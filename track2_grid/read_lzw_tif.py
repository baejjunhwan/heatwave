import sys, tifffile, numpy as np
def lzw_decode(data):
    table=[bytes([i]) for i in range(256)]+[b'',b'']
    out=bytearray(); pos=0; nbits=9; n=len(data); prev=None
    switch={511:10,1023:11,2047:12}
    data=bytes(data)+b'\x00\x00\x00'
    while pos+nbits<=n*8:
        b=pos>>3; v=(data[b]<<16)|(data[b+1]<<8)|data[b+2]
        code=(v>>(24-(pos&7)-nbits))&((1<<nbits)-1); pos+=nbits
        if code==257: break
        if code==256:
            table=table[:258]; nbits=9; prev=None; continue
        if prev is None:
            entry=table[code]; out+=entry; prev=entry; continue
        if code<len(table):
            entry=table[code]; table.append(prev+entry[:1])
        else:
            entry=prev+prev[:1]; table.append(entry)
        out+=entry; prev=entry
        if len(table) in switch: nbits=switch[len(table)]
    return bytes(out)
def read(path):
    with tifffile.TiffFile(path) as tf:
        p=tf.pages[0]; fh=tf.filehandle
        H,W,S=p.shape; th,tw=p.tilelength,p.tilewidth
        dt=np.dtype(p.dtype).newbyteorder(tf.byteorder)
        arr=np.full((H,W,S),np.nan,np.float32)
        nty=(H+th-1)//th; ntx=(W+tw-1)//tw
        for i,(off,cnt) in enumerate(zip(p.dataoffsets,p.databytecounts)):
            fh.seek(off); raw=lzw_decode(fh.read(cnt))
            t=np.frombuffer(raw[:th*tw*S*dt.itemsize],dt).reshape(th,tw,S)
            ty,tx=divmod(i,ntx); y0,x0=ty*th,tx*tw
            arr[y0:y0+th,x0:x0+tw]=t[:min(th,H-y0),:min(tw,W-x0)]
        sx,sy=p.tags['ModelPixelScaleTag'].value[:2]; lon0,lat0=p.tags['ModelTiepointTag'].value[3:5]
    return arr,(lon0,lat0,sx,sy)
if __name__=='__main__':
    a,geo=read(sys.argv[1]); np.save(sys.argv[2],a); print(a.shape,geo)
    for b in range(a.shape[2]): v=a[...,b]; print(b,np.nanmin(v),np.nanmax(v),np.nanmean(v))
