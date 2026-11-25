// Small shared helpers
import * as THREE from 'three';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
export const damp = (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt);
// bump: 0 -> 1 -> 0 over [0,1]
export const bump = (t) => (t <= 0 || t >= 1 ? 0 : Math.sin(Math.PI * t));
// window function: smooth in over [a,b], hold, smooth out over [c,d]
export const win = (t, a, b, c, d) => smooth((t - a) / (b - a)) * (1 - smooth((t - c) / (d - c)));

export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function canvasTex(c, { srgb = true, repeat = true, aniso = 4 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}

// tileable value noise on a grid (for canvas textures)
export function makeNoise2D(seed, period) {
  const r = rng(seed);
  const g = new Float32Array(period * period);
  for (let i = 0; i < g.length; i++) g[i] = r();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % period) + period) % period, y0 = ((yi % period) + period) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = g[x0 + y0 * period], b = g[x1 + y0 * period], c = g[x0 + y1 * period], d = g[x1 + y1 * period];
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  };
}

export function fbm(noise, x, y, oct, period) {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < oct; i++) { s += a * noise(x * f, y * f); n += a; a *= 0.5; f *= 2; }
  return s / n;
}

// height canvas -> normal map canvas
export function heightToNormal(hgt, w, h, strength = 2) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = hgt[((x - 1 + w) % w) + y * w], r = hgt[((x + 1) % w) + y * w];
      const u = hgt[x + ((y - 1 + h) % h) * w], d = hgt[x + ((y + 1) % h) * w];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len; ny /= len; nz /= len;
      const i = (x + y * w) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Merge static meshes that share a material (and shadow flags) into one mesh per group.
// World transforms are baked into the geometry, so draw calls and shadow-pass calls drop
// without changing what is drawn. Subtrees flagged with userData.dyn are left untouched.
export function mergeStatic(scene, mergeGeometries) {
  scene.updateMatrixWorld(true);
  const groups = new Map();
  const visit = (o) => {
    if (o.userData.dyn || !o.visible) return;
    if (o.isMesh && !o.isInstancedMesh && !o.isSkinnedMesh && o !== scene) {
      const g = o.geometry, m = o.material;
      const ok = !Array.isArray(m) && !m.transparent && !m.clippingPlanes && o.renderOrder === 0 && !o.onBeforeRender.length
        && !Object.keys(g.morphAttributes).length && o.matrixWorld.determinant() > 0 && !m.isShaderMaterial;
      if (ok) {
        const key = m.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + '|' + (g.index ? 'i' : 'n') + '|' + Object.keys(g.attributes).sort().join(',');
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(scene);
  let removed = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => { const g = o.geometry.clone(); g.clearGroups(); g.applyMatrix4(o.matrixWorld); return g; });
    const merged = mergeGeometries(geos, false);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const src = list[0];
    const mesh = new THREE.Mesh(merged, src.material);
    mesh.castShadow = src.castShadow; mesh.receiveShadow = src.receiveShadow;
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    for (const o of list) o.parent.remove(o);
    scene.add(mesh);
    removed += list.length - 1;
  }
  // static meshes left alone never move either: skip their per-frame matrix work
  return removed;
}
