#!/usr/bin/env python3
"""Pull EVERY distinct real part out of the LEGO model files and keep its true shape, once, for reuse.

  uv run --with numpy tools/build-atlas.py [--folder DIR] [--dataset FILE] [--min-uses N] [--out DIR]

Reads the .ldr/.mpd files in --folder (your own files) and, if given, the Hugging Face OMR jsonl. Every part that a model actually uses is
exported with its real LDraw geometry (studs left out; the viewer adds them) to <out>/parts/<id>.bin (Int16 studs*100, x/y/z per vertex, y up),
and described in <out>/index.json: id, name, size, how often it is used, and in which models. Nothing is picked by hand.
LDraw parts library: CC BY 4.0. OMR models: CC BY 2.0 (credit each author; this tool records the author line of each model file).
"""
import argparse, collections, csv, glob, json, os, re, sys, time
import numpy as np
sys.path.insert(0, os.path.dirname(__file__))
import ldraw2spec as L

HOME = os.path.expanduser('~/Projects/lego-data')

def part_refs(text):
    """(part id, uses) for every real part a model file uses (sub-models defined inside the file are expanded, not counted)."""
    defined = {m.group(1).strip().lower().replace('\\', '/') for m in re.finditer(r'^0 FILE (.+)$', text, re.M)}
    c = collections.Counter()
    for line in text.splitlines():
        t = line.split()
        if len(t) >= 15 and t[0] == '1':
            ref = ' '.join(t[14:]).lower().replace('\\', '/')
            if ref in defined or not ref.endswith('.dat') or ref.startswith(('s/', '48/')):
                continue
            c[ref[:-4]] += 1
    return c

def base_id(pid):
    """Printed/decorated variants (3001pr0001) and alternative moulds share the base shape."""
    return re.sub(r'(pr\d+|p[0-9a-z]{2,4})$', '', pid) if re.search(r'\d(pr\d+|p[0-9a-z]{2,4})$', pid) else pid

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--folder', default=os.path.expanduser('~/Library/CloudStorage/GoogleDrive-anthony@aguidry.tech/.shortcut-targets-by-id/1kyJnlNjeKysaOTCvZW_a5Nxp0cd-NCez/Projects/BrickForge/Lego Data'))
    ap.add_argument('--dataset', default=f'{HOME}/sets_lego_omr_full.jsonl'); ap.add_argument('--min-uses', type=int, default=1); ap.add_argument('--out', default=f'{HOME}/atlas')
    a = ap.parse_args()
    names = {r['part_num'].lower(): r['name'] for r in csv.DictReader(open(f'{HOME}/parts.csv', encoding='utf-8'))}
    uses, models, authors = collections.Counter(), collections.defaultdict(set), {}
    encrypted = []
    files = sorted(glob.glob(os.path.join(a.folder, '*.mpd')) + glob.glob(os.path.join(a.folder, '*.ldr')) + glob.glob(os.path.join(a.folder, '*.io')))
    for f in files:
        if f.endswith('.io'):          # a BrickLink Studio file is a zip holding the model as LDraw text
            import zipfile
            z = zipfile.ZipFile(f); inner = next((n for n in ('model2.ldr', 'model.ldr') if n in z.namelist()), None)
            if not inner: continue
            try: txt = z.read(inner).decode('utf-8', errors='replace')
            except RuntimeError: encrypted.append(os.path.basename(f)); continue      # password-protected Studio file: left alone
        else:
            txt = open(f, encoding='utf-8', errors='replace').read()
        name = os.path.basename(f)
        am = re.search(r'^0 Author:\s*(.+)$', txt, re.M); authors[name] = am.group(1).strip() if am else ''
        for p, n in part_refs(txt).items(): uses[base_id(p)] += n; models[base_id(p)].add(name)
    folder_parts = set(uses)
    nds = 0
    if a.dataset and os.path.exists(a.dataset):
        for line in open(a.dataset):
            r = json.loads(line); nds += 1
            for p, n in part_refs(r['mpd_content']).items(): uses[base_id(p)] += n; models[base_id(p)].add(r['set_num'])
    lib = L.Library(); os.makedirs(f'{a.out}/parts', exist_ok=True)
    index, skipped = {}, collections.Counter()
    t0 = time.time()
    for pid, n in uses.most_common():
        if n < a.min_uses: break
        path = lib.find(pid + '.dat')
        if not path or '/parts/' not in path or '/parts/s/' in path:        # primitives and sub-parts are pieces of parts, not parts
            skipped['library primitive or sub-part'] += 1; continue
        tris = lib.mesh(pid + '.dat')
        if not len(tris): skipped['not in library or no surfaces'] += 1; continue
        lo, hi = tris.reshape(-1, 3).min(0), tris.reshape(-1, 3).max(0)
        t = tris * np.array([1.0, -1.0, -1.0]) / 20.0
        open(f'{a.out}/parts/{pid}.bin', 'wb').write(np.round(t.reshape(-1) * 100).astype('<i2').tobytes())
        nm = names.get(pid) or names.get(re.sub(r'[a-z]$', '', pid)) or ''
        index[pid] = dict(name=nm, tris=len(tris), bbox_ldu=[[round(float(x)) for x in lo], [round(float(x)) for x in hi]], uses=n, models=len(models[pid]), in_your_folder=pid in folder_parts)
    json.dump(dict(generated=time.strftime('%Y-%m-%d'), source='LDraw parts library (CC BY 4.0); models from the LDraw OMR (CC BY 2.0)', parts=index, authors=authors), open(f'{a.out}/index.json', 'w'))
    size = sum(os.path.getsize(f'{a.out}/parts/{p}.bin') for p in index)
    print(json.dumps(dict(models_in_folder=len(files) - len(encrypted), protected_files_skipped=encrypted, models_in_dataset=nds, distinct_parts_used=len(uses), exported=len(index), in_your_folder=sum(1 for v in index.values() if v['in_your_folder']),
                          skipped=dict(skipped), mb=round(size / 1e6, 1), secs=round(time.time() - t0), out=a.out)))

if __name__ == '__main__':
    main()
