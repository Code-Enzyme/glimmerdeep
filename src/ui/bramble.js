// Bramble, Wren's moth (SPEC section 31). Pure: no DOM. Bramble is drawn by the board and is never a piece:
// these are the rules of when it shows, where it flies and how it reacts. Positions are in tiles.

import { DIRS } from '../engine.js';

export const BRAMBLE_SIZE = 0.7;       // of a tile: smaller than any moth on the board
export const FIRST = '1-1';            // Bramble imprints on the lantern in the first cavern
export const PERCH = { x: 0.32, y: -0.26 };   // above and to the right of its spot, from the tile's centre
export const REACTION_MS = { cheer: 1100, happy: 520, shiver: 320 };

const REST = { x: 0, y: 0, scale: 1 };
const FOLLOW_S = 0.12;   // how quickly it closes on its spot: most of the way in a quarter of a second
const TAU = Math.PI * 2;

// The setting: Bramble flies along unless the save says false.
export function readBramble(settings) {
  return !(settings && settings.bramble === false);
}

// Whether Bramble is on the board: once the first cavern is lit, and not staying home.
export function brambleShown(levels, settings) {
  return !!(levels && levels[FIRST]) && readBramble(settings);
}

// A played turn -> 'cheer' | 'hide' | 'happy' | null.
export function reactionTo(prev, next) {
  if (!next) return null;
  const events = next.events || [];
  if (next.caught || events.some((e) => e.type === 'caught')) return 'hide';
  if (next.solved && !(prev && prev.solved)) return 'cheer';
  for (const e of events) {
    if (e.type === 'settle' || e.type === 'bud' || e.type === 'ignite') return 'happy';
    if (e.type === 'gate' && e.open) return 'happy';
  }
  return null;
}

// Where Bramble goes: the hint while one shows (the key tile, the tile to step to, or Wren), else the light.
// lantern: where the light is drawn; hint: the board's hint ({ at } | { dir } | { ring }) or null; wren: Wren's tile.
export function spotOf(lantern, hint, wren) {
  if (hint && hint.at) return { x: hint.at.x, y: hint.at.y };
  if (hint && hint.dir && DIRS[hint.dir]) return { x: wren.x + DIRS[hint.dir][0], y: wren.y + DIRS[hint.dir][1] };
  if (hint && hint.ring) return { x: wren.x, y: wren.y };
  return { x: lantern.x, y: lantern.y };
}

// The drift round its spot at time t (seconds): a small figure of eight. Still with motion reduced.
export function hover(t, still) {
  if (still) return { x: 0, y: 0 };
  return { x: 0.14 * Math.sin(t * 1.3), y: 0.07 * Math.sin(t * 2.6) };
}

// One frame's flight from pos toward target, dt seconds long: part of the way, never past it.
export function follow(pos, target, dt, still) {
  if (still) return { x: target.x, y: target.y };
  const k = 1 - Math.exp(-Math.min(Math.max(dt, 0), 0.25) / FOLLOW_S);
  return { x: pos.x + (target.x - pos.x) * k, y: pos.y + (target.y - pos.y) * k };
}

// A reaction at p (0 to 1) -> { x, y, scale }: an offset in tiles and a size, at rest at both ends.
export function pose(kind, p, still) {
  if (still || !REACTION_MS[kind] || !(p > 0) || p >= 1) return { ...REST };
  if (kind === 'cheer') {
    const a = p * TAU;
    return { x: 0.32 * Math.sin(a), y: -0.32 * (1 - Math.cos(a)), scale: 1 + 0.15 * Math.sin(p * Math.PI) };
  }
  if (kind === 'happy') return { x: 0, y: -0.24 * Math.sin(p * Math.PI), scale: 1 };
  return { x: 0.08 * Math.sin(p * 6 * Math.PI) * (1 - p), y: 0, scale: 1 };   // shiver
}
