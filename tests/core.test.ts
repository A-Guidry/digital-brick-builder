import { describe, it, expect } from 'vitest';
import { PARTS, COLORS, resolveColor } from '../src/catalog';
import { parseSpec } from '../src/shapes';
import { compileSpec, Model, Placed } from '../src/compiler';
import { validate } from '../src/validator';
import { buildWithRepair } from '../src/repair';
import { makeSteps, MAX_PER_STEP } from '../src/steps';
import { wantedListXml, partsList } from '../src/bricklink';
import { PRESETS } from '../src/presets';

const mkModel = (parts: Partial<Placed>[]): Model => ({
  name: 't', size: [10, 10, 10], origin: [0, 0, 0], variant: 0,
  parts: parts.map((p, i) => ({ id: i, part: 'brick-2x4', color: 'red', x: 0, y: 0, z: 0, fx: 4, fz: 2, h: 3, ...p })),
});

describe('catalog', () => {
  it('every part has a BrickLink id and sane size; every colour has a BrickLink id', () => {
    for (const p of PARTS) { expect(p.bl).toMatch(/^\d+[a-z]?$/); expect(p.h).toBe(p.kind === 'brick' ? 3 : 1); }
    for (const c of COLORS) { expect(c.bl).toBeGreaterThan(0); expect(c.hex).toMatch(/^#[0-9a-f]{6}$/); }
    expect(new Set(COLORS.map(c => c.bl)).size).toBe(COLORS.length);
  });
  it('snaps loose colour words to real colours', () => {
    expect(resolveColor('gray')?.id).toBe('light_gray');
    expect(resolveColor('#ff0000')?.id).toBe('red');
    expect(resolveColor('chartreuse')).toBeNull();
  });
});

describe('shape spec: AI may only describe shapes', () => {
  it('rejects specs that place bricks or name parts', () => {
    const r = parseSpec({ name: 'x', shapes: [{ type: 'box', color: 'red', center: [0, 1, 0], size: [2, 2, 2], part: '3001' }] });
    expect(r.ok).toBe(false);
    const r2 = parseSpec({ name: 'x', bricks: [], shapes: [{ type: 'box', color: 'red', center: [0, 1, 0], size: [2, 2, 2] }] });
    expect(r2.ok).toBe(false);
  });
  it('rejects unknown colours and oversize models with plain messages', () => {
    const r = parseSpec({ name: 'x', shapes: [{ type: 'box', color: 'chartreuse', center: [0, 1, 0], size: [2, 2, 2] }] });
    expect(r.ok === false && r.errors[0]).toMatch(/not a LEGO colour/);
    const big = parseSpec({ name: 'x', shapes: [{ type: 'box', color: 'red', center: [0, 1, 0], size: [90, 2, 2] }] });
    expect(big.ok === false && big.errors.join()).toMatch(/max is/);
  });
  it('parses JSON inside markdown fences', () => {
    const r = parseSpec('Here you go:\n```json\n{"name":"a","shapes":[{"type":"box","color":"red","center":[0,1,0],"size":[4,2,4]}]}\n```');
    expect(r.ok).toBe(true);
  });
});

describe('compiler', () => {
  it('is deterministic', () => {
    const spec = (parseSpec(PRESETS[0].spec) as any).spec;
    const a = compileSpec(spec).model, b = compileSpec(spec).model;
    expect(JSON.stringify(a.parts)).toBe(JSON.stringify(b.parts));
  });
  it('uses only catalog parts and fills a solid block exactly', () => {
    const spec = (parseSpec({ name: 'b', shapes: [{ type: 'box', color: 'blue', center: [0, 1.2, 0], size: [4, 2.4, 4] }] }) as any).spec;
    const { model } = compileSpec(spec);
    const vol = model.parts.reduce((n, p) => n + p.fx * p.fz * p.h, 0);
    expect(vol).toBe(4 * 4 * 6);
    expect(validate(model).ok).toBe(true);
  });
});

describe('validator', () => {
  it('accepts stacked, overlapping bricks', () => {
    const m = mkModel([{}, { y: 3, x: 2 }]);
    expect(validate(m).ok).toBe(true);
  });
  it('flags parts that only touch sideways as disconnected', () => {
    const m = mkModel([{}, { x: 4 }]);
    const r = validate(m);
    expect(r.ok).toBe(false);
    expect(r.problems.some(p => p.code === 'disconnected')).toBe(true);
  });
  it('flags overlaps', () => {
    const r = validate(mkModel([{}, { x: 1 }]));
    expect(r.problems.some(p => p.code === 'overlap')).toBe(true);
  });
  it('flags a part with nothing under or over it', () => {
    const r = validate(mkModel([{}, { y: 12 }]));
    expect(r.ok).toBe(false);
  });
  it('flags unknown parts and colours', () => {
    const r = validate(mkModel([{ part: 'nope' }, { color: 'neon', y: 3 }]));
    expect(r.problems.map(p => p.code)).toEqual(expect.arrayContaining(['unknown_part', 'unknown_color']));
  });
});

describe('repair loop', () => {
  const goodSpec = { name: 'ok', shapes: [{ type: 'box', color: 'red', center: [0, 1.2, 0], size: [4, 2.4, 4] }] };
  // two blocks floating far apart in the air, cannot be fixed by program
  const brokenSpec = { name: 'bad', shapes: [
    { type: 'box', color: 'red', center: [-6, 1.2, 0], size: [2, 2.4, 2] },
    { type: 'box', color: 'blue', center: [6, 8, 0], size: [2, 2.4, 2] },
  ] };
  it('sends validator problems back to the AI and accepts its fix', async () => {
    const seen: string[] = [];
    const ask = async (_s: string, msgs: any[]) => { seen.push(msgs[msgs.length - 1].text); return JSON.stringify(goodSpec); };
    const r = await buildWithRepair((parseSpec(brokenSpec) as any).spec, ask);
    expect(seen.length).toBe(1);
    expect(seen[0]).toMatch(/failed these checks/);
    expect(seen[0]).toMatch(/disconnected/);
    expect(r.ok).toBe(true);
    expect(r.attempts.some(a => a.who === 'ai')).toBe(true);
  });
  it('fails honestly when the AI never fixes it', async () => {
    let calls = 0;
    const ask = async () => { calls++; return JSON.stringify(brokenSpec); };
    const r = await buildWithRepair((parseSpec(brokenSpec) as any).spec, ask, { maxRounds: 3 });
    expect(r.ok).toBe(false);
    expect(calls).toBe(2);
    expect(r.message).toMatch(/Could not make a valid model/);
  });
  it('sends parse errors back when the AI answers with junk', async () => {
    const replies = ['not json at all', JSON.stringify(goodSpec)];
    const ask = async () => replies.shift()!;
    const r = await buildWithRepair({ rawText: '{"name":"x","shapes":[{"type":"box","part":"3001"}]}' }, ask);
    expect(r.ok).toBe(true);
  });
});

describe('steps', () => {
  it('never more than four pieces per step, and steps cover every part exactly once', async () => {
    for (const p of PRESETS) {
      const model = (await buildWithRepair((parseSpec(p.spec) as any).spec, null)).model!;
      const steps = makeSteps(model);
      expect(steps.every(s => s.parts.length >= 1 && s.parts.length <= MAX_PER_STEP)).toBe(true);
      expect(steps.reduce((n, s) => n + s.parts.length, 0)).toBe(model.parts.length);
      // each step's parts touch the ground or something built in earlier steps or this step
      const built = new Set<number>();
      const { contacts } = await import('../src/validator');
      const c = contacts(model.parts);
      for (const st of steps) {
        for (const q of st.parts) built.add(q.id);
        for (const q of st.parts) {
          const touches = q.y === 0 || [...c.below.get(q.id)!, ...c.above.get(q.id)!].some(u => built.has(u));
          expect(touches, `${p.id} step ${st.n}`).toBe(true);
        }
      }
    }
  });
});

describe('BrickLink export', () => {
  it('quantities match the model and XML has the wanted-list shape', async () => {
    const spec = (parseSpec(PRESETS[2].spec) as any).spec;
    const model = (await buildWithRepair(spec, null)).model!;
    const list = partsList(model);
    expect(list.reduce((n, l) => n + l.qty, 0)).toBe(model.parts.length);
    const xml = wantedListXml(model);
    expect(xml.startsWith('<INVENTORY>')).toBe(true);
    expect((xml.match(/<ITEM>/g) ?? []).length).toBe(list.length);
    expect(xml).toMatch(/<ITEMTYPE>P<\/ITEMTYPE>/);
    expect(xml).toMatch(/<MINQTY>\d+<\/MINQTY>/);
  });
});
