// Lantern styles (SPEC section 24): which exist, when they unlock with star moss, and which one is in use.
// src/ui/lanterns.js has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LANTERNS, starMoss, isUnlocked, lanternInUse, readLantern, lanternById, checkLanterns } from '../src/ui/lanterns.js';

const saveWith = (stars, lantern) => {
  const levels = {};
  stars.forEach((s, i) => { levels[`1-${i + 1}`] = { moves: 5, stars: s }; });
  return { levels, daily: { '2026-11-18': { moves: 3, stars: 3 } }, settings: { lantern } };
};

test('lanterns: six styles in order, Tallow first and free, each needing more star moss', () => {
  assert.deepEqual(LANTERNS.map((l) => l.id), ['tallow', 'mossglow', 'emberrose', 'moonglass', 'heartroot', 'gloamlight']);
  assert.deepEqual(LANTERNS.map((l) => l.name), ['Tallow', 'Mossglow', 'Ember rose', 'Moonglass', 'Heartroot', 'Gloamlight']);
  assert.deepEqual(LANTERNS.map((l) => l.moss), [0, 30, 60, 100, 150, 200]);
  for (const l of LANTERNS) {
    for (const k of ['glass', 'flame', 'rim', 'halo']) assert.ok(l[k], `${l.id} has ${k}`);
    assert.equal(l.light.length, 3, `${l.id}: light is r, g, b`);
    assert.ok(l.light.every((c) => Number.isInteger(c) && c >= 0 && c <= 255), l.id);
    assert.equal(l.glass.length, 4, `${l.id}: four glass colours, centre to edge`);
  }
  assert.deepEqual(lanternById('tallow').light, [255, 190, 104], 'Tallow keeps the light the game always had');
  assert.equal(lanternById('nope'), null);
});

test('lanterns: the notes break no text rule', () => {
  assert.deepEqual(checkLanterns(), []);
  const problems = checkLanterns([{ ...LANTERNS[0], note: 'x'.repeat(101) }, { ...LANTERNS[1], note: 'Her lamp.' }, { ...LANTERNS[2], note: '' }]);
  assert.equal(problems.length, 3, problems.join('; '));
});

test('lanterns: star moss counts the level records only, not the Daily Glimmer', () => {
  assert.equal(starMoss({ levels: {} }), 0);
  assert.equal(starMoss(saveWith([3, 2, 1])), 6);
  assert.equal(starMoss({ levels: { 'N-1': { moves: 9, stars: 3 }, '1-1': { moves: 5, stars: 2 } } }), 5);
});

test('lanterns: a style unlocks at its star moss, and Unlock all never unlocks one', () => {
  const style = lanternById('mossglow');
  assert.equal(isUnlocked(lanternById('tallow'), { levels: {} }), true);
  assert.equal(isUnlocked(style, saveWith(new Array(10).fill(2))), false, '20 moss');
  assert.equal(isUnlocked(style, saveWith(new Array(10).fill(3))), true, '30 moss');
  const unlockAll = { ...saveWith([1]), settings: { unlockAll: true } };
  assert.equal(isUnlocked(style, unlockAll), false);
});

test('lanterns: the chosen style is in use while unlocked, else Tallow', () => {
  assert.equal(lanternInUse(saveWith([], undefined)).id, 'tallow');
  assert.equal(lanternInUse(saveWith(new Array(10).fill(3), 'mossglow')).id, 'mossglow');
  assert.equal(lanternInUse(saveWith([3], 'mossglow')).id, 'tallow', 'not enough moss (after a reset, say)');
  assert.equal(lanternInUse(saveWith(new Array(10).fill(3), 'gone')).id, 'tallow');
});

test('lanterns: a saved choice reads back only as a known id', () => {
  assert.equal(readLantern('moonglass'), 'moonglass');
  for (const junk of [undefined, null, 7, '', 'Moonglass', { id: 'tallow' }]) assert.equal(readLantern(junk), 'tallow');
});
