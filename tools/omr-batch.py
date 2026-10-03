#!/usr/bin/env python3
"""Convert many OMR sets from the Hugging Face jsonl into spec files.
  uv run --with numpy tools/omr-batch.py [--max 100] [--min-parts 20] [--max-parts 200] [--words car,truck,...]
Writes ~/Projects/lego-data/specs/<set_num>.json ({"name","source","set_num","spec":{...}}). Skips sets that are slow or unreadable."""
import argparse, json, os, re, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import ldraw2spec as L

ap = argparse.ArgumentParser(); ap.add_argument('--max', type=int, default=100); ap.add_argument('--min-parts', type=int, default=20); ap.add_argument('--max-parts', type=int, default=200)
ap.add_argument('--words', default='car,truck,van,bus,racer,tractor,jeep,pickup,taxi,fire,police,ambulance,house,cottage,hut,shop,station,cabin,castle,tower,plane,airplane,jet,helicopter,boat,ship,robot,rocket,train,loco,dragon,horse,dog,cat,bird,fish,animal,shark,lion,tiger')
a = ap.parse_args()
words = [w for w in a.words.split(',') if w]
home = os.path.expanduser('~/Projects/lego-data'); lib = L.Library(); done = 0
for line in open(f'{home}/sets_lego_omr_full.jsonl'):
    r = json.loads(line); m = r['rebrickable_metadata']
    if not isinstance(m, dict) or 'name' not in m:
        continue
    n = int(m.get('num_parts') or 0); name = m['name']
    if not (a.min_parts <= n <= a.max_parts) or not any(re.search(r'\b' + w, name.lower()) for w in words):
        continue
    out = f"{home}/specs/{r['set_num']}.json"
    if os.path.exists(out):
        continue
    tmp = f"{home}/tmp/{r['set_num']}.mpd"; open(tmp, 'w').write(r['mpd_content'])
    t0 = time.time()
    try:
        cells, total, used, _ = L.convert(tmp, lib)
        if len(cells) < 20:
            continue
        spec = L.to_spec(name, cells)
    except Exception as e:
        print('skip', r['set_num'], name, type(e).__name__, str(e)[:60]); continue
    json.dump({'name': name, 'set_num': r['set_num'], 'year': m.get('year'), 'parts': n, 'source': 'LDraw OMR (CC BY 2.0)', 'spec': spec, 'shapes': len(spec['shapes'])}, open(out, 'w'))
    done += 1; print(f"{r['set_num']:12} {name[:34]:34} parts={n:4} cells={len(cells):5} shapes={len(spec['shapes']):4} {time.time()-t0:4.1f}s", flush=True)
    if done >= a.max:
        break
print('done', done)
