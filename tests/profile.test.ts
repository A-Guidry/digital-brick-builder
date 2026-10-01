import { describe, it, expect } from 'vitest';
import { emptyProfile, validateProfile, exportProfile, parseProfileFile, mergeProfile, encodeShare, decodeShare, fileNameFor, Profile, LIMITS } from '../src/profile';
import { PRESETS } from '../src/presets';
import { DEFAULTS } from '../src/llm';
import { buildWithRepair } from '../src/repair';

const sample = (): Profile => {
  const p = emptyProfile(); p.name = 'Ada'; p.look = 'dramatic'; p.favorites = ['house', 'cat']; p.last = 'b:abc123';
  p.builds = [{ id: 'abc123', name: 'My tree', spec: PRESETS.find(x => x.id === 'tree')!.spec, created: 1, source: 'ai', prompt: 'a tree' }];
  p.progress = { 'p:house': { bagState: ['done', 'open', 'sealed', 'sealed'], curBag: 1, placed: [3, 4, 5], updated: 100 } };
  return p;
};

describe('profile file', () => {
  it('round-trips through export and import', () => {
    const v = parseProfileFile(exportProfile(sample()));
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.profile.name).toBe('Ada'); expect(v.profile.look).toBe('dramatic'); expect(v.profile.favorites).toEqual(['house', 'cat']);
    expect(v.profile.builds).toHaveLength(1); expect(v.profile.builds[0].spec.name).toBe('Tree');
    expect(v.profile.progress['p:house'].placed).toEqual([3, 4, 5]); expect(v.profile.last).toBe('b:abc123');
  });
  it('a saved build rebuilds into a passing model after a round trip', async () => {
    const v = parseProfileFile(exportProfile(sample())); if (!v.ok) throw new Error('bad');
    const r = await buildWithRepair(v.profile.builds[0].spec, null);
    expect(r.ok).toBe(true);
  });
  it('API keys are left out unless asked for', () => {
    const s = { ...DEFAULTS, anthropicKey: 'sk-ant-SECRET', geminiKey: 'AIzaSECRET' };
    expect(exportProfile(sample())).not.toContain('settings');
    const noKeys = exportProfile(sample(), { settings: s });
    expect(noKeys).not.toContain('SECRET'); expect(noKeys).toContain('claude-sonnet');
    expect(exportProfile(sample(), { settings: s, includeKeys: true })).toContain('sk-ant-SECRET');
  });
  it('the shared-server passcode is treated like an API key, and the server address is never exported or imported', () => {
    const s = { ...DEFAULTS, sharedPasscode: 'PASSCODE-SECRET' };
    const noKeys = exportProfile(sample(), { settings: s });
    expect(noKeys).not.toContain('PASSCODE-SECRET'); expect(noKeys).not.toContain('sharedUrl');
    const withKeys = exportProfile(sample(), { settings: s, includeKeys: true });
    expect(withKeys).toContain('PASSCODE-SECRET'); expect(withKeys).not.toContain('sharedUrl');
    const back = validateProfile(JSON.parse(withKeys));
    expect(back.ok && back.profile.settings?.sharedPasscode).toBe('PASSCODE-SECRET');
    const hostile = validateProfile({ ...JSON.parse(withKeys), settings: { provider: 'shared', sharedUrl: 'https://evil.example', sharedPasscode: 'x' } });
    expect(hostile.ok && hostile.profile.settings).toEqual({ provider: 'shared', sharedPasscode: 'x' });
  });
  it('rejects files that are not profiles, too new, or not JSON', () => {
    expect(validateProfile({ hello: 1 }).ok).toBe(false);
    expect(validateProfile({ app: 'digital-brick-builder', version: 99 }).ok).toBe(false);
    expect(validateProfile([]).ok).toBe(false);
    expect(parseProfileFile('{nope').ok).toBe(false);
    expect(parseProfileFile('x'.repeat(LIMITS.maxBytes + 1)).ok).toBe(false);
  });
  it('drops saved builds that fail shape validation (e.g. ones that try to place parts)', () => {
    const p: any = JSON.parse(exportProfile(sample()));
    p.builds.push({ id: 'evil1', name: 'Evil', spec: { name: 'x', shapes: [{ type: 'box', center: [0, 1, 0], size: [2, 2, 2], part: 'brick-2x4' }] } });
    p.builds.push({ id: 'evil2', name: 'Huge', spec: { name: 'x', shapes: [{ type: 'box', center: [0, 1, 0], size: [999, 2, 2] }] } });
    p.builds.push({ id: '../../x', name: 'Bad id', spec: PRESETS[0].spec });
    const v = validateProfile(p); expect(v.ok).toBe(true);
    if (v.ok) { expect(v.profile.builds.map(b => b.id)).toEqual(['abc123']); expect(v.warnings.length).toBeGreaterThanOrEqual(2); }
  });
  it('sanitises progress, names and settings', () => {
    const p: any = JSON.parse(exportProfile(sample()));
    p.name = 'x'.repeat(500) + '\u0000';
    p.progress['../../evil'] = { bagState: ['done'], curBag: -1, placed: [], updated: 1 };
    p.progress['p:car'] = { bagState: ['weird'], curBag: 0, placed: [], updated: 1 };
    p.progress['p:rocket'] = { bagState: ['sealed', 'sealed'], curBag: 7, placed: [1, -4, 2.5, 'a', 9], updated: 1 };
    p.settings = { provider: 'evil', localUrl: 'javascript:alert(1)', anthropicModel: 'm', extra: 'x' };
    const v = validateProfile(p); if (!v.ok) throw new Error(v.error);
    expect(v.profile.name.length).toBeLessThanOrEqual(LIMITS.name);
    expect(Object.keys(v.profile.progress).sort()).toEqual(['p:house', 'p:rocket']);
    expect(v.profile.progress['p:rocket'].curBag).toBe(-1); expect(v.profile.progress['p:rocket'].placed).toEqual([1, 9]);
    expect(v.profile.settings).toEqual({ anthropicModel: 'm' });
  });
  it('merging keeps existing builds, adds new ones, and the newer progress wins', () => {
    const a = sample(), b = sample();
    b.builds = [{ ...b.builds[0], id: 'new111', name: 'Other' }, b.builds[0]];
    b.progress['p:house'] = { bagState: ['done', 'done', 'sealed', 'sealed'], curBag: -1, placed: [], updated: 500 };
    const m = mergeProfile(a, b);
    expect(m.addedBuilds).toBe(1); expect(m.profile.builds.map(x => x.id)).toEqual(['abc123', 'new111']);
    expect(m.profile.progress['p:house'].bagState[1]).toBe('done'); expect(m.updatedProgress).toBe(1);
    const older = sample(); older.progress['p:house'].updated = 1;
    expect(mergeProfile(a, older).profile.progress['p:house'].updated).toBe(100);
  });
  it('file names are safe and dated', () => {
    expect(fileNameFor({ ...emptyProfile(), name: 'Ada L. / ../x' }, new Date('2026-09-30T10:00:00Z'))).toBe('digital-brick-builder-ada-l-x-2026-09-30.dbb.json');
    expect(fileNameFor(emptyProfile(), new Date('2026-01-02T00:00:00Z'))).toBe('digital-brick-builder-2026-01-02.dbb.json');
  });
});

describe('share links', () => {
  it('encode then decode returns the same spec, and the link is short', async () => {
    for (const p of PRESETS) {
      const code = await encodeShare(p.spec);
      const d = await decodeShare(code);
      expect(d.ok, p.id).toBe(true);
      if (d.ok) expect(d.spec.shapes.length).toBe(p.spec.shapes.length);
      expect(code.length).toBeLessThan(2500);
    }
  });
  it('rejects damaged, unknown or dangerous links', async () => {
    expect((await decodeShare('z.@@@@')).ok).toBe(false);
    expect((await decodeShare('q.abcd')).ok).toBe(false);
    expect((await decodeShare('r.' + btoa('{"name":"x","shapes":[{"type":"box","center":[0,1,0],"size":[2,2,2],"part":"brick-1x1"}]}').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))).ok).toBe(false);
    expect((await decodeShare('r.' + 'A'.repeat(300000))).ok).toBe(false);
  });
});
