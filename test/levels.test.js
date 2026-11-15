// Every shipped level must pass the level check: it solves at exactly its par and each listed feature is
// necessary (SPEC.md section 6). One sub-test per level, so a failure names the level and says why.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels/index.js';
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
