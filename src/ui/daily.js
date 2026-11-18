// The Daily Glimmer's rules (SPEC section 15): which cavern a date gets, the records, the streak and who may
// play which day. No DOM and no clock of its own: callers pass the date as 'YYYY-MM-DD'.

export const DAILY_EPOCH = '2026-01-01';   // day 0
export const ARCHIVE_DAYS = 6;             // days before today that the Full Expedition opens
export const DAILY_GLIMMER = 1;            // [PLACEHOLDER - PLAYTEST] for the first light of today's cavern
export const DAILY_KEEP = 400;             // dates remembered

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

// The date's midnight in UTC, ms, or null when it is not a real date. UTC keeps clock changes out of it.
function utc(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

const fromUtc = (t) => {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};

// The player's local calendar date.
export function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Days since 2026-01-01 (negative before it), or null for anything that is not a date.
export function dayNumber(key) {
  const t = utc(key);
  return t === null ? null : Math.round((t - utc(DAILY_EPOCH)) / DAY_MS);
}

export function addDays(key, n) {
  return fromUtc(utc(key) + n * DAY_MS);
}

// 'Wed 18 Nov'
export function dayLabel(key) {
  const d = new Date(utc(key));
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// '18 Nov', for the level screen and the result panel
export function dateLabel(key) {
  const d = new Date(utc(key));
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// The date's cavern from the pool, or null for an empty pool.
export function dailyLevel(pool, key) {
  const n = dayNumber(key);
  if (!pool || !pool.length || n === null) return null;
  return pool[((n % pool.length) + pool.length) % pool.length];
}

// The daily part of a stored save, with anything unsound dropped and only the newest dates kept.
export function readDaily(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const keys = Object.keys(raw).filter((k) => utc(k) !== null).sort();
  for (const k of keys) {
    const r = raw[k];
    if (!r || typeof r !== 'object') continue;
    const moves = Number(r.moves);
    const stars = Number(r.stars);
    if (!Number.isFinite(moves) || !Number.isFinite(stars) || moves < 1) continue;
    out[k] = { moves: Math.floor(moves), stars: Math.max(1, Math.min(3, Math.floor(stars))) };
  }
  const kept = Object.keys(out);
  for (const k of kept.slice(0, Math.max(0, kept.length - DAILY_KEEP))) delete out[k];
  return out;
}

// Records a finished attempt at a date's cavern, like a level's best. -> { record, first }
export function recordDaily(daily, key, moves, stars) {
  const old = daily[key];
  const record = old ? { moves: Math.min(old.moves, moves), stars: Math.max(old.stars, stars) } : { moves, stars };
  daily[key] = record;
  return { record, first: !old };
}

// -> { current, best }: current runs back from today, or from yesterday while today is not lit yet.
export function streakOf(daily, today) {
  const lit = (k) => !!daily[k];
  let current = 0;
  let k = lit(today) ? today : addDays(today, -1);
  while (lit(k)) {
    current++;
    k = addDays(k, -1);
  }
  let best = 0;
  let run = 0;
  let prev = null;
  for (const key of Object.keys(daily).filter((x) => utc(x) !== null).sort()) {
    run = prev !== null && dayNumber(key) === dayNumber(prev) + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = key;
  }
  return { current, best };
}

// The map card's row: the archive days, then today. -> [{ key, label, letter, today, stars }]
export function weekOf(daily, today) {
  const out = [];
  for (let i = ARCHIVE_DAYS; i >= 0; i--) {
    const key = addDays(today, -i);
    const label = dayLabel(key);
    out.push({ key, label, letter: label[0], today: i === 0, stars: daily[key] ? daily[key].stars : 0 });
  }
  return out;
}

// Today is free; the archive days need the Full Expedition; nothing else is offered.
export function dayOpen(shop, key, today) {
  const n = dayNumber(key);
  const t = dayNumber(today);
  if (n === null || t === null || n > t) return false;
  if (n === t) return true;
  return t - n <= ARCHIVE_DAYS && !!(shop && shop.full);
}

// A solved daily cavern: its record, and Glimmer for the first light of today's. Mutates both. -> { record, glimmer }
export function finishDaily(daily, shop, key, today, moves, stars) {
  const { record, first } = recordDaily(daily, key, moves, stars);
  const glimmer = first && key === today ? DAILY_GLIMMER : 0;
  shop.glimmer += glimmer;
  return { record, glimmer };
}
