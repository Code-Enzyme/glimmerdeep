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
