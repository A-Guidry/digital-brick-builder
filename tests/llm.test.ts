import { describe, it, expect, vi, afterEach } from 'vitest';
import { complete, testConnection, isConfigured, clearKeys, loadSettings, saveSettings, missingSetting, listLocalModels, passcodeFromHash, detectLocalServer, LOCAL_CANDIDATES, pickChatModel, gatewayWarmModel, DEFAULTS, Settings } from '../src/llm';

const shared = (over: Partial<Settings> = {}): Settings => ({ ...DEFAULTS, provider: 'shared', sharedUrl: 'https://proxy.example/', sharedPasscode: ' secret-code ', ...over });
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
afterEach(() => { vi.unstubAllGlobals(); });

describe('shared server provider', () => {
  it('first-time visitors default to the shared server (build-time SHARED_URL is set)', () => {
    expect(DEFAULTS.provider).toBe('shared');
    expect(DEFAULTS.sharedUrl).toMatch(/^https:\/\//);
    expect(DEFAULTS.sharedPasscode).toBe('');
  });
  it('needs no passcode: a first-time visitor is ready to go as a free guest', () => {
    expect(isConfigured(shared({ sharedPasscode: '' }))).toBe(true);
    expect(isConfigured({ ...DEFAULTS })).toBe(true);
    expect(isConfigured(shared({ sharedUrl: '' }))).toBe(false);
  });
  it('sends a per-browser guest id and no passcode header when there is no passcode', async () => {
    const store: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } });
    const f = vi.fn().mockImplementation(() => Promise.resolve(json(200, { text: 'hi' }))); vi.stubGlobal('fetch', f);
    await complete(shared({ sharedPasscode: '' }), 's', [{ role: 'user', text: 'x' }]);
    await complete(shared({ sharedPasscode: '' }), 's', [{ role: 'user', text: 'y' }]);
    const h1 = f.mock.calls[0][1].headers, h2 = f.mock.calls[1][1].headers;
    expect(h1['x-dbb-passcode']).toBeUndefined();
    expect(h1['x-dbb-guest']).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    expect(h2['x-dbb-guest']).toBe(h1['x-dbb-guest']);       // the same browser keeps the same id
    expect(store['dbb.guest']).toBe(h1['x-dbb-guest']);
  });
  it('still sends the passcode when there is one', async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    const f = vi.fn().mockResolvedValue(json(200, { text: 'hi' })); vi.stubGlobal('fetch', f);
    await complete(shared(), 's', [{ role: 'user', text: 'x' }]);
    expect(f.mock.calls[0][1].headers['x-dbb-passcode']).toBe('secret-code');
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
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/restarting or busy/);   // a web page from nginx, not our JSON
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>teapot</html>', { status: 418 })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/shared server had a problem \(418\)/);
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
    expect(missingSetting(gem({ geminiKey: '  ' }))).toMatch(/No Gemini key entered.*aistudio\.google\.com\/apikey/);
    expect(missingSetting({ ...DEFAULTS, provider: 'anthropic', anthropicKey: '' })).toMatch(/No Anthropic key entered/);
    expect(missingSetting(shared({ sharedPasscode: '' }))).toBe('');          // shared needs no passcode now
    expect(missingSetting(shared({ sharedUrl: '' }))).toMatch(/address is empty/);
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

describe('setup links', () => {
  it('reads a passcode from #pc= and decodes it (base64 passcodes contain + / =)', () => {
    expect(passcodeFromHash('#pc=AAAA%2Bbbb%2Fcc%3D%3Ddddd1234')).toBe('AAAA+bbb/cc==dddd1234');
    expect(passcodeFromHash('#pc=simple-code-12345')).toBe('simple-code-12345');
  });
  it('ignores everything that is not a setup link, including share links and junk', () => {
    for (const h of ['', '#', '#s=abc123', '#pc=', '#pc=short', '#pc=has space here1', '#pc=%E0%A4%A', '#pc=ok-code-12345&x=1', '#x=#pc=ok-code-12345', '#pc=' + 'a'.repeat(201)]) expect(passcodeFromHash(h), h).toBeNull();
  });
});

describe('finding the local server by itself', () => {
  const answer = (map: Record<string, { status: number; body?: unknown } | 'throw'>) => vi.fn().mockImplementation((url: string) => {
    const hit = Object.entries(map).find(([k]) => String(url).startsWith(k));
    if (!hit || hit[1] === 'throw') return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve(json(hit[1].status, hit[1].body ?? {}));
  });
  it('skips a server that refuses the website and picks the one that accepts it', async () => {
    vi.stubGlobal('fetch', answer({
      'http://localhost:11434/v1': { status: 403 },                              // the saved address: the PAIR proxy refuses websites
      'http://127.0.0.1:11436/v1': { status: 200, body: { data: [{ id: 'qwen3.5:9b' }, { id: 'nomic-embed-text:latest' }] } },
    }));
    const hit = await detectLocalServer(loc());
    expect(hit).toEqual({ url: 'http://127.0.0.1:11436/v1', models: ['qwen3.5:9b', 'nomic-embed-text:latest'] });
  });
  it('keeps the saved address when it works, and tries the saved one first', async () => {
    const f = answer({ 'http://my.server/v1': { status: 200, body: { data: [{ id: 'm' }] } }, 'http://127.0.0.1:11436/v1': { status: 200, body: { data: [{ id: 'other' }] } } });
    vi.stubGlobal('fetch', f);
    expect((await detectLocalServer(loc({ localUrl: 'http://my.server/v1/' })))?.url).toBe('http://my.server/v1');
    expect(String(f.mock.calls[0][0])).toBe('http://my.server/v1/models');
  });
  it('returns null when nothing answers, and only ever asks the usual places', async () => {
    const f = answer({}); vi.stubGlobal('fetch', f);
    expect(await detectLocalServer(loc({ localUrl: 'http://localhost:11434/v1' }))).toBeNull();
    const asked = f.mock.calls.map(c => String(c[0]).replace('/models', ''));
    expect(asked).toEqual([...new Set(['http://localhost:11434/v1', ...LOCAL_CANDIDATES])]);   // no duplicates, nothing else
  });
});

describe('adversarial: the local-server finder must not do surprising things', () => {
  it('NEVER replaces an address the person typed with a different server, even if that address is down', async () => {
    const f = vi.fn().mockImplementation((u: string) => String(u).startsWith('http://127.0.0.1:11436') ? Promise.resolve(json(200, { data: [{ id: 'x' }] })) : Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', f);
    expect(await detectLocalServer(loc({ localUrl: 'http://my-own-box.lan:9000/v1' }))).toBeNull();
    expect(f.mock.calls.map(c => String(c[0]))).toEqual(['http://my-own-box.lan:9000/v1/models']);   // it asked ONLY the typed address
  });
  it('treats the usual defaults (any of them) as "not chosen by the person" and may look at the others', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: string) => String(u).startsWith('http://127.0.0.1:11436') ? Promise.resolve(json(200, { data: [{ id: 'm' }] })) : Promise.resolve(json(403, {}))));
    for (const u of ['http://localhost:11434/v1', 'http://localhost:11435/v1', 'http://127.0.0.1:11436/v1', '']) expect((await detectLocalServer(loc({ localUrl: u })))?.url, u).toBe('http://127.0.0.1:11436/v1');
  });
  it('a hostile or broken /models answer cannot crash it', async () => {
    for (const body of [null, 'not json at all', { data: 'nope' }, { data: [null, 5, {}] }]) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(typeof body === 'string' ? new Response(body, { status: 200 }) : json(200, body)));
      await expect(detectLocalServer(loc({ localUrl: 'http://localhost:11434/v1' }))).resolves.toSatisfy((v: any) => v === null || Array.isArray(v.models));
    }
  });
  it('never auto-picks an embedding model (it cannot chat) and prefers the one the server keeps loaded', () => {
    const real = ['qwen3.5-fazm:latest', 'qwen3.6-fazm:latest', 'qwen3.6:latest', 'qwen3.5:9b', 'nomic-embed-text:latest'];   // the owner's real list
    expect(pickChatModel(real, 'qwen3.5:9b')).toBe('qwen3.5:9b');
    expect(pickChatModel(real)).toBe('qwen3.5-fazm:latest');
    expect(pickChatModel(['nomic-embed-text:latest', 'bge-reranker'])).toBeUndefined();
    expect(pickChatModel(['nomic-embed-text:latest', 'llama3'])).toBe('llama3');
    expect(pickChatModel(real, 'not-in-the-list')).toBe('qwen3.5-fazm:latest');
  });
  it('asks the gateway which model is warm, and shrugs if it is not a gateway', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { ok: true, warm: 'qwen3.5:9b' })));
    expect(await gatewayWarmModel('http://127.0.0.1:11436/v1')).toBe('qwen3.5:9b');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await gatewayWarmModel('http://localhost:11434/v1')).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('x')));
    expect(await gatewayWarmModel('http://localhost:11434/v1')).toBeUndefined();
  });
});

describe('adversarial: the server (or nginx in front of it) answers with something that is not our JSON', () => {
  const html = (status: number) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html><body><h1>' + status + '</h1></body></html>', { status, headers: { 'content-type': 'text/html' } })));
  it('413 from nginx: says the picture is too big, never "try again in a moment"', async () => {
    html(413);
    const err = (await complete(shared(), 's', [{ role: 'user', text: 'x' }]).catch(e => e)) as Error;
    expect(err.message).toMatch(/too big/i); expect(err.message).not.toMatch(/try again in a moment/i); expect(err.message).not.toMatch(/<html/);
  });
  it('502 / 503 / 504 from nginx: says the shared AI is restarting or busy, with no HTML in the message', async () => {
    for (const st of [502, 503, 504]) { html(st); const err = (await complete(shared(), 's', [{ role: 'user', text: 'x' }]).catch(e => e)) as Error; expect(err.message, String(st)).toMatch(/restarting|busy|unavailable/i); expect(err.message).not.toMatch(/<h1>/); }
  });
  it('a 200 that is not JSON, or JSON with no text, becomes a clear error and not "undefined" or an empty build', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('hello', { status: 200 })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/did not understand|unexpected|problem/i);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(200, { nothing: true })));
    await expect(complete(shared(), 's', [{ role: 'user', text: 'x' }])).rejects.toThrow(/no answer|empty|problem/i);
  });
});
