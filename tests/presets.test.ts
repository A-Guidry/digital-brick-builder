import { describe, it, expect } from 'vitest';
import { PRESETS } from '../src/presets';
import { parseSpec } from '../src/shapes';
import { buildWithRepair } from '../src/repair';

describe('ready-made builds', () => {
  for (const p of PRESETS) {
    it(`${p.id} parses, compiles and validates as one connected buildable piece`, async () => {
      const parsed = parseSpec(p.spec);
      expect(parsed.ok, JSON.stringify((parsed as any).errors)).toBe(true);
      const r = await buildWithRepair((parsed as any).spec, null);
      console.log(p.id, r.ok, r.model?.parts.length, r.attempts.map(a => a.note).join(' | '), r.report?.problems.slice(0, 4).map(x => x.message));
      expect(r.ok, r.message).toBe(true);
      // ready-made builds must be designed well enough that the program never has to delete parts of them
      expect(r.attempts.map(a => a.note).join(' ')).not.toMatch(/removing|removed/);
    });
  }
});
