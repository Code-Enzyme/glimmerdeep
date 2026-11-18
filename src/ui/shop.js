// The store's rules (SPEC section 14). No DOM and no clock of its own (callers pass `now`), so it all runs
// in Node tests. Which store sells (Google Play or the free test store) is src/ui/native.js's business;
// this file only decides what a purchase is worth and what a hint costs.

export const PRODUCTS = { full: 'full_expedition', jar: 'glimmer_10' };

// The prices here only show in the test store and until the real store's prices arrive.
export const CATALOG = [
  { id: PRODUCTS.full, kind: 'once', price: '$4.99' },                     // [PLACEHOLDER - PLAYTEST]
  { id: PRODUCTS.jar, kind: 'consumable', price: '$0.99', glimmer: 10 },   // [PLACEHOLDER - PLAYTEST]
];

export const FREE_CHAPTER = 1;
export const FREE_HINT_MS = 10 * 60 * 1000;   // [PLACEHOLDER - PLAYTEST] one free hint per this long
export const START_GLIMMER = 3;                // [PLACEHOLDER - PLAYTEST]
const PAID_KEEP = 50;                          // jar tokens remembered, so a re-reported jar never pays twice

export function freshShop() {
  return { full: false, glimmer: START_GLIMMER, freeAt: 0, paid: [] };
}

// The shop part of a stored save, with anything unsound dropped. Junk Glimmer counts as none.
export function readShop(raw) {
  const shop = freshShop();
  if (!raw || typeof raw !== 'object') return shop;
  shop.full = raw.full === true;
  if (raw.glimmer !== undefined) {
    shop.glimmer = typeof raw.glimmer === 'number' && Number.isFinite(raw.glimmer) ? Math.max(0, Math.floor(raw.glimmer)) : 0;
  }
  if (typeof raw.freeAt === 'number' && Number.isFinite(raw.freeAt) && raw.freeAt > 0) shop.freeAt = raw.freeAt;
  if (Array.isArray(raw.paid)) {
    for (const t of raw.paid) if (typeof t === 'string' && t && !shop.paid.includes(t)) shop.paid.push(t);
    shop.paid = shop.paid.slice(-PAID_KEEP);
  }
  return shop;
}

export function chapterOpen(shop, chapterId) {
  return chapterId === FREE_CHAPTER || !!(shop && shop.full);
}

// What the next hint costs. -> { kind: 'free' | 'glimmer' | 'wait', glimmer, waitMs }
// waitMs: how long until the next free hint (0 when one is free now).
export function hintCost(shop, now) {
  const since = now - (shop.freeAt || 0);
  const free = !shop.freeAt || since >= FREE_HINT_MS || since < 0;   // a clock set back never locks it away
  const waitMs = free ? 0 : FREE_HINT_MS - since;
  if (free) return { kind: 'free', glimmer: shop.glimmer, waitMs };
  if (shop.glimmer > 0) return { kind: 'glimmer', glimmer: shop.glimmer, waitMs };
  return { kind: 'wait', glimmer: 0, waitMs };
}

// Pays for one hint. -> 'free' | 'glimmer', or null when there is nothing to pay with (nothing changes)
export function payHint(shop, now) {
  const cost = hintCost(shop, now);
  if (cost.kind === 'free') {
    shop.freeAt = now;
    return 'free';
  }
  if (cost.kind === 'glimmer') {
    shop.glimmer -= 1;
    return 'glimmer';
  }
  return null;
}

export function minutesWord(ms) {
  return `${Math.max(1, Math.ceil(ms / 60000))} min`;
}

// The Hint button's second line: 'free', '3 left' or 'in 7 min'.
export function hintLabel(shop, now) {
  const cost = hintCost(shop, now);
  if (cost.kind === 'free') return 'free';
  if (cost.kind === 'glimmer') return `${cost.glimmer} left`;
  return `in ${minutesWord(cost.waitMs)}`;
}

// Grants what the store reports (Squirm's PurchaseBook rules). Mutates `shop`.
// -> { granted: [product id], confirm: [{ token, consume }] }
//    granted: what this call newly gave (for the thank-you); confirm: what to tell the store, in order.
export function settle(shop, purchases) {
  const granted = [];
  const confirm = [];
  for (const p of Array.isArray(purchases) ? purchases : []) {
    if (!p || p.state !== 'purchased' || !Array.isArray(p.products) || typeof p.token !== 'string' || !p.token) continue;
    for (const id of p.products) {
      if (id === PRODUCTS.full) {
        if (!shop.full) {
          shop.full = true;
          granted.push(id);
        }
        if (!p.acknowledged && !confirm.some((c) => c.token === p.token)) confirm.push({ token: p.token, consume: false });
        continue;
      }
      const jar = CATALOG.find((c) => c.id === id && c.kind === 'consumable');
      if (!jar) continue;
      if (!shop.paid.includes(p.token)) {
        shop.glimmer += jar.glimmer;
        shop.paid.push(p.token);
        if (shop.paid.length > PAID_KEEP) shop.paid.splice(0, shop.paid.length - PAID_KEEP);
        granted.push(id);
      }
      if (!confirm.some((c) => c.token === p.token)) confirm.push({ token: p.token, consume: true });
    }
  }
  return { granted, confirm };
}
