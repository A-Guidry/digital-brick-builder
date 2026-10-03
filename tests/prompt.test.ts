import { describe, it, expect } from 'vitest';
import { systemPrompt, userPrompt } from '../src/prompt';
import { LIMITS } from '../src/shapes';

describe('detail levels', () => {
  const normal = systemPrompt(), simple = systemPrompt('normal'), high = systemPrompt('high');
  it('no argument means the normal prompt, unchanged', () => { expect(normal).toBe(simple); });
  it('every level keeps the rules that make a build valid (one piece, nothing floating, real colours, size limits, the examples)', () => {
    for (const p of [normal, high]) {
      expect(p).toMatch(/ONE piece/); expect(p).toMatch(/float/i); expect(p).toContain('light_gray'); expect(p).toContain(`${LIMITS.maxStuds} x ${LIMITS.maxStuds}`);
      expect(p).toContain('Example 1'); expect(p).toContain('Example 2'); expect(p).toMatch(/"plan"/); expect(p).toMatch(/Reply with ONE JSON/);
    }
  });
  it('detailed asks for a bigger model, many more shapes, and small details, within the real limits', () => {
    expect(high).toMatch(/22-34 studs|22 to 34 studs/);
    expect(high).toMatch(/30 to 60 shapes|30-60 shapes/);
    expect(high).toMatch(/eyes/i); expect(high).toMatch(/paint/i); expect(high).toMatch(/at least 8/i);
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
    expect(high.length).toBeGreaterThan(normal.length); expect(high.length).toBeLessThan(normal.length + 2500);
  });
  it('the user prompt is unchanged by the level', () => { expect(userPrompt('a cat', false)).toContain('a cat'); });
});
