"""Step 3 - output-area (OA) master (paper 2.5, 3.3; N = 832).

Inputs (data/)
  Bukgu_OA_zonal_areaweighted.csv  GEE area-weighted zonal means for all 919 Buk-gu OAs (gee/oa_zonal_areaweighted.js)
  Bukgu_OA_queen_neighbors.csv     GEE Queen neighbour list (touching boundary or vertex)
  2024 고령인구비율.xlsx            SGIS 2024 population by sex/age (sheet 1; in_age_014..021 = 65+)
  sgis_2024_total_population.csv   SGIS 2024 population totals (to_in_001 = total population)
  sgis_2024_housing_by_year.csv    SGIS 2024 housing by construction year (ho_yr_001..003 = built 1999 or earlier)
  dong_names.json                  administrative dong code -> name
Outputs
  data/Bukgu_OA_Master_v3_base.csv  analysis sample before standardisation
  data/queen_oa_v3.gal              Queen contiguity for the 832 OAs (GeoDa/PySAL GAL format)

Exclusions: no residents (15), no valid LST in 2020 or 2025 (67; Landsat C2 ST gaps from missing ASTER GED),
no housing statistics (5) -> 832 OAs (91.4 % of Buk-gu residents).
Suppressed SGIS housing cells (1-4 units, shown as N/A) are imputed as 2.5 (use NA_HOUSE=0 to test 0).
"""
from pathlib import Path
import json, os
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / 'data'
NA_HOUSE = float(os.environ.get('NA_HOUSE', 2.5))

z = pd.read_csv(D / 'Bukgu_OA_zonal_areaweighted.csv', dtype={'TOT_OA_CD': str, 'ADM_CD': str}).set_index('TOT_OA_CD')

# elderly (65+) from SGIS population by age
s1 = pd.read_excel(D / '2024 고령인구비율.xlsx', sheet_name=0, header=3, dtype={'행 레이블': str}) \
       .rename(columns={'행 레이블': 'oa'})
s1 = s1[s1.oa.str.match(r'^\d{14}$', na=False)].set_index('oa')
eld = s1[[f'in_age_{i:03d}' for i in range(14, 22)]].sum(axis=1).rename('eld65')

# total population (no unknown-age gap)
t = pd.read_csv(D / 'sgis_2024_total_population.csv', header=None, names=['yr', 'oa', 'item', 'v'], dtype={'oa': str})
tot = pd.to_numeric(t[t.item == 'to_in_001'].set_index('oa').v, errors='coerce').rename('to_in_001')

# housing by construction year
h = pd.read_csv(D / 'sgis_2024_housing_by_year.csv', header=None, names=['yr', 'oa', 'code', 'cnt'], dtype=str)
h['n'] = pd.to_numeric(h.cnt, errors='coerce').fillna(NA_HOUSE)
house_old = h[h.code.isin(['ho_yr_001', 'ho_yr_002', 'ho_yr_003'])].groupby('oa').n.sum().rename('house_old')
house_tot = h.groupby('oa').n.sum().rename('house_tot')

d = z.join(pd.concat([eld, tot], axis=1), how='left').join(house_old).join(house_tot)
d['eld65'] = d.eld65.fillna(0)
d['house_old'] = d.house_old.fillna(0)
print(f'output areas in Buk-gu            : {len(d)}   residents {d.to_in_001.sum():,.0f}')
a = d[d.to_in_001 > 0]
print(f'  no residents                    : {len(d) - len(a)}')
nolst = a.LST25_abs.isna() | a.dRLST.isna()
print(f'  no valid LST (2020 or 2025)     : {nolst.sum()}   residents {a[nolst].to_in_001.sum():,.0f}')
b = a[~nolst]
nohouse = ~(b.house_tot > 0)
print(f'  no housing statistics           : {nohouse.sum()}   residents {b[nohouse].to_in_001.sum():,.0f}')
m = b[~nohouse].copy()
print(f'analysis sample                   : {len(m)}   residents {m.to_in_001.sum():,.0f} '
      f'({100 * m.to_in_001.sum() / d.to_in_001.sum():.1f} %)')

names = json.load(open(D / 'dong_names.json', encoding='utf-8'))
m['Admin'] = [names[c[:8]] for c in m.index]
m['Abs_mean'] = m.LST25_abs           # 2025 summer mean LST (°C)
m['dRL_mean'] = m.dRLST               # ΔRLST 2020-2025
m['dNB_mean'] = m.dNDBI               # ΔNDBI 2020-2025 (reflectance-based)
m['SAVI'] = m.SAVI25_max              # 2025 SAVI (May-Oct max composite)
m['Elderly_Ratio'] = 100 * m.eld65 / m.to_in_001
m['Old_housing_Ratio'] = 100 * m.house_old / m.house_tot
assert m.Elderly_Ratio.between(0, 100).all() and m.Old_housing_Ratio.between(0, 100).all()
m.index.name = 'TOT_OA_CD'
m.to_csv(D / 'Bukgu_OA_Master_v3_base.csv', encoding='utf-8-sig')
print('wrote data/Bukgu_OA_Master_v3_base.csv')

# Queen GAL restricted to the analysis sample (self-links removed)
nb = pd.read_csv(D / 'Bukgu_OA_queen_neighbors.csv', dtype=str)
ids = set(m.index)
lines = [f'0 {len(m)} TOT_OA_CD queen']
islands = 0
for oa, s in zip(nb.oa, nb.nbrs):
    if oa not in ids:
        continue
    nn = [x for x in s.split(';') if x != oa and x in ids]
    islands += len(nn) == 0
    lines += [f'{oa} {len(nn)}', ' '.join(nn)]
open(D / 'queen_oa_v3.gal', 'w').write('\n'.join(lines) + '\n')
print(f'wrote data/queen_oa_v3.gal  (islands: {islands})')
