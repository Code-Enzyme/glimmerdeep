// The save (src/ui/store.js): read and written through window.localStorage, which is stubbed here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSave, writeSave, recordResult, clearProgress, SAVE_KEY } from '../src/ui/store.js';

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
  assert.deepEqual(save.settings, { sound: true, contrast: false, unlockAll: false, tutorials: true });
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
