// Hints in three steps (SPEC section 18): the key piece, the first move, the whole way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step, key } from '../src/engine.js';
import { solve } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';
import { keyPiece, pieceText, HintLadder } from '../src/ui/hints.js';

const level = (id) => LEVELS.find((l) => l.id === id);
const way = (def) => {
  const start = parseLevel(def);
  const result = solve(start);
  assert.ok(result.solved, `${def.id} solves`);
  return { start, moves: result.moves };
};
// the positions a list of moves passes through, the start first
const walk = (state, moves) => {
  const states = [state];
  for (const m of moves) states.push(step(states[states.length - 1], m));
  return states;
};

// ---------------------------------------------------------------- the key piece

test('hints: the key piece of level 1-1 is its Fluffmoth, where it stands now', () => {
  const { start, moves } = way(level('1-1'));
  const moth = start.creatures.find((c) => c.type === 'M');
  assert.deepEqual(keyPiece(start, moves, 'M'), { kind: 'creature', id: moth.id, type: 'M', x: moth.x, y: moth.y });
  assert.equal(pieceText(keyPiece(start, moves, 'M')), 'Hint: think about the Fluffmoth.');
});

test('hints: of a species, the creature that does something first on the way, not the first in reading order', () => {
  const def = { id: 'two stumps', par: 7, map: ['#########', '#v#######', '#########', '#W.>...G#', '#.......#', '#########'] };
  const { start, moves } = way(def);
  assert.deepEqual(start.creatures.map((c) => c.id), ['T1', 'T2'], 'the sealed-in Stumpcap comes first in reading order');
  assert.deepEqual(keyPiece(start, moves, 'T'), { kind: 'creature', id: 'T2', type: 'T', x: 3, y: 3 });
  assert.equal(pieceText(keyPiece(start, moves, 'T')), 'Hint: think about the Stumpcap.');
});

test('hints: the species are tried in feature order', () => {
  const { start, moves } = way(level('6-10'));
  assert.equal(keyPiece(start, moves, 'TO').type, 'T');
  assert.equal(keyPiece(start, moves, 'OT').type, 'O');
  assert.equal(pieceText(keyPiece(start, moves, 'OT')), 'Hint: think about the Gloamling.');
});

test('hints: from a later position the key piece is about the rest of the way', () => {
  const { start, moves } = way(level('1-1'));
  const states = walk(start, moves);
  // the moth settles on the first move; after that no creature does anything, so the key is the Glowbud
  const later = keyPiece(states[1], moves.slice(1), 'M');
  const bud = states[1].buds[states[1].bloom.indexOf(0)];
  assert.deepEqual(later, { kind: 'bud', x: bud.x, y: bud.y });
  assert.equal(pieceText(later), 'Hint: think about the way to the Glowbud.');
});

test('hints: L in the feature points at where the lantern is next planted', () => {
  const { start, moves } = way(level('1-19'));
  const states = walk(start, moves);
  const i = states.findIndex((s, n) => n > 0 && s.events.some((e) => e.type === 'plant'));
  const plant = states[i].events.find((e) => e.type === 'plant');
  assert.deepEqual(keyPiece(start, moves, 'L'), { kind: 'plant', x: plant.x, y: plant.y });
  assert.equal(pieceText(keyPiece(start, moves, 'L')), 'Hint: think about where the lantern stands.');
});

test('hints: A in the feature points at the lantern where it is next aimed', () => {
  const def = LEVELS.find((l) => l.feature === 'A');
  const { start, moves } = way(def);
  const aimed = walk(start, moves).flatMap((s) => s.events).find((e) => e.type === 'aim');
  assert.deepEqual(keyPiece(start, moves, 'A'), { kind: 'aim', x: aimed.x, y: aimed.y });
  assert.equal(pieceText(keyPiece(start, moves, 'A')), 'Hint: think about which way the lantern shines.');
});

test('hints: the Hush is never the key piece; then any creature that acts, then a planting, then the Glowbud', () => {
  const enc = way(level('1-19'));
  const moth = enc.start.creatures.find((c) => c.type === 'M');
  assert.deepEqual(keyPiece(enc.start, enc.moves, 'H'), { kind: 'creature', id: moth.id, type: 'M', x: moth.x, y: moth.y });
  // a feature naming a species that does nothing on the way falls back the same way
  assert.equal(keyPiece(enc.start, enc.moves, 'T').id, moth.id);

  const plain = { id: 'plain', par: 2, map: ['######', '#W..G#', '######'] };
  const p = way(plain);
  assert.deepEqual(keyPiece(p.start, p.moves, 'L'), { kind: 'bud', x: 4, y: 1 });
  assert.equal(keyPiece(p.start, [], 'M'), null, 'no way, no piece');
});

// ---------------------------------------------------------------- the ladder

test('hints: the ladder climbs from the key piece to the first move to the whole way, then stays', () => {
  const { start, moves } = way(level('1-1'));
  const ladder = new HintLadder(start, moves, 'M');
  assert.equal(ladder.total, moves.length);
  assert.equal(ladder.label(start), 'more', 'the first step is already paid for once the ladder exists');
  const one = ladder.climb(start);
  assert.equal(one.tier, 1);
  assert.equal(one.index, 0);
  assert.equal(one.piece.kind, 'creature');
  assert.equal(ladder.label(start), 'more');
  const two = ladder.climb(start);
  assert.deepEqual([two.tier, two.index, two.move], [2, 0, moves[0]]);
  assert.equal(ladder.following(start), null, 'the whole way is not up yet');
  const three = ladder.climb(start);
  assert.deepEqual([three.tier, three.index, three.move], [3, 0, moves[0]]);
  assert.deepEqual(three.rest, moves);
  assert.equal(ladder.label(start), 'shown');
  const again = ladder.climb(start);
  assert.equal(again.tier, 3, 'Hint again only shows it again');
});

test('hints: the way follows the player along it, hides off it, and comes back on an undo', () => {
  const { start, moves } = way(level('1-1'));
  const states = walk(start, moves);
  const ladder = new HintLadder(start, moves, 'M');
  ladder.climb(start);
  ladder.climb(start);
  ladder.climb(start);
  for (let i = 0; i < moves.length; i++) {
    const f = ladder.following(states[i]);
    assert.deepEqual([f.index, f.total, f.move], [i, moves.length, moves[i]]);
    assert.deepEqual(f.rest, moves.slice(i));
  }
  assert.equal(ladder.following(states[moves.length]), null, 'a solved position is not on the way');
  assert.equal(ladder.at(states[moves.length]), -1);
  // a step back west from the start is off the way (1-1 starts with Wren at the west wall, so try every move)
  const off = ['N', 'E', 'S', 'W', 'L', 'Z'].map((m) => step(states[1], m)).find((s) => s && ladder.at(s) < 0);
  assert.ok(off, 'some move leaves the way');
  assert.equal(ladder.following(off), null);
  assert.equal(ladder.label(off), null, 'off the way, Hint costs again');
  assert.equal(ladder.climb(off), null);
  // undo hands back the very same position object; an equal position reached again counts too
  assert.equal(ladder.following(states[1]).index, 1);
  assert.equal(ladder.at(step(start, moves[0])), 1);
});

test('hints: a ladder climbed part way goes on from where it stopped after moves along the way', () => {
  const { start, moves } = way(level('6-10'));
  const states = walk(start, moves);
  const ladder = new HintLadder(start, moves, 'TO');
  assert.equal(ladder.climb(start).tier, 1);
  // the player makes the first two moves of the way on their own, then asks again
  assert.equal(ladder.label(states[2]), 'more');
  const two = ladder.climb(states[2]);
  assert.deepEqual([two.tier, two.index, two.move], [2, 2, moves[2]]);
  const one = new HintLadder(start, moves, 'TO');
  const piece = one.climb(states[2]);
  assert.equal(piece.index, 2);
  assert.deepEqual(piece.piece, keyPiece(states[2], moves.slice(2), 'TO'), 'the key piece is for the rest of the way');
});

test('hints: a ladder for a way of no moves, or from a solved position, has nothing to show', () => {
  const { start, moves } = way(level('1-1'));
  const solved = walk(start, moves)[moves.length];
  const ladder = new HintLadder(solved, [], 'M');
  assert.equal(ladder.at(solved), -1);
  assert.equal(ladder.climb(solved), null);
  assert.equal(ladder.label(solved), null);
  assert.equal(key(solved), key(walk(start, moves)[moves.length]));
});
