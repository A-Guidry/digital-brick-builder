import { Msg } from './prompt';

export type ProviderId = 'anthropic' | 'gemini' | 'local';
export interface Settings {
  provider: ProviderId;
  anthropicKey: string; anthropicModel: string;
  geminiKey: string; geminiModel: string;
  localUrl: string; localModel: string;
}
export const DEFAULTS: Settings = {
  provider: 'anthropic',
  anthropicKey: '', anthropicModel: 'claude-sonnet-4-5',
  geminiKey: '', geminiModel: 'gemini-2.5-flash',
  localUrl: 'http://localhost:11434/v1', localModel: 'llama3.2-vision',
};
const KEY = 'brickforge.settings.v1';
export function loadSettings(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ } }
export function clearKeys() { const s = loadSettings(); s.anthropicKey = ''; s.geminiKey = ''; saveSettings(s); }

export function isConfigured(s: Settings): boolean {
  return s.provider === 'anthropic' ? !!s.anthropicKey.trim() : s.provider === 'gemini' ? !!s.geminiKey.trim() : !!s.localUrl.trim() && !!s.localModel.trim();
}

async function readError(r: Response): Promise<string> {
  let body = ''; try { body = (await r.text()).slice(0, 300); } catch { /* ignore */ }
  if (r.status === 401 || r.status === 403) return `The provider rejected the key (${r.status}). Check it and try again. ${body}`;
  if (r.status === 404) return `Model or endpoint not found (404). Check the model name. ${body}`;
  if (r.status === 429) return `Rate limited or out of quota (429). ${body}`;
  return `Provider error ${r.status}. ${body}`;
}
const netHint = (e: unknown, what: string) => new Error(`Could not reach ${what}: ${(e as Error).message}. ` +
  (what.includes('local') ? 'Is the server running, and does it allow browser requests (CORS)? For Ollama set OLLAMA_ORIGINS="*".' : 'Check your network connection.'));

export async function complete(s: Settings, system: string, msgs: Msg[], signal?: AbortSignal): Promise<string> {
  if (s.provider === 'anthropic') {
    let r: Response;
    try {
      r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', signal,
        headers: { 'content-type': 'application/json', 'x-api-key': s.anthropicKey.trim(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        body: JSON.stringify({
          model: s.anthropicModel, max_tokens: 4096, system,
          messages: msgs.map(m => ({ role: m.role, content: m.image
            ? [{ type: 'image', source: { type: 'base64', media_type: m.image.mime, data: m.image.base64 } }, { type: 'text', text: m.text }]
            : m.text })),
        }),
      });
    } catch (e) { throw netHint(e, 'Anthropic'); }
    if (!r.ok) throw new Error(await readError(r));
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
          generationConfig: { maxOutputTokens: 4096, responseMimeType: 'application/json' },
        }),
      });
    } catch (e) { throw netHint(e, 'Gemini'); }
    if (!r.ok) throw new Error(await readError(r));
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
  if (!r.ok) throw new Error(await readError(r));
  const j = await r.json();
  return j.choices?.[0]?.message?.content ?? '';
}

export async function testConnection(s: Settings): Promise<string> {
  const out = await complete(s, 'Reply with the single word OK.', [{ role: 'user', text: 'ping' }]);
  return out.trim().slice(0, 40) || '(empty reply)';
}
