// Open ahead (SPEC section 29): from chapter 2, the three caverns after a lit one are open.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AHEAD, levelOpen, lockedWhy, othersOpen } from '../src/ui/paths.js';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';

const lv = (id) => ({ id, name: id });
const one = { id: 1, levels: ['1-1', '1-2', '1-3', '1-4'].map(lv) };
const two = { id: 2, levels: ['2-1', '2-2', '2-3', '2-4', '2-5', '2-6', '2-7'].map(lv) };
const empty = { id: 3, levels: [] };
const three = { id: 4, levels: ['4-1', '4-2'].map(lv) };
const chapters = [one, two, empty, three];
const levels = chapters.flatMap((c) => c.levels);
const byId = (id) => levels.find((d) => d.id === id);
const lit = (...ids) => Object.fromEntries(ids.map((id) => [id, { moves: 5, stars: 1 }]));
const opened = (records) => levels.filter((d) => levelOpen(d, chapters, records)).map((d) => d.id);

test('open ahead: three caverns ahead', () => {
  assert.equal(AHEAD, 3);
});

test('open ahead: chapter 1 keeps its order', () => {
  assert.deepEqual(opened({}), ['1-1']);
  assert.deepEqual(opened(lit('1-1')), ['1-1', '1-2']);
  assert.deepEqual(opened(lit('1-1', '1-2')), ['1-1', '1-2', '1-3']);
});

test('open ahead: a chapter opens with the last cavern of the one before, and its first cavern comes first', () => {
  assert.deepEqual(opened(lit('1-1', '1-2', '1-3')), ['1-1', '1-2', '1-3', '1-4']);
  assert.deepEqual(opened(lit('1-1', '1-2', '1-3', '1-4')), ['1-1', '1-2', '1-3', '1-4', '2-1']);
});

test('open ahead: from chapter 2, a lit cavern opens the three after it in its chapter', () => {
  const ch1 = ['1-1', '1-2', '1-3', '1-4'];
  assert.deepEqual(opened(lit(...ch1, '2-1')), [...ch1, '2-1', '2-2', '2-3', '2-4']);
  assert.deepEqual(opened(lit(...ch1, '2-1', '2-2')), [...ch1, '2-1', '2-2', '2-3', '2-4', '2-5']);
  // stuck on 2-3, the player lit 2-4 and 2-5 instead: 2-3 stays open, and the window moves on
  assert.deepEqual(opened(lit(...ch1, '2-1', '2-2', '2-4', '2-5')), [...ch1, '2-1', '2-2', '2-3', '2-4', '2-5', '2-6', '2-7']);
});

test('open ahead: the window stops at the end of a chapter, and an empty chapter is skipped', () => {
  const ch1 = ['1-1', '1-2', '1-3', '1-4'];
  assert.ok(!levelOpen(byId('4-1'), chapters, lit(...ch1, '2-1', '2-4', '2-5', '2-6')), 'the next chapter waits for the last cavern');
  assert.ok(levelOpen(byId('4-1'), chapters, lit(...ch1, '2-7')), 'the last cavern of chapter 2 opens chapter 4 past the empty one');
  assert.ok(!levelOpen(byId('4-2'), chapters, lit(...ch1, '2-7')), 'the window does not reach across chapters');
});

test('open ahead: a lit cavern is always open', () => {
  assert.ok(levelOpen(byId('2-6'), chapters, lit('2-6')));
});

test('open ahead: a locked cavern says what opens it', () => {
  assert.equal(lockedWhy(byId('1-3'), chapters), 'Solve the level before it first.');
  assert.equal(lockedWhy(byId('2-1'), chapters), 'Solve the level before it first.');
  assert.equal(lockedWhy(byId('2-2'), chapters), 'Solve the level before it first.');
  assert.equal(lockedWhy(byId('2-3'), chapters), 'Solve one of the two levels before it first.');
  assert.equal(lockedWhy(byId('2-4'), chapters), 'Solve one of the three levels before it first.');
  assert.equal(lockedWhy(byId('2-7'), chapters), 'Solve one of the three levels before it first.');
});

test('open ahead: how many other caverns are open and not lit, for the stuck nudge', () => {
  const ch1 = ['1-1', '1-2', '1-3', '1-4'];
  const records = lit(...ch1, '2-1', '2-2');
  const isOpen = (d) => levelOpen(d, chapters, records);
  assert.equal(othersOpen(byId('2-3'), levels, isOpen, records), 2);   // 2-4 and 2-5
  assert.equal(othersOpen(byId('2-1'), levels, isOpen, records), 3);   // replaying a lit one: 2-3, 2-4, 2-5
  const early = lit(...ch1);
  assert.equal(othersOpen(byId('2-1'), levels, (d) => levelOpen(d, chapters, early), early), 0);
  assert.equal(othersOpen(byId('1-2'), levels, (d) => levelOpen(d, chapters, lit('1-1')), lit('1-1')), 0);
});

test('open ahead: the real chapters, with chapter 1 lit, open only 2-1; with 2-1 lit, three more', () => {
  const ch1 = CHAPTERS[0].levels.map((d) => d.id);
  const ch2 = CHAPTERS[1].levels;
  const open = (records) => LEVELS.filter((d) => levelOpen(d, CHAPTERS, records)).map((d) => d.id);
  assert.deepEqual(open(lit(...ch1)), [...ch1, ch2[0].id]);
  assert.deepEqual(open(lit(...ch1, ch2[0].id)), [...ch1, ...ch2.slice(0, 4).map((d) => d.id)]);
});
