// The hidden Journal critters (SPEC section 23), drawn small in a corner of their tile, or large for the Journal.
// The Glowmark look in miniature: a soft dark body with glowing markings. No faces: no eyes, mouths or face-like
// groups of marks; markings are bands, lines and rows.
import { PALETTE } from '../sprites.js';

const TAU = Math.PI * 2;
const TEAL = PALETTE.teal;
const AMBER = PALETTE.amber;
const CREAM = PALETTE.cream;
const ROSE = PALETTE.rose;
const BODY = '#3A2B52';
const BODY_DARK = '#1E1530';
const OUTLINE = 'rgba(10,5,16,0.85)';
const GLASS = 'rgba(190,220,255,0.55)';
const SKY = '#9CC8FF';

function blob(ctx, x, y, rx, ry, fill, line) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fillStyle = fill;
  ctx.fill();
  if (line) {
    ctx.lineWidth = line;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
  }
}

function stroke(ctx, pts, color, width) {
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.stroke();
}

function body(ctx, x, y, rx, ry, u) {
  const g = ctx.createRadialGradient(x - rx * 0.3, y - ry * 0.4, 0, x, y, Math.max(rx, ry));
  g.addColorStop(0, '#5A4680');
  g.addColorStop(0.6, BODY);
  g.addColorStop(1, BODY_DARK);
  blob(ctx, x, y, rx, ry, g, u * 0.035);
}

// legs: n per side, from the body's sides, bent down
function legs(ctx, x, y, spread, n, len, u, color = BODY_DARK) {
  for (let side = -1; side <= 1; side += 2) {
    for (let i = 0; i < n; i++) {
      const lx = x + side * spread;
      const ly = y + (i - (n - 1) / 2) * u * 0.1;
      stroke(ctx, [lx, ly, lx + side * len * 0.6, ly - len * 0.2, lx + side * len, ly + len * 0.45], color, u * 0.045);
    }
  }
}

function glowing(ctx, a, fn) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha *= a;
  fn();
  ctx.restore();
}

const PAINT = {
  dewmite(ctx, x, y, u, t, pulse) {
    legs(ctx, x, y + u * 0.12, u * 0.14, 3, u * 0.16, u);
    // a teardrop of dew
    ctx.beginPath();
    ctx.moveTo(x, y - u * 0.3);
    ctx.bezierCurveTo(x + u * 0.08, y - u * 0.16, x + u * 0.22, y - u * 0.02, x + u * 0.2, y + u * 0.12);
    ctx.bezierCurveTo(x + u * 0.18, y + u * 0.26, x - u * 0.18, y + u * 0.26, x - u * 0.2, y + u * 0.12);
    ctx.bezierCurveTo(x - u * 0.22, y - u * 0.02, x - u * 0.08, y - u * 0.16, x, y - u * 0.3);
    const g = ctx.createLinearGradient(x, y - u * 0.3, x, y + u * 0.24);
    g.addColorStop(0, 'rgba(160,240,220,0.95)');
    g.addColorStop(1, 'rgba(40,110,110,0.95)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = u * 0.035;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    glowing(ctx, 0.5 + 0.4 * pulse, () => stroke(ctx, [x - u * 0.1, y + u * 0.02, x - u * 0.06, y - u * 0.12], CREAM, u * 0.05));
  },
  pebblecrab(ctx, x, y, u, t, pulse) {
    legs(ctx, x, y + u * 0.1, u * 0.18, 3, u * 0.14, u);
    // two small open pincers, held out to the sides (pincers, not stalks: nothing face-like)
    for (let side = -1; side <= 1; side += 2) {
      const cx = x + side * u * 0.32;
      const cy = y - u * 0.02;
      stroke(ctx, [x + side * u * 0.16, y + u * 0.02, cx, cy], BODY_DARK, u * 0.05);
      stroke(ctx, [cx, cy, cx + side * u * 0.1, cy - u * 0.07], ROSE, u * 0.045);
      stroke(ctx, [cx, cy, cx + side * u * 0.11, cy + u * 0.02], ROSE, u * 0.045);
    }
    // the pebble it wears
    const g = ctx.createRadialGradient(x - u * 0.06, y - u * 0.06, 0, x, y, u * 0.24);
    g.addColorStop(0, '#9A8E9C');
    g.addColorStop(1, '#4E4456');
    blob(ctx, x, y + u * 0.02, u * 0.22, u * 0.16, g, u * 0.035);
    // two glowing strata in the stone, slanting (never a level line across it: nothing face-like)
    glowing(ctx, 0.45 + 0.4 * pulse, () => {
      stroke(ctx, [x - u * 0.13, y - u * 0.04, x - u * 0.02, y - u * 0.11], TEAL, u * 0.03);
      stroke(ctx, [x - u * 0.06, y + u * 0.08, x + u * 0.12, y - u * 0.04], TEAL, u * 0.03);
    });
  },
  sporeling(ctx, x, y, u, t, pulse) {
    stroke(ctx, [x - u * 0.07, y + u * 0.1, x - u * 0.1, y + u * 0.28], BODY_DARK, u * 0.04);
    stroke(ctx, [x + u * 0.07, y + u * 0.1, x + u * 0.1, y + u * 0.28], BODY_DARK, u * 0.04);
    const puffs = [[0, -0.06, 0.15], [-0.12, 0, 0.11], [0.12, 0, 0.11], [-0.05, -0.17, 0.09], [0.07, -0.15, 0.09], [0, 0.06, 0.11]];
    for (const [dx, dy, r] of puffs) blob(ctx, x + dx * u, y + dy * u, r * u, r * u, '#B7A3C9', u * 0.025);
    for (const [dx, dy, r] of puffs) blob(ctx, x + dx * u, y + dy * u, r * u * 0.8, r * u * 0.8, '#D8CBE4');
    glowing(ctx, 0.5 + 0.5 * pulse, () => {
      const specks = [[-0.28, -0.22], [0.26, -0.3], [0.32, 0.04], [-0.3, 0.1], [0.04, -0.36]];
      for (let i = 0; i < specks.length; i++) {
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + i * 1.7);
        blob(ctx, x + specks[i][0] * u, y + specks[i][1] * u, u * 0.025 * (0.6 + tw), u * 0.025 * (0.6 + tw), AMBER);
      }
    });
  },
  skimmer(ctx, x, y, u, t, pulse) {
    // rings of light on the water under it
    glowing(ctx, 0.35 + 0.3 * pulse, () => {
      ctx.lineWidth = u * 0.025;
      ctx.strokeStyle = TEAL;
      for (const r of [0.18, 0.3]) {
        ctx.beginPath();
        ctx.ellipse(x, y + u * 0.12, r * u, r * u * 0.35, 0, 0, TAU);
        ctx.stroke();
      }
    });
    // four long bent legs
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      stroke(ctx, [x + dx * u * 0.04, y + dy * u * 0.04, x + dx * u * 0.2, y + dy * u * 0.16 - u * 0.06, x + dx * u * 0.36, y + dy * u * 0.18 + u * 0.08], BODY_DARK, u * 0.03);
    }
    body(ctx, x, y, u * 0.07, u * 0.16, u);
    glowing(ctx, 0.5 + 0.4 * pulse, () => stroke(ctx, [x, y - u * 0.1, x, y + u * 0.1], TEAL, u * 0.03));
  },
  cinderfly(ctx, x, y, u, t, pulse) {
    // wings
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.ellipse(x + side * u * 0.14, y - u * 0.12, u * 0.15, u * 0.08, side * -0.5, 0, TAU);
      ctx.fillStyle = 'rgba(244,234,213,0.35)';
      ctx.fill();
      ctx.lineWidth = u * 0.02;
      ctx.strokeStyle = 'rgba(244,234,213,0.7)';
      ctx.stroke();
    }
    body(ctx, x - u * 0.04, y - u * 0.02, u * 0.1, u * 0.09, u);
    // the tail like a fresh coal
    const tail = ctx.createRadialGradient(x + u * 0.14, y + u * 0.1, 0, x + u * 0.14, y + u * 0.1, u * 0.12);
    tail.addColorStop(0, '#FFE08A');
    tail.addColorStop(0.6, '#F27A3C');
    tail.addColorStop(1, '#7A2E1E');
    blob(ctx, x + u * 0.12, y + u * 0.08, u * 0.11, u * 0.08, tail, u * 0.03);
    glowing(ctx, 0.5 + 0.5 * pulse, () => {
      const g = ctx.createRadialGradient(x + u * 0.13, y + u * 0.09, 0, x + u * 0.13, y + u * 0.09, u * 0.28);
      g.addColorStop(0, 'rgba(255,170,90,0.7)');
      g.addColorStop(1, 'rgba(255,170,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - u * 0.2, y - u * 0.2, u * 0.66, u * 0.6);
    });
  },
  rootworm(ctx, x, y, u, t, pulse) {
    // a curled row of segments
    const segs = 7;
    for (let i = segs - 1; i >= 0; i--) {
      const a = Math.PI * 0.9 + i * 0.62;
      const r = u * (0.08 + i * 0.022);
      const sx = x + Math.cos(a) * r;
      const sy = y + u * 0.04 + Math.sin(a) * r * 0.8;
      body(ctx, sx, sy, u * (0.075 - i * 0.004), u * (0.07 - i * 0.004), u);
    }
    glowing(ctx, 0.35 + 0.55 * pulse, () => {
      for (let i = 0; i < segs; i++) {
        const a = Math.PI * 0.9 + i * 0.62;
        const r = u * (0.08 + i * 0.022);
        blob(ctx, x + Math.cos(a) * r, y + u * 0.04 + Math.sin(a) * r * 0.8, u * 0.03, u * 0.03, AMBER);
      }
    });
  },
  cogmite(ctx, x, y, u, t, pulse) {
    legs(ctx, x, y + u * 0.06, u * 0.16, 3, u * 0.12, u);
    // a shell like a brass gear
    const teeth = 10;
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * TAU;
      const r = u * (i % 2 ? 0.17 : 0.21);
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r * 0.85;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    const g = ctx.createRadialGradient(x - u * 0.05, y - u * 0.06, 0, x, y, u * 0.22);
    g.addColorStop(0, '#E6B868');
    g.addColorStop(1, '#7A5228');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = u * 0.03;
    ctx.strokeStyle = OUTLINE;
    ctx.stroke();
    // spokes, so the gear reads as a wheel
    for (let i = 0; i < 3; i++) {
      const a = 0.5 + (i / 3) * TAU;
      stroke(ctx, [x, y, x + Math.cos(a) * u * 0.13, y + Math.sin(a) * u * 0.11], '#6A4420', u * 0.03);
    }
    glowing(ctx, 0.45 + 0.45 * pulse, () => {
      for (let i = 0; i < 3; i++) {
        const a = 0.5 + (i / 3) * TAU + Math.PI / 3;
        stroke(ctx, [x + Math.cos(a) * u * 0.05, y + Math.sin(a) * u * 0.04, x + Math.cos(a) * u * 0.13, y + Math.sin(a) * u * 0.11], AMBER, u * 0.025);
      }
    });
  },
  glasswing(ctx, x, y, u, t, pulse) {
    for (let side = -1; side <= 1; side += 2) {
      ctx.beginPath();
      ctx.moveTo(x, y - u * 0.04);
      ctx.lineTo(x + side * u * 0.34, y - u * 0.26);
      ctx.lineTo(x + side * u * 0.3, y - u * 0.04);
      ctx.closePath();
      ctx.fillStyle = GLASS;
      ctx.fill();
      ctx.lineWidth = u * 0.02;
      ctx.strokeStyle = 'rgba(230,245,255,0.85)';
      ctx.stroke();
    }
    stroke(ctx, [x, y - u * 0.1, x, y + u * 0.2], BODY, u * 0.07);
    glowing(ctx, 0.45 + 0.5 * pulse, () => {
      for (let side = -1; side <= 1; side += 2) stroke(ctx, [x + side * u * 0.04, y - u * 0.06, x + side * u * 0.26, y - u * 0.18], SKY, u * 0.02);
    });
  },
};

export const CRITTER_KINDS = Object.keys(PAINT);

// px, py: the tile's top-left; size: the tile. opts: { t (seconds), found, large }
// Small in the tile's lower right corner, or large and centred for the Journal (large: true). Until it is found it
// twinkles softly, so a sharp eye can spot it.
export function drawCritter(ctx, kind, px, py, size, opts = {}) {
  const paint = PAINT[kind];
  if (!paint) return;
  const t = opts.t || 0;
  const large = !!opts.large;
  const u = large ? size * 1.3 : size * 0.46;
  const x = large ? px + size * 0.5 : px + size * 0.75;
  const y = large ? py + size * 0.55 : py + size * 0.74;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
  ctx.save();
  paint(ctx, x, y, u, t, pulse);
  if (!opts.found && !large) {
    // the twinkle: a small four-point glint that breathes in and out
    const a = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2.4));
    const gx = x + u * 0.24;
    const gy = y - u * 0.34;
    const r = u * (0.1 + 0.06 * a);
    glowing(ctx, a, () => {
      stroke(ctx, [gx - r, gy, gx + r, gy], CREAM, u * 0.04);
      stroke(ctx, [gx, gy - r, gx, gy + r], CREAM, u * 0.04);
    });
  }
  ctx.restore();
}
