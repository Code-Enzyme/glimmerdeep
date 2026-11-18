// The game session (src/ui/session.js): what a catch by the Hush does to an attempt (SPEC section 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Session } from '../src/ui/session.js';

// The Hush creeps east a tile a turn; the planted lantern below lights only x 6 and 7, so Wren, waiting at x 5
// without it, is caught on turn 4.
const ENCOUNTER = { id: 't', name: 'T', par: 9, feature: 'H', gloam: true, map: ['#########', '#H...W..#', '#######L#', '#G#######'] };

test('session: a catch ends the attempt until it is rewound', () => {
  const s = new Session(ENCOUNTER);
  assert.equal(s.caught, false);
  for (let i = 0; i < 3; i++) s.act('Z');
  assert.equal(s.caught, false);
  assert.notEqual(s.act('Z'), null);
  assert.equal(s.caught, true);
  assert.equal(s.moves, 4);
  assert.equal(s.act('E'), null, 'nothing moves while caught');
});

test('session: rewinding after a catch steps back three moves, or to the start', () => {
  const s = new Session(ENCOUNTER);
  for (let i = 0; i < 4; i++) s.act('Z');
  assert.equal(s.rewind(3), 3);
  assert.equal(s.caught, false);
  assert.equal(s.moves, 1);
  assert.deepEqual(s.state.hush, ['2,1']);

  const quick = new Session(ENCOUNTER);
  quick.act('W');
  quick.act('W');
  assert.equal(quick.caught, true);
  assert.equal(quick.rewind(3), 2, 'only two moves to take back');
  assert.equal(quick.state, quick.start);
});

test('session: a rewind never undoes a restart', () => {
  const s = new Session(ENCOUNTER);
  s.act('E');
  s.restart();
  s.act('W');
  s.act('W');
  assert.equal(s.caught, true);
  assert.equal(s.rewind(3), 2);
  assert.equal(s.state, s.start);
  assert.equal(s.undo(), true, 'the restart can still be undone');
  assert.deepEqual(s.state.wren, { x: 6, y: 1 });
});
