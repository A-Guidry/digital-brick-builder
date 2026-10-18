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
`GATEWAY_SPEECH_UPSTREAM` (empty = off): a local speech server, for example `http://127.0.0.1:8810`. When it is set, requests under `/v1/audio/` (`/v1/audio/speech`, `/v1/audio/transcriptions`, `/v1/audio/voices`) go there instead of to Ollama, through the same addresses and the same website rules. Everything else still goes to Ollama.

## Speech (optional)
With `GATEWAY_SPEECH_UPSTREAM` set, the same base URLs also serve speech: `https://agt-studio-llm.tail46b2ff.ts.net:8443/v1` and `http://100.126.162.57:11436/v1`. The speech server needs no tailnet port of its own, which matters because the tailnet rules let the VPS reach only 11436, 8443 and 8787 on this Mac. If the speech server is down, `/v1/audio/*` answers 502 with "The speech server on this Mac is not answering" while chat keeps working.

Use it from an app: base URL `https://agt-studio-llm.tail46b2ff.ts.net:8443/v1` (OpenAI-compatible), any API key, model e.g. `gemma4:26b`. In Digital Brick Builder: AI settings, Local model, paste that URL.

Chrome asks once to allow the website to reach "local network" devices: choose Allow.

## Keep-warm, and if the model gets stuck
The gateway keeps one model loaded (`GATEWAY_WARM_MODEL`, default `gemma4:26b`; empty turns it off) by re-asking Ollama every 4 minutes with a 30-minute keep-alive, so the first request after a quiet spell is fast (about 0.1 s instead of 30 to 60 s). It costs about 18 GB of memory while the Mac is on.

Ollama can occasionally wedge while unloading a model: `ollama ps` shows **Stopping…** for minutes and even tiny requests take a minute or more. The fix is to end only the model runner (Ollama starts a fresh one):
```
OLLAMA_HOST=127.0.0.1:11435 ollama ps                      # look for "Stopping…"
pkill -TERM -f "Ollama.app/Contents/Resources/llama-server"   # then the next request reloads it in ~20 s
```
Do not restart `ollama serve` itself: the PAIR app launches it on port 11435 behind its own proxy on 11434.
