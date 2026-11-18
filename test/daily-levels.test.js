// The Daily Glimmer's cavern pool (SPEC section 15): src/levels/daily.js. Par and the featured elements are
// checked with every chapter level by `npm run verify`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY } from '../src/levels/daily.js';
import { LEVELS } from '../src/levels/index.js';

const creatures = (def) => def.feature.replace(/[LA]/g, '').split('').sort().join('');

test('daily pool: a few dozen caverns, ids D-01 onward, every name its own', () => {
  assert.ok(DAILY.length >= 28, `${DAILY.length} caverns`);
  assert.deepEqual(DAILY.map((d) => d.id), DAILY.map((d, i) => `D-${String(i + 1).padStart(2, '0')}`));
  const names = [...LEVELS, ...DAILY].map((d) => d.name);
  for (const d of DAILY) {
    assert.equal(typeof d.name, 'string');
    assert.ok(d.name.length > 0 && d.name.length <= 20, `${d.id} name '${d.name}'`);
    assert.equal(names.filter((n) => n === d.name).length, 1, `${d.id} name '${d.name}' is used twice`);
  }
});

test('daily pool: never the shutter or the Mirrorbeetle, and no tutorial', () => {
  for (const d of DAILY) {
    assert.ok(!d.shutter, `${d.id} has the shutter`);
    assert.ok(!/[RA]/.test(d.feature), `${d.id} features ${d.feature}`);
    assert.ok(!d.map.some((row) => /[/\\]/.test(row)), `${d.id} has a Mirrorbeetle`);
    assert.equal(d.tutorial, undefined, `${d.id} has a tutorial`);
    assert.ok(creatures(d).length > 0, `${d.id} needs no creature`);
  }
});

test('daily pool: no copy of a chapter level', () => {
  const key = (d) => d.map.join('|') + JSON.stringify(d.under || {});
  const shipped = new Set(LEVELS.map(key));
  for (const d of DAILY) assert.ok(!shipped.has(key(d)), `${d.id} copies a chapter level`);
  assert.equal(new Set(DAILY.map(key)).size, DAILY.length, 'two daily caverns are the same');
});

test('daily pool: consecutive days, the last back round to the first, never feature the same creatures', () => {
  for (let i = 0; i < DAILY.length; i++) {
    const a = DAILY[i];
    const b = DAILY[(i + 1) % DAILY.length];
    assert.notEqual(creatures(a), creatures(b), `${a.id} and ${b.id} both feature ${creatures(a)}`);
  }
});
