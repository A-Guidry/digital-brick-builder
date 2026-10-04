#!/usr/bin/env python3
"""Build a one-file showcase page from a harness run folder: three views of each model, validity, and the real part numbers it uses.
  python3 tools/showcase.py RUN_DIR OUT.html "Title"      (RUN_DIR needs the *-low34/-side/-front.png, *-spec.json and bom.json files)"""
import base64, html, json, re, sys
d, out, title = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else 'What the model can do')
bom = json.load(open(f'{d}/bom.json'))
slug = lambda p: re.sub(r'[^a-z0-9]+', '-', p, flags=re.I)[:40]
enc = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
rows = {json.loads(l)['prompt']: json.loads(l) for l in open(f'{d}.log') if l.startswith('{')}
cards = []
for prompt, r in rows.items():
    s = slug(prompt); b = bom.get(s)
    if not b: continue
    imgs = ''.join(f'<img src="{enc(f"{d}/{s}-{v}.png")}" alt="{html.escape(prompt)} {v}">' for v in ('low34', 'side', 'front'))
    real = ''.join(f'<li><b>{l["qty"]}&times;</b> {html.escape(l["name"])} <span class=k>{l["bl"]} &middot; {html.escape(l["color"])}</span></li>' for l in b['real'])
    cards.append(f'''<section class="card"><div class="k">{"VALID" if b["ok"] else "DID NOT PASS"} &middot; {b["parts"]} parts &middot; {r["aiCalls"]} AI calls &middot; {r["secs"]} s</div>
<h2>{html.escape(prompt)}</h2><div class="views">{imgs}</div>
<div class="k">REAL SPECIALTY PARTS ({len(b["real"])} kinds) &middot; plain bricks and plates: {b["plainParts"]}</div><ul>{real or "<li>none</li>"}</ul></section>''')
ok = sum(1 for r in rows.values() if not r['banner'])
page = f'''<!doctype html><meta charset=utf-8><title>{html.escape(title)}</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>:root{{color-scheme:light}}body{{font:15px system-ui;margin:0;padding:1.2rem 1.4rem 3rem;background:#fff;color:#111;max-width:1500px}}h1{{font-size:24px;margin:.2rem 0}}p.s{{max-width:62rem;margin:.4rem 0 1.2rem}}
.card{{border-top:3px solid #111;padding:.9rem 0 1.4rem}}h2{{margin:.2rem 0 .6rem;font-size:19px}}.k{{font:11px ui-monospace,monospace;letter-spacing:.07em;text-transform:uppercase}}
.views{{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:.5rem;margin:.4rem 0 .7rem}}.views img{{width:100%;border:1px solid #111;display:block}}
ul{{margin:.3rem 0 0;padding-left:1.1rem;columns:2 22rem}}li{{margin:.15rem 0}}li .k{{opacity:.7;text-transform:none}}</style>
<h1>{html.escape(title)}</h1><p class=s>{ok} of {len(rows)} built valid. Every model was written by the real Gemini from a one-line request, then built by the app. Each wheel, window, door, windscreen, slope, roof, tree, bush, ear and horn below is a real LEGO part, drawn from its true shape and listed by its real part number.</p>{"".join(cards)}'''
open(out, 'w').write(page); print('wrote', out, len(page) // 1024, 'KB', len(cards), 'models')
