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
