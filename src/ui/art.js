// Small pictures for the DOM side of the app: button icons and rule-card portraits painted once with
// sprites.js into throwaway canvases and handed over as data URLs (so the page keeps a single live
// canvas), plus the star-moss mark as inline SVG.

import { drawIcon, PALETTE } from '../sprites.js';
import { drawTile, drawWren, drawCreature, drawGlow, drawLantern, charStyle } from '../chars.js';

function paint(cssSize, scale, painter) {
  try {
    const c = document.createElement('canvas');
    c.width = Math.round(cssSize * scale);
    c.height = Math.round(cssSize * scale);
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
      case 'M': drawCreature(g, 'M', px, py, size, { t, lit: true }); break;
      case 'S': drawCreature(g, 'S', px, py, size, { t, lit: false, hidden: false }); break;
      case 'T': drawCreature(g, 'T', px, py, size, { t, dir: 'E', lit: true, awake: true }); break;
      case 'D': drawCreature(g, 'D', px, py, size, { t, dir: 'E', lit: true, awake: true }); break;
      case 'K': drawCreature(g, 'K', px, py, size, { t, lit: true, heat: 2 }); break;
      // a Gloamling is never lit, so its portrait shows the body with its glowing edge on top
      case 'O':
        drawCreature(g, 'O', px, py, size, { t });
        drawGlow(g, 'O', px, py, size, { t, lit: false });
        break;
      case 'R': drawCreature(g, 'R', px, py, size, { t, dir: '/', lit: true }); break;
      case 'A': drawLantern(g, px, py, size, { t, beam: 'E' }); break;
      case 'bud': drawTile(g, 'bud', px, py, size, { t, seed: 3, lit: true, accent }); break;
      case 'root': drawTile(g, 'root', px, py, size, { t, seed: 3, channel: 'a', pressed: false }); break;
      case 'gate': drawTile(g, 'gate', px, py, size, { t, seed: 3, channel: 'A', open: false }); break;
      case 'puddle': drawTile(g, 'puddle', px, py, size, { t, seed: 3 }); break;
      case 'hush': drawTile(g, 'hush', px, py, size, { t, seed: 3 }); break;
      default: break;
    }
  });
  portraitCache.set(k, url);
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
