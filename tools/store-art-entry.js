// Draws the Play listing's feature graphic from the game's own Glowmark art (bundled by tools/store-art.cjs):
// Wren and the lantern's glow on plum, fluffmoths drifting in toward the light, and the game's name.
import { drawWren, drawCreature } from '../src/chars/glowmark.js';
import { PALETTE } from '../src/sprites.js';

const SERIF = "Georgia, 'Iowan Old Style', Charter, 'Bitstream Charter', serif";
const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function glow(ctx, x, y, r, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(242,176,76,${a})`);
  g.addColorStop(0.45, `rgba(242,176,76,${a * 0.35})`);
  g.addColorStop(1, 'rgba(242,176,76,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

function feature(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const k = h / 500;
  // the cave: plum, lightest round the lantern, darkest at the far edge
  const lx = 0.27 * w;
  const ly = 0.55 * h;
  const bg = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.85);
  bg.addColorStop(0, '#3D2B52');
  bg.addColorStop(0.45, PALETTE.plum);
  bg.addColorStop(1, '#120C1C');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  // the floor the light falls on
  ctx.save();
  ctx.globalAlpha = 0.5;
  const floor = ctx.createRadialGradient(lx, ly + 150 * k, 0, lx, ly + 150 * k, 300 * k);
  floor.addColorStop(0, 'rgba(122,92,88,0.9)');
  floor.addColorStop(1, 'rgba(122,92,88,0)');
  ctx.fillStyle = floor;
  ctx.beginPath();
  ctx.ellipse(lx, ly + 150 * k, 300 * k, 70 * k, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // Wren with the lantern lit
  const t = 250 * k;
  glow(ctx, lx + 0.05 * t, ly + 0.05 * t, t * 1.25, 0.55);
  drawWren(ctx, lx - 0.57 * t, ly - 0.52 * t, t, { dir: 'S', carrying: true, t: 0.6 });
  // fluffmoths on their way in to the light
  const moths = [[-0.62, -0.62, 0.34, 0.2], [0.52, -0.66, 0.3, 1.1], [0.74, 0.12, 0.26, 2.3], [-0.84, 0.18, 0.24, 3.1]];
  for (const [dx, dy, s, phase] of moths) {
    const size = s * t * 1.6;
    glow(ctx, lx + dx * t, ly + dy * t, size * 0.9, 0.22);
    drawCreature(ctx, 'M', lx + dx * t - size / 2, ly + dy * t - size / 2, size, { lit: true, t: phase });
  }
  // the name, and what the game is
  const tx = 0.525 * w;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = PALETTE.amber;
  ctx.shadowColor = 'rgba(242,176,76,0.55)';
  ctx.shadowBlur = 28 * k;
  // as big as fits, whatever serif this machine has, with a margin on the right
  let size = 80 * k;
  ctx.font = `700 ${size}px ${SERIF}`;
  const room = w - tx - 48 * k;
  const wide = ctx.measureText('Glimmerdeep').width;
  if (wide > room) size *= room / wide;
  ctx.font = `700 ${size}px ${SERIF}`;
  ctx.fillText('Glimmerdeep', tx, 0.47 * h);
  ctx.shadowBlur = 0;
  ctx.fillStyle = PALETTE.cream;
  ctx.font = `500 ${29 * k}px ${SANS}`;
  ctx.fillText('A cosy puzzle game about light', tx + 3 * k, 0.47 * h + 52 * k);
  ctx.globalAlpha = 0.75;
  ctx.font = `400 ${23 * k}px ${SANS}`;
  ctx.fillText('The creatures move themselves.', tx + 3 * k, 0.47 * h + 96 * k);
  ctx.fillText('You decide where the light is.', tx + 3 * k, 0.47 * h + 128 * k);
  ctx.globalAlpha = 1;
  return c.toDataURL('image/jpeg', 0.92);
}

window.__storeArt = { feature, ready: true };
