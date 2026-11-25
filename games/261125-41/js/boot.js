// Boot: paint the house front right away (tiny, no three.js), then load the 3D game.
import { paintFacade, markWaiting } from './facade.js';

const boot = { winRects: [], lampRect: null, finaleReached: false };
window.__boot = boot;
paintFacade(boot, window.innerWidth, window.innerHeight);
// keep the placeholder layout right if the screen turns before the game takes over
window.__bootResize = () => paintFacade(boot, window.innerWidth, window.innerHeight);
window.addEventListener('resize', window.__bootResize);
// taps on windows before the game module runs are remembered and honoured once it can
window.__bootTap = null;
window.__bootDown = (e) => {
  const i = boot.winRects.findIndex((r) => e.clientX >= r.x - 8 && e.clientX <= r.x + r.w + 8 && e.clientY >= r.y - 8 && e.clientY <= r.y + r.h + 8);
  if (i >= 0) { window.__bootTap = i; markWaiting(i); }
};
document.getElementById('game').addEventListener('pointerdown', window.__bootDown);

import('./main.js');
