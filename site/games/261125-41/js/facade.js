// Home facade (house front with three windows). No three.js dependency, so boot.js can
// paint it at once while the 3D code is still downloading.

// window placeholders shown until each room's 3D scene is ready (tinted like that room's backdrop)
const VEIL_TINT = ['#cdb79a', '#bfd2c4', '#c9d6e0'];
let veilWrap = null;
const veils = [];

export function paintFacade(state, W, H) {
  const land = W > H;
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
  drawFacade(state, W, H, roofH, frame);
  placeVeils(rects);
}

function drawFacade(state, W, H, roofH, frame) {
  const facadeEl = document.getElementById('facade');
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

// ---------- window placeholders ----------
function placeVeils(rects) {
  if (!veilWrap) {
    veilWrap = document.getElementById('veils');
    for (let i = 0; i < 3; i++) {
      const v = document.createElement('div');
      v.className = 'veil';
      v.style.setProperty('--tint', VEIL_TINT[i]);
      v.innerHTML = '<span><i></i><i></i><i></i></span>';
      veilWrap.appendChild(v);
      veils.push(v);
    }
  }
  rects.forEach((r, i) => {
    const s = veils[i].style;
    s.left = r.x + 'px'; s.top = r.y + 'px'; s.width = r.w + 'px'; s.height = r.h + 'px';
    s.borderRadius = Math.min(18, r.w * 0.05) + 'px';
  });
}
// the room behind window i can now be drawn: fade its placeholder out
export function revealWindow(i) {
  const v = veils[i];
  if (!v || v.classList.contains('off')) return;
  v.classList.remove('wait');
  v.classList.add('off');
  setTimeout(() => { v.style.display = 'none'; }, 700);
}
// the player tapped a window that is still loading: show it is coming
export function markWaiting(i) { const v = veils[i]; if (v && !v.classList.contains('off')) v.classList.add('wait'); }
