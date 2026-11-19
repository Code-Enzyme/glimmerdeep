// Board talk (SPEC section 28): the board in words, for TalkBack and the spoken description.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step } from '../src/engine.js';
import { where, sides, describeBoard, describeTurn, describeRefusal, describeBack } from '../src/ui/talk.js';

const board = (map, extra = {}) => parseLevel({ id: 'talk', map, ...extra });
const play = (state, moves) => moves.split('').reduce((s, a) => {
  const next = step(s, a);
  assert.ok(next, `move ${a} should be legal`);
  return next;
}, state);

test('talk: places are counted from Wren, the north/south part first, numbers to ten as words', () => {
  assert.equal(where(0, 0), 'here');
  assert.equal(where(0, -2), 'two tiles north');
  assert.equal(where(1, 0), 'one tile east');
  assert.equal(where(-1, 3), 'three tiles south and one west');
  assert.equal(where(2, -1), 'one tile north and two east');
  assert.equal(where(10, 0), 'ten tiles east');
  assert.equal(where(0, 12), '12 tiles south');
});

test('talk: the sides of a tile go north, east, south, west, joined when alike', () => {
  const s = board(['#####', '#.~G#', '#MW.#', '#####']);
  assert.equal(sides(s), 'A puddle to the north, open to the east, wall to the south, a Fluffmoth to the west.');
  const corridor = board(['#####', '#W.G#', '#####']);
  assert.equal(sides(corridor), 'Wall to the north, south and west, open to the east.');
  const room = board(['#####', '#...#', '#.W.#', '#...#', '#G..#', '#####']);
  assert.equal(sides(room), 'Open all round.');
  const edge = board(['W.G']);
  assert.equal(sides(edge), 'Wall to the north, south and west, open to the east.');
});

test('talk: the whole board, first light', () => {
  const s = board(['#########', '#W..~..G#', '####M####', '#########']);
  assert.deepEqual(describeBoard(s, { par: 5 }), [
    'Move 0, par 5.',
    'Wren carries the lantern.',
    'Wall to the north, south and west, open to the east.',
    'One bud to light: six tiles east.',
    'Fluffmoth, one tile south and three east, in the dark.',
    'A puddle: three tiles east.',
  ]);
});

test('talk: every creature, nearest first, then reading order, with its state', () => {
  const s = board(['#########', '#W.>..e.#', '#K.S.\\O.#', '#......G#', '#########']);
  assert.deepEqual(describeBoard(s), [
    'Move 0.',
    'Wren carries the lantern.',
    'Wall to the north and west, open to the east, an Emberwick to the south.',
    'One bud to light: two tiles south and six east.',
    'Emberwick, one tile south, cold.',
    'Stumpcap, two tiles east, facing east, asleep.',
    'Shellwhelk, one tile south and two east, in the dark.',
    'Dozer newt, five tiles east, facing east, wandering.',
    'Mirrorbeetle, one tile south and four east, mirror leaning left, in the dark.',
    'Gloamling, one tile south and five east.',
  ]);
});

test('talk: a planted lantern, and creatures in its light', () => {
  const s = board(['#########', '#.>.L.S.#', '#W...M.G#', '#########']);
  assert.deepEqual(describeBoard(s), [
    'Move 0.',
    'The lantern stands one tile north and three east.',
    'Open to the north and east, wall to the south and west.',
    'One bud to light: six tiles east.',
    'Stumpcap, one tile north and one east, facing east, awake.',
    'Fluffmoth, four tiles east, in the light.',
    'Shellwhelk, one tile north and five east, hiding in its shell.',
  ]);
});

test('talk: buds in bloom, gates and their roots', () => {
  const s = play(board(['#######', '#W.G..#', '#.a.A.#', '#....G#', '#######']), 'E');
  assert.deepEqual(describeBoard(s, { par: 9 }), [
    'Move 1, par 9.',
    'Wren carries the lantern.',
    'Wall to the north, a bud to the east, root A to the south, open to the west.',
    'One bud to light: two tiles south and three east.',
    'One in bloom.',
    'Gate A, shut: one tile south and two east.',
    'Root A: one tile south.',
  ]);
});

test('talk: a bridge a moth made is listed after the puddles', () => {
  const s = step(board(['#########', '#W..~..G#', '####M####', '#########']), 'E');
  assert.deepEqual(describeBoard(s, { par: 5 }), [
    'Move 1, par 5.',
    'Wren carries the lantern.',
    'Wall to the north and south, open to the east and west.',
    'One bud to light: five tiles east.',
    'A bridge: two tiles east.',
  ]);
  const two = play(board(['#########', '#W.~.~.G#', '###M#M###', '#########']), 'Z');
  const words = describeBoard(two);
  assert.ok(words.includes('Bridges: two tiles east; four tiles east.'), words.join('\n'));
  assert.ok(!words.some((line) => line.startsWith('A puddle') || line.startsWith('Puddles')), words.join('\n'));
});

test('talk: several buds and puddles are listed nearest first', () => {
  const s = board(['#########', '#G.~W.~G#', '#...~...#', '#G......#', '#########']);
  const words = describeBoard(s);
  assert.ok(words.includes('Three buds to light: three tiles west; three tiles east; two tiles south and three west.'), words.join('\n'));
  assert.ok(words.includes('Puddles: one tile west; one tile south; two tiles east.'), words.join('\n'));
});

test('talk: the lantern smothered in the Hush, aimed, or put out by a Gloamling', () => {
  const hush = play(board(['######', '#WH.G#', '######']), 'E');
  assert.deepEqual(describeBoard(hush).slice(1, 3), ['Wren carries the lantern in the Hush.', 'It is smothered.']);

  const aimed = play(board(['#######', '#W....#', '#....G#', '#######'], { shutter: true }), 'ELWL');
  assert.deepEqual(describeBoard(aimed).slice(1, 3), ['The lantern stands one tile east.', 'It shines a beam east.']);

  const out = play(board(['#######', '#W.O.G#', '#######']), 'Z');
  assert.deepEqual(describeBoard(out).slice(1, 3), ['Wren carries the lantern.', 'Its light is out.']);
});

test('talk: a Gloam encounter says where the Hush is closest', () => {
  const map = ['#######', '#W...G#', '#.....#', '#H....#', '#######'];
  assert.ok(describeBoard(board(map, { gloam: true })).includes('The Hush is closest two tiles south.'));
  assert.ok(!describeBoard(board(map)).some((line) => line.startsWith('The Hush is closest')));
});

test('talk: a move says what Wren did, what the creatures did, and the new sides', () => {
  const first = board(['#########', '#W..~..G#', '####M####', '#########']);
  assert.equal(describeTurn(step(first, 'E')),
    'Wren steps east. Fluffmoth lands in the puddle two tiles east and makes a bridge. '
    + 'Wall to the north and south, open to the east and west.');

  const moth = board(['########', '#W..M.G#', '########']);
  assert.equal(describeTurn(step(moth, 'Z')),
    'Wren waits. Fluffmoth flies, now two tiles east. Wall to the north, south and west, open to the east.');

  const gloam = board(['#######', '#W.O.G#', '#######']);
  assert.equal(describeTurn(step(gloam, 'Z')),
    'Wren waits. Gloamling drifts, now one tile east. Wall to the north, south and west, a Gloamling to the east.');
});

test('talk: the lantern actions', () => {
  const s = board(['#######', '#W....#', '#....G#', '#######'], { shutter: true });
  const planted = play(s, 'EL');
  assert.equal(describeTurn(planted), 'Wren plants the lantern. Wall to the north, open to the east, south and west.');
  const aimed = play(planted, 'WL');
  assert.equal(describeTurn(aimed), 'Wren aims the lantern east. Wall to the north and west, the lantern to the east, open to the south.');
  const opened = play(aimed, 'L');
  assert.equal(describeTurn(opened), "Wren opens the lantern's shutter. Wall to the north and west, the lantern to the east, open to the south.");
  const picked = play(opened, 'EL');
  assert.equal(describeTurn(picked), 'Wren picks up the lantern. Wall to the north, open to the east, south and west.');
});

test('talk: buds that bloom, the buds still to go, and a solved cavern', () => {
  const two = board(['#######', '#W.G.G#', '#######']);
  assert.equal(describeTurn(step(two, 'E')),
    'Wren steps east. A bud blooms. One bud to go. Wall to the north and south, a bud to the east, open to the west.');
  const one = board(['#####', '#W.G#', '#####']);
  assert.equal(describeTurn(step(one, 'E')), 'Wren steps east. A bud blooms. Every bud is in bloom.');
});

test('talk: every creature event has its words', () => {
  const s = board(['#########', '#W.>..e.#', '#K.S.\\O.#', '#......G#', '#########']);
  const said = (events) => describeTurn({ ...s, events });
  const tail = ' Wall to the north and west, open to the east, an Emberwick to the south.';
  const move = (who) => ({ type: 'move', who, from: { x: 4, y: 1 }, to: { x: 3, y: 1 } });
  assert.equal(said([{ type: 'wait' }, move('M1'), move('S1'), move('T1'), move('D1'), move('K1'), move('O1'), move('R1')]),
    'Wren waits. Fluffmoth flies, now two tiles east. Shellwhelk creeps, now two tiles east. Stumpcap marches, now two tiles east. '
    + 'Dozer newt wanders, now two tiles east. Emberwick follows, now two tiles east. Gloamling drifts, now two tiles east. '
    + 'Mirrorbeetle crawls, now two tiles east.' + tail);
  assert.equal(said([
    { type: 'wait' }, { type: 'bump', id: 'T1' }, { type: 'hide', id: 'S1' }, { type: 'emerge', id: 'S1' },
    { type: 'wake', id: 'T1' }, { type: 'sleep', id: 'T1' }, { type: 'sleep', id: 'D1' }, { type: 'wake', id: 'D1' },
    { type: 'turn', id: 'D1', dir: 'S' }, { type: 'warm', id: 'K1' }, { type: 'cool', id: 'K1' }, { type: 'ignite', id: 'K1' },
    { type: 'glint', id: 'R1' }, { type: 'gate', channel: 'A', open: true }, { type: 'gate', channel: 'B', open: false },
  ]),
  'Wren waits. Stumpcap is blocked. Shellwhelk hides in its shell. Shellwhelk comes out. Stumpcap wakes. Stumpcap falls asleep. '
    + 'Dozer newt dozes off. Dozer newt wakes. Dozer newt turns to face south. Emberwick warms. Emberwick cools. '
    + 'Emberwick catches and glows. Mirrorbeetle catches the light. Gate A opens. Gate B shuts.' + tail);
  assert.equal(said([{ type: 'wait' }, { type: 'creep', tiles: [{ x: 2, y: 1 }] }]), 'Wren waits. The Hush creeps closer.' + tail);
  assert.equal(describeTurn({ ...s, caught: true, events: [{ type: 'wait' }, { type: 'creep', tiles: [{ x: 1, y: 1 }] }, { type: 'caught', x: 1, y: 1 }] }),
    'Wren waits. The Hush creeps closer. The Hush catches Wren.');
});

test('talk: a refused move says why', () => {
  const corridor = board(['#####', '#W.G#', '#####']);
  assert.equal(describeRefusal(corridor, 'N'), "Can't go north: wall.");
  assert.equal(describeRefusal(board(['W.G']), 'W'), "Can't go west: wall.");
  assert.equal(describeRefusal(board(['#####', '#W~G#', '#####']), 'E'), "Can't go east: a puddle.");
  assert.equal(describeRefusal(play(board(['#######', '#W.G.G#', '#######']), 'E'), 'E'), "Can't go east: a bud.");
  assert.equal(describeRefusal(board(['######', '#WM.G#', '######']), 'E'), "Can't go east: a Fluffmoth is there.");
  assert.equal(describeRefusal(board(['#######', '#K...G#', '#W....#', '#######']), 'N'), "Can't go north: an Emberwick is there.");
  assert.equal(describeRefusal(board(['#######', '#WA..G#', '#..a..#', '#######']), 'E'), "Can't go east: gate A is shut.");
  assert.equal(describeRefusal(board(['#######', '#LWH.G#', '#######']), 'E'), "Can't go east: the Hush without the lantern.");
  assert.equal(describeRefusal(board(['#####', '#W*G#', '#####']), 'E'), "Can't go east: crystal.");
});

test('talk: a refused lantern says why, and a legal action says nothing', () => {
  assert.equal(describeRefusal(play(board(['######', '#WH.G#', '######']), 'E'), 'L'), "Can't plant the lantern here.");
  assert.equal(describeRefusal(board(['#######', '#L.W.G#', '#######']), 'L'), 'The lantern is two tiles west.');
  const corridor = board(['#####', '#W.G#', '#####']);
  assert.equal(describeRefusal(corridor, 'E'), '');
  assert.equal(describeRefusal(corridor, 'L'), '');
  assert.equal(describeRefusal(corridor, 'Z'), '');
});

test('talk: undo and restart say where Wren stands', () => {
  const s = board(['#####', '#W.G#', '#####']);
  assert.equal(describeBack(s, 'undo'), 'Back one move. Wall to the north, south and west, open to the east.');
  assert.equal(describeBack(s, 'restart'), 'Back to the start. Wall to the north, south and west, open to the east.');
});
