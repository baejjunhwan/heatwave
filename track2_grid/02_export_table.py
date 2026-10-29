"""Track 2 격자판 결과표 내보내기 → results/Track2_grid.csv (순위 순, 1,174칸)."""
import numpy as np, pandas as pd
d = pd.read_pickle('work/t2grid/final.pkl').rename(columns={'top': 'is_top'})
la, lo = d.lat.values, d.lon.values   # 격자 정본의 중심점(cx, cy)을 경위도로 바꾼 값(01 단계에서 계산)
o = pd.DataFrame({'row_index': d.row_index, 'col_index': d.col_index, 'lat': np.round(la, 6), 'lon': np.round(lo, 6),
                  'TOT_OA_CD': d.TOT_OA_CD, '행정동': d.Admin, '주거지붕_m2': d.res_h.round(0), '노후지붕_m2': d.old_h.round(0),
                  'dNDBI': d.dNDBI.round(4), 'dRLST': d.dRLST.round(3), 'Z_dNDBI': d.Zn.round(3), 'Z_노후지붕': d.Zo.round(3),
                  'Z_dRLST': d.Zr.round(3), 'T2점수': d.score.round(3), 'T2순위': d['rank'], '상위10%': d.is_top})
o.sort_values('T2순위').to_csv('results/Track2_grid.csv', index=False, encoding='utf-8-sig')
print('results/Track2_grid.csv', len(o), 'rows, top', int(o['상위10%'].sum()))
import shutil; shutil.copy('work/t2grid/final.json', 'results/track2_grid_robustness.json')
