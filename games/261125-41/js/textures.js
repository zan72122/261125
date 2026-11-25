// Procedural canvas textures
import * as THREE from 'three';
import { makeCanvas, canvasTex, rng, makeNoise2D, fbm, heightToNormal, clamp, lerp } from './util.js';

const cache = {};
function once(key, fn) { return cache[key] || (cache[key] = fn()); }

// Fur strand texture: R = strand height (dots), G = per-strand tone, B = directional streaks, A = 1
export function furStrandTex(seed = 7) {
  return once('fur' + seed, () => {
    const N = 256;
    const hgt = new Float32Array(N * N);
    const tone = new Float32Array(N * N).fill(0.5);
    const r = rng(seed);
    const count = 2600;
    for (let i = 0; i < count; i++) {
      const cx = r() * N, cy = r() * N, rad = 1.6 + r() * 2.2, h = 0.55 + r() * 0.45, tn = r();
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx + (cx % 1) - 0.5, dy + (cy % 1) - 0.5) / rad;
        if (d >= 1) continue;
        const x = ((Math.floor(cx) + dx) % N + N) % N, y = ((Math.floor(cy) + dy) % N + N) % N;
        const v = h * (1 - d * d);
        if (v > hgt[x + y * N]) { hgt[x + y * N] = v; tone[x + y * N] = tn; }
      }
    }
    const nz = makeNoise2D(seed + 3, 64);
    const c = makeCanvas(N, N);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = x + y * N;
      // streaks: stretched noise along y
      const s = fbm(nz, x / 4, y / 32, 3);
      img.data[i * 4] = clamp(hgt[i], 0, 1) * 255;
      img.data[i * 4 + 1] = tone[i] * 255;
      img.data[i * 4 + 2] = s * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = canvasTex(c, { srgb: false });
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  });
}

// Wood: returns {map, normalMap, roughnessMap}
const woodKey = (seed = 1, base = [176, 122, 74], dark = [120, 76, 40], { planks = 0 } = {}) => 'wood' + seed + base + dark + planks;
export function woodTex(...args) {
  const k = woodKey(...args);
  return cache[k] || (cache[k] = runSync(woodGen(...args)));
}
// sliced version for background loading: yields every few rows, fills the same cache
export function* woodTexSteps(...args) {
  const k = woodKey(...args);
  if (!cache[k]) cache[k] = yield* woodGen(...args);
  return cache[k];
}
function runSync(gen) { let r; while (!(r = gen.next()).done); return r.value; }
function* woodGen(seed = 1, base = [176, 122, 74], dark = [120, 76, 40], { w = 512, h = 512, rings = 9, planks = 0 } = {}) {
  {
    const nz = makeNoise2D(seed, 64), nz2 = makeNoise2D(seed + 9, 128);
    const c = makeCanvas(w, h);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(w, h);
    const hgt = new Float32Array(w * h);
    const rr = rng(seed + 2);
    const plankOff = [];
    for (let p = 0; p < 16; p++) plankOff.push(rr() * 100);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (x === 0 && (y & 15) === 15) yield;
      const u = x / w, v = y / h;
      let pi = 0, gapD = 1;
      if (planks > 0) {
        pi = Math.floor(u * planks);
        const fu = u * planks - pi;
        gapD = Math.min(fu, 1 - fu) * w / planks;
      }
      const warp = fbm(nz, u * 6 + plankOff[pi], v * 1.5, 4) * 3;
      const ring = (u * rings + warp + plankOff[pi] * 0.1);
      const g = Math.pow(0.5 + 0.5 * Math.sin(ring * Math.PI * 2), 3);
      const fine = fbm(nz2, u * 60 + plankOff[pi], v * 4, 3);
      let t = clamp(g * 0.55 + fine * 0.5, 0, 1);
      let cr = lerp(base[0], dark[0], t), cg = lerp(base[1], dark[1], t), cb = lerp(base[2], dark[2], t);
      const tint = 0.92 + 0.16 * fbm(nz, pi * 3.1 + 0.3, v * 0.5, 2);
      cr *= tint; cg *= tint; cb *= tint;
      let hh = 1 - t * 0.5 - fine * 0.2;
      if (planks > 0 && gapD < 1.8) { const k = gapD / 1.8; cr *= 0.45 + 0.55 * k; cg *= 0.45 + 0.55 * k; cb *= 0.45 + 0.55 * k; hh *= k; }
      const i = (x + y * w) * 4;
      img.data[i] = clamp(cr, 0, 255); img.data[i + 1] = clamp(cg, 0, 255); img.data[i + 2] = clamp(cb, 0, 255); img.data[i + 3] = 255;
      hgt[x + y * w] = hh;
    }
    ctx.putImageData(img, 0, 0);
    const map = canvasTex(c);
    yield;
    const normalMap = canvasTex(heightToNormal(hgt, w, h, 3), { srgb: false });
    yield;
    const rc = makeCanvas(w, h); const rctx = rc.getContext('2d'); const rimg = rctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) { const v = (0.62 + (1 - hgt[i]) * 0.3) * 255; rimg.data[i * 4] = v; rimg.data[i * 4 + 1] = v; rimg.data[i * 4 + 2] = v; rimg.data[i * 4 + 3] = 255; }
    rctx.putImageData(rimg, 0, 0);
    const roughnessMap = canvasTex(rc, { srgb: false });
    return { map, normalMap, roughnessMap };
  }
}

// generic noisy surface (rocks, plaster, ice)
export function noiseTex(seed, c0, c1, { size = 256, scale = 8, oct = 5, contrast = 1, normalStrength = 2, speck = 0 } = {}) {
  return once('noise' + seed + c0 + c1 + scale, () => {
    const nz = makeNoise2D(seed, Math.max(1, Math.round(scale)));
    const c = makeCanvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const hgt = new Float32Array(size * size);
    const r = rng(seed + 1);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let t = fbm(nz, x / size * Math.round(scale), y / size * Math.round(scale), oct);
      t = clamp((t - 0.5) * contrast + 0.5, 0, 1);
      if (speck && r() < speck) t = clamp(t + (r() - 0.5) * 0.8, 0, 1);
      const i = (x + y * size) * 4;
      img.data[i] = lerp(c0[0], c1[0], t); img.data[i + 1] = lerp(c0[1], c1[1], t); img.data[i + 2] = lerp(c0[2], c1[2], t); img.data[i + 3] = 255;
      hgt[x + y * size] = t;
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTex(c), normalMap: canvasTex(heightToNormal(hgt, size, size, normalStrength), { srgb: false }) };
  });
}

// paper bedding scrap texture (soft fibrous)
export function paperTex() {
  return once('paper', () => {
    const S = 128, nz = makeNoise2D(41, 32);
    const c = makeCanvas(S, S); const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const t = fbm(nz, x / 6, y / 6, 4);
      const v = 225 + (t - 0.5) * 50;
      const i = (x + y * S) * 4;
      img.data[i] = v; img.data[i + 1] = v * 0.97; img.data[i + 2] = v * 0.9; img.data[i + 3] = 255;
      hgt[x + y * S] = t;
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTex(c), normalMap: canvasTex(heightToNormal(hgt, S, S, 4), { srgb: false }) };
  });
}

// Straw blade texture (along u)
export function strawTex() {
  return once('straw', () => {
    const W = 64, H = 256; const nz = makeNoise2D(5, 32);
    const c = makeCanvas(W, H); const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const s = fbm(nz, x / 2, y / 40, 3);
      const vein = 0.85 + 0.15 * Math.sin(x / W * Math.PI * 10);
      const i = (x + y * W) * 4;
      img.data[i] = (205 + s * 40) * vein; img.data[i + 1] = (170 + s * 40) * vein; img.data[i + 2] = (95 + s * 30) * vein; img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvasTex(c);
  });
}

// Dappled sunlight cookie
export function cookieTex() {
  return once('cookie', () => {
    const S = 256; const c = makeCanvas(S, S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0, S, S);
    const r = rng(77);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const x = r() * S, y = r() * S, rad = 8 + r() * 26;
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, 'rgba(255,250,235,0.85)'); g.addColorStop(0.55, 'rgba(255,245,225,0.55)'); g.addColorStop(1, 'rgba(255,240,220,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.fill();
    }
    // vignette to spotlight edge
    ctx.globalCompositeOperation = 'multiply';
    const g = ctx.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S * 0.5);
    g.addColorStop(0, '#fff'); g.addColorStop(1, '#000');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    const t = canvasTex(c);
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    return t;
  });
}

export function softDotTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  return once('dot' + inner, () => {
    const S = 64; const c = makeCanvas(S, S); const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, inner); g.addColorStop(0.35, inner.replace(/[\d.]+\)$/, '0.5)')); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    return canvasTex(c, { repeat: false });
  });
}

// Fleece blanket texture: color, normal
export function fleeceTex(col = [236, 214, 196]) {
  return once('fleece', () => {
    const S = 256; const r = rng(91);
    const hgt = new Float32Array(S * S);
    for (let i = 0; i < 9000; i++) {
      const cx = r() * S, cy = r() * S, rad = 1.5 + r() * 2.5;
      const R = Math.ceil(rad);
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const d = Math.hypot(dx, dy) / rad; if (d >= 1) continue;
        const x = ((Math.floor(cx) + dx) % S + S) % S, y = ((Math.floor(cy) + dy) % S + S) % S;
        hgt[x + y * S] = Math.max(hgt[x + y * S], (1 - d * d) * (0.5 + r() * 0.5));
      }
    }
    const nz = makeNoise2D(13, 16);
    const c = makeCanvas(S, S); const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = x + y * S; const k = 0.82 + hgt[i] * 0.2 + (fbm(nz, x / 32, y / 32, 2) - 0.5) * 0.08;
      img.data[i * 4] = clamp(col[0] * k, 0, 255); img.data[i * 4 + 1] = clamp(col[1] * k, 0, 255); img.data[i * 4 + 2] = clamp(col[2] * k, 0, 255); img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTex(c), normalMap: canvasTex(heightToNormal(hgt, S, S, 2.5), { srgb: false }) };
  });
}

// Leaf: color map + normal (veins)
export function leafTex() {
  return once('leaf', () => {
    const S = 256; const nz = makeNoise2D(21, 32);
    const c = makeCanvas(S, S); const ctx = c.getContext('2d'); const img = ctx.createImageData(S, S);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const u = x / S - 0.5, v = y / S; // v along leaf (0 base -> 1 tip)
      const mid = Math.exp(-Math.pow(u / 0.018, 2));
      const side = Math.abs(u);
      const veinPhase = (v * 7 - side * 9);
      const vein = Math.exp(-Math.pow((veinPhase - Math.round(veinPhase)) / 0.06, 2)) * (side < 0.45 ? 1 : 0) * 0.6;
      const crinkle = fbm(nz, x / 10, y / 10, 4);
      const t = clamp(mid * 0.9 + vein * 0.5, 0, 1);
      const light = 0.75 + crinkle * 0.35 + side * 0.25;
      const i = (x + y * S) * 4;
      img.data[i] = clamp(lerp(120, 205, t) * light, 0, 255);
      img.data[i + 1] = clamp(lerp(190, 235, t) * light, 0, 255);
      img.data[i + 2] = clamp(lerp(80, 160, t) * light, 0, 255);
      img.data[i + 3] = 255;
      hgt[x + y * S] = crinkle * 0.8 + t * 0.6;
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTex(c, { repeat: false }), normalMap: canvasTex(heightToNormal(hgt, S, S, 3), { srgb: false, repeat: false }) };
  });
}

// Leaf alpha masks with progressive irregular bites from the top (tip near mouth)
export function leafMasks(seed) {
  const S = 256; const r = rng(seed);
  const masks = [];
  const bites = [];
  // leaf outline: wavy ellipse in uv (u across, v along)
  const outline = (ctx) => {
    ctx.beginPath();
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const wob = 1 + 0.06 * Math.sin(a * 9 + seed) + 0.04 * Math.sin(a * 17 + seed * 2);
      const x = S / 2 + Math.cos(a) * S * 0.46 * wob;
      const y = S * 0.52 + Math.sin(a) * S * 0.47 * wob;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.closePath();
  };
  for (let stage = 0; stage < 4; stage++) {
    // each stage adds a scalloped bite band at increasing depth from tip (y=0 side = tip held at mouth)
    const depth = (stage + 1) * 0.25;
    const arcs = [];
    const nA = 4 + Math.floor(r() * 3);
    for (let k = 0; k < nA; k++) {
      arcs.push({ x: (k + 0.5 + (r() - 0.5) * 0.6) / nA, d: depth * (0.85 + r() * 0.3), rad: 0.12 + r() * 0.1 });
    }
    bites.push(arcs);
  }
  for (let stage = 0; stage <= 4; stage++) {
    const c = makeCanvas(S, S); const ctx = c.getContext('2d');
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#fff'; outline(ctx); ctx.fill();
    ctx.fillStyle = '#000';
    for (let b = 0; b < stage; b++) {
      // bite region: everything above a scalloped line at depth
      const arcs = bites[b];
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(S, 0);
      const dAvg = arcs.reduce((s, a) => s + a.d, 0) / arcs.length;
      ctx.lineTo(S, dAvg * S * 0.9);
      ctx.lineTo(0, dAvg * S * 0.9);
      ctx.closePath(); ctx.fill();
      for (const a of arcs) { ctx.beginPath(); ctx.arc(a.x * S, a.d * S * 0.9, a.rad * S, 0, Math.PI * 2); ctx.fill(); }
    }
    if (stage === 4) { ctx.fillRect(0, 0, S, S); }
    const t = canvasTex(c, { srgb: false, repeat: false });
    masks.push(t);
  }
  return masks;
}

// fish skin: silver-blue with scales, dark back
export function fishTex() {
  return once('fish', () => {
    const W = 256, H = 128; const nz = makeNoise2D(31, 32);
    const c = makeCanvas(W, H); const ctx = c.getContext('2d'); const img = ctx.createImageData(W, H);
    const hgt = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H; // v: 0 = back(top), 1 = belly
      const sx = x / 7, sy = y / 7 + ((Math.floor(x / 7) % 2) * 0.5);
      const sc = Math.pow(Math.abs(Math.sin(sy * Math.PI)) * Math.abs(Math.sin(sx * Math.PI)), 0.3);
      const back = clamp((0.42 - v) / 0.25, 0, 1);
      const stripe = Math.exp(-Math.pow((v - 0.45) / 0.05, 2));
      const n = fbm(nz, x / 12, y / 12, 3);
      let r_ = lerp(205, 45, back), g_ = lerp(214, 78, back), b_ = lerp(222, 120, back);
      r_ = lerp(r_, 90, stripe * 0.5); g_ = lerp(g_, 140, stripe * 0.5); b_ = lerp(b_, 175, stripe * 0.5);
      const k = 0.85 + sc * 0.15 + (n - 0.5) * 0.15;
      const i = (x + y * W) * 4;
      img.data[i] = clamp(r_ * k, 0, 255); img.data[i + 1] = clamp(g_ * k, 0, 255); img.data[i + 2] = clamp(b_ * k, 0, 255); img.data[i + 3] = 255;
      hgt[x + y * W] = sc;
    }
    ctx.putImageData(img, 0, 0);
    return { map: canvasTex(c, { repeat: false }), normalMap: canvasTex(heightToNormal(hgt, W, H, 1.5), { srgb: false, repeat: false }) };
  });
}

// soft star sprite
export function starTex() {
  return once('star', () => {
    const S = 64; const c = makeCanvas(S, S); const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    g.addColorStop(0, 'rgba(255,255,240,1)'); g.addColorStop(0.15, 'rgba(255,250,220,0.8)'); g.addColorStop(0.4, 'rgba(255,240,200,0.15)'); g.addColorStop(1, 'rgba(255,240,200,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
    ctx.strokeStyle = 'rgba(255,250,230,0.5)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(S / 2, 6); ctx.lineTo(S / 2, S - 6); ctx.moveTo(6, S / 2); ctx.lineTo(S - 6, S / 2); ctx.stroke();
    return canvasTex(c, { repeat: false });
  });
}

// water normal map (tileable)
export function waterNormalTex() {
  return once('waterN', () => {
    const S = 256; const nz = makeNoise2D(55, 32);
    const hgt = new Float32Array(S * S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) hgt[x + y * S] = fbm(nz, x / S * 32, y / S * 32, 4);
    return canvasTex(heightToNormal(hgt, S, S, 6), { srgb: false });
  });
}
