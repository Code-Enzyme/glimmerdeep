// The save (src/ui/store.js): read and written through window.localStorage, which is stubbed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadSave, writeSave, recordResult, clearProgress, SAVE_KEY, parseSave, newerSave, setSaveMirror, savedDurably, saveWrites, adoptInto,
} from '../src/ui/store.js';

function withStorage(initial) {
  const data = new Map(initial === undefined ? [] : [[SAVE_KEY, initial]]);
  globalThis.window = {
    localStorage: {
      getItem: (k) => (data.has(k) ? data.get(k) : null),
      setItem: (k, v) => data.set(k, String(v)),
    },
  };
  return data;
}

test('store: a fresh save has no levels, no seen story pages and the default settings', () => {
  withStorage();
  const save = loadSave();
  assert.deepEqual(save.levels, {});
  assert.deepEqual(save.seen, []);
  assert.deepEqual(save.settings, {
    sound: true, contrast: false, unlockAll: false, tutorials: true, textSize: 1, readable: false, motion: 'system', lantern: 'tallow',
    arrows: false, hand: 'right', swipe: 'normal', talk: false,
  });
});

test('store: Board talk round-trips, junk reads as off, and a reset keeps it (SPEC section 28)', () => {
  const data = withStorage();
  const save = loadSave();
  save.settings.talk = true;
  writeSave(save);
  const again = loadSave();
  assert.equal(again.settings.talk, true);
  for (const junk of ['yes', 1, null, {}]) {
    data.set(SAVE_KEY, JSON.stringify({ settings: { talk: junk } }));
    assert.equal(loadSave().settings.talk, false, `talk: ${JSON.stringify(junk)}`);
  }
  clearProgress(again);
  assert.equal(again.settings.talk, true, 'Reset progress keeps it');
});

test('store: the control settings round-trip, and junk in them falls back to the defaults (SPEC section 27)', () => {
  const data = withStorage();
  const save = loadSave();
  Object.assign(save.settings, { arrows: true, hand: 'left', swipe: 'long' });
  writeSave(save);
  const again = loadSave();
  assert.deepEqual([again.settings.arrows, again.settings.hand, again.settings.swipe], [true, 'left', 'long']);
  data.set(SAVE_KEY, JSON.stringify({ settings: { arrows: 'yes', hand: 'middle', swipe: 3, sound: false } }));
  const junk = loadSave();
  assert.deepEqual([junk.settings.arrows, junk.settings.hand, junk.settings.swipe, junk.settings.sound], [false, 'right', 'normal', false]);
  clearProgress(again);
  assert.deepEqual([again.settings.arrows, again.settings.hand, again.settings.swipe], [true, 'left', 'long'], 'Reset progress keeps them');
});

test('store: the comfort settings round-trip, and junk in them falls back to the defaults (SPEC section 22)', () => {
  const data = withStorage();
  const save = loadSave();
  Object.assign(save.settings, { textSize: 2, readable: true, motion: 'reduced' });
  writeSave(save);
  const again = loadSave();
  assert.deepEqual([again.settings.textSize, again.settings.readable, again.settings.motion], [2, true, 'reduced']);
  data.set(SAVE_KEY, JSON.stringify({ settings: { textSize: 7, readable: 'on', motion: 'wild', sound: false } }));
  const junk = loadSave();
  assert.deepEqual([junk.settings.textSize, junk.settings.readable, junk.settings.motion, junk.settings.sound], [1, false, 'system', false]);
  clearProgress(again);
  assert.deepEqual([again.settings.textSize, again.settings.readable, again.settings.motion], [2, true, 'reduced'], 'Reset progress keeps them');
});

test('store: seen story pages round-trip through storage', () => {
  const data = withStorage();
  const save = loadSave();
  recordResult(save, '1-1', 5, 3);
  save.seen.push('prologue', 'ch1');
  assert.equal(writeSave(save), true);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).seen, ['prologue', 'ch1']);
  const again = loadSave();
  assert.deepEqual(again.seen, ['prologue', 'ch1']);
  assert.deepEqual(again.levels, { '1-1': { moves: 5, stars: 3 } });
});

test('store: an old save without seen, or with junk in it, loads cleanly', () => {
  withStorage(JSON.stringify({ levels: { '1-1': { moves: 5, stars: 2 } }, settings: { sound: false } }));
  const old = loadSave();
  assert.deepEqual(old.seen, []);
  assert.deepEqual(old.levels, { '1-1': { moves: 5, stars: 2 } });
  assert.equal(old.settings.sound, false);

  withStorage(JSON.stringify({ levels: {}, seen: ['ch2', 7, null, 'ch2', { id: 'x' }, 'prologue'] }));
  assert.deepEqual(loadSave().seen, ['ch2', 'prologue']);
  withStorage(JSON.stringify({ levels: {}, seen: 'prologue' }));
  assert.deepEqual(loadSave().seen, []);
});

test('store: reset progress clears levels and seen story pages, and keeps the settings', () => {
  withStorage();
  const save = loadSave();
  recordResult(save, '1-1', 5, 3);
  save.seen.push('prologue');
  save.settings.contrast = true;
  clearProgress(save);
  assert.deepEqual(save.levels, {});
  assert.deepEqual(save.seen, []);
  assert.equal(save.settings.contrast, true);
});

test('store: a fresh save has a fresh shop (SPEC section 14)', () => {
  withStorage();
  assert.deepEqual(loadSave().shop, { full: false, glimmer: 3, freeAt: 0, paid: [] });
});

test('store: the shop round-trips through storage, and an old save without one gets a fresh shop', () => {
  const data = withStorage();
  const save = loadSave();
  save.shop.full = true;
  save.shop.glimmer = 12;
  save.shop.freeAt = 1234;
  save.shop.paid.push('J1');
  assert.equal(writeSave(save), true);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).shop, { full: true, glimmer: 12, freeAt: 1234, paid: ['J1'] });
  assert.deepEqual(loadSave().shop, { full: true, glimmer: 12, freeAt: 1234, paid: ['J1'] });

  withStorage(JSON.stringify({ levels: {}, seen: [] }));
  assert.deepEqual(loadSave().shop, { full: false, glimmer: 3, freeAt: 0, paid: [] });
  withStorage(JSON.stringify({ levels: {}, shop: { full: 1, glimmer: 'lots' } }));
  assert.deepEqual(loadSave().shop, { full: false, glimmer: 0, freeAt: 0, paid: [] });
});

test('store: reset progress keeps the purchases and the Glimmer', () => {
  withStorage();
  const save = loadSave();
  save.shop.full = true;
  save.shop.glimmer = 9;
  recordResult(save, '1-1', 5, 3);
  clearProgress(save);
  assert.deepEqual(save.levels, {});
  assert.equal(save.shop.full, true);
  assert.equal(save.shop.glimmer, 9);
});

test('store: the Daily Glimmer records round-trip, junk is dropped, an old save gets none (SPEC section 15)', () => {
  const data = withStorage();
  const save = loadSave();
  assert.deepEqual(save.daily, {});
  save.daily['2026-11-18'] = { moves: 14, stars: 3 };
  writeSave(save);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).daily, { '2026-11-18': { moves: 14, stars: 3 } });
  assert.deepEqual(loadSave().daily, { '2026-11-18': { moves: 14, stars: 3 } });
  withStorage(JSON.stringify({ levels: {} }));
  assert.deepEqual(loadSave().daily, {});
  withStorage(JSON.stringify({ levels: {}, daily: { yesterday: { moves: 3, stars: 1 }, '2026-11-17': { moves: 8, stars: 2 } } }));
  assert.deepEqual(loadSave().daily, { '2026-11-17': { moves: 8, stars: 2 } });
});

test('store: reset progress clears the Daily Glimmer records too', () => {
  withStorage();
  const save = loadSave();
  save.daily['2026-11-18'] = { moves: 14, stars: 3 };
  clearProgress(save);
  assert.deepEqual(save.daily, {});
});

// ---------------------------------------------------------------- SPEC section 16: a save that survives a quick kill

test('store: every write counts up the save\'s revision, and a reset keeps counting', () => {
  const data = withStorage();
  const save = loadSave();
  assert.equal(save.rev, 0);
  writeSave(save);
  writeSave(save);
  assert.equal(save.rev, 2);
  assert.equal(JSON.parse(data.get(SAVE_KEY)).rev, 2);
  assert.equal(loadSave().rev, 2);
  clearProgress(save);
  writeSave(save);
  assert.equal(loadSave().rev, 3, 'a reset never goes back');
  withStorage(JSON.stringify({ levels: {}, rev: 'x' }));
  assert.equal(loadSave().rev, 0);
  withStorage(JSON.stringify({ levels: {}, rev: -4 }));
  assert.equal(loadSave().rev, 0);
  withStorage(JSON.stringify({ levels: {}, rev: 7.9 }));
  assert.equal(loadSave().rev, 7);
});

test('store: parseSave reads a saved string like loadSave, and junk as a fresh save', () => {
  withStorage();
  const save = loadSave();
  recordResult(save, '2-3', 9, 2);
  save.shop.full = true;
  const data = withStorage();
  writeSave(save);
  const parsed = parseSave(data.get(SAVE_KEY));
  assert.deepEqual(parsed, loadSave());
  assert.deepEqual(parsed.levels, { '2-3': { moves: 9, stars: 2 } });
  for (const junk of [null, '', 'nope', '42', '[]']) assert.deepEqual(parseSave(junk), parseSave(null));
  assert.equal(parseSave(null).rev, 0);
});

test('store: of two saves, the one with more writes wins; a tie keeps the first', () => {
  const a = { ...parseSave(null), rev: 4 };
  const b = { ...parseSave(null), rev: 6 };
  assert.equal(newerSave(a, b), b);
  assert.equal(newerSave(b, a), b);
  assert.equal(newerSave(a, { ...a }), a);
  assert.equal(newerSave(a, null), a);
});

test('store: every write goes to the mirror too, and savedDurably waits for it', async () => {
  const data = withStorage();
  const save = loadSave();
  const got = [];
  let finish;
  setSaveMirror((json) => {
    got.push(json);
    return new Promise((resolve) => { finish = resolve; });
  });
  const before = saveWrites();
  writeSave(save);
  assert.equal(saveWrites(), before + 1);
  assert.deepEqual(got, [data.get(SAVE_KEY)], 'the mirror gets exactly what was written');
  let done = false;
  savedDurably().then(() => { done = true; });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(done, false, 'not durable until the mirror answers');
  finish();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(done, true);

  // a mirror that fails, or throws, still lets the game go on
  setSaveMirror(() => Promise.reject(new Error('disk full')));
  writeSave(save);
  await savedDurably();
  setSaveMirror(() => { throw new Error('gone'); });
  assert.equal(writeSave(save), true);
  await savedDurably();
  setSaveMirror(null);
  writeSave(save);
  await savedDurably();
});

// ---------------------------------------------------------------- SPEC section 23: hidden Journal critters

test('store: the found critters round-trip, junk is dropped, an old save has none, a reset clears them', () => {
  const data = withStorage();
  const save = loadSave();
  assert.deepEqual(save.critters, []);
  save.critters.push('1-1', '2-3');
  writeSave(save);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).critters, ['1-1', '2-3']);
  assert.deepEqual(loadSave().critters, ['1-1', '2-3']);
  withStorage(JSON.stringify({ levels: {} }));
  assert.deepEqual(loadSave().critters, []);
  withStorage(JSON.stringify({ levels: {}, critters: ['1-1', 4, '', null, '1-1', 'N-2'] }));
  assert.deepEqual(loadSave().critters, ['1-1', 'N-2']);
  withStorage(JSON.stringify({ levels: {}, critters: '1-1' }));
  assert.deepEqual(loadSave().critters, []);
  save.settings.contrast = true;
  clearProgress(save);
  assert.deepEqual(save.critters, []);
  assert.equal(save.settings.contrast, true);
});

test('store: adopting a newer save takes every part of it, the found critters too, and an older one is left alone', () => {
  const mine = { ...parseSave(null), rev: 3 };
  const other = parseSave(JSON.stringify({
    levels: { '1-1': { moves: 5, stars: 3 } }, seen: ['prologue'], critters: ['1-1'], daily: { '2026-11-18': { moves: 9, stars: 2 } },
    shop: { full: true, glimmer: 7, freeAt: 0, paid: [] }, settings: { contrast: true, textSize: 2 }, rev: 9,
  }));
  assert.equal(adoptInto(mine, { ...other, rev: 2 }), false, 'an older copy changes nothing');
  assert.deepEqual(mine.levels, {});
  assert.equal(adoptInto(mine, other), true);
  for (const k of Object.keys(parseSave(null))) assert.deepEqual(mine[k], other[k], k);
  assert.deepEqual(mine.critters, ['1-1']);
});

test('store: the chosen lantern style round-trips, junk reads as Tallow, and a reset keeps it (SPEC section 24)', () => {
  const data = withStorage();
  const save = loadSave();
  save.settings.lantern = 'moonglass';
  writeSave(save);
  assert.equal(JSON.parse(data.get(SAVE_KEY)).settings.lantern, 'moonglass');
  assert.equal(loadSave().settings.lantern, 'moonglass');
  withStorage(JSON.stringify({ settings: { lantern: 'disco' } }));
  assert.equal(loadSave().settings.lantern, 'tallow');
  clearProgress(save);
  assert.equal(save.settings.lantern, 'moonglass');
});

// ---------------------------------------------------------------- SPEC section 26: the Workshop

test('store: Workshop caverns round-trip, junk is dropped, an old save has none, a reset keeps them', () => {
  const data = withStorage();
  const save = loadSave();
  assert.deepEqual(save.workshop, []);
  const cavern = {
    seed: 12, map: ['#####', '#W.G#', '#####'], gloam: false, shutter: false, par: 2, check: 'lit',
  };
  save.workshop.push(cavern);
  writeSave(save);
  assert.deepEqual(JSON.parse(data.get(SAVE_KEY)).workshop, [cavern]);
  assert.deepEqual(loadSave().workshop, [cavern]);
  withStorage(JSON.stringify({ levels: {} }));
  assert.deepEqual(loadSave().workshop, []);
  withStorage(JSON.stringify({ levels: {}, workshop: [cavern, { seed: 5, map: ['#?#'] }, 'x'] }));
  assert.deepEqual(loadSave().workshop, [cavern]);
  save.levels['1-1'] = { moves: 5, stars: 3 };
  clearProgress(save);
  assert.deepEqual(save.levels, {});
  assert.deepEqual(save.workshop, [cavern], 'Reset progress keeps your caverns');
  const other = { ...parseSave(JSON.stringify({ levels: {}, workshop: [cavern], rev: 9 })) };
  const mine = { ...parseSave(null), rev: 1 };
  adoptInto(mine, other);
  assert.deepEqual(mine.workshop, [cavern], 'a newer copy brings its caverns');
});
