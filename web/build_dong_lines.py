"""행정동 경계선 → site/data/dong_lines.json (GeoJSON MultiLineString, WGS84)

SGIS 집계구 경계(원본, EPSG:5179)의 변을 모아, 같은 행정동 안의 두 집계구가 공유하는 변은 지우고
서로 다른 행정동 사이의 변과 북구 바깥 경계만 남긴 뒤 선으로 잇습니다(외부 GIS 라이브러리 없이).
"""
import os, sys, json
from collections import defaultdict
import numpy as np
W = os.path.dirname(os.path.abspath(__file__)); SCR = os.path.abspath(os.path.join(W, '..'))
sys.path.insert(0, W)
for cand in ('analysis', 'analysis'):
    if os.path.isdir(os.path.join(SCR, cand)): sys.path.insert(0, os.path.join(SCR, cand))
from shp import read_dbf, read_shp
import tm5179
BND = next(p for p in [os.path.join(SCR, 'data/boundary')] if os.path.isdir(p))
_, recs = read_dbf(os.path.join(BND, 'bnd_oa_24040_2025_2Q.dbf'))
geoms = read_shp(os.path.join(BND, 'bnd_oa_24040_2025_2Q.shp'))

def rings(g):
    if isinstance(g, dict):
        g = g.get('parts') or g.get('rings') or g.get('coordinates')
    out = []
    def walk(x):
        if len(x) and isinstance(x[0], (int, float, np.floating)):
            raise ValueError
        if len(x) and isinstance(x[0][0], (int, float, np.floating)):
            out.append([tuple(p[:2]) for p in x]); return
        for y in x: walk(y)
    walk(g); return out

Q = lambda p: (round(p[0], 2), round(p[1], 2))       # 1 cm 격자로 꼭짓점 맞추기
seg = defaultdict(set)                                # 변(무순서) → 그 변을 가진 행정동 집합(중복 수 포함)
cnt = defaultdict(int)
for rec, g in zip(recs, geoms):
    adm = rec['ADM_CD']
    for r in rings(g):
        for a, b in zip(r[:-1], r[1:]):
            a, b = Q(a), Q(b)
            if a == b: continue
            k = (a, b) if a < b else (b, a)
            seg[k].add(adm); cnt[k] += 1
keep = [k for k in seg if len(seg[k]) > 1 or cnt[k] == 1]
print('edges', len(seg), 'boundary edges', len(keep))

# 변을 선으로 잇기
adj = defaultdict(list)
for a, b in keep: adj[a].append(b); adj[b].append(a)
used = set(); lines = []
def take(a, b):
    k = (a, b) if a < b else (b, a)
    if k in used: return False
    used.add(k); return True
starts = [v for v in adj if len(adj[v]) != 2] + list(adj)
for s in starts:
    for n in adj[s]:
        if not take(s, n): continue
        line = [s, n]; prev, cur = s, n
        while len(adj[cur]) == 2:
            nxt = adj[cur][0] if adj[cur][1] == prev else adj[cur][1]
            if not take(cur, nxt): break
            line.append(nxt); prev, cur = cur, nxt
        lines.append(line)

def dp(a, tol):
    a = np.asarray(a, float)
    if len(a) < 3: return a
    keep = np.zeros(len(a), bool); keep[0] = keep[-1] = True; st = [(0, len(a) - 1)]
    while st:
        s, e = st.pop()
        if e <= s + 1: continue
        p, q = a[s], a[e]; v = a[s + 1:e] - p; L = np.hypot(*(q - p))
        d = np.hypot(*v.T) if L == 0 else np.abs((q - p)[0] * v[:, 1] - (q - p)[1] * v[:, 0]) / L
        i = int(np.argmax(d))
        if d[i] > tol: keep[s + 1 + i] = True; st += [(s, s + 1 + i), (s + 1 + i, e)]
    return a[keep]

coords = []
for ln in lines:
    a = dp(ln, 2.0)
    lo, la = tm5179.inverse(a[:, 0], a[:, 1])
    coords.append([[round(float(x), 6), round(float(y), 6)] for x, y in zip(lo, la)])
out = {'type': 'Feature', 'properties': {}, 'geometry': {'type': 'MultiLineString', 'coordinates': coords}}
json.dump(out, open(os.path.join(W, 'site', 'data', 'dong_lines.json'), 'w'), separators=(',', ':'))
print('lines', len(coords), 'points', sum(len(c) for c in coords))
