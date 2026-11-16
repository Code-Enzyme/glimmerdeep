// "Glowmark": the characters as dark velvet silhouettes with bioluminescent markings, like deep-sea
// and cave creatures. Bodies are soft plum-to-ink shapes with a gentle rim light; the markings (lines,
// bands, rings, spot rows) glow in moss teal, lantern amber and pale cream, and brighten and pulse
// when the creature is lit. There are NO faces: no eyes, mouths or face-like mark groupings. State is
// told by silhouette and motion (wings spread or folded, a foot sliding out or a sealed shell sitting
// low, a stump standing mid-stride or squatting asleep) and facing by hood tip, lean, chevrons and feet.
//
// Every sprite is painted once per (device-pixel size, kind, state, animation frame) into two offscreen
// canvases: the body (normal blend) and its glow (drawn with 'lighter' at a pulsing alpha). A frame is
// then a few drawImage calls per character. Canvases are made lazily, so the module imports in Node.
import { PALETTE } from '../sprites.js';

const TAU = Math.PI * 2;
const TEAL = PALETTE.teal || '#5FBFA8';
const AMBER = PALETTE.amber || '#F2B04C';
const CREAM = PALETTE.cream || '#F4EAD5';
const TRIM = '#F7D59C'; // Wren's cloak trim: pale lantern-cream
const OUTLINE = 'rgba(10,5,16,0.8)';
const RIM_COOL = '#6A5592';
const RIM_WARM = '#C99260';
const MARGIN = 0.25;
const EMIT_RIM = 'rgba(160,140,214,0.6)';

const T_CLOAK = ['#5C4886', '#30244B', '#160E23'];
const T_MOTH = ['#55427A', '#2E2145', '#150D20'];
const T_WING = ['#4D3B70', '#2A1E40', '#140C1E'];
const T_BRIDGE = ['#6E5A96', '#463764', '#2A1F40'];
const T_SHELL = ['#56395E', '#2D1B34', '#140A18'];
const T_FOOT = ['#625082', '#3B2C55', '#1E152E'];
const T_CAP = ['#74406A', '#43213F', '#1E0D1C'];
const T_STEM = ['#4E3D50', '#2C2030', '#150E19'];
const T_METAL = ['#5A4A66', '#2E2438', '#140E1A'];
const T_DEADGLASS = ['#3E3456', '#241C34', '#120C1A'];

// ---------------------------------------------------------------------------
// small utilities
// ---------------------------------------------------------------------------

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
  return null; // plain Node: drawing becomes a no-op
}

const rgbCache = new Map();
function rgb(c) {
  let v = rgbCache.get(c);
  if (!v) {
    const n = parseInt(c.slice(1, 7), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbCache.set(c, v);
  }
  return v;
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
}
function rgba(c, a) {
  const A = rgb(c);
  return `rgba(${A[0]},${A[1]},${A[2]},${a})`;
}

function flicker(t) {
  return 0.5 + 0.28 * Math.sin(t * 9.1) + 0.22 * Math.sin(t * 14.3 + 1.7);
}

// Smooth closed (or open) path through points [x, y, corner?] (Catmull-Rom as cubic Beziers).
function smooth(pts, closed = true) {
  const p = new Path2D();
  const n = pts.length;
  const tan = (i) => {
    if (pts[i][2]) return [0, 0];
    const a = closed ? pts[(i - 1 + n) % n] : pts[Math.max(0, i - 1)];
    const b = closed ? pts[(i + 1) % n] : pts[Math.min(n - 1, i + 1)];
    return [(b[0] - a[0]) / 6, (b[1] - a[1]) / 6];
  };
  p.moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const j = (i + 1) % n;
    const b = pts[j];
    const ta = tan(i);
    const tb = tan(j);
    p.bezierCurveTo(a[0] + ta[0], a[1] + ta[1], b[0] - tb[0], b[1] - tb[1], b[0], b[1]);
  }
  if (closed) p.closePath();
  return p;
}

// Polygon with rounded corners (blocky shapes).
function roundPoly(pts, r) {
  const p = new Path2D();
  const n = pts.length;
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const s = mid(pts[n - 1], pts[0]);
  p.moveTo(s[0], s[1]);
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const z = pts[(i - 1 + n) % n];
    const m = mid(a, b);
    p.arcTo(a[0], a[1], m[0], m[1], Math.min(r, d(a, b) / 2, d(a, z) / 2));
  }
  p.closePath();
  return p;
}
function rrect(x, y, w, h, r) {
  return roundPoly([[x, y], [x + w, y], [x + w, y + h], [x, y + h]], r);
}
function ell(cx, cy, rx, ry, rot = 0) {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, 0, TAU);
  return p;
}
function arcP(cx, cy, rx, ry, rot, a0, a1) {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, a0, a1);
  return p;
}
function fuzzy(cx, cy, r, n, amt) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = r * (i % 2 ? 1 - amt : 1);
    pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return smooth(pts);
}
const mirror = (pts) => pts.map((q) => [1 - q[0], q[1], q[2]]);

// ---------------------------------------------------------------------------
// the pen: paints one layer. In the glow layer bodies become black occluders (a no-op under
// 'lighter'), markings become bright with a soft halo.
// ---------------------------------------------------------------------------

class Pen {
  constructor(g, mode, P) {
    this.g = g;
    this.glow = mode >= 1;
    this.emit = mode === 2;
    this.P = P;
    this.rim = RIM_COOL;
    this.fx = 1; // -1 while painting mirrored, so the rim light stays top-left
  }
  lw(w) {
    return Math.max(w, 1.15 / this.P);
  }
  velvet(cx, cy, r, tone) {
    const g = this.g;
    const gr = g.createRadialGradient(cx - 0.35 * r * this.fx, cy - 0.45 * r, r * 0.05, cx, cy, r * 1.25);
    gr.addColorStop(0, tone[0]);
    gr.addColorStop(0.55, tone[1]);
    gr.addColorStop(1, tone[2]);
    return gr;
  }
  // a velvet body: rim crescent on the top-left, soft radial fill, thin dark outline
  body(path, cx, cy, r, tone, rim = 0.022) {
    const g = this.g;
    if (this.glow) {
      this.occlude(path, true);
      if (this.emit && r >= 0.07) {
        // a faint rim so the silhouette can be traced in the dark (the body itself stays dark)
        g.strokeStyle = EMIT_RIM;
        g.lineWidth = this.lw(0.016);
        g.stroke(path);
      }
      return;
    }
    g.fillStyle = this.rim;
    g.fill(path);
    g.save();
    g.clip(path);
    g.translate(rim * 0.7 * this.fx, rim);
    g.fillStyle = this.velvet(cx, cy, r, tone);
    g.fill(path);
    g.restore();
    g.strokeStyle = OUTLINE;
    g.lineWidth = this.lw(0.014);
    g.stroke(path);
  }
  // hide glow behind a body: black under 'lighter' in the glow layer, erased in the emissive layer
  occlude(path, fill, w) {
    const g = this.g;
    if (this.emit) g.globalCompositeOperation = 'destination-out';
    if (fill) {
      g.fillStyle = '#000';
      g.fill(path);
    } else {
      g.strokeStyle = '#000';
      g.lineWidth = this.lw(w);
      g.stroke(path);
    }
    if (this.emit) g.globalCompositeOperation = 'source-over';
  }
  // plain fill that also occludes glow
  solid(path, style) {
    if (this.glow) return this.occlude(path, true);
    this.g.fillStyle = style;
    this.g.fill(path);
  }
  // body-layer only paint (shading, shadows)
  paint(path, style) {
    if (this.glow) return;
    this.g.fillStyle = style;
    this.g.fill(path);
  }
  strokeBody(path, style, w) {
    if (this.glow) return this.occlude(path, false, w);
    const g = this.g;
    g.strokeStyle = style;
    g.lineWidth = this.lw(w);
    g.stroke(path);
  }
  // a glowing marking line; `dim` is how much of the colour shows in the body layer
  line(path, color, w, dim = 0.6, blur = 0.06) {
    const g = this.g;
    g.lineWidth = this.lw(w);
    if (this.glow) {
      g.save();
      g.shadowColor = color;
      g.shadowBlur = this.P * blur * (this.emit ? 1.4 : 1);
      g.strokeStyle = this.emit ? color : mix(color, '#FFFFFF', 0.3);
      g.stroke(path);
      g.restore();
    } else {
      g.strokeStyle = mix('#1A1026', color, dim);
      g.stroke(path);
    }
  }
  mark(path, color, dim = 0.6, blur = 0.06) {
    const g = this.g;
    if (this.glow) {
      g.save();
      g.shadowColor = color;
      g.shadowBlur = this.P * blur * (this.emit ? 1.4 : 1);
      g.fillStyle = this.emit ? color : mix(color, '#FFFFFF', 0.3);
      g.fill(path);
      g.restore();
    } else {
      g.fillStyle = mix('#1A1026', color, dim);
      g.fill(path);
    }
  }
  dot(x, y, r, color, dim, blur) {
    this.mark(ell(x, y, Math.max(r, 0.9 / this.P), Math.max(r, 0.9 / this.P)), color, dim, blur);
  }
}

// ---------------------------------------------------------------------------
// sprite cache: device-pixel tile size -> Map(key -> { body, glow, m, k })
// ---------------------------------------------------------------------------

let scaleCtx = null;
let scaleValue = 1;
let scaleTtl = 0;
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

const sizes = new Map();
let useTick = 0;
let lastP = -1;
let lastB = null;
function bucket(ctx, size) {
  let P = Math.round(size * ctxScale(ctx));
  P = P < 16 ? 16 : P > 400 ? 400 : P;
  if (P === lastP) return lastB;
  let b = sizes.get(P);
  if (!b) {
    b = { P, map: new Map(), used: 0 };
    sizes.set(P, b);
    if (sizes.size > 6) {
      let old = null;
      for (const c of sizes.values()) if (c !== b && (!old || c.used < old.used)) old = c;
      if (old) sizes.delete(old.P);
    }
  }
  b.used = ++useTick;
  lastP = P;
  lastB = b;
  return b;
}

function layer(P, paint, rim, mode) {
  const mp = Math.round(P * MARGIN);
  const c = makeCanvas(P + 2 * mp, P + 2 * mp);
  if (!c) return null;
  const g = c.getContext('2d');
  g.setTransform(P, 0, 0, P, mp, mp);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const pen = new Pen(g, mode, P);
  if (rim) pen.rim = rim;
  paint(pen);
  return c;
}

function build(P, paint, rim, bake) {
  const mp = Math.round(P * MARGIN);
  const body = layer(P, paint, rim, 0);
  if (!body) return null;
  const out = { body, glow: layer(P, paint, rim, 1), emit: undefined, m: mp / P, k: (P + 2 * mp) / P, P, paint, rim };
  if (bake > 0) {
    const g = out.body.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'lighter';
    g.globalAlpha = bake;
    g.drawImage(out.glow, 0, 0);
    out.glow.width = 1;
    out.glow.height = 1;
    out.glow = null;
  }
  return out;
}
function get(b, key, paint, rim, bake) {
  let s = b.map.get(key);
  if (s === undefined) {
    s = build(b.P, paint, rim, bake);
    b.map.set(key, s);
  }
  return s;
}
// the markings-plus-rim layer drawn after the darkness, made the first time it is asked for
function emissive(s) {
  if (s.emit === undefined) s.emit = crop(layer(s.P, s.paint, s.rim, 2));
  return s.emit;
}
function crop(c) {
  if (!c) return null;
  const W = c.width;
  const H = c.height;
  const a = c.getContext('2d').getImageData(0, 0, W, H).data;
  let x0 = W;
  let y0 = H;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (a[(y * W + x) * 4 + 3] > 3) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const out = makeCanvas(w, h);
  out.getContext('2d').drawImage(c, x0, y0, w, h, 0, 0, w, h);
  c.width = 1;
  c.height = 1;
  return { c: out, ox: x0, oy: y0, side: W };
}

// Draw a sprite, optionally squashed around an anchor (in tile units), then its glow.
function put(ctx, s, px, py, size, glowA, sx = 1, sy = 1, ax = 0.5, ay = 0.9, only = null) {
  const d = size * s.k;
  const o = size * s.m;
  const Ax = px + ax * size;
  const Ay = py + ay * size;
  const x = Ax + (px - o - Ax) * sx;
  const y = Ay + (py - o - Ay) * sy;
  if (only) {
    // a cropped emissive layer, plain blend
    const kx = (d * sx) / only.side;
    const ky = (d * sy) / only.side;
    const al = ctx.globalAlpha;
    ctx.globalAlpha = al * Math.min(1, glowA);
    ctx.drawImage(only.c, x + only.ox * kx, y + only.oy * ky, only.c.width * kx, only.c.height * ky);
    ctx.globalAlpha = al;
    return;
  }
  ctx.drawImage(s.body, x, y, d * sx, d * sy);
  if (s.glow && glowA > 0.01) {
    const al = ctx.globalAlpha;
    const op = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = al * Math.min(1, glowA);
    ctx.drawImage(s.glow, x, y, d * sx, d * sy);
    ctx.globalAlpha = al;
    ctx.globalCompositeOperation = op;
  }
}

// soft contact shadow and warm lantern halo (one small sprite each per size)
function radialSprite(b, key, stops) {
  let s = b.map.get(key);
  if (s === undefined) {
    const n = Math.max(16, Math.min(256, b.P));
    const c = makeCanvas(n, n);
    s = null;
    if (c) {
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
      for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]);
      g.fillStyle = gr;
      g.fillRect(0, 0, n, n);
      s = c;
    }
    b.map.set(key, s);
  }
  return s;
}
function shadow(ctx, b, cx, cy, w, h, a) {
  const s = radialSprite(b, 'shadow', [0, 'rgba(8,4,14,0.85)', 0.55, 'rgba(8,4,14,0.45)', 1, 'rgba(8,4,14,0)']);
  if (!s) return;
  const al = ctx.globalAlpha;
  ctx.globalAlpha = al * a;
  ctx.drawImage(s, cx - w / 2, cy - h / 2, w, h);
  ctx.globalAlpha = al;
}
function halo(ctx, b, cx, cy, d, a) {
  const s = radialSprite(b, 'halo', [0, 'rgba(255,226,160,0.95)', 0.22, 'rgba(250,190,96,0.5)', 0.55, 'rgba(242,150,60,0.14)', 1, 'rgba(242,140,60,0)']);
  if (!s) return;
  const al = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = al * a;
  ctx.drawImage(s, cx - d / 2, cy - d / 2, d, d);
  ctx.globalAlpha = al;
  ctx.globalCompositeOperation = op;
}

// ---------------------------------------------------------------------------
// the lantern (carried and planted share it)
// ---------------------------------------------------------------------------

function paintLantern(p, cx, top, w, h, on, f) {
  const g = p.g;
  const ring = new Path2D();
  ring.arc(cx, top + 0.2 * h, 0.22 * w, Math.PI * 1.08, Math.PI * 1.92);
  p.strokeBody(ring, '#1C1224', 0.07 * w);
  if (!p.glow) {
    g.strokeStyle = 'rgba(150,128,176,0.55)';
    g.lineWidth = p.lw(0.022 * w);
    g.stroke(ring);
  }
  const cap = roundPoly([[cx - 0.36 * w, top + 0.3 * h], [cx - 0.2 * w, top + 0.15 * h], [cx + 0.2 * w, top + 0.15 * h], [cx + 0.36 * w, top + 0.3 * h]], 0.05 * w);
  p.body(cap, cx, top + 0.2 * h, 0.3 * w, T_METAL, 0.012);
  const glass = rrect(cx - 0.5 * w, top + 0.28 * h, w, 0.56 * h, 0.32 * w);
  if (on) {
    const gr = g.createRadialGradient(cx, top + 0.6 * h, 0.02 * w, cx, top + 0.58 * h, 0.62 * w);
    gr.addColorStop(0, '#FFF8DA');
    gr.addColorStop(0.35, '#FFDB8E');
    gr.addColorStop(0.75, AMBER);
    gr.addColorStop(1, '#C27632');
    if (p.glow) {
      g.save();
      g.shadowColor = AMBER;
      g.shadowBlur = p.P * 0.12;
      g.fillStyle = gr;
      g.fill(glass);
      g.restore();
    } else {
      g.fillStyle = gr;
      g.fill(glass);
      g.strokeStyle = '#8A4E22';
      g.lineWidth = p.lw(0.03 * w);
      g.stroke(glass);
    }
    const wob = [0, 0.03, -0.02, 0.015][f] * w;
    const fl = smooth([
      [cx + wob * 1.6, top + 0.4 * h, 1],
      [cx + 0.1 * w, top + 0.58 * h],
      [cx + 0.07 * w, top + 0.7 * h],
      [cx, top + 0.73 * h],
      [cx - 0.07 * w, top + 0.7 * h],
      [cx - 0.1 * w, top + 0.58 * h],
    ]);
    g.fillStyle = '#FFFDF0';
    g.fill(fl);
  } else {
    p.body(glass, cx, top + 0.56 * h, 0.5 * w, T_DEADGLASS, 0.015);
    // a cold glint and an out wick: the lamp is there, just dark
    p.line(smooth([[cx - 0.32 * w, top + 0.42 * h], [cx - 0.36 * w, top + 0.56 * h], [cx - 0.32 * w, top + 0.7 * h]], false), '#8F86B8', 0.035 * w, 0.55, 0.02);
    p.paint(ell(cx, top + 0.66 * h, 0.05 * w, 0.07 * w), '#0B0710');
  }
  // the two frame bars
  const bars = new Path2D();
  bars.moveTo(cx - 0.2 * w, top + 0.3 * h);
  bars.lineTo(cx - 0.22 * w, top + 0.82 * h);
  bars.moveTo(cx + 0.2 * w, top + 0.3 * h);
  bars.lineTo(cx + 0.22 * w, top + 0.82 * h);
  p.strokeBody(bars, '#2A1C30', 0.045 * w);
  const base = rrect(cx - 0.42 * w, top + 0.82 * h, 0.84 * w, 0.13 * h, 0.05 * w);
  p.body(base, cx, top + 0.86 * h, 0.4 * w, T_METAL, 0.01);
}


// soft contact shadow baked into a sprite's body layer
function groundShadow(p, cx, cy, rx, ry, a) {
  if (p.glow) return;
  const g = p.g;
  g.save();
  g.translate(cx, cy);
  g.scale(rx, ry);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 1);
  gr.addColorStop(0, `rgba(8,4,14,${0.85 * a})`);
  gr.addColorStop(0.55, `rgba(8,4,14,${0.45 * a})`);
  gr.addColorStop(1, 'rgba(8,4,14,0)');
  g.fillStyle = gr;
  g.beginPath();
  g.arc(0, 0, 1, 0, TAU);
  g.fill();
  g.restore();
}

function softVoid(p, clip, cx, cy, rx, ry) {
  if (p.glow) return;
  const g = p.g;
  g.save();
  g.clip(clip);
  const gr = g.createRadialGradient(cx, cy + ry * 0.2, 0.005, cx, cy, Math.max(rx, ry) * 1.05);
  gr.addColorStop(0, 'rgba(6,3,11,1)');
  gr.addColorStop(0.55, 'rgba(10,5,17,0.9)');
  gr.addColorStop(1, 'rgba(18,11,30,0)');
  g.fillStyle = gr;
  g.fill(ell(cx, cy, rx, ry));
  g.restore();
}

// ---------------------------------------------------------------------------
// Wren: small hooded cloak, oversized lantern, no face (the hood opening is a soft shadow)
// ---------------------------------------------------------------------------

const HEM_S = [[0.19, 0.865, 1], [0.28, 0.9], [0.385, 0.875, 1], [0.5, 0.905], [0.615, 0.875, 1], [0.72, 0.9], [0.81, 0.865, 1]];
const HEM_TRIM_S = [[0.22, 0.845], [0.28, 0.876], [0.385, 0.853], [0.5, 0.881], [0.615, 0.853], [0.72, 0.876], [0.78, 0.845]];

function mitten(p, x, y, a, trim) {
  const m = ell(x, y, 0.044, 0.038, a);
  p.body(m, x, y, 0.045, T_CLOAK, 0.01);
  if (!p.emit) p.line(arcP(x, y, 0.044, 0.038, a, -2.2, -0.9), TRIM, 0.016, 0.5 * trim + 0.2);
}

function paintWrenFront(p, carrying, on, f, back) {
  const tr = carrying ? (on ? 0.85 : 0.35) : 0.6;
  groundShadow(p, 0.5, 0.885, 0.32, 0.075, 0.6);
  if (back && carrying) {
    // held out in front: the lantern peeks out beside the body, higher up
    paintLantern(p, 0.795, 0.31, 0.21, 0.31, on, f);
    const arm = smooth([[0.6, 0.5], [0.71, 0.46], [0.79, 0.37], [0.82, 0.42], [0.72, 0.57], [0.62, 0.58]]);
    p.body(arm, 0.7, 0.5, 0.1, T_CLOAK, 0.012);
  }
  const cloak = smooth([[0.36, 0.46], [0.29, 0.6], [0.23, 0.76], ...HEM_S, [0.77, 0.76], [0.71, 0.6], [0.64, 0.46], [0.5, 0.43]]);
  p.body(cloak, 0.5, 0.64, 0.32, T_CLOAK);
  p.line(smooth(HEM_TRIM_S, false), TRIM, 0.022, tr);
  if (!back) p.line(smooth([[0.5, 0.55], [0.49, 0.66], [0.475, 0.77], [0.465, 0.875]], false), TRIM, 0.02, tr);
  let hood;
  if (back) {
    hood = smooth([[0.27, 0.42], [0.28, 0.28], [0.36, 0.18], [0.5, 0.14], [0.64, 0.18], [0.72, 0.28], [0.73, 0.42], [0.62, 0.52], [0.5, 0.54], [0.38, 0.52]]);
  } else {
    hood = smooth([[0.27, 0.42], [0.28, 0.28], [0.36, 0.18], [0.48, 0.14], [0.58, 0.13], [0.665, 0.09], [0.735, 0.045, 1], [0.725, 0.14], [0.735, 0.25], [0.74, 0.37], [0.71, 0.47], [0.6, 0.53], [0.5, 0.54], [0.4, 0.53], [0.3, 0.48]]);
  }
  p.body(hood, 0.5, 0.32, 0.24, T_CLOAK, 0.026);
  if (back) {
    // the hood's soft point flops down over one shoulder, a glowing seam running into it
    const tail = smooth([[0.47, 0.29], [0.575, 0.33], [0.54, 0.46], [0.45, 0.55], [0.3, 0.62, 1], [0.37, 0.52], [0.43, 0.41]]);
    p.body(tail, 0.46, 0.43, 0.14, T_CLOAK, 0.016);
    p.line(smooth([[0.5, 0.16], [0.51, 0.25], [0.515, 0.33], [0.49, 0.43], [0.43, 0.51], [0.33, 0.595]], false), TRIM, 0.018, tr);
  } else {
    softVoid(p, hood, 0.5, 0.5, 0.135, 0.065);
    p.line(smooth([[0.6, 0.15], [0.68, 0.1], [0.73, 0.055]], false), TRIM, 0.016, tr * 0.8);
  }
  if (!carrying) {
    // empty hands, held a little out
    const L = [[0.37, 0.53], [0.3, 0.58], [0.24, 0.65], [0.28, 0.7], [0.38, 0.63]];
    p.body(smooth(L), 0.32, 0.6, 0.08, T_CLOAK, 0.01);
    p.body(smooth(mirror(L)), 0.68, 0.6, 0.08, T_CLOAK, 0.01);
    mitten(p, 0.245, 0.685, 0.5, tr);
    mitten(p, 0.755, 0.685, -0.5, tr);
  } else if (!back) {
    const arm = smooth([[0.6, 0.51], [0.71, 0.53], [0.79, 0.6], [0.75, 0.66], [0.64, 0.61]]);
    p.body(arm, 0.7, 0.58, 0.1, T_CLOAK, 0.012);
    paintLantern(p, 0.785, 0.6, 0.25, 0.36, on, f);
    mitten(p, 0.775, 0.625, 0.3, tr);
  }
}

function paintWrenSide(p, carrying, on, f) {
  // facing east; west is painted mirrored
  const tr = carrying ? (on ? 0.85 : 0.35) : 0.6;
  groundShadow(p, 0.47, 0.885, 0.33, 0.075, 0.6);
  const cloak = smooth([[0.42, 0.47], [0.34, 0.6], [0.25, 0.74], [0.13, 0.875, 1], [0.23, 0.87], [0.31, 0.887, 1], [0.44, 0.9], [0.58, 0.895, 1], [0.74, 0.875, 1], [0.72, 0.74], [0.68, 0.6], [0.62, 0.47], [0.52, 0.44]]);
  p.body(cloak, 0.48, 0.64, 0.32, T_CLOAK);
  p.line(smooth([[0.17, 0.856], [0.24, 0.852], [0.31, 0.866], [0.44, 0.877], [0.58, 0.872], [0.71, 0.857]], false), TRIM, 0.022, tr);
  p.line(smooth([[0.64, 0.53], [0.67, 0.64], [0.695, 0.75], [0.715, 0.862]], false), TRIM, 0.02, tr);
  // hood: round, pushed forward, its soft point trailing down behind
  const hood = smooth([[0.36, 0.47], [0.3, 0.45], [0.245, 0.5], [0.205, 0.6, 1], [0.185, 0.46], [0.21, 0.33], [0.29, 0.21], [0.41, 0.14], [0.54, 0.13], [0.66, 0.17], [0.75, 0.27], [0.785, 0.39], [0.735, 0.5], [0.6, 0.55], [0.46, 0.54]]);
  p.body(hood, 0.55, 0.31, 0.24, T_CLOAK, 0.026);
  p.line(smooth([[0.31, 0.23], [0.23, 0.34], [0.205, 0.46], [0.205, 0.57]], false), TRIM, 0.016, tr * 0.8);
  softVoid(p, hood, 0.775, 0.435, 0.09, 0.115);
  if (carrying) {
    const arm = smooth([[0.54, 0.5], [0.68, 0.52], [0.81, 0.56], [0.79, 0.63], [0.63, 0.62]]);
    p.body(arm, 0.67, 0.55, 0.12, T_CLOAK, 0.012);
    paintLantern(p, 0.845, 0.58, 0.25, 0.36, on, f);
    mitten(p, 0.825, 0.6, 0.2, tr);
  } else {
    const arm = smooth([[0.54, 0.52], [0.66, 0.57], [0.75, 0.64], [0.71, 0.69], [0.6, 0.64]]);
    p.body(arm, 0.65, 0.59, 0.1, T_CLOAK, 0.01);
    mitten(p, 0.755, 0.675, -0.4, tr);
  }
}

function paintWren(p, d, carrying, out, f) {
  const on = carrying && !out;
  if (d === 1 || d === 3) {
    if (d === 3) {
      p.g.translate(1, 0);
      p.g.scale(-1, 1);
      p.fx = -1;
    }
    paintWrenSide(p, carrying, on, f);
  } else {
    paintWrenFront(p, carrying, on, f, d === 0);
  }
}

const DIRS = { N: 0, E: 1, S: 2, W: 3 };
const LANTERN_AT = [[0.795, 0.5], [0.845, 0.77], [0.785, 0.79], [0.155, 0.77]];

function wrenSpec(b, o) {
  const t = o.t || 0;
  const d = DIRS[o.dir] === undefined ? 2 : DIRS[o.dir];
  const carrying = o.carrying ? 1 : 0;
  const out = carrying && o.smothered ? 1 : 0;
  const on = carrying && !out;
  const s = get(b, 'W' + d + carrying + out, (p) => paintWren(p, d, carrying, out, 0), null, on ? 0.92 : out ? 0.25 : 0.62);
  const br = Math.sin(t * (out ? 1.4 : 2.3));
  return { s, d, on, sx: 1 - 0.012 * br, sy: (out ? 0.95 : 1) * (1 + 0.022 * br) };
}

export function drawWren(ctx, px, py, size, opts) {
  const o = opts || {};
  const b = bucket(ctx, size);
  const w = wrenSpec(b, o);
  if (!w.s) return;
  put(ctx, w.s, px, py, size, 0, w.sx, w.sy, 0.5, 0.89);
  if (w.on) {
    const q = LANTERN_AT[w.d];
    halo(ctx, b, px + q[0] * size, py + (0.89 - (0.89 - q[1]) * w.sy) * size, size * 0.95, 0.32 + 0.16 * flicker(o.t || 0));
  }
}

// the planted lantern
export function drawLantern(ctx, px, py, size, opts) {
  const o = opts || {};
  const t = o.t || 0;
  const b = bucket(ctx, size);
  const f = Math.floor(t * 8) & 3;
  const s = get(b, 'L' + f, (p) => {
    groundShadow(p, 0.5, 0.9, 0.26, 0.065, 0.7);
    // a little iron foot pushed into the floor
    const foot = roundPoly([[0.4, 0.86], [0.6, 0.86], [0.66, 0.92], [0.34, 0.92]], 0.02);
    p.body(foot, 0.5, 0.88, 0.15, T_METAL, 0.01);
    paintLantern(p, 0.5, 0.3, 0.36, 0.6, true, f);
  });
  if (!s) return;
  put(ctx, s, px, py, size, 0.85 + 0.15 * flicker(t));
  halo(ctx, b, px + 0.5 * size, py + 0.64 * size, size * 1.35, 0.32 + 0.14 * flicker(t));
}

// ---------------------------------------------------------------------------
// Fluffmoth
// ---------------------------------------------------------------------------

function featherAntenna(p, x0, y0, x1, y1, bend, color, dim) {
  const mx = (x0 + x1) / 2 + bend;
  const my = (y0 + y1) / 2;
  const shaft = new Path2D();
  shaft.moveTo(x0, y0);
  shaft.quadraticCurveTo(mx, my, x1, y1);
  const barbs = new Path2D();
  const dx = x1 - x0;
  const dy = y1 - y0;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  for (let i = 1; i <= 4; i++) {
    const u = i / 5;
    const x = (1 - u) * (1 - u) * x0 + 2 * u * (1 - u) * mx + u * u * x1;
    const y = (1 - u) * (1 - u) * y0 + 2 * u * (1 - u) * my + u * u * y1;
    const k = 0.028 * (1 - u * 0.5);
    barbs.moveTo(x + nx * k - (dx / L) * 0.012, y + ny * k - (dy / L) * 0.012);
    barbs.lineTo(x, y);
    barbs.lineTo(x - nx * k - (dx / L) * 0.012, y - ny * k - (dy / L) * 0.012);
  }
  p.strokeBody(shaft, '#2A1E3C', 0.022);
  p.line(shaft, color, 0.012, dim, 0.03);
  p.line(barbs, color, 0.01, dim * 0.8, 0.02);
}

function mothBody(p, cy, lit) {
  const dm = lit ? 0.75 : 0.45;
  const abd = ell(0.5, cy + 0.17, 0.058, 0.125);
  p.body(abd, 0.5, cy + 0.15, 0.1, T_MOTH, 0.014);
  const bands = new Path2D();
  for (let i = 0; i < 3; i++) {
    const y = cy + 0.13 + i * 0.05;
    const w = 0.045 - i * 0.008;
    bands.moveTo(0.5 - w, y - 0.006);
    bands.quadraticCurveTo(0.5, y + 0.014, 0.5 + w, y - 0.006);
  }
  p.line(bands, TEAL, 0.017, dm);
  p.body(fuzzy(0.5, cy, 0.09, 18, 0.12), 0.5, cy, 0.09, T_MOTH, 0.018);
  p.line(arcP(0.5, cy, 0.062, 0.052, 0, Math.PI * 1.15, Math.PI * 1.85), CREAM, 0.014, dm * 0.8, 0.04);
  p.body(fuzzy(0.5, cy - 0.097, 0.052, 12, 0.14), 0.5, cy - 0.097, 0.05, T_MOTH, 0.012);
}

function paintMoth(p, lit, f) {
  if (lit) {
    const ph = (f / 12) * TAU;
    const s = 0.76 + 0.24 * Math.cos(ph);
    const lift = -0.04 * Math.sin(ph);
    const X = (x) => 0.5 + (x - 0.5) * s;
    for (const side of [1, -1]) {
      const sx = (x) => (side > 0 ? x : 1 - x);
      const W = (pts) => pts.map((q) => [sx(X(q[0])), q[1] + (q[3] || 0) * lift, q[2]]);
      const hind = smooth(W([[0.53, 0.48], [0.67, 0.5], [0.8, 0.56, 0, 0.5], [0.8, 0.67, 0, 0.5], [0.7, 0.75], [0.6, 0.72], [0.53, 0.61]]));
      p.body(hind, sx(X(0.64)), 0.6, 0.16, T_WING, 0.016);
      p.line(smooth(W([[0.57, 0.53], [0.66, 0.58], [0.74, 0.63, 0, 0.5]]), false), TEAL, 0.016, 0.7);
      p.line(smooth(W([[0.77, 0.58, 0, 0.5], [0.765, 0.665, 0, 0.5], [0.69, 0.715], [0.62, 0.69]]), false), CREAM, 0.018, 0.75);
      const fore = smooth(W([[0.53, 0.36], [0.62, 0.28, 0, 0.5], [0.76, 0.21, 0, 1], [0.92, 0.18, 1, 1], [0.91, 0.3, 0, 1], [0.85, 0.42, 0, 0.7], [0.72, 0.49], [0.55, 0.48]]));
      p.body(fore, sx(X(0.7)), 0.34, 0.22, T_WING);
      const veins = new Path2D();
      const V = (pts) => {
        const q = W(pts);
        veins.moveTo(q[0][0], q[0][1]);
        veins.quadraticCurveTo(q[1][0], q[1][1], q[2][0], q[2][1]);
      };
      V([[0.56, 0.42], [0.7, 0.32, 0, 0.6], [0.83, 0.24, 0, 1]]);
      V([[0.56, 0.43], [0.72, 0.37, 0, 0.7], [0.85, 0.34, 0, 1]]);
      V([[0.56, 0.45], [0.68, 0.45, 0, 0.5], [0.77, 0.43, 0, 0.7]]);
      p.line(veins, TEAL, 0.016, 0.7);
      p.line(smooth(W([[0.78, 0.235, 0, 1], [0.885, 0.215, 0, 1], [0.88, 0.3, 0, 1], [0.83, 0.39, 0, 0.7], [0.73, 0.455]]), false), CREAM, 0.02, 0.8);
    }
    mothBody(p, 0.4, true);
    featherAntenna(p, 0.485, 0.29, 0.37, 0.15, -0.03, CREAM, 0.7);
    featherAntenna(p, 0.515, 0.29, 0.63, 0.15, 0.03, CREAM, 0.7);
  } else {
    // resting on the floor, wings folded down over the back into a soft tent
    groundShadow(p, 0.5, 0.83, 0.25, 0.065, 0.75);
    const R = [[0.5, 0.35], [0.6, 0.36], [0.68, 0.48], [0.725, 0.65], [0.7, 0.8], [0.58, 0.85], [0.47, 0.79]];
    const veinR = [[0.53, 0.43], [0.6, 0.6], [0.62, 0.77]];
    const edgeR = [[0.64, 0.47], [0.69, 0.64], [0.67, 0.78], [0.58, 0.825]];
    p.body(smooth(mirror(R)), 0.42, 0.6, 0.22, T_WING);
    p.line(smooth(mirror(veinR), false), TEAL, 0.015, 0.42);
    p.line(smooth(mirror(edgeR), false), CREAM, 0.017, 0.42);
    p.body(smooth(R), 0.58, 0.6, 0.22, T_WING);
    p.line(smooth(veinR, false), TEAL, 0.015, 0.42);
    p.line(smooth(edgeR, false), CREAM, 0.017, 0.42);
    // the big fluffy ruff is what makes it a Fluffmoth even folded up
    p.body(fuzzy(0.5, 0.37, 0.105, 20, 0.13), 0.5, 0.37, 0.1, T_MOTH, 0.02);
    p.line(arcP(0.5, 0.37, 0.07, 0.06, 0, Math.PI * 1.15, Math.PI * 1.85), CREAM, 0.014, 0.4, 0.04);
    p.body(fuzzy(0.5, 0.265, 0.052, 12, 0.14), 0.5, 0.265, 0.05, T_MOTH, 0.012);
    featherAntenna(p, 0.48, 0.25, 0.3, 0.42, -0.05, CREAM, 0.42);
    featherAntenna(p, 0.52, 0.25, 0.7, 0.42, 0.05, CREAM, 0.42);
  }
}

// a Fluffmoth settled flat on a puddle: a broad soft mat you can step on
function paintBridge(p) {
  const g = p.g;
  if (!p.glow) {
    g.strokeStyle = 'rgba(200,220,235,0.22)';
    g.lineWidth = p.lw(0.012);
    for (const [x, y, r] of [[0.06, 0.2, 0.07], [0.94, 0.2, 0.07], [0.12, 0.84, 0.06], [0.88, 0.84, 0.06]]) {
      g.beginPath();
      g.ellipse(x, y, r, r * 0.5, 0, 0, TAU);
      g.stroke();
    }
    g.fillStyle = 'rgba(8,4,14,0.35)';
    g.fill(ell(0.5, 0.53, 0.46, 0.36));
  }
  for (const side of [1, -1]) {
    const S = (pts) => (side > 0 ? pts : mirror(pts));
    const hind = smooth(S([[0.53, 0.5], [0.72, 0.53], [0.9, 0.62], [0.91, 0.76], [0.79, 0.87], [0.62, 0.83], [0.53, 0.68]]));
    p.body(hind, side > 0 ? 0.72 : 0.28, 0.66, 0.22, T_BRIDGE, 0.016);
    const fore = smooth(S([[0.53, 0.35], [0.66, 0.24], [0.84, 0.15], [0.97, 0.16, 1], [0.97, 0.33], [0.89, 0.46], [0.7, 0.52], [0.54, 0.5]]));
    p.body(fore, side > 0 ? 0.74 : 0.26, 0.32, 0.26, T_BRIDGE);
    // ribs across the wings, like the slats of a little footbridge
    const ribs = new Path2D();
    const r = S([[0.6, 0.31], [0.66, 0.46], [0.7, 0.25], [0.78, 0.45], [0.8, 0.2], [0.9, 0.4], [0.62, 0.56], [0.6, 0.76], [0.72, 0.58], [0.72, 0.8], [0.83, 0.64], [0.82, 0.8]]);
    for (let i = 0; i < r.length; i += 2) {
      ribs.moveTo(r[i][0], r[i][1]);
      ribs.lineTo(r[i + 1][0], r[i + 1][1]);
    }
    p.line(ribs, CREAM, 0.014, 0.4, 0.025);
    p.line(smooth(S([[0.82, 0.18], [0.94, 0.19], [0.94, 0.32], [0.87, 0.43], [0.72, 0.49]]), false), TEAL, 0.02, 0.7);
    p.line(smooth(S([[0.88, 0.64], [0.885, 0.75], [0.78, 0.84], [0.65, 0.81]]), false), TEAL, 0.02, 0.7);
  }
  const abd = ell(0.5, 0.6, 0.06, 0.15);
  p.body(abd, 0.5, 0.58, 0.1, T_MOTH, 0.014);
  const bands = new Path2D();
  for (let i = 0; i < 4; i++) {
    const y = 0.54 + i * 0.05;
    bands.moveTo(0.46, y);
    bands.quadraticCurveTo(0.5, y + 0.014, 0.54, y);
  }
  p.line(bands, TEAL, 0.016, 0.6);
  p.body(fuzzy(0.5, 0.42, 0.08, 18, 0.12), 0.5, 0.42, 0.08, T_MOTH, 0.016);
  p.body(fuzzy(0.5, 0.33, 0.045, 12, 0.14), 0.5, 0.33, 0.045, T_MOTH, 0.01);
  featherAntenna(p, 0.485, 0.31, 0.4, 0.16, -0.02, CREAM, 0.55);
  featherAntenna(p, 0.515, 0.31, 0.6, 0.16, 0.02, CREAM, 0.55);
}

export function drawBridgeMoth(ctx, px, py, size, opts) {
  const o = opts || {};
  const t = o.t || 0;
  const b = bucket(ctx, size);
  const s = get(b, 'B', paintBridge, RIM_COOL, 0.55);
  if (!s) return;
  put(ctx, s, px, py, size, 0);
}

// ---------------------------------------------------------------------------
// Shellwhelk: a tall whorled cone; out = a soft foot sliding out (no stalks), hidden = sealed, low
// ---------------------------------------------------------------------------

// A snail-like spiral shell seen from the side, its coil centre high at the back.
const SHELL = [[0.63, 0.77], [0.69, 0.62], [0.66, 0.44], [0.56, 0.31], [0.42, 0.26], [0.29, 0.27], [0.2, 0.34], [0.16, 0.46], [0.17, 0.6], [0.24, 0.72], [0.36, 0.79], [0.5, 0.81]];

function paintShell(p, dm) {
  const g = p.g;
  const sh = smooth(SHELL);
  p.body(sh, 0.44, 0.52, 0.3, T_SHELL);
  const ox = 0.37;
  const oy = 0.45;
  const turns = 2.2;
  const end = turns * TAU;
  const k = Math.log(13) / end;
  const ph = 0.55 - end;
  const at = (th, m) => {
    const r = 0.018 * Math.exp(k * th) * m;
    return [ox + r * Math.cos(th + ph), oy + r * Math.sin(th + ph) * 0.92];
  };
  g.save();
  g.clip(sh);
  const sp = new Path2D();
  for (let i = 0; i <= 90; i++) {
    const q = at((i / 90) * end, 1);
    if (i) sp.lineTo(q[0], q[1]);
    else sp.moveTo(q[0], q[1]);
  }
  p.line(sp, AMBER, 0.02, dm);
  // a thinner teal band winding between the amber coils, as on a banded shell
  const mid = (1 + Math.exp(k * TAU)) / 2;
  const band = new Path2D();
  for (let i = 0; i <= 60; i++) {
    const q = at(TAU * 0.6 + (i / 60) * (end - TAU * 1.05), mid);
    if (i) band.lineTo(q[0], q[1]);
    else band.moveTo(q[0], q[1]);
  }
  p.line(band, TEAL, 0.013, dm * 0.9, 0.035);
  g.restore();
  // the pale lip of the opening
  p.line(smooth([[0.48, 0.8], [0.6, 0.775], [0.675, 0.68]], false), CREAM, 0.014, dm * 0.6, 0.03);
}

function paintWhelk(p, hidden, f, lit) {
  const dm = lit ? 0.78 : 0.45;
  const g = p.g;
  if (!hidden) {
    const ph = (f / 6) * TAU;
    const st = 0.03 * Math.sin(ph);
    groundShadow(p, 0.55, 0.86, 0.4, 0.06, 0.55);
    const foot = smooth([[0.2, 0.86, 1], [0.4, 0.875], [0.62, 0.873], [0.8 + st, 0.862], [0.9 + st, 0.835], [0.94 + st, 0.775], [0.9 + st, 0.725], [0.8 + st, 0.715], [0.64, 0.735], [0.46, 0.755], [0.3, 0.8]]);
    p.body(foot, 0.6, 0.78, 0.3, T_FOOT, 0.018);
    p.line(smooth([[0.28, 0.852], [0.5, 0.86], [0.72, 0.855], [0.87 + st, 0.828], [0.925 + st, 0.78]], false), TEAL, 0.018, dm);
    // pedal waves rippling back along the foot
    const waves = new Path2D();
    for (let i = 0; i < 3; i++) {
      const u = (i + f / 6) / 3;
      const x = 0.88 + st - u * 0.3;
      if (Math.sin(Math.PI * u) < 0.25) continue;
      waves.moveTo(x - 0.012, 0.845);
      waves.quadraticCurveTo(x + 0.02, 0.8, x - 0.006, 0.75);
    }
    p.line(waves, CREAM, 0.016, dm * 0.8, 0.04);
    g.save();
    g.translate(0.44 + st * 0.4, 0.78);
    g.rotate(0.06 + st * 0.8);
    g.translate(-0.44, -0.81);
    paintShell(p, dm);
    g.restore();
  } else {
    // pulled down onto the floor: squat, flat-bottomed, the lid shut tight
    groundShadow(p, 0.5, 0.86, 0.44, 0.085, 0.95);
    if (!p.glow) {
      g.strokeStyle = 'rgba(10,5,16,0.55)';
      g.lineWidth = p.lw(0.014);
      g.beginPath();
      for (const [x0, y0, x1, y1] of [[0.13, 0.85, 0.05, 0.88], [0.17, 0.875, 0.12, 0.925], [0.86, 0.85, 0.95, 0.875], [0.82, 0.875, 0.88, 0.925]]) {
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
      }
      g.stroke();
    }
    g.save();
    const clip = new Path2D();
    clip.rect(-0.25, -0.25, 1.5, 1.095);
    g.clip(clip);
    g.translate(0.5, 0.85);
    g.scale(1.14, 0.84);
    g.translate(-0.43, -0.8);
    paintShell(p, dm);
    g.restore();
    const lid = rrect(0.15, 0.815, 0.7, 0.05, 0.025);
    p.body(lid, 0.5, 0.83, 0.3, ['#6A5670', '#463850', '#251C2E'], 0.01);
    const seam = new Path2D();
    seam.moveTo(0.19, 0.818);
    seam.lineTo(0.81, 0.818);
    p.line(seam, AMBER, 0.016, dm, 0.05);
  }
}

// ---------------------------------------------------------------------------
// Stumpcap: a blocky mushroom golem. Facing = cap offset, double chevron, feet, gill side.
// ---------------------------------------------------------------------------

const DV = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function chevron(cx, cy, dx, dy, a, b) {
  // tip at c + dir*a, arms back to c - dir*a*0.6 +- lateral*b (vertical squashed for the 3/4 view)
  const fy = 0.78;
  const lx = -dy;
  const ly = dx;
  const p = new Path2D();
  p.moveTo(cx - dx * a * 0.6 + lx * b, cy + (-dy * a * 0.6 + ly * b) * fy);
  p.lineTo(cx + dx * a, cy + dy * a * fy);
  p.lineTo(cx - dx * a * 0.6 - lx * b, cy + (-dy * a * 0.6 - ly * b) * fy);
  return p;
}

function footPath(cx, cy, dx, dy) {
  const lx = -dy;
  const ly = dx;
  const fy = 0.72;
  const P = (u, v) => [cx + dx * u + lx * v, cy + (dy * u + ly * v) * fy];
  return smooth([
    [...P(-0.075, -0.06), 1],
    P(0.04, -0.065),
    P(0.095, -0.035),
    P(0.105, 0),
    P(0.095, 0.035),
    P(0.04, 0.065),
    [...P(-0.075, 0.06), 1],
  ]);
}

function capPts(cx, top, w, h, band, inset) {
  const i = inset;
  return [
    [cx - w / 2 + i, top + h + band - i],
    [cx - w / 2 + i * 0.5, top + h * 0.5],
    [cx - w * 0.28, top + i * 0.8],
    [cx + w * 0.28, top + i * 0.8],
    [cx + w / 2 - i * 0.5, top + h * 0.5],
    [cx + w / 2 - i, top + h + band - i],
  ];
}

function paintStump(p, d, awake, f, lit) {
  const [dx, dy] = DV[d];
  const dm = lit ? 0.8 : 0.45;
  const g = p.g;
  let cx;
  let top;
  let w;
  let band;
  if (awake) {
    groundShadow(p, 0.5, 0.86, 0.36, 0.08, 0.65);
    const stride = [1, 0, -1, 0][f];
    const lx = -dy;
    const ly = dx;
    const base = dy > 0 ? 0.835 : 0.815;
    const feet = [];
    for (const k of [-1, 1]) {
      feet.push([0.5 + lx * k * 0.12 + dx * k * stride * 0.06, base + ly * k * 0.055 + dy * k * stride * 0.04]);
    }
    feet.sort((a, b) => a[1] - b[1]);
    for (const [fx, fy] of feet) p.body(footPath(fx, fy, dx, dy), fx, fy, 0.09, T_STEM, 0.014);
    // stem, leaning a touch toward the walk, with one long glowing grain line
    const lean = dx * 0.035;
    const stem = roundPoly([[0.34 + lean, 0.5], [0.66 + lean, 0.5], [0.68, 0.81], [0.32, 0.81]], 0.06);
    p.body(stem, 0.5, 0.66, 0.2, T_STEM);
    const grain = smooth([[0.385 + lean, 0.56], [0.375 + lean * 0.7, 0.63], [0.39 + lean * 0.4, 0.7], [0.375, 0.78]], false);
    p.line(grain, TEAL, 0.014, dm * 0.85, 0.035);
    p.dot(0.405 + lean * 0.6, 0.665, 0.011, TEAL, dm, 0.03);
    p.dot(0.36 + lean * 0.4, 0.735, 0.008, TEAL, dm, 0.03);
    cx = 0.5 + dx * 0.075 + lean;
    top = 0.2 + dy * 0.045;
    w = 0.68;
    band = 0.1;
  } else {
    groundShadow(p, 0.5, 0.865, 0.42, 0.085, 0.8);
    // legs tucked away: only a stub of stem shows under the cap
    const stub = roundPoly([[0.35, 0.72], [0.65, 0.72], [0.67, 0.865], [0.33, 0.865]], 0.05);
    p.body(stub, 0.5, 0.8, 0.15, T_STEM, 0.01);
    cx = 0.5 + dx * 0.045;
    top = 0.4 + dy * 0.025;
    w = 0.74;
    band = 0.1;
    // a sleepy slump to one side
    g.translate(cx, top + 0.4);
    g.rotate(-0.06 * p.fx);
    g.translate(-cx, -(top + 0.4));
  }
  const h = 0.3;
  const r = awake ? 0.13 : 0.15;
  const outer = roundPoly(capPts(cx, top, w, h, band, 0), r);
  p.body(outer, cx, top + h * 0.6, w * 0.55, T_CAP, 0.016);
  if (!p.glow) {
    // the domed top, lighter than the brim band below it
    g.fillStyle = p.velvet(cx, top + h * 0.4, w * 0.5, ['#9A5C8C', '#5C2D55', '#331632']);
    g.fill(roundPoly(capPts(cx, top, w, h - 0.01, 0, 0.018), r * 0.9));
  }
  const brim = new Path2D();
  brim.moveTo(cx - w / 2 + 0.04, top + h - 0.01);
  brim.lineTo(cx + w / 2 - 0.04, top + h - 0.01);
  p.line(brim, CREAM, 0.012, dm * 0.5, 0.03);
  // gills fan under the front end of the cap when it faces sideways
  if (dx !== 0) {
    const gills = new Path2D();
    for (let i = 0; i < 4; i++) {
      const x = cx + dx * (w / 2 - 0.05 - i * 0.04);
      gills.moveTo(x, top + h + 0.016);
      gills.lineTo(x + dx * 0.014, top + h + band - 0.02);
    }
    p.line(gills, TEAL, 0.012, dm * 0.8, 0.03);
  }
  // the double chevron: where it will walk
  const ccy = top + h * 0.52;
  p.line(chevron(cx + dx * 0.06, ccy + dy * 0.05, dx, dy, 0.085, 0.13), AMBER, 0.042, Math.min(1, dm + 0.12), 0.07);
  p.line(chevron(cx - dx * 0.08, ccy - dy * 0.065, dx, dy, 0.06, 0.09), AMBER, 0.03, dm * 0.75, 0.05);
}

function paintZ(p) {
  const z = new Path2D();
  z.moveTo(0.3, 0.32);
  z.lineTo(0.7, 0.32);
  z.lineTo(0.3, 0.7);
  z.lineTo(0.7, 0.7);
  p.line(z, CREAM, 0.1, 0.85, 0.12);
}

// Which sprite a creature uses this frame and where it sits (shared by drawCreature and drawGlow).
function creatureSpec(b, type, o) {
  const t = o.t || 0;
  const lit = o.lit ? 1 : 0;
  const sp = { s: null, dy: 0, sx: 1, sy: 1, ax: 0.5, ay: 0.9, glowA: 0, hover: false, zed: false, emitA: 0.6 };
  if (type === 'M') {
    const f = lit ? Math.floor(t * 26) % 12 : 0;
    sp.s = get(b, 'M' + lit + '.' + f, (p) => paintMoth(p, lit, f), lit ? RIM_WARM : RIM_COOL, lit ? 0 : 0.34);
    if (lit) {
      const bob = Math.sin(t * 4.2);
      sp.hover = bob;
      sp.dy = -(0.07 + 0.03 * bob);
      sp.glowA = 0.85 + 0.15 * Math.sin(t * 5.3);
    } else {
      const br = Math.sin(t * 1.5);
      sp.sx = 1 + 0.015 * br;
      sp.sy = 1 - 0.02 * br;
      sp.ay = 0.83;
      sp.emitA = 0.5 + 0.08 * br;
    }
  } else if (type === 'S') {
    const hidden = (o.hidden === undefined ? o.lit : o.hidden) ? 1 : 0;
    const gl = o.lit === undefined ? hidden : lit;
    const f = hidden ? 0 : Math.floor(t * 4) % 6;
    sp.s = get(b, 'S' + hidden + gl + '.' + f, (p) => paintWhelk(p, hidden, f, gl), gl ? RIM_WARM : RIM_COOL, gl ? 0 : 0.34);
    sp.glowA = !gl ? 0 : hidden ? 0.8 + 0.06 * Math.sin(t * 1.2) : 0.9 + 0.1 * Math.sin(t * 3);
    sp.emitA = 0.48 + 0.07 * Math.sin(t * 1.6);
  } else if (type === 'T') {
    const awake = (o.awake === undefined ? o.lit : o.awake) ? 1 : 0;
    const gl = o.lit === undefined ? awake : lit;
    const d = DIRS[o.dir] === undefined ? 2 : DIRS[o.dir];
    const f = awake ? Math.floor(t * 6) & 3 : 0;
    sp.s = get(b, 'T' + d + awake + gl + '.' + f, (p) => paintStump(p, d, awake, f, gl), gl ? RIM_WARM : RIM_COOL, gl ? 0 : 0.34);
    if (awake) {
      sp.dy = -Math.abs(Math.sin(t * Math.PI * 3)) * 0.018;
      sp.glowA = gl ? 0.88 + 0.12 * Math.sin(t * 4) : 0;
    } else {
      const br = Math.sin(t * 1.4);
      sp.glowA = gl ? 0.7 : 0;
      sp.sx = 1 + 0.012 * br;
      sp.sy = 1 + 0.025 * br;
      sp.ay = 0.86;
      sp.zed = true;
      sp.emitA = 0.48 + 0.06 * br;
    }
  }
  return sp;
}

function drawZed(ctx, b, px, py, size, t, emit) {
  const z = get(b, 'Z', paintZ, null, 0.9);
  if (!z) return;
  const u = (t * 0.4) % 1;
  const al = ctx.globalAlpha;
  ctx.globalAlpha = al * Math.sin(Math.PI * u) * 0.9;
  const zs = size * (0.22 + 0.06 * u);
  const e = emit ? emissive(z) : null;
  if (!emit || e) put(ctx, z, px + size * (0.72 + 0.06 * u), py + size * (0.08 - 0.16 * u), zs, emit ? 0.55 : 0, 1, 1, 0.5, 0.9, e);
  ctx.globalAlpha = al;
}

export function drawCreature(ctx, type, px, py, size, opts) {
  const o = opts || {};
  const b = bucket(ctx, size);
  const sp = creatureSpec(b, type, o);
  if (!sp.s) return;
  if (sp.hover !== false) shadow(ctx, b, px + 0.5 * size, py + 0.88 * size, (0.5 - 0.04 * sp.hover) * size, 0.12 * size, 0.38);
  put(ctx, sp.s, px, py + sp.dy * size, size, sp.glowA, sp.sx, sp.sy, sp.ax, sp.ay);
  if (sp.zed) drawZed(ctx, b, px, py, size, o.t || 0, false);
}

// Emissive pass, drawn after the darkness. On an unlit tile only the luminous markings and a faint rim
// show (no body fill, so the darkness still covers the body); lit creatures and a lit Wren get nothing.
export function drawGlow(ctx, who, px, py, size, opts) {
  const o = opts || {};
  if (o.lit) return;
  const b = bucket(ctx, size);
  if (who === 'wren') {
    const w = wrenSpec(b, o);
    const e = w.s && emissive(w.s);
    if (e) put(ctx, w.s, px, py, size, 0.4 + 0.06 * Math.sin((o.t || 0) * 2.3), w.sx, w.sy, 0.5, 0.89, e);
    return;
  }
  const sp = creatureSpec(b, who, o);
  const e = sp.s && emissive(sp.s);
  if (!e) return;
  put(ctx, sp.s, px, py + sp.dy * size, size, sp.emitA, sp.sx, sp.sy, sp.ax, sp.ay, e);
  if (sp.zed) drawZed(ctx, b, px, py, size, o.t || 0, true);
}
