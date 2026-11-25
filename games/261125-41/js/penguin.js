// Emperor-penguin-like chick: grey down, white face mask, black cap
import * as THREE from 'three';
import { E, C, G, buildCreature, instantiate, makeEye, surfacePoint, orientZ, attachAt } from './sculpt.js';
import { Animal } from './creature.js';
import { smooth, clamp, lerp, bump, rng } from './util.js';
import * as SFX from './audio.js';

const X = (x, m) => (m ? -x : x);
const sq = (v) => v * v;
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
let BUILT = null;

const BONES = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 0.28, 0] },
  { name: 'spine', parent: 'hips', pos: [0, 0.48, 0] },
  { name: 'chest', parent: 'spine', pos: [0, 0.6, 0.01] },
  { name: 'neck', parent: 'chest', pos: [0, 0.71, 0.02] },
  { name: 'head', parent: 'neck', pos: [0, 0.82, 0.04] },
  { name: 'jaw', parent: 'head', pos: [0, 0.81, 0.17] },
  { name: 'flipL', parent: 'chest', pos: [0.26, 0.64, 0.0] },
  { name: 'flipTipL', parent: 'flipL', pos: [0.33, 0.49, 0.01] },
  { name: 'flipR', parent: 'chest', pos: [-0.26, 0.64, 0.0] },
  { name: 'flipTipR', parent: 'flipR', pos: [-0.33, 0.49, 0.01] },
  { name: 'legL', parent: 'hips', pos: [0.1, 0.14, 0.03] },
  { name: 'footL', parent: 'legL', pos: [0.1, 0.02, 0.06] },
  { name: 'legR', parent: 'hips', pos: [-0.1, 0.14, 0.03] },
  { name: 'footR', parent: 'legR', pos: [-0.1, 0.02, 0.06] },
  { name: 'tail', parent: 'hips', pos: [0, 0.12, -0.25] },
];
const HEAD_C = [0, 0.855, 0.05];
const EYE_DIR = (m) => new THREE.Vector3(X(0.52, m), 0.2, 0.83).normalize().toArray();

function prims() {
  const P = [
    E([0, 0.31, 0.015], [0.305, 0.3, 0.28], { bones: (x, y, z) => { const t = clamp((y - 0.25) / 0.3, 0, 1); return [['hips', 1 - t], ['spine', t]]; }, k: 0.12, tag: 'body', s: 0.06 }),
    E([0, 0.56, 0.0], [0.245, 0.23, 0.23], { bones: (x, y, z) => { const t = clamp((y - 0.5) / 0.15, 0, 1); return [['spine', 1 - t], ['chest', t]]; }, k: 0.14, tag: 'body', s: 0.05 }),
    E([0, 0.71, 0.02], [0.175, 0.12, 0.165], { bone: 'neck', k: 0.12, tag: 'neck', s: 0.04 }),
    E(HEAD_C, [0.182, 0.17, 0.17], { bone: 'head', k: 0.1, tag: 'head', s: 0.04 }),
    E([0, 0.12, -0.255], [0.06, 0.045, 0.05], { bone: 'tail', k: 0.05, tag: 'body', s: 0.02 }),
  ];
  for (const m of [false, true]) {
    const s = m ? 'R' : 'L';
    P.push(E([X(0.1, m), 0.09, 0.05], [0.075, 0.07, 0.075], { bone: 'leg' + s, k: 0.06, tag: 'body', s: 0.03 }));
    P.push(G([
      E([X(0.29, m), 0.57, 0.0], [0.035, 0.09, 0.072], { rot: [0, 0, X(0.32, m)], bone: 'flip' + s, k: 0.04, tag: 'flip', s: 0.03 }),
      E([X(0.335, m), 0.46, 0.01], [0.028, 0.085, 0.058], { rot: [0, 0, X(0.38, m)], bone: 'flipTip' + s, k: 0.05, tag: 'flip', s: 0.03 }),
    ], { k: 0.04 }));
  }
  return P;
}

function build() {
  if (BUILT) return BUILT;
  const eyes = [];
  const def = {
    prims: prims(), bones: BONES, h: 0.0145,
    bounds: [[-0.42, -0.03, -0.36], [0.42, 1.06, 0.4]],
    pre(f) { for (const m of [false, true]) eyes.push(surfacePoint(f, HEAD_C, EYE_DIR(m))); },
    color(p, n, tw) {
      const grey = [0.58, 0.595, 0.62], light = [0.74, 0.75, 0.76], black = [0.11, 0.11, 0.12], white = [0.95, 0.95, 0.94];
      let c = grey.slice();
      // lighter belly
      c = mix3(c, light, smooth((n.z - 0.2) / 0.5) * smooth((0.6 - p.y) / 0.25) * 0.7);
      // darker back
      c = mix3(c, [0.48, 0.5, 0.53], smooth((-n.z - 0.2) / 0.5) * 0.5);
      const headW = smooth((p.y - 0.7) / 0.06);
      if (headW > 0) {
        // face mask: white disc around eyes and cheeks, black cap
        const fx = p.x / 0.175, fy = (p.y - 0.82) / 0.1;
        const mask = smooth((1 - (fx * fx + fy * fy)) / 0.3) * smooth((n.z + 0.25) / 0.35);
        const cap = 1 - mask;
        let hc = mix3(black, white, mask);
        // black stripe down the middle of the forehead to beak
        hc = mix3(hc, black, Math.exp(-sq(p.x / 0.035)) * smooth((p.y - 0.84) / 0.04) * 0.95);
        // throat paler
        c = mix3(c, hc, headW);
        c = mix3(c, [0.82, 0.82, 0.82], smooth((0.79 - p.y) / 0.04) * smooth((p.y - 0.68) / 0.04) * smooth((n.z - 0.3) / 0.4) * 0.6);
      }
      c = mix3(c, [0.42, 0.44, 0.48], tw('flip') * 0.7);
      return c;
    },
    fur(p, n, tw) {
      let f = 1.0 - tw('flip') * 0.15;
      f *= 1 - smooth((p.y - 0.72) / 0.08) * 0.62;
      for (const e of eyes) { const d = Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2]); f *= smooth((d - 0.028) / 0.018); }
      const bd = Math.hypot(p.x, p.y - 0.8, p.z - 0.2); f *= smooth((bd - 0.03) / 0.04);
      return clamp(f, 0, 1.2);
    },
    morphs: [
      { name: 'belly', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.32) + sq((p.y - 0.3) / 0.22) + sq((p.z - 0.08) / 0.3))) * smooth((n.z + 0.3) / 0.6); return [n.x * w * 0.035, n.y * w * 0.01, n.z * w * 0.045]; } },
      { name: 'breath', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.35) + sq((p.y - 0.45) / 0.3) + sq(p.z / 0.3))); return [n.x * w * 0.01, n.y * w * 0.008, n.z * w * 0.01]; } },
      { name: 'throat', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.1) + sq((p.y - 0.72) / 0.06) + sq((p.z - 0.13) / 0.08))); return [n.x * w * 0.03, 0, n.z * w * 0.045 + w * 0.01]; } },
    ],
  };
  BUILT = buildCreature(def);
  BUILT.eyes = eyes;
  return BUILT;
}

export class Penguin extends Animal {
  constructor({ shells = 5 } = {}) {
    const built = build();
    const inst = instantiate(built, { shells, furLength: 0.05, scale: 5, comb: [0, -0.3, -0.4], sheen: 0, tipLight: 0.25, rough: 0.92 });
    super(inst, built);
    this.kind = 'penguin';
    this.headPos = [0, 0.85, 0.06];
    this.addParts();
    this.state = 'idle';
    this.eatenFish = 0; this.eatenShrimp = 0;
    this.visit = 0;
    this.breathPeriod = 1.3;
    this.stroke = 0;
    this.combBase = this.inst.uComb.clone();
    this.groundFn = null;
  }
  addParts() {
    const b = this.built, inst = this.inst;
    const lidCol = new THREE.Color().setRGB(0.9, 0.9, 0.89, THREE.SRGBColorSpace);
    b.eyes.forEach((e, i) => {
      const m = i === 1, d = EYE_DIR(m);
      const eye = makeEye(0.028, lidCol, 0x0a0a0c);
      attachAt(inst, 'head', eye.group, [e[0] - d[0] * 0.012, e[1] - d[1] * 0.012, e[2] - d[2] * 0.012], b);
      orientZ(eye.group, d);
      this.eyes.push(eye);
    });
    // beak: upper on head, lower on jaw
    const beakMat = new THREE.MeshPhysicalMaterial({ color: 0x141416, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.25 });
    const bp = surfacePoint(b.sdf, [0, 0.81, 0.1], [0, 0.0, 1]);
    const up = new THREE.LatheGeometry([0, 0.006, 0.015, 0.022, 0.026].map((r, i) => new THREE.Vector2(r, 0.1 - i * 0.025)), 14);
    up.scale(1, 1, 0.75); up.rotateX(Math.PI / 2); // tip toward +z
    const upper = new THREE.Mesh(up, beakMat); upper.castShadow = true;
    up.translate(0, 0.0, -0.005);
    attachAt(inst, 'head', upper, [bp[0], bp[1] + 0.006, bp[2] - 0.03], b);
    upper.rotation.x = 0.18;
    const lo = new THREE.LatheGeometry([0, 0.005, 0.012, 0.017, 0.02].map((r, i) => new THREE.Vector2(r, 0.085 - i * 0.021)), 12);
    lo.scale(1, 0.6, 1); lo.rotateX(Math.PI / 2);
    const lower = new THREE.Mesh(lo, beakMat);
    attachAt(inst, 'jaw', lower, [bp[0], bp[1] - 0.01, bp[2] - 0.03], b);
    lower.rotation.x = 0.05;
    // feet: dark, three toes
    const footMat = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.55 });
    for (const m of [false, true]) {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(new THREE.SphereGeometry(0.05, 14, 10), footMat); pad.scale.set(1, 0.32, 1.1); g.add(pad);
      for (let i = -1; i <= 1; i++) {
        const toe = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.05, 4, 8), footMat);
        toe.rotation.x = Math.PI / 2; toe.rotation.y = i * 0.45;
        toe.position.set(i * 0.028, -0.004, 0.05 - Math.abs(i) * 0.008); toe.scale.y = 1; g.add(toe);
      }
      g.traverse((o) => { o.castShadow = true; });
      attachAt(inst, m ? 'footR' : 'footL', g, [X(0.1, m), 0.014, 0.1], b);
      g.rotation.y = X(0.25, m);
    }
    this.mouth = new THREE.Object3D();
    attachAt(inst, 'head', this.mouth, [0, 0.81, 0.2], b);
    this.holdAnchor = new THREE.Object3D();
    attachAt(inst, 'head', this.holdAnchor, [0, 0.805, 0.215], b);
    this.holdAnchor.rotation.x = -1.47; // +y points back down the throat
    this.proxHead = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'head', this.proxHead, [0, 0.85, 0.06], b);
    this.proxBack = new THREE.Mesh(new THREE.SphereGeometry(0.33, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'spine', this.proxBack, [0, 0.45, -0.02], b);
    this.proxHead.userData.part = 'head'; this.proxBack.userData.part = 'back';
  }
  setRoom(room) { this.room = room; this.homeSpot = room.spots.home; this.root.position.set(this.homeSpot[0], 0, this.homeSpot[1]); this.groundFn = room.groundY; }
  get foodsLeft() { return this.room.foods.filter((f) => f.state !== 'gone' && f.state !== 'eating').length; }
  accepting() { return this.state === 'idle'; }
  enter() { this.visit++; if (this.state === 'idle') this.play(this.idleLoop()); }

  pose(dt) {
    const t = this.time, g = (n) => this.g(n);
    const lie = g('lie');
    const alive = 1 - lie;
    const bp = this.asleep ? 2.0 : this.breathPeriod;
    this.breathPh = (this.breathPh || 0) + dt / bp * Math.PI * 2;
    const br = Math.sin(this.breathPh);
    this.morphW.breath = 0.5 + 0.5 * br;
    this.morphW.belly = g('belly');
    this.morphW.throat = g('throat');
    // idle drift
    this.rot('head', 0.04 * Math.sin(t * 0.6) * alive, 0.12 * Math.sin(t * 0.43) * alive, 0.05 * Math.sin(t * 0.31) * alive);
    const lw = this.look.w * alive;
    this.rot('head', this.look.pitch * 0.6 * lw, this.look.yaw * 0.55 * lw, 0);
    this.rot('neck', this.look.pitch * 0.25 * lw, this.look.yaw * 0.35 * lw, 0);
    // flippers rest slightly away from body; balance spread
    const spread = g('spread') + 0.04;
    this.rot('flipL', 0, 0, 0.45 * spread); this.rot('flipR', 0, 0, -0.45 * spread);
    this.rot('flipTipL', 0, 0, 0.25 * spread); this.rot('flipTipR', 0, 0, -0.25 * spread);
    // flapping
    const flap = g('flap');
    if (flap > 0.001) {
      const f = Math.max(0, Math.sin(t * 22));
      this.rot('flipL', 0, 0, (0.3 + 0.7 * f) * flap); this.rot('flipR', 0, 0, -(0.3 + 0.7 * f) * flap);
    }
    // head tilt
    this.rot('head', 0, 0, 0.35 * g('tilt'));
    // neck stretch / beak up / beak open
    const stretch = g('stretch');
    this.mov('neck', 0, 0.05 * stretch, 0.01 * stretch); this.mov('head', 0, 0.03 * stretch, 0);
    const beakUp = g('beakUp');
    this.rot('neck', -0.35 * beakUp, 0, 0); this.rot('head', -0.85 * beakUp, 0, 0);
    this.rot('jaw', 0.55 * g('beak'), 0, 0);
    // gulp bulge + neck stretch
    const gulp = g('gulp');
    this.mov('neck', 0, 0.035 * gulp, 0); this.rot('head', -0.1 * gulp, 0, 0);
    // belly wiggle
    const wig = g('wiggle');
    this.rot('hips', 0, 0, 0.12 * Math.sin(t * 14) * wig); this.rot('spine', 0, 0.1 * Math.sin(t * 14) * wig, -0.08 * Math.sin(t * 14) * wig);
    this.rot('legL', 0, 0, -0.12 * Math.sin(t * 14) * wig); this.rot('legR', 0, 0, -0.12 * Math.sin(t * 14) * wig);
    // content sway (feet planted)
    const sway = g('sway');
    const sw = Math.sin(t * 2.2) * 0.12 * sway;
    this.rot('hips', 0, 0, sw); this.rot('legL', 0, 0, -sw); this.rot('legR', 0, 0, -sw); this.rot('neck', 0, 0, -sw * 0.4);
    // shake / preen
    const shake = g('shake');
    if (shake > 0.001) { this.rot('spine', 0, 0.25 * Math.sin(t * 30) * shake, 0.06 * Math.sin(t * 30) * shake); this.rot('head', 0, -0.3 * Math.sin(t * 30) * shake, 0); }
    const preen = g('preen');
    if (preen > 0.001) {
      this.rot('neck', 0.4 * preen, 0.5 * preen, 0); this.rot('head', 0.6 * preen + 0.12 * Math.sin(t * 14) * preen, 0.6 * preen, 0.2 * preen);
      this.rot('flipL', 0, 0, 0.35 * preen);
    }
    // shrink neck (petting)
    const low = g('lower');
    this.mov('neck', 0, -0.03 * low, 0); this.mov('head', 0, -0.02 * low, 0);
    this.rot('flipL', 0, 0, 0.12 * low * (1 + Math.sin(t * 8))); this.rot('flipR', 0, 0, -0.12 * low * (1 + Math.sin(t * 8 + 1)));
    // waddle
    const walk = g('walk');
    if (walk > 0.001) {
      const ph = this.gait * Math.PI * 2;
      const roll = Math.sin(ph) * 0.14 * walk;
      this.rot('hips', 0, 0.05 * Math.sin(ph) * walk, roll);
      this.rot('legL', -Math.max(0, Math.sin(ph)) * 0.35 * walk, 0, -roll); this.rot('legR', -Math.max(0, -Math.sin(ph)) * 0.35 * walk, 0, -roll);
      this.mov('legL', 0, Math.max(0, Math.sin(ph)) * 0.025 * walk, 0); this.mov('legR', 0, Math.max(0, -Math.sin(ph)) * 0.025 * walk, 0);
      this.rot('neck', 0, 0, -roll * 0.6);
      this.rot('flipL', 0, 0, (0.25 + 0.1 * Math.sin(ph)) * walk); this.rot('flipR', 0, 0, -(0.25 - 0.1 * Math.sin(ph)) * walk);
    }
    // lying on belly (sleep, slide)
    if (lie > 0.001) {
      this.rot('neck', -0.5 * lie, 0, 0); this.rot('head', -0.55 * lie + 0.25 * g('rest'), 0, 0.2 * g('rest'));
      this.rot('flipL', 0.35 * lie, 0, -0.03 * lie); this.rot('flipR', 0.35 * lie, 0, 0.03 * lie);
      this.rot('legL', 1.2 * lie, 0, 0); this.rot('legR', 1.2 * lie, 0, 0);
      this.rot('footL', 0.4 * lie, 0, 0); this.rot('footR', 0.4 * lie, 0, 0);
      this.rot('spine', -0.035 * br * lie, 0, 0);
    }
    this.rot('neck', 0, 0.35 * g('headSide'), 0.25 * g('headSide')); this.rot('head', -0.15 * g('headSide'), 0.45 * g('headSide'), 0.6 * g('headSide'));
    this.body.rotation.x = 1.36 * lie;
    this.body.position.z = -0.03 * lie;
    this.body.position.y = 0.2 * lie + g('lift');
    this.rot('flipTipL', 0, 0, 0.3 * g('flTw') * Math.sin(t * 30));
    // down flutter via comb direction
    const fl = g('flutter') + g('shake') + 0.15 * walk;
    this.inst.uComb.set(this.combBase.x + Math.sin(t * 23) * 0.35 * fl, this.combBase.y + Math.sin(t * 17) * 0.2 * fl, this.combBase.z + Math.cos(t * 19) * 0.3 * fl);
  }
  resetGestures() {
    for (const k of ['spread', 'tilt', 'stretch', 'beakUp', 'beak', 'shake', 'preen', 'flutter', 'flap', 'wiggle', 'gulp', 'sway']) this.set(k, 0, 5);
    if (!this.asleep) this.set('lid', 0, 5);
  }
  *idleLoop() {
    let last = '';
    yield* this.wait(1.0);
    for (;;) {
      const opts = ['balance', 'tilt', 'waddle', 'preen', 'hunger', 'hunger'].filter((o) => o !== last);
      if (this.foodsLeft === 0) opts.splice(opts.indexOf('hunger'), 1);
      const pick = opts[Math.floor(Math.random() * opts.length)]; last = pick;
      if (pick === 'balance') yield* this.gBalance();
      else if (pick === 'tilt') yield* this.gTilt();
      else if (pick === 'waddle') yield* this.gWaddle();
      else if (pick === 'preen') yield* this.gPreen();
      else yield* this.gHunger();
      this.resetGestures();
      yield* this.wait(1.3 + Math.random() * 2.2);
    }
  }
  *gBalance() { this.set('spread', 1, 5); this.set('sway', 0.3, 4); yield* this.wait(1.6); this.set('spread', 0, 4); this.set('sway', 0, 4); yield* this.wait(0.4); }
  *gTilt() {
    this.set('flutter', 0.6, 6);
    this.set('tilt', 1, 5); yield* this.wait(0.6); this.set('tilt', -1, 5); yield* this.wait(0.7); this.set('tilt', 0, 5); yield* this.wait(0.5);
    this.set('flutter', 0, 3);
  }
  *gWaddle() {
    const h = this.homeSpot, p = this.root.position;
    const dir = Math.random() < 0.5 ? 1 : -1;
    const tx = h[0] + dir * 0.22;
    yield* this.waddleTo(tx, h[1] + 0.05, 1.4);
    yield* this.waddleTo(h[0], h[1], 1.4);
    yield* this.turnTo(0, 4);
  }
  *waddleTo(x, z, dur) {
    // 2 short steps per call with side-to-side weight shift
    const p0 = this.root.position.clone();
    this.set('walk', 1, 8);
    let lastStep = 0;
    yield* this.tween(dur, (u) => {
      const e = smooth(u);
      this.root.position.x = lerp(p0.x, x, e); this.root.position.z = lerp(p0.z, z, e);
      const want = Math.atan2(x - p0.x, z - p0.z);
      if (Math.hypot(x - p0.x, z - p0.z) > 0.02) this.yaw += (((want - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * 0.08;
      this.gait = u * 2; // two steps
      const st = Math.floor(u * 4);
      if (st !== lastStep) { lastStep = st; if (st % 2 === 1) SFX.pat(0.35); }
      this.followGround();
    });
    this.set('walk', 0, 6);
  }
  followGround() { if (this.groundFn) this.root.position.y = this.groundFn(this.root.position.x, this.root.position.z); }
  *gPreen() {
    this.set('shake', 1, 10); this.set('lid', 0.5, 6); SFX.feather();
    yield* this.wait(0.6); this.set('shake', 0, 6);
    this.set('preen', 1, 4); this.set('lid', 0.7, 4);
    yield* this.wait(1.2); this.set('preen', 0, 4); this.set('lid', 0, 4);
    yield* this.wait(0.4);
  }
  *gHunger() {
    this.lookTarget = this.room.spots.emptyDishW;
    yield* this.wait(0.8);
    this.lookTarget = null;
    this.set('stretch', 1, 4); this.set('beakUp', 1, 4); this.set('spread', 0.6, 4);
    yield* this.wait(0.35);
    this.set('beak', 1, 10); SFX.peep(1);
    yield* this.wait(0.35); this.set('beak', 0, 8);
    yield* this.wait(0.25); this.set('beak', 0.8, 10); SFX.peep(1.1);
    yield* this.wait(0.3); this.set('beak', 0, 8);
    yield* this.wait(0.3);
    this.set('stretch', 0, 3); this.set('beakUp', 0, 3); this.set('spread', 0, 3);
    this.lookTarget = this.room.spots.foodDishW;
    yield* this.wait(0.9); this.lookTarget = null;
  }
  setTracking(pos) {
    this.lookTarget = pos;
    if (pos && this.state === 'idle') { this.set('stretch', 0.6, 4); this.set('spread', 0.4, 4); }
  }
  tryReceive(food) {
    if (!this.accepting()) return false;
    this.state = 'eating'; this.resetGestures(); this.lookTarget = null;
    this.play(food.type === 'fish' ? this.eatFish(food) : this.eatShrimp(food));
    return true;
  }
  *grab(food, dur = 0.25) {
    this.set('beakUp', 1, 10); this.set('beak', 1, 12); this.set('stretch', 0.7, 8);
    this.holdAnchor.attach(food.obj);
    const p0 = food.obj.position.clone(), q0 = food.obj.quaternion.clone();
    yield* this.tween(dur, (u) => { const e = smooth(u); food.obj.position.lerpVectors(p0, food.holdPos(), e); food.obj.quaternion.slerpQuaternions(q0, food.holdQuat(), e); });
  }
  *eatFish(food) {
    food.state = 'eating';
    yield* this.grab(food, 0.3);
    SFX.peep(1.2);
    const steps = [0.35, 0.75, 1.0];
    for (let i = 0; i < 3; i++) {
      const c0 = food.cut, c1 = steps[i];
      this.set('beak', 0.6, 30);
      yield* this.tween(0.1, (u) => { food.setCut(lerp(c0, c1, smooth(u))); food.obj.position.copy(food.holdPos()); });
      this.set('beak', 1, 30);
      this.set('gulp', 0.6, 20);
      yield* this.wait(0.08);
      this.set('gulp', 0, 15);
    }
    food.done();
    this.set('beak', 0, 12);
    // swallowed whole: neck stretch + throat bulge
    yield* this.gulpDown(0.45);
    this.eatenFish++;
    yield* this.afterFood();
  }
  *eatShrimp(food) {
    food.state = 'eating';
    yield* this.grab(food, 0.2);
    yield* this.tween(0.2, (u) => { food.setCut(smooth(u)); food.obj.position.copy(food.holdPos()); });
    food.done();
    this.set('beak', 0, 14);
    yield* this.gulpDown(0.3);
    this.eatenShrimp++;
    yield* this.afterFood();
  }
  *gulpDown(d) {
    SFX.gulp();
    this.set('gulp', 1, 12);
    yield* this.tween(d, (u) => { this.now('throat', bump(u)); });
    this.now('throat', 0);
    this.set('gulp', 0, 6); this.set('beakUp', 0, 5); this.set('stretch', 0, 5);
    this.set('belly', Math.min(1, (this.tg.belly || 0) + 0.34), 2);
  }
  *afterFood() {
    yield* this.wait(0.15);
    // flap twice + wiggle belly
    SFX.feather();
    this.set('flap', 1, 14); yield* this.wait(0.3); this.set('flap', 0, 10);
    this.set('wiggle', 1, 10); this.set('flutter', 0.7, 8); yield* this.wait(0.6); this.set('wiggle', 0, 6); this.set('flutter', 0, 4);
    SFX.peep(1.3);
    yield* this.wait(0.3);
    if (this.eatenFish >= 2 && this.eatenShrimp >= 1) { yield* this.finale(); return; }
    this.state = 'idle';
    yield* this.idleLoop();
  }
  *finale() {
    this.state = 'full';
    SFX.happy();
    this.set('sway', 1, 2); this.set('lid', 0.45, 3);
    yield* this.wait(2.4);
    this.set('sway', 0, 3); this.set('lid', 0, 3);
    const s = this.room.spots;
    // waddle up the ice hill ~2s
    for (let i = 0; i < s.hillPath.length; i++) {
      const pnt = s.hillPath[i];
      yield* this.waddleTo(pnt[0], pnt[1], 0.7);
    }
    yield* this.turnTo(s.slideYaw, 5);
    // lie on belly
    SFX.feather();
    this.set('lie', 1, 6); this.set('spread', 0.2, 4);
    yield* this.wait(0.5);
    // slide ~1.5s into the pool
    SFX.slide();
    const path = s.slidePath; const p0 = this.root.position.clone();
    yield* this.tween(1.5, (u) => {
      const e = u * u * (1.4 - 0.4 * u);
      const x = lerp(p0.x, path[0], e), z = lerp(p0.z, path[1], e);
      this.root.position.x = x; this.root.position.z = z;
      this.root.position.y = this.groundFn(x, z);
      const ahead = this.groundFn(x + Math.sin(this.yaw) * 0.1, z + Math.cos(this.yaw) * 0.1);
      this.now('pitchSlope', Math.atan2(this.root.position.y - ahead, 0.1));
      this.body.rotation.x += 0;
    });
    this.room.splash(this.root.position.x, this.root.position.z);
    SFX.splash();
    this.set('flap', 1, 10);
    yield* this.wait(0.6);
    this.set('flap', 0, 6);
    this.set('lie', 0, 5);
    // quickly back to shore
    yield* this.waddleTo(s.shore[0], s.shore[1], 1.0);
    this.room.ripple(this.root.position.x, this.root.position.z, 0.5);
    yield* this.waddleTo(s.bed[0], s.bed[1] + 0.15, 1.2);
    yield* this.waddleTo(s.bed[0], s.bed[1], 0.8);
    yield* this.turnTo(s.bedYaw, 4);
    // preen on the dry rest spot
    this.set('shake', 1, 10); SFX.feather(); yield* this.wait(0.7); this.set('shake', 0, 6);
    yield* this.gPreen();
    yield* this.goSleep();
  }
  *goSleep() {
    this.state = 'toBed';
    this.set('lid', 0.6, 2);
    yield* this.wait(0.5);
    this.set('lie', 1, 1.8); this.set('rest', 1, 1.5);
    yield* this.wait(1.0);
    this.set('lid', 1, 1.5);
    SFX.feather();
    yield* this.wait(0.8);
    this.fallAsleep();
    yield* this.sleepLoop();
  }
  fallAsleep() { this.asleep = true; this.state = 'sleep'; this.now('lid', 1); this.onSleep && this.onSleep(); }
  *sleepLoop() {
    for (;;) { yield* this.wait(3 + Math.random() * 4); this.set('flTw', 1, 20); yield* this.wait(0.2); this.set('flTw', 0, 8); }
  }
  sleepNow(pos, yaw) {
    this.resetGestures(); this.main = null; this.layers = [];
    this.state = 'sleep'; this.asleep = true;
    if (pos) this.root.position.set(pos[0], pos[1] || 0, pos[2]);
    else { this.root.position.set(this.room.spots.bed[0], 0, this.room.spots.bed[1]); this.followGround(); }
    this.yaw = yaw ?? this.room.spots.bedYaw;
    this.now('lie', 1); this.now('rest', 1); this.now('lid', 1); this.now('belly', 1);
    this.play(this.sleepLoop());
  }
  wakeForReplay() {
    this.asleep = false; this.main = null; this.layers = [];
    this.state = 'busy'; this.eatenFish = 0; this.eatenShrimp = 0;
    this.play(this.wakeUp());
  }
  *wakeUp() {
    this.set('lie', 0, 2); this.set('rest', 0, 2); this.set('lid', 0, 2); this.set('belly', 0, 0.5);
    yield* this.wait(1.2);
    yield* this.gPreen();
    yield* this.waddleTo(this.homeSpot[0], this.homeSpot[1] - 0.2, 1.4);
    yield* this.waddleTo(this.homeSpot[0], this.homeSpot[1], 0.9);
    yield* this.turnTo(0, 4);
    this.state = 'idle';
    yield* this.idleLoop();
  }
  pet(part, kind) {
    if (this.asleep) { this.layer(this.twitchSmall()); return; }
    if (kind === 'stroke') this.stroke = 0.4;
    else this.layer(this.tapTilt());
  }
  *tapTilt() { SFX.peep(1.4); this.set('tilt', Math.random() < 0.5 ? 1 : -1, 6); yield* this.wait(0.6); this.set('tilt', 0, 4); }
  *twitchSmall() { this.set('flTw', 0.7, 20); yield* this.wait(0.15); this.set('flTw', 0, 8); }
  update(dt) {
    if (this.stroke > 0) {
      this.stroke -= dt; this.set('lower', 1, 5); this.set('flutter', 0.4, 5);
      if (this.stroke <= 0) { this.set('lower', 0, 3); this.set('flutter', 0, 3); }
    }
    super.update(dt);
    this.body.rotation.x += this.g('pitchSlope') * this.g('lie');
  }
}
export function buildPenguin() { return build(); }
