// Base animal controller: channels, coroutine scripts, procedural pose layering
import * as THREE from 'three';
import { damp, clamp, smooth, lerp } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _m = new THREE.Matrix4();

export class Animal {
  constructor(inst, built) {
    this.inst = inst; this.built = built;
    this.root = new THREE.Group();
    this.body = new THREE.Group(); // body offset group (hops, rolls)
    this.root.add(this.body);
    this.body.add(inst.mesh);
    this.bones = inst.bones;
    this.rest = {};
    for (const n in this.bones) this.rest[n] = this.bones[n].position.clone();
    this.P = {};
    for (const n in this.bones) this.P[n] = { x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0 };
    this.c = {}; this.tg = {}; this.rt = {};
    this.time = Math.random() * 10; this.dt = 0.016;
    this.main = null; this.layers = [];
    this.yaw = 0; this.gait = 0; this.speed = 0;
    this.eyes = [];
    this.look = { yaw: 0, pitch: 0, w: 0 };
    this.lookTarget = null; // world-space Vector3 or null
    this.morphW = {};
    this.blinkT = 2 + Math.random() * 3; this.blink = 0;
    this.asleep = false;
    this.mouth = new THREE.Object3D();
  }
  // ---- channels ----
  set(name, v, rate = 6) { this.tg[name] = v; this.rt[name] = rate; if (this.c[name] === undefined) this.c[name] = 0; }
  now(name, v) { this.tg[name] = v; this.c[name] = v; if (this.rt[name] === undefined) this.rt[name] = 6; }
  g(name) { return this.c[name] || 0; }
  // ---- coroutine helpers ----
  *wait(d) { let t = 0; while (t < d) { t += this.dt; yield; } }
  *tween(d, fn) { let t = 0; fn(0); while (t < d) { t += this.dt; fn(clamp(t / d, 0, 1)); yield; } fn(1); }
  *until(cond) { while (!cond()) yield; }
  play(gen) { this.main = gen; }
  layer(gen) { this.layers.push(gen); }
  *turnTo(yaw, rate = 5) {
    while (Math.abs(angDiff(this.yaw, yaw)) > 0.03) { this.yaw += angDiff(this.yaw, yaw) * (1 - Math.exp(-rate * this.dt)); this.gait += this.dt * 3; yield; }
  }
  *walkTo(x, z, speed = 0.4, gaitScale = 1, turnRate = 6) {
    this.set('walk', 1, 6);
    const p = this.root.position;
    for (let guard = 0; guard < 2000; guard++) {
      const dx = x - p.x, dz = z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.01) break;
      const want = Math.atan2(dx, dz);
      this.yaw += angDiff(this.yaw, want) * (1 - Math.exp(-turnRate * this.dt));
      const facing = Math.max(0, Math.cos(angDiff(this.yaw, want)));
      const sp = Math.min(speed * (0.35 + 0.65 * facing) * Math.min(1, d / 0.08 + 0.3), d / this.dt);
      p.x += Math.sin(this.yaw) * sp * this.dt * (d > 0.05 ? 1 : 0) + (d <= 0.05 ? dx * 0.2 : 0);
      p.z += Math.cos(this.yaw) * sp * this.dt * (d > 0.05 ? 1 : 0) + (d <= 0.05 ? dz * 0.2 : 0);
      this.speed = sp;
      this.gait += sp * this.dt * gaitScale;
      yield;
    }
    this.speed = 0;
    this.set('walk', 0, 5);
  }
  *walkPath(pts, speed, gaitScale) { for (const p of pts) yield* this.walkTo(p[0], p[1], speed, gaitScale); }
  // ---- per-frame ----
  update(dt) {
    this.dt = dt; this.time += dt;
    if (this.main) { const r = this.main.next(); if (r.done) this.main = null; }
    for (let i = this.layers.length - 1; i >= 0; i--) { const r = this.layers[i].next(); if (r.done) this.layers.splice(i, 1); }
    for (const k in this.tg) this.c[k] = damp(this.c[k], this.tg[k], this.rt[k], dt);
    this.root.rotation.y = this.yaw;
    // blink
    if (!this.asleep) {
      this.blinkT -= dt;
      if (this.blinkT < 0) { this.blinkT = 2.5 + Math.random() * 4; this.blink = 1; }
    }
    this.blink = Math.max(0, this.blink - dt * 7);
    // reset pose
    for (const n in this.P) { const p = this.P[n]; p.x = p.y = p.z = p.px = p.py = p.pz = 0; }
    this.updateLook(dt);
    this.pose(dt);
    for (const n in this.P) {
      const p = this.P[n], b = this.bones[n], r = this.rest[n];
      _e.set(p.x, p.y, p.z, 'YXZ');
      b.quaternion.setFromEuler(_e);
      b.position.set(r.x + p.px, r.y + p.py, r.z + p.pz);
    }
    this.post && this.post(dt);
    // eyelids
    const lidV = clamp(Math.max(this.g('lid'), bump01(this.blink)), 0, 1);
    for (const e of this.eyes) e.setClosed(lidV);
    // morphs
    const mi = this.inst.mesh.morphTargetInfluences;
    for (const k in this.inst.morph) mi[this.inst.morph[k]] = this.morphW[k] || 0;
  }
  rot(n, x = 0, y = 0, z = 0) { const p = this.P[n]; if (!p) return; p.x += x; p.y += y; p.z += z; }
  mov(n, x = 0, y = 0, z = 0) { const p = this.P[n]; if (!p) return; p.px += x; p.py += y; p.pz += z; }
  // look: compute yaw/pitch toward lookTarget from head position in root space
  updateLook(dt) {
    let ty = 0, tp = 0, tw = 0;
    if (this.lookTarget) {
      this.root.updateMatrixWorld();
      _v.copy(this.lookTarget);
      this.root.worldToLocal(_v);
      const hp = this.headPos || [0, 0.3, 0.2];
      const dx = _v.x - hp[0], dy = _v.y - hp[1], dz = _v.z - hp[2];
      ty = clamp(Math.atan2(dx, Math.max(0.05, dz)), -1.0, 1.0);
      tp = clamp(-Math.atan2(dy, Math.hypot(dx, dz)), -0.8, 0.7);
      tw = 1;
    }
    const r = 6;
    this.look.yaw = damp(this.look.yaw, ty, r, dt);
    this.look.pitch = damp(this.look.pitch, tp, r, dt);
    this.look.w = damp(this.look.w, tw, 4, dt);
  }
  mouthWorld(out) { return this.mouth.getWorldPosition(out); }
  // two-joint-free reach: rotate arm so the paw points at T, stretch a little if needed
  reach(armName, pawName, T, w) {
    if (w < 0.001) return;
    const arm = this.bones[armName], paw = this.bones[pawName];
    arm.updateMatrixWorld(true);
    const S = arm.getWorldPosition(_v), P = paw.getWorldPosition(_v2);
    const dP = P.clone().sub(S), dT = T.clone().sub(S);
    const lp = dP.length(), lt = dT.length();
    if (lp < 1e-5 || lt < 1e-5) return;
    _q.setFromUnitVectors(dP.normalize(), dT.clone().normalize());
    const pq = arm.parent.getWorldQuaternion(new THREE.Quaternion());
    const local = pq.clone().invert().multiply(_q).multiply(pq).multiply(arm.quaternion);
    arm.quaternion.slerp(local, w);
    if (lt > lp) {
      const off = dT.normalize().multiplyScalar((lt - lp) * w).applyQuaternion(pq.clone().invert());
      const sc = arm.parent.getWorldScale(new THREE.Vector3());
      arm.position.add(off.divide(sc));
    }
    arm.updateMatrixWorld(true);
  }
}

export function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function bump01(b) { return b > 0.5 ? (1 - b) * 2 : b * 2; }
