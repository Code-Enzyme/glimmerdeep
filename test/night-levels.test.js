// The Night Garden's deep puzzles (SPEC section 20): each passes the level check, and the set keeps its rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels/index.js';
import { DAILY } from '../src/levels/daily.js';
import { NIGHT, GARDEN } from '../src/levels/night.js';
import { checkLevel } from '../src/solver.js';
import { checkTutorial } from '../src/ui/tutorial.js';

test('night: ten deep puzzles to start, numbered N-1, N-2, … in order', () => {
  assert.ok(NIGHT.length >= 10, `only ${NIGHT.length} deep puzzles`);
  NIGHT.forEach((def, i) => assert.equal(def.id, `N-${i + 1}`));
  assert.equal(GARDEN.levels, NIGHT);
  const ids = [...LEVELS, ...DAILY, ...NIGHT].map((d) => d.id);
  assert.deepEqual(ids.filter((id, i) => ids.indexOf(id) !== i), [], 'ids are unique across every set');
});

test('night: every deep puzzle passes checkLevel', async (t) => {
  for (const def of NIGHT) {
    await t.test(`${def.id} "${def.name}"`, () => {
      const result = checkLevel(def);
      assert.equal(result.ok, true, `${def.id}: ${result.problems.join('; ')}`);
    });
  }
});

test('night: every deep puzzle is built round crystal walls, with a par from 16 to 40', () => {
  for (const def of NIGHT) {
    assert.ok(def.feature.includes('*'), `${def.id}: crystal walls are not in its feature`);
    assert.ok(def.par >= 16 && def.par <= 40, `${def.id}: par ${def.par}`);
    assert.equal(typeof def.name, 'string');
    assert.ok(def.name.length > 0 && def.name.length <= 26, `${def.id}: name "${def.name}"`);
    assert.equal(typeof def.note, 'string');
  }
});

test('night: the first deep puzzle opens with the Crystal card, and every tutorial is sound', () => {
  assert.deepEqual(NIGHT[0].tutorial[0], { card: '*', until: 'card' });
  for (const def of NIGHT) assert.deepEqual(checkTutorial(def), [], def.id);
});
