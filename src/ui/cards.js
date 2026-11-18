// Rule cards. The texts are SPEC.md section 8, word for word.

import { terrainAt, creatureAt } from '../engine.js';

const ROOT_AND_GATE = 'A gate opens while something heavy rests on its root.';

export const RULE_CARDS = {
  wren: {
    title: 'Wren',
    text: 'Swipe to walk. Tap Wren to set the lantern down or pick it up. A planted lantern shines further.',
  },
  lantern: {
    title: 'Wren',
    text: 'Swipe to walk. Tap Wren to set the lantern down or pick it up. A planted lantern shines further.',
  },
  M: {
    title: 'Fluffmoth',
    text: 'Flies toward your lantern, sideways first. Loves puddles: it lands in one and becomes a bridge.',
  },
  S: {
    title: 'Shellwhelk',
    text: 'Creeps away from your lantern. Catch it in the light and it hides in its shell; a hiding whelk is heavy. A planted lantern reaches further.',
  },
  T: {
    title: 'Stumpcap',
    text: 'Sleeps in the dark. In the light it marches straight ahead until something stands in its way. Always heavy.',
  },
  D: {
    title: 'Dozer newt',
    text: 'Wanders in the dark and turns right whenever something blocks it. Light makes it doze off where it stands. Always heavy.',
  },
  K: {
    title: 'Emberwick',
    text: 'Keep it in the light for two turns in a row and it catches. Then it glows like a little lantern and follows Wren everywhere. Never heavy.',
  },
  O: {
    title: 'Gloamling',
    text: 'Drifts toward your lantern and eats light: the tiles around it stay dark, your lantern\'s too. It waits while the lantern is smothered. Never heavy.',
  },
  R: {
    title: 'Mirrorbeetle',
    text: 'Crawls toward your lantern in the dark and stops in the light. Its mirror shell turns a beam around a corner. Never heavy.',
  },
  A: {
    title: 'Shutter',
    text: 'Stand beside the planted lantern and tap Wren to aim its light, away from you, as a beam four tiles long. Tap again from the same side to open it.',
  },
  bud: {
    title: 'Glowbud',
    text: 'Light every Glowbud. Once lit, it stays in bloom.',
  },
  root: { title: 'Pressure root and gate', text: ROOT_AND_GATE },
  gate: { title: 'Pressure root and gate', text: ROOT_AND_GATE },
  puddle: {
    title: 'Puddle',
    text: 'Too deep for Wren. A Fluffmoth can bridge it.',
  },
  hush: {
    title: 'Hush',
    text: 'Darkness that eats light. Wren can only cross it with the lantern in hand, and the lantern goes dark inside.',
  },
  // crystal walls (SPEC section 19); '*' is also the tutorial's card for them
  '*': {
    title: 'Crystal',
    text: 'Light shines straight through crystal, but nothing can walk through it. A carried lantern only lights the near side; plant it to shine through.',
  },
  // the Hush in a Gloam encounter (SPEC section 17); 'H' is also the tutorial's card for it
  H: {
    title: "The Gloam's Hush",
    text: "The Gloam's Hush creeps onto every dark floor tile beside it, one step each turn. Light holds it back. If it reaches Wren, you step back three turns.",
  },
};

// Which card a long-press on tile (x, y) opens: Wren first, then a creature, the planted lantern, the
// terrain. -> a key of RULE_CARDS, or null for plain floor and walls.
export function cardKindAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
  if (state.wren.x === x && state.wren.y === y) return 'wren';
  const creature = creatureAt(state, x, y);
  if (creature) return creature.type;
  if (!state.lantern.carried && state.lantern.x === x && state.lantern.y === y) return state.shutter ? 'A' : 'lantern';
  const terrain = terrainAt(state, x, y);
  if (terrain === 'G') return 'bud';
  if (terrain === '~' || terrain === 'bridge') return 'puddle';
  if (terrain === 'H') return state.creep ? 'H' : 'hush';
  if (terrain === 'a' || terrain === 'b' || terrain === 'c') return 'root';
  if (terrain === 'A' || terrain === 'B' || terrain === 'C') return 'gate';
  if (terrain === '*') return '*';
  return null;
}
