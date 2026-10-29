"""Track 2 성분 점검(토의용 추가 분석) → results/track2_component_checks.json

1) 성분별 영향: 한 성분을 뺄 때 상위 117칸 유지 수, 상위 칸 평균 Z, 분산 기여
2) ΔNDBI 대신 2025년 NDBI, SAVI(2025 수준·변화량) 추가·대체
3) 노후 지붕을 4층·5층 이하 건물로 한정 (data/buildings/Bukgu_grid100_floors.tif, GEE track2_grid_floors.js 산출)
"""
import os, sys, json, numpy as np, pandas as pd
from scipy.stats import spearmanr
sys.path.insert(0, os.path.dirname(__file__)); from read_lzw_tif import read
D = pd.read_pickle('work/t2grid/final.pkl')
z = lambda s: (s - s.mean()) / s.std(ddof=1)
S = D.score; T = int(D.top.sum()); top = set(S.nlargest(T).index)
out = {'N': len(D), 'top': T}
def comp(parts):
    Zs = pd.DataFrame({p: z(D[p]) for p in parts}); s = Zs.sum(axis=1); t = set(s.nlargest(T).index)
    return {'rho': round(spearmanr(s, S)[0], 3), 'keep': len(t & top),
            'dominant': {k: int(v) for k, v in Zs.loc[list(t)].idxmax(axis=1).value_counts().items()},
            'var_share': {p: round(float(np.cov(Zs[p], s)[0, 1] / s.var()), 3) for p in parts}}
base = ['dNDBI', 'old_h', 'dRLST']
out['base'] = comp(base)
out['top_mean_z'] = {k: round(float(D.loc[list(top), k].mean()), 2) for k in ['Zn', 'Zo', 'Zr']}
out['drop_one'] = {p: comp([q for q in base if q != p]) for p in base}
D['green_deficit'] = -D.SAVI2025; D['green_loss'] = -D.dSAVI
out['NDBI2025_instead_of_dNDBI'] = comp(['NDBI25', 'old_h', 'dRLST'])
out['add_green_deficit'] = comp(base + ['green_deficit'])
out['add_green_loss'] = comp(base + ['green_loss'])
out['green_loss_instead_of_dNDBI'] = comp(['green_loss', 'old_h', 'dRLST'])
arr, _ = read('data/buildings/Bukgu_grid100_floors.tif')   # res_h, known_h, old_h, old_lo4, old_lo5, old_flna
r, c = D.row_index.astype(int).values, D.col_index.astype(int).values
for i, n in enumerate(['f_res_h', 'f_known_h', 'f_old_h', 'old_lo4', 'old_lo5', 'old_flna']):
    D[n] = arr[r, c, i]
assert np.allclose(D.f_old_h, D.old_h), 'floors tif old_h differs from buildings tif'
out['floors'] = {'old_roof_ha_bukgu': {n: round(float(arr[..., i].sum() / 1e4), 1) for i, n in [(2, 'all'), (3, 'le4F'), (4, 'le5F'), (5, 'floor_missing')]},
                 'top_share_le4F_pct': round(float(D.loc[list(top), 'old_lo4'].sum() / D.loc[list(top), 'old_h'].sum() * 100), 1),
                 'le4F': comp(['dNDBI', 'old_lo4', 'dRLST']), 'le5F': comp(['dNDBI', 'old_lo5', 'dRLST'])}
json.dump(out, open('results/track2_component_checks.json', 'w'), ensure_ascii=False, indent=1)
print(json.dumps(out, ensure_ascii=False, indent=1))
