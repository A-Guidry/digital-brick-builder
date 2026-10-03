// The "look at it" step. The structural checks only prove the bricks connect; they cannot tell a unicorn from a "W".
// After a build, the app photographs its own model from four sides, asks the AI whether a child would recognise it
// and whether every asked-for feature is there, and (when not) asks for a corrected model. It never makes things worse:
// the best-scoring model seen is always the one left on screen.
export const PASS_SCORE = 7;     // 7 and up: a child would recognise it
export const MAX_LOOKS = 2;      // look at most twice, so at most one rebuild: bounded cost and time

export interface Verdict { sees: string; matches: boolean; score: number; missing: string[]; fix: string }

const tidy = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export function criticSystemPrompt(): string {
  return `You are a strict but kind judge of LEGO-style models that are built only from simple blocks, wedges, cylinders, cones and spheres. Blocky is expected and fine.
You are shown ONE picture made of four views of a finished model (front, side, three-quarter and back) of something that was supposed to be a given subject. Decide whether a child would recognise the subject, and whether EVERY feature that was asked for or that defines the subject is clearly present (for an animal: the right number of legs, a body, a neck if it has one, a head, a tail; plus anything special that was asked for, such as a horn, wings, a trunk or wheels). A feature that exists but is too tiny to see, or is in the wrong place, counts as missing.
What you are looking at: the flat grey or tan plate under every model is its BASEPLATE, and the model is built standing on it. Never say a model is "floating", "hovering" or "on a platform", and ignore the studs and the shadows. Dark blocks at the corners of a vehicle ARE its wheels. Judge ONLY whether the subject is recognisable and whether the asked-for features are present, not tidiness or small details. Be fair: if a child would say "that's a horse" it is a horse. Only list a feature as missing when you looked for it in all four views and it is truly absent or unreadable.
Reply with ONE JSON object and nothing else:
{ "sees": "one plain sentence: what the model actually looks like", "matches": true or false, "score": a whole number 1 to 10, "missing": ["each missing, hidden or wrong feature, briefly"], "fix": "concrete changes to the shapes: what to add, resize, move or recolour, with rough sizes in studs and where" }
Scoring: 9-10 clearly recognisable with every feature; 7-8 recognisable with small flaws; 4-6 vague or key features missing; 1-3 not recognisable.`;
}

/** The request is quoted data inside our own sentence, so whatever the person typed cannot rewrite the judge's instructions. */
export function criticUserText(request: string): string {
  return `The model was supposed to be: "${tidy(request, 300)}"\nLook at the four views and reply with the JSON verdict only.`;
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : raw).trim();
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  return a >= 0 && b > a ? body.slice(a, b + 1) : null;
}

/** Reads the judge's answer defensively. Anything unusable returns null (the build is then simply left as it is). */
export function parseVerdict(raw: string): Verdict | null {
  if (typeof raw !== 'string') return null;
  const js = extractJson(raw); if (!js) return null;
  let o: any; try { o = JSON.parse(js); } catch { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const matches = o.matches === true || o.matches === 'true' ? true : o.matches === false || o.matches === 'false' ? false : null;
  let score: number | null = null;
  if (typeof o.score === 'number' && Number.isFinite(o.score)) score = o.score;
  else if (typeof o.score === 'string') { const m = o.score.match(/-?\d+(\.\d+)?/); if (m) score = Number(m[0]); }
  if (score === null && matches === null) return null;
  if (score === null) score = matches ? PASS_SCORE + 1 : PASS_SCORE - 4;
  score = Math.min(10, Math.max(1, Math.round(score)));
  const missing = (Array.isArray(o.missing) ? o.missing : []).filter((x: unknown) => typeof x === 'string').map((x: string) => tidy(x, 140)).filter(Boolean).slice(0, 8);
  // Contact with the baseplate is guaranteed by the app's own structural check, so a complaint about it is always a mistake in the picture reading.
  const contact = /\b(float(s|ed|ing)?|hover(s|ed|ing)?|detach(ed)?|unattach(ed)?|disconnect(ed)?|suspend(ed)?)\b|\b(on|above|over) (a|the) (floating |tan |grey |gray )?(platform|base ?plate)\b/i;
  const real = missing.filter((m: string) => !contact.test(m));
  const onlyContact = missing.length > 0 && real.length === 0;
  const finalScore = onlyContact ? Math.max(score, PASS_SCORE + 1) : score;
  return { sees: tidy(o.sees, 240), matches: onlyContact ? true : (matches ?? finalScore >= PASS_SCORE), score: finalScore, missing: real, fix: onlyContact ? '' : tidy(o.fix, 700) };
}

/** Needs a rebuild unless the judge says it matches AND scores at least the pass mark (the lower opinion wins). */
export const needsFix = (v: Verdict) => !v.matches || v.score < PASS_SCORE;

export function revisionPrompt(request: string, specJson: string, v: Verdict): string {
  return `You designed a LEGO model for: "${tidy(request, 300)}"
This is your spec:
${specJson}
It was built and then looked at from four sides. What it looks like: ${v.sees || 'unclear'}.
Problems found:
${(v.missing.length ? v.missing : ['it does not look enough like the request']).map(m => '- ' + m).join('\n')}
Suggested fix: ${v.fix || 'make the missing features bigger and bolder'}
Return the COMPLETE corrected JSON spec (same format, with a revised "plan"). Keep everything that already works, and fix every problem above. Do NOT add a base, floor or platform under the model (it already stands on a baseplate), and do not shrink the model. Remember: features at least 2 studs thick, parts join only by stacking, every plan item gets its own shape.`;
}

export interface LoopDeps<R> {
  request: string;
  first: R;
  /** Photograph the CURRENT model and ask the judge. May throw; returns null when the answer is unusable. */
  critique: (current: R) => Promise<Verdict | null>;
  /** Ask the builder for a corrected model and rebuild it. Returns null when that did not produce a valid model. */
  revise: (current: R, verdict: Verdict) => Promise<R | null>;
  show: (r: R) => void;
  log: (message: string) => void;
  maxLooks?: number;
}

export async function improveByLooking<R>(d: LoopDeps<R>): Promise<{ result: R; verdict: Verdict | null; looks: number }> {
  const max = Math.max(0, d.maxLooks ?? MAX_LOOKS);
  let current = d.first, best = d.first, bestVerdict: Verdict | null = null, bestScore = -1, looks = 0;
  while (looks < max) {
    let verdict: Verdict | null;
    try { verdict = await d.critique(current); } catch { d.log('Could not look at it this time, so I am keeping it as it is.'); break; }
    looks++;
    if (!verdict) { d.log('The check did not give a usable answer, so I am keeping it as it is.'); break; }
    if (verdict.score > bestScore) { best = current; bestScore = verdict.score; bestVerdict = verdict; }
    d.log(`Looked at it from four sides: ${verdict.sees || 'ok'} (${verdict.score}/10)`);
    if (!needsFix(verdict)) break;
    if (looks >= max) break;
    d.log(`Fixing: ${verdict.missing.length ? verdict.missing.join('; ') : 'making it look more like the request'}`);
    let next: R | null = null;
    try { next = await d.revise(current, verdict); } catch { next = null; }
    if (!next) { d.log('The fix did not work out, so I am keeping the previous one.'); break; }
    d.show(next); current = next;
  }
  if (best !== current) { d.show(best); d.log('The earlier version looked better, so I put it back.'); }
  return { result: best, verdict: bestVerdict, looks };
}
