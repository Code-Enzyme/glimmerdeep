// The two stores the game can sell through (SPEC section 14), as src/ui/billing.js builds them. The Play
// store is driven here through a fake of the Android Billing plugin, so its answers can be scripted.
import test from 'node:test';
import assert from 'node:assert/strict';
import { testStore, playStore } from '../src/ui/billing.js';
import { CATALOG } from '../src/ui/shop.js';

const purchase = (id, token, extra) => ({ products: [id], token, state: 'purchased', acknowledged: false, ...extra });

// A fake Billing plugin. `answers.buy` is a list of answers given in turn.
function fakeBilling(answers = {}) {
  const calls = [];
  const listeners = {};
  const buys = [...(answers.buy || [])];
  return {
    calls,
    emit: (name, data) => listeners[name](data),
    prices: async (o) => {
      calls.push(['prices', o]);
      if (answers.pricesFail) throw new Error('offline');
      return answers.prices === undefined ? { prices: { full_expedition: '£4.49' } } : answers.prices;
    },
    buy: async (o) => {
      calls.push(['buy', o]);
      return buys.length ? buys.shift() : { status: 'ok', message: '', purchases: [] };
    },
    owned: async () => {
      calls.push(['owned']);
      return answers.owned === undefined ? { purchases: [] } : answers.owned;
    },
    confirm: async (o) => {
      calls.push(['confirm', o]);
    },
    addListener: (name, fn) => {
      calls.push(['addListener', name]);
      listeners[name] = fn;
      return Promise.resolve({ remove: () => {} });
    },
  };
}

test('test store: prices from the catalog, and every purchase succeeds at once with its own token', async () => {
  const store = testStore(CATALOG);
  assert.equal(store.kind, 'test');
  assert.deepEqual(await store.prices(), { full_expedition: '$4.99', glimmer_10: '$0.99' });
  const a = await store.buy('glimmer_10');
  const b = await store.buy('glimmer_10');
  assert.equal(a.status, 'ok');
  assert.deepEqual(a.purchases.map((p) => [p.products, p.state, p.acknowledged]), [[['glimmer_10'], 'purchased', false]]);
  assert.notEqual(a.purchases[0].token, b.purchases[0].token);
  assert.deepEqual(await store.owned(), []);
  store.confirm([{ token: 'x', consume: true }]);
  store.onPurchases(() => {});
});

test('play store: asks the plugin for the catalog\'s prices', async () => {
  const billing = fakeBilling();
  const store = playStore(CATALOG, billing);
  assert.equal(store.kind, 'play');
  assert.deepEqual(await store.prices(), { full_expedition: '£4.49' });
  assert.deepEqual(billing.calls[0], ['prices', { ids: ['full_expedition', 'glimmer_10'] }]);
  assert.deepEqual(await playStore(CATALOG, fakeBilling({ prices: null })).prices(), {});
});

test('play store: a purchase passes through with its status and purchases', async () => {
  const billing = fakeBilling({ buy: [{ status: 'ok', message: '', purchases: [purchase('full_expedition', 'T1')] }] });
  const r = await playStore(CATALOG, billing).buy('full_expedition');
  assert.deepEqual(r, { status: 'ok', message: '', purchases: [purchase('full_expedition', 'T1')] });
  assert.deepEqual(billing.calls, [['buy', { id: 'full_expedition' }]]);
});

test('play store: cancelled, pending and failed purchases keep their status', async () => {
  for (const status of ['cancelled', 'pending', 'error']) {
    const billing = fakeBilling({ buy: [{ status, message: status === 'error' ? 'code 6' : '', purchases: [] }] });
    const r = await playStore(CATALOG, billing).buy('glimmer_10');
    assert.equal(r.status, status);
    assert.deepEqual(billing.calls.map((c) => c[0]), ['buy'], `${status}: nothing else asked`);
  }
});

test('play store: prices not loaded yet (offline at startup) are loaded, and the purchase tried once more', async () => {
  const billing = fakeBilling({ buy: [{ status: 'unready', message: '', purchases: [] }, { status: 'ok', message: '', purchases: [purchase('glimmer_10', 'J1')] }] });
  const r = await playStore(CATALOG, billing).buy('glimmer_10');
  assert.deepEqual(billing.calls.map((c) => c[0]), ['buy', 'prices', 'buy']);
  assert.equal(r.status, 'ok');
  assert.equal(r.purchases[0].token, 'J1');
  // still unready after that: say so, do not loop
  const stuck = fakeBilling({ buy: [{ status: 'unready' }, { status: 'unready' }, { status: 'ok' }] });
  assert.equal((await playStore(CATALOG, stuck).buy('glimmer_10')).status, 'unready');
  assert.deepEqual(stuck.calls.map((c) => c[0]), ['buy', 'prices', 'buy']);
  // the prices cannot be reached at all: unready, without asking again
  const offline = fakeBilling({ pricesFail: true, buy: [{ status: 'unready' }, { status: 'ok' }] });
  assert.equal((await playStore(CATALOG, offline).buy('glimmer_10')).status, 'unready');
  assert.deepEqual(offline.calls.map((c) => c[0]), ['buy', 'prices']);
});

test('play store: a purchase Play says is already owned is fetched from what the player owns', async () => {
  const billing = fakeBilling({
    buy: [{ status: 'ok', message: 'already owned', purchases: [] }],
    owned: { purchases: [purchase('full_expedition', 'T9', { acknowledged: true })] },
  });
  const r = await playStore(CATALOG, billing).buy('full_expedition');
  assert.deepEqual(billing.calls.map((c) => c[0]), ['buy', 'owned']);
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.purchases, [purchase('full_expedition', 'T9', { acknowledged: true })]);
});

test('play store: junk answers become an error with no purchases', async () => {
  for (const junk of [null, undefined, 'x', { purchases: 'no' }]) {
    const r = await playStore(CATALOG, fakeBilling({ buy: [junk], owned: { purchases: [] } })).buy('glimmer_10');
    assert.ok(['error', 'ok'].includes(r.status));
    assert.deepEqual(r.purchases, []);
    assert.equal(typeof r.message, 'string');
  }
  assert.equal((await playStore(CATALOG, fakeBilling({ buy: [null] })).buy('glimmer_10')).status, 'error');
});

test('play store: owned lists purchases, confirm only calls when there is something to confirm', async () => {
  const billing = fakeBilling({ owned: { purchases: [purchase('glimmer_10', 'J2')] } });
  const store = playStore(CATALOG, billing);
  assert.deepEqual(await store.owned(), [purchase('glimmer_10', 'J2')]);
  store.confirm([]);
  store.confirm(undefined);
  store.confirm([{ token: 'J2', consume: true }]);
  assert.deepEqual(billing.calls.filter((c) => c[0] === 'confirm'), [['confirm', { items: [{ token: 'J2', consume: true }] }]]);
});

test('play store: purchases that arrive later reach the game as a list', async () => {
  const billing = fakeBilling();
  const got = [];
  playStore(CATALOG, billing).onPurchases((list) => got.push(list));
  billing.emit('purchases', { purchases: [purchase('glimmer_10', 'J3')] });
  billing.emit('purchases', {});
  assert.deepEqual(got, [[purchase('glimmer_10', 'J3')], []]);
});
