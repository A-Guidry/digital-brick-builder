# Digital Brick Builder: full deploy plan (for Claude Code)

Goal: publish the site on the owner's domain (GitHub Pages), and add a shared AI proxy on the owner's VPS so friends and family can use AI without their own key, with a passcode and rate limits. Everything below is meant to be executed end to end, with a pause for approval at each step marked **ASK**.

Project folder: the `digital-brick-builder` folder this file sits in (Vite + TypeScript static site, tests with vitest, browser tests with Playwright, `npm run build` makes one `dist/index.html`). Read `README.md`, `ARCHITECTURE.md` and `PUBLISHING.md` first.

## 0. Information the owner must provide (fill in before starting)

Claude Code: if any value is blank, ask the owner for it once, in plain text, before doing anything else. Never ask for passwords or API keys in chat (see Rules).

| # | Item | Value |
|---|------|-------|
| 1 | Site address (domain or subdomain), e.g. `bricks.example.com` | |
| 2 | Proxy address on the VPS, e.g. `api.example.com` | |
| 3 | Where the domain's DNS is managed (Cloudflare, GoDaddy, Namecheap, etc.) and whether Claude Code can edit records itself (API/CLI) or the owner will enter them | |
| 4 | GitHub username or organisation, and repo name (default `digital-brick-builder`, public) | |
| 5 | VPS: provider, public IP, OS and version, SSH user, SSH key or host alias already set up on this computer | |
| 6 | Is Caddy, nginx or Apache already running on the VPS? Which ports are in use? | |
| 7 | Which AI answers the shared requests: `anthropic`, `qwen` or `switchable` (default `switchable`, starting on `anthropic`) | |
| 8 | Anthropic model name to use (default `claude-sonnet-4-5`) | |
| 9 | Qwen: where it runs (home computer / VPS / elsewhere), the OpenAI-compatible address (e.g. `http://127.0.0.1:11434/v1`), the model name, and whether it has vision | |
| 10 | If Qwen is not on the VPS: can Tailscale (or WireGuard) be installed on both machines? | |
| 11 | Rate limits per person (default 10 requests/hour and 40/day), daily cap across everyone (default 150), max request size (default 1 MB, images included) | |
| 12 | Who gets the passcode, and how many separate passcodes (default one shared passcode; optional one per person so a single person can be cut off) | |
| 13 | Contact email for Let's Encrypt certificate notices | |
| 14 | Anything the owner wants hidden or changed on the site before it goes live | |

Owner-only actions (Claude Code cannot do these and must not try): create the Anthropic key and set its **monthly spend limit** in the Anthropic console; type the key into the VPS `.env` file themselves; approve DNS changes at the registrar if no API access.

## Rules (apply to every phase)

1. Never put an API key, passcode or `.env` content in the repo, in chat, in logs, in shell history or in a commit. Secrets are entered by the owner directly on the VPS (`nano /etc/dbb-proxy/env`) or via a hidden prompt (`read -s`).
2. **ASK before:** creating the public GitHub repo, changing DNS, opening firewall ports, installing packages or services on the VPS, restarting anything that is already running there, and any deletion. Show the exact command or record first.
3. Do not touch anything on the VPS that is not part of this project. If another site or service is present, work alongside it (separate Caddy site block, separate port, separate user).
4. Keep the footer disclaimer and the "Project disclaimer" line. Do not add LEGO logos or branding.
5. Do not change existing app behaviour except as listed. All existing tests must keep passing.
6. After each phase, run the checks listed for it. If a check fails, fix it before moving on. Keep a running `DEPLOY_LOG.md` (no secrets) with what was done, so it can be reversed.
7. Prefer small reversible steps. Take a note of the VPS state before changes (`ss -tlnp`, `systemctl list-units --type=service --state=running`, firewall status).

## Phase 1: verify the project locally

1. `npm ci`, `npm test` (expect 64 unit tests passing), `npm run build`.
2. Optional but recommended: start the dev server and run `node scripts/e2e.mjs` (expect 88/88; takes about 15 minutes; needs Playwright's Chromium). Do not run two e2e runs at once.
3. Confirm no secrets are tracked: `git grep -nEi "sk-ant|api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]"` returns nothing meaningful.

## Phase 2: build the proxy (new folder `server/`)

A small Node 20+ program with **no runtime dependencies** (built-in `http`, `fetch`, `crypto`). Files: `server/proxy.mjs`, `server/proxy.test.mjs` (node:test), `server/README.md`, `server/dbb-proxy.service`, `server/Caddyfile.example`, `server/env.example`.

Behaviour:

- `POST /v1/ai` only. Body: `{ "system": string, "messages": [{ "role": "user"|"assistant", "text": string, "image"?: {"mime": string, "base64": string} }] }`. This mirrors the app's internal `Msg` type in `src/llm.ts`; read that file and match what each provider there sends and expects.
- Response: `{ "text": string }` on success; `{ "error": string }` with a plain-language message and the right status (401 bad passcode, 429 limit with a `Retry-After` header and a friendly message saying when to try again, 413 too large, 502 upstream trouble, 504 timeout).
- `GET /healthz` returns `ok` (no secrets, no upstream call).
- `OPTIONS` preflight handled. CORS allows only the origins in `ALLOWED_ORIGINS` (the site address from item 1, plus `http://localhost:5173` only if `ALLOW_LOCALHOST=1`). Never `*`.
- Passcode: header `x-dbb-passcode`. Stored as a list in env (`PASSCODES=name1:code1,name2:code2`), compared in constant time. The name is only used for rate-limit bucketing and logs.
- Rate limits (env-configurable, defaults from item 11): per passcode-name and per client IP, sliding window, hourly and daily; plus a global daily cap. In-memory is fine (state resets on restart); document that. Trust `X-Forwarded-For` only from the local reverse proxy.
- Request size cap, per-request upstream timeout (default 90 s), concurrency cap (default 3 in flight), `max_tokens` capped server-side regardless of what the client asks.
- Upstream selection by `UPSTREAM=anthropic|qwen`: `anthropic` calls the Anthropic Messages API with the key from `ANTHROPIC_API_KEY` and the model from env; `qwen` calls the OpenAI-compatible chat endpoint at `QWEN_BASE_URL` with `QWEN_MODEL` (and an optional `QWEN_API_KEY`). Changing `UPSTREAM` and restarting switches the AI for everyone. The client never chooses the model or upstream.
- Logging: one line per request with time, passcode name, client IP hash (not raw IP), status and duration. **Never** log prompts, images, responses, passcodes or keys.
- Startup fails loudly if required env is missing. The process never prints env values.
- Tests (node:test, upstream mocked with a local http server): good request, bad/missing passcode, over-limit hourly/daily/global (with `Retry-After`), oversize body, wrong origin, upstream error and timeout mapped correctly, key and passcode never appear in any response or log output, `max_tokens` clamped, image passthrough.

## Phase 3: app change ("Shared server" provider)

1. `src/llm.ts`: add provider `shared`. It POSTs to the configured proxy URL (`/v1/ai`) with the passcode header, and maps the `{text}` / `{error}` responses into the same return and error shapes the other providers use (so the repair loop and error messages work unchanged). Show the 429 message to the user as written.
2. `src/config.ts` (new): `export const SHARED_URL = '<proxy address from item 2>'` with a comment that it is public and contains no secret. Build-time default only; the Settings field can override it.
3. Settings dialog: add a fourth choice "Shared server". It shows only a Passcode field (password input, stored in localStorage with the other settings, never put in profile files, never in share links) and a Test connection button (calls `/healthz` then a tiny request). Hide the key/model fields for this choice. If `SHARED_URL` is set, make "Shared server" the default selection for first-time visitors.
4. Profile file export/import: the passcode must be excluded unless the same "include keys" opt-in is ticked (treat it like an API key). Update `src/profile.ts` validation and its tests.
5. Tests: add unit tests for the provider (mocked fetch) and extend `scripts/e2e.mjs` with a mocked proxy route (pattern: `mockAnthropic`). Run the phone checks too: `node scripts/phone.mjs phone|small|land` and `node scripts/phone-build.mjs phone`.
6. Keep `tsc --noEmit`, all unit tests, e2e 88/88 (plus the new checks) green.

## Phase 4: deploy the proxy on the VPS (ASK at each step)

1. SSH in, record the starting state (Rule 7). Confirm OS, Node availability (install Node 20+ LTS from the distro or NodeSource only after asking), and that no other service uses the chosen local port (default 8787, bound to 127.0.0.1 only).
2. Create a dedicated unprivileged user `dbb` with no shell login. Put the app in `/opt/dbb-proxy/`, owned by that user. Create `/etc/dbb-proxy/env` (mode 600, owner `dbb`) from `env.example` with placeholders. **Stop and tell the owner to fill in `ANTHROPIC_API_KEY` and `PASSCODES` themselves** (give the exact `sudoedit` command). Generate suggested passcodes with `openssl rand -base64 18`, but show them only to the owner on their screen, not in the log file.
3. Install the systemd unit (`dbb-proxy.service`) with hardening: `User=dbb`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`, `Restart=on-failure`, `EnvironmentFile=/etc/dbb-proxy/env`. Enable and start. Check `systemctl status` and `curl http://127.0.0.1:8787/healthz`.
4. Reverse proxy and https: if Caddy exists, add a separate site block for the proxy address (reverse_proxy to 127.0.0.1:8787, security headers, no access log of bodies). If no web server exists, install Caddy (ask first). If nginx/Apache owns ports 80/443, add a server block there with a Let's Encrypt cert via certbot instead, and do not disturb existing sites.
5. Firewall: allow 22, 80, 443 only (ufw or the existing firewall; check SSH access still works before enabling). Do not expose 8787. Suggest `fail2ban` for SSH and unattended security updates; install only if the owner agrees.
6. If `UPSTREAM=qwen` or `switchable` and Qwen is not on the VPS: set up Tailscale on both machines (ask; the owner must log in to Tailscale in their own browser), point `QWEN_BASE_URL` at the Qwen machine's tailnet address, and make sure Qwen listens on that interface only (for Ollama set `OLLAMA_HOST` appropriately; no public exposure). Test with `curl` from the VPS.
7. DNS: create an `A` record for the proxy address pointing to the VPS IP (and `AAAA` if the VPS has IPv6). Wait for propagation, then confirm https works with a valid certificate.
8. Live checks (use a throwaway passcode; never print it): `/healthz` over https; wrong passcode gives 401; request from a wrong `Origin` is refused by CORS; one real small request returns text; send enough requests to confirm the 429 and `Retry-After`; confirm logs contain no prompts or secrets (`journalctl -u dbb-proxy`).
9. Write `server/README.md` operations notes: how to change limits, rotate passcodes, switch `UPSTREAM`, read logs, update the proxy, and roll back.

## Phase 5: publish the site

1. **ASK**, then create the public GitHub repo (item 4) with `gh repo create ... --public --source=. --remote=origin`, commit, push `main`. The repo must contain `.github/workflows/pages.yml` (already present) and must not contain `server/env*` with real values (only `env.example`).
2. Enable Pages with source "GitHub Actions": `gh api -X POST repos/<owner>/<repo>/pages -f build_type=workflow` (use PUT if it exists). Watch `gh run watch`; fix and re-push on failure.
3. Custom domain: add a `public/CNAME` file containing the site address (so it survives deploys) or set it via `gh api -X PUT repos/<owner>/<repo>/pages -f cname=<site address>`. Add the DNS record: a `CNAME` for the site subdomain pointing to `<owner>.github.io` (for a bare domain use GitHub's four `A` records). Then enable "Enforce HTTPS" once the certificate is issued (can take minutes to a day).
4. Confirm `https://<site address>` loads, the footer shows "Project disclaimer", a ready-made build renders, and the browser console has no errors.

## Phase 6: end-to-end acceptance

On the live site, in a fresh browser profile and on a real phone if possible:

- First-time visit shows "Shared server" selected; entering a wrong passcode gives a clear error; the right passcode lets "a small red house" generate a model that passes the build checks.
- A picture upload works if (and only if) the active upstream supports vision; otherwise the message says so plainly.
- Hitting the rate limit shows a friendly message with when to retry.
- Saving a profile file does not contain the passcode by default.
- A share link opens correctly in a second browser.
- Build tab works on a phone: open a bag, place a brick by tapping, and by press-and-drag.
- Look at the Anthropic console: spend is recorded, and the owner's monthly limit is set.

## Phase 7: handoff report (plain language, no secrets)

Give the owner: the live site URL, the proxy URL, where the proxy lives on the VPS and how to see its logs, how to change the limits and passcodes, how to switch between Qwen and Anthropic, how to update the site (`git push`), what was installed or changed on the VPS (from `DEPLOY_LOG.md`), how to undo each step, and the known limits: live AI providers and the VPS path were first tested in production; the proxy's rate-limit counters reset when it restarts; the site's saved builds live in each visitor's own browser; physics and touch were tested only in emulated phones.
