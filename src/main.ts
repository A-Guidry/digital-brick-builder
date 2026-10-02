import { THUMBS } from './thumbs';
import { Profile, SavedBuild, loadProfile, saveProfile, emptyProfile, newId, exportProfile, fileNameFor, parseProfileFile, mergeProfile, requestPersistence, encodeShare, decodeShare, STORE_KEY, LIMITS as PLIM } from './profile';
import { Viewer, Look } from './viewer';
import { Model, Placed } from './compiler';
import { ShapeSpec } from './shapes';
import { PRESETS } from './presets';
import { buildWithRepair, BuildResult, Attempt } from './repair';
import { Report, formatProblems } from './validator';
import { makeSteps, Step, MAX_PER_STEP } from './steps';
import { makeBags, Bag } from './bags';
import type { LooseSpec } from './pile';
import { partsList, wantedListXml, csv } from './bricklink';
import { PART_BY_ID, COLOR_BY_ID } from './catalog';
import { complete, loadSettings, saveSettings, clearKeys, isConfigured, testConnection, listLocalModels, passcodeFromHash, Settings, ProviderId } from './llm';
import { systemPrompt, userPrompt, Msg } from './prompt';

const $ = <T extends HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

const viewer = new Viewer($('#view'));
let settings: Settings = loadSettings();
// A setup link (…/#pc=passcode) sets this device up for the shared server, then removes the passcode from the address bar.
let setupViaLink = false;
{ const pc = passcodeFromHash(location.hash); if (pc) { settings = { ...settings, provider: 'shared', sharedPasscode: pc }; saveSettings(settings); history.replaceState(null, '', location.pathname + location.search); setupViaLink = true; } }
let model: Model | null = null, spec: ShapeSpec | null = null, report: Report | null = null, steps: Step[] = [], attempts: Attempt[] = [];
let stepIdx = 0, currentPreset = '';
let image: { mime: string; base64: string; url: string } | null = null;
let failedBuild = false;
// ---------- profile (saved in this browser; export/import as a file) ----------
let profile: Profile = loadProfile();
let currentKey = '', pendingKey = '', needTray = false;
let saveTimer = 0;
function commit() { clearTimeout(saveTimer); saveTimer = window.setTimeout(() => saveProfile(profile), 250); }
window.addEventListener('pagehide', () => { clearTimeout(saveTimer); saveProfile(profile); });
(window as any).__bf = { viewer, get model() { return model; }, get steps() { return steps; }, toScreen(x: number, y: number, z: number) { const r = viewer.renderer.domElement.getBoundingClientRect(); const v = new (viewer.camera.position.constructor as any)(x, y, z).project(viewer.camera); return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height]; } }; // test hook

// ---------- log ----------
function logReset() { $('#log').innerHTML = ''; }
function log(text: string, tag = '', bad = false) {
  const li = document.createElement('li');
  if (bad) li.className = 'bad';
  li.innerHTML = `<span class="tag">${esc(tag)}</span><span>${esc(text)}</span>`;
  $('#log').appendChild(li); li.scrollIntoView({ block: 'nearest' });
}

// ---------- tabs ----------
const appEl = document.getElementById('app')!;
const phone = window.matchMedia('(max-width: 900px)');
/** Phone layout: one bottom bar drives both the "Create" panel (left) and the tab panes (right). */
function setPanel(name: string) { const was = appEl.dataset.tab; appEl.dataset.panel = name === 'create' ? 'create' : 'tab'; appEl.dataset.tab = name; document.querySelectorAll<HTMLElement>('#mnav button, #rail button').forEach(b => b.classList.toggle('on', b.dataset.m === name)); if (was !== name) { document.getElementById('left')!.scrollTop = 0; document.getElementById('right')!.scrollTop = 0; } }
function showCreate() { if (mode === 'build') leaveBuild(); setPanel('create'); }
document.querySelectorAll<HTMLElement>('#mnav button').forEach(b => b.onclick = () => b.dataset.m === 'create' ? showCreate() : tab(b.dataset.m!));
/** The disclaimer line sits under the panel (above the bottom bar on phones). */
function placeFoot() { const f = document.getElementById('foot')!; appEl.appendChild(f); }
phone.addEventListener?.('change', () => { placeFoot(); setPanel(phone.matches ? (appEl.dataset.tab || 'create') : 'steps'); });
function tab(name: string) {
  setPanel(name);
  if (name === 'build') appEl.dataset.drawer = 'open'; else delete appEl.dataset.drawer;
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  document.querySelectorAll<HTMLElement>('.pane').forEach(p => p.hidden = p.id !== `tab-${name}`);
  if (name === 'build') enterBuild(); else if (mode === 'build') leaveBuild();
  if (name === 'steps') renderSteps();
  if (name === 'saved') renderSaved();
}
document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.onclick = () => tab(b.dataset.tab!));

// ---------- build mode chrome: the panels step aside, sections become an icon rail, the panel opens as a drawer ----------
const setDrawer = (open: boolean) => { appEl.dataset.drawer = open ? 'open' : 'closed'; };
document.querySelectorAll<HTMLElement>('#mnav button').forEach(src => {
  const m = src.dataset.m!, label = src.querySelector('span')!.textContent!;
  const b = document.createElement('button'); b.dataset.m = m; b.title = label; b.setAttribute('aria-label', label);
  b.appendChild(src.querySelector('svg')!.cloneNode(true));
  b.onclick = () => m === 'create' ? showCreate() : m === 'build' && mode === 'build' ? setDrawer(appEl.dataset.drawer !== 'open') : tab(m);
  $('#rail').appendChild(b);
});
$('#drawer-close').onclick = () => setDrawer(false);
document.querySelectorAll<HTMLElement>('#rail-act button').forEach(b => b.onclick = () => document.getElementById('b-' + b.dataset.act!)?.click());
document.addEventListener('keydown', e => { if (e.key === 'Escape' && mode === 'build' && appEl.dataset.drawer === 'open' && curBag >= 0) setDrawer(false); });
// touching the 3D view while building tucks the drawer away (once a bag is open)
$('#view').addEventListener('pointerdown', () => { if (mode === 'build' && appEl.dataset.drawer === 'open' && curBag >= 0) setDrawer(false); }, true);
/** What to find, the action buttons' enabled state, and the rail visibility, mirrored from the build pane. */
function syncBuildChrome() {
  const on = curBag >= 0 && !allDone() && !!curStep();
  appEl.dataset.bag = on ? 'on' : 'off';
  const need = $('#need');
  if (on) {
    const bag = bags[curBag], st = curStep()!;
    const groups = groupParts(st.parts.filter(p => !bPlaced.has(p.id)));
    need.innerHTML = `<span class="ns">Bag ${bag.n} · step ${bStep + 1}/${bag.steps.length}</span>` +
      groups.map(g => `<span class="nc" title="${esc(pieceName(g.part))}, ${esc(COLOR_BY_ID[g.color].name)}">${mini(g)}<b>×${g.ids.length}</b></span>`).join('');
    need.hidden = false;
  } else need.hidden = true;
  document.querySelectorAll<HTMLButtonElement>('#rail-act button').forEach(b => { const src = document.getElementById('b-' + b.dataset.act!) as HTMLButtonElement | null; b.disabled = !src || src.disabled; });
}
let toastTimer = 0 as any;
function toast(t: string) {
  const el = $('#toast'); if (!t) { el.hidden = true; return; }
  el.textContent = t; el.className = t.startsWith('✗') ? 'err' : ''; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, t.startsWith('✗') ? 9000 : 6000);
}

// ---------- looks ----------
document.querySelectorAll<HTMLElement>('#looks button').forEach(b => b.onclick = () => {
  viewer.setLook(b.dataset.look as Look); profile.look = b.dataset.look as Profile['look']; commit();
  document.querySelectorAll('#looks button').forEach(x => x.classList.toggle('on', x === b));
});

// ---------- presets ----------
const presetBox = $('#presets');
for (const p of PRESETS) {
  const b = document.createElement('button');
  b.dataset.id = p.id; b.style.setProperty('--c', ['#d01012', '#0055bf', '#e0b400', '#237841', '#fe8a18'][PRESETS.indexOf(p) % 5]);
  b.innerHTML = `${THUMBS[p.id] ? `<img src="${THUMBS[p.id]}" alt="Finished ${esc(p.spec.name)}" loading="lazy">` : ''}<span class="t">${esc(p.spec.name)}<small>${esc(p.blurb)}</small></span>`;
  b.onclick = async () => { await loadPreset(p.id); if (phone.matches && appEl.dataset.panel === 'create') tab('steps'); };
  presetBox.appendChild(b);
}
async function loadPreset(id: string) {
  const p = PRESETS.find(x => x.id === id)!;
  currentPreset = id; pendingKey = 'p:' + id;
  document.querySelectorAll('#presets button').forEach(x => x.classList.toggle('on', (x as HTMLElement).dataset.id === id));
  logReset(); log(`Loading ready-made build "${p.spec.name}"`, 'info');
  $('#stage').classList.add('busy');
  await new Promise(r => setTimeout(r, 20));
  const res = await buildWithRepair(p.spec, null);
  $('#stage').classList.remove('busy');
  showResult(res, `Ready-made: ${p.spec.name}`);
}

// ---------- result ----------
function showResult(res: BuildResult, label: string) {
  attempts = res.attempts; spec = res.spec ?? null; report = res.report ?? null;
  for (const a of res.attempts) log(`${a.note}${a.problems ? ` (${a.problems} problem${a.problems > 1 ? 's' : ''})` : ''}`, a.who === 'ai' ? 'AI' : 'prog', !a.ok && a.who === 'program' && false);
  failedBuild = !res.ok;
  const banner = $('#banner');
  if (!res.model) { banner.hidden = false; banner.textContent = res.message; log(res.message, 'FAIL', true); model = null; viewer.setModel(null); render(); return; }
  model = res.model; steps = makeSteps(model); stepIdx = 0; prog = 1; cancelAnimationFrame(progAnim);
  viewer.setModel(model); resetBuild();
  currentKey = pendingKey; restoreProgress(); if (currentKey) { profile.last = currentKey; commit(); }
  $('#modelname').textContent = model.name;
  if (res.ok) { banner.hidden = true; log(`PASS: ${model.parts.length} parts, one connected piece, ${steps.length} steps`, 'done'); }
  else { banner.hidden = false; banner.textContent = 'This model did NOT pass the build checks, so the instructions may not work.\n' + res.message; log('FAILED build checks — see Checks tab', 'FAIL', true); }
  document.title = `Digital Brick Builder — ${label}`;
  { const stay = phone.matches && appEl.dataset.panel === 'create'; render(); tab('steps'); if (stay) setPanel('create'); }
}
function render() { renderHud(); renderSteps(); renderParts(); renderChecks(); if (mode === 'build') enterBuild(); }
function renderHud() {
  $('#hud').textContent = model ? `${model.parts.length} parts · ${model.size[0]}×${model.size[1]} studs · ${(model.size[2] / 2.5).toFixed(1)} studs tall${failedBuild ? ' · FAILED CHECKS' : ''}` : 'Pick a ready-made build or generate one';
}

// ---------- piece visuals ----------
function mini(p: { fx: number; fz: number; part: string; color: string }) {
  const S = 9, w = Math.max(p.fx, p.fz) === p.fx ? p.fx : p.fx, h = p.fz;
  const dots: string[] = [];
  for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) dots.push(`<i style="left:${(i + 0.5) * S}px;top:${(j + 0.5) * S}px"></i>`);
  const kind = PART_BY_ID[p.part]?.kind;
  return `<span class="mini ${kind}" style="width:${w * S}px;height:${h * S}px;background:${COLOR_BY_ID[p.color].hex}">${dots.join('')}</span>`;
}
function groupParts(parts: Placed[]) {
  const m = new Map<string, { key: string; part: string; color: string; fx: number; fz: number; ids: number[] }>();
  for (const p of parts) {
    const k = `${p.part}|${p.color}`;
    if (!m.has(k)) m.set(k, { key: k, part: p.part, color: p.color, fx: p.fx, fz: p.fz, ids: [] });
    m.get(k)!.ids.push(p.id);
  }
  return [...m.values()];
}
const pieceName = (part: string) => PART_BY_ID[part].name;

// ---------- steps tab ----------
// `prog` is a continuous build position 0..N: whole numbers = that many steps built; in between, the next
// step's pieces drop in (or lift out) as you scrub the slider.
let prog = 1, progAnim = 0, stepsBuiltFor: unknown = null;
const stepNow = () => Math.max(1, Math.min(steps.length, Math.ceil(prog - 1e-6)));
function renderSteps() {
  const el = $('#tab-steps');
  if (!model || !steps.length) { el.innerHTML = '<p class="note">No model yet. Choose a ready-made build or generate one.</p>'; stepsBuiltFor = null; return; }
  if (stepsBuiltFor !== steps) {
    stepsBuiltFor = steps;
    el.innerHTML = `
      <div class="bar"><span class="big" id="s-title"></span><span class="chip" id="s-bag"></span><span class="sp"></span>
        <button id="s-first" title="First">|«</button><button id="s-prev" title="Previous (←)">‹</button><button id="s-next" title="Next (→)">›</button><button id="s-last" title="Last">»|</button></div>
      <input type="range" id="s-range" min="0" max="${steps.length}" step="0.001" value="${prog}" aria-label="Build progress — drag to build and unbuild">
      <div class="scrub"><span>empty</span><span>drag to build / unbuild</span><span>done</span></div>
      <div class="h" id="s-h"></div>
      <div id="s-pieces"></div>
      <div class="row"><button id="s-all">Show finished model</button><button id="s-print">Printable instructions</button></div>
      <p class="note"><kbd>←</kbd> <kbd>→</kbd> to move between steps.</p>`;
    const r = $('#s-range') as HTMLInputElement;
    r.oninput = () => { cancelAnimationFrame(progAnim); setProg(+r.value, false); };
    const snap = () => animateTo(Math.round(+r.value));
    r.onchange = snap;
    $('#s-first').onclick = () => go(0); $('#s-prev').onclick = () => go(stepNow() - 2); $('#s-next').onclick = () => go(stepNow()); $('#s-last').onclick = () => go(steps.length - 1);
    $('#s-all').onclick = () => { cancelAnimationFrame(progAnim); prog = steps.length; ($('#s-range') as HTMLInputElement).value = String(prog); viewer.showAll(); updateStepsUi(); };
    $('#s-print').onclick = printInstructions;
  }
  updateStepsUi();
  if (mode !== 'build') viewer.showProgress(prog, steps.map(s => s.parts));
}
function updateStepsUi() {
  if (!steps.length) return;
  const n = stepNow(), st = steps[n - 1];
  $('#s-title').innerHTML = `Step ${n}<span class="dim" style="font-weight:400"> / ${steps.length}</span>`;
  $('#s-bag').textContent = `Bag ${bagOfStep(n)}`;
  $('#s-h').textContent = `Add these ${st.parts.length} piece${st.parts.length > 1 ? 's' : ''} (max ${MAX_PER_STEP}) — highlighted in the view`;
  $('#s-pieces').innerHTML = groupParts(st.parts).map(g => `<div class="piece">${mini(g)}<span class="txt"><b>${pieceName(g.part)}</b><span>${COLOR_BY_ID[g.color].name}</span></span><span class="qty">×${g.ids.length}</span></div>`).join('');
  const r = $('#s-range') as HTMLInputElement; if (document.activeElement !== r || Math.abs(+r.value - prog) > 0.01) r.value = String(prog);
  (['#s-first', '#s-prev'] as const).forEach(s => ($(s) as HTMLButtonElement).disabled = prog <= 1.0001);
  (['#s-next', '#s-last'] as const).forEach(s => ($(s) as HTMLButtonElement).disabled = prog >= steps.length - 0.0001);
  stepIdx = n - 1;
}
function setProg(v: number, syncSlider = true) {
  prog = Math.max(0, Math.min(steps.length, v));
  if (syncSlider) ($('#s-range') as HTMLInputElement).value = String(prog);
  if (mode !== 'build') viewer.showProgress(prog, steps.map(s => s.parts));
  updateStepsUi();
}
function animateTo(target: number, ms = 380) {
  cancelAnimationFrame(progAnim);
  const from = prog, t0 = performance.now();
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
    setProg(from + (target - from) * e);
    if (k < 1) progAnim = requestAnimationFrame(tick);
  };
  progAnim = requestAnimationFrame(tick);
}
function go(i: number) { animateTo(Math.max(0, Math.min(steps.length - 1, i)) + 1); }
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).matches('input[type=text],textarea,input:not([type])')) return;
  if (!$('#tab-steps').hidden && steps.length) { if (e.key === 'ArrowRight') go(stepNow()); if (e.key === 'ArrowLeft') go(stepNow() - 2); }
});
function printInstructions() {
  if (!model) return;
  const rows = steps.map(s => `<tr><td>${s.n}</td><td>${groupParts(s.parts).map(g => `${g.ids.length} × ${pieceName(g.part)} (${COLOR_BY_ID[g.color].name})`).join('<br>')}</td></tr>`).join('');
  const html = `<!doctype html><meta charset=utf-8><title>${esc(model.name)} — instructions</title><style>body{font:13px system-ui;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #000;padding:4px 8px;vertical-align:top;text-align:left}h1{font-size:18px}</style><h1>${esc(model.name)} — ${model.parts.length} parts, ${steps.length} steps</h1><table><tr><th>Step</th><th>Add</th></tr>${rows}</table>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  window.open(url, '_blank');
}

// ---------- parts tab ----------
function renderParts() {
  const el = $('#tab-parts');
  if (!model) { el.innerHTML = '<p class="note">No model yet.</p>'; return; }
  const list = partsList(model);
  el.innerHTML = `
    <dl class="stat"><dt>Total parts</dt><dd>${model.parts.length}</dd><dt>Unique (part, colour)</dt><dd>${list.length}</dd></dl>
    <div class="row" style="margin:0 0 8px"><button id="p-xml">Download XML</button><button id="p-csv">CSV</button><button id="p-copy">Copy XML</button></div>
    <div class="bl-card">
      <div class="h">Get these parts on BrickLink</div>
      <ol><li>Press <b>Copy XML &amp; open BrickLink</b> (or download the XML file).</li><li>On BrickLink's <b>Wanted List → Upload</b> page, paste the XML into the box (or pick the file) and continue.</li><li>Check colours and quantities, then save the list. From there BrickLink can show sellers and prices.</li></ol>
      <div class="row"><button id="p-bl" class="primary">Copy XML &amp; open BrickLink</button></div>
      <p class="note">There is no BrickLink login or connection inside this app — the upload is a copy-and-paste step, so the app never sees your BrickLink account. Stock and prices are not checked here.</p>
    </div>
    <table><tr><th>Part</th><th>Colour</th><th class="r">Qty</th></tr>
    ${list.map(l => `<tr><td>${esc(l.name)}<br><span class="dim">BL ${l.bl}</span></td><td><span class="sw" style="background:${l.hex}"></span>${esc(l.colorName)}<br><span class="dim">BL colour ${l.blColor}</span></td><td class="r"><b>${l.qty}</b></td></tr>`).join('')}</table>
`;
  const dl = (name: string, text: string, type: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click(); };
  const base = model.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
  $('#p-xml').onclick = () => dl(`${base}-bricklink.xml`, wantedListXml(model!), 'application/xml');
  $('#p-bl').onclick = async () => { try { await navigator.clipboard.writeText(wantedListXml(model!)); $('#p-bl').textContent = 'XML copied — paste it on BrickLink'; } catch { $('#p-bl').textContent = 'Copy failed — use Download XML'; } window.open('https://www.bricklink.com/v2/wanted/upload.page', '_blank', 'noopener'); };
  $('#p-csv').onclick = () => dl(`${base}-parts.csv`, csv(model!), 'text/csv');
  $('#p-copy').onclick = async () => { try { await navigator.clipboard.writeText(wantedListXml(model!)); ($('#p-copy')).textContent = 'Copied'; } catch { ($('#p-copy')).textContent = 'Copy failed'; } };
}

// ---------- checks tab ----------
function renderChecks() {
  const el = $('#tab-checks');
  if (!report || !model) { el.innerHTML = '<p class="note">No model yet.</p>'; return; }
  const s = report.stats;
  el.innerHTML = `
    <div class="${report.ok ? 'ok' : 'fail'}">${report.ok ? 'One connected piece — builds' : 'Does not pass'}</div>
    <dl class="stat" style="margin-top:8px"><dt>Parts</dt><dd>${s.parts}</dd><dt>Connected groups</dt><dd>${s.components}</dd><dt>On the ground plate</dt><dd>${s.grounded}</dd><dt>Single-stud joints</dt><dd>${s.weakLinks}</dd><dt>Pressed on from below</dt><dd>${s.hanging}</dd></dl>
    ${report.problems.map(p => `<div class="issue">[${p.code}] ${esc(p.message)}</div>`).join('')}
    ${report.warnings.map(w => `<div class="issue" style="border-left-style:dashed">note: ${esc(w)}</div>`).join('')}
    <div class="h" style="margin-top:10px">What the program did</div>
    ${attempts.map(a => `<div class="issue" style="border-left-width:1px">${a.who === 'ai' ? 'AI' : 'Program'} · round ${a.round} · ${esc(a.note)}</div>`).join('')}
    <div class="h" style="margin-top:10px">Shape spec (what the AI wrote)</div>
    <pre>${esc(JSON.stringify(spec, null, 1))}</pre>
    <button id="c-copy">Copy spec JSON</button>`;
  $('#c-copy').onclick = () => navigator.clipboard?.writeText(JSON.stringify(spec, null, 2));
}

// ---------- build mode: 4 bags, tray, loose bricks ----------
type BagState = 'sealed' | 'open' | 'done';
let mode: 'view' | 'build' = 'view';
let bags: Bag[] = [], bagState: BagState[] = [], curBag = -1, bStep = 0, ripping = false, bMsg = '';
const bPlaced = new Set<number>(), bPending = new Set<number>();
let bHist: { id: number; spec: LooseSpec }[] = [];
const bagOfStep = (n: number) => bags.find(b => b.steps.some(s => s.n === n))?.n ?? 1;
const looseSpec = (p: Placed): LooseSpec => ({ part: p.part, color: p.color, fx: p.fx, fz: p.fz, h: p.h });

function resetBuild() {
  bags = model ? makeBags(steps) : []; bagState = bags.map(() => 'sealed'); curBag = -1; bStep = 0; ripping = false; bMsg = '';
  bPlaced.clear(); bPending.clear(); bHist = []; viewer.pile.clear(); viewer.setGhosts([]); needTray = false;
}
function enterBuild() {
  if (!model) { $('#tab-build').innerHTML = '<p class="note">No model yet.</p>'; return; }
  mode = 'build';
  viewer.enterBuild(Math.max(...bags.map(b => b.parts.length)));
  renderBuild(); syncBuildScene();
  if (needTray && curBag >= 0 && !ripping) { needTray = false; bags[curBag].parts.filter(p => !bPlaced.has(p.id)).forEach(p => viewer.pile.drop(looseSpec(p))); renderBuild(); }
}
function leaveBuild() { mode = 'view'; viewer.leaveBuild(); viewer.setGhosts([]); }
const allDone = () => bagState.length > 0 && bagState.every(s => s === 'done');
function curStep(): Step | null { return curBag >= 0 ? bags[curBag].steps[bStep] ?? null : null; }
/** Built model so far + ghosts for the step in hand. */
function syncBuildScene() {
  if (!model || mode !== 'build') return;
  if (allDone()) { viewer.showAll(); viewer.setGhosts([]); return; }
  const built: Placed[][] = [];
  bags.forEach((b, i) => { if (bagState[i] === 'done') built.push(b.parts); });
  if (curBag >= 0) {
    const bag = bags[curBag];
    for (let i = 0; i < bStep; i++) built.push(bag.steps[i].parts);
    const st = curStep();
    if (st) { built.push(st.parts.filter(p => bPlaced.has(p.id))); viewer.setGhosts(ripping ? [] : st.parts.filter(p => !bPlaced.has(p.id))); }
  } else viewer.setGhosts([]);
  viewer.showSteps(built, curBag >= 0);
}
const BAG_SVG = (n: number, state: string) => `<svg viewBox="0 0 40 48" width="34" height="40" aria-hidden="true"><path d="M6 8 Q4 26 6 42 Q20 46 34 42 Q36 26 34 8 Q20 4 6 8Z" fill="${state === 'done' ? '#111' : '#fff'}" stroke="#111" stroke-width="2"/><path d="M5 8 L9 4 L13 8 L17 4 L21 8 L25 4 L29 8 L33 4 L35 8" fill="none" stroke="#111" stroke-width="2"/><text x="20" y="32" text-anchor="middle" font-size="18" font-weight="700" fill="${state === 'done' ? '#fff' : '#111'}" font-family="system-ui,sans-serif">${n}</text></svg>`;

function renderBuild() {
  const el = $('#tab-build');
  if (!model || !steps.length) return;
  const nextAvail = curBag === -1 && !ripping ? bagState.findIndex(s => s === 'sealed') : -1;
  const placedTotal = bPlaced.size + bags.reduce((n, b, i) => n + (bagState[i] === 'done' ? b.parts.length - b.parts.filter(p => bPlaced.has(p.id)).length : 0), 0);
  const bagRow = bags.map((b, i) => {
    const st = bagState[i], can = i === nextAvail;
    const label = st === 'done' ? 'Built' : st === 'open' ? (ripping ? 'Opening…' : 'Open') : can ? 'Tap to open' : 'Locked';
    return `<button class="bag ${st} ${can ? 'can' : ''}" data-i="${i}" ${can ? '' : 'disabled'} aria-label="Bag ${b.n}, ${b.parts.length} pieces, ${label}">${BAG_SVG(b.n, st)}<span class="bl">Bag ${b.n}</span><span class="bs">${b.parts.length} pcs · ${label}</span></button>`;
  }).join('');
  let body = '';
  if (allDone()) {
    body = `<div class="big">Finished!</div><p>You built all ${model.parts.length} parts of <b>${esc(model.name)}</b> from ${bags.length} bags.</p><div class="row"><button id="b-restart" class="primary">Build again</button></div>`;
  } else if (curBag >= 0) {
    const bag = bags[curBag], st = curStep()!;
    const groups = groupParts(st.parts.filter(p => !bPlaced.has(p.id)));
    const loose = viewer.pile.count();
    body = `
      <div class="bar"><span class="big">Bag ${bag.n} · step ${bStep + 1}<span class="dim" style="font-weight:400"> / ${bag.steps.length}</span></span><span class="sp"></span><button id="b-undo" ${bHist.length && !ripping ? '' : 'disabled'}>Undo</button></div>
      <div class="h">Find these in the tray (${loose} loose brick${loose === 1 ? '' : 's'} left)</div>
      ${groups.map(g => `<div class="piece">${mini(g)}<span class="txt"><b>${pieceName(g.part)}</b><span>${COLOR_BY_ID[g.color].name}</span></span><span class="qty">×${g.ids.length}</span></div>`).join('') || '<p class="note">Step complete.</p>'}
      <div class="row"><button id="b-hint" ${ripping ? 'disabled' : ''}>Hint</button><button id="b-shake" ${ripping ? 'disabled' : ''}>Shake tray</button><button id="b-auto" ${ripping ? 'disabled' : ''}>Place one for me</button><button id="b-finish" ${ripping ? 'disabled' : ''}>Auto-build bag</button></div>`;
  } else {
    body = `<p class="note">Open the next bag. Its pieces spill into the tray beside the build — sort through them to find what each step needs.</p>`;
  }
  el.innerHTML = `<div class="bags">${bagRow}</div>${body}
    <p class="note ${/^✗/.test(bMsg) ? 'err' : ''}" id="b-msg">${esc(bMsg || (curBag >= 0 ? 'Stir the pile with your mouse or finger. Drag a brick (touch: press and hold) onto its ghost — or tap a brick, then tap the ghost.' : ''))}</p>`;
  void placedTotal;
  el.querySelectorAll<HTMLElement>('.bag.can').forEach(b => b.onclick = () => openBag(+b.dataset.i!));
  $('#b-restart')?.addEventListener('click', () => { resetBuild(); enterBuild(); });
  $('#b-hint')?.addEventListener('click', hint);
  $('#b-shake')?.addEventListener('click', () => { viewer.pile.shake(); say('Shaken — bricks are moving around.'); });
  $('#b-undo')?.addEventListener('click', undo);
  $('#b-auto')?.addEventListener('click', placeOne);
  $('#b-finish')?.addEventListener('click', autoBuildBag);
  syncBuildChrome();
  saveProgress();
}
function say(t: string) { bMsg = t; toast(t); const m = document.querySelector('#b-msg'); if (m) { m.textContent = t; m.className = 'note' + (t.startsWith('✗') ? ' err' : ''); } }

function openBag(i: number) {
  if (ripping || curBag !== -1) return;
  setDrawer(false);
  const bag = bags[i]; ripping = true; curBag = i; bStep = 0; bagState[i] = 'open'; bHist = []; bMsg = '';
  renderBuild(); syncBuildScene();
  viewer.pile.openBag(bag.n, bag.parts.map(looseSpec), () => { ripping = false; say(`Bag ${bag.n} is empty. ${bag.parts.length} bricks are in the tray — go find the first ones.`); renderBuild(); syncBuildScene(); }, () => say('Riiiip!'));
}
function advance() {
  const bag = bags[curBag];
  while (bStep < bag.steps.length && bag.steps[bStep].parts.every(p => bPlaced.has(p.id))) bStep++;
  if (bStep >= bag.steps.length) {
    bagState[curBag] = 'done'; const n = bag.n; curBag = -1; bHist = [];
    if (allDone()) setDrawer(true);
    say(allDone() ? 'All bags built!' : `Bag ${n} built. Open bag ${n + 1} when you are ready.`);
  }
  renderBuild(); syncBuildScene();
}
viewer.onDrop = (l, gid) => {
  if (mode !== 'build' || gid === null || ripping) return 'none';
  const st = curStep(); const target = st?.parts.find(p => p.id === gid);
  if (!target || bPlaced.has(gid) || bPending.has(gid)) return 'none';
  if (target.part === l.part && target.color === l.color) { bPending.add(gid); return 'ok'; }
  say(`✗ Wrong piece. That spot needs a ${pieceName(target.part)} (${COLOR_BY_ID[target.color].name}); you are holding a ${pieceName(l.part)} (${COLOR_BY_ID[l.color].name}).`);
  return 'wrong';
};
viewer.onPlaced = (l, gid) => {
  bPending.delete(gid); bPlaced.add(gid); bHist.push({ id: gid, spec: { part: l.part, color: l.color, fx: l.fx, fz: l.fz, h: l.h } });
  if (curBag < 0) return;
  say('Snapped on.'); advance();
};
function neededHere(): Placed | null { const st = curStep(); return st?.parts.find(p => !bPlaced.has(p.id) && !bPending.has(p.id)) ?? null; }
function looseMatching(p: Placed) { return [...viewer.pile.loose.values()].filter(l => !l.flying && l.part === p.part && l.color === p.color); }
function hint() {
  const need = neededHere(); if (!need) return;
  const m = looseMatching(need);
  viewer.pile.pulse(m.map(l => l.uid), 3500); viewer.setPulse([need.id]);
  say(`Hint: look for a ${pieceName(need.part)} (${COLOR_BY_ID[need.color].name}) — ${m.length} matching in the tray are wiggling.`);
}
function placeOne() {
  const need = neededHere(); if (!need) return;
  const m = looseMatching(need)[0]; if (!m) { say('No matching brick left in the tray.'); return; }
  bPending.add(need.id); viewer.flyLoose(m, need.id);
}
function undo() {
  const last = bHist.pop(); if (!last || ripping) return;
  bPlaced.delete(last.id);
  const bag = bags[curBag]; const idx = bag.steps.findIndex(s => s.parts.some(p => p.id === last.id)); if (idx >= 0) bStep = idx;
  viewer.hidePart(last.id); viewer.pile.drop(last.spec);
  say('Undone — the brick dropped back into the tray.'); renderBuild(); syncBuildScene();
}
function autoBuildBag() {
  if (curBag < 0 || ripping) return;
  const bag = bags[curBag];
  bag.parts.forEach(p => bPlaced.add(p.id)); bPending.clear();
  viewer.pile.clear(); bStep = bag.steps.length; advance();
}
$('.tabs').addEventListener('click', () => { /* tab() handles build enter/leave */ });

// ---------- input: text + picture ----------
const drop = $('#drop'), fileIn = $('#file') as HTMLInputElement;
drop.onclick = e => { if ((e.target as HTMLElement).id !== 'drop-clear') fileIn.click(); };
drop.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } };
fileIn.onchange = () => { if (fileIn.files?.[0]) takeImage(fileIn.files[0]); fileIn.value = ''; };
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', e => { const f = (e as DragEvent).dataTransfer?.files?.[0]; if (f) takeImage(f); });
window.addEventListener('paste', e => { const f = Array.from(e.clipboardData?.files ?? []).find(x => x.type.startsWith('image/')); if (f) takeImage(f); });
$('#drop-clear').onclick = e => { e.stopPropagation(); setImage(null); };
async function takeImage(f: File) {
  if (!f.type.startsWith('image/')) { setNote('That file is not an image.', true); return; }
  const bmp = await createImageBitmap(f);
  const s = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  setImage({ mime: 'image/jpeg', base64: url.split(',')[1], url });
}
function setImage(i: typeof image) {
  image = i;
  const img = $('#drop-img') as HTMLImageElement;
  img.hidden = !i; if (i) img.src = i.url;
  $('#drop-text').hidden = !!i; $('#drop-clear').hidden = !i;
}
function setNote(t: string, err = false) { const n = $('#ai-note'); n.textContent = t; n.className = 'note' + (err ? ' err' : ''); }
function refreshNote() {
  setNote(isConfigured(settings) ? (settings.provider === 'shared' ? 'AI: shared server' : `AI: ${settings.provider === 'anthropic' ? 'Anthropic' : settings.provider === 'gemini' ? 'Gemini' : 'local model'} · ${settings.provider === 'anthropic' ? settings.anthropicModel : settings.provider === 'gemini' ? settings.geminiModel : settings.localModel}`) : 'No AI set up. Use AI settings to paste a key or point at a local model — or open a ready-made build below.');
}

// ---------- generate ----------
let busy = false;
$('#go').onclick = generate;
($('#prompt') as HTMLTextAreaElement).addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate(); });
async function generate() {
  if (busy) return;
  const text = ($('#prompt') as HTMLTextAreaElement).value;
  if (!text.trim() && !image) { setNote('Type what you want to build, or drop a picture.', true); return; }
  if (!isConfigured(settings)) { setNote('No AI is set up yet. Open AI settings, or try a ready-made build.', true); ($('#settings') as HTMLDialogElement).showModal(); syncSettingsUi(); return; }
  busy = true; ($('#go') as HTMLButtonElement).disabled = true; $('#stage').classList.add('busy');
  logReset(); log(image ? 'Sending picture + notes to the AI…' : 'Asking the AI to describe shapes…', 'AI');
  currentPreset = ''; document.querySelectorAll('#presets button').forEach(x => x.classList.remove('on'));
  try {
    const first: Msg = { role: 'user', text: userPrompt(text, !!image), image: image ? { mime: image.mime, base64: image.base64 } : undefined };
    const ask = (sys: string, msgs: Msg[]) => complete(settings, sys, msgs);
    const reply = await ask(systemPrompt(), [first]);
    log('AI replied with a shape spec. Compiling to real parts…', 'prog');
    const res = await buildWithRepair({ rawText: reply }, ask, { original: first, onStatus: s => log(s, 'prog') });
    pendingKey = '';
    if (res.ok && res.spec) pendingKey = 'b:' + addBuild(res.spec, text, 'ai').id;
    showResult(res, text.slice(0, 40) || 'picture');
    if (phone.matches && appEl.dataset.panel === 'create') tab('steps');
  } catch (e) {
    log((e as Error).message, 'ERROR', true); setNote((e as Error).message, true);
  } finally { busy = false; ($('#go') as HTMLButtonElement).disabled = false; $('#stage').classList.remove('busy'); }
}

// ---------- settings dialog ----------
const dlg = $('#settings') as HTMLDialogElement;
function syncSettingsUi() {
  for (const k of ['anthropicKey', 'anthropicModel', 'geminiKey', 'geminiModel', 'localUrl', 'localModel', 'sharedUrl', 'sharedPasscode'] as const) ($(`#${k}`) as HTMLInputElement).value = settings[k];
  document.querySelectorAll<HTMLElement>('#prov button').forEach(b => b.classList.toggle('on', b.dataset.p === settings.provider));
  document.querySelectorAll<HTMLElement>('[data-for]').forEach(d => d.hidden = d.dataset.for !== settings.provider);
  $('#test-out').textContent = '';
}
function readSettingsUi() {
  for (const k of ['anthropicKey', 'anthropicModel', 'geminiKey', 'geminiModel', 'localUrl', 'localModel', 'sharedUrl', 'sharedPasscode'] as const) settings[k] = ($(`#${k}`) as HTMLInputElement).value.trim();
}
/** Ask the local server which models it really has, fill the model box's suggestions, and fix a model name that is not installed. */
async function findModels() {
  const out = $('#models-out'); out.textContent = 'Looking…';
  try {
    const ids = await listLocalModels(settings);
    $('#localModelList').innerHTML = ids.map(id => `<option value="${esc(id)}"></option>`).join('');
    if (!ids.length) { out.textContent = 'The server answered, but it has no models installed.'; return; }
    if (ids.includes(settings.localModel)) { out.textContent = `Installed: ${ids.join(', ')}`; return; }
    const was = settings.localModel;
    settings.localModel = ids[0]; ($('#localModel') as HTMLInputElement).value = ids[0]; saveSettings(settings); refreshNote();
    out.textContent = `"${was}" is not installed, so I picked "${ids[0]}". Installed: ${ids.join(', ')}`;
  } catch (e) { out.textContent = (e as Error).message; }
}
$('#find-models').onclick = () => { readSettingsUi(); void findModels(); };
$('#btn-settings').onclick = () => { syncSettingsUi(); dlg.showModal(); if (settings.provider === 'local') void findModels(); };
document.querySelectorAll<HTMLElement>('#prov button').forEach(b => b.onclick = () => { readSettingsUi(); settings.provider = b.dataset.p as ProviderId; saveSettings(settings); syncSettingsUi(); refreshNote(); if (settings.provider === 'local') void findModels(); });
const persist = () => { readSettingsUi(); saveSettings(settings); refreshNote(); };
dlg.addEventListener('close', persist);
$('#save-close').onclick = () => { persist(); dlg.close(); };
dlg.addEventListener('click', e => { if (e.target === dlg) { persist(); dlg.close(); } });   // click the dimmed backdrop to close
dlg.addEventListener('input', persist);
dlg.querySelector('form')!.addEventListener('submit', persist);
$('#clear-keys').onclick = () => { readSettingsUi(); saveSettings(settings); clearKeys(); settings = loadSettings(); syncSettingsUi(); refreshNote(); };
$('#test').onclick = async () => {
  readSettingsUi(); const out = $('#test-out'); out.textContent = 'Testing…';
  try { out.textContent = 'Connected. Reply: ' + await testConnection(settings); } catch (e) { out.textContent = (e as Error).message; }
};

// ---------- saved builds, progress, share links, profile dialog ----------
function addBuild(sp: ShapeSpec, prompt: string, source: SavedBuild['source']): SavedBuild {
  const sig = JSON.stringify(sp);
  const dup = profile.builds.find(b => JSON.stringify(b.spec) === sig);
  if (dup) return dup;
  const b: SavedBuild = { id: newId(), name: (sp.name || prompt || 'Untitled').slice(0, PLIM.name), spec: sp, created: Date.now(), source, prompt: prompt ? prompt.slice(0, 300) : undefined };
  profile.builds.push(b);
  while (profile.builds.length > PLIM.builds) { const old = profile.builds.shift()!; delete profile.progress['b:' + old.id]; }
  commit(); return b;
}
function saveProgress() {
  if (!currentKey || !model || !bags.length) return;
  const untouched = bagState.every(s => s === 'sealed');
  if (untouched) delete profile.progress[currentKey];
  else {
    const open = curBag >= 0 ? new Set(bags[curBag].parts.map(p => p.id)) : new Set<number>();
    profile.progress[currentKey] = { bagState: [...bagState], curBag, placed: [...bPlaced].filter(id => open.has(id)), updated: Date.now() };
  }
  commit();
}
function restoreProgress() {
  const pr = currentKey ? profile.progress[currentKey] : null;
  if (!pr || pr.bagState.length !== bags.length) return;
  bagState = pr.bagState.slice(); curBag = pr.curBag;
  bagState = bagState.map((s, i) => (s === 'open' && i !== curBag ? 'sealed' : s));
  if (curBag >= 0 && bagState[curBag] !== 'open') curBag = -1;
  if (curBag >= 0) {
    const bag = bags[curBag], ids = new Set(bag.parts.map(p => p.id));
    pr.placed.filter(id => ids.has(id)).forEach(id => bPlaced.add(id));
    bStep = bag.steps.findIndex(st => st.parts.some(p => !bPlaced.has(p.id)));
    if (bStep < 0) { bagState[curBag] = 'done'; curBag = -1; bStep = 0; bPlaced.clear(); } else needTray = true;
  }
}
function curInfo(): { key: string; name: string; preset: boolean } | null {
  if (!currentKey) return model ? { key: '', name: model.name, preset: false } : null;
  if (currentKey.startsWith('p:')) { const p = PRESETS.find(x => 'p:' + x.id === currentKey); return p ? { key: currentKey, name: p.spec.name, preset: true } : null; }
  const b = profile.builds.find(x => 'b:' + x.id === currentKey); return b ? { key: currentKey, name: b.name, preset: false } : null;
}
async function loadSaved(id: string) {
  const b = profile.builds.find(x => x.id === id); if (!b) return;
  pendingKey = 'b:' + id;
  logReset(); log(`Opening your saved build "${b.name}"`, 'info');
  $('#stage').classList.add('busy'); await new Promise(r => setTimeout(r, 20));
  const res = await buildWithRepair(b.spec, null);
  $('#stage').classList.remove('busy');
  document.querySelectorAll('#presets button').forEach(x => x.classList.remove('on'));
  showResult(res, b.name);
}
async function loadShared(sp: ShapeSpec) {
  const b = addBuild(sp, '', 'shared'); b.source = b.source === 'ai' ? 'ai' : 'shared';
  pendingKey = 'b:' + b.id;
  logReset(); log(`Opened a shared build: "${b.name}"`, 'info');
  $('#stage').classList.add('busy'); await new Promise(r => setTimeout(r, 20));
  const res = await buildWithRepair(sp, null);
  $('#stage').classList.remove('busy');
  document.querySelectorAll('#presets button').forEach(x => x.classList.remove('on'));
  showResult(res, b.name);
}
async function openKey(key: string) {
  if (key.startsWith('p:')) return loadPreset(key.slice(2));
  return loadSaved(key.slice(2));
}
/** Opens a share link found in the address bar. Returns true if the hash held a link (good or damaged). */
async function openHashLink(): Promise<boolean> {
  const h = location.hash.match(/^#s=(.+)$/);
  if (!h) return false;
  const d = await decodeShare(h[1]);
  history.replaceState(null, '', location.pathname + location.search);
  if (d.ok) await loadShared(d.spec); else setNote(d.error, true);
  return d.ok;
}
window.addEventListener('hashchange', () => { if (!busy) void openHashLink(); });
async function startup() {
  if (await openHashLink()) return;
  const q = new URLSearchParams(location.search).get('preset'); if (q) return loadPreset(q);
  const last = profile.last;
  if (last.startsWith('b:') && profile.builds.some(b => 'b:' + b.id === last)) return loadSaved(last.slice(2));
  if (last.startsWith('p:') && PRESETS.some(p => 'p:' + p.id === last)) return loadPreset(last.slice(2));
  return loadPreset('house');
}
function applyProfileLook() {
  viewer.setLook(profile.look);
  document.querySelectorAll<HTMLElement>('#looks button').forEach(x => x.classList.toggle('on', x.dataset.look === profile.look));
}
function refreshFavs() { document.querySelectorAll<HTMLElement>('#presets button').forEach(b => b.classList.toggle('fav', profile.favorites.includes(b.dataset.id!))); }
function refreshProfileButton() { $('#btn-profile').textContent = profile.name || 'Guest'; refreshFavs(); }
const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const armed = new WeakMap<HTMLElement, number>();
/** Two-step buttons: first click arms ("Sure?"), second click within 3 s does it. */
function armThen(btn: HTMLElement, label: string, run: () => void) {
  if (armed.has(btn)) { clearTimeout(armed.get(btn)); armed.delete(btn); run(); return; }
  const old = btn.textContent; btn.textContent = label;
  armed.set(btn, window.setTimeout(() => { armed.delete(btn); btn.textContent = old; }, 4000));
}
function progressLine(pr: Profile['progress'][string]) {
  const done = pr.bagState.filter(s => s === 'done').length, n = pr.bagState.length;
  return { done, n, text: done === n ? 'Finished' : `${done} of ${n} bags built${pr.curBag >= 0 ? ` · bag ${pr.curBag + 1} open` : ''}` };
}
let shareUrl = '';
function renderSaved() {
  const el = $('#tab-saved'), cur = curInfo();
  const nameOf = (k: string) => k.startsWith('p:') ? PRESETS.find(p => 'p:' + p.id === k)?.spec.name : profile.builds.find(b => 'b:' + b.id === k)?.name;
  const inProg = Object.entries(profile.progress).filter(([k]) => nameOf(k)).sort((a, b) => b[1].updated - a[1].updated);
  const favs = profile.favorites.filter(id => PRESETS.some(p => p.id === id));
  const isFav = cur?.preset && profile.favorites.includes(cur.key.slice(2));
  el.innerHTML = `
    <div class="h">Open now</div>
    ${cur ? `<div class="item"><span class="txt"><b>${esc(cur.name)}</b><span>${cur.key ? (cur.preset ? 'Ready-made build' : 'Saved build') : 'Not saved (did not pass the checks)'}</span></span>
      ${cur.preset ? `<button class="star ${isFav ? 'on' : ''}" data-act="fav" title="Favourite">${isFav ? '★' : '☆'}</button>` : ''}
      <button data-act="share" ${spec ? '' : 'disabled'}>Share link</button></div>
      <input class="share-box" id="share-box" readonly hidden aria-label="Share link">` : '<p class="note">No model open.</p>'}
    <div class="saved-h"><span class="h" style="margin:0">Pick up where you left off</span></div>
    ${inProg.length ? inProg.map(([k, pr]) => { const l = progressLine(pr); return `<div class="item"><span class="txt"><b>${esc(nameOf(k)!)}</b><span>${l.text} · ${when(pr.updated)}</span><div class="pbar"><i style="width:${Math.round(l.done / l.n * 100)}%"></i></div></span><button data-act="resume" data-key="${k}" class="primary">${l.done === l.n ? 'View' : 'Resume'}</button></div>`; }).join('') : '<p class="note">Nothing in progress. Open a bag on the Build tab and your progress is saved automatically.</p>'}
    <div class="saved-h"><span class="h" style="margin:0">My builds (${profile.builds.length})</span></div>
    ${profile.builds.length ? [...profile.builds].reverse().map(b => `<div class="item"><span class="txt"><b>${esc(b.name)}</b><span>${b.source === 'shared' ? 'Shared with you' : b.source === 'imported' ? 'From a file' : 'Made with AI'} · ${when(b.created)}</span></span><button data-act="open" data-key="b:${b.id}">Open</button><button data-act="del" data-id="${b.id}" title="Delete">Delete</button></div>`).join('') : '<p class="note">Builds you generate with AI, or open from a share link, are kept here.</p>'}
    ${favs.length ? `<div class="saved-h"><span class="h" style="margin:0">Favourites</span></div>${favs.map(id => `<div class="item"><span class="txt"><b>${esc(PRESETS.find(p => p.id === id)!.spec.name)}</b><span>Ready-made</span></span><button data-act="open" data-key="p:${id}">Open</button></div>`).join('')}` : ''}
    <p class="note">Everything here is saved in this browser. To keep it safe or use it on another computer, choose <b>${esc($('#btn-profile').textContent || 'Guest')}</b> at the top and save a profile file.</p>`;
  el.onclick = async e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]'); if (!t) return;
    const act = t.dataset.act;
    if (act === 'open') await openKey(t.dataset.key!);
    else if (act === 'resume') { await openKey(t.dataset.key!); tab('build'); }
    else if (act === 'del') armThen(t, 'Sure?', () => { const id = t.dataset.id!; profile.builds = profile.builds.filter(b => b.id !== id); delete profile.progress['b:' + id]; if (profile.last === 'b:' + id) profile.last = ''; commit(); renderSaved(); });
    else if (act === 'fav') { const id = cur!.key.slice(2); profile.favorites = profile.favorites.includes(id) ? profile.favorites.filter(x => x !== id) : [...profile.favorites, id]; commit(); refreshFavs(); renderSaved(); }
    else if (act === 'share' && spec) {
      const url = `${location.href.split('#')[0]}#s=${await encodeShare(spec)}`; shareUrl = url;
      const box = $('#share-box') as HTMLInputElement; box.hidden = false; box.value = url; box.select();
      try { await navigator.clipboard.writeText(url); t.textContent = 'Link copied'; } catch { t.textContent = 'Copy the link below'; }
    }
  };
}
// profile dialog
const pdlg = $('#profile') as HTMLDialogElement;
let pendingSettings: Partial<Settings> | null = null;
function pfStatus() {
  const n = Object.keys(profile.progress).length;
  $('#pf-status').textContent = `Saved automatically in this browser · ${profile.builds.length} saved build${profile.builds.length === 1 ? '' : 's'} · ${n} in progress`;
  ($('#pf-name') as HTMLInputElement).value = profile.name;
}
function pfMsg(t: string) { $('#pf-msg').textContent = t; }
$('#btn-profile').onclick = () => { pfStatus(); pfMsg(''); ($('#pf-apply-row') as HTMLElement).hidden = true; pdlg.showModal(); };
$('#pf-close').onclick = () => pdlg.close();
pdlg.addEventListener('click', e => { if (e.target === pdlg) pdlg.close(); });
($('#pf-name') as HTMLInputElement).addEventListener('input', e => { profile.name = (e.target as HTMLInputElement).value.slice(0, PLIM.name); refreshProfileButton(); commit(); });
($('#pf-inc-settings') as HTMLInputElement).onchange = e => { const on = (e.target as HTMLInputElement).checked; const k = $('#pf-inc-keys') as HTMLInputElement; k.disabled = !on; if (!on) k.checked = false; };
$('#pf-save').onclick = () => {
  const inc = ($('#pf-inc-settings') as HTMLInputElement).checked, keys = ($('#pf-inc-keys') as HTMLInputElement).checked;
  const text = exportProfile(profile, { settings: inc ? settings : undefined, includeKeys: keys });
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = fileNameFor(profile); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  pfMsg(`Saved ${a.download}. Keep it somewhere safe — load it here any time to get everything back.${keys ? ' It contains your API keys, so keep it private.' : ''}`);
};
$('#pf-load').onclick = () => ($('#pf-file') as HTMLInputElement).click();
($('#pf-file') as HTMLInputElement).onchange = async e => {
  const inp = e.target as HTMLInputElement, f = inp.files?.[0]; inp.value = ''; if (!f) return;
  const v = parseProfileFile(await f.text());
  if (!v.ok) { pfMsg(v.error); return; }
  const m = mergeProfile(profile, v.profile); profile = m.profile; commit();
  saveProfile(profile);
  pendingSettings = v.profile.settings ?? null; ($('#pf-apply-row') as HTMLElement).hidden = !pendingSettings;
  applyProfileLook(); refreshProfileButton(); pfStatus(); if (!$('#tab-saved').hidden) renderSaved();
  pfMsg(`Loaded: ${m.addedBuilds} new saved build${m.addedBuilds === 1 ? '' : 's'}, ${m.updatedProgress} progress update${m.updatedProgress === 1 ? '' : 's'}.${v.warnings.length ? ' Note: ' + v.warnings.slice(0, 3).join(' ') : ''}${pendingSettings ? ' This file also has AI settings — apply them below if you want them.' : ''}`);
  const last = profile.last; if (last && last !== currentKey) { /* leave the open model alone; it is under Saved */ }
};
$('#pf-apply').onclick = () => { if (!pendingSettings) return; settings = { ...settings, ...pendingSettings }; saveSettings(settings); refreshNote(); pendingSettings = null; ($('#pf-apply-row') as HTMLElement).hidden = true; pfMsg('AI settings applied.'); };
$('#pf-persist').onclick = async () => {
  const ok = await requestPersistence();
  pfMsg(ok === true ? 'Your browser agreed to keep this data. Saving a profile file is still the safest backup.' : ok === false ? 'Your browser did not promise to keep the data. Save a profile file now and then to be safe.' : 'This browser does not support that request. Save a profile file now and then to be safe.');
};
$('#pf-erase').onclick = e => armThen(e.currentTarget as HTMLElement, 'Click again to erase', () => {
  clearTimeout(saveTimer); try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
  profile = emptyProfile(); applyProfileLook(); refreshProfileButton(); pfStatus(); resetBuild(); if (mode === 'build') enterBuild();
  if (!$('#tab-saved').hidden) renderSaved(); pfMsg('Profile erased from this browser. Your AI settings were not touched.');
});

refreshNote(); if (setupViaLink) setNote('Shared AI is set up on this device. Describe something to build!'); renderHud(); render();
applyProfileLook();
refreshProfileButton();
placeFoot(); setPanel(phone.matches ? 'create' : 'steps');
startup();
