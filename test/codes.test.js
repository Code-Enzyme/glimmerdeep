// Share codes for Workshop caverns (SPEC section 26): a whole cavern packed into a short code and back.
// src/ui/codes.js has no DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCavern, decodeCavern, SYMBOLS, CODE_VERSION } from '../src/ui/codes.js';

const cavern = (over = {}) => ({
  seed: 345,
  map: ['#######', '#.....#', '#.~...#', '#W..M.G', '#.....#', '#######'],
  gloam: false,
  shutter: false,
  par: 9,
  check: 'lit',
  ...over,
});
const strip = (c) => ({ seed: c.seed, map: c.map, gloam: c.gloam, shutter: c.shutter, par: c.par });

test('codes: the symbols, in order', () => {
  assert.equal(SYMBOLS, '#.~GHabcABC*WMS^>v<neswKO/\\L');
  assert.equal(SYMBOLS.length, 28);
  assert.equal(CODE_VERSION, 1);
});

test('codes: a cavern comes back exactly', () => {
  const c = cavern();
  const code = encodeCavern(c);
  const back = decodeCavern(code);
  assert.equal(back.ok, true, back.why);
  assert.deepEqual(back.cavern, strip(c));
});

test('codes: groups of four from Crockford base 32, joined by dashes', () => {
  const code = encodeCavern(cavern());
  assert.match(code, /^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{1,4}(-[0-9ABCDEFGHJKMNPQRSTVWXYZ]{1,4})*$/);
  for (const group of code.split('-').slice(0, -1)) assert.equal(group.length, 4);
  assert.ok(code.replace(/-/g, '').length <= 40, `a small cavern has a short code: ${code}`);
});

test('codes: every symbol, the flags, the largest size and long runs survive', () => {
  const big = [
    '#########',
    '#W.~GHabc',
    'ABC*MS^>v',
    '<neswKO/\\',
    'L........',
    '.........',
    '.........',
    '#########',
    '#########',
    '#########',
    '#########',
  ];
  const c = cavern({ map: big, gloam: true, shutter: true, seed: 1023, par: 255 });
  const back = decodeCavern(encodeCavern(c));
  assert.equal(back.ok, true, back.why);
  assert.deepEqual(back.cavern, strip(c));
  const tiny = cavern({ map: ['###', '#WG', '###'], seed: 0, par: 1 });
  assert.deepEqual(decodeCavern(encodeCavern(tiny)).cavern, strip(tiny));
});

test('codes: reading is forgiving of case, spaces, dashes and look-alike letters', () => {
  const c = cavern();
  const code = encodeCavern(c);
  const messy = ' ' + code.toLowerCase().replace(/-/g, ' - ') + '\n';
  assert.deepEqual(decodeCavern(messy).cavern, strip(c));
  if (/[01]/.test(code)) {
    const lookalike = code.replace(/1/g, 'l').replace(/0/g, 'O');
    assert.deepEqual(decodeCavern(lookalike).cavern, strip(c));
  }
  assert.deepEqual(decodeCavern(code.replace(/1/g, 'I')).cavern, strip(c));
});

test('codes: a typo, a cut-off code or a newer version is told apart', () => {
  const code = encodeCavern(cavern());
  const chars = code.replace(/-/g, '');
  const swap = (s, i) => s.slice(0, i) + (s[i] === '7' ? '8' : '7') + s.slice(i + 1);
  // (the first two characters are the checksum, the next two hold the length)
  for (const i of [0, 5, 9, chars.length - 1]) {
    const r = decodeCavern(swap(chars, i));
    assert.deepEqual(r, { ok: false, why: 'That code has a typo in it.' }, `typo at ${i}`);
  }
  assert.deepEqual(decodeCavern(chars.slice(0, 6)), { ok: false, why: 'That code is not complete.' });
  assert.deepEqual(decodeCavern(''), { ok: false, why: 'That code is not complete.' });
  assert.equal(decodeCavern('hello there!').ok, false);
  assert.deepEqual(decodeCavern(chars + 'Q'), { ok: false, why: 'That code has a typo in it.' }, 'one too many');
  assert.deepEqual(decodeCavern(chars.slice(0, 5) + 'U' + chars.slice(6)), { ok: false, why: 'That code has a typo in it.' }, 'not a code letter');
  // version 2: the first three bits are 010
  const newer = encodeCavern(cavern(), { version: 2 });
  assert.deepEqual(decodeCavern(newer), { ok: false, why: 'That code is from a newer Glimmerdeep.' });
});

test('codes: a cavern that cannot be written is refused', () => {
  assert.throws(() => encodeCavern(cavern({ par: null })), /par/);
  assert.throws(() => encodeCavern(cavern({ par: 256 })), /par/);
  assert.throws(() => encodeCavern(cavern({ seed: 1024 })), /seed/);
  assert.throws(() => encodeCavern(cavern({ map: ['##', '##'] })), /size/);
  assert.throws(() => encodeCavern(cavern({ map: ['##########', '#W......G#', '##########'] })), /size/);
  assert.throws(() => encodeCavern(cavern({ map: ['####', '#WG#', '###'] })), /rows/);
  assert.throws(() => encodeCavern(cavern({ map: ['####', '#WGx', '####'] })), /x/);
});
