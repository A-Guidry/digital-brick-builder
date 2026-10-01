# Shared AI proxy (server/)

A small Node 20+ program with no dependencies. The site sends it one request type; it checks a passcode, applies limits, and forwards to ONE AI chosen by the server. Credentials never reach the browser.

- `POST /v1/ai` with header `x-dbb-passcode`. Body `{ system, messages:[{role,text,image?:{mime,base64}}] }`. Reply `{ text }` or `{ error }`.
- `GET /healthz` returns `ok` (no upstream call).
- Statuses: 401 wrong passcode, 403 wrong website, 413 too big, 429 limit (with `Retry-After`), 502 AI trouble, 504 timeout.

## Files
| File | Purpose |
|---|---|
| `proxy.mjs` / `proxy.test.mjs` | the program and its tests (`npm test` runs them) |
| `env.example` | every setting, with defaults. Real values live ONLY in `/etc/dbb-proxy/env` on the server |
| `dbb-proxy.service` | systemd unit (runs as user `dbb`, hardened) |
| `nginx.conf.example` | nginx site for the proxy address (this VPS already runs nginx) |
| `switch-upstream.sh` | switch the AI for everyone: `switch-upstream.sh qwen` or `gemini` |

## Where it lives (production)
Program `/opt/dbb-proxy/`, settings `/etc/dbb-proxy/env` (mode 600), service `dbb-proxy`, listening on `127.0.0.1:8787` only. nginx terminates https.

## Everyday operations (run on the VPS as root)
- **Logs** (one safe line per request: time, passcode name, hashed IP, status, ms; never prompts, passcodes or keys): `journalctl -u dbb-proxy -f`
- **Switch AI**: `/opt/dbb-proxy/switch-upstream.sh gemini` (or `qwen`). Limits switch with it (see below).
- **Change limits**: edit `LIMIT_DAY`, `LIMIT_GLOBAL_DAY`, optionally `LIMIT_HOUR` in `/etc/dbb-proxy/env` (format `qwen:60,gemini:10`), then `systemctl restart dbb-proxy`. Defaults: Qwen 60/day per person, Gemini 10/day per person, plus a daily cap across everyone (300 / 30). Each person is limited both by passcode name and by connection, so sharing a passcode does not multiply the allowance.
- **Add / rotate / cut off a passcode**: edit `PASSCODES` (`ann:code1,bob:code2`), restart. Remove a name to cut that person off. New code: `openssl rand -base64 18`.
- **Update the proxy**: copy new `proxy.mjs` to `/opt/dbb-proxy/`, `systemctl restart dbb-proxy`, check `curl -s http://127.0.0.1:8787/healthz`.
- **Roll back**: keep the previous `proxy.mjs` as `proxy.mjs.prev`; copy it back and restart.

## Good to know
- Rate-limit counters are in memory. A restart resets everyone's allowance (so switching the AI also resets it).
- Behind nginx the client address comes from `X-Forwarded-For`, which nginx overwrites with the real address; the proxy only trusts it when the request comes from localhost.
- Qwen runs on the owner's Mac and is reached over Tailscale. If the Mac is asleep or off, requests fail with a friendly 502; switch to Gemini meanwhile.
- Pictures only work if the active model supports vision (Gemini does; check the Qwen build).
