#!/usr/bin/env python3
"""Summarise proxy log lines from stdin (counts only: no keys, prompts or addresses). Used by usage.sh."""
import sys, re, os, json, collections
posts = []
for line in sys.stdin:
    m = re.match(r"(\S+) POST /v1/ai who=(\S+) ip=(\S+) status=(\d+)(.*?) ms=(\d+)", line)
    if not m:
        continue
    rest = m.group(5)
    via = re.search(r"via=(\S+)", rest); mod = re.search(r" m=(\S+)", rest); up = re.search(r"up=(\S+)", rest)
    posts.append(dict(who=m.group(2), ip=m.group(3), status=int(m.group(4)), via=via.group(1) if via else "-", model=mod.group(1) if mod else "-", up=up.group(1) if up else "-", ms=int(m.group(6))))
n = len(posts); ok = [p for p in posts if p["status"] == 200]
ms = sorted(p["ms"] for p in ok)
pct = lambda q: ms[min(len(ms) - 1, int(len(ms) * q))] if ms else 0
out = dict(days=int(os.environ.get("DAYS", "1")), requests=n, ok=len(ok), by_status=dict(collections.Counter(str(p["status"]) for p in posts)),
           by_upstream=dict(collections.Counter(p["via"] for p in ok)), by_model=dict(collections.Counter(p["model"] for p in ok)),
           guests=len({p["ip"] for p in posts if p["who"] == "guest"}), family=len({p["who"] for p in posts if p["who"] not in ("guest", "-")}),
           pool_exhausted=sum(1 for p in posts if p["up"].startswith("gemini-pool")), median_ms=pct(0.5), p95_ms=pct(0.95))
if os.environ.get("JSON") == "1":
    print(json.dumps(out, indent=1))
else:
    print(f"last {out['days']} day(s): {n} requests, {len(ok)} succeeded ({(len(ok) * 100 // n) if n else 0}%)")
    print("  status:   ", out["by_status"]); print("  upstream: ", out["by_upstream"]); print("  models:   ", out["by_model"])
    print(f"  browsers: {out['guests']} guest, {out['family']} family;  Gemini pool exhausted {out['pool_exhausted']}x;  median {out['median_ms']} ms, p95 {out['p95_ms']} ms")
