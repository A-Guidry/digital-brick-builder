import { describe, it, expect, afterEach } from 'vitest';
import * as THREE from 'three';
import { Pile, TUNE } from '../src/pile';

// Deterministic randomness so the physics result is repeatable.
const realRandom = Math.random;
afterEach(() => { Math.random = realRandom; });
function seed(n: number) { let s = n * 9973 + 11; Math.random = () => (s = (s * 16807) % 2147483647) / 2147483647; }

const PARTS: [number, number, number][] = [[2, 4, 3], [2, 2, 3], [1, 4, 3], [1, 2, 3], [2, 3, 3], [1, 1, 3], [4, 6, 1], [2, 2, 1], [1, 6, 3], [2, 8, 3]];

/** Drop bricks into a tray, let them settle, sweep a finger across the middle, report how the bricks in its path moved. */
function sweep(seedN: number, speed: number, w = 28, d = 20, n = 50) {
  seed(seedN);
  const pile = new Pile(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), new THREE.Scene());
  pile.show(true); pile.setTray(0, 0, w, d);
  for (let i = 0; i < n; i++) { const [a, b, h] = PARTS[i % PARTS.length]; pile.add({ part: 'x', color: 'red', fx: a, fz: b, h }, new THREE.Vector3((Math.random() - 0.5) * w * 0.6, 3 + Math.random() * 10, (Math.random() - 0.5) * d * 0.6)); }
  for (let i = 0; i < 600; i++) pile.update(1 / 60);
  const before = pile.snapshot().map(s => [s.x, s.z]);
  const inPath = before.map(b => Math.abs(b[1]) < 3);
  let x = -w * 0.4;
  for (let ev = 0; ev < Math.floor((w * 0.8) / speed); ev++) { x += speed; pile.stir(new THREE.Vector3(x, 0.6, 0), new THREE.Vector3(speed, 0, 0)); pile.update(1 / 60); }
  for (let i = 0; i < 90; i++) pile.update(1 / 60);
  const moved = pile.snapshot().map((s, i) => Math.hypot(s.x - before[i][0], s.z - before[i][1])).filter((_, i) => inPath[i]);
  return { n: moved.length, far: moved.filter(v => v > 1.5).length, mean: moved.reduce((a, b) => a + b, 0) / Math.max(1, moved.length) };
}

describe('tray physics', () => {
  it('a finger swipe moves most of the bricks in its path, not just a few (slow, medium and fast swipes)', () => {
    for (const speed of [0.25, 0.6, 1.2]) {
      let n = 0, far = 0, mean = 0;
      for (const sd of [1, 2, 3]) { const r = sweep(sd, speed); n += r.n; far += r.far; mean += r.mean / 3; }
      expect(far / n, `speed ${speed}`).toBeGreaterThan(0.7);   // the old, weak tuning was 33% to 50%
      expect(mean, `speed ${speed}`).toBeGreaterThan(5);        // average distance in studs; the old tuning was 2 to 3
    }
  });
  it('hard swipes do not throw bricks out of the tray', () => {
    seed(5);
    const w = 28, d = 20, pile = new Pile(() => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)), new THREE.Scene());
    pile.show(true); pile.setTray(0, 0, w, d);
    for (let i = 0; i < 50; i++) { const [a, b, h] = PARTS[i % PARTS.length]; pile.add({ part: 'x', color: 'red', fx: a, fz: b, h }, new THREE.Vector3((Math.random() - 0.5) * 10, 3 + Math.random() * 10, (Math.random() - 0.5) * 8)); }
    for (let i = 0; i < 600; i++) pile.update(1 / 60);
    for (let s = 0; s < 6; s++) { let x = -12; for (let ev = 0; ev < 30; ev++) { x += 0.8; pile.stir(new THREE.Vector3(x, 0.6, -6 + s * 2.4), new THREE.Vector3(1.5, 0, 0)); pile.update(1 / 60); } }
    for (let i = 0; i < 300; i++) pile.update(1 / 60);
    const out = pile.snapshot().filter(s => Math.abs(s.x) > w / 2 + 0.6 || Math.abs(s.z) > d / 2 + 0.6 || s.y < -1);
    expect(out.length).toBe(0);
  });
  it('keeps the tuning that makes stirring feel strong', () => {
    expect(TUNE.power).toBeGreaterThanOrEqual(40);
    expect(TUNE.radius).toBeGreaterThanOrEqual(2.4);
  });
});
