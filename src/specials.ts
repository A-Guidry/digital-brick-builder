// Real parts that are not plain rectangles, read from src/specials.json (baked from the LDraw library and the OMR models by tools/build-units.py).
// A "unit" is the anchor part plus the companions that ride on it (a wheel holder with its hub and tyre, a window frame with its glass).
// No three.js in here, so it is easy to test.
import data from './specials.json';

export type Facing = '+x' | '-x' | '+z' | '-z';
export interface UnitPart { tag: 'body' | 'extra'; bl: string; name: string; colour: string | null; accentDefault?: string | null; positions: Float32Array }
export interface UnitDef {
  cls: 'hang' | 'wall' | 'block'; studs?: boolean | 'back'; overhang?: boolean; footprint: [number, number, number]; baseFacing: Facing; anchorY: 'center' | 'bottom'; bodyDefault: string | null; bl: string;
  parts: { tag: string; bl: string; name: string; colour: string | null; accentDefault?: string | null; tris: string; n: number }[];
}
export const UNITS = data as unknown as Record<string, UnitDef>;
export const UNIT_NAMES = Object.keys(UNITS);

// quarter turns about the vertical axis: new x = a*x + b*z, new z = c*x + d*z  (a pure rotation: determinant 1)
const TURN: Record<Facing, [number, number, number, number]> = { '+x': [1, 0, 0, 1], '-x': [-1, 0, 0, -1], '+z': [0, -1, 1, 0], '-z': [0, 1, -1, 0] };
const ORDER: Facing[] = ['+x', '+z', '-x', '-z'];                          // counter-clockwise from above, matching TURN
/** The turn that takes a part stored facing `from` to facing `to`. */
function turnBetween(from: Facing, to: Facing): [number, number, number, number] {
  const k = (ORDER.indexOf(to) - ORDER.indexOf(from) + 4) % 4;
  return TURN[ORDER[k]];
}
const cache = new Map<string, UnitPart[]>();

function decode(b64: string): Float32Array {
  const bin = atob(b64), n = bin.length >> 1, out = new Float32Array(n);
  for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v & 0x8000) v -= 0x10000; out[i] = v / 100; }
  return out;
}
/** Triangle soup (x,y,z per vertex, in studs, y up) for each real part of the unit, turned to `facing`, relative to the footprint centre at the top of the anchor. */
export function unitParts(unit: string, facing?: Facing): UnitPart[] {
  const u = UNITS[unit]; if (!u) throw new Error(`unknown special unit "${unit}"`);
  const f = facing ?? u.baseFacing, key = `${unit}|${f}`;
  const hit = cache.get(key); if (hit) return hit;
  const [a, b, c, d] = turnBetween(u.baseFacing, f);
  const parts = u.parts.map(p => {
    const v = decode(p.tris);
    for (let i = 0; i < v.length; i += 3) { const x = v[i], z = v[i + 2]; v[i] = a * x + b * z; v[i + 2] = c * x + d * z; }
    return { tag: p.tag as UnitPart['tag'], bl: p.bl, name: p.name, colour: p.colour, accentDefault: p.accentDefault, positions: v };
  });
  cache.set(key, parts);
  return parts;
}
/** Footprint in cells (x, z) and plates (y) once turned to `facing`: a window facing sideways is one cell wide in x. */
export function unitFootprint(unit: string, facing: Facing): { fx: number; fz: number; h: number } {
  const [w, d, h] = UNITS[unit].footprint;
  const sideways = ORDER.indexOf(facing) % 2 !== ORDER.indexOf(UNITS[unit].baseFacing) % 2;
  return sideways ? { fx: d, fz: w, h } : { fx: w, fz: d, h };
}
/** How far the lowest point of the wheel unit hangs below the top of its holder (studs). */
export const WHEEL_DROP = 1.5;
/** The holder's top is placed this high so the tyre touches the ground (rounded to whole plates for the grid; the viewer closes the last 0.1). */
export const WHEEL_TOP = 1.6;
