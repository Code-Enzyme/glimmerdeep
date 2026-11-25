// The store's rules (SPEC section 14): src/ui/shop.js has no DOM, so chapter locks, the hint price and
// how purchases pay out are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS, CATALOG, FREE_HINT_MS, START_GLIMMER, freshShop, readShop, chapterOpen, hintCost, payHint,
  hintLabel, settle, REVIEW_SALT, REVIEW_HASH, normalCode, redeemCode,
} from '../src/ui/shop.js';
import { sha256Hex } from '../src/ui/sha256.js';
import { createHash } from 'node:crypto';

const MIN = 60 * 1000;
const bought = (id, token, extra) => ({ products: [id], token, state: 'purchased', acknowledged: false, ...extra });

test('shop: the catalog has the Full Expedition and the Glimmer jar', () => {
  assert.equal(PRODUCTS.full, 'full_expedition');
  assert.equal(PRODUCTS.jar, 'glimmer_10');
  assert.deepEqual(CATALOG.map((p) => p.id), ['full_expedition', 'glimmer_10']);
  assert.equal(CATALOG.find((p) => p.id === 'glimmer_10').glimmer, 10);
  for (const p of CATALOG) assert.match(p.price, /^\$\d+\.\d\d$/);
  assert.equal(FREE_HINT_MS, 10 * MIN);
  assert.equal(START_GLIMMER, 3);
});

test('shop: a fresh shop owns nothing, has the starting Glimmer and has never taken a free hint', () => {
  assert.deepEqual(freshShop(), { full: false, glimmer: 3, freeAt: 0, paid: [] });
});

test('shop: readShop keeps what is sound and drops junk', () => {
  assert.deepEqual(readShop(undefined), freshShop());
  assert.deepEqual(readShop('nonsense'), freshShop());
  assert.deepEqual(readShop({ full: true, glimmer: 7, freeAt: 123, paid: ['a', 'b'] }), { full: true, glimmer: 7, freeAt: 123, paid: ['a', 'b'] });
  assert.deepEqual(readShop({ full: 'yes', glimmer: -4, freeAt: 'x', paid: [1, '', 'c', 'c'] }), { full: false, glimmer: 0, freeAt: 0, paid: ['c'] });
  assert.equal(readShop({ glimmer: 2.7 }).glimmer, 2);
});

test('shop: chapter 1 is free, later chapters need the Full Expedition', () => {
  const shop = freshShop();
  assert.equal(chapterOpen(shop, 1), true);
  for (const id of [2, 3, 4, 5, 6, 7]) assert.equal(chapterOpen(shop, id), false, `chapter ${id}`);
  shop.full = true;
  for (const id of [1, 2, 3, 4, 5, 6, 7]) assert.equal(chapterOpen(shop, id), true, `chapter ${id}`);
});

test('shop: the first hint is free, then Glimmer pays until ten minutes have passed', () => {
  const shop = freshShop();
  const t0 = 1_000_000_000_000;
  assert.equal(hintCost(shop, t0).kind, 'free');
  assert.equal(payHint(shop, t0), 'free');
  assert.equal(shop.freeAt, t0);
  assert.equal(shop.glimmer, 3);

  assert.equal(hintCost(shop, t0 + MIN).kind, 'glimmer');
  assert.equal(payHint(shop, t0 + MIN), 'glimmer');
  assert.equal(shop.glimmer, 2);
  assert.equal(shop.freeAt, t0, 'a paid hint does not restart the free-hint clock');

  assert.equal(payHint(shop, t0 + 10 * MIN), 'free');
  assert.equal(shop.glimmer, 2);
  assert.equal(shop.freeAt, t0 + 10 * MIN);
});

test('shop: with no free hint and no Glimmer a hint has to wait, and nothing is spent', () => {
  const shop = { ...freshShop(), glimmer: 0, freeAt: 5_000_000 };
  const cost = hintCost(shop, 5_000_000 + 3 * MIN);
  assert.equal(cost.kind, 'wait');
  assert.equal(cost.waitMs, 7 * MIN);
  assert.equal(payHint(shop, 5_000_000 + 3 * MIN), null);
  assert.deepEqual(shop, { ...freshShop(), glimmer: 0, freeAt: 5_000_000 });
});

test('shop: a clock set back never locks the free hint away', () => {
  const shop = { ...freshShop(), glimmer: 0, freeAt: 9_000_000 };
  assert.equal(hintCost(shop, 1_000_000).kind, 'free');
});

test('shop: the Hint button says what the next hint costs', () => {
  const t0 = 2_000_000_000_000;
  assert.equal(hintLabel(freshShop(), t0), 'free');
  assert.equal(hintLabel({ ...freshShop(), freeAt: t0 }, t0 + MIN), '3 left');
  assert.equal(hintLabel({ ...freshShop(), glimmer: 1, freeAt: t0 }, t0 + MIN), '1 left');
  assert.equal(hintLabel({ ...freshShop(), glimmer: 0, freeAt: t0 }, t0 + 3 * MIN), 'in 7 min');
  assert.equal(hintLabel({ ...freshShop(), glimmer: 0, freeAt: t0 }, t0 + 9 * MIN + 30 * 1000), 'in 1 min');
});

test('settle: the Full Expedition is granted and acknowledged once', () => {
  const shop = freshShop();
  const out = settle(shop, [bought('full_expedition', 'T1')]);
  assert.equal(shop.full, true);
  assert.deepEqual(out.granted, ['full_expedition']);
  assert.deepEqual(out.confirm, [{ token: 'T1', consume: false }]);
  // reported again, already acknowledged: nothing new to grant or confirm
  const again = settle(shop, [bought('full_expedition', 'T1', { acknowledged: true })]);
  assert.equal(shop.full, true);
  assert.deepEqual(again.granted, []);
  assert.deepEqual(again.confirm, []);
});

test('settle: a Glimmer jar pays out once per purchase, and is always consumed', () => {
  const shop = freshShop();
  const out = settle(shop, [bought('glimmer_10', 'J1')]);
  assert.equal(shop.glimmer, 13);
  assert.deepEqual(out.granted, ['glimmer_10']);
  assert.deepEqual(out.confirm, [{ token: 'J1', consume: true }]);
  // the consume failed and the store reports the same purchase again: no second payout, consume again
  const again = settle(shop, [bought('glimmer_10', 'J1')]);
  assert.equal(shop.glimmer, 13);
  assert.deepEqual(again.granted, []);
  assert.deepEqual(again.confirm, [{ token: 'J1', consume: true }]);
  // a second jar is a new purchase
  settle(shop, [bought('glimmer_10', 'J2')]);
  assert.equal(shop.glimmer, 23);
  assert.deepEqual(shop.paid, ['J1', 'J2']);
});

test('settle: pending and unknown purchases grant nothing', () => {
  const shop = freshShop();
  const out = settle(shop, [
    bought('full_expedition', 'P1', { state: 'pending' }),
    bought('glimmer_10', 'P2', { state: 'pending' }),
    bought('glimmer_10', 'P3', { state: 'other' }),
    bought('lantern_gold', 'X1'),
  ]);
  assert.deepEqual(shop, freshShop());
  assert.deepEqual(out, { granted: [], confirm: [] });
  // the pending payment clears later
  settle(shop, [bought('glimmer_10', 'P2')]);
  assert.equal(shop.glimmer, 13);
});

test('settle: only the last 50 jar tokens are remembered', () => {
  const shop = freshShop();
  for (let i = 0; i < 60; i++) settle(shop, [bought('glimmer_10', `J${i}`)]);
  assert.equal(shop.paid.length, 50);
  assert.equal(shop.paid[0], 'J10');
  assert.equal(shop.glimmer, 3 + 600);
});

test('settle: junk in the report is ignored', () => {
  const shop = freshShop();
  assert.deepEqual(settle(shop, null), { granted: [], confirm: [] });
  assert.deepEqual(settle(shop, [null, {}, { products: 'glimmer_10', token: 'Z', state: 'purchased' }]), { granted: [], confirm: [] });
  assert.deepEqual(shop, freshShop());
});

// ---------------------------------------------------------------- the reviewer code (SPEC section 14)

test('sha256Hex: the standard test vectors', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
});

test('sha256Hex: agrees with Node at every length around a block, and with letters beyond ASCII', () => {
  for (let n = 0; n < 200; n++) {
    const text = 'Wren\u2019s lantern \u00e9\u{1F56F}'.repeat(8).slice(0, n);
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'), `length ${n}`);
  }
});

test('normalCode: case, spaces and dashes do not matter', () => {
  assert.equal(normalCode(' ab12-cd34 ef56 '), 'AB12CD34EF56');
  assert.equal(normalCode('AB12CD34EF56'), 'AB12CD34EF56');
  assert.equal(normalCode(''), '');
  assert.equal(normalCode(null), '');
  assert.equal(normalCode(undefined), '');
});

test('redeemCode: the right code opens the Full Expedition once; nothing else changes the shop', () => {
  const hash = sha256Hex(REVIEW_SALT + 'TESTCODE2345');
  const shop = freshShop();
  assert.equal(redeemCode(shop, '', hash), 'empty');
  assert.equal(redeemCode(shop, '  - ', hash), 'empty');
  assert.equal(redeemCode(shop, 'TESTCODE2346', hash), 'wrong');
  assert.equal(redeemCode(shop, 'TESTCODE234', hash), 'wrong');
  assert.deepEqual(shop, freshShop(), 'a wrong or empty code changes nothing');
  assert.equal(redeemCode(shop, 'test-code 2345', hash), 'opened');
  assert.equal(shop.full, true);
  assert.deepEqual({ ...shop, full: false }, freshShop(), 'only the Full Expedition changes');
  assert.equal(redeemCode(shop, 'TESTCODE2345', hash), 'owned');
  assert.equal(shop.full, true);
});

test('redeemCode: what it opens is kept like a purchase', () => {
  const hash = sha256Hex(REVIEW_SALT + 'TESTCODE2345');
  const shop = freshShop();
  redeemCode(shop, 'TESTCODE2345', hash);
  assert.equal(readShop(JSON.parse(JSON.stringify(shop))).full, true, 'it survives the save');
  settle(shop, []);
  assert.equal(shop.full, true, 'a Restore that finds no purchase never takes it away');
});

test('redeemCode: the real code is only a hash, and no short or obvious code opens it', () => {
  assert.equal(REVIEW_SALT, 'glimmerdeep review code:');
  assert.match(REVIEW_HASH, /^[0-9a-f]{64}$/);
  const shop = freshShop();
  for (const guess of ['', 'GLIMMERDEEP', 'REVIEW', 'REVIEWER', 'GOOGLE', 'WREN', 'LANTERN', 'TEST', '1234', '0000', 'FREE']) {
    assert.notEqual(redeemCode(shop, guess), 'opened', guess);
  }
  assert.equal(shop.full, false);
});
