import { describe, it, expect } from 'vitest';
import { systemPrompt, userPrompt } from '../src/prompt';
import { LIMITS, parseSpec } from '../src/shapes';
import { FEATURE_KINDS, MAX_FEATURES } from '../src/features';
import { buildWithRepair } from '../src/repair';

describe('detail levels', () => {
  const normal = systemPrompt(), simple = systemPrompt('normal'), high = systemPrompt('high');
  it('no argument means the normal prompt, unchanged', () => { expect(normal).toBe(simple); });
  it('every level keeps the rules that make a build valid (one piece, nothing floating, real colours, size limits, the examples)', () => {
    for (const p of [normal, high]) {
      expect(p).toMatch(/ONE piece/); expect(p).toMatch(/float/i); expect(p).toContain('light_gray'); expect(p).toContain(`${LIMITS.maxStuds} x ${LIMITS.maxStuds}`);
      expect(p).toContain('Example 1'); expect(p).toContain('Example 2'); expect(p).toContain('Example 3'); expect(p).toMatch(/"plan"/); expect(p).toMatch(/Reply with ONE JSON/);
    }
  });
  it('detailed asks for a bigger model, many more shapes, and small details, within the real limits', () => {
    expect(high).toMatch(/22-34 studs|22 to 34 studs/);
    expect(high).toMatch(/20 to 45 shapes/);
    expect(high).toMatch(/eyes/i); expect(high).toMatch(/paint/i); expect(high).toMatch(/at least 8 catalog features/i);
    expect(high).not.toMatch(/Prefer few, bold/i); expect(high).not.toMatch(/roughly 10-24 studs/);
    expect(normal).toMatch(/Prefer few, bold/i); expect(normal).toMatch(/roughly 10-24 studs/);
    // never asks for more than the app accepts, so a Detailed answer cannot be rejected for size
    const nums = [...high.matchAll(/(\d+)\s*(?:to|-)\s*(\d+)\s*shapes/g)].flatMap(m => [Number(m[1]), Number(m[2])]);
    expect(Math.max(...nums)).toBeLessThanOrEqual(LIMITS.maxShapes);
    const studs = [...high.matchAll(/(\d+)\s*(?:to|-)\s*(\d+)\s*studs/g)].flatMap(m => [Number(m[1]), Number(m[2])]);
    expect(Math.max(...studs)).toBeLessThanOrEqual(LIMITS.maxStuds);
  });
  it('an unknown level falls back to normal and never throws', () => { expect(systemPrompt('turbo' as any)).toBe(normal); });
  it('the prompt stays a sensible size (cost and speed): detailed adds guidance but not pages', () => {
    expect(high.length).toBeGreaterThan(normal.length); expect(high.length).toBeLessThan(normal.length + 1800);
  });
  it('the user prompt is unchanged by the level', () => { expect(userPrompt('a cat', false)).toContain('a cat'); });
});

describe('the parts catalog in the prompt', () => {
  it('every kind of part is described, for both levels, and the cap is stated', () => {
    for (const p of [systemPrompt(), systemPrompt('high')]) {
      for (const k of FEATURE_KINDS) expect(p).toMatch(new RegExp(`^- ${k}:`, 'm'));
      expect(p).toContain(`at most ${MAX_FEATURES}`); expect(p).toContain('"features"');
    }
  });
  it('nothing in the prompt names a part that does not exist (no stale kinds in examples)', () => {
    const p = systemPrompt();
    for (const m of p.matchAll(/"kind":"([a-z]+)"/g)) expect(FEATURE_KINDS).toContain(m[1]);
  });
  it('the three examples in the prompt are real: each parses and builds into one valid model with no AI help', async () => {
    const { EXAMPLE, EXAMPLE_CAR, EXAMPLE_ANIMAL } = await import('../src/prompt');
    for (const [name, ex] of Object.entries({ house: EXAMPLE, car: EXAMPLE_CAR, pony: EXAMPLE_ANIMAL })) {
      expect(parseSpec(ex).ok, `${name} parses`).toBe(true);
      const r = await buildWithRepair({ rawText: JSON.stringify(ex) }, async () => { throw new Error('AI called'); }, { maxRounds: 1 });
      expect(r.ok, `${name}: ${r.message}`).toBe(true);
      expect(r.report?.stats.components).toBe(1);
    }
  });
});
