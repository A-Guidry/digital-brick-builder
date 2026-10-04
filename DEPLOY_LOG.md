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
- 2026-10-01: DNS `brickbuilder` CNAME -> a-guidry.github.io done by owner. Pushed 4f89d24; Pages custom domain brickbuilder.arcwel.ai set, cert approved, HTTPS enforced; https://brickbuilder.arcwel.ai serves 200.
- Acceptance: page loads with Shared server default + disclaimer, no console errors; wrong passcode -> plain message via real CORS; "a small red house" through the live proxy (Qwen qwen3.5:9b) passes the app's build checks (1 repair round, ~66 s). Not tested live: the 429 message (covered by automated tests; no real limit was hit), pictures, real phone, Anthropic spend (Anthropic not used).

## 2026-10-02 local LLM gateway + setup link
- Tailscale name of the Mac changed `agt-bmbp-llm` -> `agt-studio-llm` (`tailscale set --hostname`; macOS system name untouched). Old-name serve entries for :443/:80 -> :8080 are now stale (see README note below).
- Mac: `tools/local-llm-gateway` installed via `local-llm-gateway install`: launchd agent `tech.arcwel.local-llm-gateway`, files in ~/.local/share/local-llm-gateway, log ~/Library/Logs/local-llm-gateway.log, tailscale serve `--https=8443` and `--tcp=11436` -> 127.0.0.1:11436. Undo: `local-llm-gateway uninstall`.
- VPS: QWEN_BASE_URL -> http://100.126.162.57:11436/v1; added /opt/dbb-proxy/share-link.sh (prints a one-tap setup link; run it only in your own terminal).
- 2026-10-02: REMOVED the old `tailscale serve --tcp=11434` forward (it published the PAIR proxy; nothing used it). Audit before removal: VPS proxy uses :11436; no pm2/docker/systemd/cron on the VPS references the Mac; every Mac-side consumer of 11434 (HazzMate, WebDeck, agent-system, litellm/fazm config) uses 127.0.0.1; HazzMate's tailnet use is :8787 only and discovers the address at runtime. Re-verified after: local PAIR proxy 200, Ollama 200, gateway healthy and running, VPS -> :11436 and https :8443 both 200.
- NOTE: the Mac runs tailscaled with `--tun=userspace-networking`. In that mode a tailnet peer (VPS, iPhone) can reach ANY port with a listener on the Mac, published or not (verified: :11434 and :11435 still answer from the VPS after the removal; closed ports do not). `tailscale serve` rules therefore do not restrict TCP access. To restrict it, use Tailscale ACLs in the admin console. Peers today are only the owner's own devices.

## 2026-10-02 zero-setup access + automatic local-first fallback
- Goal from the owner: kids and nephews open the site and it just works (no passcode, key, VPN or addresses).
- Proxy: `UPSTREAM=auto` = the Mac's local AI first (through the gateway), Gemini automatically when the Mac is off/slow/failing (health check cached 15-20 s). `OPEN_ACCESS=1` = guests need no passcode: each browser (random id) gets LIMIT_DAY builds/day, each internet connection GUEST_IP_DAY (40), all guests GUEST_GLOBAL_DAY (150) on the local AI and GUEST_GLOBAL_GEMINI_DAY (60) on the Gemini backup. Gemini backup builds also use the Gemini allowance (10/day per person). Family passcode still lifts limits. Scripts with no website origin are refused.
- VPS env changed: UPSTREAM=auto, OPEN_ACCESS=1 (+ GUEST_* and AUTO_* lines). Backup of the previous env: /root/env.pre-auto.bak (contains secrets; delete when no longer needed). Program rollback: /opt/dbb-proxy/proxy.mjs.prev.
- Verified live: kid with no passcode -> 200 via=qwen; Mac gateway stopped -> 200 via=gemini in ~1 s; next request skips the dead AI; no-origin script 401; other website 403.
- App: Shared server needs no passcode (optional), sends a per-browser guest id (localStorage `dbb.guest`).
- Known: the local model unloads after idle, so the first build after a quiet spell can take ~30 s (a normal build 55-65 s). Gemini answers in 1-5 s.
- 2026-10-02 keep-warm: gateway now pings Ollama every 4 min (WARM_MODEL=qwen3.5:9b, keep_alive 30m); reinstalled with `local-llm-gateway install`. Found Ollama's runner wedged in "Stopping…" (direct requests 60-90 s); ended only the llama-server child (SIGTERM), reloaded: first load 22 s, then 0.14 s. The wedge pre-dates keep-warm (seen in the first `ollama ps` of this session). If it recurs, see tools/local-llm-gateway/README.md.

## 2026-10-02 adversarial review (tests that try to break it, run against the real system)
Found and fixed (each with a test that failed first):
- Many kids at once: 5 of 8 were told "busy" and the rest waited ~65 s. Now MAX_IN_FLIGHT defaults to 12 in auto mode (the VPS env had 3 pinned; removed), the Mac is asked for at most MAX_LOCAL_IN_FLIGHT=2 at a time (race fixed: slot taken before the await), extra kids go straight to Gemini. Live re-test: 8/8 answered, 6 in ~1 s, 2 in 13 s.
- A busy, cold or silent local AI no longer makes kids wait out the long timeout: the local AI is asked in streaming mode and must produce its first token within AUTO_FIRST_TOKEN_MS=12000 or Gemini answers. Black-holing the Mac on the live VPS: first kid 3.1 s, next 0.6 s.
- Auto local-server detection in the app silently swapped a custom address for a different server (and the e2e hit the real gateway). Now it only acts when the saved address is one of the usual defaults; it never picks an embedding model; prefers the gateway's warm model (gateway health now reports it).
- Raw nginx pages (413/502/503/504) and non-JSON/empty 200s now give clear messages; an unreadable picture now gives a clear message instead of doing nothing.
- If the lookup threw, the Generate button could stay disabled forever; it is now guarded.
Findings that are NOT fixed (decisions for the owner):
- Guest access cannot tell a browser from a script that sends the right Origin header. Caps bound the damage (per browser, per connection, per day, global) but a determined script can use the guest allowance. Set OPEN_ACCESS=0 to require a passcode.
- The Mac's local model is shared with claude-mem and other tools: trivial requests took 34-87 s to produce a first token, so the 12 s first-token limit sends most kids to Gemini. Keep-warm does not help (an empty-prompt ping does not extend Ollama's expiry on an already loaded model) and is not the bottleneck.
- Tailscale device keys expire 2027-03-06 (Mac) and 2027-03-30 (VPS); an expired key silently drops the device (kids then get Gemini only). Disable key expiry for both in the Tailscale admin console.
- Test model `brickbuilder` was created and removed again while measuring; Ollama keeps only one model loaded at a time on this Mac.

## 2026-10-02 "Gemini just works"
- Choosing Gemini in AI settings with the key box empty now uses the site's built-in Gemini through the shared server (the real key never reaches the browser). The app sends `x-dbb-prefer: gemini`; in auto mode the proxy then skips the Mac and answers with Gemini (log: `via=gemini up=chose-gemini`), using the Gemini allowance. A key typed into the box still goes straight to Google as before. With no key AND no shared server the old "paste a key" message remains and nothing is sent.
- Proxy deployed to the VPS (backward compatible; rollback copy /opt/dbb-proxy/proxy.mjs.prev3). App change needs a push.
- 2026-10-02 DEPENDENCY FOUND: /etc/nginx/sites-available/hazzmate (hazzmate.arcwel.ai, created by another session) proxies to the Mac's tailnet address 100.126.162.57:8787 (HazzMate API). So the VPS<->Mac Tailscale link is needed by BOTH the local-first AI and HazzMate-on-the-web. The earlier draft ACL denied vps->mac:8787 and would have broken it; draft corrected (vps may reach 11436, 8443, 8787). Tailscale node keys expire 2027-03-06 (Mac) and 2027-03-30 (VPS): disable key expiry or both features go down silently.

## 2026-10-03 Gemini first, hardened for a free-tier key
- Measured on the real key: FREE TIER, 15 requests/minute per model (Google's refusal: generate_content_free_tier_requests, limit 15). Limits are per project and per model; daily counts reset at midnight Pacific. `gemini-flash-lite-latest` is an alias of `gemini-3.5-flash-lite` and shares its quota; `gemini-3.1-flash-lite` has its own.
- Proxy: AUTO_PRIMARY=gemini. Gemini is used as a pool (GEMINI_MODELS=3.5-flash-lite, 3.1-flash-lite, 3.5-flash), paced at GEMINI_RPM_PER_MODEL=12 per model, with per-model cooldowns (429 -> Google's retry hint, PerDay quota -> until midnight Pacific, 404 -> 1 h, key/permission errors -> 10 min, 5xx/timeouts -> 20 s). The Mac is only the safety net if every Gemini model is unavailable. If both are unavailable: a friendly 429 with a retry hint (never Google's text, never the key).
- Found by live crowd tests and fixed: our own in-flight guard (12) turned away 4 of 16 simultaneous kids and 28 of 40 (the fake test Gemini was instant so it hid this; fakes are now realistically slow). Guard is now 60. Final live result: 16 at once -> 16 answered (1-6 s); 40 at once -> 28 answered, 12 friendly "try again in N seconds"; Google refused nothing.
- Tools: /opt/dbb-proxy/check-gemini.sh checks the key and every pool model (no secrets printed). Backups: /root/env.pre-gemfirst.bak (secrets inside), /opt/dbb-proxy/proxy.mjs.prev4.
- Recommended owner actions in Google AI Studio / Cloud console: restrict the key to the Generative Language API and to the VPS address 187.77.28.18 (so a leaked key is useless elsewhere); check the project's tier/limits at ai.dev/rate-limit; a paid tier would raise the per-minute limits if kids outgrow 15/min per model.

## 2026-10-03: Detailed mode + look-check limits
- App: prompt v2 (plan first), vision look-and-fix check (`src/critic.ts`), Simple/Detailed switch (`settings.detail`), reply budget 4096 to 8192.
- VPS `/etc/dbb-proxy/env` (backup `/root/env.pre-detail.bak`): MAX_TOKENS=8192, LIMIT_DAY gemini 10 to 30, LIMIT_GLOBAL_DAY gemini 30 to 240, GUEST_IP_DAY 80, GUEST_GLOBAL_DAY 400, GUEST_GLOBAL_GEMINI_DAY 240. A build now costs about 3-4 AI calls.
- Measured A/B (6 subjects, real Gemini): Detailed gives +60% shapes, +44% parts, +34% colours; recognisability gain is modest and not proven.

## 2026-10-03: Parts catalog (`src/features.ts`)
- The AI can now add `"features"`: named parts (wheel, window, windshield, door, headlight, taillight, porthole, eye, spot, hoof, ear, horn, antenna, wing, fin, tower, roof, chimney, battlement, tree, flag, bumper). `features.ts` builds each from ordinary shapes; the prompt's catalog text is generated from the same table. Max 24 per model. Unknown kinds, bad sizes/facings/colours come back to the AI as plain-English problems.
- Found by mutation testing: feature shapes need an explicit `op:'add'`; paint must reach ~2 studs into the wall or fractional positions paint nothing; one-stud pieces are snapped to a cell centre.
- Blind test 1 (shape-count Detailed): 5 Detailed, 4 Simple, 1 tie. Wins tracked size, not detail.
- Blind test 2 (old Simple vs catalog Detailed, 7 subjects): 6 Detailed, 0 Simple, 1 tie. Detailed is now the default (`settings.detail = 'high'`).
- Tests: 231 unit, 82 server, 150/150 browser.

## 2026-10-03: gap fixes after the parts catalog
- **Local model was effectively unusable**: it is a thinking model, and neither the proxy nor the app turned thinking off. Same house request: 129 s with no answer (all 8192 tokens spent reasoning) before; valid JSON in ~30 s after (busy GPU). Fix: `reasoning_effort: "none"` in the proxy (both plain and streaming requests) and in the app for Ollama/gateway ports only (`localExtras`). Proxy deployed to the VPS (backup `/root/proxy.mjs.pre-nothink.bak`, md5 matches repo). Still saturated by claude-mem: GPU ~92% busy.
- **Look-check false alarms**: 41% of verdict sentences said floating/detached/baseplate, and 41% of builds were rebuilt. Now a "floating"-only complaint with nothing real missing counts as a pass (`critic.ts`, mutation-checked).
- **Wheels**: size 4 came out square, 6 round. Default is now 5 and the catalog tells the AI to use 5+.
- **Scale numbers** (real models scaled in place): parts grow about 2.5-3x per doubling for thin-walled models (46 -> 132 -> 378; 44 -> 110), but repair time grows faster than parts (253 parts took 8.4 s). Larger scales also broke connectivity more often.
- **New tool** `server/usage.sh [--days N] [--json]`: requests, success rate, upstream and model mix, pool exhaustions, latency, from the proxy log (counts only). First reading, 2 days: 153 requests, 66% ok, 49 rate-limited (429), Gemini pool exhausted 12x, p95 60 s (includes testing traffic).
- Phone checks (390x844, 360x640, 844x390): no overflow, no small targets, no errors.

## 2026-10-03: real parts (wheel unit) and the part library
- **Real wheel unit.** A `wheel` feature is now one real assembly mined from the OMR models (holder 4488 + hub 6014b + tyre 6015, exact offsets from a real Tow Truck), drawn from the true LDraw shapes (`src/specials.json`, baked by `tools/export-specials.py`). The holder is a real catalog part (`plate-wheel`, never offered to the packer); the shopping list adds the hub and tyre. The body may start at 1.6 or higher; a short post in the body colour joins a body that sits higher. Wheels hang below, so the model carries `lift` and stands on the baseplate. 19 new unit tests (6 mutations caught), 4 browser checks.
- **Part library, nothing picked by hand.** `tools/build-atlas.py` pulls every distinct part out of the model files and the dataset: 4,599 distinct parts used, 2,743 exported at 3+ uses (51 MB, `~/Projects/lego-data/atlas-v1`, 3 s). Your folder alone uses 1,016 of them. 10 Studio `.io` files are password-protected and were left alone.
- Real Gemini builds (sports car, bus, truck, police car) use the wheel units and build valid.
- Tests: 253 unit, 83 server, 154/154 browser.

## 2026-10-03: every real part is a row of data (units)
- **tools/units.json** lists real assemblies (anchor part + companions). **tools/build-units.py** mines each companion's exact offset and turn from the OMR models (the wheel's 108/74 sightings reproduced automatically) and bakes the true LDraw shapes into `src/specials.json` (105 KB). Units today: wheel (4488+6014b+6015), window 2x2/2x3/4x3 (60592/60593/60594 + glass), windscreen 3823, door (frame 60596 + leaf 60623). Adding a part = one line in units.json + `uv run --with numpy tools/build-units.py`.
- **Engine, generic**: `unitsOf()` places units from the AI's features; the compiler reserves each unit's volume (`Grid.fixed`), masks it from the packer, and adds the real part. Wall units go in the outermost wall layer near the asked-for surface (tolerates a stud of error) and slide down to fit; clashes and missing walls come back to the AI as plain-English problems (`unit_not_placed`). Repair bridge plates never enter a real part (real Gemini police car found this).
- **Viewer/BOM generic**: real shapes with fixed colours per part (tyre, glass, leaf), studs added, shopping list includes companions (door leaf in its own colour). Two glass colours added to the palette (Trans-Light Blue BL 15, Trans-Clear BL 12).
- **Real Gemini**: 8 of 8 vehicle/building prompts built valid with real parts; average 4.5 AI calls and 43 s per build (above the 30 s target). 
- Tests: 297 unit (every unit is covered by table-driven tests; 13 deliberate breakages caught), 83 server, 154/154 browser.

## 2026-10-03: real slopes and roofs
- Units added to `tools/units.json`: slope-4 (3037), slope-2 (3039), slope-1 (3040), class `block` (placed where asked, no wall to find). A `slope` feature places one (facing = the way it goes down; size 1/2/4 wide).
- `roof` is now real: stepped courses of real slopes on both long edges (each course 3 plates up and 2 studs in) over a plain brick core with a 2-wide ridge cap; width made even and >= 4; height follows from the width; facing +x/-x turns the ridge. The model bounds now include block parts.
- Real Gemini: 6 of 6 buildings (house, castle, fire station, cottage, barn, garage) valid, 3.7 AI calls and 39 s on average.
- Tests: 337 unit (7 deliberate breakages caught), 83 server, 154/154 browser.
