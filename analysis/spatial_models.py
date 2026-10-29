"""Spatial econometrics helpers used in the paper (numpy/scipy only).

- ols, read_gal, moran_perm, lm_tests, ml_error, ml_lag : output-area models (dense W, N=832)
- queen_grid, moran_normal, gm_error_het                : 100 m grid models (sparse W, N=11,752)
"""
import numpy as np
from scipy import optimize, stats


def read_gal(path, ids):
    """Return dense row-standardized W ordered by `ids` (list of str)."""
    idx = {k: i for i, k in enumerate(ids)}
    n = len(ids)
    W = np.zeros((n, n))
    with open(path, encoding='utf-8-sig') as f:
        f.readline()
        lines = [l.strip() for l in f if l.strip()]
    for a, b in zip(lines[0::2], lines[1::2]):
        k, cnt = a.split()
        nb = b.split() if int(cnt) > 0 else []
        if k not in idx:
            continue
        for j in nb:
            if j in idx:
                W[idx[k], idx[j]] = 1
    nn = W.sum(1)
    islands = int((nn == 0).sum())
    Wb = W.copy()
    nn[nn == 0] = 1
    return W / nn[:, None], Wb, islands


def ols(y, X, names):
    n, k = X.shape
    XtXi = np.linalg.inv(X.T @ X)
    b = XtXi @ X.T @ y
    e = y - X @ b
    sse = e @ e
    s2 = sse / (n - k)
    se = np.sqrt(np.diag(XtXi) * s2)
    t = b / se
    p = 2 * stats.t.sf(np.abs(t), n - k)
    r2 = 1 - sse / ((y - y.mean()) @ (y - y.mean()))
    ar2 = 1 - (1 - r2) * (n - 1) / (n - k)
    sig2ml = sse / n
    ll = -n / 2 * (np.log(2 * np.pi) + np.log(sig2ml) + 1)
    aic = -2 * ll + 2 * k
    F = (r2 / (k - 1)) / ((1 - r2) / (n - k))
    sy = y.std(ddof=1)
    beta = b * X.std(0, ddof=1) / sy
    beta[0] = np.nan
    # VIF
    vif = []
    for j in range(1, k):
        others = [c for c in range(1, k) if c != j]
        Xo = np.column_stack([np.ones(n), X[:, others]])
        bj = np.linalg.lstsq(Xo, X[:, j], rcond=None)[0]
        ej = X[:, j] - Xo @ bj
        r2j = 1 - ej @ ej / ((X[:, j] - X[:, j].mean()) @ (X[:, j] - X[:, j].mean()))
        vif.append(1 / (1 - r2j))
    return dict(b=b, se=se, t=t, p=p, r2=r2, ar2=ar2, ll=ll, aic=aic, F=F, df=(k - 1, n - k), e=e,
                beta=beta, vif=np.array(vif), names=names, n=n, k=k, sig2=sse / n)


def moran_perm(e, W, perms=999, seed=1):
    """Moran's I with a permutation p-value (dense W)."""
    n = len(e)
    z = e - e.mean()
    I = n / W.sum() * (z @ W @ z) / (z @ z)
    rng = np.random.default_rng(seed)
    sims = np.empty(perms)
    for s in range(perms):
        zp = rng.permutation(z)
        sims[s] = n / W.sum() * (zp @ W @ zp) / (zp @ zp)
    p = (np.sum(np.abs(sims - sims.mean()) >= abs(I - sims.mean())) + 1) / (perms + 1)
    return I, p


def lm_tests(y, X, W, res):
    n = len(y)
    e = res['e']
    s2 = e @ e / n
    WX_b = W @ (X @ res['b'])
    M = np.eye(n) - X @ np.linalg.inv(X.T @ X) @ X.T
    T = np.trace(W.T @ W + W @ W)
    D = (WX_b @ M @ WX_b) / s2 + T
    eWe = e @ W @ e / s2
    eWy = e @ W @ y / s2
    lm_e = eWe ** 2 / T
    lm_l = eWy ** 2 / D
    rlm_e = (eWe - T / D * eWy) ** 2 / (T - T ** 2 / D)
    rlm_l = (eWy - eWe) ** 2 / (D - T)
    out = {}
    for k_, v in [('LM-error', lm_e), ('LM-lag', lm_l), ('Robust LM-error', rlm_e), ('Robust LM-lag', rlm_l)]:
        out[k_] = (v, stats.chi2.sf(v, 1))
    return out


def _bounds(omega):
    return 1 / omega.min() + 1e-6, 1 / omega.max() - 1e-6


def ml_lag(y, X, W):
    n, k = X.shape
    omega = np.real(np.linalg.eigvals(W))
    Wy = W @ y
    XtXi = np.linalg.inv(X.T @ X)
    b0 = XtXi @ X.T @ y
    bL = XtXi @ X.T @ Wy
    e0 = y - X @ b0
    eL = Wy - X @ bL

    def nll(r):
        e = e0 - r * eL
        s2 = e @ e / n
        return -(-n / 2 * np.log(2 * np.pi * s2) + np.sum(np.log(1 - r * omega)) - n / 2)
    lo, hi = _bounds(omega)
    r = optimize.minimize_scalar(nll, bounds=(max(lo, -0.99), min(hi, 0.99)), method='bounded',
                                 options={'xatol': 1e-10}).x
    b = b0 - r * bL
    e = y - r * Wy - X @ b
    s2 = e @ e / n
    ll = -nll(r)
    A = np.eye(n) - r * W
    Ai = np.linalg.inv(A)
    WA = W @ Ai
    WAXb = WA @ X @ b
    info = np.zeros((k + 2, k + 2))
    info[:k, :k] = X.T @ X / s2
    info[:k, k] = info[k, :k] = X.T @ WAXb / s2
    info[k, k] = np.trace(WA @ WA) + np.trace(WA.T @ WA) + WAXb @ WAXb / s2
    info[k, k + 1] = info[k + 1, k] = np.trace(WA) / s2
    info[k + 1, k + 1] = n / (2 * s2 ** 2)
    V = np.linalg.inv(info)
    se = np.sqrt(np.diag(V))
    coef = np.append(b, r)
    z = coef / se[:k + 1]
    p = 2 * stats.norm.sf(np.abs(z))
    aic = -2 * ll + 2 * (k + 1)
    # impacts
    direct = np.mean(np.diag(Ai)) * b[1:]
    total = b[1:] / (1 - r)
    indirect = total - direct
    # pseudo R2 (squared corr between y and predicted)
    yhat = Ai @ (X @ b)
    pr2 = np.corrcoef(y, yhat)[0, 1] ** 2
    return dict(coef=coef, se=se[:k + 1], z=z, p=p, rho=r, ll=ll, aic=aic, e=e, s2=s2,
                direct=direct, indirect=indirect, total=total, pr2=pr2, V=V)


def ml_error(y, X, W):
    n, k = X.shape
    omega = np.real(np.linalg.eigvals(W))
    Wy = W @ y
    WX = W @ X

    def fit(l):
        ys = y - l * Wy
        Xs = X - l * WX
        b = np.linalg.lstsq(Xs, ys, rcond=None)[0]
        e = ys - Xs @ b
        return b, e

    def nll(l):
        b, e = fit(l)
        s2 = e @ e / n
        return -(-n / 2 * np.log(2 * np.pi * s2) + np.sum(np.log(1 - l * omega)) - n / 2)
    lo, hi = _bounds(omega)
    l = optimize.minimize_scalar(nll, bounds=(max(lo, -0.99), min(hi, 0.99)), method='bounded',
                                 options={'xatol': 1e-10}).x
    b, ef = fit(l)
    s2 = ef @ ef / n
    ll = -nll(l)
    B = np.eye(n) - l * W
    WB = W @ np.linalg.inv(B)
    Xs = B @ X
    Vb = s2 * np.linalg.inv(Xs.T @ Xs)
    info2 = np.array([[np.trace(WB @ WB) + np.trace(WB.T @ WB), np.trace(WB) / s2],
                      [np.trace(WB) / s2, n / (2 * s2 ** 2)]])
    V2 = np.linalg.inv(info2)
    se = np.append(np.sqrt(np.diag(Vb)), np.sqrt(V2[0, 0]))
    coef = np.append(b, l)
    z = coef / se
    p = 2 * stats.norm.sf(np.abs(z))
    aic = -2 * ll + 2 * (k + 1)
    u = y - X @ b
    yhat = X @ b
    pr2 = np.corrcoef(y, yhat)[0, 1] ** 2
    return dict(coef=coef, se=se, z=z, p=p, lam=l, ll=ll, aic=aic, e_filtered=ef, u=u, s2=s2, pr2=pr2)


# ---------------------------------------------------------------- grid (sparse) helpers
from scipy import sparse

def queen_grid(cols, rows):
    idx = {(c, r): i for i, (c, r) in enumerate(zip(cols, rows))}
    R, C = [], []
    for i, (c, r) in enumerate(zip(cols, rows)):
        for dc in (-1, 0, 1):
            for dr in (-1, 0, 1):
                if dc == 0 and dr == 0: continue
                j = idx.get((c + dc, r + dr))
                if j is not None: R.append(i); C.append(j)
    n = len(idx)
    W = sparse.csr_matrix((np.ones(len(R)), (R, C)), shape=(n, n))
    rs = np.asarray(W.sum(1)).ravel(); inv = np.where(rs > 0, 1 / np.where(rs > 0, rs, 1), 0)
    return sparse.diags(inv) @ W

def moran_normal(e, W):
    """Moran's I with a normal-approximation p-value (sparse W)."""
    z = e - e.mean(); n = len(z); S0 = W.sum()
    I = n / S0 * (z @ (W @ z)) / (z @ z)
    # normality-assumption z test
    Ws = W + W.T; S1 = 0.5 * Ws.multiply(Ws).sum()
    S2 = ((np.asarray(W.sum(1)).ravel() + np.asarray(W.sum(0)).ravel()) ** 2).sum()
    EI = -1 / (n - 1)
    VI = (n * n * S1 - n * S2 + 3 * S0 * S0) / ((n * n - 1) * S0 * S0) - EI ** 2
    zI = (I - EI) / np.sqrt(VI)
    return I, 2 * stats.norm.sf(abs(zI))

def gm_error(y, X, W):
    """Kelejian-Prucha (1999) GM spatial error model, as in PySAL spreg.GM_Error."""
    n = len(y)
    b0 = np.linalg.lstsq(X, y, rcond=None)[0]; u = y - X @ b0
    wu = W @ u; wwu = W @ wu
    trWtW = W.multiply(W).sum()
    g = np.array([u @ u, wu @ wu, u @ wu]) / n
    G = np.array([[2 * (u @ wu), -(wu @ wu), n],
                  [2 * (wu @ wwu), -(wwu @ wwu), trWtW],
                  [u @ wwu + wu @ wu, -(wu @ wwu), 0.]]) / n
    f = lambda p: np.sum((G @ np.array([p[0], p[0] ** 2, p[1]]) - g) ** 2)
    res = optimize.fmin_l_bfgs_b(f, [0.0, 0.0], approx_grad=True)
    lam = res[0][0]
    xs = X - lam * (W @ X); ys = y - lam * (W @ y)
    XtXi = np.linalg.inv(xs.T @ xs); b = XtXi @ xs.T @ ys
    es = ys - xs @ b; sig2 = es @ es / n
    se = np.sqrt(np.diag(sig2 * XtXi)); zst = b / se; p = 2 * stats.norm.sf(np.abs(zst))
    u2 = y - X @ b; ef = u2 - lam * (W @ u2)
    return dict(b=b, se=se, z=zst, p=p, lam=lam, u=u2, e_filtered=ef, sig2=sig2)

def _optim(G, g, vc=None, bound=(-1.0, 1.0)):
    G = G.copy(); g = g.copy()
    if vc is not None:
        Ec = np.linalg.cholesky(np.linalg.inv(vc)).T
        G = Ec @ G; g = Ec @ g
    sc = min(G.min(), g.min()); G = G / sc; g = g / sc
    f = lambda p: np.sum((G @ np.array([p[0], p[0] ** 2]) - g) ** 2)
    return optimize.fmin_l_bfgs_b(f, [0.0], approx_grad=True, bounds=[bound])[0][0]

def gm_error_het(y, X, W, max_iter=1, eps=1e-5):
    """Arraiz, Drukker, Kelejian & Prucha (2010) heteroskedasticity-robust GM SEM,
    following PySAL spreg.GM_Error_Het / GMM_Error(estimator='het') defaults (max_iter=1)."""
    n = len(y)
    WtW = (W.T @ W).tocsr()
    A1 = WtW - sparse.diags(WtW.diagonal())
    def moments(u):
        A1u = A1 @ u; wu = W @ u
        g = np.array([u @ A1u, u @ wu]) / n
        G = np.array([[2 * (wu @ A1u), -(wu @ (A1 @ wu))],
                      [wu @ ((W + W.T) @ u), -(wu @ (W @ wu))]]) / n
        return G, g
    def vc_het(u, lam):
        e2 = (u - lam * (W @ u)) ** 2; E = sparse.diags(e2)
        a = (2 * A1) @ E; b = (W + W.T) @ E
        p11 = a.multiply(a.T).sum(); p12 = a.multiply(b.T).sum(); p22 = b.multiply(b.T).sum()
        return np.array([[p11, p12], [p12, p22]]) / (2.0 * n)
    b0 = np.linalg.lstsq(X, y, rcond=None)[0]; u = y - X @ b0
    lam = _optim(*moments(u))
    it, d = 0, 1
    while it < max_iter and d > eps:
        xs = X - lam * (W @ X); ys = y - lam * (W @ y)
        b = np.linalg.lstsq(xs, ys, rcond=None)[0]
        u = y - X @ b
        G, g = moments(u)
        lam2 = _optim(G, g, vc_het(u, lam))
        d = abs(lam2 - lam); lam = lam2; it += 1
    xs = X - lam * (W @ X)
    ef = u - lam * (W @ u)
    XtXi = np.linalg.inv(xs.T @ xs)
    meat = (xs * (ef ** 2)[:, None]).T @ xs
    vm = XtXi @ meat @ XtXi
    se = np.sqrt(np.diag(vm)); zst = b / se; p = 2 * stats.norm.sf(np.abs(zst))
    return dict(b=b, se=se, z=zst, p=p, lam=lam, u=u, e_filtered=ef, iterations=it)
