# Deploy log (no secrets)

## 2026-09-30
- Phase 1: `npm ci`, 64 unit tests, build OK. (Plan said `pages.yml`; the repo's workflow is `deploy.yml`.)
- Repo `A-Guidry/digital-brick-builder` was already public with Pages (Actions) live at https://a-guidry.github.io/digital-brick-builder/.
- Phase 2: added `server/` proxy (qwen primary, gemini backup, anthropic optional). 20 node:test tests.
- Phase 3: added "Shared server" provider (`src/llm.ts`, `src/config.ts`, settings dialog, profile rules). Tests: 73 vitest + 20 server.
- VPS baseline before changes (187.77.28.18, Ubuntu 24.04, Node 22): nginx on 80/443 with 7 existing sites, ufw active (22/80/443/8443), pm2 apps, no tailscale, no caddy.
- DNS (Hostinger, arcwel.ai) before changes: `brickbuilder` ALIAS -> brickbuilder.arcwel.ai.cdn.hstgr.net (placeholder shared-hosting site, default.php); no proxy record.
- Security review of the proxy: fixed limit overshoot (allowance now reserved before the body is read, refunded on invalid/failed requests), added wrong-passcode throttle, 16-char minimum passcode, text-length cap, IPv6 /64 bucketing, extra systemd hardening, nginx rate limit. Known and left as-is: a hostile profile file can still set `provider`/`localUrl` if the user clicks "Apply the AI settings from this file" (existing behaviour).
- Local verification: 73 vitest + 26 proxy tests, tsc + build OK, e2e 99/99 (88 original + 11 shared-server), phone/small/land layout checks and touch checks pass, no secrets in tracked source.
- Nothing has been committed, pushed, or changed on the VPS or in DNS yet (waiting for owner approval).

## 2026-09-30 / 10-01 deployment (owner approved)
- DNS (Hostinger, arcwel.ai): ADDED `A brickbuilder-api -> 187.77.28.18` (TTL 14400). NOT YET DONE: replace ALIAS `brickbuilder -> brickbuilder.arcwel.ai.cdn.hstgr.net` with `CNAME brickbuilder -> a-guidry.github.io` (an automated edit was blocked; to be done by the owner). Undo for the A record: delete it.
- VPS 187.77.28.18: created system user `dbb` (no shell); `/opt/dbb-proxy/{proxy.mjs,switch-upstream.sh}`; `/etc/dbb-proxy/env` (root:root 600; passcode `family` generated on the server, never displayed); `/etc/systemd/system/dbb-proxy.service` (enabled, running, 127.0.0.1:8787); nginx `/etc/nginx/sites-available/dbb-proxy` (+ symlink) and `/etc/nginx/conf.d/dbb-proxy-zone.conf`, nginx reloaded (existing sites untouched); Let's Encrypt cert for brickbuilder-api.arcwel.ai via certbot (no email, auto-renew); Tailscale installed (`arcwel-vps`, DNS/routes/ssh disabled) - login pending owner approval.
- Mac: `tailscale serve --bg --tcp=11434 tcp://127.0.0.1:11434` (undo: `tailscale --socket=$HOME/.config/tailscale/tailscaled.sock serve --tcp=11434 off`).
- Verified live: /healthz ok over https, http->https 301, wrong passcode 401, wrong origin 403, preflight OK.
- Undo VPS: `systemctl disable --now dbb-proxy; rm /etc/systemd/system/dbb-proxy.service /etc/nginx/sites-enabled/dbb-proxy /etc/nginx/conf.d/dbb-proxy-zone.conf; nginx -t && systemctl reload nginx; certbot delete --cert-name brickbuilder-api.arcwel.ai; rm -r /opt/dbb-proxy /etc/dbb-proxy; userdel dbb; tailscale down` and `apt remove tailscale`.
- 2026-10-01: Tailscale joined (VPS `arcwel-vps` 100.123.119.96 <-> Mac 100.126.162.57). Gemini key stored via `/opt/dbb-proxy/set-secret.sh`. Models: `qwen3.6-fazm` (22 GB) timed out on the busy Mac, so QWEN_MODEL=qwen3.5:9b (~4 s); `gemini-2.5-flash` is retired for new keys, so GEMINI_MODEL=gemini-3.8-flash (~2 s). Live end-to-end test through https passed for both. Proxy now logs the upstream HTTP status (`up=NNN`, no content). Current upstream: qwen. Rollback copy: /opt/dbb-proxy/proxy.mjs.prev.
- STILL OPEN: `brickbuilder` DNS (Hostinger) still points at the Hostinger placeholder; needs CNAME -> a-guidry.github.io. Commit/push and Pages custom domain wait on this.
