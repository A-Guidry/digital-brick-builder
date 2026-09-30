import { describe, it, expect } from 'vitest';
import { PRESETS } from '../src/presets';
import { parseSpec } from '../src/shapes';
import { buildWithRepair } from '../src/repair';
import { makeSteps } from '../src/steps';
import { makeBags } from '../src/bags';

describe('bags', () => {
  for (const p of PRESETS) {
    it(`${p.id}: exactly 4 bags, every part in exactly one bag, steps stay in order, sizes balanced`, async () => {
      const model = (await buildWithRepair((parseSpec(p.spec) as any).spec, null)).model!;
      const steps = makeSteps(model);
      const bags = makeBags(steps);
      expect(bags.length).toBe(4);
      const ids = bags.flatMap(b => b.parts.map(x => x.id));
      expect(ids.length).toBe(model.parts.length);
      expect(new Set(ids).size).toBe(model.parts.length);
      // contiguous, in order
      expect(bags.flatMap(b => b.steps.map(s => s.n))).toEqual(steps.map(s => s.n));
      const sizes = bags.map(b => b.parts.length);
      console.log(p.id, sizes.join('/'));
      expect(Math.min(...sizes)).toBeGreaterThan(0);
      expect(Math.max(...sizes) / Math.min(...sizes)).toBeLessThan(2.2);
    });
  }
  it('tiny models get fewer bags rather than empty ones', () => {
    const steps = [1, 2].map(n => ({ n, parts: [{ id: n } as any] }));
    const bags = makeBags(steps as any);
    expect(bags.length).toBe(2);
    expect(bags.every(b => b.parts.length > 0)).toBe(true);
  });
});
