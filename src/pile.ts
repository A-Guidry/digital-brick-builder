import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { COLOR_BY_ID } from './catalog';

const PLATE = 0.4;
export interface LooseSpec { part: string; color: string; fx: number; fz: number; h: number }
export interface Loose extends LooseSpec { uid: number; mesh: THREE.Mesh; body: CANNON.Body; mass: number; held: boolean; flying: boolean }
export type MeshFactory = (p: LooseSpec) => THREE.Mesh;

const rnd = (a = -1, b = 1) => a + Math.random() * (b - a);
const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

interface Ripper { group: THREE.Group; strip: THREE.Mesh; body: THREE.Mesh; preview: THREE.Object3D[]; t: number; list: LooseSpec[]; spawned: number; stripVel: THREE.Vector3 | null; stripT: number; dur: number; done: () => void; ripped: boolean; onRip?: () => void; phase: 'drop' | 'shake' | 'dump' | 'crumple' | 'gone' }

/** Loose bricks with real rigid-body physics, a sorting tray, and the bag that rips open and dumps them. */
export class Pile {
  world: CANNON.World;
  group = new THREE.Group();
  private trayGroup = new THREE.Group();
  loose = new Map<number, Loose>();
  tray = { cx: 12, cz: 0, w: 20, d: 14 };
  visible = false;
  private uid = 1;
  private mat = new CANNON.Material('brick');
  private fixed: CANNON.Body[] = [];
  private ripper: Ripper | null = null;
  private pulses = new Map<number, number>();  // uid -> until (ms)
  private flights: { l: Loose; from: THREE.Vector3; to: THREE.Vector3; qFrom: THREE.Quaternion; qTo: THREE.Quaternion; t: number; done: () => void }[] = [];
  selected: Loose | null = null;
  private trayMat = new THREE.MeshStandardMaterial({ color: 0xd8b36a, roughness: 0.6 });
  private outline = new Map<number, THREE.LineSegments>();

  constructor(private make: MeshFactory, private scene: THREE.Scene) {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -48, 0) });
    this.world.allowSleep = true;
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 12;
    this.world.defaultContactMaterial = new CANNON.ContactMaterial(this.mat, this.mat, { friction: 0.45, restitution: 0.12 });
    this.group.visible = false; this.trayGroup.visible = false;
    scene.add(this.group, this.trayGroup);
  }

  setLook(studio: boolean) { this.trayMat.color.set(studio ? 0xd8b36a : 0x2c2f34); }

  setTray(cx: number, cz: number, w: number, d: number) {
    this.tray = { cx, cz, w, d };
    for (const b of this.fixed) this.world.removeBody(b);
    this.fixed = [];
    for (const c of [...this.trayGroup.children]) { this.trayGroup.remove(c); (c as THREE.Mesh).geometry?.dispose(); }
    const box = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => {
      const b = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), material: this.mat });
      b.position.set(x, y, z); this.world.addBody(b); this.fixed.push(b);
    };
    box(cx, -2, cz, w / 2 + 1, 2, d / 2 + 1);                       // floor (thick, no tunnelling)
    box(cx - w / 2 - 0.5, 4, cz, 0.5, 4, d / 2 + 1); box(cx + w / 2 + 0.5, 4, cz, 0.5, 4, d / 2 + 1);
    box(cx, 4, cz - d / 2 - 0.5, w / 2 + 1, 4, 0.5); box(cx, 4, cz + d / 2 + 0.5, w / 2 + 1, 4, 0.5);
    // visible tray: floor + low rim
    const floor = new THREE.Mesh(new THREE.BoxGeometry(w + 2, 0.4, d + 2), this.trayMat);
    floor.position.set(cx, -0.2, cz); floor.receiveShadow = true; this.trayGroup.add(floor);
    const rim = (x: number, z: number, sx: number, sz: number) => {
      const m = new THREE.Mesh(new RoundedBoxGeometry(sx, 1.1, sz, 2, 0.12), this.trayMat);
      m.position.set(x, 0.55, z); m.castShadow = true; m.receiveShadow = true; this.trayGroup.add(m);
    };
    rim(cx - w / 2 - 0.5, cz, 1, d + 2); rim(cx + w / 2 + 0.5, cz, 1, d + 2);
    rim(cx, cz - d / 2 - 0.5, w, 1); rim(cx, cz + d / 2 + 0.5, w, 1);
  }
  inTray(x: number, z: number, margin = 0) {
    return Math.abs(x - this.tray.cx) <= this.tray.w / 2 + margin && Math.abs(z - this.tray.cz) <= this.tray.d / 2 + margin;
  }

  show(v: boolean) { this.visible = v; this.group.visible = v; this.trayGroup.visible = v; }
  count() { return this.loose.size; }

  clear() {
    for (const l of [...this.loose.values()]) this.remove(l.uid);
    this.selected = null; this.flights = []; this.pulses.clear();
    if (this.ripper) { this.scene.remove(this.ripper.group); this.ripper = null; }
  }

  add(spec: LooseSpec, pos: THREE.Vector3, vel?: THREE.Vector3, quat?: THREE.Quaternion): Loose {
    const mesh = this.make(spec);
    const hx = spec.fx / 2 - 0.01, hy = (spec.h * PLATE) / 2 - 0.01, hz = spec.fz / 2 - 0.01;
    const mass = Math.max(0.4, spec.fx * spec.fz * spec.h * 0.12);
    const body = new CANNON.Body({ mass, shape: new CANNON.Box(new CANNON.Vec3(hx, hy, hz)), material: this.mat });
    body.position.set(pos.x, pos.y, pos.z);
    const q = quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd(0, 6.28), rnd(0, 6.28), rnd(0, 6.28)));
    body.quaternion.set(q.x, q.y, q.z, q.w);
    if (vel) body.velocity.set(vel.x, vel.y, vel.z);
    body.angularVelocity.set(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6));
    body.linearDamping = 0.03; body.angularDamping = 0.12;
    body.allowSleep = true; body.sleepSpeedLimit = 0.3; body.sleepTimeLimit = 0.5;
    this.world.addBody(body);
    const l: Loose = { ...spec, uid: this.uid++, mesh, body, mass, held: false, flying: false };
    mesh.userData.loose = l.uid; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.position.copy(pos); mesh.quaternion.copy(q);
    this.group.add(mesh); this.loose.set(l.uid, l);
    return l;
  }
  /** Drop a brick into the tray from above (undo, or a brick that was refused). */
  drop(spec: LooseSpec) {
    const t = this.tray;
    return this.add(spec, new THREE.Vector3(t.cx + rnd(-t.w / 3, t.w / 3), 9 + rnd(0, 3), t.cz + rnd(-t.d / 3, t.d / 3)), new THREE.Vector3(rnd(-2, 2), 0, rnd(-2, 2)));
  }
  remove(uid: number) {
    const l = this.loose.get(uid); if (!l) return;
    this.world.removeBody(l.body); this.group.remove(l.mesh); this.loose.delete(uid);
    this.setOutline(l, false);
    if (this.selected === l) this.selected = null;
  }
  private setOutline(l: Loose, on: boolean) {
    const ex = this.outline.get(l.uid);
    if (on && !ex) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(l.fx, l.h * PLATE, l.fz)), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }));
      e.renderOrder = 10; l.mesh.add(e); this.outline.set(l.uid, e);
    } else if (!on && ex) { l.mesh.remove(ex); ex.geometry.dispose(); this.outline.delete(l.uid); }
  }
  select(l: Loose | null) {
    if (this.selected && this.selected !== l) this.setOutline(this.selected, false);
    this.selected = l; if (l) this.setOutline(l, true);
  }

  // ---- taking a brick out of physics (while dragged) and putting it back ----
  pickUp(l: Loose) { if (l.held) return; l.held = true; this.world.removeBody(l.body); }
  release(l: Loose, vel?: THREE.Vector3) {
    if (!l.held) return; l.held = false;
    l.body.position.set(l.mesh.position.x, l.mesh.position.y, l.mesh.position.z);
    l.body.quaternion.set(l.mesh.quaternion.x, l.mesh.quaternion.y, l.mesh.quaternion.z, l.mesh.quaternion.w);
    l.body.velocity.set(vel?.x ?? 0, vel?.y ?? -2, vel?.z ?? 0); l.body.angularVelocity.set(rnd(-2, 2), rnd(-2, 2), rnd(-2, 2));
    // keep inside the tray
    const t = this.tray;
    l.body.position.x = THREE.MathUtils.clamp(l.body.position.x, t.cx - t.w / 2 + 1, t.cx + t.w / 2 - 1);
    l.body.position.z = THREE.MathUtils.clamp(l.body.position.z, t.cz - t.d / 2 + 1, t.cz + t.d / 2 - 1);
    l.body.position.y = Math.max(l.body.position.y, 3);
    this.world.addBody(l.body); l.body.wakeUp();
  }
  /** Fly a held/loose brick onto its ghost, then remove it from the pile. */
  flyTo(l: Loose, to: THREE.Vector3, done: () => void, qTo = new THREE.Quaternion()) {
    if (!l.held) this.pickUp(l);
    l.flying = true; this.setOutline(l, false);
    this.flights.push({ l, from: l.mesh.position.clone(), to, qFrom: l.mesh.quaternion.clone(), qTo, t: 0, done });
  }

  // ---- stirring ----
  /** Push bricks near a point along a horizontal delta (mouse hover or finger swipe). */
  stir(at: THREE.Vector3, delta: THREE.Vector3, radius = 1.9) {
    const speed = Math.min(1.6, delta.length());
    if (speed < 0.01) return 0;
    let n = 0;
    for (const l of this.loose.values()) {
      if (l.held || l.flying) continue;
      const p = l.body.position, dx = p.x - at.x, dz = p.z - at.z, dist = Math.hypot(dx, dz);
      if (dist > radius + Math.max(l.fx, l.fz) / 2) continue;
      const fall = 1 - Math.min(1, dist / (radius + 2));
      const k = l.mass * 14 * fall;
      l.body.wakeUp();
      l.body.applyImpulse(new CANNON.Vec3(delta.x * k + dx * 0.4 * l.mass * speed, 1.6 * l.mass * speed * fall, delta.z * k + dz * 0.4 * l.mass * speed));
      l.body.angularVelocity.set(l.body.angularVelocity.x + rnd(-2, 2) * speed, l.body.angularVelocity.y + rnd(-3, 3) * speed, l.body.angularVelocity.z + rnd(-2, 2) * speed);
      n++;
    }
    return n;
  }
  shake() {
    for (const l of this.loose.values()) if (!l.held && !l.flying) { l.body.wakeUp(); l.body.applyImpulse(new CANNON.Vec3(rnd(-1, 1) * l.mass * 9, rnd(4, 9) * l.mass, rnd(-1, 1) * l.mass * 9)); l.body.angularVelocity.set(rnd(-5, 5), rnd(-5, 5), rnd(-5, 5)); }
  }
  pulse(uids: number[], ms = 3000) { const until = performance.now() + ms; uids.forEach(u => this.pulses.set(u, until)); }
  snapshot() { return [...this.loose.values()].map(l => ({ uid: l.uid, part: l.part, color: l.color, x: l.mesh.position.x, y: l.mesh.position.y, z: l.mesh.position.z, asleep: l.body.sleepState === CANNON.Body.SLEEPING })); }

  // ---- the bag ----
  get ripping() { return !!this.ripper; }
  openBag(n: number, list: LooseSpec[], done: () => void, onRip?: () => void) {
    if (this.ripper) return;
    const g = new THREE.Group();
    const plastic = new THREE.MeshPhysicalMaterial({ color: 0xf2f4f6, transparent: true, opacity: 0.5, roughness: 0.12, clearcoat: 1, side: THREE.DoubleSide, depthWrite: false });
    const body = new THREE.Mesh(new RoundedBoxGeometry(5.6, 7.4, 2.2, 5, 0.9), plastic);
    g.add(body);
    // a peek of what is inside
    const preview: THREE.Object3D[] = [];
    for (let i = 0; i < Math.min(14, list.length); i++) {
      const s = list[(i * 7) % list.length];
      const m = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.9, 1.6), rnd(0.5, 0.9), rnd(0.9, 1.6)), new THREE.MeshStandardMaterial({ color: COLOR_BY_ID[s.color].hex, roughness: 0.4 }));
      m.position.set(rnd(-2, 2), rnd(-3, 2.6), rnd(-0.5, 0.5)); m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
      g.add(m); preview.push(m);
    }
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = 256;
    const cx = cv.getContext('2d')!; cx.fillStyle = '#fff'; cx.fillRect(0, 0, 256, 256); cx.fillStyle = '#111'; cx.font = 'bold 150px system-ui,sans-serif'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillText(String(n), 128, 138);
    cx.font = 'bold 30px system-ui,sans-serif'; cx.fillText('BAG', 128, 34); cx.strokeStyle = '#111'; cx.lineWidth = 8; cx.strokeRect(4, 4, 248, 248);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(cv) }));
    label.position.set(0, -0.4, 1.13); g.add(label);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(5.7, 0.7, 2.3), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.5 }));
    strip.position.set(0, 3.55, 0); g.add(strip);
    const t = this.tray;
    g.position.set(t.cx, 18, t.cz - 3.5); g.rotation.set(0, 0.35, 0.1);
    this.scene.add(g);
    this.ripper = { group: g, strip, body, preview, t: 0, list: [...list].sort(() => Math.random() - 0.5), spawned: 0, stripVel: null, stripT: 0, dur: THREE.MathUtils.clamp(list.length / 22, 1.3, 3.2), done, ripped: false, onRip, phase: 'drop' };
  }

  update(dt: number) {
    if (!this.visible) return;
    dt = Math.min(dt, 0.05);
    this.world.step(1 / 120, dt, 6);
    const now = performance.now();
    for (const l of this.loose.values()) {
      if (l.held || l.flying) continue;
      { // safety net: a brick that escaped the tray (or fell through) is dropped back in
        const t = this.tray, b = l.body.position;
        if (b.y < -1 || Math.abs(b.x - t.cx) > t.w / 2 + 0.6 || Math.abs(b.z - t.cz) > t.d / 2 + 0.6) {
          b.set(THREE.MathUtils.clamp(b.x, t.cx - t.w / 2 + 2, t.cx + t.w / 2 - 2), 6, THREE.MathUtils.clamp(b.z, t.cz - t.d / 2 + 2, t.cz + t.d / 2 - 2));
          l.body.velocity.set(0, 0, 0); l.body.angularVelocity.set(0, 0, 0); l.body.wakeUp();
        }
      }
      l.mesh.position.set(l.body.position.x, l.body.position.y, l.body.position.z);
      l.mesh.quaternion.set(l.body.quaternion.x, l.body.quaternion.y, l.body.quaternion.z, l.body.quaternion.w);
    }
    // hint pulses
    for (const [u, until] of this.pulses) {
      const l = this.loose.get(u);
      if (!l || now > until) { if (l) { l.mesh.scale.setScalar(1); this.setOutline(l, l === this.selected); } this.pulses.delete(u); continue; }
      const s = 1 + 0.07 * Math.sin(now / 90); l.mesh.scale.setScalar(s); this.setOutline(l, true);
    }
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i]; f.t += dt / 0.22; const k = ease(f.t);
      f.l.mesh.position.lerpVectors(f.from, f.to, k); f.l.mesh.quaternion.slerpQuaternions(f.qFrom, f.qTo, k);
      if (f.t >= 1) { this.flights.splice(i, 1); this.remove(f.l.uid); f.done(); }
    }
    if (this.ripper) this.stepRipper(dt);
  }

  private stepRipper(dt: number) {
    const r = this.ripper!, t = this.tray; r.t += dt;
    const g = r.group;
    if (r.phase === 'drop') {
      const k = ease(r.t / 0.6);
      g.position.y = 18 + (8 - 18) * k; g.rotation.z = 0.1 * (1 - k) + Math.sin(r.t * 9) * 0.05 * (1 - k);
      if (r.t >= 0.6) { r.phase = 'shake'; r.t = 0; }
    } else if (r.phase === 'shake') {
      const decay = 1 - r.t / 0.7;
      g.rotation.z = Math.sin(r.t * 48) * 0.16 * decay; g.position.y = 8 + Math.abs(Math.sin(r.t * 24)) * 0.35 * decay;
      if (r.t > 0.35 && !r.ripped) {          // the seal tears off
        r.ripped = true; r.onRip?.();
        this.scene.attach(r.strip);
        r.stripVel = new THREE.Vector3(3.5, 9, -3); r.stripT = 0;
        r.body.scale.set(1, 0.97, 1);
      }
      if (r.t >= 0.7) { r.phase = 'dump'; r.t = 0; r.preview.forEach(p => (p.visible = false)); g.rotation.z = 0; }
    } else if (r.phase === 'dump') {
      const p = Math.min(1, r.t / r.dur);
      g.rotation.x = 2.25 * ease(Math.min(1, r.t / 0.9));
      g.position.y = 8 - 1.6 * ease(Math.min(1, r.t / 0.9));
      const want = Math.floor(p * r.list.length + (p >= 1 ? 1 : 0));
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(g.quaternion);
      while (r.spawned < Math.min(want, r.list.length) && g.rotation.x > 1.05) {
        const spec = r.list[r.spawned++];
        const at = g.localToWorld(new THREE.Vector3(rnd(-2.1, 2.1), 3.2, rnd(-0.6, 0.6)));
        at.x = THREE.MathUtils.clamp(at.x, t.cx - t.w / 2 + 1.5, t.cx + t.w / 2 - 1.5);
        at.z = THREE.MathUtils.clamp(at.z, t.cz - t.d / 2 + 1.5, t.cz + t.d / 2 - 1.5);
        this.add(spec, at, up.clone().multiplyScalar(rnd(1, 4)).add(new THREE.Vector3(rnd(-2.5, 2.5), rnd(-1, 1), rnd(0, 3))));
      }
      if (r.spawned >= r.list.length && r.t > r.dur + 0.3) { r.phase = 'crumple'; r.t = 0; }
    } else if (r.phase === 'crumple') {
      const k = ease(r.t / 0.5);
      g.scale.set(1 + 0.15 * k, 1 - 0.85 * k, 1 + 0.2 * k);
      g.position.set(t.cx + (t.w / 2 - 2.5) * k * 0.0 + 0, 8 - 1.6 - (6.2 - 0.3) * k, t.cz - t.d / 2 + 0.5 * (1 - k) - 1.5 * k);
      (r.body.material as THREE.MeshPhysicalMaterial).opacity = 0.5 * (1 - Math.max(0, (r.t - 0.5) / 0.6));
      if (r.t >= 1.1) { this.scene.remove(g); this.scene.remove(r.strip); const d = r.done; this.ripper = null; d(); return; }
    }
    if (r.stripVel) {
      r.stripT += dt; r.stripVel.y -= 32 * dt; r.strip.position.addScaledVector(r.stripVel, dt); r.strip.rotation.x += 7 * dt; r.strip.rotation.z += 5 * dt;
      if (r.stripT > 1.4) { this.scene.remove(r.strip); r.stripVel = null; }
    }
  }
}
