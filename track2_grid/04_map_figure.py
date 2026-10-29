"""Thesis Fig 5-2 (grid): Track 2 on 100 m grid cells over Sentinel-2 2025."""
import sys, glob
import numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.collections import PatchCollection
from matplotlib.patches import Rectangle, Patch
from scipy.ndimage import map_coordinates, gaussian_filter
from PIL import Image
REPO='.'; sys.path.insert(0,REPO+'/analysis'); import tm5179
for f in glob.glob('/usr/share/fonts/opentype/noto/NotoSansCJK-*.ttc'): fm.fontManager.addfont(f)
plt.rcParams['font.family']='Noto Sans CJK KR'; plt.rcParams['axes.unicode_minus']=False
SURFACE,INK,INK2,MUTED,HAIR='#ffffff','#111111','#4a4a48','#85847f','#d9d8d2'
BLUE=["#cde2fb","#9ec5f4","#6da7ec","#3987e5","#256abf","#184f95","#0d366b"]
VEIL,SAT=0.40,0.55
oa=pd.read_csv(REPO+'/data/Bukgu_OA_Master_v3.csv',dtype={'TOT_OA_CD':str})
pad=600; xlim=(oa.cx.min()-pad,oa.cx.max()+pad); ylim=(oa.cy.min()-pad,oa.cy.max()+pad)
def basemap(res=10.0):
    Image.MAX_IMAGE_PIXELS=None
    im=Image.open(REPO+'/data/basemap/Sentinel2_TrueColor_2025_Bukgu.tif'); src=np.asarray(im.convert('RGB')).astype(np.float32)
    sx,sy=im.tag_v2[33550][0],im.tag_v2[33550][1]; lon0,lat0=im.tag_v2[33922][3],im.tag_v2[33922][4]
    valid=src.sum(2)>0
    for b in range(3):
        lo,hi=np.percentile(src[...,b][valid],[2,98]); src[...,b]=np.clip((src[...,b]-lo)/(hi-lo),0,1)
    src=src**0.95
    gx=np.arange(xlim[0]+res/2,xlim[1],res); gy=np.arange(ylim[1]-res/2,ylim[0],-res)
    LON,LAT=tm5179.inverse(*np.meshgrid(gx,gy)); col=(LON-lon0)/sx-0.5; row=(lat0-LAT)/sy-0.5
    rgb=np.stack([map_coordinates(src[...,b],[row,col],order=1,cval=0) for b in range(3)],-1)
    alpha=map_coordinates(valid.astype(np.float32),[row,col],order=1,cval=0)
    grey=(rgb@np.array([0.299,0.587,0.114]))[...,None]; rgb=(1-VEIL)*(grey+SAT*(rgb-grey))+VEIL
    return np.dstack([np.clip(rgb,0,1),(alpha>0.5).astype(np.float32)]),(gx[0]-res/2,gx[-1]+res/2,gy[-1]-res/2,gy[0]+res/2),gx,gy,gaussian_filter(alpha,1.0)
D=pd.read_pickle('work/t2grid/final.pkl')
G=pd.read_pickle('work/t2grid/g.pkl')
dev=G[(G.dNDBI>=0.10)&(G.dSAVI<=-0.10)&(G.res_h>=1000)&(G.known_h>0)]
rgba,ext,gx,gy,alpha_s=basemap()
fig,ax=plt.subplots(figsize=(7.6,7.6),dpi=200,facecolor=SURFACE)
ax.imshow(rgba,extent=ext,origin='upper',interpolation='bilinear',zorder=0)
ax.contour(gx,gy,alpha_s,levels=[0.5],colors=['#5c5c58'],linewidths=0.8,zorder=1)
cmap=LinearSegmentedColormap.from_list('t2',BLUE)
vmin,vmax=D.score.quantile([.02,.98]); norm=plt.Normalize(vmin,vmax)
dd=D.sort_values('score')
pc=PatchCollection([Rectangle((x-50,y-50),100,100) for x,y in zip(dd.cx,dd.cy)],facecolor=cmap(norm(dd.score.values)),edgecolor='none',zorder=2)
ax.add_collection(pc)
t=D[D.top]
ax.add_collection(PatchCollection([Rectangle((x-50,y-50),100,100) for x,y in zip(t.cx,t.cy)],facecolor='none',edgecolor=INK,linewidth=0.75,zorder=4))
ax.add_collection(PatchCollection([Rectangle((x-50,y-50),100,100) for x,y in zip(dev.cx,dev.cy)],facecolor='#d9d8d2',edgecolor='#6b6a66',linewidth=0.6,hatch='////',zorder=3))
ax.set_xlim(*xlim); ax.set_ylim(*ylim); ax.set_aspect('equal')
for s in ax.spines.values(): s.set_color(HAIR); s.set_linewidth(.8)
ax.set_xticks([]); ax.set_yticks([])
ax.set_title('Z(시가화 변화) + Z(노후 주거 지붕 면적) + Z(ΔRLST), 100m 격자',color=INK,fontsize=12.5,loc='left',pad=10)
cb=fig.colorbar(plt.cm.ScalarMappable(norm=norm,cmap=cmap),ax=ax,orientation='horizontal',fraction=.04,pad=.03,aspect=36,extend='both')
cb.set_label('Z-점수 합산 (색 범위: 2~98 백분위)',color=INK2,fontsize=10); cb.outline.set_visible(False); cb.ax.tick_params(colors=MUTED,labelsize=9,length=0)
x0,y0=xlim[0]+700,ylim[0]+620
ax.plot([x0,x0+2000],[y0,y0],color=INK,lw=2.4,solid_capstyle='butt',zorder=5); ax.text(x0+1000,y0+200,'2 km',color=INK2,fontsize=9.5,ha='center',zorder=5)
nx,ny=xlim[1]-700,ylim[1]-1900
ax.annotate('',xy=(nx,ny+1000),xytext=(nx,ny),arrowprops=dict(arrowstyle='-|>',color=INK,lw=1.6),zorder=5); ax.text(nx,ny+1120,'N',color=INK,fontsize=10,ha='center',fontweight='bold')
leg=[Patch(facecolor='none',edgecolor=INK,linewidth=1.2,label=f'상위 10% 우선순위 격자 (n={len(t)})'),
     Patch(facecolor=BLUE[2],edgecolor='none',label=f'대상 격자: 주거 지붕 1,000m² 이상 (N={len(D):,})'),
     Patch(facecolor='#d9d8d2',edgecolor='#6b6a66',hatch='////',label=f'재건축·신개발 진행 격자 (제외, n={len(dev)})')]
lg=ax.legend(handles=leg,loc='upper left',frameon=True,fontsize=9.2,labelcolor=INK2,fancybox=False,framealpha=0.88,edgecolor='none',facecolor='white'); lg.set_zorder(6)
ax.text(0.99,0.012,'배경: Sentinel-2 실사 영상(2025), Copernicus Sentinel 자료 가공. 건물: 국토교통부 GIS건물통합정보',transform=ax.transAxes,ha='right',va='bottom',fontsize=7,color=INK2,zorder=6,bbox=dict(boxstyle='square,pad=0.25',fc='white',ec='none',alpha=0.8))
out='figs/fig5_2_track2_grid.png'
fig.savefig(out,facecolor=SURFACE,bbox_inches='tight',pad_inches=0.12); plt.close(fig)
Image.open(out).convert('RGB').save(out.replace('.png','.jpg'),quality=88)
print(out,len(t),len(D),len(dev))
