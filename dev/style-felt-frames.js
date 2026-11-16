// Scratch: animation strips for the felt style (rows = character/state, columns = time samples).
import * as felt from '../src/chars/felt.js';
import { drawTile, drawBackdrop } from '../src/sprites.js';
const ROWS = [
  ['wren S', (c, x, y, s, t) => felt.drawWren(c, x, y, s, { t, dir: 'S', carrying: true })],
  ['wren E', (c, x, y, s, t) => felt.drawWren(c, x, y, s, { t, dir: 'E', carrying: true })],
  ['wren N empty', (c, x, y, s, t) => felt.drawWren(c, x, y, s, { t, dir: 'N', carrying: false })],
  ['wren W hush', (c, x, y, s, t) => felt.drawWren(c, x, y, s, { t, dir: 'W', carrying: true, smothered: true })],
  ['moth lit', (c, x, y, s, t) => felt.drawCreature(c, 'M', x, y, s, { t, lit: true })],
  ['moth dark', (c, x, y, s, t) => felt.drawCreature(c, 'M', x, y, s, { t, lit: false })],
  ['whelk out', (c, x, y, s, t) => felt.drawCreature(c, 'S', x, y, s, { t, lit: false })],
  ['stump E awake', (c, x, y, s, t) => felt.drawCreature(c, 'T', x, y, s, { t, dir: 'E', lit: true })],
  ['stump S awake', (c, x, y, s, t) => felt.drawCreature(c, 'T', x, y, s, { t, dir: 'S', lit: true })],
  ['stump N asleep', (c, x, y, s, t) => felt.drawCreature(c, 'T', x, y, s, { t, dir: 'N', lit: false })],
  ['lantern', (c, x, y, s, t) => felt.drawLantern(c, x, y, s, { t })],
];
const S = 56;
const N = 7;
const cv = document.createElement('canvas');
const W = 40 + N * (S + 4);
const H = ROWS.length * (S + 6) + 8;
cv.width = W * 2;
cv.height = H * 2;
cv.style.width = W + 'px';
document.body.appendChild(cv);
const ctx = cv.getContext('2d');
ctx.setTransform(2, 0, 0, 2, 0, 0);
drawBackdrop(ctx, W, H, { t: 0 });
ROWS.forEach(([name, fn], r) => {
  const y = 4 + r * (S + 6);
  for (let i = 0; i < N; i++) {
    const x = 40 + i * (S + 4);
    const t = 0.1 + i * 0.19;
    drawTile(ctx, 'floor', x, y, S, { t, seed: i + r * 9 });
    fn(ctx, x, y, S, t);
  }
  ctx.fillStyle = '#F4EAD5';
  ctx.font = '9px sans-serif';
  ctx.fillText(name.split(' ')[0], 2, y + S / 2);
  ctx.fillText(name.split(' ').slice(1).join(' '), 2, y + S / 2 + 11);
});
window.__done = true;
// paint-cost probe: fresh sizes so every call is a cache miss
const probe = {};
const c2 = document.createElement('canvas').getContext('2d');
c2.setTransform(2, 0, 0, 2, 0, 0);
let sz = 50;
for (const [name, fn] of ROWS) {
  sz += 1;
  const a = performance.now();
  for (let i = 0; i < 12; i++) fn(c2, 0, 0, sz, i * 0.2 + 0.01);
  probe[name] = ((performance.now() - a) / 12).toFixed(2);
}
window.__probe = Object.assign(probe, { prof: globalThis.__fp });
