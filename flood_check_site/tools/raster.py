"""Vectorized polygon decoding + even-odd scanline rasterization into sparse 5 m tiles."""
import numpy as np, os, struct, time
from fgdb import Table, varuint

CELL = 5.0            # metres
TS = 1024             # cells per tile side (5120 m)
X0 = 200000.0         # grid origin (SWEREF99 TM), top-left
Y0 = 7700000.0
TILEDIR = '/home/claude/work/tiles'
os.makedirs(TILEDIR, exist_ok=True)

def decode_signed_varints(buf):
    """Decode a run of zigzag-ish FileGDB signed varints (6 bits + sign in first byte)."""
    b = np.frombuffer(buf, dtype=np.uint8)
    term = b < 0x80
    ends = np.nonzero(term)[0]
    n = len(ends)
    starts = np.empty(n, dtype=np.int64); starts[0] = 0; starts[1:] = ends[:-1] + 1
    vid = np.zeros(len(b), dtype=np.int64)
    vid[starts[1:]] = 1
    vid = np.cumsum(vid)
    k = np.arange(len(b)) - starts[vid]
    first = k == 0
    contrib = np.where(first, (b & 0x3f).astype(np.int64),
                       ((b & 0x7f).astype(np.int64)) << np.maximum(6 + 7 * (k - 1), 0))
    val = np.add.reduceat(contrib, starts)
    neg = (b[starts] & 0x40) != 0
    val[neg] = -val[neg]
    return val

def decode_polygon_np(blob, gf):
    """Return (xs, ys, counts) arrays in metres."""
    p = 0
    gt, p = varuint(blob, p)
    npts, p = varuint(blob, p)
    if npts == 0:
        return None
    nparts, p = varuint(blob, p)
    if gt & 0x20000000:
        ncurves, p = varuint(blob, p)
    for _ in range(4):
        _, p = varuint(blob, p)
    counts = []
    for _ in range(nparts - 1):
        c, p = varuint(blob, p); counts.append(c)
    counts.append(npts - sum(counts))
    # coordinates: 2*npts signed varints; find the byte span
    b = np.frombuffer(blob, dtype=np.uint8, offset=p)
    ends = np.nonzero(b < 0x80)[0]
    last = ends[2 * npts - 1]
    v = decode_signed_varints(blob[p:p + last + 1])
    v = np.cumsum(v.reshape(-1, 2), axis=0)
    sc = gf['xyscale']
    xs = v[:, 0] / sc + gf['xorig']
    ys = v[:, 1] / sc + gf['yorig']
    return xs, ys, np.array(counts)

def edges_from_rings(xs, ys, counts):
    """Grid-space edges for all rings (col, row as float)."""
    gx = (xs - X0) / CELL
    gy = (Y0 - ys) / CELL
    a_idx = []; b_idx = []
    s = 0
    for c in counts:
        idx = np.arange(s, s + c)
        a_idx.append(idx); b_idx.append(np.roll(idx, -1))
        s += c
    a = np.concatenate(a_idx); bb = np.concatenate(b_idx)
    return gx[a], gy[a], gx[bb], gy[bb]

def spans(ex0, ey0, ex1, ey1):
    """Even-odd scanline: returns (row, c0, c1) spans with cells [c0,c1)."""
    ymin = np.minimum(ey0, ey1); ymax = np.maximum(ey0, ey1)
    r0 = np.ceil(ymin - 0.5).astype(np.int64)
    r1 = np.ceil(ymax - 0.5).astype(np.int64)   # exclusive
    n = r1 - r0
    keep = n > 0
    ex0, ey0, ex1, ey1, r0, n = ex0[keep], ey0[keep], ex1[keep], ey1[keep], r0[keep], n[keep]
    if len(n) == 0:
        return None
    tot = int(n.sum())
    eid = np.repeat(np.arange(len(n)), n)
    off = np.arange(tot) - np.repeat(np.cumsum(n) - n, n)
    rows = r0[eid] + off
    yc = rows + 0.5
    t = (yc - ey0[eid]) / (ey1[eid] - ey0[eid])
    xc = ex0[eid] + t * (ex1[eid] - ex0[eid])
    col = np.ceil(xc - 0.5).astype(np.int64)
    order = np.lexsort((col, rows))
    rows = rows[order]; col = col[order]
    # pair consecutive crossings within the same row
    rr = rows[0::2]; c0 = col[0::2]; c1 = col[1::2]
    assert len(c0) == len(c1) and np.all(rows[1::2] == rr), 'odd crossings'
    m = c1 > c0
    return rr[m], c0[m], c1[m]

class TileStore:
    def __init__(self):
        self.cache = {}
    def get(self, tx, ty):
        k = (tx, ty)
        if k not in self.cache:
            fn = f'{TILEDIR}/{tx}_{ty}.u8'
            if os.path.exists(fn):
                a = np.fromfile(fn, dtype=np.uint8).reshape(TS, TS)
            else:
                a = np.full((TS, TS), 255, dtype=np.uint8)
            self.cache[k] = a
        return self.cache[k]
    def flush(self):
        for (tx, ty), a in self.cache.items():
            a.tofile(f'{TILEDIR}/{tx}_{ty}.u8')
        self.cache = {}

def burn(store, rows, c0, c1, value):
    """Set cells in spans to min(existing, value)."""
    out_r, out_a, out_b = [], [], []
    while len(c0):
        tb = (c0 // TS + 1) * TS
        out_r.append(rows); out_a.append(c0); out_b.append(np.minimum(c1, tb))
        m = c1 > tb
        rows, c0, c1 = rows[m], tb[m], c1[m]
    rows = np.concatenate(out_r); c0 = np.concatenate(out_a); c1 = np.concatenate(out_b)
    m = c1 > c0
    rows, c0, c1 = rows[m], c0[m], c1[m]
    ty = rows // TS; tx = c0 // TS
    key = tx * 100000 + ty
    order = np.argsort(key, kind='stable')
    key, rows, c0, c1, tx, ty = key[order], rows[order], c0[order], c1[order], tx[order], ty[order]
    bounds = np.nonzero(np.diff(key))[0] + 1
    for s, e in zip(np.r_[0, bounds], np.r_[bounds, len(key)]):
        t = store.get(int(tx[s]), int(ty[s]))
        lr = rows[s:e] - ty[s] * TS
        la = c0[s:e] - tx[s] * TS
        lb = c1[s:e] - tx[s] * TS
        diff = np.zeros((TS, TS + 1), dtype=np.int32)
        np.add.at(diff, (lr, la), 1)
        np.add.at(diff, (lr, lb), -1)
        mask = np.cumsum(diff, axis=1)[:, :TS] > 0
        np.minimum(t, value, out=t, where=mask)
    if len(store.cache) > 1200:
        store.flush()

def rasterize_table(path, value, store, log=print, verify=False):
    t = Table(path)
    gf = t.geomfield()
    gname = [f['name'] for f in t.fields if f['type'] == 7][0]
    t0 = time.time(); nf = 0; npts = 0
    acc = []; nacc = 0
    for oid, r in t.rows(want={gname}):
        g = r.get(gname)
        if g is None: continue
        d = decode_polygon_np(g, gf)
        if d is None: continue
        xs, ys, counts = d
        npts += len(xs); nf += 1
        sp = spans(*edges_from_rings(xs, ys, counts))
        if sp is not None:
            acc.append(sp); nacc += len(sp[0])
        if nacc > 4_000_000:
            burn(store, *[np.concatenate(z) for z in zip(*acc)], value); acc = []; nacc = 0
    if acc:
        burn(store, *[np.concatenate(z) for z in zip(*acc)], value)
    log(f'  {os.path.basename(path)} value={value} features={nf} pts={npts} {time.time()-t0:.1f}s')
    return nf, npts
