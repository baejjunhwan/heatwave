"""Track 2 격자판 입력표 만들기 (저장소 최상위에서 실행).

data/Bukgu_Grid_Master_v3.csv(4장 격자 정본, N=11,752)에
data/buildings/Bukgu_grid100_buildings.tif(GEE track2_grid_buildings.js 산출, 칸당 m²)를 붙여
work/t2grid/g.pkl 을 만들고, 격자 칸 경계(work/grid_all.pkl)를 함께 저장합니다.
밴드: res_h, known_h, old_h (단독·공동주택) / res_m, known_m, old_m (근린생활시설 포함)
"""
import os, sys, numpy as np, pandas as pd
sys.path.insert(0, os.path.dirname(__file__))
from read_lzw_tif import read

os.makedirs('work/t2grid', exist_ok=True)
gm = pd.read_csv('data/Bukgu_Grid_Master_v3.csv', dtype={'TOT_OA_CD': str})
arr, geo = read('data/buildings/Bukgu_grid100_buildings.tif')
assert arr.shape[:2] == (154, 172), arr.shape
names = ['res_h', 'known_h', 'old_h', 'res_m', 'known_m', 'old_m']
r, c = gm.row_index.astype(int).values, gm.col_index.astype(int).values
for i, n in enumerate(names):
    gm[n] = arr[r, c, i].astype(float)
gm.to_pickle('work/t2grid/g.pkl')
ga = pd.read_csv('data/전체종합_구역통계-빈셀 제거.csv')[['id', 'left', 'top', 'right', 'bottom', 'row_index', 'col_index']]
ga.to_pickle('work/grid_all.pkl')
print('grid table', gm.shape, '| cell bounds', ga.shape)
