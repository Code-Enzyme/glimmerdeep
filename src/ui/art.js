// Small pictures for the DOM side of the app: button icons and rule-card portraits painted once with
// sprites.js into throwaway canvases and handed over as data URLs (so the page keeps a single live
// canvas), plus the star-moss mark as inline SVG.

import { drawIcon, PALETTE } from '../sprites.js';
import { drawTile, drawWren, drawCreature, drawGlow, drawLantern, drawCritter, CRITTER_KINDS, charStyle } from '../chars.js';

function paint(cssSize, scale, painter, cssHeight) {
  try {
    const c = document.createElement('canvas');
    c.width = Math.round(cssSize * scale);
    c.height = Math.round((cssHeight || cssSize) * scale);
    const g = c.getContext('2d');
    if (!g) return '';
    g.setTransform(scale, 0, 0, scale, 0, 0);
    painter(g);
    return c.toDataURL('image/png');
  } catch (e) {
    return '';   // no canvas: buttons keep their text labels
  }
}

const iconCache = new Map();

// One of the sprites.js line icons as a data URL. `tint` recolours it (the icons are painted in cream).
export function iconUrl(name, tint) {
  const k = name + '|' + (tint || '');
  let url = iconCache.get(k);
  if (url === undefined) {
    url = paint(32, 3, (g) => {
      drawIcon(g, name, 0, 0, 32);
      if (tint) {
        g.globalCompositeOperation = 'source-in';
        g.fillStyle = tint;
        g.fillRect(0, 0, 32, 32);
      }
    });
    iconCache.set(k, url);
  }
  return url;
}

// Fills every `.ico[data-icon]` under `root` with its icon.
export function applyIcons(root) {
  const nodes = root.querySelectorAll('.ico[data-icon]');
  for (const node of nodes) setIcon(node, node.dataset.icon, node.dataset.tint);
}

export function setIcon(node, name, tint) {
  const url = iconUrl(name, tint);
  node.dataset.icon = name;
  node.style.backgroundImage = url ? `url(${url})` : 'none';
}

// A creature at its most telling: lit and awake, facing east.
function drawSubject(g, kind, px, py, size, t) {
  switch (kind) {
    case 'M': drawCreature(g, 'M', px, py, size, { t, lit: true }); break;
    case 'S': drawCreature(g, 'S', px, py, size, { t, lit: false, hidden: false }); break;
    case 'T': drawCreature(g, 'T', px, py, size, { t, dir: 'E', lit: true, awake: true }); break;
    case 'D': drawCreature(g, 'D', px, py, size, { t, dir: 'E', lit: true, awake: true }); break;
    case 'K': drawCreature(g, 'K', px, py, size, { t, lit: true, heat: 2 }); break;
    // a Gloamling is never lit, so it shows the body with its glowing edge on top
    case 'O':
      drawCreature(g, 'O', px, py, size, { t });
      drawGlow(g, 'O', px, py, size, { t, lit: false });
      break;
    case 'R': drawCreature(g, 'R', px, py, size, { t, dir: '/', lit: true }); break;
    default: break;
  }
}

const portraitCache = new Map();

// A fully lit portrait for a rule card. kind: 'wren' | 'lantern' | 'M' | 'S' | 'T' | 'D' | 'K' | 'O' | 'R' | 'A' | 'bud' | 'root' | 'gate' |
// 'puddle' | 'hush' ('A' is the Shutter: a lantern aimed east)
export function portraitUrl(kind, accent) {
  const k = kind + '|' + (accent || '') + '|' + charStyle();
  let url = portraitCache.get(k);
  if (url !== undefined) return url;
  const size = 72;
  const pad = 18;   // creatures and Wren overhang their tile a little
  url = paint(size + pad * 2, 2, (g) => {
    const t = 0.4;
    g.fillStyle = PALETTE.floor;
    g.fillRect(0, 0, size + pad * 2, size + pad * 2);
    // a 3 by 3 patch of floor so the subject stands on something
    for (let y = -1; y <= 1; y++) {
      for (let x = -1; x <= 1; x++) drawTile(g, 'floor', pad + x * size, pad + y * size, size, { seed: 7 + x * 3 + y * 5, t });
    }
    const px = pad;
    const py = pad;
    switch (kind) {
      case 'wren': drawWren(g, px, py, size, { t, dir: 'S', carrying: true }); break;
      case 'lantern': drawLantern(g, px, py, size, { t }); break;
      case 'M': case 'S': case 'T': case 'D': case 'K': case 'O': case 'R':
        drawSubject(g, kind, px, py, size, t);
        break;
      case 'A': drawLantern(g, px, py, size, { t, beam: 'E' }); break;
      case 'bud': drawTile(g, 'bud', px, py, size, { t, seed: 3, lit: true, accent }); break;
      case 'root': drawTile(g, 'root', px, py, size, { t, seed: 3, channel: 'a', pressed: false }); break;
      case 'gate': drawTile(g, 'gate', px, py, size, { t, seed: 3, channel: 'A', open: false }); break;
      case 'puddle': drawTile(g, 'puddle', px, py, size, { t, seed: 3 }); break;
      case 'hush': drawTile(g, 'hush', px, py, size, { t, seed: 3 }); break;
      case '*':   // crystal (SPEC section 19): a short wall of it, lit
        for (let y = -1; y <= 1; y++) {
          drawTile(g, 'crystal', px, py + y * size, size, { t, seed: 4 + y, lit: y === 0, neighbors: { n: y > -1, s: y < 1, e: false, w: false } });
        }
        break;
      case 'H':   // the Gloam's Hush (SPEC section 17): a wall of it on the west, reaching into the middle
        for (let y = -1; y <= 1; y++) {
          drawTile(g, 'hush', px - size, py + y * size, size, { t, seed: 5 + y, neighbors: { n: y > -1, s: y < 1, e: y === 0, w: false } });
        }
        drawTile(g, 'hush', px, py, size, { t, seed: 3, neighbors: { n: false, s: false, e: false, w: true } });
        break;
      default:
        // a hidden Journal critter (SPEC section 23), large on its patch of floor
        if (CRITTER_KINDS.includes(kind)) drawCritter(g, kind, px, py, size, { t, found: true, large: true });
        break;
    }
  });
  portraitCache.set(k, url);
  return url;
}

// ---------------------------------------------------------------- story pictures

const SCENE_W = 320;
const SCENE_H = 176;
const sceneCache = new Map();

// The Heartroot behind the cast: one thick root coming down from the rock above, splitting into tapered
// strands that splay out over the floor, with glowing veins. state: 'dim' | 'gentle' | 'bright'
function paintRoot(g, state, cx, floorY) {
  const tone = {
    dim: { glow: 'rgba(201, 132, 42, 0.2)', body: '#5E4128', vein: 'rgba(242, 176, 76, 0.5)', reach: 70 },
    gentle: { glow: 'rgba(242, 176, 76, 0.4)', body: '#7A5430', vein: 'rgba(255, 214, 140, 0.95)', reach: 110 },
    bright: { glow: 'rgba(255, 246, 220, 0.8)', body: '#B98A50', vein: '#FFFFFF', reach: 180 },
  }[state];
  if (!tone) return;
  const halo = g.createRadialGradient(cx, floorY - 50, 4, cx, floorY - 50, tone.reach);
  halo.addColorStop(0, tone.glow);
  halo.addColorStop(1, 'rgba(242, 176, 76, 0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, SCENE_W, SCENE_H);
  // [where the strand lands, how far it bows sideways, its width at the top]
  const strands = [[-58, -14, 12], [-24, 10, 16], [8, -8, 18], [40, 12, 14], [70, 18, 9]];
  const top = -6;
  const strand = (land, bow, w) => {
    const x0 = cx + land * 0.12;
    const x1 = cx + land;
    const y1 = floorY + 4;
    const mx = (x0 + x1) / 2 + bow;
    const my = (top + y1) / 2;
    g.beginPath();
    g.moveTo(x0 - w / 2, top);
    g.quadraticCurveTo(mx - w * 0.35, my, x1 - w * 0.12, y1);
    g.quadraticCurveTo(x1 + (land < 0 ? -10 : 10), y1 + 3, x1 + w * 0.12 + (land < 0 ? -14 : 14), y1 + 1);
    g.quadraticCurveTo(mx + w * 0.35, my, x0 + w / 2, top);
    g.closePath();
  };
  for (const [land, bow, w] of strands) {
    strand(land, bow, w);
    g.fillStyle = tone.body;
    g.fill();
    g.strokeStyle = '#24162E';
    g.lineWidth = 2.5;
    g.stroke();
  }
  // the trunk above, where the strands join
  g.beginPath();
  g.moveTo(cx - 30, top - 4);
  g.quadraticCurveTo(cx - 20, 34, cx - 6, 46);
  g.lineTo(cx + 8, 46);
  g.quadraticCurveTo(cx + 22, 34, cx + 34, top - 4);
  g.closePath();
  g.fillStyle = tone.body;
  g.fill();
  g.strokeStyle = '#24162E';
  g.lineWidth = 2.5;
  g.stroke();
  // glowing veins down the middle of each strand
  g.lineCap = 'round';
  g.strokeStyle = tone.vein;
  g.lineWidth = 2.2;
  for (const [land, bow] of strands) {
    // along the middle of the strand: the same curve as its two edges, ending just short of the floor
    const x0 = cx + land * 0.12;
    const x1 = cx + land;
    const y1 = floorY + 4;
    const mx = (x0 + x1) / 2 + bow;
    const my = (top + y1) / 2;
    const at = (u) => [(1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1, (1 - u) * (1 - u) * top + 2 * (1 - u) * u * my + u * u * y1];
    g.beginPath();
    for (let i = 0; i <= 16; i++) {
      const [x, y] = at(0.25 + (i / 16) * 0.65);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
  }
  g.beginPath();
  g.moveTo(cx + 1, top);
  g.lineTo(cx + 1, 40);
  g.stroke();
}

// A picture for a story page (SPEC section 13): the cast on a strip of cave floor, the Heartroot behind
// them, the Gloam at the edge, all in the dark around Wren's lantern. -> a PNG data URL, or ''.
export function sceneUrl(scene, accent) {
  const cast = (scene && scene.cast) || [];
  const k = JSON.stringify([cast, scene && scene.gloam, scene && scene.root, accent || '', charStyle()]);
  let url = sceneCache.get(k);
  if (url !== undefined) return url;
  url = paint(SCENE_W, 2, (g) => {
    const t = 0.4;
    const T = 54;
    const floorY = SCENE_H - T - 6;
    g.save();
    g.beginPath();
    g.rect(0, 0, SCENE_W, SCENE_H);
    g.clip();
    const sky = g.createLinearGradient(0, 0, 0, SCENE_H);
    sky.addColorStop(0, '#1D1428');
    sky.addColorStop(1, '#3B2B50');
    g.fillStyle = sky;
    g.fillRect(0, 0, SCENE_W, SCENE_H);
    // the cave: a row of rock above, a row of floor below
    const cols = Math.ceil(SCENE_W / T) + 1;
    for (let i = 0; i < cols; i++) {
      drawTile(g, 'wall', i * T - 10, -T * 0.55, T, { seed: 11 + i * 7, t });
      drawTile(g, 'floor', i * T - 10, floorY, T, { seed: 5 + i * 3, t });
      drawTile(g, 'floor', i * T - 10, floorY + T, T, { seed: 9 + i * 5, t });
    }
    if (scene && scene.root) paintRoot(g, scene.root, SCENE_W * 0.56, floorY + T * 0.5);
    // the Gloam: huge, half out of the picture on the right; or small, a Gloamling remembered by the root
    const big = scene && scene.gloam === 'near';
    const small = scene && scene.gloam === 'small';
    const gloamAt = big
      ? { x: SCENE_W - 112, y: floorY + T - 176, size: 176 }
      : { x: SCENE_W * 0.56 + 62, y: floorY - T * 0.18, size: T };
    if (big || small) drawCreature(g, 'O', gloamAt.x, gloamAt.y, gloamAt.size, { t });
    // the cast, left to right
    const start = 18;
    const step = T + 6;
    const lights = [];
    cast.forEach((who, i) => {
      const px = start + i * step;
      const py = floorY - T * 0.18;
      if (who === 'wren') {
        drawWren(g, px, py, T, { t, dir: 'E', carrying: true });
        lights.push({ x: px + T * 0.62, y: py + T * 0.5, r: T * 3.2 });
      } else {
        drawSubject(g, who, px, py, T, t);
        if (who === 'K') lights.push({ x: px + T * 0.5, y: py + T * 0.5, r: T * 1.2 });
      }
    });
    if (scene && scene.root) {
      lights.push({ x: SCENE_W * 0.56, y: floorY - 10, r: { dim: 60, gentle: 120, bright: 220 }[scene.root] || 0 });
    }
    // the dark, with a soft hole around every light
    const dark = document.createElement('canvas');
    dark.width = g.canvas.width;
    dark.height = g.canvas.height;
    const d = dark.getContext('2d');
    if (d) {
      const k2 = dark.width / SCENE_W;
      d.setTransform(k2, 0, 0, k2, 0, 0);
      d.fillStyle = 'rgba(13, 8, 20, 0.66)';
      d.fillRect(0, 0, SCENE_W, SCENE_H);
      d.globalCompositeOperation = 'destination-out';
      for (const l of lights) {
        const hole = d.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r);
        hole.addColorStop(0, 'rgba(0, 0, 0, 1)');
        hole.addColorStop(0.55, 'rgba(0, 0, 0, 0.75)');
        hole.addColorStop(1, 'rgba(0, 0, 0, 0)');
        d.fillStyle = hole;
        d.fillRect(0, 0, SCENE_W, SCENE_H);
      }
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.drawImage(dark, 0, 0);
      g.restore();
    }
    // warm lantern light on top, and the Gloam's glowing edge, which shows in the dark
    for (const l of lights) {
      const warm = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, l.r * 0.6);
      warm.addColorStop(0, 'rgba(242, 176, 76, 0.22)');
      warm.addColorStop(1, 'rgba(242, 176, 76, 0)');
      g.fillStyle = warm;
      g.fillRect(0, 0, SCENE_W, SCENE_H);
    }
    if (big || small) drawGlow(g, 'O', gloamAt.x, gloamAt.y, gloamAt.size, { t, lit: false });
    cast.forEach((who, i) => {
      if (who === 'wren' || who === 'O') return;
      drawGlow(g, who, start + i * step, floorY - T * 0.18, T, { t, lit: true });
    });
    g.restore();
  }, SCENE_H);
  sceneCache.set(k, url);
  return url;
}

// ---------------------------------------------------------------- star moss

// A soft five-pointed sprig. The path is built once: outer points at radius 10, inner at 4.7, in a 24 box.
const MOSS_PATH = (() => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 10 : 4.7;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    d += (i === 0 ? 'M' : 'L') + (12 + r * Math.cos(a)).toFixed(2) + ' ' + (12.6 + r * Math.sin(a)).toFixed(2);
  }
  return d + 'Z';
})();

// Star-moss mark as SVG markup. Earned marks are filled, unearned ones are a dashed outline: the
// difference is in the shape, not only in the colour.
export function mossSvg(earned, size) {
  const s = size || 14;
  return (
    `<svg class="moss ${earned ? 'on' : 'off'}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true" focusable="false">`
    + `<path d="${MOSS_PATH}"/>`
    + (earned ? '<circle cx="12" cy="12.6" r="1.9"/>' : '')
    + '</svg>'
  );
}

// A row of bud pips for the status line: filled when in bloom.
export function pipSvg(on) {
  return (
    `<svg class="pip ${on ? 'on' : 'off'}" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">`
    + (on
      ? '<circle cx="8" cy="8" r="5.2"/><path d="M8 1v3M8 12v3M1 8h3M12 8h3"/>'
      : '<circle cx="8" cy="8" r="4.4"/>')
    + '</svg>'
  );
}

// One move of a hint's way for the status row (SPEC section 18): an arrow, the lantern, or a pause for Wait.
// `next`: the move to make now, drawn brighter.
const WAY_TURN = { N: -90, E: 0, S: 90, W: 180 };
export function wayMoveSvg(move, next) {
  let body;
  if (move === 'L') body = '<path d="M6.2 3.2h3.6M5.4 5.2h5.2l-.7 7.4H6.1z"/><circle class="glow" cx="8" cy="9" r="1.5"/>';
  else if (move === 'Z') body = '<path d="M6 4.5v7M10 4.5v7"/>';
  else body = `<path transform="rotate(${WAY_TURN[move] || 0} 8 8)" d="M3 8h9M8.5 4.2 12.3 8l-3.8 3.8"/>`;
  return (
    `<svg class="way-move${next ? ' next' : ''}" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">`
    + body
    + '</svg>'
  );
}

