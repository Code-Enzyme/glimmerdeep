// Draws the launcher icon and splash images from the game's own Glowmark art (bundled by make-icons.cjs).
import { drawWren } from '../src/chars/glowmark.js';
import { PALETTE } from '../src/sprites.js';

const PLUM = PALETTE.plum;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function glow(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(242,176,76,${a})`);
  g.addColorStop(0.45, `rgba(242,176,76,${a * 0.35})`);
  g.addColorStop(1, 'rgba(242,176,76,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function backdrop(ctx, w, h) {
  const r = Math.hypot(w, h) / 2;
  const g = ctx.createRadialGradient(w / 2, h * 0.46, 0, w / 2, h / 2, r);
  g.addColorStop(0, '#3D2B52');
  g.addColorStop(0.55, PLUM);
  g.addColorStop(1, '#170F22');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Wren facing the viewer with a lit lantern; (cx, cy) is the centre of the figure, t the tile size.
function wren(ctx, cx, cy, t) {
  // the lantern hangs to the right, so the figure sits a little left of centre to look balanced
  const x = cx - 0.07 * t;
  glow(ctx, x + 0.12 * t, cy + 0.05 * t, t * 0.95, 0.5);
  drawWren(ctx, x - 0.5 * t, cy - 0.52 * t, t, { dir: 'S', carrying: true, t: 0.6 });
}

// type: 'image/png' or 'image/webp' (lossy, keeps alpha; the glows' fine dithering makes PNGs huge)
function render(kind, w, h, type = 'image/png') {
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  const s = Math.min(w, h);
  if (kind === 'foreground') {
    // adaptive icon foreground: 108 units, keep the figure inside the 66-unit safe circle
    wren(ctx, w / 2, h / 2, s * 0.52);
  } else if (kind === 'legacy' || kind === 'round') {
    ctx.save();
    ctx.beginPath();
    if (kind === 'round') ctx.arc(w / 2, h / 2, s / 2, 0, Math.PI * 2);
    else ctx.roundRect(0, 0, w, h, s * 0.18);
    ctx.clip();
    backdrop(ctx, w, h);
    wren(ctx, w / 2, h / 2, s * 0.82);
    ctx.restore();
  } else if (kind === 'store') {
    // Play Store listing icon: full square, the store applies its own mask
    backdrop(ctx, w, h);
    wren(ctx, w / 2, h / 2, s * 0.78);
  } else if (kind === 'splash') {
    // transparent: drawable/splash.xml puts it in the middle of a plain plum screen
    wren(ctx, w / 2, h / 2, s * 0.62);
  }
  return type === 'image/webp' ? c.toDataURL(type, 0.9) : c.toDataURL(type);
}

window.__icons = { render, ready: true };
