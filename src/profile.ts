// A "semi-account" with no server: the profile lives in this browser (localStorage) and can be exported to / loaded from
// a small .dbb.json file. Saved builds are stored as SHAPE SPECS only (never parts), and every spec is re-validated and
// rebuilt on load, so a hand-edited or hostile file can only ever produce a normal, checked model.
import { ShapeSpec, parseSpec } from './shapes';
import { Settings, DEFAULTS } from './llm';

export const APP_ID = 'digital-brick-builder';
export const VERSION = 1;
export const STORE_KEY = 'dbb.profile.v1';
export const LIMITS = { builds: 200, progress: 400, favorites: 100, maxBytes: 8_000_000, name: 60, parts: 5000 };

export type BagStateName = 'sealed' | 'open' | 'done';
export interface SavedBuild { id: string; name: string; spec: ShapeSpec; created: number; source: 'ai' | 'shared' | 'imported'; prompt?: string }
export interface BuildProgress { bagState: BagStateName[]; curBag: number; placed: number[]; updated: number }
export interface Profile {
  app: typeof APP_ID; version: number; name: string; savedAt: number;
  look: 'studio' | 'dramatic';
  last: string;                              // key of the build that was open last ("p:house" / "b:abc")
  favorites: string[];                       // ready-made ids
  builds: SavedBuild[];                      // AI / shared builds
  progress: Record<string, BuildProgress>;   // key: "p:<presetId>" or "b:<buildId>"
  settings?: Partial<Settings>;              // only present in a file when the user opted in
}

export const emptyProfile = (): Profile => ({ app: APP_ID, version: VERSION, name: '', savedAt: Date.now(), look: 'studio', last: '', favorites: [], builds: [], progress: {} });
export const newId = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4);

// ---------- browser storage ----------
export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return emptyProfile();
    const v = validateProfile(JSON.parse(raw));
    return v.ok ? v.profile : emptyProfile();
  } catch { return emptyProfile(); }
}
export function saveProfile(p: Profile): boolean {
  try { p.savedAt = Date.now(); localStorage.setItem(STORE_KEY, JSON.stringify({ ...p, settings: undefined })); return true; } catch { return false; }
}
/** Ask the browser not to evict our data under storage pressure. Returns true if granted (or unsupported queries fail quietly). */
export async function requestPersistence(): Promise<boolean | null> {
  try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch { /* ignore */ }
  return null;
}

// ---------- validation ----------
const str = (v: unknown, max: number, dflt = ''): string => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : dflt);
const safeId = (v: unknown): string | null => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v) ? v : null);
const isKey = (k: string) => /^(p:[A-Za-z0-9_-]{1,40}|b:[A-Za-z0-9_-]{1,40})$/.test(k);

export type Validated = { ok: true; profile: Profile; warnings: string[] } | { ok: false; error: string };

export function validateProfile(raw: unknown): Validated {
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'This is not a Digital Brick Builder profile file.' };
  const r = raw as Record<string, any>;
  if (r.app !== APP_ID) return { ok: false, error: 'This file was not made by Digital Brick Builder.' };
  if (typeof r.version !== 'number' || r.version < 1) return { ok: false, error: 'This profile file has no valid version.' };
  if (r.version > VERSION) return { ok: false, error: `This profile was saved by a newer version (v${r.version}). Update the app and try again.` };
  const p = emptyProfile();
  p.name = str(r.name, LIMITS.name);
  p.savedAt = typeof r.savedAt === 'number' && Number.isFinite(r.savedAt) ? r.savedAt : Date.now();
  p.look = r.look === 'dramatic' ? 'dramatic' : 'studio';
  p.last = typeof r.last === 'string' && isKey(r.last) ? r.last : '';
  if (Array.isArray(r.favorites)) p.favorites = [...new Set(r.favorites.map((x: unknown) => safeId(x)).filter((x): x is string => !!x))].slice(0, LIMITS.favorites);
  const seen = new Set<string>();
  if (Array.isArray(r.builds)) {
    if (r.builds.length > LIMITS.builds) warnings.push(`Only the first ${LIMITS.builds} saved builds were loaded.`);
    for (const b of r.builds.slice(0, LIMITS.builds)) {
      const id = safeId(b?.id); if (!id || seen.has(id)) { warnings.push('Skipped a saved build with a missing or duplicate id.'); continue; }
      const parsed = parseSpec(b?.spec);
      if (!parsed.ok) { warnings.push(`Skipped "${str(b?.name, 40) || id}": ${parsed.errors[0]}`); continue; }
      seen.add(id);
      p.builds.push({ id, name: str(b?.name, LIMITS.name) || parsed.spec.name || 'Untitled', spec: parsed.spec, created: typeof b?.created === 'number' ? b.created : Date.now(), source: b?.source === 'shared' || b?.source === 'imported' ? b.source : 'ai', prompt: b?.prompt ? str(b.prompt, 300) : undefined });
    }
  }
  if (r.progress && typeof r.progress === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries<any>(r.progress)) {
      if (n++ >= LIMITS.progress) { warnings.push('Some saved progress was skipped (too many entries).'); break; }
      if (!isKey(k) || !v || !Array.isArray(v.bagState) || v.bagState.length > 8 || !v.bagState.every((s: unknown) => s === 'sealed' || s === 'open' || s === 'done')) continue;
      const placed = Array.isArray(v.placed) ? v.placed.filter((x: unknown) => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 100000).slice(0, LIMITS.parts) : [];
      const curBag = Number.isInteger(v.curBag) && v.curBag >= -1 && v.curBag < v.bagState.length ? v.curBag : -1;
      p.progress[k] = { bagState: v.bagState, curBag, placed, updated: typeof v.updated === 'number' ? v.updated : Date.now() };
    }
  }
  if (r.settings && typeof r.settings === 'object') {
    const s: Partial<Settings> = {}, rs = r.settings as Record<string, unknown>;
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (typeof rs[k] === 'string') (s as any)[k] = str(rs[k], 400);
    if (s.provider && !['shared', 'anthropic', 'gemini', 'local'].includes(s.provider)) delete s.provider;
    delete s.sharedUrl; // never importable: a hostile file could point the passcode at someone else's server
    if (s.localUrl && !/^https?:\/\//i.test(s.localUrl)) delete s.localUrl;
    if (Object.keys(s).length) p.settings = s;
  }
  return { ok: true, profile: p, warnings };
}

// ---------- export / import ----------
export function exportProfile(p: Profile, opts: { settings?: Settings; includeKeys?: boolean } = {}): string {
  const out: Profile = { ...p, savedAt: Date.now() };
  if (opts.settings) {
    const s: Partial<Settings> = { ...opts.settings };
    delete s.sharedUrl;
    if (!opts.includeKeys) { delete s.anthropicKey; delete s.geminiKey; delete s.sharedPasscode; }
    out.settings = s;
  } else delete out.settings;
  return JSON.stringify(out, null, 1);
}
export function fileNameFor(p: Profile, d = new Date()): string {
  const who = p.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `digital-brick-builder${who ? '-' + who : ''}-${d.toISOString().slice(0, 10)}.dbb.json`;
}
export function parseProfileFile(text: string): Validated {
  if (text.length > LIMITS.maxBytes) return { ok: false, error: 'That file is too large to be a profile.' };
  try { return validateProfile(JSON.parse(text)); } catch { return { ok: false, error: 'That file is not valid JSON, so it cannot be a profile.' }; }
}
/** Merge an imported profile into the current one. Builds are matched by id; progress keeps the newer copy. */
export function mergeProfile(cur: Profile, inc: Profile): { profile: Profile; addedBuilds: number; updatedProgress: number } {
  const out: Profile = { ...cur, builds: [...cur.builds], progress: { ...cur.progress }, favorites: [...new Set([...cur.favorites, ...inc.favorites])] };
  if (inc.name) out.name = inc.name;
  out.look = inc.look; if (inc.last) out.last = inc.last;
  const have = new Set(out.builds.map(b => b.id));
  let addedBuilds = 0;
  for (const b of inc.builds) if (!have.has(b.id)) { out.builds.push(b); have.add(b.id); addedBuilds++; }
  out.builds = out.builds.slice(-LIMITS.builds);
  let updatedProgress = 0;
  for (const [k, v] of Object.entries(inc.progress)) if (!out.progress[k] || out.progress[k].updated < v.updated) { out.progress[k] = v; updatedProgress++; }
  return { profile: out, addedBuilds, updatedProgress };
}

// ---------- share links (no server: the shape spec travels inside the URL) ----------
const b64u = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const w = stream.writable.getWriter(); w.write(bytes as unknown as BufferSource); w.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}
/** "z." = deflate-compressed, "r." = plain (older browsers). */
export async function encodeShare(spec: ShapeSpec): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(spec));
  try { if (typeof CompressionStream !== 'undefined') return 'z.' + b64u(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall through */ }
  return 'r.' + b64u(bytes);
}
export async function decodeShare(code: string): Promise<{ ok: true; spec: ShapeSpec } | { ok: false; error: string }> {
  try {
    if (code.length > 200_000) return { ok: false, error: 'That share link is too long to be valid.' };
    const kind = code.slice(0, 2), body = code.slice(2);
    let bytes: Uint8Array = unb64u(body);
    if (kind === 'z.') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
    else if (kind !== 'r.') return { ok: false, error: 'This share link is not recognised.' };
    const parsed = parseSpec(new TextDecoder().decode(bytes));
    return parsed.ok ? { ok: true, spec: parsed.spec } : { ok: false, error: 'The shared build failed validation: ' + parsed.errors[0] };
  } catch { return { ok: false, error: 'This share link is damaged and could not be opened.' }; }
}
