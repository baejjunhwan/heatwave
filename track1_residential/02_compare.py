import pandas as pd, numpy as np, json
from scipy.stats import spearmanr, pearsonr
pd.set_option('display.width',240)
j=pd.read_pickle('work/res_lst/joined.pkl')
z=lambda s:(s-s.mean())/s.std(ddof=1)
top=83
out={}
base=set(j.Track1_Score.nlargest(top).index)
for k,lab in [('2','주택만'),('1','주택+근생')]:
    e=j[f'LST25_res_{k}'].where(j[f'res_share_{k}']>0).fillna(j.Abs_mean)
    j[f'exp_{k}']=e; j[f'fb_{k}']=j[f'LST25_res_{k}'].isna()|(j[f'res_share_{k}']==0)
    j[f'T1_{k}']=z(e)+z(j.Elderly_Ratio)
    j[f'R1_{k}']=j[f'T1_{k}'].rank(ascending=False,method='min').astype(int)
    new=set(j[f'T1_{k}'].nlargest(top).index)
    d=e-j.Abs_mean
    out[k]=dict(fallback=int(j[f'fb_{k}'].sum()),r_exp=pearsonr(e,j.Abs_mean)[0],rho_score=spearmanr(j[f'T1_{k}'],j.Track1_Score)[0],
                overlap=len(new&base),entered=sorted(new-base),left=sorted(base-new),
                diff_mean=d.mean(),diff_sd=d.std(),diff_p5=d.quantile(.05),diff_p95=d.quantile(.95),n_up1=int((d>=1).sum()),n_dn1=int((d<=-1).sum()))
    print(f"[{lab}] fallback {out[k]['fallback']}, r(exposure) {out[k]['r_exp']:.3f}, rho(score) {out[k]['rho_score']:.3f}, top83 overlap {out[k]['overlap']}/83, "
          f"diff mean {d.mean():+.2f} sd {d.std():.2f} p5 {d.quantile(.05):+.2f} p95 {d.quantile(.95):+.2f}, >=+1℃ {out[k]['n_up1']}, <=-1℃ {out[k]['n_dn1']}")
# what drives the difference
j['d2']=j.exp_2-j.Abs_mean
print('corr diff with SAVI',round(j.d2.corr(j.SAVI),2),' with res_share',round(j.d2.corr(j.res_share_2),2),' with DEM',round(j.d2.corr(j.DEM),2),' with Abs',round(j.d2.corr(j.Abs_mean),2))
j['savi_q']=pd.qcut(j.SAVI,5,labels=['Q1 낮음','Q2','Q3','Q4','Q5 높음'])
print(j.groupby('savi_q',observed=True).d2.agg(['mean','median','count']).round(2).to_string())
print('by dong (mean diff, n):'); g=j.groupby('Admin').d2.agg(['mean','count']).sort_values('mean',ascending=False); print(g.round(2).head(8).to_string()); print(g.round(2).tail(5).to_string())
cols=['Admin','Elderly_Ratio','Abs_mean','exp_2','res_share_2','SAVI','Track1_Rank','R1_2','R1_1']
print('\nENTERED (housing only):'); print(j.loc[out['2']['entered'],cols].sort_values('R1_2').round(2).to_string())
print('\nLEFT (housing only):'); print(j.loc[out['2']['left'],cols].sort_values('Track1_Rank').round(2).to_string())
print('\nentered both versions:',sorted(set(out['1']['entered'])&set(out['2']['entered'])))
j.to_pickle('work/res_lst/joined2.pkl')
json.dump({k:{kk:(vv if not isinstance(vv,(np.floating,)) else float(vv)) for kk,vv in v.items()} for k,v in out.items()},open('work/res_lst/summary.json','w'),ensure_ascii=False,default=float,indent=1)
