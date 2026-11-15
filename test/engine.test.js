// Rules tests for src/engine.js. Every rule in SPEC.md sections 1 to 6 is pinned here on small
// hand-made maps. Coordinates are (x, y) with the origin top-left.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, DIRS, parseLevel, step, key, isLit, terrainAt, creatureAt, canEnter, isGateOpen, isHidden, isAwake,
} from '../src/engine.js';
import ch1 from '../src/levels/ch1.js';

// ---------------------------------------------------------------- helpers

const def = (map, extra = {}) => ({ id: 't-1', name: 'Test', feature: '', par: 1, map, note: '', ...extra });
const parse = (map, extra) => parseLevel(def(map, extra));

function deepFreeze(value, seen = new Set()) {
  if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v, seen);
  }
  return value;
}

// Runs a list of actions, failing loudly if one of them is illegal.
function run(state, actions) {
  let s = state;
  for (const a of actions) {
    const n = step(s, a);
    assert.notEqual(n, null, `action ${a} should be legal at turn ${s.turn}`);
    s = n;
  }
  return s;
}

// The stored light as one string per row: '1' lit, '0' dark.
const light = (s) => s.tiles.map((_, y) => Array.from({ length: s.w }, (_, x) => (isLit(s, x, y) ? '1' : '0')).join(''));

// Creatures as 'type@x,y' (plus facing for a Stumpcap), sorted, so tests do not depend on array order.
const where = (s) => s.creatures.map((c) => `${c.type}${c.dir ?? ''}@${c.x},${c.y}`).sort();

const firstLight = ch1.find((l) => l.id === '1-1');

const only = (s, type) => {
  const found = s.creatures.filter((c) => c.type === type);
  assert.equal(found.length, 1, `expected exactly one ${type}`);
  return found[0];
};

// ---------------------------------------------------------------- constants

test('ACTIONS and DIRS match the contract', () => {
  assert.deepEqual(ACTIONS, ['N', 'E', 'S', 'W', 'L', 'Z']);
  assert.deepEqual(DIRS, { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] });
});

// ---------------------------------------------------------------- parseLevel

test('parseLevel: extracts terrain and puts floor under Wren and the creatures', () => {
  const s = parse([
    '#########',
    '#W.~G.H.#',
    '#aMbSc^A#',
    '#.>.v.<B#',
    '#...C...#',
    '#########',
  ]);
  assert.equal(s.w, 9);
  assert.equal(s.h, 6);
  assert.deepEqual(s.tiles, [
    '#########',
    '#..~G.H.#',
    '#a.b.c.A#',
    '#......B#',
    '#...C...#',
    '#########',
  ]);
  assert.deepEqual(s.wren, { x: 1, y: 1 });
  assert.deepEqual(s.lantern, { x: 1, y: 1, carried: true });
  assert.deepEqual(s.buds, [{ x: 4, y: 1 }]);
  assert.deepEqual(s.bloom, [0]);
  assert.deepEqual(s.bridges, []);
  assert.equal(s.turn, 0);
  assert.equal(s.solved, false);
  assert.deepEqual(s.events, []);
  assert.deepEqual(where(s), ['M@2,2', 'S@4,2', 'TE@2,3', 'TN@6,2', 'TS@4,3', 'TW@6,3']);
});

test('parseLevel: the state has exactly the documented fields and is plain JSON data', () => {
  const s = parse(['W.M', 'aA.']);
  assert.deepEqual(Object.keys(s).sort(), [
    'bloom', 'bridges', 'buds', 'creatures', 'events', 'gates', 'h', 'lantern', 'lit', 'solved', 'tiles', 'turn', 'w',
    'wren',
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.deepEqual(Object.keys(s.creatures[0]).sort(), ['dir', 'id', 'type', 'x', 'y']);
});

test('parseLevel: Stumpcap facings come from ^ > v <, other creatures have dir null', () => {
  const s = parse(['W.^.>', '..v.<', '..M.S']);
  assert.equal(creatureAt(s, 2, 0).type, 'T');
  assert.equal(creatureAt(s, 2, 0).dir, 'N');
  assert.equal(creatureAt(s, 4, 0).dir, 'E');
  assert.equal(creatureAt(s, 2, 1).dir, 'S');
  assert.equal(creatureAt(s, 4, 1).dir, 'W');
  assert.equal(creatureAt(s, 2, 2).type, 'M');
  assert.equal(creatureAt(s, 2, 2).dir, null);
  assert.equal(creatureAt(s, 4, 2).type, 'S');
  assert.equal(creatureAt(s, 4, 2).dir, null);
});

test('parseLevel: creature ids are unique and never "wren"', () => {
  const s = parse(['WMMS', '>v<^']);
  const ids = s.creatures.map((c) => c.id);
  assert.equal(new Set(ids).size, 7);
  assert.ok(!ids.includes('wren'));
});

test('parseLevel: `under` gives the terrain beneath Wren, the lantern or a creature', () => {
  const s = parse(['W.M.L', '.>...'], { under: { '0,0': 'A', '2,0': 'a', '4,0': 'b', '1,1': 'B' } });
  assert.deepEqual(s.tiles, ['A.a.b', '.B...']);
  assert.equal(terrainAt(s, 0, 0), 'A');
  assert.equal(terrainAt(s, 2, 0), 'a');
  assert.equal(creatureAt(s, 2, 0).type, 'M');
  assert.equal(creatureAt(s, 1, 1).type, 'T');
});

test('parseLevel: Wren may start on Hush while carrying the lantern', () => {
  const s = parse(['W.'], { under: { '0,0': 'H' } });
  assert.deepEqual(s.tiles, ['H.']);
  assert.deepEqual(s.wren, { x: 0, y: 0 });
});

test('parseLevel: L is a lantern that starts planted, and Wren starts without it', () => {
  const s = parse(['W..L.']);
  assert.deepEqual(s.tiles, ['.....']);
  assert.deepEqual(s.wren, { x: 0, y: 0 });
  assert.deepEqual(s.lantern, { x: 3, y: 0, carried: false });
  assert.deepEqual(light(s), ['01111']);   // radius 2 around the planted lantern, nothing around Wren
});

test('parseLevel: throws on malformed maps', () => {
  assert.throws(() => parse(['#W#', '##']), /row/i, 'ragged rows');
  assert.throws(() => parse(['#.#', '###']), /Wren/, 'no Wren');
  assert.throws(() => parse(['WW']), /Wren/, 'two Wrens');
  assert.throws(() => parse(['W.x']), /'x'/, 'unknown character');
  assert.throws(() => parse(['W.T']), /'T'/, 'T is not a map character (Stumpcaps are ^ > v <)');
  assert.throws(() => parse(['WLL']), /lantern/i, 'two planted lanterns');
  assert.throws(() => parse([]), /map/i, 'empty map');
  assert.throws(() => parse(['']), /map/i, 'empty rows');
  assert.throws(() => parse('W..'), /map/i, 'map is not an array');
  assert.throws(() => parse(['W..', 7]), /row/i, 'row is not a string');
  assert.throws(() => parseLevel(undefined), /map/i);
});

test('parseLevel: the board is at most 9 columns by 11 rows', () => {
  assert.doesNotThrow(() => parse(['W........']));
  assert.throws(() => parse(['W.........']), /9/, '10 columns');
  const rows = (n) => ['W', ...Array.from({ length: n - 1 }, () => '.')];
  assert.doesNotThrow(() => parse(rows(11)));
  assert.throws(() => parse(rows(12)), /11/, '12 rows');
});

test('parseLevel: throws on a bad `under` entry', () => {
  assert.throws(() => parse(['W.M'], { under: { '5,0': 'a' } }), /under/, 'outside the map');
  assert.throws(() => parse(['W.M'], { under: { 'two,0': 'a' } }), /under/, 'key is not x,y');
  assert.throws(() => parse(['W.M'], { under: { '02,0': 'a' } }), /under/, 'key must be written the plain way, 2,0');
  assert.throws(() => parse(['W.M'], { under: { '2,0': 'M' } }), /under/, 'value is not terrain');
  assert.throws(() => parse(['W.M'], { under: { '2,0': 'bridge' } }), /under/, 'bridge is not a map terrain');
  assert.throws(() => parse(['W.M'], { under: { '1,0': 'a' } }), /under/, 'nothing stands at 1,0, so the map char is the terrain');
});

test('parseLevel: throws when something starts on terrain it could never stand on', () => {
  assert.throws(() => parse(['W.M'], { under: { '0,0': '~' } }), /Wren/);
  assert.throws(() => parse(['W.M'], { under: { '0,0': '#' } }), /Wren/);
  assert.throws(() => parse(['W.M'], { under: { '0,0': 'G' } }), /Wren/);
  assert.throws(() => parse(['W.L'], { under: { '0,0': 'H' } }), /Wren/, 'on Hush without the lantern');
  assert.throws(() => parse(['W.M'], { under: { '2,0': '~' } }), /Fluffmoth/);
  assert.throws(() => parse(['W.S'], { under: { '2,0': 'H' } }), /Shellwhelk/);
  assert.throws(() => parse(['W.>'], { under: { '2,0': '#' } }), /Stumpcap/);
  assert.throws(() => parse(['W.L'], { under: { '2,0': 'A' } }), /lantern/i, 'a lantern cannot be planted on a gate');
  assert.throws(() => parse(['W.L'], { under: { '2,0': 'H' } }), /lantern/i, 'nor on Hush');
});

test('parseLevel: errors name the level', () => {
  assert.throws(() => parseLevel({ id: '2-7', map: ['...'] }), /2-7/);
});

test('parseLevel: gates lists only the channels present in the level', () => {
  assert.deepEqual(parse(['W..']).gates, {});
  assert.deepEqual(parse(['WaA']).gates, { A: false });
  assert.deepEqual(parse(['WbBcC']).gates, { B: false, C: false });
});

test('parseLevel: runs light, gates and goal once at turn 0', () => {
  // A Stumpcap asleep on root a (out of the light) holds gate A open from the start.
  const open = parse(['W..>A'], { under: { '3,0': 'a' } });
  assert.deepEqual(light(open), ['11000']);
  assert.deepEqual(open.gates, { A: true });
  assert.equal(isGateOpen(open, 'A'), true);

  // A bud next to Wren's carried lantern is lit, so this (invalid) level starts solved.
  const solved = parse(['WG']);
  assert.deepEqual(solved.bloom, [1]);
  assert.equal(solved.solved, true);
  assert.deepEqual(solved.events, []);
});

test('parseLevel: bloom is parallel to buds (reading order); a bud lit at the start is already in bloom', () => {
  const s = parse(['G.W', '..G', 'G..']);   // Wren's carried light reaches only the bud at 2,1
  assert.deepEqual(s.buds, [{ x: 0, y: 0 }, { x: 2, y: 1 }, { x: 0, y: 2 }]);
  assert.deepEqual(s.bloom, [0, 1, 0]);
  assert.equal(s.solved, false);
  assert.deepEqual(parse(['W.']).bloom, [], 'no buds, no bloom flags');
});

// ---------------------------------------------------------------- accessors

test('terrainAt: returns the terrain char, and wall outside the board', () => {
  const s = parse(['W.#~GH', 'aAbBcC', '.M>...']);
  const row = (y) => Array.from({ length: 6 }, (_, x) => terrainAt(s, x, y));
  assert.deepEqual(row(0), ['.', '.', '#', '~', 'G', 'H']);
  assert.deepEqual(row(1), ['a', 'A', 'b', 'B', 'c', 'C']);
  assert.deepEqual(row(2), ['.', '.', '.', '.', '.', '.']);
  for (const [x, y] of [[-1, 0], [0, -1], [6, 0], [0, 3]]) assert.equal(terrainAt(s, x, y), '#');
});

test('creatureAt: the creature on a tile, or null', () => {
  const s = parse(['W.M', '..S']);
  assert.equal(creatureAt(s, 2, 0), only(s, 'M'));
  assert.equal(creatureAt(s, 2, 1), only(s, 'S'));
  assert.equal(creatureAt(s, 1, 0), null);
  assert.equal(creatureAt(s, 0, 0), null, 'Wren is not a creature');
  assert.equal(creatureAt(s, 9, 9), null);
});

test('isLit: reads the stored light map, false outside the board', () => {
  const s = parse(['W..', '...']);
  assert.deepEqual(s.lit, [1, 1, 0, 1, 0, 0]);   // index y*w+x
  assert.equal(isLit(s, 0, 0), true);
  assert.equal(isLit(s, 1, 0), true);
  assert.equal(isLit(s, 0, 1), true);
  assert.equal(isLit(s, 2, 0), false);
  assert.equal(isLit(s, -1, 0), false);
  assert.equal(isLit(s, 0, -1), false);
  assert.equal(isLit(s, 3, 0), false);
  assert.equal(isLit(s, 0, 2), false);
});

test('isGateOpen: false for a closed gate and for a channel the level does not have', () => {
  const s = parse(['WaA']);
  assert.equal(isGateOpen(s, 'A'), false);
  assert.equal(isGateOpen(s, 'B'), false);
});

test('isHidden / isAwake: a lit Shellwhelk is hidden, a lit Stumpcap is awake', () => {
  const s = parse(['.S.S', 'MW>.', '...>']);
  const [nearWhelk, farWhelk] = [creatureAt(s, 1, 0), creatureAt(s, 3, 0)];
  const [nearStump, farStump] = [creatureAt(s, 2, 1), creatureAt(s, 3, 2)];
  const moth = creatureAt(s, 0, 1);
  assert.equal(isHidden(s, nearWhelk), true);
  assert.equal(isHidden(s, farWhelk), false);
  assert.equal(isAwake(s, nearStump), true);
  assert.equal(isAwake(s, farStump), false);
  // Only a whelk hides and only a stump wakes, lit or not.
  assert.equal(isHidden(s, nearStump), false);
  assert.equal(isAwake(s, nearWhelk), false);
  assert.equal(isHidden(s, moth), false);
  assert.equal(isAwake(s, moth), false);
});

test('canEnter: the terrain table, for Wren and for each species', () => {
  //  x: 0123456
  //  0: W.#~GH.     Wren carries the lantern.
  //  1: aA>B.MS     The Stumpcap stands on root b, so gate B is open; root a is empty, so gate A is closed.
  const s = parse(['W.#~GH.', 'aA>B.MS'], { under: { '2,1': 'b' } });
  assert.deepEqual(s.gates, { A: false, B: true });
  const table = [
    // x, y, wren, M, S, T, what
    [1, 0, true, true, true, true, 'floor'],
    [2, 0, false, false, false, false, 'wall'],
    [3, 0, false, true, false, false, 'puddle: only a moth'],
    [4, 0, false, false, false, false, 'glowbud'],
    [5, 0, true, false, false, false, 'hush: only Wren, carrying'],
    [0, 1, true, true, true, true, 'root'],
    [1, 1, false, false, false, false, 'closed gate'],
    [3, 1, true, true, true, true, 'open gate'],
    [2, 1, false, false, false, false, 'a Stumpcap is there'],
    [5, 1, false, false, false, false, 'a Fluffmoth is there'],
    [6, 1, false, false, false, false, 'a Shellwhelk is there'],
    [-1, 0, false, false, false, false, 'out of bounds west'],
    [0, -1, false, false, false, false, 'out of bounds north'],
    [7, 0, false, false, false, false, 'out of bounds east'],
    [0, 2, false, false, false, false, 'out of bounds south'],
  ];
  for (const [x, y, wren, m, sw, t, what] of table) {
    assert.equal(canEnter(s, 'wren', x, y), wren, `wren, ${what}`);
    assert.equal(canEnter(s, 'M', x, y), m, `M, ${what}`);
    assert.equal(canEnter(s, 'S', x, y), sw, `S, ${what}`);
    assert.equal(canEnter(s, 'T', x, y), t, `T, ${what}`);
  }
  for (const who of ['M', 'S', 'T']) assert.equal(canEnter(s, who, 0, 0), false, `${who} onto Wren`);
});

test('canEnter: Wren may step onto the planted lantern, creatures may not; Hush needs the lantern in hand', () => {
  const s = parse(['L.WH']);
  assert.equal(canEnter(s, 'wren', 0, 0), true);
  for (const who of ['M', 'S', 'T']) assert.equal(canEnter(s, who, 0, 0), false, who);
  assert.equal(canEnter(s, 'wren', 3, 0), false, 'Hush without the lantern');
});

// ---------------------------------------------------------------- light (SPEC section 4)

test('light: carried radius is 1; the source and its four neighbours are lit, walls included', () => {
  assert.deepEqual(light(parse(['###', '#W#', '###'])), ['010', '111', '010']);
  assert.deepEqual(light(parse(['.....', '.....', '..W..', '.....', '.....'])), [
    '00000',
    '00100',
    '01110',
    '00100',
    '00000',
  ]);
});

test('light: planted radius is 2 (a diamond on open floor)', () => {
  assert.deepEqual(light(parse(['W....', '.....', '..L..', '.....', '.....'])), [
    '00100',
    '01110',
    '11111',
    '01110',
    '00100',
  ]);
});

test('light: a wall at the edge of the light is lit but does not pass light on', () => {
  assert.deepEqual(light(parse(['L#..W'])), ['11000']);
  assert.deepEqual(light(parse(['L...W'])), ['11100']);
});

test('light: a creature at the edge of the light is lit', () => {
  assert.deepEqual(light(parse(['L.S.W'])), ['11100']);
});

test('light: a creature next to a planted lantern casts a one-tile shadow behind itself', () => {
  for (const ch of ['M', 'S', '>']) assert.deepEqual(light(parse([`L${ch}..W`])), ['11000'], ch);
  // On an open board the tile straight behind the creature is dark, the diagonal is still reached the other way.
  assert.deepEqual(light(parse(['L>.', '...', '..W'])), ['110', '110', '100']);
  assert.deepEqual(light(parse(['L..', '...', '..W'])), ['111', '110', '100']);
});

test('light: the shadow falls behind the creature on whichever side of the lantern it stands', () => {
  const board = (mothX, mothY) => {
    const rows = ['W....', '.....', '..L..', '.....', '.....'].map((row) => [...row]);
    rows[mothY][mothX] = 'M';
    return light(parse(rows.map((row) => row.join(''))));
  };
  assert.deepEqual(board(3, 2), ['00100', '01110', '11110', '01110', '00100'], 'east');
  assert.deepEqual(board(1, 2), ['00100', '01110', '01111', '01110', '00100'], 'west');
  assert.deepEqual(board(2, 3), ['00100', '01110', '11111', '01110', '00000'], 'south');
  assert.deepEqual(board(2, 1), ['00000', '01110', '11111', '01110', '00100'], 'north');
});

test('light: bends round a corner at radius 2 if either in-between tile is transparent', () => {
  assert.deepEqual(light(parse(['L#.', '...', '..W'])), ['110', '110', '100']);
  assert.deepEqual(light(parse(['L.#', '#..', '..W'])), ['111', '110', '000']);
  assert.deepEqual(light(parse(['L#.', '#..', '..W'])), ['110', '100', '000'], 'both in-between tiles are walls');
});

test('light: Hush is never lit and does not pass light on', () => {
  assert.deepEqual(light(parse(['WH.'])), ['100']);
  assert.deepEqual(light(parse(['LH.W'])), ['1000']);
  assert.deepEqual(light(parse(['L.HW'])), ['1100']);
  assert.deepEqual(light(parse(['LH.', '...', '..W'])), ['100', '110', '100']);
});

test('light: Wren does not block light', () => {
  assert.deepEqual(light(parse(['LW..'])), ['1110']);
});

test('light: a lantern carried on Hush is smothered and lights nothing', () => {
  const s = parse(['W..', '...'], { under: { '0,0': 'H' } });
  assert.deepEqual(light(s), ['000', '000']);
  assert.deepEqual(s.lit, [0, 0, 0, 0, 0, 0]);
});

test('light: gates (even closed), buds, puddles and roots are transparent', () => {
  for (const ch of ['A', 'G', '~', 'a']) assert.deepEqual(light(parse([`L${ch}.W`])), ['1110'], ch);
});

// ---------------------------------------------------------------- Wren's movement (SPEC sections 1 and 2)

test('move: N E S W step one tile, a carried lantern moves with Wren, the turn counter goes up', () => {
  const s = parse(['...', '.W.', '...']);
  const cases = { N: [1, 0], E: [2, 1], S: [1, 2], W: [0, 1] };
  for (const [a, [x, y]] of Object.entries(cases)) {
    const n = step(s, a);
    assert.deepEqual(n.wren, { x, y }, a);
    assert.deepEqual(n.lantern, { x, y, carried: true }, a);
    assert.equal(n.turn, 1, a);
  }
  assert.deepEqual(light(step(s, 'E')), ['001', '011', '001'], 'the light is recomputed around the new position');
});

test('move: Wren cannot leave the board or enter a wall', () => {
  const s = parse(['W#']);
  for (const a of ['N', 'E', 'S', 'W']) assert.equal(step(s, a), null, a);
});

test('move: Wren cannot enter a puddle', () => {
  assert.equal(step(parse(['W~.']), 'E'), null);
});

test('move: Wren cannot enter a Glowbud', () => {
  const s = parse(['WG..G']);   // two buds, so that standing next to one does not solve the level
  assert.equal(s.solved, false);
  assert.equal(step(s, 'E'), null);
  assert.notEqual(step(s, 'Z'), null, 'the level is still in play');
});

test('move: Wren cannot enter a closed gate but may enter an open one', () => {
  const closed = parse(['WA.']);   // channel A has no root, so its gate never opens
  assert.equal(step(closed, 'E'), null);
  // A Stumpcap on root a, facing the board edge so that it stays there.
  const open = parse(['WA', '.>'], { under: { '1,1': 'a' } });
  assert.equal(isGateOpen(open, 'A'), true);
  assert.deepEqual(step(open, 'E').wren, { x: 1, y: 0 });
});

test("move: Wren cannot enter a creature's tile", () => {
  for (const ch of ['M', 'S', '>', '<']) assert.equal(step(parse([`W${ch}.`]), 'E'), null, ch);
});

test('move: Wren may walk onto a root', () => {
  assert.deepEqual(step(parse(['Wa']), 'E').wren, { x: 1, y: 0 });
});

test('move: Wren may walk onto the tile of the planted lantern', () => {
  const s = run(parse(['W..']), ['L', 'E']);   // plant at 0,0 and step away
  assert.deepEqual(s.lantern, { x: 0, y: 0, carried: false });
  const back = step(s, 'W');
  assert.deepEqual(back.wren, { x: 0, y: 0 });
  assert.deepEqual(back.lantern, { x: 0, y: 0, carried: false }, 'walking onto it does not pick it up');
});

test('move: Wren may enter Hush only while carrying the lantern, and the lantern is smothered there', () => {
  const s = parse(['.WH.']);
  const inHush = step(s, 'E');
  assert.deepEqual(inHush.wren, { x: 2, y: 0 });
  assert.deepEqual(light(inHush), ['0000']);
  assert.deepEqual(light(step(inHush, 'E')), ['0001'], 'it shines again on the far side (never on the Hush)');
  const planted = step(s, 'L');
  assert.equal(step(planted, 'E'), null, 'not without the lantern');
});

test('an unknown action is illegal', () => {
  const s = parse(['W.']);
  for (const a of ['X', 'e', '', 'NE', undefined, null, 'constructor', 'toString']) assert.equal(step(s, a), null, String(a));
});

test('an illegal action returns null and step never mutates its input', () => {
  // Wren (carrying) with a wall to the north and west; a moth, a whelk and a Stumpcap that all react.
  const s = deepFreeze(parse([
    '#######',
    '#W.~.H#',
    '#.M.S.#',
    '#a>.A.#',
    '#######',
  ]));
  const legal = { N: false, E: true, S: true, W: false, L: true, Z: true };
  for (const a of ACTIONS) {
    const before = JSON.stringify(s);
    const n = step(s, a);   // a write to the frozen input would throw here
    assert.equal(JSON.stringify(s), before, a);
    assert.equal(n !== null, legal[a], a);
    if (n) {
      assert.notEqual(n, s);
      assert.equal(n.turn, 1);
    }
  }
  assert.equal(s.turn, 0);
});

test('step never mutates: a long walk in which every state is deep-frozen', () => {
  // The bud at 3,0 blooms during the walk; the one in the corner can never be lit, so the walk never ends.
  let s = deepFreeze(parse([
    'G##G###',
    '#W.~.H#',
    '#.M.S.#',
    '#a>.A.#',
    '#..M..#',
    '#######',
  ]));
  let seed = 20261115;
  let moves = 0;
  for (let i = 0; i < 600; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    const a = ACTIONS[(seed >>> 16) % ACTIONS.length];
    const before = JSON.stringify(s);
    const n = step(s, a);
    assert.equal(JSON.stringify(s), before);
    if (n) {
      assert.equal(n.turn, s.turn + 1);
      moves++;
      s = deepFreeze(n);
    }
  }
  assert.ok(moves > 150, `the walk should mostly be legal moves, got ${moves}`);
  assert.deepEqual(s.bloom, [0, 1]);
});

test('step accepts a state that went through JSON (saved games)', () => {
  const s = parse(['W.~..', '..M.S', 'a>.A.']);
  const copy = JSON.parse(JSON.stringify(s));
  for (const a of ACTIONS) assert.deepEqual(step(copy, a), step(s, a), a);
});

// ---------------------------------------------------------------- the lantern

test("lantern: L plants the carried lantern on Wren's tile and the light grows to radius 2", () => {
  const s = parse(['.....', '.....', '..W..', '.....', '.....']);
  const p = step(s, 'L');
  assert.deepEqual(p.lantern, { x: 2, y: 2, carried: false });
  assert.deepEqual(p.wren, { x: 2, y: 2 });
  assert.equal(p.turn, 1);
  assert.deepEqual(light(p), ['00100', '01110', '11111', '01110', '00100']);
});

test('lantern: a planted lantern stays behind and keeps shining when Wren walks away', () => {
  const s = run(parse(['W....']), ['L', 'E', 'E', 'E']);
  assert.deepEqual(s.wren, { x: 3, y: 0 });
  assert.deepEqual(s.lantern, { x: 0, y: 0, carried: false });
  assert.deepEqual(light(s), ['11100']);
});

test('lantern: L picks the lantern up only when Wren stands on it', () => {
  const away = run(parse(['W..']), ['L', 'E']);
  assert.equal(step(away, 'L'), null, 'one tile away');
  const held = run(away, ['W', 'L']);
  assert.deepEqual(held.lantern, { x: 0, y: 0, carried: true });
  assert.deepEqual(light(held), ['110'], 'back to radius 1');
  assert.deepEqual(step(held, 'E').lantern, { x: 1, y: 0, carried: true }, 'and it moves with Wren again');
});

test('lantern: can be planted on floor and on a root, not on a gate and not on Hush', () => {
  assert.notEqual(step(parse(['W.']), 'L'), null, 'floor');
  assert.notEqual(step(parse(['W.'], { under: { '0,0': 'a' } }), 'L'), null, 'root');
  assert.equal(step(parse(['W.'], { under: { '0,0': 'A' } }), 'L'), null, 'gate');
  assert.equal(step(parse(['W.'], { under: { '0,0': 'H' } }), 'L'), null, 'Hush');
});

test('wait: Z is always legal, spends a turn and moves nothing', () => {
  const s = parse(['#W#']);
  const n = step(s, 'Z');
  assert.equal(n.turn, 1);
  assert.deepEqual(n.wren, s.wren);
  assert.deepEqual(n.lantern, s.lantern);
});

// ---------------------------------------------------------------- the goal

test('goal: a Glowbud lit in Light B comes into bloom; the level is solved when every bud is in bloom', () => {
  const s = parse(['G.W.G']);
  assert.deepEqual(s.bloom, [0, 0]);
  const west = step(s, 'W');   // Wren at 1,0: only the west bud is in the light
  assert.deepEqual(light(west), ['11100']);
  assert.deepEqual(west.bloom, [1, 0]);
  assert.equal(west.solved, false, 'one bud of two');
  assert.deepEqual(s.bloom, [0, 0], 'the earlier state keeps its own flags');
  const both = step(s, 'L');   // planted at 2,0: radius 2 reaches both buds in one turn
  assert.deepEqual(both.bloom, [1, 1]);
  assert.equal(both.solved, true);
});

test('goal: a bud stays in bloom after the light leaves', () => {
  const s = run(parse(['G.W.G']), ['W', 'E']);   // light the west bud, then step back
  assert.equal(isLit(s, 0, 0), false);
  assert.deepEqual(s.bloom, [1, 0]);
  const later = run(s, ['Z', 'Z', 'Z']);
  assert.deepEqual(later.bloom, [1, 0]);
  assert.equal(later.solved, false);
});

test('goal: buds far apart are solved by visiting each; solved fires on the turn the last one blooms', () => {
  // Six tiles apart: no lantern position lights both, which made this unsolvable under "all lit at once".
  const s = parse(['G..W..G']);
  const west = run(s, ['W', 'W']);            // Wren at 1,0
  assert.deepEqual(west.bloom, [1, 0]);
  assert.equal(west.solved, false);
  const nearly = run(west, ['E', 'E', 'E']);   // Wren at 4,0, the east bud still two tiles away
  assert.deepEqual(nearly.bloom, [1, 0]);
  assert.equal(nearly.solved, false);
  const done = step(nearly, 'E');              // Wren at 5,0
  assert.equal(isLit(done, 0, 0), false, 'the west bud is long out of the light');
  assert.deepEqual(done.bloom, [1, 1]);
  assert.equal(done.solved, true);
  assert.deepEqual(done.events, [wrenMove(4, 0, 5, 0), { type: 'bud', x: 6, y: 0, lit: true }, { type: 'solved' }]);
  for (const a of ACTIONS) assert.equal(step(done, a), null, a);
});

test('goal: a level without a Glowbud is never solved', () => {
  assert.equal(parse(['W.']).solved, false);
  assert.equal(run(parse(['W.']), ['E', 'L', 'Z']).solved, false);
});

test('goal: after the level is solved, step returns null for every action', () => {
  const solved = step(parse(['W.G']), 'E');
  assert.equal(solved.solved, true);
  for (const a of ACTIONS) assert.equal(step(solved, a), null, a);
  for (const a of ACTIONS) assert.equal(step(parse(['WG']), a), null, `starts solved, ${a}`);
});

// ---------------------------------------------------------------- turn order (SPEC section 2)

test('turn order: creatures react to the light as it is after the player acted (Light A), not to the old light', () => {
  // The Stumpcap is dark at the start. Wren steps next to it: it is lit now, so it walks this very turn.
  const s = parse(['W.>..']);
  assert.equal(isAwake(s, only(s, 'T')), false);
  assert.deepEqual(where(step(s, 'E')), ['TE@3,0']);
  // The whelk is lit (hiding) at the start. Wren steps away: it is dark now, so it creeps off this very turn.
  const t = parse(['.WS..']);
  assert.equal(isHidden(t, only(t, 'S')), true);
  assert.deepEqual(where(step(t, 'W')), ['S@3,0']);
});

test('turn order: Light A is fixed before any creature moves', () => {
  // x: 0123
  // 0: Lv>.   The planted lantern lights the south-facing Stumpcap at 1,0, which shades the one at 2,0.
  // 1: W...
  const s = parse(['Lv>.', 'W...']);
  assert.deepEqual(light(s), ['1100', '1100']);
  const n = step(s, 'Z');
  // The first Stumpcap walks south, out of the way. The second was dark in Light A, so it does not walk,
  // although Light B (the stored light) now reaches it.
  assert.deepEqual(where(n), ['TE@2,0', 'TS@1,1']);
  assert.deepEqual(light(n), ['1110', '1100']);
  assert.equal(isAwake(n, creatureAt(n, 2, 0)), true);
  // One turn later it is lit in Light A and walks.
  assert.deepEqual(where(step(n, 'Z')), ['TE@3,0', 'TS@1,1']);
});

test('turn order: creatures act left to right and see the moves made earlier in the same turn', () => {
  // Moving into a tile vacated earlier in the turn: the west moth goes first, the east one follows it.
  assert.deepEqual(where(step(parse(['W.MM']), 'Z')), ['M@1,0', 'M@2,0']);
  // Blocked by a creature that has not moved yet: the west moth goes first and finds the east one in its way.
  assert.deepEqual(where(step(parse(['MM.W']), 'Z')), ['M@0,0', 'M@2,0']);
});

test('turn order: the top row acts before the rows below, whatever the order of the creatures array', () => {
  // x: 01
  // 0: .M   Both moths want the tile 1,1. The one in the top row gets it;
  // 1: M.   the other finds it taken and takes its vertical step instead.
  // 2: .W
  const s = parse(['.M', 'M.', '.W']);
  const topId = creatureAt(s, 1, 0).id;
  const n = step(s, 'Z');
  assert.deepEqual(where(n), ['M@0,2', 'M@1,1']);
  assert.equal(creatureAt(n, 1, 1).id, topId);
  const reversed = { ...s, creatures: [...s.creatures].reverse() };
  const m = step(reversed, 'Z');
  assert.deepEqual(where(m), ['M@0,2', 'M@1,1']);
  assert.equal(creatureAt(m, 1, 1).id, topId);
});

test('turn order: a moth that settles leaves a bridge that a later creature can use in the same turn', () => {
  // The moth (first in reading order) settles in the puddle at 1,0; the lit Stumpcap then walks onto the bridge.
  const n = step(parse(['M~<W']), 'Z');
  assert.deepEqual(n.bridges, ['1,0']);
  assert.deepEqual(where(n), ['TW@1,0']);
});

// ---------------------------------------------------------------- the greedy step (SPEC section 3)

test('greedy step: the horizontal step comes first', () => {
  assert.deepEqual(where(step(parse(['M..', '...', '..W']), 'Z')), ['M@1,0']);
});

test('greedy step: the vertical step when the horizontal one is impossible or not wanted', () => {
  assert.deepEqual(where(step(parse(['M#.', '...', '..W']), 'Z')), ['M@0,1'], 'wall to the east');
  assert.deepEqual(where(step(parse(['M', '.', 'W']), 'Z')), ['M@0,1'], 'same column');
});

test('greedy step: stays when neither step is possible, and never goes round an obstacle', () => {
  assert.deepEqual(where(step(parse(['M#.', '#..', '..W']), 'Z')), ['M@0,0']);
  assert.deepEqual(where(step(parse(['M#W', '...']), 'Z')), ['M@0,0'], 'in line: there is no vertical wish');
});

test('greedy step: never onto Wren', () => {
  assert.deepEqual(where(step(parse(['MW']), 'Z')), ['M@0,0']);
  assert.deepEqual(where(run(parse(['M.', '.W']), ['Z', 'Z'])), ['M@1,0'], 'it stops next to her');
});

test('greedy step: never onto another creature', () => {
  // The whelk next to Wren is lit and stays; the moth behind it cannot pass.
  assert.deepEqual(where(step(parse(['MSW']), 'Z')), ['M@0,0', 'S@1,0']);
});

test('greedy step: never onto the planted lantern', () => {
  assert.deepEqual(where(run(parse(['M.L', 'W..']), ['Z', 'Z', 'Z'])), ['M@1,0']);
});

// ---------------------------------------------------------------- Fluffmoth

test('Fluffmoth: flies toward the planted lantern, not toward Wren', () => {
  assert.deepEqual(where(step(parse(['W.M.L']), 'Z')), ['M@3,0']);
});

test('Fluffmoth: follows the carried lantern, also from the dark', () => {
  const s = parse(['W......M']);
  assert.equal(isLit(s, 7, 0), false);
  assert.deepEqual(where(run(s, ['Z', 'Z', 'Z'])), ['M@4,0']);
});

test('Fluffmoth: a step into a puddle makes it settle: it leaves the creature list and the puddle becomes a bridge', () => {
  // The wall at 0,1 rules out the horizontal step, so the moth flies north into the puddle.
  const s = parse(['W~.', '#M#']);
  assert.equal(terrainAt(s, 1, 0), '~');
  const n = step(s, 'Z');
  assert.deepEqual(n.creatures, []);
  assert.deepEqual(n.bridges, ['1,0']);
  assert.equal(terrainAt(n, 1, 0), 'bridge');
  assert.equal(creatureAt(n, 1, 0), null);
  assert.equal(n.tiles, s.tiles, 'tiles never change and are shared');
  assert.deepEqual(s.bridges, []);
});

test('Fluffmoth: Wren can walk over the bridge and plant the lantern on it', () => {
  const s = step(parse(['W~.', '#M#']), 'Z');
  assert.equal(canEnter(s, 'wren', 1, 0), true);
  const on = step(s, 'E');
  assert.deepEqual(on.wren, { x: 1, y: 0 });
  assert.deepEqual(step(on, 'E').wren, { x: 2, y: 0 });
  assert.deepEqual(step(on, 'L').lantern, { x: 1, y: 0, carried: false });
});

test('Fluffmoth: creatures can cross a bridge, and a second moth does not settle on it', () => {
  // x: 01234
  //    W.~MM   The first moth settles at 2,0; the second follows it over the bridge.
  const start = parse(['W.~MM']);
  const a = step(start, 'Z');
  assert.deepEqual(a.bridges, ['2,0']);
  assert.deepEqual(where(a), ['M@3,0']);
  const b = step(a, 'Z');
  assert.deepEqual(where(b), ['M@2,0'], 'on the bridge, still a creature');
  assert.deepEqual(b.bridges, ['2,0']);
  assert.deepEqual(where(step(b, 'Z')), ['M@1,0']);
  for (const who of ['S', 'T']) {
    assert.equal(canEnter(start, who, 2, 0), false, `${who} cannot enter the puddle`);
    assert.equal(canEnter(a, who, 2, 0), true, `${who} can enter the bridge`);
  }
});

test('Fluffmoth: several bridges are kept sorted', () => {
  // Both moths are walled in on the west side, so each flies north into the puddle above it.
  const n = step(parse(['~W~', 'M#M']), 'Z');
  assert.deepEqual(n.creatures, []);
  assert.deepEqual(n.bridges, ['0,0', '2,0']);
});

test('Fluffmoth: ignores a smothered lantern', () => {
  const s = parse(['W..M'], { under: { '0,0': 'H' } });
  const n = step(s, 'Z');
  assert.deepEqual(where(n), ['M@3,0']);
  assert.deepEqual(where(step(n, 'E')), ['M@2,0'], 'it comes again once the lantern is out of the Hush');
});

// ---------------------------------------------------------------- Shellwhelk

test('Shellwhelk: lit, it hides in its shell and does not move', () => {
  const n = step(parse(['WS.']), 'Z');
  assert.deepEqual(where(n), ['S@1,0']);
  assert.equal(isHidden(n, only(n, 'S')), true);
});

test('Shellwhelk: unlit, it creeps one tile away from the lantern', () => {
  assert.deepEqual(where(step(parse(['W.S.']), 'Z')), ['S@3,0']);
  assert.deepEqual(where(step(parse(['.S.W']), 'Z')), ['S@0,0']);
  assert.deepEqual(where(step(parse(['W', '.', 'S', '.']), 'Z')), ['S@0,3']);
});

test('Shellwhelk: creeps away from the planted lantern, wherever Wren is', () => {
  assert.deepEqual(where(step(parse(['L..S..W']), 'Z')), ['S@4,0']);
  assert.deepEqual(where(step(parse(['L..SW']), 'Z')), ['S@3,0'], 'but never onto Wren');
});

test('Shellwhelk: uses the greedy step, horizontal first, vertical if that is blocked', () => {
  assert.deepEqual(where(step(parse(['W...', '....', '..S.', '....']), 'Z')), ['S@3,2']);
  assert.deepEqual(where(step(parse(['W...', '....', '..S#', '....']), 'Z')), ['S@2,3']);
  assert.deepEqual(where(step(parse(['W..', '...', '..S']), 'Z')), ['S@2,2'], 'cornered');
});

test('Shellwhelk: exactly in line with the lantern it only backs straight away', () => {
  // Same row as Wren with a wall behind it: it does not sidestep to 2,1.
  assert.deepEqual(where(step(parse(['W.S#', '....']), 'Z')), ['S@2,0']);
  // Same column as Wren with a wall behind it: it does not sidestep to 1,2.
  assert.deepEqual(where(step(parse(['W.', '..', 'S.', '#.']), 'Z')), ['S@0,2']);
});

test('Shellwhelk: cannot enter a puddle (or a wall, a Glowbud, Hush, a closed gate), but walks onto a root', () => {
  for (const ch of ['~', '#', 'G', 'H', 'A']) {
    const n = step(parse([`W.S${ch}`]), 'Z');
    assert.deepEqual(where(n), ['S@2,0'], ch);
    assert.deepEqual(n.bridges, [], ch);
  }
  assert.deepEqual(where(step(parse(['W.Sa']), 'Z')), ['S@3,0']);
});

test('Shellwhelk: stays put while the lantern is smothered', () => {
  const s = parse(['W.S.'], { under: { '0,0': 'H' } });
  assert.equal(isHidden(s, only(s, 'S')), false);
  assert.deepEqual(where(step(s, 'Z')), ['S@2,0']);
});

// ---------------------------------------------------------------- Stumpcap

test('Stumpcap: sleeps while it is unlit', () => {
  const n = step(parse(['W.>.']), 'Z');
  assert.deepEqual(where(n), ['TE@2,0']);
  assert.equal(isAwake(n, only(n, 'T')), false);
});

test('Stumpcap: lit, it walks one tile forward in its facing', () => {
  assert.deepEqual(where(step(parse(['W>.']), 'Z')), ['TE@2,0']);
  assert.deepEqual(where(step(parse(['.<W']), 'Z')), ['TW@0,0']);
  assert.deepEqual(where(step(parse(['.', '^', 'W']), 'Z')), ['TN@0,0']);
  assert.deepEqual(where(step(parse(['W', 'v', '.']), 'Z')), ['TS@0,2']);
});

test('Stumpcap: walks ahead of Wren as long as her light keeps reaching it', () => {
  // Z: lit, walks to 2,0 (now dark). Z: asleep. E, E: Wren catches up each turn and it walks each turn.
  assert.deepEqual(where(run(parse(['W>...']), ['Z', 'Z'])), ['TE@2,0']);
  assert.deepEqual(where(run(parse(['W>...']), ['Z', 'Z', 'E', 'E'])), ['TE@4,0']);
});

test('Stumpcap: bumps (stays where it is) when it cannot walk, and never turns', () => {
  const cases = [
    [['W>#'], 'TE@1,0', 'wall'],
    [['W>~'], 'TE@1,0', 'puddle'],
    [['W>A'], 'TE@1,0', 'closed gate'],
    [['W>H'], 'TE@1,0', 'Hush'],
    [['W>G'], 'TE@1,0', 'Glowbud'],
    [['W>'], 'TE@1,0', 'board edge'],
    [['.W<'], 'TW@2,0', 'Wren'],
    [['W.', 'L<'], 'TW@1,1', 'planted lantern'],
  ];
  for (const [map, expected, what] of cases) {
    const s = parse(map);
    assert.equal(isAwake(s, only(s, 'T')), true, what);
    assert.deepEqual(where(run(s, ['Z', 'Z'])), [expected], what);
  }
  // Another creature that has not moved yet is in the way too.
  assert.deepEqual(where(step(parse(['W>M']), 'Z')), ['M@2,0', 'TE@1,0']);
});

test('Stumpcap: cannot walk into a puddle, but walks over a bridge', () => {
  // Turn 1: the Stumpcap (first in reading order) bumps at the puddle, then the moth settles in it.
  const a = step(parse(['W>~.', '##M#']), 'Z');
  assert.deepEqual(where(a), ['TE@1,0']);
  assert.deepEqual(a.bridges, ['2,0']);
  assert.deepEqual(where(step(a, 'Z')), ['TE@2,0']);
});

test("Stumpcap: walks out of a planted lantern's light and stops on the first unlit tile", () => {
  let s = parse(['L>....W']);
  s = step(s, 'Z');
  assert.deepEqual(where(s), ['TE@2,0']);
  assert.equal(isLit(s, 2, 0), true);
  s = step(s, 'Z');
  assert.deepEqual(where(s), ['TE@3,0']);
  assert.equal(isLit(s, 3, 0), false);
  s = run(s, ['Z', 'Z']);
  assert.deepEqual(where(s), ['TE@3,0'], 'asleep on the first unlit tile');
});

// ---------------------------------------------------------------- roots and gates (SPEC section 2, phase 5)

test('roots: a Stumpcap presses a root whether asleep or awake', () => {
  const asleep = parse(['W.>A'], { under: { '2,0': 'a' } });
  assert.equal(isAwake(asleep, only(asleep, 'T')), false);
  assert.equal(isGateOpen(asleep, 'A'), true);
  const awake = parse(['W>#A'], { under: { '1,0': 'a' } });
  assert.equal(isAwake(awake, only(awake, 'T')), true);
  assert.equal(isGateOpen(awake, 'A'), true);
  assert.equal(isGateOpen(step(awake, 'Z'), 'A'), true);
});

test('roots: a Shellwhelk presses a root only while it is lit', () => {
  // The whelk sits on root a with a wall behind it, two tiles from Wren: dark, so the gate is closed.
  const s = parse(['W.S#A'], { under: { '2,0': 'a' } });
  assert.equal(isGateOpen(s, 'A'), false);
  const waited = step(s, 'Z');
  assert.deepEqual(where(waited), ['S@2,0']);
  assert.equal(isGateOpen(waited, 'A'), false);
  const near = step(s, 'E');   // Wren steps next to it: lit, hiding, heavy
  assert.equal(isHidden(near, only(near, 'S')), true);
  assert.equal(isGateOpen(near, 'A'), true);
  const away = step(near, 'W');   // and back: dark again, light again
  assert.equal(isGateOpen(away, 'A'), false);
});

test('roots: a whelk lit in Light A but dark in Light B does not move and is not heavy', () => {
  // x: 01234
  // 0: L.S.A   The whelk on root a (2,0) is lit by the planted lantern: gate A starts open.
  // 1: #M..W   The moth flies up to 1,0 and shades it.
  const s = parse(['L.S.A', '#M..W'], { under: { '2,0': 'a' } });
  assert.deepEqual(light(s), ['11100', '11000']);
  assert.equal(isGateOpen(s, 'A'), true);
  const n = step(s, 'Z');
  assert.deepEqual(where(n), ['M@1,0', 'S@2,0'], 'lit in Light A, so the whelk hid instead of creeping east');
  assert.deepEqual(light(n), ['11000', '10000']);
  assert.equal(isHidden(n, only(n, 'S')), false);
  assert.equal(isGateOpen(n, 'A'), false, 'dark in Light B, so it no longer presses the root');
  assert.deepEqual(where(step(n, 'Z')), ['M@1,0', 'S@3,0'], 'and next turn it creeps away');
});

test('roots: a whelk dark in Light A but lit in Light B is heavy', () => {
  // x: 0123
  // 0: LvS#   The Stumpcap at 1,0 shades the whelk on root a (2,0), then walks south out of the way.
  // 1: W..A   The whelk, dark in Light A, wants to creep east but the wall stops it.
  const s = parse(['LvS#', 'W..A'], { under: { '2,0': 'a' } });
  assert.equal(isGateOpen(s, 'A'), false);
  const n = step(s, 'Z');
  assert.deepEqual(where(n), ['S@2,0', 'TS@1,1']);
  assert.equal(isHidden(n, only(n, 'S')), true);
  assert.equal(isGateOpen(n, 'A'), true);
});

test('roots: Wren, a moth and the planted lantern never press a root', () => {
  const wrenOn = parse(['W.A'], { under: { '0,0': 'a' } });
  assert.equal(isGateOpen(wrenOn, 'A'), false);
  assert.equal(isGateOpen(step(wrenOn, 'L'), 'A'), false);
  assert.equal(isGateOpen(run(wrenOn, ['L', 'E']), 'A'), false);
  const mothOn = parse(['WM.A'], { under: { '1,0': 'a' } });
  assert.equal(isGateOpen(mothOn, 'A'), false);
  assert.equal(isGateOpen(step(mothOn, 'Z'), 'A'), false);
});

test('gates: a channel opens only when all of its roots are pressed', () => {
  // x: 01234
  // 0: W>a.A   The lit Stumpcap walks onto the root at 2,0.
  // 1: ....<   Another Stumpcap already sleeps on the root at 4,1.
  const s = parse(['W>a.A', '....<'], { under: { '4,1': 'a' } });
  assert.equal(isGateOpen(s, 'A'), false, 'one of two roots pressed');
  const n = step(s, 'Z');
  assert.deepEqual(where(n), ['TE@2,0', 'TW@4,1']);
  assert.equal(isGateOpen(n, 'A'), true, 'both pressed');
});

test('gates: a channel without a root never opens, and channels are independent', () => {
  const s = parse(['W.>B', 'A...'], { under: { '2,0': 'b' } });
  assert.deepEqual(s.gates, { A: false, B: true });
  assert.deepEqual(step(s, 'Z').gates, { A: false, B: true });
});

test('gates: the state stored at the end of a turn governs movement during the next turn', () => {
  // x: 012
  // 0: W>a   The Stumpcap acts first and steps onto the root.
  // 1: .AM   The moth then wants to go west into the gate, which was closed when the turn began.
  const s = parse(['W>a', '.AM']);
  const a = step(s, 'Z');
  assert.deepEqual(where(a), ['M@2,1', 'TE@2,0']);
  assert.equal(isGateOpen(a, 'A'), true, 'open from the end of this turn');
  assert.equal(canEnter(a, 'M', 1, 1), true);
  assert.deepEqual(where(step(a, 'Z')), ['M@1,1', 'TE@2,0'], 'now the moth goes through');
});

test('gates: a gate that was open when the turn began can be entered even if its root is released first', () => {
  // x: 0123
  // 0: W>..   The lit Stumpcap acts first and walks off root a (1,0).
  // 1: .AM.   The moth then flies west into gate A, still open for this turn. It closes around the moth.
  const s = parse(['W>..', '.AM.'], { under: { '1,0': 'a' } });
  assert.equal(isGateOpen(s, 'A'), true);
  const a = step(s, 'Z');
  assert.deepEqual(where(a), ['M@1,1', 'TE@2,0']);
  assert.equal(isGateOpen(a, 'A'), false);
  assert.deepEqual(where(step(a, 'Z')), ['M@0,1', 'TE@2,0'], 'and the moth steps out of the closed gate');
});

test('gates: a gate that closes around Wren lets her step out, but not back in', () => {
  // x: 0123
  // 0: .WA.   The whelk on root a (1,1) is lit by Wren next to it, so gate A starts open.
  // 1: .S..
  const s = parse(['.WA.', '.S..'], { under: { '1,1': 'a' } });
  assert.equal(isGateOpen(s, 'A'), true);
  const inside = step(s, 'E');   // Wren enters the gate; the whelk is dark now and creeps off the root
  assert.deepEqual(inside.wren, { x: 2, y: 0 });
  assert.deepEqual(where(inside), ['S@0,1']);
  assert.equal(isGateOpen(inside, 'A'), false);
  assert.deepEqual(step(inside, 'W').wren, { x: 1, y: 0 }, 'she can step back out');
  const out = step(inside, 'E');
  assert.deepEqual(out.wren, { x: 3, y: 0 }, 'or out the far side');
  assert.equal(step(out, 'W'), null, 'but the closed gate keeps her out');
});

test('gates: a creature standing in a closed gate can step out', () => {
  const s = parse(['W.M.'], { under: { '2,0': 'A' } });
  assert.equal(isGateOpen(s, 'A'), false);
  assert.deepEqual(where(step(s, 'Z')), ['M@1,0']);
});

test('goal: uses Light B, the light after the creatures have moved', () => {
  // x: 012
  // 0: W.G   Planting lights the bud two tiles east in Light A...
  // 1: #M.   ...but the moth flies up into the tile between and shades it: not solved.
  const n = step(parse(['W.G', '#M.']), 'L');
  assert.deepEqual(where(n), ['M@1,0']);
  assert.deepEqual(light(n), ['110', '100']);
  assert.deepEqual(n.bloom, [0], 'lit only in Light A: no bloom');
  assert.equal(n.solved, false);
  // The other way round: the Stumpcap shades the bud in Light A and walks out of the way: solved.
  const t = step(parse(['LvG', 'W..']), 'Z');
  assert.deepEqual(where(t), ['TS@1,1']);
  assert.deepEqual(t.bloom, [1]);
  assert.equal(t.solved, true);
});

// ---------------------------------------------------------------- events (SPEC section 7)

const wrenMove = (fx, fy, tx, ty) => ({ type: 'move', who: 'wren', from: { x: fx, y: fy }, to: { x: tx, y: ty } });

test('events: plant, pickup and wait', () => {
  const s = parse(['W.']);
  assert.deepEqual(step(s, 'Z').events, [{ type: 'wait' }]);
  const planted = step(s, 'L');
  assert.deepEqual(planted.events, [{ type: 'plant', x: 0, y: 0 }]);
  assert.deepEqual(step(planted, 'L').events, [{ type: 'pickup', x: 0, y: 0 }]);
});

test('events: only the events of the step that produced the state', () => {
  const s = run(parse(['W..']), ['E', 'Z']);
  assert.deepEqual(s.events, [{ type: 'wait' }]);
  assert.deepEqual(step(s, 'E').events, [wrenMove(1, 0, 2, 0)]);
});

test('events: a move with a moth settling (Wren, then the moth, then its settle)', () => {
  const s = parseLevel(firstLight);
  const moth = only(s, 'M').id;
  assert.deepEqual(step(s, 'E').events, [
    wrenMove(1, 1, 2, 1),
    { type: 'move', who: moth, from: { x: 4, y: 2 }, to: { x: 4, y: 1 } },
    { type: 'settle', id: moth, x: 4, y: 1 },
  ]);
});

test('events: a whelk hiding and a gate opening, then emerging and closing', () => {
  const s = parse(['W.S#A'], { under: { '2,0': 'a' } });
  const whelk = only(s, 'S').id;
  const near = step(s, 'E');
  assert.deepEqual(near.events, [
    wrenMove(0, 0, 1, 0),
    { type: 'hide', id: whelk },
    { type: 'gate', channel: 'A', open: true },
  ]);
  assert.deepEqual(step(near, 'Z').events, [{ type: 'wait' }], 'nothing changes while it stays lit');
  assert.deepEqual(step(near, 'W').events, [
    wrenMove(1, 0, 0, 0),
    { type: 'emerge', id: whelk },
    { type: 'gate', channel: 'A', open: false },
  ]);
});

test('events: a bud lighting and solved', () => {
  assert.deepEqual(step(parse(['W.G']), 'E').events, [
    wrenMove(0, 0, 1, 0),
    { type: 'bud', x: 2, y: 0, lit: true },
    { type: 'solved' },
  ]);
});

test('events: a bud event is emitted once, on the turn the bud comes into bloom', () => {
  const s = parse(['G.W.G']);
  const west = step(s, 'W');
  assert.deepEqual(west.events, [wrenMove(2, 0, 1, 0), { type: 'bud', x: 0, y: 0, lit: true }]);
  assert.deepEqual(step(west, 'Z').events, [{ type: 'wait' }], 'nothing while it stays lit');
  const away = step(west, 'E');
  assert.deepEqual(away.events, [wrenMove(1, 0, 2, 0)], 'nothing when the light leaves');
  assert.deepEqual(step(away, 'W').events, [wrenMove(2, 0, 1, 0)], 'and nothing when the light comes back');
  assert.deepEqual(step(s, 'L').events, [
    { type: 'plant', x: 2, y: 0 },
    { type: 'bud', x: 0, y: 0, lit: true },
    { type: 'bud', x: 4, y: 0, lit: true },
    { type: 'solved' },
  ], 'two buds at once, in reading order');
});

test('events: a Stumpcap waking, bumping and going back to sleep', () => {
  const s = parse(['W.>#']);
  const stump = only(s, 'T').id;
  const near = step(s, 'E');
  assert.deepEqual(near.events, [wrenMove(0, 0, 1, 0), { type: 'bump', id: stump }, { type: 'wake', id: stump }]);
  assert.deepEqual(step(near, 'Z').events, [{ type: 'wait' }, { type: 'bump', id: stump }], 'it bumps every lit turn');
  assert.deepEqual(step(near, 'W').events, [wrenMove(1, 0, 0, 0), { type: 'sleep', id: stump }]);
});

test('events: a Stumpcap that walks out of the light moves, then sleeps', () => {
  const s = parse(['W>.']);
  const stump = only(s, 'T').id;
  assert.deepEqual(step(s, 'Z').events, [
    { type: 'wait' },
    { type: 'move', who: stump, from: { x: 1, y: 0 }, to: { x: 2, y: 0 } },
    { type: 'sleep', id: stump },
  ]);
});

test('events: creature moves come first, then light changes, then gates', () => {
  // The two Light B maps from the roots tests above.
  const a = parse(['LvS#', 'W..A'], { under: { '2,0': 'a' } });
  assert.deepEqual(step(a, 'Z').events, [
    { type: 'wait' },
    { type: 'move', who: only(a, 'T').id, from: { x: 1, y: 0 }, to: { x: 1, y: 1 } },
    { type: 'hide', id: only(a, 'S').id },
    { type: 'gate', channel: 'A', open: true },
  ]);
  const b = parse(['L.S.A', '#M..W'], { under: { '2,0': 'a' } });
  assert.deepEqual(step(b, 'Z').events, [
    { type: 'wait' },
    { type: 'move', who: only(b, 'M').id, from: { x: 1, y: 1 }, to: { x: 1, y: 0 } },
    { type: 'emerge', id: only(b, 'S').id },
    { type: 'gate', channel: 'A', open: false },
  ]);
});

test('events: creatures are reported in the order they act', () => {
  const s = parse(['W.MM']);
  const [first, second] = [creatureAt(s, 2, 0).id, creatureAt(s, 3, 0).id];
  assert.deepEqual(step(s, 'Z').events, [
    { type: 'wait' },
    { type: 'move', who: first, from: { x: 2, y: 0 }, to: { x: 1, y: 0 } },
    { type: 'move', who: second, from: { x: 3, y: 0 }, to: { x: 2, y: 0 } },
  ]);
});

// ---------------------------------------------------------------- key (SPEC section 7)

test('key: a short string', () => {
  const k = key(parse(['W.M.S', '.>~..']));
  assert.equal(typeof k, 'string');
  assert.ok(k.length <= 8, `key has ${k.length} characters`);
});

test('key: equal for states that differ only in turn and events', () => {
  const a = parse(['W..']);
  const b = run(a, ['E', 'W']);
  assert.notEqual(a.turn, b.turn);
  assert.notDeepEqual(a.events, b.events);
  assert.equal(key(a), key(b));
  assert.equal(key(a), key(step(a, 'Z')));
});

test('key: equal for states that differ only in creature ids and array order', () => {
  const a = parse(['W...', '.M.S', '.>.<']);
  const b = { ...a, creatures: [...a.creatures].reverse().map((c, i) => ({ ...c, id: `renamed${i}` })) };
  assert.equal(key(a), key(b));
});

test('key: different when Wren, the lantern, a creature or a bridge differs', () => {
  const a = parse(['W..']);
  assert.notEqual(key(a), key(step(a, 'E')), 'Wren moved');
  assert.notEqual(key(a), key(step(a, 'L')), 'lantern planted under Wren instead of carried');
  const plantedWest = run(a, ['L', 'E']);   // lantern at 0,0, Wren at 1,0
  const plantedHere = run(a, ['E', 'L']);   // lantern at 1,0, Wren at 1,0
  const carried = step(a, 'E');             // lantern carried, Wren at 1,0
  assert.equal(new Set([key(plantedWest), key(plantedHere), key(carried)]).size, 3);

  assert.notEqual(key(parse(['W.M.'])), key(parse(['W..M'])), 'creature position');
  const kinds = ['M', 'S', '^', '>', 'v', '<'].map((ch) => key(parse([`W.${ch}`])));
  assert.equal(new Set(kinds).size, 6, 'species and facing');

  const bridged = step(parse(['W~.', '#M#']), 'Z');   // the moth settled at 1,0
  assert.notEqual(key(bridged), key(parse(['W~.', '###'])), 'a bridge');
  // A creature and a bridge swapping places must not look the same.
  const base = parse(['W~~', '...']);
  const moth = (x) => [{ id: 'M1', type: 'M', x, y: 1, dir: null }];
  const one = { ...base, bridges: ['1,0'], creatures: moth(2) };
  const two = { ...base, bridges: ['2,0'], creatures: moth(1) };
  assert.notEqual(key(one), key(two));
});

test('key: different when the bloom flags differ', () => {
  const start = parse(['G.W.G']);
  const west = run(start, ['W', 'E']);   // back on the start tile, the west bud in bloom
  const east = run(start, ['E', 'W']);   // back on the start tile, the east bud in bloom
  assert.deepEqual([start.bloom, west.bloom, east.bloom], [[0, 0], [1, 0], [0, 1]]);
  assert.deepEqual([west.wren, east.wren], [start.wren, start.wren]);
  assert.equal(new Set([key(start), key(west), key(east)]).size, 3);
});

test('key: tells every bud apart on a board with many buds', () => {
  const s = parse(['GGGGGGGGG', '.........', '....W....', '.........', 'GGGGGGGGG']);
  assert.equal(s.bloom.length, 18);
  const oneInBloom = s.bloom.map((_, i) => key({ ...s, bloom: s.bloom.map((__, j) => (i === j ? 1 : 0)) }));
  assert.equal(new Set([key(s), ...oneInBloom]).size, 19);
});

test('key: two states share a key exactly when they share Wren, lantern, creatures, bridges and bloom', () => {
  // Enumerate positions breadth-first, telling them apart by a slow but obviously right description, and
  // check that key() draws exactly the same distinctions.
  const canon = (s) => JSON.stringify([
    s.wren, s.lantern, s.creatures.map((c) => [c.type, c.x, c.y, c.dir]).sort(), s.bridges, s.bloom,
  ]);
  const boards = [
    [['W...~....', '....#.S..', 'a>...~.<.', '.....A...', '..M....^.'], 4000],
    [['G...W...G', '.........', '.S..G....', '.........', 'G.......#'], 1500],   // four buds, never all in bloom
  ];
  for (const [map, atLeast] of boards) {
    const start = parse(map);
    const keyOf = new Map([[canon(start), key(start)]]);
    const queue = [start];
    for (let head = 0; head < queue.length && keyOf.size < 4000; head++) {
      for (const a of ACTIONS) {
        const n = step(queue[head], a);
        if (!n) continue;
        const c = canon(n);
        if (keyOf.has(c)) {
          assert.equal(key(n), keyOf.get(c), 'one position, two keys');
        } else {
          keyOf.set(c, key(n));
          queue.push(n);
        }
      }
    }
    assert.ok(keyOf.size >= atLeast, `expected a big state space, found ${keyOf.size}`);
    assert.equal(new Set(keyOf.values()).size, keyOf.size, 'two positions, one key');
  }
});

// ---------------------------------------------------------------- the worked example (SPEC section 5)

test('worked example: level 1-1 is solved by E, E, E, E, E exactly as section 5 describes', () => {
  assert.deepEqual(firstLight.map, ['#########', '#W..~..G#', '####M####', '#########']);
  let s = parseLevel(firstLight);
  assert.deepEqual(s.wren, { x: 1, y: 1 });
  assert.deepEqual(s.lantern, { x: 1, y: 1, carried: true });
  assert.deepEqual(where(s), ['M@4,2']);
  assert.equal(terrainAt(s, 4, 1), '~');
  assert.equal(terrainAt(s, 3, 2), '#', 'the wall that rules out the horizontal step');
  assert.equal(s.solved, false);

  s = step(s, 'E');   // the moth wants hx -1, vy -1; 3,2 is a wall, so it flies up into the puddle and settles
  assert.deepEqual(s.wren, { x: 2, y: 1 });
  assert.deepEqual(s.creatures, []);
  assert.deepEqual(s.bridges, ['4,1']);
  assert.equal(terrainAt(s, 4, 1), 'bridge');

  s = step(s, 'E');
  assert.deepEqual(s.wren, { x: 3, y: 1 });
  s = step(s, 'E');
  assert.deepEqual(s.wren, { x: 4, y: 1 }, 'onto the bridge');
  s = step(s, 'E');
  assert.deepEqual(s.wren, { x: 5, y: 1 });
  assert.equal(isLit(s, 7, 1), false);
  assert.equal(s.solved, false);
  s = step(s, 'E');
  assert.deepEqual(s.wren, { x: 6, y: 1 });
  assert.equal(isLit(s, 7, 1), true, 'the Glowbud is within radius 1');
  assert.equal(s.solved, true);
  assert.equal(s.turn, 5);
});

test('worked example: without the bridge Wren cannot pass the puddle', () => {
  const s = run(parseLevel({ ...firstLight, map: ['#########', '#W..~..G#', '####.####', '#########'] }), ['E', 'E']);
  assert.deepEqual(s.wren, { x: 3, y: 1 });
  assert.equal(step(s, 'E'), null);
});

// ---------------------------------------------------------------- cross-check against a naive reference

// A second implementation of SPEC sections 1 to 4, written to be read next to the spec rather than to be
// fast: it copies everything, keeps light as a set of 'x,y' strings and recomputes all of it every turn.
// It returns what step() must agree with (everything except turn and events), or null for an illegal action.
function referenceStep(s, action) {
  if (s.solved) return null;
  const tile = (x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? '#' : s.tiles[y][x]);
  const at = (x, y) => `${x},${y}`;
  let wren = { ...s.wren };
  let lantern = { ...s.lantern };
  const creatures = s.creatures.map((c) => ({ ...c }));
  const bridges = [...s.bridges];
  const creatureOn = (x, y) => creatures.find((c) => c.x === x && c.y === y);

  const canEnter = (who, x, y) => {
    const ch = tile(x, y);
    let terrainOk;
    if (ch === '#' || ch === 'G') terrainOk = false;
    else if (ch === '.' || 'abc'.includes(ch)) terrainOk = true;
    else if (ch === '~') terrainOk = who === 'M' || bridges.includes(at(x, y));
    else if (ch === 'H') terrainOk = who === 'wren' && lantern.carried;
    else terrainOk = s.gates[ch] === true;   // a gate: the state stored at the end of the previous turn
    if (!terrainOk || creatureOn(x, y)) return false;
    if (who === 'wren') return true;
    if (wren.x === x && wren.y === y) return false;
    return lantern.carried || lantern.x !== x || lantern.y !== y;
  };

  const light = () => {
    const lit = new Set();
    if (lantern.carried && tile(lantern.x, lantern.y) === 'H') return lit;   // smothered
    const transparent = (x, y) => tile(x, y) !== '#' && tile(x, y) !== 'H' && !creatureOn(x, y);
    lit.add(at(lantern.x, lantern.y));
    let frontier = [[lantern.x, lantern.y]];
    for (let d = 0; d < (lantern.carried ? 1 : 2); d++) {
      const next = [];
      for (const [x, y] of frontier) {
        if (d > 0 && !transparent(x, y)) continue;
        for (const [dx, dy] of Object.values(DIRS)) {
          const [nx, ny] = [x + dx, y + dy];
          if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h || tile(nx, ny) === 'H' || lit.has(at(nx, ny))) continue;
          lit.add(at(nx, ny));
          next.push([nx, ny]);
        }
      }
      frontier = next;
    }
    return lit;
  };

  // Phase 1.
  if (action === 'N' || action === 'E' || action === 'S' || action === 'W') {
    const [x, y] = [wren.x + DIRS[action][0], wren.y + DIRS[action][1]];
    if (!canEnter('wren', x, y)) return null;
    wren = { x, y };
    if (lantern.carried) lantern = { x, y, carried: true };
  } else if (action === 'L') {
    const { x, y } = wren;
    if (lantern.carried) {
      const ch = tile(x, y);
      if (!(ch === '.' || 'abc'.includes(ch) || (ch === '~' && bridges.includes(at(x, y))))) return null;
      lantern = { x, y, carried: false };
    } else if (lantern.x === x && lantern.y === y) {
      lantern = { x, y, carried: true };
    } else {
      return null;
    }
  } else if (action !== 'Z') {
    return null;
  }

  // Phases 2 and 3.
  const lightA = light();
  const smothered = lantern.carried && tile(lantern.x, lantern.y) === 'H';
  for (const c of [...creatures].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const lit = lightA.has(at(c.x, c.y));
    let [x, y] = [c.x, c.y];
    if (c.type === 'T') {
      if (!lit || !canEnter('T', x + DIRS[c.dir][0], y + DIRS[c.dir][1])) continue;
      x += DIRS[c.dir][0];
      y += DIRS[c.dir][1];
    } else {
      if (smothered || (c.type === 'S' && lit)) continue;
      const toward = c.type === 'M' ? 1 : -1;
      const hx = Math.sign(lantern.x - x) * toward;
      const vy = Math.sign(lantern.y - y) * toward;
      if (hx !== 0 && canEnter(c.type, x + hx, y)) x += hx;
      else if (vy !== 0 && canEnter(c.type, x, y + vy)) y += vy;
      else continue;
    }
    c.x = x;
    c.y = y;
    if (c.type === 'M' && tile(x, y) === '~' && !bridges.includes(at(x, y))) {
      creatures.splice(creatures.indexOf(c), 1);
      bridges.push(at(x, y));
      bridges.sort();
    }
  }

  // Phases 4 to 6.
  const lightB = light();
  const gates = {};
  for (const channel of Object.keys(s.gates)) {
    const roots = [];
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) if (tile(x, y) === channel.toLowerCase()) roots.push([x, y]);
    gates[channel] = roots.length > 0 && roots.every(([x, y]) => {
      const c = creatureOn(x, y);
      return c !== undefined && (c.type === 'T' || (c.type === 'S' && lightB.has(at(x, y))));
    });
  }
  const lit = [];
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) lit.push(lightB.has(at(x, y)) ? 1 : 0);
  const bloom = s.buds.map((b, i) => (s.bloom[i] === 1 || lightB.has(at(b.x, b.y)) ? 1 : 0));   // never back to 0
  const solved = bloom.length > 0 && bloom.every((flag) => flag === 1);
  return { wren, lantern, creatures, bridges, lit, gates, bloom, solved };
}

test('step agrees with a naive reference implementation on every move of thousands of positions', async (t) => {
  const boards = {
    'all three species, a root and a gate': ['W...~....', '....#.S..', 'a>...~.<.', '.....A...', '..M....^.'],
    'a lantern that starts planted': ['L..S.....', '..#..M...', 'W...~..G.', '..v...b.B'],
    'two whelks and two channels': ['W..a.A...', '.S.....S.', '..b.B....', '...~M....', 'G........'],
    'Hush': ['W.H.M....', '..H...S..', '.>HHH....', '....~....', '..G......'],
    'moths and puddles': ['W.......M', '.~.~.~.~.', 'M...M...M', '.........'],
    'buds far apart, with a whelk and a moth': ['G...W...G', '.S.....M.', '....G....', 'G.......#'],
    'four Stumpcaps and two buds': ['..v.G....', '.W.>.a.A.', '..^.S..G.', '.<..~M...'],
  };
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  for (const [name, map] of Object.entries(boards)) {
    await t.test(name, () => {
      const start = parse(map);
      const seen = new Set([key(start)]);
      const queue = [start];
      let compared = 0;
      for (let head = 0; head < queue.length; head++) {
        const s = queue[head];
        for (const a of ACTIONS) {
          const actual = step(s, a);
          const expected = referenceStep(s, a);
          compared++;
          if (expected === null) {
            assert.equal(actual, null, `${a} should be illegal after ${JSON.stringify(s)}`);
            continue;
          }
          assert.notEqual(actual, null, `${a} should be legal after ${JSON.stringify(s)}`);
          const { wren, lantern, bridges, lit, gates, bloom, solved } = actual;
          assert.deepEqual(
            { wren, lantern, creatures: [...actual.creatures].sort(byId), bridges, lit, gates, bloom, solved },
            { ...expected, creatures: expected.creatures.sort(byId) },
            `${a} after ${JSON.stringify(s)}`,
          );
          if (!seen.has(key(actual)) && seen.size < 2500) {
            seen.add(key(actual));
            queue.push(actual);
          }
        }
      }
      assert.ok(compared >= 1000, `only ${compared} moves compared`);
    });
  }
});
