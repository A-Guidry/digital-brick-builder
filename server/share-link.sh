#!/usr/bin/env bash
# Usage (on the VPS, as root): share-link.sh [name]      Prints a one-tap setup link for that passcode name (default: first one).
# The passcode goes in the part after "#", which browsers never send to any server. Treat the link like the passcode itself.
set -euo pipefail
f="${DBB_ENV:-/etc/dbb-proxy/env}"; want="${1:-}"
entry="$(grep '^PASSCODES=' "$f" | cut -d= -f2- | tr ',' '\n' | { if [ -n "$want" ]; then grep "^$want:" || true; else head -1; fi; })"
[ -n "$entry" ] || { echo "No passcode named '${want}' in $f" >&2; exit 1; }
name="${entry%%:*}"; code="${entry#*:}"
enc="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$code")"
echo "Setup link for '$name' (send it privately; opening it stores the passcode on that device only):"
echo "https://brickbuilder.arcwel.ai/#pc=$enc"
