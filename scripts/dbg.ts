import { PRESETS } from '../src/presets';
import { parseSpec } from '../src/shapes';
import { solveDeterministic } from '../src/repair';
import { formatProblems } from '../src/validator';
const only = process.argv[2];
for (const p of PRESETS) {
  if (only && p.id !== only) continue;
  const r = parseSpec(p.spec); if (!r.ok) { console.log(p.id, r.errors); continue; }
  const notes: string[] = [];
  const s = solveDeterministic(r.spec, n => notes.push(n));
  console.log('==', p.id, s.report.ok, s.model.parts.length, 'size', s.model.size.join('x'), notes.join('; '));
  if (!s.report.ok) console.log(formatProblems(s.report, 6));
}
