// The Night Garden (SPEC section 20): when it opens. Pure rules in src/ui/garden.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { GARDEN_MOSS, STORY_END, chapterMoss, gardenState, gardenNote, puzzleOpen, levelTitle } from '../src/ui/garden.js';

const levels = (pairs) => Object.fromEntries(pairs.map(([id, stars]) => [id, { moves: 9, stars }]));

test('garden: the story ends with the last chapter\'s last level, and the garden needs 100 star moss', () => {
  const last = CHAPTERS[CHAPTERS.length - 1];
  assert.equal(STORY_END, last.levels[last.levels.length - 1].id);
  assert.equal(STORY_END, '7-11');
  assert.equal(GARDEN_MOSS, 100);
});

test('garden: only the chapters\' star moss counts, not the garden\'s own or the daily caverns\'', () => {
  const save = { levels: levels([['1-1', 3], ['1-2', 2], [NIGHT[0] ? NIGHT[0].id : 'N-1', 3], ['zz', 3]]) };
  assert.equal(chapterMoss(save, LEVELS), 5);
  assert.equal(chapterMoss({ levels: {} }, LEVELS), 0);
});

test('garden: it opens once the story is done and there is enough star moss', () => {
  const all = (stars) => levels(LEVELS.map((l) => [l.id, stars]));
  const done = gardenState({ levels: all(2) }, LEVELS);
  assert.deepEqual(done, { open: true, story: true, moss: LEVELS.length * 2, need: GARDEN_MOSS });
  const poor = gardenState({ levels: all(1) }, LEVELS);
  assert.deepEqual(poor, { open: LEVELS.length >= GARDEN_MOSS, story: true, moss: LEVELS.length, need: GARDEN_MOSS });
  const early = { levels: all(3) };
  delete early.levels[STORY_END];
  const s = gardenState(early, LEVELS);
  assert.equal(s.open, false, 'plenty of moss, but the story is not done');
  assert.equal(s.story, false);
});

test('garden: the map says what it waits for', () => {
  assert.equal(gardenNote({ open: false, story: false, moss: 64, need: 100 }), 'Opens when the story is done and you have 100 star moss. You have 64.');
  assert.equal(gardenNote({ open: false, story: false, moss: 120, need: 100 }), 'Opens when the story is done and you have 100 star moss. You have it.');
  assert.equal(gardenNote({ open: false, story: true, moss: 99, need: 100 }), 'Opens when the story is done and you have 100 star moss. You have 99.');
  assert.equal(gardenNote({ open: true, story: true, moss: 150, need: 100 }), '');
});

// a stand-in garden of three puzzles, so these rules do not wait on the real levels
const GARDEN3 = [{ id: 'N-1' }, { id: 'N-2' }, { id: 'N-3' }];
const storyDone = (stars) => levels(LEVELS.map((l) => [l.id, stars]));

test('garden: its first puzzle opens with the garden; after that a puzzle opens when it or the one before is lit', () => {
  const [one, two, three] = GARDEN3;
  const closed = { levels: {} };
  assert.equal(puzzleOpen(one, closed, GARDEN3, LEVELS, false), false);
  assert.equal(puzzleOpen(two, closed, GARDEN3, LEVELS, false), false);
  const open = { levels: storyDone(3) };
  assert.equal(puzzleOpen(one, open, GARDEN3, LEVELS, false), true);
  assert.equal(puzzleOpen(two, open, GARDEN3, LEVELS, false), false, 'the one before is not lit');
  open.levels['N-1'] = { moves: 20, stars: 2 };
  assert.equal(puzzleOpen(two, open, GARDEN3, LEVELS, false), true);
  assert.equal(puzzleOpen(three, open, GARDEN3, LEVELS, false), false);
  // a puzzle once lit stays open, even if the garden would not open now
  assert.equal(puzzleOpen(one, { levels: { 'N-1': { moves: 20, stars: 1 } } }, GARDEN3, LEVELS, false), true);
});

test('garden: Unlock all skips the order and the star moss', () => {
  for (const def of GARDEN3) assert.equal(puzzleOpen(def, { levels: {} }, GARDEN3, LEVELS, true), true);
  assert.equal(puzzleOpen({ id: '1-1' }, { levels: {} }, GARDEN3, LEVELS, true), false, 'not a garden puzzle');
});

test('garden: a deep puzzle is called "Night Garden 3", any other level "Level 1-2"', () => {
  assert.equal(levelTitle({ id: 'N-3' }), 'Night Garden 3');
  assert.equal(levelTitle({ id: 'N-10' }), 'Night Garden 10');
  assert.equal(levelTitle({ id: '1-2' }), 'Level 1-2');
  assert.equal(levelTitle({ id: 7 }), 'Level 7');
  assert.equal(levelTitle({}), 'Test cavern');
  assert.equal(levelTitle({ id: 'workshop' }), 'Your cavern', 'a Workshop cavern (SPEC section 26)');
  assert.equal(levelTitle({ id: 'shared' }), 'Shared cavern', 'a cavern played from a code');
});
