// "Lantern glyphs": the characters as bold cut-glass emblems, like the coloured panes of a lantern.
// Each one is a single strong shape with thick plum leading, flat jewel fills with a soft inner glow,
// and one or two inner lines that act as a rune. There are no faces anywhere: state is told by the
// shape changing (wings open or fold to a diamond, a spiral shell unwinds or seals into a dome, a
// stump stands tall or squats) and by motion (bob, flutter, breathing squash, sway).
//
// Same signatures as sprites.js (SPEC section 7). Everything is painted once into small offscreen
// canvases keyed by kind, device-pixel size, state and an animation-frame bucket, then blitted.
// No DOM at import time: canvases are created lazily (OffscreenCanvas, else document.createElement).

const TAU = Math.PI * 2;
const NONE = Object.freeze({});

const LEAD = '#2B1E3A'; // the leading between panes
const VOID = '#33244A'; // an empty dark pane (hood opening, a smothered lantern)
const AMBER = '#F2B04C';
const AMBER_LT = '#FFE2A0';
const AMBER_DK = '#C47F2C';
const TEAL = '#5FBFA8';
const TEAL_LT = '#BDEFDF';
const ROSE = '#C97A8A';
const ROSE_LT = '#F4C6CC';
const ROSE_DK = '#99536A';
const CREAM = '#F4EAD5';
const CREAM_DK = '#D9C3A2';
const FLAME = '#FFE08A';
const CORE = '#FFF9E6';
const LW = 0.056; // leading width, in tiles

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function hash(n) {
  n = (n ^ 61) ^ (n >>> 16);
  n = (n + (n << 3)) | 0;
  n ^= n >>> 4;
  n = Math.imul(n, 0x27d4eb2d);
  n ^= n >>> 15;
  return (n >>> 0) / 4294967296;
}

const rgbCache = new Map();
function rgb(c) {
  let v = rgbCache.get(c);
  if (!v) {
    const h = c.replace('#', '');
    v = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    rgbCache.set(c, v);
  }
  return v;
}
function rgba(c, a) {
  const v = rgb(c);
  return `rgba(${v[0]},${v[1]},${v[2]},${a})`;
}
// Hand-cut wobble: nudges every point a little, the same way every time for a given seed.
function wob(pts, seed, amt) {
  return pts.map((p, i) => {
    const q = [p[0] + (hash(seed * 97 + i * 2) - 0.5) * 2 * amt, p[1] + (hash(seed * 97 + i * 2 + 1) - 0.5) * 2 * amt];
    if (p[2]) q.push(1);
    return q;
  });
}
// A smooth path through points (Catmull-Rom); a point [x, y, 1] is a sharp corner.
function shape(pts, closed = true) {
  const p = new Path2D();
  const n = pts.length;
  const at = (i) => pts[closed ? (i + n) % n : Math.max(0, Math.min(n - 1, i))];
  p.moveTo(pts[0][0], pts[0][1]);
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const k1 = p1[2] ? 0 : 1 / 6;
    const k2 = p2[2] ? 0 : 1 / 6;
    p.bezierCurveTo(
      p1[0] + (p2[0] - p0[0]) * k1, p1[1] + (p2[1] - p0[1]) * k1,
      p2[0] - (p3[0] - p1[0]) * k2, p2[1] - (p3[1] - p1[1]) * k2,
      p2[0], p2[1]);
  }
  if (closed) p.closePath();
  return p;
}
function ellipse(cx, cy, rx, ry, rot = 0) {
  const p = new Path2D();
  p.ellipse(cx, cy, rx, ry, rot, 0, TAU);
  return p;
}
function roundRect(x0, y0, x1, y1, r) {
  const p = new Path2D();
  p.moveTo(x0 + r, y0);
  p.arcTo(x1, y0, x1, y1, r);
  p.arcTo(x1, y1, x0, y1, r);
  p.arcTo(x0, y1, x0, y0, r);
  p.arcTo(x0, y0, x1, y0, r);
  p.closePath();
  return p;
}

// A glass pane: flat jewel fill, a soft glow from inside, a slightly deeper rim, a shine streak.
function pane(g, path, base, glow, gx, gy, gr, opt = NONE) {
  g.fillStyle = base;
  g.fill(path);
  g.save();
  g.clip(path);
  if (glow) {
    const gd = g.createRadialGradient(gx, gy, 0, gx, gy, gr);
    gd.addColorStop(0, rgba(glow, opt.glowA === undefined ? 0.95 : opt.glowA));
    gd.addColorStop(0.55, rgba(glow, (opt.glowA === undefined ? 0.95 : opt.glowA) * 0.35));
    gd.addColorStop(1, rgba(glow, 0));
    g.fillStyle = gd;
    g.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
  }
  if (opt.rim !== 0) {
    g.strokeStyle = rgba(LEAD, opt.rim || 0.22);
    g.lineWidth = LW * 3;
    g.stroke(path);
  }
  if (opt.shine) {
    const s = opt.shine; // [x0, y0, x1, y1]
    g.strokeStyle = 'rgba(255,252,240,0.55)';
    g.lineWidth = LW * 0.6;
    g.beginPath();
    g.moveTo(s[0], s[1]);
    g.quadraticCurveTo((s[0] + s[2]) / 2 - (s[3] - s[1]) * 0.15, (s[1] + s[3]) / 2, s[2], s[3]);
    g.stroke();
  }
  g.restore();
}
function lead(g, path, w = LW) {
  g.strokeStyle = LEAD;
  g.lineWidth = w;
  g.stroke(path);
}
// A leading line inside a shape (clipped so it meets the outline cleanly).
function rune(g, clipPath, linePath, w = LW * 0.8) {
  g.save();
  g.clip(clipPath);
  lead(g, linePath, w);
  g.restore();
}
function line(pts) {
  return shape(pts, false);
}
function shadow(g, cx, cy, rx, ry, a = 0.38) {
  g.save();
  g.translate(cx, cy);
  g.scale(1, ry / rx);
  const gd = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  gd.addColorStop(0, `rgba(18,10,28,${a})`);
  gd.addColorStop(0.65, `rgba(18,10,28,${a * 0.6})`);
  gd.addColorStop(1, 'rgba(18,10,28,0)');
  g.fillStyle = gd;
  g.fillRect(-rx, -rx, rx * 2, rx * 2);
  g.restore();
}

// ---------------------------------------------------------------------------
// sprite cache
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

const cache = new Map();
const MAX_AREA = 12e6; // device pixels kept before the cache starts over
let cacheArea = 0;
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
function devSize(ctx, size) {
  const P = Math.round(size * ctxScale(ctx));
  return P < 12 ? 12 : P > 512 ? 512 : P;
}

// Get (painting on first use) the sprite `key` at device size P. Painters draw in tile units.
function sprite(P, key, painter, margin = 0.25) {
  const k = key + '@' + P;
  let s = cache.get(k);
  if (s !== undefined) return s;
  const mp = Math.round(P * margin);
  const side = P + 2 * mp;
  if (cacheArea + side * side > MAX_AREA) {
    for (const v of cache.values()) if (v) v.c.width = v.c.height = 1;
    cache.clear();
    cacheArea = 0;
  }
  cacheArea += side * side;
  const c = makeCanvas(side, side);
  s = null;
  if (c) {
    const g = c.getContext('2d');
    g.setTransform(P, 0, 0, P, mp, mp);
    g.lineCap = 'round';
    g.lineJoin = 'round';
    painter(g);
    s = { c, m: mp / P, k: side / P };
  }
  cache.set(k, s);
  return s;
}

// Copy a sprite 1:1 (its device size matches the tile), so no resampling happens per frame.
function blit(ctx, s, px, py, size) {
  const o = size * s.m;
  const d = size * s.k;
  ctx.drawImage(s.c, px - o, py - o, d, d);
}

function paintGlow(g) {
  const gd = g.createRadialGradient(0.5, 0.5, 0, 0.5, 0.5, 0.5);
  gd.addColorStop(0, 'rgba(255,216,140,0.9)');
  gd.addColorStop(0.35, 'rgba(250,182,86,0.4)');
  gd.addColorStop(1, 'rgba(242,176,76,0)');
  g.fillStyle = gd;
  g.fillRect(0, 0, 1, 1);
}
function drawGlow(ctx, P, cx, cy, d, alpha) {
  const s = sprite(P, 'glow', paintGlow, 0);
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
const BUCKETS = 12;
function bucket(t, rate, n = BUCKETS) {
  const p = (t * rate) % 1;
  return Math.floor((p < 0 ? p + 1 : p) * n) % n;
}

// ---------------------------------------------------------------------------
// the lantern pane (carried and planted)
// ---------------------------------------------------------------------------

// A lantern centred on (cx, cy), `h` tall. out: smothered (dark glass). f: flame frame 0..5.
function paintLanternGlyph(g, cx, cy, h, out, f, panes, tilt = 0) {
  const w = h * 0.66;
  g.save();
  if (tilt) {
    // hanging limp from its ring
    g.translate(cx, cy - h * 0.56);
    g.rotate(tilt);
    g.translate(-cx, -(cy - h * 0.56));
  }
  const lw = Math.min(LW, h * 0.17);
  // ring handle
  g.beginPath();
  g.arc(cx, cy - h * 0.43, h * 0.13, Math.PI * 1.05, Math.PI * 1.95);
  g.strokeStyle = LEAD;
  g.lineWidth = lw * 0.9;
  g.stroke();
  // cap
  const cap = shape([[cx - w * 0.2, cy - h * 0.45, 1], [cx + w * 0.2, cy - h * 0.45, 1], [cx + w * 0.46, cy - h * 0.29, 1], [cx - w * 0.46, cy - h * 0.29, 1]]);
  pane(g, cap, AMBER_DK, null, 0, 0, 0, { rim: 0 });
  // glass, slightly barrel-shaped
  const glass = shape([[cx - w * 0.44, cy - h * 0.29, 1], [cx + w * 0.44, cy - h * 0.29, 1], [cx + w * 0.53, cy], [cx + w * 0.44, cy + h * 0.29, 1], [cx - w * 0.44, cy + h * 0.29, 1], [cx - w * 0.53, cy]]);
  if (out) {
    pane(g, glass, VOID, '#6E6488', cx - w * 0.15, cy - h * 0.12, w * 0.6, { glowA: 0.45, rim: 0.3 });
  } else {
    g.fillStyle = AMBER;
    g.fill(glass);
    g.save();
    g.clip(glass);
    const gd = g.createRadialGradient(cx, cy + h * 0.04, 0, cx, cy + h * 0.04, w * 0.62);
    gd.addColorStop(0, CORE);
    gd.addColorStop(0.45, FLAME);
    gd.addColorStop(1, AMBER);
    g.fillStyle = gd;
    g.fillRect(cx - w, cy - h, w * 2, h * 2);
    // the flame: a small cream teardrop that leans and stretches a little
    const lean = [0, 0.05, -0.04, 0.03, -0.06, 0.02][f % 6] * w;
    const tall = [1, 1.08, 0.94, 1.04, 0.98, 1.1][f % 6];
    const fy = cy + h * 0.16;
    const fl = shape([[cx + lean, fy - h * 0.32 * tall, 1], [cx + w * 0.13, fy - h * 0.08], [cx + w * 0.1, fy], [cx, fy + h * 0.04], [cx - w * 0.1, fy], [cx - w * 0.13, fy - h * 0.08]]);
    g.fillStyle = '#FFFFFF';
    g.globalAlpha = 0.85;
    g.fill(fl);
    g.globalAlpha = 1;
    g.restore();
  }
  if (panes) {
    rune(g, glass, line([[cx - w * 0.2, cy - h * 0.3], [cx - w * 0.22, cy + h * 0.3]]), lw * 0.7);
    rune(g, glass, line([[cx + w * 0.2, cy - h * 0.3], [cx + w * 0.22, cy + h * 0.3]]), lw * 0.7);
  }
  // base
  const base = shape([[cx - w * 0.42, cy + h * 0.29, 1], [cx + w * 0.42, cy + h * 0.29, 1], [cx + w * 0.34, cy + h * 0.41, 1], [cx - w * 0.34, cy + h * 0.41, 1]]);
  pane(g, base, AMBER_DK, null, 0, 0, 0, { rim: 0 });
  lead(g, cap, lw);
  lead(g, glass, lw);
  lead(g, base, lw);
  if (out) {
    // a thread of smoke where the flame was
    const wisp = line([[cx, cy - h * 0.48], [cx + w * 0.25, cy - h * 0.7], [cx - w * 0.15, cy - h * 0.88], [cx + w * 0.1, cy - h * 1.08]]);
    g.strokeStyle = 'rgba(214,204,226,0.7)';
    g.lineWidth = lw * 0.7;
    g.stroke(wisp);
  }
  g.restore();
}

function paintPlantedLantern(g, f) {
  shadow(g, 0.5, 0.86, 0.26, 0.07);
  paintLanternGlyph(g, 0.5, 0.56, 0.6, false, f, true);
}

// ---------------------------------------------------------------------------
// Wren: a hooded cloak reduced to a teardrop emblem; the hood point shows the way
// ---------------------------------------------------------------------------

// A hooded figure in one pane: a soft hood "head" with a floppy point, a pinch at the scarf, a flared cloak.
const CLOAK_S = [[0.4, 0.06, 1], [0.5, 0.1], [0.62, 0.18], [0.7, 0.32], [0.71, 0.46], [0.68, 0.57], [0.73, 0.7], [0.79, 0.84], [0.77, 0.92], [0.5, 0.95], [0.23, 0.92], [0.21, 0.84], [0.27, 0.7], [0.32, 0.57], [0.29, 0.46], [0.3, 0.32], [0.36, 0.18], [0.4, 0.12]];
const CLOAK_N = CLOAK_S.map((p) => (p[2] ? [1 - p[0], p[1], 1] : [1 - p[0], p[1]]));
const CLOAK_E = [[0.8, 0.12, 1], [0.74, 0.17], [0.72, 0.28], [0.725, 0.42], [0.7, 0.55], [0.69, 0.59], [0.74, 0.72], [0.79, 0.86], [0.76, 0.93], [0.46, 0.95], [0.2, 0.92], [0.13, 0.86], [0.24, 0.7], [0.3, 0.57], [0.28, 0.42], [0.33, 0.26], [0.46, 0.14], [0.64, 0.1]];
// where the lantern hangs, per facing N E S W (W is E mirrored)
const LANTERN_AT = [[0.8, 0.6], [0.87, 0.75], [0.83, 0.79], [0.87, 0.75]];
const LANTERN_H = 0.3;
const WREN_FRAMES = 8;

// Bake a little motion into a frame: squash about an anchor, a tilt and a lift.
function anim(g, ax, ay, sx, sy, rot, dy) {
  g.translate(ax, ay + dy);
  if (rot) g.rotate(rot);
  g.scale(sx, sy);
  g.translate(-ax, -ay);
}
function wrenMotion(d, f) {
  const p = (f / WREN_FRAMES) * TAU;
  const br = Math.sin(p);
  return { sx: 1 + 0.018 * br, sy: 1 - 0.026 * br, rot: (d === 1 || d === 3 ? 0.03 : 0.012) * Math.sin(p + 1), dy: -0.012 * (1 + br) };
}

function ribbon(g, x0, y0, x1, y1, w, wave) {
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  const p = shape([[x0 - nx, y0 - ny], [mx - nx * 0.8 + wave * nx * 4, my - ny * 0.8 + wave * ny * 4], [x1, y1, 1], [mx + nx * 0.8 + wave * nx * 4, my + ny * 0.8 + wave * ny * 4], [x0 + nx, y0 + ny]]);
  pane(g, p, TEAL, TEAL_LT, x0, y0, len, { rim: 0, glowA: 0.6 });
  lead(g, p, LW * 0.75);
}

function paintWren(g, d, carrying, out, f) {
  shadow(g, 0.5, 0.91, 0.3, 0.075);
  const m = wrenMotion(d, f);
  anim(g, 0.5, 0.92, m.sx, m.sy, m.rot, m.dy);
  if (d === 3) {
    g.translate(1, 0);
    g.scale(-1, 1);
  }
  const side = d === 1 || d === 3;
  const wave = Math.sin((f / WREN_FRAMES) * TAU * 2);
  const L = carrying ? LANTERN_AT[d] : null;
  if (L && d === 0) {
    // seen from behind: the lantern hangs at the side, half hidden by the cloak
    paintLanternGlyph(g, L[0], L[1], LANTERN_H, out, f, false, out ? 0.3 : 0);
  }
  if (side) ribbon(g, 0.32, 0.6, 0.08, 0.64 + wave * 0.03, 0.06, wave * 0.01); // the scarf end streams behind
  const cloak = shape(wob(side ? CLOAK_E : d === 0 ? CLOAK_N : CLOAK_S, 3 + d, 0.006));
  pane(g, cloak, AMBER, AMBER_LT, side ? 0.55 : 0.48, 0.42, 0.45, { shine: side ? [0.4, 0.3, 0.27, 0.74] : d === 0 ? [0.3, 0.68, 0.26, 0.84] : [0.3, 0.68, 0.26, 0.84] });
  // a deeper facet down the shaded side
  g.save();
  g.clip(cloak);
  g.fillStyle = rgba(AMBER_DK, 0.5);
  g.fill(side ? shape([[0, 0.56, 1], [0.36, 0.6, 1], [0.3, 1, 1], [0, 1, 1]]) : shape([[0.6, 0.6, 1], [0.66, 1, 1], [1, 1, 1], [1, 0.55, 1]]));
  g.restore();
  let scarf;
  if (d === 2) {
    // facing us: the hood opening is one solid dark pane, nothing inside it
    const hole = shape(wob([[0.5, 0.3], [0.585, 0.33], [0.62, 0.43], [0.615, 0.6, 1], [0.385, 0.6, 1], [0.38, 0.43], [0.415, 0.33]], 21, 0.004));
    pane(g, hole, VOID, '#4A3766', 0.5, 0.58, 0.2, { rim: 0.35 });
    lead(g, hole, LW * 0.8);
    rune(g, cloak, line([[0.6, 0.68], [0.63, 0.82], [0.64, 0.96]]), LW * 0.7);
    scarf = [[0.1, 0.5, 1], [0.5, 0.58], [0.9, 0.5, 1], [0.9, 0.62, 1], [0.5, 0.7], [0.1, 0.62, 1]];
  } else if (d === 0) {
    // from behind: the hood is closed and plain; only the flopped point shows a fold
    rune(g, cloak, line([[0.62, 0.05], [0.56, 0.15], [0.47, 0.2]]), LW * 0.65);
    rune(g, cloak, line([[0.4, 0.68], [0.37, 0.82], [0.36, 0.96]]), LW * 0.7);
    scarf = [[0.1, 0.5, 1], [0.5, 0.57], [0.9, 0.5, 1], [0.9, 0.61, 1], [0.5, 0.68], [0.1, 0.61, 1]];
  } else {
    // side view: a dark pane at the front of the hood, a fold trailing back
    const hole = shape(wob([[0.63, 0.25], [0.7, 0.29], [0.715, 0.41], [0.7, 0.6, 1], [0.59, 0.61, 1], [0.575, 0.43], [0.59, 0.31]], 23, 0.004));
    pane(g, hole, VOID, '#4A3766', 0.66, 0.56, 0.2, { rim: 0.35 });
    lead(g, hole, LW * 0.8);
    rune(g, cloak, line([[0.47, 0.7], [0.4, 0.82], [0.34, 0.96]]), LW * 0.7);
    scarf = [[0.1, 0.52, 1], [0.45, 0.58], [0.9, 0.5, 1], [0.9, 0.62, 1], [0.45, 0.7], [0.1, 0.64, 1]];
  }
  const sc = shape(wob(scarf, 25 + d, 0.004));
  g.save();
  g.clip(cloak);
  pane(g, sc, TEAL, TEAL_LT, 0.45, 0.58, 0.3, { rim: 0.2 });
  lead(g, sc, LW * 0.8);
  g.restore();
  lead(g, cloak);
  if (L && d !== 0) {
    // a little sleeve holds the ring
    const sleeve = d === 2 ? ellipse(0.71, 0.64, 0.065, 0.056, 0.5) : ellipse(0.73, 0.62, 0.065, 0.056, 0.3);
    pane(g, sleeve, AMBER, AMBER_LT, d === 2 ? 0.7 : 0.72, 0.62, 0.06, { rim: 0 });
    lead(g, sleeve, LW * 0.8);
    paintLanternGlyph(g, L[0], L[1], LANTERN_H, out, f, false, out ? 0.35 : 0);
  }
}

// ---------------------------------------------------------------------------
// Fluffmoth: wings wide open in the light, folded to a narrow diamond in the dark
// ---------------------------------------------------------------------------

function mothBody(g, cy, len, seed) {
  // a fluffy scalloped capsule, no head
  const pts = [];
  const n = 14;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const bump = i % 2 ? 1 : 0.86;
    pts.push([0.5 + Math.sin(a) * 0.075 * bump, cy - Math.cos(a) * len * (i % 2 ? 1 : 0.94)]);
  }
  const body = shape(wob(pts, seed, 0.004));
  pane(g, body, CREAM, '#FFFFFF', 0.48, cy - len * 0.3, 0.12, { rim: 0.18 });
  rune(g, body, line([[0.4, cy + len * 0.2], [0.6, cy + len * 0.22]]), LW * 0.55);
  rune(g, body, line([[0.4, cy + len * 0.48], [0.6, cy + len * 0.5]]), LW * 0.55);
  lead(g, body);
  return body;
}

function feather(g, x0, y0, x1, y1, w) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const nx = -dy * w;
  const ny = dx * w;
  const p = shape([[x0, y0, 1], [x0 + dx * 0.5 + nx, y0 + dy * 0.5 + ny], [x1, y1, 1], [x0 + dx * 0.5 - nx, y0 + dy * 0.5 - ny]]);
  pane(g, p, CREAM_DK, null, 0, 0, 0, { rim: 0 });
  lead(g, p, LW * 0.6);
}

const MOTH_LIT_FRAMES = 16; // one cycle = two wingbeats and one slow tilt
const MOTH_DARK_FRAMES = 8;
function paintMoth(g, lit, f) {
  if (lit) {
    // open wide; the wings beat between 0.74 and 1 of their spread, the body bobs against them
    const q = (f / MOTH_LIT_FRAMES) * TAU;
    const s = 0.74 + 0.26 * (0.5 + 0.5 * Math.cos(q * 2));
    const lift = (1 - s) * 0.16;
    shadow(g, 0.5, 0.92, 0.26 + 0.12 * s, 0.06, 0.3);
    anim(g, 0.5, 0.5, 1, 1, 0.06 * Math.sin(q), -0.035 - 0.035 * Math.sin(q * 2));
    const up = (k) => [[0.53, 0.36, 1], [0.5 + 0.18 * s, 0.2 - lift], [0.5 + 0.36 * s, 0.11 - lift], [0.5 + 0.47 * s, 0.17 - lift], [0.5 + 0.44 * s, 0.33 - lift * 0.5], [0.5 + 0.3 * s, 0.47], [0.53, 0.5, 1]].map((p) => (k ? [1 - p[0], p[1], p[2]] : p)).map((p) => (p[2] ? p : [p[0], p[1]]));
    const lo = (k) => [[0.53, 0.5, 1], [0.5 + 0.28 * s, 0.53], [0.5 + 0.35 * s, 0.66], [0.5 + 0.27 * s, 0.79], [0.5 + 0.13 * s, 0.8], [0.53, 0.66, 1]].map((p) => (k ? [1 - p[0], p[1], p[2]] : p)).map((p) => (p[2] ? p : [p[0], p[1]]));
    for (let k = 0; k < 2; k++) {
      const sg = k ? -1 : 1;
      const lower = shape(wob(lo(k), 40 + k, 0.006));
      pane(g, lower, '#E8AFA6', '#FFF1DA', 0.5 + sg * 0.2 * s, 0.62, 0.22);
      rune(g, lower, line([[0.5 + sg * 0.04, 0.56], [0.5 + sg * 0.17 * s, 0.63], [0.5 + sg * 0.26 * s, 0.72]]), LW * 0.65);
      lead(g, lower);
      const upper = shape(wob(up(k), 50 + k, 0.006));
      pane(g, upper, ROSE, ROSE_LT, 0.5 + sg * 0.28 * s, 0.3 - lift, 0.3, { shine: [0.5 + sg * 0.2 * s, 0.22 - lift, 0.5 + sg * 0.36 * s, 0.17 - lift] });
      rune(g, upper, line([[0.5 + sg * 0.04, 0.44], [0.5 + sg * 0.24 * s, 0.33 - lift * 0.6], [0.5 + sg * 0.46 * s, 0.27 - lift]]), LW * 0.65);
      lead(g, upper);
    }
    feather(g, 0.47, 0.3, 0.36, 0.13, 0.22);
    feather(g, 0.53, 0.3, 0.64, 0.13, 0.22);
    mothBody(g, 0.5, 0.22, 60);
  } else {
    // folded into a narrow tented diamond, dim; it only breathes, the folded wings swelling a little
    shadow(g, 0.5, 0.9, 0.2, 0.05, 0.32);
    const br = 0.5 - 0.5 * Math.cos((f / MOTH_DARK_FRAMES) * TAU);
    anim(g, 0.5, 0.86, 1 + 0.07 * br, 1 - 0.02 * br, 0, 0);
    const dia = shape(wob([[0.5, 0.2, 1], [0.61, 0.35], [0.66, 0.53], [0.59, 0.7], [0.5, 0.84, 1], [0.41, 0.7], [0.34, 0.53], [0.39, 0.35]], 70, 0.005));
    pane(g, dia, '#9B6276', '#C99AA6', 0.52, 0.4, 0.22, { rim: 0.3 });
    g.save();
    g.clip(dia);
    g.fillStyle = rgba(LEAD, 0.2);
    g.fillRect(0, 0, 0.5, 1);
    g.restore();
    rune(g, dia, line([[0.5, 0.12], [0.5, 0.88]]), LW * 0.75);
    rune(g, dia, line([[0.5, 0.42], [0.58, 0.55], [0.6, 0.66]]), LW * 0.55);
    rune(g, dia, line([[0.5, 0.42], [0.42, 0.55], [0.4, 0.66]]), LW * 0.55);
    lead(g, dia);
    // the fluffy collar where the folded wings meet
    const ruff = [];
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU;
      const r = i % 2 ? 0.075 : 0.06;
      ruff.push([0.5 + Math.sin(a) * r, 0.25 - Math.cos(a) * r * 0.8]);
    }
    const collar = shape(wob(ruff, 72, 0.003));
    pane(g, collar, '#CDBDA6', '#F4EAD5', 0.49, 0.23, 0.07, { rim: 0 });
    lead(g, collar, LW * 0.8);
    // a tuft of fluff peeks out below
    const tuft = shape(wob([[0.46, 0.82], [0.5, 0.79], [0.54, 0.82], [0.53, 0.88], [0.5, 0.9], [0.47, 0.88]], 71, 0.003));
    pane(g, tuft, '#BFB09C', null, 0, 0, 0, { rim: 0 });
    lead(g, tuft, LW * 0.7);
  }
}

// Settled flat on a puddle: a broad glass raft that spans the water, wings pressed flat edge to edge.
function paintBridgeMoth(g) {
  // a soft ripple ring on the water around it
  g.strokeStyle = 'rgba(214,236,240,0.28)';
  g.lineWidth = 0.025;
  g.beginPath();
  g.ellipse(0.5, 0.52, 0.5, 0.36, 0, 0, TAU);
  g.stroke();
  shadow(g, 0.5, 0.56, 0.5, 0.26, 0.32);
  for (let k = 0; k < 2; k++) {
    const sg = k ? -1 : 1;
    const X = (x) => 0.5 + sg * x;
    const lower = shape(wob([[X(0.03), 0.5, 1], [X(0.3), 0.52], [X(0.42), 0.64], [X(0.34), 0.78], [X(0.12), 0.8], [X(0.03), 0.68, 1]], 80 + k, 0.006));
    pane(g, lower, '#DDA79F', '#FFF1DA', X(0.2), 0.64, 0.24, { rim: 0.25 });
    lead(g, lower);
    const upper = shape(wob([[X(0.03), 0.34, 1], [X(0.2), 0.22], [X(0.42), 0.2], [X(0.53), 0.27], [X(0.52), 0.42], [X(0.38), 0.52], [X(0.03), 0.52, 1]], 90 + k, 0.006));
    pane(g, upper, '#BE7486', ROSE_LT, X(0.26), 0.34, 0.3, { rim: 0.25, shine: [X(0.16), 0.27, X(0.38), 0.25] });
    // straight cross leading, like the boards of a footbridge
    rune(g, upper, line([[X(0.03), 0.37], [X(0.55), 0.36]]), LW * 0.65);
    rune(g, lower, line([[X(0.03), 0.64], [X(0.44), 0.65]]), LW * 0.65);
    lead(g, upper);
  }
  // the body lies flat down the middle, antennae laid back
  feather(g, 0.47, 0.27, 0.4, 0.13, 0.2);
  feather(g, 0.53, 0.27, 0.6, 0.13, 0.2);
  mothBody(g, 0.5, 0.25, 61);
}

// ---------------------------------------------------------------------------
// Shellwhelk: a spiral shell on a soft creeping foot; hidden = sealed into a low heavy dome
// ---------------------------------------------------------------------------

function spiralPath(cx, cy, r0, r1, turns, start, sq) {
  const p = new Path2D();
  const n = Math.ceil(turns * 28);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const a = start + u * turns * TAU;
    const r = r0 + (r1 - r0) * u;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r * sq;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  return p;
}

function paintWhelk(g, hidden, f) {
  if (!hidden) {
    const ph = (f / BUCKETS) * TAU;
    const st = 0.5 - 0.5 * Math.cos(ph); // 0 tucked .. 1 stretched
    const hx = 0.8 + 0.07 * st;
    const hy = 0.72 - 0.03 * Math.sin(ph);
    shadow(g, 0.5, 0.88, 0.36 + 0.03 * st, 0.07);
    anim(g, 0.5, 0.88, 1 - 0.01 * Math.sin(ph), 1 + 0.02 * Math.sin(ph), 0, 0);
    const foot = shape(wob([[0.11, 0.875], [0.11, 0.8], [0.3, 0.745], [0.58, 0.74], [hx - 0.09, hy + 0.0], [hx - 0.03, hy - 0.085], [hx + 0.06, hy - 0.07], [hx + 0.095, hy + 0.02], [hx + 0.05, 0.875], [0.5, 0.9]], 30, 0.004));
    pane(g, foot, CREAM, '#FFFFFF', hx - 0.04, hy - 0.03, 0.24, { rim: 0.22 });
    lead(g, foot);
    const cx = 0.42 - 0.015 * st;
    const cy = 0.5 + 0.008 * st;
    const shell = shape(wob([[cx - 0.27, cy + 0.02], [cx - 0.21, cy - 0.17], [cx - 0.02, cy - 0.26], [cx + 0.18, cy - 0.2], [cx + 0.27, cy - 0.02], [cx + 0.22, cy + 0.19], [cx + 0.04, cy + 0.27], [cx - 0.18, cy + 0.21]], 31, 0.005));
    pane(g, shell, ROSE, ROSE_LT, cx - 0.06, cy - 0.08, 0.3, { shine: [cx - 0.16, cy - 0.06, cx - 0.06, cy - 0.18] });
    // the open spiral: unwinding outward to the lip
    rune(g, shell, spiralPath(cx + 0.01, cy + 0.01, 0.025, 0.25, 2.1, 0.6 + 0.12 * st, 0.95), LW * 0.85);
    lead(g, shell);
  } else {
    // sealed: a low wide dome sitting flat and heavy, coils closed into stacked arches
    shadow(g, 0.5, 0.88, 0.44, 0.09, 0.5);
    const dome = shape(wob([[0.12, 0.86, 1], [0.13, 0.7], [0.24, 0.48], [0.5, 0.38], [0.76, 0.48], [0.87, 0.7], [0.88, 0.86, 1]], 33, 0.005));
    pane(g, dome, ROSE, ROSE_LT, 0.42, 0.52, 0.34, { shine: [0.24, 0.66, 0.32, 0.5] });
    rune(g, dome, shape([[0.25, 0.9], [0.27, 0.68], [0.5, 0.53], [0.73, 0.68], [0.75, 0.9]], false), LW * 0.75);
    rune(g, dome, shape([[0.38, 0.9], [0.4, 0.75], [0.5, 0.68], [0.6, 0.75], [0.62, 0.9]], false), LW * 0.75);
    const band = shape(wob([[0.09, 0.8, 1], [0.91, 0.8, 1], [0.92, 0.9, 1], [0.08, 0.9, 1]], 34, 0.004));
    pane(g, band, ROSE_DK, null, 0, 0, 0, { rim: 0 });
    lead(g, dome);
    lead(g, band);
  }
}

// ---------------------------------------------------------------------------
// Stumpcap: a blocky mushroom golem. Facing = chevron rune, cap pushed forward, feet pointing.
// ---------------------------------------------------------------------------

// A ">" chevron (pointing along `ang`) centred on (cx, cy), `sz` across; `sy` squashes it.
function chevron(cx, cy, sz, ang, sy = 1) {
  const base = [[-0.42, -0.5], [-0.1, -0.5], [0.42, 0], [-0.1, 0.5], [-0.42, 0.5], [0.08, 0]];
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return shape(base.map(([x, y]) => {
    const X = x * sz;
    const Y = y * sz;
    return [cx + X * c - Y * s, cy + (X * s + Y * c) * sy, 1];
  }));
}

function shoe(fx, fy, dir) {
  // side shoe pointing +x
  if (dir === 'E') return shape([[fx - 0.055, fy - 0.035], [fx + 0.03, fy - 0.045], [fx + 0.085, fy - 0.01], [fx + 0.08, fy + 0.022, 1], [fx - 0.055, fy + 0.022, 1]]);
  if (dir === 'S') return shape([[fx - 0.05, fy - 0.03], [fx + 0.05, fy - 0.03], [fx + 0.06, fy + 0.02], [fx, fy + 0.045], [fx - 0.06, fy + 0.02]]);
  return roundRect(fx - 0.045, fy - 0.03, fx + 0.045, fy + 0.02, 0.02); // heel, seen from behind
}

function stumpCap(g, pts, seed, gillAt, chev) {
  const cap = shape(wob(pts, seed, 0.006));
  pane(g, cap, ROSE, ROSE_LT, chev[0] - 0.08, chev[1] - 0.06, 0.38, { shine: [chev[0] - 0.26, chev[1] + 0.02, chev[0] - 0.18, chev[1] - 0.12] });
  if (gillAt) {
    g.save();
    g.clip(cap);
    g.fillStyle = ROSE_DK;
    g.fill(gillAt);
    g.restore();
    rune(g, cap, gillAt, LW * 0.75);
  }
  const ch = chevron(chev[0], chev[1], chev[2], chev[3], chev[4]);
  pane(g, ch, CREAM, '#FFFFFF', chev[0], chev[1], chev[2] * 0.6, { rim: 0 });
  lead(g, ch, LW * 0.8);
  lead(g, cap);
}

function stumpBody(g, x0, y0, x1, y1, seed, grain) {
  const body = shape(wob([[x0 + 0.04, y0], [x1 - 0.04, y0], [x1, y0 + 0.05], [x1 + 0.01, y1 - 0.05], [x1 - 0.05, y1], [x0 + 0.05, y1], [x0 - 0.01, y1 - 0.05], [x0, y0 + 0.05]], seed, 0.005));
  pane(g, body, '#EFDCBC', '#FFF8EA', (x0 + x1) / 2 - 0.05, (y0 + y1) / 2, 0.26, { rim: 0.28 });
  if (grain) rune(g, body, line([[grain, y0], [grain - 0.015, (y0 + y1) / 2], [grain + 0.01, y1]]), LW * 0.5);
  lead(g, body);
}

function leg(g, hx, hy, fx, fy, dir, far) {
  const L = line([[hx, hy], [fx, fy - 0.02]]);
  g.strokeStyle = LEAD;
  g.lineWidth = 0.1 + LW;
  g.stroke(L);
  g.strokeStyle = far ? CREAM_DK : '#EBDDC3';
  g.lineWidth = 0.1 - LW * 0.4;
  g.stroke(L);
  const s = shoe(fx, fy, dir);
  pane(g, s, far ? '#B79C7C' : CREAM_DK, null, 0, 0, 0, { rim: 0 });
  lead(g, s, LW * 0.85);
}

function paintStump(g, d, awake, f) {
  const a = awake ? Math.sin((f / 8) * TAU) : 0;
  const liftA = awake ? 0.035 * Math.max(0, Math.cos((f / 8) * TAU)) : 0;
  const liftB = awake ? 0.035 * Math.max(0, -Math.cos((f / 8) * TAU)) : 0;
  shadow(g, 0.5, 0.9, awake ? 0.3 : 0.38, 0.075, awake ? 0.36 : 0.45);
  if (awake) anim(g, 0.5, 0.9, 1, 1, d === 1 ? 0.04 : d === 3 ? -0.04 : 0, -Math.abs(Math.sin((f / 8) * TAU)) * 0.025);
  else {
    const br = 0.5 - 0.5 * Math.cos((f / 8) * TAU);
    anim(g, 0.5, 0.9, 1 + 0.025 * br, 1 - 0.04 * br, 0, 0);
  }
  if (d === 3) {
    g.translate(1, 0);
    g.scale(-1, 1);
  }
  if (d === 1 || d === 3) {
    if (awake) {
      leg(g, 0.45, 0.72, 0.45 - 0.09 * a, 0.9 - liftB, 'E', true);
      stumpBody(g, 0.3, 0.38, 0.68, 0.78, 100, 0.4);
      leg(g, 0.55, 0.72, 0.55 + 0.09 * a, 0.9 - liftA, 'E', false);
      stumpCap(g, [[0.14, 0.43, 1], [0.15, 0.3], [0.29, 0.13], [0.52, 0.07], [0.75, 0.11], [0.9, 0.26], [0.95, 0.47, 1], [0.56, 0.48]], 110,
        line([[0.1, 0.39], [0.5, 0.43], [1, 0.42]]), [0.57, 0.27, 0.24, 0, 1]);
    } else {
      leg(g, 0.38, 0.84, 0.38, 0.88, 'E', true);
      leg(g, 0.6, 0.84, 0.6, 0.88, 'E', false);
      stumpBody(g, 0.3, 0.6, 0.68, 0.86, 101, 0.4);
      stumpCap(g, [[0.12, 0.69, 1], [0.13, 0.58], [0.27, 0.42], [0.5, 0.36], [0.72, 0.39], [0.87, 0.5], [0.92, 0.7, 1], [0.54, 0.72]], 111,
        line([[0.08, 0.65], [0.5, 0.68], [1, 0.66]]), [0.55, 0.53, 0.19, 0, 0.92]);
    }
  } else if (d === 2) {
    if (awake) {
      // facing us: the back foot sits higher (smaller), the front foot comes down toward us
      const fa = 0.9 + 0.025 * a;
      const fb = 0.9 - 0.025 * a;
      leg(g, 0.41, 0.72, 0.4, fa - liftA * 0.5, 'S', a < 0);
      leg(g, 0.59, 0.72, 0.6, fb - liftB * 0.5, 'S', a > 0);
      stumpBody(g, 0.3, 0.42, 0.7, 0.8, 102, 0.6);
      stumpCap(g, [[0.1, 0.45, 1], [0.12, 0.3], [0.28, 0.12], [0.5, 0.07], [0.72, 0.12], [0.88, 0.3], [0.9, 0.45, 1], [0.5, 0.54]], 112,
        shape([[0.05, 0.36], [0.5, 0.45], [0.95, 0.36], [1, 1], [0, 1]]), [0.5, 0.25, 0.24, Math.PI / 2, 1]);
    } else {
      leg(g, 0.38, 0.84, 0.38, 0.89, 'S', false);
      leg(g, 0.62, 0.84, 0.62, 0.89, 'S', false);
      stumpBody(g, 0.3, 0.62, 0.7, 0.86, 103);
      stumpCap(g, [[0.09, 0.69, 1], [0.11, 0.56], [0.27, 0.4], [0.5, 0.35], [0.73, 0.4], [0.89, 0.56], [0.91, 0.69, 1], [0.5, 0.76]], 113,
        shape([[0.05, 0.62], [0.5, 0.7], [0.95, 0.62], [1, 1], [0, 1]]), [0.5, 0.53, 0.18, Math.PI / 2, 0.92]);
    }
  } else {
    // seen from behind: cap pushed up and away, heels showing
    if (awake) {
      leg(g, 0.41, 0.74, 0.41, 0.9 - 0.03 * Math.max(0, a), 'N', false);
      leg(g, 0.59, 0.74, 0.59, 0.9 - 0.03 * Math.max(0, -a), 'N', false);
      stumpBody(g, 0.3, 0.32, 0.7, 0.82, 104, 0.42);
      stumpCap(g, [[0.1, 0.37, 1], [0.12, 0.23], [0.28, 0.07], [0.5, 0.03], [0.72, 0.07], [0.88, 0.23], [0.9, 0.37, 1], [0.5, 0.41]], 114,
        null, [0.5, 0.21, 0.24, -Math.PI / 2, 1]);
    } else {
      leg(g, 0.39, 0.85, 0.39, 0.88, 'N', false);
      leg(g, 0.61, 0.85, 0.61, 0.88, 'N', false);
      stumpBody(g, 0.3, 0.52, 0.7, 0.87, 105);
      stumpCap(g, [[0.09, 0.62, 1], [0.11, 0.5], [0.27, 0.34], [0.5, 0.29], [0.73, 0.34], [0.89, 0.5], [0.91, 0.62, 1], [0.5, 0.66]], 115,
        null, [0.5, 0.47, 0.18, -Math.PI / 2, 0.92]);
    }
  }
}

function paintZed(g) {
  const z = new Path2D();
  z.moveTo(0.24, 0.26);
  z.lineTo(0.76, 0.24);
  z.lineTo(0.26, 0.74);
  z.lineTo(0.76, 0.74);
  g.strokeStyle = LEAD;
  g.lineWidth = 0.3;
  g.stroke(z);
  g.strokeStyle = TEAL_LT;
  g.lineWidth = 0.13;
  g.stroke(z);
}

// ---------------------------------------------------------------------------
// public draw functions (SPEC section 7)
// ---------------------------------------------------------------------------

const DIRS = { N: 0, E: 1, S: 2, W: 3 };
function dirIndex(d) {
  const i = DIRS[d];
  return i === undefined ? 2 : i;
}

// Wren. opts: { t, dir, carrying, smothered }
export function drawWren(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const P = devSize(ctx, size);
  const t = o.t || 0;
  const d = dirIndex(o.dir);
  const carrying = o.carrying ? 1 : 0;
  const out = carrying && o.smothered ? 1 : 0;
  const f = bucket(t, 0.42, WREN_FRAMES);
  const s = sprite(P, `w${d}${carrying}${out}${f}`, (g) => paintWren(g, d, carrying, out, f));
  if (!s) return;
  blit(ctx, s, px, py, size);
  if (carrying && !out) {
    let L = LANTERN_AT[d];
    if (d === 3) L = [1 - L[0], L[1]];
    const dy = wrenMotion(d, f).dy * size;
    drawGlow(ctx, P, px + L[0] * size, py + L[1] * size + dy, size * 0.85, 0.24 + 0.14 * flicker(t));
  }
}

// The planted lantern. opts: { t }
export function drawLantern(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const P = devSize(ctx, size);
  const t = o.t || 0;
  const f = bucket(t, 1.6, 6);
  const s = sprite(P, `L${f}`, (g) => paintPlantedLantern(g, f));
  if (!s) return;
  blit(ctx, s, px, py, size);
  drawGlow(ctx, P, px + size * 0.5, py + size * 0.56, size * 1.3, 0.24 + 0.16 * flicker(t));
}

// Creatures. type 'M' Fluffmoth, 'S' Shellwhelk, 'T' Stumpcap. opts: { t, dir, lit, hidden, awake }
// (`hidden` and `awake` fall back to `lit` when they are left out.)
export function drawCreature(ctx, type, px, py, size, opts) {
  const o = opts || NONE;
  const P = devSize(ctx, size);
  const t = o.t || 0;
  if (type === 'M') {
    const lit = o.lit ? 1 : 0;
    const f = lit ? bucket(t, 1.1, MOTH_LIT_FRAMES) : bucket(t, 0.22, MOTH_DARK_FRAMES);
    const s = sprite(P, `m${lit}${f}`, (g) => paintMoth(g, lit, f));
    if (!s) return;
    if (lit) drawGlow(ctx, P, px + size * 0.5, py + size * 0.42, size * 1.05, 0.2 + 0.05 * flicker(t * 0.5));
    blit(ctx, s, px, py, size);
  } else if (type === 'S') {
    const hidden = (o.hidden === undefined ? o.lit : o.hidden) ? 1 : 0;
    const f = hidden ? 0 : bucket(t, 0.6);
    const s = sprite(P, `s${hidden}${f}`, (g) => paintWhelk(g, hidden, f));
    if (s) blit(ctx, s, px, py, size);
  } else if (type === 'T') {
    const awake = (o.awake === undefined ? o.lit : o.awake) ? 1 : 0;
    const d = dirIndex(o.dir);
    const f = awake ? bucket(t, 1.1, 8) : bucket(t, 0.19, 8);
    const s = sprite(P, `t${d}${awake}${f}`, (g) => paintStump(g, d, awake, f));
    if (!s) return;
    blit(ctx, s, px, py, size);
    if (!awake) {
      // one small "z" that stays, and a smaller one that drifts up and fades
      const z = sprite(P, 'z', paintZed, 0);
      if (z) {
        const al = ctx.globalAlpha;
        const big = size * 0.26;
        const sway = Math.sin(t * 1.7) * 0.015 * size;
        ctx.drawImage(z.c, px + size * 0.72, py + size * 0.08 + sway, big, big);
        const p = (t * 0.4) % 1;
        const small = size * 0.17;
        ctx.globalAlpha = al * Math.sin(Math.PI * p);
        ctx.drawImage(z.c, px + size * (0.92 + 0.04 * p), py - size * (0.02 + 0.12 * p), small, small);
        ctx.globalAlpha = al;
      }
    }
  }
}

// A Fluffmoth settled flat on a puddle (drawn over the puddle tile). opts: { t }
export function drawBridgeMoth(ctx, px, py, size) {
  const s = sprite(devSize(ctx, size), 'b', paintBridgeMoth);
  if (s) blit(ctx, s, px, py, size);
}
