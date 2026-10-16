"""Convert 1024-cell work tiles into compressed 512-cell web tiles + a 50 m overview."""
import numpy as np, os, glob, zlib, json, sys
from raster import TILEDIR, TS, CELL, X0, Y0

OUT = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/site/data'
WT = 512           # web tile size (cells)
OV = 10            # overview factor -> 50 m
os.makedirs(OUT + '/t', exist_ok=True); os.makedirs(OUT + '/o', exist_ok=True)

index = {}         # "tx_ty" -> uniform value (only for uniform, non-empty tiles)
files = 0; nbytes = 0
ov = {}            # overview blocks keyed by work tile
for f in sorted(glob.glob(TILEDIR + '/*.u8')):
    tx, ty = map(int, os.path.basename(f)[:-3].split('_'))
    a = np.fromfile(f, dtype=np.uint8).reshape(TS, TS)
    k = TS // WT
    for j in range(k):
        for i in range(k):
            sub = a[j*WT:(j+1)*WT, i*WT:(i+1)*WT]
            key = f'{tx*k+i}_{ty*k+j}'
            mn, mx = sub.min(), sub.max()
            if mn == mx:
                if mn != 255: index[key] = int(mn)
                continue
            z = zlib.compress(np.ascontiguousarray(sub).tobytes(), 9)
            open(f'{OUT}/t/{key}.bin', 'wb').write(z)
            files += 1; nbytes += len(z)
    ov[(tx, ty)] = None

# overview grid: whole bbox at 50 m, stored as 512-cell tiles
keys = list(ov)
TXmin = min(k[0] for k in keys); TXmax = max(k[0] for k in keys)
TYmin = min(k[1] for k in keys); TYmax = max(k[1] for k in keys)
H = (TYmax + 1) * TS // OV + 1; W = (TXmax + 1) * TS // OV + 1
grid = np.full((H, W), 255, dtype=np.uint8)
for (tx, ty) in ov:
    a = np.fromfile(f'{TILEDIR}/{tx}_{ty}.u8', dtype=np.uint8).reshape(TS, TS)
    g0y = ty * TS; g0x = tx * TS
    # overview cell b has centre at global 5 m cell 10*b+5
    by0 = -(-(g0y - 5) // OV); bx0 = -(-(g0x - 5) // OV)
    ys = np.arange(by0 * OV + 5, g0y + TS, OV) - g0y
    xs = np.arange(bx0 * OV + 5, g0x + TS, OV) - g0x
    grid[by0:by0+len(ys), bx0:bx0+len(xs)] = a[np.ix_(ys, xs)]
ovfiles = 0
for j in range(0, H, WT):
    for i in range(0, W, WT):
        sub = np.full((WT, WT), 255, dtype=np.uint8)
        s = grid[j:j+WT, i:i+WT]; sub[:s.shape[0], :s.shape[1]] = s
        if sub.min() == 255: continue
        open(f'{OUT}/o/{i//WT}_{j//WT}.bin', 'wb').write(zlib.compress(sub.tobytes(), 9)); ovfiles += 1

tiles=sorted(os.path.basename(p)[:-4] for p in glob.glob(OUT+'/t/*.bin'))
ovt=sorted(os.path.basename(p)[:-4] for p in glob.glob(OUT+'/o/*.bin'))
meta = dict(x0=X0, y0=Y0, cell=CELL, tile=WT, ovcell=CELL*OV, uniform=index, tiles=tiles, ovTiles=ovt,
            note='uint8 cells: 1-50 = coast flooded at +n*0.1 m; 101-120 = Vänern class n; 255 = not mapped/not flooded')
json.dump(meta, open(OUT + '/meta.json', 'w'), separators=(',', ':'))
print(f'detail files {files} ({nbytes/1e6:.1f} MB), uniform {len(index)}, overview files {ovfiles}')
