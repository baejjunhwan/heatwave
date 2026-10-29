import glob, json, numpy as np, pandas as pd
import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
from matplotlib import font_manager as fm
from matplotlib.collections import PolyCollection
from matplotlib.colors import TwoSlopeNorm
for f in glob.glob('/usr/share/fonts/opentype/noto/NotoSansCJK-*.ttc'): fm.fontManager.addfont(f)
plt.rcParams['font.family']='Noto Sans CJK KR'; plt.rcParams['axes.unicode_minus']=False
j=pd.read_pickle('work/res_lst/joined2.pkl')
j['dexp']=j.exp_2-j.Abs_mean
base=set(j.Track1_Score.nlargest(83).index); new=set(j.T1_2.nlargest(83).index)
ent=new-base; left=base-new
g=json.load(open('web/site/data/oa.json'))
polys=[];vals=[];codes=[]
lat0=35.19; kx=np.cos(np.radians(lat0))
for f in g['features']:
    c=f['properties']['c']; geom=f['geometry']
    rings=[geom['coordinates'][0]] if geom['type']=='Polygon' else [p[0] for p in geom['coordinates']]
    for r in rings:
        a=np.array(r); polys.append(np.column_stack([a[:,0]*kx,a[:,1]])); codes.append(c)
fig=plt.figure(figsize=(15,8.2),dpi=130)
gs=fig.add_gridspec(1,2,width_ratios=[1.25,1],left=0.01,right=0.98,top=0.92,bottom=0.1,wspace=0.08)
ax=fig.add_subplot(gs[0])
norm=TwoSlopeNorm(0,-3,3); cm=plt.get_cmap('RdBu_r')
fc=[]
for c in codes:
    if c in j.index and not j.loc[c,'fb_2']: fc.append(cm(norm(np.clip(j.loc[c,'dexp'],-3,3))))
    elif c in j.index: fc.append((0.80,0.80,0.80,1))
    else: fc.append((0.93,0.93,0.93,1))
ax.add_collection(PolyCollection(polys,facecolors=fc,edgecolors='white',linewidths=0.15))
for sel,col,lw,ls in [(ent,'#eb6834',2.2,'-'),(left,'#2a78d6',2.0,'-')]:
    pp=[p for p,c in zip(polys,codes) if c in sel]
    ax.add_collection(PolyCollection(pp,facecolors='none',edgecolors=col,linewidths=lw,linestyles=ls))
ax.autoscale(); ax.set_aspect('equal'); ax.set_xticks([]); ax.set_yticks([])
for s in ax.spines.values(): s.set_visible(False)
ax.set_title('거주지 기준 노출 − 집계구 평균 노출 (℃, 2025 여름 지표면온도)',fontsize=11.5,loc='left')
cax=ax.inset_axes([0.62,0.06,0.33,0.025]); cb=fig.colorbar(plt.cm.ScalarMappable(norm=norm,cmap=cm),cax=cax,orientation='horizontal'); cb.ax.tick_params(labelsize=8); cb.set_label('℃ (±3에서 자름)',fontsize=8.5)
ax.plot([],[],'s',ms=9,mfc=(0.8,0.8,0.8),mec='none',label='주거 건물 없음 → 기존 값 사용 (113곳)')
ax.plot([],[],'s',ms=9,mfc='none',mec='#eb6834',mew=2,label='상위 10%에 새로 든 곳 (6)')
ax.plot([],[],'s',ms=9,mfc='none',mec='#2a78d6',mew=2,label='상위 10%에서 빠진 곳 (6)')
ax.legend(loc='upper left',fontsize=9,frameon=False)
# scatter
ax=fig.add_subplot(gs[1])
oth=j[~j.index.isin(ent|left)]
ax.scatter(oth.Track1_Score,oth.T1_2,s=9,color='#9a9a9a',alpha=0.6,lw=0)
ax.scatter(j.loc[sorted(ent),'Track1_Score'],j.loc[sorted(ent),'T1_2'],s=46,color='#eb6834',zorder=3,label='새로 든 곳')
ax.scatter(j.loc[sorted(left),'Track1_Score'],j.loc[sorted(left),'T1_2'],s=46,color='#2a78d6',zorder=3,label='빠진 곳')
th0=j.Track1_Score.nlargest(83).min(); th1=j.T1_2.nlargest(83).min()
ax.axvline(th0,color='#bbb',lw=1,ls='--'); ax.axhline(th1,color='#bbb',lw=1,ls='--')
lim=[min(j.Track1_Score.min(),j.T1_2.min())-0.2,max(j.Track1_Score.max(),j.T1_2.max())+0.2]
ax.plot(lim,lim,color='#ddd',lw=1,zorder=0)
s=j.loc['24040700010001']; ax.annotate('삼각동 산자락 마을\n고령 61%, 175위 → 53위',(s.Track1_Score,s.T1_2),xytext=(-3.3,3.0),fontsize=9,arrowprops=dict(arrowstyle='-',color='#555',lw=0.8))
ax.set_xlabel('기존 Track 1 점수 (집계구 평균 온도)',fontsize=9.5); ax.set_ylabel('새 Track 1 점수 (거주지 기준 온도)',fontsize=9.5)
ax.text(th0+0.05,lim[0]+0.2,'기존 상위 10% 경계',fontsize=8,color='#888',rotation=90,va='bottom')
ax.text(lim[0]+0.1,th1+0.08,'새 상위 10% 경계',fontsize=8,color='#888')
ax.grid(color='#f0f0f0'); ax.spines[['top','right']].set_visible(False); ax.tick_params(labelsize=8)
ax.legend(loc='lower right',fontsize=9,frameon=False)
ax.set_title('Track 1 점수 비교: 순위 상관 ρ = 0.963, 상위 83곳 중 77곳 유지',fontsize=11.5,loc='left')
fig.text(0.01,0.02,'거주지 기준 노출: GIS건물통합정보 중 주용도 단독·공동주택 건물이 덮은 면적으로 가중한 2025년 5~9월 평균 지표면온도(Landsat 8, 기존과 같은 합성). '
         '주거 건물이 없거나 온도값이 빈 113곳은 기존 집계구 평균을 사용.\n근린생활시설을 포함하면 상위 83곳 중 81곳이 같고, 지붕 면적 900 m² 미만인 57곳을 기존 값으로 바꿔도 상위 83곳은 그대로임.',fontsize=8.5,color='#555')
fig.savefig('results/Track1_거주지노출_비교.png',facecolor='white'); print('ok')
# csv
o=j[['Admin','to_in_001','Elderly_Ratio','Abs_mean','exp_2','res_share_2','fb_2','Track1_Score','Track1_Rank','T1_2','R1_2','exp_1','T1_1','R1_1']].copy()
o.columns=['행정동','인구','고령비율','노출_집계구평균','노출_거주지(주택)','주거지붕비율','기존값사용','T1점수_기존','T1순위_기존','T1점수_거주지','T1순위_거주지','노출_거주지(주택+근생)','T1점수_주택근생','T1순위_주택근생']
o['상위10%_기존']=o.index.isin(base); o['상위10%_거주지']=o.index.isin(new)
o.sort_values('T1순위_거주지').round(4).to_csv('results/Track1_거주지노출.csv',encoding='utf-8-sig')
print(len(o))
