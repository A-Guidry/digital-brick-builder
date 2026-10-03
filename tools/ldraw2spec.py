#!/usr/bin/env python3
"""Turn a real LEGO model (LDraw .ldr/.mpd) into our shape spec, using the REAL geometry of every part.

  uv run --with numpy tools/ldraw2spec.py MODEL.mpd [--out spec.json] [--json] [--lib DIR]

Every part is read from the official LDraw parts library (studs removed), then sampled on our grid (1 stud x 1 plate):
a column of a part is solid from its lowest surface to its highest. Slopes, wheels, tyres, arches and minifigure
parts therefore keep their real outline, at the resolution our models use. Output is boxes of one colour, merged
greedily, in the same shape format the AI writes.

The LDraw library is CC BY 4.0 (https://www.ldraw.org). Models from the Official Model Repository are CC BY 2.0.
"""
import argparse, json, math, os, re, sys
from collections import defaultdict
import numpy as np

LIB = os.path.expanduser('~/Projects/lego-data/ldraw/ldraw')
STUD, PLATE = 20.0, 8.0            # LDU per stud (across) and per plate (up)
STUD_PRIM = re.compile(r'^(stud|stug)[0-9a-z]*\.dat$')
OUR = {'white': 'f2f3f2', 'black': '1b2a34', 'red': 'c91a09', 'dark_red': '720e0f', 'blue': '0055bf', 'dark_blue': '0a3463', 'medium_azure': '36aebf', 'yellow': 'f2cd37', 'orange': 'fe8a18',
       'green': '237841', 'dark_green': '184632', 'lime': 'bbe90b', 'tan': 'e4cd9e', 'dark_tan': '958a73', 'reddish_brown': '582a12', 'nougat': 'cc702a', 'light_nougat': 'f6d7b3',
       'light_gray': 'a0a5a9', 'dark_gray': '6c6e68', 'bright_pink': 'e4adc8', 'purple': '3f2a6d'}
_rgb = lambda h: tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def load_colours(lib):
    table = {}
    for line in open(os.path.join(lib, 'LDConfig.ldr'), errors='replace'):
        m = re.search(r'!COLOUR\s+\S+\s+CODE\s+(\d+)\s+VALUE\s+#([0-9A-Fa-f]{6})', line)
        if m:
            table[int(m.group(1))] = m.group(2)
    return table


def nearest(hexv):
    c = _rgb(hexv)
    return min(OUR, key=lambda k: sum((a - b) ** 2 for a, b in zip(c, _rgb(OUR[k]))))


class Library:
    def __init__(self, lib=LIB):
        self.lib, self.cache, self.colours, self.missing = lib, {}, load_colours(lib), set()

    def colour(self, code, parent):
        c = parent if code in (16, 24) else code
        return nearest(self.colours.get(c, '9BA19D'))

    def find(self, name):
        n = name.replace('\\', '/').lower()
        for d in ('parts', 'p', 'parts/s', 'models'):
            f = os.path.join(self.lib, d, n)
            if os.path.isfile(f):
                return f
        return None

    def mesh(self, name, depth=0):
        """Triangles (N,3,3) of a library file in its own frame, studs removed."""
        if name in self.cache:
            return self.cache[name]
        path = self.find(name); out = []
        if not path or depth > 16:
            self.missing.add(name); self.cache[name] = np.zeros((0, 3, 3)); return self.cache[name]
        for line in open(path, errors='replace'):
            p = line.split()
            if not p:
                continue
            if p[0] == '1' and len(p) >= 15:
                ref = ' '.join(p[14:]).lower().replace('\\', '/')
                if STUD_PRIM.match(os.path.basename(ref)):
                    continue
                sub = self.mesh(ref, depth + 1)
                if len(sub):
                    a = np.array(p[5:14], float).reshape(3, 3); t = np.array(p[2:5], float)
                    out.append(sub @ a.T + t)
            elif p[0] == '3' and len(p) >= 11:
                out.append(np.array(p[2:11], float).reshape(1, 3, 3))
            elif p[0] == '4' and len(p) >= 14:
                q = np.array(p[2:14], float).reshape(4, 3); out.append(np.stack([q[[0, 1, 2]], q[[0, 2, 3]]]))
        self.cache[name] = np.concatenate(out) if out else np.zeros((0, 3, 3))
        return self.cache[name]


def parse_model(path):
    files, cur, order = {}, None, []
    for line in open(path, encoding='utf-8', errors='replace'):
        t = line.strip()
        if t.startswith('0 FILE '):
            cur = t[7:].strip().lower().replace('\\', '/'); files[cur] = []; order.append(cur)
        elif t:
            if cur is None:
                cur = '__main__'; files[cur] = []; order.append(cur)
            files[cur].append(t)
    return files, order[0]


def flatten(files, name, col, m, off, out, lib, depth=0):
    for t in files[name]:
        p = t.split()
        if p[0] != '1' or len(p) < 15:
            continue
        c = lib.colour(int(p[1]), col)
        a = np.array(p[5:14], float).reshape(3, 3); pos = np.array(p[2:5], float)
        mm, pp = m @ a, off + m @ pos
        ref = ' '.join(p[14:]).lower().replace('\\', '/')
        if ref in files and depth < 12:
            flatten(files, ref, c, mm, pp, out, lib, depth + 1)
        else:
            out.append((c, mm, pp, ref))


def sample(tris, cells, colour, res=1):
    """Mark every grid cell whose centre column passes through this part, from its lowest to its highest surface.
    World frame: LDraw (x, y down, z) -> ours (x, -y, -z), so the front of a model faces +z."""
    if not len(tris):
        return 0
    S, P = STUD / res, PLATE / res          # finer cells = a bigger, more detailed model
    t = tris * np.array([1.0, -1.0, -1.0])
    lo, hi = t.reshape(-1, 3).min(0), t.reshape(-1, 3).max(0)
    xs = np.arange(math.floor(lo[0] / S), math.ceil(hi[0] / S))
    zs = np.arange(math.floor(lo[2] / S), math.ceil(hi[2] / S))
    if not len(xs) or not len(zs):
        return 0
    gx, gz = np.meshgrid(xs, zs, indexing='ij'); gx, gz = gx.ravel(), gz.ravel()
    px, pz = (gx + 0.5) * S + 0.013, (gz + 0.5) * S + 0.007          # nudge off exact edges
    a, b, c = t[:, 0], t[:, 1], t[:, 2]
    d = (b[:, 2] - c[:, 2]) * (a[:, 0] - c[:, 0]) + (c[:, 0] - b[:, 0]) * (a[:, 2] - c[:, 2])
    ok = np.abs(d) > 1e-9
    a, b, c, d = a[ok], b[ok], c[ok], d[ok]
    if not len(a):
        return 0
    X, Z = px[:, None], pz[:, None]
    l1 = ((b[:, 2] - c[:, 2]) * (X - c[:, 0]) + (c[:, 0] - b[:, 0]) * (Z - c[:, 2])) / d
    l2 = ((c[:, 2] - a[:, 2]) * (X - c[:, 0]) + (a[:, 0] - c[:, 0]) * (Z - c[:, 2])) / d
    l3 = 1 - l1 - l2
    hit = (l1 >= 0) & (l2 >= 0) & (l3 >= 0)
    y = l1 * a[:, 1] + l2 * b[:, 1] + l3 * c[:, 1]
    n = 0
    for i in np.nonzero(hit.any(1))[0]:
        ys = y[i][hit[i]]
        for k in range(math.ceil(ys.min() / P - 0.5), math.floor(ys.max() / P - 0.5) + 1):
            cells[(int(gx[i]), k, int(gz[i]))] = colour; n += 1
    return n


def boxes(cells):
    """Greedy maximal single-colour boxes."""
    left, out = dict(cells), []
    while left:
        k0 = min(left, key=lambda k: (k[1], k[2], k[0])); col = left[k0]
        x, y, z = k0; sx = sy = sz = 1
        grow = True
        while grow:
            grow = False
            for ax in (0, 2, 1):
                size = [sx, sy, sz]; size[ax] += 1
                if all(left.get((x + i, y + j, z + k)) == col for i in range(size[0]) for j in range(size[1]) for k in range(size[2])):
                    sx, sy, sz = size; grow = True
        for i in range(sx):
            for j in range(sy):
                for k in range(sz):
                    del left[(x + i, y + j, z + k)]
        out.append((col, x, y, z, sx, sy, sz))
    return out


def to_spec(name, cells):
    xs = [k[0] for k in cells]; ys = [k[1] for k in cells]; zs = [k[2] for k in cells]
    mx, mz, my = (min(xs) + max(xs) + 1) // 2, (min(zs) + max(zs) + 1) // 2, min(ys)
    shapes = []
    for col, x, y, z, sx, sy, sz in boxes(cells):
        shapes.append({'type': 'box', 'color': col, 'center': [round(x + sx / 2 - mx, 2), round((y + sy / 2 - my) * 0.4, 2), round(z + sz / 2 - mz, 2)], 'size': [sx, round(sy * 0.4, 2), sz]})
    return {'name': name, 'shapes': shapes}


def convert(path, lib=None, res=1):
    lib = lib or Library()
    files, main = parse_model(path); inst = []
    flatten(files, main, 71, np.eye(3), np.zeros(3), inst, lib)
    cells, used = {}, 0
    for col, m, pos, ref in inst:
        base = ref
        tris = lib.mesh(base)
        if not len(tris):
            continue
        used += 1
        sample(tris @ m.T + pos, cells, col, res)
    return cells, len(inst), used, lib


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('model'); ap.add_argument('--out'); ap.add_argument('--json', action='store_true'); ap.add_argument('--max-shapes', type=int, default=80); ap.add_argument('--res', type=int, default=1, help='cells per original stud; 2 = a model twice as big in each direction')
    a = ap.parse_args()
    cells, total, used, lib = convert(a.model, res=a.res)
    if not cells:
        print(json.dumps({'ok': False, 'error': 'nothing readable'}) if a.json else 'nothing readable'); sys.exit(2)
    spec = to_spec(re.sub(r'\.\w+$', '', os.path.basename(a.model)), cells)
    info = {'ok': True, 'parts_total': total, 'parts_read': used, 'cells': len(cells), 'shapes': len(spec['shapes']), 'fits_shape_limit': len(spec['shapes']) <= a.max_shapes,
            'missing_library_files': sorted(lib.missing)[:6]}
    if a.out:
        json.dump(spec, open(a.out, 'w'))
    print(json.dumps(info) if a.json else info)


if __name__ == '__main__':
    main()
