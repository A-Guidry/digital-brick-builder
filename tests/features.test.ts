import { describe, it, expect } from 'vitest';
import { FEATURE_KINDS, expandFeatures, featureCatalogText, Feature, MAX_FEATURES } from '../src/features';
import { parseSpec, ShapeSpec, specBounds, expand } from '../src/shapes';
import { voxelize } from '../src/compiler';
import { buildWithRepair } from '../src/repair';
import { resolveColor } from '../src/catalog';

// A solid host to hang parts on: 16 wide (x -8..8), 12 deep (z -6..6), 12 tall.
const host = (over: Partial<ShapeSpec> = {}): ShapeSpec => ({ name: 'host', shapes: [{ type: 'box', op: 'add', color: 'tan', center: [0, 6, 0], size: [16, 12, 12] }], ...over });
const filled = (s: ShapeSpec) => { const g = voxelize(s); let n = 0; for (const c of g.cells) if (c) n++; return { g, n }; };
// Absolute cell coordinates, so two specs whose grids start in different places can still be compared.
const cellsAbs = (s: ShapeSpec) => { const g = voxelize(s), out = new Set<string>(); for (let y = 0; y < g.ny; y++) for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) if (g.cells[(y * g.nz + z) * g.nx + x]) out.add(`${g.origin[0] + x}|${(g.origin[1] + y / 2.5).toFixed(2)}|${g.origin[2] + z}`); return out; };
const diff = (a: ShapeSpec, b: ShapeSpec) => { const A = voxelize(a), B = voxelize(b); if (A.cells.length !== B.cells.length) return -1; let d = 0; for (let i = 0; i < A.cells.length; i++) if (A.palette[A.cells[i]] !== B.palette[B.cells[i]]) d++; return d; };

const UNIT_KINDS = ['wheel', 'window', 'windshield', 'door', 'slope'];                 // real parts: tested in wheels.test.ts and units.test.ts
const PAINT_KINDS = ['headlight', 'taillight', 'porthole', 'eye', 'spot', 'hoof'];
const ADD_KINDS = FEATURE_KINDS.filter(k => !PAINT_KINDS.includes(k) && !UNIT_KINDS.includes(k));

describe('parts catalog: every kind builds sane shapes', () => {
  it('the catalog has the parts people ask for', () => {
    for (const k of ['wheel', 'window', 'door', 'eye', 'headlight', 'windshield', 'roof', 'tower', 'wing', 'horn', 'ear', 'antenna']) expect(FEATURE_KINDS).toContain(k);
  });
  for (const kind of FEATURE_KINDS.filter(k => !UNIT_KINDS.includes(k))) {
    it(`${kind}: defaults give finite numbers and real colours`, () => {
      const shapes = expandFeatures([{ kind, at: [1, 2, 3] }]);
      expect(shapes.length).toBeGreaterThan(0);
      for (const s of shapes) {
        for (const v of [...s.center, ...(s.size ?? []), s.radius ?? 0, s.length ?? 0]) expect(Number.isFinite(v)).toBe(true);
        if (s.op !== 'subtract') expect(resolveColor(s.color!)).toBeTruthy();
        if (s.size) expect(s.size.every(n => n > 0)).toBe(true);
        if (s.radius !== undefined) expect(s.radius).toBeGreaterThan(0);
        if (s.length !== undefined) expect(s.length).toBeGreaterThan(0);
      }
    });
    it(`${kind}: tiny, huge and odd sizes never produce NaN or non-positive dimensions`, () => {
      for (const size of [0.01, 0.5, 1, 1.01, 7.3, 40, [0.01, 0.01], [40, 40], [3, 1, 9]] as Feature['size'][]) {
        for (const s of expandFeatures([{ kind, at: [0.3, 0.1, -2.7], size }])) {
          for (const v of [...s.center, ...(s.size ?? []), s.radius ?? 1, s.length ?? 1]) expect(Number.isFinite(v)).toBe(true);
          if (s.size) expect(s.size.every(n => n > 0)).toBe(true);
          if (s.radius !== undefined) expect(s.radius).toBeGreaterThan(0);
          if (s.length !== undefined) expect(s.length).toBeGreaterThan(0);
        }
      }
    });
  }
});

describe('parts catalog: painted parts really show up, wherever the AI puts the decimals', () => {
  // The grid samples at cell centres, so a naive paint box of the right size can land between cells and paint nothing.
  const faces: { facing: '+x' | '-x' | '+z' | '-z'; at: (f: number, v: number) => [number, number, number] }[] = [
    { facing: '+z', at: (f, v) => [f, v, 6] }, { facing: '-z', at: (f, v) => [f, v, -6] },
    { facing: '+x', at: (f, v) => [8, v, f] }, { facing: '-x', at: (f, v) => [-8, v, f] },
  ];
  for (const kind of PAINT_KINDS.filter(k => k !== 'hoof')) {
    it(`${kind}: changes visible colours on all four walls for any fractional placement`, () => {
      const base = host();
      for (const face of faces) for (const f of [0, 0.25, 0.5, 0.75, -1.3, 2.6]) for (const dv of [0, 0.17, 0.5]) {
        // the wall may also sit a fraction off from where the AI thinks it is
        for (const off of [0, 0.3, -0.45]) {
          const at = face.at(f, 7 + dv); if (face.facing === '+z') at[2] += off; if (face.facing === '-z') at[2] -= off; if (face.facing === '+x') at[0] += off; if (face.facing === '-x') at[0] -= off;
          const d = diff(base, { ...base, features: [{ kind, at, facing: face.facing, size: kind === 'door' ? undefined : undefined }] });
          expect(d, `${kind} ${face.facing} f=${f} dv=${dv} off=${off}`).toBeGreaterThan(0);
        }
      }
    });
    it(`${kind}: paints only, never adds or removes material`, () => {
      const base = host(); const before = filled(base).n;
      for (const facing of ['+x', '-x', '+z', '-z'] as const) {
        const spec = { ...base, features: [{ kind, at: [0, 7, 6] as [number, number, number], facing }] };
        expect(filled(spec).n).toBe(before);
      }
    });
  }
  it('hoof recolours the bottom of a leg', () => {
    const leg: ShapeSpec = { name: 'leg', shapes: [{ type: 'box', op: 'add', color: 'white', center: [0.5, 3, 0.5], size: [2, 6, 2] }], features: [{ kind: 'hoof', at: [0.5, 0, 0.5], size: 2 }] };
    const g = voxelize(leg); const names = new Set<string>(); for (let y = 0; y < 2; y++) names.add(g.palette[g.cells[(y * g.nz + 0) * g.nx + 0]]);
    expect(names.has('dark_gray')).toBe(true);
  });
});

describe('parts catalog: added parts add material and join the model', () => {
  const placements: Record<string, { host: ShapeSpec; feat: Feature }> = {
    ear: { host: host(), feat: { kind: 'ear', at: [3, 12, 0] } },
    horn: { host: host(), feat: { kind: 'horn', at: [0, 12, 0], size: 4 } },
    antenna: { host: host(), feat: { kind: 'antenna', at: [0, 12, 0], size: 4 } },
    wing: { host: host(), feat: { kind: 'wing', at: [8, 3, 0], facing: '+x', size: 6 } },
    fin: { host: host(), feat: { kind: 'fin', at: [8, 0, 0], facing: '+x', size: 5 } },
    tower: { host: host(), feat: { kind: 'tower', at: [0, 12, 0], size: 4 } },
    roof: { host: host(), feat: { kind: 'roof', at: [0, 12, 0], size: [16, 5, 12] } },
    chimney: { host: host(), feat: { kind: 'chimney', at: [4, 12, 0], size: 3 } },
    battlement: { host: host(), feat: { kind: 'battlement', at: [0, 12, 5.5], size: 12, facing: '+z' } },
    tree: { host: { name: 'ground', shapes: [{ type: 'box', op: 'add', color: 'green', center: [0, 0.5, 0], size: [10, 1, 10] }] }, feat: { kind: 'tree', at: [0, 1, 0], size: 8 } },
    flag: { host: host(), feat: { kind: 'flag', at: [0, 12, 0], size: 6, facing: '+x' } },
    bumper: { host: { name: 'car', shapes: [{ type: 'box', op: 'add', color: 'red', center: [0, 3, 0], size: [8, 3, 14] }] }, feat: { kind: 'bumper', at: [0, 1.5, 7], facing: '+z', size: 6 } },
  };
  const noAi = async () => { throw new Error('the AI must not be needed to make a part join the model'); };
  const solid = async (spec: ShapeSpec) => buildWithRepair({ rawText: JSON.stringify(spec) }, noAi, { maxRounds: 1 });
  for (const kind of ADD_KINDS) {
    it(`${kind}: adds new material and builds into one valid connected model with no AI help`, async () => {
      const p = placements[kind]; expect(p, `a placement for ${kind}`).toBeTruthy();
      const withF: ShapeSpec = { ...p.host, features: [p.feat] };
      const hostCells = cellsAbs(p.host); let added = 0; for (const c of cellsAbs(withF)) if (!hostCells.has(c)) added++;
      expect(added, `${kind} cells added`).toBeGreaterThan(0);
      const r = await solid(withF);
      expect(r.ok, `${kind}: ${r.message}`).toBe(true);
      expect(r.report?.stats.components).toBe(1);
    });
  }
  it('the host alone builds the same way (so a failure above is the part, not the host)', async () => {
    for (const h of [host(), placements.tree.host]) expect((await solid(h)).ok).toBe(true);
  });
  it('every added kind has a placement in this test (nothing in the catalog goes untested)', () => {
    expect(Object.keys(placements).sort()).toEqual([...ADD_KINDS].sort());
  });
  it('a roof really is higher in the middle than at the eaves', () => {
    const spec: ShapeSpec = { ...host(), features: [{ kind: 'roof', at: [0, 12, 0], size: [16, 5, 12] }] };
    const g = voxelize(spec); const top = (x: number, z: number) => { for (let y = g.ny - 1; y >= 0; y--) if (g.cells[(y * g.nz + z) * g.nx + x]) return y; return -1; };
    expect(top(Math.floor(g.nx / 2), 6)).toBeGreaterThan(top(0, 6) + 3);
    const turned: ShapeSpec = { ...host(), features: [{ kind: 'roof', at: [0, 12, 0], size: [16, 5, 12], facing: '+x' }] };
    const t = voxelize(turned); const top2 = (x: number, z: number) => { for (let y = t.ny - 1; y >= 0; y--) if (t.cells[(y * t.nz + z) * t.nx + x]) return y; return -1; };
    expect(top2(8, Math.floor(t.nz / 2))).toBeGreaterThan(top2(8, 0) + 3);
  });
  it('a window painted on a tower works even when it is listed before the tower', () => {
    const spec: ShapeSpec = { name: 't', shapes: [{ type: 'box', op: 'add', color: 'tan', center: [0, 0.5, 0], size: [8, 1, 8] }], features: [{ kind: 'window', at: [0, 5, 2], size: 2 }, { kind: 'tower', at: [0, 1, 0], size: 4 }] };
    const g = voxelize(spec); expect([...g.cells].some(c => c && g.palette[c] === 'medium_azure')).toBe(true);
  });
});

describe('parts catalog: one-stud pieces are exactly one stud wherever the decimals fall', () => {
  // A 1-stud-wide box straddling two cell centres comes out 2 studs wide, or 0 wide; snapping to a cell centre is what prevents it.
  const topLayer = (kind: string, at: [number, number, number], extra: Partial<Feature> = {}) => {
    const shapes = expandFeatures([{ kind, at, size: 6, ...extra }]);
    const g = voxelize({ name: 't', shapes: shapes as any }); let n = 0;
    for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) if (g.cells[((g.ny - 1) * g.nz + z) * g.nx + x]) n++;
    return n;
  };
  for (const kind of ['horn', 'flag']) it(`${kind}: the thin pole/column is one stud wide at any fractional position`, () => {
    for (const x of [0, 0.25, 0.5, 0.75, 1, -2.5, 3.01, 3.99]) for (const z of [0, 0.5, -1.25, 2])
      expect(topLayer(kind, [x, 0, z], kind === 'flag' ? { facing: '+z' } : {}), `${kind} at ${x},${z}`).toBe(kind === 'flag' ? topLayer(kind, [0.5, 0, 0.5], { facing: '+z' }) : 1);
  });
  it('battlement teeth alternate with gaps (every other stud) at any fractional position', () => {
    for (const x of [0, 0.3, 0.5, 0.9]) {
      const g = voxelize({ name: 't', shapes: expandFeatures([{ kind: 'battlement', at: [x, 0, 0.4], size: 12, facing: '+z' }]) as any });
      const row = []; for (let xx = 0; xx < g.nx; xx++) { let any = 0; for (let zz = 0; zz < g.nz; zz++) if (g.cells[zz * g.nx + xx]) any = 1; row.push(any); }
      const s2 = row.join('').replace(/^0+|0+$/g, '');
      expect(s2, `battlement at x=${x}: ${row.join('')}`).toMatch(/^1(01)+$/);
    }
  });
});

describe('parts catalog: the AI cannot break it', () => {
  const base = { name: 'x', shapes: [{ type: 'box', op: 'add', color: 'red', center: [0, 1, 0], size: [4, 2, 4] }] };
  const parse = (features: unknown) => parseSpec({ ...base, features });
  it('accepts a valid list and keeps it in the spec', () => {
    const r = parse([{ kind: 'wheel', at: [1, 1, 1], size: 3, facing: '+x', color: 'black' }]);
    expect(r.ok).toBe(true); if (r.ok) expect(r.spec.features?.[0]).toMatchObject({ kind: 'wheel', facing: '+x' });
  });
  it('rejects unknown kinds, naming the real ones', () => {
    const r = parse([{ kind: 'jetpack', at: [0, 0, 0] }]); expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/jetpack.*wheel/);
  });
  it('rejects prototype tricks as a kind', () => {
    for (const kind of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) expect(parse([{ kind, at: [0, 0, 0] }]).ok).toBe(false);
  });
  it('rejects bad positions, sizes, facings and colours with a clear message each', () => {
    const bad: unknown[] = [
      { kind: 'eye' }, { kind: 'eye', at: [1, 2] }, { kind: 'eye', at: [1, 2, 'a'] }, { kind: 'eye', at: [NaN, 0, 0] }, { kind: 'eye', at: [Infinity, 0, 0] }, { kind: 'eye', at: [1e9, 0, 0] },
      { kind: 'eye', at: [0, 0, 0], size: 0 }, { kind: 'eye', at: [0, 0, 0], size: -3 }, { kind: 'eye', at: [0, 0, 0], size: 1000 }, { kind: 'eye', at: [0, 0, 0], size: 'big' }, { kind: 'eye', at: [0, 0, 0], size: [] }, { kind: 'eye', at: [0, 0, 0], size: [1, 2, 3, 4] },
      { kind: 'eye', at: [0, 0, 0], facing: '+y' }, { kind: 'eye', at: [0, 0, 0], facing: 'up' }, { kind: 'hoof', at: [0, 0, 0], facing: '+x' },
      { kind: 'eye', at: [0, 0, 0], color: 'chartreuse' }, { kind: 'eye', at: [0, 0, 0], accent: 5 },
      null, 5, 'eye', [],
    ];
    for (const f of bad) { const r = parse([f]); expect(r.ok, JSON.stringify(f)).toBe(false); if (!r.ok) expect(r.errors.length).toBeGreaterThan(0); }
  });
  it('rejects a features value that is not a list, and too many features', () => {
    expect(parse('wheel').ok).toBe(false); expect(parse({ kind: 'wheel' }).ok).toBe(false);
    expect(parse(Array.from({ length: MAX_FEATURES + 1 }, () => ({ kind: 'eye', at: [0, 1, 2] }))).ok).toBe(false);
    expect(parse(Array.from({ length: MAX_FEATURES }, () => ({ kind: 'eye', at: [0, 1, 2] }))).ok).toBe(true);
  });
  it('still refuses the forbidden brick words, even inside a feature', () => {
    expect(parse([{ kind: 'eye', at: [0, 1, 2], brick: '3001' }]).ok).toBe(false);
  });
  it('features cannot be used to smuggle in a model bigger than the limits', () => {
    const r = parse([{ kind: 'battlement', at: [0, 2, 0], size: 40 }, { kind: 'wing', at: [0, 2, 0], size: 40, facing: '+x' }, { kind: 'wing', at: [0, 2, 0], size: 40, facing: '-x' }]);
    expect(r.ok).toBe(false);
  });
  it('an unknown extra key is dropped, not passed along', () => {
    const r = parse([{ kind: 'eye', at: [0, 1, 2], evil: 'x', size: 2 }]); expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.spec.features![0]).sort()).toEqual(['at', 'kind', 'size']);
  });
  it('a spec with no features behaves exactly as before', () => {
    const r = parse(undefined); expect(r.ok).toBe(true); if (r.ok) expect(r.spec.features).toBeUndefined();
  });
});

describe('parts catalog: mirror_x', () => {
  const body = { name: 'm', mirror_x: true, shapes: [{ type: 'box', op: 'add', color: 'tan', center: [0, 3, 0], size: [10, 6, 10] }] };
  it('a part off the centre line is mirrored, a part on it is not doubled', () => {
    const both = parseSpec({ ...body, features: [{ kind: 'eye', at: [3, 4, 5] }, { kind: 'spot', at: [0, 4, 5] }] }); expect(both.ok).toBe(true);
    if (!both.ok) return;
    const n = (k: string) => expand(both.spec).filter(s => s.op === 'paint').length;
    expect(n('x')).toBe(2 * 2 + 1 /* eye: 2 shapes x 2 sides; spot on the centre line: 1 shape, not doubled */);
  });
  it('a wedge-based part keeps its slope flipped on the mirrored side', () => {
    const r = parseSpec({ ...body, features: [{ kind: 'wing', at: [5, 2, 0], facing: '+x', size: 5 }] }); expect(r.ok).toBe(true);
    if (!r.ok) return;
    const w = expand(r.spec).filter(s => s.type === 'wedge'); expect(w.length).toBe(2);
    expect(new Set(w.map(s => s.slope))).toEqual(new Set(['+x', '-x']));
    expect(Math.sign(w[0].center[0])).toBe(-Math.sign(w[1].center[0]));
  });
});

describe('parts catalog: prompt text is generated from the table', () => {
  it('lists every kind exactly once with its meaning of "at"', () => {
    const t = featureCatalogText();
    for (const k of FEATURE_KINDS) expect(t.match(new RegExp(`^- ${k}:`, 'm'))).toBeTruthy();
    expect(t.split('\n').length).toBe(FEATURE_KINDS.length);
    expect(t).toMatch(/"at" = /);
  });
});
