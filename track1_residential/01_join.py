import pandas as pd, numpy as np
from scipy.stats import spearmanr, pearsonr
pd.set_option('display.width',220)
m=pd.read_csv('data/Bukgu_OA_Master_v3.csv',dtype={'TOT_OA_CD':str,'ADM_CD':str}).set_index('TOT_OA_CD')
print('master N',len(m))
r={}
FILES={'r1':'data/residential_lst/Bukgu_OA_LST25_residential_mixed.csv','r2':'data/residential_lst/Bukgu_OA_LST25_residential_house.csv'}
import os; os.makedirs('work/res_lst',exist_ok=True)
for k in ['r1','r2']:
    x=pd.read_csv(FILES[k],dtype={'TOT_OA_CD':str}).set_index('TOT_OA_CD')
    x=x[~x.index.duplicated()]
    r[k]=x
    j=m.join(x,how='left')
    print(f'--- {k}: rows {len(x)}, matched {j.LST25_all.notna().sum()}, res_share mean {j.res_share.mean():.3f} median {j.res_share.median():.3f}, zero share OAs {(j.res_share==0).sum()}, LST25_res NaN {j.LST25_res.isna().sum()}')
    print('   check LST25_all vs Abs_mean: r=',round(j[['LST25_all','Abs_mean']].corr().iloc[0,1],4),' max abs diff',round((j.LST25_all-j.Abs_mean).abs().max(),3))
# which is broader
j=m.join(r['r1'][['res_share','LST25_res']].add_suffix('_1')).join(r['r2'][['res_share','LST25_res']].add_suffix('_2'))
print('r1 share > r2 share in',(j.res_share_1>=j.res_share_2-1e-9).mean().round(3),'of OAs')
j.to_pickle('work/res_lst/joined.pkl')
