import { describe, it, expect } from 'vitest';
import { UNITS, UNIT_NAMES, unitParts, unitFootprint, Facing } from '../src/specials';
import { SPECIAL_PARTS, SPECIAL_BY_ID, PARTS, PART_BY_ID, COLOR_BY_ID, resolveColor } from '../src/catalog';
import { unitsOf, Feature } from '../src/features';
import { buildWithRepair } from '../src/repair';
import { partsList } from '../src/bricklink';
import { parseSpec } from '../src/shapes';

const FACINGS: Facing[] = ['+x', '-x', '+z', '-z'];
const WALL_UNITS = UNIT_NAMES.filter(n => UNITS[n].cls === 'wall');
const noAi = async () => { throw new Error('the AI must not be needed'); };
const build = (spec: unknown) => buildWithRepair({ rawText: JSON.stringify(spec) }, noAi, { maxRounds: 1 });
const bbox = (v: Float32Array) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[i + k]); hi[k] = Math.max(hi[k], v[i + k]); } return { lo, hi, size: hi.map((h, k) => h - lo[k]) }; };
// feature that produces each wall unit, with the surface point for a wall box centred at the origin (x +-6, z +-2, y 0..10)
const featureFor = (unit: string, facing: Facing): Feature => {
  const kind = unit.startsWith('window') ? 'window' : unit === 'windscreen' ? 'windshield' : 'door';
  const [w, , h] = UNITS[unit].footprint, y = kind === 'door' ? 0 : 5;
  const at: [number, number, number] = facing === '+z' ? [0, y, 2] : facing === '-z' ? [0, y, -2] : facing === '+x' ? [6, y, 0] : [-6, y, 0];
  return { kind, at, facing, ...(kind === 'window' ? { size: [w, h * 0.4] } : {}) };
};
const wall = (features: Feature[], extra: object = {}) => ({ name: 'wall', shapes: [{ type: 'box', color: 'tan', center: [0, 5, 0], size: [12, 10, 4] }], features, ...extra });

describe('every real unit in the data is sane (this table grows by itself when a unit is added to tools/units.json)', () => {
  for (const name of UNIT_NAMES) {
    const u = UNITS[name];
    it(`${name}: real triangles, finite numbers, a body first, footprint matches the real shape`, () => {
      const parts = unitParts(name);
      expect(parts[0].tag).toBe('body'); expect(parts.length).toBe(u.parts.length);
      parts.forEach((p, i) => { expect(p.positions.length / 9).toBe(u.parts[i].n); for (const v of p.positions) expect(Number.isFinite(v)).toBe(true); });
      const b = bbox(parts[0].positions), [fw, fd, fh] = u.footprint;
      if (u.overhang) {                                                     // trees and bushes: branches reach past the 2 x 2 base, never less than it, and stay centred on it
        expect(b.size[0], `${name} width`).toBeGreaterThanOrEqual(fw - 0.2); expect(b.size[2], `${name} depth`).toBeGreaterThanOrEqual(fd - 0.2);
        expect(Math.abs((b.lo[0] + b.hi[0]) / 2), `${name} centred in x`).toBeLessThan(0.4); expect(Math.abs((b.lo[2] + b.hi[2]) / 2), `${name} centred in z`).toBeLessThan(0.4);
      } else if (name !== 'wheel') {                                        // (the wheel's footprint is its plate; its holder arms reach out beyond it)
        expect(Math.abs(b.size[0] - fw), `${name} width ${b.size[0]} vs ${fw}`).toBeLessThan(0.45);
        expect(Math.abs(b.size[2] - fd), `${name} depth ${b.size[2]} vs ${fd}`).toBeLessThan(0.45);
        expect(Math.abs(b.size[1] / 0.4 - fh), `${name} height ${b.size[1] / 0.4} plates vs ${fh}`).toBeLessThan(1.6);
        expect(Math.abs((b.lo[0] + b.hi[0]) / 2), `${name} centred in x`).toBeLessThan(0.1); expect(Math.abs((b.lo[2] + b.hi[2]) / 2), `${name} centred in z`).toBeLessThan(0.1);
      }
      expect(b.hi[1], `${name} top of the anchor is at 0`).toBeLessThan(0.25);
    });
    it(`${name}: turning to all four sides keeps the real shape (a pure rotation) and swaps the footprint correctly`, () => {
      const base = bbox(unitParts(name)[0].positions).size;
      for (const f of FACINGS) {
        const turned = bbox(unitParts(name, f)[0].positions).size, fp = unitFootprint(name, f);
        const alongX = Math.abs(turned[0] - base[0]) < 0.01;                  // same way round as stored, or swapped
        const swapped = Math.abs(turned[0] - base[2]) < 0.01 && Math.abs(turned[2] - base[0]) < 0.01;
        expect(alongX || swapped, `${name} ${f}`).toBe(true);
        expect(Math.abs(turned[1] - base[1])).toBeLessThan(0.01);
        expect([fp.fx, fp.fz].sort()).toEqual([u.footprint[0], u.footprint[1]].sort());
        expect(fp.h).toBe(u.footprint[2]);
      }
    });
    it(`${name}: for every side it faces, the cell footprint matches the turned real shape (width in x, depth in z)`, () => {
      if (name === 'wheel' || u.overhang) return;                            // holder arms and branches reach beyond the base
      for (const f of FACINGS) {
        const size = bbox(unitParts(name, f)[0].positions).size, fp = unitFootprint(name, f);
        expect(Math.abs(size[0] - fp.fx), `${name} ${f} x: shape ${size[0].toFixed(2)} vs footprint ${fp.fx}`).toBeLessThan(0.45);
        expect(Math.abs(size[2] - fp.fz), `${name} ${f} z: shape ${size[2].toFixed(2)} vs footprint ${fp.fz}`).toBeLessThan(0.45);
      }
    });
    it(`${name}: is a real catalog part with its real number, never offered to the packer, colours all real`, () => {
      const d = SPECIAL_BY_ID[`unit-${name}`];
      expect(d.bl).toBe(u.bl); expect([d.w, d.d, d.h]).toEqual(u.footprint);
      expect(PARTS.some(p => p.id === d.id)).toBe(false); expect(PART_BY_ID[d.id]).toBe(d);
      for (const e of d.extras) expect(resolveColor(e.color), `${name} extra ${e.bl}`).toBeTruthy();
      if (u.parts[0].colour) expect(COLOR_BY_ID[u.parts[0].colour]).toBeTruthy();
    });
  }
  it('every unit has a line in the catalog and the catalog has no extra special parts', () => {
    expect(SPECIAL_PARTS.map(p => p.unit).sort()).toEqual([...UNIT_NAMES].sort());
  });
});

describe('real windows, windscreens and doors go into a real wall on every side', () => {
  for (const unit of WALL_UNITS) for (const facing of FACINGS) {
    it(`${unit} facing ${facing}: builds one valid connected model, exactly one real part, in the outer layer of the wall`, async () => {
      const r = await build(wall([featureFor(unit, facing)]));
      expect(r.ok, `${unit} ${facing}: ${r.message}`).toBe(true);
      const sp = r.model!.parts.filter(p => p.part === `unit-${unit}`);
      expect(sp.length, 'exactly one').toBe(1);
      const { fx, fz, h } = unitFootprint(unit, facing); expect([sp[0].fx, sp[0].fz, sp[0].h]).toEqual([fx, fz, h]);
      expect(sp[0].special?.facing).toBe(facing);
      expect(r.report!.stats.components).toBe(1);
      // it sits in the outer cell layer on the side it faces
      const m = r.model!, ox = m.origin[0], oz = m.origin[2];
      if (facing === '+z') expect(oz + sp[0].z + sp[0].fz).toBe(2); if (facing === '-z') expect(oz + sp[0].z).toBe(-2);
      if (facing === '+x') expect(ox + sp[0].x + sp[0].fx).toBe(6); if (facing === '-x') expect(ox + sp[0].x).toBe(-6);
    });
  }
  it('fractional positions still land the unit in the wall, within half a stud of where it was asked for', async () => {
    for (const dx of [0, 0.2, 0.5, -0.4, 0.9]) for (const dy of [0, 0.3, -0.6]) {
      const f = featureFor('window-2x2', '+z'); f.at = [f.at[0] + dx, f.at[1] + dy, 2 + (dx > 0.4 ? 0.3 : 0)];
      const r = await build(wall([f])); expect(r.ok, `${dx},${dy}: ${r.message}`).toBe(true);
      const sp = r.model!.parts.find(p => p.part === 'unit-window-2x2')!; expect(sp).toBeTruthy();
      expect(Math.abs(r.model!.origin[0] + sp.x + sp.fx / 2 - f.at[0]), `x ${dx}`).toBeLessThanOrEqual(0.51);
    }
  });
  it('mirror_x makes the matching pair, flips the side they face, and does not double a unit on the centre line', async () => {
    const side = (unit: string, kind: string): Feature => ({ kind, at: [3, 5, 2], facing: '+z' });
    expect(unitsOf([side('', 'window')], true).map(u => [u.cx, u.facing])).toEqual([[3, '+z'], [-3, '+z']]);
    expect(unitsOf([{ kind: 'window', at: [6, 5, 0], facing: '+x' }], true).map(u => u.facing)).toEqual(['+x', '-x']);
    expect(unitsOf([{ kind: 'door', at: [0, 0, 2], facing: '+z' }], true).length).toBe(1);
    const r = await build(wall([{ kind: 'window', at: [3, 5, 2], facing: '+z', size: [2, 2.4] }], { mirror_x: true }));
    expect(r.ok, r.message).toBe(true); expect(r.model!.parts.filter(p => p.part === 'unit-window-2x2').length).toBe(2);
  });
  it('window size picks the nearest real window, never an invented one', () => {
    const pick = (size: any) => unitsOf([{ kind: 'window', at: [0, 5, 2], facing: '+z', size }], false)[0].unit;
    expect(pick(undefined)).toBe('window-2x2'); expect(pick([2, 2.4])).toBe('window-2x2'); expect(pick([2, 3.6])).toBe('window-2x3'); expect(pick([4, 3.6])).toBe('window-4x3');
    expect(pick(10)).toBe('window-4x3'); expect(pick([0.1, 0.1])).toBe('window-2x2'); expect(UNIT_NAMES).toContain(pick([99, 99]));
  });
  it('a unit placed where there is no wall is reported, never silently dropped', async () => {
    const r = await build(wall([{ kind: 'window', at: [0, 5, 14], facing: '+z' }]));
    expect(r.ok).toBe(false); expect(r.message).toMatch(/window.*not on the model/i);
    const hi = await build(wall([{ kind: 'door', at: [0, 30, 2], facing: '+z' }])); expect(hi.ok).toBe(false); expect(hi.message).toMatch(/door.*not on the model/i);
  });
  it('several units on one wall do not collide: a door, two windows and a windscreen together', async () => {
    const r = await build({ name: 'house', shapes: [{ type: 'box', color: 'tan', center: [0, 6, 0], size: [16, 12, 4] }],
      features: [{ kind: 'door', at: [0, 0, 2], facing: '+z' }, { kind: 'window', at: [-6, 6, 2], facing: '+z' }, { kind: 'window', at: [6, 6, 2], facing: '+z' }, { kind: 'windshield', at: [0, 9.5, -2], facing: '-z' }] });
    expect(r.ok, r.message).toBe(true);
    expect(r.model!.parts.filter(p => p.part.startsWith('unit-')).map(p => p.part).sort()).toEqual(['unit-door', 'unit-window-2x2', 'unit-window-2x2', 'unit-windscreen']);
  });
});

describe('real units placed the way an AI really places them', () => {
  it('a unit asked for too high is moved down just enough to fit inside the wall, never left sticking out', async () => {
    for (const y of [0, 1.6, 2.8]) {                                         // these fit as asked (a 7.2 door in a 10 wall)
      const r = await build(wall([{ kind: 'door', at: [0, y, 2], facing: '+z' }])); expect(r.ok, `y ${y}: ${r.message}`).toBe(true);
      expect(r.model!.parts.find(p => p.part === 'unit-door')!.y, `door asked at y ${y}`).toBe(Math.round(y * 2.5));
    }
    for (const y of [4.5, 5.2, 9]) {                                         // these would stick out of the top: moved down to fit
      const r = await build(wall([{ kind: 'door', at: [0, y, 2], facing: '+z' }])); expect(r.ok, `y ${y}: ${r.message}`).toBe(true);
      const d = r.model!.parts.find(p => p.part === 'unit-door')!; expect(d.y + d.h, `door asked at y ${y}`).toBeLessThanOrEqual(r.model!.size[2]);
    }
  });
  it('two real parts asked for in the same place are reported plainly, naming both, instead of colliding', async () => {
    const r = await build(wall([{ kind: 'door', at: [0, 0, 2], facing: '+z' }, { kind: 'window', at: [0, 4, 2], facing: '+z' }]));
    expect(r.ok).toBe(false); expect(r.message).toMatch(/window.*overlaps|overlaps.*window/i);
    expect(r.message).not.toMatch(/occupy the same space/);
  });
  it('real parts that merely sit side by side on the same wall are fine', async () => {
    const r = await build({ name: 'h', shapes: [{ type: 'box', color: 'tan', center: [0, 6, 0], size: [20, 12, 4] }], features: [{ kind: 'door', at: [-4, 0, 2], facing: '+z' }, { kind: 'window', at: [4, 6, 2], facing: '+z' }, { kind: 'window', at: [8, 6, 2], facing: '+z' }] });
    expect(r.ok, r.message).toBe(true);
  });
  it('the prompt tells the AI where each real part belongs, so a car is not given a house door', async () => {
    const { systemPrompt } = await import('../src/prompt'); const p = systemPrompt();
    expect(p).toMatch(/door[^.]*building/i); expect(p).toMatch(/7\.2/);
  });
});

describe('repair never puts anything inside a real part', () => {
  it('a real Gemini police car (door plus bridge-plate repair) used to collide; now it has no overlaps', async () => {
    const spec = (await import('./fixtures/police-car.json')).default;
    const r = await build(spec);
    expect(r.message, 'no overlap problems').not.toMatch(/occupy the same space/);
    expect(r.model!.parts.filter(p => p.part.startsWith('unit-')).length).toBeGreaterThanOrEqual(7);
  });
  it('bridge plates, platify and the packer all keep out of every unit volume (checked on every unit, every side)', async () => {
    for (const unit of WALL_UNITS) for (const facing of FACINGS) {
      const r = await build(wall([featureFor(unit, facing)]));
      const sp = r.model!.parts.find(p => p.part === `unit-${unit}`)!, others = r.model!.parts.filter(p => p !== sp);
      for (const o of others) {
        const hit = o.x < sp.x + sp.fx && sp.x < o.x + o.fx && o.z < sp.z + sp.fz && sp.z < o.z + o.fz && o.y < sp.y + sp.h && sp.y < o.y + o.h;
        expect(hit, `${unit} ${facing}: part ${o.id} (${o.part}) is inside it`).toBe(false);
      }
    }
  });
});

describe('the shopping list for real units', () => {
  it('a window lists the frame and the glass; a door lists the frame and the leaf in its own colour', async () => {
    const r = await build({ name: 'house', shapes: [{ type: 'box', color: 'tan', center: [0, 6, 0], size: [16, 12, 4] }],
      features: [{ kind: 'door', at: [0, 0, 2], facing: '+z', accent: 'dark_green' }, { kind: 'window', at: [-6, 6, 2], facing: '+z' }] });
    expect(r.ok, r.message).toBe(true);
    const l = partsList(r.model!), q = (bl: string, color?: string) => l.filter(x => x.bl === bl && (!color || x.color === color)).reduce((a, b) => a + b.qty, 0);
    expect([q('60596'), q('60623', 'dark_green'), q('60592'), q('60601', 'trans_light_blue')]).toEqual([1, 1, 1, 1]);
  });
  it('the door leaf defaults to a real colour when none is given', async () => {
    const r = await build({ name: 'h', shapes: [{ type: 'box', color: 'tan', center: [0, 6, 0], size: [16, 12, 4] }], features: [{ kind: 'door', at: [0, 0, 2], facing: '+z' }] });
    expect(partsList(r.model!).find(x => x.bl === '60623')!.color).toBe('reddish_brown');
  });
});

describe('what the AI can write', () => {
  it('window, windshield and door features parse; a window needs no size, and a wrong facing is refused', () => {
    const ok = (f: object) => parseSpec(wall([f as Feature])).ok;
    expect(ok({ kind: 'window', at: [0, 5, 2] })).toBe(true); expect(ok({ kind: 'door', at: [0, 0, 2], facing: '-z' })).toBe(true); expect(ok({ kind: 'windshield', at: [0, 5, 2], size: [4, 2] })).toBe(true);
    expect(ok({ kind: 'window', at: [0, 5, 2], facing: '+y' })).toBe(false); expect(ok({ kind: 'door', at: [0, 0], facing: '+z' })).toBe(false);
  });
});
