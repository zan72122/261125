// どうぶつのごはん - main app
import * as THREE from 'three';
import { RoomEnvironment } from '../lib/RoomEnvironment.js';
import { HamsterRoom, RabbitRoom, PenguinRoom, fitCamera } from './rooms.js';
import { Finale } from './finale.js';
import * as SFX from './audio.js';
import { clamp, lerp, smooth, easeInOut, easeOut, damp } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c'), facadeEl = $('facade'), homeBtn = $('homeBtn'), handEl = $('hand'), fadeEl = $('fade'), loadingEl = $('loading');
const params = new URLSearchParams(location.search);

// ---------- renderer ----------
// opaque canvas: the page behind it is the same flat colour, and an opaque layer is cheaper to composite on iOS
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance', stencil: false });
// resolution: at most 1.5x, and at most ~2.3M pixels (large iPads), lowered step by step if frames run slow
const PIXEL_BUDGET = 2.3e6;
const DPR_STEPS = [1.5, 1.35, 1.2, 1.0];
let dprStep = 0;
function targetDpr() {
  const dev = window.devicePixelRatio || 1;
  const area = Math.max(1, window.innerWidth * window.innerHeight);
  return Math.max(Math.min(1, dev), Math.min(dev, DPR_STEPS[dprStep], Math.sqrt(PIXEL_BUDGET / area)));
}
renderer.setPixelRatio(targetDpr());
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// shadow maps are refreshed only for scenes that actually moved this frame (see renderRect)
renderer.shadowMap.autoUpdate = false;
renderer.localClippingEnabled = true;
renderer.autoClear = false;
renderer.setClearColor(0x2b201a, 1);

let W = 1, H = 1;
const state = {
  view: 'loading', active: 0, t: 0, rooms: [], finale: null,
  finaleReached: false, finaleRound: 0, roundShown: -1, finaleTimer: -1,
  lastInput: performance.now() / 1000, demoDone: {}, demo: null,
  winRects: [], lampRect: null, quality: 2, frameTimes: [],
};
let cameraSmooth = [];

// ---------- facade (home screen) ----------
function layout() {
  W = window.innerWidth; H = window.innerHeight;
  renderer.setPixelRatio(targetDpr());
  renderer.setSize(W, H, false);
  const land = W > H;
  const safeTop = 0;
  const roofH = Math.max(52, Math.min(H * 0.1, 96));
  const m = Math.max(12, Math.min(W, H) * 0.035);
  const frame = Math.max(10, Math.min(W, H) * 0.022);
  const rects = [];
  if (!land) {
    const top = roofH + m * 0.6, bottom = H - m;
    const gap = m + frame * 1.6;
    const hh = (bottom - top - gap * 2) / 3;
    for (let i = 0; i < 3; i++) rects.push({ x: m + frame, y: top + i * (hh + gap), w: W - 2 * (m + frame), h: hh - frame * 0.6 });
  } else {
    const top = roofH + m * 0.6, bottom = H - m - frame * 1.2;
    const gap = m + frame * 1.8;
    const ww = (W - 2 * (m + frame) - gap * 2) / 3;
    for (let i = 0; i < 3; i++) rects.push({ x: m + frame + i * (ww + gap), y: top + frame * 0.4, w: ww, h: bottom - top - frame });
  }
  state.winRects = rects;
  const lr = Math.max(20, roofH * 0.32);
  state.lampRect = { x: W / 2 - lr, y: roofH * 0.42 - lr, w: lr * 2, h: lr * 2, cx: W / 2, cy: roofH * 0.42, r: lr };
  drawFacade(roofH, frame);
}

function drawFacade(roofH, frame) {
  const rects = state.winRects;
  const L = state.lampRect;
  let holes = '', frames = '', sills = '', glass = '';
  rects.forEach((r, i) => {
    const rad = Math.min(18, r.w * 0.05);
    holes += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="${rad}" fill="#000"/>`;
    frames += `<rect x="${r.x - frame / 2}" y="${r.y - frame / 2}" width="${r.w + frame}" height="${r.h + frame}" rx="${rad + frame / 2}" fill="none" stroke="url(#fr)" stroke-width="${frame}"/>`;
    frames += `<rect x="${r.x - frame}" y="${r.y - frame}" width="${r.w + frame * 2}" height="${r.h + frame * 2}" rx="${rad + frame}" fill="none" stroke="rgba(60,35,18,0.35)" stroke-width="1.5"/>`;
    frames += `<rect x="${r.x + 1}" y="${r.y + 1}" width="${r.w - 2}" height="${r.h - 2}" rx="${rad}" fill="none" stroke="rgba(0,0,0,0.28)" stroke-width="3"/>`;
    sills += `<rect x="${r.x - frame * 1.6}" y="${r.y + r.h + frame * 0.55}" width="${r.w + frame * 3.2}" height="${frame * 0.9}" rx="${frame * 0.3}" fill="url(#sill)"/>`;
    glass += `<path d="M${r.x + r.w * 0.06} ${r.y + r.h} L${r.x + r.w * 0.38} ${r.y} L${r.x + r.w * 0.52} ${r.y} L${r.x + r.w * 0.2} ${r.y + r.h} Z" fill="url(#gl)"/>`;
  });
  const lampLit = state.finaleReached;
  const lamp = `<g id="lampwin">
    <circle cx="${L.cx}" cy="${L.cy}" r="${L.r + 5}" fill="#7a5032" stroke="#4a2e1a" stroke-width="1.5"/>
    <circle cx="${L.cx}" cy="${L.cy}" r="${L.r}" fill="${lampLit ? 'url(#lampg)' : '#2a2340'}"/>
    ${lampLit ? '' : `<circle cx="${L.cx + L.r * 0.3}" cy="${L.cy - L.r * 0.3}" r="1.6" fill="#fff6d0" opacity="0.8"/><circle cx="${L.cx - L.r * 0.35}" cy="${L.cy + L.r * 0.1}" r="1.1" fill="#fff6d0" opacity="0.6"/>`}
    ${lampLit ? '' : `<path d="M${L.cx - L.r} ${L.cy} H${L.cx + L.r} M${L.cx} ${L.cy - L.r} V${L.cy + L.r}" stroke="#7a5032" stroke-width="2.5"/>`}
  </g>`;
  // lit lamp: the pulsing halo is a separate compositor-animated layer (an SVG <animate> would
  // re-rasterise the whole masked facade every frame); the bulb details sit above it as before
  const lampTop = lampLit ? `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;left:0;top:0">
      <path d="M${L.cx - L.r * 0.35} ${L.cy - L.r * 0.05} L${L.cx + L.r * 0.35} ${L.cy - L.r * 0.05} L${L.cx + L.r * 0.22} ${L.cy - L.r * 0.45} L${L.cx - L.r * 0.22} ${L.cy - L.r * 0.45} Z" fill="#fff0c8"/>
      <rect x="${L.cx - 1.5}" y="${L.cy - L.r * 0.05}" width="3" height="${L.r * 0.55}" fill="#8a6038"/>
      <path d="M${L.cx - L.r} ${L.cy} H${L.cx + L.r} M${L.cx} ${L.cy - L.r} V${L.cy + L.r}" stroke="#7a5032" stroke-width="2.5"/></svg>` : '';
  const hr = L.r * 2.4;
  const halo = lampLit ? `<div class="halo" style="left:${L.cx - hr}px;top:${L.cy - hr}px;width:${hr * 2}px;height:${hr * 2}px"></div>` : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <pattern id="sid" width="${W}" height="26" patternUnits="userSpaceOnUse">
      <rect width="${W}" height="26" fill="#d9b48a"/><rect y="0" width="${W}" height="3" fill="#c49a6c"/><rect y="3" width="${W}" height="2" fill="#e6c49c" opacity="0.6"/>
    </pattern>
    <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.25"/><stop offset="0.15" stop-color="#000" stop-opacity="0"/><stop offset="0.85" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.18"/></linearGradient>
    <linearGradient id="roof" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8e4a36"/><stop offset="1" stop-color="#6e3426"/></linearGradient>
    <pattern id="shing" width="34" height="16" patternUnits="userSpaceOnUse"><rect width="34" height="16" fill="url(#roof)"/><path d="M0 15.5 H34 M17 0 V8 M0 8 H34 M8 8 V16 M26 8 V16" stroke="#5a2a1e" stroke-width="1.2" opacity="0.55"/></pattern>
    <linearGradient id="fr" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbf3e4"/><stop offset="1" stop-color="#e3cfae"/></linearGradient>
    <linearGradient id="sill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f6ead4"/><stop offset="1" stop-color="#c8ab84"/></linearGradient>
    <linearGradient id="gl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.07"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="lampg"><stop offset="0" stop-color="#fff4c8"/><stop offset="0.6" stop-color="#ffc66e"/><stop offset="1" stop-color="#e08a3a"/></radialGradient>
    <radialGradient id="halo"><stop offset="0.3" stop-color="#ffd48a" stop-opacity="0.6"/><stop offset="1" stop-color="#ffd48a" stop-opacity="0"/></radialGradient>
    <mask id="holes"><rect width="${W}" height="${H}" fill="#fff"/>${holes}</mask>
  </defs>
  <g mask="url(#holes)">
    <rect width="${W}" height="${H}" fill="url(#sid)"/>
    <rect width="${W}" height="${H}" fill="url(#shade)"/>
    <rect width="${W}" height="${roofH}" fill="url(#shing)"/>
    <rect y="${roofH - 6}" width="${W}" height="8" fill="#4e2a1c"/>
    <rect y="${roofH + 2}" width="${W}" height="10" fill="#000" opacity="0.12"/>
    <path d="M${W / 2 - roofH * 1.4} ${roofH} L${W / 2} ${-roofH * 0.15} L${W / 2 + roofH * 1.4} ${roofH} Z" fill="#c89a6a" stroke="#6e3426" stroke-width="6" stroke-linejoin="round"/>
  </g>
  ${sills}${frames}${glass}${lamp}
  </svg>`;
  facadeEl.innerHTML = svg + halo + lampTop;
}

// ---------- scenes ----------
let env = null;
async function build() {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const pmrem = new THREE.PMREMGenerator(renderer);
  env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  await tick();
  const portrait = window.innerWidth / window.innerHeight < 0.9;
  state.rooms.push(new HamsterRoom(env, portrait)); await tick();
  state.rooms.push(new RabbitRoom(env, portrait)); await tick();
  state.rooms.push(new PenguinRoom(env, portrait)); await tick();
  state.rooms.forEach((room, i) => {
    room.optimize();
    room.index = i;
    room.animal.onSleep = () => onAnimalSleep(i);
  });
  layout();
  setShellsHome();
  // pre-compile
  for (const r of state.rooms) { r.camera.aspect = 1; r.camera.updateProjectionMatrix(); renderer.compile(r.scene, r.camera); }
}

function setShellsHome() { const n = state.quality >= 2 ? 3 : 2; state.rooms.forEach((r) => r.animal.inst.setShells(n)); }
function setShellsFinale() { if (!state.finale) return; const n = state.quality >= 2 ? 5 : state.quality === 1 ? 3 : 2; for (const a of state.finale.animals) a.inst.setShells(n); }
function setShellsRoom(room) { const n = state.quality >= 2 ? 5 : state.quality === 1 ? 3 : 2; room.animal.inst.setShells(n); }

// ---------- camera helpers ----------
function roomCam(room, rect, blendRoom) {
  const aspect = rect.w / rect.h;
  if (window.__closeup && blendRoom > 0.99) {
    const h = room.animal.proxHead.getWorldPosition(new THREE.Vector3());
    const pts = []; const s = room.animal.kind === 'hamster' ? 0.3 : 0.45;
    for (const sx of [-1, 1]) for (const sy of [-1.3, 0.7]) pts.push(new THREE.Vector3(h.x + sx * s, h.y + sy * s, h.z));
    const c = fitCamera(pts, aspect, room.camCfg, 0.95);
    return { pos: c.pos, tgt: c.target, fov: c.fov, aspect };
  }
  const a = fitCamera(room.homePoints(), aspect, room.camCfg, 0.86, 0.75);
  const b = fitCamera(room.keyPoints, aspect, room.camCfg, 0.95, 0.5);
  const k = blendRoom;
  const pos = a.pos.clone().lerp(b.pos, k), tgt = a.target.clone().lerp(b.target, k);
  const fov = lerp(a.fov, b.fov, k);
  return { pos, tgt, fov, aspect };
}
function applyCam(room, c, smoothRate, dt) {
  const cam = room.camera;
  if (!room.camState || smoothRate <= 0) room.camState = { pos: c.pos.clone(), tgt: c.tgt.clone(), fov: c.fov };
  else {
    const k = 1 - Math.exp(-smoothRate * dt);
    room.camState.pos.lerp(c.pos, k); room.camState.tgt.lerp(c.tgt, k); room.camState.fov = lerp(room.camState.fov, c.fov, k);
  }
  cam.position.copy(room.camState.pos); cam.lookAt(room.camState.tgt);
  cam.fov = room.camState.fov; cam.aspect = c.aspect; cam.updateProjectionMatrix();
}
function renderRect(scene, cam, r, shadows = true) {
  const y = H - (r.y + r.h);
  renderer.shadowMap.needsUpdate = shadows || !scene.userData.shadowReady;
  scene.userData.shadowReady = true;
  renderer.setViewport(r.x, y, r.w, r.h);
  renderer.setScissor(r.x, y, r.w, r.h);
  renderer.setScissorTest(true);
  renderer.render(scene, cam);
}
const fullRect = () => ({ x: 0, y: 0, w: W, h: H });
const lerpRect = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), w: lerp(a.w, b.w, t), h: lerp(a.h, b.h, t) });

// ---------- views ----------
function showHomeBtn(on) {
  if (on) { homeBtn.classList.add('show'); requestAnimationFrame(() => homeBtn.classList.add('vis')); }
  else { homeBtn.classList.remove('vis'); setTimeout(() => { if (!homeBtn.classList.contains('vis')) homeBtn.classList.remove('show'); }, 400); }
}
function goRoom(i) {
  if (state.view !== 'home') return;
  cancelDemo();
  state.active = i; state.view = 'zoomIn'; state.t = 0;
  const room = state.rooms[i];
  SFX.tok();
  facadeEl.style.opacity = '0';
  setShellsRoom(room);
  // replay after finale: food reappears and the sleeping animal wakes gently
  if (state.finaleReached && room.animal.asleep) {
    room.replayFoods();
    room.animal.wakeForReplay();
    state.finaleRound++;
  } else room.animal.enter();
  SFX.setAmbient(room.kind);
}
function goHome() {
  if (state.view === 'room') {
    cancelDemo(); endDrag(true);
    state.view = 'zoomOut'; state.t = 0;
    showHomeBtn(false);
    SFX.setAmbient('home');
  } else if (state.view === 'finale') {
    state.view = 'finaleOut'; state.t = 0;
    fadeEl.style.opacity = '1';
    showHomeBtn(false);
  }
}
function goFinale() {
  if (state.view === 'finale' || state.view === 'toFinale') return;
  cancelDemo(); endDrag(true);
  state.view = 'toFinale'; state.t = 0;
  fadeEl.style.opacity = '1';
  showHomeBtn(false);
}
function onAnimalSleep(i) {
  if (state.rooms.every((r) => r.animal.asleep) && state.roundShown !== state.finaleRound) {
    state.finaleTimer = state.view === 'home' ? 1.5 : 4.5;
  }
}

// ---------- input ----------
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let ptr = null; // active pointer info
let drag = null;
function toNDC(x, y) { ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1); return ndc; }
function project(room, v) { const p = v.clone().project(room.camera); return { x: (p.x + 1) / 2 * W, y: (1 - p.y) / 2 * H, z: p.z }; }

function onDown(e) {
  if (ptr) return;
  e.preventDefault();
  SFX.unlock(); SFX.flushAmbient();
  ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, moved: 0, kind: null };
  try { e.target.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  state.lastInput = now();
  cancelDemo();
  if (state.view === 'home') {
    const L = state.lampRect;
    if (state.finaleReached && Math.hypot(e.clientX - L.cx, e.clientY - L.cy) < L.r * 1.6) { SFX.chime(); goFinale(); return; }
    state.winRects.forEach((r, i) => { if (e.clientX >= r.x - 8 && e.clientX <= r.x + r.w + 8 && e.clientY >= r.y - 8 && e.clientY <= r.y + r.h + 8) goRoom(i); });
    return;
  }
  if (state.view !== 'room') return;
  const room = state.rooms[state.active];
  // food pick (generous radius, nearest)
  const R = Math.max(64, Math.min(W, H) * 0.11);
  let best = null, bd = R;
  const a = room.animal;
  if (!a.asleep) {
    for (const f of room.foods) {
      if (f.state !== 'dish' && f.state !== 'return') continue;
      const p = project(room, f.obj.getWorldPosition(new THREE.Vector3()));
      const d = Math.hypot(p.x - e.clientX, p.y - e.clientY);
      if (d < bd) { bd = d; best = f; }
    }
  }
  if (best) { startDrag(room, best, e.clientX, e.clientY); return; }
  // animal petting
  ray.setFromCamera(toNDC(e.clientX, e.clientY), room.camera);
  const hits = ray.intersectObjects([a.proxHead, a.proxBack], false);
  if (hits.length) { ptr.kind = 'pet'; ptr.part = hits[0].object.userData.part; ptr.petT = 0; }
}
function onMove(e) {
  if (!ptr || e.pointerId !== ptr.id) return;
  e.preventDefault();
  const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  ptr.moved += Math.hypot(dx, dy);
  ptr.x = e.clientX; ptr.y = e.clientY;
  state.lastInput = now();
  if (ptr.kind === 'pet' && state.view === 'room') {
    const room = state.rooms[state.active];
    if (ptr.moved > 22) {
      ray.setFromCamera(toNDC(e.clientX, e.clientY), room.camera);
      const hits = ray.intersectObjects([room.animal.proxHead, room.animal.proxBack], false);
      if (hits.length) {
        const part = hits[0].object.userData.part;
        if (!ptr.stroking || ptr.moved - (ptr.lastStroke || 0) > 30) { room.animal.pet(part, 'stroke'); ptr.lastStroke = ptr.moved; ptr.stroking = true; if (Math.random() < 0.25) SFX.furRub(); }
      }
    }
  }
}
function onUp(e) {
  if (!ptr || e.pointerId !== ptr.id) return;
  e.preventDefault();
  if (ptr.kind === 'pet' && !ptr.stroking && state.view === 'room') {
    const room = state.rooms[state.active];
    room.animal.pet(ptr.part, 'tap');
  }
  if (drag) endDrag(false);
  ptr = null;
}
const gameEl = $('game');
gameEl.addEventListener('pointerdown', onDown, { passive: false });
gameEl.addEventListener('pointermove', onMove, { passive: false });
gameEl.addEventListener('pointerup', onUp, { passive: false });
gameEl.addEventListener('pointercancel', onUp, { passive: false });
homeBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); SFX.unlock(); SFX.tok(); state.lastInput = now(); goHome(); });
for (const ev of ['touchstart', 'touchmove', 'gesturestart', 'gesturechange', 'contextmenu', 'dblclick', 'selectstart']) document.addEventListener(ev, (e) => { if (e.cancelable) e.preventDefault(); }, { passive: false });
window.addEventListener('resize', () => { if (state.view !== 'loading') { layout(); for (const r of state.rooms) r.camState = null; } });

function startDrag(room, food, x, y) {
  ptr.kind = 'food';
  food.state = 'drag';
  drag = { room, food, x, y, demo: false };
  SFX.tick(0.35);
}
function endDrag(instant) {
  if (!drag) return;
  const { room, food } = drag;
  if (food.state === 'drag' || food.state === 'demo') food.state = 'return';
  room.animal.setTracking(null);
  drag = null;
}
const _plane = new THREE.Plane(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _n = new THREE.Vector3();
function updateDrag(dt) {
  if (!drag) return;
  const { room, food } = drag;
  if (food.state !== 'drag' && food.state !== 'demo') { drag = null; return; }
  const px = drag.demo ? drag.x : ptr ? ptr.x : drag.x, py = drag.demo ? drag.y : ptr ? ptr.y : drag.y;
  const lift = Math.max(46, Math.min(W, H) * 0.08);
  const cam = room.camera;
  const mouth = room.animal.mouthWorld(_v2);
  cam.getWorldDirection(_n);
  _plane.setFromNormalAndCoplanarPoint(_n.clone().negate(), mouth);
  ray.setFromCamera(toNDC(px, py - lift), cam);
  const hit = ray.ray.intersectPlane(_plane, _v);
  if (hit) {
    hit.y = Math.max(hit.y, 0.06);
    food.obj.position.lerp(hit, 1 - Math.exp(-18 * dt));
  }
  // gently turn the food so it reads well while carried
  food.obj.rotation.x = damp(food.obj.rotation.x, food.type === 'carrot' ? 0.3 : food.type === 'seed' ? 0.2 : 0, 6, dt);
  food.obj.rotation.z = damp(food.obj.rotation.z, food.type === 'fish' || food.type === 'shrimp' ? 0.25 : 0, 6, dt);
  const fw = food.obj.getWorldPosition(new THREE.Vector3());
  room.animal.setTracking(fw);
  // snap zone near the mouth
  if (!drag.demo) {
    const pm = project(room, mouth), pf = project(room, fw);
    const sd = Math.hypot(pm.x - pf.x, pm.y - pf.y);
    const snapR = Math.max(70, Math.min(W, H) * 0.14);
    if (sd < snapR && room.animal.accepting()) {
      if (room.animal.tryReceive(food)) { drag = null; state.lastInput = now(); }
    }
  }
}

// ---------- idle demo hand ----------
function now() { return performance.now() / 1000; }
function cancelDemo() {
  if (!state.demo) return;
  const d = state.demo; state.demo = null;
  handEl.style.opacity = '0';
  if (d.food && (d.food.state === 'demo')) { d.food.state = 'return'; d.room.animal.setTracking(null); if (drag && drag.demo) drag = null; }
}
function updateDemo(dt) {
  const t = now();
  if (state.demo) {
    const d = state.demo; d.t += dt;
    if (d.room && (state.view !== 'room' || (!d.room.animal.accepting() && d.food.state !== 'demo'))) { cancelDemo(); return; }
    const u = d.t / d.dur;
    let x, y, s = 1, o = 0.85;
    if (u < 0.2) { const k = u / 0.2; x = d.a.x; y = d.a.y; o = 0.85 * smooth(k * 2); s = 1 - 0.12 * smooth((k - 0.5) * 2); }
    else if (u < 0.8) { const k = easeInOut((u - 0.2) / 0.6); x = lerp(d.a.x, d.b.x, k); y = lerp(d.a.y, d.b.y, k) - Math.sin(k * Math.PI) * 50; s = 0.88; }
    else { x = d.b.x; y = d.b.y; s = 0.88 + 0.12 * smooth((u - 0.8) / 0.2); o = 0.85 * (1 - smooth((u - 0.8) / 0.2)); }
    handEl.style.opacity = String(o);
    handEl.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    if (d.food) {
      if (u >= 0.2 && u < 0.8 && d.food.state === 'dish') { d.food.state = 'demo'; drag = { room: d.room, food: d.food, x, y, demo: true }; }
      if (drag && drag.demo) { drag.x = x; drag.y = y; }
      if (u >= 0.8 && d.food.state === 'demo') { d.food.state = 'return'; d.room.animal.setTracking(null); drag = null; }
    } else if (d.tap && u > 0.45 && !d.tapped) { d.tapped = true; }
    if (u >= 1) { state.demo = null; handEl.style.opacity = '0'; }
    return;
  }
  if (t - state.lastInput < 8 || ptr) return;
  if (state.view === 'room') {
    const room = state.rooms[state.active], a = room.animal;
    if (!a.accepting()) return;
    const eaten = room.foods.filter((f) => f.state === 'gone').length;
    const key = room.kind + ':' + state.finaleRound + ':' + eaten;
    if (state.demoDone[key]) return;
    const food = room.foods.find((f) => f.state === 'dish');
    if (!food) return;
    state.demoDone[key] = true;
    const p = project(room, food.obj.getWorldPosition(new THREE.Vector3()));
    const m = project(room, a.mouthWorld(new THREE.Vector3()));
    const lift = Math.max(46, Math.min(W, H) * 0.08);
    state.demo = { t: 0, dur: 1.9, a: { x: p.x, y: p.y }, b: { x: m.x, y: m.y + lift * 0.6 }, food, room };
  } else if (state.view === 'home') {
    const asleep = state.rooms.filter((r) => r.animal.asleep).length;
    const key = 'home:' + state.finaleRound + ':' + asleep;
    if (state.demoDone[key]) return;
    const idx = state.rooms.findIndex((r) => !r.animal.asleep);
    if (idx < 0) return;
    state.demoDone[key] = true;
    const r = state.winRects[idx];
    const c = { x: r.x + r.w * 0.5, y: r.y + r.h * 0.55 };
    state.demo = { t: 0, dur: 1.6, a: { x: c.x + 40, y: c.y + 60 }, b: c, tap: true };
  }
}

// ---------- quality ----------
// Watch steady frame times; when frames run long, first lower the resolution a notch,
// then (only at the lowest resolution) thin the fur shells. A display locked at 30 fps
// (iOS Low Power Mode) is recognised and does not push the quality further down.
function trackPerf(dt) {
  if (state.view !== 'home' && state.view !== 'room' && state.view !== 'finale') { state.frameTimes.length = 0; return; }
  if (performance.now() - state.bootAt < 4000) return;
  state.frameTimes.push(dt);
  if (state.frameTimes.length < 90) return;
  const ft = state.frameTimes;
  const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
  const locked30 = ft.filter((t) => t > 0.03 && t < 0.037).length > ft.length * 0.85;
  ft.length = 0;
  if (avg <= 0.024) return;
  if (dprStep < DPR_STEPS.length - 1 && targetDpr() > Math.min(1, window.devicePixelRatio || 1)) {
    const before = targetDpr();
    while (dprStep < DPR_STEPS.length - 1 && targetDpr() >= before - 0.01) dprStep++;
    renderer.setPixelRatio(targetDpr()); renderer.setSize(W, H, false);
    return;
  }
  if (locked30 || state.quality <= 0) return;
  state.quality--;
  if (state.view === 'room') setShellsRoom(state.rooms[state.active]); else if (state.view === 'finale') setShellsFinale(); else setShellsHome();
}

// ---------- main loop ----------
let last = performance.now();
let frameNo = 0;
function frame() {
  requestAnimationFrame(frame);
  const tn = performance.now();
  let dt = Math.min(params.has('debug') ? +(params.get('cap') || 0.25) : 0.05, (tn - last) / 1000); last = tn;
  if (state.view === 'loading') return;
  if (!params.has('debug')) trackPerf(dt);
  stepFrame(dt);
}
function stepFrame(dt) {
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, W, H);
  renderer.clear(true, true, true);
  const v = state.view;
  state.t += dt;
  if (state.finaleTimer > 0) {
    state.finaleTimer -= dt;
    if (state.finaleTimer <= 0 && (state.view === 'room' || state.view === 'home') && !drag) goFinale();
    else if (state.finaleTimer <= 0) state.finaleTimer = 0.5;
  }
  frameNo++;
  if (v === 'home') {
    for (let i = 0; i < 3; i++) {
      const room = state.rooms[i];
      room.update(dt);
      const r = state.winRects[i];
      applyCam(room, roomCam(room, r, 0), 2, dt);
      // small windows: each room's shadows refresh every other frame (staggered)
      renderRect(room.scene, room.camera, r, (frameNo + i) % 2 === 0);
    }
  } else if (v === 'zoomIn' || v === 'zoomOut') {
    const D = 0.6;
    const u = clamp(state.t / D, 0, 1);
    const e = v === 'zoomIn' ? easeInOut(u) : 1 - easeInOut(u);
    for (let i = 0; i < 3; i++) {
      if (i === state.active) continue;
      const room = state.rooms[i];
      applyCam(room, roomCam(room, state.winRects[i], 0), 2, dt);
      renderRect(room.scene, room.camera, state.winRects[i], false); // frozen during the zoom
    }
    const room = state.rooms[state.active];
    room.update(dt);
    const rect = lerpRect(state.winRects[state.active], fullRect(), e);
    applyCam(room, roomCam(room, rect, e), 0, dt);
    renderRect(room.scene, room.camera, rect);
    if (v === 'zoomOut' && u > 0.55) facadeEl.style.opacity = '1';
    if (u >= 1) {
      if (v === 'zoomIn') { state.view = 'room'; showHomeBtn(true); }
      else { state.view = 'home'; setShellsHome(); for (const r of state.rooms) r.camState = null; }
      state.t = 0;
    }
  } else if (v === 'room') {
    const room = state.rooms[state.active];
    updateDrag(dt);
    room.update(dt);
    applyCam(room, roomCam(room, fullRect(), 1), 0, dt);
    renderRect(room.scene, room.camera, fullRect());
  } else if (v === 'toFinale') {
    // keep drawing the current view while fading out
    if (state.prevDraw) state.prevDraw(dt);
    if (state.t > 0.8) {
      if (!state.finale) state.finale = new Finale(env);
      setShellsFinale();
      state.finale.start();
      state.view = 'finale'; state.t = 0;
      state.finaleReached = true; state.roundShown = state.finaleRound;
      facadeEl.style.opacity = '0';
      fadeEl.style.opacity = '0';
      SFX.setAmbient('finale');
      SFX.musicBox();
      setTimeout(() => { if (state.view === 'finale') showHomeBtn(true); }, 2500);
    }
  } else if (v === 'finale' || v === 'finaleOut') {
    const f = state.finale;
    f.update(dt);
    f.fit(W / H);
    renderRect(f.scene, f.camera, fullRect(), frameNo % 2 === 0); // sleepers barely move
    if (v === 'finaleOut' && state.t > 0.8) {
      layout();
      state.view = 'home'; state.t = 0;
      facadeEl.style.opacity = '1'; fadeEl.style.opacity = '0';
      setShellsHome(); for (const r of state.rooms) r.camState = null;
      SFX.setAmbient('home');
    }
  }
  if (v === 'home' || v === 'room') state.prevDraw = v === 'home' ? drawHomeStatic : drawRoomStatic;
  updateDemo(dt);
}
function drawHomeStatic(dt) { for (let i = 0; i < 3; i++) { const room = state.rooms[i]; applyCam(room, roomCam(room, state.winRects[i], 0), 2, dt); renderRect(room.scene, room.camera, state.winRects[i], false); } }
function drawRoomStatic(dt) { const room = state.rooms[state.active]; room.update(dt); applyCam(room, roomCam(room, fullRect(), 1), 0, dt); renderRect(room.scene, room.camera, fullRect()); }

// ---------- boot ----------
(async () => {
  layout();
  await build();
  state.view = 'home';
  state.bootAt = performance.now();
  loadingEl.style.opacity = '0';
  setTimeout(() => { loadingEl.style.display = 'none'; }, 700);
  SFX.setAmbient('home');
  requestAnimationFrame(frame);
  // debug hooks
  window.__game = {
    state, renderer,
    step(n = 1, dt = 1 / 30) { for (let i = 0; i < n; i++) stepFrame(dt); },
    room(i) { state.view = 'home'; goRoom(i); state.t = 0.6; },
    home() { goHome(); },
    finale() { for (const r of state.rooms) if (!r.animal.asleep) r.animal.sleepNow(); goFinale(); },
    feed(i, n = 1) {
      const room = state.rooms[i];
      const f = room.foods.filter((x) => x.state === 'dish')[n - 1] || room.foods.find((x) => x.state === 'dish');
      if (!f) return false;
      const a = room.animal;
      a.main = null; a.now('lift', 0); a.now('emergeTilt', 0); a.now('earFlat', 0);
      a.root.position.set(a.homeSpot[0], 0, a.homeSpot[1]); a.yaw = 0;
      if (room.mound) room.mound.set(0);
      a.state = 'idle';
      return room.animal.tryReceive(f);
    },
    sleepAll() { for (const r of state.rooms) { for (const f of r.foods) f.done(); r.animal.sleepNow(); } },
    demo() { state.lastInput = -100; },
    autoFeed(i) {
      const room = state.rooms[i];
      const h = setInterval(() => {
        if (room.foods.every((x) => x.state === 'gone')) { clearInterval(h); return; }
        const f = room.foods.find((x) => x.state === 'dish');
        if (!f) return;
        if (room.animal.accepting()) room.animal.tryReceive(f);
      }, 200);
    },
    screen(i) {
      const room = state.rooms[i];
      const f = room.foods.find((x) => x.state === 'dish');
      const fp = f ? project(room, f.obj.getWorldPosition(new THREE.Vector3())) : null;
      const mp = project(room, room.animal.mouthWorld(new THREE.Vector3()));
      return { food: fp, mouth: mp };
    },
    info(i) { const a = state.rooms[i].animal; return { state: a.state, asleep: a.asleep, pos: a.root.position.toArray().map((v) => +v.toFixed(2)), foods: state.rooms[i].foods.map((f) => f.state) }; },
  };
  window.__ready = true;
  const dbg = params.get('debug');
  if (dbg && dbg.startsWith('room')) window.__game.room(+dbg.slice(4));
  if (dbg === 'finale') window.__game.finale();
})();
