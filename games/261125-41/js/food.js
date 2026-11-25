// Food models. Bites are shown with a clipping plane in the food's local frame
// (backfaces rendered as a flat cut face with inner colour), not by scaling.
import * as THREE from 'three';
import { mergeGeometries } from '../lib/BufferGeometryUtils.js';
import { makeCanvas, canvasTex, rng, makeNoise2D, fbm, clamp, smooth, damp } from './util.js';
import { leafTex, leafMasks, fishTex, noiseTex } from './textures.js';

const _m = new THREE.Matrix4(), _n = new THREE.Vector3(), _q = new THREE.Quaternion();

function cutMat(params, cap) {
  const mat = new THREE.MeshPhysicalMaterial(Object.assign({ side: THREE.DoubleSide }, params));
  const u = { uCapN: { value: new THREE.Vector3(0, 1, 0) }, uCapIn: { value: new THREE.Color(...cap.inner) }, uCapOut: { value: new THREE.Color(...cap.outer) }, uCapR: { value: 1 }, uCapRatio: { value: cap.ratio ?? 0.5 }, uCapAxis: { value: cap.axis ?? 1 } };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLoc;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLoc = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLoc; uniform vec3 uCapN; uniform vec3 uCapIn; uniform vec3 uCapOut; uniform float uCapR; uniform float uCapRatio; uniform float uCapAxis;')
      .replace('#include <color_fragment>', `#include <color_fragment>
if (!gl_FrontFacing) {
  float rr = (uCapAxis > 0.5 ? length(vLoc.xz) : length(vLoc.yz)) / max(uCapR, 1e-4);
  float k = smoothstep(uCapRatio - 0.12, uCapRatio + 0.05, rr);
  diffuseColor.rgb = mix(uCapIn, uCapOut, k) * (0.94 + 0.06 * sin(rr * 40.0));
}`)
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (!gl_FrontFacing) normal = normalize(uCapN);');
  };
  mat.customProgramCacheKey = () => 'cut';
  return mat;
}

export class Food {
  constructor(type, obj, cfg) {
    this.type = type; this.obj = obj; this.cfg = cfg;
    this.state = 'dish'; this.cut = 0;
    this.plane = new THREE.Plane();
    this.localPlane = new THREE.Plane();
    this.mats = [];
    obj.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.userData.clip !== false) this.mats.push(o.material); } });
    for (const m of this.mats) { if (cfg.clip !== 'none') m.clippingPlanes = [this.plane]; }
    this.home = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    this.tremble = 0;
    this.setCut(0);
    const self = this;
    obj.traverse((o) => {
      if (o.isMesh && o.material.userData.u) o.onBeforeRender = (r, s, cam) => {
        // cap normal (pointing out of the remaining piece) in view space
        _n.copy(cfg.capN);
        _m.multiplyMatrices(cam.matrixWorldInverse, self.obj.matrixWorld);
        _n.transformDirection(_m);
        o.material.userData.u.uCapN.value.copy(_n);
      };
    });
  }
  setCut(v) {
    this.cut = v;
    const c = this.cfg;
    if (c.clip === 'top') { this.localPlane.normal.set(0, -1, 0); this.localPlane.constant = c.top - v * c.len; }
    else if (c.clip === 'bottom') { this.localPlane.normal.set(0, 1, 0); this.localPlane.constant = -(c.base + v * c.len); }
    else if (c.clip === 'x') { this.localPlane.normal.set(1, 0, 0); this.localPlane.constant = -(v * c.len); }
    if (c.capR) for (const m of this.mats) if (m.userData.u) m.userData.u.uCapR.value = c.capR(v);
  }
  // local pose of food inside the animal's hold anchor (anchor +y points into the mouth)
  holdPos() { return this.cfg.holdPos(this.cut, this.stage || 0); }
  holdQuat() { return this.cfg.holdQuat; }
  setStage(s) { this.stage = s; if (this.cfg.setStage) this.cfg.setStage(s); }
  done() { this.state = 'gone'; this.obj.visible = false; }
  setHome(parent, pos, rotY = 0, tilt = 0) {
    this.homeParent = parent;
    this.home.pos.copy(pos);
    this.home.quat.setFromEuler(new THREE.Euler(tilt, rotY, 0, 'YXZ'));
    parent.add(this.obj);
    this.obj.position.copy(pos); this.obj.quaternion.copy(this.home.quat);
  }
  resetToDish() {
    if (this.cfg.reseed) this.cfg.reseed();
    this.state = 'dish'; this.obj.visible = true; this.setCut(0); this.stage = 0; if (this.cfg.setStage) this.cfg.setStage(0);
    this.homeParent.add(this.obj);
    this.obj.position.copy(this.home.pos); this.obj.quaternion.copy(this.home.quat);
  }
  update(dt, time) {
    if (this.cfg.clip !== 'none') {
      this.obj.updateMatrixWorld();
      this.plane.copy(this.localPlane).applyMatrix4(this.obj.matrixWorld);
    }
    if (this.state === 'return') {
      const p = this.obj.position, q = this.obj.quaternion;
      p.x = damp(p.x, this.home.pos.x, 7, dt); p.z = damp(p.z, this.home.pos.z, 7, dt);
      // gentle arc down
      p.y = damp(p.y, this.home.pos.y, 5, dt);
      q.slerp(this.home.quat, 1 - Math.exp(-7 * dt));
      if (p.distanceTo(this.home.pos) < 0.003) { p.copy(this.home.pos); q.copy(this.home.quat); this.state = 'dish'; }
    }
    if (this.tremble > 0 && this.state === 'eating') {
      this.obj.rotation.z += Math.sin(time * 60) * 0.03 * this.tremble;
    }
  }
}

// ---------- seed ----------
let seedTexC = null;
function seedTex() {
  if (seedTexC) return seedTexC;
  const W = 128, H = 128; const c = makeCanvas(W, H); const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
  const nz = makeNoise2D(3, 32);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W;
    const st = Math.sin(u * Math.PI * 2 * 7 + Math.sin(y / H * 5) * 0.5);
    const stripe = smooth((st - 0.55) / 0.25);
    const n = fbm(nz, x / 6, y / 24, 3);
    const base = 22 + n * 25;
    const v = base + stripe * (170 + n * 50);
    const i = (x + y * W) * 4;
    img.data[i] = v; img.data[i + 1] = v * 0.98; img.data[i + 2] = v * 0.94; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  seedTexC = canvasTex(c);
  return seedTexC;
}
function seedGeo(L) {
  const g = new THREE.SphereGeometry(1, 20, 16);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const taper = 0.78 - 0.3 * y;
    x *= taper; z *= taper;
    const ridge = 1 + 0.08 * Math.max(0, 1 - Math.abs(z) * 3); // slight keel
    p.setXYZ(i, x * 0.34 * L / 2 * ridge, y * L / 2, z * 0.2 * L / 2);
  }
  g.computeVertexNormals();
  return g;
}
export function makeSeed(L = 0.1, plain = false) {
  const g = seedGeo(L);
  const params = { map: seedTex(), roughness: 0.42, clearcoat: 0.5, clearcoatRoughness: 0.35 };
  if (plain) { const m = new THREE.Mesh(g, new THREE.MeshPhysicalMaterial(params)); m.castShadow = true; return m; }
  const mat = cutMat(params, { inner: [0.93, 0.9, 0.82], outer: [0.15, 0.14, 0.13], ratio: 0.8 });
  const obj = new THREE.Group(); obj.add(new THREE.Mesh(g, mat));
  const top = L / 2;
  return new Food('seed', obj, {
    clip: 'top', top, len: L, capN: new THREE.Vector3(0, 1, 0),
    capR: (v) => { const y = (top - v * L) / (L / 2); return Math.max(0.002, Math.sqrt(Math.max(0, 1 - y * y)) * (0.78 - 0.3 * y) * 0.34 * L / 2); },
    holdPos: (cut) => new THREE.Vector3(0, -(top - cut * L) - 0.004, 0.0),
    holdQuat: new THREE.Quaternion(),
  });
}

// ---------- broccoli ----------
export function makeBroccoli(S = 1) {
  const r = rng(11);
  const geos = [];
  const stem = new THREE.CylinderGeometry(0.016 * S, 0.022 * S, 0.075 * S, 12, 3); stem.translate(0, 0.0375 * S, 0);
  const stemMat = cutMat({ color: 0xa9c77a, roughness: 0.6 }, { inner: [0.8, 0.88, 0.62], outer: [0.62, 0.78, 0.42], ratio: 0.8 });
  // branches
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * Math.PI * 2 + r();
    const b = new THREE.CylinderGeometry(0.007 * S, 0.01 * S, 0.05 * S, 8); b.translate(0, 0.025 * S, 0);
    b.rotateZ(0.5); b.rotateY(a); b.translate(0, 0.065 * S, 0);
    geos.push(b);
  }
  const stemAll = mergeGeometries([stem, ...geos.map((g) => g.toNonIndexed ? g : g)].map((g) => g.index ? g.toNonIndexed() : g));
  // florets: many small bumpy buds on a dome
  const buds = [];
  const cols = [];
  const bud = new THREE.IcosahedronGeometry(1, 2);
  for (let i = 0; i < 46; i++) {
    const th = r() * Math.PI * 2, ph = Math.acos(1 - r() * 0.95);
    const R = 0.052 * S;
    const x = Math.sin(ph) * Math.cos(th) * R, z = Math.sin(ph) * Math.sin(th) * R, y = 0.088 * S + Math.cos(ph) * R * 0.8;
    const rad = (0.017 + r() * 0.01) * S;
    const g = bud.clone();
    const pa = g.attributes.position;
    for (let k = 0; k < pa.count; k++) {
      const vx = pa.getX(k), vy = pa.getY(k), vz = pa.getZ(k);
      const bump = 1 + 0.18 * Math.sin(vx * 9 + i) * Math.sin(vy * 11) * Math.sin(vz * 7 + i);
      pa.setXYZ(k, vx * rad * bump + x, vy * rad * bump * 0.85 + y, vz * rad * bump + z);
    }
    const shade = 0.75 + r() * 0.35;
    const col = new THREE.Color().setRGB(0.2 * shade, 0.42 * shade, 0.16 * shade, THREE.SRGBColorSpace);
    const ca = new Float32Array(pa.count * 3);
    for (let k = 0; k < pa.count; k++) { const yy = pa.getY(k); const t = clamp((yy - y + rad) / (2 * rad), 0, 1); ca[k * 3] = col.r * (0.7 + 0.5 * t); ca[k * 3 + 1] = col.g * (0.7 + 0.5 * t); ca[k * 3 + 2] = col.b * (0.7 + 0.4 * t); }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    g.deleteAttribute('uv');
    buds.push(g.index ? g.toNonIndexed() : g);
  }
  const floret = mergeGeometries(buds);
  floret.computeVertexNormals();
  const tex = noiseTex(17, [40, 80, 30], [120, 170, 70], { scale: 24, normalStrength: 5 });
  const floretMat = cutMat({ vertexColors: true, roughness: 0.7, normalMap: tex.normalMap, sheen: 0.4, sheenColor: new THREE.Color(0.6, 0.8, 0.5) }, { inner: [0.72, 0.82, 0.5], outer: [0.55, 0.7, 0.35], ratio: 0.9 });
  const obj = new THREE.Group();
  const sm = new THREE.Mesh(stemAll, stemMat), fm = new THREE.Mesh(floret, floretMat);
  obj.add(sm, fm);
  const top = 0.088 * S + 0.052 * S * 0.8 + 0.022 * S;
  const fh = top - 0.06 * S;
  return new Food('broccoli', obj, {
    clip: 'top', top, len: fh, capN: new THREE.Vector3(0, 1, 0),
    capR: () => 0.07 * S,
    holdPos: (cut) => new THREE.Vector3(0, -(top - cut * fh) - 0.004, 0.012),
    holdQuat: new THREE.Quaternion(),
  });
}

// ---------- carrot ----------
let carrotTexC = null;
function carrotTex() {
  if (carrotTexC) return carrotTexC;
  const W = 64, H = 256; const nz = makeNoise2D(8, 32);
  const c = makeCanvas(W, H); const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
  const hgt = new Float32Array(W * H);
  const r = rng(4); const rings = []; for (let i = 0; i < 26; i++) rings.push([r() * H, 0.5 + r() * 0.5]);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let ring = 0; for (const [ry, a] of rings) ring = Math.max(ring, a * Math.exp(-Math.pow((y - ry) / 1.2, 2)) * (0.5 + 0.5 * Math.sin(x / W * Math.PI * 2 * 2 + ry)));
    const n = fbm(nz, x / 8, y / 8, 3);
    const k = 0.92 + n * 0.16 - ring * 0.25;
    const i = (x + y * W) * 4;
    img.data[i] = clamp(238 * k, 0, 255); img.data[i + 1] = clamp(118 * k, 0, 255); img.data[i + 2] = clamp(28 * k, 0, 255); img.data[i + 3] = 255;
    hgt[x + y * W] = 1 - ring;
  }
  ctx.putImageData(img, 0, 0);
  carrotTexC = canvasTex(c);
  return carrotTexC;
}
export function makeCarrot(L = 0.42, R = 0.03) {
  const prof = (t) => { // t: 0 tip -> 1 top
    const base = R * (0.12 + 0.88 * Math.pow(t, 0.6));
    const shoulder = t > 0.94 ? Math.sqrt(Math.max(0, 1 - Math.pow((t - 0.94) / 0.06, 2))) : 1;
    return Math.max(0.0015, base * shoulder);
  };
  const pts = [];
  const N = 40;
  for (let i = 0; i <= N; i++) { const t = i / N; pts.push(new THREE.Vector2(prof(t) * (1 + 0.04 * Math.sin(t * 60)), t * L)); }
  const g = new THREE.LatheGeometry(pts, 20);
  const mat = cutMat({ map: carrotTex(), roughness: 0.5, clearcoat: 0.15 }, { inner: [1.0, 0.68, 0.28], outer: [0.98, 0.5, 0.1], ratio: 0.5 });
  const obj = new THREE.Group();
  const body = new THREE.Mesh(g, mat);
  obj.add(body);
  // leafy top
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x5f9a3a, roughness: 0.6, side: THREE.DoubleSide });
  leafMat.userData.clip = true;
  const r = rng(L * 1000 | 0);
  const stalks = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + r() * 0.5, tilt = 0.15 + r() * 0.35;
    const len = L * (0.35 + r() * 0.25);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, L, 0), new THREE.Vector3(Math.cos(a) * len * tilt * 0.6, L + len * 0.6, Math.sin(a) * len * tilt * 0.6), new THREE.Vector3(Math.cos(a) * len * tilt * 1.6, L + len, Math.sin(a) * len * tilt * 1.6));
    stalks.push(new THREE.TubeGeometry(curve, 8, 0.0035, 5));
    // frilly leaflets
    for (let k = 0; k < 4; k++) {
      const p = curve.getPoint(0.45 + k * 0.17);
      const lf = new THREE.PlaneGeometry(0.03, 0.045, 1, 2);
      const pa = lf.attributes.position;
      for (let q = 0; q < pa.count; q++) pa.setZ(q, Math.sin(pa.getY(q) * 60) * 0.004);
      lf.rotateY(a + (k % 2 ? 0.8 : -0.8)); lf.rotateZ(0.4); lf.translate(p.x, p.y, p.z);
      stalks.push(lf.index ? lf.toNonIndexed() : lf);
    }
  }
  const tops = mergeGeometries(stalks.map((s) => { const q = s.index ? s.toNonIndexed() : s; if (q.attributes.uv) q.deleteAttribute('uv'); return q; }));
  tops.computeVertexNormals();
  const leaves = new THREE.Mesh(tops, leafMat);
  obj.add(leaves);
  return new Food('carrot', obj, {
    clip: 'bottom', base: 0, len: L * 1.02, capN: new THREE.Vector3(0, -1, 0),
    capR: (v) => prof(Math.min(1, v)) ,
    holdPos: (cut) => new THREE.Vector3(0, cut * L * 1.02 - 0.012, 0),
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI)),
  });
}

// ---------- leaf ----------
export function makeLeaf(seed, W = 0.2, H = 0.26) {
  const g = new THREE.PlaneGeometry(W, H, 12, 16);
  g.translate(0, H / 2, 0);
  const pa = g.attributes.position;
  const nz = makeNoise2D(seed, 16);
  for (let i = 0; i < pa.count; i++) {
    const x = pa.getX(i), y = pa.getY(i);
    const cup = -Math.pow(x / (W / 2), 2) * 0.03;
    const crinkle = (fbm(nz, x * 40 + 5, y * 40 + 5, 3) - 0.5) * 0.025 * (Math.abs(x) / (W / 2));
    const bend = -Math.pow(y / H, 2) * 0.05;
    pa.setZ(i, cup + crinkle + bend);
  }
  g.computeVertexNormals();
  const t = leafTex();
  let masks = leafMasks(seed);
  const mat = new THREE.MeshPhysicalMaterial({ map: t.map, normalMap: t.normalMap, alphaMap: masks[0], alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: new THREE.Color(0.8, 1, 0.7) });
  // alpha map uses uv; flip so bites start at the tip (top of leaf)
  const obj = new THREE.Group();
  const m = new THREE.Mesh(g, mat);
  obj.add(m);
  return new Food('leaf', obj, {
    clip: 'none', capN: new THREE.Vector3(0, 1, 0),
    holdPos: (cut, stage) => new THREE.Vector3(0, -H + (stage || 0) * H * 0.24 - 0.01, 0.01),
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.2, 0, 0)),
    setStage: (s) => { mat.alphaMap = masks[Math.min(4, s)]; mat.needsUpdate = true; },
    // new irregular bite outlines on every replay
    reseed: () => { for (const m of masks) m.dispose(); masks = leafMasks((Math.random() * 1e6) | 0); },
  });
}

// ---------- fish ----------
export function makeFish(L = 0.3) {
  const prof = (t) => { // t: 0 head -> 1 tail; returns half-height
    if (t < 0.12) return 0.06 * L * Math.sqrt(t / 0.12) * 1.2;
    return 0.072 * L * Math.pow(Math.max(0, 1 - (t - 0.12) / 0.88), 0.9) * (1 - 0.15 * (t - 0.12)) + 0.012 * L;
  };
  const segs = 28, rad = 16;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, h = prof(t) * (i === 0 ? 0 : 1);
    for (let j = 0; j <= rad; j++) {
      const a = j / rad * Math.PI * 2;
      const y = Math.cos(a) * h, z = Math.sin(a) * h * 0.45;
      pos.push(t * L, y, z);
      uv.push(t, (1 - Math.cos(a)) / 2);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < rad; j++) {
    const a = i * (rad + 1) + j, b = a + rad + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  g.computeVertexNormals();
  const tx = fishTex();
  const mat = cutMat({ map: tx.map, normalMap: tx.normalMap, roughness: 0.25, metalness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15, iridescence: 0.3 }, { inner: [0.95, 0.75, 0.7], outer: [0.85, 0.85, 0.88], ratio: 0.85, axis: 0 });
  const obj = new THREE.Group();
  obj.add(new THREE.Mesh(g, mat));
  // tail fin
  const fin = new THREE.Shape();
  fin.moveTo(0, 0); fin.lineTo(0.16 * L, 0.09 * L); fin.quadraticCurveTo(0.12 * L, 0, 0.16 * L, -0.09 * L); fin.lineTo(0, 0);
  const fg = new THREE.ShapeGeometry(fin); fg.translate(L * 0.97, 0, 0);
  const finMat = cutMat({ color: 0x6f8aa0, roughness: 0.4, transparent: true, opacity: 0.85, metalness: 0.2 }, { inner: [0.5, 0.6, 0.7], outer: [0.5, 0.6, 0.7], axis: 0 });
  obj.add(new THREE.Mesh(fg, finMat));
  const dorsal = new THREE.Shape(); dorsal.moveTo(0, 0); dorsal.lineTo(0.08 * L, 0.06 * L); dorsal.lineTo(0.16 * L, 0); dorsal.lineTo(0, 0);
  const dg = new THREE.ShapeGeometry(dorsal); dg.translate(0.45 * L, 0.06 * L, 0);
  obj.add(new THREE.Mesh(dg, finMat));
  // eyes
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.1, clearcoat: 1 });
  const ringMat = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.3, metalness: 0.4 });
  for (const s of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.SphereGeometry(0.018 * L * 2, 10, 8), ringMat); ring.scale.set(1, 1, 0.4); ring.position.set(0.09 * L, 0.018 * L, s * 0.022 * L); obj.add(ring);
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.011 * L * 2, 10, 8), eyeMat); e.position.set(0.09 * L, 0.018 * L, s * 0.028 * L); obj.add(e);
  }
  return new Food('fish', obj, {
    clip: 'x', len: L, capN: new THREE.Vector3(-1, 0, 0),
    capR: (v) => prof(v),
    holdPos: (cut) => new THREE.Vector3(0, cut * L - 0.01, 0),
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)),
  });
}

// ---------- shrimp ----------
export function makeShrimp(S = 0.14) {
  const geos = [];
  const N = 9;
  const cols = [];
  for (let i = 0; i < N; i++) {
    const s = i / (N - 1);
    const th = Math.PI * 0.15 + s * Math.PI * 1.15;
    const R = S * 0.36;
    const x = Math.cos(th) * R, y = Math.sin(th) * R;
    const rad = S * (0.15 - 0.09 * s);
    const g = new THREE.SphereGeometry(rad, 14, 10);
    g.scale(1.05, 1.0, 0.85);
    g.rotateZ(th + Math.PI / 2);
    g.translate(x, y, 0);
    const pa = g.attributes.position; const ca = new Float32Array(pa.count * 3);
    for (let k = 0; k < pa.count; k++) {
      const band = i % 2 ? 1 : 0.88;
      const lx = pa.getX(k) - x, ly = pa.getY(k) - y;
      const outer = clamp((lx * Math.cos(th) + ly * Math.sin(th)) / rad * 0.5 + 0.5, 0, 1);
      const c = new THREE.Color().setRGB((0.98 - 0.1 * (1 - outer)) * band, (0.55 + 0.25 * (1 - outer)) * band, (0.45 + 0.25 * (1 - outer)) * band, THREE.SRGBColorSpace);
      ca[k * 3] = c.r; ca[k * 3 + 1] = c.g; ca[k * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  // tail fan
  const thE = Math.PI * 0.15 + Math.PI * 1.15;
  for (const sgn of [-1, 1]) {
    const g = new THREE.SphereGeometry(S * 0.09, 10, 6); g.scale(1, 0.4, 0.5);
    g.rotateZ(thE + sgn * 0.5); g.translate(Math.cos(thE) * S * 0.42, Math.sin(thE) * S * 0.42, sgn * S * 0.03);
    const pa = g.attributes.position; const ca = new Float32Array(pa.count * 3);
    const c = new THREE.Color().setRGB(0.95, 0.45, 0.35, THREE.SRGBColorSpace);
    for (let k = 0; k < pa.count; k++) { ca[k * 3] = c.r; ca[k * 3 + 1] = c.g; ca[k * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    geos.push(g.index ? g.toNonIndexed() : g);
  }
  const body = mergeGeometries(geos);
  body.computeVertexNormals();
  const mat = cutMat({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, transmission: 0.0 }, { inner: [1, 0.85, 0.8], outer: [0.98, 0.6, 0.5], ratio: 0.8, axis: 0 });
  const obj = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(new THREE.Mesh(body, mat));
  // eyes + antennae
  const th0 = Math.PI * 0.15;
  const hx = Math.cos(th0) * S * 0.36, hy = Math.sin(th0) * S * 0.36;
  const eyeMat = new THREE.MeshPhysicalMaterial({ color: 0x111111, roughness: 0.15, clearcoat: 1 });
  for (const s of [1, -1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(S * 0.025, 8, 6), eyeMat); e.position.set(hx + S * 0.1, hy + S * 0.05, s * S * 0.05); inner.add(e); }
  const ant = [];
  for (const s of [1, -1]) { ant.push(hx + S * 0.1, hy, s * S * 0.03, hx + S * 0.5, hy - S * 0.25, s * S * 0.12, hx + S * 0.5, hy - S * 0.25, s * S * 0.12, hx + S * 0.75, hy - S * 0.6, s * S * 0.18); }
  const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.Float32BufferAttribute(ant, 3));
  inner.add(new THREE.LineSegments(ag, new THREE.LineBasicMaterial({ color: 0xd88070 })));
  // reorient so the head is at local x = 0 and the body extends along +x
  inner.position.set(-hx + S * 0.12, -hy, 0);
  inner.rotation.z = 0;
  obj.add(inner);
  return new Food('shrimp', obj, {
    clip: 'x', len: S * 0.9, capN: new THREE.Vector3(-1, 0, 0),
    capR: () => S * 0.15,
    holdPos: (cut) => new THREE.Vector3(0, cut * S * 0.9 - 0.01, 0),
    holdQuat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -Math.PI / 2)),
  });
}

// ---------- ceramic dish ----------
export function makeDish(R = 0.25, H = 0.08, color = 0xf1ece2, glaze = 0xd8e4ea) {
  const pts = [];
  const add = (x, y) => pts.push(new THREE.Vector2(x, y));
  add(0, 0.004); add(R * 0.6, 0.0); add(R * 0.66, 0.004); add(R * 0.68, 0.012);
  add(R * 0.8, 0.02);
  for (let i = 0; i <= 8; i++) { const t = i / 8; add(R * (0.8 + 0.2 * Math.sin(t * Math.PI / 2)), 0.02 + (H - 0.02) * t); }
  add(R * 1.02, H + 0.006); add(R * 0.98, H + 0.01); add(R * 0.93, H);
  for (let i = 0; i <= 8; i++) { const t = i / 8; add(R * (0.93 - 0.25 * Math.sin(t * Math.PI / 2)), H - (H - 0.03) * t); }
  add(R * 0.5, 0.028); add(0, 0.026);
  const g = new THREE.LatheGeometry(pts, 48);
  g.computeVertexNormals();
  const mat = new THREE.MeshPhysicalMaterial({ color, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0 });
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true; m.receiveShadow = true;
  // inner glaze colour ring
  const inner = new THREE.Mesh(new THREE.CircleGeometry(R * 0.62, 40), new THREE.MeshPhysicalMaterial({ color: glaze, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }));
  inner.rotation.x = -Math.PI / 2; inner.position.y = 0.029; inner.receiveShadow = true;
  const grp = new THREE.Group(); grp.add(m, inner);
  grp.userData.floorY = 0.03;
  return grp;
}
