// The Night Garden's deep puzzles (SPEC section 20): each passes the level check, and the set keeps its rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LEVELS } from '../src/levels/index.js';
import { DAILY } from '../src/levels/daily.js';
import { NIGHT, GARDEN } from '../src/levels/night.js';
import { checkLevel } from '../src/solver.js';
import { checkTutorial } from '../src/ui/tutorial.js';

test('night: thirty deep puzzles, numbered N-1, N-2, … in order', () => {
  assert.equal(NIGHT.length, 30);
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

const species = (def) => def.feature.replace(/[^MSTDKOR]/g, '');

test('night: from N-11 they mix: crystal and at least two creatures, par 22 to 40, shortest par first', () => {
  const later = NIGHT.slice(10);
  for (const def of later) {
    assert.ok(def.feature.includes('*'), `${def.id}: crystal`);
    assert.ok(species(def).length >= 2, `${def.id} needs only ${species(def) || 'no creature'}`);
    assert.ok(def.par >= 22 && def.par <= 40, `${def.id}: par ${def.par}`);
  }
  for (let i = 1; i < later.length; i++) assert.ok(later[i].par >= later[i - 1].par, `${later[i].id} par ${later[i].par} after ${later[i - 1].par}`);
});

test('night: every deep puzzle has a short tip, and its name is its own', () => {
  const names = [...LEVELS, ...DAILY, ...NIGHT].map((d) => d.name);
  for (const def of NIGHT) {
    assert.ok(typeof def.tip === 'string' && def.tip.length > 0 && def.tip.length <= 70, `${def.id}: tip "${def.tip}"`);
    assert.equal(names.filter((n) => n === def.name).length, 1, `${def.id}: the name "${def.name}" is used twice`);
  }
});

test('night: no near copies: at least 6 tiles differ from every other deep puzzle and chapter level', () => {
  const differ = (a, b) => {
    if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
    let n = 0;
    for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
    return n;
  };
  for (let i = 0; i < NIGHT.length; i++) {
    for (const l of LEVELS) assert.ok(differ(NIGHT[i], l) >= 6, `${NIGHT[i].id} is close to ${l.id}`);
    for (let j = i + 1; j < NIGHT.length; j++) assert.ok(differ(NIGHT[i], NIGHT[j]) >= 6, `${NIGHT[i].id} and ${NIGHT[j].id}`);
  }
});
