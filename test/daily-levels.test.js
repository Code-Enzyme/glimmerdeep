// The Daily Glimmer's cavern pool (SPEC section 15): src/levels/daily.js. Par and the featured elements are
// checked with every chapter level by `npm run verify`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DAILY } from '../src/levels/daily.js';
import { LEVELS } from '../src/levels/index.js';

const creatures = (def) => def.feature.replace(/[LA]/g, '').split('').sort().join('');

test('daily pool: 365 caverns, one for every day of a year, ids D-01 onward, every name its own', () => {
  assert.equal(DAILY.length, 365);
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

test('daily pool: every par is 12 to 26', () => {
  for (const d of DAILY) assert.ok(d.par >= 12 && d.par <= 26, `${d.id} par ${d.par}`);
});

test('daily pool: each of the six creatures is needed in at least 20 caverns', () => {
  for (const c of 'MSTDKO') {
    const n = DAILY.filter((d) => d.feature.includes(c)).length;
    assert.ok(n >= 20, `${c} is needed in only ${n} caverns`);
  }
});

test('daily pool: no near copies: two caverns of one size differ in at least 6 tiles, and none is a chapter level', () => {
  const differ = (a, b) => {
    if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
    let n = 0;
    for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
    return n;
  };
  for (let i = 0; i < DAILY.length; i++) {
    for (const l of LEVELS) assert.ok(differ(DAILY[i], l) >= 6, `${DAILY[i].id} is close to ${l.id}`);
    for (let j = i + 1; j < DAILY.length; j++) assert.ok(differ(DAILY[i], DAILY[j]) >= 6, `${DAILY[i].id} and ${DAILY[j].id} are near copies`);
  }
});
