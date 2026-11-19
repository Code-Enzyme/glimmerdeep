// The Workshop's editor canvas (SPEC section 26): a cavern drawn in full light, tile by tile, with a faint
// grid so every tile can be aimed at, and the tool pictures for its palette. What is drawn comes from
// cavernPicture (src/ui/workshop.js); this module only paints it.

import { drawBackdrop, PALETTE } from '../sprites.js';
import { drawTile, drawWren, drawLantern, drawCreature, drawGlow } from '../chars.js';
import { cavernPicture, TOOLS } from './workshop.js';

const ACCENT = PALETTE.amber;

// A creature at its most telling, as the rule cards show it: lit and awake.
function creature(g, type, dir, px, py, size) {
  if (type === 'S') drawCreature(g, 'S', px, py, size, { t: 0, lit: false, hidden: false });
  else if (type === 'O') {
    drawCreature(g, 'O', px, py, size, { t: 0 });
    drawGlow(g, 'O', px, py, size, { t: 0, lit: false });
  } else drawCreature(g, type, px, py, size, { t: 0, dir, lit: true, awake: true, heat: type === 'K' ? 2 : 0 });
}

function tileOpts(tile) {
  const o = { t: 0, seed: tile.x * 7 + tile.y * 13 + 1 };
  if (tile.neighbors) o.neighbors = tile.neighbors;
  if (tile.kind === 'bud') {
    o.lit = true;
    o.accent = ACCENT;
  } else if (tile.kind === 'root') {
    o.channel = tile.channel;
    o.pressed = false;
  } else if (tile.kind === 'gate') {
    o.channel = tile.channel;
    o.open = false;
  } else if (tile.kind === 'crystal') {
    o.lit = true;
  }
  return o;
}

// Paints a picture (cavernPicture) with its top-left tile at (ox, oy).
function paintPicture(g, pic, ox, oy, size) {
  for (const tile of pic.tiles) drawTile(g, tile.kind, ox + tile.x * size, oy + tile.y * size, size, tileOpts(tile));
  const planted = pic.things.some((t) => t.who === 'lantern');
  const things = pic.things.slice().sort((a, b) => a.y - b.y);
  for (const t of things) {
    const px = ox + t.x * size;
    const py = oy + t.y * size;
    if (t.who === 'wren') drawWren(g, px, py, size, { t: 0, dir: 'S', carrying: !planted });
    else if (t.who === 'lantern') drawLantern(g, px, py, size, { t: 0 });
    else creature(g, t.type, t.dir, px, py, size);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export class EditorView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.picture = null;
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.rect = { left: 0, top: 0 };
    this.layout = null;   // { size, ox, oy, w, h }
    this.frames = 0;
  }

  setMap(map) {
    this.picture = cavernPicture(map);
    this.computeLayout();
    this.draw();
  }

  // Call when the canvas box may have changed (resize, rotation, screen shown).
  resize() {
    const box = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(box.width));
    const cssH = Math.max(1, Math.round(box.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.rect = { left: box.left, top: box.top };
    if (cssW !== this.cssW || cssH !== this.cssH || dpr !== this.dpr) {
      this.cssW = cssW;
      this.cssH = cssH;
      this.dpr = dpr;
      this.canvas.width = Math.round(cssW * dpr);
      this.canvas.height = Math.round(cssH * dpr);
    }
    this.computeLayout();
    this.draw();
  }

  // The largest whole-pixel tile that fits with a margin, centred, like the board's.
  computeLayout() {
    const p = this.picture;
    if (!p || this.cssW < 2) {
      this.layout = null;
      return;
    }
    const margin = Math.max(10, Math.min(20, Math.round(Math.min(this.cssW, this.cssH) * 0.03)));
    let size = Math.floor(Math.min((this.cssW - margin * 2) / p.w, (this.cssH - margin * 2) / p.h));
    size = Math.max(12, Math.min(88, size));
    this.layout = { size, w: p.w, h: p.h, ox: Math.round((this.cssW - size * p.w) / 2), oy: Math.round((this.cssH - size * p.h) / 2) };
  }

  // The tile under a point in client coordinates, or null outside the cavern.
  tileAt(clientX, clientY) {
    const L = this.layout;
    if (!L) return null;
    const box = this.canvas.getBoundingClientRect();   // the bars round it may have moved it
    this.rect = { left: box.left, top: box.top };
    const x = Math.floor((clientX - this.rect.left - L.ox) / L.size);
    const y = Math.floor((clientY - this.rect.top - L.oy) / L.size);
    return x >= 0 && y >= 0 && x < L.w && y < L.h ? { x, y } : null;
  }

  draw() {
    const L = this.layout;
    const g = this.ctx;
    if (!L || !this.picture) return;
    this.frames++;
    const { size, ox, oy, w, h } = L;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    drawBackdrop(g, this.cssW, this.cssH, { t: 0, accent: ACCENT });
    // the frame, as on the board
    g.fillStyle = 'rgba(14, 9, 22, 0.2)';
    for (let i = 4; i >= 1; i--) {
      const d = i * Math.max(2, size * 0.07);
      roundRect(g, ox - d, oy - d + 2, w * size + d * 2, h * size + d * 2, Math.max(6, size * 0.2) + d);
      g.fill();
    }
    g.fillStyle = PALETTE.ink;
    roundRect(g, ox - 3, oy - 3, w * size + 6, h * size + 6, Math.max(6, size * 0.2) * 0.6);
    g.fill();
    paintPicture(g, this.picture, ox, oy, size);
    // a faint grid, so every tile can be aimed at
    g.strokeStyle = 'rgba(244, 234, 213, 0.16)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < w; x++) {
      g.moveTo(ox + x * size + 0.5, oy);
      g.lineTo(ox + x * size + 0.5, oy + h * size);
    }
    for (let y = 1; y < h; y++) {
      g.moveTo(ox, oy + y * size + 0.5);
      g.lineTo(ox + w * size, oy + y * size + 0.5);
    }
    g.stroke();
  }
}

const toolCache = new Map();
const TOOL_MAP = {
  floor: '.', wall: '#', puddle: '~', bud: 'G', wren: 'W', lantern: 'L', hush: 'H', root: 'a', gate: 'A',
  crystal: '*', moth: 'M', whelk: 'S', stumpcap: '>', newt: 'e', ember: 'K', gloamling: 'O', beetle: '/',
};

// A tool's picture: what it paints, on one tile, as a data URL ('' without a canvas).
export function toolIconUrl(toolId) {
  if (toolCache.has(toolId)) return toolCache.get(toolId);
  let url = '';
  try {
    const css = 40;
    const scale = 3;
    const c = document.createElement('canvas');
    c.width = css * scale;
    c.height = css * scale;
    const g = c.getContext('2d');
    if (g && TOOL_MAP[toolId] && TOOLS.some((t) => t.id === toolId)) {
      g.setTransform(scale, 0, 0, scale, 0, 0);
      paintPicture(g, cavernPicture([TOOL_MAP[toolId]]), 0, 0, css);
      url = c.toDataURL('image/png');
    }
  } catch (e) {
    url = '';   // the label still says what it is
  }
  toolCache.set(toolId, url);
  return url;
}
