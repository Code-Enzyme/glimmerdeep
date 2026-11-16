// "Felt and stitch" character style: handmade felt toys with fuzzy edges, fibre texture, running-stitch
// seams and appliqué patches. No faces anywhere: mood and state come from posture, silhouette and motion
// (tucked up in the dark, stretched out in the light).
// Same signatures as sprites.js (SPEC section 7) plus drawBridgeMoth for chars.js.
// Static art is painted once into offscreen canvases keyed by kind, device-pixel size, state and an
// animation-frame bucket; per frame we only blit (with a cheap squash/bob transform) and add glows.
import { PALETTE } from '../sprites.js';

const TAU = Math.PI * 2;
const NONE = Object.freeze({});

const AMBER = PALETTE.amber; // #F2B04C hood and coat
const TEAL = PALETTE.teal; // #5FBFA8 scarf and mittens
const ROSE = PALETTE.rose; // #C97A8A creatures
const CREAM = PALETTE.cream; // #F4EAD5 thread, pompom, fluff
const INK = PALETTE.ink;
const AMBER_LT = '#F8CB7C';
const TEAL_DK = '#3E9A86';
const BOOT = '#6A4454';
const PEACH = '#EEDCC0';
const BROWN = '#94633F';
const BROWN_DK = '#664330';
const STUMP = '#ECDDC1';
const BARK = '#B8977A';
const LID = '#7E5160';
const THREAD = CREAM;
const THREAD_DK = '#6E3F52';
const OUTLINE = 'rgba(30,18,40,0.86)';

// ---------------------------------------------------------------------------
// small utilities
function rng(seed) {
  let s = (Math.imul(seed | 0, 2654435761) >>> 0) || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

const rgbMemo = new Map();
function rgbOf(c) {
  let v = rgbMemo.get(c);
  if (!v) {
    const n = parseInt(c.slice(1), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    rgbMemo.set(c, v);
  }
  return v;
}
// k > 0 lightens toward warm white, k < 0 darkens toward ink. Returns a hex colour.
function tone(c, k) {
  const a = rgbOf(c);
  const t = k < 0 ? [36, 22, 46] : [255, 249, 232];
  const m = Math.abs(k);
  const h = (i) => Math.round(a[i] + (t[i] - a[i]) * m).toString(16).padStart(2, '0');
  return '#' + h(0) + h(1) + h(2);
}
function rgba(c, al) {
  const a = rgbOf(c);
  return `rgba(${a[0]},${a[1]},${a[2]},${al})`;
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
  return null; // plain Node: drawing becomes a no-op
}

// ---------------------------------------------------------------------------
// shapes as dense point lists (so we can fringe and inset them)

// Superellipse (sq 2 = ellipse, 4 = soft box) with a hand-cut wobble.
function oval(cx, cy, rx, ry, o) {
  o = o || NONE;
  const n = o.n || 44;
  const wob = o.wob === undefined ? 0.025 : o.wob;
  const e = 2 / (o.sq || 2);
  const R = rng(o.seed || 7);
  const p1 = R() * TAU;
  const p2 = R() * TAU;
  const rot = o.rot || 0;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = 1 + wob * (0.6 * Math.sin(a * 3 + p1) + 0.4 * Math.sin(a * 5 + p2));
    const x = Math.sign(ca) * Math.pow(Math.abs(ca), e) * rx * k;
    let y = Math.sign(sa) * Math.pow(Math.abs(sa), e) * ry * k;
    if (o.flat !== undefined && y > o.flat) y = o.flat + (y - o.flat) * 0.15;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return pts;
}

// Smooth closed curve through edge midpoints of a control polygon (repeat a point for a sharp corner).
function smooth(ctrl, k) {
  k = k || 7;
  const n = ctrl.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ctrl[(i - 1 + n) % n];
    const c = ctrl[i];
    const b = ctrl[(i + 1) % n];
    const p0x = (a[0] + c[0]) / 2;
    const p0y = (a[1] + c[1]) / 2;
    const p1x = (c[0] + b[0]) / 2;
    const p1y = (c[1] + b[1]) / 2;
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const u = 1 - t;
      out.push([u * u * p0x + 2 * u * t * c[0] + t * t * p1x, u * u * p0y + 2 * u * t * c[1] + t * t * p1y]);
    }
  }
  return out;
}

// A tapering strand along a quadratic curve (hood tips, scarf tails, antennae, legs).
// Half-width goes from w0 to w1, plus `bulge` in the middle.
function strand(x0, y0, cx, cy, x1, y1, w0, w1, bulge, n) {
  n = n || 12;
  bulge = bulge || 0;
  const A = [];
  const B = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
    const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
    const tx = 2 * u * (cx - x0) + 2 * t * (x1 - cx);
    const ty = 2 * u * (cy - y0) + 2 * t * (y1 - cy);
    const tl = Math.hypot(tx, ty) || 1;
    const hw = w0 + (w1 - w0) * t + bulge * Math.sin(Math.PI * t);
    A.push([x - (ty / tl) * hw, y + (tx / tl) * hw]);
    B.push([x + (ty / tl) * hw, y - (tx / tl) * hw]);
  }
  return A.concat(B.reverse());
}

function curvePts(x0, y0, cx, cy, x1, y1, n) {
  const p = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    p.push([u * u * x0 + 2 * u * t * cx + t * t * x1, u * u * y0 + 2 * u * t * cy + t * t * y1]);
  }
  return p;
}

function spiralPts(cx, cy, r0, r1, turns, start, sy) {
  const p = [];
  const n = Math.ceil(turns * 26);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * turns * TAU;
    const r = r0 + (r1 - r0) * t;
    p.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * sy]);
  }
  return p;
}


function trace(g, pts, close, dx, dy) {
  dx = dx || 0;
  dy = dy || 0;
  g.beginPath();
  g.moveTo(pts[0][0] + dx, pts[0][1] + dy);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0] + dx, pts[i][1] + dy);
  if (close !== false) g.closePath();
}

function area(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function normals(pts) {
  const n = pts.length;
  const sgn = area(pts) > 0 ? 1 : -1;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b[0] - a[0];
    const ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    out[i] = [(sgn * ty) / l, (-sgn * tx) / l];
  }
  return out;
}

function inset(pts, d) {
  const nr = normals(pts);
  return pts.map((p, i) => [p[0] - nr[i][0] * d, p[1] - nr[i][1] * d]);
}

function bbox(pts) {
  let x0 = 1e9;
  let y0 = 1e9;
  let x1 = -1e9;
  let y1 = -1e9;
  for (const p of pts) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------------------
// felt painting

let UPX = 1 / 64; // tile units per device pixel of the sprite being painted
let pieceSeed = 1;

// One felt piece: fuzzy fringe, flat fill, pillowy shading, inset running stitch.
// o: { hair, puff, stitch (thread colour or false), ins, dash, lw, seed }
function felt(g, pts, col, o) {
  o = o || NONE;
  const R = rng(o.seed || ++pieceSeed);
  const hair = o.hair === undefined ? 1 : o.hair;
  const b = bbox(pts);
  const w = b[2] - b[0];
  const h = b[3] - b[1];
  if (hair > 0) {
    const nr = normals(pts);
    g.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (R() > 0.62) continue;
      const a = (R() - 0.5) * 1.4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const nx = nr[i][0] * c - nr[i][1] * s;
      const ny = nr[i][0] * s + nr[i][1] * c;
      const L = (0.004 + R() * 0.009) * hair;
      const p = pts[i];
      g.moveTo(p[0] - nx * 0.006, p[1] - ny * 0.006);
      g.lineTo(p[0] + nx * L, p[1] + ny * L);
    }
    g.strokeStyle = tone(col, -0.05);
    g.lineWidth = Math.max(0.0045, UPX * 0.9);
    g.stroke();
  }
  trace(g, pts);
  g.fillStyle = col;
  g.fill();
  const puff = o.puff === undefined ? 1 : o.puff;
  if (puff > 0) {
    const r = Math.max(w, h) * 0.78;
    const gr = g.createRadialGradient(b[0] + w * 0.38, b[1] + h * 0.3, 0, b[0] + w * 0.45, b[1] + h * 0.42, r);
    gr.addColorStop(0, `rgba(255,248,232,${0.28 * puff})`);
    gr.addColorStop(0.5, 'rgba(255,248,232,0)');
    gr.addColorStop(1, `rgba(36,22,46,${0.34 * puff})`);
    g.fillStyle = gr;
    g.fill(); // same path as the flat fill
  }
  if (o.stitch !== false) {
    const ins = o.ins || Math.min(0.026, Math.min(w, h) * 0.17);
    stitch(g, inset(pts, ins), true, o.stitch || THREAD, o);
  }
}

// Running stitch with a little shadow so it looks sewn in.
function stitch(g, pts, close, col, o) {
  o = o || NONE;
  const lw = Math.max(o.lw || 0.011, UPX * 1.1);
  const dash = o.dash || 0.028;
  g.save();
  g.lineCap = 'round';
  g.setLineDash([dash * 0.5, dash * 0.62]);
  trace(g, pts, close, 0, lw * 0.6);
  g.strokeStyle = 'rgba(36,22,46,0.3)';
  g.lineWidth = lw * 1.25;
  g.stroke();
  trace(g, pts, close);
  g.strokeStyle = col;
  g.lineWidth = lw;
  g.stroke();
  g.restore();
}

// Knitted texture: columns of little V stitches, clipped to the piece.
function knit(g, pts, col, step, rot) {
  step = step || 0.03;
  const b = bbox(pts);
  g.save();
  trace(g, pts);
  g.clip();
  const cx = (b[0] + b[2]) / 2;
  const cy = (b[1] + b[3]) / 2;
  g.translate(cx, cy);
  if (rot) g.rotate(rot);
  const hw = (b[2] - b[0]) / 2;
  const hh = (b[3] - b[1]) / 2;
  const sr = Math.abs(Math.sin(rot || 0));
  const ex = hw + hh * sr + step;
  const ey = hh + hw * sr + step;
  g.beginPath();
  for (let y = -ey; y < ey; y += step * 0.72) {
    for (let x = -ex; x < ex; x += step) {
      g.moveTo(x - step * 0.36, y - step * 0.26);
      g.lineTo(x, y + step * 0.2);
      g.lineTo(x + step * 0.36, y - step * 0.26);
    }
  }
  g.strokeStyle = rgba(tone(col, -0.4), 0.5);
  g.lineWidth = Math.max(0.0065, UPX * 1.0);
  g.stroke();
  g.restore();
}

// Crosswise ribs on a strand (scarf tails).
function ribs(g, pts, col, a0, a1, n) {
  g.save();
  trace(g, pts);
  g.clip();
  g.beginPath();
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a0[0] + (a1[0] - a0[0]) * t;
    const y = a0[1] + (a1[1] - a0[1]) * t;
    const dx = a1[0] - a0[0];
    const dy = a1[1] - a0[1];
    const l = Math.hypot(dx, dy) || 1;
    g.moveTo(x - (dy / l) * 0.06, y + (dx / l) * 0.06);
    g.lineTo(x + (dy / l) * 0.06, y - (dx / l) * 0.06);
  }
  g.strokeStyle = rgba(tone(col, -0.4), 0.55);
  g.lineWidth = Math.max(0.007, UPX);
  g.stroke();
  g.restore();
}

// ---------------------------------------------------------------------------
// sprite cache

const MARGIN = 0.25;
const sizes = new Map(); // device-pixel tile size -> { P, map, used }
let useTick = 0;
let scaleCtx = null;
let scaleVal = 1;
let scaleTtl = 0;
let fibreTile = null;
let scratch = null;

function ctxScale(ctx) {
  if (ctx === scaleCtx && scaleTtl-- > 0) return scaleVal;
  let s = 0;
  if (typeof ctx.getTransform === 'function') {
    const m = ctx.getTransform();
    s = Math.hypot(m.a, m.b);
  }
  if (!(s > 0)) s = (typeof devicePixelRatio === 'number' && devicePixelRatio > 0 && devicePixelRatio) || 1;
  scaleCtx = ctx;
  scaleVal = s;
  scaleTtl = 40;
  return s;
}

function bucketFor(ctx, size) {
  let P = Math.round(size * ctxScale(ctx));
  P = Math.max(16, Math.min(400, P || 16));
  let b = sizes.get(P);
  if (!b) {
    b = { P, map: new Map(), used: 0 };
    sizes.set(P, b);
    if (sizes.size > 6) {
      let old = null;
      for (const c of sizes.values()) if (c !== b && (!old || c.used < old.used)) old = c;
      if (old) {
        for (const s of old.map.values()) if (s && s.c) s.c.width = s.c.height = 1;
        sizes.delete(old.P);
      }
    }
  }
  b.used = ++useTick;
  return b;
}

// A tileable patch of short felt fibres, light and dark.
function fibreSource() {
  if (fibreTile) return fibreTile;
  const n = 128;
  const c = makeCanvas(n, n);
  if (!c) return null;
  const g = c.getContext('2d');
  const R = rng(9001);
  g.lineCap = 'round';
  for (let pass = 0; pass < 2; pass++) {
    g.strokeStyle = pass ? 'rgba(255,249,232,0.55)' : 'rgba(36,22,46,0.5)';
    g.lineWidth = pass ? 0.8 : 0.9;
    g.beginPath();
    for (let i = 0; i < 520; i++) {
      const x = R() * n;
      const y = R() * n;
      const a = R() * TAU;
      const l = 2 + R() * 5;
      const bx = x + Math.cos(a) * l;
      const by = y + Math.sin(a) * l;
      for (const ox of [-n, 0, n]) {
        for (const oy of [-n, 0, n]) {
          if (ox && (bx + ox < -6 || bx + ox > n + 6) && (x + ox < -6 || x + ox > n + 6)) continue;
          if (oy && (by + oy < -6 || by + oy > n + 6) && (y + oy < -6 || y + oy > n + 6)) continue;
          g.moveTo(x + ox, y + oy);
          g.quadraticCurveTo(x + ox + Math.cos(a + 0.6) * l * 0.5, y + oy + Math.sin(a + 0.6) * l * 0.5, bx + ox, by + oy);
        }
      }
    }
    g.stroke();
  }
  fibreTile = c;
  return c;
}

function stampFibres(g, side, P, seed) {
  const src = fibreSource();
  if (!src) return;
  const n = Math.max(40, P * 0.8);
  const R = rng(seed);
  const ox = -R() * n;
  const oy = -R() * n;
  g.save();
  g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = 0.26;
  for (let y = oy; y < side; y += n) for (let x = ox; x < side; x += n) g.drawImage(src, x, y, n, n);
  g.restore();
}

// A soft dark rim around the whole figure (so it reads on any floor, lit or dark).
function outline(g, c, side, P) {
  if (!scratch || scratch.width < side || scratch.height < side) scratch = makeCanvas(Math.max(side, 64), Math.max(side, 64));
  if (!scratch) return;
  const sg = scratch.getContext('2d');
  sg.setTransform(1, 0, 0, 1, 0, 0);
  sg.globalCompositeOperation = 'source-over';
  sg.clearRect(0, 0, scratch.width, scratch.height);
  sg.drawImage(c, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = OUTLINE;
  sg.fillRect(0, 0, side, side);
  sg.globalCompositeOperation = 'source-over';
  g.save();
  g.globalCompositeOperation = 'destination-over';
  // four diagonal offsets and one downward give a soft, slightly bottom-heavy rim in five blits
  const r = Math.max(1, P * 0.018);
  const q = r * 0.85;
  for (const [dx, dy] of [[-q, -q * 0.6], [q, -q * 0.6], [-q, q * 1.1], [q, q * 1.1], [0, r * 1.4]]) g.drawImage(scratch, 0, 0, side, side, dx, dy, side, side);
  g.restore();
}

// A soft contact shadow painted underneath the finished figure: [cx, cy, rx, ry, alpha] in tile units.
function bakeShadow(g, P, mp, sh) {
  g.save();
  g.setTransform(P, 0, 0, P, mp, mp);
  g.globalCompositeOperation = 'destination-over';
  g.translate(sh[0], sh[1]);
  g.scale(1, sh[3] / sh[2]);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, sh[2]);
  gr.addColorStop(0, `rgba(24,14,32,${0.85 * sh[4]})`);
  gr.addColorStop(0.55, `rgba(24,14,32,${0.5 * sh[4]})`);
  gr.addColorStop(1, 'rgba(24,14,32,0)');
  g.fillStyle = gr;
  g.fillRect(-sh[2], -sh[2], sh[2] * 2, sh[2] * 2);
  g.restore();
}

function hashKey(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return h >>> 0;
}

function make(b, key, painter, opts) {
  const P = b.P;
  const mp = Math.round(P * MARGIN);
  const side = P + 2 * mp;
  const c = makeCanvas(side, side);
  if (!c) {
    b.map.set(key, null);
    return null;
  }
  const g = c.getContext('2d');
  UPX = 1 / P;
  pieceSeed = hashKey(key) & 0xffff;
  g.setTransform(P, 0, 0, P, mp, mp);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  painter(g);
  g.setTransform(1, 0, 0, 1, 0, 0);
  stampFibres(g, side, P, hashKey(key));
  if (!opts || opts.outline !== false) outline(g, c, side, P);
  if (opts && opts.shadow) bakeShadow(g, P, mp, opts.shadow);
  const s = { c, m: mp / P, k: side / P };
  b.map.set(key, s);
  return s;
}

// Blit with an optional squash (sx, sy) about an anchor (ax, ay) in tile units, and a vertical offset.
// (No transform state changes: in a software canvas those cost as much as the blit itself.)
function blit(ctx, s, px, py, size, ax, ay, sx, sy, dy) {
  const k = size * s.k;
  const m = s.m;
  const X = px + ax * size;
  const Y = py + ay * size + dy;
  ctx.drawImage(s.c, X - (ax + m) * size * sx, Y - (ay + m) * size * sy, k * sx, k * sy);
}

let shadowTile = null;
let glowTile = null;
function radialTile(stops) {
  const n = 96;
  const c = makeCanvas(n, n);
  if (!c) return null;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  for (let i = 0; i < stops.length; i += 2) gr.addColorStop(stops[i], stops[i + 1]);
  g.fillStyle = gr;
  g.fillRect(0, 0, n, n);
  return c;
}
function drawShadow(ctx, cx, cy, rx, ry, al) {
  if (!shadowTile) shadowTile = radialTile([0, 'rgba(24,14,32,0.85)', 0.55, 'rgba(24,14,32,0.5)', 1, 'rgba(24,14,32,0)']);
  if (!shadowTile) return;
  const a = ctx.globalAlpha;
  ctx.globalAlpha = a * al;
  ctx.drawImage(shadowTile, cx - rx, cy - ry, rx * 2, ry * 2);
  ctx.globalAlpha = a;
}
function drawGlow(ctx, cx, cy, d, al) {
  if (!glowTile) glowTile = radialTile([0, 'rgba(255,214,130,0.9)', 0.35, 'rgba(250,180,84,0.42)', 1, 'rgba(242,176,76,0)']);
  if (!glowTile) return;
  const a = ctx.globalAlpha;
  const op = ctx.globalCompositeOperation;
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a * al;
  ctx.drawImage(glowTile, cx - d / 2, cy - d / 2, d, d);
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = op;
}

function frameOf(t, period, n) {
  const f = Math.floor((((t / period) % 1) + 1) % 1 * n);
  return f >= n ? 0 : f;
}
function flicker(t) {
  return 0.5 + 0.28 * Math.sin(t * 9.1) + 0.22 * Math.sin(t * 14.3 + 1.7);
}
const DIRS = { N: 0, E: 1, S: 2, W: 3 };
function dirIndex(d) {
  const i = DIRS[d];
  return i === undefined ? 2 : i;
}

// ---------------------------------------------------------------------------
// the lantern

function flamePts(cx, by, w, h) {
  return smooth([[cx, by - h], [cx, by - h], [cx + w * 0.55, by - h * 0.5], [cx + w, by - h * 0.12], [cx + w * 0.5, by + w * 0.2], [cx - w * 0.5, by + w * 0.2], [cx - w, by - h * 0.12], [cx - w * 0.55, by - h * 0.5]], 6);
}

// A felt lantern: ring handle, cap, glowing glass with a felt flame, base. `top` is the top of the ring.
function paintLantern(g, cx, top, h, flame, out) {
  const w = h * 0.58;
  g.beginPath();
  g.ellipse(cx, top + h * 0.1, h * 0.085, h * 0.085, 0, 0, TAU);
  g.strokeStyle = BROWN_DK;
  g.lineWidth = h * 0.065;
  g.stroke();
  const glass = oval(cx, top + h * 0.6, w * 0.4, h * 0.27, { sq: 3.4, wob: 0.015, seed: 11 });
  if (out) {
    felt(g, glass, '#4A3C5A', { stitch: false, hair: 0.4, puff: 0.7 });
    // a cold wick and a little stitched curl of smoke where the flame was
    g.beginPath();
    g.moveTo(cx, top + h * 0.8);
    g.lineTo(cx, top + h * 0.68);
    g.strokeStyle = INK;
    g.lineWidth = h * 0.04;
    g.stroke();
    stitch(g, curvePts(cx, top + h * 0.66, cx + h * 0.14, top + h * 0.55, cx - h * 0.02, top + h * 0.42, 8), false, 'rgba(244,234,213,0.6)', { lw: h * 0.035, dash: h * 0.08 });
  } else {
    felt(g, glass, '#FFE6A2', { stitch: false, hair: 0.4, puff: 0 });
    const gr = g.createRadialGradient(cx, top + h * 0.66, 0, cx, top + h * 0.62, h * 0.3);
    gr.addColorStop(0, '#FFF8DE');
    gr.addColorStop(0.6, 'rgba(255,230,160,0.4)');
    gr.addColorStop(1, 'rgba(242,160,60,0.65)');
    g.fillStyle = gr;
    g.fill(); // the glass path is still current
    const fx = cx + [0, -0.016, 0.016, 0.006][flame] * h;
    const fh = [1, 1.1, 0.9, 1.05][flame];
    felt(g, flamePts(fx, top + h * 0.79, h * 0.12, h * 0.31 * fh), '#F2862E', { stitch: false, hair: 0.3, puff: 0.3, seed: 31 });
    felt(g, flamePts((fx + cx) / 2, top + h * 0.78, h * 0.06, h * 0.16 * fh), '#FFF4D6', { stitch: false, hair: 0, puff: 0 });
  }
  for (const sx of [-1, 1]) {
    const bar = strand(cx + sx * w * 0.2, top + h * 0.34, cx + sx * w * 0.24, top + h * 0.6, cx + sx * w * 0.22, top + h * 0.86, h * 0.028, h * 0.028, 0, 6);
    felt(g, bar, BROWN, { stitch: false, hair: 0, puff: 0.4 });
  }
  felt(g, oval(cx, top + h * 0.27, w * 0.5, h * 0.09, { sq: 3, seed: 12 }), BROWN, { ins: h * 0.04, lw: Math.max(0.008, h * 0.025), dash: h * 0.07 });
  felt(g, oval(cx, top + h * 0.9, w * 0.52, h * 0.08, { sq: 3, seed: 13 }), BROWN_DK, { ins: h * 0.035, lw: Math.max(0.008, h * 0.025), dash: h * 0.07 });
}

// ---------------------------------------------------------------------------
// Wren: a round felt doll in a pointed amber hood, a teal knitted scarf wrapped up over where a face
// would be, mittens and boots. Facing shows through the hood tip (it flops away from the way she walks),
// the scarf tail, the lantern side and the boots.

function mitten(g, cx, cy, s, thumb, seed) {
  const th = oval(cx + thumb * 0.038 * s, cy - 0.016 * s, 0.022 * s, 0.027 * s, { seed: seed + 1, rot: thumb * 0.5 });
  felt(g, th, TEAL_DK, { stitch: false, hair: 0.6, puff: 0.5 });
  felt(g, oval(cx, cy, 0.05 * s, 0.056 * s, { sq: 2.3, wob: 0.04, seed }), TEAL, { stitch: false, hair: 0.7 });
  // knitted cuff
  felt(g, oval(cx, cy - 0.046 * s, 0.046 * s, 0.018 * s, { seed: seed + 2 }), TEAL_DK, { stitch: false, hair: 0.4, puff: 0.3 });
}

function pompom(g, x, y, r) {
  felt(g, oval(x, y, r, r * 0.95, { wob: 0.12, seed: 41 }), CREAM, { stitch: false, hair: 2.2, puff: 0.8 });
}

function hoodCone(g, L, R, T, C1, C2, col) {
  const a = curvePts(L[0], L[1], C1[0], C1[1], T[0], T[1], 10);
  const b = curvePts(T[0], T[1], C2[0], C2[1], R[0], R[1], 10);
  const mid = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2 + 0.05];
  const pts = a.concat(b.slice(1), [mid]);
  felt(g, pts, col, { stitch: false, hair: 0.9 });
  // a seam stitched up the middle of the cone
  const m0 = [(L[0] + R[0]) / 2, (L[1] + R[1]) / 2];
  const cm = [(C1[0] + C2[0]) / 2, (C1[1] + C2[1]) / 2];
  stitch(g, curvePts(m0[0], m0[1], cm[0], cm[1], T[0], T[1], 10).slice(1, 9), false, THREAD);
}

function coat(g, ctrl, seed) {
  const pts = smooth(ctrl, 8);
  felt(g, pts, AMBER, { seed, ins: 0.028 });
  return pts;
}

function patch(g, x, y, r, rot, col) {
  const p = oval(x, y, r, r * 0.9, { sq: 3.6, wob: 0.03, rot, seed: 51 });
  felt(g, p, col, { stitch: false, hair: 0.4, puff: 0.5 });
  stitch(g, inset(p, Math.max(0.008, r * 0.18)), true, THREAD, { dash: 0.02, lw: 0.009 });
}

function scarfRoll(g, cx, cy, rx, ry, col, seed, rot) {
  const p = oval(cx, cy, rx, ry, { wob: 0.05, seed, rot });
  felt(g, p, col, { stitch: false, hair: 1.1 });
  knit(g, p, col, 0.03, rot);
  return p;
}

function scarfTail(g, x0, y0, cx, cy, x1, y1, w, seed) {
  const p = strand(x0, y0, cx, cy, x1, y1, w, w * 0.85, w * 0.12, 10);
  felt(g, p, TEAL, { stitch: false, hair: 0.9, seed });
  ribs(g, p, TEAL, [x0, y0], [x1, y1], 6);
  // fringe
  const dx = x1 - cx;
  const dy = y1 - cy;
  const l = Math.hypot(dx, dy) || 1;
  g.beginPath();
  for (let i = -2; i <= 2; i++) {
    const ox = (-dy / l) * w * 0.4 * i;
    const oy = (dx / l) * w * 0.4 * i;
    g.moveTo(x1 + ox, y1 + oy);
    g.lineTo(x1 + ox + (dx / l) * 0.035, y1 + oy + (dy / l) * 0.035);
  }
  g.strokeStyle = TEAL_DK;
  g.lineWidth = Math.max(0.009, UPX * 1.2);
  g.stroke();
}

function boot(g, cx, cy, rx, ry, rot, seed) {
  felt(g, oval(cx, cy, rx, ry, { sq: 2.4, seed, rot }), BOOT, { stitch: false, hair: 0.6 });
}

// lantern glass centre per facing (for the additive glow), in tile units
const W_GLOW = [[0.8, 0.55], [0.83, 0.745], [0.785, 0.745], [0.17, 0.745]];
const LANT_H = 0.34;

function paintWren(g, d, state, ph) {
  const carry = state !== 1;
  const out = state === 2;
  if (d === 3) {
    g.translate(1, 0);
    g.scale(-1, 1);
    d = 1;
  }
  if (out) {
    // hunched and tucked: the lantern has gone dark
    g.translate(0.5, 0.88);
    g.scale(1.06, 0.9);
    g.translate(-0.5, -0.88);
  }
  const s1 = Math.sin(ph);
  const s2 = Math.sin(ph + 1.2);
  const s3 = Math.sin(ph + 2.4);
  const fl = Math.floor((ph / TAU) * 12) % 4;
  if (d === 2) wrenS(g, carry, out, s1, s2, s3, fl);
  else if (d === 0) wrenN(g, carry, out, s1, s2, s3, fl);
  else wrenE(g, carry, out, s1, s2, s3, fl);
}

function wrenS(g, carry, out, s1, s2, s3, fl) {
  // hood tip flops back (up the screen), away from the viewer
  const T = out ? [0.75, 0.2 + s2 * 0.004] : [0.64 + s2 * 0.014, 0.035];
  hoodCone(g, [0.4, 0.25], [0.6, 0.23], T, out ? [0.5, 0.08] : [0.48, 0.08], out ? [0.66, 0.13] : [0.62, 0.12], AMBER);
  pompom(g, T[0], T[1], 0.045);
  boot(g, 0.405, 0.852, 0.072, 0.05, 0.1, 61);
  boot(g, 0.595, 0.852, 0.072, 0.05, -0.1, 62);
  coat(g, [[0.5, 0.43], [0.67, 0.47], [0.75, 0.71], [0.72, 0.86], [0.5, 0.885], [0.28, 0.86], [0.25, 0.71], [0.33, 0.47]], 63);
  patch(g, 0.4, 0.74, 0.048, 0.25, ROSE);
  mitten(g, 0.265, 0.7 + s1 * 0.006, 1, 1, 70);
  // head in the hood, scarf wound up over the front
  felt(g, oval(0.5, 0.29, 0.19, 0.155, { seed: 64 }), AMBER, { stitch: false });
  felt(g, oval(0.5, 0.345, 0.165, 0.05, { seed: 65, wob: 0.03 }), AMBER_LT, { stitch: THREAD_DK, ins: 0.018, puff: 0.6 });
  scarfRoll(g, 0.5, 0.475, 0.205, 0.068, TEAL, 66, 0);
  scarfRoll(g, 0.5, 0.405, 0.19, 0.062, tone(TEAL, 0.1), 67, 0);
  scarfTail(g, 0.39, 0.46, 0.37 + s3 * 0.01, 0.56, 0.36 + s1 * 0.016, 0.66, 0.034, 68);
  if (carry) {
    paintLantern(g, 0.785, 0.53 + s2 * 0.004, LANT_H, fl, out);
    mitten(g, 0.775, 0.555, 1, -1, 72);
  } else {
    mitten(g, 0.735, 0.7 - s1 * 0.006, 1, -1, 72);
  }
}

function wrenN(g, carry, out, s1, s2, s3, fl) {
  // walking away: lantern held out in front (up the screen, partly behind her)
  if (carry) {
    paintLantern(g, 0.8, 0.33 + s2 * 0.004, LANT_H, fl, out);
    mitten(g, 0.785, 0.36, 1, -1, 72);
  }
  boot(g, 0.41, 0.858, 0.064, 0.042, 0, 61);
  boot(g, 0.59, 0.858, 0.064, 0.042, 0, 62);
  coat(g, [[0.5, 0.42], [0.67, 0.46], [0.75, 0.7], [0.72, 0.855], [0.5, 0.88], [0.28, 0.855], [0.25, 0.7], [0.33, 0.46]], 63);
  stitch(g, [[0.5, 0.52], [0.5, 0.85]], false, THREAD);
  patch(g, 0.62, 0.76, 0.045, -0.3, ROSE);
  mitten(g, 0.265, 0.69 + s1 * 0.006, 1, 1, 70);
  if (!carry) mitten(g, 0.735, 0.69 - s1 * 0.006, 1, -1, 71);
  scarfRoll(g, 0.5, 0.455, 0.2, 0.062, TEAL, 66, 0);
  // scarf tails down the back
  scarfTail(g, 0.55, 0.46, 0.56 + s3 * 0.01, 0.56, 0.54 + s1 * 0.016, 0.67, 0.032, 68);
  scarfTail(g, 0.58, 0.46, 0.62 + s3 * 0.01, 0.54, 0.63 + s1 * 0.012, 0.63, 0.03, 69);
  // back of the hood, the tip lying down over it toward us
  felt(g, oval(0.5, 0.3, 0.195, 0.168, { seed: 64 }), AMBER, { stitch: false });
  stitch(g, curvePts(0.5, 0.15, 0.49, 0.3, 0.5, 0.42, 8), false, THREAD);
  const T = out ? [0.33, 0.56] : [0.35 + s2 * 0.012, 0.57];
  hoodCone(g, [0.43, 0.19], [0.59, 0.21], T, [0.34, 0.3], [0.48, 0.4], tone(AMBER, -0.12));
  pompom(g, T[0], T[1], 0.045);
}

function wrenE(g, carry, out, s1, s2, s3, fl) {
  // seen from the side, walking right: hood tip and scarf tail stream back to the left
  if (!carry) mitten(g, 0.35, 0.68 - s1 * 0.008, 0.9, 1, 71);
  boot(g, 0.42, 0.848, 0.066, 0.042, 0, 61);
  const T = out ? [0.22, 0.44] : [0.2 + s2 * 0.012, 0.37 + s2 * 0.008];
  hoodCone(g, [0.43, 0.27], [0.53, 0.16], T, out ? [0.33, 0.3] : [0.32, 0.24], out ? [0.3, 0.12] : [0.28, 0.05], AMBER);
  coat(g, [[0.53, 0.43], [0.67, 0.48], [0.74, 0.71], [0.71, 0.86], [0.5, 0.885], [0.31, 0.86], [0.28, 0.7], [0.38, 0.47]], 63);
  patch(g, 0.44, 0.73, 0.046, 0.2, ROSE);
  boot(g, 0.61, 0.856, 0.088, 0.05, 0.05, 62);
  scarfTail(g, 0.4, 0.47, 0.3 + s3 * 0.01, 0.5, 0.18 + s1 * 0.02, 0.585 + s1 * 0.01, 0.034, 68);
  felt(g, oval(0.55, 0.3, 0.175, 0.155, { seed: 64 }), AMBER, { stitch: false });
  stitch(g, curvePts(0.6, 0.16, 0.7, 0.26, 0.66, 0.4, 8), false, THREAD);
  pompom(g, T[0], T[1], 0.045);
  // scarf wound up high over the front
  scarfRoll(g, 0.55, 0.465, 0.19, 0.066, TEAL, 66, 0);
  scarfRoll(g, 0.65, 0.41, 0.09, 0.075, tone(TEAL, 0.1), 67, 0.25);
  if (carry) {
    paintLantern(g, 0.83, 0.53 + s2 * 0.004, LANT_H, fl, out);
    mitten(g, 0.8, 0.555, 1, -1, 72);
  } else {
    mitten(g, 0.67, 0.69 + s1 * 0.008, 1, -1, 72);
  }
}

// ---------------------------------------------------------------------------
// Fluffmoth: a fluffy pom of a moth. Lit: wings spread wide, body perked up, hovering.
// Dark: wings folded down like a cloak, body tucked, sitting on the ground.

const FORE = [[0.02, -0.03], [0.14, -0.18], [0.33, -0.22], [0.44, -0.15], [0.43, -0.03], [0.3, 0.05], [0.12, 0.07], [0.03, 0.04]];
const HIND = [[0.02, -0.02], [0.18, -0.03], [0.31, 0.05], [0.31, 0.17], [0.2, 0.24], [0.08, 0.2], [0.02, 0.1]];
const FOLD = [[0.01, -0.04], [0.1, -0.03], [0.18, 0.1], [0.21, 0.26], [0.13, 0.32], [0.04, 0.28], [0.0, 0.12]];

function wing(g, ox, oy, rel, sx, sy, col, veins) {
  const pts = smooth(rel.map((p) => [ox + p[0] * sx, oy + p[1] * sy]), 7);
  felt(g, pts, col, { ins: 0.024 });
  if (veins) {
    for (const v of veins) stitch(g, curvePts(ox + v[0] * sx, oy + v[1] * sy, ox + v[2] * sx, oy + v[3] * sy, ox + v[4] * sx, oy + v[5] * sy, 8), false, rgba(CREAM, 0.85), { dash: 0.024 });
  }
}

function antenna(g, x0, y0, cx, cy, x1, y1) {
  const c = curvePts(x0, y0, cx, cy, x1, y1, 10);
  g.beginPath();
  trace(g, c, false);
  for (let i = 2; i < c.length; i++) {
    const a = c[i - 1];
    const p = c[i];
    const dx = p[0] - a[0];
    const dy = p[1] - a[1];
    const l = Math.hypot(dx, dy) || 1;
    const bl = 0.03 * (1 - i / (c.length + 1));
    for (const sd of [-1, 1]) {
      g.moveTo(p[0], p[1]);
      g.lineTo(p[0] + (-dy / l) * bl * sd - (dx / l) * bl * 0.5, p[1] + (dx / l) * bl * sd - (dy / l) * bl * 0.5);
    }
  }
  g.strokeStyle = tone(ROSE, -0.4);
  g.lineWidth = Math.max(0.009, UPX * 1.2);
  g.stroke();
}

function fluffBody(g, cx, cy, rx, ry) {
  const p = oval(cx, cy, rx, ry, { wob: 0.06, seed: 81 });
  felt(g, p, '#EEDFC8', { stitch: false, hair: 1.8 });
  // two appliqué stripes across the abdomen
  g.save();
  trace(g, p);
  g.clip();
  for (const k of [0.15, 0.5]) {
    const y = cy + ry * k;
    const band = oval(cx, y, rx * 1.2, ry * 0.12, { wob: 0.04, seed: 82 + k * 10 });
    felt(g, band, ROSE, { stitch: false, hair: 0, puff: 0.3 });
  }
  g.restore();
}

function ruff(g, cx, cy, r) {
  felt(g, oval(cx, cy, r, r * 0.85, { wob: 0.14, seed: 83, n: 52 }), CREAM, { stitch: false, hair: 2.6, puff: 0.7 });
}

function paintMoth(g, lit, ph) {
  if (lit) {
    const o = 0.74 + 0.26 * Math.cos(ph);
    const lift = 0.02 * Math.sin(ph);
    antenna(g, 0.48, 0.36, 0.43, 0.22, 0.31, 0.15 - lift);
    antenna(g, 0.52, 0.36, 0.57, 0.22, 0.69, 0.15 - lift);
    const hv = [[0.03, 0.02, 0.15, 0.06, 0.25, 0.16]];
    wing(g, 0.48, 0.5, HIND, -o, 1, ROSE_LT_W, hv);
    wing(g, 0.52, 0.5, HIND, o, 1, ROSE_LT_W, hv);
    const fv = [[0.03, -0.01, 0.2, -0.08, 0.38, -0.12], [0.03, 0.01, 0.2, 0.0, 0.34, 0.01]];
    wing(g, 0.48, 0.44, FORE, -o, 1, ROSE, fv);
    wing(g, 0.52, 0.44, FORE, o, 1, ROSE, fv);
    fluffBody(g, 0.5, 0.57, 0.07, 0.145);
    ruff(g, 0.5, 0.415, 0.088);
  } else {
    const o = 1 + 0.05 * Math.sin(ph);
    fluffBody(g, 0.5, 0.66, 0.075, 0.1);
    const fv = [[0.04, 0.0, 0.1, 0.12, 0.12, 0.26]];
    wing(g, 0.49, 0.5, FOLD, -o, 1, ROSE, fv);
    wing(g, 0.51, 0.5, FOLD, o, 1, ROSE, fv);
    // antennae swept back flat over the folded wings
    antenna(g, 0.47, 0.47, 0.4, 0.5, 0.36, 0.62);
    antenna(g, 0.53, 0.47, 0.6, 0.5, 0.64, 0.62);
    ruff(g, 0.5, 0.49, 0.08);
  }
}
const ROSE_LT_W = '#E2A6B0';

// The moth settled flat on a puddle as a little quilted mat you can step on.
function paintBridgeMoth(g) {
  const quilt = (pts, col) => {
    felt(g, pts, col, { puff: 0.35, ins: 0.026 });
    const b = bbox(pts);
    g.save();
    trace(g, inset(pts, 0.04));
    g.clip();
    const lines = [];
    for (let k = -1.2; k < 1.2; k += 0.11) {
      lines.push([[b[0] + k, b[1]], [b[0] + k + 1, b[1] + 1]]);
      lines.push([[b[0] + k, b[3]], [b[0] + k + 1, b[3] - 1]]);
    }
    for (const l of lines) stitch(g, l, false, rgba(CREAM, 0.7), { dash: 0.026, lw: 0.009 });
    g.restore();
  };
  const fore = (sx) => smooth([[0.03, -0.04], [0.2, -0.3], [0.42, -0.31], [0.49, -0.18], [0.47, 0.02], [0.3, 0.07], [0.05, 0.05]].map((p) => [0.5 + p[0] * sx, 0.46 + p[1]]), 7);
  const hind = (sx) => smooth([[0.03, 0.0], [0.25, 0.02], [0.41, 0.12], [0.4, 0.28], [0.27, 0.36], [0.1, 0.3], [0.03, 0.14]].map((p) => [0.5 + p[0] * sx, 0.5 + p[1]]), 7);
  quilt(hind(-1), ROSE_LT_W);
  quilt(hind(1), ROSE_LT_W);
  quilt(fore(-1), ROSE);
  quilt(fore(1), ROSE);
  antenna(g, 0.48, 0.3, 0.44, 0.2, 0.39, 0.13);
  antenna(g, 0.52, 0.3, 0.56, 0.2, 0.61, 0.13);
  const body = oval(0.5, 0.52, 0.06, 0.2, { wob: 0.05, seed: 91 });
  felt(g, body, '#EEDFC8', { stitch: false, hair: 1.2, puff: 0.4 });
  stitch(g, [[0.5, 0.4], [0.5, 0.68]], false, ROSE, { dash: 0.026 });
  ruff(g, 0.5, 0.33, 0.07);
}

// ---------------------------------------------------------------------------
// Shellwhelk: out = a soft felt body sliding out of a stitched spiral shell (no stalks).
// Hidden = the shell sealed with a felt lid patch, squat and heavy on a flat weighted base.

function shellSpiral(g, cx, cy, r, sy, start) {
  const sp = spiralPts(cx, cy, r * 0.12, r * 0.86, 2.1, start, sy);
  g.save();
  g.beginPath();
  trace(g, sp, false);
  g.strokeStyle = tone(ROSE, 0.32);
  g.lineWidth = r * 0.2;
  g.stroke();
  g.restore();
  stitch(g, sp, false, THREAD, { lw: 0.012, dash: 0.026 });
}

function paintWhelkHidden(g) {
  const base = 0.86;
  const sh = oval(0.5, 0.62, 0.31, 0.25, { sq: 2.3, wob: 0.03, seed: 101, flat: 0.235, n: 56 });
  felt(g, sh, tone(ROSE, -0.08), { ins: 0.03 });
  // weighted base band
  g.save();
  trace(g, sh);
  g.clip();
  const band = oval(0.5, base + 0.01, 0.4, 0.075, { seed: 102, wob: 0.02 });
  felt(g, band, tone(ROSE, -0.38), { stitch: false, hair: 0, puff: 0.5 });
  stitch(g, curvePts(0.22, base - 0.04, 0.5, base - 0.07, 0.78, base - 0.04, 12), false, THREAD, { dash: 0.026 });
  g.restore();
  shellSpiral(g, 0.46, 0.57, 0.2, 0.85, 0.4);
  // the lid patch sealing the opening, darned on with radial stitches
  const lid = oval(0.73, 0.73, 0.085, 0.075, { sq: 2.8, rot: -0.3, seed: 103, wob: 0.06 });
  felt(g, lid, LID, { stitch: false, hair: 0.6, puff: 0.6 });
  g.beginPath();
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * TAU + 0.3;
    g.moveTo(0.73 + Math.cos(a) * 0.055, 0.73 + Math.sin(a) * 0.05);
    g.lineTo(0.73 + Math.cos(a) * 0.094, 0.73 + Math.sin(a) * 0.086);
  }
  g.strokeStyle = THREAD;
  g.lineWidth = Math.max(0.009, UPX * 1.1);
  g.stroke();
}

// The out whelk is two cached layers, animated with a continuous inchworm stretch at blit time.
function paintWhelkFoot(g) {
  // a flat creeping foot along the ground that rises at the front into a soft rounded head
  const body = smooth([
    [0.13, 0.88], [0.15, 0.8], [0.4, 0.765], [0.64, 0.75], [0.68, 0.6],
    [0.75, 0.47], [0.86, 0.45], [0.95, 0.55], [0.93, 0.7],
    [0.89, 0.8], [0.94, 0.875], [0.6, 0.885], [0.24, 0.885],
  ], 7);
  felt(g, body, PEACH, { ins: 0.024, stitch: tone(ROSE, -0.1) });
  // a stitched collar where the head rises from the foot, and ripples along the sole
  stitch(g, curvePts(0.69, 0.69, 0.8, 0.74, 0.91, 0.7, 8), false, tone(ROSE, -0.1));
  g.beginPath();
  for (const x of [0.3, 0.45, 0.6]) {
    g.moveTo(x - 0.022, 0.865);
    g.quadraticCurveTo(x, 0.835, x + 0.022, 0.865);
  }
  g.strokeStyle = rgba(tone(PEACH, -0.35), 0.6);
  g.lineWidth = Math.max(0.008, UPX);
  g.stroke();
}

function paintWhelkShell(g) {
  // the shell, lifted and tipped forward
  const sh = oval(0.4, 0.5, 0.245, 0.235, { rot: -0.2, wob: 0.03, seed: 104, n: 56 });
  felt(g, sh, ROSE, { ins: 0.03 });
  shellSpiral(g, 0.38, 0.48, 0.2, 0.92, 0.9);
  // the shell's lip where the body comes out
  g.beginPath();
  trace(g, curvePts(0.5, 0.7, 0.62, 0.68, 0.64, 0.56, 8), false);
  g.strokeStyle = tone(ROSE, -0.35);
  g.lineWidth = 0.03;
  g.stroke();
}

// ---------------------------------------------------------------------------
// Stumpcap: a blocky felt mushroom golem. Facing: the cap's peak overhangs that way, an appliqué chevron
// on the cap points that way, the feet point that way and the stitched gills are on that side.
// Asleep: squat, cap pulled low and drooping, legs tucked. Awake: tall, legs out mid-stride.

const CAP_COL = '#CD7C8C';

function chevron(g, cx, cy, ang, s) {
  const c = Math.cos(ang);
  const si = Math.sin(ang);
  const P = (x, y) => [cx + x * c - y * si, cy + x * si + y * c];
  const pts = smooth([P(0.07 * s, 0), P(0.07 * s, 0), P(-0.04 * s, 0.085 * s), P(-0.085 * s, 0.07 * s), P(-0.01 * s, 0), P(-0.085 * s, -0.07 * s), P(-0.04 * s, -0.085 * s)], 5);
  felt(g, pts, CREAM, { stitch: false, hair: 0.5, puff: 0.5 });
  stitch(g, inset(pts, 0.012), true, tone(ROSE, -0.2), { lw: 0.008, dash: 0.018 });
}

// The underside of the cap on the facing side: a darker band with stitched gills fanning out from the stem.
function capUnder(g, ctrl, fx, fy, a0, a1) {
  const pts = smooth(ctrl, 6);
  felt(g, pts, tone(ROSE, -0.3), { stitch: false, hair: 0.5, puff: 0.4 });
  g.save();
  trace(g, pts);
  g.clip();
  g.beginPath();
  for (let i = 0; i <= 14; i++) {
    const a = a0 + ((a1 - a0) * i) / 14;
    g.moveTo(fx + Math.cos(a) * 0.04, fy + Math.sin(a) * 0.04);
    g.lineTo(fx + Math.cos(a) * 0.6, fy + Math.sin(a) * 0.6);
  }
  g.strokeStyle = rgba(tone(ROSE, 0.4), 0.85);
  g.lineWidth = Math.max(0.009, UPX * 1.1);
  g.stroke();
  g.restore();
}

function stumpFoot(g, cx, cy, rx, ry, seed) {
  felt(g, oval(cx, cy, rx, ry, { sq: 3, seed, wob: 0.04 }), BARK, { stitch: false, hair: 0.6 });
}

function leg(g, x, y0, y1, w) {
  felt(g, oval(x, (y0 + y1) / 2, w, (y1 - y0) / 2 + 0.01, { sq: 4, seed: 111, wob: 0.02 }), tone(BARK, -0.1), { stitch: false, hair: 0.4, puff: 0.6 });
}

function stumpBody(g, cx, cy, rx, ry, seed) {
  const p = oval(cx, cy, rx, ry, { sq: 4.2, wob: 0.025, seed });
  felt(g, p, STUMP, { stitch: tone(BARK, -0.25), ins: 0.026 });
  return p;
}

function paintStump(g, d, awake, ph) {
  if (d === 3) {
    g.translate(1, 0);
    g.scale(-1, 1);
    d = 1;
  }
  const st = awake ? Math.sin(ph) : 0;
  const bob = awake ? 0.012 * Math.abs(Math.cos(ph)) : 0;
  if (d === 1) {
    // side view, facing right
    if (awake) {
      const fb = [0.4 - st * 0.07, 0.855 - Math.max(0, -st) * 0.035];
      const ff = [0.56 + st * 0.07, 0.855 - Math.max(0, st) * 0.035];
      leg(g, fb[0], 0.7, fb[1], 0.042);
      stumpFoot(g, fb[0] + 0.025, fb[1], 0.075, 0.042, 112);
      leg(g, ff[0], 0.7, ff[1], 0.042);
      stumpFoot(g, ff[0] + 0.025, ff[1], 0.075, 0.042, 113);
      g.translate(0.03, -bob);
      stumpBody(g, 0.47, 0.565, 0.165, 0.165, 114);
      felt(g, oval(0.4, 0.62, 0.05, 0.06, { sq: 3, rot: 0.3, seed: 115 }), BARK, { stitch: false, hair: 0.4, puff: 0.5 });
      stumpCapE(g, 0.0, 0);
    } else {
      stumpFoot(g, 0.55, 0.862, 0.06, 0.026, 113);
      stumpFoot(g, 0.4, 0.862, 0.05, 0.024, 112);
      stumpBody(g, 0.49, 0.71, 0.18, 0.135, 114);
      g.translate(0.5, 0.55);
      g.rotate(0.07);
      g.translate(-0.5, -0.55);
      stumpCapE(g, 0.14, 0.15);
    }
    return;
  }
  const S = d === 2;
  if (awake) {
    const ya = 0.86 - Math.max(0, st) * 0.04;
    const yb = 0.86 - Math.max(0, -st) * 0.04;
    leg(g, 0.4, 0.72, ya - 0.02, 0.045);
    leg(g, 0.6, 0.72, yb - 0.02, 0.045);
    if (S) {
      stumpFoot(g, 0.4, ya, 0.07, 0.055 - Math.max(0, st) * 0.012, 112);
      stumpFoot(g, 0.6, yb, 0.07, 0.055 - Math.max(0, -st) * 0.012, 113);
      stitch(g, curvePts(0.35, ya + 0.02, 0.4, ya + 0.045, 0.45, ya + 0.02, 6), false, THREAD_DK, { lw: 0.009, dash: 0.018 });
      stitch(g, curvePts(0.55, yb + 0.02, 0.6, yb + 0.045, 0.65, yb + 0.02, 6), false, THREAD_DK, { lw: 0.009, dash: 0.018 });
    } else {
      stumpFoot(g, 0.4, ya, 0.06, 0.04, 112);
      stumpFoot(g, 0.6, yb, 0.06, 0.04, 113);
    }
    g.translate(0, -bob);
    stumpBody(g, 0.5, 0.58, 0.19, 0.17, 114);
  } else {
    stumpFoot(g, 0.39, 0.866, 0.06, 0.024, 112);
    stumpFoot(g, 0.61, 0.866, 0.06, 0.024, 113);
    stumpBody(g, 0.5, 0.71, 0.205, 0.135, 114);
    g.translate(0, 0.13);
  }
  if (S) {
    felt(g, oval(0.6, 0.66, 0.045, 0.05, { sq: 3.5, rot: -0.2, seed: 116 }), BARK, { stitch: false, hair: 0.4, puff: 0.5 });
    stumpCapS(g, awake);
  } else {
    felt(g, oval(0.42, 0.66, 0.05, 0.045, { sq: 3.5, rot: 0.2, seed: 116 }), BARK, { stitch: false, hair: 0.4, puff: 0.5 });
    stitch(g, [[0.58, 0.5], [0.58, 0.72]], false, tone(BARK, -0.25));
    stumpCapN(g, awake);
  }
}

function capDeco(g, pts, cx, cy, ang, s) {
  felt(g, pts, CAP_COL, { ins: 0.03 });
  chevron(g, cx, cy, ang, s);
}

function stumpCapE(g, dy, droop) {
  const pts = smooth([
    [0.2, 0.44 + dy], [0.22, 0.27 + dy], [0.38, 0.16 + dy], [0.6, 0.15 + dy], [0.77, 0.24 + dy],
    [0.92, 0.37 + dy], [0.92, 0.37 + dy], [0.86, 0.44 + dy], [0.62, 0.47 + dy], [0.36, 0.475 + dy],
  ], 7);
  capUnder(g, [[0.42, 0.45 + dy], [0.62, 0.52 + dy], [0.86, 0.5 + dy], [0.96, 0.39 + dy], [0.84, 0.4 + dy], [0.6, 0.43 + dy]], 0.48, 0.36 + dy, 0.15, 1.35);
  capDeco(g, pts, 0.56, 0.31 + dy, 0, 1 - droop * 0.2);
}

function stumpCapS(g, awake) {
  void awake;
  const pts = smooth([
    [0.17, 0.42], [0.19, 0.24], [0.35, 0.13], [0.65, 0.13], [0.81, 0.24], [0.83, 0.42],
    [0.7, 0.49], [0.5, 0.545], [0.5, 0.545], [0.3, 0.49],
  ], 7);
  capUnder(g, [[0.2, 0.44], [0.32, 0.54], [0.5, 0.605], [0.68, 0.54], [0.8, 0.44], [0.5, 0.42]], 0.5, 0.34, Math.PI / 2 - 1.0, Math.PI / 2 + 1.0);
  capDeco(g, pts, 0.5, 0.31, Math.PI / 2, 1);
}

function stumpCapN(g, awake) {
  void awake;
  const pts = smooth([
    [0.17, 0.4], [0.2, 0.22], [0.36, 0.1], [0.5, 0.055], [0.5, 0.055], [0.64, 0.1], [0.8, 0.22], [0.83, 0.4],
    [0.66, 0.46], [0.34, 0.46],
  ], 7);
  capDeco(g, pts, 0.5, 0.27, -Math.PI / 2, 1);
}

function paintZed(g) {
  const pts = [[0.24, 0.22], [0.78, 0.22], [0.78, 0.36], [0.46, 0.64], [0.78, 0.64], [0.78, 0.8], [0.22, 0.8], [0.22, 0.66], [0.54, 0.38], [0.24, 0.38]];
  const p = smooth(pts.flatMap((q) => [q, q]), 3);
  felt(g, p, CREAM, { stitch: false, hair: 0.5, puff: 0.4 });
}

// ---------------------------------------------------------------------------
// public API

// Wren. opts: { t, dir, carrying, smothered }
export function drawWren(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const t = o.t || 0;
  const d = dirIndex(o.dir);
  const carrying = o.carrying ? 1 : 0;
  const out = carrying && o.smothered ? 1 : 0;
  const state = carrying ? (out ? 2 : 0) : 1;
  const f = frameOf(t, 3.2, 12);
  const key = 'W' + d + state + '.' + f;
  let s = b.map.get(key);
  if (s === undefined) s = make(b, key, (g) => paintWren(g, d, state, (f / 12) * TAU), { shadow: [0.5, 0.875, 0.3, 0.075, 0.55] });
  if (!s) return;
  const br = out ? 0.012 * Math.sin(t * 1.6) : 0.02 * Math.sin(t * 2.6);
  const sway = out ? 0 : 0.008 * Math.sin(t * 1.3) * size;
  blit(ctx, s, px + sway, py, size, 0.5, 0.88, 1 - br * 0.6, 1 + br, 0);
  if (carrying && !out) {
    const p = W_GLOW[d];
    drawGlow(ctx, px + p[0] * size, py + p[1] * size, size * 0.8, 0.2 + 0.14 * flicker(t));
  }
}

// The planted lantern. opts: { t }
export function drawLantern(ctx, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const t = o.t || 0;
  const f = (Math.floor(t * 7) * 7 + Math.floor(t * 3)) & 3;
  const key = 'L' + f;
  let s = b.map.get(key);
  if (s === undefined) {
    s = make(b, key, (g) => {
      felt(g, oval(0.5, 0.86, 0.17, 0.045, { seed: 121 }), BROWN_DK, { stitch: false, hair: 0.8, puff: 0.4 });
      paintLantern(g, 0.5, 0.17, 0.7, f, false);
    }, { shadow: [0.5, 0.88, 0.24, 0.06, 0.6] });
  }
  if (!s) return;
  blit(ctx, s, px, py, size, 0, 0, 1, 1, 0);
  drawGlow(ctx, px + size * 0.5, py + size * 0.6, size * 1.25, 0.22 + 0.16 * flicker(t));
}

// Creatures. type 'M' | 'S' | 'T'. opts: { t, dir, lit, hidden, awake } (hidden/awake fall back to lit)
export function drawCreature(ctx, type, px, py, size, opts) {
  const o = opts || NONE;
  const b = bucketFor(ctx, size);
  const t = o.t || 0;
  let s;
  if (type === 'M') {
    const lit = o.lit ? 1 : 0;
    const f = frameOf(t, lit ? 0.55 : 3.2, 12);
    const key = 'M' + lit + '.' + f;
    s = b.map.get(key);
    if (s === undefined) s = make(b, key, (g) => paintMoth(g, lit, (f / 12) * TAU), lit ? undefined : { shadow: [0.5, 0.86, 0.2, 0.06, 0.6] });
    if (lit) {
      // hovering: the shadow stays on the ground while the moth bobs above it
      const hover = (0.07 + 0.025 * Math.sin(t * 3.1)) * size;
      drawShadow(ctx, px + size * 0.5, py + size * 0.86, size * 0.2, size * 0.05, 0.4);
      if (s) blit(ctx, s, px, py, size, 0.5, 0.5, 1, 1, -hover);
    } else {
      const br = 0.025 * Math.sin(t * 1.9);
      if (s) blit(ctx, s, px, py, size, 0.5, 0.86, 1 - br * 0.5, 1 + br, 0);
    }
  } else if (type === 'S') {
    const hidden = (o.hidden === undefined ? o.lit : o.hidden) ? 1 : 0;
    if (hidden) {
      // sealed and still: no motion at all, a wide dark footprint
      s = b.map.get('SH');
      if (s === undefined) s = make(b, 'SH', paintWhelkHidden, { shadow: [0.5, 0.875, 0.38, 0.08, 0.8] });
      if (s) blit(ctx, s, px, py, size, 0, 0, 1, 1, 0);
    } else {
      let foot = b.map.get('SF');
      if (foot === undefined) foot = make(b, 'SF', paintWhelkFoot, { shadow: [0.52, 0.87, 0.38, 0.06, 0.5] });
      s = b.map.get('SS');
      if (s === undefined) s = make(b, 'SS', paintWhelkShell);
      const w = Math.sin(t * 2.4);
      if (foot) blit(ctx, foot, px, py, size, 0.13, 0.88, 1 + 0.05 * w, 1 - 0.035 * w, 0);
      if (s) blit(ctx, s, px + size * 0.012 * Math.sin(t * 2.4 - 0.9), py, size, 0.4, 0.75, 1, 1, -size * 0.006 * (1 + Math.sin(t * 4.8)));
    }
  } else if (type === 'T') {
    const awake = (o.awake === undefined ? o.lit : o.awake) ? 1 : 0;
    const d = dirIndex(o.dir);
    const f = awake ? frameOf(t, 1.3, 12) : 0;
    const key = 'T' + d + awake + '.' + f;
    s = b.map.get(key);
    if (s === undefined) s = make(b, key, (g) => paintStump(g, d, awake, (f / 12) * TAU), { shadow: [0.5, 0.87, 0.3, 0.07, 0.65] });
    if (!s) return;
    if (awake) blit(ctx, s, px, py, size, 0, 0, 1, 1, 0);
    else {
      const br = 0.022 * Math.sin(t * 1.5);
      blit(ctx, s, px, py, size, 0.5, 0.87, 1 - br * 0.5, 1 + br, 0);
      let z = b.map.get('Z');
      if (z === undefined) z = make(b, 'Z', paintZed);
      if (z) {
        const right = d !== 1; // drift up off the back of the cap
        const zx = right ? 0.72 : 0.02;
        const p = (t * 0.4) % 1;
        const al = ctx.globalAlpha;
        ctx.globalAlpha = al * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85);
        const zs = size * (0.2 + 0.08 * p);
        ctx.drawImage(z.c, px + size * (zx + (right ? 0.06 : -0.06) * p) - zs * z.m, py + size * (0.02 - 0.16 * p) - zs * z.m, zs * z.k, zs * z.k);
        ctx.globalAlpha = al;
      }
    }
  }
}

// A Fluffmoth settled flat on a puddle as a bridge (drawn over an already painted puddle tile).
export function drawBridgeMoth(ctx, px, py, size, opts) {
  void opts;
  const b = bucketFor(ctx, size);
  let s = b.map.get('B');
  if (s === undefined) s = make(b, 'B', paintBridgeMoth, { shadow: [0.5, 0.56, 0.5, 0.38, 0.55] });
  if (s) blit(ctx, s, px, py, size, 0, 0, 1, 1, 0);
}
