// Golden hamster: sculpt + behaviour
import * as THREE from 'three';
import { E, C, buildCreature, instantiate, makeEye, surfacePoint, orientZ, attachAt } from './sculpt.js';
import { Animal } from './creature.js';
import { smooth, clamp, lerp, bump, win, rng } from './util.js';
import * as SFX from './audio.js';

const X = (x, mirror) => (mirror ? -x : x);
let BUILT = null;

const BONES = [
  { name: 'root', parent: null, pos: [0, 0, 0] },
  { name: 'hips', parent: 'root', pos: [0, 0.2, -0.12] },
  { name: 'spine', parent: 'hips', pos: [0, 0.23, 0.05] },
  { name: 'head', parent: 'spine', pos: [0, 0.29, 0.2] },
  { name: 'jaw', parent: 'head', pos: [0, 0.245, 0.33] },
  { name: 'nose', parent: 'head', pos: [0, 0.285, 0.4] },
  { name: 'cheekL', parent: 'head', pos: [0.11, 0.25, 0.29] },
  { name: 'cheekR', parent: 'head', pos: [-0.11, 0.25, 0.29] },
  { name: 'earL', parent: 'head', pos: [0.1, 0.4, 0.18] },
  { name: 'earR', parent: 'head', pos: [-0.1, 0.4, 0.18] },
  { name: 'armL', parent: 'spine', pos: [0.07, 0.14, 0.19] },
  { name: 'pawL', parent: 'armL', pos: [0.066, 0.05, 0.245] },
  { name: 'armR', parent: 'spine', pos: [-0.07, 0.14, 0.19] },
  { name: 'pawR', parent: 'armR', pos: [-0.066, 0.05, 0.245] },
  { name: 'legL', parent: 'hips', pos: [0.12, 0.15, -0.13] },
  { name: 'footL', parent: 'legL', pos: [0.12, 0.03, -0.06] },
  { name: 'legR', parent: 'hips', pos: [-0.12, 0.15, -0.13] },
  { name: 'footR', parent: 'legR', pos: [-0.12, 0.03, -0.06] },
  { name: 'tail', parent: 'hips', pos: [0, 0.14, -0.33] },
];

const EYE_DIR = (m) => new THREE.Vector3(X(0.66, m), 0.36, 0.66).normalize().toArray();
const EYE_ORIGIN = [0, 0.325, 0.27];

function prims() {
  const P = [
    E([0, 0.225, -0.08], [0.25, 0.215, 0.255], { bones: (x, y, z) => { const t = clamp((z + 0.2) / 0.3, 0, 1); return [['hips', 1 - t], ['spine', t]]; }, k: 0.08, tag: 'body', s: 0.04 }),
    E([0, 0.215, 0.08], [0.22, 0.205, 0.18], { bone: 'spine', k: 0.1, tag: 'body', s: 0.04 }),
    E([0, 0.3, 0.235], [0.172, 0.16, 0.16], { bone: 'head', k: 0.1, tag: 'head', s: 0.035 }),
    E([0, 0.27, 0.355], [0.082, 0.072, 0.075], { bone: 'head', k: 0.07, tag: 'muzzle' }),
    E([0, 0.285, 0.395], [0.034, 0.03, 0.03], { bone: 'nose', k: 0.035, tag: 'muzzle', s: 0.015 }),
    E([0, 0.225, 0.33], [0.055, 0.035, 0.055], { bone: 'jaw', k: 0.04, tag: 'chin', s: 0.015 }),
  ];
  for (const m of [false, true]) {
    const s = m ? 'R' : 'L';
    P.push(E([X(0.095, m), 0.245, 0.3], [0.085, 0.075, 0.085], { bone: 'cheek' + s, k: 0.07, tag: 'cheek', s: 0.03 }));
    P.push(E([X(0.1, m), 0.41, 0.16], [0.038, 0.042, 0.014], { rot: [-0.25, X(0.45, m), X(-0.35, m)], bone: 'ear' + s, k: 0.025, tag: 'ear', s: 0.012 }));
    P.push(C([X(0.07, m), 0.14, 0.19], [X(0.066, m), 0.06, 0.24], 0.034, 0.025, { bone: 'arm' + s, k: 0.04, tag: 'arm', s: 0.02 }));
    P.push(E([X(0.066, m), 0.035, 0.255], [0.024, 0.016, 0.028], { bone: 'paw' + s, k: 0.025, tag: 'paw', s: 0.012 }));
    P.push(E([X(0.115, m), 0.14, -0.12], [0.105, 0.11, 0.12], { bone: 'leg' + s, k: 0.06, tag: 'body', s: 0.03 }));
    P.push(E([X(0.115, m), 0.02, -0.03], [0.036, 0.02, 0.066], { bone: 'foot' + s, k: 0.03, tag: 'paw', s: 0.008 }));
  }
  P.push(E([0, 0.14, -0.335], [0.022, 0.022, 0.028], { bone: 'tail', k: 0.03, tag: 'tail', s: 0.012 }));
  return P;
}

function build() {
  if (BUILT) return BUILT;
  const eyes = [];
  const def = {
    prims: prims(), bones: BONES, h: 0.0105,
    bounds: [[-0.32, -0.03, -0.46], [0.32, 0.5, 0.48]],
    pre(f) {
      for (const m of [false, true]) eyes.push(surfacePoint(f, EYE_ORIGIN, EYE_DIR(m)));
    },
    color(p, n, tw) {
      const gold = [0.86, 0.56, 0.27], dark = [0.68, 0.4, 0.18], white = [0.95, 0.92, 0.86], skin = [0.93, 0.68, 0.66];
      let c = gold.slice();
      // darker along spine top
      const top = smooth((n.y - 0.4) / 0.5) * smooth((p.y - 0.3) / 0.15);
      c = mix3(c, dark, top * 0.45);
      // white underside, chin, front of chest, lower cheeks
      let w = smooth((0.17 - p.y) / 0.08) + smooth((-n.y - 0.1) / 0.4);
      w += smooth((0.255 - p.y) / 0.03) * smooth((p.z - 0.2) / 0.06);
      w += tw('chin') + tw('muzzle') * smooth((0.29 - p.y) / 0.03) * 0.9;
      w += tw('arm') * 0.7;
      w = clamp(w, 0, 1);
      c = mix3(c, white, w);
      // muzzle bridge lighter gold
      c = mix3(c, [0.93, 0.74, 0.5], tw('muzzle') * (1 - w) * 0.5);
      // cheek dark stripe hint
      c = mix3(c, [0.6, 0.38, 0.2], tw('cheek') * smooth((p.y - 0.255) / 0.03) * smooth((0.29 - p.y) / 0.02) * 0.25);
      c = mix3(c, [0.62, 0.46, 0.42], tw('ear'));
      c = mix3(c, skin, tw('paw'));
      c = mix3(c, [0.85, 0.66, 0.62], tw('tail') * 0.5);
      return c;
    },
    fur(p, n, tw) {
      let f = 1.0 - tw('ear') * 0.9 - tw('paw') - tw('muzzle') * 0.5 - tw('chin') * 0.3 - tw('arm') * 0.4 + tw('cheek') * 0.15;
      for (const e of eyes) { const d = Math.hypot(p.x - e[0], p.y - e[1], p.z - e[2]); f *= smooth((d - 0.027) / 0.016); }
      return clamp(f, 0, 1.2);
    },
    morphs: [
      { name: 'cheekL', fn: (p, n) => pouch(p, n, 1) },
      { name: 'cheekR', fn: (p, n) => pouch(p, n, -1) },
      { name: 'belly', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.25) + sq((p.y - 0.12) / 0.16) + sq((p.z + 0.02) / 0.26))) * smooth((0.3 - n.y) / 0.6); return [n.x * w * 0.03, n.y * w * 0.02 - w * 0.005, n.z * w * 0.02]; } },
      { name: 'breath', fn: (p, n) => { const w = Math.exp(-(sq(p.x / 0.3) + sq((p.y - 0.2) / 0.2) + sq((p.z + 0.0) / 0.28))); return [n.x * w * 0.009, n.y * w * 0.012, n.z * w * 0.004]; } },
    ],
  };
  BUILT = buildCreature(def);
  BUILT.eyes = eyes;
  return BUILT;
}
const sq = (v) => v * v;
function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
function pouch(p, n, side) {
  if (p.x * side < 0.02) return [0, 0, 0];
  const cx = 0.12 * side, cy = 0.235, cz = 0.27;
  const d2 = sq((p.x - cx) / 0.1) + sq((p.y - cy) / 0.075) + sq((p.z - cz) / 0.1);
  let w = Math.exp(-d2 * 1.4);
  w *= smooth((0.31 - p.y) / 0.04); // keep eyes untouched
  w *= smooth((0.39 - p.z) / 0.05); // keep nose untouched
  const dir = new THREE.Vector3(side * 0.9, -0.25, 0.1).normalize().multiplyScalar(0.6).add(new THREE.Vector3(n.x, n.y, n.z).multiplyScalar(0.4));
  return [dir.x * w * 0.1, dir.y * w * 0.1, dir.z * w * 0.1];
}

export class Hamster extends Animal {
  constructor({ shells = 5 } = {}) {
    const built = build();
    const inst = instantiate(built, { shells, furLength: 0.022, scale: 8, comb: [0, -0.5, -0.9], sheen: 0.2, tipLight: 0.22 });
    super(inst, built);
    this.kind = 'hamster';
    this.headPos = [0, 0.3, 0.25];
    this.addParts();
    this.state = 'idle';
    this.pouchL = 0; this.pouchR = 0; this.pouchSeeds = 0; this.nestSeeds = 0;
    this.eatenSeeds = 0; this.eatenBroc = 0;
    this.visit = 0;
    this.seedSide = 1;
    this.breathPeriod = 1.1;
    this.wheelAngle = 0; this.wheelSpeed = 0;
    this.rand = rng(1234);
    this.stroke = 0;
  }
  addParts() {
    const b = this.built, inst = this.inst;
    const lidCol = new THREE.Color().setRGB(0.8, 0.52, 0.27, THREE.SRGBColorSpace);
    b.eyes.forEach((e, i) => {
      const m = i === 1;
      const eye = makeEye(0.028, lidCol);
      const d = EYE_DIR(m);
      const pos = [e[0] - d[0] * 0.012, e[1] - d[1] * 0.012, e[2] - d[2] * 0.012];
      attachAt(inst, 'head', eye.group, pos, b);
      orientZ(eye.group, d);
      this.eyes.push(eye);
    });
    // nose
    const noseMat = new THREE.MeshPhysicalMaterial({ color: 0xe79a98, roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.3 });
    const np = surfacePoint(b.sdf, [0, 0.285, 0.36], [0, 0.1, 1]);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.016, 16, 12), noseMat);
    nose.scale.set(1.25, 0.8, 0.8);
    attachAt(inst, 'nose', nose, [np[0], np[1], np[2] - 0.006], b);
    // nostril line
    // whiskers
    const wpts = [];
    const rr = rng(5);
    for (const side of [1, -1]) for (let i = 0; i < 7; i++) {
      const base = surfacePoint(b.sdf, [side * 0.02, 0.272 + (i % 3) * 0.008, 0.35], [side * 0.8, 0.05, 0.6]);
      const ang = -0.35 + i * 0.12 + (rr() - 0.5) * 0.08;
      const len = 0.13 + rr() * 0.06;
      let px = base[0], py = base[1], pz = base[2];
      let dx = side * Math.cos(ang) * 0.8, dy = Math.sin(ang) * 0.5, dz = 0.25 - i * 0.03;
      for (let s = 0; s < 4; s++) {
        const nx = px + dx * len / 4, ny = py + dy * len / 4 - s * 0.003, nz = pz + dz * len / 4;
        wpts.push(px, py, pz, nx, ny, nz); px = nx; py = ny; pz = nz;
        dz -= 0.12;
      }
    }
    const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wpts, 3));
    const whisk = new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: 0xf4efe6, transparent: true, opacity: 0.55 }));
    attachAt(inst, 'nose', whisk, [0, 0, 0], b);
    // inner ears (pink cupped discs)
    const earMat = new THREE.MeshStandardMaterial({ color: 0xd9928e, roughness: 0.6, side: THREE.DoubleSide });
    for (const m of [false, true]) {
      const g = new THREE.SphereGeometry(0.031, 16, 8, 0, Math.PI * 2, 0, 0.9);
      const ear = new THREE.Mesh(g, earMat);
      ear.scale.set(0.95, 1.05, 0.35);
      const hold = new THREE.Group(); hold.add(ear);
      ear.rotation.x = Math.PI; // cup facing +z
      attachAt(inst, m ? 'earR' : 'earL', hold, [X(0.103, m), 0.413, 0.172], b);
      hold.rotation.set(-0.25, X(0.45, m), X(-0.35, m));
      hold.translateZ(0.006);
    }
    // small pink hands (palm + fingers) on the paw bones
    const toeMat = new THREE.MeshStandardMaterial({ color: 0xeeb0aa, roughness: 0.55 });
    const palmG = new THREE.SphereGeometry(0.02, 12, 8);
    const fingG = new THREE.CapsuleGeometry(0.0055, 0.014, 3, 6);
    this.hands = [];
    for (const m of [false, true]) {
      const hand = new THREE.Group();
      const palm = new THREE.Mesh(palmG, toeMat); palm.scale.set(1.0, 0.7, 1.2); hand.add(palm);
      for (let i = 0; i < 4; i++) {
        const f = new THREE.Mesh(fingG, toeMat);
        f.position.set((i - 1.5) * 0.0095, -0.004, 0.022);
        f.rotation.x = Math.PI / 2 - 0.5; f.rotation.z = (i - 1.5) * 0.12;
        hand.add(f);
      }
      hand.traverse((o) => { o.castShadow = true; });
      attachAt(inst, m ? 'pawR' : 'pawL', hand, [X(0.066, m), 0.03, 0.265], b);
      this.hands.push(hand);
    }
    // mouth anchor (food hold point) on head
    this.mouth = new THREE.Object3D();
    attachAt(inst, 'head', this.mouth, [0, 0.235, 0.385], b);
    // hold anchor: in front of mouth, +y axis = into mouth (up/back)
    this.holdAnchor = new THREE.Object3D();
    attachAt(inst, 'head', this.holdAnchor, [0, 0.232, 0.45], b);
    this.holdAnchor.rotation.x = -0.15;
    // petting proxies
    this.proxHead = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'head', this.proxHead, [0, 0.31, 0.27], b);
    this.proxBack = new THREE.Mesh(new THREE.SphereGeometry(0.27, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    attachAt(inst, 'hips', this.proxBack, [0, 0.25, -0.1], b);
    this.proxHead.userData.part = 'head'; this.proxBack.userData.part = 'back';
  }

  // ---------- room hookup ----------
  setRoom(room) {
    this.room = room;
    this.homeSpot = room.spots.home;
    this.root.position.set(this.homeSpot[0], 0, this.homeSpot[1]);
  }
  get foodsLeft() { return this.room.foods.filter((f) => f.state !== 'gone' && f.state !== 'eating').length; }
  accepting() { return this.state === 'idle'; }
  canEat(food) { return this.accepting(); }

  enter() {
    this.visit++;
    if (this.state === 'idle') this.play(this.emergeThenIdle(this.visit));
  }

  // ---------- pose ----------
  pose(dt) {
    const t = this.time, g = (n) => this.g(n);
    const walk = g('walk'), sit = g('sit'), stand = g('stand'), hold = g('hold'), rub = g('rub'), curl = g('curl');
    const run = g('run');
    // breathing
    const bp = this.asleep ? 1.8 : this.breathPeriod;
    this.breathPh = (this.breathPh || 0) + dt / bp * Math.PI * 2;
    const br = Math.sin(this.breathPh);
    this.morphW.breath = 0.5 + 0.5 * br * (this.asleep ? 1 : 0.7);
    // idle drift
    const alive = 1 - curl;
    this.rot('head', 0.04 * Math.sin(t * 0.53) * alive, 0.1 * Math.sin(t * 0.7) * alive * (1 - hold * 0.7), 0.04 * Math.sin(t * 0.41) * alive);
    // look target
    const lw = this.look.w * (1 - curl);
    this.rot('head', this.look.pitch * 0.6 * lw, this.look.yaw * 0.55 * lw, 0);
    this.rot('spine', this.look.pitch * 0.2 * lw, this.look.yaw * 0.3 * lw, 0);
    // sniff / nose twitch
    const sn = g('sniff');
    this.mov('nose', 0, 0.0035 * Math.sin(t * 38) * sn, 0.002 * Math.sin(t * 38 + 1) * sn);
    this.rot('head', 0.025 * Math.sin(t * 19) * sn, 0, 0);
    // sit up (eating posture)
    const up = sit * 0.55 + stand * 1.05;
    this.rot('hips', -up, 0, 0);
    this.mov('hips', 0, 0.035 * sit + 0.06 * stand, -0.04 * sit - 0.06 * stand);
    this.rot('spine', -0.2 * sit - 0.25 * stand, 0, 0);
    this.rot('head', 0.5 * sit + 1.0 * stand - 0.15 * stand, 0, 0);
    this.rot('legL', up * 0.95, 0, 0); this.rot('legR', up * 0.95, 0, 0);
    this.rot('footL', 0.1 * up, 0, 0); this.rot('footR', 0.1 * up, 0, 0);
    this.rot('tail', up * 0.6, 0, 0);
    // arms: hold food at mouth
    const regrip = g('regrip');
    const ah = hold;
    this.rot('pawL', -0.9 * ah, 0, -0.5 * ah); this.rot('pawR', -0.9 * ah, 0, 0.5 * ah);
    // paws at chest (stand sniff)
    const chest = g('chestPaws');
    this.rot('pawL', -1.2 * chest, 0, 0); this.rot('pawR', -1.2 * chest, 0, 0);
    // face washing
    if (rub > 0.001) {
      const ph = t * 9;
      this.rot('pawL', -1.0 * rub, 0, -0.4 * rub); this.rot('pawR', -1.0 * rub, 0, 0.4 * rub);
      this.rot('head', (0.15 + 0.08 * Math.sin(ph)) * rub, 0.12 * Math.sin(ph * 0.5) * rub, 0.06 * Math.sin(ph) * rub);
    }
    // stretch / arch / yawn
    const st = g('stretch'), arch = g('arch');
    this.rot('armL', -1.25 * st, 0, 0); this.rot('armR', -1.25 * st, 0, 0);
    this.rot('pawL', 0.9 * st, 0, 0); this.rot('pawR', 0.9 * st, 0, 0);
    this.rot('spine', 0.22 * st - 0.2 * arch, 0, 0); this.rot('hips', -0.1 * st + 0.18 * arch, 0, 0);
    this.mov('spine', 0, -0.02 * st, 0.03 * st);
    this.rot('head', -0.25 * st - 0.35 * g('yawn'), 0, 0);
    this.rot('legL', 0.1 * st - 0.18 * arch, 0, 0); this.rot('legR', 0.1 * st - 0.18 * arch, 0, 0);
    // jaw
    const jaw = g('jaw') + g('yawn') * 0.55;
    this.rot('jaw', jaw * 0.45, 0, 0);
    this.mov('jaw', 0, -jaw * 0.008, 0);
    // chewing cheeks
    const chew = g('chew');
    this.mov('cheekL', 0.003 * Math.sin(t * 25) * chew, 0.003 * Math.sin(t * 25) * chew, 0);
    this.mov('cheekR', -0.003 * Math.sin(t * 25 + 0.5) * chew, 0.003 * Math.sin(t * 25 + 0.5) * chew, 0);
    this.rot('jaw', 0.12 * Math.max(0, Math.sin(t * 25)) * chew, 0, 0);
    // walking gait (diagonal pairs)
    if (walk > 0.001 || run > 0.001) {
      const ph = this.gait * Math.PI * 2;
      const a = 0.55 * walk + 0.85 * run;
      this.rot('legL', Math.sin(ph) * a, 0, 0); this.rot('legR', Math.sin(ph + Math.PI) * a, 0, 0);
      this.rot('footL', Math.max(0, Math.sin(ph + 1.2)) * 0.5 * a, 0, 0); this.rot('footR', Math.max(0, Math.sin(ph + 1.2 + Math.PI)) * 0.5 * a, 0, 0);
      this.rot('armL', Math.sin(ph + Math.PI) * a * 0.9, 0, 0); this.rot('armR', Math.sin(ph) * a * 0.9, 0, 0);
      this.rot('pawL', Math.max(0, Math.sin(ph + Math.PI + 1)) * -0.6 * a, 0, 0); this.rot('pawR', Math.max(0, Math.sin(ph + 1)) * -0.6 * a, 0, 0);
      this.rot('spine', Math.sin(ph * 2) * 0.04 * (walk + run), 0, Math.sin(ph) * 0.05 * walk);
      this.rot('head', -Math.sin(ph * 2) * 0.04 * walk - 0.1 * run, 0, 0);
      this.body.position.y = Math.abs(Math.sin(ph)) * (0.008 * walk + 0.02 * run);
      this.rot('hips', -0.08 * run, 0, 0);
    } else this.body.position.y = 0;
    // petting: lower body + squint
    const low = g('lower');
    this.body.position.y -= 0.03 * low;
    this.rot('spine', 0.08 * low, 0, 0); this.rot('head', 0.12 * low, 0, 0);
    this.rot('earL', 0.35 * low, 0, -0.25 * low); this.rot('earR', 0.35 * low, 0, 0.25 * low);
    // ear twitches
    const et = g('earTwitchL'), et2 = g('earTwitchR');
    this.rot('earL', -0.3 * et * Math.sin(t * 30), 0, 0.2 * et); this.rot('earR', -0.3 * et2 * Math.sin(t * 30), 0, -0.2 * et2);
    // hunger: lean forward, paws a bit raised
    const hung = g('hunger');
    this.rot('spine', -0.1 * hung, 0, 0); this.rot('armL', -0.35 * hung, 0, 0); this.rot('armR', -0.35 * hung, 0, 0);
    this.rot('pawL', -0.5 * hung, 0, 0); this.rot('pawR', -0.5 * hung, 0, 0);
    this.rot('hips', -0.15 * hung, 0, 0); this.rot('legL', 0.15 * hung, 0, 0); this.rot('legR', 0.15 * hung, 0, 0);
    // emerging from bedding: head pitched up
    const em = g('emergeTilt');
    this.rot('head', -0.6 * em, 0, 0); this.rot('spine', -0.4 * em, 0, 0);
    this.rot('earL', 0.6 * g('earFlat'), 0, 0); this.rot('earR', 0.6 * g('earFlat'), 0, 0);
    // sleep curl
    if (curl > 0.001) {
      this.rot('hips', 0.35 * curl, 0.25 * curl, 0);
      this.rot('spine', 0.45 * curl, 0.35 * curl, 0.1 * curl);
      this.rot('head', 0.75 * curl, 0.35 * curl, 0.25 * curl);
      this.rot('pawL', -1.2 * curl, 0, 0); this.rot('pawR', -1.2 * curl, 0, 0);
      this.rot('legL', 0.6 * curl, 0, 0); this.rot('legR', 0.6 * curl, 0, 0);
      this.rot('earL', 0.5 * curl, 0, -0.3 * curl); this.rot('earR', 0.5 * curl, 0, 0.3 * curl);
      this.body.position.y -= 0.045 * curl;
      this.body.rotation.z = 0.12 * curl;
      this.rot('spine', 0.02 * br * curl, 0, 0);
    } else this.body.rotation.z = 0;
    this.rot('head', -1.25 * g('faceUp'), -0.45 * g('faceUp'), -0.2 * g('faceUp')); this.rot('spine', -0.25 * g('faceUp'), 0, 0);
    this.body.position.y += g('lift');
    // pouch morphs (+ tiny chewing wobble)
    const cw = chew * 0.04 * Math.sin(t * 25);
    this.morphW.cheekL = clamp(g('pouchL') + cw, 0, 1.3);
    this.morphW.cheekR = clamp(g('pouchR') - cw, 0, 1.3);
    this.morphW.belly = g('belly');
  }

  post() {
    const g = (n) => this.g(n);
    const hold = g('hold'), rub = g('rub'), chest = g('chestPaws'), curl = g('curl');
    const w = Math.max(hold, rub, chest, curl);
    if (w < 0.01) return;
    this.root.updateMatrixWorld(true);
    const t = this.time;
    for (const side of [1, -1]) {
      const arm = side > 0 ? 'armL' : 'armR', paw = side > 0 ? 'pawL' : 'pawR';
      let T;
      if (hold >= Math.max(rub, chest, curl)) {
        T = this.holdAnchor.localToWorld(new THREE.Vector3(side * 0.03, this.holdDepth || -0.06, 0.0));
        T.y -= 0.012 * g('regrip') * Math.abs(Math.sin(t * 22 + side));
      } else if (rub >= Math.max(chest, curl)) {
        const ph = t * 9 + (side > 0 ? 0 : Math.PI);
        T = this.bones.head.localToWorld(new THREE.Vector3(side * (0.07 + 0.02 * Math.sin(ph)), -0.035 + 0.035 * Math.sin(ph), 0.235));
      } else if (chest >= curl) {
        T = this.bones.spine.localToWorld(new THREE.Vector3(side * 0.04, 0.04, 0.24));
      } else {
        T = this.bones.head.localToWorld(new THREE.Vector3(side * 0.035, -0.07, 0.17));
      }
      this.reach(arm, paw, T, w);
    }
  }
  // ---------- behaviours ----------
  resetGestures() {
    for (const k of ['sit', 'stand', 'hold', 'rub', 'stretch', 'arch', 'yawn', 'jaw', 'chestPaws', 'hunger', 'emergeTilt', 'earFlat', 'chew', 'regrip', 'sniff']) this.set(k, 0, 6);
    this.set('lid', 0, 6);
  }
  *idleLoop() {
    let last = '';
    yield* this.wait(1.2);
    for (;;) {
      const opts = ['wash', 'stretch', 'stand', 'hunger', 'hunger', 'wash'].filter((o) => o !== last);
      if (this.foodsLeft === 0) { const i = opts.indexOf('hunger'); if (i >= 0) opts.splice(i, 1); }
      const pick = opts[Math.floor(Math.random() * opts.length)];
      last = pick;
      if (pick === 'wash') yield* this.gWash();
      else if (pick === 'stretch') yield* this.gStretch();
      else if (pick === 'stand') yield* this.gStand();
      else yield* this.gHunger();
      this.resetGestures();
      yield* this.wait(1.3 + Math.random() * 2.2);
    }
  }
  *gWash() {
    this.set('sit', 1, 7); yield* this.wait(0.3);
    this.set('rub', 1, 8); this.set('lid', 0.55, 8);
    SFX.furRub();
    yield* this.wait(0.9); SFX.furRub();
    yield* this.wait(0.6);
    this.set('rub', 0, 7); this.set('lid', 0, 6);
    yield* this.wait(0.25);
  }
  *gStretch() {
    this.set('stretch', 1, 4); yield* this.wait(0.8);
    this.set('stretch', 0.3, 3); this.set('arch', 1, 4); this.set('yawn', 1, 5); this.set('lid', 0.9, 6);
    yield* this.wait(0.8);
    this.set('yawn', 0, 5); this.set('lid', 0, 5); this.set('arch', 0, 4); this.set('stretch', 0, 4);
    yield* this.wait(0.6);
  }
  *gStand() {
    this.set('stand', 1, 7); this.set('chestPaws', 1, 7); this.set('sniff', 1, 8);
    SFX.snuffle(0.6);
    yield* this.wait(1.0);
    this.set('stand', 0, 6); this.set('chestPaws', 0, 6); this.set('sniff', 0, 4);
    yield* this.wait(0.3);
  }
  *gHunger() {
    const ed = this.room.spots.emptyDishW, fd = this.room.spots.foodDishW;
    this.lookTarget = ed; this.set('hunger', 0.6, 4);
    yield* this.wait(0.9);
    this.lookTarget = fd; this.set('sniff', 1, 6); this.set('hunger', 1, 4);
    SFX.snuffle(0.5);
    yield* this.wait(1.3);
    this.lookTarget = null; this.set('sniff', 0, 3); this.set('hunger', 0, 3);
  }
  *emergeThenIdle(visit) {
    this.state = 'busy';
    const r = rng(visit * 97 + 3);
    const spots = this.room.spots.emerge;
    const sp = spots[(visit - 1) % spots.length];
    const mound = this.room.mound;
    // dive into the bedding first (if visible)
    if (this.g('lift') > -0.1) {
      yield* this.wait(0.55);
      const p0 = this.root.position.clone();
      mound.place(p0.x + Math.sin(this.yaw) * 0.15, p0.z + Math.cos(this.yaw) * 0.15);
      this.set('emergeTilt', -0.8, 6); this.set('earFlat', 1, 5);
      SFX.rustle('bedding', 0.8);
      yield* this.tween(0.8, (u) => { this.now('lift', -0.55 * smooth(u)); mound.set(0.8 * Math.sin(Math.min(1, u * 1.3) * Math.PI)); });
      mound.set(0);
      yield* this.wait(0.3);
    }
    // hidden under bedding
    this.root.position.set(sp[0], 0, sp[1]);
    this.yaw = Math.atan2(this.homeSpot[0] - sp[0], this.homeSpot[1] - sp[1]) + (r() - 0.5) * 0.6;
    this.now('lift', -0.55); this.now('emergeTilt', 1); this.now('earFlat', 1);
    mound.place(sp[0] + Math.sin(this.yaw) * 0.2, sp[1] + Math.cos(this.yaw) * 0.2);
    yield* this.wait(0.25);
    SFX.rustle('bedding', 1.0);
    yield* this.tween(0.7, (u) => mound.set(smooth(u)));
    // nose
    yield* this.tween(0.45, (u) => { this.now('lift', lerp(-0.55, -0.33, smooth(u))); mound.set(1); });
    this.set('sniff', 1, 8); SFX.snuffle(0.5);
    yield* this.wait(0.25);
    // ears
    this.set('earFlat', 0, 6);
    yield* this.tween(0.35, (u) => { this.now('lift', lerp(-0.33, -0.2, smooth(u))); });
    SFX.rustle('bedding', 0.6);
    // head
    yield* this.tween(0.4, (u) => { this.now('lift', lerp(-0.2, -0.08, smooth(u))); });
    yield* this.wait(0.2);
    this.set('emergeTilt', 0, 3);
    yield* this.tween(0.5, (u) => { this.now('lift', lerp(-0.08, 0, smooth(u))); mound.set(1 - smooth(u)); });
    this.set('sniff', 0, 4);
    mound.set(0);
    yield* this.walkTo(this.homeSpot[0], this.homeSpot[1], 0.35, 7);
    yield* this.turnTo(0, 4);
    this.state = 'idle';
    yield* this.idleLoop();
  }

  // dragging hooks
  setTracking(pos) { this.lookTarget = pos; if (pos && this.state === 'idle') { this.set('sniff', 1, 6); this.set('hunger', 0.5, 4); } }

  tryReceive(food) {
    if (!this.accepting()) return false;
    this.state = 'eating';
    this.resetGestures();
    this.lookTarget = null;
    this.play(food.type === 'seed' ? this.eatSeed(food) : this.eatBroccoli(food));
    return true;
  }
  *grab(food, dur = 0.3) {
    // attach food to hold anchor, lerp into local target
    this.set('sit', 1, 9); this.set('hold', 1, 9);
    this.holdAnchor.attach(food.obj);
    const p0 = food.obj.position.clone(), q0 = food.obj.quaternion.clone();
    yield* this.tween(dur, (u) => {
      const e = smooth(u);
      food.obj.position.lerpVectors(p0, food.holdPos(), e);
      food.obj.quaternion.slerpQuaternions(q0, food.holdQuat(), e);
    });
  }
  *eatSeed(food) {
    food.state = 'eating';
    this.holdDepth = -0.065;
    yield* this.grab(food);
    SFX.snuffle(0.4);
    const side = this.seedSide; this.seedSide *= -1;
    for (let i = 0; i < 3; i++) {
      // nibble: open, push seed in, crack
      this.set('jaw', 0.8, 30);
      const c0 = food.cut, c1 = [0.35, 0.7, 1.0][i];
      yield* this.tween(0.13, (u) => { food.setCut(lerp(c0, c1, smooth(u))); food.obj.position.copy(food.holdPos()); });
      this.set('jaw', 0, 30);
      SFX.seedCrack();
      this.layer(this.headShake(0.08));
      this.set('chew', 1, 20);
      yield* this.wait(0.22);
      this.set('chew', 0.3, 10);
    }
    food.setCut(1); food.done();
    this.eatenSeeds++;
    this.pouchSeeds++;
    // pouch on alternating side (~20% width each)
    const key = side > 0 ? 'pouchL' : 'pouchR';
    this.set(key, this.g(key) + 0.5, 5);
    if (side > 0) this.pouchL++; else this.pouchR++;
    this.set('chew', 0, 6);
    this.set('hold', 0, 6);
    SFX.snuffle(0.5);
    this.layer(this.headShake(0.12));
    yield* this.wait(0.45);
    this.set('sit', 0, 5);
    this.updateBelly();
    yield* this.wait(0.35);
    yield* this.afterFood();
  }
  *eatBroccoli(food) {
    food.state = 'eating';
    this.holdDepth = -0.1;
    yield* this.grab(food, 0.32);
    for (let i = 0; i < 4; i++) {
      this.set('jaw', 0.9, 25);
      const c0 = food.cut, c1 = (i + 1) * 0.25;
      yield* this.tween(0.16, (u) => { food.setCut(lerp(c0, c1, smooth(u))); food.obj.position.copy(food.holdPos()); });
      this.set('jaw', 0, 25);
      SFX.broccoli();
      this.set('chew', 1, 15);
      this.set('regrip', 1, 12);
      yield* this.wait(0.29);
      this.set('regrip', 0, 8);
      if (i === 1) SFX.snuffle(0.35);
    }
    food.done();
    this.eatenBroc++;
    this.set('hold', 0, 6);
    yield* this.wait(0.4);
    this.set('chew', 0, 5); this.set('sit', 0, 5);
    this.updateBelly();
    yield* this.wait(0.3);
    yield* this.afterFood();
  }
  updateBelly() { this.set('belly', (this.eatenSeeds + this.eatenBroc * 1.5) / 4.5, 2); }
  *headShake(a) { yield* this.tween(0.3, (u) => { this.now('shake', Math.sin(u * Math.PI * 4) * a * (1 - u)); }); }
  *afterFood() {
    if (this.pouchSeeds >= 3) { yield* this.stash(); }
    if (this.eatenSeeds >= 3 && this.eatenBroc >= 1) { yield* this.finale(); return; }
    this.state = 'idle';
    yield* this.idleLoop();
  }
  *stash() {
    this.state = 'busy';
    const s = this.room.spots;
    yield* this.wait(0.3);
    yield* this.walkPath([s.nestFront, s.nestIn], 0.6, 6);
    yield* this.turnTo(Math.atan2(s.pile[0] - s.nestIn[0], s.pile[1] - s.nestIn[1]), 5);
    this.set('stand', 0.25, 4); this.set('chestPaws', 0, 4);
    yield* this.wait(0.3);
    // deflate ~1s while seeds drop onto the pile
    SFX.snuffle(0.6);
    const pl0 = this.g('pouchL'), pr0 = this.g('pouchR');
    let dropped = 0;
    yield* this.tween(1.0, (u) => {
      this.now('pouchL', pl0 * (1 - smooth(u))); this.now('pouchR', pr0 * (1 - smooth(u)));
      this.now('rub', 0.5 * bump(u));
      const want = Math.min(this.pouchSeeds, Math.floor(u * 3.2));
      while (dropped < want) { dropped++; this.pouchSeeds--; this.nestSeeds++; this.room.setNestSeeds(this.nestSeeds); SFX.tick(0.5); }
    });
    while (this.pouchSeeds > 0) { this.pouchSeeds--; this.nestSeeds++; this.room.setNestSeeds(this.nestSeeds); }
    this.pouchL = this.pouchR = 0;
    this.set('rub', 0, 6); this.set('stand', 0, 4);
    yield* this.wait(0.4);
    yield* this.walkPath([s.nestFront, this.homeSpot], 0.6, 6);
    yield* this.turnTo(0, 4);
  }
  *finale() {
    this.state = 'full';
    this.updateBelly();
    SFX.happy();
    this.set('lid', 0.5, 4); yield* this.wait(0.6); this.set('lid', 0, 4);
    // happy trick: wheel
    const s = this.room.spots;
    yield* this.walkPath([s.wheelFront], 0.6, 6);
    yield* this.turnTo(Math.PI, 5);
    // hop in
    const p0 = this.root.position.clone();
    yield* this.tween(0.45, (u) => {
      this.root.position.z = lerp(p0.z, s.wheelIn[1], smooth(u));
      this.root.position.x = lerp(p0.x, s.wheelIn[0], smooth(u));
      this.now('lift', s.wheelY * smooth(u) + Math.sin(u * Math.PI) * 0.07);
    });
    SFX.tick(0.6);
    yield* this.turnTo(Math.PI / 2, 6);
    // run ~4s
    const wheel = this.room.wheel;
    SFX.wheel(true);
    let sp = 0;
    yield* this.tween(4.4, (u) => {
      const target = u < 0.12 ? smooth(u / 0.12) : u > 0.75 ? 1 - smooth((u - 0.75) / 0.25) : 1;
      sp = 1.1 * target;
      this.now('run', clamp(target * 1.3, 0, 1));
      this.gait += sp * this.dt * 6;
      wheel.spin(sp * this.dt / wheel.radius);
      SFX.wheelSpeed(target);
    });
    this.now('run', 0); this.set('run', 0);
    SFX.wheel(false);
    yield* this.wait(0.3);
    yield* this.turnTo(0, 5);
    const p1 = this.root.position.clone();
    yield* this.tween(0.45, (u) => {
      this.root.position.z = lerp(p1.z, s.wheelFront[1], smooth(u));
      this.root.position.x = lerp(p1.x, s.wheelFront[0], smooth(u));
      this.now('lift', s.wheelY * (1 - smooth(u)) + Math.sin(u * Math.PI) * 0.06);
    });
    SFX.tick(0.5);
    // wash face
    yield* this.gWash();
    this.resetGestures();
    yield* this.wait(0.3);
    yield* this.goSleep();
  }
  *goSleep() {
    this.state = 'toBed';
    const s = this.room.spots;
    yield* this.walkPath([s.nestFront, s.bed], 0.5, 6);
    yield* this.turnTo(s.bedYaw, 4);
    SFX.rustle('bedding', 0.5);
    this.set('curl', 1, 1.6); this.set('lid', 1, 1.5);
    yield* this.wait(1.2);
    this.fallAsleep();
    yield* this.sleepLoop();
  }
  fallAsleep() {
    this.asleep = true; this.state = 'sleep';
    this.now('lid', 1);
    this.onSleep && this.onSleep();
  }
  *sleepLoop() {
    for (;;) {
      yield* this.wait(3 + Math.random() * 4);
      const k = Math.random() < 0.5 ? 'earTwitchL' : 'earTwitchR';
      this.set(k, 1, 20); yield* this.wait(0.18); this.set(k, 0, 8);
    }
  }
  sleepNow(pos, yaw) {
    this.resetGestures(); this.main = null; this.layers = [];
    this.state = 'sleep'; this.asleep = true;
    if (pos) { this.root.position.set(pos[0], pos[1] || 0, pos[2]); }
    else if (this.room) { this.root.position.set(this.room.spots.bed[0], 0, this.room.spots.bed[1]); }
    this.yaw = yaw ?? (this.room ? this.room.spots.bedYaw : 0);
    this.now('curl', 1); this.now('lid', 1); this.now('belly', 1); this.now('lift', 0);
    this.play(this.sleepLoop());
  }
  wakeForReplay() {
    this.asleep = false; this.main = null; this.layers = [];
    this.state = 'busy';
    this.eatenSeeds = 0; this.eatenBroc = 0; this.pouchSeeds = 0;
    this.play(this.wakeUp());
  }
  *wakeUp() {
    this.set('curl', 0, 2); this.set('lid', 0, 2); this.set('belly', 0, 0.5);
    yield* this.wait(0.8);
    yield* this.gStretch();
    yield* this.walkPath([this.room.spots.nestFront, this.homeSpot], 0.32, 7);
    yield* this.turnTo(0, 4);
    this.state = 'idle';
    yield* this.idleLoop();
  }
  pet(part, kind) {
    if (this.asleep) { this.layer(this.twitchSmall()); return; }
    if (part === 'head' && kind === 'tap') {
      this.layer(this.noseTwitch());
    } else if (kind === 'stroke') {
      this.stroke = 0.35;
    }
  }
  *noseTwitch() { SFX.snuffle(0.4); this.set('sniff', 1, 15); yield* this.wait(0.6); if (this.state !== 'eating') this.set('sniff', 0, 5); }
  *twitchSmall() { const k = Math.random() < 0.5 ? 'earTwitchL' : 'earTwitchR'; this.set(k, 0.7, 20); yield* this.wait(0.15); this.set(k, 0, 8); }
  update(dt) {
    if (this.stroke > 0) {
      this.stroke -= dt;
      this.set('lower', 1, 5); if (!this.asleep) this.set('lid', 0.65, 6);
      if (this.stroke <= 0) { this.set('lower', 0, 3); if (!this.asleep) this.set('lid', 0, 4); }
    }
    super.update(dt);
    // head shake channel
    this.bones.head.rotation.y += this.g('shake');
  }
}

export function buildHamster() { return build(); }
