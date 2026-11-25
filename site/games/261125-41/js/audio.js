// Web Audio synthesis: all sounds generated, soft and gamey.
let ctx = null, master = null, comp = null, noiseBuf = null, pinkBuf = null;
let voices = 0;
const MAX_VOICES = 14;
const lastAt = {};
let ambient = null, wheelLoop = null;

export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ctx.createGain(); master.gain.value = 0.55;
      master.connect(comp); comp.connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      pinkBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const p = pinkBuf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; b0 = 0.997 * b0 + w * 0.03; b1 = 0.985 * b1 + w * 0.05; b2 = 0.95 * b2 + w * 0.1; p[i] = (b0 + b1 + b2) * 0.6; }
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch (e) { /* audio unavailable */ }
}

function ok(key, minGap) {
  if (!ctx || ctx.state !== 'running') return false;
  const t = ctx.currentTime;
  if (key && lastAt[key] !== undefined && t - lastAt[key] < minGap) return false;
  if (voices >= MAX_VOICES) return false;
  if (key) lastAt[key] = t;
  return true;
}
function track(node, dur) { voices++; setTimeout(() => { voices--; }, (dur + 0.05) * 1000); return node; }

function noise(t0, dur, { type = 'bandpass', f = 2000, q = 1, gain = 0.3, attack = 0.002, f2 = null, pink = false, rate = 1 } = {}) {
  const src = ctx.createBufferSource(); src.buffer = pink ? pinkBuf : noiseBuf; src.playbackRate.value = rate;
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.02);
  return g;
}
function tone(t0, dur, { f = 800, f2 = null, type = 'sine', gain = 0.2, attack = 0.005, vib = 0, out = master, curve = 'exp' } = {}) {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t0);
  if (f2) { if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(f2, t0 + dur); else o.frequency.linearRampToValueAtTime(f2, t0 + dur); }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  if (vib) { const l = ctx.createOscillator(); l.frequency.value = 18; const lg = ctx.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(o.frequency); l.start(t0); l.stop(t0 + dur); }
  o.connect(g); g.connect(out); o.start(t0); o.stop(t0 + dur + 0.02);
  return g;
}
const R = (a, b) => a + Math.random() * (b - a);

// ---- feeding sounds ----
export function seedCrack() {
  if (!ok('seed', 0.08)) return; const t = ctx.currentTime; track(null, 0.15);
  noise(t, 0.035, { type: 'highpass', f: 3500, gain: 0.5, q: 0.7 });
  tone(t, 0.03, { f: R(2600, 3400), f2: 1800, type: 'triangle', gain: 0.18 });
  noise(t + 0.04, 0.03, { type: 'bandpass', f: R(4000, 6000), q: 2, gain: 0.3 });
  noise(t + 0.075, 0.02, { type: 'bandpass', f: R(3000, 5000), q: 2, gain: 0.15 });
}
export function broccoli() {
  if (!ok('broc', 0.1)) return; const t = ctx.currentTime; track(null, 0.2);
  for (let i = 0; i < 4; i++) noise(t + i * 0.025 + R(0, 0.01), 0.05, { type: 'bandpass', f: R(1400, 2600), q: 1.2, gain: 0.28 - i * 0.05 });
  tone(t, 0.06, { f: 420, f2: 260, type: 'sine', gain: 0.08 });
}
export function carrot() {
  if (!ok('carrot', 0.1)) return; const t = ctx.currentTime; track(null, 0.2);
  noise(t, 0.012, { type: 'highpass', f: 2500, gain: 0.55 });
  noise(t + 0.008, 0.09, { type: 'bandpass', f: R(3000, 4200), f2: 1800, q: 1.4, gain: 0.35 });
  tone(t, 0.05, { f: R(900, 1100), f2: 600, type: 'triangle', gain: 0.12 });
  noise(t + 0.06, 0.05, { type: 'bandpass', f: 2400, q: 1.5, gain: 0.12 });
}
export function leaf() {
  if (!ok('leaf', 0.12)) return; const t = ctx.currentTime; track(null, 0.3);
  noise(t, 0.08, { type: 'highpass', f: 3200, gain: 0.25, attack: 0.01 });
  noise(t + 0.11, 0.08, { type: 'highpass', f: 3600, gain: 0.2, attack: 0.01 });
  noise(t + 0.01, 0.04, { type: 'bandpass', f: 1800, q: 2, gain: 0.12 });
}
export function gulp() {
  if (!ok('gulp', 0.15)) return; const t = ctx.currentTime; track(null, 0.3);
  tone(t, 0.16, { f: 340, f2: 120, type: 'sine', gain: 0.4, attack: 0.01 });
  tone(t + 0.1, 0.1, { f: 180, f2: 360, type: 'sine', gain: 0.15, attack: 0.01 });
}
export function peep(pitch = 1) {
  if (!ok('peep', 0.18)) return; const t = ctx.currentTime; track(null, 0.25);
  const f = 2100 * pitch * R(0.95, 1.05);
  const g = tone(t, 0.14, { f, f2: f * 1.25, type: 'sine', gain: 0.14, attack: 0.015, vib: 30, curve: 'lin' });
  tone(t + 0.02, 0.12, { f: f * 2, f2: f * 2.4, type: 'sine', gain: 0.025, attack: 0.015 });
}
export function snuffle(level = 0.5) {
  if (!ok('snuf', 0.25)) return; const t = ctx.currentTime; track(null, 0.25);
  for (let i = 0; i < 3; i++) noise(t + i * 0.055, 0.04, { type: 'bandpass', f: R(900, 1400), q: 1.5, gain: 0.12 * level, attack: 0.008 });
  tone(t + 0.05, 0.07, { f: R(1500, 1800), f2: 1300, gain: 0.03 * level, attack: 0.01 });
}
export function furRub() {
  if (!ok('rub', 0.3)) return; const t = ctx.currentTime; track(null, 0.4);
  noise(t, 0.35, { type: 'bandpass', f: 900, q: 0.8, gain: 0.06, attack: 0.08, pink: true });
}
export function rustle(kind = 'bedding', level = 1) {
  if (!ok('rustle' + kind, 0.25)) return; const t = ctx.currentTime; track(null, 0.7);
  const bright = kind === 'straw' ? 1.5 : 1;
  noise(t, 0.5, { type: 'bandpass', f: 1800 * bright, q: 0.6, gain: 0.08 * level, attack: 0.1, pink: true });
  for (let i = 0; i < 7; i++) noise(t + R(0, 0.45), 0.02, { type: 'bandpass', f: R(2500, 5000) * bright, q: 3, gain: 0.08 * level });
}
export function feather() {
  if (!ok('feather', 0.3)) return; const t = ctx.currentTime; track(null, 0.4);
  noise(t, 0.12, { type: 'bandpass', f: 1200, q: 0.7, gain: 0.08, attack: 0.03, pink: true });
  noise(t + 0.13, 0.12, { type: 'bandpass', f: 1400, q: 0.7, gain: 0.07, attack: 0.03, pink: true });
}
export function tick(level = 0.5) {
  if (!ok('tick', 0.06)) return; const t = ctx.currentTime; track(null, 0.1);
  tone(t, 0.05, { f: R(900, 1300), f2: 500, type: 'triangle', gain: 0.12 * level });
  noise(t, 0.02, { type: 'bandpass', f: 2500, q: 2, gain: 0.08 * level });
}
export function thump(level = 0.5) {
  if (!ok('thump', 0.08)) return; const t = ctx.currentTime; track(null, 0.15);
  tone(t, 0.1, { f: 140, f2: 60, gain: 0.3 * level, attack: 0.004 });
  noise(t, 0.06, { type: 'lowpass', f: 600, gain: 0.08 * level, pink: true });
}
export function pat(level = 0.4) {
  if (!ok('pat', 0.1)) return; const t = ctx.currentTime; track(null, 0.1);
  noise(t, 0.04, { type: 'lowpass', f: 900, gain: 0.12 * level, pink: true });
}
export function tok() {
  if (!ok('tok', 0.1)) return; const t = ctx.currentTime; track(null, 0.2);
  tone(t, 0.12, { f: 620, f2: 480, type: 'sine', gain: 0.18 });
  tone(t, 0.06, { f: 1240, f2: 900, type: 'sine', gain: 0.05 });
}
export function swoosh() {
  if (!ok('swoosh', 0.3)) return; const t = ctx.currentTime; track(null, 0.6);
  noise(t, 0.5, { type: 'bandpass', f: 500, f2: 1500, q: 0.8, gain: 0.05, attack: 0.2, pink: true });
}
export function splash() {
  if (!ok('splash', 0.4)) return; const t = ctx.currentTime; track(null, 1.0);
  noise(t, 0.6, { type: 'lowpass', f: 4000, f2: 400, gain: 0.35, attack: 0.01 });
  noise(t, 0.25, { type: 'bandpass', f: 1500, q: 0.7, gain: 0.2 });
  for (let i = 0; i < 8; i++) { const dt = R(0.05, 0.6); tone(t + dt, 0.05, { f: R(900, 2000), f2: R(1800, 3000), gain: 0.05, attack: 0.004 }); }
}
export function slide() {
  if (!ok('slide', 0.5)) return; const t = ctx.currentTime; track(null, 1.5);
  noise(t, 1.4, { type: 'bandpass', f: 2200, f2: 1200, q: 1, gain: 0.05, attack: 0.3 });
}
export function happy() {
  if (!ok('happy', 1)) return; const t = ctx.currentTime; track(null, 1.2);
  [0, 0.12, 0.24].forEach((d, i) => bell(t + d, [784, 988, 1175][i], 0.08, 1.0));
}
export function chime() {
  if (!ok('chime', 0.3)) return; const t = ctx.currentTime; track(null, 1);
  bell(t, 1319, 0.05, 0.8);
}

// ---- wheel loop ----
export function wheel(on) {
  if (!ctx) return;
  if (on && !wheelLoop) {
    const src = ctx.createBufferSource(); src.buffer = pinkBuf; src.loop = true;
    const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 260;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(fl); fl.connect(g); g.connect(master); src.start();
    wheelLoop = { src, g, fl, speed: 0, next: ctx.currentTime, sq: ctx.currentTime + 0.8, timer: null };
    wheelLoop.timer = setInterval(() => {
      if (!wheelLoop) return;
      const now = ctx.currentTime;
      if (wheelLoop.speed > 0.1 && now >= wheelLoop.next) {
        tone(now, 0.03, { f: 1500, f2: 800, type: 'triangle', gain: 0.05 * wheelLoop.speed });
        wheelLoop.next = now + 0.12 / wheelLoop.speed;
      }
      if (wheelLoop.speed > 0.4 && now >= wheelLoop.sq) {
        tone(now, 0.18, { f: R(1100, 1300), f2: R(1400, 1600), gain: 0.025, attack: 0.05, curve: 'lin' });
        wheelLoop.sq = now + R(0.7, 1.4);
      }
    }, 30);
  } else if (!on && wheelLoop) {
    const w = wheelLoop; wheelLoop = null;
    clearInterval(w.timer);
    w.g.gain.setTargetAtTime(0, ctx.currentTime, 0.1);
    setTimeout(() => { try { w.src.stop(); } catch (e) {} }, 600);
  }
}
export function wheelSpeed(s) { if (wheelLoop) { wheelLoop.speed = s; wheelLoop.g.gain.setTargetAtTime(0.25 * s, ctx.currentTime, 0.05); } }

// ---- ambience ----
export function setAmbient(kind) {
  if (!ctx) { pendingAmbient = kind; return; }
  if (ambient && ambient.kind === kind) return;
  if (ambient) {
    const a = ambient; a.g.gain.setTargetAtTime(0, ctx.currentTime, 0.4);
    setTimeout(() => { try { a.src.stop(); a.lfo.stop(); } catch (e) {} }, 2000);
    ambient = null;
  }
  if (!kind) return;
  const cfg = { hamster: [350, 0.035], rabbit: [600, 0.04], penguin: [900, 0.06], home: [500, 0.03], finale: [300, 0.03] }[kind] || [500, 0.03];
  const src = ctx.createBufferSource(); src.buffer = pinkBuf; src.loop = true; src.playbackRate.value = 0.5;
  const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = cfg[0];
  const g = ctx.createGain(); g.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = cfg[1] * 0.5;
  lfo.connect(lg); lg.connect(g.gain);
  src.connect(fl); fl.connect(g); g.connect(master);
  src.start(); lfo.start();
  g.gain.setTargetAtTime(cfg[1], ctx.currentTime, 0.8);
  ambient = { kind, src, g, lfo };
}
let pendingAmbient = null;
export function flushAmbient() { if (pendingAmbient !== null && ctx) { const k = pendingAmbient; pendingAmbient = null; setAmbient(k); } }

// ---- music box finale ----
function bell(t, f, gain, dur) {
  const out = ctx.createGain(); out.gain.value = 1; out.connect(master);
  [[1, 1], [2.76, 0.35], [5.4, 0.12], [2, 0.18]].forEach(([m, a], i) => {
    tone(t, dur * (i === 0 ? 1 : 0.45), { f: f * m * (1 + (Math.random() - 0.5) * 0.002), gain: gain * a, attack: 0.003, out });
  });
}
export function musicBox() {
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.3;
  // original gentle lullaby in C major pentatonic, ~12 s
  const N = { C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880, C6: 1046.5, G4: 392, A4: 440, E4: 329.63, C4: 261.63, D6: 1174.66, E6: 1318.5 };
  const mel = [
    ['E5', 0, 1], ['G5', 1, 1], ['A5', 2, 1], ['G5', 3, 2], ['E5', 5, 1], ['D5', 6, 2],
    ['C5', 8, 1], ['D5', 9, 1], ['E5', 10, 1], ['G5', 11, 2], ['E5', 13, 1], ['D5', 14, 2],
    ['E5', 16, 1], ['G5', 17, 1], ['C6', 18, 1], ['A5', 19, 2], ['G5', 21, 1], ['E5', 22, 2],
    ['D5', 24, 1], ['E5', 25, 1], ['D5', 26, 1], ['C5', 27, 4],
  ];
  const bass = [['C4', 0], ['G4', 4], ['A4', 8], ['E4', 12], ['C4', 16], ['A4', 20], ['G4', 24], ['C4', 27]];
  const beat = 0.4;
  for (const [n, b, len] of mel) bell(t0 + b * beat + (Math.random() - 0.5) * 0.015, N[n], 0.07, 1.6 + len * 0.3);
  for (const [n, b] of bass) bell(t0 + b * beat, N[n], 0.035, 2.4);
}
