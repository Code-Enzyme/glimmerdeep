// Tutorial step logic (SPEC section 12): src/ui/tutorial.js has no DOM, so the rules for when a step
// shows, what finishes it and what it points at are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step } from '../src/engine.js';
import { solve } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';
import { Tutorial, resolvePoint, checkTutorial, STUCK_AFTER } from '../src/ui/tutorial.js';

const def = (map, tutorial, extra = {}) => ({ id: 't-1', name: 'Test', feature: 'M', par: 1, map, tutorial, ...extra });

// Plays actions from a level's start, feeding every turn to the tutorial like the game does.
function play(level, tut, actions) {
  let s = parseLevel(level);
  for (const a of actions) {
    const n = step(s, a);
    assert.notEqual(n, null, `action ${a} should be legal at turn ${s.turn}`);
    s = n;
    tut.advance(s.events, s);
  }
  return s;
}

const MOTH = ['#########', '#W..~..G#', '####M####', '#########'];

test('tutorial: no steps means nothing to show', () => {
  const t = new Tutorial(undefined);
  assert.equal(t.done, true);
  assert.equal(t.current(parseLevel(def(MOTH))), null);
  assert.equal(new Tutorial([]).done, true);
});

test('tutorial: a step shows until its event, then the next one shows', () => {
  const level = def(MOTH, [
    { say: 'Swipe to walk.', point: 'wren', gesture: 'swipe-E', until: 'step' },
    { say: 'Cross the moth.', point: [5, 1], until: 'arrive' },
    { say: 'Light the Glowbud.', point: 'bud', until: 'solved' },
  ]);
  const t = new Tutorial(level.tutorial);
  const s0 = parseLevel(level);
  assert.equal(t.index, 0);
  assert.equal(t.current(s0).say, 'Swipe to walk.');
  // waiting is a move but not a step
  let s = play(level, t, ['Z']);
  assert.equal(t.index, 0);
  s = play(level, t, ['E']);
  assert.equal(t.index, 1);
  assert.equal(t.current(s).say, 'Cross the moth.');
  // Wren reaches [5, 1] on the fourth step east, and the bud is lit on the fifth
  const t2 = new Tutorial(level.tutorial);
  play(level, t2, ['E', 'E', 'E']);
  assert.equal(t2.index, 1);
  play(level, t2, ['E', 'E', 'E', 'E']);
  assert.equal(t2.index, 2);
  play(level, t2, ['E', 'E', 'E', 'E', 'E']);
  assert.equal(t2.done, true);
  assert.equal(t2.current(s), null);
});

test("tutorial: 'move' is finished by any legal action, 'wait' only by waiting", () => {
  const level = def(MOTH, [{ say: 'a', until: 'move' }, { say: 'b', until: 'wait' }, { say: 'c', until: 'solved' }]);
  const t = new Tutorial(level.tutorial);
  play(level, t, ['L']);
  assert.equal(t.index, 1);
  play(level, t, ['L', 'E']);
  assert.equal(t.index, 1);
  play(level, t, ['Z']);
  assert.equal(t.index, 2);
});

test('tutorial: one action finishes at most one step', () => {
  const level = def(MOTH, [{ say: 'a', until: 'move' }, { say: 'b', until: 'move' }]);
  const t = new Tutorial(level.tutorial);
  play(level, t, ['E']);
  assert.equal(t.index, 1);
});

test("tutorial: 'arrive' is finished when Wren stands on the step's tile", () => {
  const level = def(MOTH, [{ say: 'Go there.', point: [3, 1], until: 'arrive' }, { say: 'b', until: 'solved' }]);
  const t = new Tutorial(level.tutorial);
  play(level, t, ['E']);
  assert.equal(t.index, 0);
  play(level, t, ['E', 'E']);
  assert.equal(t.index, 1);
});

test("tutorial: 'plant' and 'pickup', and 'when' hides a step until the lantern is down", () => {
  const level = def(MOTH, [
    { say: 'Tap Wren.', point: 'wren', gesture: 'tap', until: 'plant' },
    { say: 'Pick it up again.', point: 'lantern', when: 'planted', until: 'pickup' },
  ]);
  const t = new Tutorial(level.tutorial);
  let s = play(level, t, ['L']);
  assert.equal(t.index, 1);
  assert.equal(t.current(s).say, 'Pick it up again.');
  s = play(level, t, ['L', 'L']);   // a fresh run of the same tutorial object: planted, picked up
  assert.equal(t.done, true);
  const t2 = new Tutorial([{ say: 'later', when: 'planted', until: 'pickup' }]);
  const s0 = parseLevel(level);
  assert.equal(t2.current(s0), null, 'hidden while the lantern is carried');
  assert.equal(t2.index, 0);
  const planted = step(s0, 'L');
  assert.equal(t2.current(planted).say, 'later');
});

test("tutorial: 'gate' needs a gate to open, not to close", () => {
  // the whelk backs onto the root and is caught there: the gate opens on the fourth step
  const level = def(['#######', '#W....#', '#####S#', '#G..A.#', '#####a#', '#######'], [
    { say: 'Light the whelk on the root.', point: 'root', until: 'gate' },
    { say: 'Go through.', point: 'gate', until: 'solved' },
  ], { feature: 'S' });
  const t = new Tutorial(level.tutorial);
  const sol = solve(parseLevel(level)).moves;
  let s = parseLevel(level);
  let opened = -1;
  for (let i = 0; i < sol.length; i++) {
    s = step(s, sol[i]);
    t.advance(s.events, s);
    if (opened < 0 && s.events.some((e) => e.type === 'gate' && e.open)) opened = i;
    if (opened < 0) assert.equal(t.index, 0, `still on the first step after move ${i + 1}`);
  }
  assert.ok(opened >= 0);
  assert.equal(t.done, true);
});

test('tutorial: a card step waits for the card to close, and restart goes back past it', () => {
  const t = new Tutorial([
    { card: 'M', until: 'card' },
    { say: 'Walk.', point: 'wren', until: 'step' },
    { say: 'Light it.', point: 'bud', until: 'solved' },
  ]);
  const level = def(MOTH);
  const s0 = parseLevel(level);
  assert.equal(t.current(s0).card, 'M');
  t.advance(step(s0, 'E').events, step(s0, 'E'));
  assert.equal(t.index, 0, 'moving does not close a card');
  t.cardClosed();
  assert.equal(t.index, 1);
  play(level, t, ['E']);
  assert.equal(t.index, 2);
  t.restart();
  assert.equal(t.index, 1, 'restart goes back to the first step that is not a card');
  t.end();
  assert.equal(t.done, true);
  t.restart();
  assert.equal(t.done, true, 'an ended tutorial stays ended');
});

test('tutorial: cardClosed does nothing when the current step is not a card', () => {
  const t = new Tutorial([{ say: 'a', until: 'move' }]);
  t.cardClosed();
  assert.equal(t.index, 0);
});

test('tutorial: points resolve to Wren, creatures, tiles and buttons', () => {
  const level = def(['#########', '#W.M~.aG#', '#L.A.M###', '#########'], undefined, { feature: 'M' });
  const s = parseLevel(level);
  assert.deepEqual(resolvePoint('wren', s), { kind: 'wren', x: 1, y: 1 });
  assert.deepEqual(resolvePoint('M', s), { kind: 'creature', id: 'M1', x: 3, y: 1 });
  assert.equal(resolvePoint('S', s), null);
  assert.deepEqual(resolvePoint('bud', s), { kind: 'tile', x: 7, y: 1 });
  assert.deepEqual(resolvePoint('root', s), { kind: 'tile', x: 6, y: 1 });
  assert.deepEqual(resolvePoint('gate', s), { kind: 'tile', x: 3, y: 2 });
  assert.deepEqual(resolvePoint('lantern', s), { kind: 'tile', x: 1, y: 2 });
  assert.deepEqual(resolvePoint([4, 2], s), { kind: 'tile', x: 4, y: 2 });
  assert.deepEqual(resolvePoint('plant', s), { kind: 'button', name: 'plant' });
  assert.deepEqual(resolvePoint('hint', s), { kind: 'button', name: 'hint' });
  assert.equal(resolvePoint(undefined, s), null);
  // the carried lantern is not on the board
  assert.equal(resolvePoint('lantern', parseLevel(def(MOTH))), null);
});

test('tutorial: the bud point moves on to the next bud not yet in bloom', () => {
  const level = def(['#########', '#W..G..G#', '#########'], undefined, { feature: 'L' });
  let s = parseLevel(level);
  assert.deepEqual(resolvePoint('bud', s), { kind: 'tile', x: 4, y: 1 });
  s = step(step(s, 'E'), 'E');   // Wren's light reaches the first bud
  assert.deepEqual(resolvePoint('bud', s), { kind: 'tile', x: 7, y: 1 });
  s = step(s, 'W');   // a bud stays in bloom when the light moves away
  assert.deepEqual(resolvePoint('bud', s), { kind: 'tile', x: 7, y: 1 });
});

test('checkTutorial: catches what would break or mislead', () => {
  const ok = def(MOTH, [{ say: 'Walk.', point: 'wren', gesture: 'swipe-E', until: 'step' }]);
  assert.deepEqual(checkTutorial(ok), []);
  assert.deepEqual(checkTutorial(def(MOTH)), []);
  const bad = (steps) => checkTutorial(def(MOTH, steps)).length;
  assert.ok(bad('nope'), 'not an array');
  assert.ok(bad([{ say: 'x', until: 'jump' }]), 'unknown event');
  assert.ok(bad([{ say: 'x', point: 'teapot', until: 'move' }]), 'unknown point');
  assert.ok(bad([{ say: 'x', point: 'S', until: 'move' }]), 'a species the level does not have');
  assert.ok(bad([{ say: 'x', point: [40, 1], until: 'move' }]), 'a tile off the map');
  assert.ok(bad([{ say: 'x', gesture: 'wave', until: 'move' }]), 'unknown gesture');
  assert.ok(bad([{ say: 'x', point: 'wren', until: 'arrive' }]), "'arrive' needs a tile");
  assert.ok(bad([{ card: 'T', until: 'card' }]), 'a card for a species the level does not have');
  assert.ok(bad([{ card: 'M', until: 'move' }]), "a card step must end with 'card'");
  assert.ok(bad([{ say: 'x', until: 'card' }]), "'card' without a card");
  assert.ok(bad([{ until: 'move' }]), 'a step that says nothing and shows no card');
  assert.ok(bad([{ say: 'x', when: 'sometimes', until: 'move' }]), 'unknown when');
  assert.ok(bad([{ say: 'x'.repeat(130), until: 'move' }]), 'too long for the status row');
});

test('checkTutorial: knows the Emberwick and its ignite event', () => {
  const ember = def(['######', '#L~K.#', '###..#', '#G...#', '##.W.#', '######'], [
    { card: 'K', until: 'card' },
    { say: 'Wait while it catches.', point: 'K', until: 'ignite' },
  ], { feature: 'K' });
  assert.deepEqual(checkTutorial(ember), []);
  const t = new Tutorial(ember.tutorial);
  t.cardClosed();
  let s = parseLevel(ember);
  assert.deepEqual(resolvePoint('K', s), { kind: 'creature', id: 'K1', x: 3, y: 1 });
  s = step(s, 'Z');
  t.advance(s.events, s);
  assert.equal(t.index, 1, 'warming is not catching');
  s = step(s, 'Z');
  t.advance(s.events, s);
  assert.equal(t.done, true);
  assert.ok(checkTutorial(def(MOTH, [{ card: 'K', until: 'card' }])).length, 'no Emberwick on the map');
});

test('stuck nudge comes six moves after par', () => {
  assert.equal(STUCK_AFTER, 6);
});

test('levels: every tutorial is well formed', () => {
  for (const level of LEVELS) {
    assert.deepEqual(checkTutorial(level), [], `level ${level.id}`);
  }
});

test('levels: the first level and the first level of every new creature have a tutorial', () => {
  const firsts = new Set(['1-1']);
  for (const level of LEVELS) {
    const ch = level.id.split('-')[0];
    if (level.id === `${ch}-1`) firsts.add(level.id);
  }
  for (const id of firsts) {
    const level = LEVELS.find((l) => l.id === id);
    assert.ok(Array.isArray(level.tutorial) && level.tutorial.length > 0, `level ${id} has a tutorial`);
  }
  // a new creature is met through its card on its chapter's first level (chapter 1 starts with doing)
  for (const id of firsts) {
    if (id.startsWith('1-')) continue;
    const level = LEVELS.find((l) => l.id === id);
    assert.equal(level.tutorial[0].card, level.feature[0], `level ${id} opens with the ${level.feature[0]} card`);
  }
});

test('levels: following the par solution finishes every tutorial, so it never asks for a wasted move', () => {
  for (const level of LEVELS) {
    if (!level.tutorial) continue;
    const t = new Tutorial(level.tutorial);
    const moves = solve(parseLevel(level)).moves;
    let s = parseLevel(level);
    if (t.current(s) && t.current(s).card) t.cardClosed();
    for (const m of moves) {
      s = step(s, m);
      t.advance(s.events, s);
      if (t.current(s) && t.current(s).card) t.cardClosed();
    }
    assert.equal(s.solved, true);
    assert.equal(t.done, true, `level ${level.id}: the tutorial is still on step ${t.index} after the par solution`);
  }
});
