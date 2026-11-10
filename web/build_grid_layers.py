"""지표 탭의 100 m 격자 레이어 → site/data/grid_<key>.png(표시용), grid_<key>_v.png(값 조회용), raster_meta.json

레이어(4장 100 m 격자, 원점 939392.419, 1696099.8, EPSG:5179; 북구 칸 11,809개 기준):
  abs25 : 2025 여름 평균 지표면온도(℃) = RLST2025 + 북구 평균(집계구 구역통계의 LST25_abs − RLST25 상수)
  drl   : 상대 지표면온도 변화 ΔRLST(℃)               — Track 2 성분
  dnb   : 건물밀도 변화 ΔNDBI(반사율 기준, v3)          — Track 2 성분
  oldr  : 1999년 이전 사용승인 주거 건물 지붕 면적(m²) — Track 2 성분, 주거 건물이 있는 칸만
값 조회용 PNG: R·G 두 채널에 16비트 정수 v를 담고(v = 0은 값 없음), 값 = off + (v − 1) / scale.
"""
import os, sys, json
import numpy as np, pandas as pd
from PIL import Image

W = os.path.dirname(os.path.abspath(__file__)); SCR = os.path.abspath(os.path.join(W, '..'))
DATA = next(p for p in [os.path.join(SCR, 'data'), os.path.join(SCR, 'data')] if os.path.isdir(p))
sys.path.insert(0, next(p for p in [os.path.join(SCR, 'analysis'), os.path.join(SCR, 'analysis')] if os.path.isdir(p)))
import tm5179
OUT = os.path.join(W, 'site', 'data')
GX0, GY0 = 939392.4194, 1696099.8

# ---- 칸 값 ------------------------------------------------------------------------------
gz = pd.read_csv(os.path.join(DATA, '전체종합_구역통계-빈셀 제거.csv'))
assert abs(gz.left.min() - GX0) < 0.01 and abs(gz.top.max() - GY0) < 0.01
z = pd.read_csv(os.path.join(DATA, 'Bukgu_OA_zonal_areaweighted.csv')); k = (z.LST25_abs - z.RLST25).dropna()
assert k.max() - k.min() < 1e-4; BK = float(k.median())
nd = pd.read_csv(os.path.join(DATA, 'Bukgu_NDBI_2020_2025_100m_grid.csv')).rename(columns={'col': 'col_index', 'row': 'row_index'})
gz = gz.merge(nd[['col_index', 'row_index', 'dNDBI']], on=['col_index', 'row_index'], how='left')
bt = next(p for p in [os.path.join(DATA, 'buildings/Bukgu_grid100_buildings.tif'), os.path.join(SCR, 'work/t2grid/b.tif')] if os.path.exists(p))
sys.path.insert(0, next(p for p in [os.path.join(SCR, 'scripts'), os.path.join(SCR, 'track2_grid')] if os.path.isdir(p)))
from read_lzw_tif import read
B, _ = read(bt)
r_, c_ = gz.row_index.astype(int).values, gz.col_index.astype(int).values
gz['res_h'] = B[r_, c_, 0]; gz['old_h'] = B[r_, c_, 2]
VAL = {
    'abs25': gz.LST25_mean + BK,
    'drl': gz.dLST_mean,
    'dnb': gz.dNDBI,
    'oldr': gz.old_h.where(gz.res_h > 0),
}
DIV = ['#1c5cab', '#5598e7', '#b7d3f6', '#ecebe6', '#f6c3a6', '#eb6834', '#b8410f']
SPEC = {   # breaks, colors, encoding (off, scale), decimals, signed, unit
    'abs25': ([30, 33, 36, 39, 42, 45], DIV, (10, 100), 1, False, '℃'),
    'drl': ([-3, -1.5, -0.5, 0.5, 1.5, 3], DIV, (-20, 1000), 2, True, '℃'),
    'dnb': ([-0.05, -0.02, -0.005, 0.005, 0.02, 0.05], DIV, (-1, 10000), 3, True, ''),
    'oldr': ([500, 1000, 2000, 3000], ['#fbefd3', '#f2d28a', '#e1a944', '#b97a1c', '#7f520f'], (0, 1), 0, False, 'm²'),
}

# ---- 웹 메르카토르 래스터로 옮기기(기존 영상과 같은 범위·해상도) ---------------------------
R = 6378137.0
merc = lambda lon, lat: (np.radians(lon) * R, R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)))
imerc = lambda x, y: (np.degrees(x / R), np.degrees(2 * np.arctan(np.exp(y / R)) - np.pi / 2))
LON0, LAT0, LON1, LAT1 = 126.8345, 35.1210, 127.0225, 35.2586
X0, Y0 = merc(LON0, LAT0); X1, Y1 = merc(LON1, LAT1)
PW = 1400; PH = int(round(PW * (Y1 - Y0) / (X1 - X0)))
xs = X0 + (np.arange(PW) + .5) * (X1 - X0) / PW; ys = Y1 - (np.arange(PH) + .5) * (Y1 - Y0) / PH
X, Y = tm5179.forward(*imerc(*np.meshgrid(xs, ys)))
ci = np.floor((X - GX0) / 100).astype(int); ri = np.floor((GY0 - Y) / 100).astype(int)
key = (ci * 100000 + ri).ravel()
lk = (gz.col_index * 100000 + gz.row_index).values; order = np.argsort(lk); lk = lk[order]
pos = np.searchsorted(lk, key); pos[pos >= len(lk)] = 0; hit = lk[pos] == key

meta = json.load(open(os.path.join(OUT, 'raster_meta.json'), encoding='utf-8'))
meta['grid'] = {}
for name in ['grid_rl25.png', 'grid_drl.png', 'grid_abs25.png', 'grid_abs25_v.png']:
    p = os.path.join(OUT, name)
    if os.path.exists(p): os.remove(p)
meta.pop('abs25', None)
for kname, s in VAL.items():
    br, cols, (off, sc), ndp, sg, unit = SPEC[kname]
    vals = s.values[order]
    A = np.full(key.shape, np.nan); A[hit] = vals[pos[hit]]; A = A.reshape(X.shape)
    img = np.zeros(A.shape + (4,), np.uint8); idx = np.digitize(A, br)
    for i, c in enumerate(cols):
        m = (idx == i) & ~np.isnan(A); img[m, :3] = [int(c[j:j + 2], 16) for j in (1, 3, 5)]; img[m, 3] = 225
    Image.fromarray(img, 'RGBA').save(os.path.join(OUT, f'grid_{kname}.png'), optimize=True)
    v = np.zeros(A.shape, np.int64); ok = ~np.isnan(A)
    v[ok] = np.clip(np.round((A[ok] - off) * sc) + 1, 1, 65535)
    rgb = np.zeros(A.shape + (3,), np.uint8); rgb[..., 0] = v >> 8; rgb[..., 1] = v & 255
    Image.fromarray(rgb, 'RGB').save(os.path.join(OUT, f'grid_{kname}_v.png'), optimize=True)
    t = s.dropna()
    meta['grid'][kname] = {'breaks': br, 'colors': cols, 'enc': [off, sc], 'nd': ndp, 'signed': sg, 'unit': unit,
                           'n': int(len(t)), 'mean': round(float(t.mean()), 3), 'min': round(float(t.min()), 3), 'max': round(float(t.max()), 3)}
    print(f'{kname}: n {len(t)}  {t.min():.3f} ~ {t.max():.3f}  mean {t.mean():.3f}')
meta['px'] = [PW, PH]

# ---- 위성 비교 탭: 건물밀도가 크게 늘어난 곳(ΔNDBI ≥ 0.10 인 칸이 이어진 묶음) 상위 8곳 -------------
names = json.load(open(os.path.join(DATA, 'dong_names.json'), encoding='utf-8'))
gm = pd.read_csv(os.path.join(DATA, 'grid_oa_map.csv'), dtype={'TOT_OA_CD': str})
hh = gz.merge(gm, on=['row_index', 'col_index'], how='left')
hh = hh[hh.dNDBI >= 0.10].copy()
cells = {(r, c): i for i, r, c in zip(hh.index, hh.row_index, hh.col_index)}
lab, k = {}, 0
for key0 in cells:
    if key0 in lab: continue
    k += 1; st = [key0]; lab[key0] = k
    while st:
        r, c = st.pop()
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                n = (r + dr, c + dc)
                if n in cells and n not in lab: lab[n] = k; st.append(n)
hh['cl'] = [lab[(r, c)] for r, c in zip(hh.row_index, hh.col_index)]
hh['dong'] = hh.TOT_OA_CD.str[:8].map(names)
sites = []
for cl, d in sorted(hh.groupby('cl'), key=lambda t: (-len(t[1]), -t[1].dNDBI.max()))[:8]:
    cc = []
    for l, t, rr, b in zip(d.left, d.top, d.right, d.bottom):
        lo, la = tm5179.inverse(np.array([l, rr, rr, l]), np.array([b, b, t, t]))
        cc.append([[round(float(y), 6), round(float(x), 6)] for x, y in zip(lo, la)])
    sites.append({'dong': d.dong.mode().iat[0] if d.dong.notna().any() else '북구', 'n': int(len(d)),
                  'max': round(float(d.dNDBI.max()), 3), 'mean': round(float(d.dNDBI.mean()), 3), 'cells': cc})
meta['devsites'] = sites
print('dev sites', [(s['dong'], s['n'], s['max']) for s in sites])
json.dump(meta, open(os.path.join(OUT, 'raster_meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
