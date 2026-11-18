// The store's rules (SPEC section 14): src/ui/shop.js has no DOM, so chapter locks, the hint price and
// how purchases pay out are pinned here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCTS, CATALOG, FREE_HINT_MS, START_GLIMMER, freshShop, readShop, chapterOpen, hintCost, payHint,
  hintLabel, settle,
} from '../src/ui/shop.js';

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
