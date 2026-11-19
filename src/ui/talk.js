// Board talk (SPEC section 28): the board in words, for TalkBack and the spoken description. Pure: no DOM.
// Places are counted from Wren's tile; lists go nearest first, then in reading order.

import { terrainAt, creatureAt, isLit, isGateOpen, DIRS } from '../engine.js';

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
const SIDES = ['N', 'E', 'S', 'W'];
const SIDE_NAME = { N: 'north', E: 'east', S: 'south', W: 'west' };

const NAMES = { M: 'Fluffmoth', S: 'Shellwhelk', T: 'Stumpcap', D: 'Dozer newt', K: 'Emberwick', O: 'Gloamling', R: 'Mirrorbeetle' };
const VERBS = { M: 'flies', S: 'creeps', T: 'marches', D: 'wanders', K: 'follows', O: 'drifts', R: 'crawls' };
const HEAT = ['cold', 'warm', 'glowing'];

const word = (n) => (n >= 0 && n < NUMBERS.length ? NUMBERS[n] : String(n));
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nameOf = (type) => NAMES[type] || 'Something';
const withArticle = (name) => (/^[AEIOU]/.test(name) ? 'an ' : 'a ') + name;
// creature ids are numbered per species (SPEC section 9), so the id says the species even after a moth settles
const typeOfId = (state, id) => {
  const c = state.creatures.find((k) => k.id === id);
  return c ? c.type : String(id).charAt(0);
};

// "two tiles north", "three tiles south and one west", "here": a place dx, dy tiles from Wren
export function where(dx, dy) {
  if (dx === 0 && dy === 0) return 'here';
  const parts = [];
  if (dy !== 0) parts.push([Math.abs(dy), dy < 0 ? 'north' : 'south']);
  if (dx !== 0) parts.push([Math.abs(dx), dx < 0 ? 'west' : 'east']);
  const [n, side] = parts[0];
  let text = `${word(n)} ${n === 1 ? 'tile' : 'tiles'} ${side}`;
  if (parts[1]) text += ` and ${word(parts[1][0])} ${parts[1][1]}`;
  return text;
}

const from = (state, p) => where(p.x - state.wren.x, p.y - state.wren.y);

// Places sorted nearest first (fewest steps from Wren), then in reading order.
function nearestFirst(state, places) {
  const d = (p) => Math.abs(p.x - state.wren.x) + Math.abs(p.y - state.wren.y);
  return places.slice().sort((a, b) => d(a) - d(b) || a.y - b.y || a.x - b.x);
}

function lanternPlanted(state, x, y) {
  return !state.lantern.carried && state.lantern.x === x && state.lantern.y === y;
}

// What stands on one side of Wren, in a few words.
function sideWord(state, x, y) {
  const c = creatureAt(state, x, y);
  if (c) return withArticle(nameOf(c.type));
  if (lanternPlanted(state, x, y)) return 'the lantern';
  const t = terrainAt(state, x, y);
  if (t === '.' || t === 'bridge') return 'open';
  if (t === '~') return 'a puddle';
  if (t === 'G') return 'a bud';
  if (t === 'H') return 'the Hush';
  if (t === '*') return 'crystal';
  if (/^[abc]$/.test(t)) return `root ${t.toUpperCase()}`;
  if (/^[ABC]$/.test(t)) return `gate ${t}, ${isGateOpen(state, t) ? 'open' : 'shut'}`;
  return 'wall';
}

const joinSides = (names) => (names.length === 1 ? `the ${names[0]}`
  : `the ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// "Wall to the north and west, open to the east, a puddle to the south." or "Open all round."
export function sides(state) {
  const groups = [];
  for (const side of SIDES) {
    const [dx, dy] = DIRS[side];
    const what = sideWord(state, state.wren.x + dx, state.wren.y + dy);
    const g = groups.find((k) => k.what === what);
    if (g) g.sides.push(SIDE_NAME[side]);
    else groups.push({ what, sides: [SIDE_NAME[side]] });
  }
  if (groups.length === 1) return `${capital(groups[0].what)} all round.`;
  return capital(groups.map((g) => `${g.what} to ${joinSides(g.sides)}`).join(', ')) + '.';
}

function smothered(state) {
  return state.lantern.carried && terrainAt(state, state.wren.x, state.wren.y) === 'H';
}

function lanternWords(state) {
  const L = state.lantern;
  const out = [];
  if (L.carried) {
    if (smothered(state)) return ['Wren carries the lantern in the Hush.', 'It is smothered.'];
    out.push('Wren carries the lantern.');
  } else {
    out.push(`The lantern stands ${from(state, L)}.`);
    if (L.beam) out.push(`It shines a beam ${SIDE_NAME[L.beam]}.`);
  }
  if (!isLit(state, L.x, L.y)) out.push('Its light is out.');
  return out;
}

function budWords(state) {
  const left = state.buds.filter((b, i) => state.bloom[i] !== 1);
  if (!left.length) return ['Every bud is in bloom.'];
  const n = left.length;
  const out = [`${capital(word(n))} ${n === 1 ? 'bud' : 'buds'} to light: ${nearestFirst(state, left).map((b) => from(state, b)).join('; ')}.`];
  const bloomed = state.buds.length - n;
  if (bloomed > 0) out.push(`${capital(word(bloomed))} in bloom.`);
  return out;
}

function creatureState(state, c) {
  const lit = isLit(state, c.x, c.y);
  switch (c.type) {
    case 'M': return [lit ? 'in the light' : 'in the dark'];
    case 'S': return [lit ? 'hiding in its shell' : 'in the dark'];
    case 'T': return [`facing ${SIDE_NAME[c.dir]}`, lit ? 'awake' : 'asleep'];
    case 'D': return [`facing ${SIDE_NAME[c.dir]}`, lit ? 'dozing' : 'wandering'];
    case 'K': return [HEAT[c.heat] || HEAT[0]];
    case 'R': return [c.dir === '/' ? 'mirror leaning right' : 'mirror leaning left', lit ? 'in the light' : 'in the dark'];
    default: return [];
  }
}

function tilesOf(state, test) {
  const out = [];
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) if (test(terrainAt(state, x, y))) out.push({ x, y });
  }
  return out;
}

const placeList = (state, places) => nearestFirst(state, places).map((p) => from(state, p)).join('; ');

// The whole board, one sentence an entry.
export function describeBoard(state, { par } = {}) {
  const out = [typeof par === 'number' ? `Move ${state.turn}, par ${par}.` : `Move ${state.turn}.`];
  out.push(...lanternWords(state));
  out.push(sides(state));
  out.push(...budWords(state));
  for (const c of nearestFirst(state, state.creatures)) {
    out.push([nameOf(c.type), from(state, c), ...creatureState(state, c)].join(', ') + '.');
  }
  const puddles = tilesOf(state, (t) => t === '~');
  if (puddles.length) out.push(`${puddles.length === 1 ? 'A puddle' : 'Puddles'}: ${placeList(state, puddles)}.`);
  for (const ch of ['A', 'B', 'C']) {
    if (!(ch in state.gates)) continue;
    const gates = tilesOf(state, (t) => t === ch);
    const roots = tilesOf(state, (t) => t === ch.toLowerCase());
    if (gates.length) out.push(`Gate ${ch}, ${isGateOpen(state, ch) ? 'open' : 'shut'}: ${placeList(state, gates)}.`);
    if (roots.length) out.push(`Root ${ch}: ${placeList(state, roots)}.`);
  }
  if (state.creep) {
    const hush = nearestFirst(state, tilesOf(state, (t) => t === 'H'));
    if (hush.length) out.push(`The Hush is closest ${from(state, hush[0])}.`);
  }
  return out;
}

function wrenWords(e) {
  switch (e.type) {
    case 'move': {
      const dx = e.to.x - e.from.x;
      const dy = e.to.y - e.from.y;
      const side = dx > 0 ? 'east' : dx < 0 ? 'west' : dy < 0 ? 'north' : 'south';
      return `Wren steps ${side}.`;
    }
    case 'plant': return 'Wren plants the lantern.';
    case 'pickup': return 'Wren picks up the lantern.';
    case 'aim': return e.dir ? `Wren aims the lantern ${SIDE_NAME[e.dir]}.` : "Wren opens the lantern's shutter.";
    case 'wait': return 'Wren waits.';
    default: return '';
  }
}

const EVENT_WORDS = {
  bump: (n) => `${n} is blocked.`,
  hide: (n) => `${n} hides in its shell.`,
  emerge: (n) => `${n} comes out.`,
  wake: (n) => `${n} wakes.`,
  sleep: (n, type) => (type === 'D' ? `${n} dozes off.` : `${n} falls asleep.`),
  turn: (n, type, e) => `${n} turns to face ${SIDE_NAME[e.dir]}.`,
  warm: (n) => `${n} warms.`,
  cool: (n) => `${n} cools.`,
  ignite: (n) => `${n} catches and glows.`,
  glint: (n) => `${n} catches the light.`,
};

// One move's line, from the events of the state it made.
export function describeTurn(next) {
  const out = [];
  const events = next.events || [];
  let bloomed = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.who === 'wren' || ['plant', 'pickup', 'aim', 'wait'].includes(e.type)) {
      const w = wrenWords(e);
      if (w) out.push(w);
    } else if (e.type === 'move') {
      const type = typeOfId(next, e.who);
      const after = events[i + 1];
      if (after && after.type === 'settle' && after.id === e.who) {
        out.push(`${nameOf(type)} lands in the puddle ${from(next, after)} and makes a bridge.`);
        i++;
      } else {
        out.push(`${nameOf(type)} ${VERBS[type] || 'moves'}, now ${from(next, e.to)}.`);
      }
    } else if (EVENT_WORDS[e.type]) {
      const type = typeOfId(next, e.id);
      out.push(EVENT_WORDS[e.type](nameOf(type), type, e));
    } else if (e.type === 'gate') {
      out.push(`Gate ${e.channel} ${e.open ? 'opens' : 'shuts'}.`);
    } else if (e.type === 'bud') {
      bloomed++;
      out.push('A bud blooms.');
    } else if (e.type === 'creep') {
      out.push('The Hush creeps closer.');
    } else if (e.type === 'caught') {
      out.push('The Hush catches Wren.');
    }
  }
  if (next.solved) {
    out.push('Every bud is in bloom.');
  } else if (!next.caught) {
    const left = next.bloom.filter((b) => b !== 1).length;
    if (bloomed > 0) out.push(`${capital(word(left))} ${left === 1 ? 'bud' : 'buds'} to go.`);
    out.push(sides(next));
  }
  return out.join(' ');
}

// Why the engine refused an action, or '' when it would not (SPEC section 2 has the rules).
export function describeRefusal(state, action) {
  if (state.solved || state.caught) return '';
  if (action === 'L') {
    const L = state.lantern;
    if (L.carried) {
      const t = terrainAt(state, state.wren.x, state.wren.y);
      return t === '.' || t === 'bridge' || /^[abc]$/.test(t) ? '' : "Can't plant the lantern here.";
    }
    if (L.x === state.wren.x && L.y === state.wren.y) return '';
    const next = Math.abs(L.x - state.wren.x) + Math.abs(L.y - state.wren.y) === 1;
    if (next && state.shutter) return '';
    return `The lantern is ${from(state, L)}.`;
  }
  const d = DIRS[action];
  if (!d) return '';
  const x = state.wren.x + d[0];
  const y = state.wren.y + d[1];
  const go = `Can't go ${SIDE_NAME[action]}: `;
  const c = creatureAt(state, x, y);
  if (c) return `${go}${withArticle(nameOf(c.type))} is there.`;
  const t = terrainAt(state, x, y);
  if (t === '.' || t === 'bridge' || /^[abc]$/.test(t)) return '';
  if (t === 'H') return state.lantern.carried ? '' : `${go}the Hush without the lantern.`;
  if (/^[ABC]$/.test(t)) return isGateOpen(state, t) ? '' : `${go}gate ${t} is shut.`;
  if (t === '~') return `${go}a puddle.`;
  if (t === 'G') return `${go}a bud.`;
  if (t === '*') return `${go}crystal.`;
  return `${go}wall.`;
}

// After an undo or a restart: where Wren stands now.
export function describeBack(state, kind) {
  return `${kind === 'restart' ? 'Back to the start.' : 'Back one move.'} ${sides(state)}`;
}
