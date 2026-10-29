"""Minimal ESRI shapefile (Polygon) + DBF reader."""
import struct

def read_dbf(path, enc='utf-8'):
    b = open(path, 'rb').read()
    n, hlen, rlen = struct.unpack('<IHH', b[4:12])
    fields = []
    for i in range(32, hlen - 1, 32):
        f = b[i:i+32]
        if f[0] == 0x0D: break
        name = f[:11].split(b'\0')[0].decode('ascii'); typ = chr(f[11]); ln = f[16]
        fields.append((name, typ, ln))
    recs = []
    for r in range(n):
        o = hlen + r * rlen + 1
        rec = {}
        for name, typ, ln in fields:
            v = b[o:o+ln].decode(enc, 'replace').strip(); o += ln
            rec[name] = v
        recs.append(rec)
    return fields, recs

def read_shp(path):
    b = open(path, 'rb').read()
    i = 100; out = []
    while i < len(b):
        num, clen = struct.unpack('>ii', b[i:i+8]); i += 8
        rec = b[i:i + clen*2]; i += clen*2
        st = struct.unpack('<i', rec[:4])[0]
        if st == 0: out.append(None); continue
        assert st in (5, 15, 25), st
        nparts, npts = struct.unpack('<ii', rec[36:44])
        parts = list(struct.unpack('<%di' % nparts, rec[44:44+4*nparts]))
        p0 = 44 + 4*nparts
        pts = [struct.unpack('<dd', rec[p0+16*k:p0+16*k+16]) for k in range(npts)]
        rings = [pts[parts[k]:(parts[k+1] if k+1 < nparts else npts)] for k in range(nparts)]
        out.append(rings)
    return out
