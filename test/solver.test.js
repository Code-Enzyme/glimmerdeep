// Tests for src/solver.js: the breadth-first solver, the hint (nextMove) and the level check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, parseLevel, step } from '../src/engine.js';
import { solve, nextMove, checkLevel } from '../src/solver.js';
import ch1 from '../src/levels/ch1.js';

const def = (map, extra = {}) => ({ id: 't-1', name: 'Test', feature: 'L', par: 1, map, note: '', ...extra });
const parse = (map, extra) => parseLevel(def(map, extra));
const firstLight = ch1.find((l) => l.id === '1-1');
const NO_PLANTING = ACTIONS.filter((a) => a !== 'L');

// Plays the moves and returns the final state; every move must be legal.
function replay(state, moves) {
  let s = state;
  for (const a of moves) {
    s = step(s, a);
    assert.notEqual(s, null, `move ${a} of ${moves.join('')} is illegal`);
  }
  return s;
}

// An independent oracle: tries every action sequence of length 0, 1, 2, ... with no visited set at all.
function bruteForceShortest(state, maxDepth) {
  const reaches = (s, depth) => {
    if (s.solved) return true;
    if (depth === 0) return false;
    for (const a of ACTIONS) {
      const n = step(s, a);
      if (n && reaches(n, depth - 1)) return true;
    }
    return false;
  };
  for (let depth = 0; depth <= maxDepth; depth++) if (reaches(state, depth)) return depth;
  return null;
}

// Small levels whose shortest solution can be worked out by hand.
const HAND_MADE = {
  // Walk two tiles east; the bud is then next to the carried lantern.
  walk: { map: ['W..G'], shortest: 2 },
  // The puddle cannot be crossed. Step east and plant: radius 2 reaches the bud through the puddle.
  plant: { map: ['W.~G'], shortest: 2 },
  // Level 1-1: the moth bridges the puddle on turn 1, Wren walks five tiles.
  firstLight: { map: firstLight.map, shortest: 5 },
  // The buds are six tiles apart, so no lantern position lights both: bloom the west one from 1,0
  // (W, W), then walk to 5,0 for the east one (E, E, E, E).
  twoFarBuds: { map: ['G..W..G'], shortest: 6 },
  // Wren cannot move until the moth has flown two tiles and settled in the puddle: Z, Z, E, E.
  waitForMoth: { map: ['W~.G', '#.##', '#M##'], shortest: 4 },
  // The moth bridges the first puddle (E, E, E); the second one needs the planted lantern (L).
  bridgeThenPlant: { map: ['W.~.~G', '##M###'], shortest: 4 },
  // The whelk on root a (1,1) is lit, so gate A is open. Wren steps into the gate (the whelk flees and the
  // gate closes around her), then out the far side next to the bud.
  whelkGate: { map: ['.WA.G', '.S###'], under: { '1,1': 'a' }, shortest: 2 },
  // Walking along the bottom row lights the Stumpcap from below on turns 2 and 3, so it marches onto root a
  // (3,0) and bumps into the wall there. Gate A (4,1) is open when Wren arrives: S, E, E, E, E, E, N.
  stumpGate: { map: ['W>.a#.G', '....A..'], shortest: 7 },
  // The newt patrols over the root and holds gate A open only while it stands there: a timing puzzle.
  newtGate: { map: ['W..A.G', '###.##', '##ea.#'], shortest: 7 },
  // The lantern is planted out of reach across a puddle, but it lights the Emberwick: wait while it catches,
  // then lead it round so it glows next to the bud.
  emberLight: { map: ['######', '#L~K.#', '###..#', '#G...#', '##.W.#', '######'], shortest: 5 },
};
const handMade = (name) => parse(HAND_MADE[name].map, { under: HAND_MADE[name].under });

// ---------------------------------------------------------------- solve

test('solve: finds the shortest solution of each hand-made level', () => {
  for (const [name, { shortest }] of Object.entries(HAND_MADE)) {
    const start = handMade(name);
    const result = solve(start);
    assert.equal(result.solved, true, name);
    assert.equal(result.moves.length, shortest, `${name}: ${result.moves.join('')}`);
    assert.equal(replay(start, result.moves).solved, true, `${name}: the moves really solve the level`);
    assert.ok(Number.isInteger(result.explored) && result.explored >= 1, name);
  }
});

test('solve: agrees with a brute-force search that uses no visited set', () => {
  for (const [name, { shortest }] of Object.entries(HAND_MADE)) {
    assert.equal(bruteForceShortest(handMade(name), 7), shortest, name);
  }
});

test('solve: returns the moves in order, as action letters', () => {
  assert.deepEqual(solve(handMade('plant')).moves, ['E', 'L']);
  assert.deepEqual(solve(handMade('whelkGate')).moves, ['E', 'E']);
  assert.deepEqual(solve(handMade('waitForMoth'), { actions: ['E', 'Z'] }).moves, ['Z', 'Z', 'E', 'E']);
});

test('solve: a state that is already solved needs no moves', () => {
  const result = solve(parse(['WG']));
  assert.equal(result.solved, true);
  assert.deepEqual(result.moves, []);
});

test('solve: can start from any state, not only from the start of a level', () => {
  const midway = replay(parseLevel(firstLight), ['E', 'E']);
  assert.deepEqual(solve(midway).moves, ['E', 'E', 'E']);
});

test('solve: does not mutate the state it is given', () => {
  const start = parseLevel(firstLight);
  const before = JSON.stringify(start);
  solve(start);
  assert.equal(JSON.stringify(start), before);
});

test('solve: an unsolvable level is reported as exhausted and not solved', () => {
  // Wren is walled in. The only positions are "carrying" and "planted underfoot".
  const result = solve(parse(['W#G']));
  assert.deepEqual(result, { solved: false, moves: [], explored: 2, exhausted: true });
});

test('solve: explored counts every distinct position of the reachable space', () => {
  // 45 open tiles, nothing else: 45 positions carrying, plus 45 x 45 with the lantern planted somewhere.
  const open = parse(['W........', '.........', '.........', '.........', '.........']);
  const result = solve(open);
  assert.deepEqual(result, { solved: false, moves: [], explored: 45 + 45 * 45, exhausted: true });
});

test('solve: respects maxStates', () => {
  const open = parse(['W........', '.........', '.........', '.........', '.........']);
  const capped = solve(open, { maxStates: 100 });
  assert.deepEqual(capped, { solved: false, moves: [], explored: 100, exhausted: false });

  // Too small a budget to reach the bud seven tiles away: not solved, and not a proof of anything.
  const far = parse(['W.......G']);
  const tooSmall = solve(far, { maxStates: 4 });
  assert.equal(tooSmall.solved, false);
  assert.equal(tooSmall.exhausted, false);
  assert.ok(tooSmall.explored <= 4);
  // A budget that is big enough changes nothing.
  assert.equal(solve(far, { maxStates: 500 }).moves.length, 7);
  // A budget that exactly fits the whole space still counts as exhaustive.
  assert.equal(solve(parse(['W#G']), { maxStates: 2 }).exhausted, true);
  assert.equal(solve(parse(['W#G']), { maxStates: 1 }).exhausted, false);
});

test('solve: the actions option restricts the search', () => {
  const start = handMade('plant');
  const without = solve(start, { actions: NO_PLANTING });
  assert.equal(without.solved, false);
  assert.equal(without.exhausted, true, 'unsolvable without planting');
  assert.deepEqual(solve(parse(['W..G']), { actions: ['E'] }).moves, ['E', 'E']);
  assert.deepEqual(solve(parse(['W..G']), { actions: ['E', 'L'] }).moves, ['E', 'E']);
  assert.deepEqual(solve(parse(['W..G']), { actions: ['L', 'E'] }).moves, ['E', 'L'], 'ties go to the earlier action');
});

test('worked example: the solver finds par 5 for level 1-1, and the moth is necessary', () => {
  const result = solve(parseLevel(firstLight));
  assert.equal(result.solved, true);
  assert.equal(result.moves.length, 5);
  assert.equal(firstLight.par, 5);
  const check = checkLevel(firstLight);
  assert.equal(check.shortest, 5);
  assert.deepEqual(check.featureOk, { M: true });
  // By hand as well: the same map with the moth taken out cannot be solved at all.
  const noMoth = solve(parseLevel({ ...firstLight, map: firstLight.map.map((row) => row.replace('M', '.')) }));
  assert.equal(noMoth.solved, false);
  assert.equal(noMoth.exhausted, true);
});

// ---------------------------------------------------------------- nextMove

test('nextMove: the first move of a shortest solution', () => {
  assert.equal(nextMove(parseLevel(firstLight)), 'E');
  const start = handMade('plant');
  assert.equal(nextMove(start), 'E');
  assert.equal(nextMove(step(start, 'E')), 'L');
  assert.equal(nextMove(handMade('waitForMoth')), solve(handMade('waitForMoth')).moves[0]);
});

test('nextMove: following it move by move solves the level at the shortest length', () => {
  let s = handMade('stumpGate');
  let moves = 0;
  while (!s.solved) {
    s = step(s, nextMove(s));
    moves++;
    assert.ok(moves <= 7, 'took more moves than the shortest solution');
  }
  assert.equal(moves, 7);
});

test('nextMove: null when there is nothing to suggest', () => {
  assert.equal(nextMove(parse(['W#G'])), null, 'unsolvable');
  assert.equal(nextMove(parse(['WG'])), null, 'already solved');
  assert.equal(nextMove(parse(['W.......G']), { maxStates: 4 }), null, 'not found within the budget');
  assert.equal(nextMove(handMade('plant'), { actions: NO_PLANTING }), null, 'options are passed on to the search');
});

// ---------------------------------------------------------------- checkLevel

test('checkLevel: a good level', () => {
  const result = checkLevel(firstLight);
  assert.equal(result.id, '1-1');
  assert.equal(result.ok, true);
  assert.equal(result.par, 5);
  assert.equal(result.shortest, 5);
  assert.deepEqual(result.featureOk, { M: true });
  assert.deepEqual(result.problems, []);
  assert.ok(Number.isInteger(result.explored) && result.explored >= 5);
  assert.ok(result.searched >= result.explored, 'searched also counts the necessity searches');
});

test('checkLevel: reports every listed feature', () => {
  const level = def(HAND_MADE.bridgeThenPlant.map, { id: 't-2', feature: 'ML', par: 4 });
  const result = checkLevel(level);
  assert.deepEqual(result.featureOk, { M: true, L: true });
  assert.equal(result.ok, true, result.problems.join('; '));
  assert.equal(result.id, 't-2');
});

test('checkLevel: Shellwhelk and Stumpcap necessity (the species is removed, the terrain under it stays)', () => {
  const whelk = checkLevel(def(HAND_MADE.whelkGate.map, { under: HAND_MADE.whelkGate.under, feature: 'S', par: 2 }));
  assert.deepEqual(whelk.featureOk, { S: true });
  assert.equal(whelk.ok, true, whelk.problems.join('; '));
  const stump = checkLevel(def(HAND_MADE.stumpGate.map, { feature: 'T', par: 7 }));
  assert.deepEqual(stump.featureOk, { T: true });
  assert.equal(stump.ok, true, stump.problems.join('; '));
});

test('checkLevel: Dozer newt necessity (every newt facing is removed)', () => {
  const newt = checkLevel(def(HAND_MADE.newtGate.map, { feature: 'D', par: 7 }));
  assert.deepEqual(newt.featureOk, { D: true });
  assert.equal(newt.ok, true, newt.problems.join('; '));
  const missing = checkLevel(def(HAND_MADE.stumpGate.map, { feature: 'D', par: 7 }));
  assert.deepEqual(missing.featureOk, { D: false });
  assert.ok(missing.problems.some((p) => p.includes('no Dozer newt')), missing.problems.join('; '));
});

test('checkLevel: Emberwick necessity', () => {
  const ember = checkLevel(def(HAND_MADE.emberLight.map, { feature: 'K', par: 5 }));
  assert.deepEqual(ember.featureOk, { K: true });
  assert.equal(ember.ok, true, ember.problems.join('; '));
  const missing = checkLevel(def(HAND_MADE.newtGate.map, { feature: 'K', par: 7 }));
  assert.deepEqual(missing.featureOk, { K: false });
  assert.ok(missing.problems.some((p) => p.includes('no Emberwick')), missing.problems.join('; '));
});

test('checkLevel: knows the Gloamling as a feature', () => {
  const missing = checkLevel(def(HAND_MADE.newtGate.map, { feature: 'O', par: 7 }));
  assert.deepEqual(missing.featureOk, { O: false });
  assert.ok(missing.problems.some((p) => p.includes('no Gloamling')), missing.problems.join('; '));
});

test('checkLevel: removing a species leaves the `under` terrain in place', () => {
  // The whelk gate again, but channel A has a second root (4,2) with a walled-in Stumpcap asleep on it.
  // Take the Stumpcap away and its root is still there, unpressed, so the gate never opens: the Stumpcap
  // is necessary. (If its root vanished with it, the whelk alone would open the gate.)
  const level = def(['.WA.G', '.S###', '...#>'], { under: { '1,1': 'a', '4,2': 'a' }, feature: 'ST', par: 2 });
  const result = checkLevel(level);
  assert.deepEqual(result.featureOk, { S: true, T: true });
  assert.equal(result.ok, true, result.problems.join('; '));
});

test('checkLevel: flags a wrong par', () => {
  for (const par of [4, 6]) {
    const result = checkLevel({ ...firstLight, par });
    assert.equal(result.ok, false);
    assert.equal(result.par, par);
    assert.equal(result.shortest, 5);
    assert.equal(result.problems.length, 1);
    assert.match(result.problems[0], /par/);
  }
});

test('checkLevel: flags an unsolvable level', () => {
  const result = checkLevel(def(['W#G'], { par: 3 }));
  assert.equal(result.ok, false);
  assert.equal(result.shortest, null);
  assert.match(result.problems.join('; '), /unsolvable/);
});

test('checkLevel: flags a level that was not solved within maxStates, without calling it unsolvable', () => {
  const result = checkLevel(def(['W.......G'], { par: 7 }), { maxStates: 4 });
  assert.equal(result.ok, false);
  assert.equal(result.shortest, null);
  assert.match(result.problems.join('; '), /maxStates/);
  assert.doesNotMatch(result.problems.join('; '), /unsolvable/);
});

test('checkLevel: flags a species that is not necessary', () => {
  // The moth is only decoration here: Wren walks to the bud without it.
  const result = checkLevel(def(['W..G', '.M..'], { feature: 'M', par: 2 }));
  assert.equal(result.shortest, 2);
  assert.deepEqual(result.featureOk, { M: false });
  assert.equal(result.ok, false);
  assert.match(result.problems.join('; '), /Fluffmoth|'M'/);
});

test('checkLevel: flags planting when the level can be solved without it', () => {
  const walk = checkLevel(def(['W..G'], { feature: 'L', par: 2 }));
  assert.deepEqual(walk.featureOk, { L: false });
  assert.equal(walk.ok, false);
  const plant = checkLevel(def(['W.~G'], { feature: 'L', par: 2 }));
  assert.deepEqual(plant.featureOk, { L: true });
  assert.equal(plant.ok, true, plant.problems.join('; '));
});

test('checkLevel: flags a feature whose species is not in the level, and unknown or missing features', () => {
  const absent = checkLevel(def(['W.~G'], { feature: 'LS', par: 2 }));
  assert.deepEqual(absent.featureOk, { L: true, S: false });
  assert.equal(absent.ok, false);

  const unknown = checkLevel(def(['W.~G'], { feature: 'LX', par: 2 }));
  assert.equal(unknown.ok, false);
  assert.match(unknown.problems.join('; '), /'X'/);

  for (const feature of ['', undefined]) {
    const none = checkLevel(def(['W.~G'], { feature, par: 2 }));
    assert.equal(none.ok, false, String(feature));
    assert.match(none.problems.join('; '), /feature/);
  }
});

test('checkLevel: flags a level that starts solved', () => {
  const result = checkLevel(def(['WG'], { par: 0 }));
  assert.equal(result.ok, false);
  assert.match(result.problems.join('; '), /starts solved/);
});

test('checkLevel: reports a malformed map as a problem instead of throwing', () => {
  const result = checkLevel(def(['WW.G'], { id: 't-9' }));
  assert.equal(result.id, 't-9');
  assert.equal(result.ok, false);
  assert.equal(result.shortest, null);
  assert.match(result.problems.join('; '), /Wren/);
});

test('checkLevel: necessity must be proven by an exhaustive search', () => {
  // E, L solves it after a handful of positions, but proving that planting is needed means searching all
  // 18 positions of the room without L.
  const level = def(['....W.~G', '......##', '......##'], { feature: 'L', par: 2 });
  assert.equal(checkLevel(level).ok, true);
  const capped = checkLevel(level, { maxStates: 12 });
  assert.equal(capped.shortest, 2);
  assert.deepEqual(capped.featureOk, { L: false });
  assert.equal(capped.ok, false);
  assert.match(capped.problems.join('; '), /maxStates/);
});

// The top row is level 1-1 again. Below it lies a big open room that has nothing to do with the solution
// but can be wandered through with four creatures in it: 208,090 positions once the moth is taken out.
const SPRAWL = ['W..~..G##', '.##M#####', '.........', '..>...S..', '....a....', '.<..A..^.', '.........', '.........'];

test('checkLevel: flags a search that explores more than 150,000 positions (SPEC section 5)', () => {
  const result = checkLevel(def(SPRAWL, { feature: 'M', par: 5 }));
  assert.equal(result.shortest, 5);
  assert.ok(result.explored < 1000, 'the solution itself is found quickly');
  assert.deepEqual(result.featureOk, { M: true }, 'the moth is proven necessary...');
  assert.equal(result.ok, false, '...but only by a search that is too big');
  assert.equal(result.problems.length, 1);
  assert.match(result.problems[0], /too big/);
  assert.match(result.problems[0], /208090/);
  assert.match(result.problems[0], /150000/);
});

test('checkLevel: the size limit also applies to the search for the solution; exactly 150,000 is allowed', () => {
  // The same room with neither moth nor a way to the bud: the main search runs until maxStates stops it.
  const level = def(SPRAWL.map((row) => row.replace('M', '.')), { feature: 'L', par: 5 });
  const atLimit = checkLevel(level, { maxStates: 150000 });
  assert.equal(atLimit.explored, 150000);
  assert.doesNotMatch(atLimit.problems.join('; '), /too big/);
  const over = checkLevel(level, { maxStates: 150001 });
  assert.match(over.problems.join('; '), /too big.*150001/);
});

test('checkLevel: the search options are passed on', () => {
  const level = def(['W.~G'], { feature: 'L', par: 2 });
  assert.equal(checkLevel(level).ok, true);
  const noPlanting = checkLevel(level, { actions: NO_PLANTING });
  assert.equal(noPlanting.ok, false);
  assert.equal(noPlanting.shortest, null);
});
