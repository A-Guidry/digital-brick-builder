import { COLORS, resolveColor, PLATES_PER_STUD } from './catalog';
import { Feature, validateFeatures, cleanFeatures, expandFeatures, unitsOf } from './features';
import { UNITS, unitFootprint } from './specials';

export type Vec3 = [number, number, number];
export interface Shape {
  type: 'box' | 'cylinder' | 'sphere' | 'cone' | 'wedge';
  op?: 'add' | 'subtract' | 'paint';
  color?: string;
  center: Vec3;               // studs (x right, y up, z toward viewer)
  size?: Vec3;                // box/sphere/wedge full size in studs
  radius?: number;            // cylinder/cone base radius
  length?: number;            // cylinder length / cone height
  axis?: 'x' | 'y' | 'z';     // cylinder axis
  slope?: '+x' | '-x' | '+z' | '-z'; // wedge: side toward which height drops to zero
}
export interface ShapeSpec {
  name: string;
  mirror_x?: boolean;         // mirror every shape across x = 0
  shapes: Shape[];
  features?: Feature[];       // named parts (wheel, window, eye ...) built by features.ts; expanded into shapes by expand()
}
export const LIMITS = { maxShapes: 80, maxStuds: 40, maxHeightStuds: 30 };

const FORBIDDEN_KEYS = new Set(['part', 'parts', 'partid', 'part_id', 'brick', 'bricks', 'ldraw', 'bricklink', 'placements', 'studs_list']);

function scanForbidden(v: unknown, path: string, out: string[]) {
  if (Array.isArray(v)) v.forEach((x, i) => scanForbidden(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) out.push(`${path}.${k}: you may not place bricks or name parts; describe shapes only`);
      scanForbidden(x, `${path}.${k}`, out);
    }
  }
}
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isVec = (v: unknown, positive = false): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every(isNum) && (!positive || v.every(n => n > 0));

/** Parse & validate. Returns normalised spec or list of plain-English problems. */
export function parseSpec(input: unknown): { ok: true; spec: ShapeSpec } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  let raw: any = input;
  if (typeof raw === 'string') {
    try { raw = JSON.parse(extractJson(raw)); } catch (e) { return { ok: false, errors: ['Reply was not valid JSON: ' + (e as Error).message] }; }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, errors: ['Spec must be a JSON object'] };
  scanForbidden(raw, 'spec', errors);
  if (!Array.isArray(raw.shapes) || raw.shapes.length === 0) errors.push('spec.shapes must be a non-empty array');
  else if (raw.shapes.length > LIMITS.maxShapes) errors.push(`too many shapes (max ${LIMITS.maxShapes})`);
  errors.push(...validateFeatures(raw.features));
  const shapes: Shape[] = [];
  (raw.shapes ?? []).forEach((s: any, i: number) => {
    const p = `shapes[${i}]`;
    if (!s || typeof s !== 'object') { errors.push(`${p} must be an object`); return; }
    if (!['box', 'cylinder', 'sphere', 'cone', 'wedge'].includes(s.type)) errors.push(`${p}.type must be box, cylinder, sphere, cone or wedge`);
    const op = s.op ?? 'add';
    if (!['add', 'subtract', 'paint'].includes(op)) errors.push(`${p}.op must be add, subtract or paint`);
    if (!isVec(s.center)) errors.push(`${p}.center must be [x,y,z] numbers`);
    if (op !== 'subtract') {
      if (!s.color) errors.push(`${p}.color is required`);
      else if (!resolveColor(s.color)) errors.push(`${p}.color "${s.color}" is not a LEGO colour. Use one of: ${COLORS.map(c => c.id).join(', ')}`);
    }
    if (['box', 'sphere', 'wedge'].includes(s.type) && !isVec(s.size, true)) errors.push(`${p}.size must be [sx,sy,sz] positive numbers`);
    if (['cylinder', 'cone'].includes(s.type)) {
      if (!isNum(s.radius) || s.radius <= 0) errors.push(`${p}.radius must be a positive number`);
      if (!isNum(s.length) || s.length <= 0) errors.push(`${p}.length must be a positive number`);
    }
    if (s.type === 'cylinder' && s.axis && !['x', 'y', 'z'].includes(s.axis)) errors.push(`${p}.axis must be x, y or z`);
    if (s.type === 'wedge' && !['+x', '-x', '+z', '-z'].includes(s.slope)) errors.push(`${p}.slope must be +x, -x, +z or -z`);
    shapes.push({ ...s, op });
  });
  if (errors.length) return { ok: false, errors };
  const spec: ShapeSpec = { name: String(raw.name ?? 'Model').slice(0, 60), mirror_x: !!raw.mirror_x, shapes };
  const feats = cleanFeatures(raw.features);
  if (feats.length) spec.features = feats;
  const b = specBounds(spec);
  if (!b) return { ok: false, errors: ['spec has no "add" shapes'] };
  const dx = b.max[0] - b.min[0], dy = b.max[1] - b.min[1], dz = b.max[2] - b.min[2];
  if (dx > LIMITS.maxStuds || dz > LIMITS.maxStuds) errors.push(`model is ${dx.toFixed(1)} x ${dz.toFixed(1)} studs wide; max is ${LIMITS.maxStuds} x ${LIMITS.maxStuds}. Make it smaller.`);
  if (dy > LIMITS.maxHeightStuds) errors.push(`model is ${dy.toFixed(1)} studs tall; max is ${LIMITS.maxHeightStuds}. Make it smaller.`);
  if (dx < 1 || dz < 1 || dy < 0.4) errors.push('model is smaller than one stud in some direction; make it bigger');
  return errors.length ? { ok: false, errors } : { ok: true, spec };
}

export function extractJson(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) return fence[1].trim();
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  return a >= 0 && b > a ? text.slice(a, b + 1) : text;
}

/** Expand mirror_x into explicit shapes. */
export function expand(spec: ShapeSpec): Shape[] {
  const all = spec.features?.length ? [...spec.shapes, ...expandFeatures(spec.features)] : spec.shapes;
  if (!spec.mirror_x) return all;
  const out: Shape[] = [];
  for (const s of all) {
    out.push(s);
    const m: Shape = { ...s, center: [-s.center[0], s.center[1], s.center[2]] };
    if (s.type === 'wedge' && s.slope) m.slope = s.slope === '+x' ? '-x' : s.slope === '-x' ? '+x' : s.slope;
    if (Math.abs(s.center[0]) > 1e-6) out.push(m);
  }
  return out;
}

function bbox(s: Shape): { min: Vec3; max: Vec3 } {
  const [cx, cy, cz] = s.center;
  let h: Vec3;
  if (s.type === 'cylinder') {
    const r = s.radius!, L = s.length! / 2, ax = s.axis ?? 'y';
    h = ax === 'x' ? [L, r, r] : ax === 'z' ? [r, r, L] : [r, L, r];
    return { min: [cx - h[0], cy - h[1], cz - h[2]], max: [cx + h[0], cy + h[1], cz + h[2]] };
  }
  if (s.type === 'cone') {
    const r = s.radius!, L = s.length!;
    return { min: [cx - r, cy, cz - r], max: [cx + r, cy + L, cz + r] }; // center = base center
  }
  const sz = s.size!;
  return { min: [cx - sz[0] / 2, cy - sz[1] / 2, cz - sz[2] / 2], max: [cx + sz[0] / 2, cy + sz[1] / 2, cz + sz[2] / 2] };
}

export function specBounds(spec: ShapeSpec): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const s of expand(spec)) {
    if (s.op !== 'add') continue;
    any = true;
    const b = bbox(s);
    for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], b.min[i]); max[i] = Math.max(max[i], b.max[i]); }
  }
  // Block parts (slopes) stand where the AI put them, so the model must reach them even when no shape does.
  for (const u of unitsOf(spec.features, !!spec.mirror_x)) {
    if (UNITS[u.unit].cls !== 'block') continue;
    const { fx, fz, h } = unitFootprint(u.unit, u.facing), lo = [u.at[0] - fx / 2, u.at[1], u.at[2] - fz / 2], hi = [lo[0] + fx, lo[1] + h * 0.4, lo[2] + fz];
    any = true; for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], lo[i]); max[i] = Math.max(max[i], hi[i]); }
  }
  return any ? { min, max } : null;
}

export function inside(s: Shape, x: number, y: number, z: number): boolean {
  const [cx, cy, cz] = s.center;
  const dx = x - cx, dy = y - cy, dz = z - cz;
  switch (s.type) {
    case 'box': { const [a, b, c] = s.size!; return Math.abs(dx) <= a / 2 && Math.abs(dy) <= b / 2 && Math.abs(dz) <= c / 2; }
    case 'sphere': { const [a, b, c] = s.size!; return (dx / (a / 2)) ** 2 + (dy / (b / 2)) ** 2 + (dz / (c / 2)) ** 2 <= 1; }
    case 'cylinder': {
      const r = s.radius!, L = s.length! / 2, ax = s.axis ?? 'y';
      const [u, v, w] = ax === 'x' ? [dy, dz, dx] : ax === 'z' ? [dx, dy, dz] : [dx, dz, dy];
      return u * u + v * v <= r * r && Math.abs(w) <= L;
    }
    case 'cone': {
      const r = s.radius!, L = s.length!;
      if (dy < 0 || dy > L) return false;
      const rr = r * (1 - dy / L);
      return dx * dx + dz * dz <= rr * rr;
    }
    case 'wedge': {
      const [a, b, c] = s.size!;
      if (Math.abs(dx) > a / 2 || Math.abs(dy) > b / 2 || Math.abs(dz) > c / 2) return false;
      const t = (dy + b / 2) / b; // 0 bottom .. 1 top
      const dir = s.slope!, sgn = dir[0] === '+' ? 1 : -1;
      const pos = dir[1] === 'x' ? dx / a : dz / c;      // -0.5..0.5 along drop direction
      const f = 0.5 - sgn * pos;                          // 1 at high side, 0 at drop side
      return t <= f;
    }
  }
}

export { PLATES_PER_STUD };
