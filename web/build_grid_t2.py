"""web/site/data/grid_t2.json: Track 2 on 100 m grid (old roof area version, redevelopment cells separate)."""
import sys, json, numpy as np, pandas as pd
sys.path.insert(0,'analysis'); import tm5179
D=pd.read_pickle('work/t2grid/final.pkl'); G=pd.read_pickle('work/t2grid/g.pkl')
m=pd.read_csv('data/grid_oa_map.csv',dtype={'TOT_OA_CD':str})
oa=pd.read_csv('data/Bukgu_OA_Master_v3.csv',dtype={'TOT_OA_CD':str}).set_index('TOT_OA_CD')
ga=pd.read_pickle('work/grid_all.pkl')[['row_index','col_index','left','right','top','bottom']]
def corners(df):
    df=df[['row_index','col_index']].merge(ga,on=['row_index','col_index'],how='left')
    out=[]
    for l,r,b,t in zip(df['left'],df['right'],df['bottom'],df['top']):
        lo,la=tm5179.inverse(np.array([l,r,r,l]),np.array([b,b,t,t]))
        out.append([[round(float(y),6),round(float(x),6)] for x,y in zip(lo,la)])
    return out
pct=lambda s:(s.rank(pct=True)*100).round(1)
D=D.sort_values('rank').reset_index(drop=True)
D['pn'],D['pa'],D['pl']=pct(D.dNDBI),pct(D.oldA),pct(D.dRLST)
N=len(D)
cells=[]
for row,c in zip(D.itertuples(),corners(D)):
    cells.append({'id':f'g{row.row_index}_{row.col_index}','c':c,'d':row.Admin,'o':row.TOT_OA_CD,'s':round(row.score,3),'r':int(row.rank),'k':int(row.top),
                  'n':round(row.dNDBI,4),'a':int(round(row.oldA)),'t':int(round(row.res_h)),'l':round(row.dRLST,2),
                  'zn':round(row.Zn,2),'za':round(row.Zo,2),'zl':round(row.Zr,2),'pn':row.pn,'pa':row.pa,'pl':row.pl,
                  'la':round(row.lat,5),'lo':round(row.lon,5)})
g=G.drop(columns=['TOT_OA_CD']).merge(m,on=['row_index','col_index'],how='left')
dev=g[(g.dNDBI>=0.10)&(g.dSAVI<=-0.10)&(g.res_h>=1000)&(g.known_h>0)].copy()
adm8=oa.reset_index().assign(a8=lambda x:x.TOT_OA_CD.str[:8]).drop_duplicates('a8').set_index('a8').Admin
dev['Admin']=dev.TOT_OA_CD.map(oa.Admin).fillna(dev.TOT_OA_CD.str[:8].map(adm8))
lo,la=tm5179.inverse(dev.cx.values,dev.cy.values); dev['lat'],dev['lon']=la,lo
devs=[{'id':f'g{r.row_index}_{r.col_index}','c':c,'d':r.Admin,'o':r.TOT_OA_CD,'n':round(r.dNDBI,4),'sv':round(r.dSAVI,3),'l':round(r.dRLST,2),'la':round(r.lat,5),'lo':round(r.lon,5)}
      for r,c in zip(dev.itertuples(),corners(dev))]
meta={'N':N,'top':int(D.top.sum()),'q25':int(round(N*.25)),'q50':int(round(N*.5)),'ndev':len(devs),
      'old_top_ha':round(float(D[D.top].oldA.sum())/1e4,1),'thr':1000,'old_year':1999}
json.dump({'meta':meta,'cells':cells,'dev':devs},open('web/site/data/grid_t2.json','w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print(meta, len(cells), len(devs))
