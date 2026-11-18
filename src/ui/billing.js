// The two stores the game can sell through (SPEC section 14). No Capacitor here: src/ui/native.js hands the
// Android Billing plugin to playStore, and picks which store the game gets. Both have the same shape:
//   { kind: 'play' | 'test',
//     prices() -> Promise<{ [id]: '$4.99' }>,
//     buy(id) -> Promise<{ status: 'ok' | 'cancelled' | 'pending' | 'unready' | 'error', message, purchases }>,
//     owned() -> Promise<purchases>,          // what the player owns, for startup and Restore
//     confirm([{ token, consume }]),           // acknowledge or consume what src/ui/shop.js granted
//     onPurchases(fn) }                         // purchases that arrive later (a pending payment clears)
// A purchase is { products: [id], token, state: 'purchased' | 'pending' | 'other', acknowledged }.

const STATUSES = ['ok', 'cancelled', 'pending', 'unready', 'error'];

// Debug apps, browsers and every check: each purchase succeeds at once, free.
export function testStore(catalog) {
  let n = 0;
  return {
    kind: 'test',
    prices: async () => Object.fromEntries(catalog.map((p) => [p.id, p.price])),
    buy: async (id) => {
      n += 1;
      return { status: 'ok', message: '', purchases: [{ products: [id], token: `test-${Date.now()}-${n}`, state: 'purchased', acknowledged: false }] };
    },
    owned: async () => [],
    confirm: () => {},
    onPurchases: () => {},
  };
}

// Release apps: Google Play, through `billing` (BillingPlugin in the Android project: prices({ ids }),
// buy({ id }), owned(), confirm({ items }), and 'purchases' events).
export function playStore(catalog, billing) {
  const ids = catalog.map((p) => p.id);
  const list = (r) => (r && typeof r === 'object' && Array.isArray(r.purchases) ? r.purchases : []);
  const answer = (r) => {
    const ok = r && typeof r === 'object';
    return {
      status: ok && STATUSES.includes(r.status) ? r.status : 'error',
      message: ok && typeof r.message === 'string' ? r.message : '',
      purchases: list(r),
    };
  };
  const prices = async () => {
    const r = await billing.prices({ ids });
    return (r && r.prices) || {};
  };
  return {
    kind: 'play',
    prices,
    buy: async (id) => {
      let r = answer(await billing.buy({ id }));
      if (r.status === 'unready') {
        // the prices never loaded (offline at startup): load them, then try once more
        try {
          await prices();
        } catch (e) {
          return r;
        }
        r = answer(await billing.buy({ id }));
      }
      if (r.status === 'ok' && !r.purchases.length) {
        // Play says it is already owned: grant it from what the player owns
        try {
          r.purchases = list(await billing.owned());
        } catch (e) {
          // Restore, or the next start, finds it
        }
      }
      return r;
    },
    owned: async () => list(await billing.owned()),
    confirm: (items) => {
      if (Array.isArray(items) && items.length) Promise.resolve(billing.confirm({ items })).catch(() => {});
    },
    onPurchases: (fn) => {
      try {
        Promise.resolve(billing.addListener('purchases', (r) => fn(list(r)))).catch(() => {});
      } catch (e) {
        // no late purchases then; Restore and the next start still find them
      }
    },
  };
}
