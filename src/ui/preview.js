// Hold to preview a creature (SPEC section 21): what a creature does on the next turn if Wren waits, in
// words and as the tile it steps onto. No DOM in here, so it can be tested in Node.

import { step, isLit, terrainAt } from '../engine.js';

const STEP_VERB = { M: 'flies', S: 'creeps', T: 'marches', D: 'wanders', O: 'drifts', R: 'crawls' };
const DIR_WORD = { N: 'north', E: 'east', S: 'south', W: 'west' };
const GLOWING = 2;

const dirOf = (from, to) => (to.x > from.x ? 'E' : to.x < from.x ? 'W' : to.y > from.y ? 'S' : 'N');

// Why a creature that does nothing this turn stays put.
function staying(state, c) {
  const lit = isLit(state, c.x, c.y);
  const smothered = state.lantern.carried && terrainAt(state, state.lantern.x, state.lantern.y) === 'H';
  if (c.type === 'S' && lit) return 'it stays hidden in its shell.';
  if (c.type === 'T') return 'it sleeps.';                 // a lit Stumpcap always walks or bumps
  if (c.type === 'D') return 'it dozes.';                  // a newt in the dark always walks or turns
  if (c.type === 'K') return c.heat === GLOWING ? 'it stays beside Wren.' : 'it stays cold.';
  if (c.type === 'R' && lit) return 'it basks in the light.';
  if (smothered) return 'it waits while the lantern is smothered.';
  return 'it stays where it is.';
}

// -> null when there is no such creature or no next turn, else { id, type, x, y, to: { x, y } | null, text }
export function previewOf(state, id) {
  if (!state || state.solved || state.caught) return null;
  const c = state.creatures.find((k) => k.id === id);
  if (!c) return null;
  const next = step(state, 'Z');
  if (!next) return null;
  const mine = next.events.filter((e) => e.id === id || e.who === id);
  const move = mine.find((e) => e.type === 'move');
  let to = null;
  let words;
  if (move) {
    to = { x: move.to.x, y: move.to.y };
    const dir = DIR_WORD[dirOf(move.from, move.to)];
    if (c.type === 'K') words = `it follows Wren ${dir}.`;
    else if (mine.some((e) => e.type === 'settle')) words = `it ${STEP_VERB[c.type]} ${dir} and settles in the puddle as a bridge.`;
    else words = `it ${STEP_VERB[c.type]} ${dir}.`;
  } else {
    const e = mine[0];
    if (e && e.type === 'turn') words = `it is blocked and turns to face ${DIR_WORD[e.dir]}.`;
    else if (e && e.type === 'bump') words = 'it wakes but cannot step forward.';
    else if (e && e.type === 'warm') words = 'it warms up. One more lit turn and it catches.';
    else if (e && e.type === 'ignite') words = 'it catches and starts to glow.';
    else if (e && e.type === 'cool') words = 'it cools off.';
    else words = staying(state, c);
  }
  return { id: c.id, type: c.type, x: c.x, y: c.y, to, text: `If Wren waits, ${words}` };
}
