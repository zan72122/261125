// Procedural sculpted creatures: SDF of smooth-unioned primitives -> surface nets mesh
// -> one continuous SkinnedMesh with procedural skin weights, morph targets and fur shells.
import * as THREE from 'three';
import { furStrandTex } from './textures.js';

// ---------- SDF primitives ----------
function rotInv(rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'));
  m.invert();
  const e = m.elements;
  return [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
}

export function E(c, r, opt = {}) { // ellipsoid
  return { t: 0, c, r, R: opt.rot ? rotInv(...opt.rot) : null, k: opt.k ?? 0.05, bone: opt.bone, bones: opt.bones, s: opt.s ?? 0.03, sub: !!opt.sub, tag: opt.tag };
}
export function C(a, b, ra, rb, opt = {}) { // tapered capsule
  return { t: 1, a, b, ra, rb, k: opt.k ?? 0.04, bone: opt.bone, bones: opt.bones, s: opt.s ?? 0.03, sub: !!opt.sub, tag: opt.tag };
}

export function G(children, opt = {}) { // group: children smooth-unioned first, then unioned into the body with k
  return { t: 2, children, k: opt.k ?? 0.02 };
}
function primDist(p, x, y, z) {
  if (p.t === 2) {
    let d = 1e9;
    for (let i = 0; i < p.children.length; i++) { const c = p.children[i]; const di = primDist(c, x, y, z); d = i === 0 ? di : smin(d, di, c.k); }
    return d;
  }
  if (p.t === 0) {
    let qx = x - p.c[0], qy = y - p.c[1], qz = z - p.c[2];
    if (p.R) {
      const R = p.R;
      const tx = R[0] * qx + R[1] * qy + R[2] * qz, ty = R[3] * qx + R[4] * qy + R[5] * qz, tz = R[6] * qx + R[7] * qy + R[8] * qz;
      qx = tx; qy = ty; qz = tz;
    }
    const ax = qx / p.r[0], ay = qy / p.r[1], az = qz / p.r[2];
    const k0 = Math.sqrt(ax * ax + ay * ay + az * az);
    const bx = ax / p.r[0], by = ay / p.r[1], bz = az / p.r[2];
    const k1 = Math.sqrt(bx * bx + by * by + bz * bz);
    if (k1 < 1e-9) return -Math.min(p.r[0], p.r[1], p.r[2]);
    return k0 * (k0 - 1) / k1;
  } else {
    const pax = x - p.a[0], pay = y - p.a[1], paz = z - p.a[2];
    const bax = p.b[0] - p.a[0], bay = p.b[1] - p.a[1], baz = p.b[2] - p.a[2];
    let h = (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz);
    h = h < 0 ? 0 : h > 1 ? 1 : h;
    const dx = pax - bax * h, dy = pay - bay * h, dz = paz - baz * h;
    return Math.sqrt(dx * dx + dy * dy + dz * dz) - (p.ra + (p.rb - p.ra) * h);
  }
}

function smin(a, b, k) {
  if (k <= 0) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}
function smax(a, b, k) { return -smin(-a, -b, k); }

export function makeSDF(prims) {
  const f = (x, y, z) => {
    let d = 1e9;
    for (let i = 0; i < prims.length; i++) {
      const p = prims[i];
      const di = primDist(p, x, y, z);
      if (p.sub) d = smax(d, -di, p.k);
      else d = i === 0 ? di : smin(d, di, p.k);
    }
    return d;
  };
  f.prims = prims;
  return f;
}

function grad(f, x, y, z, e = 0.002) {
  const gx = f(x + e, y, z) - f(x - e, y, z);
  const gy = f(x, y + e, z) - f(x, y - e, z);
  const gz = f(x, y, z + e) - f(x, y, z - e);
  return [gx / (2 * e), gy / (2 * e), gz / (2 * e)];
}

// march from inside point along dir until surface
export function surfacePoint(f, o, d) {
  let t = 0, prev = f(o[0], o[1], o[2]);
  const step = 0.004;
  for (let i = 0; i < 400; i++) {
    const t2 = t + step;
    const v = f(o[0] + d[0] * t2, o[1] + d[1] * t2, o[2] + d[2] * t2);
    if (prev < 0 && v >= 0) {
      let a = t, b = t2;
      for (let j = 0; j < 20; j++) { const m = (a + b) / 2; const vm = f(o[0] + d[0] * m, o[1] + d[1] * m, o[2] + d[2] * m); if (vm < 0) a = m; else b = m; }
      t = (a + b) / 2; break;
    }
    prev = v; t = t2;
  }
  return [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t];
}

// ---------- Surface nets ----------
const CORN = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

function* surfaceNets(f, bmin, bmax, h) {
  const nx = Math.ceil((bmax[0] - bmin[0]) / h) + 1, ny = Math.ceil((bmax[1] - bmin[1]) / h) + 1, nz = Math.ceil((bmax[2] - bmin[2]) / h) + 1;
  const F = new Float32Array(nx * ny * nz);
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    F[i + nx * (j + ny * k)] = f(bmin[0] + i * h, bmin[1] + j * h, bmin[2] + k * h);
    if (i === nx - 1 && j === ny - 1) yield;
  }
  const cellIdx = new Int32Array(nx * ny * nz).fill(-1);
  const verts = [];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let mask = 0;
    for (let c = 0; c < 8; c++) {
      const val = F[(i + CORN[c][0]) + nx * ((j + CORN[c][1]) + ny * (k + CORN[c][2]))];
      v[c] = val; if (val < 0) mask |= 1 << c;
    }
    if (mask === 0 || mask === 255) continue;
    let sx = 0, sy = 0, sz = 0, cnt = 0;
    for (const [a, b] of EDGES) {
      if ((v[a] < 0) !== (v[b] < 0)) {
        const t = v[a] / (v[a] - v[b]);
        sx += CORN[a][0] + (CORN[b][0] - CORN[a][0]) * t;
        sy += CORN[a][1] + (CORN[b][1] - CORN[a][1]) * t;
        sz += CORN[a][2] + (CORN[b][2] - CORN[a][2]) * t;
        cnt++;
      }
    }
    cellIdx[i + nx * (j + ny * k)] = verts.length / 3;
    verts.push(bmin[0] + (i + sx / cnt) * h, bmin[1] + (j + sy / cnt) * h, bmin[2] + (k + sz / cnt) * h);
  }
  const idx = [];
  const C = (i, j, k) => cellIdx[i + nx * (j + ny * k)];
  const quad = (a, b, c, d, flip) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) idx.push(a, c, b, a, d, c); else idx.push(a, b, c, a, c, d);
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const p0 = F[i + nx * (j + ny * k)] < 0;
    if (i < nx - 1 && j > 0 && k > 0 && j < ny - 1 && k < nz - 1) {
      const p1 = F[(i + 1) + nx * (j + ny * k)] < 0;
      if (p0 !== p1) quad(C(i, j - 1, k - 1), C(i, j, k - 1), C(i, j, k), C(i, j - 1, k), p0);
    }
    if (j < ny - 1 && i > 0 && k > 0 && i < nx - 1 && k < nz - 1) {
      const p1 = F[i + nx * ((j + 1) + ny * k)] < 0;
      if (p0 !== p1) quad(C(i - 1, j, k - 1), C(i - 1, j, k), C(i, j, k), C(i, j, k - 1), p0);
    }
    if (k < nz - 1 && i > 0 && j > 0 && i < nx - 1 && j < ny - 1) {
      const p1 = F[i + nx * (j + ny * (k + 1))] < 0;
      if (p0 !== p1) quad(C(i - 1, j - 1, k), C(i, j - 1, k), C(i, j, k), C(i - 1, j, k), p0);
    }
  }
  return { verts: new Float32Array(verts), idx };
}

// ---------- Creature build ----------
// Run a step generator to the end in one go (the synchronous path).
export function runSync(gen) { let r; while (!(r = gen.next()).done); return r.value; }
// def: { prims, bones:[{name,parent,pos}], bounds:[min,max], h, color(p,n)->[r,g,b], fur(p,n)->0..1+, morphs:[{name, fn(p,n)->[dx,dy,dz]}] }
export function buildCreature(def) { return runSync(buildCreatureSteps(def)); }
// The same build as a generator that yields between small slices of work, so it can be
// spread over several frames while the game keeps running (the result is identical).
export function* buildCreatureSteps(def) {
  const f = makeSDF(def.prims);
  if (def.pre) def.pre(f);
  const { verts, idx } = yield* surfaceNets(f, def.bounds[0], def.bounds[1], def.h);
  yield;
  const nV = verts.length / 3;
  // project onto surface + one laplacian smoothing pass
  const project = function* (it) {
    for (let n = 0; n < it; n++) for (let i = 0; i < nV; i++) {
      if ((i & 255) === 255) yield;
      const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
      const d = f(x, y, z);
      const g = grad(f, x, y, z);
      const gl = g[0] * g[0] + g[1] * g[1] + g[2] * g[2] + 1e-9;
      verts[i * 3] -= d * g[0] / gl; verts[i * 3 + 1] -= d * g[1] / gl; verts[i * 3 + 2] -= d * g[2] / gl;
    }
  };
  yield* project(2);
  // laplacian smooth
  {
    const acc = new Float32Array(nV * 3), cnt = new Float32Array(nV);
    for (let t = 0; t < idx.length; t += 3) {
      for (let e = 0; e < 3; e++) {
        const a = idx[t + e], b = idx[t + (e + 1) % 3];
        acc[a * 3] += verts[b * 3]; acc[a * 3 + 1] += verts[b * 3 + 1]; acc[a * 3 + 2] += verts[b * 3 + 2]; cnt[a]++;
      }
    }
    for (let i = 0; i < nV; i++) if (cnt[i]) for (let c = 0; c < 3; c++) verts[i * 3 + c] = verts[i * 3 + c] * 0.4 + acc[i * 3 + c] / cnt[i] * 0.6;
  }
  yield* project(2);
  // fix triangle orientation against gradient
  for (let t = 0; t < idx.length; t += 3) {
    if (t % 1536 === 1533) yield;
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const ux = verts[b * 3] - ax, uy = verts[b * 3 + 1] - ay, uz = verts[b * 3 + 2] - az;
    const vx = verts[c * 3] - ax, vy = verts[c * 3 + 1] - ay, vz = verts[c * 3 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (ax + verts[b * 3] + verts[c * 3]) / 3, cy = (ay + verts[b * 3 + 1] + verts[c * 3 + 1]) / 3, cz = (az + verts[b * 3 + 2] + verts[c * 3 + 2]) / 3;
    const g = grad(f, cx, cy, cz);
    if (nx * g[0] + ny * g[1] + nz * g[2] < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  const normals = new Float32Array(nV * 3);
  for (let i = 0; i < nV; i++) {
    if ((i & 511) === 511) yield;
    const g = grad(f, verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    const l = Math.hypot(g[0], g[1], g[2]) || 1;
    normals[i * 3] = g[0] / l; normals[i * 3 + 1] = g[1] / l; normals[i * 3 + 2] = g[2] / l;
  }
  // bones
  const boneIndex = {};
  def.bones.forEach((b, i) => { boneIndex[b.name] = i; });
  // skin weights
  const skinIndex = new Uint16Array(nV * 4), skinWeight = new Float32Array(nV * 4);
  const prims = [];
  const flat = (arr) => { for (const p of arr) { if (p.t === 2) flat(p.children); else if (!p.sub) prims.push(p); } };
  flat(def.prims);
  const nB = def.bones.length;
  const bw = new Float32Array(nB);
  const dists = new Float32Array(prims.length);
  for (let i = 0; i < nV; i++) {
    if ((i & 255) === 255) yield;
    const x = verts[i * 3], y = verts[i * 3 + 1], z = verts[i * 3 + 2];
    let dmin = 1e9;
    for (let p = 0; p < prims.length; p++) { dists[p] = primDist(prims[p], x, y, z); if (dists[p] < dmin) dmin = dists[p]; }
    bw.fill(0);
    for (let p = 0; p < prims.length; p++) {
      const pr = prims[p];
      const w = Math.exp(-(dists[p] - dmin) / pr.s);
      if (w < 1e-4) continue;
      if (pr.bones) {
        const list = typeof pr.bones === 'function' ? pr.bones(x, y, z) : pr.bones;
        for (const [bn, bf] of list) bw[boneIndex[bn]] += w * bf;
      } else bw[boneIndex[pr.bone]] += w;
    }
    // top 4
    const top = [];
    for (let b = 0; b < nB; b++) if (bw[b] > 0) top.push([b, bw[b]]);
    top.sort((a, b) => b[1] - a[1]);
    let sum = 0; for (let q = 0; q < Math.min(4, top.length); q++) sum += top[q][1];
    for (let q = 0; q < 4; q++) {
      if (q < top.length) { skinIndex[i * 4 + q] = top[q][0]; skinWeight[i * 4 + q] = top[q][1] / sum; }
    }
  }
  // colors + fur length
  const colors = new Float32Array(nV * 3), furLen = new Float32Array(nV);
  const P = new THREE.Vector3(), N = new THREE.Vector3();
  const tagAcc = {};
  const tagW = (t) => tagAcc[t] || 0;
  for (let i = 0; i < nV; i++) {
    if ((i & 255) === 255) yield;
    P.fromArray(verts, i * 3); N.fromArray(normals, i * 3);
    for (const k in tagAcc) tagAcc[k] = 0;
    {
      let dmin = 1e9; const ds = [];
      for (let p = 0; p < prims.length; p++) { const d = primDist(prims[p], P.x, P.y, P.z); ds.push(d); if (d < dmin) dmin = d; }
      let sum = 0;
      for (let p = 0; p < prims.length; p++) { const w = Math.exp(-(ds[p] - dmin) / 0.012); const t = prims[p].tag || 'body'; tagAcc[t] = (tagAcc[t] || 0) + w; sum += w; }
      for (const k in tagAcc) tagAcc[k] /= sum;
    }
    const c = def.color(P, N, tagW);
    // colors are given in sRGB 0..1 -> convert to linear
    const col = new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    colors[i * 3] = col.r; colors[i * 3 + 1] = col.g; colors[i * 3 + 2] = col.b;
    furLen[i] = def.fur(P, N, tagW);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('furLen', new THREE.BufferAttribute(furLen, 1));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4));
  geo.setIndex(idx);
  // morphs (relative)
  if (def.morphs && def.morphs.length) {
    geo.morphAttributes.position = [];
    geo.morphTargetsRelative = true;
    for (const m of def.morphs) {
      yield;
      const arr = new Float32Array(nV * 3);
      for (let i = 0; i < nV; i++) {
        P.fromArray(verts, i * 3); N.fromArray(normals, i * 3);
        const d = m.fn(P, N);
        arr[i * 3] = d[0]; arr[i * 3 + 1] = d[1]; arr[i * 3 + 2] = d[2];
      }
      const a = new THREE.BufferAttribute(arr, 3); a.name = m.name;
      geo.morphAttributes.position.push(a);
    }
  }
  geo.computeBoundingSphere();
  return { geo, sdf: f, def, morphNames: (def.morphs || []).map((m) => m.name) };
}

// ---------- Fur material ----------
export function furMaterial({ shell = 0, furLength = 0.02, scale = 40, comb = [0, -0.6, -0.5], rough = 0.85, sheen = 0, rim = 0.25, tipLight = 0.18 } = {}) {
  const Mat = sheen > 0 ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const mat = new Mat({ vertexColors: true, roughness: rough, metalness: 0 });
  if (sheen > 0) { mat.sheen = sheen; mat.sheenRoughness = 0.6; mat.sheenColor = new THREE.Color(1, 0.95, 0.88); }
  const u = {
    uShell: { value: shell }, uFurLen: { value: furLength }, uComb: { value: new THREE.Vector3(...comb) },
    uStrand: { value: furStrandTex(7) }, uScale: { value: scale }, uRim: { value: rim }, uTip: { value: tipLight },
  };
  mat.userData.u = u;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float furLen;
uniform float uShell; uniform float uFurLen; uniform vec3 uComb;
varying vec3 vObjPos; varying vec3 vObjN; varying float vFur;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vObjPos = position; vObjN = normal; vFur = furLen;
float shOff = uShell * uFurLen * furLen;
transformed += normal * shOff + uComb * (shOff * uShell);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uShell; uniform sampler2D uStrand; uniform float uScale; uniform float uRim; uniform float uTip;
varying vec3 vObjPos; varying vec3 vObjN; varying float vFur;
vec4 furSample;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 tw = pow(abs(normalize(vObjN)), vec3(8.0)); tw /= (tw.x + tw.y + tw.z);
  vec3 sp = vObjPos * uScale;
  furSample = texture2D(uStrand, sp.zy) * tw.x + texture2D(uStrand, sp.xz + 0.37) * tw.y + texture2D(uStrand, sp.xy + 0.71) * tw.z;
  float fr = clamp(vFur * 1.5, 0.0, 1.0);
  if (uShell > 0.001) {
    float thr = mix(0.22, 0.9, uShell);
    if (vFur < 0.06 || furSample.r < thr) discard;
    diffuseColor.rgb *= mix(0.6, 1.0, uShell) * (0.88 + 0.24 * furSample.g);
    diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * (1.0 + uTip) + uTip * 0.06, uShell * uShell);
  } else {
    float ao = mix(1.0, 0.55 + 0.35 * furSample.r, fr);
    diffuseColor.rgb *= ao * mix(1.0, 0.9 + 0.2 * furSample.b, fr);
  }
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = clamp(roughnessFactor + (furSample.b - 0.5) * 0.2 - (1.0 - clamp(vFur * 3.0, 0.0, 1.0)) * 0.35, 0.25, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + (vec3(furSample.g, furSample.b, furSample.r) - 0.5) * 0.35 * clamp(vFur * 2.0, 0.0, 1.0));`)
      .replace('#include <opaque_fragment>', `{
  float rimF = pow(1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0), 3.0);
  outgoingLight += diffuseColor.rgb * rimF * uRim * clamp(vFur * 2.0, 0.0, 1.0);
}
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => 'fur' + (sheen > 0 ? 'p' : 's');
  return mat;
}

// Create a skinned instance (bones + base mesh + shells) from a built creature
export function instantiate(built, { shells = 5, furLength = 0.02, scale = 40, comb, sheen = 0.5, rough = 0.85, tipLight = 0.18 } = {}) {
  const def = built.def;
  const bones = {}, list = [];
  for (const b of def.bones) {
    const bone = new THREE.Bone(); bone.name = b.name;
    bones[b.name] = bone; list.push(bone);
  }
  for (const b of def.bones) {
    const bone = bones[b.name];
    if (b.parent) {
      const pp = def.bones.find((q) => q.name === b.parent).pos;
      bone.position.set(b.pos[0] - pp[0], b.pos[1] - pp[1], b.pos[2] - pp[2]);
      bones[b.parent].add(bone);
    } else bone.position.set(...b.pos);
  }
  const baseMat = furMaterial({ shell: 0, furLength, scale, comb, sheen, rough });
  const mesh = new THREE.SkinnedMesh(built.geo, baseMat);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  const rootBone = list[0];
  mesh.add(rootBone);
  mesh.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  mesh.bind(skeleton);
  const shellMeshes = [];
  const shellMats = [];
  const maxShells = 6;
  for (let s = 1; s <= maxShells; s++) {
    const m = furMaterial({ shell: s / maxShells, furLength, scale, comb, sheen: 0, rough: Math.min(1, rough + 0.05), tipLight });
    // share uniforms that animate
    m.userData.u.uComb = baseMat.userData.u.uComb;
    m.userData.u.uFurLen = baseMat.userData.u.uFurLen;
    shellMats.push(m);
    const sm = new THREE.SkinnedMesh(built.geo, m);
    sm.bind(skeleton, mesh.bindMatrix);
    sm.frustumCulled = false; sm.castShadow = false; sm.receiveShadow = true;
    sm.renderOrder = s;
    sm.morphTargetInfluences = mesh.morphTargetInfluences;
    mesh.add(sm);
    shellMeshes.push(sm);
  }
  const setShells = (n) => {
    // spread n visible shells across the stack
    for (let i = 0; i < maxShells; i++) shellMeshes[i].visible = false;
    for (let i = 0; i < n; i++) {
      const k = Math.round(((i + 1) / n) * maxShells) - 1;
      shellMeshes[k].visible = true;
    }
  };
  setShells(shells);
  const morph = {};
  built.morphNames.forEach((n, i) => { morph[n] = i; });
  return { mesh, bones, skeleton, shellMeshes, setShells, baseMat, shellMats, morph, sdf: built.sdf, uComb: baseMat.userData.u.uComb.value };
}

// ---------- helpers for add-on parts ----------
export function eyeMaterial(color = 0x0a0706) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, ior: 1.45, specularIntensity: 1 });
}

// lid texture: soft fur-like noise with a dark lash band at the rim
const lidTexC = {};
function lidTex(lower) {
  if (lidTexC[lower]) return lidTexC[lower];
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(64, 64);
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const v = 1 - y / 63; // uv.y
    const rim = lower ? 1 - v : v; // 0 at the rim
    const band = Math.exp(-Math.pow(rim / 0.09, 2));
    const n = 0.9 + Math.random() * 0.12;
    const k = Math.max(0.12, n * (1 - band * 0.82) * (0.88 + 0.12 * Math.min(1, rim * 4)));
    const i = (x + y * 64) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = k * 255; img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (lidTexC[lower] = t);
}
// Eye with upper eyelid. Returns {group, lid, setClosed(v)}; group's +z points out of the head.
export function makeEye(radius, lidColor, irisColor = 0x0a0706) {
  const outer = new THREE.Group();
  const g = new THREE.Group(); outer.add(g);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(radius, 24, 16), eyeMaterial(irisColor));
  g.add(eye);
  // fake catch-light so the eye always reads as glossy
  const hl = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.18, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
  hl.position.set(radius * 0.35, radius * 0.42, radius * 0.82);
  g.add(hl);
  const lc = new THREE.Color(lidColor).multiplyScalar(0.8);
  const lidMat = new THREE.MeshStandardMaterial({ color: lc, roughness: 0.95, map: lidTex(false) });
  const lowMat = new THREE.MeshStandardMaterial({ color: lc, roughness: 0.95, map: lidTex(true) });
  const lidGeo = new THREE.SphereGeometry(radius * 1.04, 28, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const lid = new THREE.Mesh(lidGeo, lidMat);
  const lidPivot = new THREE.Group(); lidPivot.add(lid);
  const flat = new THREE.Group(); flat.scale.set(1.0, 1.0, 1.0); g.add(flat);
  flat.add(lidPivot);
  const lowGeo = new THREE.SphereGeometry(radius * 1.03, 28, 8, 0, Math.PI * 2, Math.PI * 0.62, Math.PI * 0.38);
  const low = new THREE.Mesh(lowGeo, lowMat);
  const lowPivot = new THREE.Group(); lowPivot.add(low); flat.add(lowPivot);
  let closed = 0;
  const setClosed = (v) => {
    closed = v;
    // open: upper lid tucked back; closed: upper lid rim meets the raised lower lid at mid-eye (soft lash line)
    lidPivot.rotation.x = -0.85 + v * 0.97;
    lowPivot.rotation.x = 0.35 - v * 0.71;
    hl.visible = v < 0.55;
    g.position.z = -radius * 0.25 * Math.max(0, (v - 0.4) / 0.6);
  };
  setClosed(0);
  return { group: outer, eye, lid: lidPivot, setClosed, hl };
}

// orient object's +z along direction d (array)
export function orientZ(obj, d, up = [0, 1, 0]) {
  const m = new THREE.Matrix4();
  const z = new THREE.Vector3(...d).normalize();
  const u = new THREE.Vector3(...up);
  const x = new THREE.Vector3().crossVectors(u, z).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  m.makeBasis(x, y, z);
  obj.quaternion.setFromRotationMatrix(m);
}

// attach object at a model-space position to a bone (bones in bind pose with identity rotation)
export function attachAt(inst, boneName, obj, pos, built) {
  const bone = inst.bones[boneName];
  const bp = built.def.bones.find((b) => b.name === boneName).pos;
  obj.position.set(pos[0] - bp[0], pos[1] - bp[1], pos[2] - bp[2]);
  bone.add(obj);
  return obj;
}

export function boneWorldPos(built, name) { return built.def.bones.find((b) => b.name === name).pos; }
