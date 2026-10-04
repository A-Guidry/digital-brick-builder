import { describe, it, expect } from 'vitest';
import { UNITS, UNIT_NAMES, unitFootprint } from '../src/specials';
import { unitsOf, Feature } from '../src/features';
import { buildWithRepair } from '../src/repair';
import { partsList } from '../src/bricklink';
import { parseSpec } from '../src/shapes';
import type { Placed } from '../src/compiler';

const noAi = async () => { throw new Error('the AI must not be needed'); };
const build = (spec: unknown) => buildWithRepair({ rawText: JSON.stringify(spec) }, noAi, { maxRounds: 1 });
const body = (features: Feature[], over: object = {}) => ({ name: 'b', shapes: [{ type: 'box', color: 'tan', center: [0, 3, 0], size: [10, 6, 8] }], features, ...over });
const units = (m: { parts: Placed[] }) => m.parts.filter(p => p.part.startsWith('unit-'));

describe('trees, bushes, ears and horns are real parts', () => {
  it('the data has the real tree and bush pieces and the round-brick and cone for ears and horns', () => {
    for (const [n, bl] of [['pine-small', '2435'], ['pine-large', '3471'], ['fruit-tree', '3470'], ['cypress', '3778'], ['bush', '6064'], ['cone-1', '4589'], ['round-1', '3062b']]) expect(UNITS[n].bl, n).toBe(bl);
    expect(UNITS['cone-1'].footprint).toEqual([1, 1, 3]); expect(UNITS['round-1'].footprint).toEqual([1, 1, 3]);
    for (const n of ['pine-small', 'pine-large', 'fruit-tree', 'cypress', 'bush']) { expect(UNITS[n].footprint.slice(0, 2)).toEqual([2, 2]); expect(UNITS[n].overhang).toBe(true); }
  });
  it('a tree picks the nearest real tree by height, and a bush is always the real bush', () => {
    const pick = (size?: number) => unitsOf([{ kind: 'tree', at: [0, 6, 0], size }], false)[0].unit;
    expect([pick(4), pick(undefined), pick(7), pick(8.5), pick(14), pick(40), pick(0.1)]).toEqual(['pine-small', 'pine-small', 'fruit-tree', 'pine-large', 'cypress', 'cypress', 'pine-small']);
    expect(unitsOf([{ kind: 'bush', at: [0, 6, 0] }], false)[0].unit).toBe('bush');
  });
  it('an ear is one real cone; a horn is a column of real round bricks capped by a real cone, as tall as asked', () => {
    expect(unitsOf([{ kind: 'ear', at: [0, 6, 0] }], false).map(u => u.unit)).toEqual(['cone-1']);
    const col = (size: number) => unitsOf([{ kind: 'horn', at: [0, 6, 0], size }], false);
    expect(col(1.2).map(u => u.unit)).toEqual(['cone-1']);
    expect(col(3.6).map(u => u.unit)).toEqual(['round-1', 'round-1', 'cone-1']);
    expect(col(6).map(u => u.unit)).toEqual(['round-1', 'round-1', 'round-1', 'round-1', 'cone-1']);
    expect(col(3.6).map(u => u.at[1])).toEqual([6, 7.2, 8.4]);                      // each part sits exactly on the one below
    expect(col(3.6).every(u => u.at[0] === 0 && u.at[2] === 0)).toBe(true);
    expect(col(999).length).toBeLessThanOrEqual(9); expect(col(0.01).length).toBe(1);   // never absurd, never empty
  });
  it('mirror_x mirrors a feature that is off the centre line and does not double one on it', () => {
    expect(unitsOf([{ kind: 'ear', at: [1.5, 6, 0] }], true).map(u => u.cx)).toEqual([1.5, -1.5]);
    expect(unitsOf([{ kind: 'ear', at: [0, 6, 0] }], true).length).toBe(1);
    expect(unitsOf([{ kind: 'horn', at: [0, 6, 0], size: 3.6 }], true).length).toBe(3);
  });
  for (const [label, f, expected] of [
    ['a small pine on a roof', { kind: 'tree', at: [0, 6, 0], size: 4.8 }, ['unit-pine-small']],
    ['a large pine', { kind: 'tree', at: [0, 6, 0], size: 8 }, ['unit-pine-large']],
    ['a fruit tree', { kind: 'tree', at: [0, 6, 0], size: 7.2 }, ['unit-fruit-tree']],
    ['a cypress', { kind: 'tree', at: [0, 6, 0], size: 14 }, ['unit-cypress']],
    ['a bush', { kind: 'bush', at: [0, 6, 0] }, ['unit-bush']],
    ['an ear', { kind: 'ear', at: [0, 6, 0] }, ['unit-cone-1']],
    ['a horn', { kind: 'horn', at: [0, 6, 0], size: 3.6 }, ['unit-round-1', 'unit-round-1', 'unit-cone-1']],
  ] as [string, Feature, string[]][]) {
    it(`${label}: builds one valid connected model of exactly the real parts asked for, in the colour asked for`, async () => {
      const r = await build(body([{ ...f, color: 'dark_green' }]));
      expect(r.ok, `${label}: ${r.message}`).toBe(true);
      expect(units(r.model!).map(p => p.part).sort(), label).toEqual([...expected].sort());
      for (const p of units(r.model!)) expect(p.color).toBe('dark_green');
      expect(r.report!.stats.components).toBe(1);
    });
  }
  it('the shopping list names the real tree, bush, round brick and cone', async () => {
    const r = await build(body([{ kind: 'tree', at: [-3, 6, 0], size: 4.8 }, { kind: 'bush', at: [3, 6, 0] }, { kind: 'horn', at: [0, 6, 2], size: 3.6 }]));
    expect(r.ok, r.message).toBe(true);
    const q = (bl: string) => partsList(r.model!).filter(x => x.bl === bl).reduce((a, b) => a + b.qty, 0);
    expect([q('2435'), q('6064'), q('3062b'), q('4589')]).toEqual([1, 1, 2, 1]);
  });
  it('a pair of ears mirrored with the model gives two cones, a horn column grows straight up', async () => {
    const r = await build(body([{ kind: 'ear', at: [2, 6, 0] }, { kind: 'horn', at: [0, 6, 0], size: 3.6 }], { mirror_x: true }));
    expect(r.ok, r.message).toBe(true); const u = units(r.model!);
    expect(u.filter(p => p.part === 'unit-cone-1').length).toBe(3); expect(u.filter(p => p.part === 'unit-round-1').length).toBe(2);
    const col = u.filter(p => p.x === u.find(q => q.part === 'unit-round-1')!.x && p.z === u.find(q => q.part === 'unit-round-1')!.z).sort((a, b) => a.y - b.y);
    expect(col.map(p => p.part)).toEqual(['unit-round-1', 'unit-round-1', 'unit-cone-1']);
  });
  it('things asked for in thin air or on top of each other are named, never silently lost', async () => {
    const air = await build(body([{ kind: 'tree', at: [0, 12, 0], size: 4.8 }])); expect(air.ok).toBe(false); expect(air.message).toMatch(/not joined|disconnected|not on the model/i);
    const clash = await build(body([{ kind: 'bush', at: [0, 6, 0] }, { kind: 'bush', at: [1, 6, 0] }])); expect(clash.ok).toBe(false); expect(clash.message).toMatch(/bush.*overlaps/i);
  });
  it('every block unit in the data can be placed by some feature (nothing in the table is unreachable)', () => {
    const reach = new Set<string>();
    for (const f of [{ kind: 'slope', size: 1 }, { kind: 'slope', size: 2 }, { kind: 'slope', size: 4 }, { kind: 'ear' }, { kind: 'horn', size: 3.6 }, { kind: 'bush' }, { kind: 'roof', size: [8, 3, 4] },
      ...[4, 5, 7.2, 8, 14].map(size => ({ kind: 'tree', size }))] as any[]) for (const u of unitsOf([{ at: [0, 6, 0], ...f }], false)) reach.add(u.unit);
    for (const n of UNIT_NAMES.filter(n => UNITS[n].cls === 'block')) expect(reach.has(n), `${n} cannot be reached by any feature`).toBe(true);
  });
  it('the AI can write these features, and bad ones are refused', () => {
    for (const f of [{ kind: 'tree', at: [0, 6, 0] }, { kind: 'bush', at: [0, 6, 0] }, { kind: 'ear', at: [1, 6, 0] }, { kind: 'horn', at: [0, 6, 0], size: 4 }]) expect(parseSpec(body([f as Feature])).ok, f.kind).toBe(true);
    for (const f of [{ kind: 'tree', at: [0, 6] }, { kind: 'horn', at: [0, 6, 0], size: -1 }, { kind: 'bush', at: [0, 6, 0], facing: '+y' }]) expect(parseSpec(body([f as any])).ok, JSON.stringify(f)).toBe(false);
  });
  it('the footprint of each of these matches how big the real part is at its base', () => {
    for (const n of ['pine-small', 'pine-large', 'fruit-tree', 'cypress', 'bush', 'cone-1', 'round-1']) { const f = unitFootprint(n, '+z'); expect(f.fx * f.fz, n).toBeGreaterThanOrEqual(1); expect(f.h, n).toBeGreaterThanOrEqual(3); }
  });
});
