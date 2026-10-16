"""Bundle per-tile .bin files into a few pack files (<19 MB) addressed by byte ranges."""
import os, glob, json
D = '/home/claude/site/data'
meta = json.load(open(D + '/meta.json'))
LIM = 19_000_000
packs = []; idx = {'t': {}, 'o': {}}
cur = None; size = 0; pn = -1
def newpack():
    global cur, size, pn
    if cur: cur.close()
    pn += 1; cur = open(f'{D}/pack{pn:02d}.bin', 'wb'); size = 0
newpack()
for kind in ('o', 't'):
    for f in sorted(glob.glob(f'{D}/{kind}/*.bin')):
        b = open(f, 'rb').read()
        if size + len(b) > LIM: newpack()
        idx[kind][os.path.basename(f)[:-4]] = [pn, size, len(b)]
        cur.write(b); size += len(b)
cur.close()
meta.pop('tiles', None); meta.pop('ovTiles', None)
meta['packs'] = [f'pack{i:02d}.bin' for i in range(pn + 1)]
meta['index'] = idx
json.dump(meta, open(D + '/meta.json', 'w'), separators=(',', ':'))
print(pn + 1, 'packs', os.path.getsize(D + '/meta.json'))
