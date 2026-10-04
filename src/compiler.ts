import { PARTS, PART_BY_ID, resolveColor, COLORS, PLATES_PER_STUD, BRICK_H } from './catalog';
import { ShapeSpec, expand, specBounds, inside } from './shapes';
import { unitsOf } from './features';
import { UNITS, unitFootprint } from './specials';

export interface Placed {
  id: number;
  part: string;     // catalog id
  color: string;    // colour id
  x: number; y: number; z: number; // min corner: studs, studs, plates
  fx: number; fz: number;          // footprint in studs after rotation
  h: number;                       // height in plates
  special?: { facing: '+x' | '-x' | '+z' | '-z'; accent?: string };   // a real non-rectangular part (wheel unit, window, door): which way it faces, and its second colour
}
export interface Model {
  name: string;
  parts: Placed[];
  size: [number, number, number];  // studs x, studs z, plates y
  origin: [number, number, number]; // spec-space stud coords of grid cell (0,0,0) corner: x, y(studs), z
  variant: number;
  lift?: number;                   // studs the whole model stands above the baseplate (wheel units hang below the body)
  unplaced?: string[];             // real-part units the AI asked for that could not be put in the model (plain-English, reported by the validator)
}
export interface Grid { nx: number; ny: number; nz: number; cells: Uint8Array; palette: string[]; origin: [number, number, number]; plateOnly?: Uint8Array; forced?: { x: number; y: number; z: number; fx: number; fz: number; color: number }[];
  /** Volumes taken by real-part units (wheel holders, windows, doors): the packer leaves them alone and the real part is added instead. */
  unplaced?: string[];
  fixed?: { x: number; y: number; z: number; fx: number; fz: number; h: number; color: number; special: { unit: string; facing: '+x' | '-x' | '+z' | '-z'; accent?: string } }[]; }

const idx = (g: Grid, x: number, y: number, z: number) => (y * g.nz + z) * g.nx + x;

const niceName = (unit: string) => (unit.startsWith('window') ? 'window' : unit === 'windscreen' ? 'windshield' : unit.startsWith('slope') ? 'slope' : unit);

/** Turn shapes into a voxel grid (1 stud x 1 stud x 1 plate). */
export function voxelize(spec: ShapeSpec): Grid {
  const shapes = expand(spec);
  const b = specBounds(spec)!;
  const ox = Math.floor(b.min[0] + 1e-6), oy = b.min[1], oz = Math.floor(b.min[2] + 1e-6);
  const nx = Math.max(1, Math.ceil(b.max[0] - ox - 1e-6)), nz = Math.max(1, Math.ceil(b.max[2] - oz - 1e-6));
  const ny = Math.max(1, Math.round((b.max[1] - oy) * PLATES_PER_STUD));
  const palette: string[] = [''];
  const pIdx = new Map<string, number>();
  const cid = (c: string) => {
    const id = resolveColor(c)!.id;
    if (!pIdx.has(id)) { pIdx.set(id, palette.length); palette.push(id); }
    return pIdx.get(id)!;
  };
  const cells = new Uint8Array(nx * ny * nz);
  const g: Grid = { nx, ny, nz, cells, palette, origin: [ox, oy, oz] };
  const sh = shapes.map(s => ({ s, c: s.op === 'subtract' ? 0 : cid(s.color!) }));
  for (let y = 0; y < ny; y++) {
    const py = oy + (y + 0.5) / PLATES_PER_STUD;
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
      const px = ox + x + 0.5, pz = oz + z + 0.5;
      let v = 0;
      for (const { s, c } of sh) {
        if (!inside(s, px, py, pz)) continue;
        if (s.op === 'add') v = c; else if (s.op === 'subtract') v = 0; else if (v) v = c;
      }
      cells[idx(g, x, y, z)] = v;
    }
  }
  // Real-part units (wheel holders, windows, doors): reserve their volume so the packer places the real part and nothing else there.
  for (const u of unitsOf(spec.features, !!spec.mirror_x)) {
    const def = UNITS[u.unit], { fx, fz, h } = unitFootprint(u.unit, u.facing), alongZ = u.facing === '+z' || u.facing === '-z';
    let x: number, z: number, y: number;
    if (def.cls === 'hang') {                                           // wheel holder: centred under the body, its top at the height the tyre needs
      x = Math.round(u.cx - fx / 2 - ox); z = Math.round(u.cz - fz / 2 - oz); y = Math.round((u.topY - h * 0.4 - oy) * PLATES_PER_STUD);
    } else if (def.cls === 'block') {                                   // a plain block (slope): its footprint corner is where the AI said, no wall to find
      x = Math.round(u.at[0] - fx / 2 - ox); z = Math.round(u.at[2] - fz / 2 - oz); y = Math.round((u.at[1] - oy) * PLATES_PER_STUD);
    } else {                                                            // wall unit: fills the opening just inside the wall's outer surface
      y = Math.round((u.at[1] - oy) * PLATES_PER_STUD - (def.anchorY === 'bottom' ? 0 : h / 2));
      const plus = u.facing === '+z' || u.facing === '+x';
      const first = alongZ ? (plus ? Math.floor(u.at[2] - 1e-6) : Math.floor(u.at[2] + 1e-6)) - oz : (plus ? Math.floor(u.at[0] - 1e-6) : Math.floor(u.at[0] + 1e-6)) - ox;
      const lat = alongZ ? Math.round(u.at[0] - fx / 2 - ox) : Math.round(u.at[2] - fz / 2 - oz);
      // the AI's surface can be a little off: use the outermost layer near it that actually has wall behind the opening
      const hasWall = (layer: number) => {
        for (let dy = 0; dy < h; dy++) for (let k = 0; k < (alongZ ? fx : fz); k++) {
          const X = alongZ ? lat + k : layer, Z = alongZ ? layer : lat + k, Y = y + dy;
          if (X >= 0 && Z >= 0 && Y >= 0 && X < nx && Z < nz && Y < ny && cells[idx(g, X, Y, Z)]) return true;
        }
        return false;
      };
      const layer = [first, first + (plus ? -1 : 1), first + (plus ? 1 : -1)].find(hasWall) ?? first;
      if (alongZ) { x = lat; z = plus ? layer - fz + 1 : layer; } else { z = lat; x = plus ? layer - fx + 1 : layer; }
    }
    if (def.cls === 'wall' && y + h > ny && y < ny && ny >= h) y = ny - h;           // asked too high: slide down just enough to fit inside the wall
    const clash = (g.fixed ?? []).find(f => x < f.x + f.fx && f.x < x + fx && z < f.z + f.fz && f.z < z + fz && y < f.y + f.h && f.y < y + h);
    if (clash) {
      (g.unplaced ??= []).push(`The ${niceName(u.unit)} at (${u.at.map(v => +v.toFixed(1)).join(', ')}) overlaps the ${niceName(clash.special.unit)} already placed there: move one of them.`);
      continue;
    }
    if (x < 0 || z < 0 || y < 0 || x + fx > nx || z + fz > nz || y + h > ny) {
      (g.unplaced ??= []).push(`The ${niceName(u.unit)} at (${u.at.map(v => +v.toFixed(1)).join(', ')}) facing ${u.facing} is not on the model: put it on the outer surface of a wall or body that is there.`);
      continue;
    }
    const ci = cid(def.parts[0].colour ?? u.color);
    for (let dy = 0; dy < h; dy++) for (let dz = 0; dz < fz; dz++) for (let dx = 0; dx < fx; dx++) cells[idx(g, x + dx, y + dy, z + dz)] = ci;
    (g.fixed ??= []).push({ x, y, z, fx, fz, h, color: ci, special: { unit: u.unit, facing: u.facing, ...(u.accent ? { accent: u.accent } : {}) } });
    if (def.cls === 'hang') {                                           // short posts in the body's colour from the holder up to the body, so a body that sits a little high is still attached
      for (let dz = 0; dz < fz; dz++) for (let dx = 0; dx < fx; dx++) {
        let up = y + h; while (up < ny && !cells[idx(g, x + dx, up, z + dz)]) up++;
        if (up < ny && up > y + h) { const c = cells[idx(g, x + dx, up, z + dz)]; for (let k = y + h; k < up; k++) cells[idx(g, x + dx, k, z + dz)] = c; }
      }
    }
  }
  return g;
}

/** Remove voxel groups that are not held up (6-connected to the ground). Returns count removed. */
export function pruneFloating(g: Grid, maxRemove = 12): number {
  const seen = new Uint8Array(g.cells.length);
  const groups: number[][] = [];
  const stack: number[] = [];
  for (let i = 0; i < g.cells.length; i++) {
    if (!g.cells[i] || seen[i]) continue;
    const comp: number[] = []; let grounded = false;
    stack.push(i); seen[i] = 1;
    while (stack.length) {
      const c = stack.pop()!; comp.push(c);
      const x = c % g.nx, z = Math.floor(c / g.nx) % g.nz, y = Math.floor(c / (g.nx * g.nz));
      if (y === 0) grounded = true;
      const nb = [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
      for (const [dx, dy, dz] of nb) {
        const X = x + dx, Y = y + dy, Z = z + dz;
        if (X < 0 || Y < 0 || Z < 0 || X >= g.nx || Y >= g.ny || Z >= g.nz) continue;
        const j = idx(g, X, Y, Z);
        if (g.cells[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!grounded) groups.push(comp);
  }
  let removed = 0;
  for (const comp of groups) if (comp.length <= maxRemove) { for (const c of comp) g.cells[c] = 0; removed += comp.length; }
  return removed;
}

/** Fill columns of cells that hang in the air with a support of the same colour down to the nearest solid below. */
export function addSupports(g: Grid): number {
  let added = 0;
  for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
    let last = -1; // index of last filled y seen scanning up
    for (let y = 0; y < g.ny; y++) {
      const v = g.cells[idx(g, x, y, z)];
      if (!v) continue;
      if (y > 0 && !g.cells[idx(g, x, y - 1, z)]) {
        // gap below: is there something below in this column? if not, we don't add (would create pillars from nothing)
        if (last >= 0) { for (let k = last + 1; k < y; k++) { g.cells[idx(g, x, k, z)] = v; added++; } }
      }
      last = y;
    }
  }
  return added;
}

interface Rect { w: number; d: number; part: string }
const rectsFor = (kind: 'brick' | 'plate'): Rect[] => {
  const out: Rect[] = [];
  for (const p of PARTS) if (p.kind === kind) {
    out.push({ w: p.w, d: p.d, part: p.id });
    if (p.w !== p.d) out.push({ w: p.d, d: p.w, part: p.id });
  }
  return out;
};
const BRICK_RECTS = rectsFor('brick'), PLATE_RECTS = rectsFor('plate');

/** Greedy pack a 2D mask (per colour) into real rectangles. variant controls orientation/scan strategy. */
function mulberry(a: number) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function pack2D(mask: Uint8Array, nx: number, nz: number, rects: Rect[], layerParity: number, variant: number) {
  const rng = variant >= 8 ? mulberry(variant * 7919 + layerParity * 104729 + nx * 31 + nz) : null;
  const out: { x: number; z: number; r: Rect }[] = [];
  const free = (x: number, z: number) => x >= 0 && z >= 0 && x < nx && z < nz && mask[z * nx + x] === 1;
  const preferX = ((layerParity + (variant & 1)) & 1) === 0; // run along x on this layer?
  const zMajor = (variant & 2) !== 0;
  const reverse = (variant & 4) !== 0;
  const order: [number, number][] = [];
  if (zMajor) for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) order.push([x, z]);
  else for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) order.push([x, z]);
  if (reverse) order.reverse();
  for (const [x0, z0] of order) {
    if (!free(x0, z0)) continue;
    let best: { r: Rect; ax: number; az: number; score: number } | null = null;
    for (const r of rects) {
      // anchor: try all offsets so the anchor cell is inside the rect (reverse order pass needs it)
      for (let ox = 0; ox < r.w; ox++) for (let oz = 0; oz < r.d; oz++) {
        const ax = x0 - ox, az = z0 - oz;
        let ok = true;
        for (let dz = 0; dz < r.d && ok; dz++) for (let dx = 0; dx < r.w; dx++) if (!free(ax + dx, az + dz)) { ok = false; break; }
        if (!ok) continue;
        const area = r.w * r.d;
        const orient = (r.w >= r.d) === preferX ? 0.5 : 0;
        // prefer big parts, along preferred direction; slight penalty for wide 2xN over 1xN so seams can stagger
        const score = area + orient + (r.w === 1 || r.d === 1 ? 0.2 : 0) - (ox + oz) * 0.01 + (rng ? rng() * 3.5 : 0);
        if (!best || score > best.score) best = { r, ax, az, score };
      }
    }
    if (!best) continue;
    for (let dz = 0; dz < best.r.d; dz++) for (let dx = 0; dx < best.r.w; dx++) mask[(best.az + dz) * nx + best.ax + dx] = 0;
    out.push({ x: best.ax, z: best.az, r: best.r });
  }
  return out;
}

/** Pack a voxel grid into real parts. */
export function packGrid(g: Grid, name = 'Model', variant = 0): Model {
  const parts: Placed[] = [];
  let id = 0;
  const layer = (y0: number, cellColor: (x: number, z: number) => number, rects: Rect[], parity: number) => {
    const byColor = new Map<number, Uint8Array>();
    for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) {
      const c = cellColor(x, z);
      if (!c) continue;
      if (!byColor.has(c)) byColor.set(c, new Uint8Array(g.nx * g.nz));
      byColor.get(c)![z * g.nx + x] = 1;
    }
    for (const [c, mask] of byColor) {
      for (const p of pack2D(mask, g.nx, g.nz, rects, parity, variant)) {
        parts.push({ id: id++, part: p.r.part, color: g.palette[c], x: p.x, y: y0, z: p.z, fx: p.r.w, fz: p.r.d, h: PART_BY_ID[p.r.part].h });
      }
    }
  };
  const fixedMask = new Uint8Array(g.cells.length);
  for (const f of g.fixed ?? []) for (let dy = 0; dy < f.h; dy++) for (let dz = 0; dz < f.fz; dz++) for (let dx = 0; dx < f.fx; dx++) fixedMask[idx(g, f.x + dx, f.y + dy, f.z + dz)] = 1;
  for (let r = 0; r * BRICK_H < g.ny; r++) {
    const y0 = r * BRICK_H;
    const solid = (x: number, z: number) => {
      if (y0 + BRICK_H > g.ny) return 0;
      if (fixedMask[idx(g, x, y0, z)] || fixedMask[idx(g, x, y0 + 1, z)] || fixedMask[idx(g, x, y0 + 2, z)]) return 0;
      const a = g.cells[idx(g, x, y0, z)];
      if (!a) return 0;
      if (g.plateOnly && (g.plateOnly[idx(g, x, y0, z)] || g.plateOnly[idx(g, x, y0 + 1, z)] || g.plateOnly[idx(g, x, y0 + 2, z)])) return 0;
      return g.cells[idx(g, x, y0 + 1, z)] === a && g.cells[idx(g, x, y0 + 2, z)] === a ? a : 0;
    };
    // forced bridge plates make their 3-plate row plate-only in those columns
    for (const f of g.forced ?? []) if (f.y >= y0 && f.y < y0 + BRICK_H) {
      if (!g.plateOnly) g.plateOnly = new Uint8Array(g.cells.length);
      for (let dz = 0; dz < f.fz; dz++) for (let dx = 0; dx < f.fx; dx++) for (let k = 0; k < BRICK_H; k++) g.plateOnly[idx(g, f.x + dx, y0 + k, f.z + dz)] = 1;
    }
    // brick pass
    const brickCells = new Uint8Array(g.nx * g.nz);
    for (let z = 0; z < g.nz; z++) for (let x = 0; x < g.nx; x++) brickCells[z * g.nx + x] = solid(x, z);
    layer(y0, (x, z) => brickCells[z * g.nx + x], BRICK_RECTS, r);
    // plate passes for cells that are not full-height same colour bricks
    for (let k = 0; k < BRICK_H && y0 + k < g.ny; k++) {
      const fmask = new Uint8Array(g.nx * g.nz);
      for (const f of g.forced ?? []) if (f.y === y0 + k) {
        for (let dz = 0; dz < f.fz; dz++) for (let dx = 0; dx < f.fx; dx++) fmask[(f.z + dz) * g.nx + f.x + dx] = 1;
        parts.push({ id: id++, part: `plate-${Math.min(f.fx, f.fz)}x${Math.max(f.fx, f.fz)}`, color: g.palette[f.color], x: f.x, y: y0 + k, z: f.z, fx: f.fx, fz: f.fz, h: 1 });
      }
      layer(y0 + k, (x, z) => (brickCells[z * g.nx + x] || fmask[z * g.nx + x] || fixedMask[idx(g, x, y0 + k, z)] ? 0 : g.cells[idx(g, x, y0 + k, z)]), PLATE_RECTS, r * BRICK_H + k);
    }
  }
  for (const f of g.fixed ?? []) parts.push({ id: id++, part: `unit-${f.special.unit}`, color: g.palette[f.color], x: f.x, y: f.y, z: f.z, fx: f.fx, fz: f.fz, h: f.h, special: { facing: f.special.facing, ...(f.special.accent ? { accent: f.special.accent } : {}) } });
  const lift = (g.fixed ?? []).some(f => UNITS[f.special.unit].cls === 'hang') ? +g.origin[1].toFixed(2) : undefined;
  return { name, parts, size: [g.nx, g.nz, g.ny], origin: g.origin, variant, ...(lift ? { lift } : {}), ...(g.unplaced?.length ? { unplaced: g.unplaced } : {}) };
}

export function compileSpec(spec: ShapeSpec, variant = 0, opts: { prune?: boolean; support?: boolean } = {}): { model: Model; grid: Grid; removed: number; supported: number } {
  const grid = voxelize(spec);
  const removed = opts.prune ? pruneFloating(grid) : 0;
  const supported = opts.support ? addSupports(grid) : 0;
  return { model: packGrid(grid, spec.name, variant), grid, removed, supported };
}

export function specCoord(model: Model, p: { x: number; y: number; z: number }): [number, number, number] {
  return [+(model.origin[0] + p.x).toFixed(1), +(model.origin[1] + p.y / PLATES_PER_STUD).toFixed(1), +(model.origin[2] + p.z).toFixed(1)];
}
export { COLORS };
