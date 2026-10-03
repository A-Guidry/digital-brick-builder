// The parts catalog. The AI names a part ("wheel", "window", "eye") and says where it goes; this file builds it out of
// ordinary shapes, the same correct way every time. The AI never has to work out how to make a wheel from cylinders.
//
// The voxel grid is 1 stud wide and one plate (0.4 stud) tall and samples at cell centres, so every size here is chosen to land on
// whole cells: single-stud pieces are snapped to a cell centre, two-stud pieces to a cell edge, and anything painted on a
// wall reaches ~2 studs in so a few tenths of an error in "at" still hits the visible surface.
import { resolveColor, COLORS } from './catalog';
import type { Shape, Vec3 } from './shapes';

export type Facing = '+x' | '-x' | '+z' | '-z' | '+y';
export interface Feature {
  kind: string;
  at: Vec3;                       // see FEATURE_DOCS: a centre on the surface, or the bottom centre of the part
  size?: number | number[];       // one number, or [width, height] ([width, height, depth] for a roof)
  facing?: Facing;                // which way the part faces / points out of the model (default +z, the front)
  color?: string;
  accent?: string;
}
export const MAX_FEATURES = 24;
const MAX_SIZE = 40;

interface Kind { paint: boolean; facings: Facing[]; doc: string; at: string; build: (f: Req) => Shape[] }
type Req = Required<Pick<Feature, 'at' | 'facing'>> & { size?: number | number[]; color?: string; accent?: string };
type Dir = { x: number; z: number; xAxis: boolean };

const H4: Facing[] = ['+x', '-x', '+z', '-z'];
const DIRS: Record<string, Dir> = { '+x': { x: 1, z: 0, xAxis: true }, '-x': { x: -1, z: 0, xAxis: true }, '+z': { x: 0, z: 1, xAxis: false }, '-z': { x: 0, z: -1, xAxis: false } };
const cell = (v: number) => Math.floor(v) + 0.5;       // centre of the 1-stud cell containing v
const edge = (v: number) => Math.round(v);              // a cell edge (a two-cell-wide piece centred here covers exactly 2 cells)
const wh = (s: number | number[] | undefined, dw: number, dh: number): [number, number] => {
  if (Array.isArray(s)) return [Math.max(1.02, s[0]), Math.max(0.67, s[1] ?? s[0])];
  if (typeof s === 'number') return [Math.max(1.02, s), Math.max(0.67, s * dh / dw)];
  return [dw, dh];
};
const num = (s: number | number[] | undefined, d: number) => (Array.isArray(s) ? s[0] : typeof s === 'number' ? s : d);

// ---- helpers: boxes laid out relative to a wall that faces `d` ----
function onWall(r: Req, lat: number, h: number, depth: number, over: number, up: number, side: number, op: 'add' | 'paint', color: string): Shape {
  const d = DIRS[r.facing];
  const [x, y, z] = r.at;
  const cx = x + d.x * over + (d.xAxis ? 0 : side), cz = z + d.z * over + (d.xAxis ? side : 0);
  return { type: 'box', op, color, center: [cx, y + up, cz], size: d.xAxis ? [depth, h, lat] : [lat, h, depth] };
}
/** Paint on a wall: ~2 studs deep, reaching from just outside the surface to 1.75 studs inside it. */
const paintWall = (r: Req, lat: number, h: number, color: string, up = 0, side = 0): Shape => onWall(r, lat, h, 2, -0.75, up, side, 'paint', color);
const col = (x: number, y: number, z: number, h: number, color: string): Shape => ({ type: 'box', color, center: [cell(x), y + h / 2, cell(z)], size: [1.02, h, 1.02] });

function windowShapes(r: Req, dw: number, dh: number, frame: boolean): Shape[] {
  const [w, h] = wh(r.size, dw, dh), glass = r.color ?? 'medium_azure', out: Shape[] = [];
  if (frame && w >= 3 && h >= 2.34) {
    out.push(paintWall(r, w, h, r.accent ?? 'white'));
    out.push(paintWall(r, w - 2, h - 1.34, glass));
  } else out.push(paintWall(r, w, h, glass));
  return out;
}

const KINDS: Record<string, Kind> = {
  wheel: { paint: false, facings: H4, at: 'the CENTRE of the wheel', doc: 'a tyre with a hub and an axle that reaches into the body. facing = the side of the body it is on. size = diameter (default 4). color = tyre (black), accent = hub',
    build: r => {
      const d = DIRS[r.facing], dia = Math.max(2, num(r.size, 4)), tl = Math.min(2.2, Math.max(1.2, dia * 0.4)), [x, y, z] = r.at, ax = d.xAxis ? 'x' : 'z';
      const at = (o: number): Vec3 => [x + d.x * o, y, z + d.z * o];
      return [
        { type: 'cylinder', color: r.color ?? 'black', center: at(0), radius: dia / 2, length: tl, axis: ax },
        { type: 'cylinder', color: r.accent ?? 'light_gray', center: at(tl / 2 - 0.2), radius: Math.max(0.72, dia * 0.19), length: 0.9, axis: ax },
        { type: 'box', color: 'dark_gray', center: at(-(tl / 2 + 0.9)), size: d.xAxis ? [2.4, 1.2, 1.2] : [1.2, 1.2, 2.4] },
      ];
    } },
  window: { paint: true, facings: H4, at: 'the CENTRE of the window on the wall surface', doc: 'a window painted on a wall (with a frame when 3+ wide). size = width or [width, height] (default 2x2). color = glass, accent = frame',
    build: r => windowShapes(r, 2, 2, true) },
  windshield: { paint: true, facings: H4, at: 'the CENTRE of the glass on the surface', doc: 'a big glass panel for a car, bus or rocket cabin. size = [width, height] (default 4x2). color = glass',
    build: r => windowShapes(r, 4, 2, false) },
  door: { paint: true, facings: H4, at: 'the BOTTOM centre of the door on the wall surface', doc: 'a door with a handle. size = [width, height] (default 2x4). color = door, accent = handle',
    build: r => {
      const [w, h] = wh(r.size, 2, 4), out: Shape[] = [paintWall(r, w, h, r.color ?? 'reddish_brown', h / 2)];
      if (w >= 2) out.push(paintWall(r, 1.02, 0.67, r.accent ?? 'yellow', h * 0.45, w / 4));
      return out;
    } },
  headlight: { paint: true, facings: H4, at: 'the CENTRE of the lamp on the surface', doc: 'a lamp. size default 1.5. color default yellow',
    build: r => { const s = Math.max(1.02, num(r.size, 1.5)); return [paintWall(r, s, Math.max(0.67, s * 0.67), r.color ?? 'yellow')]; } },
  taillight: { paint: true, facings: H4, at: 'the CENTRE of the lamp on the surface', doc: 'a red rear lamp. size default 1.5',
    build: r => { const s = Math.max(1.02, num(r.size, 1.5)); return [paintWall(r, s, Math.max(0.67, s * 0.67), r.color ?? 'red')]; } },
  porthole: { paint: true, facings: H4, at: 'the CENTRE of the round window on the surface', doc: 'a round window with a rim. size = diameter (default 3). color = glass, accent = rim',
    build: r => {
      const d = DIRS[r.facing], dia = Math.max(1.5, num(r.size, 3)), [x, y, z] = r.at, ax = d.xAxis ? 'x' : 'z';
      const c: Vec3 = [x - d.x * 0.75, y, z - d.z * 0.75];
      return [
        { type: 'cylinder', op: 'paint', color: r.accent ?? 'white', center: c, radius: dia / 2, length: 2, axis: ax },
        { type: 'cylinder', op: 'paint', color: r.color ?? 'medium_azure', center: c, radius: Math.max(0.72, dia / 2 - 0.7), length: 2, axis: ax },
      ];
    } },
  eye: { paint: true, facings: H4, at: 'the CENTRE of the eye on the head surface', doc: 'an eye (white with a dark pupil). size default 1.5. Use it on both sides of a head, or with mirror_x. color = white of the eye, accent = pupil',
    build: r => { const s = Math.max(1.02, num(r.size, 1.5)); return [paintWall(r, s, Math.max(1, s * 0.9), r.color ?? 'white'), paintWall(r, 1.02, Math.max(0.67, s * 0.45), r.accent ?? 'black')]; } },
  spot: { paint: true, facings: [...H4, '+y'], at: 'the CENTRE of the spot on the surface', doc: 'a round dot of colour: nose, nostril, button, belly patch, tail tip. size = diameter (default 1.5). facing +y paints the top',
    build: r => {
      const rad = Math.max(0.72, num(r.size, 1.5) / 2), [x, y, z] = r.at, color = r.color ?? 'black';
      if (r.facing === '+y') return [{ type: 'cylinder', op: 'paint', color, center: [x, y - 0.75, z], radius: rad, length: 2, axis: 'y' }];
      const d = DIRS[r.facing];
      return [{ type: 'cylinder', op: 'paint', color, center: [x - d.x * 0.75, y, z - d.z * 0.75], radius: rad, length: 2, axis: d.xAxis ? 'x' : 'z' }];
    } },
  hoof: { paint: true, facings: ['+z'], at: 'the BOTTOM centre of the foot', doc: 'colours the bottom of a leg like a hoof or a shoe. size = width (default 2). color default dark_gray',
    build: r => { const s = Math.max(1.02, num(r.size, 2)), [x, y, z] = r.at; return [{ type: 'box', op: 'paint', color: r.color ?? 'dark_gray', center: [x, y + 0.33, z], size: [s, 0.67, s] }]; } },
  ear: { paint: false, facings: ['+z'], at: 'the BOTTOM centre of the ear, on top of the head', doc: 'a pointed ear standing up. size default 2. color default light_gray (give it the head colour)',
    build: r => { const s = num(r.size, 2); return [{ type: 'cone', color: r.color ?? 'light_gray', center: [...r.at] as Vec3, radius: Math.max(1.05, s * 0.5), length: Math.max(1.5, s * 1.3) }]; } },
  horn: { paint: false, facings: ['+z'], at: 'the BOTTOM centre of the horn, on top of the head', doc: 'a tall thin horn (unicorn, rhino, narwhal). size = height (default 4). color default yellow',
    build: r => {
      const s = Math.max(2, num(r.size, 4)), [x, y, z] = r.at, c = r.color ?? 'yellow';
      return [{ type: 'cone', color: c, center: [cell(x), y, cell(z)], radius: 1.3, length: s * 0.4 }, col(x, y, z, s, c)];
    } },
  antenna: { paint: false, facings: ['+z'], at: 'the BOTTOM centre of the antenna', doc: 'a thin mast with a ball on top. size = height (default 3). color = mast, accent = ball',
    build: r => {
      const s = Math.max(1.5, num(r.size, 3)), [x, y, z] = r.at;
      return [col(x, y, z, s, r.color ?? 'dark_gray'), { type: 'sphere', color: r.accent ?? 'red', center: [cell(x), y + s, cell(z)], size: [1.6, 1.6, 1.6] }];
    } },
  wing: { paint: false, facings: H4, at: 'the BOTTOM of the wing where it joins the body', doc: 'a flat tapering wing. facing = the side it sticks out toward. size = length (default 5). Use mirror_x for a pair',
    build: r => {
      const d = DIRS[r.facing], len = Math.max(2, num(r.size, 5)), chord = Math.max(2, len * 0.7), [x, y, z] = r.at;
      return [{ type: 'wedge', color: r.color ?? 'light_gray', center: [x + d.x * (len / 2 - 0.5), y + 0.5, z + d.z * (len / 2 - 0.5)], size: d.xAxis ? [len, 1, chord] : [chord, 1, len], slope: r.facing as Shape['slope'] }];
    } },
  fin: { paint: false, facings: H4, at: 'the BOTTOM of the fin where it joins the body', doc: 'a triangular fin (rocket, shark, tail fin). facing = the side it sticks out toward. size = height (default 4)',
    build: r => {
      const d = DIRS[r.facing], h = Math.max(2, num(r.size, 4)), len = Math.max(1.5, h * 0.6), [x, y, z] = r.at;
      return [{ type: 'wedge', color: r.color ?? 'red', center: [x + d.x * (len / 2 - 0.5), y + h / 2, z + d.z * (len / 2 - 0.5)], size: d.xAxis ? [len, h, 1.02] : [1.02, h, len], slope: r.facing as Shape['slope'] }];
    } },
  tower: { paint: false, facings: H4, at: 'the BOTTOM centre of the tower', doc: 'a round tower with a pointed roof and a window. size = diameter (default 4; 3 or more). color = walls, accent = roof',
    build: r => {
      const dia = Math.max(3, num(r.size, 4)), h = dia * 2, [x, y, z] = r.at, d = DIRS[r.facing];
      const out: Shape[] = [
        { type: 'cylinder', color: r.color ?? 'light_gray', center: [x, y + h / 2, z], radius: dia / 2, length: h, axis: 'y' },
        { type: 'cone', color: r.accent ?? 'red', center: [x, y + h, z], radius: dia / 2 + 0.5, length: dia },
      ];
      if (dia >= 4) out.push(paintWall({ ...r, at: [x + d.x * dia / 2, y + h * 0.6, z + d.z * dia / 2] }, 1.5, 2, 'medium_azure'));
      return out;
    } },
  roof: { paint: false, facings: H4, at: 'the BOTTOM centre of the roof, on top of the walls', doc: 'a pitched roof. size = [width, height, depth] (default 10x4x10). The ridge runs front to back; facing +x or -x turns it. color default red',
    build: r => {
      const [w, h, dd] = Array.isArray(r.size) ? [Math.max(2, r.size[0]), Math.max(1, r.size[1] ?? r.size[0] * 0.4), Math.max(2, r.size[2] ?? r.size[0])] : (() => { const s = Math.max(2, num(r.size, 10)); return [s, s * 0.4, s]; })();
      const [x, y, z] = r.at, c = r.color ?? 'red', cy = y + h / 2;
      if (DIRS[r.facing].xAxis) return [
        { type: 'wedge', color: c, center: [x, cy, z - dd / 4], size: [w, h, dd / 2], slope: '-z' },
        { type: 'wedge', color: c, center: [x, cy, z + dd / 4], size: [w, h, dd / 2], slope: '+z' },
      ];
      return [
        { type: 'wedge', color: c, center: [x - w / 4, cy, z], size: [w / 2, h, dd], slope: '-x' },
        { type: 'wedge', color: c, center: [x + w / 4, cy, z], size: [w / 2, h, dd], slope: '+x' },
      ];
    } },
  chimney: { paint: false, facings: ['+z'], at: 'the BOTTOM centre of the chimney, on the roof', doc: 'a brick chimney with a dark cap. size = height (default 3)',
    build: r => {
      const s = Math.max(1.5, num(r.size, 3)), [x, y, z] = r.at, cx = edge(x), cz = edge(z);
      return [{ type: 'box', color: r.color ?? 'dark_red', center: [cx, y + s / 2, cz], size: [2, s, 2] }, { type: 'box', op: 'paint', color: r.accent ?? 'black', center: [cx, y + s - 0.33, cz], size: [2, 0.67, 2] }];
    } },
  battlement: { paint: false, facings: H4, at: 'the TOP centre of the wall, where the little blocks go', doc: 'a row of castle teeth along the top of a wall. facing = the way the wall faces; size = length of the wall (default 8)',
    build: r => {
      const d = DIRS[r.facing], len = Math.min(24, Math.max(2, num(r.size, 8))), [x, y, z] = r.at, out: Shape[] = [];
      for (let u = -len / 2 + 0.5; u <= len / 2 - 0.5 + 1e-6; u += 2) {
        const px = d.xAxis ? x : x + u, pz = d.xAxis ? z + u : z;
        out.push(col(px, y, pz, 1, r.color ?? 'light_gray'));
      }
      return out;
    } },
  tree: { paint: false, facings: ['+z'], at: 'the BOTTOM centre of the trunk', doc: 'a tree with a trunk and a round crown. size = height (default 6). color = crown, accent = trunk',
    build: r => {
      const hgt = Math.max(3, num(r.size, 6)), [x, y, z] = r.at, cx = edge(x), cz = edge(z), tr = hgt * 0.4, cd = hgt * 0.65;
      return [{ type: 'box', color: r.accent ?? 'reddish_brown', center: [cx, y + tr / 2, cz], size: [2, tr, 2] }, { type: 'sphere', color: r.color ?? 'green', center: [cx, y + tr + cd * 0.35, cz], size: [cd, cd * 1.05, cd] }];
    } },
  flag: { paint: false, facings: H4, at: 'the BOTTOM centre of the flag pole', doc: 'a pole with a flag. facing = the way the flag flies; size = pole height (default 6). color = flag, accent = pole',
    build: r => {
      const d = DIRS[r.facing], h = Math.max(3, num(r.size, 6)), [x, y, z] = r.at, px = cell(x), pz = cell(z);
      return [col(x, y, z, h, r.accent ?? 'light_gray'),
        { type: 'box', color: r.color ?? 'red', center: [px + d.x * 2, y + h - 0.9, pz + d.z * 2], size: d.xAxis ? [3, 1.5, 1.02] : [1.02, 1.5, 3] }];
    } },
  bumper: { paint: false, facings: H4, at: 'the BOTTOM centre of the bumper on the front or back surface', doc: 'a car bumper bar. size = width (default 6). color default dark_gray',
    build: r => { const d = DIRS[r.facing], w = Math.max(2, num(r.size, 6)), [x, y, z] = r.at; return [{ type: 'box', color: r.color ?? 'dark_gray', center: [x + d.x * 0.25, y + 0.5, z + d.z * 0.25], size: d.xAxis ? [1.5, 1, w] : [w, 1, 1.5] }]; } },
};

export const FEATURE_KINDS = Object.keys(KINDS);

/** One line per kind for the AI's prompt, generated from the table above so the two can never disagree. */
export function featureCatalogText(): string {
  return FEATURE_KINDS.map(k => `- ${k}: ${KINDS[k].doc}. "at" = ${KINDS[k].at}.`).join('\n');
}

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Plain-English problems with a raw "features" list (empty when fine). */
export function validateFeatures(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) return ['spec.features must be an array'];
  const errors: string[] = [];
  if (raw.length > MAX_FEATURES) errors.push(`too many features (max ${MAX_FEATURES})`);
  raw.slice(0, MAX_FEATURES).forEach((f: any, i: number) => {
    const p = `features[${i}]`;
    if (!f || typeof f !== 'object') { errors.push(`${p} must be an object`); return; }
    const k = KINDS[f.kind];
    if (!k || !Object.prototype.hasOwnProperty.call(KINDS, f.kind)) { errors.push(`${p}.kind "${String(f.kind)}" is not one of: ${FEATURE_KINDS.join(', ')}`); return; }
    if (!Array.isArray(f.at) || f.at.length !== 3 || !f.at.every((n: unknown) => isNum(n) && Math.abs(n) <= 100)) errors.push(`${p}.at must be [x,y,z] numbers`);
    if (f.size !== undefined) {
      const ok = isNum(f.size) ? f.size > 0 && f.size <= MAX_SIZE : Array.isArray(f.size) && f.size.length >= 1 && f.size.length <= 3 && f.size.every((n: unknown) => isNum(n) && n > 0 && n <= MAX_SIZE);
      if (!ok) errors.push(`${p}.size must be a positive number (or [width, height]) of at most ${MAX_SIZE}`);
    }
    if (f.facing !== undefined && !k.facings.includes(f.facing)) errors.push(`${p}.facing for a ${f.kind} must be one of ${k.facings.join(', ')}`);
    for (const c of ['color', 'accent']) if (f[c] !== undefined && !(typeof f[c] === 'string' && resolveColor(f[c]))) errors.push(`${p}.${c} "${String(f[c])}" is not a LEGO colour. Use one of: ${COLORS.map(x => x.id).join(', ')}`);
  });
  return errors;
}

/** Normalise a validated raw list (drops unknown keys, fills the default facing). */
export function cleanFeatures(raw: unknown): Feature[] {
  return (Array.isArray(raw) ? raw : []).slice(0, MAX_FEATURES).map((f: any) => {
    const out: Feature = { kind: f.kind, at: [f.at[0], f.at[1], f.at[2]] };
    if (f.size !== undefined) out.size = Array.isArray(f.size) ? [...f.size] : f.size;
    if (f.facing) out.facing = f.facing;
    if (f.color) out.color = f.color;
    if (f.accent) out.accent = f.accent;
    return out;
  });
}

/**
 * Shapes for every feature. Parts that add material come first and parts that only paint come last, so a window painted
 * on a tower works wherever the AI listed it.
 */
export function expandFeatures(features: Feature[] | undefined): Shape[] {
  const adds: Shape[] = [], paints: Shape[] = [];
  for (const f of features ?? []) {
    const k = KINDS[f.kind];
    if (!k) continue;
    const facing = (k.facings.includes(f.facing as Facing) ? f.facing : k.facings.includes('+z') ? '+z' : k.facings[0]) as Facing;
    (k.paint ? paints : adds).push(...k.build({ ...f, facing, at: f.at }).map(s => ({ ...s, op: s.op ?? 'add' })));
  }
  return [...adds, ...paints];
}
