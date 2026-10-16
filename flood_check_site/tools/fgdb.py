import struct, os, math

def varuint(b, p):
    r=0; s=0
    while True:
        c=b[p]; p+=1
        r |= (c&0x7f)<<s; s+=7
        if not c&0x80: return r,p

def varint(b,p):
    c=b[p]; p+=1
    neg = c&0x40; r=c&0x3f; s=6
    while c&0x80:
        c=b[p]; p+=1
        r |= (c&0x7f)<<s; s+=7
    return (-r if neg else r),p

class Table:
    def __init__(self, path):
        self.path=path
        self.f=open(path,'rb')
        h=self.f.read(40)
        magic,self.nvalid,self.maxrow,_,_,_,self.fsize,self.fdoff=struct.unpack('<iiiiiiqq',h)
        self.f.seek(self.fdoff)
        hsz,=struct.unpack('<i',self.f.read(4))
        b=self.f.read(hsz)
        self.version,flags,nf=struct.unpack('<iih',b[:10])
        self.geomtype=flags&0xff
        self.has_z = bool(flags & (1<<31)); self.has_m=bool(flags&(1<<30))
        p=10; self.fields=[]
        for i in range(nf):
            n=b[p]; p+=1; name=b[p:p+2*n].decode('utf-16le'); p+=2*n
            n=b[p]; p+=1; alias=b[p:p+2*n].decode('utf-16le'); p+=2*n
            t=b[p]; p+=1
            fd={'name':name,'type':t}
            if t==6: # objectid
                p+=2; fd['nullable']=False
            elif t==4: # string
                p+=4; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
                dl,p=varuint(b,p); p+=dl
            elif t==7: # geometry
                p+=1; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
                wl,=struct.unpack('<h',b[p:p+2]); p+=2
                fd['wkt']=b[p:p+wl].decode('utf-16le'); p+=wl
                mf=b[p]; p+=1
                fd['hasm']=bool(mf&2); fd['hasz']=bool(mf&4)
                fd['xorig'],fd['yorig'],fd['xyscale']=struct.unpack('<ddd',b[p:p+24]); p+=24
                if fd['hasm']: p+=16
                if fd['hasz']: fd['zorig'],fd['zscale']=struct.unpack('<dd',b[p:p+16]); p+=16
                p+=8 # xytol
                if fd['hasm']: p+=8
                if fd['hasz']: p+=8
                fd['bbox']=struct.unpack('<dddd',b[p:p+32]); p+=32
                while True:
                    ng,=struct.unpack('<i',b[p+1:p+5])
                    if b[p]==0 and 1<=ng<=3: p+=5; break
                    p+=8
                p+=8*ng
            elif t==8: # binary
                p+=1; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
            elif t==9: # raster
                p+=1; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
                n=b[p]; p+=1; p+=2*n
                wl,=struct.unpack('<h',b[p:p+2]); p+=2; p+=wl
                mf=b[p]; p+=1
                if mf:
                    p+=24
                    if mf&2: p+=16
                    if mf&4: p+=16
                    p+=8
                    if mf&2: p+=8
                    if mf&4: p+=8
                p+=1
            elif t in (10,11,12): # guid, globalid, xml
                p+=1; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
            else:
                sz=b[p]; p+=1; fl=b[p]; p+=1; fd['nullable']=bool(fl&1)
                dl=b[p]; p+=1; p+=dl
            self.fields.append(fd)
        self.nnullable=sum(1 for f in self.fields if f.get('nullable'))
        # tablx
        x=path[:-9]+'.gdbtablx'
        self.offsets=[]
        if os.path.exists(x):
            xb=open(x,'rb').read()
            _,nblk,nrows,osz=struct.unpack('<iiii',xb[:16])
            self.osz=osz
            n=nrows
            if nblk*1024!=nrows or True:
                pass
            # handle sparse bitmap
            tail=16+nblk*1024*osz
            if len(xb)>tail+16 and nblk>0:
                nbitmap,nbits,_,_=struct.unpack('<iiii',xb[tail:tail+16])
            else: nbitmap=0
            if nbitmap:
                bm=xb[tail+16:tail+16+nbitmap*4]
                blocks=[]
                for i in range(nbitmap*32):
                    if bm[i//8]>>(i%8)&1: blocks.append(i)
                for bi,blk in enumerate(blocks):
                    for j in range(1024):
                        o=16+(bi*1024+j)*osz
                        self.offsets.append((blk*1024+j+1,int.from_bytes(xb[o:o+osz],'little')))
            else:
                for i in range(nblk*1024):
                    o=16+i*osz
                    self.offsets.append((i+1,int.from_bytes(xb[o:o+osz],'little')))
            self.offsets=[(i,o) for i,o in self.offsets if o]
    def rows(self, want=None, geom=True):
        f=self.f
        for oid,off in self.offsets:
            f.seek(off); sz,=struct.unpack('<i',f.read(4))
            b=f.read(sz)
            yield oid,self.parse(b,want,geom)
    def parse(self,b,want=None,geom=True):
        nb=(self.nnullable+7)//8
        flags=b[:nb]; p=nb; ni=0; row={}
        for fd in self.fields:
            t=fd['type']
            if t==6: continue
            if fd.get('nullable'):
                isnull=flags[ni//8]>>(ni%8)&1; ni+=1
                if isnull: row[fd['name']]=None; continue
            nm=fd['name']
            if t==0: v,=struct.unpack('<h',b[p:p+2]); p+=2
            elif t==1: v,=struct.unpack('<i',b[p:p+4]); p+=4
            elif t==2: v,=struct.unpack('<f',b[p:p+4]); p+=4
            elif t in (3,5): v,=struct.unpack('<d',b[p:p+8]); p+=8
            elif t in (4,12):
                l,p=varuint(b,p); v=b[p:p+l].decode('utf-8','replace'); p+=l
            elif t in (7,8,9):
                l,p=varuint(b,p); v=b[p:p+l] if (t!=7 or geom) else None; p+=l
            elif t in (10,11): v=b[p:p+16].hex(); p+=16
            elif t==13: v,=struct.unpack('<q',b[p:p+8]); p+=8
            elif t==14: v,=struct.unpack('<d',b[p:p+8]); p+=8
            elif t==15: v,=struct.unpack('<d',b[p:p+8]); p+=8
            elif t==16: v=b[p:p+10]; p+=10
            else: raise ValueError(t)
            if want is None or nm in want: row[nm]=v
        return row
    def geomfield(self):
        for fd in self.fields:
            if fd['type']==7: return fd

def decode_polygon(blob, gf):
    """returns list of rings (list of (x,y))"""
    b=blob; p=0
    gt,p=varuint(b,p)
    base=gt&0xff
    npts,p=varuint(b,p)
    if npts==0: return []
    nparts,p=varuint(b,p)
    hascurves = bool(gt & 0x20000000)
    if hascurves: ncurves,p=varuint(b,p)
    for _ in range(4): _,p=varuint(b,p)  # bbox
    counts=[]
    for _ in range(nparts-1):
        c,p=varuint(b,p); counts.append(c)
    counts.append(npts-sum(counts))
    sc=gf['xyscale']; xo=gf['xorig']; yo=gf['yorig']
    dx=dy=0; rings=[]
    for c in counts:
        r=[]
        for _ in range(c):
            vx,p=varint(b,p); vy,p=varint(b,p)
            dx+=vx; dy+=vy
            r.append((dx/sc+xo, dy/sc+yo))
        rings.append(r)
    return rings
