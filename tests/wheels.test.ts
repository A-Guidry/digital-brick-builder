import { describe, it, expect } from 'vitest';
import { unitParts, WHEEL_TOP, WHEEL_DROP } from '../src/specials';
import { PARTS, PART_BY_ID, SPECIAL_BY_ID, resolveColor } from '../src/catalog';
import { unitsOf, expandFeatures, Feature } from '../src/features';
import { voxelize } from '../src/compiler';
import { buildWithRepair } from '../src/repair';
import { partsList } from '../src/bricklink';
import { parseSpec, ShapeSpec } from '../src/shapes';

const noAi = async () => { throw new Error('the AI must not be needed'); };
const build = (spec: unknown) => buildWithRepair({ rawText: JSON.stringify(spec) }, noAi, { maxRounds: 1 });
// A car whose body starts at 1.6 (the height the wheel units need), wheels on both sides at the front and back.
const car = (over: Partial<ShapeSpec> & { floor?: number; features?: Feature[] } = {}) => {
  const floor = over.floor ?? 1.6;
  return {
    name: 'car', mirror_x: true,
    shapes: [{ type: 'box', color: 'red', center: [0, floor + 1.2, 0], size: [8, 2.4, 16] }, { type: 'box', color: 'red', center: [0, floor + 3.6, -1.5], size: [7, 2.4, 8] }],
    features: over.features ?? [{ kind: 'wheel', at: [4, 0, 5], facing: '+x' }, { kind: 'wheel', at: [4, 0, -5], facing: '+x' }],
  };
};

describe('real wheel unit: the baked LDraw shapes', () => {
  it('has the real holder, hub and tyre with their real triangle counts', () => {
    const p = unitParts('wheel');
    expect(p.map(x => x.tag)).toEqual(['body', 'extra', 'extra']);
    expect(p.map(x => x.positions.length / 9)).toEqual([268, 888, 712]);
    expect(p.map(x => x.bl)).toEqual(['4488', '6014b', '6015']);
    for (const x of p) for (const v of x.positions) expect(Number.isFinite(v)).toBe(true);
  });
  it('the hub and tyre have fixed real colours; the holder takes the placed colour', () => {
    const p = unitParts('wheel');
    expect(p[0].colour).toBeNull(); expect(resolveColor(p[1].colour!)).toBeTruthy(); expect(p[2].colour).toBe('black');
  });
  const centroid = (v: Float32Array) => { let x = 0, y = 0, z = 0; const n = v.length / 3; for (let i = 0; i < v.length; i += 3) { x += v[i]; y += v[i + 1]; z += v[i + 2]; } return [x / n, y / n, z / n]; };
  it('the wheel points the way it is told to, for all four facings, and the tyre always reaches the same depth below the holder', () => {
    const want: Record<string, [number, number]> = { '+x': [1, 0], '-x': [-1, 0], '+z': [0, 1], '-z': [0, -1] };
    for (const f of Object.keys(want) as ('+x' | '-x' | '+z' | '-z')[]) {
      const tyre = unitParts('wheel', f)[2].positions, c = centroid(tyre);
      expect(Math.sign(Math.round(c[0] * 10)), f).toBe(want[f][0]); expect(Math.sign(Math.round(c[2] * 10)), f).toBe(want[f][1]);
      let minY = Infinity; for (let i = 1; i < tyre.length; i += 3) minY = Math.min(minY, tyre[i]);
      expect(minY, `${f} tyre bottom`).toBeCloseTo(-WHEEL_DROP, 1);
      // the holder keeps its 2 x 2 footprint whichever way the wheel points
      const b = unitParts('wheel', f)[0].positions; let lo = [Infinity, Infinity], hi = [-Infinity, -Infinity];
      for (let i = 0; i < b.length; i += 3) { lo = [Math.min(lo[0], b[i]), Math.min(lo[1], b[i + 2])]; hi = [Math.max(hi[0], b[i]), Math.max(hi[1], b[i + 2])]; }
      const along = f.endsWith('x') ? 0 : 1, across = 1 - along;
      expect(hi[across] - lo[across], `${f} holder width`).toBeCloseTo(2, 1);
    }
  });
  it('turning is a pure rotation (nothing is mirrored or squashed)', () => {
    const a = unitParts('wheel', '+x')[2].positions, b = unitParts('wheel', '+z')[2].positions;
    const vol = (v: Float32Array) => { let s = 0; for (let i = 0; i < v.length; i += 9) s += v[i] * (v[i + 4] * v[i + 8] - v[i + 5] * v[i + 7]) - v[i + 1] * (v[i + 3] * v[i + 8] - v[i + 5] * v[i + 6]) + v[i + 2] * (v[i + 3] * v[i + 7] - v[i + 4] * v[i + 6]); return s / 6; };
    expect(vol(b)).toBeCloseTo(vol(a), 2);
  });
});

describe('real wheel unit: catalog', () => {
  it('the holder is a real part with its real number, and its hub and tyre are on the shopping list', () => {
    const d = SPECIAL_BY_ID['unit-wheel'];
    expect(d.bl).toBe('4488'); expect([d.w, d.d, d.h]).toEqual([2, 2, 1]); expect(d.extras.map(e => e.bl)).toEqual(['6014b', '6015']);
    for (const e of d.extras) expect(resolveColor(e.color)).toBeTruthy();
  });
  it('the packer is never offered the holder as an ordinary plate', () => {
    expect(PARTS.some(p => p.id === 'unit-wheel')).toBe(false); expect(PART_BY_ID['unit-wheel']).toBeTruthy();
  });
});

describe('real wheel unit: where the holders go', () => {
  it('a holder sits flush with the body side, with the wheel outside it, for all four sides', () => {
    const at = (facing: string, x: number, z: number) => unitsOf([{ kind: 'wheel', at: [x, 0, z], facing: facing as any }], false)[0];
    expect(at('+x', 4, 5)).toMatchObject({ cx: 3, cz: 5, facing: '+x' }); expect(at('-x', -4, 5)).toMatchObject({ cx: -3, cz: 5 });
    expect(at('+z', 1, 8)).toMatchObject({ cx: 1, cz: 7 }); expect(at('-z', 1, -8)).toMatchObject({ cx: 1, cz: -7 });
  });
  it('the y the AI gives is ignored: the holder is always at the height the tyre needs', () => {
    for (const y of [-5, 0, 0.7, 3, 40]) expect(unitsOf([{ kind: 'wheel', at: [4, y, 5], facing: '+x' }], false)[0].topY).toBe(WHEEL_TOP);
  });
  it('fractional positions snap to whole studs, and the unit and its reserved plate agree', () => {
    for (const x of [3.6, 3.99, 4, 4.01, 4.4]) for (const z of [4.6, 5, 5.49]) {
      const f: Feature = { kind: 'wheel', at: [x, 0, z], facing: '+x' }, u = unitsOf([f], false)[0], sh = expandFeatures([f])[0];
      expect(Number.isInteger(u.cx) && Number.isInteger(u.cz)).toBe(true);
      expect([sh.center[0], sh.center[2]]).toEqual([u.cx, u.cz]);
    }
  });
  it('mirror_x adds the opposite wheel facing the other way; a wheel on the centre line is not doubled; z-facing wheels keep their facing', () => {
    const u = unitsOf([{ kind: 'wheel', at: [4, 0, 5], facing: '+x' }], true);
    expect(u.map(x => [x.cx, x.facing])).toEqual([[3, '+x'], [-3, '-x']]);
    expect(unitsOf([{ kind: 'wheel', at: [0, 0, 8], facing: '+z' }], true).length).toBe(1);
    expect(unitsOf([{ kind: 'wheel', at: [3, 0, 8], facing: '+z' }], true).map(x => x.facing)).toEqual(['+z', '+z']);
  });
  it('other features create no units', () => {
    expect(unitsOf([{ kind: 'headlight', at: [0, 1, 1] }, { kind: 'eye', at: [0, 1, 1] }], true)).toEqual([]);
  });
});

describe('real wheel unit: in a real build', () => {
  it('a car with four wheel units builds valid, with exactly four real holders pointing the right ways, and stands on lift', async () => {
    const r = await build(car());
    expect(r.ok, r.message).toBe(true);
    const w = r.model!.parts.filter(p => p.part === 'unit-wheel');
    expect(w.length).toBe(4); expect(w.filter(p => p.special?.facing === '+x').length).toBe(2); expect(w.filter(p => p.special?.facing === '-x').length).toBe(2);
    for (const p of w) { expect([p.fx, p.fz, p.h]).toEqual([2, 2, 1]); expect(p.y).toBe(0); }
    expect(r.model!.lift).toBeCloseTo(1.2, 1);
    expect(r.report!.stats.components).toBe(1);
  });
  it('the shopping list has the real holder, hub and tyre, one each per wheel', async () => {
    const r = await build(car()); const l = partsList(r.model!);
    const q = (bl: string) => l.filter(x => x.bl === bl).reduce((a, b) => a + b.qty, 0);
    expect([q('4488'), q('6014b'), q('6015')]).toEqual([4, 4, 4]);
    expect(l.find(x => x.bl === '6015')!.color).toBe('black'); expect(l.find(x => x.bl === '6014b')!.color).toBe('light_gray');
    const none = partsList((await build(car({ features: [{ kind: 'headlight', at: [2, 3, 8] }] }))).model!);
    expect(none.some(x => ['4488', '6014b', '6015'].includes(x.bl))).toBe(false);
  });
  it('no wheel is ever silently lost: body too high, too low, or wheel off the body entirely', async () => {
    for (const [label, spec, shouldWork] of [
      ['body floats 1.4 studs above the holders', car({ floor: 3 }), true],
      ['body starts at the ground (overlaps the holders)', car({ floor: 0 }), null],
      ['body slightly low', car({ floor: 1.2 }), null],
      ['wheel placed far from the body', car({ features: [{ kind: 'wheel', at: [14, 0, 5], facing: '+x' }, { kind: 'wheel', at: [4, 0, -5], facing: '+x' }] }), false],
    ] as [string, any, boolean | null][]) {
      const r = await build(spec); const want = spec.features.length * 2 - (label.includes('far') ? 1 : 0);   // the far one is mirrored too but counts the same
      const got = r.model?.parts.filter(p => p.part === 'unit-wheel').length ?? 0;
      if (shouldWork === true) expect(r.ok, `${label}: ${r.message}`).toBe(true);
      if (shouldWork === false) expect(r.ok, label).toBe(false);
      expect(got === spec.features.length * 2 || !r.ok, `${label}: ${got} units, ok=${r.ok}`).toBe(true);
      void want;
    }
  });
  it('a body that sits above the holders gets short posts in its own colour down to them, so the wheels are always attached', async () => {
    for (const floor of [1.6, 2.0, 2.4, 3, 4.4]) {
      const r = await build(car({ floor }));
      expect(r.ok, `floor ${floor}: ${r.message}`).toBe(true);
      expect(r.model!.parts.filter(p => p.part === 'unit-wheel').length).toBe(4);
      expect(r.report!.stats.components).toBe(1);
    }
  });
  it('with no body above a holder there is nothing to attach it to, and that is reported rather than hidden', async () => {
    const r = await build({ name: 'x', shapes: [{ type: 'box', color: 'red', center: [0, 1, 20], size: [4, 2, 4] }], features: [{ kind: 'wheel', at: [4, 0, 0], facing: '+x' }] });
    expect(r.ok).toBe(false); expect(r.message).toMatch(/not joined|disconnected/);
  });
  it('wheel units come out the same every time the same spec is built', async () => {
    const a = (await build(car())).model!.parts.filter(p => p.part === 'unit-wheel').map(p => [p.x, p.y, p.z, p.special?.facing]);
    const b = (await build(car())).model!.parts.filter(p => p.part === 'unit-wheel').map(p => [p.x, p.y, p.z, p.special?.facing]);
    expect(a).toEqual(b);
  });
  it('the spec the AI writes survives parsing with wheel features, and a wheel with a made-up facing is refused', () => {
    expect(parseSpec(car()).ok).toBe(true);
    expect(parseSpec(car({ features: [{ kind: 'wheel', at: [4, 0, 5], facing: '+y' as any }] })).ok).toBe(false);
  });
  it('voxelize reserves exactly the unit cells and nothing else changes for a car without wheels', () => {
    const g = voxelize((parseSpec(car()) as any).spec); expect(g.fixed?.length).toBe(4);
    for (const f of g.fixed!) { expect([f.fx, f.fz, f.h]).toEqual([2, 2, 1]); expect(f.special.unit).toBe('wheel'); }
    expect(voxelize((parseSpec(car({ features: [] })) as any).spec).fixed).toBeUndefined();
  });
});
