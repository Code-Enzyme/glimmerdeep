// Character art (Wren, the planted lantern, the creatures) comes in several styles so they can be
// compared. Everything else (tiles, darkness, backdrop, icons) is in sprites.js and shared by all styles.
// Each style module exports drawWren, drawLantern and drawCreature with the signatures in SPEC section 7.
import * as faces from './sprites.js';
import * as glowmark from './chars/glowmark.js';
import * as felt from './chars/felt.js';
import * as glyph from './chars/glyph.js';

export const CHAR_STYLES = {
  faces: { name: 'Current (with faces)', mod: faces },
  glowmark: { name: 'Glowmark', mod: glowmark },
  felt: { name: 'Felt and stitch', mod: felt },
  glyph: { name: 'Lantern glyphs', mod: glyph },
};

let current = 'faces';

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

// Tiles come from sprites.js, except the moth bridge, which is a creature and follows the style when
// the style module exports drawBridgeMoth(ctx, px, py, size, { t }) (drawn on top of a puddle tile).
export function drawTile(ctx, kind, px, py, size, opts) {
  const mod = CHAR_STYLES[current].mod;
  if (kind === 'bridge' && mod.drawBridgeMoth) {
    faces.drawTile(ctx, 'puddle', px, py, size, opts);
    return mod.drawBridgeMoth(ctx, px, py, size, opts || {});
  }
  return faces.drawTile(ctx, kind, px, py, size, opts);
}
