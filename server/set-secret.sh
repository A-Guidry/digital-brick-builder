#!/usr/bin/env bash
# Usage (on the VPS, as root): set-secret.sh GEMINI_API_KEY   (also ANTHROPIC_API_KEY, QWEN_API_KEY)
# Asks for the value with hidden input, writes it to /etc/dbb-proxy/env, restarts the proxy. Never prints the value.
set -euo pipefail
k="${1:-}"; case "$k" in GEMINI_API_KEY|ANTHROPIC_API_KEY|QWEN_API_KEY) ;; *) echo "usage: $0 GEMINI_API_KEY|ANTHROPIC_API_KEY|QWEN_API_KEY" >&2; exit 2;; esac
f=/etc/dbb-proxy/env
read -rsp "Paste the value for $k (hidden), then press Enter: " v; echo
v="$(printf %s "$v" | tr -d '[:space:]')"
[ -n "$v" ] || { echo "Nothing entered. No change made." >&2; exit 1; }
case "$v" in *\|*|*\&*|*\\*) echo "Value has an unexpected character. No change made." >&2; exit 1;; esac
sed -i "s|^$k=.*|$k=$v|" "$f"
chmod 600 "$f"
n="$(grep "^$k=" "$f" | cut -d= -f2- | wc -c)"
systemctl restart dbb-proxy; sleep 1
echo "Saved $k (length $((n-1))). Proxy is $(systemctl is-active dbb-proxy)."
