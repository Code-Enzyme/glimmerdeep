// The Daily Glimmer's date rules (SPEC section 15): src/ui/daily.js has no DOM and no clock.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_EPOCH, ARCHIVE_DAYS, DAILY_GLIMMER, DAILY_KEEP, dateKey, dayNumber, addDays, dayLabel, dateLabel, dailyLevel,
  readDaily, recordDaily, streakOf, weekOf, dayOpen, finishDaily,
} from '../src/ui/daily.js';
import { freshShop } from '../src/ui/shop.js';

test('daily: the constants', () => {
  assert.equal(DAILY_EPOCH, '2026-01-01');
  assert.equal(ARCHIVE_DAYS, 6);
  assert.equal(DAILY_GLIMMER, 1);
  assert.equal(DAILY_KEEP, 400);
});

test('daily: a date is the local calendar date', () => {
  assert.equal(dateKey(new Date(2026, 10, 18, 0, 0, 1)), '2026-11-18');
  assert.equal(dateKey(new Date(2026, 10, 18, 23, 59, 59)), '2026-11-18');
  assert.equal(dateKey(new Date(2027, 0, 5, 12)), '2027-01-05');
});

test('daily: day numbers count from 2026-01-01, across months, leap years and clock changes', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-01-02'), 1);
  assert.equal(dayNumber('2026-03-30'), 88);   // the day after Europe's clocks go forward
  assert.equal(dayNumber('2026-11-18'), 321);
  assert.equal(dayNumber('2027-01-01'), 365);
  assert.equal(dayNumber('2028-12-31'), 365 * 3);   // 2028 is a leap year
  assert.equal(dayNumber('2025-12-31'), -1);
  assert.equal(dayNumber('nonsense'), null);
  assert.equal(dayNumber('2026-02-30'), null);
});

test('daily: adding days', () => {
  assert.equal(addDays('2026-11-18', -1), '2026-11-17');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-03-01', -1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-11-18', 0), '2026-11-18');
});

test('daily: the date as the map shows it', () => {
  assert.equal(dayLabel('2026-11-18'), 'Wed 18 Nov');
  assert.equal(dayLabel('2026-01-01'), 'Thu 1 Jan');
  assert.equal(dayLabel('2027-02-28'), 'Sun 28 Feb');
});

test('daily: the date as the level screen shows it, without the weekday so it fits a phone', () => {
  assert.equal(dateLabel('2026-11-18'), '18 Nov');
  assert.equal(dateLabel('2027-01-05'), '5 Jan');
});

test('daily: the day\'s cavern walks through the pool and wraps', () => {
  const pool = ['a', 'b', 'c'];
  assert.equal(dailyLevel(pool, '2026-01-01'), 'a');
  assert.equal(dailyLevel(pool, '2026-01-02'), 'b');
  assert.equal(dailyLevel(pool, '2026-01-04'), 'a');
  assert.equal(dailyLevel(pool, '2026-11-18'), pool[321 % 3]);
  assert.equal(dailyLevel(pool, '2025-12-31'), 'c', 'dates before the epoch still land in the pool');
  assert.equal(dailyLevel([], '2026-01-01'), null);
});

test('daily: readDaily keeps sound records and drops junk', () => {
  assert.deepEqual(readDaily(undefined), {});
  assert.deepEqual(readDaily('x'), {});
  assert.deepEqual(readDaily({
    '2026-11-18': { moves: 12.6, stars: 5 },
    '2026-11-17': { moves: 0, stars: 2 },
    '2026-13-01': { moves: 3, stars: 1 },
    'today': { moves: 3, stars: 1 },
    '2026-11-16': { moves: 'x', stars: 2 },
    '2026-11-15': { moves: 9, stars: 0 },
  }), { '2026-11-18': { moves: 12, stars: 3 }, '2026-11-15': { moves: 9, stars: 1 } });
  const many = {};
  for (let i = 0; i < 450; i++) many[addDays('2026-01-01', i)] = { moves: 5, stars: 2 };
  const kept = Object.keys(readDaily(many)).sort();
  assert.equal(kept.length, 400);
  assert.equal(kept[0], addDays('2026-01-01', 50), 'the oldest dates go first');
});

test('daily: a record keeps the fewest moves and the most star moss, and says when it is the first', () => {
  const daily = {};
  assert.deepEqual(recordDaily(daily, '2026-11-18', 20, 2), { record: { moves: 20, stars: 2 }, first: true });
  assert.deepEqual(recordDaily(daily, '2026-11-18', 24, 3), { record: { moves: 20, stars: 3 }, first: false });
  assert.deepEqual(recordDaily(daily, '2026-11-18', 18, 1), { record: { moves: 18, stars: 3 }, first: false });
  assert.deepEqual(daily, { '2026-11-18': { moves: 18, stars: 3 } });
});

test('daily: the streak runs back from today, or from yesterday while today is not lit', () => {
  const lit = (...keys) => Object.fromEntries(keys.map((k) => [k, { moves: 9, stars: 2 }]));
  const today = '2026-11-18';
  assert.deepEqual(streakOf({}, today), { current: 0, best: 0 });
  assert.deepEqual(streakOf(lit('2026-11-18'), today), { current: 1, best: 1 });
  assert.deepEqual(streakOf(lit('2026-11-16', '2026-11-17'), today), { current: 2, best: 2 }, 'today not lit yet');
  assert.deepEqual(streakOf(lit('2026-11-16', '2026-11-17', '2026-11-18'), today), { current: 3, best: 3 });
  assert.deepEqual(streakOf(lit('2026-11-15', '2026-11-16'), today), { current: 0, best: 2 }, 'a missed day ends it');
  assert.deepEqual(streakOf(lit('2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-11-18'), today), { current: 1, best: 4 });
  assert.deepEqual(streakOf(lit('2026-02-28', '2026-03-01'), '2026-03-01'), { current: 2, best: 2 }, 'across a month end');
  assert.deepEqual(streakOf(lit('2026-11-19'), today), { current: 0, best: 1 }, 'a date after today never counts as current');
});

test('daily: the week row is the 6 archive days, then today', () => {
  const week = weekOf({ '2026-11-17': { moves: 9, stars: 3 } }, '2026-11-18');
  assert.deepEqual(week.map((d) => d.key), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-11-18']);
  assert.deepEqual(week.map((d) => d.letter), ['T', 'F', 'S', 'S', 'M', 'T', 'W']);
  assert.deepEqual(week.map((d) => d.today), [false, false, false, false, false, false, true]);
  assert.deepEqual(week[5], { key: '2026-11-17', label: 'Tue 17 Nov', letter: 'T', today: false, stars: 3 });
  assert.equal(week[6].stars, 0);
});

test('daily: today is free, the archive needs the Full Expedition, nothing else opens', () => {
  const today = '2026-11-18';
  const free = freshShop();
  const full = { ...freshShop(), full: true };
  assert.equal(dayOpen(free, today, today), true);
  assert.equal(dayOpen(free, '2026-11-17', today), false);
  assert.equal(dayOpen(full, '2026-11-17', today), true);
  assert.equal(dayOpen(full, '2026-11-12', today), true);
  assert.equal(dayOpen(full, '2026-11-11', today), false, 'older than the archive');
  assert.equal(dayOpen(full, '2026-11-19', today), false, 'tomorrow');
  assert.equal(dayOpen(full, 'junk', today), false);
});

test('daily: the first light of today\'s cavern gives one Glimmer; replays and archive days give none', () => {
  const today = '2026-11-18';
  const daily = {};
  const shop = freshShop();
  assert.deepEqual(finishDaily(daily, shop, today, today, 20, 2), { record: { moves: 20, stars: 2 }, glimmer: 1 });
  assert.equal(shop.glimmer, 4);
  assert.deepEqual(finishDaily(daily, shop, today, today, 18, 3), { record: { moves: 18, stars: 3 }, glimmer: 0 });
  assert.equal(shop.glimmer, 4);
  assert.deepEqual(finishDaily(daily, shop, '2026-11-17', today, 11, 3), { record: { moves: 11, stars: 3 }, glimmer: 0 });
  assert.equal(shop.glimmer, 4);
});
