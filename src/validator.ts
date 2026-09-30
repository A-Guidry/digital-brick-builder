import { Model, Placed, specCoord } from './compiler';
import { PART_BY_ID, COLOR_BY_ID } from './catalog';

export interface Problem {
  code: 'overlap' | 'unknown_part' | 'unknown_color' | 'disconnected' | 'build_order' | 'too_big' | 'empty';
  message: string;
  partIds: number[];
  at?: [number, number, number]; // spec-space studs
}
export interface Report { ok: boolean; problems: Problem[]; warnings: string[]; stats: { parts: number; components: number; grounded: number; weakLinks: number; hanging: number }; }
export const MAX_PARTS = 2500;

/** Build the stud-contact graph. Two parts connect if one sits directly on top of the other and footprints overlap. */
export function contacts(parts: Placed[]) {
  const occ = new Map<string, number>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const overlaps: [number, number, Placed][] = [];
  for (const p of parts) for (let y = p.y; y < p.y + p.h; y++) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) {
    const k = key(x, y, z);
    if (occ.has(k)) overlaps.push([occ.get(k)!, p.id, p]); else occ.set(k, p.id);
  }
  const below = new Map<number, Set<number>>(), above = new Map<number, Set<number>>();
  for (const p of parts) { below.set(p.id, new Set()); above.set(p.id, new Set()); }
  const shared = new Map<string, number>();
  for (const p of parts) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) {
    const under = occ.get(key(x, p.y - 1, z));
    if (under !== undefined && under !== p.id) {
      below.get(p.id)!.add(under); above.get(under)!.add(p.id);
      const kk = `${under}-${p.id}`; shared.set(kk, (shared.get(kk) ?? 0) + 1);
    }
  }
  return { occ, below, above, overlaps, shared };
}

/** Layer-by-layer build order. Each part must touch the ground plate or something already built.
 *  Parts that hang under something (nothing beneath them) are pressed on from below once the part above exists. */
export function buildOrder(parts: Placed[], c = contacts(parts)): { order: Placed[]; stuck: Placed[]; hanging: Set<number> } {
  const sorted = [...parts].sort((a, b) => a.y - b.y || a.z - b.z || a.x - b.x);
  const built = new Set<number>(), order: Placed[] = [], hanging = new Set<number>();
  let remaining = sorted;
  while (remaining.length) {
    let pick = -1, viaAbove = false;
    for (let i = 0; i < remaining.length; i++) {
      const p = remaining[i];
      if (p.y === 0 || [...c.below.get(p.id)!].some(u => built.has(u))) { pick = i; break; }
    }
    if (pick < 0) for (let i = 0; i < remaining.length; i++) {
      if ([...c.above.get(remaining[i].id)!].some(u => built.has(u))) { pick = i; viaAbove = true; break; }
    }
    if (pick < 0) break;
    const p = remaining[pick];
    if (viaAbove) hanging.add(p.id);
    built.add(p.id); order.push(p);
    remaining = remaining.slice(0, pick).concat(remaining.slice(pick + 1));
  }
  return { order, stuck: remaining, hanging };
}

export function validate(model: Model): Report {
  const problems: Problem[] = [];
  const warnings: string[] = [];
  const { parts } = model;
  const zero = { parts: 0, components: 0, grounded: 0, weakLinks: 0, hanging: 0 };
  if (parts.length === 0) return { ok: false, problems: [{ code: 'empty', message: 'Model has no parts', partIds: [] }], warnings, stats: zero };
  if (parts.length > MAX_PARTS) problems.push({ code: 'too_big', message: `Model needs ${parts.length} parts; the limit is ${MAX_PARTS}. Make it smaller or simpler.`, partIds: [] });
  for (const p of parts) {
    if (!PART_BY_ID[p.part]) problems.push({ code: 'unknown_part', message: `Part "${p.part}" is not in the catalog`, partIds: [p.id] });
    if (!COLOR_BY_ID[p.color]) problems.push({ code: 'unknown_color', message: `Colour "${p.color}" is not a real LEGO colour`, partIds: [p.id] });
  }
  const c = contacts(parts);
  for (const [a, b, p] of c.overlaps) problems.push({ code: 'overlap', message: `Parts ${a} and ${b} occupy the same space`, partIds: [a, b], at: specCoord(model, p) });

  // Stud-contact graph: one connected piece? (the ground plate does not count as glue)
  const N = parts.length, ix = new Map(parts.map((p, i) => [p.id, i]));
  const uf = Array.from({ length: N }, (_, i) => i);
  const find = (a: number): number => (uf[a] === a ? a : (uf[a] = find(uf[a])));
  for (const p of parts) for (const u of c.below.get(p.id)!) uf[find(ix.get(p.id)!)] = find(ix.get(u)!);
  const groups = new Map<number, Placed[]>();
  for (const p of parts) { const r = find(ix.get(p.id)!); if (!groups.has(r)) groups.set(r, []); groups.get(r)!.push(p); }
  const biggest = [...groups.entries()].reduce((a, b) => (b[1].length > a[1].length ? b : a))[0];
  const comps = groups.size;
  groups.delete(biggest);
  for (const g of groups.values()) {
    const first = g.reduce((a, b) => (b.y < a.y ? b : a));
    problems.push({ code: 'disconnected', message: `A group of ${g.length} part(s) is not joined to the main model by studs (they only touch sideways or not at all); lowest part near ${specCoord(model, first).join(', ')}`, partIds: g.map(p => p.id), at: specCoord(model, first) });
  }
  // A build order must exist that attaches every part to something already built.
  const bo = buildOrder(parts, c);
  if (bo.stuck.length && groups.size === 0) problems.push({ code: 'build_order', message: `${bo.stuck.length} part(s) cannot be attached in any build order`, partIds: bo.stuck.map(p => p.id) });
  if (bo.hanging.size) warnings.push(`${bo.hanging.size} part(s) hang under something and are pressed on from below (allowed).`);
  let weak = 0;
  for (const n of c.shared.values()) if (n === 1) weak++;
  if (weak > parts.length * 0.5) warnings.push('Many parts are held by a single stud; the model may be fragile.');
  return { ok: problems.length === 0, problems, warnings, stats: { parts: parts.length, components: comps, grounded: parts.filter(p => p.y === 0).length, weakLinks: weak, hanging: bo.hanging.size } };
}

export function formatProblems(rep: Report, limit = 12): string {
  return rep.problems.slice(0, limit).map((p, i) => `${i + 1}. [${p.code}] ${p.message}${p.at ? ` @ (x=${p.at[0]}, y=${p.at[1]}, z=${p.at[2]})` : ''}`).join('\n')
    + (rep.problems.length > limit ? `\n…and ${rep.problems.length - limit} more` : '');
}
