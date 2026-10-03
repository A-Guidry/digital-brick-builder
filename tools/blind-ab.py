#!/usr/bin/env python3
"""Builds a blind A/B page from two harness result folders. Usage: blind-ab.py SIMPLE_DIR DETAILED_DIR OUT.html"""
import base64, json, random, re, sys
sd, hd, out = sys.argv[1:4]
rs = {x['prompt']: x for x in json.load(open(f'{sd}/results.json'))}
rh = {x['prompt']: x for x in json.load(open(f'{hd}/results.json'))}
slug = lambda p: re.sub(r'[^a-z0-9]+', '-', p, flags=re.I)[:40]
enc = lambda f: 'data:image/png;base64,' + base64.b64encode(open(f, 'rb').read()).decode()
import os
def img(d, p):
    # three views when the harness saved them (3/4, side, front), otherwise the single default view
    views = [f'{d}/{slug(p)}-{v}.png' for v in ('low34', 'side', 'front')]
    return [enc(f) for f in views] if all(os.path.exists(f) for f in views) else [enc(f'{d}/{slug(p)}.png')]
rnd = random.Random(); items = []
for p in rs:
    if p not in rh: continue
    flip = rnd.random() < 0.5            # which side Detailed lands on
    a, b = (('high', hd, rh[p]), ('simple', sd, rs[p])) if flip else (('simple', sd, rs[p]), ('high', hd, rh[p]))
    items.append({'prompt': p, 'A': img(a[1], p), 'B': img(b[1], p), 'key': {'A': a[0], 'B': b[0]},
                  'parts': {'A': a[2].get('parts'), 'B': b[2].get('parts')}})
html = '''<!doctype html><meta charset=utf-8><title>Blind brick test</title><meta name=viewport content="width=device-width,initial-scale=1">
<style>body{font:15px system-ui;margin:0;padding:1rem 1.2rem;background:#fff;color:#111}h1{font-size:20px;margin:.2rem 0}
.row{border-top:2px solid #111;padding:1rem 0}.k{font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.08em}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:.6rem}.pair img{width:100%;border:1px solid #111;display:block;margin-bottom:.3rem}
button{font:inherit;padding:.5rem .9rem;border:2px solid #111;background:#fff;cursor:pointer;margin:.3rem .3rem 0 0}
button.on{background:#e8590c;color:#fff;border-color:#e8590c}#res{display:none;border:2px solid #111;padding:1rem;margin:1rem 0}</style>
<h1>Which looks more like the thing?</h1><p>Pick the better model for each. No peeking at sizes. When done, press Reveal.</p><div id=list></div>
<button id=rev style="font-weight:700">Reveal results</button><div id=res></div>
<script>const D=__DATA__;const pick={};const L=document.getElementById('list');
D.forEach((d,i)=>{const r=document.createElement('div');r.className='row';r.innerHTML=`<div class=k>${i+1} of ${D.length}</div><h2 style="margin:.2rem 0 .6rem;font-size:18px">${d.prompt}</h2><div class=pair><div><div class=k>A</div>${d.A.map(u=>`<img src="${u}">`).join('')}</div><div><div class=k>B</div>${d.B.map(u=>`<img src="${u}">`).join('')}</div></div>`;
['A','B','Same'].forEach(v=>{const b=document.createElement('button');b.textContent=v==='Same'?'Same / can\\'t tell':'Better: '+v;b.onclick=()=>{pick[i]=v;[...r.querySelectorAll('button')].forEach(x=>x.classList.remove('on'));b.classList.add('on')};r.appendChild(b)});L.appendChild(r)});
document.getElementById('rev').onclick=()=>{let h=0,s=0,t=0,rows='';D.forEach((d,i)=>{const v=pick[i];let w=v==null?'(no pick)':v==='Same'?'tie':d.key[v]==='high'?'Detailed':'Simple';if(w==='Detailed')h++;else if(w==='Simple')s++;else if(w==='tie')t++;rows+=`<li>${d.prompt}: <b>${w}</b> (A=${d.key.A}, ${d.parts.A} parts; B=${d.key.B}, ${d.parts.B} parts)</li>`});
const R=document.getElementById('res');R.style.display='block';R.innerHTML=`<h2>Detailed ${h} · Simple ${s} · Tie ${t}</h2><p>${h>=Math.ceil(D.length*.6)?'Detailed wins clearly enough to make it the default.':'Not a clear win for Detailed.'}</p><ul>${rows}</ul>`};</script>'''
open(out, 'w').write(html.replace('__DATA__', json.dumps(items)))
print(f'wrote {out} with {len(items)} pairs')
