"""Step 1 - 100 m grid master (paper 3.2, N = 11,752).

Inputs (data/)
  전체종합_구역통계-빈셀 제거.csv        QGIS zonal means per 100 m cell (LST, SAVI, DEM; N = 11,809)
  Bukgu_NDBI_2020_2025_100m_grid.csv   reflectance-based NDBI per cell (gee/ndbi_reextract_2020_2025.js)
  grid_oa_map.csv                      cell -> SGIS output-area code (cell centre inside an output area)
Output
  data/Bukgu_Grid_Master_v3.csv

Sample rule: keep cells whose centre lies inside an SGIS output area (drops 52 edge cells)
and whose ΔNDBI could be computed (drops 5 more) -> 11,752 cells.
"""
from pathlib import Path
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / 'data'

zon = pd.read_csv(D / '전체종합_구역통계-빈셀 제거.csv')
ndbi = pd.read_csv(D / 'Bukgu_NDBI_2020_2025_100m_grid.csv').drop(columns=['id'])
ndbi['col'] = ndbi.col.astype(int)
ndbi['row'] = ndbi.row.astype(int)
oa = pd.read_csv(D / 'grid_oa_map.csv', dtype={'TOT_OA_CD': str})

m = (zon.merge(ndbi, left_on=['col_index', 'row_index'], right_on=['col', 'row'], how='left')
        .merge(oa, on=['row_index', 'col_index'], how='left'))
print(f'cells in zonal table      : {len(m):,}')
print(f'  centre outside any OA   : {m.TOT_OA_CD.isna().sum():,}')
print(f'  no ΔNDBI (inside an OA) : {(m.TOT_OA_CD.notna() & m.dNDBI.isna()).sum():,}')
g = m[m.TOT_OA_CD.notna() & m.dNDBI.notna()].copy()
print(f'analysis sample           : {len(g):,}')

keep = ['id', 'row_index', 'col_index', 'cx', 'cy', 'TOT_OA_CD', 'center_in',
        'dLST_mean', 'LST20_mean', 'LST25_mean', 'dSAVI', 'SAVI20_mea', 'SAVI25_mea', 'DEM_mean',
        'NDBI20', 'NDBI25', 'dNDBI', 'dNDBI_mean']
g[keep].rename(columns={'dLST_mean': 'dRLST', 'LST20_mean': 'RLST2020', 'LST25_mean': 'RLST2025',
                        'SAVI20_mea': 'SAVI2020', 'SAVI25_mea': 'SAVI2025', 'DEM_mean': 'DEM',
                        'dNDBI_mean': 'dNDBI_v2_raw_DN', 'center_in': 'center_in_GEE_boundary'}) \
    .to_csv(D / 'Bukgu_Grid_Master_v3.csv', index=False, encoding='utf-8-sig')
print('wrote data/Bukgu_Grid_Master_v3.csv')
