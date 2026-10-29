"""Step 2 - grid models (paper 3.2, Table 2-3, Appendix Table 1 Panel A).

DV = ΔRLST (2025 - 2020), IVs = RLST2020, ΔSAVI, SAVI2020, ΔNDBI, DEM.
OLS + VIF, residual Moran's I (Queen, row-standardised), GM spatial error model.
Robustness: drop cells whose centre is outside the GEE dong boundary (N = 11,370).
Output: results/grid_results.json
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from scipy import sparse, stats
from spatial_models import ols, queen_grid, moran_normal, _optim


def gm_error_grid(y, X, W):
    """GM spatial error model used for the grid (Arraiz et al. 2010 moment conditions, first-step
    lambda from OLS residuals) with heteroskedasticity-robust (sandwich) standard errors."""
    n = len(y)
    WtW = (W.T @ W).tocsr()
    A1 = WtW - sparse.diags(WtW.diagonal())
    u = y - X @ np.linalg.lstsq(X, y, rcond=None)[0]
    A1u, wu = A1 @ u, W @ u
    g_ = np.array([u @ A1u, u @ wu]) / n
    G = np.array([[2 * (wu @ A1u), -(wu @ (A1 @ wu))], [wu @ ((W + W.T) @ u), -(wu @ (W @ wu))]]) / n
    lam = _optim(G, g_)
    xs, ys = X - lam * (W @ X), y - lam * (W @ y)
    XtXi = np.linalg.inv(xs.T @ xs)
    b = XtXi @ xs.T @ ys
    u2 = y - X @ b
    ef = u2 - lam * (W @ u2)
    vm = XtXi @ ((xs * (ef ** 2)[:, None]).T @ xs) @ XtXi
    se = np.sqrt(np.diag(vm))
    return dict(b=b, se=se, p=2 * stats.norm.sf(np.abs(b / se)), lam=lam, e_filtered=ef)

ROOT = Path(__file__).resolve().parents[1]
g = pd.read_csv(ROOT / 'data' / 'Bukgu_Grid_Master_v3.csv', dtype={'TOT_OA_CD': str})
NAMES = ['Intercept', 'RLST2020', 'dSAVI', 'SAVI2020', 'dNDBI', 'DEM']


def run(df, label):
    y = df.dRLST.values
    X = np.column_stack([np.ones(len(df)), df.RLST2020, df.dSAVI, df.SAVI2020, df.dNDBI, df.DEM])
    o = ols(y, X, NAMES)
    W = queen_grid(df.col_index.values, df.row_index.values)
    mi = moran_normal(o['e'], W)
    s = gm_error_grid(y, X, W)
    ms = moran_normal(s['e_filtered'], W)
    print(f"\n== {label}: N = {len(df):,}  R2 = {o['r2']:.3f}  adj.R2 = {o['ar2']:.3f}  "
          f"F{o['df']} = {o['F']:.1f}  max VIF = {o['vif'].max():.2f}")
    print(f"{'':10s}{'B':>11s}{'SE':>10s}{'t':>9s}{'p':>8s}{'beta':>8s} | {'SEM B':>9s}{'p':>10s}")
    for i, k in enumerate(NAMES):
        print(f"{k:10s}{o['b'][i]:11.4g}{o['se'][i]:10.4g}{o['t'][i]:9.3f}{o['p'][i]:8.3f}"
              f"{o['beta'][i]:8.3f} | {s['b'][i]:9.3f}{s['p'][i]:10.2g}")
    print(f"Moran's I (OLS residuals) = {mi[0]:.3f} (p = {mi[1]:.3g});  SEM lambda = {s['lam']:.3f};  "
          f"Moran's I (SEM filtered residuals) = {ms[0]:.3f} (p = {ms[1]:.3g})")
    return dict(n=len(df), names=NAMES,
                ols=dict(b=o['b'].tolist(), se=o['se'].tolist(), t=o['t'].tolist(), p=o['p'].tolist(),
                         beta=o['beta'].tolist(), r2=o['r2'], adj_r2=o['ar2'], F=o['F'], df=o['df'],
                         vif=o['vif'].tolist()),
                moran_ols=list(mi),
                sem_gm=dict(b=s['b'].tolist(), se=s['se'].tolist(), p=s['p'].tolist(), lam=s['lam'],
                            moran_filtered=list(ms)))


R = {'main': run(g, 'SGIS output-area rule (paper)')}
strict = g[g.center_in_GEE_boundary.astype(str).str.lower() == 'true']
R['robust_gee_boundary'] = run(strict, 'also inside GEE dong boundary (robustness)')
cols = ['dRLST', 'DEM', 'SAVI2020', 'dSAVI', 'RLST2020', 'dNDBI']
R['desc'] = g[cols].describe().T[['count', 'mean', 'std', 'min', 'max']].to_dict('index')
R['zero_order_r_with_dRLST'] = g[cols].corr()['dRLST'].to_dict()
print('\nDescriptive statistics (Table 3)\n', g[cols].describe().T[['count', 'mean', 'std', 'min', 'max']].round(3))
(ROOT / 'results').mkdir(exist_ok=True)
json.dump(R, open(ROOT / 'results' / 'grid_results.json', 'w'), indent=1, default=float)
print('\nwrote results/grid_results.json')
