#!/usr/bin/env bash
# Usage (on the VPS, as root): check-gemini.sh        Checks the stored Gemini key and every model in the pool. Prints no secrets.
# One tiny request per model (the free tier allows ~15 per minute per model; this uses 1). Exit code 0 = key and at least one model work.
set -uo pipefail
f="${DBB_ENV:-/etc/dbb-proxy/env}"
set -a; . "$f"; set +a
[ -n "${GEMINI_API_KEY:-}" ] || { echo "FAIL: GEMINI_API_KEY is empty in $f"; exit 2; }
echo "key: stored, ${#GEMINI_API_KEY} characters"
models="${GEMINI_MODELS:-${GEMINI_MODEL:-gemini-3.5-flash-lite}}"
working=0
for m in ${models//,/ }; do
  code=$(curl -s -m 30 -o /tmp/dbb-gem.json -w "%{http_code} %{time_total}" "https://generativelanguage.googleapis.com/v1beta/models/$m:generateContent" \
    -H "x-goog-api-key: $GEMINI_API_KEY" -H "content-type: application/json" -d '{"contents":[{"role":"user","parts":[{"text":"Say OK"}]}],"generationConfig":{"maxOutputTokens":8}}')
  status=${code%% *}; secs=${code##* }
  case "$status" in
    200) echo "  OK       $m  (${secs}s)"; working=$((working+1));;
    429) echo "  LIMITED  $m  (Google says slow down: free tier is 15/min per model; normal if it was just used)";;
    404) echo "  RETIRED  $m  (not available to this key: remove it from GEMINI_MODELS)";;
    400|401|403) echo "  KEY      $m  (HTTP $status: the key was rejected, or restricted so this server cannot use it)";;
    *)   echo "  TROUBLE  $m  (HTTP $status)";;
  esac
done
rm -f /tmp/dbb-gem.json
[ "$working" -gt 0 ] && { echo "RESULT: OK ($working of $(echo ${models//,/ } | wc -w) models answered)"; exit 0; } || { echo "RESULT: NOT OK - no model answered"; exit 1; }
