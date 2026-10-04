#!/usr/bin/env python3
"""Build src/specials.json from tools/units.json: real shapes, real offsets, mined from the models.

  uv run --with numpy tools/build-units.py [--dataset FILE]

For every unit: the anchor part's footprint comes from its real geometry; each companion's position and turn relative to the anchor is the MOST COMMON
arrangement found in the OMR models (so a new unit is one line in units.json). Output frame: x right, y up, z toward the viewer, studs*100 as Int16 (base64),
origin = centre of the footprint at the TOP of the anchor. LDraw parts library CC BY 4.0, OMR models CC BY 2.0.
"""
import argparse, base64, collections, json, os, re, sys
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import ldraw2spec as L

HOME = os.path.expanduser('~/Projects/lego-data')
FRAME = np.array([1.0, -1.0, -1.0])

def enc(t): return base64.b64encode(np.round(t.reshape(-1) * 100).astype('<i2').tobytes()).decode()

def mine(units, dataset, lib):
    """most common (offset, turn) of each companion relative to its anchor, over all models"""
    want = {u['anchor']: u for u in units.values() if u.get('companions')}
    found = collections.defaultdict(collections.Counter)
    tmp = '/tmp/build-units.mpd'
    for line in open(dataset):
        r = json.loads(line); c = r['mpd_content']
        if not any(re.search(r'\b' + a + r'\.dat\s*$', c, re.M) for a in want): continue
        open(tmp, 'w').write(c); files, main = L.parse_model(tmp); inst = []
        try: L.flatten(files, main, 71, np.eye(3), np.zeros(3), inst, lib)
        except Exception: continue
        items = [(ref[:-4], m, pos) for col, m, pos, ref in inst]
        for aid, am, ap in [i for i in items if i[0] in want]:
            ids = {c['id'] for c in want[aid]['companions']}
            for pid, m, pos in items:
                if pid in ids and np.linalg.norm(pos - ap) < 80:
                    rel = np.linalg.inv(am) @ (pos - ap); rm = np.linalg.inv(am) @ m
                    found[(aid, pid)][(tuple(np.round(rel).astype(int)), tuple(np.round(rm).astype(int).flatten()))] += 1
    return found

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--dataset', default=f'{HOME}/sets_lego_omr_full.jsonl'); a = ap.parse_args()
    units = {k: v for k, v in json.load(open(os.path.join(os.path.dirname(__file__), 'units.json'))).items() if not k.startswith('_')}
    lib = L.Library(); found = mine(units, a.dataset, lib); out = {}
    for name, u in units.items():
        anchor = lib.mesh(u['anchor'] + '.dat'); assert len(anchor), f"{u['anchor']} not in the LDraw library"
        lo, hi = anchor.reshape(-1, 3).min(0), anchor.reshape(-1, 3).max(0)
        fp = u.get('footprint') or [max(1, round((hi[0] - lo[0]) / 20)), max(1, round((hi[2] - lo[2]) / 20)), max(1, round((hi[1] - lo[1]) / 8))]
        cx, cz = (0.0, 0.0) if u.get('footprint') else ((lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2)          # recentre so the footprint centre is the origin
        # origin = top of the anchor. Bricks, plates and windows already hang down from it; trees and bushes are modelled standing UP from it, so lift them down by their own height.
        shift = np.array([cx, float(lo[1]) if abs(lo[1]) > 6 else 0.0, cz])
        parts = [dict(tag='body', bl=u['bl'], name=lib_name(u['anchor']), colour=None if u['body'] == 'placed' else u['body'], tris=enc((anchor - shift) * FRAME / 20.0), n=len(anchor))]
        mined = {}
        for c in u.get('companions', []):
            best = found.get((u['anchor'], c['id']))
            if not best: raise SystemExit(f"no model uses {c['id']} next to {u['anchor']}: cannot mine it")
            (rel, rm), n = best.most_common(1)[0]; mined[c['id']] = dict(offset=list(map(int, rel)), turn=list(map(int, rm)), seen=n)
            tris = lib.mesh(c['id'] + '.dat'); assert len(tris), c['id']
            moved = tris @ np.array(rm, float).reshape(3, 3).T + np.array(rel, float)
            parts.append(dict(tag='extra', bl=c['bl'], name=lib_name(c['id']), colour=c['colour'], accentDefault=c.get('accentDefault'), tris=enc((moved - shift) * FRAME / 20.0), n=len(tris)))
        out[name] = dict(cls=u['class'], footprint=fp, baseFacing=u['baseFacing'], anchorY=u.get('anchorY', 'center'), studs=u.get('studs', True), overhang=u.get('overhang', False), bodyDefault=u.get('bodyDefault'), bl=u['bl'],
                         bboxStuds=[round(float(x) / 20, 2) for x in (hi[0] - lo[0], (hi[1] - lo[1]) / 2.5, hi[2] - lo[2])], mined=mined, parts=parts)
    dest = os.path.join(os.path.dirname(__file__), '..', 'src', 'specials.json')
    json.dump(out, open(dest, 'w'), separators=(',', ':'))
    for k, v in out.items(): print(f"{k:12} footprint {v['footprint']}  parts {[p['n'] for p in v['parts']]}  mined {[(i, m['offset'], m['seen']) for i, m in v['mined'].items()]}")
    print('wrote', os.path.relpath(dest), os.path.getsize(dest) // 1024, 'KB')

_names = None
def lib_name(pid):
    global _names
    if _names is None:
        import csv
        _names = {r['part_num'].lower(): r['name'] for r in csv.DictReader(open(f'{HOME}/parts.csv', encoding='utf-8'))}
    return _names.get(pid) or _names.get(pid + 'b') or _names.get(pid + 'a') or _names.get(re.sub(r'[a-z]$', '', pid)) or pid

if __name__ == '__main__':
    main()
