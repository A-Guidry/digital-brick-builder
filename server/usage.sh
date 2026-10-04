#!/usr/bin/env bash
# What the kids' allowance is actually costing. Reads the proxy log on the VPS; prints counts only.
#   server/usage.sh [--days N] [--json] [--host root@187.77.28.18]
set -euo pipefail
DAYS=1; JSON=0; HOST="root@187.77.28.18"; HERE="$(cd "$(dirname "$0")" && pwd)"
while [ $# -gt 0 ]; do case "$1" in --days) DAYS="$2"; shift 2;; --json) JSON=1; shift;; --host) HOST="$2"; shift 2;; -h|--help) sed -n 2,4p "$0"; exit 0;; *) echo "unknown option $1" >&2; exit 2;; esac; done
case "$DAYS" in ''|*[!0-9]*) echo "--days needs a number" >&2; exit 2;; esac
ssh -o BatchMode=yes "$HOST" "journalctl -u dbb-proxy --since '$DAYS days ago' --no-pager -o cat" | DAYS="$DAYS" JSON="$JSON" python3 "$HERE/usage.py"
