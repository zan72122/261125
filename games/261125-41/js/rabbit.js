// Holland lop rabbit: sculpt + behaviour (spring-simulated lop ears)
import * as THREE from 'three';
import { E, C, G, buildCreature, instantiate, makeEye, surfacePoint, orientZ, attachAt } from './sculpt.js';
import { Animal, angDiff } from './creature.js';
import { smooth, clamp, lerp, bump, rng } from './util.js';
import * as SFX from './audio.js';

const X = (x, m) => (m ? -x : x);
let BUILT = null;
const sq = (v) => v * v;
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }

const BONES = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 0.3, -0.15] },
  { name: 'spine', parent: 'hips', pos: [0, 0.36, 0.06] },
  { name: 'neck', parent: 'spine', pos: [0, 0.47, 0.16] },
  { name: 'head', parent: 'neck', pos: [0, 0.56, 0.25] },
  { name: 'jaw', parent: 'head', pos: [0, 0.48, 0.36] },
  { name: 'nose', parent: 'head', pos: [0, 0.54, 0.44] },
  { name: 'cheekL', parent: 'head', pos: [0.07, 0.5, 0.39] },
  { name: 'cheekR', parent: 'head', pos: [-0.07, 0.5, 0.39] },
  { name: 'earRootL', parent: 'head', pos: [0.15, 0.69, 0.25] },
  { name: 'earMidL', parent: 'earRootL', pos: [0.235, 0.6, 0.27] },
  { name: 'earTipL', parent: 'earMidL', pos: [0.255, 0.47, 0.28] },
  { name: 'earRootR', parent: 'head', pos: [-0.15, 0.69, 0.25] },
  { name: 'earMidR', parent: 'earRootR', pos: [-0.235, 0.6, 0.27] },
  { name: 'earTipR', parent: 'earMidR', pos: [-0.255, 0.47, 0.28] },
  { name: 'armL', parent: 'spine', pos: [0.1, 0.22, 0.17] },
  { name: 'pawL', parent: 'armL', pos: [0.1, 0.05, 0.235] },
  { name: 'armR', parent: 'spine', pos: [-0.1, 0.22, 0.17] },
  { name: 'pawR', parent: 'armR', pos: [-0.1, 0.05, 0.235] },
  { name: 'legL', parent: 'hips', pos: [0.17, 0.27, -0.2] },
  { name: 'footL', parent: 'legL', pos: [0.17, 0.05, -0.12] },
  { name: 'legR', parent: 'hips', pos: [-0.17, 0.27, -0.2] },
  { name: 'footR', parent: 'legR', pos: [-0.17, 0.05, -0.12] },
  { name: 'tail', parent: 'hips', pos: [0, 0.24, -0.44] },
];
const EYE_O = [0, 0.585, 0.29];
const EYE_DIR = (m) => new THREE.Vector3(X(0.78, m), 0.22, 0.58).normalize().toArray();

function prims() {
  const P = [
    E([0, 0.3, -0.16], [0.29, 0.285, 0.31], { bones: (x, y, z) => { const t = clamp((z + 0.15) / 0.3, 0, 1); return [['hips', 1 - t], ['spine', t]]; }, k: 0.1, tag: 'body', s: 0.05 }),
    E([0, 0.3, 0.085], [0.24, 0.27, 0.2], { bone: 'spine', k: 0.12, tag: 'body', s: 0.05 }),
    E([0, 0.47, 0.17], [0.165, 0.14, 0.14], { bone: 'neck', k: 0.1, tag: 'body', s: 0.04 }),
    E([0, 0.565, 0.285], [0.198, 0.178, 0.18], { bone: 'head', k: 0.1, tag: 'head', s: 0.04 }),
    E([0, 0.535, 0.425], [0.06, 0.05, 0.05], { bone: 'nose', k: 0.05, tag: 'muzzle', s: 0.015 }),
    E([0, 0.47, 0.39], [0.05, 0.035, 0.05], { bone: 'jaw', k: 0.05, tag: 'chin', s: 0.02 }),
    E([0, 0.685, 0.24], [0.13, 0.055, 0.085], { bone: 'head', k: 0.06, tag: 'crown', s: 0.03 }),
    E([0, 0.24, -0.45], [0.065, 0.065, 0.055], { bone: 'tail', k: 0.04, tag: 'tail', s: 0.02 }),
  ];
  for (const m of [false, true]) {
    const s = m ? 'R' : 'L';
    P.push(E([X(0.065, m), 0.505, 0.385], [0.078, 0.07, 0.07], { bone: 'cheek' + s, k: 0.06, tag: 'muzzle', s: 0.025 }));
    P.push(C([X(0.1, m), 0.22, 0.17], [X(0.1, m), 0.07, 0.22], 0.05, 0.04, { bone: 'arm' + s, k: 0.05, tag: 'arm', s: 0.025 }));
    P.push(E([X(0.1, m), 0.03, 0.255], [0.04, 0.028, 0.056], { bone: 'paw' + s, k: 0.03, tag: 'paw', s: 0.015 }));
    P.push(E([X(0.16, m), 0.24, -0.19], [0.13, 0.17, 0.19], { bone: 'leg' + s, k: 0.08, tag: 'body', s: 0.035 }));
    P.push(E([X(0.17, m), 0.04, -0.03], [0.06, 0.04, 0.16], { bone: 'foot' + s, k: 0.05, tag: 'foot', s: 0.02 }));
  }
  for (const m of [false, true]) {
    const s = m ? 'R' : 'L';
    const ear = [];
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const u = i / (segs - 1);
      // path from crown down the side of the head
      const x = 0.17 + 0.075 * Math.sin(Math.min(1, u * 2.2) * Math.PI / 2) + 0.012 * u;
      const y = 0.68 - u * 0.33;
      const z = 0.25 + 0.035 * u;
      const w = 0.055 + 0.05 * Math.sin(Math.min(1, u * 1.4) * Math.PI / 2) - 0.012 * Math.pow(u, 3);
      const th = 0.03 - 0.008 * u;
      const bone = u < 0.28 ? 'earRoot' + s : u < 0.62 ? 'earMid' + s : 'earTip' + s;
      ear.push(E([X(x, m), y, z], [th, 0.06, w], { rot: [0.06, 0, X(u < 0.2 ? 0.9 - u * 3 : 0.1, m)], bone, k: 0.07, tag: u > 0.75 ? 'earTip' : 'ear', s: u < 0.3 ? 0.012 : 0.02 }));
    }
    P.push(G(ear, { k: 0.035 }));
  }
  return P;
}

function build() {
  if (BUILT) return BUILT;
  const eyes = [];
  const def = {
    prims: prims(), bones: BONES, h: 0.0125,
    bounds: [[-0.36, -0.03, -0.56], [0.36, 0.78, 0.52]],
    pre(f) { for (const m of [false, true]) eyes.push(surfacePoint(f, EYE_O, EYE_DIR(m))); },
    color(p, n, tw) {
      const fawn = [0.86, 0.66, 0.44], deep = [0.72, 0.5, 0.3], cream = [0.96, 0.92, 0.85];
      let c = fawn.slice();
      c = mix3(c, deep, smooth((n.y - 0.3) / 0.6) * smooth((p.y - 0.4) / 0.3) * 0.35);
      let w = smooth((0.2 - p.y) / 0.12) + smooth((-n.y - 0.1) / 0.5) * 0.8;
      // white blaze on muzzle + chin + chest front
      w += tw('muzzle') * smooth((n.z - 0.1) / 0.4) * 0.85 + tw('chin');
      w += smooth((p.z - 0.17) / 0.08) * smooth((0.42 - p.y) / 0.1) * smooth((n.z - 0.2) / 0.4) * 0.9;
      w += Math.exp(-(sq(p.x / 0.035) + sq((p.y - 0.6) / 0.1))) * smooth((p.z - 0.4) / 0.04) * 0.7;
      w += tw('paw') * 0.7 + tw('tail') * smooth((-n.z - 0.1) / 0.3);
      c = mix3(c, cream, clamp(w, 0, 1));
      // eye ring lighter
      for (const e of eyes) { const d = Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2]); c = mix3(c, [0.93, 0.8, 0.62], Math.exp(-sq(d / 0.055)) * 0.2); }
      // ears: darker edges + pinkish inside
      const ear = tw('ear') + tw('earTip');
      if (ear > 0.01) {
        const inner = smooth((-(n.x * Math.sign(p.x)) - 0.2) / 0.4);
        c = mix3(c, mix3(deep, [0.62, 0.44, 0.3], tw('earTip')), ear * 0.7);
        c = mix3(c, [0.88, 0.7, 0.62], ear * inner * 0.6);
      }
      return c;
    },
    fur(p, n, tw) {
      let f = 1 - tw('ear') * 0.45 - tw('earTip') * 0.45 - tw('muzzle') * 0.35 - tw('paw') * 0.4 + tw('tail') * 0.4 - tw('foot') * 0.3;
      for (const e of eyes) { const d = Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2]); f *= smooth((d - 0.027) / 0.011); }
      const nd = Math.hypot(p.x, p.y - 0.54, p.z - 0.47); f *= smooth((nd - 0.02) / 0.03);
      return clamp(f, 0, 1.4);
    },
    morphs: [
      { name: 'belly', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.3) + sq((p.y - 0.2) / 0.2) + sq((p.z + 0.05) / 0.3))) * smooth((0.4 - n.y) / 0.7); return [n.x * w * 0.04, n.y * w * 0.02 - w * 0.004, n.z * w * 0.03]; } },
      { name: 'breath', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.3) + sq((p.y - 0.33) / 0.22) + sq((p.z + 0.05) / 0.3))); return [n.x * w * 0.01, n.y * w * 0.012, n.z * w * 0.006]; } },
    ],
  };
  BUILT = buildCreature(def);
  BUILT.eyes = eyes;
  return BUILT;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();

export class Rabbit extends Animal {
  constructor({ shells = 5 } = {}) {
    const built = build();
    const inst = instantiate(built, { shells, furLength: 0.026, scale: 7, comb: [0, -0.4, -0.9], sheen: 0.25, tipLight: 0.2 });
    super(inst, built);
    this.kind = 'rabbit';
    this.headPos = [0, 0.57, 0.3];
    this.addParts();
    this.state = 'idle';
    this.eatenCarrots = 0; this.eatenLeaf = 0;
    this.visit = 0;
    this.breathPeriod = 1.4;
    this.stroke = 0;
    this.earSide = 1;
    this.floorY = 0;
    this.initEars();
  }
  addParts() {
    const b = this.built, inst = this.inst;
    const lidCol = new THREE.Color().setRGB(0.8, 0.6, 0.4, THREE.SRGBColorSpace);
    b.eyes.forEach((e, i) => {
      const m = i === 1; const d = EYE_DIR(m);
      const eye = makeEye(0.036, lidCol, 0x140c08);
      attachAt(inst, 'head', eye.group, [e[0] - d[0] * 0.016, e[1] - d[1] * 0.016, e[2] - d[2] * 0.016], b);
      orientZ(eye.group, d);
      this.eyes.push(eye);
    });
    // nose: soft pink with Y split
    const np = surfacePoint(b.sdf, [0, 0.545, 0.4], [0, 0.25, 1]);
    const noseMat = new THREE.MeshPhysicalMaterial({ color: 0xc98b84, roughness: 0.45, clearcoat: 0.4 });
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.017, 14, 10), noseMat);
    nose.scale.set(1.3, 0.75, 0.6);
    attachAt(inst, 'nose', nose, [np[0], np[1] - 0.004, np[2] - 0.004], b);
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5a3a30, transparent: true, opacity: 0.6 });
    const yl = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, np[1] - 0.01, np[2] + 0.002), new THREE.Vector3(0, np[1] - 0.03, np[2] - 0.004),
      new THREE.Vector3(0, np[1] - 0.03, np[2] - 0.004), new THREE.Vector3(0.016, np[1] - 0.042, np[2] - 0.012),
      new THREE.Vector3(0, np[1] - 0.03, np[2] - 0.004), new THREE.Vector3(-0.016, np[1] - 0.042, np[2] - 0.012),
    ]);
    attachAt(inst, 'nose', new THREE.LineSegments(yl, lineMat), [0, 0, 0], b);
    // whiskers
    const w = []; const rr = rng(9);
    for (const s of [1, -1]) for (let i = 0; i < 6; i++) {
      const base = surfacePoint(b.sdf, [s * 0.04, 0.505 + (i % 3) * 0.01, 0.4], [s * 0.7, 0.1, 0.7]);
      let px = base[0], py = base[1], pz = base[2];
      const ang = -0.3 + i * 0.13 + (rr() - 0.5) * 0.1, len = 0.2 + rr() * 0.08;
      let dx = s * Math.cos(ang), dy = Math.sin(ang) * 0.6, dz = 0.2;
      for (let k = 0; k < 4; k++) { const nx = px + dx * len / 4, ny = py + dy * len / 4 - k * 0.004, nz = pz + dz * len / 4; w.push(px, py, pz, nx, ny, nz); px = nx; py = ny; pz = nz; dz -= 0.15; }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(w, 3));
    attachAt(inst, 'cheekL', new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf6f0e6, transparent: true, opacity: 0.3 })), [0, 0, 0], b);
    // claws
    const clawMat = new THREE.MeshStandardMaterial({ color: 0x8a7a6a, roughness: 0.4 });
    const cg = new THREE.ConeGeometry(0.006, 0.02, 6); cg.rotateX(Math.PI / 2);
    for (const m of [false, true]) for (let i = 0; i < 4; i++) {
      const c = new THREE.Mesh(cg, clawMat);
      attachAt(inst, m ? 'pawR' : 'pawL', c, [X(0.1 + (i - 1.5) * 0.016, m), 0.012, 0.31], b);
      c.rotation.x = 0.4;
    }
    this.mouth = new THREE.Object3D();
    attachAt(inst, 'head', this.mouth, [0, 0.48, 0.43], b);
    this.holdAnchor = new THREE.Object3D();
    attachAt(inst, 'head', this.holdAnchor, [0, 0.475, 0.435], b);
    this.holdAnchor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-0.6, 0.45, -0.66).normalize()); // +y points into mouth; food extends forward-right-down
    this.proxHead = new THREE.Mesh(new THREE.SphereGeometry(0.24, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'head', this.proxHead, [0, 0.58, 0.3], b);
    this.proxBack = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'hips', this.proxBack, [0, 0.33, -0.12], b);
    this.proxHead.userData.part = 'head'; this.proxBack.userData.part = 'back';
  }
  // ---- ear spring sim ----
  initEars() {
    this.ears = {};
    for (const s of ['L', 'R']) {
      const root = this.bones['earRoot' + s], mid = this.bones['earMid' + s], tip = this.bones['earTip' + s];
      const endLocal = new THREE.Vector3(0.008 * (s === 'L' ? 1 : -1), -0.12, 0.005);
      const e = { root, mid, tip, endLocal, pts: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], prev: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], len: [], restDir: [], init: false };
      e.restDir = [mid.position.clone().normalize(), tip.position.clone().normalize(), endLocal.clone().normalize()];
      e.len = [mid.position.length(), tip.position.length(), endLocal.length()];
      this.ears[s] = e;
    }
  }
  post(dt) {
    this.root.updateMatrixWorld(true);
    const headC = new THREE.Vector3(0, 0.58, 0.29); this.bones.head.parent && this.inst.mesh.localToWorld(headC);
    const hc = this.bones.head.localToWorld(new THREE.Vector3(0, 0.0, 0.03));
    const bodyC = this.bones.spine.localToWorld(new THREE.Vector3(0, -0.04, -0.05));
    const sdt = Math.min(dt, 1 / 30);
    for (const s of ['L', 'R']) {
      const e = this.ears[s];
      const stiff = Math.max(this.g('earStiff' + s) || 0, this.g('lie'));
      const k = lerp(30, 260, stiff);
      // target positions from posed chain
      const tgt = [e.mid.getWorldPosition(_a).clone(), e.tip.getWorldPosition(_a).clone(), e.tip.localToWorld(e.endLocal.clone())];
      const anchor = e.root.getWorldPosition(new THREE.Vector3());
      if (!e.init || this.earReset) { for (let i = 0; i < 3; i++) { e.pts[i].copy(tgt[i]); e.prev[i].copy(tgt[i]); } e.init = true; }
      for (let i = 0; i < 3; i++) {
        const p = e.pts[i], pv = e.prev[i];
        const vx = (p.x - pv.x) * 0.9, vy = (p.y - pv.y) * 0.9, vz = (p.z - pv.z) * 0.9;
        pv.copy(p);
        p.x += vx + (tgt[i].x - p.x) * k * sdt * sdt;
        p.y += vy + (tgt[i].y - p.y) * k * sdt * sdt - 3.5 * sdt * sdt * (1 - stiff);
        p.z += vz + (tgt[i].z - p.z) * k * sdt * sdt;
      }
      // constraints
      for (let it = 0; it < 3; it++) {
        let prevP = anchor;
        for (let i = 0; i < 3; i++) {
          const p = e.pts[i];
          _b.subVectors(p, prevP); const l = _b.length() || 1e-6;
          p.copy(prevP).addScaledVector(_b, e.len[i] / l);
          // head collision
          _c.subVectors(p, hc); const dh = _c.length(); const rh = 0.2;
          if (dh < rh) p.copy(hc).addScaledVector(_c, rh / dh);
          _c.subVectors(p, bodyC); const db = _c.length(); const rb = 0.25;
          if (db < rb) p.copy(bodyC).addScaledVector(_c, rb / db);
          if (p.y < this.floorY + 0.012) p.y = this.floorY + 0.012;
          prevP = p;
        }
      }
      // write bone rotations
      const chain = [e.root, e.mid, e.tip];
      let from = anchor;
      for (let i = 0; i < 3; i++) {
        const bone = chain[i];
        bone.parent.getWorldQuaternion(_q).invert();
        _b.subVectors(e.pts[i], from).normalize().applyQuaternion(_q);
        bone.quaternion.setFromUnitVectors(e.restDir[i], _b);
        bone.updateMatrixWorld(true);
        from = e.pts[i];
      }
    }
    this.earReset = false;
  }

  setRoom(room) {
    this.room = room; this.homeSpot = room.spots.home;
    this.root.position.set(this.homeSpot[0], 0, this.homeSpot[1]);
    this.floorY = 0;
  }
  get foodsLeft() { return this.room.foods.filter((f) => f.state !== 'gone' && f.state !== 'eating').length; }
  accepting() { return this.state === 'idle'; }
  enter() {
    this.visit++;
    this.earSide = this.visit % 2 ? 1 : -1;
    if (this.state === 'idle') this.play(this.idleLoop());
  }

  pose(dt) {
    const t = this.time, g = (n) => this.g(n);
    const lie = g('lie');
    const alive = 1 - lie;
    const bp = this.asleep ? 2.5 : this.breathPeriod;
    this.breathPh = (this.breathPh || 0) + dt / bp * Math.PI * 2;
    const br = Math.sin(this.breathPh);
    this.morphW.breath = 0.5 + 0.5 * br;
    this.morphW.belly = g('belly');
    // idle drift
    this.rot('head', 0.03 * Math.sin(t * 0.5) * alive, 0.08 * Math.sin(t * 0.37) * alive, 0.03 * Math.sin(t * 0.29) * alive);
    const lw = this.look.w * alive;
    this.rot('head', this.look.pitch * 0.55 * lw, this.look.yaw * 0.5 * lw, 0);
    this.rot('neck', this.look.pitch * 0.3 * lw, this.look.yaw * 0.35 * lw, 0);
    // nose twitch (always a little when awake)
    const tw = (0.35 + g('twitch')) * alive;
    const nz = Math.sin(t * 52) * (0.5 + 0.5 * Math.sin(t * 3.1));
    this.mov('nose', 0, 0.004 * nz * tw, 0.0015 * nz * tw);
    this.mov('cheekL', 0, 0.0015 * nz * tw, 0); this.mov('cheekR', 0, 0.0015 * nz * tw, 0);
    // chewing ~4/s: jaw, nose and cheeks move together
    const chew = g('chew');
    if (chew > 0.001) {
      const cp = t * Math.PI * 2 * 4.2;
      const s = Math.sin(cp), c2 = Math.cos(cp);
      this.rot('jaw', (0.1 + 0.08 * s) * chew, 0.06 * c2 * chew, 0);
      this.mov('cheekL', 0.004 * c2 * chew, 0.004 * s * chew, 0); this.mov('cheekR', 0.004 * c2 * chew, 0.004 * s * chew, 0);
      this.mov('nose', 0, 0.004 * s * chew, 0);
      this.rot('head', 0.015 * s * chew, 0, 0);
    }
    this.rot('jaw', 0.35 * g('jaw') + 0.55 * g('yawn'), 0, 0);
    // head tilt
    this.rot('head', 0, 0, 0.3 * g('tilt'));
    // lean forward (hunger) with a paw step
    const lean = g('lean');
    this.rot('hips', 0.06 * lean, 0, 0); this.rot('spine', 0.1 * lean, 0, 0); this.rot('neck', 0.15 * lean, 0, 0); this.rot('head', -0.15 * lean, 0, 0);
    this.mov('spine', 0, -0.01 * lean, 0.03 * lean);
    this.rot('armL', -0.35 * g('stepL'), 0, 0); this.rot('pawL', 0.25 * g('stepL'), 0, 0);
    // reach down to eat from mouth level (bite forward)
    const bite = g('bite');
    this.rot('neck', 0.1 * bite, 0, 0); this.mov('head', 0, 0, 0.015 * bite);
    // grooming: lick paw / wash face
    const lick = g('lick'), wash = g('wash');
    if (lick > 0.001) {
      this.rot('armL', -1.25 * lick, 0, -0.35 * lick); this.rot('pawL', -0.6 * lick, 0, 0);
      this.rot('neck', 0.25 * lick, 0, 0); this.rot('head', (0.35 + 0.12 * Math.sin(t * 12)) * lick, 0.25 * lick, 0);
      this.rot('jaw', 0.15 * Math.max(0, Math.sin(t * 12)) * lick, 0, 0);
      this.rot('hips', -0.12 * lick, 0, 0); this.rot('spine', -0.15 * lick, 0, 0);
    }
    if (wash > 0.001) {
      const ph = t * 8;
      this.rot('hips', -0.35 * wash, 0, 0); this.rot('spine', -0.3 * wash, 0, 0); this.mov('hips', 0, 0.02 * wash, -0.03 * wash);
      this.rot('legL', 0.6 * wash, 0, 0); this.rot('legR', 0.6 * wash, 0, 0);
      this.rot('armL', -(1.5 + 0.25 * Math.sin(ph)) * wash, 0, -0.35 * wash); this.rot('armR', -(1.5 + 0.25 * Math.sin(ph)) * wash, 0, 0.35 * wash);
      this.rot('pawL', -0.8 * wash, 0, 0); this.rot('pawR', -0.8 * wash, 0, 0);
      this.rot('head', (0.55 + 0.1 * Math.sin(ph)) * wash, 0, 0);
    }
    // stretch + yawn
    const st = g('stretch');
    this.rot('armL', -1.1 * st, 0, 0.05 * st); this.rot('armR', -1.1 * st, 0, -0.05 * st);
    this.rot('pawL', 1.0 * st, 0, 0); this.rot('pawR', 1.0 * st, 0, 0);
    this.rot('spine', 0.3 * st, 0, 0); this.rot('hips', 0.05 * st, 0, 0); this.rot('neck', -0.1 * st, 0, 0); this.rot('head', -0.4 * g('yawn') - 0.1 * st, 0, 0);
    this.mov('spine', 0, -0.06 * st, 0.06 * st);
    this.rot('legL', -0.25 * st, 0, 0); this.rot('legR', -0.25 * st, 0, 0);
    // content pose: paws together, relaxed
    const cont = g('content');
    this.rot('armL', -0.12 * cont, 0, -0.12 * cont); this.rot('armR', -0.12 * cont, 0, 0.12 * cont);
    this.rot('spine', 0.04 * cont, 0, 0); this.rot('head', 0.08 * cont, 0, 0); this.mov('hips', 0, -0.012 * cont, 0);
    // petting: ears lower, chin dips
    const low = g('lower');
    this.rot('head', 0.22 * low, 0, 0); this.rot('neck', 0.1 * low, 0, 0); this.mov('spine', 0, -0.015 * low, 0);
    this.rot('earRootL', 0.5 * low, 0, -0.3 * low); this.rot('earRootR', 0.5 * low, 0, 0.3 * low);
    // ear lift gesture (one ear raised, then flops)
    const el = g('earLiftL'), er = g('earLiftR');
    this.rot('earRootL', -0.4 * el, 0, 1.6 * el); this.rot('earMidL', 0, 0, 0.4 * el);
    this.rot('earRootR', -0.4 * er, 0, -1.6 * er); this.rot('earMidR', 0, 0, -0.4 * er);
    this.rot('earRootL', 0, 0, 0.35 * g('earTwL') * Math.sin(t * 35)); this.rot('earRootR', 0, 0, -0.35 * g('earTwR') * Math.sin(t * 35));
    // hop gait
    const hop = g('hop');
    if (hop > 0.001) {
      const ph = this.hopPh || 0; // 0..1 within a hop
      const air = Math.sin(ph * Math.PI);
      this.rot('legL', (-0.6 * air + 0.3) * hop, 0, 0); this.rot('legR', (-0.6 * air + 0.3) * hop, 0, 0);
      this.rot('footL', 0.8 * air * hop, 0, 0); this.rot('footR', 0.8 * air * hop, 0, 0);
      this.rot('armL', (-0.7 * air + 0.2 * (1 - air)) * hop, 0, 0); this.rot('armR', (-0.7 * air + 0.2 * (1 - air)) * hop, 0, 0);
      this.rot('spine', -0.15 * air * hop, 0, 0); this.rot('hips', (-0.25 * air + 0.1) * hop, 0, 0);
      this.rot('head', 0.15 * air * hop, 0, 0);
      // sequential landing: front then hind
      const land = g('land');
      this.rot('armL', -0.3 * land, 0, 0); this.rot('armR', -0.3 * land, 0, 0); this.rot('legL', 0.4 * land, 0, 0); this.rot('legR', 0.4 * land, 0, 0);
    }
    // walk (slow rabbit shuffle)
    const walk = g('walk');
    if (walk > 0.001) {
      const ph = this.gait * Math.PI * 2;
      this.rot('armL', Math.sin(ph) * 0.45 * walk, 0, 0); this.rot('armR', Math.sin(ph + Math.PI) * 0.45 * walk, 0, 0);
      this.rot('legL', Math.sin(ph + 1.5) * 0.3 * walk, 0, 0); this.rot('legR', Math.sin(ph + 1.5) * 0.3 * walk, 0, 0);
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.025 * walk;
      this.rot('spine', Math.sin(ph * 2) * 0.05 * walk, 0, 0);
    }
    // lying on side (sleep)
    if (lie > 0.001) {
      this.rot('armL', -1.25 * lie, 0, 0.1 * lie); this.rot('armR', -1.15 * lie, 0, -0.1 * lie);
      this.rot('pawL', 0.9 * lie, 0, 0); this.rot('pawR', 0.9 * lie, 0, 0);
      this.rot('legL', -0.9 * lie, 0, 0); this.rot('legR', -0.8 * lie, 0, 0);
      this.rot('footL', 0.5 * lie, 0, 0); this.rot('footR', 0.5 * lie, 0, 0);
      this.rot('neck', -0.2 * lie, 0, -0.15 * lie); this.rot('head', -0.05 * lie, 0, -0.25 * lie);
      this.rot('spine', -0.04 * br * lie, 0, 0);
      this.rot('pawL', 0.25 * g('pawTw') * Math.sin(t * 30), 0, 0);
      this.rot('earRootL', 1.45 * lie, 0, -0.15 * lie); this.rot('earRootR', 1.45 * lie, 0, 0.15 * lie);
      this.rot('earMidL', 0.35 * lie, 0, 0); this.rot('earMidR', 0.35 * lie, 0, 0);
    }
    const rk = this.rollK ?? 1;
    this.body.rotation.z = -1.32 * lie * rk;
    this.body.position.x = -0.04 * lie * rk;
    const ly = (rk < 1 ? 0.3 * (Math.cos(1.32 * rk) - 1) + 0.255 * Math.sin(1.32 * rk) / Math.sin(1.32) * 0.75 + 0.02 : 0.255) * lie;
    this.rot('head', 0.15 * g('headUp'), 0, 0.55 * g('headUp')); this.rot('neck', 0, 0, 0.3 * g('headUp'));
    if (walk < 0.001) this.body.position.y = 0;
    this.body.position.y += ly + g('lift');
    this.body.rotation.y = g('twist');
    this.body.rotation.x = g('pitchBody');
  }

  resetGestures() {
    for (const k of ['lean', 'stepL', 'lick', 'wash', 'stretch', 'yawn', 'tilt', 'jaw', 'twitch', 'bite']) this.set(k, 0, 5);
    for (const k of ['earLiftL', 'earLiftR', 'earStiffL', 'earStiffR']) this.set(k, 0, 25);
    if (!this.asleep) this.set('lid', 0, 5);
  }
  *idleLoop() {
    let last = '';
    yield* this.wait(1.0);
    for (;;) {
      const opts = ['ear', 'groom', 'stretch', 'sniff', 'hunger', 'hunger'].filter((o) => o !== last);
      if (this.foodsLeft === 0) opts.splice(opts.indexOf('hunger'), 1);
      const pick = opts[Math.floor(Math.random() * opts.length)]; last = pick;
      if (pick === 'ear') yield* this.gEar();
      else if (pick === 'groom') yield* this.gGroom();
      else if (pick === 'stretch') yield* this.gStretch();
      else if (pick === 'sniff') yield* this.gSniff();
      else yield* this.gHunger();
      this.resetGestures();
      yield* this.wait(1.4 + Math.random() * 2.4);
    }
  }
  *gEar() {
    const s = this.earSide > 0 ? 'L' : 'R';
    this.earSide *= -1;
    this.set('earStiff' + s, 1, 10); this.set('earLift' + s, 1, 5); this.set('tilt', s === 'L' ? -0.25 : 0.25, 4);
    yield* this.wait(0.8);
    // release: flops down by gravity
    this.set('earStiff' + s, 0, 30); this.set('earLift' + s, 0, 30); this.set('tilt', 0, 3);
    yield* this.wait(1.2);
  }
  *gGroom() {
    this.set('lick', 1, 5); yield* this.wait(1.1);
    this.set('lick', 0, 5); this.set('wash', 1, 5); this.set('lid', 0.6, 5); SFX.furRub();
    yield* this.wait(1.1); SFX.furRub();
    this.set('wash', 0, 4); this.set('lid', 0, 4);
    yield* this.wait(0.4);
  }
  *gStretch() {
    this.set('stretch', 1, 3); yield* this.wait(0.9);
    this.set('yawn', 1, 5); this.set('lid', 0.9, 5); yield* this.wait(0.9);
    this.set('yawn', 0, 5); this.set('lid', 0, 4); this.set('stretch', 0, 3); this.set('content', 0.6, 3);
    yield* this.wait(1.1); this.set('content', 0, 2);
  }
  *gSniff() {
    this.set('twitch', 1.5, 8); SFX.snuffle(0.4);
    this.set('tilt', 0.3, 4); yield* this.wait(0.6); this.set('tilt', -0.25, 4); yield* this.wait(0.6); this.set('tilt', 0, 4);
    yield* this.wait(0.3); this.set('twitch', 0, 3);
  }
  *gHunger() {
    this.lookTarget = this.room.spots.emptyDishW; this.set('twitch', 1, 5);
    yield* this.wait(0.9);
    this.lookTarget = this.room.spots.foodDishW; this.set('lean', 1, 4); this.set('stepL', 1, 5); SFX.snuffle(0.4);
    yield* this.wait(1.3);
    this.lookTarget = null; this.set('lean', 0, 3); this.set('stepL', 0, 3); this.set('twitch', 0, 3);
  }
  setTracking(pos) { this.lookTarget = pos; if (pos && this.state === 'idle') { this.set('twitch', 1.3, 6); this.set('lean', 0.4, 4); } }
  tryReceive(food) {
    if (!this.accepting()) return false;
    this.state = 'eating'; this.resetGestures(); this.lookTarget = null;
    this.play(food.type === 'carrot' ? this.eatCarrot(food) : this.eatLeaf(food));
    return true;
  }
  *grab(food, dur = 0.3) {
    this.holdAnchor.attach(food.obj);
    const p0 = food.obj.position.clone(), q0 = food.obj.quaternion.clone();
    yield* this.tween(dur, (u) => { const e = smooth(u); food.obj.position.lerpVectors(p0, food.holdPos(), e); food.obj.quaternion.slerpQuaternions(q0, food.holdQuat(), e); });
  }
  *eatCarrot(food) {
    food.state = 'eating';
    this.set('bite', 1, 8);
    yield* this.grab(food, 0.32);
    SFX.snuffle(0.3);
    for (let i = 0; i < 5; i++) {
      // bite: jaw opens, carrot fed toward mouth, crisp snap
      this.set('chew', 0, 30); this.set('jaw', 1, 30); this.set('bite', 1.4, 12);
      const c0 = food.cut, c1 = (i + 1) * 0.2;
      yield* this.tween(0.14, (u) => { food.setCut(lerp(c0, c1, smooth(u))); food.obj.position.copy(food.holdPos()); });
      this.set('jaw', 0, 30); SFX.carrot();
      // pull back a little so the cut face shows, chew ~4/s
      this.set('bite', 0.6, 8); this.set('chew', 1, 20);
      if (i < 4) {
        yield* this.tween(0.41, (u) => { food.obj.position.copy(food.holdPos()).add(_a.set(0, -0.028 * bump(u), 0)); });
      }
      this.belly(0.06);
    }
    food.done();
    this.eatenCarrots++;
    yield* this.chewOff();
  }
  *eatLeaf(food) {
    food.state = 'eating';
    this.set('bite', 1, 8);
    yield* this.grab(food, 0.3);
    for (let i = 0; i < 4; i++) {
      this.set('chew', 0, 30); this.set('jaw', 1, 30);
      yield* this.wait(0.08);
      food.setStage(i + 1);
      food.obj.position.copy(food.holdPos());
      this.set('jaw', 0, 30); SFX.leaf();
      this.set('chew', 1, 20);
      yield* this.tween(0.32, (u) => { food.tremble = 1 - u; food.obj.position.copy(food.holdPos()); });
      this.belly(0.05);
    }
    food.done();
    this.eatenLeaf++;
    yield* this.chewOff();
  }
  belly(d) { this.set('belly', Math.min(1, (this.tg.belly || 0) + d), 2); }
  *chewOff() {
    this.set('bite', 0, 4);
    SFX.snuffle(0.35);
    yield* this.wait(0.7);
    this.set('chew', 0, 4);
    if (this.eatenCarrots >= 2 && this.eatenLeaf >= 1) { yield* this.finale(); return; }
    this.state = 'idle';
    yield* this.idleLoop();
  }
  *finale() {
    this.state = 'full';
    this.set('belly', 1, 1.5);
    this.set('content', 1, 2); this.set('lid', 0.55, 2);
    SFX.happy();
    yield* this.wait(1.4);
    this.set('content', 0, 3); this.set('lid', 0, 3);
    const s = this.room.spots;
    // move to straw-free floor
    yield* this.walkTo(s.hop0[0], s.hop0[1], 0.4, 3);
    yield* this.turnTo(s.hopYaw, 5);
    // two small hops, second is a binky (~3s)
    yield* this.hopTo(s.hop1, 0.18, 0.55, 0);
    yield* this.wait(0.25);
    yield* this.hopTo(s.hop2, 0.38, 0.8, 1);
    yield* this.wait(0.6);
    this.set('content', 0.6, 2);
    yield* this.wait(0.6);
    yield* this.goSleep();
  }
  *hopTo(to, height, dur, binky) {
    const p0 = this.root.position.clone();
    this.set('hop', 1, 12);
    // crouch
    yield* this.tween(0.15, (u) => { this.now('lift', -0.03 * smooth(u)); this.hopPh = 0; });
    if (binky) SFX.swoosh();
    yield* this.tween(dur, (u) => {
      this.hopPh = u;
      this.root.position.x = lerp(p0.x, to[0], u); this.root.position.z = lerp(p0.z, to[1], u);
      this.now('lift', Math.sin(u * Math.PI) * height - 0.03 * (1 - u));
      if (binky) {
        // mid-air twist ~25deg and body kick
        this.now('twist', Math.sin(u * Math.PI) * 0.44);
        this.now('pitchBody', -Math.sin(u * Math.PI * 2) * 0.12);
        this.rot && 0;
      }
    });
    this.now('twist', 0); this.now('pitchBody', 0);
    // sequential landing: front paws, then hind
    SFX.thump(0.35);
    this.set('land', 1, 25);
    yield* this.wait(0.09);
    SFX.thump(0.25);
    this.set('land', 0, 8);
    yield* this.tween(0.15, (u) => this.now('lift', -0.02 * bump(u)));
    this.set('hop', 0, 6);
  }
  *goSleep() {
    this.state = 'toBed';
    const s = this.room.spots;
    yield* this.walkTo(s.bed[0], s.bed[1], 0.38, 3);
    yield* this.turnTo(s.bedYaw, 4);
    SFX.rustle('straw', 0.7);
    this.set('lid', 0.6, 2);
    yield* this.wait(0.4);
    this.set('lie', 1, 1.6);
    yield* this.wait(1.0);
    SFX.rustle('straw', 0.4);
    this.set('lid', 1, 1.5);
    yield* this.wait(0.8);
    this.fallAsleep();
    yield* this.sleepLoop();
  }
  fallAsleep() { this.asleep = true; this.state = 'sleep'; this.now('lid', 1); this.onSleep && this.onSleep(); }
  *sleepLoop() {
    for (;;) {
      yield* this.wait(3.5 + Math.random() * 4);
      if (Math.random() < 0.5) { this.set('pawTw', 1, 20); yield* this.wait(0.25); this.set('pawTw', 0, 8); }
      else { const k = Math.random() < 0.5 ? 'earTwL' : 'earTwR'; this.set(k, 0.4, 20); yield* this.wait(0.15); this.set(k, 0, 8); }
    }
  }
  sleepNow(pos, yaw) {
    this.resetGestures(); this.main = null; this.layers = [];
    this.state = 'sleep'; this.asleep = true;
    if (pos) this.root.position.set(pos[0], pos[1] || 0, pos[2]);
    else this.root.position.set(this.room.spots.bed[0], 0, this.room.spots.bed[1]);
    this.yaw = yaw ?? this.room.spots.bedYaw;
    this.now('lie', 1); this.now('lid', 1); this.now('belly', 1); this.now('content', 0);
    this.earReset = true;
    this.play(this.sleepLoop());
  }
  wakeForReplay() {
    this.asleep = false; this.main = null; this.layers = [];
    this.state = 'busy'; this.eatenCarrots = 0; this.eatenLeaf = 0;
    this.play(this.wakeUp());
  }
  *wakeUp() {
    this.set('lie', 0, 2); this.set('lid', 0, 2); this.set('belly', 0, 0.5);
    yield* this.wait(1.2);
    yield* this.gStretch();
    yield* this.walkTo(this.homeSpot[0], this.homeSpot[1], 0.38, 3);
    yield* this.turnTo(0, 4);
    this.state = 'idle';
    yield* this.idleLoop();
  }
  pet(part, kind) {
    if (this.asleep) { this.layer(this.twitchSmall()); return; }
    if (kind === 'stroke') this.stroke = 0.4;
    else this.layer(this.earTwitch());
  }
  *earTwitch() { const k = Math.random() < 0.5 ? 'earTwL' : 'earTwR'; this.set(k, 1, 25); SFX.snuffle(0.3); yield* this.wait(0.3); this.set(k, 0, 8); }
  *twitchSmall() { this.set('pawTw', 0.7, 20); yield* this.wait(0.15); this.set('pawTw', 0, 8); }
  update(dt) {
    if (this.stroke > 0) {
      this.stroke -= dt; this.set('lower', 1, 4); if (!this.asleep) this.set('lid', 0.55, 5);
      if (this.stroke <= 0) { this.set('lower', 0, 2.5); if (!this.asleep && this.state !== 'full') this.set('lid', 0, 3); }
    }
    super.update(dt);
  }
}
export function buildRabbit() { return build(); }
