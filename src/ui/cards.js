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
};

// Which card a long-press on tile (x, y) opens: Wren first, then a creature, the planted lantern, the
// terrain. -> a key of RULE_CARDS, or null for plain floor and walls.
export function cardKindAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return null;
  if (state.wren.x === x && state.wren.y === y) return 'wren';
  const creature = creatureAt(state, x, y);
  if (creature) return creature.type;
  if (!state.lantern.carried && state.lantern.x === x && state.lantern.y === y) return 'lantern';
  const terrain = terrainAt(state, x, y);
  if (terrain === 'G') return 'bud';
  if (terrain === '~' || terrain === 'bridge') return 'puddle';
  if (terrain === 'H') return 'hush';
  if (terrain === 'a' || terrain === 'b' || terrain === 'c') return 'root';
  if (terrain === 'A' || terrain === 'B' || terrain === 'C') return 'gate';
  return null;
}
