"""Build data for the Buk-gu heat policy map (static web app).
Outputs (site/data/): oa.json, dongs.json, meta.json, grid_rl25.png, grid_drl.png, s2_2020.webp, s2_2025.webp
"""
import json, math, sys, os
import numpy as np, pandas as pd
from PIL import Image
sys.path.insert(0, os.path.dirname(__file__))
from shp import read_dbf, read_shp
SCR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(SCR, 'analysis'))
import tm5179

OUT = os.path.join(os.path.dirname(__file__), 'site', 'data')
os.makedirs(OUT, exist_ok=True)
REPO = os.path.join(SCR, 'data')

# ------------------------------------------------------------------ boundaries
_, recs = read_dbf(os.path.join(SCR, 'data/boundary/bnd_oa_24040_2025_2Q.dbf'))
geoms = read_shp(os.path.join(SCR, 'data/boundary/bnd_oa_24040_2025_2Q.shp'))


def dp(pts, tol):
    """Douglas-Peucker on a closed ring (list of (x,y)), keeps first/last."""
    if len(pts) < 5:
        return pts
    a = np.array(pts)
    keep = np.zeros(len(a), bool); keep[0] = keep[-1] = True
    stack = [(0, len(a) - 1)]
    while stack:
        s, e = stack.pop()
        if e <= s + 1:
            continue
        p, q = a[s], a[e]
        seg = q - p; L = np.hypot(*seg)
        sub = a[s + 1:e]
        if L == 0:
            d = np.hypot(*(sub - p).T)
        else:
            v = sub - p
            d = np.abs(seg[0] * v[:, 1] - seg[1] * v[:, 0]) / L
        i = int(np.argmax(d))
        if d[i] > tol:
            k = s + 1 + i; keep[k] = True
            stack += [(s, k), (k, e)]
    out = a[keep]
    return [tuple(x) for x in out] if len(out) >= 4 else pts


def area(r):
    x = np.array([p[0] for p in r]); y = np.array([p[1] for p in r])
    return 0.5 * np.sum(x[:-1] * y[1:] - x[1:] * y[:-1])


def to_ll(ring):
    xs = np.array([p[0] for p in ring]); ys = np.array([p[1] for p in ring])
    lon, lat = tm5179.inverse(xs, ys)
    return [[round(float(a), 6), round(float(b), 6)] for a, b in zip(lon, lat)]


def geometry(rings):
    polys = []
    for r in rings:
        r = dp(r, 1.5)
        if area(r) <= 0:          # shapefile outer rings are clockwise
            polys.append([to_ll(r[::-1])])   # GeoJSON outer ring counter-clockwise
        else:                                 # hole: attach to the previous outer ring
            if not polys:
                polys.append([])
            polys[-1].append(to_ll(r[::-1]))
    if len(polys) == 1:
        return {'type': 'Polygon', 'coordinates': polys[0]}
    return {'type': 'MultiPolygon', 'coordinates': polys}


# ------------------------------------------------------------------ attributes
names = json.load(open(os.path.join(REPO, 'dong_names.json'), encoding='utf-8'))
m = pd.read_csv(os.path.join(REPO, 'Bukgu_OA_Master_v3.csv'), dtype={'TOT_OA_CD': str, 'ADM_CD': str}).set_index('TOT_OA_CD')
z = pd.read_csv(os.path.join(REPO, 'Bukgu_OA_zonal_areaweighted.csv'), dtype={'TOT_OA_CD': str}).set_index('TOT_OA_CD')
# population/housing for every OA (incl. excluded) - same rules as analysis/03
s1 = pd.read_excel(os.path.join(REPO, '2024 고령인구비율.xlsx'), sheet_name=0, header=3, dtype={'행 레이블': str}).rename(columns={'행 레이블': 'oa'})
s1 = s1[s1.oa.str.match(r'^\d{14}$', na=False)].set_index('oa')
eld = s1[[f'in_age_{i:03d}' for i in range(14, 22)]].sum(axis=1)
t = pd.read_csv(os.path.join(REPO, 'sgis_2024_total_population.csv'), header=None, names=['yr', 'oa', 'item', 'v'], dtype={'oa': str})
tot = pd.to_numeric(t[t.item == 'to_in_001'].set_index('oa').v, errors='coerce')
h = pd.read_csv(os.path.join(REPO, 'sgis_2024_housing_by_year.csv'), header=None, names=['yr', 'oa', 'code', 'cnt'], dtype=str)
h['n'] = pd.to_numeric(h.cnt, errors='coerce').fillna(2.5)
htot = h.groupby('oa').n.sum()

IND = {'abs': 'Abs_mean', 'drl': 'dRL_mean', 'dnb': 'dNB_mean', 'eld': 'Elderly_Ratio',
       'old': 'Old_housing_Ratio', 'savi': 'SAVI', 'dem': 'DEM'}
pct = {k: m[c].rank(pct=True) * 100 for k, c in IND.items()}
N = len(m)


def r(v, nd):
    return None if v is None or (isinstance(v, float) and math.isnan(v)) else round(float(v), nd)


feats = []
for rec, g in zip(recs, geoms):
    code = rec['TOT_OA_CD']; adm = rec['ADM_CD']
    p = {'c': code, 'd': names.get(adm, adm)}
    popv = tot.get(code, np.nan)
    p['pop'] = None if pd.isna(popv) else int(popv)
    if code in m.index:
        row = m.loc[code]
        p['s'] = 'ok'
        p.update({k: r(row[c], {'abs': 2, 'drl': 2, 'dnb': 3, 'eld': 1, 'old': 1, 'savi': 3, 'dem': 0}[k]) for k, c in IND.items()})
        p['pc'] = {k: round(float(pct[k][code]), 1) for k in IND}
        p['e65'] = int(row.eld65); p['ho'] = round(float(row.house_old), 1); p['ht'] = round(float(row.house_tot), 1)
        p['t1'] = round(float(row.Track1_Score), 2); p['t2'] = round(float(row.Track2_Score), 2)
        p['r1'] = int(row.Track1_Rank); p['r2'] = int(row.Track2_Rank)
        p['k1'] = bool(row.Track1_Top10); p['k2'] = bool(row.Track2_Top10)
        if p['k2']:
            p['ty'] = '노후·가열형' if row.Old_housing_Ratio >= 50 else '신개발형'
    else:
        zz = z.loc[code] if code in z.index else None
        if pd.isna(popv) or popv <= 0:
            p['s'] = 'nopop'
        elif zz is None or pd.isna(zz.LST25_abs) or pd.isna(zz.dRLST):
            p['s'] = 'nolst'
        else:
            p['s'] = 'nohouse'
        if p['pop'] and p['pop'] > 0:
            p['eld'] = round(100 * float(eld.get(code, 0)) / p['pop'], 1)
    feats.append({'type': 'Feature', 'properties': p, 'geometry': geometry(g)})

ok = [f for f in feats if f['properties']['s'] == 'ok']
assert len(ok) == N == 832, len(ok)
json.dump({'type': 'FeatureCollection', 'features': feats}, open(os.path.join(OUT, 'oa.json'), 'w', encoding='utf-8'),
          ensure_ascii=False, separators=(',', ':'))

# dong list (centroid of member OA centroids, bbox)
dongs = {}
for f in feats:
    d = f['properties']['d']
    cs = f['geometry']['coordinates'] if f['geometry']['type'] == 'MultiPolygon' else [f['geometry']['coordinates']]
    xs = [pt[0] for poly in cs for pt in poly[0]]; ys = [pt[1] for poly in cs for pt in poly[0]]
    b = dongs.setdefault(d, [180, 90, -180, -90, 0])
    b[0] = min(b[0], min(xs)); b[1] = min(b[1], min(ys)); b[2] = max(b[2], max(xs)); b[3] = max(b[3], max(ys)); b[4] += 1
json.dump([{'name': k, 'bbox': [round(v, 5) for v in b[:4]], 'n': b[4]} for k, b in sorted(dongs.items())],
          open(os.path.join(OUT, 'dongs.json'), 'w', encoding='utf-8'), ensure_ascii=False)

# ------------------------------------------------------------------ class breaks / meta
def q(col, k=5):
    return [round(float(x), 3) for x in m[col].quantile(np.linspace(0, 1, k + 1)[1:-1])]


excluded = pd.Series([f['properties']['s'] for f in feats]).value_counts().to_dict()
meta = {
    'n': N, 'top': int(m.Track1_Top10.sum()), 'excluded': excluded,
    'pop_total': int(tot.reindex([f['properties']['c'] for f in feats]).fillna(0).sum()),
    'pop_ok': int(m.to_in_001.sum()),
    'breaks': {'abs': q('Abs_mean'), 'eld': q('Elderly_Ratio'), 'old': [20, 40, 60, 80], 'savi': q('SAVI'),
               't1': [round(float(m.Track1_Score.quantile(x)), 2) for x in (.5, .75, .9)],
               't2': [round(float(m.Track2_Score.quantile(x)), 2) for x in (.5, .75, .9)]},
    'ranges': {k: [round(float(m[c].min()), 3), round(float(m[c].max()), 3)] for k, c in IND.items()},
    'mean': {k: round(float(m[c].mean()), 3) for k, c in IND.items()},
    'types2': pd.Series([f['properties'].get('ty') for f in ok if f['properties'].get('ty')]).value_counts().to_dict(),
    'both': int((m.Track1_Top10 & m.Track2_Top10).sum()),
}
json.dump(meta, open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print('meta', json.dumps(meta, ensure_ascii=False)[:900])

# ------------------------------------------------------------------ rasters in Web Mercator
R = 6378137.0
def merc(lon, lat):
    return np.radians(lon) * R, R * np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))
def imerc(x, y):
    return np.degrees(x / R), np.degrees(2 * np.arctan(np.exp(y / R)) - np.pi / 2)

LON0, LAT0, LON1, LAT1 = 126.8345, 35.1210, 127.0225, 35.2586     # Buk-gu extent (Sentinel clip)
X0, Y0 = merc(LON0, LAT0); X1, Y1 = merc(LON1, LAT1)


def mgrid(px):
    W = px; H = int(round(px * (Y1 - Y0) / (X1 - X0)))
    xs = X0 + (np.arange(W) + .5) * (X1 - X0) / W
    ys = Y1 - (np.arange(H) + .5) * (Y1 - Y0) / H
    XX, YY = np.meshgrid(xs, ys)
    return imerc(XX, YY)


meta_r = {'bounds': [[LAT0, LON0], [LAT1, LON1]]}

# 100 m grid (all 11,809 cells of the zonal table)
gz = pd.read_csv(os.path.join(REPO, '전체종합_구역통계-빈셀 제거.csv'))
gz['cx'] = (gz.left + gz.right) / 2; gz['cy'] = (gz.top + gz.bottom) / 2
GX0, GY0 = 939375.915623063, 1696099.90909134     # QGIS grid origin (upper-left)
cells = {}
for c_, r_, a_, b_ in zip(gz.col_index, gz.row_index, gz.LST25_mean, gz.dLST_mean):
    cells[(int(c_), int(r_))] = (a_, b_)
LON, LAT = mgrid(1400)
X, Y = tm5179.forward(LON, LAT)
ci = np.floor((X - GX0) / 100).astype(int); ri = np.floor((GY0 - Y) / 100).astype(int)
rl = np.full(X.shape, np.nan); dr = np.full(X.shape, np.nan)
# vectorised lookup
key = ci * 100000 + ri
lut_k = np.array([c_ * 100000 + r_ for (c_, r_) in cells]); order = np.argsort(lut_k); lut_k = lut_k[order]
vals = np.array(list(cells.values()))[order]
pos = np.searchsorted(lut_k, key.ravel()); pos[pos >= len(lut_k)] = 0
hit = lut_k[pos] == key.ravel()
rl.ravel()[hit] = vals[pos[hit], 0]; dr.ravel()[hit] = vals[pos[hit], 1]


def hex2rgb(hx):
    hx = hx.lstrip('#'); return [int(hx[i:i + 2], 16) for i in (0, 2, 4)]


def colorize(arr, breaks, colors, alpha=225):
    img = np.zeros(arr.shape + (4,), np.uint8)
    idx = np.digitize(arr, breaks)
    for k, cc in enumerate(colors):
        msk = (idx == k) & ~np.isnan(arr)
        img[msk, :3] = hex2rgb(cc); img[msk, 3] = alpha
    return Image.fromarray(img, 'RGBA')


# relative LST 2025: diverging around Buk-gu mean (0)
DIV = ['#1c5cab', '#5598e7', '#b7d3f6', '#ecebe6', '#f6c3a6', '#eb6834', '#b8410f']
rl_b = [-6, -3, -1, 1, 3, 6]
dr_b = [-3, -1.5, -0.5, 0.5, 1.5, 3]
colorize(rl, rl_b, DIV).save(os.path.join(OUT, 'grid_rl25.png'), optimize=True)
colorize(dr, dr_b, DIV).save(os.path.join(OUT, 'grid_drl.png'), optimize=True)
meta_r['grid'] = {'rl25': rl_b, 'drl': dr_b, 'colors': DIV}

# Sentinel-2 true colour 2020 / 2025
UP = os.path.join(SCR, 'data', 'basemap') + os.sep
from scipy.ndimage import map_coordinates
LON, LAT = mgrid(1900)
for yr, fn in [(2020, 'Sentinel2_TrueColor_2020_Bukgu.tif'), (2025, 'Sentinel2_TrueColor_2025_Bukgu.tif')]:
    im = Image.open(UP + fn); src = np.asarray(im.convert('RGB')).astype(np.float32)
    sx, sy = im.tag_v2[33550][:2]; lo0, la0 = im.tag_v2[33922][3], im.tag_v2[33922][4]
    valid = src.sum(2) > 0
    for b in range(3):
        lo, hi = np.percentile(src[..., b][valid], [1, 99.5])
        src[..., b] = np.clip((src[..., b] - lo) / (hi - lo), 0, 1)
    col = (LON - lo0) / sx - 0.5; row = (la0 - LAT) / sy - 0.5
    rgb = np.stack([map_coordinates(src[..., b], [row, col], order=1, cval=0) for b in range(3)], -1) ** 0.85
    al = map_coordinates(valid.astype(np.float32), [row, col], order=1, cval=0)
    out = np.dstack([np.clip(rgb * 255, 0, 255), (al > .5) * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(os.path.join(OUT, f's2_{yr}.webp'), quality=82, method=6)
json.dump(meta_r, open(os.path.join(OUT, 'raster_meta.json'), 'w'), indent=1)
for fn in sorted(os.listdir(OUT)):
    print(f'{fn:22s} {os.path.getsize(os.path.join(OUT, fn)) / 1024:8.0f} KB')
