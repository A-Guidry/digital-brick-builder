#!/bin/sh
# Run `npm test` in a fresh network namespace that has only loopback (no internet, no
# LAN, no local LLM gateway/Ollama), proving the suite needs no outbound network.
# Needs Linux `unshare` with user namespaces. Usage: scripts/test-offline.sh
set -e
cd "$(dirname "$0")/.."
exec unshare -rn python3 scripts/netns-loopback.py npm test
