#!/usr/bin/env bash
# Usage (on the VPS, as root): switch-upstream.sh auto|qwen|gemini|anthropic   (auto = local AI first, Gemini as automatic backup)
# Sets UPSTREAM in /etc/dbb-proxy/env, restarts the proxy, and checks it came back healthy.
set -euo pipefail
u="${1:-}"; case "$u" in auto|qwen|gemini|anthropic) ;; *) echo "usage: $0 auto|qwen|gemini|anthropic" >&2; exit 2;; esac
f=/etc/dbb-proxy/env
sed -i "s/^UPSTREAM=.*/UPSTREAM=$u/" "$f"
systemctl restart dbb-proxy
sleep 1
curl -fsS http://127.0.0.1:8787/healthz >/dev/null && echo "dbb-proxy now using: $u"
