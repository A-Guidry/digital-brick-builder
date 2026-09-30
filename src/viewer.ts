import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Model, Placed } from './compiler';
import { COLOR_BY_ID } from './catalog';
import { Pile, Loose, LooseSpec } from './pile';

export type Look = 'studio' | 'dramatic';
const PLATE = 0.4;            // world units per plate (1 unit = 1 stud)
const STUD_R = 0.3, STUD_H = 0.18;

export class Viewer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 500);
  controls: OrbitControls;
  root = new THREE.Group();
  ghostRoot = new THREE.Group();
  meshes = new Map<number, THREE.Mesh>();
  private mats = new Map<string, THREE.MeshPhysicalMaterial>();
  private geoms = new Map<string, THREE.BufferGeometry>();
  private key = new THREE.DirectionalLight(0xffffff, 2);
  private fill = new THREE.HemisphereLight(0xffffff, 0x888888, 0.4);
  private rim = new THREE.DirectionalLight(0x9db8ff, 0);
  private ground: THREE.Mesh;
  private base = new THREE.Group();
  private env: THREE.Texture;
  model: Model | null = null;
  look: Look = 'studio';
  private off = new THREE.Vector3();
  pile: Pile;
  buildActive = false;
  /** Called when a brick is dropped/tapped onto a ghost. 'ok' = accept, 'wrong' = refuse with feedback, 'none' = nothing happened. */
  onDrop: ((l: Loose, ghostId: number | null) => 'ok' | 'wrong' | 'none') | null = null;
  onPlaced: ((l: LooseSpec, ghostId: number) => void) | null = null;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private ptr = { mode: 'idle' as 'idle' | 'cand' | 'drag' | 'stir', brick: null as Loose | null, x: 0, y: 0, type: 'mouse', timer: 0 as any, last: null as THREE.Vector3 | null, moved: 0, hover: -1 };
  private raf = 0;
  private pulse: number[] = [];

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    host.appendChild(this.renderer.domElement);
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.env;
    this.scene.add(this.root, this.ghostRoot, this.base);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0004;
    this.key.shadow.normalBias = 0.02;
    this.scene.add(this.key, this.key.target, this.fill, this.rim);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.25 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.camera.position.set(22, 20, 28);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.pile = new Pile(p => this.brickMesh(p), this.scene);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(host);
    this.setLook('studio');
    this.resize();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
    loop();
  }

  private tick() {
    const dt = this.clock.getDelta();
    this.controls.update();
    this.pile.update(dt);
    const t = performance.now() / 1000;
    for (const id of this.pulse) { const m = this.ghostRoot.children.find(c => c.userData.id === id) as THREE.Mesh | undefined; if (m) (m.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.3 * Math.sin(t * 6); }
    this.renderer.render(this.scene, this.camera);
  }
  resize() {
    const w = this.host.clientWidth || 300, h = this.host.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px'; this.renderer.domElement.style.height = h + 'px';
    const old = this.camera.aspect; this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.model && Math.abs(old - this.camera.aspect) > 0.05) this.frame();   // layout changed (rotation, bigger build view): re-fit
  }

  // ---- materials & geometry ------------------------------------------------
  private material(color: string, mode: 'normal' | 'new' = 'normal'): THREE.MeshPhysicalMaterial {
    const k = `${color}|${mode}`;
    let m = this.mats.get(k);
    if (!m) {
      const c = new THREE.Color(COLOR_BY_ID[color].hex);
      m = new THREE.MeshPhysicalMaterial({
        color: c, roughness: 0.32, metalness: 0, clearcoat: 0.55, clearcoatRoughness: 0.28,
        sheen: 0.15, sheenRoughness: 0.6, envMapIntensity: this.look === 'studio' ? 1 : 0.35,
        emissive: mode === 'new' ? new THREE.Color(0xffffff) : new THREE.Color(0x000000), emissiveIntensity: mode === 'new' ? 0.16 : 0,
      });
      this.mats.set(k, m);
    }
    return m;
  }
  private geometry(p: { fx: number; fz: number; h: number }): THREE.BufferGeometry {
    const k = `${p.fx}x${p.fz}x${p.h}`;
    let g = this.geoms.get(k);
    if (!g) {
      const gap = 0.03, W = p.fx - gap, D = p.fz - gap, H = p.h * PLATE - 0.01;
      const body = new RoundedBoxGeometry(W, H, D, 3, Math.min(0.05, H / 4));
      const parts: THREE.BufferGeometry[] = [body];
      for (let i = 0; i < p.fx; i++) for (let j = 0; j < p.fz; j++) {
        const s = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 20);
        s.translate(-p.fx / 2 + i + 0.5, H / 2 + STUD_H / 2 - 0.005, -p.fz / 2 + j + 0.5);
        parts.push(s);
      }
      const merged = mergeGeometries(parts.map(x => x.index ? x.toNonIndexed() : x), false)!;
      parts.forEach(x => x.dispose());
      g = merged; this.geoms.set(k, g);
    }
    return g;
  }
  brickMesh(p: LooseSpec): THREE.Mesh {
    const m = new THREE.Mesh(this.geometry(p), this.material(p.color));
    return m;
  }
  private position(p: Placed): THREE.Vector3 {
    return new THREE.Vector3(p.x + p.fx / 2 + this.off.x, p.y * PLATE + (p.h * PLATE) / 2, p.z + p.fz / 2 + this.off.z);
  }

  // ---- model ---------------------------------------------------------------
  setModel(model: Model | null) {
    this.clear(this.root); this.clear(this.ghostRoot); this.meshes.clear();
    this.pile.clear();
    this.model = model; this.pulse = [];
    for (const c of [...this.base.children]) { this.base.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    if (!model) return;
    this.off.set(-model.size[0] / 2, 0, -model.size[1] / 2);
    for (const p of model.parts) {
      const m = new THREE.Mesh(this.geometry(p), this.material(p.color));
      m.position.copy(this.position(p)); m.castShadow = true; m.receiveShadow = true; m.userData.id = p.id;
      this.root.add(m); this.meshes.set(p.id, m);
    }
    this.buildBaseplate(model);
    this.frame();
    this.applyLook();
  }
  private buildBaseplate(model: Model) {
    const w = model.size[0] + 4, d = model.size[1] + 4;
    const plate = new THREE.Mesh(new RoundedBoxGeometry(w, PLATE, d, 2, 0.04),
      new THREE.MeshPhysicalMaterial({ color: this.look === 'studio' ? 0x5e7a99 : 0x1f2a38, roughness: 0.45, clearcoat: 0.3 }));
    plate.position.set(0, -PLATE / 2, 0); plate.receiveShadow = true; plate.castShadow = false; plate.userData.base = true;
    this.base.add(plate);
    const stud = new THREE.CylinderGeometry(STUD_R, STUD_R, STUD_H, 14);
    const inst = new THREE.InstancedMesh(stud, plate.material as THREE.Material, w * d);
    const mtx = new THREE.Matrix4(); let n = 0;
    for (let i = 0; i < w; i++) for (let j = 0; j < d; j++) { mtx.setPosition(-w / 2 + i + 0.5, STUD_H / 2 - 0.005, -d / 2 + j + 0.5); inst.setMatrixAt(n++, mtx); }
    inst.receiveShadow = true; inst.userData.base = true;
    this.base.add(inst);
    this.key.shadow.camera.left = -w; this.key.shadow.camera.right = w; this.key.shadow.camera.top = w; this.key.shadow.camera.bottom = -w;
    this.key.shadow.camera.far = 120; this.key.shadow.camera.updateProjectionMatrix();
  }
  private clear(g: THREE.Group) {
    for (const c of [...g.children]) { g.remove(c); const m = c as THREE.Mesh; if (m.userData.ghost) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }
  }
  frame(includeTray = this.buildActive) {
    if (!this.model) return;
    const [sx, sz, sy] = this.model.size, h = sy * PLATE;
    let minX = -sx / 2 - 2, maxX = sx / 2 + 2, minZ = -sz / 2 - 2, maxZ = sz / 2 + 2, H = h;
    if (includeTray) {
      const t = this.pile.tray;
      minX = Math.min(minX, t.cx - t.w / 2 - 1); maxX = Math.max(maxX, t.cx + t.w / 2 + 1);
      minZ = Math.min(minZ, t.cz - t.d / 2 - 1); maxZ = Math.max(maxZ, t.cz + t.d / 2 + 1); H = Math.max(h, 9);
    }
    const dx = maxX - minX, dz = maxZ - minZ;
    const radius = Math.sqrt(dx * dx + dz * dz + H * H) / 2;
    let dist = (radius / Math.sin((this.camera.fov * Math.PI) / 360)) * (this.camera.aspect < 1 ? 1.25 : 1.0) * (includeTray ? 1.1 : 1.0);
    if (includeTray) {
      // Build view looks mostly straight down: fit the footprint to the screen's width and height separately,
      // so a tall phone screen gets a tall layout instead of a tiny, cropped wide one.
      const tv = Math.tan((this.camera.fov * Math.PI) / 360), th = tv * this.camera.aspect;
      dist = Math.max((dx / 2) / th, ((dz * 0.85 + H * 0.55) / 2) / tv) * 1.25 + 2;
    }
    const flat = H < Math.max(dx, dz) * 0.3;   // flat builds are easier to read from higher up
    const dir = (flat || includeTray ? new THREE.Vector3(0.22, 1.0, 0.62) : new THREE.Vector3(0.62, 0.52, 0.78)).normalize();
    this.controls.target.set((minX + maxX) / 2, includeTray ? 0 : H / 2, (minZ + maxZ) / 2);
    this.camera.position.copy(this.controls.target).addScaledVector(dir, dist);
    this.controls.update();
  }

  // ---- build mode: bags, tray, loose bricks -----------------------------------
  enterBuild(maxBagParts: number) {
    if (!this.model) return;
    this.buildActive = true; this.resize();
    const area = Math.max(90, maxBagParts * 6.5);
    const w = THREE.MathUtils.clamp(Math.round(Math.sqrt(area * 1.5)), 14, 40), d = THREE.MathUtils.clamp(Math.ceil(area / w), 10, 30);
    const [sx, sz] = this.model.size;
    // landscape screens: tray beside the plate. Portrait (phones): tray in front of it, so both fill the width.
    if (this.camera.aspect < 1) { const pw = Math.max(14, Math.min(w, Math.max(sx + 6, 18))), pd = Math.min(30, Math.max(10, Math.ceil(area / pw))); this.pile.setTray(0, sz / 2 + 2 + 3 + pd / 2, pw, pd); }
    else this.pile.setTray(sx / 2 + 2 + 3 + w / 2, 0, w, d);
    this.pile.setLook(this.look === 'studio');
    this.pile.show(true);
    this.frame(true);
  }
  leaveBuild() {
    this.buildActive = false; this.resize(); this.pile.show(false); this.controls.enabled = true; this.ptr.mode = 'idle';
    this.renderer.domElement.style.cursor = '';
    this.frame(false);
  }

  private setRay(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
  }
  private hitLoose(e: PointerEvent): Loose | null {
    this.setRay(e);
    const meshes = [...this.pile.loose.values()].filter(l => !l.flying).map(l => l.mesh);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    return hit ? this.pile.loose.get(hit.object.userData.loose as number) ?? null : null;
  }
  private hitGhost(e: PointerEvent): number | null {
    this.setRay(e);
    const hit = this.raycaster.intersectObjects(this.ghostRoot.children, false)[0];
    return hit ? (hit.object.userData.id as number) : null;
  }
  private groundPt(e: PointerEvent, y: number): THREE.Vector3 | null {
    this.setRay(e);
    const out = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), out) ? out : null;
  }
  private hoverGhost(id: number | null) {
    const want = id ?? -1; if (this.ptr.hover === want) return; this.ptr.hover = want;
    for (const g of this.ghostRoot.children) ((g as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = g.userData.id === want ? 0.85 : 0.4;
  }
  private finishDrop(l: Loose, gid: number | null) {
    const verdict = this.onDrop?.(l, gid) ?? 'none';
    if (verdict === 'ok' && gid !== null && this.model) {
      const part = this.model.parts.find(q => q.id === gid)!;
      this.flyLoose(l, gid);
    } else if (l.held) {
      this.pile.release(l, new THREE.Vector3(0, -3, 0));
    }
    this.hoverGhost(null);
  }
  /** Fly a loose brick onto the ghost of build part `gid`, then report it as placed. */
  flyLoose(l: Loose, gid: number) {
    const part = this.model!.parts.find(q => q.id === gid)!;
    const q = new THREE.Quaternion();
    if (l.fx !== part.fx) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);   // brick lies the other way round
    this.pile.select(null);
    this.pile.flyTo(l, this.position(part), () => this.onPlaced?.(l, gid), q);
  }
  private startDrag(e: PointerEvent) {
    const p = this.ptr; if (!p.brick) return;
    clearTimeout(p.timer); p.mode = 'drag'; this.pile.pickUp(p.brick);
    this.renderer.domElement.style.cursor = 'grabbing';
    this.dragTo(e);
  }
  private dragTo(e: PointerEvent) {
    const b = this.ptr.brick!, g = this.groundPt(e, 7);
    if (g) { b.mesh.position.lerp(g, 0.6); }
    b.mesh.quaternion.slerp(new THREE.Quaternion(), 0.2);
    this.hoverGhost(this.hitGhost(e));
  }
  private stirTo(e: PointerEvent) {
    const g = this.groundPt(e, 0.6), p = this.ptr;
    if (!g || !this.pile.inTray(g.x, g.z, 0.5)) { p.last = null; return; }
    if (p.last) { const d = g.clone().sub(p.last); d.y = 0; if (d.length() > 0.02) this.pile.stir(g, d); }
    p.last = g;
  }
  private bindPointer() {
    const el = this.renderer.domElement, p = this.ptr;
    el.style.touchAction = 'none';
    // capture phase on the host so we can switch OrbitControls off BEFORE it sees the press
    this.host.addEventListener('pointerdown', e => {
      if (!this.buildActive) return;
      p.x = e.clientX; p.y = e.clientY; p.type = e.pointerType; p.moved = 0; p.last = null; p.brick = null;
      const b = this.hitLoose(e);
      if (b) {
        p.mode = 'cand'; p.brick = b; this.controls.enabled = false;
        if (e.pointerType !== 'mouse') p.timer = setTimeout(() => { if (p.mode === 'cand') this.startDrag(e); }, 300);
      } else {
        const g = this.groundPt(e, 0.6);
        if (g && this.pile.inTray(g.x, g.z, 0.5)) { p.mode = 'stir'; p.last = g; this.controls.enabled = false; }
        else p.mode = 'idle';
      }
      try { el.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    }, true);
    el.addEventListener('pointermove', e => {
      if (!this.buildActive) return;
      p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x, e.clientY - p.y));
      if (p.mode === 'drag') { this.dragTo(e); return; }
      if (p.mode === 'cand') {
        if (e.pointerType === 'mouse' && p.moved > 5) { this.startDrag(e); return; }
        if (e.pointerType !== 'mouse' && p.moved > 10) { clearTimeout(p.timer); p.mode = 'stir'; p.brick = null; }
        return;
      }
      if (p.mode === 'stir' || (e.pointerType === 'mouse' && e.buttons === 0)) {
        this.stirTo(e);
        if (e.pointerType === 'mouse' && e.buttons === 0) el.style.cursor = this.hitLoose(e) ? 'grab' : '';
      }
    });
    const up = (e: PointerEvent) => {
      if (!this.buildActive) return;
      clearTimeout(p.timer);
      const mode = p.mode, b = p.brick, tap = p.moved < 8;
      p.mode = 'idle'; p.brick = null; p.last = null; this.controls.enabled = true; el.style.cursor = '';
      if (mode === 'drag' && b) { this.finishDrop(b, this.hitGhost(e)); return; }
      if (tap) {
        const gid = this.hitGhost(e);
        const sel = this.pile.selected;
        if (mode === 'cand' && b) { this.pile.select(sel === b ? null : b); return; }
        if (gid !== null && sel) this.finishDrop(sel, gid);
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', e => { if (p.mode === 'drag' && p.brick) this.pile.release(p.brick); p.mode = 'idle'; p.brick = null; this.controls.enabled = true; void e; });
  }

  // ---- steps / highlight / ghosts ------------------------------------------
  /** Show parts up to (and incl.) current step; parts in the current step are highlighted; later ones hidden. */
  showSteps(upTo: Placed[][], highlightLast = true) {
    const visible = new Map<number, boolean>();
    upTo.forEach((s, i) => s.forEach(p => visible.set(p.id, highlightLast && i === upTo.length - 1)));
    for (const [id, m] of this.meshes) {
      const p = this.model!.parts[this.model!.parts.findIndex(q => q.id === id)];
      m.visible = visible.has(id); m.position.copy(this.position(p));
      m.material = this.material(p.color, visible.get(id) ? 'new' : 'normal');
      this.setOutline(m, !!visible.get(id), p);
    }
  }
  /** Continuous build progress: f = 0..N. Whole steps are built; the fractional part drops the next step's pieces in one by one (or lifts them back out when scrubbing backwards). */
  showProgress(f: number, steps: Placed[][]) {
    if (!this.model) return;
    const N = steps.length; f = Math.max(0, Math.min(N, f));
    const k = Math.floor(f + 1e-6), frac = f - k > 1e-6 ? f - k : 0;
    const cur = frac > 0 ? k : k - 1;                       // the step being shown / highlighted
    const state = new Map<number, number>();                // part id -> 0..1 arrival
    steps.forEach((s, i) => s.forEach((p, j) => {
      if (i < cur) state.set(p.id, 1);
      else if (i === cur) {
        if (frac === 0) state.set(p.id, 1);
        else { const n = s.length, a = n === 1 ? 0 : (j / n) * 0.55, q = (frac - a) / 0.45; state.set(p.id, Math.max(0, Math.min(1, q))); }
      }
    }));
    const curIds = new Set(cur >= 0 && cur < N ? steps[cur].map(p => p.id) : []);
    for (const [id, m] of this.meshes) {
      const a = state.get(id) ?? 0;
      const p = this.model.parts.find(q => q.id === id)!;
      m.visible = a > 0.001;
      m.material = this.material(p.color, curIds.has(id) ? 'new' : 'normal');
      this.setOutline(m, curIds.has(id) && m.visible, p);
      const e = 1 - Math.pow(1 - a, 3);
      const base = this.position(p);
      m.position.set(base.x, base.y + (1 - e) * 7, base.z);
    }
    this.clear(this.ghostRoot);
  }
  showAll() {
    for (const [id, m] of this.meshes) { const q = this.model!.parts.find(x => x.id === id)!; m.position.copy(this.position(q)); }
    for (const [id, m] of this.meshes) { m.visible = true; m.material = this.material(this.model!.parts.find(q => q.id === id)!.color); this.setOutline(m, false); }
    this.clear(this.ghostRoot); this.pulse = [];
    this.frame();
  }
  private setOutline(m: THREE.Mesh, on: boolean, p?: Placed) {
    const ex = m.children.find(c => c.userData.outline);
    if (on && !ex && p) {
      const l = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(p.fx, p.h * PLATE, p.fz)), new THREE.LineBasicMaterial({ color: this.look === 'studio' ? 0x000000 : 0xffffff }));
      l.userData.outline = true; m.add(l);
    }
    if (!on && ex) { m.remove(ex); (ex as THREE.LineSegments).geometry.dispose(); }
  }
  /** Translucent target ghosts for build mode. */
  setGhosts(parts: Placed[]) {
    this.clear(this.ghostRoot); this.pulse = [];
    for (const p of parts) {
      const g = new THREE.BoxGeometry(p.fx - 0.02, p.h * PLATE, p.fz - 0.02);
      const mat = new THREE.MeshBasicMaterial({ color: COLOR_BY_ID[p.color].hex, transparent: true, opacity: 0.4, depthWrite: false });
      const m = new THREE.Mesh(g, mat);
      m.position.copy(this.position(p)); m.userData = { ghost: true, id: p.id };
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color: this.look === 'studio' ? 0x111111 : 0xffffff }));
      m.add(edges);
      this.ghostRoot.add(m);
    }
  }
  setPulse(ids: number[]) { this.pulse = ids; for (const m of this.ghostRoot.children) if (!ids.includes(m.userData.id)) (m as THREE.Mesh & { material: THREE.MeshBasicMaterial }).material.opacity = 0.4; }
  placePart(id: number, normalHighlight = true) {
    const m = this.meshes.get(id); if (!m) return;
    m.visible = true;
    const p = this.model!.parts.find(q => q.id === id)!;
    m.material = this.material(p.color, normalHighlight ? 'new' : 'normal');
    this.setOutline(m, normalHighlight, p);
  }
  hidePart(id: number) { const m = this.meshes.get(id); if (m) m.visible = false; }
  /** Kept deliberately passive: the camera stays framed on the whole model so tall builds never crop. */
  focusOn(_parts: Placed[]) { /* no-op */ }

  // ---- looks ---------------------------------------------------------------
  setLook(look: Look) { this.look = look; this.applyLook(); }
  private applyLook() {
    const studio = this.look === 'studio';
    this.scene.background = null;   // the stage colour comes from CSS so each UI theme can set its own
    this.renderer.setClearAlpha(0);
    this.host.dataset.look = studio ? 'studio' : 'dramatic';
    this.scene.environment = this.env;
    this.scene.environmentIntensity = studio ? 0.85 : 0.12;
    this.renderer.toneMappingExposure = studio ? 1.0 : 1.15;
    if (studio) {
      this.key.color.set(0xffffff); this.key.intensity = 1.8; this.key.position.set(14, 30, 18); this.key.shadow.radius = 6;
      this.fill.intensity = 0.55; this.rim.intensity = 0;
      (this.ground.material as THREE.ShadowMaterial).opacity = 0.22;
    } else {
      this.key.color.set(0xffe2bd); this.key.intensity = 5.2; this.key.position.set(-20, 16, 8); this.key.shadow.radius = 1.5;
      this.fill.intensity = 0.06; this.rim.color.set(0x8fb0ff); this.rim.intensity = 3.2; this.rim.position.set(18, 12, -22);
      (this.ground.material as THREE.ShadowMaterial).opacity = 0.7;
    }
    this.pile?.setLook(studio);
    for (const [k, m] of this.mats) { m.envMapIntensity = studio ? 1 : 0.45; m.needsUpdate = true; }
    const bp = this.base.children[0] as THREE.Mesh | undefined;
    if (bp) (bp.material as THREE.MeshPhysicalMaterial).color.set(studio ? 0x6d7177 : 0x2a2d32);
    for (const g of this.ghostRoot.children) { const e = g.children[0] as THREE.LineSegments | undefined; if (e) (e.material as THREE.LineBasicMaterial).color.set(studio ? 0x111111 : 0xffffff); }
  }

  snapshot(): string { this.renderer.render(this.scene, this.camera); return this.renderer.domElement.toDataURL('image/png'); }
  dispose() { cancelAnimationFrame(this.raf); this.renderer.dispose(); }
}
