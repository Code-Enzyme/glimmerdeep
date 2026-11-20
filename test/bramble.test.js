// Bramble, Wren's moth (SPEC section 31): drawn by the board, never a piece. The rules of where it flies and
// how it reacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLevel, step } from '../src/engine.js';
import { solve } from '../src/solver.js';
import { CHAPTERS } from '../src/levels/index.js';
import {
  BRAMBLE_SIZE, FIRST, PERCH, REACTION_MS, brambleShown, readBramble, reactionTo, spotOf, hover, follow, pose,
} from '../src/ui/bramble.js';

const turn = (events, extra = {}) => ({ events, solved: false, caught: false, ...extra });
const before = turn([]);

test('bramble: smaller than any moth on the board', () => {
  assert.ok(BRAMBLE_SIZE > 0.3 && BRAMBLE_SIZE <= 0.75, `${BRAMBLE_SIZE}`);
});

test('bramble: flies once the first cavern is lit, unless it stays home', () => {
  assert.equal(FIRST, CHAPTERS[0].levels[0].id, 'the first cavern of the first chapter');
  assert.equal(brambleShown({}, {}), false, 'not in the first lesson');
  assert.equal(brambleShown({ [FIRST]: { moves: 5, stars: 1 } }, {}), true);
  assert.equal(brambleShown({ [FIRST]: { moves: 5, stars: 1 } }, { bramble: true }), true);
  assert.equal(brambleShown({ [FIRST]: { moves: 5, stars: 1 } }, { bramble: false }), false);
  assert.equal(brambleShown({ '2-1': { moves: 5, stars: 1 } }, {}), false);
});

test('bramble: the setting is true unless it says false', () => {
  assert.equal(readBramble({ bramble: false }), false);
  assert.equal(readBramble({ bramble: true }), true);
  for (const junk of [undefined, null, {}, { bramble: 'no' }, { bramble: 0 }]) assert.equal(readBramble(junk), true);
});

test('bramble: cheers when the cavern is lit, hides when the Hush reaches Wren', () => {
  assert.equal(reactionTo(before, turn([{ type: 'bud', x: 1, y: 1 }], { solved: true })), 'cheer');
  assert.equal(reactionTo(before, turn([{ type: 'creep', tiles: [] }, { type: 'caught', x: 1, y: 1 }], { caught: true })), 'hide');
});

test('bramble: happy when a turn makes a bridge, opens a gate, blooms a bud or catches an Emberwick', () => {
  assert.equal(reactionTo(before, turn([{ type: 'settle', id: 1, x: 2, y: 1 }])), 'happy');
  assert.equal(reactionTo(before, turn([{ type: 'gate', channel: 'A', open: true }])), 'happy');
  assert.equal(reactionTo(before, turn([{ type: 'bud', x: 3, y: 1, lit: true }])), 'happy');
  assert.equal(reactionTo(before, turn([{ type: 'ignite', id: 2 }])), 'happy');
});

test('bramble: nothing for an ordinary step, a gate closing or a creature going cold', () => {
  assert.equal(reactionTo(before, turn([{ type: 'move', who: 'wren' }])), null);
  assert.equal(reactionTo(before, turn([{ type: 'gate', channel: 'A', open: false }])), null);
  assert.equal(reactionTo(before, turn([{ type: 'cool', id: 2 }, { type: 'warm', id: 3 }])), null);
  assert.equal(reactionTo(before, turn([])), null);
  assert.equal(reactionTo(before, null), null);
});

test('bramble: in 1-1 the moth settling is happy and the last step cheers', () => {
  const def = CHAPTERS[0].levels[0];
  let s = parseLevel(def);
  const { moves } = solve(s);
  const seen = [];
  for (const m of moves) {
    const next = step(s, m);
    seen.push(reactionTo(s, next));
    s = next;
  }
  assert.equal(seen[seen.length - 1], 'cheer');
  assert.ok(seen.includes('happy'), JSON.stringify(seen));
});

test('bramble: goes beside the light, or to the hint while one shows', () => {
  const lantern = { x: 3.5, y: 2 };
  const wren = { x: 3, y: 2 };
  assert.deepEqual(spotOf(lantern, null, wren), { x: 3.5, y: 2 });
  assert.deepEqual(spotOf(lantern, { at: { x: 6, y: 1 } }, wren), { x: 6, y: 1 }, 'the key creature or tile');
  assert.deepEqual(spotOf(lantern, { dir: 'N' }, wren), { x: 3, y: 1 }, 'the tile to step to');
  assert.deepEqual(spotOf(lantern, { dir: 'W' }, wren), { x: 2, y: 2 });
  assert.deepEqual(spotOf(lantern, { ring: true }, wren), { x: 3, y: 2 }, 'wait or the lantern: by Wren');
  assert.ok(PERCH.x > 0 && PERCH.y < 0, 'above and to the right');
});

test('bramble: drifts in a small figure of eight, within half a tile; still with motion reduced', () => {
  let maxX = 0;
  let maxY = 0;
  let moved = false;
  const first = hover(0, false);
  for (let t = 0; t < 20; t += 0.05) {
    const h = hover(t, false);
    maxX = Math.max(maxX, Math.abs(h.x));
    maxY = Math.max(maxY, Math.abs(h.y));
    if (Math.hypot(h.x - first.x, h.y - first.y) > 0.05) moved = true;
    assert.ok(Math.hypot(PERCH.x + h.x, PERCH.y + h.y) <= 0.75, 'near its spot');
    assert.deepEqual(hover(t, true), { x: 0, y: 0 });
  }
  assert.ok(moved, 'it drifts');
  assert.ok(maxX <= 0.5 && maxY <= 0.5 && maxX > 0.05, JSON.stringify({ maxX, maxY }));
});

test('bramble: follows a moving spot without overshooting, and gets there', () => {
  let pos = { x: 0, y: 0 };
  const target = { x: 4, y: -2 };
  for (let i = 0; i < 120; i++) {
    const next = follow(pos, target, 1 / 60, false);
    assert.ok(next.x >= pos.x && next.x <= target.x && next.y <= pos.y && next.y >= target.y, 'never past the spot');
    pos = next;
  }
  assert.ok(Math.hypot(pos.x - 4, pos.y + 2) < 0.01, JSON.stringify(pos));
  assert.ok(follow({ x: 0, y: 0 }, target, 1 / 60, false).x < 4, 'a frame moves only part of the way');
  assert.deepEqual(follow({ x: 0, y: 0 }, target, 1 / 60, true), target, 'reduced motion: there at once');
  const long = follow({ x: 0, y: 0 }, target, 30, false);
  assert.ok(long.x <= 4 && long.x > 0, 'a long pause (a hidden page) does not throw it past');
  assert.deepEqual(follow({ x: 1, y: 1 }, target, 0, false), { x: 1, y: 1 });
});

test('bramble: a reaction is a loop, a hop or a shiver that ends where it began', () => {
  for (const kind of ['cheer', 'happy', 'shiver']) {
    assert.ok(REACTION_MS[kind] > 0 && REACTION_MS[kind] <= 1500, kind);
    assert.deepEqual(pose(kind, 0, false), { x: 0, y: 0, scale: 1 }, `${kind} starts at rest`);
    const end = pose(kind, 1, false);
    assert.ok(Math.abs(end.x) < 1e-9 && Math.abs(end.y) < 1e-9 && end.scale === 1, `${kind} ends at rest`);
    let far = 0;
    for (let p = 0; p <= 1; p += 0.02) {
      const q = pose(kind, p, false);
      far = Math.max(far, Math.hypot(q.x, q.y));
      assert.ok(Math.hypot(q.x, q.y) <= 0.75, `${kind} stays near`);
      assert.deepEqual(pose(kind, p, true), { x: 0, y: 0, scale: 1 }, `${kind}: none with motion reduced`);
    }
    assert.ok(far > 0.04, `${kind} moves`);
  }
  assert.ok(pose('happy', 0.5, false).y < 0, 'a hop goes up');
  assert.deepEqual(pose('cheer', 2, false), { x: 0, y: 0, scale: 1 }, 'after the end: at rest');
  assert.deepEqual(pose(null, 0.5, false), { x: 0, y: 0, scale: 1 });
});
