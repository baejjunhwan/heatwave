"""Step 5 - paper Fig. 2 (Track 1) and Fig. 3 (Track 2), 2525 x 2329 px.

usage: python3 analysis/05_figures.py                 # Sentinel-2 2025 true-colour background (paper version)
       python3 analysis/05_figures.py --no-basemap    # plain background
Background: data/basemap/Sentinel2_TrueColor_2025_Bukgu.tif (EPSG:4326, clipped to Buk-gu) warped to EPSG:5179.
Outputs: figs/Fig2_Track1.jpg, figs/Fig3_Track2.png
"""
import sys, os, glob
import numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.lines import Line2D
from matplotlib.patches import Rectangle
from scipy.ndimage import map_coordinates, gaussian_filter
from PIL import Image
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tm5179

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
BASEMAP = '--no-basemap' not in sys.argv
TIF, YEAR = os.path.join(ROOT, 'data', 'basemap', 'Sentinel2_TrueColor_2025_Bukgu.tif'), 2025
VEIL, SAT = 0.40, 0.55          # white veil over the image / share of saturation kept

for f in glob.glob('/usr/share/fonts/opentype/noto/NotoSansCJK-*.ttc'):
    fm.fontManager.addfont(f)
if any('Noto Sans CJK' in f.name for f in fm.fontManager.ttflist):
    plt.rcParams['font.family'] = 'Noto Sans CJK KR'   # font used for the paper figures
plt.rcParams['axes.unicode_minus'] = False
plt.rcParams['mathtext.fontset'] = 'custom'; plt.rcParams['mathtext.it'] = 'DejaVu Sans:italic'
INK, INK2, MUTED, HAIR, MAPBG = '#111111', '#333333', '#7a7a76', '#d6d5cf', '#fafaf8'
ORANGE = ["#fbe3d6", "#f7c8ad", "#f2ab83", "#eb6834", "#c9501f", "#9e3b13", "#6e260b"]
BLUE = ["#d3e6fc", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0b2f5e"]

d = pd.read_csv(os.path.join(ROOT, 'data', 'Bukgu_OA_Master_v3.csv'), dtype={'TOT_OA_CD': str})
top = round(len(d) * .1); pad = 700
xlim = (d.cx.min() - pad, d.cx.max() + pad); ylim = (d.cy.min() - pad, d.cy.max() + pad)
W, H, DPI = 2525, 2329, 250


def basemap(res=10.0):
    """Read the GeoTIFF (EPSG:4326, PixelIsArea) and warp it to an EPSG:5179 grid covering the map extent."""
    Image.MAX_IMAGE_PIXELS = None
    im = Image.open(TIF)
    src = np.asarray(im.convert('RGB')).astype(np.float32)
    sx, sy = im.tag_v2[33550][0], im.tag_v2[33550][1]          # ModelPixelScale
    lon0, lat0 = im.tag_v2[33922][3], im.tag_v2[33922][4]      # ModelTiepoint (upper-left corner)
    valid = src.sum(2) > 0
    for b in range(3):                                         # 2-98 % stretch on valid pixels
        lo, hi = np.percentile(src[..., b][valid], [2, 98])
        src[..., b] = np.clip((src[..., b] - lo) / (hi - lo), 0, 1)
    src = src ** 0.95
    gx = np.arange(xlim[0] + res / 2, xlim[1], res); gy = np.arange(ylim[1] - res / 2, ylim[0], -res)
    LON, LAT = tm5179.inverse(*np.meshgrid(gx, gy))
    col = (LON - lon0) / sx - 0.5; row = (lat0 - LAT) / sy - 0.5
    rgb = np.stack([map_coordinates(src[..., b], [row, col], order=1, cval=0) for b in range(3)], -1)
    alpha = map_coordinates(valid.astype(np.float32), [row, col], order=1, cval=0)
    grey = (rgb @ np.array([0.299, 0.587, 0.114]))[..., None]
    rgb = (1 - VEIL) * (grey + SAT * (rgb - grey)) + VEIL
    rgba = np.dstack([np.clip(rgb, 0, 1), (alpha > 0.5).astype(np.float32)])
    ext = (gx[0] - res / 2, gx[-1] + res / 2, gy[-1] - res / 2, gy[0] + res / 2)
    return rgba, ext, gx, gy, gaussian_filter(alpha, 1.0)


bm = basemap() if BASEMAP else None
os.makedirs(os.path.join(ROOT, 'figs'), exist_ok=True)
for col, ramp, title, outname, fmt in [
        ('Track1_Score', ORANGE, 'Z(Absolute LST) + Z(Elderly Ratio)', 'Fig2_Track1.jpg', 'jpg'),
        ('Track2_Score', BLUE, 'Z(ΔNDBI) + Z(Old Housing Ratio) + Z(ΔRLST)', 'Fig3_Track2.png', 'png')]:
    fig = plt.figure(figsize=(W / DPI, H / DPI), dpi=DPI, facecolor='white')
    fig.add_artist(Rectangle((0.004, 0.004), 0.992, 0.992, transform=fig.transFigure, fill=False, lw=2.2, ec=INK))
    fig.text(0.06, 0.935, title, fontsize=17, color=INK, va='center')
    ax = fig.add_axes([0.055, 0.17, 0.89, 0.72]); ax.set_facecolor(MAPBG)
    if bm is not None:
        rgba, ext, gx, gy, alpha_s = bm
        ax.imshow(rgba, extent=ext, origin='upper', interpolation='bilinear', zorder=0)
        ax.contour(gx, gy, alpha_s, levels=[0.5], colors=['#5c5c58'], linewidths=0.9, zorder=1)
    cmap = LinearSegmentedColormap.from_list(col, ramp)
    dd = d.iloc[d[col].argsort()]; is_top = dd.index.isin(d[col].nlargest(top).index)
    vmin, vmax = d[col].quantile([.02, .98]); norm = plt.Normalize(vmin, vmax)
    ax.scatter(dd.cx, dd.cy, c=dd[col], cmap=cmap, norm=norm, s=62, linewidths=.7, edgecolors='white', zorder=2)
    ax.scatter(dd.cx[is_top], dd.cy[is_top], s=170, facecolors='none', edgecolors='white', linewidths=3.4, zorder=3)
    ax.scatter(dd.cx[is_top], dd.cy[is_top], s=170, facecolors='none', edgecolors=INK, linewidths=1.6, zorder=4)
    ax.set_xlim(*xlim); ax.set_ylim(*ylim); ax.set_aspect('equal', adjustable='box')
    for s in ax.spines.values():
        s.set_color(HAIR); s.set_linewidth(1.0)
    ax.set_xticks([]); ax.set_yticks([])
    x0, y0 = xlim[0] + 800, ylim[0] + 700                                  # scale bar
    ax.plot([x0, x0 + 2000], [y0, y0], color=INK, lw=3.2, solid_capstyle='butt', zorder=5)
    ax.text(x0 + 1000, y0 + 220, '2 km', color=INK2, fontsize=10.5, ha='center', va='bottom')
    nx, ny = xlim[1] - 650, ylim[1] - 2100                                 # north arrow
    ax.annotate('', xy=(nx, ny + 1250), xytext=(nx, ny),
                arrowprops=dict(arrowstyle='-|>,head_width=0.35,head_length=0.7', color=INK, lw=2.0), zorder=5)
    ax.text(nx, ny + 1450, 'N', color=INK, fontsize=12, ha='center', va='bottom', fontweight='bold')
    leg = [Line2D([], [], marker='o', color='none', markerfacecolor='none', markeredgecolor=INK, markeredgewidth=1.8,
                  markersize=12, label=f'Top 10% Priority Target Output Areas ($n$ = {top})'),
           Line2D([], [], marker='o', color='none', markerfacecolor='#8f8f8b', markeredgecolor='white', markersize=10,
                  label=f'Centroids of Output Areas ($N$ = {len(d)})')]
    lg = ax.legend(handles=leg, loc='upper right', bbox_to_anchor=(0.93, 0.985), frameon=bm is not None,
                   fontsize=10.5, labelcolor=INK2, handletextpad=0.4, borderaxespad=0.4, fancybox=False,
                   framealpha=0.88, edgecolor='none', facecolor='white')
    lg.set_zorder(6)
    if bm is not None:
        ax.text(0.99, 0.012, f'Background: Sentinel-2 true colour ({YEAR}), contains modified Copernicus Sentinel data',
                transform=ax.transAxes, ha='right', va='bottom', fontsize=7.5, color=INK2, zorder=6,
                bbox=dict(boxstyle='square,pad=0.25', fc='white', ec='none', alpha=0.8))
    cax = fig.add_axes([0.055, 0.105, 0.89, 0.028])
    cb = fig.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation='horizontal',
                      extend='both', extendfrac=0.035)
    cb.outline.set_visible(False); cb.ax.tick_params(colors=MUTED, labelsize=10.5, length=0, pad=6)
    fig.text(0.5, 0.035, 'Sum of Z-scores, Color scale: 2nd–98th percentile', fontsize=15, color=INK,
             ha='center', va='center')
    path = os.path.join(ROOT, 'figs', outname)
    fig.savefig(path, facecolor='white', dpi=DPI, **({'pil_kwargs': {'quality': 92}} if fmt == 'jpg' else {}))
    plt.close(fig)
    print('wrote', os.path.relpath(path, ROOT), Image.open(path).size)
