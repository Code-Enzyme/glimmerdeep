// Glimmerdeep sprites: procedural "lantern-lit gouache" art on a 2D canvas. No game logic.
//
// Everything is painted once into small offscreen canvases (keyed by device-pixel tile size, kind,
// variant and state) and then blitted, so a frame is a few hundred drawImage calls and nothing else.
// Callers draw in CSS pixels and may scale the context however they like (for devicePixelRatio): the
// cache reads the context's current scale to pick its resolution, it never sets a transform.
// The module touches no DOM at import time, so it loads in Node; canvases are created lazily.
//
// Notes for the caller (all within the SPEC section 7 signatures; every opt is optional):
// - Tiles are opaque and complete: 'bud', 'root', 'gate', 'puddle', 'bridge' and 'hush' paint their
//   own floor. Draw tiles first (any order), then the lantern, creatures and Wren (top row first
//   looks best), then drawDarkness over the lot.
// - `neighbors` is used by 'wall', 'puddle', 'bridge' and 'hush'. For walls, count off-board as wall.
// - `seed` (any number or string, for example y * w + x) picks one of a few floor / rock variants.
// - `accent` (any CSS colour) tints a Glowbud, or a root / gate channel. Channels default to amber
//   (A), teal (B), lilac (C); the circle / triangle / square mark is what really tells them apart.
// - drawCreature: `hidden` (whelk) and `awake` (stumpcap) fall back to `lit` when left out.
// - drawWren accepts one extra opt, `smothered: true`, to show the carried lantern gone dark.
// - Sprites may reach a little outside their tile (shadows, glows, sleepy z's): up to a quarter tile.
// - Dev gallery: dev/sprites.html (see dev/sprites-shot.cjs).

const TAU = Math.PI * 2;
const NONE = Object.freeze({});

export const PALETTE = Object.freeze({
  // the six named colours of the design doc
  amber: '#F2B04C', // lantern light, Wren
  teal: '#5FBFA8', // flora, Glowbuds
  rose: '#C97A8A', // creatures
  plum: '#2B1E3A', // unlit floor, background
  hush: '#120C1C', // the Hush
  cream: '#F4EAD5', // paper, UI lines
  // supporting tones used by the painters (handy for UI that wants to match)
  ink: '#24162E',
  night: '#21172F',
  floor: '#7A5C58',
  wall: '#5A4563',
  water: '#2B3454',
  bark: '#7B5850',
  flame: '#FFE08A',
  // gate channels: amber, teal and lilac, apart for every type of colour vision (SPEC section 25)
  channels: Object.freeze({ A: '#F2B04C', B: '#5FBFA8', C: '#9877D9' }),
  hint: '#FFC872', // the hint's way
  coach: '#9CF5E3', // a tutorial's pointer: mint, so it never reads as a hint
});

const INK = PALETTE.ink;
const CREAM = PALETTE.cream;
const AMBER = PALETTE.amber;
const TEAL = PALETTE.teal;
const ROSE = PALETTE.rose;
const CHANNEL_TINT = [PALETTE.channels.A, PALETTE.channels.B, PALETTE.channels.C];

// ---------------------------------------------------------------------------
// Small utilities
// ---------------------------------------------------------------------------

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashInt(n) {
  n = (n | 0) ^ 0x9e3779b9;
  n = Math.imul(n ^ (n >>> 16), 0x85ebca6b);
  n = Math.imul(n ^ (n >>> 13), 0xc2b2ae35);
  return (n ^ (n >>> 16)) >>> 0;
}

function seedInt(seed) {
  if (typeof seed === 'number') return seed === seed ? Math.floor(seed) | 0 : 0;
  if (typeof seed === 'string') {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
    return h;
  }
  return 0;
}

function makeCanvas(w, h) {
  w = Math.max(1, Math.ceil(w));
  h = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  if (typeof document !== 'undefined' && document.createElement) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  return null; // no canvas here (plain Node): draw calls become no-ops
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

// --- colour ---------------------------------------------------------------

const colorCache = new Map();
let scratch = null;

function parseColor(c, depth) {
  if (typeof c !== 'string') return null;
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(c);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  if (!depth) {
    // any other CSS colour: let a canvas normalise it
    if (!scratch) {
      const sc = makeCanvas(1, 1);
      scratch = sc ? sc.getContext('2d') : null;
    }
    if (scratch) {
      scratch.fillStyle = '#000000';
      scratch.fillStyle = c;
      return parseColor(String(scratch.fillStyle), 1);
    }
  }
  return null;
}

function rgbOf(c) {
  let v = colorCache.get(c);
  if (!v) {
    v = parseColor(c, 0) || [95, 191, 168];
    colorCache.set(c, v);
  }
  return v;
}

function mix(a, b, t) {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return (
    'rgb(' +
    Math.round(A[0] + (B[0] - A[0]) * t) + ',' +
    Math.round(A[1] + (B[1] - A[1]) * t) + ',' +
    Math.round(A[2] + (B[2] - A[2]) * t) + ')'
  );
}

function rgba(c, a) {
  const A = rgbOf(c);
  return 'rgba(' + A[0] + ',' + A[1] + ',' + A[2] + ',' + a + ')';
}

// --- brush helpers (all in unit space: the tile is the square 0..1) ---------

function F(g, c) {
  g.fillStyle = c;
  g.fill();
}

function K(g, c, lw) {
  g.strokeStyle = c;
  g.lineWidth = lw;
  g.stroke();
}

// Smooth closed curve through the midpoints of a control polygon.
function closed(g, p) {
  const n = p.length;
  g.beginPath();
  g.moveTo((p[n - 1][0] + p[0][0]) / 2, (p[n - 1][1] + p[0][1]) / 2);
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  g.closePath();
}

// Smooth open curve from the first point to the last.
function open(g, p) {
  const n = p.length;
  g.beginPath();
  g.moveTo(p[0][0], p[0][1]);
  if (n === 2) {
    g.lineTo(p[1][0], p[1][1]);
    return;
  }
  for (let i = 1; i < n - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    if (i === n - 2) g.quadraticCurveTo(a[0], a[1], b[0], b[1]);
    else g.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
}

// A slightly wandering brush line.
function wline(g, x0, y0, x1, y1, rnd, wob, seg) {
  seg = seg || 4;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const p = [[x0, y0]];
  for (let i = 1; i < seg; i++) {
    const t = i / seg;
    const o = (rnd() - 0.5) * 2 * wob;
    p.push([x0 + dx * t + nx * o, y0 + dy * t + ny * o]);
  }
  p.push([x1, y1]);
  open(g, p);
}

// An irregular hand-painted ellipse.
function blob(g, cx, cy, rx, ry, rnd, wob, n, rot) {
  n = n || 9;
  if (wob === undefined) wob = 0.07;
  const a0 = rnd ? rnd() * TAU : 0;
  const c = rot ? Math.cos(rot) : 1;
  const s = rot ? Math.sin(rot) : 0;
  const p = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (i / n) * TAU;
    const k = (1 + 1.6 / (n * n)) * (1 + (rnd ? (rnd() - 0.5) * 2 * wob : 0)) / Math.cos(Math.PI / n) * 0.985;
    const x = Math.cos(a) * rx * k;
    const y = Math.sin(a) * ry * k;
    p.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  closed(g, p);
}

function ell(g, cx, cy, rx, ry, rot) {
  g.beginPath();
  g.ellipse(cx, cy, rx, ry, rot || 0, 0, TAU);
}

// Polygon with softly rounded corners (robust for short edges).
function poly(g, p, r) {
  const n = p.length;
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = p[(i + n - 1) % n];
    const b = p[i];
    const c = p[(i + 1) % n];
    const l1 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const l2 = Math.hypot(c[0] - b[0], c[1] - b[1]) || 1;
    const d1 = Math.min(r, l1 * 0.45);
    const d2 = Math.min(r, l2 * 0.45);
    const x1 = b[0] + ((a[0] - b[0]) * d1) / l1;
    const y1 = b[1] + ((a[1] - b[1]) * d1) / l1;
    const x2 = b[0] + ((c[0] - b[0]) * d2) / l2;
    const y2 = b[1] + ((c[1] - b[1]) * d2) / l2;
    if (i === 0) g.moveTo(x1, y1);
    else g.lineTo(x1, y1);
    g.quadraticCurveTo(b[0], b[1], x2, y2);
  }
  g.closePath();
}

// Leaf or petal from a base point to a tip.
function leaf(g, x0, y0, x1, y1, w, bend) {
  bend = bend || 0;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const mx = (x0 + x1) / 2 + nx * bend;
  const my = (y0 + y1) / 2 + ny * bend;
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo(mx + nx * w, my + ny * w, x1, y1);
  g.quadraticCurveTo(mx - nx * w, my - ny * w, x0, y0);
  g.closePath();
}

function spiral(g, cx, cy, r0, r1, turns, start, squash) {
  const steps = Math.max(12, Math.round(turns * 22));
  g.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * (squash || 1);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
}

// Four-pointed glint.
function sparkle(g, x, y, r) {
  const k = r * 0.22;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x + k, y - k, x + r, y);
  g.quadraticCurveTo(x + k, y + k, x, y + r);
  g.quadraticCurveTo(x - k, y + k, x - r, y);
  g.quadraticCurveTo(x - k, y - k, x, y - r);
  g.closePath();
}

function radial(g, cx, cy, r, stops) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]);
  return gr;
}

// A tile-filling slab with organic edges on its open sides. Sides that adjoin a tile of the same kind
// (bits of `nb`: 1 north, 2 east, 4 south, 8 west) run straight off the canvas so neighbours merge.
function slabPts(x0, y0, x1, y1, nb, rad, rnd, wob) {
  const oN = !(nb & 1);
  const oE = !(nb & 2);
  const oS = !(nb & 4);
  const oW = !(nb & 8);
  const F0 = -0.5;
  const F1 = 1.5;
  const e0 = -0.04;
  const e1 = 1.04;
  const p = [];
  const j = () => (rnd() - 0.5) * 2 * wob;
  if (oN) {
    const a = oW ? x0 + rad : 0;
    const b = oE ? x1 - rad : 1;
    if (oW) p.push([x0 + rad, y0]);
    else p.push([F0, y0], [e0, y0]);
    for (let i = 1; i < 4; i++) p.push([a + ((b - a) * i) / 4, y0 + j()]);
    if (oE) p.push([x1 - rad, y0]);
    else p.push([e1, y0], [F1, y0]);
  } else if (!oW) p.push([F0, F0]);
  if (oE) {
    const a = oN ? y0 + rad : 0;
    const b = oS ? y1 - rad : 1;
    if (oN) p.push([x1, y0 + rad]);
    else p.push([x1, F0], [x1, e0]);
    for (let i = 1; i < 4; i++) p.push([x1 + j(), a + ((b - a) * i) / 4]);
    if (oS) p.push([x1, y1 - rad]);
    else p.push([x1, e1], [x1, F1]);
  } else if (!oN) p.push([F1, F0]);
  if (oS) {
    const a = oE ? x1 - rad : 1;
    const b = oW ? x0 + rad : 0;
    if (oE) p.push([x1 - rad, y1]);
    else p.push([F1, y1], [e1, y1]);
    for (let i = 1; i < 4; i++) p.push([a + ((b - a) * i) / 4, y1 + j()]);
    if (oW) p.push([x0 + rad, y1]);
    else p.push([e0, y1], [F0, y1]);
  } else if (!oE) p.push([F1, F1]);
  if (oW) {
    const a = oS ? y1 - rad : 1;
    const b = oN ? y0 + rad : 0;
    if (oS) p.push([x0, y1 - rad]);
    else p.push([x0, F1], [x0, e1]);
    for (let i = 1; i < 4; i++) p.push([x0 + j(), a + ((b - a) * i) / 4]);
    if (oN) p.push([x0, y0 + rad]);
    else p.push([x0, e0], [x0, F0]);
  } else if (!oS) p.push([F0, F1]);
  return p;
}

// ---------------------------------------------------------------------------
// Paper grain (generated once, stamped onto sprites when they are built)
// ---------------------------------------------------------------------------

let grainTile = null;

function grainSource() {
  if (grainTile) return grainTile;
  const n = 96;
  const c = makeCanvas(n, n);
  if (!c) return null;
  const g = c.getContext('2d');
  const img = g.createImageData(n, n);
  const d = img.data;
  const rnd = rng(4242);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const fine = rnd() - 0.5;
      const u = (x / n) * TAU;
      const w = (y / n) * TAU;
      const lo = 0.5 * Math.sin(u * 2 + 1.3) * Math.sin(w * 3 + 0.4) + 0.5 * Math.sin(u * 5 + w * 2 + 2.1) * Math.sin(w * 4 + 0.9);
      const v = fine + lo * 0.26;
      if (v > 0) {
        d[i] = 252;
        d[i + 1] = 242;
        d[i + 2] = 222;
        d[i + 3] = Math.min(255, v * 150);
      } else {
        d[i] = 26;
        d[i + 1] = 14;
        d[i + 2] = 36;
        d[i + 3] = Math.min(255, -v * 175);
      }
    }
  }
  g.putImageData(img, 0, 0);
  grainTile = c;
  return c;
}

function stampGrain(g, w, h, amt, seed, scale) {
  const src = grainSource();
  if (!src) return;
  const n = src.width * scale;
  const ox = -((hashInt(seed) % 1000) / 1000) * n;
  const oy = -((hashInt(seed + 71) % 1000) / 1000) * n;
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = amt;
  for (let y = oy; y < h; y += n) for (let x = ox; x < w; x += n) g.drawImage(src, x, y, n, n);
  g.restore();
}

// ---------------------------------------------------------------------------
// Sprite cache
// ---------------------------------------------------------------------------

const MAX_BUCKETS = 8;
const buckets = new Map(); // device-pixel tile size -> { P, map, used }
let useTick = 0;
let lastP = -1;
let lastBucket = null;
let lastBucketMade = -1e9;

let scaleCtx = null;
let scaleValue = 1;
let scaleTtl = 0;

// The context's current uniform scale (so the cache can match device pixels). Re-read every few
// dozen calls: a stale value only costs a little sharpness for a moment.
function ctxScale(ctx) {
  if (ctx === scaleCtx && scaleTtl-- > 0) return scaleValue;
  let s = 0;
  if (typeof ctx.getTransform === 'function') {
    const m = ctx.getTransform();
    s = Math.sqrt(m.a * m.a + m.b * m.b);
  }
  if (!(s > 0)) s = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 && devicePixelRatio) || 1;
  scaleCtx = ctx;
  scaleValue = s;
  scaleTtl = 40;
  return s;
}

function dropBucket(b) {
  for (const s of b.map.values()) {
    if (s && s.c) {
      s.c.width = 1;
      s.c.height = 1;
    }
  }
  b.map.clear();
}

function bucketFor(ctx, size) {
  let P = Math.round(size * ctxScale(ctx));
  if (!(P >= 12)) P = 12;
  else if (P > 512) P = 512;
  if (P === lastP) return lastBucket;
  let b = buckets.get(P);
  if (!b) {
    const t = nowMs();
    if (t - lastBucketMade < 350) {
      // Sizes are changing fast (a zoom animation): borrow the nearest size instead of repainting.
      let best = null;
      let bestR = 1.25;
      for (const c of buckets.values()) {
        const r = c.P > P ? c.P / P : P / c.P;
        if (r < bestR) {
          bestR = r;
          best = c;
        }
      }
      if (best) {
        best.used = ++useTick;
        return best;
      }
    }
    b = { P, map: new Map(), used: 0 };
    buckets.set(P, b);
    lastBucketMade = t;
    if (buckets.size > MAX_BUCKETS) {
      let old = null;
      for (const c of buckets.values()) if (c !== b && (!old || c.used < old.used)) old = c;
      if (old) {
        buckets.delete(old.P);
        dropBucket(old);
      }
    }
  }
  b.used = ++useTick;
  lastP = P;
  lastBucket = b;
  return b;
}

function flushSprites() {
  for (const b of buckets.values()) dropBucket(b);
  buckets.clear();
  lastP = -1;
  lastBucket = null;
}

const accentIds = new Map();
let accentCount = 0;

function accentId(a) {
  if (!a) return 0;
  let id = accentIds.get(a);
  if (id === undefined) {
    if (accentCount >= 62) {
      // someone is animating accent colours: start over rather than grow without bound
      accentIds.clear();
      accentCount = 0;
      flushSprites();
    }
    id = ++accentCount;
    accentIds.set(a, id);
  }
  return id;
}

// Paint one sprite. `margin` is extra room around the tile, as a fraction of the tile (0 means a
// plain tile, which still gets one device pixel of bleed so neighbouring tiles never show seams).
function make(b, key, margin, grainAmt, painter, opaque) {
  const P = b.P;
  const mp = margin > 0 ? Math.round(P * margin) : 1;
  const side = P + 2 * mp;
  const c = makeCanvas(side, side);
  let s = null;
  if (c) {
    const g = opaque ? c.getContext('2d', { alpha: false }) : c.getContext('2d');
    g.setTransform(P, 0, 0, P, mp, mp);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    painter(g);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (grainAmt > 0) stampGrain(g, side, side, grainAmt, key, Math.max(1, P / 64));
    s = { c, m: mp / P, k: side / P };
  }
  b.map.set(key, s);
  return s;
}

function blit(ctx, s, px, py, size) {
  const d = size * s.k;
  const o = size * s.m;
  ctx.drawImage(s.c, px - o, py - o, d, d);
}

// Sprite kinds (low five bits of a cache key).
const K_FLOOR = 1, K_WALL = 2, K_PUDDLE = 3, K_BRIDGE = 4, K_BUD = 5, K_HUSH = 6, K_HUSH_SHIM = 7, K_ROOT = 8, K_GATE = 9;
const K_WREN = 10, K_LANTERN = 11, K_MOTH = 12, K_WHELK = 13, K_STUMP = 14, K_ZED = 15, K_GLOW = 16, K_ICON = 17, K_BUDGLOW = 18;
const K_CRYSTAL = 19, K_CRYSTAL_GLINT = 20;

// ---------------------------------------------------------------------------
// Tile painters
// ---------------------------------------------------------------------------

const FLOOR_BASE = ['#7a5c58', '#80625a', '#755755', '#7c5f5c'];

function paintFloor(g, v) {
  const rnd = rng(9001 + v * 131);
  g.fillStyle = FLOOR_BASE[v & 3];
  g.fillRect(-0.1, -0.1, 1.2, 1.2);
  // broad gouache strokes
  for (let i = 0; i < 9; i++) {
    const y = -0.05 + rnd() * 1.1;
    const tilt = (rnd() - 0.5) * 0.28;
    wline(g, -0.12, y, 1.12, y + tilt, rnd, 0.04, 4);
    K(g, rgba(i % 2 ? '#a08070' : '#58414a', 0.07 + rnd() * 0.1), 0.06 + rnd() * 0.14);
  }
  // worn seams between the packed-earth pads, a little wider at the corners
  const seam = rgba('#35242f', 0.34);
  wline(g, -0.02, 0, 1.02, 0, rnd, 0.012, 4);
  K(g, seam, 0.05);
  wline(g, -0.02, 1, 1.02, 1, rnd, 0.012, 4);
  K(g, seam, 0.05);
  wline(g, 0, -0.02, 0, 1.02, rnd, 0.012, 4);
  K(g, seam, 0.05);
  wline(g, 1, -0.02, 1, 1.02, rnd, 0.012, 4);
  K(g, seam, 0.05);
  const corners = [[0, 0], [1, 0], [0, 1], [1, 1]];
  for (let i = 0; i < 4; i++) {
    blob(g, corners[i][0], corners[i][1], 0.06, 0.06, rnd, 0.2, 7);
    F(g, rgba('#35242f', 0.3));
  }
  // soft light on the top-left of the pad
  wline(g, 0.08, 0.075, 0.9, 0.07, rnd, 0.01, 3);
  K(g, rgba('#c9a892', 0.17), 0.03);
  wline(g, 0.075, 0.1, 0.07, 0.88, rnd, 0.01, 3);
  K(g, rgba('#c9a892', 0.12), 0.03);

  const pebble = (x, y, r) => {
    blob(g, x + r * 0.15, y + r * 0.35, r * 1.1, r * 0.8, rnd, 0.1, 7);
    F(g, rgba('#35242f', 0.5));
    blob(g, x, y, r, r * 0.78, rnd, 0.12, 7);
    F(g, '#a18577');
    blob(g, x - r * 0.25, y - r * 0.25, r * 0.45, r * 0.28, rnd, 0.1, 6);
    F(g, rgba('#d3bba6', 0.75));
  };
  const crack = (pts) => {
    open(g, pts);
    K(g, rgba('#35242f', 0.5), 0.016);
  };
  const moss = (x, y, n) => {
    blob(g, x, y, 0.15, 0.085, rnd, 0.18, 9);
    F(g, rgba('#4c8f7f', 0.3));
    for (let i = 0; i < n; i++) {
      blob(g, x + (rnd() - 0.5) * 0.2, y + (rnd() - 0.5) * 0.11, 0.028 + rnd() * 0.03, 0.02 + rnd() * 0.018, rnd, 0.15, 6);
      F(g, i % 3 ? rgba('#4c8f7f', 0.85) : rgba('#79bfaa', 0.85));
    }
  };
  const specks = (n) => {
    for (let i = 0; i < n; i++) {
      ell(g, 0.12 + rnd() * 0.76, 0.12 + rnd() * 0.76, 0.008 + rnd() * 0.008, 0.007 + rnd() * 0.006);
      F(g, i % 2 ? rgba('#c9a892', 0.45) : rgba('#35242f', 0.4));
    }
  };
  specks(5);
  switch (v) {
    case 0:
      pebble(0.72, 0.3, 0.05);
      pebble(0.26, 0.7, 0.035);
      break;
    case 1:
      crack([[0.2, 0.3], [0.32, 0.38], [0.36, 0.52], [0.5, 0.6]]);
      break;
    case 2:
      moss(0.24, 0.78, 6);
      break;
    case 3:
      specks(7);
      break;
    case 4:
      pebble(0.3, 0.3, 0.04);
      crack([[0.6, 0.62], [0.7, 0.7], [0.82, 0.72]]);
      break;
    case 5:
      moss(0.76, 0.22, 5);
      pebble(0.34, 0.74, 0.035);
      break;
    case 6:
      crack([[0.66, 0.2], [0.6, 0.3], [0.66, 0.42]]);
      specks(4);
      break;
    default:
      moss(0.3, 0.26, 4);
      break;
  }
}

function paintWall(g, nb, v) {
  const rnd = rng(7001 + v * 53 + nb * 977);
  const openS = !(nb & 4);
  // the crevice at the foot of the rock
  g.fillStyle = '#2a1d29';
  g.fillRect(-0.1, -0.1, 1.2, 1.2);
  const block = slabPts(0.03, 0.035, 0.97, 0.985, nb, 0.12, rnd, 0.016);
  const lipY = 0.68;
  const lip = [];
  for (let i = 0; i <= 6; i++) lip.push([-0.2 + (1.4 * i) / 6, lipY + (rnd() - 0.5) * 0.035]);
  const topPath = () => {
    g.beginPath();
    g.moveTo(-0.5, -0.5);
    g.lineTo(1.5, -0.5);
    if (openS) {
      g.lineTo(1.5, lipY);
      for (let i = 6; i >= 0; i--) g.lineTo(lip[i][0], lip[i][1]);
      g.lineTo(-0.5, lipY);
    } else {
      g.lineTo(1.5, 1.5);
      g.lineTo(-0.5, 1.5);
    }
    g.closePath();
  };
  const topH = openS ? 0.66 : 1;

  closed(g, block);
  F(g, '#2c1f37');
  g.save();
  closed(g, block);
  g.clip();
  if (openS) {
    // front face: dark rock with a few upright strokes, darkest at its foot
    for (let i = 0; i < 9; i++) {
      const x = -0.05 + rnd() * 1.1;
      wline(g, x, lipY, x + (rnd() - 0.5) * 0.06, 1.02, rnd, 0.015, 3);
      K(g, rgba(i % 3 ? '#1f1528' : '#4a3860', 0.4), 0.04 + rnd() * 0.07);
    }
    const gr = g.createLinearGradient(0, lipY, 0, 1);
    gr.addColorStop(0, 'rgba(20,12,26,0)');
    gr.addColorStop(1, 'rgba(20,12,26,0.65)');
    g.fillStyle = gr;
    g.fillRect(-0.1, lipY, 1.2, 0.4);
  }
  // top face: dusky plum stone, chiselled into a few planes
  topPath();
  F(g, '#44344c');
  g.save();
  topPath();
  g.clip();
  for (let i = 0; i < 6; i++) {
    const x = rnd();
    const y = rnd() * topH;
    const a = rnd() * TAU;
    wline(g, x - Math.cos(a) * 0.3, y - Math.sin(a) * 0.3, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, rnd, 0.04, 3);
    K(g, rgba(i % 2 ? '#574464' : '#35273f', 0.34), 0.08 + rnd() * 0.12);
  }
  for (let i = 0; i < 3; i++) {
    const x = 0.12 + rnd() * 0.76;
    const y = (0.14 + rnd() * 0.72) * topH;
    const r = 0.11 + rnd() * 0.1;
    const a0 = rnd() * TAU;
    const n = 4 + ((rnd() * 2) | 0);
    const pts = [];
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * TAU + (rnd() - 0.5) * 0.5;
      pts.push([x + Math.cos(a) * r * (0.7 + rnd() * 0.5), y + Math.sin(a) * r * (0.55 + rnd() * 0.4)]);
    }
    poly(g, pts, 0.02);
    F(g, rgba('#6a5679', 0.3));
    // shadowed lower edge of the facet, lit upper edge
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    g.lineTo(pts[1][0], pts[1][1]);
    g.lineTo(pts[2][0], pts[2][1]);
    K(g, rgba('#221729', 0.55), 0.018);
    g.beginPath();
    g.moveTo(pts[n - 2][0], pts[n - 2][1]);
    g.lineTo(pts[n - 1][0], pts[n - 1][1]);
    K(g, rgba('#8d769a', 0.4), 0.014);
  }
  for (let i = 0; i < 4; i++) {
    blob(g, 0.1 + rnd() * 0.8, (0.08 + rnd() * 0.84) * topH, 0.012 + rnd() * 0.016, 0.01 + rnd() * 0.01, rnd, 0.2, 6);
    F(g, rgba(i % 2 ? '#7c6689' : '#2a1d33', 0.55));
  }
  // knuckles of rock: a short shadow with a catch of light above it
  for (let i = 0; i < 2; i++) {
    const x = 0.16 + rnd() * 0.68;
    const y = (0.2 + rnd() * 0.6) * topH;
    const r = 0.06 + rnd() * 0.06;
    const tilt = (rnd() - 0.5) * 0.9;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.55, tilt, 0.05 * Math.PI, 0.8 * Math.PI);
    K(g, rgba('#1f1527', 0.6), 0.024);
    g.beginPath();
    g.ellipse(x, y - 0.014, r, r * 0.55, tilt, 1.1 * Math.PI, 1.7 * Math.PI);
    K(g, rgba('#927a9f', 0.5), 0.02);
  }
  // lit rim along the open edges
  closed(g, block);
  K(g, rgba('#8f7699', 0.5), 0.08);
  if (openS) {
    // the bright lip where the top face turns down into the front face
    open(g, lip.map((p) => [p[0], p[1] - 0.028]));
    K(g, rgba('#bb9da8', 0.9), 0.045);
  }
  g.restore();
  if (openS) {
    open(g, lip);
    K(g, rgba(INK, 0.75), 0.018);
  }
  g.restore();
  closed(g, block);
  K(g, rgba('#1c1124', 0.9), 0.03);
}

function paintPuddle(g, nb, v) {
  paintFloor(g, (v * 3 + 1) & 7);
  const rnd = rng(3001 + v * 17 + nb * 31);
  const openN = !(nb & 1);
  const hole = slabPts(0.1, 0.12, 0.9, 0.9, nb, 0.2, rnd, 0.03);
  // damp earth around the pool
  closed(g, hole);
  K(g, rgba('#3d2b36', 0.55), 0.11);
  closed(g, hole);
  F(g, '#33252f');
  g.save();
  closed(g, hole);
  g.clip();
  // the water sits a little below the floor, so the far bank shows
  g.translate(0, openN ? 0.05 : 0);
  closed(g, hole);
  F(g, '#2b3454');
  g.fillStyle = '#2b3454';
  g.fillRect(-0.2, 0.6, 1.4, 0.7);
  g.translate(0, openN ? -0.05 : 0);
  blob(g, 0.5, 0.58, 0.3, 0.22, rnd, 0.1, 9);
  F(g, rgba('#1b2140', 0.6));
  // far-bank shadow on the water
  if (openN) {
    wline(g, 0.1, 0.2, 0.9, 0.2, rnd, 0.01, 3);
    K(g, rgba('#141830', 0.45), 0.05);
  }
  // glints
  wline(g, 0.26, 0.42, 0.5, 0.415, rnd, 0.008, 3);
  K(g, rgba('#b9d2e0', 0.75), 0.024);
  wline(g, 0.56, 0.6, 0.74, 0.6, rnd, 0.008, 3);
  K(g, rgba('#9cbad0', 0.6), 0.02);
  wline(g, 0.3, 0.72, 0.42, 0.72, rnd, 0.006, 2);
  K(g, rgba('#9cbad0', 0.45), 0.016);
  ell(g, 0.66, 0.4, 0.014, 0.012);
  F(g, rgba(CREAM, 0.85));
  // a pale shoreline where the water meets the bank (it reads as liquid even without colour)
  closed(g, hole);
  K(g, rgba('#9fc0d6', 0.5), 0.05);
  g.restore();
  closed(g, hole);
  K(g, rgba(INK, 0.8), 0.026);
}

function paintBridge(g, nb, v) {
  paintPuddle(g, nb, v);
  const rnd = rng(2300);
  // ripple and the pad's shadow on the water
  ell(g, 0.5, 0.55, 0.445, 0.365);
  K(g, rgba('#a8c3d6', 0.4), 0.016);
  ell(g, 0.5, 0.585, 0.4, 0.31);
  F(g, rgba('#11152a', 0.55));
  for (let sx = -1; sx <= 1; sx += 2) {
    g.save();
    g.translate(0.5, 0.5);
    g.scale(sx, 1);
    // lower wing
    const lower = [[0.03, 0.02], [0.26, 0.03], [0.37, 0.13], [0.33, 0.27], [0.18, 0.33], [0.05, 0.22]];
    closed(g, lower);
    K(g, INK, 0.05);
    F(g, '#e6adb1');
    // upper wing
    const upper = [[0.02, -0.08], [0.12, -0.27], [0.31, -0.33], [0.43, -0.22], [0.43, -0.05], [0.31, 0.05], [0.05, 0.05]];
    closed(g, upper);
    K(g, INK, 0.05);
    F(g, '#d48d9a');
    g.save();
    closed(g, upper);
    g.clip();
    closed(g, upper);
    K(g, rgba('#f6e2d0', 0.85), 0.05);
    const veins = [[0.2, -0.3], [0.36, -0.26], [0.42, -0.12], [0.36, 0.02]];
    for (let i = 0; i < veins.length; i++) {
      open(g, [[0.06, -0.03], veins[i]]);
      K(g, rgba('#a85a6c', 0.55), 0.012);
    }
    g.restore();
    ell(g, 0.27, -0.15, 0.05, 0.045);
    F(g, '#f6e6d2');
    ell(g, 0.27, -0.15, 0.024, 0.022);
    F(g, '#93485d');
    g.restore();
  }
  // fuzzy body, seen from above
  blob(g, 0.5, 0.5, 0.085, 0.2, rnd, 0.05, 12);
  K(g, INK, 0.045);
  F(g, '#f7eedc');
  for (let i = 0; i < 4; i++) {
    wline(g, 0.44, 0.47 + i * 0.055, 0.56, 0.47 + i * 0.055, rnd, 0.006, 2);
    K(g, rgba('#d6bfa5', 0.8), 0.014);
  }
  // sleepy face and flat antennae
  g.beginPath();
  g.arc(0.468, 0.385, 0.02, 0.1 * Math.PI, 0.9 * Math.PI);
  K(g, INK, 0.014);
  g.beginPath();
  g.arc(0.532, 0.385, 0.02, 0.1 * Math.PI, 0.9 * Math.PI);
  K(g, INK, 0.014);
  open(g, [[0.47, 0.31], [0.4, 0.22], [0.32, 0.2], [0.28, 0.24]]);
  K(g, INK, 0.022);
  open(g, [[0.53, 0.31], [0.6, 0.22], [0.68, 0.2], [0.72, 0.24]]);
  K(g, INK, 0.022);
}

function paintHush(g, nb, v) {
  paintFloor(g, (v + 5) & 7);
  g.fillStyle = rgba('#170e22', 0.6);
  g.fillRect(-0.1, -0.1, 1.2, 1.2);
  const rnd = rng(8100 + nb * 13 + v * 71);
  const ink = slabPts(0.05, 0.05, 0.95, 0.95, nb, 0.2, rnd, 0.045);
  closed(g, ink);
  K(g, rgba(PALETTE.hush, 0.5), 0.1);
  closed(g, ink);
  F(g, PALETTE.hush);
  g.save();
  closed(g, ink);
  g.clip();
  // slow inner swirl, barely lighter than the ink
  for (let i = 0; i < 4; i++) {
    const a0 = rnd() * TAU;
    g.beginPath();
    g.arc(0.5 + (rnd() - 0.5) * 0.06, 0.5 + (rnd() - 0.5) * 0.06, 0.1 + i * 0.1, a0, a0 + 1.5 + rnd() * 1.6);
    K(g, rgba('#2c1e49', 0.75), 0.04);
  }
  spiral(g, 0.5, 0.5, 0.02, 0.1, 1.3, rnd() * TAU);
  K(g, rgba('#3a2960', 0.8), 0.03);
  g.restore();
}

// A crystal wall (SPEC section 19): a block of pale blue glass on the floor, joined to its neighbours like
// rock, with facets and a cool highlight. Light passes through it, so it is drawn see-through.
const CRYSTAL_EDGE = '#2E5873';
function paintCrystal(g, nb, v) {
  paintFloor(g, (v + 3) & 7);
  const rnd = rng(9100 + nb * 17 + v * 31);
  const block = slabPts(0.07, 0.06, 0.93, 0.95, nb, 0.13, rnd, 0.012);
  // a soft shadow where it meets the floor
  closed(g, block);
  K(g, rgba('#1b2a3a', 0.35), 0.09);
  closed(g, block);
  F(g, rgba('#8FD8EC', 0.42));
  g.save();
  closed(g, block);
  g.clip();
  // facets: a few planes meeting at an off-centre point, alternately lighter and darker
  const cx = 0.42 + rnd() * 0.16;
  const cy = 0.38 + rnd() * 0.16;
  const corners = [[-0.2, -0.2], [0.55 + (rnd() - 0.5) * 0.2, -0.2], [1.2, -0.2], [1.2, 0.5 + (rnd() - 0.5) * 0.2], [1.2, 1.2],
    [0.45 + (rnd() - 0.5) * 0.2, 1.2], [-0.2, 1.2], [-0.2, 0.5 + (rnd() - 0.5) * 0.2]];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    g.closePath();
    F(g, i % 2 ? rgba('#E6FBFF', 0.16) : rgba('#3B7C9B', 0.14));
  }
  for (const a of corners) {
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(a[0], a[1]);
    K(g, rgba('#E6FBFF', 0.42), 0.014);
  }
  // a cool highlight streak toward the top left
  g.beginPath();
  g.moveTo(0.16, 0.42);
  g.lineTo(0.38, 0.16);
  K(g, rgba('#FFFFFF', 0.55), 0.035);
  g.beginPath();
  g.moveTo(0.2, 0.56);
  g.lineTo(0.27, 0.47);
  K(g, rgba('#FFFFFF', 0.4), 0.025);
  g.restore();
  closed(g, block);
  K(g, CRYSTAL_EDGE, 0.03);
}

// The glint a lit crystal wall shows, added over it with a soft pulse.
function paintCrystalGlint(g, v) {
  const rnd = rng(9300 + v * 13);
  ell(g, 0.5, 0.48, 0.4, 0.4);
  F(g, radial(g, 0.5, 0.48, 0.42, [0, rgba('#DFF8FF', 0.55), 1, rgba('#8FD8EC', 0)]));
  for (let i = 0; i < 2; i++) {
    sparkle(g, 0.3 + rnd() * 0.4, 0.25 + rnd() * 0.4, 0.07 + rnd() * 0.04);
    F(g, rgba('#FFFFFF', 0.9));
  }
}

// The Hush's shimmer: a broken pale-violet line just inside its edge plus a few motes. Two phases
// are cross-faded at draw time.
function paintHushShimmer(g, nb, v, phase) {
  const rnd = rng(8100 + nb * 13 + v * 71);
  const line = slabPts(0.105, 0.105, 0.895, 0.895, nb, 0.2, rnd, 0.045);
  g.setLineDash(phase ? [0.11, 0.13] : [0.16, 0.1]);
  g.lineDashOffset = phase ? 0.12 : 0;
  closed(g, line);
  K(g, rgba('#b29cf0', phase ? 0.8 : 0.7), 0.022);
  g.setLineDash([]);
  const r2 = rng(8200 + phase * 91 + v * 7 + nb);
  for (let i = 0; i < 3; i++) {
    sparkle(g, 0.22 + r2() * 0.56, 0.22 + r2() * 0.56, 0.022 + r2() * 0.02);
    F(g, rgba('#cdbcff', 0.75));
  }
}

function paintBud(g, v, lit, accent) {
  paintFloor(g, v);
  const rnd = rng(4100 + (lit ? 7 : 0));
  const stem = mix(accent, '#2c5350', 0.5);
  const leafCol = lit ? mix(accent, '#2f6a5a', 0.35) : mix(accent, '#4a5b63', 0.6);
  const outline = rgba(INK, 0.9);

  if (lit) {
    // halo first, so the plant sits in its own light
    ell(g, 0.5, 0.45, 0.46, 0.46);
    F(g, radial(g, 0.5, 0.45, 0.45, [0, rgba(mix(accent, '#ffffff', 0.55), 0.9), 0.5, rgba(accent, 0.5), 1, rgba(accent, 0)]));
  }
  // mossy mound
  blob(g, 0.5, 0.875, 0.2, 0.06, rnd, 0.08, 9);
  F(g, rgba(INK, 0.32));
  blob(g, 0.5, 0.855, 0.165, 0.052, rnd, 0.1, 9);
  K(g, outline, 0.03);
  F(g, mix(accent, '#3c4a4c', lit ? 0.45 : 0.68));

  if (!lit) {
    // asleep: leaves flop to the ground, the bud hangs shut from a bowed stalk
    leaf(g, 0.5, 0.85, 0.17, 0.83, 0.08, -0.05);
    K(g, outline, 0.04);
    F(g, leafCol);
    leaf(g, 0.5, 0.85, 0.83, 0.84, 0.075, 0.04);
    K(g, outline, 0.04);
    F(g, leafCol);
    const stalk = [[0.5, 0.85], [0.41, 0.62], [0.37, 0.36], [0.46, 0.19], [0.62, 0.18], [0.68, 0.32]];
    open(g, stalk);
    K(g, INK, 0.085);
    open(g, stalk);
    K(g, stem, 0.045);
    // the shut bud: pale, so it can still be found in the dark
    const bud = [[0.68, 0.315], [0.79, 0.39], [0.835, 0.55], [0.775, 0.7], [0.69, 0.81], [0.605, 0.7], [0.545, 0.55], [0.59, 0.39]];
    closed(g, bud);
    K(g, INK, 0.06);
    F(g, mix(accent, '#eef1e4', 0.62));
    g.save();
    closed(g, bud);
    g.clip();
    blob(g, 0.76, 0.66, 0.1, 0.16, rnd, 0.1, 8);
    F(g, rgba(mix(accent, '#3f5560', 0.5), 0.5));
    open(g, [[0.655, 0.34], [0.625, 0.55], [0.69, 0.8]]);
    K(g, rgba(INK, 0.5), 0.018);
    open(g, [[0.715, 0.34], [0.755, 0.55], [0.69, 0.8]]);
    K(g, rgba(INK, 0.5), 0.018);
    g.restore();
    // sepals
    leaf(g, 0.68, 0.3, 0.57, 0.42, 0.04, 0.012);
    K(g, outline, 0.028);
    F(g, stem);
    leaf(g, 0.68, 0.3, 0.8, 0.41, 0.04, -0.012);
    K(g, outline, 0.028);
    F(g, stem);
    return;
  }

  // awake: leaves lift like arms, a wide star of petals around a bright heart
  leaf(g, 0.5, 0.85, 0.2, 0.7, 0.07, 0.05);
  K(g, outline, 0.04);
  F(g, leafCol);
  leaf(g, 0.5, 0.85, 0.8, 0.7, 0.07, -0.05);
  K(g, outline, 0.04);
  F(g, leafCol);
  const stalk = [[0.5, 0.85], [0.49, 0.72], [0.5, 0.58]];
  open(g, stalk);
  K(g, INK, 0.08);
  open(g, stalk);
  K(g, stem, 0.042);
  const cx = 0.5;
  const cy = 0.43;
  const petals = 7;
  const tipCol = mix(accent, '#ffffff', 0.62);
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < petals; i++) {
      const a = -Math.PI / 2 + (i / petals) * TAU + 0.06;
      const c = Math.cos(a);
      const s = Math.sin(a) * 0.86;
      if (pass === 0) {
        leaf(g, cx + c * 0.04, cy + s * 0.04, cx + c * 0.315, cy + s * 0.315, 0.1);
        K(g, rgba(INK, 0.92), 0.05);
        F(g, mix(accent, '#ffffff', 0.18));
      } else {
        leaf(g, cx + c * 0.09, cy + s * 0.09, cx + c * 0.28, cy + s * 0.28, 0.05);
        F(g, tipCol);
      }
    }
  }
  // glowing heart
  ell(g, cx, cy, 0.2, 0.18);
  F(g, radial(g, cx, cy, 0.2, [0, 'rgba(255,253,236,1)', 0.45, 'rgba(255,250,220,0.9)', 1, 'rgba(255,250,220,0)']));
  ell(g, cx, cy, 0.075, 0.068);
  F(g, '#fffdf0');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    ell(g, cx + Math.cos(a) * 0.108, cy + Math.sin(a) * 0.094, 0.014, 0.014);
    F(g, AMBER);
  }
  // glints
  sparkle(g, 0.13, 0.17, 0.05);
  F(g, '#fffbe6');
  sparkle(g, 0.88, 0.22, 0.04);
  F(g, '#fffbe6');
  sparkle(g, 0.86, 0.74, 0.032);
  F(g, '#fffbe6');
}

// Soft pulse drawn over a lit bud.
function paintBudGlow(g, accent) {
  ell(g, 0.5, 0.45, 0.46, 0.46);
  F(g, radial(g, 0.5, 0.45, 0.45, [0, rgba(mix(accent, '#ffffff', 0.7), 0.5), 0.5, rgba(accent, 0.2), 1, rgba(accent, 0)]));
}

function glyphPath(g, ch, cx, cy, r) {
  g.beginPath();
  if (ch === 1) {
    g.moveTo(cx, cy - r * 1.12);
    g.lineTo(cx + r * 1.08, cy + r * 0.78);
    g.lineTo(cx - r * 1.08, cy + r * 0.78);
    g.closePath();
  } else if (ch === 2) {
    g.rect(cx - r * 0.86, cy - r * 0.86, r * 1.72, r * 1.72);
  } else {
    g.arc(cx, cy, r, 0, TAU);
  }
}

// Channel mark: circle, triangle or square. Hollow when idle, solid when its channel is active.
function paintGlyph(g, ch, cx, cy, r, active, accent) {
  glyphPath(g, ch, cx, cy, r);
  K(g, INK, r * 1.05);
  F(g, active ? mix(CREAM, accent, 0.12) : INK);
  glyphPath(g, ch, cx, cy, r);
  K(g, active ? '#fffaf0' : mix(CREAM, accent, 0.3), r * 0.4);
}

const BARK = '#a07a63';
const BARK_HI = '#d2b092';
const BARK_DK = '#5d4046';

function paintRoot(g, v, pressed, ch, accent) {
  paintFloor(g, v);
  const rnd = rng(5200 + ch * 31);
  const tendril = (pts, lw) => {
    open(g, pts);
    K(g, rgba(INK, 0.85), lw + 0.035);
    open(g, pts);
    K(g, BARK, lw);
  };
  // rootlets anchoring the pad into the floor
  tendril([[0.3, 0.42], [0.18, 0.28], [0.08, 0.2], [-0.04, 0.12]], 0.045);
  tendril([[0.7, 0.42], [0.84, 0.3], [0.92, 0.16], [1.04, 0.1]], 0.045);
  tendril([[0.36, 0.66], [0.26, 0.84], [0.14, 0.92], [0.08, 1.04]], 0.04);
  tendril([[0.66, 0.66], [0.78, 0.82], [0.9, 0.9], [1.04, 0.94]], 0.04);

  const cx = 0.5;
  const cy = pressed ? 0.55 : 0.48;
  const rx = pressed ? 0.37 : 0.315;
  const ry = pressed ? 0.275 : 0.255;
  const h = pressed ? 0 : 0.085;
  if (pressed) {
    // light seeping out from under the squashed pad, with little squash marks around it
    ell(g, cx, cy, 0.45, 0.45);
    F(g, radial(g, cx, cy, 0.44, [0, rgba(accent, 0.8), 0.65, rgba(accent, 0.4), 1, rgba(accent, 0)]));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU + 0.39;
      const c = Math.cos(a);
      const s = Math.sin(a);
      g.beginPath();
      g.moveTo(cx + c * rx * 1.14, cy + s * ry * 1.16);
      g.lineTo(cx + c * rx * 1.34, cy + s * ry * 1.4);
      K(g, INK, 0.055);
      g.beginPath();
      g.moveTo(cx + c * rx * 1.14, cy + s * ry * 1.16);
      g.lineTo(cx + c * rx * 1.34, cy + s * ry * 1.4);
      K(g, '#fff6dc', 0.026);
    }
  } else {
    // raised: a drop shadow and a visible side
    ell(g, cx + 0.01, cy + h + 0.035, rx * 1.1, ry * 1.04);
    F(g, rgba(INK, 0.4));
    ell(g, cx, cy + h, rx, ry);
    K(g, INK, 0.05);
    F(g, BARK_DK);
    g.fillStyle = BARK_DK;
    g.fillRect(cx - rx, cy, rx * 2, h);
    g.beginPath();
    g.moveTo(cx - rx, cy);
    g.lineTo(cx - rx, cy + h);
    g.moveTo(cx + rx, cy);
    g.lineTo(cx + rx, cy + h);
    K(g, INK, 0.025);
  }
  // the knotted top
  blob(g, cx, cy, rx, ry, rnd, 0.025, 14);
  K(g, INK, 0.05);
  F(g, BARK);
  ell(g, cx, cy, rx * 0.74, ry * 0.74);
  K(g, pressed ? mix(BARK_HI, accent, 0.35) : BARK_HI, pressed ? 0.06 : 0.08);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU + 0.2;
    const a2 = a + 0.22;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * rx * 0.56, cy + Math.sin(a) * ry * 0.56);
    g.lineTo(cx + Math.cos(a2) * rx * 0.93, cy + Math.sin(a2) * ry * 0.93);
    K(g, pressed ? rgba(mix(accent, '#ffffff', 0.55), 0.95) : rgba(INK, 0.7), pressed ? 0.024 : 0.02);
  }
  ell(g, cx, cy, rx * 0.5, ry * 0.5);
  F(g, pressed ? mix(accent, '#ffffff', 0.35) : BARK_DK);
  paintGlyph(g, ch, cx, cy, pressed ? 0.1 : 0.092, pressed, accent);
}

function paintGate(g, v, isOpen, ch, accent) {
  paintFloor(g, v);
  const root = (pts, lw) => {
    open(g, pts);
    K(g, INK, lw + 0.05);
    open(g, pts);
    K(g, BARK, lw);
    g.save();
    g.translate(-lw * 0.2, -lw * 0.2);
    open(g, pts);
    K(g, rgba(BARK_HI, 0.85), lw * 0.28);
    g.restore();
  };
  if (!isOpen) {
    // the lattice throws the whole tile into shade
    g.fillStyle = rgba(INK, 0.34);
    g.fillRect(-0.1, -0.1, 1.2, 1.2);
    root([[-0.1, 0.3], [0.2, 0.26], [0.5, 0.31], [0.8, 0.26], [1.1, 0.3]], 0.085);
    root([[-0.1, 0.72], [0.22, 0.76], [0.52, 0.71], [0.8, 0.76], [1.1, 0.72]], 0.085);
    root([[0.2, -0.1], [0.17, 0.25], [0.22, 0.5], [0.18, 0.78], [0.21, 1.1]], 0.1);
    root([[0.8, -0.1], [0.83, 0.22], [0.79, 0.5], [0.82, 0.76], [0.79, 1.1]], 0.1);
    root([[0.5, -0.1], [0.52, 0.15], [0.5, 0.36]], 0.1);
    root([[0.5, 0.64], [0.48, 0.86], [0.51, 1.1]], 0.1);
    // central knot carrying the channel mark
    const rnd = rng(6200 + ch * 17);
    blob(g, 0.5, 0.5, 0.2, 0.19, rnd, 0.04, 12);
    K(g, INK, 0.06);
    F(g, BARK);
    ell(g, 0.5, 0.5, 0.15, 0.14);
    K(g, rgba(BARK_HI, 0.8), 0.022);
    paintGlyph(g, ch, 0.5, 0.5, 0.095, false, accent);
    return;
  }
  // open: the roots have curled away into the four corners
  for (let sy = -1; sy <= 1; sy += 2) {
    for (let sx = -1; sx <= 1; sx += 2) {
      g.save();
      g.translate(0.5, 0.5);
      g.scale(sx, sy);
      g.translate(-0.5, -0.5);
      root([[-0.1, 0.3], [0.06, 0.31], [0.2, 0.25], [0.25, 0.13], [0.17, 0.05], [0.08, 0.1], [0.11, 0.18]], 0.075);
      root([[0.3, -0.1], [0.31, 0.02], [0.27, 0.08]], 0.06);
      g.restore();
    }
  }
  ell(g, 0.5, 0.5, 0.3, 0.3);
  F(g, radial(g, 0.5, 0.5, 0.26, [0, rgba(accent, 0.5), 1, rgba(accent, 0)]));
  paintGlyph(g, ch, 0.5, 0.5, 0.085, true, accent);
}

// ---------------------------------------------------------------------------
// Lantern, Wren and the creatures
// ---------------------------------------------------------------------------

const BRASS = '#a06f3c';
const BRASS_DK = '#5e3d2a';
const BRASS_HI = '#e0b266';

// The lamplighter's lantern: ring, cap, glowing glass, base. `top` is the top of the ring.
function paintLantern(g, cx, top, h, flame, out) {
  const w = h * 0.52;
  ell(g, cx, top + h * 0.1, h * 0.085, h * 0.09);
  K(g, INK, h * 0.11);
  ell(g, cx, top + h * 0.1, h * 0.085, h * 0.09);
  K(g, BRASS, h * 0.05);
  const cap = [[cx - w * 0.2, top + h * 0.18], [cx + w * 0.2, top + h * 0.18], [cx + w * 0.54, top + h * 0.34], [cx - w * 0.54, top + h * 0.34]];
  const glass = [[cx - w * 0.4, top + h * 0.33], [cx + w * 0.4, top + h * 0.33], [cx + w * 0.46, top + h * 0.85], [cx - w * 0.46, top + h * 0.85]];
  const base = [[cx - w * 0.54, top + h * 0.84], [cx + w * 0.54, top + h * 0.84], [cx + w * 0.45, top + h * 0.985], [cx - w * 0.45, top + h * 0.985]];
  poly(g, glass, h * 0.04);
  K(g, INK, h * 0.1);
  poly(g, cap, h * 0.035);
  K(g, INK, h * 0.1);
  poly(g, base, h * 0.035);
  K(g, INK, h * 0.1);
  poly(g, glass, h * 0.04);
  if (out) {
    // smothered: cold glass, a bare wick
    F(g, '#5a4a66');
    g.beginPath();
    g.moveTo(cx, top + h * 0.78);
    g.lineTo(cx, top + h * 0.62);
    K(g, INK, h * 0.04);
    g.beginPath();
    g.moveTo(cx - w * 0.3, top + h * 0.4);
    g.lineTo(cx - w * 0.33, top + h * 0.62);
    K(g, rgba(CREAM, 0.35), h * 0.035);
  } else {
    F(g, radial(g, cx, top + h * 0.62, h * 0.32, [0, '#fffbe0', 0.5, '#ffe08a', 1, '#f2b04c']));
    // flame
    const fx = cx + [0, -0.014, 0.016][flame] * h;
    const fh = [1, 1.12, 0.9][flame];
    const fy = top + h * 0.78;
    g.beginPath();
    g.moveTo(fx, fy - h * 0.34 * fh);
    g.bezierCurveTo(cx + h * 0.12, fy - h * 0.13, cx + h * 0.1, fy, cx, fy);
    g.bezierCurveTo(cx - h * 0.1, fy, cx - h * 0.12, fy - h * 0.13, fx, fy - h * 0.34 * fh);
    F(g, '#f08a24');
    g.beginPath();
    g.moveTo((fx + cx) / 2, fy - h * 0.2 * fh);
    g.bezierCurveTo(cx + h * 0.06, fy - h * 0.08, cx + h * 0.05, fy - h * 0.02, cx, fy - h * 0.02);
    g.bezierCurveTo(cx - h * 0.05, fy - h * 0.02, cx - h * 0.06, fy - h * 0.08, (fx + cx) / 2, fy - h * 0.2 * fh);
    F(g, '#fffbe6');
  }
  // frame bars
  g.beginPath();
  g.moveTo(cx - w * 0.2, top + h * 0.34);
  g.lineTo(cx - w * 0.23, top + h * 0.84);
  g.moveTo(cx + w * 0.2, top + h * 0.34);
  g.lineTo(cx + w * 0.23, top + h * 0.84);
  K(g, rgba(BRASS_DK, 0.8), h * 0.032);
  poly(g, cap, h * 0.035);
  F(g, BRASS);
  g.beginPath();
  g.moveTo(cx - w * 0.2, top + h * 0.215);
  g.lineTo(cx - w * 0.4, top + h * 0.31);
  K(g, rgba(BRASS_HI, 0.9), h * 0.035);
  poly(g, base, h * 0.035);
  F(g, BRASS_DK);
  g.beginPath();
  g.moveTo(cx - w * 0.42, top + h * 0.885);
  g.lineTo(cx + w * 0.1, top + h * 0.885);
  K(g, rgba(BRASS_HI, 0.6), h * 0.03);
}

function paintPlantedLantern(g, flame) {
  // warm halo and a pool of light on the ground
  ell(g, 0.5, 0.55, 0.75, 0.75);
  F(g, radial(g, 0.5, 0.55, 0.7, [0, 'rgba(255,214,128,0.6)', 0.45, 'rgba(242,176,76,0.26)', 1, 'rgba(242,176,76,0)']));
  ell(g, 0.5, 0.875, 0.3, 0.085);
  F(g, 'rgba(255,232,170,0.4)');
  ell(g, 0.5, 0.885, 0.2, 0.05);
  F(g, rgba(INK, 0.4));
  const rnd = rng(77);
  blob(g, 0.5, 0.875, 0.16, 0.045, rnd, 0.1, 9);
  K(g, rgba(INK, 0.9), 0.03);
  F(g, '#6a4d4c');
  paintLantern(g, 0.5, 0.17, 0.7, flame);
}

function paintWren(g, dir, carrying, out) {
  if (dir === 'W') {
    g.translate(1, 0);
    g.scale(-1, 1);
    dir = 'E';
  }
  const S = dir === 'S';
  const N = dir === 'N';
  const E = dir === 'E';
  const wool = '#e3a244';
  const woolDk = '#b3722d';
  const woolHi = '#f5cc80';
  const skin = '#f4cfad';
  const boot = '#3b2742';
  const rnd = rng(31 + (S ? 0 : N ? 1 : 2));
  const hx = E ? 0.47 : 0.5; // hood centre
  const hy = 0.4;
  const L = S ? { x: 0.785, top: 0.5, h: 0.41 } : N ? { x: 0.795, top: 0.3, h: 0.39 } : { x: 0.835, top: 0.5, h: 0.41 };

  ell(g, 0.5, 0.905, 0.24, 0.058);
  F(g, rgba(INK, 0.36));
  if (carrying) {
    if (!out) {
      const gy = L.top + L.h * 0.62;
      ell(g, L.x, gy, 0.42, 0.42);
      F(g, radial(g, L.x, gy, 0.4, [0, 'rgba(255,214,128,0.62)', 0.5, 'rgba(242,176,76,0.25)', 1, 'rgba(242,176,76,0)']));
    }
    if (N) paintLantern(g, L.x, L.top, L.h, 0, out);
  }

  // boots
  const bootAt = (x, y, rx) => {
    ell(g, x, y, rx, 0.05);
    K(g, INK, 0.04);
    F(g, boot);
    ell(g, x - rx * 0.2, y - 0.018, rx * 0.45, 0.014);
    F(g, rgba('#7a5a86', 0.7));
  };
  if (E) {
    bootAt(0.43, 0.885, 0.085);
    bootAt(0.585, 0.89, 0.085);
  } else {
    bootAt(0.415, 0.89, 0.075);
    bootAt(0.585, 0.89, 0.075);
  }

  // poncho and hood, outlined as one soft gumdrop
  const o = E ? -0.025 : 0;
  const body = [[0.37 + o, 0.57], [0.63 + o, 0.57], [0.715 + o, 0.8], [0.67 + o, 0.865], [0.5 + o, 0.885], [0.33 + o, 0.865], [0.285 + o, 0.8]];
  const tipS = [[0.43, 0.21], [0.5, 0.11], [0.62, 0.055], [0.73, 0.085], [0.735, 0.165], [0.64, 0.15], [0.58, 0.22]];
  const tip = S ? tipS : tipS.map((p) => [2 * hx - p[0] + (E ? 0.03 : 0), p[1]]);
  const hood = () => blob(g, hx, hy, 0.25, 0.245, null, 0, 14);
  closed(g, body);
  K(g, INK, 0.055);
  hood();
  K(g, INK, 0.055);
  closed(g, tip);
  K(g, INK, 0.055);
  closed(g, body);
  F(g, wool);
  g.save();
  closed(g, body);
  g.clip();
  blob(g, 0.5 + o, 0.9, 0.3, 0.1, rnd, 0.08, 9);
  F(g, rgba(woolDk, 0.55));
  for (let i = 0; i < 6; i++) {
    ell(g, 0.33 + o + i * 0.068, 0.835 + Math.sin(i * 1.3) * 0.006, 0.012, 0.012);
    F(g, CREAM);
  }
  g.restore();
  closed(g, tip);
  F(g, wool);
  hood();
  F(g, wool);
  g.save();
  hood();
  g.clip();
  blob(g, hx - 0.03, hy + 0.2, 0.3, 0.1, rnd, 0.08, 9);
  F(g, rgba(woolDk, 0.5));
  blob(g, hx - 0.09, hy - 0.15, 0.1, 0.045, rnd, 0.1, 8, -0.5);
  F(g, rgba(woolHi, 0.75));
  // knit ticks
  for (let i = 0; i < 7; i++) {
    const a = -2.6 + i * 0.36;
    const x = hx + Math.cos(a) * 0.205;
    const y = hy + Math.sin(a) * 0.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * 0.03, y + Math.sin(a) * 0.03);
    K(g, rgba(woolDk, 0.75), 0.016);
  }
  g.restore();

  if (S || E) {
    // face framed by a cream wool trim
    const fx = S ? 0.5 : 0.607;
    const frx = S ? 0.172 : 0.118;
    ell(g, fx, 0.455, frx, 0.143);
    K(g, rgba(INK, 0.7), 0.03);
    F(g, CREAM);
    const sx = S ? 0.5 : 0.617;
    const srx = S ? 0.134 : 0.09;
    ell(g, sx, 0.463, srx, 0.108);
    F(g, skin);
    g.save();
    ell(g, sx, 0.463, srx, 0.108);
    g.clip();
    blob(g, sx - (E ? 0.03 : 0), 0.365, srx * 1.25, 0.045, rnd, 0.1, 8);
    F(g, '#5c3b3c');
    g.restore();
    const e1 = S ? 0.447 : 0.6;
    const e2 = S ? 0.553 : 0.672;
    ell(g, e1, 0.478, 0.029, 0.033);
    F(g, INK);
    ell(g, e2, 0.478, E ? 0.024 : 0.029, 0.033);
    F(g, INK);
    ell(g, e1 - 0.009, 0.468, 0.009, 0.009);
    F(g, '#ffffff');
    ell(g, e2 - 0.009, 0.468, 0.009, 0.009);
    F(g, '#ffffff');
    ell(g, S ? 0.405 : 0.585, 0.528, 0.028, 0.018);
    F(g, rgba(ROSE, 0.7));
    ell(g, S ? 0.595 : 0.68, 0.528, E ? 0.02 : 0.028, 0.018);
    F(g, rgba(ROSE, 0.7));
    g.beginPath();
    g.arc(S ? 0.5 : 0.64, 0.518, 0.02, 0.15 * Math.PI, 0.85 * Math.PI);
    K(g, rgba('#7a3d3d', 0.9), 0.014);
  } else {
    // back of the hood: a seam and a row of stitches
    open(g, [[0.5, 0.17], [0.488, 0.4], [0.5, 0.63]]);
    K(g, rgba(woolDk, 0.9), 0.022);
    for (let i = 0; i < 5; i++) {
      ell(g, 0.36 + i * 0.07, 0.54 + Math.abs(i - 2) * -0.012, 0.012, 0.012);
      F(g, CREAM);
    }
  }
  // pom on the hood's tip
  const pom = tip[3];
  ell(g, pom[0] + (S ? 0.005 : -0.005), pom[1] + 0.04, 0.043, 0.043);
  K(g, INK, 0.035);
  F(g, CREAM);

  // mittens (and the lantern, held out on the side Wren faces)
  const mitten = (x, y) => {
    ell(g, x, y, 0.046, 0.044);
    K(g, INK, 0.04);
    F(g, ROSE);
  };
  const sleeve = (x0, y0, x1, y1) => {
    open(g, [[x0, y0], [x1, y1]]);
    K(g, INK, 0.115);
    open(g, [[x0, y0], [x1, y1]]);
    K(g, wool, 0.07);
  };
  if (S) {
    mitten(0.295, 0.715);
    if (carrying) {
      paintLantern(g, L.x, L.top, L.h, 0, out);
      sleeve(0.66, 0.63, 0.75, 0.57);
      mitten(0.775, 0.545);
    } else mitten(0.705, 0.715);
  } else if (N) {
    mitten(0.295, 0.715);
    if (carrying) {
      sleeve(0.67, 0.62, 0.74, 0.5);
      mitten(0.76, 0.46);
    } else mitten(0.705, 0.715);
  } else if (carrying) {
    paintLantern(g, L.x, L.top, L.h, 0, out);
    sleeve(0.6, 0.64, 0.77, 0.575);
    mitten(0.815, 0.55);
  } else {
    mitten(0.57, 0.72);
  }
}

function paintMoth(g, lit, f) {
  const cx = 0.5;
  const cy = 0.52;
  const rnd = rng(555);
  ell(g, 0.5, 0.92, 0.13, 0.034);
  F(g, rgba(INK, 0.3));
  // wings: three flutter positions, raised higher when delighted
  const ang = [-0.75, -0.22, 0.3][f] + (lit ? -0.1 : 0.06);
  for (let sx = -1; sx <= 1; sx += 2) {
    g.save();
    g.translate(cx + sx * 0.11, cy + 0.07);
    g.scale(sx, 1);
    g.rotate(ang * 0.45 + 0.55);
    const low = [[0, -0.035], [0.1, -0.075], [0.2, -0.04], [0.2, 0.045], [0.09, 0.075], [0, 0.04]];
    closed(g, low);
    K(g, INK, 0.05);
    F(g, '#e3a9af');
    g.restore();
    g.save();
    g.translate(cx + sx * 0.12, cy - 0.05);
    g.scale(sx, 1);
    g.rotate(ang);
    const up = [[0, -0.05], [0.12, -0.14], [0.28, -0.14], [0.345, -0.03], [0.27, 0.085], [0.1, 0.095], [0, 0.055]];
    closed(g, up);
    K(g, INK, 0.055);
    F(g, '#cf8493');
    g.save();
    closed(g, up);
    g.clip();
    closed(g, up);
    K(g, rgba('#f6e2d0', 0.9), 0.055);
    g.restore();
    ell(g, 0.215, -0.025, 0.05, 0.046);
    F(g, '#f6e6d2');
    ell(g, 0.215, -0.025, 0.025, 0.023);
    F(g, '#93485d');
    g.restore();
  }
  // antennae: feathery, springing up when delighted
  for (let sx = -1; sx <= 1; sx += 2) {
    const tipX = cx + sx * (lit ? 0.13 : 0.2);
    const tipY = lit ? 0.13 : 0.22;
    const pts = [[cx + sx * 0.06, 0.37], [cx + sx * (lit ? 0.08 : 0.13), lit ? 0.24 : 0.27], [tipX, tipY]];
    open(g, pts);
    K(g, INK, 0.03);
    for (let i = 1; i <= 3; i++) {
      const t = i / 3.4;
      const x = pts[0][0] + (tipX - pts[0][0]) * t;
      const y = pts[0][1] + (tipY - pts[0][1]) * t - 0.012;
      g.beginPath();
      g.moveTo(x - sx * 0.03, y - 0.02);
      g.lineTo(x + sx * 0.035, y + 0.012);
      K(g, INK, 0.016);
    }
    ell(g, tipX, tipY, 0.022, 0.022);
    F(g, lit ? AMBER : INK);
  }
  // fluffy round body
  const fluff = 15;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < fluff; i++) {
      const a = (i / fluff) * TAU + 0.2;
      ell(g, cx + Math.cos(a) * 0.168, cy + Math.sin(a) * 0.168, pass ? 0.045 : 0.068, pass ? 0.045 : 0.068);
      F(g, pass ? '#f8f0e0' : INK);
    }
    ell(g, cx, cy, pass ? 0.185 : 0.2, pass ? 0.185 : 0.2);
    F(g, pass ? '#f8f0e0' : INK);
  }
  g.save();
  ell(g, cx, cy, 0.21, 0.21);
  g.clip();
  blob(g, cx + 0.02, cy + 0.17, 0.2, 0.085, rnd, 0.1, 9);
  F(g, rgba('#dcc4ab', 0.8));
  g.restore();
  for (let i = 0; i < 5; i++) {
    const a = 0.5 + i * 0.5;
    const x = cx + Math.cos(a) * 0.12;
    const y = cy + 0.05 + Math.sin(a) * 0.1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + 0.012, y + 0.028);
    K(g, rgba('#c9ae93', 0.9), 0.014);
  }
  // little feet
  ell(g, cx - 0.06, cy + 0.2, 0.022, 0.016);
  F(g, '#a85f72');
  ell(g, cx + 0.06, cy + 0.2, 0.022, 0.016);
  F(g, '#a85f72');
  // face
  if (lit) {
    for (let sx = -1; sx <= 1; sx += 2) {
      g.beginPath();
      g.arc(cx + sx * 0.078, cy - 0.005, 0.045, 1.12 * Math.PI, 1.88 * Math.PI);
      K(g, INK, 0.032);
      ell(g, cx + sx * 0.13, cy + 0.055, 0.03, 0.019);
      F(g, rgba(ROSE, 0.75));
    }
    g.beginPath();
    g.arc(cx, cy + 0.045, 0.04, 0.05 * Math.PI, 0.95 * Math.PI);
    g.closePath();
    K(g, INK, 0.02);
    F(g, '#8c3f52');
    sparkle(g, 0.87, 0.3, 0.045);
    F(g, '#fff6dc');
    sparkle(g, 0.12, 0.66, 0.036);
    F(g, '#fff6dc');
    sparkle(g, 0.84, 0.74, 0.03);
    F(g, '#fff6dc');
  } else {
    for (let sx = -1; sx <= 1; sx += 2) {
      ell(g, cx + sx * 0.078, cy - 0.01, 0.052, 0.06);
      F(g, INK);
      ell(g, cx + sx * 0.078 - 0.016, cy - 0.03, 0.019, 0.021);
      F(g, '#ffffff');
      ell(g, cx + sx * 0.078 + 0.016, cy + 0.012, 0.009, 0.009);
      F(g, rgba('#ffffff', 0.8));
    }
    g.beginPath();
    g.arc(cx, cy + 0.07, 0.016, 0.1 * Math.PI, 0.9 * Math.PI);
    K(g, INK, 0.016);
  }
}

const SHELL = '#c2707f';
const SHELL_DK = '#93485d';
const SHELL_BAND = '#f3dfc8';
const WHELK_SKIN = '#f1dbc5';

function paintWhelk(g, hidden, f) {
  const rnd = rng(640);
  if (hidden) {
    // shut tight: a squat, flat-footed block of shell
    ell(g, 0.5, 0.89, 0.37, 0.066);
    F(g, rgba(INK, 0.55));
    for (let sx = -1; sx <= 1; sx += 2) {
      g.beginPath();
      g.arc(0.5 + sx * 0.4, 0.86, 0.05, sx < 0 ? 0.55 * Math.PI : 0.05 * Math.PI, sx < 0 ? 0.95 * Math.PI : 0.45 * Math.PI);
      K(g, rgba(INK, 0.7), 0.022);
    }
    const shell = [[0.2, 0.8], [0.8, 0.8], [0.84, 0.5], [0.68, 0.24], [0.32, 0.24], [0.16, 0.5]];
    poly(g, shell, 0.11);
    K(g, INK, 0.065);
    F(g, SHELL);
    g.save();
    poly(g, shell, 0.11);
    g.clip();
    blob(g, 0.66, 0.74, 0.3, 0.2, rnd, 0.08, 9);
    F(g, rgba(SHELL_DK, 0.6));
    blob(g, 0.36, 0.33, 0.13, 0.05, rnd, 0.1, 8, -0.5);
    F(g, rgba('#eeb1b6', 0.75));
    spiral(g, 0.5, 0.5, 0.025, 0.225, 2.15, -0.5, 0.92);
    K(g, rgba(INK, 0.6), 0.082);
    spiral(g, 0.5, 0.5, 0.025, 0.225, 2.15, -0.5, 0.92);
    K(g, SHELL_BAND, 0.046);
    g.restore();
    // thick foot-plate with the door pulled shut
    const lipPts = [[0.14, 0.7], [0.86, 0.7], [0.845, 0.855], [0.155, 0.855]];
    poly(g, lipPts, 0.045);
    K(g, INK, 0.06);
    F(g, '#ecd2ba');
    ell(g, 0.5, 0.78, 0.11, 0.04);
    K(g, INK, 0.03);
    F(g, '#8c5564');
    g.beginPath();
    g.moveTo(0.41, 0.78);
    g.lineTo(0.59, 0.78);
    K(g, INK, 0.018);
    return;
  }
  // out and about: a tilted shell, a soft foot, two shy eye stalks
  const dx = f ? 0.012 : 0;
  ell(g, 0.52, 0.895, 0.31, 0.052);
  F(g, rgba(INK, 0.32));
  const foot = [[0.26, 0.82], [0.42, 0.75], [0.62, 0.76], [0.72, 0.64], [0.84, 0.6], [0.92, 0.68], [0.92, 0.8], [0.84, 0.875], [0.5, 0.885], [0.3, 0.875]];
  // stalks behind the head
  const stalk = (x0, y0, x1, y1) => {
    open(g, [[x0, y0], [(x0 + x1) / 2 - 0.02, (y0 + y1) / 2], [x1, y1]]);
    K(g, INK, 0.085);
    open(g, [[x0, y0], [(x0 + x1) / 2 - 0.02, (y0 + y1) / 2], [x1, y1]]);
    K(g, WHELK_SKIN, 0.045);
  };
  const ex1 = 0.7 + dx;
  const ey1 = 0.37;
  const ex2 = 0.88 - dx;
  const ey2 = 0.41;
  stalk(0.76, 0.66, ex1, ey1 + 0.04);
  stalk(0.86, 0.66, ex2, ey2 + 0.04);
  closed(g, foot);
  K(g, INK, 0.055);
  F(g, WHELK_SKIN);
  g.save();
  closed(g, foot);
  g.clip();
  blob(g, 0.62, 0.9, 0.36, 0.05, rnd, 0.1, 9);
  F(g, rgba('#d2b196', 0.8));
  g.restore();
  // eyes: looking down and away, lids half lowered
  const eye = (x, y) => {
    ell(g, x, y, 0.062, 0.062);
    K(g, INK, 0.04);
    F(g, '#fffaf0');
    ell(g, x - 0.016, y + 0.02, 0.03, 0.032);
    F(g, INK);
    g.save();
    ell(g, x, y, 0.062, 0.062);
    g.clip();
    g.fillStyle = WHELK_SKIN;
    g.fillRect(x - 0.08, y - 0.08, 0.16, 0.05);
    g.restore();
    g.beginPath();
    g.moveTo(x - 0.062, y - 0.028);
    g.lineTo(x + 0.062, y - 0.028);
    K(g, INK, 0.02);
  };
  eye(ex1, ey1);
  eye(ex2, ey2);
  ell(g, 0.845, 0.755, 0.034, 0.02);
  F(g, rgba(ROSE, 0.7));
  open(g, [[0.865, 0.8], [0.885, 0.79], [0.9, 0.8]]);
  K(g, INK, 0.014);
  // shell
  blob(g, 0.39, 0.52, 0.275, 0.265, rnd, 0.02, 14);
  K(g, INK, 0.06);
  F(g, SHELL);
  g.save();
  blob(g, 0.39, 0.52, 0.275, 0.265, null, 0, 14);
  g.clip();
  blob(g, 0.5, 0.74, 0.28, 0.13, rnd, 0.08, 9);
  F(g, rgba(SHELL_DK, 0.6));
  blob(g, 0.29, 0.36, 0.11, 0.045, rnd, 0.1, 8, -0.6);
  F(g, rgba('#eeb1b6', 0.75));
  spiral(g, 0.39, 0.53, 0.025, 0.215, 2.15, 0.6);
  K(g, rgba(INK, 0.6), 0.08);
  spiral(g, 0.39, 0.53, 0.025, 0.215, 2.15, 0.6);
  K(g, SHELL_BAND, 0.045);
  g.restore();
  // the shell's lip where the body comes out
  open(g, [[0.6, 0.6], [0.66, 0.7], [0.62, 0.79]]);
  K(g, INK, 0.07);
  open(g, [[0.6, 0.6], [0.66, 0.7], [0.62, 0.79]]);
  K(g, '#ecd2ba', 0.035);
}

const CAP = '#d07f8c';
const CAP_HI = '#efb8ba';
const CAP_DK = '#9a4d61';
const STUMP_BODY = '#f1e2c8';
const STUMP_SIDE = '#c6ab8c';
const STUMP_FOOT = '#d6bd9b';

// Stumpcap, seen mostly from above: a blocky spotted cap, a pale block of a head poking out in
// front of it with the eyes on top, two stubby feet beside the head, and a chevron on the cap.
// Everything is built facing south (local +y) and turned to its facing; height is added by
// sweeping the shapes down the screen.
function paintStump(g, dir, awake, f) {
  const th = dir === 'W' ? Math.PI / 2 : dir === 'N' ? Math.PI : dir === 'E' ? -Math.PI / 2 : 0;
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const capH = 0.05;
  const H = awake ? 0.125 : 0.08;
  const cx = 0.5;
  const cy = (awake ? 0.45 : 0.49) - (awake && f ? 0.012 : 0);
  const back = -0.035;
  const R = (x, y, lift) => {
    const yy = y + back;
    return [cx + x * cs - yy * sn, cy + x * sn + yy * cs + (lift || 0)];
  };
  const at = (pts, lift) => pts.map((p) => R(p[0], p[1], lift));
  const ext = awake ? 0.335 : 0.3; // how far the head reaches out
  const capL = [[-0.29, -0.3], [0.29, -0.3], [0.29, 0.13], [-0.29, 0.13]];
  const bodyL = [[-0.2, -0.2], [0.2, -0.2], [0.2, ext], [-0.2, ext]];
  const footprint = [[-0.29, -0.3], [0.29, -0.3], [0.29, 0.13], [0.2, ext], [-0.2, ext], [-0.29, 0.13]];

  poly(g, at(footprint, H + 0.04), 0.09);
  F(g, rgba(INK, 0.36));

  // stubby feet: mid-stride when awake, tucked under the cap when asleep
  const foot = (x, y0, y1) => {
    const lift = H * 0.6;
    poly(g, at([[x - 0.062, y0], [x + 0.062, y0], [x + 0.062, y1], [x - 0.062, y1]], lift), 0.05);
    K(g, INK, 0.055);
    F(g, STUMP_FOOT);
    const a = R(x - 0.028, y1 - 0.04, lift);
    const b = R(x + 0.028, y1 - 0.04, lift);
    g.beginPath();
    g.moveTo(a[0], a[1]);
    g.lineTo(b[0], b[1]);
    K(g, rgba('#fff3dc', 0.75), 0.022);
  };
  if (awake) {
    foot(-0.275, f ? -0.04 : 0.1, f ? 0.25 : 0.42);
    foot(0.275, f ? 0.1 : -0.04, f ? 0.42 : 0.25);
  } else {
    foot(-0.275, -0.04, 0.205);
    foot(0.275, -0.04, 0.205);
  }

  // the body block: its side, swept down to the ground, then its top with the face
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 4; i >= 0; i--) {
      poly(g, at(bodyL, (H * i) / 4), 0.07);
      if (pass === 0) K(g, INK, 0.055);
      else F(g, i === 0 ? STUMP_BODY : STUMP_SIDE);
    }
  }
  for (let sx = -1; sx <= 1; sx += 2) {
    if (awake) {
      const e = R(sx * 0.098, ext - 0.1);
      ell(g, e[0], e[1], 0.052, 0.052);
      F(g, INK);
      ell(g, e[0] - 0.016, e[1] - 0.018, 0.016, 0.016);
      F(g, '#ffffff');
    } else {
      const e = R(sx * 0.098, ext - 0.078);
      g.beginPath();
      g.arc(e[0], e[1], 0.046, th + 0.1, th + Math.PI - 0.1);
      K(g, INK, 0.036);
    }
  }
  const m0 = R(-0.03, ext - 0.03);
  const m1 = R(0.03, ext - 0.03);
  g.beginPath();
  g.moveTo(m0[0], m0[1]);
  g.lineTo(m1[0], m1[1]);
  K(g, rgba(INK, 0.8), 0.018);

  // the cap: a thick rim swept down, then the spotted top
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 3; i >= 0; i--) {
      poly(g, at(capL, (capH * i) / 3), 0.1);
      if (pass === 0) K(g, INK, 0.055);
      else F(g, i === 0 ? CAP : CAP_DK);
    }
  }
  const top = at(capL, 0);
  g.save();
  poly(g, top, 0.1);
  g.clip();
  const rnd = rng(900);
  blob(g, cx - 0.1, cy - 0.16, 0.2, 0.1, rnd, 0.1, 9, -0.35);
  F(g, rgba(CAP_HI, 0.6));
  blob(g, cx + 0.12, cy + 0.22, 0.24, 0.1, rnd, 0.1, 9, -0.2);
  F(g, rgba(CAP_DK, 0.35));
  // the brim: a pale band along the front edge
  const b0 = R(-0.3, 0.12);
  const b1 = R(0.3, 0.12);
  g.beginPath();
  g.moveTo(b0[0], b0[1]);
  g.lineTo(b1[0], b1[1]);
  K(g, rgba('#f6dccf', 0.85), 0.05);
  g.restore();
  // square spots
  const spot = (x, y, r) => {
    poly(g, at([[x - r, y - r], [x + r, y - r], [x + r, y + r], [x - r, y + r]], 0), r * 0.5);
    F(g, rgba('#fbf0dc', 0.95));
  };
  spot(-0.195, -0.215, 0.04);
  spot(0.195, -0.215, 0.04);
  spot(-0.215, -0.02, 0.026);
  spot(0.215, -0.02, 0.026);
  // chevron pointing the way it walks
  const c0 = R(-0.11, -0.2);
  const c1 = R(0, -0.07);
  const c2 = R(0.11, -0.2);
  for (let pass = 0; pass < 2; pass++) {
    g.beginPath();
    g.moveTo(c0[0], c0[1]);
    g.lineTo(c1[0], c1[1]);
    g.lineTo(c2[0], c2[1]);
    if (pass === 0) K(g, INK, 0.095);
    else K(g, '#fff8e8', 0.05);
  }
}

function paintZed(g) {
  const z = () => {
    g.beginPath();
    g.moveTo(0.26, 0.26);
    g.lineTo(0.74, 0.26);
    g.lineTo(0.26, 0.74);
    g.lineTo(0.74, 0.74);
  };
  z();
  K(g, INK, 0.3);
  z();
  K(g, CREAM, 0.13);
}

function paintGlow(g) {
  ell(g, 0.5, 0.5, 0.5, 0.5);
  F(g, radial(g, 0.5, 0.5, 0.5, [0, 'rgba(255,214,130,0.9)', 0.35, 'rgba(250,180,84,0.42)', 1, 'rgba(242,176,76,0)']));
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

const ICONS = ['undo', 'restart', 'wait', 'hint', 'lantern', 'map', 'sound', 'mute', 'star', 'lock', 'contrast', 'book', 'comfort', 'glow'];

function arrowHead(g, x, y, ang, len) {
  g.moveTo(x + Math.cos(ang + 2.5) * len, y + Math.sin(ang + 2.5) * len);
  g.lineTo(x, y);
  g.lineTo(x + Math.cos(ang - 2.5) * len, y + Math.sin(ang - 2.5) * len);
}

function iconPath(g, name) {
  g.beginPath();
  switch (name) {
    case 'undo': {
      // a looping stroke that doubles back to the left
      const cx = 0.53, cy = 0.56, r = 0.25;
      g.arc(cx, cy, r, 0.42 * Math.PI, -1.02 * Math.PI, true);
      const ex = cx + Math.cos(-1.02 * Math.PI) * r;
      const ey = cy + Math.sin(-1.02 * Math.PI) * r;
      arrowHead(g, ex, ey + 0.02, Math.PI / 2 + 0.1, 0.17);
      break;
    }
    case 'restart': {
      const cx = 0.5, cy = 0.52, r = 0.27;
      g.arc(cx, cy, r, -0.3 * Math.PI, 1.42 * Math.PI);
      const a = -0.3 * Math.PI;
      const sx = cx + Math.cos(a) * r;
      const sy = cy + Math.sin(a) * r;
      arrowHead(g, sx - 0.005, sy - 0.03, -Math.PI / 2 - 0.55, 0.17);
      break;
    }
    case 'wait':
      // hourglass
      g.moveTo(0.27, 0.19);
      g.lineTo(0.73, 0.19);
      g.moveTo(0.27, 0.83);
      g.lineTo(0.73, 0.83);
      g.moveTo(0.32, 0.2);
      g.bezierCurveTo(0.32, 0.4, 0.47, 0.44, 0.47, 0.51);
      g.bezierCurveTo(0.47, 0.58, 0.32, 0.62, 0.32, 0.82);
      g.moveTo(0.68, 0.2);
      g.bezierCurveTo(0.68, 0.4, 0.53, 0.44, 0.53, 0.51);
      g.bezierCurveTo(0.53, 0.58, 0.68, 0.62, 0.68, 0.82);
      break;
    case 'hint':
      // a glowing bulb
      g.arc(0.5, 0.44, 0.2, 0.7 * Math.PI, 0.3 * Math.PI);
      g.lineTo(0.585, 0.72);
      g.lineTo(0.415, 0.72);
      g.closePath();
      g.moveTo(0.43, 0.83);
      g.lineTo(0.57, 0.83);
      g.moveTo(0.5, 0.1);
      g.lineTo(0.5, 0.15);
      g.moveTo(0.2, 0.22);
      g.lineTo(0.24, 0.26);
      g.moveTo(0.8, 0.22);
      g.lineTo(0.76, 0.26);
      break;
    case 'lantern':
      g.arc(0.5, 0.2, 0.075, 0, TAU);
      g.moveTo(0.4, 0.3);
      g.lineTo(0.6, 0.3);
      g.lineTo(0.7, 0.42);
      g.lineTo(0.3, 0.42);
      g.closePath();
      g.moveTo(0.34, 0.42);
      g.lineTo(0.31, 0.78);
      g.moveTo(0.66, 0.42);
      g.lineTo(0.69, 0.78);
      g.moveTo(0.27, 0.8);
      g.lineTo(0.73, 0.8);
      g.lineTo(0.68, 0.88);
      g.lineTo(0.32, 0.88);
      g.closePath();
      g.moveTo(0.5, 0.5);
      g.bezierCurveTo(0.6, 0.6, 0.57, 0.7, 0.5, 0.7);
      g.bezierCurveTo(0.43, 0.7, 0.4, 0.6, 0.5, 0.5);
      break;
    case 'map':
      g.moveTo(0.16, 0.3);
      g.lineTo(0.38, 0.21);
      g.lineTo(0.62, 0.3);
      g.lineTo(0.84, 0.21);
      g.lineTo(0.84, 0.71);
      g.lineTo(0.62, 0.8);
      g.lineTo(0.38, 0.71);
      g.lineTo(0.16, 0.8);
      g.closePath();
      g.moveTo(0.38, 0.21);
      g.lineTo(0.38, 0.71);
      g.moveTo(0.62, 0.3);
      g.lineTo(0.62, 0.8);
      break;
    case 'sound':
    case 'mute':
      g.moveTo(0.16, 0.41);
      g.lineTo(0.3, 0.41);
      g.lineTo(0.46, 0.26);
      g.lineTo(0.46, 0.74);
      g.lineTo(0.3, 0.59);
      g.lineTo(0.16, 0.59);
      g.closePath();
      if (name === 'sound') {
        g.moveTo(0.58 + 0.0, 0.4);
        g.quadraticCurveTo(0.66, 0.5, 0.58, 0.6);
        g.moveTo(0.69, 0.29);
        g.quadraticCurveTo(0.86, 0.5, 0.69, 0.71);
      } else {
        g.moveTo(0.6, 0.39);
        g.lineTo(0.82, 0.61);
        g.moveTo(0.82, 0.39);
        g.lineTo(0.6, 0.61);
      }
      break;
    case 'star':
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i / 10) * TAU;
        const r = i % 2 ? 0.155 : 0.35;
        const x = 0.5 + Math.cos(a) * r;
        const y = 0.53 + Math.sin(a) * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
      break;
    case 'lock':
      g.moveTo(0.34, 0.46);
      g.lineTo(0.34, 0.36);
      g.bezierCurveTo(0.34, 0.1, 0.66, 0.1, 0.66, 0.36);
      g.lineTo(0.66, 0.46);
      g.moveTo(0.25, 0.47);
      g.lineTo(0.75, 0.47);
      g.lineTo(0.75, 0.83);
      g.lineTo(0.25, 0.83);
      g.closePath();
      g.moveTo(0.5, 0.6);
      g.lineTo(0.5, 0.7);
      break;
    case 'contrast':
      g.arc(0.5, 0.5, 0.31, 0, TAU);
      break;
    case 'book':
      // an open field guide, for the Tutorials setting
      g.moveTo(0.5, 0.3);
      g.bezierCurveTo(0.41, 0.22, 0.27, 0.21, 0.15, 0.26);
      g.lineTo(0.15, 0.76);
      g.bezierCurveTo(0.27, 0.71, 0.41, 0.72, 0.5, 0.8);
      g.bezierCurveTo(0.59, 0.72, 0.73, 0.71, 0.85, 0.76);
      g.lineTo(0.85, 0.26);
      g.bezierCurveTo(0.73, 0.21, 0.59, 0.22, 0.5, 0.3);
      g.lineTo(0.5, 0.8);
      g.moveTo(0.24, 0.4);
      g.quadraticCurveTo(0.32, 0.37, 0.41, 0.41);
      g.moveTo(0.24, 0.53);
      g.quadraticCurveTo(0.32, 0.5, 0.41, 0.54);
      g.moveTo(0.59, 0.41);
      g.quadraticCurveTo(0.68, 0.37, 0.76, 0.4);
      break;
    case 'glow':
      // a small lantern with rays round it, for the Lantern styles (SPEC section 24)
      g.arc(0.5, 0.3, 0.05, 0, TAU);
      g.moveTo(0.42, 0.37);
      g.lineTo(0.58, 0.37);
      g.lineTo(0.64, 0.46);
      g.lineTo(0.36, 0.46);
      g.closePath();
      g.moveTo(0.38, 0.46);
      g.lineTo(0.36, 0.7);
      g.lineTo(0.64, 0.7);
      g.lineTo(0.62, 0.46);
      g.moveTo(0.33, 0.75);
      g.lineTo(0.67, 0.75);
      for (const [x0, y0, x1, y1] of [[0.18, 0.58, 0.08, 0.58], [0.82, 0.58, 0.92, 0.58], [0.24, 0.34, 0.15, 0.27], [0.76, 0.34, 0.85, 0.27], [0.27, 0.82, 0.19, 0.89], [0.73, 0.82, 0.81, 0.89]]) {
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      break;
    case 'comfort':
      // a large A and a small a, for the Comfort settings (SPEC section 22)
      g.moveTo(0.1, 0.8);
      g.lineTo(0.33, 0.2);
      g.lineTo(0.56, 0.8);
      g.moveTo(0.19, 0.58);
      g.lineTo(0.47, 0.58);
      g.moveTo(0.6, 0.8);
      g.lineTo(0.75, 0.44);
      g.lineTo(0.9, 0.8);
      g.moveTo(0.66, 0.67);
      g.lineTo(0.84, 0.67);
      break;
    default:
      g.arc(0.5, 0.5, 0.08, 0, TAU);
  }
}

function paintIcon(g, name) {
  // a touch of tilt and a soft second pass, like a brush pen on rough paper
  g.translate(0.5, 0.5);
  g.rotate(-0.035);
  g.translate(-0.5, -0.5);
  if (name === 'contrast') {
    g.beginPath();
    g.arc(0.5, 0.5, 0.31, -Math.PI / 2, Math.PI / 2);
    g.closePath();
    F(g, CREAM);
  }
  if (name === 'wait') {
    g.beginPath();
    g.moveTo(0.4, 0.78);
    g.quadraticCurveTo(0.5, 0.64, 0.6, 0.78);
    g.closePath();
    F(g, CREAM);
    ell(g, 0.5, 0.58, 0.016, 0.016);
    F(g, CREAM);
  }
  if (name === 'map') {
    ell(g, 0.27, 0.6, 0.022, 0.022);
    F(g, CREAM);
    ell(g, 0.5, 0.5, 0.022, 0.022);
    F(g, CREAM);
    ell(g, 0.73, 0.42, 0.03, 0.03);
    F(g, CREAM);
  }
  g.save();
  g.translate(0.012, 0.014);
  iconPath(g, name);
  K(g, rgba(CREAM, 0.3), 0.11);
  g.restore();
  iconPath(g, name);
  K(g, CREAM, 0.078);
}

// ---------------------------------------------------------------------------
// Public drawing functions
// ---------------------------------------------------------------------------

function nbMask(n) {
  return n ? (n.n ? 1 : 0) | (n.e ? 2 : 0) | (n.s ? 4 : 0) | (n.w ? 8 : 0) : 0;
}

function channelIndex(c) {
  if (typeof c === 'number') return c >= 0 && c <= 2 ? c | 0 : 0;
  if (typeof c !== 'string' || !c) return 0;
  const i = (c.charCodeAt(0) & 0x5f) - 65;
  return i >= 0 && i <= 2 ? i : 0;
}

// Tiles are opaque and fill their square. Kinds: floor, wall, puddle, bridge, bud, hush, root, gate, crystal.
// opts: { t, seed, lit, open, pressed, channel, accent, neighbors: { n, e, s, w } }
export function drawTile(ctx, kind, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const v = hashInt(seedInt(o.seed)) & 7;
  let key;
  let s;
  switch (kind) {
    case 'wall': {
      const nb = nbMask(o.neighbors);
      const wv = v & 3;
      key = K_WALL + 32 * (wv + 8 * nb);
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.55, (g) => paintWall(g, nb, wv), true);
      if (s) blit(ctx, s, px, py, size);
      return;
    }
    case 'puddle':
    case 'bridge': {
      const nb = nbMask(o.neighbors);
      const pv = v & 1;
      const bridge = kind === 'bridge';
      key = (bridge ? K_BRIDGE : K_PUDDLE) + 32 * (pv + 8 * nb);
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.5, (g) => (bridge ? paintBridge(g, nb, pv) : paintPuddle(g, nb, pv)), true);
      if (s) blit(ctx, s, px, py, size);
      return;
    }
    case 'hush': {
      const nb = nbMask(o.neighbors);
      const hv = v & 1;
      key = K_HUSH + 32 * (hv + 8 * nb);
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.35, (g) => paintHush(g, nb, hv), true);
      if (!s) return;
      blit(ctx, s, px, py, size);
      // slow shimmer: two outline phases breathing against each other
      const t = o.t || 0;
      const w = 0.5 + 0.5 * Math.sin(t * 0.9 + (v & 7) * 0.8);
      const al = ctx.globalAlpha;
      for (let ph = 0; ph < 2; ph++) {
        const k2 = K_HUSH_SHIM + 32 * (hv + 8 * (nb + 16 * ph));
        let sh = b.map.get(k2);
        if (sh === undefined) sh = make(b, k2, 0, 0, (g) => paintHushShimmer(g, nb, hv, ph));
        if (sh) {
          ctx.globalAlpha = al * (0.25 + 0.6 * (ph ? 1 - w : w));
          blit(ctx, sh, px, py, size);
        }
      }
      ctx.globalAlpha = al;
      return;
    }
    case 'bud': {
      const lit = o.lit ? 1 : 0;
      const acc = accentId(o.accent);
      const accent = o.accent || TEAL;
      key = K_BUD + 32 * (v + 8 * (lit + 4 * acc));
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.45, (g) => paintBud(g, v, lit, accent), true);
      if (!s) return;
      blit(ctx, s, px, py, size);
      if (lit) {
        const k2 = K_BUDGLOW + 32 * acc;
        let gl = b.map.get(k2);
        if (gl === undefined) gl = make(b, k2, 0, 0, (g) => paintBudGlow(g, accent));
        if (gl) {
          const t = o.t || 0;
          const al = ctx.globalAlpha;
          const op = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = al * (0.3 + 0.22 * Math.sin(t * 2.6 + (v & 7)));
          blit(ctx, gl, px, py, size);
          ctx.globalAlpha = al;
          ctx.globalCompositeOperation = op;
        }
      }
      return;
    }
    case 'crystal': {
      const nb = nbMask(o.neighbors);
      const cv = v & 3;
      key = K_CRYSTAL + 32 * (cv + 4 * nb);
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.3, (g) => paintCrystal(g, nb, cv), true);
      if (!s) return;
      blit(ctx, s, px, py, size);
      if (o.lit) {
        const k2 = K_CRYSTAL_GLINT + 32 * cv;
        let gl = b.map.get(k2);
        if (gl === undefined) gl = make(b, k2, 0, 0, (g) => paintCrystalGlint(g, cv));
        if (gl) {
          const t = o.t || 0;
          const al = ctx.globalAlpha;
          const op = ctx.globalCompositeOperation;
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = al * (0.35 + 0.25 * Math.sin(t * 2.1 + v));
          blit(ctx, gl, px, py, size);
          ctx.globalAlpha = al;
          ctx.globalCompositeOperation = op;
        }
      }
      return;
    }
    case 'root':
    case 'gate': {
      const ch = channelIndex(o.channel);
      const acc = accentId(o.accent);
      const accent = o.accent || CHANNEL_TINT[ch];
      const root = kind === 'root';
      const on = (root ? o.pressed : o.open) ? 1 : 0;
      key = (root ? K_ROOT : K_GATE) + 32 * (v + 8 * (on + 2 * (ch + 4 * acc)));
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.5, (g) => (root ? paintRoot(g, v, on, ch, accent) : paintGate(g, v, on, ch, accent)), true);
      if (s) blit(ctx, s, px, py, size);
      return;
    }
    default: {
      key = K_FLOOR + 32 * v;
      s = b.map.get(key);
      if (s === undefined) s = make(b, key, 0, 0.55, (g) => paintFloor(g, v), true);
      if (s) blit(ctx, s, px, py, size);
    }
  }
}

const SPRITE_MARGIN = 0.25;
const DIR_INDEX = { N: 0, E: 1, S: 2, W: 3 };
const DIR_NAME = ['N', 'E', 'S', 'W'];
const FLUTTER = [0, 1, 2, 1];
const WREN_GLOW = [[0.795, 0.54], [0.835, 0.75], [0.785, 0.75], [0.165, 0.75]]; // lantern centre per facing

function dirIndex(d) {
  const i = DIR_INDEX[d];
  return i === undefined ? 2 : i;
}

function glowSprite(b) {
  let s = b.map.get(K_GLOW);
  if (s === undefined) s = make(b, K_GLOW, 0, 0, paintGlow);
  return s;
}

// Additive warm glow centred on (cx, cy), `d` across.
function drawGlow(ctx, b, cx, cy, d, alpha) {
  const s = glowSprite(b);
  if (!s) return;
  const al = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = al * alpha;
  ctx.drawImage(s.c, cx - d / 2, cy - d / 2, d, d);
  ctx.globalAlpha = al;
  ctx.globalCompositeOperation = op;
}

function flicker(t) {
  return 0.5 + 0.28 * Math.sin(t * 9.1) + 0.22 * Math.sin(t * 14.3 + 1.7);
}

// Wren, the lamplighter. opts: { t, dir: 'N'|'E'|'S'|'W', carrying }
// Optional extra: `smothered: true` draws the carried lantern gone dark (Wren standing in the Hush).
export function drawWren(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const d = dirIndex(o.dir);
  const carrying = o.carrying ? 1 : 0;
  const out = carrying && o.smothered ? 1 : 0;
  const t = o.t || 0;
  const key = K_WREN + 32 * (d + 4 * (carrying + 2 * out));
  let s = b.map.get(key);
  if (s === undefined) s = make(b, key, SPRITE_MARGIN, 0.4, (g) => paintWren(g, DIR_NAME[d], carrying, out));
  if (!s) return;
  const bob = Math.sin(t * 2.4) * 0.012 * size;
  blit(ctx, s, px, py + bob, size);
  if (carrying && !out) {
    const p = WREN_GLOW[d];
    drawGlow(ctx, b, px + p[0] * size, py + p[1] * size + bob, size * 0.8, 0.2 + 0.14 * flicker(t));
  }
}

// The lantern planted on the ground. opts: { t }
export function drawLantern(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const t = o.t || 0;
  const f = FLUTTER[Math.floor(t * 7) & 3];
  const key = K_LANTERN + 32 * f;
  let s = b.map.get(key);
  if (s === undefined) s = make(b, key, SPRITE_MARGIN, 0.3, (g) => paintPlantedLantern(g, f));
  if (!s) return;
  blit(ctx, s, px, py, size);
  drawGlow(ctx, b, px + size * 0.5, py + size * 0.6, size * 1.25, 0.22 + 0.16 * flicker(t));
}

// Creatures. type 'M' Fluffmoth, 'S' Shellwhelk, 'T' Stumpcap. opts: { t, dir, lit, hidden, awake }
// (`hidden` and `awake` fall back to `lit` when they are left out.)
export function drawCreature(ctx, type, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const t = o.t || 0;
  let key;
  let s;
  if (type === 'M') {
    const lit = o.lit ? 1 : 0;
    const f = FLUTTER[Math.floor(t * (lit ? 12 : 8)) & 3];
    key = K_MOTH + 32 * (f + 4 * lit);
    s = b.map.get(key);
    if (s === undefined) s = make(b, key, SPRITE_MARGIN, 0.4, (g) => paintMoth(g, lit, f));
    if (s) blit(ctx, s, px, py + Math.sin(t * (lit ? 4.2 : 3)) * (lit ? 0.035 : 0.025) * size - 0.02 * size, size);
  } else if (type === 'S') {
    const hidden = (o.hidden === undefined ? o.lit : o.hidden) ? 1 : 0;
    const f = hidden ? 0 : Math.floor(t * 1.4) & 1;
    key = K_WHELK + 32 * (f + 2 * hidden);
    s = b.map.get(key);
    if (s === undefined) s = make(b, key, SPRITE_MARGIN, 0.45, (g) => paintWhelk(g, hidden, f));
    if (s) blit(ctx, s, px, py, size);
  } else if (type === 'T') {
    const awake = (o.awake === undefined ? o.lit : o.awake) ? 1 : 0;
    const d = dirIndex(o.dir);
    const f = awake ? Math.floor(t * 3.2) & 1 : 0;
    key = K_STUMP + 32 * (d + 4 * (awake + 2 * f));
    s = b.map.get(key);
    if (s === undefined) s = make(b, key, SPRITE_MARGIN, 0.45, (g) => paintStump(g, DIR_NAME[d], awake, f));
    if (!s) return;
    blit(ctx, s, px, py, size);
    if (!awake) {
      // sleepy z's: one that stays, one that drifts up and fades
      let z = b.map.get(K_ZED);
      if (z === undefined) z = make(b, K_ZED, 0, 0, paintZed);
      if (z) {
        const al = ctx.globalAlpha;
        const big = size * 0.3;
        const sway = Math.sin(t * 1.7) * 0.012 * size;
        ctx.drawImage(z.c, px + size * 0.7, py - size * 0.02 + sway, big, big);
        const p = (t * 0.45) % 1;
        const small = size * 0.2;
        ctx.globalAlpha = al * Math.sin(Math.PI * p);
        ctx.drawImage(z.c, px + size * (0.9 + 0.04 * p), py - size * (0.1 + 0.12 * p), small, small);
        ctx.globalAlpha = al;
      }
    }
  }
}

// Line icons in journal cream: undo, restart, wait, hint, lantern, map, sound, mute, star, lock, contrast, book.
export function drawIcon(ctx, name, px, py, size) {
  const b = bucketFor(ctx, size);
  const i = ICONS.indexOf(name);
  const key = K_ICON + 32 * (i + 1);
  let s = b.map.get(key);
  if (s === undefined) s = make(b, key, 0, 0.5, (g) => paintIcon(g, name));
  if (s) blit(ctx, s, px, py, size);
}

// ---------------------------------------------------------------------------
// Darkness
// ---------------------------------------------------------------------------

const DK = 12; // the light mask is computed at this many pixels per tile, then scaled up softly
const GUT = 2; // spare columns between the two layers
const NIGHT = [33, 23, 47];
const WARM = [255, 190, 104];
const MAX_SIDE = 4096;
const MAX_AREA = 8e6;

// Far from the light the darkness is one flat colour, so only the lit tiles and a one-tile border
// around them need a picture. That region is kept in ONE cached canvas at device resolution, two
// layers side by side: the plum darkness with its soft edge (left) and the lantern's warm bloom,
// already cut to the lit tiles (right). It is rebuilt only when the lit tiles, the board or tile
// size, the source (to a tenth of a tile) or highContrast change. A frame is then four flat fills
// around the region and two plain blits.
const dark = {
  c: null, g: null, low: null, lg: null, img: null,
  w: 0, h: 0, P: 0, sx: 0, sy: 0, sr: 0, hc: -1, tk: -1, fill: '',
  lit: null, mixed: null, any: false, valid: false,
  rx: 0, ry: 0, rw: 0, rh: 0, // region, in tiles
  gx: 0, gy: 0, gw: 0, gh: 0, // where the bloom is not empty, in cache pixels inside the region
};

function rebuildDark(w, h, P, lit, hasSource, sx, sy, sr, hc, tint = WARM) {
  const LW = w * DK;
  const LH = h * DK;
  const AW = LW * 2 + GUT;
  if (!dark.low || dark.low.width !== AW || dark.low.height !== LH) {
    dark.low = makeCanvas(AW, LH);
    if (!dark.low) return false;
    dark.lg = dark.low.getContext('2d');
    dark.img = dark.lg.createImageData(AW, LH);
  }

  // copy the lit map and find its bounding box
  const n = w * h;
  if (!dark.lit || dark.lit.length !== n) {
    dark.lit = new Uint8Array(n);
    dark.mixed = new Uint8Array(n);
  }
  const m = dark.lit;
  const mixed = dark.mixed;
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = lit && lit[y * w + x] ? 1 : 0;
      m[y * w + x] = v;
      if (v) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  const any = bx1 >= 0;
  const baseA = Math.round((hc ? 0.3 : 0.6) * 255);
  dark.w = w;
  dark.h = h;
  dark.P = P;
  dark.sx = sx;
  dark.sy = sy;
  dark.sr = sr;
  dark.hc = hc;
  dark.fill = 'rgba(' + NIGHT[0] + ',' + NIGHT[1] + ',' + NIGHT[2] + ',' + baseA / 255 + ')';
  dark.any = any;
  dark.valid = true;
  if (!any) return true;

  // the region: the lit tiles and one tile around them
  const rx0 = Math.max(0, bx0 - 1);
  const ry0 = Math.max(0, by0 - 1);
  const rx1 = Math.min(w, bx1 + 2);
  const ry1 = Math.min(h, by1 + 2);
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const own = m[y * w + x];
      let mix = 0;
      for (let oy = -1; oy <= 1 && !mix; oy++) {
        const yy = y + oy;
        if (yy < 0 || yy >= h) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox;
          if (xx >= 0 && xx < w && m[yy * w + xx] !== own) {
            mix = 1;
            break;
          }
        }
      }
      mixed[y * w + x] = mix;
    }
  }

  // the mask, at low resolution (one pixel of margin so scaling never reads stale pixels)
  const d = dark.img.data;
  const cxs = hasSource ? sx / 10 + 0.5 : (bx0 + bx1 + 1) / 2;
  const cys = hasSource ? sy / 10 + 0.5 : (by0 + by1 + 1) / 2;
  const reach = (hasSource ? sr / 10 : Math.max(bx1 - bx0, by1 - by0) / 2 + 0.5) + 0.9;
  const i0 = Math.max(0, rx0 * DK - 1);
  const i1 = Math.min(LW, rx1 * DK + 1);
  const j0 = Math.max(0, ry0 * DK - 1);
  const j1 = Math.min(LH, ry1 * DK + 1);
  for (let j = j0; j < j1; j++) {
    const v0 = (j + 0.5) / DK;
    const wobX = 0.028 * Math.sin(v0 * 5.3 + 0.7);
    const row = j * AW * 4;
    for (let i = i0; i < i1; i++) {
      const u0 = (i + 0.5) / DK;
      // a slightly wandering sample point gives the light a hand-painted edge
      const u = u0 + wobX;
      const v = v0 + 0.028 * Math.sin(u0 * 4.7 + 1.9);
      let tx = Math.floor(u);
      let ty = Math.floor(v);
      tx = tx < 0 ? 0 : tx >= w ? w - 1 : tx;
      ty = ty < 0 ? 0 : ty >= h ? h - 1 : ty;
      const own = m[ty * w + tx];
      let s = own;
      if (mixed[ty * w + tx]) {
        // signed distance to the nearest tile of the other kind: light keeps the shape of its tiles
        const fx = u - tx;
        const fy = v - ty;
        let best = 9;
        for (let oy = -1; oy <= 1; oy++) {
          const yy = ty + oy;
          if (yy < 0 || yy >= h) continue;
          const ddy = oy < 0 ? fy : oy > 0 ? 1 - fy : 0;
          for (let ox = -1; ox <= 1; ox++) {
            const xx = tx + ox;
            if (xx < 0 || xx >= w || m[yy * w + xx] === own) continue;
            const ddx = ox < 0 ? fx : ox > 0 ? 1 - fx : 0;
            const dd = ddx * ddx + ddy * ddy;
            if (dd < best) best = dd;
          }
        }
        const sd = own ? Math.sqrt(best) : -Math.sqrt(best);
        s = (sd + 0.15) / 0.2;
        s = s < 0 ? 0 : s > 1 ? 1 : s;
        s = s * s * (3 - 2 * s);
      }
      let aDark = baseA;
      let aGlow = 0;
      if (s > 0) {
        const dx = u0 - cxs;
        const dy = v0 - cys;
        const far = Math.min(1, Math.sqrt(dx * dx + dy * dy) / reach);
        const near = 1 - far;
        aDark = baseA * (1 - s) + s * 30 * far * far;
        aGlow = s * (20 + 76 * near * Math.sqrt(near));
      }
      const di = row + i * 4;
      const gi = row + (LW + GUT + i) * 4;
      d[di] = NIGHT[0];
      d[di + 1] = NIGHT[1];
      d[di + 2] = NIGHT[2];
      d[di + 3] = aDark;
      d[gi] = tint[0];
      d[gi + 1] = tint[1];
      d[gi + 2] = tint[2];
      d[gi + 3] = aGlow;
    }
    // gutter: repeat the neighbouring columns so scaling never bleeds one layer into the other
    const a = row + (LW - 1) * 4;
    const g0 = row + LW * 4;
    const b = row + (LW + GUT) * 4;
    for (let c = 0; c < 4; c++) {
      d[g0 + c] = d[a + c];
      d[g0 + 4 + c] = d[b + c];
    }
  }
  dark.lg.putImageData(dark.img, 0, 0);

  // scale the region up into the cache (bilinear filtering is what makes the edges soft)
  const RW = (rx1 - rx0) * P;
  const RH = (ry1 - ry0) * P;
  const CW = RW * 2 + GUT;
  if (!dark.c) {
    dark.c = makeCanvas(CW, RH);
    if (!dark.c) return false;
    dark.g = dark.c.getContext('2d');
  } else if (dark.c.width < CW || dark.c.height < RH || dark.c.width > CW * 2 || dark.c.height > RH * 2) {
    dark.c.width = CW;
    dark.c.height = RH;
  }
  const g = dark.g;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';
  g.imageSmoothingEnabled = true;
  g.clearRect(0, 0, CW, RH);
  const sxl = rx0 * DK;
  const syl = ry0 * DK;
  const swl = (rx1 - rx0) * DK;
  const shl = (ry1 - ry0) * DK;
  g.drawImage(dark.low, sxl, syl, swl, shl, 0, 0, RW, RH);
  g.drawImage(dark.low, LW + GUT + sxl, syl, swl, shl, RW + GUT, 0, RW, RH);

  if (hc) {
    // high contrast: a crisp line around the lit tiles
    g.save();
    g.beginPath();
    g.rect(0, 0, RW, RH);
    g.clip();
    g.lineCap = 'round';
    g.beginPath();
    for (let y = by0; y <= by1; y++) {
      for (let x = bx0; x <= bx1; x++) {
        if (!m[y * w + x]) continue;
        const X = (x - rx0) * P;
        const Y = (y - ry0) * P;
        if (y === 0 || !m[(y - 1) * w + x]) {
          g.moveTo(X, Y);
          g.lineTo(X + P, Y);
        }
        if (y === h - 1 || !m[(y + 1) * w + x]) {
          g.moveTo(X, Y + P);
          g.lineTo(X + P, Y + P);
        }
        if (x === 0 || !m[y * w + x - 1]) {
          g.moveTo(X, Y);
          g.lineTo(X, Y + P);
        }
        if (x === w - 1 || !m[y * w + x + 1]) {
          g.moveTo(X + P, Y);
          g.lineTo(X + P, Y + P);
        }
      }
    }
    g.strokeStyle = INK;
    g.lineWidth = Math.max(3, P * 0.1);
    g.stroke();
    g.strokeStyle = '#fff3d6';
    g.lineWidth = Math.max(1.5, P * 0.045);
    g.stroke();
    g.restore();
  }

  dark.rx = rx0;
  dark.ry = ry0;
  dark.rw = rx1 - rx0;
  dark.rh = ry1 - ry0;
  // the bloom only needs blitting where it is not empty: the lit tiles plus their soft edge
  dark.gx = Math.max(0, Math.floor((bx0 - 0.25 - rx0) * P));
  dark.gy = Math.max(0, Math.floor((by0 - 0.25 - ry0) * P));
  dark.gw = Math.min(RW, Math.ceil((bx1 + 1.25 - rx0) * P)) - dark.gx;
  dark.gh = Math.min(RH, Math.ceil((by1 + 1.25 - ry0) * P)) - dark.gy;
  return true;
}

// Paints the dark over a fully lit board whose top-left is (ox, oy).
// opts: { ox, oy, size, w, h, lit, source: { x, y, radius } | null, t, highContrast }
// `lit` is the engine's array (index y * w + x). `source.x/y` are tile coordinates like the
// lantern's (3 means the middle of column 3), fractions allowed. No source: everything is dark.
export function drawDarkness(ctx, opts) {
  const o = opts || NONE;
  const w = o.w | 0;
  const h = o.h | 0;
  if (w <= 0 || h <= 0) return;
  const size = o.size > 0 ? o.size : 40;
  const ox = o.ox || 0;
  const oy = o.oy || 0;
  const src = o.source || null;
  const lit = src ? o.lit : null;
  const hc = o.highContrast ? 1 : 0;
  // the lantern's light colour (SPEC section 24), r, g, b; the lamplighters' amber by default
  const tint = Array.isArray(o.tint) && o.tint.length === 3 ? o.tint : WARM;
  const tk = tint[0] * 65536 + tint[1] * 256 + tint[2];
  const sx = src ? Math.round((+src.x || 0) * 10) : -99999;
  const sy = src ? Math.round((+src.y || 0) * 10) : -99999;
  const sr = src ? Math.round((src.radius > 0 ? src.radius : 1) * 10) : 0;

  // The context's scale and offset, read once per frame: the cache is kept at device resolution,
  // and the region's edges are snapped to whole device pixels so the fills meet it without a seam.
  let a = 0;
  let e = 0;
  let f = 0;
  let snap = false;
  if (typeof ctx.getTransform === 'function') {
    const tm = ctx.getTransform();
    if (tm.b === 0 && tm.c === 0 && tm.a > 0 && tm.a === tm.d) {
      a = tm.a;
      e = tm.e;
      f = tm.f;
      snap = true;
    }
  }
  if (!snap) a = ctxScale(ctx);

  let P = Math.round(size * a);
  const cap = Math.min(Math.floor((MAX_SIDE - GUT) / (2 * w)), Math.floor(MAX_SIDE / h), Math.floor(Math.sqrt(MAX_AREA / (2 * w * h))));
  if (P > cap) P = cap;
  if (P < 4) P = 4;
  const n = w * h;
  let dirty = !dark.valid || dark.w !== w || dark.h !== h || dark.P !== P || dark.sx !== sx || dark.sy !== sy || dark.sr !== sr || dark.hc !== hc || dark.tk !== tk;
  if (!dirty) {
    const m = dark.lit;
    for (let i = 0; i < n; i++) {
      if ((lit && lit[i] ? 1 : 0) !== m[i]) {
        dirty = true;
        break;
      }
    }
  }
  if (dirty && !rebuildDark(w, h, P, lit, !!src, sx, sy, sr, hc, tint)) return;
  dark.tk = tk;

  // the board, plus the one device pixel that tiles bleed past it
  const px1 = 1 / a;
  const bx0 = ox - px1;
  const by0 = oy - px1;
  const bx1 = ox + w * size + px1;
  const by1 = oy + h * size + px1;
  const fs = ctx.fillStyle;
  ctx.fillStyle = dark.fill;
  if (!dark.any) {
    ctx.fillRect(bx0, by0, bx1 - bx0, by1 - by0);
    ctx.fillStyle = fs;
    return;
  }
  let x0 = ox + dark.rx * size;
  let y0 = oy + dark.ry * size;
  let x1 = x0 + dark.rw * size;
  let y1 = y0 + dark.rh * size;
  if (snap) {
    x0 = (Math.round(x0 * a + e) - e) / a;
    x1 = (Math.round(x1 * a + e) - e) / a;
    y0 = (Math.round(y0 * a + f) - f) / a;
    y1 = (Math.round(y1 * a + f) - f) / a;
  }
  if (y0 > by0) ctx.fillRect(bx0, by0, bx1 - bx0, y0 - by0);
  if (by1 > y1) ctx.fillRect(bx0, y1, bx1 - bx0, by1 - y1);
  if (x0 > bx0) ctx.fillRect(bx0, y0, x0 - bx0, y1 - y0);
  if (bx1 > x1) ctx.fillRect(x1, y0, bx1 - x1, y1 - y0);
  ctx.fillStyle = fs;

  const RW = dark.rw * P;
  const RH = dark.rh * P;
  const kx = (x1 - x0) / RW;
  const ky = (y1 - y0) / RH;
  const smooth = ctx.imageSmoothingEnabled;
  if (smooth === false) ctx.imageSmoothingEnabled = true;
  ctx.drawImage(dark.c, 0, 0, RW, RH, x0, y0, x1 - x0, y1 - y0);
  const t = o.t || 0;
  const al = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = al * (0.84 + 0.16 * flicker(t * 0.8));
  ctx.drawImage(dark.c, RW + GUT + dark.gx, dark.gy, dark.gw, dark.gh, x0 + dark.gx * kx, y0 + dark.gy * ky, dark.gw * kx, dark.gh * ky);
  ctx.globalAlpha = al;
  ctx.globalCompositeOperation = op;
  if (smooth === false) ctx.imageSmoothingEnabled = false;
}

// ---------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------

const back = { c: null, g: null, w: 0, h: 0, cw: 0, ch: 0 };
const moteSprites = new Map();
const MOTES = [];

function moteSprite(accent) {
  let c = moteSprites.get(accent);
  if (c !== undefined) return c;
  if (moteSprites.size > 12) moteSprites.clear();
  c = makeCanvas(32, 32);
  if (c) {
    const g = c.getContext('2d');
    g.fillStyle = radial(g, 16, 16, 16, [0, rgba(mix(accent, '#ffffff', 0.6), 1), 0.25, rgba(accent, 0.7), 1, rgba(accent, 0)]);
    g.fillRect(0, 0, 32, 32);
  }
  moteSprites.set(accent, c);
  return c;
}

function buildBackdrop(bw, bh) {
  const c = makeCanvas(bw, bh);
  if (!c) return null;
  const g = c.getContext('2d');
  const rnd = rng(1207);
  const big = Math.max(bw, bh);
  g.fillStyle = PALETTE.plum;
  g.fillRect(0, 0, bw, bh);
  // a faint breath of lighter air in the middle of the cave
  g.fillStyle = radial(g, bw * 0.5, bh * 0.44, big * 0.62, [0, 'rgba(70,50,94,0.5)', 1, 'rgba(70,50,94,0)']);
  g.fillRect(0, 0, bw, bh);
  // mottled washes
  for (let i = 0; i < 12; i++) {
    blob(g, rnd() * bw, rnd() * bh, big * (0.12 + rnd() * 0.2), big * (0.09 + rnd() * 0.14), rnd, 0.2, 9);
    F(g, i % 2 ? 'rgba(66,47,90,0.1)' : 'rgba(24,16,36,0.12)');
  }
  // rock shapes hanging at the top and heaped at the bottom
  const ridge = (y0, dirY, col, amp, seed) => {
    const r = rng(seed);
    g.beginPath();
    g.moveTo(-10, y0 - dirY * 40);
    const steps = 9;
    for (let i = 0; i <= steps; i++) {
      const x = (i / steps) * bw;
      const y = y0 + dirY * (0.3 + r() * 0.7) * amp;
      const xm = x - bw / steps / 2;
      g.quadraticCurveTo(xm, y0 + dirY * r() * amp * 1.5, x, y);
    }
    g.lineTo(bw + 10, y0 - dirY * 40);
    g.closePath();
    F(g, col);
  };
  ridge(0, 1, 'rgba(22,14,33,0.55)', bh * 0.1, 11);
  ridge(0, 1, 'rgba(16,10,25,0.6)', bh * 0.055, 12);
  ridge(bh, -1, 'rgba(22,14,33,0.55)', bh * 0.09, 13);
  ridge(bh, -1, 'rgba(16,10,25,0.6)', bh * 0.05, 14);
  // vignette
  const vg = g.createRadialGradient(bw / 2, bh / 2, big * 0.25, bw / 2, bh / 2, big * 0.78);
  vg.addColorStop(0, 'rgba(14,9,22,0)');
  vg.addColorStop(1, 'rgba(14,9,22,0.82)');
  g.fillStyle = vg;
  g.fillRect(0, 0, bw, bh);
  stampGrain(g, bw, bh, 0.16, 5, 1);
  return c;
}

// Quiet cave backdrop behind the board. opts: { t, accent }
export function drawBackdrop(ctx, width, height, opts) {
  if (!(width > 0 && height > 0)) return;
  const o = opts || NONE;
  const t = o.t || 0;
  const accent = o.accent || TEAL;
  // painted small (it is all soft shapes), then kept at device resolution so each frame is one plain blit
  const scale = ctxScale(ctx);
  let cw = Math.max(8, Math.round(width * scale));
  let ch = Math.max(8, Math.round(height * scale));
  const k = Math.min(1, MAX_SIDE / cw, MAX_SIDE / ch, Math.sqrt(MAX_AREA / (cw * ch)));
  if (k < 1) {
    cw = Math.floor(cw * k);
    ch = Math.floor(ch * k);
  }
  const bw = Math.max(8, Math.round(width / 3));
  const bh = Math.max(8, Math.round(height / 3));
  if (!back.c || back.cw !== cw || back.ch !== ch || back.w !== bw || back.h !== bh) {
    const low = buildBackdrop(bw, bh);
    if (!low) return;
    if (!back.c) {
      back.c = makeCanvas(cw, ch);
      back.g = back.c.getContext('2d', { alpha: false });
    } else if (back.c.width !== cw || back.c.height !== ch) {
      back.c.width = cw;
      back.c.height = ch;
    }
    const g = back.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = true;
    g.drawImage(low, 0, 0, cw, ch);
    stampGrain(g, cw, ch, 0.16, 9, Math.max(1, cw / Math.max(1, width)));
    back.w = bw;
    back.h = bh;
    back.cw = cw;
    back.ch = ch;
  }
  const smooth = ctx.imageSmoothingEnabled;
  if (smooth === false) ctx.imageSmoothingEnabled = true;
  ctx.drawImage(back.c, 0, 0, width, height);
  // drifting motes
  const m = moteSprite(accent);
  if (m) {
    if (!MOTES.length) {
      const r = rng(905);
      for (let i = 0; i < 16; i++) {
        MOTES.push({ x: r(), y: r(), sp: 0.006 + r() * 0.012, f: 0.2 + r() * 0.5, ph: r() * TAU, sw: 0.01 + r() * 0.025, r: 2.5 + r() * 4.5, tw: 0.5 + r() * 1.2 });
      }
    }
    const al = ctx.globalAlpha;
    for (let i = 0; i < MOTES.length; i++) {
      const a = MOTES[i];
      const yy = (((a.y - t * a.sp) % 1) + 1) % 1;
      const x = (a.x + Math.sin(t * a.f + a.ph) * a.sw) * width;
      const y = yy * (height + 40) - 20;
      const edge = Math.min(1, yy * 6, (1 - yy) * 6);
      ctx.globalAlpha = al * edge * (0.3 + 0.22 * Math.sin(t * a.tw + a.ph * 3));
      ctx.drawImage(m, x - a.r, y - a.r, a.r * 2, a.r * 2);
    }
    ctx.globalAlpha = al;
  }
  if (smooth === false) ctx.imageSmoothingEnabled = false;
}
