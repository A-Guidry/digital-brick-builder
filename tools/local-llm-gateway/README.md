# Local LLM gateway

Makes the local model on this Mac usable from websites and from every device or app on the tailnet, without touching Ollama's own settings.

```
app / browser on the tailnet ──https://agt-studio-llm.tail46b2ff.ts.net:8443/v1──┐
server on the tailnet        ──http://100.126.162.57:11436/v1────────────────────┤
                                                                                  ▼
                                   gateway (127.0.0.1:11436) ──▶ Ollama (127.0.0.1:11435)
```

- Removes the website `Origin` before forwarding, so Ollama stops answering 403 to pages it does not know.
- Answers browser permission checks (CORS and Private Network Access) only for `https://brickbuilder.arcwel.ai` and `localhost`. Other websites get 403.
- Streams replies through. Adds no password: it is reachable only on the tailnet (`tailscale serve`, never Funnel).
- The Mac must be awake and Ollama running. Check: `local-llm-gateway status`.

## Commands
```
./local-llm-gateway install [--dry-run]    copy to ~/.local/share/local-llm-gateway, add a launchd agent, publish on the tailnet
./local-llm-gateway status [--json]
./local-llm-gateway restart | logs | uninstall [--dry-run]
```
Settings (environment variables when installing): `GATEWAY_UPSTREAM` (default `http://127.0.0.1:11435`), `GATEWAY_ORIGINS` (comma list of allowed websites), `GATEWAY_PORT` (11436), `GATEWAY_HTTPS_PORT` (8443; Tailscale allows 443, 8443, 10000).

Use it from an app: base URL `https://agt-studio-llm.tail46b2ff.ts.net:8443/v1` (OpenAI-compatible), any API key, model e.g. `qwen3.5:9b`. In Digital Brick Builder: AI settings, Local model, paste that URL.

Chrome asks once to allow the website to reach "local network" devices: choose Allow.

## Keep-warm, and if the model gets stuck
The gateway keeps one model loaded (`GATEWAY_WARM_MODEL`, default `qwen3.5:9b`; empty turns it off) by re-asking Ollama every 4 minutes with a 30-minute keep-alive, so the first request after a quiet spell is fast (about 0.1 s instead of 30 to 60 s). It costs about 7 GB of memory while the Mac is on.

Ollama can occasionally wedge while unloading a model: `ollama ps` shows **Stopping…** for minutes and even tiny requests take a minute or more. The fix is to end only the model runner (Ollama starts a fresh one):
```
OLLAMA_HOST=127.0.0.1:11435 ollama ps                      # look for "Stopping…"
pkill -TERM -f "Ollama.app/Contents/Resources/llama-server"   # then the next request reloads it in ~20 s
```
Do not restart `ollama serve` itself: the PAIR app launches it on port 11435 behind its own proxy on 11434.
