// どうぶつのごはん - main app
import * as THREE from 'three';
import { RoomEnvironment } from '../lib/RoomEnvironment.js';
import { HamsterRoom, RabbitRoom, PenguinRoom, fitCamera } from './rooms.js';
import { Finale } from './finale.js';
import { paintFacade, revealWindow, markWaiting } from './facade.js';
import * as SFX from './audio.js';
import { clamp, lerp, smooth, easeInOut, easeOut, damp } from './util.js';

const $ = (id) => document.getElementById(id);
const canvas = $('c'), facadeEl = $('facade'), veilsEl = $('veils'), homeBtn = $('homeBtn'), handEl = $('hand'), fadeEl = $('fade');
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
  // rooms are built one by one in the background; a slot stays null until its room is ready
  view: 'home', active: 0, t: 0, rooms: [null, null, null], finale: null, loading: true, want: -1,
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
  paintFacade(state, W, H);
}
// the house front and the window placeholders show and hide together
function showFacade(on) { const o = on ? '1' : '0'; facadeEl.style.opacity = o; veilsEl.style.opacity = o; }

// ---------- scenes ----------
// The house front is on screen from the start. The three rooms are then made one after
// another, the heavy procedural parts in small time slices between frames, so whatever is
// already on screen keeps moving; each window opens as soon as its room is ready.
const ROOMS = [HamsterRoom, RabbitRoom, PenguinRoom];
let env = null;
const portrait = window.innerWidth / window.innerHeight < 0.9;
// Between slices the browser gets a turn (input, and a frame whenever one is due); a message
// channel resumes without setTimeout's clamping. Loading may take only so much time per frame:
// little while a room is being played, more on the house front, a lot while nothing moves yet.
const chan = new MessageChannel(), chanQ = [];
chan.port1.onmessage = () => { const r = chanQ.shift(); r && r(); };
let workSinceFrame = 0, sliceStart = performance.now(), drawMs = 0, frameGap = 16.7, lastFrameAt = 0;
// a minimum share per frame, or whatever main-thread time is left before the next frame is due
// (when the GPU sets the pace, the gap between frames is long and the CPU would otherwise idle)
const frameBudget = () => Math.max(state.view !== 'home' ? 6 : state.rooms.some(Boolean) ? 12 : 60, frameGap - drawMs - 4);
const nextSlice = () => new Promise((res) => {
  workSinceFrame += performance.now() - sliceStart;
  const r = () => { sliceStart = performance.now(); res(); };
  if (!document.hidden && workSinceFrame >= frameBudget()) requestAnimationFrame(() => setTimeout(r, 0));
  else { chanQ.push(r); chan.port2.postMessage(0); }
});
const SLICE = 8; // ms of work before giving the browser a turn
async function runSliced(gen) {
  let t0 = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (performance.now() - t0 > SLICE) { await nextSlice(); t0 = performance.now(); }
  }
}
// upload a scene's textures to the GPU a few at a time (otherwise they all go up in its first frame)
async function uploadTextures(scene) {
  const seen = new Set();
  scene.traverse((o) => {
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) for (const k in m) { const v = m[k]; if (v && v.isTexture && !v.isRenderTargetTexture) seen.add(v); }
  });
  let t0 = performance.now();
  for (const t of seen) {
    renderer.initTexture(t);
    if (performance.now() - t0 > SLICE) { await nextSlice(); t0 = performance.now(); }
  }
}
async function loadRoom(i) {
  await runSliced(ROOMS[i].prepare());
  await nextSlice();
  const room = new ROOMS[i](env, portrait);
  room.optimize();
  room.index = i;
  room.animal.onSleep = () => onAnimalSleep(i);
  room.animal.inst.setShells(homeShells());
  await nextSlice();
  room.camera.aspect = 1; room.camera.updateProjectionMatrix();
  await renderer.compileAsync(room.scene, room.camera);
  await uploadTextures(room.scene);
  await nextSlice();
  state.rooms[i] = room;
  // the window opens once the room has been drawn behind it
  await nextSlice();
  revealWindow(i);
  if (state.want === i) { state.want = -1; if (state.view === 'home') goRoom(i); }
}
async function loadAll() {
  env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  await nextSlice();
  for (;;) {
    // a window the player tapped comes first, then the rest in order
    let i = state.want >= 0 && !state.rooms[state.want] ? state.want : state.rooms.findIndex((r) => !r);
    if (i < 0) break;
    await loadRoom(i);
  }
  window.__ready = true;
}
// the finale is needed only much later: prepare it quietly too
async function prepareFinale() {
  await runSliced(Finale.prepare());
  if (!state.finale && state.view !== 'toFinale') {
    await nextSlice();
    const f = new Finale(env);
    for (const a of f.animals) a.inst.setShells(finaleShells());
    f.fit(W / H);
    await renderer.compileAsync(f.scene, f.camera);
    await uploadTextures(f.scene);
    if (!state.finale) state.finale = f;
  }
  state.loading = false;
  state.frameTimes.length = 0; state.bootAt = performance.now();
}

const homeShells = () => (state.quality >= 2 ? 3 : 2);
const finaleShells = () => (state.quality >= 2 ? 5 : state.quality === 1 ? 3 : 2);
function setShellsHome() { const n = homeShells(); state.rooms.forEach((r) => r && r.animal.inst.setShells(n)); }
function setShellsFinale() { if (!state.finale) return; const n = finaleShells(); for (const a of state.finale.animals) a.inst.setShells(n); }
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
  const room = state.rooms[i];
  // still being made: remember the wish, it opens as soon as it is ready
  if (!room) { state.want = i; markWaiting(i); SFX.tok(); return; }
  state.active = i; state.view = 'zoomIn'; state.t = 0;
  SFX.tok();
  showFacade(false);
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
  if (state.rooms.every((r) => r && r.animal.asleep) && state.roundShown !== state.finaleRound) {
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
    const i = state.winRects.findIndex((r) => e.clientX >= r.x - 8 && e.clientX <= r.x + r.w + 8 && e.clientY >= r.y - 8 && e.clientY <= r.y + r.h + 8);
    if (i >= 0) goRoom(i);
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
window.addEventListener('resize', () => { layout(); for (const r of state.rooms) if (r) r.camState = null; });

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
    const asleep = state.rooms.filter((r) => r && r.animal.asleep).length;
    const key = 'home:' + state.finaleRound + ':' + asleep;
    if (state.demoDone[key]) return;
    const idx = state.rooms.findIndex((r) => r && !r.animal.asleep);
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
  // frames are uneven while rooms are still being made in the background: judge only afterwards
  if (state.loading || performance.now() - state.bootAt < 4000) return;
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
  workSinceFrame = 0;
  let dt = Math.min(params.has('debug') ? +(params.get('cap') || 0.25) : 0.05, (tn - last) / 1000); last = tn;
  if (!params.has('debug')) trackPerf(dt);
  stepFrame(dt);
  drawMs = lerp(drawMs, performance.now() - tn, 0.2);
  if (lastFrameAt) frameGap = lerp(frameGap, Math.min(100, tn - lastFrameAt), 0.2);
  lastFrameAt = tn;
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
      if (!room) continue;
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
      if (i === state.active || !state.rooms[i]) continue;
      const room = state.rooms[i];
      applyCam(room, roomCam(room, state.winRects[i], 0), 2, dt);
      renderRect(room.scene, room.camera, state.winRects[i], false); // frozen during the zoom
    }
    const room = state.rooms[state.active];
    room.update(dt);
    const rect = lerpRect(state.winRects[state.active], fullRect(), e);
    applyCam(room, roomCam(room, rect, e), 0, dt);
    renderRect(room.scene, room.camera, rect);
    if (v === 'zoomOut' && u > 0.55) showFacade(true);
    if (u >= 1) {
      if (v === 'zoomIn') { state.view = 'room'; showHomeBtn(true); }
      else { state.view = 'home'; setShellsHome(); for (const r of state.rooms) if (r) r.camState = null; }
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
      showFacade(false);
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
      showFacade(true); fadeEl.style.opacity = '0';
      setShellsHome(); for (const r of state.rooms) if (r) r.camState = null;
      SFX.setAmbient('home');
    }
  }
  if (v === 'home' || v === 'room') state.prevDraw = v === 'home' ? drawHomeStatic : drawRoomStatic;
  updateDemo(dt);
}
function drawHomeStatic(dt) { for (let i = 0; i < 3; i++) { const room = state.rooms[i]; if (!room) continue; applyCam(room, roomCam(room, state.winRects[i], 0), 2, dt); renderRect(room.scene, room.camera, state.winRects[i], false); } }
function drawRoomStatic(dt) { const room = state.rooms[state.active]; room.update(dt); applyCam(room, roomCam(room, fullRect(), 1), 0, dt); renderRect(room.scene, room.camera, fullRect()); }

// ---------- boot ----------
(async () => {
  // take over from boot.js (which painted the house front and noted any early tap)
  window.removeEventListener('resize', window.__bootResize);
  gameEl.removeEventListener('pointerdown', window.__bootDown);
  if (window.__bootTap != null) { state.want = window.__bootTap; markWaiting(state.want); }
  layout();
  state.bootAt = performance.now();
  SFX.setAmbient('home');
  requestAnimationFrame(frame);
  const loading = loadAll();
  loading.then(prepareFinale);
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
  await loading;
  const dbg = params.get('debug');
  if (dbg && dbg.startsWith('room')) window.__game.room(+dbg.slice(4));
  if (dbg === 'finale') window.__game.finale();
})();
