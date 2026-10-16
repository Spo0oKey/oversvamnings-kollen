import json, os, time, traceback
from raster import *
jobs=json.load(open('/home/claude/work/jobs.json'))
DONE='/home/claude/work/done.txt'
done=set(open(DONE).read().split()) if os.path.exists(DONE) else set()
U='/mnt/user-data/uploads/GIS_FLOOD_APP/'
store=TileStore()
while True:
    progressed=False
    for j in jobs:
        if j['name'] in done: continue
        p=U+j['rel']+'.gdbtable'; x=U+j['rel']+'.gdbtablx'
        if os.path.exists(p) and os.path.exists(x) and os.path.getsize(p)==j['size'] and os.path.getsize(x)==j['xsize']:
            try:
                rasterize_table(p, j['value'], store, log=lambda m: print(j['name'], m, flush=True))
                store.flush()
                done.add(j['name']); open(DONE,'a').write(j['name']+'\n')
                print('DONE', j['name'], len(done), '/', len(jobs), flush=True)
            except Exception as e:
                traceback.print_exc(); print('FAIL', j['name'], flush=True); done.add(j['name'])
            progressed=True
    if len(done)==len(jobs): print('ALL DONE'); break
    if not progressed: time.sleep(10)
