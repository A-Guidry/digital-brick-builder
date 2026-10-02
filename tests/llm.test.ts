import { describe, it, expect, vi, afterEach } from 'vitest';
import { complete, testConnection, isConfigured, clearKeys, loadSettings, saveSettings, missingSetting, listLocalModels, DEFAULTS, Settings } from '../src/llm';

const shared = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, provider: 'shared', sharedUrl: 'https://proxy.example/', sharedPasscode: ' secret-code ', ...over });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
afterEach(() => { vi.unstubAllGlobals(); });

describe('shared server provider', () => {
  it('first-time visitors default to the shared server (build-time SHARED_URL is set)', () => {
    expect(DEFAULTS.provider).toBe('shared');
    expect(DEFAULTS.sharedUrl).toMatch(/^https:\/\//);
    expect(DEFAULTS.sharedPasscode).toBe('');
  });
  it('is configured only when a passcode is present', () => {
    expect(isConfigured(shared({ sharedPasscode: '' }))).toBe(false);
    expect(isConfigured(shared({ sharedPasscode: '   ' }))).toBe(false);
    expect(isConfigured(shared())).toBe(true);
  });
  it('posts system + messages (with image) and the passcode header to /v1/ai, and returns the text', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { text: 'hello' })); vi.stubGlobal('fetch', f);
    const out = await complete(shared(), 'SYS', [{ role: 'user', text: 'hi', image: { mime: 'image/png', base64: 'AAAA' } }, { role: 'assistant', text: 'ok' }]);
    expect(out).toBe('hello');
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://proxy.example/v1/ai');
    expect(init.headers['x-dbb-passcode']).toBe('secret-code');
    expect(JSON.parse(init.body)).toEqual({ system: 'SYS', messages: [{ role: 'user', text: 'hi', image: { mime: 'image/png', base64: 'AAAA' } }, { role: 'assistant', text: 'ok' }] });
    expect(init.body).not.toContain('secret-code');
  });
  it('shows the server\'s friendly message as written (429 and 401)', async () => {
    const msg = 'You have used your shared AI allowance for today. Please try again in about 5 hours.';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(429, { error: msg }, { 'retry-after': '18000' })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(msg);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { error: 'That passcode is not right. Check it and try again.' })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow('That passcode is not right');
  });
  it('falls back to a plain message when the error body is not JSON, and explains network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/shared server had a problem \(502\)/);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/Could not reach the shared server/);
  });
  it('test connection checks /healthz first, then makes a tiny request', async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response('ok')).mockResolvedValueOnce(json(200, { text: 'OK' })); vi.stubGlobal('fetch', f);
    expect(await testConnection(shared())).toBe('OK');
    expect(f.mock.calls[0][0]).toBe('https://proxy.example/healthz');
    expect(f.mock.calls[1][0]).toBe('https://proxy.example/v1/ai');
  });
  it('test connection stops at an unhealthy server without spending a request', async () => {
    const f = vi.fn().mockResolvedValue(new Response('no', { status: 503 })); vi.stubGlobal('fetch', f);
    await expect(testConnection(shared())).rejects.toThrow(/Could not reach the shared server/);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('clearKeys also clears the saved passcode', () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    saveSettings(shared()); clearKeys();
    expect(loadSettings().sharedPasscode).toBe('');
  });
});

const gem = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, provider: 'gemini', geminiKey: 'AIzaREAL', geminiModel: 'gemini-test', ...over });
const loc = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, provider: 'local', localUrl: 'http://localhost:11434/v1/', localModel: 'llama3.2-vision', ...over });
const ask = (s: Settings) => complete(s, 'sys', [{ role: 'user', text: 'hi' }]);

describe('empty boxes are caught before any request', () => {
  it('names what is missing for every provider', () => {
    expect(missingSetting(gem({ geminiKey: '  ' }))).toMatch(/No Gemini key entered.*AIza/);
    expect(missingSetting({ ...DEFAULTS, provider: 'anthropic', anthropicKey: '' })).toMatch(/No Anthropic key entered/);
    expect(missingSetting(shared({ sharedPasscode: '' }))).toMatch(/passcode/);
    expect(missingSetting(loc({ localModel: '' }))).toMatch(/Find installed models/);
    expect(missingSetting(gem())).toBe('');
  });
  it('Test connection and generate send nothing when the key box is empty (the "unregistered callers" 403)', async () => {
    const f = vi.fn(); vi.stubGlobal('fetch', f);
    await expect(testConnection(gem({ geminiKey: '' }))).rejects.toThrow(/No Gemini key entered yet/);
    await expect(ask(gem({ geminiKey: '' }))).rejects.toThrow(/No Gemini key entered yet/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('provider errors are explained', () => {
  const fail = (status: number, body: unknown) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(status, body)));
  it('Gemini: no key reached Google', async () => {
    fail(403, { error: { code: 403, message: "Method doesn't allow unregistered callers (callers without established identity). Please use API Key or other form of API consumer identity to call this API.", status: 'PERMISSION_DENIED' } });
    await expect(ask(gem())).rejects.toThrow(/Google received no API key/);
  });
  it('Gemini: invalid key, restricted key, retired model, quota, overload', async () => {
    fail(400, { error: { message: 'API key not valid. Please pass a valid API key.' } });
    await expect(ask(gem())).rejects.toThrow(/not valid.*aistudio\.google\.com\/apikey/);
    fail(403, { error: { message: 'Requests from referer https://x are blocked.' } });
    await expect(ask(gem())).rejects.toThrow(/refused this key from this website.*brickbuilder\.arcwel\.ai/);
    fail(404, { error: { message: 'This model is no longer available to new users.' } });
    await expect(ask(gem())).rejects.toThrow(/does not offer the model "gemini-test".*gemini-3\.5-flash-lite/);
    fail(429, { error: { message: 'quota' } });
    await expect(ask(gem())).rejects.toThrow(/free-tier or rate limit/);
    fail(503, { error: { message: 'high demand' } });
    await expect(ask(gem())).rejects.toThrow(/overloaded right now \(503\)/);
  });
  it('Anthropic keeps its original wording', async () => {
    fail(401, { error: { message: 'invalid x-api-key' } });
    await expect(ask({ ...DEFAULTS, provider: 'anthropic', anthropicKey: 'sk-ant-x' })).rejects.toThrow(/rejected the key \(401\)/);
  });
  it('Local: server refuses the website, or lacks the model', async () => {
    fail(403, 'Forbidden');
    await expect(ask(loc())).rejects.toThrow(/refused this website.*localhost.*OLLAMA_ORIGINS/);
    fail(502, { error: 'no available node advertises the requested model' });
    await expect(ask(loc())).rejects.toThrow(/does not have the model "llama3\.2-vision".*Find installed models/);
  });
});

describe('finding installed local models', () => {
  it('reads the OpenAI-style list', async () => {
    const f = vi.fn().mockResolvedValue(json(200, { data: [{ id: 'qwen3.5:9b' }, { id: 'nomic-embed-text:latest' }] })); vi.stubGlobal('fetch', f);
    expect(await listLocalModels(loc())).toEqual(['qwen3.5:9b', 'nomic-embed-text:latest']);
    expect(f.mock.calls[0][0]).toBe('http://localhost:11434/v1/models');
  });
  it('explains an unreachable or refusing server', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(listLocalModels(loc())).rejects.toThrow(/Could not reach the local model server/);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
    await expect(listLocalModels(loc())).rejects.toThrow(/refused this website/);
  });
});
