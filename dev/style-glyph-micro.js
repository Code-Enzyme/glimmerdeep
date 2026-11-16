// scratch micro-benchmark: per-call cost of each character draw, glyph vs faces
import * as glyph from '../src/chars/glyph.js';
import * as faces from '../src/sprites.js';
const c = document.createElement('canvas'); c.width = 800; c.height = 800; document.body.appendChild(c);
const ctx = c.getContext('2d'); ctx.setTransform(2, 0, 0, 2, 0, 0);
const cases = {
  wren: (m, t) => m.drawWren(ctx, 50, 50, 54, { t, dir: 'N', carrying: true }),
  stumpSleep: (m, t) => m.drawCreature(ctx, 'T', 50, 50, 54, { t, dir: 'E', lit: false, awake: false }),
  whelkOut: (m, t) => m.drawCreature(ctx, 'S', 50, 50, 54, { t, lit: false, hidden: false }),
  lantern: (m, t) => m.drawLantern(ctx, 50, 50, 54, { t }),
  mothLit: (m, t) => m.drawCreature(ctx, 'M', 50, 50, 54, { t, lit: true }),
};
const res = {};
for (const [name, fn] of Object.entries(cases)) {
  for (const [mn, m] of [['faces', faces], ['glyph', glyph]]) {
    for (let i = 0; i < 300; i++) fn(m, i / 60); // warm
    ctx.getImageData(0, 0, 1, 1);
    const a = performance.now();
    for (let i = 0; i < 2000; i++) fn(m, i / 60);
    ctx.getImageData(0, 0, 1, 1);
    res[name + ' ' + mn] = ((performance.now() - a) / 2000 * 1000).toFixed(1) + 'us';
  }
}
window.__res = res;
