// scratch: big sprite sheet of the glyph style (plus a greyscale strip) for close inspection
import * as glyph from '../src/chars/glyph.js';
const S = 150, cols = 6, Z = Number(new URLSearchParams(location.search).get("z") || 0.62);
const cells = [
  ['wren', 'S', 1], ['wren', 'E', 1], ['wren', 'N', 1], ['wren', 'W', 0], ['wren', 'S', 1, 1], ['lantern'],
  ['M', 0], ['M', 1], ['S', 0], ['S', 1], ['T', 'E', 0], ['T', 'E', 1],
  ['T', 'N', 1], ['T', 'S', 1], ['T', 'W', 1], ['T', 'S', 0], ['T', 'N', 0], ['bridge'],
];
const c = document.createElement('canvas');
const rows = Math.ceil(cells.length / cols);
c.width = cols * S; c.height = rows * S * 2;
document.body.style.margin = 0; document.body.appendChild(c);
const ctx = c.getContext('2d');
const t = Number(new URLSearchParams(location.search).get('t') || 1.3);
cells.forEach((k, i) => {
  const x = (i % cols) * S, y = Math.floor(i / cols) * S;
  ctx.fillStyle = (i + Math.floor(i / cols)) % 2 ? '#7a5c58' : '#6f524f';
  ctx.fillRect(x, y, S, S);
  if (k[0] === 'bridge') { ctx.fillStyle = '#2B3454'; ctx.beginPath(); ctx.ellipse(x + S / 2, y + S / 2, S * 0.45, S * 0.42, 0, 0, 7); ctx.fill(); }
  const z = S * Z, o = (S - z) / 2;
  if (k[0] === 'wren') glyph.drawWren(ctx, x + o, y + o, z, { t, dir: k[1], carrying: !!k[2], smothered: !!k[3] });
  else if (k[0] === 'lantern') glyph.drawLantern(ctx, x + o, y + o, z, { t });
  else if (k[0] === 'bridge') glyph.drawBridgeMoth(ctx, x + o, y + o, z, { t });
  else if (k[0] === 'T') glyph.drawCreature(ctx, 'T', x + o, y + o, z, { t, dir: k[1], awake: !!k[2], lit: !!k[2] });
  else glyph.drawCreature(ctx, k[0], x + o, y + o, z, { t, lit: !!k[1] });
});
// greyscale copy below
const img = ctx.getImageData(0, 0, c.width, rows * S);
for (let i = 0; i < img.data.length; i += 4) { const v = img.data[i] * 0.3 + img.data[i + 1] * 0.59 + img.data[i + 2] * 0.11; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; }
ctx.putImageData(img, 0, rows * S);
window.__done = true;
