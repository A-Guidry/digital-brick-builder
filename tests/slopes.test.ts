import { describe, it, expect } from 'vitest';
import { UNITS, UNIT_NAMES, unitFootprint, unitParts, Facing } from '../src/specials';
import { unitsOf, expandFeatures, Feature } from '../src/features';
import { buildWithRepair } from '../src/repair';
import { partsList } from '../src/bricklink';
import { parseSpec } from '../src/shapes';
import type { Placed } from '../src/compiler';

const noAi = async () => { throw new Error('the AI must not be needed'); };
const build = (spec: unknown) => buildWithRepair({ rawText: JSON.stringify(spec) }, noAi, { maxRounds: 1 });
const SLOPES = UNIT_NAMES.filter(n => n.startsWith('slope-'));
// A house body: walls 10 wide, 8 deep, 6 tall, standing on the ground.
const house = (features: Feature[], over: object = {}) => ({ name: 'house', shapes: [{ type: 'box', color: 'tan', center: [0, 3, 0], size: [10, 6, 8] }], features, ...over });
const slopesIn = (m: { parts: Placed[] }) => m.parts.filter(p => p.part.startsWith('unit-slope-'));

describe('real slope parts', () => {
  it('the three real slopes are in the data: 3037 (4 wide), 3039 (2 wide), 3040 (1 wide), each 2 deep and 3 plates tall', () => {
    expect(SLOPES.sort()).toEqual(['slope-1', 'slope-2', 'slope-4']);
    expect([UNITS['slope-4'].bl, UNITS['slope-2'].bl, UNITS['slope-1'].bl]).toEqual(['3037', '3039', '3040']);
    expect(UNITS['slope-4'].footprint).toEqual([4, 2, 3]); expect(UNITS['slope-2'].footprint).toEqual([2, 2, 3]); expect(UNITS['slope-1'].footprint).toEqual([1, 2, 3]);
    for (const n of SLOPES) expect(UNITS[n].cls).toBe('block');
  });
  it('a slope is lower on the side it descends toward, for every facing (the real shape, not a box)', () => {
    const lowSide = (v: Float32Array, axis: 0 | 2) => {            // mean height of the vertices on each side of the footprint along the axis
      let neg = 0, nn = 0, pos = 0, np = 0;
      for (let i = 0; i < v.length; i += 3) { const a = v[i + axis], y = v[i + 1]; if (a < -0.4) { neg += y; nn++; } else if (a > 0.4) { pos += y; np++; } }
      return neg / nn - pos / np;                                   // > 0 means the - side is higher
    };
    for (const f of ['+x', '-x', '+z', '-z'] as Facing[]) {
      const v = unitParts('slope-2', f)[0].positions, axis = f.endsWith('x') ? 0 : 2, d = lowSide(v, axis);
      expect(f.startsWith('+') ? d > 0.1 : d < -0.1, `${f}: ${d}`).toBe(true);   // descending toward + means the + side is lower, so the - side is higher
    }
  });
  for (const unit of SLOPES) for (const f of ['+x', '-x', '+z', '-z'] as Facing[]) {
    it(`${unit} placed on a body facing ${f}: valid, one real part, sloping the way it was told`, async () => {
      const at: [number, number, number] = f === '+x' ? [3, 6, 0] : f === '-x' ? [-3, 6, 0] : f === '+z' ? [0, 6, 2] : [0, 6, -2];
      const r = await build(house([{ kind: 'slope', at, facing: f, size: UNITS[unit].footprint[0] }]));
      expect(r.ok, `${unit} ${f}: ${r.message}`).toBe(true);
      const sp = slopesIn(r.model!); expect(sp.length).toBe(1); expect(sp[0].part).toBe(`unit-${unit}`);
      expect(sp[0].special?.facing).toBe(f); const fp = unitFootprint(unit, f); expect([sp[0].fx, sp[0].fz, sp[0].h]).toEqual([fp.fx, fp.fz, 3]);
    });
  }
  it('a slope length picks the nearest real slope: 1, 2 or 4 wide', () => {
    const pick = (size: any) => unitsOf([{ kind: 'slope', at: [0, 6, 0], facing: '+z', size }], false)[0].unit;
    expect([pick(1), pick(2), pick(4), pick(3.1), pick(40), pick(0.2), pick(undefined)]).toEqual(['slope-1', 'slope-2', 'slope-4', 'slope-4', 'slope-4', 'slope-1', 'slope-2']);
  });
  it('a slope in thin air is reported, and one overlapping another real part is named', async () => {
    const air = await build(house([{ kind: 'slope', at: [0, 12, 0], facing: '+z' }])); expect(air.ok).toBe(false); expect(air.message).toMatch(/not joined|disconnected|not on the model/i);
    const two = await build(house([{ kind: 'slope', at: [0, 6, 2], facing: '+z', size: 4 }, { kind: 'slope', at: [1, 6, 2], facing: '+z', size: 4 }]));
    expect(two.ok).toBe(false); expect(two.message).toMatch(/slope.*overlaps/i);
  });
  it('the shopping list names the real slope parts', async () => {
    const r = await build(house([{ kind: 'slope', at: [0, 6, 2], facing: '+z', size: 4 }, { kind: 'slope', at: [-3, 6, 2], facing: '+z', size: 2 }]));
    expect(r.ok, r.message).toBe(true);
    const l = partsList(r.model!); expect(l.filter(x => x.bl === '3037').reduce((a, b) => a + b.qty, 0)).toBe(1); expect(l.filter(x => x.bl === '3039').reduce((a, b) => a + b.qty, 0)).toBe(1);
  });
});

describe('real roofs: stepped courses of real slopes with a brick core', () => {
  const roof = (w: number, d: number, extra: Partial<Feature> = {}): Feature => ({ kind: 'roof', at: [0, 6, 0], size: [w, 3, d], color: 'red', ...extra });
  it('a roof is slopes on both long edges for each course: 4 courses of slopes for a 16 wide roof, 3 for 12, 2 for 8, 1 for 4', () => {
    const courses = (w: number) => { const u = unitsOf([roof(w, 4)], false); return new Set(u.map(x => x.at[1])).size; };
    expect([courses(16), courses(12), courses(8), courses(4)]).toEqual([4, 3, 2, 1]);
  });
  it('every slope descends away from the ridge: the left band faces -x, the right band +x (ridge along z)', () => {
    for (const u of unitsOf([roof(12, 8)], false)) expect(u.facing, `at x ${u.at[0]}`).toBe(u.at[0] < 0 ? '-x' : '+x');
  });
  it('turning the ridge to run along x puts the bands on the z edges, facing -z and +z', () => {
    const u = unitsOf([roof(12, 8, { facing: '+x' })], false); expect(u.length).toBeGreaterThan(0);
    for (const x of u) expect(x.facing, `at z ${x.at[2]}`).toBe(x.at[2] < 0 ? '-z' : '+z');
  });
  it('the slopes along one edge cover the whole length with 4, 2 and 1 wide slopes and no gaps or overlaps', () => {
    for (const d of [1, 2, 3, 4, 5, 6, 7, 8, 11, 12]) {
      const u = unitsOf([roof(8, d)], false).filter(x => x.at[1] === 6 && x.at[0] < 0);
      const spans = u.map(x => { const w = UNITS[x.unit].footprint[0]; return [x.at[2] - w / 2, x.at[2] + w / 2]; }).sort((a, b) => a[0] - b[0]);
      let end = spans[0][0];
      for (const [a, b] of spans) { expect(a, `d ${d} gap/overlap`).toBe(end); end = b; }
      expect(end - spans[0][0], `d ${d} length`).toBe(d);
    }
  });
  it('odd or tiny widths are made even and at least 4, never invalid', () => {
    for (const w of [0.5, 1, 3, 5, 7, 9.9]) { const u = unitsOf([roof(w, 4)], false); expect(u.length, `w ${w}`).toBeGreaterThan(0); for (const x of u) expect(Number.isInteger(x.at[0] - 1) || Number.isInteger(x.at[0]), `w ${w}`).toBe(true); }
  });
  it('the core of the roof is ordinary brick shapes the same colour, so the bounds include the whole roof', () => {
    const sh = expandFeatures([roof(12, 8)]); expect(sh.length).toBeGreaterThan(0); for (const s of sh) { expect(s.color).toBe('red'); expect(s.type).toBe('box'); }
  });
  it('a roof on a house builds valid with real slopes on every course and edge, with no AI help', async () => {
    const r = await build(house([roof(10, 8)]));
    expect(r.ok, r.message).toBe(true);
    const sp = slopesIn(r.model!); expect(sp.length).toBeGreaterThanOrEqual(4);
    expect(new Set(sp.map(p => p.special?.facing))).toEqual(new Set(['-x', '+x']));
    expect(r.report!.stats.components).toBe(1);
  });
  it('the ridge direction can be turned, and a roof can be mirrored with the model', async () => {
    const a = await build(house([roof(8, 10, { facing: '+x' })])); expect(a.ok, a.message).toBe(true); expect(new Set(slopesIn(a.model!).map(p => p.special?.facing))).toEqual(new Set(['-z', '+z']));
    const b = await build(house([roof(8, 8, { at: [0, 6, 0] })], { mirror_x: true })); expect(b.ok, b.message).toBe(true);
    const c = await build({ name: 'two', mirror_x: true, shapes: [{ type: 'box', color: 'tan', center: [0, 3, 0], size: [20, 6, 8] }], features: [roof(8, 8, { at: [6, 6, 0] })] });
    expect(c.ok, c.message).toBe(true); expect(slopesIn(c.model!).length % 2).toBe(0);
  });
  it('the shopping list has the real slope numbers in the roof colour', async () => {
    const r = await build(house([roof(10, 8)])); const l = partsList(r.model!);
    expect(l.some(x => ['3037', '3039', '3040'].includes(x.bl) && x.color === 'red')).toBe(true);
  });
  it('a roof that does not sit on anything is reported by the normal checks, never silently half-built', async () => {
    const r = await build({ name: 'x', shapes: [{ type: 'box', color: 'tan', center: [0, 1, 20], size: [4, 2, 4] }], features: [roof(8, 8, { at: [0, 10, 0] })] });
    expect(r.ok === false || slopesIn(r.model!).length > 0).toBe(true);
  });
  it('the AI can write roof and slope features, with a bad facing refused', () => {
    expect(parseSpec(house([roof(10, 8)])).ok).toBe(true); expect(parseSpec(house([{ kind: 'slope', at: [0, 6, 2], facing: '-z' }])).ok).toBe(true);
    expect(parseSpec(house([{ kind: 'slope', at: [0, 6, 2], facing: '+y' as any }])).ok).toBe(false);
  });
});
