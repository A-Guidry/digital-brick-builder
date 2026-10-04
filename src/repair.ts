import { Grid, Model, Placed, compileSpec, packGrid, voxelize } from './compiler';
import { ShapeSpec, parseSpec } from './shapes';
import { Report, validate, formatProblems, contacts } from './validator';
import { Msg, systemPrompt } from './prompt';

export interface Attempt { round: number; who: 'program' | 'ai'; note: string; problems: number; ok: boolean; }
export interface BuildResult { ok: boolean; model?: Model; spec?: ShapeSpec; report?: Report; attempts: Attempt[]; message: string; }
export type Ask = (system: string, msgs: Msg[]) => Promise<string>;

const score = (r: Report) => r.problems.reduce((n, p) => n + Math.max(1, p.partIds.length), 0) + r.stats.components * 0.1;

/** Components of the stud-contact graph (as arrays of parts). */
function groups(model: Model): Placed[][] {
  const c = contacts(model.parts), byId = new Map(model.parts.map(p => [p.id, p]));
  const seen = new Set<number>(), out: Placed[][] = [];
  for (const p of model.parts) {
    if (seen.has(p.id)) continue;
    const comp: Placed[] = [], st = [p.id]; seen.add(p.id);
    while (st.length) {
      const id = st.pop()!; comp.push(byId.get(id)!);
      for (const n of [...c.below.get(id)!, ...c.above.get(id)!]) if (!seen.has(n)) { seen.add(n); st.push(n); }
    }
    out.push(comp);
  }
  return out.sort((a, b) => b.length - a.length);
}

/** Deterministic fix: add one-plate "bridge" plates across the seam where a loose group touches the main model sideways. */
export function bridge(grid: Grid, model: Model): number {
  const gs = groups(model);
  if (gs.length < 2) return 0;
  const owner = new Map<string, number>();
  gs.forEach((g, gi) => g.forEach(p => { for (let y = p.y; y < p.y + p.h; y++) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) owner.set(`${x},${y},${z}`, gi); }));
  const I = (x: number, y: number, z: number) => (y * grid.nz + z) * grid.nx + x;
  grid.forced ??= [];
  const used = new Set(grid.forced.flatMap(f => [`${f.x},${f.y},${f.z}`, `${f.x + f.fx - 1},${f.y},${f.z + f.fz - 1}`]));
  const inUnit = (x: number, y: number, z: number) => (grid.fixed ?? []).some(f => x >= f.x && x < f.x + f.fx && y >= f.y && y < f.y + f.h && z >= f.z && z < f.z + f.fz);
  let fixes = 0;
  for (let gi = 1; gi < gs.length; gi++) {
    let best: { a: [number, number, number]; b: [number, number, number]; y: number; rank: number } | null = null;
    for (const p of gs[gi]) for (let y = p.y; y < p.y + p.h; y++) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) {
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const X = x + dx, Z = z + dz;
        if (owner.get(`${X},${y},${Z}`) !== 0) continue;
        if (inUnit(x, y, z) || inUnit(X, y, Z)) continue;                    // never put a bridge plate inside a real part (a window, a door)
        if (used.has(`${x},${y},${z}`) || used.has(`${X},${y},${Z}`)) continue;
        const belowOk = owner.get(`${x},${y - 1},${z}`) === gi && owner.get(`${X},${y - 1},${Z}`) === 0;
        const aboveOk = owner.get(`${x},${y + 1},${z}`) === gi && owner.get(`${X},${y + 1},${Z}`) === 0;
        if (!belowOk && !aboveOk) continue;
        const rank = (belowOk ? 1000 : 0) + y;
        if (!best || rank > best.rank) best = { a: [x, y, z], b: [X, y, Z], y, rank };
      }
    }
    if (best) {
      const [ax, ay, az] = best.a, [bx, , bz] = best.b;
      const colour = grid.cells[I(ax, ay, az)];
      grid.cells[I(bx, ay, bz)] = colour;
      grid.forced.push({ x: Math.min(ax, bx), y: ay, z: Math.min(az, bz), fx: ax === bx ? 1 : 2, fz: az === bz ? 1 : 2, color: colour });
      used.add(`${ax},${ay},${az}`); used.add(`${bx},${ay},${bz}`);   // never let a later bridge in this pass overlap this one
      fixes++;
    }
  }
  return fixes;
}

/** Break loose regions into stacked plates (staggered seams can then interlock, single brick rows cannot). */
export function platify(grid: Grid, model: Model): number {
  const gs = groups(model);
  if (gs.length < 2) return 0;
  grid.plateOnly ??= new Uint8Array(grid.cells.length);
  let n = 0;
  for (let gi = 0; gi < gs.length; gi++) for (const p of gs[gi]) {
    if (gi === 0 && gs.length > 1 && p.h === 1) continue;
    const y0 = Math.floor(p.y / 3) * 3;
    for (let y = y0; y < y0 + 3 && y < grid.ny; y++) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) {
      const i = (y * grid.nz + z) * grid.nx + x;
      if (!grid.plateOnly[i]) { grid.plateOnly[i] = 1; n++; }
    }
  }
  return n;
}

/** Delete tiny loose bits (<= maxParts parts) that could not be joined. Returns voxels removed. */
export function dropLoose(grid: Grid, model: Model, maxParts = 4): number {
  const gs = groups(model);
  let removed = 0;
  for (let gi = 1; gi < gs.length; gi++) if (gs[gi].length <= maxParts) for (const p of gs[gi])
    for (let y = p.y; y < p.y + p.h; y++) for (let z = p.z; z < p.z + p.fz; z++) for (let x = p.x; x < p.x + p.fx; x++) {
      const i = (y * grid.nz + z) * grid.nx + x;
      if (grid.cells[i]) { grid.cells[i] = 0; removed++; }
    }
  return removed;
}

/** Everything the program can do on its own, cheapest change first. Returns the best model found. */
export function solveDeterministic(spec: ShapeSpec, note: (s: string) => void) {
  let best: { model: Model; report: Report; grid: Grid; how: string } | null = null;
  const consider = (model: Model, grid: Grid, how: string) => {
    const report = validate(model);
    if (!best || score(report) < score(best.report)) best = { model, report, grid, how };
    return report.ok;
  };
  const RANDOM = 40;
  // 1) just re-pack differently
  for (let v = 0; v < 8 + RANDOM; v++) {
    const { model, grid } = compileSpec(spec, v);
    if (consider(model, grid, `packing variant ${v}`)) { note(v ? `Fixed by re-packing (variant ${v})` : 'Packed cleanly'); return best!; }
  }
  // 2) bridge plates across colour/edge seams, on several packings
  for (const v of [best!.model.variant, 0, 1, 2, 9, 10, 11, 12, 13]) {
    const grid = voxelize(spec);
    let model = packGrid(grid, spec.name, v), total = 0;
    for (let pass = 0; pass < 12; pass++) {
      const n = bridge(grid, model);
      if (!n) break;
      total += n; model = packGrid(grid, spec.name, v);
      if (consider(model, grid, `variant ${v} + ${total} bridge plate(s)`)) { note(`Fixed by adding ${total} bridge plate(s) across seams`); return best!; }
    }
  }
  // 2b) loose regions become stacked plates so seams can interlock
  for (const v0 of [0, 1]) {
    const grid = voxelize(spec);
    let model = packGrid(grid, spec.name, v0), total = 0;
    for (let iter = 0; iter < 4; iter++) {
      if (!platify(grid, model)) break;
      for (let v = 0; v < 8 + RANDOM; v++) {
        const m = packGrid(grid, spec.name, v);
        if (consider(m, grid, `plates + variant ${v}`)) { note(`Fixed by using stacked plates for thin regions (variant ${v})`); return best!; }
      }
      for (let pass = 0; pass < 8; pass++) {
        model = packGrid(grid, spec.name, best!.model.variant);
        const n = bridge(grid, model); if (!n) break; total += n;
        const m2 = packGrid(grid, spec.name, best!.model.variant);
        if (consider(m2, grid, `plates + ${total} bridge(s)`)) { note(`Fixed by stacked plates and ${total} bridge plate(s)`); return best!; }
      }
      model = packGrid(grid, spec.name, best!.model.variant);
    }
  }
  // 3) remove tiny loose bits that cannot be joined (reported to the user)
  for (const v of [best!.model.variant, 0, 1, 9, 10, 11]) {
    const grid = voxelize(spec);
    let model = packGrid(grid, spec.name, v), total = 0, dropped = 0;
    for (let pass = 0; pass < 12; pass++) {
      const n = bridge(grid, model);
      if (n) { total += n; model = packGrid(grid, spec.name, v); if (consider(model, grid, `variant ${v} + ${total} bridge(s)`)) break; continue; }
      const d = dropLoose(grid, model);
      if (!d) break;
      dropped += d; model = packGrid(grid, spec.name, v);
      if (consider(model, grid, `variant ${v}, ${total} bridge(s), ${dropped} loose voxels removed`)) { note(`Fixed with ${total} bridge plate(s) and by removing ${dropped} loose voxel(s) that could not be joined`); return best!; }
    }
    if (best!.report.ok) { note(`Fixed with ${total} bridge plate(s) and cleanup`); return best!; }
  }
  note(`Program could not fully fix it (best attempt: ${best!.report.problems.length} problem(s))`);
  return best!;
}

export async function buildWithRepair(
  first: ShapeSpec | { rawText: string } ,
  ask: Ask | null,
  opts: { maxRounds?: number; original?: Msg; onStatus?: (s: string) => void } = {},
): Promise<BuildResult> {
  const max = opts.maxRounds ?? 4, attempts: Attempt[] = [];
  const say = opts.onStatus ?? (() => {});
  const convo: Msg[] = opts.original ? [opts.original] : [];
  let specIn = null as ShapeSpec | null;
  let parseErrors = null as string[] | null;
  const takeText = (text: string) => {
    const r = parseSpec(text);
    if (r.ok) { specIn = r.spec; parseErrors = null; } else parseErrors = r.errors;
  };
  const getErr = (): string[] | null => parseErrors;
  if ('rawText' in first) { convo.push({ role: 'assistant', text: first.rawText }); takeText(first.rawText); } else { const r = parseSpec(first); if (r.ok) specIn = r.spec; else parseErrors = r.errors; };
  let last: BuildResult | null = null;
  for (let round = 1; round <= max; round++) {
    const perr0 = getErr();
    if (perr0 || !specIn) {
      attempts.push({ round, who: 'program', note: 'Spec rejected: ' + (perr0 ?? []).slice(0, 3).join('; '), problems: perr0?.length ?? 1, ok: false });
      if (!ask) return { ok: false, attempts, message: 'The spec was rejected and no AI is available to fix it: ' + (perr0 ?? []).join('; ') };
      say(`Round ${round}: asking the AI to fix its spec…`);
      convo.push({ role: 'user', text: `Your spec was rejected:\n${(perr0 ?? []).join('\n')}\nReturn the corrected full JSON spec only.` });
      const reply = await ask(systemPrompt(), convo);
      convo.push({ role: 'assistant', text: reply }); takeText(reply);
      continue;
    }
    say(`Round ${round}: compiling and checking…`);
    const notes: string[] = [];
    const sol = solveDeterministic(specIn, s => notes.push(s));
    attempts.push({ round, who: 'program', note: notes.join('. ') || sol.how, problems: sol.report.problems.length, ok: sol.report.ok });
    last = { ok: sol.report.ok, model: sol.model, spec: specIn, report: sol.report, attempts, message: sol.report.ok ? 'Model is one connected piece and builds.' : 'Problems remain.' };
    if (sol.report.ok) return last;
    if (!ask || round === max) break;
    say(`Round ${round}: ${sol.report.problems.length} problem(s) — sending them back to the AI…`);
    convo.push({ role: 'user', text:
      `The program compiled your shapes into real LEGO parts, but the model failed these checks:\n${formatProblems(sol.report)}\n\n` +
      `Coordinates are in your spec's studs. Fix the shapes (e.g. make loose pieces overlap the main body so they stack on top of it, thicken thin joins, give floating parts something to rest on). ` +
      `Return the corrected full JSON spec only.` });
    const reply = await ask(systemPrompt(), convo);
    convo.push({ role: 'assistant', text: reply });
    takeText(reply);
    const pe = getErr();
    if (pe) attempts.push({ round, who: 'ai', note: 'AI reply rejected: ' + pe.slice(0, 2).join('; '), problems: pe.length, ok: false });
    else attempts.push({ round, who: 'ai', note: 'AI returned a revised spec', problems: sol.report.problems.length, ok: false });
  }
  if (last) {
    last.message = `Could not make a valid model after ${max} round(s). Remaining problems:\n${formatProblems(last.report!)}`;
    last.ok = false;
    return last;
  }
  return { ok: false, attempts, message: 'No valid spec was produced.' };
}
