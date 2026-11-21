// Every shipped level must pass the level check: it solves at exactly its par and each listed feature is
// necessary (SPEC.md section 6). One sub-test per level, so a failure names the level and says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';
import { checkLevel } from '../src/solver.js';

test('levels: ids are unique', () => {
  const ids = LEVELS.map((level) => level.id);
  const twice = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(twice, [], `duplicate level ids: ${twice.join(', ')}`);
});

test('levels: every level passes checkLevel', async (t) => {
  for (const level of LEVELS) {
    await t.test(`level ${level.id} "${level.name}"`, () => {
      const result = checkLevel(level);
      assert.equal(result.ok, true, `level ${level.id}: ${result.problems.join('; ')}`);
    });
  }
});

test('levels: every chapter ends with a Gloam encounter, and only there (SPEC section 17)', () => {
  for (const chapter of CHAPTERS) {
    const last = chapter.levels[chapter.levels.length - 1];
    assert.equal(last.gloam, true, `chapter ${chapter.id} ends with ${last.id}, not an encounter`);
    assert.equal(last.id, `${chapter.id}-${chapter.levels.length}`);
    assert.ok(last.feature.includes('H'), `${last.id}: the creeping Hush is its feature`);
    assert.ok(last.feature.includes(chapter.species), `${last.id}: it uses the chapter's creature, ${chapter.species}`);
    assert.ok(last.par >= 14 && last.par <= 34, `${last.id}: par ${last.par}`);
    for (const def of chapter.levels.slice(0, -1)) assert.notEqual(def.gloam, true, `${def.id} is not the chapter's last level`);
  }
});

// SPEC section 32: chapters of 19, eight new caverns before each encounter.
const KIND = { M: 'M', S: 'S', '^': 'T', '>': 'T', v: 'T', '<': 'T', n: 'D', e: 'D', s: 'D', w: 'D', K: 'K', O: 'O', '/': 'R', '\\': 'R' };
const differ = (a, b) => {
  if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
  let n = 0;
  for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
  return n;
};

test('levels: every chapter has 19 caverns, numbered in order, 133 in all (SPEC section 32)', () => {
  for (const chapter of CHAPTERS) {
    assert.equal(chapter.levels.length, 19, `chapter ${chapter.id}`);
    chapter.levels.forEach((def, i) => assert.equal(def.id, `${chapter.id}-${i + 1}`));
  }
  assert.equal(LEVELS.length, 133);
});

test('levels: the new caverns x-11 to x-18 use only what the player has met (SPEC section 32)', async (t) => {
  const { DAILY } = await import('../src/levels/daily.js');
  const { NIGHT } = await import('../src/levels/night.js');
  const every = [...LEVELS, ...DAILY, ...NIGHT];
  const names = every.map((d) => d.name);
  for (const [c, chapter] of CHAPTERS.entries()) {
    const met = CHAPTERS.slice(0, c + 1).map((ch) => ch.species);
    for (const def of chapter.levels.slice(10, 18)) {
      await t.test(def.id, () => {
        const all = def.map.join('') + Object.values(def.under || {}).join('');
        assert.ok(def.feature.includes(chapter.species), `${def.id}: features ${chapter.species}`);
        for (const ch of all) if (KIND[ch]) assert.ok(met.includes(KIND[ch]), `${def.id}: a ${KIND[ch]} before its chapter`);
        assert.ok(!all.includes('*') && !def.feature.includes('*'), `${def.id}: no crystal`);
        assert.ok(!def.gloam && !def.feature.includes('H'), `${def.id}: no creeping Hush`);
        if (chapter.id < 5) assert.ok(!all.includes('H'), `${def.id}: no Hush pool before chapter 5`);
        if (chapter.id < 2) assert.ok(!/[abcABC]/.test(all), `${def.id}: no root or gate in chapter 1`);
        if (chapter.id !== 7) assert.ok(!def.shutter && !def.feature.includes('A'), `${def.id}: the shutter only in chapter 7`);
        assert.ok(def.par >= 16 && def.par <= 36, `${def.id}: par ${def.par}`);
        assert.ok(typeof def.name === 'string' && def.name.length > 0 && def.name.length <= 26, `${def.id}: name "${def.name}"`);
        assert.equal(names.filter((n) => n === def.name).length, 1, `${def.id}: the name "${def.name}" is used twice`);
        assert.ok(typeof def.note === 'string' && def.note.length > 0, `${def.id}: a designer's note`);
        assert.ok(Array.isArray(def.critter), `${def.id}: a hidden critter`);
        assert.equal(def.tutorial, undefined, `${def.id}: no tutorial`);
        const near = every.filter((o) => o !== def && differ(def, o) < 6).map((o) => o.id);
        assert.deepEqual(near, [], `${def.id}: near copies`);
      });
    }
  }
});
