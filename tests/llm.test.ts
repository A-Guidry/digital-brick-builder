import { describe, it, expect, vi, afterEach } from 'vitest';
import { complete, testConnection, isConfigured, clearKeys, loadSettings, saveSettings, DEFAULTS, Settings } from '../src/llm';

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
