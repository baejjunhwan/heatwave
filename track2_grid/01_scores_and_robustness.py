import pandas as pd, numpy as np, json, sys
from scipy.stats import spearmanr, pearsonr, mstats
sys.path.insert(0,'analysis'); import tm5179
pd.set_option('display.width',240)
g=pd.read_pickle('work/t2grid/g.pkl')
m=pd.read_csv('data/grid_oa_map.csv',dtype={'TOT_OA_CD':str})
oa=pd.read_csv('data/Bukgu_OA_Master_v3.csv',dtype={'TOT_OA_CD':str}).set_index('TOT_OA_CD')
g=g.drop(columns=['TOT_OA_CD']).merge(m,on=['row_index','col_index'],how='left')
g['Admin']=g.TOT_OA_CD.map(oa.Admin)
# dong for cells whose OA not in 832: use dong code from OA code prefix via any OA in master with same ADM
adm=oa.reset_index()[['TOT_OA_CD','ADM_CD','Admin']]; adm['ADM8']=adm.TOT_OA_CD.str[:8]
a8=adm.drop_duplicates('ADM8').set_index('ADM8').Admin
g['Admin']=g.Admin.fillna(g.TOT_OA_CD.str[:8].map(a8))
z=lambda s:(s-s.mean())/s.std(ddof=1)
zmad=lambda s:(s-s.median())/(1.4826*(s-s.median()).abs().median())
wins=lambda s:pd.Series(mstats.winsorize(s.values,limits=[.05,.05]),index=s.index).astype(float)
g['dev']=(g.dNDBI>=0.10)&(g.dSAVI<=-0.10)
def domain(res,known,thr,drop_dev=True):
    d=g[(g[res]>=thr)&(g[known]>0)].dropna(subset=['dNDBI','dRLST']).copy()
    return d[~d.dev] if drop_dev else d
def build(d,old,f=z,use=('n','o','r')):
    parts={'n':f(d.dNDBI),'o':f(d[old]),'r':f(d.dRLST)}
    return sum(parts[k] for k in use)
ALL=domain('res_h','known_h',1000,drop_dev=False); DEV=ALL[ALL.dev]
print('dev cells in base domain',len(DEV),DEV.Admin.value_counts().to_dict())
R0={'dev_n':len(DEV),'dev_dong':DEV.Admin.value_counts().to_dict()}
D=domain('res_h','known_h',1000); D['oldA']=D.old_h; D['oldS']=D.old_h/D.known_h
D['Zn'],D['Zo'],D['Zr']=z(D.dNDBI),z(D.oldA),z(D.dRLST)
D['score']=D.Zn+D.Zo+D.Zr; D['rank']=D.score.rank(ascending=False,method='min').astype(int)
TOP=round(len(D)*.1); D['top']=D.index.isin(D.score.nlargest(TOP).index)
print('domain',len(D),'top',TOP)
R={'N':len(D),'top':TOP,**R0}
c=D[['dNDBI','oldA','dRLST']]; R['corr']={f'{a}-{b}':[pearsonr(c[a],c[b])[0],pearsonr(c[a],c[b])[1]] for a,b in [('dNDBI','oldA'),('dNDBI','dRLST'),('oldA','dRLST')]}
print('corr',{k:[round(v[0],3),round(v[1],4)] for k,v in R['corr'].items()})
# PCA weights
X=np.column_stack([D.Zn,D.Zo,D.Zr]); C=np.corrcoef(X.T); w,v=np.linalg.eigh(C); pc=v[:,-1]*np.sign(v[:,-1].sum()); R['pca_var']=w[-1]/w.sum(); R['pca_w']=pc.tolist()
pca=X@pc
Tset=set(D[D.top].index)
def comp(name,s,dom=None):
    if dom is None:
        t=set(s.nlargest(TOP).index); rho=spearmanr(D.score,s)[0]; k=len(Tset&t); return dict(name=name,rho=rho,kept=k,den=TOP,n=len(s))
    # different domain: s indexed by its own domain
    tn=round(len(s)*.1); t=set(s.nlargest(tn).index); common=D.index.intersection(s.index)
    rho=spearmanr(D.loc[common,'score'],s.loc[common])[0]
    if tn>=TOP: k=len(Tset&t); den=TOP
    else: k=len(t&Tset); den=tn
    return dict(name=name,rho=rho,kept=k,den=den,n=len(s))
rows=[comp('로버스트(중위수·MAD) 표준화',build(D,'oldA',zmad)),
      comp('윈저화(5%/95%)',z(wins(D.dNDBI))+z(wins(D.oldA))+z(wins(D.dRLST))),
      comp('PCA 기반 가중',pd.Series(pca,index=D.index)),
      comp('ΔNDBI 제외',D.Zo+D.Zr),
      comp('ΔRLST 제외',D.Zn+D.Zo),
      comp('노후 지붕 비율(면적 대신)',z(D.dNDBI)+z(D.oldS)+z(D.dRLST))]
for thr,lab in [(500,'대상 하한 500 m²'),(1500,'대상 하한 1,500 m²')]:
    d=domain('res_h','known_h',thr); s=z(d.dNDBI)+z(d.old_h)+z(d.dRLST); rows.append(comp(lab,s,dom=True))
d=domain('res_m','known_m',1000); s=z(d.dNDBI)+z(d.old_m)+z(d.dRLST); rows.append(comp('근린생활시설 포함',s,dom=True))
d=domain('res_h','known_h',1000,drop_dev=False); s=z(d.dNDBI)+z(d.old_h)+z(d.dRLST); rows.append(comp('재건축·신개발 칸 포함',s,dom=True))
RB=pd.DataFrame(rows); RB['pct']=100*RB.kept/RB.den
print(RB.round(3).to_string(index=False)); R['robust']=RB.to_dict('records')
print('PCA var',round(R['pca_var'],3),'weights',np.round(pc,3))
# top cells description
t=D[D.top]
dom_comp=t[['Zn','Zo','Zr']].idxmax(axis=1).map({'Zn':'시가화 변화','Zo':'노후 지붕','Zr':'온도 변화'})
R['dominant']=dom_comp.value_counts().to_dict(); print('dominant',R['dominant'])
R['top_means']={k:float(t[k].mean()) for k in ['Zn','Zo','Zr','dNDBI','oldA','dRLST','res_h']}; print({k:round(v,2) for k,v in R['top_means'].items()})
R['dong']=t.Admin.value_counts().to_dict(); print(R['dong'])
# clusters: connected components of top cells (8-neighbour)
cells=set(zip(t.row_index,t.col_index)); seen=set(); comps=[]
for c0 in cells:
    if c0 in seen: continue
    st=[c0]; comp_=[]; seen.add(c0)
    while st:
        r,cc=st.pop(); comp_.append((r,cc))
        for dr in (-1,0,1):
            for dc in (-1,0,1):
                nb=(r+dr,cc+dc)
                if nb in cells and nb not in seen: seen.add(nb); st.append(nb)
    comps.append(comp_)
sizes=sorted([len(c) for c in comps],reverse=True); R['clusters']=sizes; print('clusters',len(comps),'sizes',sizes[:12],'singletons',sum(1 for s in sizes if s==1))
# top 10 table
lo,la=tm5179.inverse(D.cx.values,D.cy.values); D['lat']=la; D['lon']=lo
T10=D.sort_values('rank').head(10)[['rank','Admin','lat','lon','dNDBI','Zn','oldA','Zo','dRLST','Zr','score','res_h']]
print(T10.round(3).to_string(index=False)); R['top10']=T10.round(4).to_dict('records')
# old share in top
R['old_share_top']=float((t.old_h.sum()/t.known_h.sum())); R['old_share_all']=float(D.old_h.sum()/D.known_h.sum())
print('old share area top/all',round(R['old_share_top'],3),round(R['old_share_all'],3),' old roof total top m2',int(t.old_h.sum()))
R['old_roof_top_total']=float(t.old_h.sum())
# OA relation (descriptive only)
D['oa_t2top']=D.TOT_OA_CD.map(oa.Track2_Top10).fillna(False).astype(bool)
R['in_oa_top']=int(D[D.top].oa_t2top.sum()); print('grid top in OA T2 top:',R['in_oa_top'])
# shinyong village
v=D[D.TOT_OA_CD=='24040820050002']; print('신용동 village OA cells in domain:',len(v), v[['rank','oldA','dRLST','dNDBI']].to_string() if len(v) else '')
vv=g[g.TOT_OA_CD=='24040820050002'][['row_index','col_index','res_h','old_h','dRLST']]; print(vv.to_string())
D.to_pickle('work/t2grid/final.pkl'); json.dump(R,open('work/t2grid/final.json','w'),ensure_ascii=False,default=float,indent=1)
