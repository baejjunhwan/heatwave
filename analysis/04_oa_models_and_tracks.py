"""Step 4 - OA models, Track 1/2 scores and robustness (paper 3.3-3.5, Tables 4-9, Appendix Table 1 Panel B).

DV = Abs LST 2025, IVs = ΔNDBI, Elderly_Ratio, Old_housing_Ratio, SAVI 2025, DEM (N = 832).
OLS + VIF, residual Moran's I (Queen GAL, 999 permutations), LM tests, ML spatial error / spatial lag models.
Track 1 = Z(Abs LST) + Z(Elderly);  Track 2 = Z(ΔNDBI) + Z(Old housing) + Z(ΔRLST);  top 10 % = 83 OAs.
Outputs: data/Bukgu_OA_Master_v3.csv, data/z_score_v3.xlsx, results/oa_results.json
"""
from pathlib import Path
import json
import numpy as np
import pandas as pd
from scipy.stats import spearmanr, pearsonr, mstats, skew
from spatial_models import read_gal, ols, moran_perm, lm_tests, ml_error, ml_lag

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / 'data'
d = pd.read_csv(D / 'Bukgu_OA_Master_v3_base.csv', dtype={'TOT_OA_CD': str, 'ADM_CD': str}).set_index('TOT_OA_CD')
W, _, islands = read_gal(D / 'queen_oa_v3.gal', d.index.tolist())
R = {'n': len(d), 'islands': islands}

V = ['Abs_mean', 'dNB_mean', 'Elderly_Ratio', 'Old_housing_Ratio', 'SAVI', 'DEM', 'dRL_mean']
R['desc'] = d[V].describe().T[['count', 'mean', 'std', 'min', 'max']].to_dict('index')
R['r_abs_elderly'] = pearsonr(d.Abs_mean, d.Elderly_Ratio)
R['r_abs_oldhousing'] = pearsonr(d.Abs_mean, d.Old_housing_Ratio)
R['skew'] = {'Elderly_Ratio': skew(d.Elderly_Ratio), 'Old_housing_Ratio': skew(d.Old_housing_Ratio)}
R['old_housing_0_100'] = [int((d.Old_housing_Ratio == 0).sum()), int((d.Old_housing_Ratio >= 99.9999).sum())]

# ---- regression models -------------------------------------------------------------------
names = ['Intercept', 'dNB_mean', 'Elderly_Ratio', 'Old_housing_Ratio', 'SAVI2025', 'DEM']
X = np.column_stack([np.ones(len(d)), d.dNB_mean, d.Elderly_Ratio, d.Old_housing_Ratio, d.SAVI, d.DEM])
y = d.Abs_mean.values
o = ols(y, X, names)
se, sl = ml_error(y, X, W), ml_lag(y, X, W)
R['ols'] = {k: (v.tolist() if hasattr(v, 'tolist') else v) for k, v in o.items() if k not in ('e',)}
R['moran_ols'] = moran_perm(o['e'], W)
R['lm_tests'] = lm_tests(y, X, W, o)
R['sem'] = {k: (v.tolist() if hasattr(v, 'tolist') else v) for k, v in se.items() if k in ('coef', 'se', 'z', 'p', 'lam', 'll', 'aic', 'pr2')}
R['sem_moran'] = moran_perm(se['e_filtered'], W)
R['slm'] = {k: (v.tolist() if hasattr(v, 'tolist') else v) for k, v in sl.items() if k in ('coef', 'se', 'z', 'p', 'rho', 'll', 'aic', 'pr2', 'direct', 'indirect', 'total')}
R['slm_moran'] = moran_perm(sl['e'], W)

print(f"OLS: N = {len(d)}  R2 = {o['r2']:.3f}  adj.R2 = {o['ar2']:.3f}  F{o['df']} = {o['F']:.1f}  max VIF = {o['vif'].max():.2f}  AIC = {o['aic']:.0f}")
print(f"{'':18s}{'OLS B':>10s}{'p':>8s}{'beta':>8s} | {'SEM B':>9s}{'p':>8s} | {'SLM B':>9s}{'p':>8s}")
for i, k in enumerate(names):
    print(f"{k:18s}{o['b'][i]:10.4f}{o['p'][i]:8.3f}{o['beta'][i]:8.3f} | {se['coef'][i]:9.4f}{se['p'][i]:8.3f} | "
          f"{sl['coef'][i]:9.4f}{sl['p'][i]:8.3f}")
print(f"lambda = {se['lam']:.3f}   rho = {sl['rho']:.3f}   AIC OLS/SEM/SLM = {o['aic']:.0f}/{se['aic']:.0f}/{sl['aic']:.0f}")
print(f"Moran's I residuals OLS/SEM/SLM = {R['moran_ols'][0]:.3f}/{R['sem_moran'][0]:.3f} (p={R['sem_moran'][1]:.3f})/{R['slm_moran'][0]:.3f}")

# ---- Track scores ------------------------------------------------------------------------
z = lambda s: (s - s.mean()) / s.std(ddof=1)
zmad = lambda s: (s - s.median()) / (1.4826 * (s - s.median()).abs().median())
wins = lambda s: pd.Series(mstats.winsorize(s.values, limits=[.05, .05]), index=s.index)
d['Z_Abs'], d['Z_Elderly'] = z(d.Abs_mean), z(d.Elderly_Ratio)
d['Z_dNB'], d['Z_Old'], d['Z_dRL'] = z(d.dNB_mean), z(d.Old_housing_Ratio), z(d.dRL_mean)
d['Track1_Score'] = d.Z_Abs + d.Z_Elderly
d['Track2_Score'] = d.Z_dNB + d.Z_Old + d.Z_dRL
d['Track1_Rank'] = d.Track1_Score.rank(ascending=False, method='min').astype(int)
d['Track2_Rank'] = d.Track2_Score.rank(ascending=False, method='min').astype(int)
top = round(len(d) * .1)
t1, t2 = set(d.Track1_Score.nlargest(top).index), set(d.Track2_Score.nlargest(top).index)
d['Track1_Top10'] = d.index.isin(t1)
d['Track2_Top10'] = d.index.isin(t2)
R['top_n'] = top
R['r_track1_track2'] = pearsonr(d.Track1_Score, d.Track2_Score)
R['overlap_top10'] = len(t1 & t2)
R['overlap_expected_if_independent'] = top * top / len(d)
R['corr_track2_components'] = d[['dNB_mean', 'Old_housing_Ratio', 'dRL_mean']].corr().to_dict()
R['corr_track2_components_p'] = {f'{a}|{b}': pearsonr(d[a], d[b])[1] for a, b in
                                 [('dNB_mean', 'Old_housing_Ratio'), ('dNB_mean', 'dRL_mean'), ('Old_housing_Ratio', 'dRL_mean')]}

# robustness (Table 9)
Zm = d[['Z_dNB', 'Z_Old', 'Z_dRL']].values
ev, evec = np.linalg.eigh(np.corrcoef(Zm.T))
i = np.argmax(ev)
pc1 = evec[:, i] * np.sign(evec[:, i].sum())
R['pca_pc1_share'], R['pca_pc1_loadings'] = ev[i] / ev.sum(), pc1.tolist()

# sensitivity to suppressed housing cells imputed as 0 instead of 2.5
h = pd.read_csv(D / 'sgis_2024_housing_by_year.csv', header=None, names=['yr', 'oa', 'code', 'cnt'], dtype=str)
h['n'] = pd.to_numeric(h.cnt, errors='coerce').fillna(0)
old0 = (h[h.code.isin(['ho_yr_001', 'ho_yr_002', 'ho_yr_003'])].groupby('oa').n.sum()
        / h.groupby('oa').n.sum() * 100).reindex(d.index).fillna(0)
alts = {'Track 2: Robust (MAD) standardisation': zmad(d.dNB_mean) + zmad(d.Old_housing_Ratio) + zmad(d.dRL_mean),
        'Track 2: Winsorizing (5%/95%)': z(wins(d.dNB_mean)) + z(wins(d.Old_housing_Ratio)) + z(wins(d.dRL_mean)),
        'Track 2: PCA-based weighting': pd.Series(Zm @ pc1, index=d.index),
        'Track 2: Excluding dNB_mean': d.Z_Old + d.Z_dRL,
        'Track 2: suppressed housing cells = 0': d.Z_dNB + z(old0) + d.Z_dRL,
        'Track 1: Winsorizing (5%/95%)': z(wins(d.Abs_mean)) + z(wins(d.Elderly_Ratio)),
        'Track 1: Robust (MAD) standardisation': zmad(d.Abs_mean) + zmad(d.Elderly_Ratio)}
rob = []
for k, a in alts.items():
    base, bs = (d.Track1_Score, t1) if k.startswith('Track 1') else (d.Track2_Score, t2)
    ov = len(bs & set(a.nlargest(top).index))
    rob.append(dict(method=k, spearman=spearmanr(base, a)[0], overlap=ov, overlap_pct=100 * ov / top))
    if 'Winsorizing' in k:
        rk = a.rank(ascending=False, method='min')
        lead = (d.Track1_Score if k.startswith('Track 1') else d.Track2_Score).nlargest(5).index
        rob[-1]['top5_rank_after'] = {c: int(rk[c]) for c in lead}
R['robustness'] = rob
print('\nRobustness (Table 9)')
for r_ in rob:
    print(f"  {r_['method']:42s} rho = {r_['spearman']:.3f}  overlap = {r_['overlap']} ({r_['overlap_pct']:.1f} %)")

# non-compensatory check and Track 2 typology
nc = d[(d.Z_Abs >= 1) & (d.Z_Elderly >= 1)]
R['track1_noncompensatory'] = dict(n=len(nc), in_top10=len(set(nc.index) & t1))
R['track2_top10_dominant_component'] = d.loc[list(t2), ['Z_dNB', 'Z_Old', 'Z_dRL']].idxmax(axis=1).value_counts().to_dict()
R['both_tracks_top10'] = d.loc[sorted(t1 & t2), ['Admin', 'Track1_Rank', 'Track2_Rank']].reset_index().to_dict('records')
print(f"\nr(Track1, Track2) = {R['r_track1_track2'][0]:.3f}; top-10 % overlap = {R['overlap_top10']} of {top} "
      f"({100 * R['overlap_top10'] / top:.1f} %), expected if independent = {R['overlap_expected_if_independent']:.1f}")

# ---- outputs ----------------------------------------------------------------------------
cols = ['ADM_CD', 'Admin', 'cx', 'cy', 'area_m2', 'to_in_001', 'eld65', 'house_old', 'house_tot',
        'Abs_mean', 'dRL_mean', 'dNB_mean', 'SAVI', 'DEM', 'Elderly_Ratio', 'Old_housing_Ratio',
        'RLST20', 'RLST25', 'NDBI20', 'NDBI25', 'SAVI25_mean', 'valid20', 'valid25',
        'Z_Abs', 'Z_Elderly', 'Z_dNB', 'Z_Old', 'Z_dRL', 'Track1_Score', 'Track2_Score',
        'Track1_Rank', 'Track2_Rank', 'Track1_Top10', 'Track2_Top10']
d[cols].to_csv(D / 'Bukgu_OA_Master_v3.csv', encoding='utf-8-sig')
show = ['Admin', 'Abs_mean', 'Elderly_Ratio', 'dNB_mean', 'Old_housing_Ratio', 'dRL_mean',
        'Track1_Score', 'Track1_Rank', 'Track2_Score', 'Track2_Rank']
with pd.ExcelWriter(D / 'z_score_v3.xlsx') as xw:
    d[cols].to_excel(xw, sheet_name='OA_master_N832')
    d.sort_values('Track1_Score', ascending=False).head(top)[show].to_excel(xw, sheet_name='Track1_top10pct')
    d.sort_values('Track2_Score', ascending=False).head(top)[show].to_excel(xw, sheet_name='Track2_top10pct')
    d.loc[sorted(t1 & t2), show].to_excel(xw, sheet_name='Both_tracks_top10pct')
    pd.DataFrame(rob).drop(columns=['top5_rank_after'], errors='ignore').to_excel(xw, sheet_name='Robustness', index=False)
(ROOT / 'results').mkdir(exist_ok=True)
json.dump(R, open(ROOT / 'results' / 'oa_results.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1,
          default=lambda x: x.tolist() if hasattr(x, 'tolist') else float(x))
print('\nwrote data/Bukgu_OA_Master_v3.csv, data/z_score_v3.xlsx, results/oa_results.json')
