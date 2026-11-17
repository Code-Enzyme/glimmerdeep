// Character art (Wren, the planted lantern, the creatures). The game uses the faceless Glowmark style.
// Tiles, darkness, backdrop and icons come from sprites.js. Other styles can be registered for
// side-by-side previews (dev/style-preview.js); each exports drawWren, drawLantern and drawCreature with
// the signatures in SPEC section 7, and optionally drawBridgeMoth.
import { drawTile as baseTile } from './sprites.js';
import * as glowmark from './chars/glowmark.js';

export const CHAR_STYLES = {
  glowmark: { name: 'Glowmark', mod: glowmark },
};

export function registerCharStyle(key, name, mod) {
  CHAR_STYLES[key] = { name, mod };
}

let current = 'glowmark';

export function setCharStyle(name) {
  if (CHAR_STYLES[name]) current = name;
  return current;
}
export function charStyle() {
  return current;
}

export function drawWren(ctx, px, py, size, opts) {
  return CHAR_STYLES[current].mod.drawWren(ctx, px, py, size, opts);
}
export function drawLantern(ctx, px, py, size, opts) {
  return CHAR_STYLES[current].mod.drawLantern(ctx, px, py, size, opts);
}
export function drawCreature(ctx, type, px, py, size, opts) {
  return CHAR_STYLES[current].mod.drawCreature(ctx, type, px, py, size, opts);
}

// Optional emissive pass, drawn AFTER the darkness so glowing markings show in the dark.
// who: 'wren' | 'M' | 'S' | 'T' | 'D' | 'K' | 'O' | 'R'; opts as for drawWren / drawCreature, plus lit (the tile is lit).
export function drawGlow(ctx, who, px, py, size, opts) {
  const mod = CHAR_STYLES[current].mod;
  if (mod.drawGlow) mod.drawGlow(ctx, who, px, py, size, opts);
}

// The moth bridge is a creature, so it follows the style when the style exports drawBridgeMoth
// (drawn on top of a puddle tile).
export function drawTile(ctx, kind, px, py, size, opts) {
  const mod = CHAR_STYLES[current].mod;
  if (kind === 'bridge' && mod.drawBridgeMoth) {
    baseTile(ctx, 'puddle', px, py, size, opts);
    return mod.drawBridgeMoth(ctx, px, py, size, opts || {});
  }
  return baseTile(ctx, kind, px, py, size, opts);
}
