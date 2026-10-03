import { Msg, Detail } from './prompt';
import { SHARED_URL } from './config';

export type ProviderId = 'shared' | 'anthropic' | 'gemini' | 'local';
export interface Settings {
  provider: ProviderId;
  anthropicKey: string; anthropicModel: string;
  geminiKey: string; geminiModel: string;
  localUrl: string; localModel: string;
  sharedUrl: string; sharedPasscode: string;
  /** After building, the AI looks at its own model from four sides and fixes it if it does not look like the request. */
  lookCheck: boolean;
  /** 'high' asks for a bigger, richer model (more shapes, small details). */
  detail: Detail;
}
export const DEFAULTS: Settings = {
  provider: SHARED_URL ? 'shared' : 'anthropic',
  anthropicKey: '', anthropicModel: 'claude-sonnet-4-5',
  geminiKey: '', geminiModel: 'gemini-3.5-flash-lite',
  localUrl: 'http://localhost:11434/v1', localModel: 'llama3.2-vision',
  sharedUrl: SHARED_URL, sharedPasscode: '',
  lookCheck: true,
  detail: 'high',
};
const KEY = 'brickforge.settings.v1';
export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
export function clearKeys() { const s = loadSettings(); s.anthropicKey = ''; s.geminiKey = ''; s.sharedPasscode = ''; saveSettings(s); }

/** Chose Gemini but has no key of their own: use the site's built-in Gemini through the shared server (the real key stays on the server). */
export const geminiViaSite = (s: Settings) => s.provider === 'gemini' && !s.geminiKey.trim() && !!s.sharedUrl.trim();

export function isConfigured(s: Settings): boolean {
  if (s.provider === 'shared') return !!s.sharedUrl.trim();   // a passcode is optional: without one you are a free guest with a daily allowance
  return s.provider === 'anthropic' ? !!s.anthropicKey.trim() : s.provider === 'gemini' ? (!!s.geminiKey.trim() || !!s.sharedUrl.trim()) : !!s.localUrl.trim() && !!s.localModel.trim();
}

type Who = 'anthropic' | 'gemini' | 'local';
/** A setup link "…/#pc=<passcode>" opens the app already pointed at the shared server. Returns the passcode, or null if the address is not one. */
export function passcodeFromHash(hash: string): string | null {
  const m = hash.match(/^#pc=([^&]+)$/); if (!m) return null;
  let v = ''; try { v = decodeURIComponent(m[1]); } catch { return null; }
  v = v.trim();
  return v.length >= 8 && v.length <= 200 && !/[\u0000-\u001f\u007f\s]/.test(v) ? v : null;
}

/** Says what is missing BEFORE any request is made, so an empty box never turns into a confusing error from the provider. */
export function missingSetting(s: Settings): string {
  if (s.provider === 'shared') return s.sharedUrl.trim() ? '' : 'The shared server address is empty. Clear it to use the default, or choose another AI.';
  if (s.provider === 'anthropic') return s.anthropicKey.trim() ? '' : 'No Anthropic key entered yet. Paste your key (it starts with "sk-ant-") in the box above, then try again.';
  if (s.provider === 'gemini') return s.geminiKey.trim() || s.sharedUrl.trim() ? '' : 'No Gemini key entered yet. Paste your key (you can get one free at aistudio.google.com/apikey) in the box above, then try again.';
  if (!s.localUrl.trim()) return 'Enter the address of your local model server (for Ollama: http://localhost:11434/v1).';
  return s.localModel.trim() ? '' : 'Enter a model name, or press "Find installed models".';
}

/** Turns a provider's error into something a person can act on. Keeps the provider's own words at the end for support. */
async function readError(r: Response, who: Who, model = ''): Promise<string> {
  let raw = ''; try { raw = await r.text(); } catch { /* ignore */ }
  let msg = raw; try { const j = JSON.parse(raw); msg = String(j.error?.message ?? (typeof j.error === 'string' ? j.error : '') ?? j.message ?? raw); } catch { /* not JSON */ }
  msg = msg.replace(/\s+/g, ' ').trim().slice(0, 220);
  const st = r.status, tail = msg ? ` (${msg})` : '';
  if (who === 'gemini') {
    if (/unregistered callers|without established identity/i.test(msg)) return `Google received no API key. Paste your key into the Gemini box and try again.${tail}`;
    if (st === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return `Google says that API key is not valid. Copy it again from aistudio.google.com/apikey and paste it with no spaces.${tail}`;
    if (st === 403) return `Google refused this key from this website (403). If you limited the key to certain websites or apps in Google AI Studio or Cloud, allow brickbuilder.arcwel.ai or make a new unrestricted key.${tail}`;
    if (st === 404) return `Google does not offer the model "${model}" to your key (404). Try gemini-3.5-flash-lite in the Model box.${tail}`;
    if (st === 429) return `Google says you have reached its free-tier or rate limit (429). Wait a minute and try again.${tail}`;
    if (st >= 500) return `Google's model is overloaded right now (${st}). Try again in a moment, or set the Model box to gemini-3.5-flash-lite.${tail}`;
  }
  if (who === 'local') {
    if (st === 403) return 'Your local model server refused this website (403). Some servers, including the PAIR app on port 11434, only accept pages opened from localhost. Open this app at http://localhost (run npm run dev), or for plain Ollama set OLLAMA_ORIGINS="https://brickbuilder.arcwel.ai" and restart it.' + tail;
    if (st === 404 || /model|node advertises/i.test(msg)) return `Your server does not have the model "${model}". Press "Find installed models" to pick one that is installed.${tail}`;
  }
  if (st === 401 || st === 403) return `The provider rejected the key (${st}). Check it and try again.${tail}`;
  if (st === 404) return `Model or endpoint not found (404). Check the model name.${tail}`;
  if (st === 429) return `Rate limited or out of quota (429).${tail}`;
  return `Provider error ${st}.${tail}`;
}
const netHint = (e: unknown, what: string) => {
  const local = what.includes('local');
  const https = typeof location !== 'undefined' && location.protocol === 'https:';
  return new Error(`Could not reach ${what}: ${(e as Error).message}. ` + (local
    ? (https ? 'Chrome blocks a website from reaching your own computer unless you allow it: click the lock icon next to the address, allow "Local network access", and reload. Also check the server is running and accepts this website (Ollama: OLLAMA_ORIGINS).' : 'Is the server running, and does it allow browser requests (CORS)? For Ollama set OLLAMA_ORIGINS="*".')
    : 'Check your network connection.'));
};

/** Places a local model server is usually found, best first. The gateway (11436) is listed first because it accepts websites; plain Ollama and the PAIR proxy often do not. */
export const LOCAL_CANDIDATES = ['http://127.0.0.1:11436/v1', 'http://localhost:11434/v1', 'http://localhost:11435/v1'];

/** Finds a local server that really answers this website. Only when the saved address is one of the usual defaults:
 *  an address the person typed themselves is respected, never swapped for a different server. A server that refuses the
 *  website (403) or is not there does not count. Returns its address and models, or null. */
export async function detectLocalServer(s: Settings): Promise<{ url: string; models: string[] } | null> {
  const norm = (u: string) => u.trim().replace(/\/+$/, '');
  const saved = norm(s.localUrl);
  const isDefault = !saved || LOCAL_CANDIDATES.includes(saved);
  const urls = (isDefault ? [saved, ...LOCAL_CANDIDATES] : [saved]).filter((u, i, a) => u && a.indexOf(u) === i);
  for (const url of urls) {
    try {
      const r = await fetch(`${url}/models`, { signal: AbortSignal.timeout(4000) });
      if (!r.ok) continue;
      const j = await r.json();
      const models: string[] = (j.data ?? j.models ?? []).map((m: any) => String(m.id ?? m.name ?? '')).filter(Boolean);
      return { url, models };
    } catch { /* not here, or blocked: try the next */ }
  }
  return null;
}

/** Which installed model to use when the saved one is missing: never an embedding model (they cannot chat),
 *  and prefer the one the server keeps loaded (the gateway reports it) so the first request is not a cold start. */
export function pickChatModel(models: string[], warm?: string): string | undefined {
  const chat = models.filter(m => !/embed|rerank/i.test(m));
  return (warm && chat.includes(warm) ? warm : chat[0]) ?? undefined;
}

/** The model a gateway keeps loaded, if this server is one (GET /gateway/health at the server's origin). */
export async function gatewayWarmModel(url: string): Promise<string | undefined> {
  try {
    const r = await fetch(new URL('/gateway/health', url), { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return undefined;
    const j = await r.json();
    return typeof j.warm === 'string' && j.warm ? j.warm : undefined;
  } catch { return undefined; }
}

/** Models the local server says it has (OpenAI-compatible GET /models). */
export async function listLocalModels(s: Settings): Promise<string[]> {
  const base = s.localUrl.trim().replace(/\/+$/, '');
  if (!base) throw new Error('Enter the address of your local model server first.');
  let r: Response;
  try { r = await fetch(`${base}/models`); } catch (e) { throw netHint(e, 'the local model server'); }
  if (!r.ok) throw new Error(await readError(r, 'local'));
  const j = await r.json();
  return (j.data ?? j.models ?? []).map((m: any) => String(m.id ?? m.name ?? '')).filter(Boolean);
}

/** A random id for this browser, so each person gets their own daily allowance even when they share a home internet connection. Not personal data. */
export function guestId(): string {
  const make = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9]/g, '').padEnd(24, '0').slice(0, 40);
  try { let g = localStorage.getItem('dbb.guest'); if (!g || !/^[A-Za-z0-9_-]{16,64}$/.test(g)) { g = make(); localStorage.setItem('dbb.guest', g); } return g; } catch { return make(); }
}

/** Shared server: the proxy holds the AI credentials; we send only the passcode. Its error text is already plain language. */
async function completeShared(s: Settings, system: string, msgs: Msg[], signal?: AbortSignal, prefer?: 'gemini'): Promise<string> {
  let r: Response;
  try {
    r = await fetch(`${s.sharedUrl.trim().replace(/\/+$/, '')}/v1/ai`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-dbb-guest': guestId(), ...(prefer ? { 'x-dbb-prefer': prefer } : {}), ...(s.sharedPasscode.trim() ? { 'x-dbb-passcode': s.sharedPasscode.trim() } : {}) },
      body: JSON.stringify({ system, messages: msgs.map(m => ({ role: m.role, text: m.text, ...(m.image ? { image: { mime: m.image.mime, base64: m.image.base64 } } : {}) })) }),
    });
  } catch (e) { throw netHint(e, 'the shared server'); }
  if (!r.ok) {
    let msg = ''; try { msg = String((await r.json()).error ?? ''); } catch { /* not JSON */ }
    // nginx (in front of the server) answers some problems with a web page instead of our JSON: say what actually happened
    if (!msg && r.status === 413) msg = 'That picture is too big to send. Try a smaller one, or take it again at a lower quality.';
    if (!msg && (r.status === 502 || r.status === 503 || r.status === 504)) msg = 'The shared AI is restarting or busy right now. Please try again in a minute.';
    throw new Error(msg || `The shared server had a problem (${r.status}). Try again in a moment.`);
  }
  let j: any; try { j = await r.json(); } catch { throw new Error('The shared server sent back something unexpected. Please try again in a moment.'); }
  if (typeof j?.text !== 'string' || !j.text.trim()) throw new Error('The shared AI sent back no answer. Please try again.');
  return j.text;
}

export async function complete(s: Settings, system: string, msgs: Msg[], signal?: AbortSignal, opts: { preferGemini?: boolean } = {}): Promise<string> {
  const missing = missingSetting(s); if (missing) throw new Error(missing);
  if (s.provider === 'shared') return completeShared(s, system, msgs, signal, opts.preferGemini ? 'gemini' : undefined);   // pictures need Gemini, not the Mac's text model
  if (geminiViaSite(s)) return completeShared(s, system, msgs, signal, 'gemini');   // no key of their own: the site's Gemini
  if (s.provider === 'anthropic') {
    let r: Response;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: s.anthropicModel, max_tokens: 8192, system,
          messages: msgs.map(m => ({ role: m.role, content: m.image
            ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } }, { type: 'text', text: m.text }]
            : m.text })),
        }),
      });
    } catch (e) { throw netHint(e, 'Anthropic'); }
    if (!r.ok) throw new Error(await readError(r, 'anthropic', s.anthropicModel));
    const j = await r.json();
    return (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  }
  if (s.provider === 'gemini') {
    let r: Response;
    try {
      r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(s.geminiModel)}:generateContent`, {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': s.geminiKey.trim() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [
            ...(m.image ? [{ inlineData: { mimeType: m.image.mime, data: m.image.base64 } }] : []), { text: m.text }] })),
          generationConfig: { maxOutputTokens: 8192, responseMimeType: 'application/json' },
        }),
      });
    } catch (e) { throw netHint(e, 'Gemini'); }
    if (!r.ok) throw new Error(await readError(r, 'gemini', s.geminiModel));
    const j = await r.json();
    return (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  }
  // local OpenAI-compatible (Ollama, LM Studio, llama.cpp server)
  const base = s.localUrl.replace(/\/+$/, '');
  let r: Response;
  try {
    r = await fetch(`${base}/chat/completions`, {
      method: 'POST', signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: s.localModel, stream: false, temperature: 0.4,
        messages: [{ role: 'system', content: system }, ...msgs.map(m => ({ role: m.role, content: m.image
          ? [{ type: 'image_url', image_url: { url: `data:${m.image.mime};base64,${m.image.base64}` } }, { type: 'text', text: m.text }]
          : m.text }))],
      }),
    });
  } catch (e) { throw netHint(e, 'the local model server'); }
  if (!r.ok) throw new Error(await readError(r, 'local', s.localModel));
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? '';
}

export async function testConnection(s: Settings): Promise<string> {
  const missing = missingSetting(s); if (missing) throw new Error(missing);
  if (s.provider === 'shared' || geminiViaSite(s)) {
    try { const h = await fetch(`${s.sharedUrl.trim().replace(/\/+$/, '')}/healthz`); if (!h.ok) throw new Error(`status ${h.status}`); }
    catch (e) { throw netHint(e, 'the shared server'); }
  }
  const out = await complete(s, 'Reply with the single word OK.', [{ role: 'user', text: 'ping' }]);
  return out.trim().slice(0, 40) || '(empty reply)';
}
