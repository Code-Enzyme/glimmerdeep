// Saving. One localStorage key holds per-level bests, the story pages already shown, the shop (purchases and
// Glimmer, SPEC section 14), the Daily Glimmer records (section 15) and the settings. Every read and write is guarded:
// the game must play the same with storage missing, full or blocked (private mode, file:// policies).

import { freshShop, readShop } from './shop.js';
import { readDaily } from './daily.js';

export const SAVE_KEY = 'glimmerdeep.v1';

const SETTING_DEFAULTS = { sound: true, contrast: false, unlockAll: false, tutorials: true };

function freshSave() {
  return { levels: {}, seen: [], shop: freshShop(), daily: {}, settings: { ...SETTING_DEFAULTS } };
}

// -> { levels: { [id]: { moves, stars } }, seen: [story page id], shop: { full, glimmer, freeAt, paid },
//      daily: { [YYYY-MM-DD]: { moves, stars } }, settings: { sound, contrast, unlockAll, tutorials } }
export function loadSave() {
  const data = freshSave();
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return data;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return data;
    if (parsed.levels && typeof parsed.levels === 'object') {
      for (const id of Object.keys(parsed.levels)) {
        const r = parsed.levels[id];
        if (!r || typeof r !== 'object') continue;
        const moves = Number(r.moves);
        const stars = Number(r.stars);
        if (!Number.isFinite(moves) || !Number.isFinite(stars) || moves < 1) continue;
        data.levels[id] = { moves: Math.floor(moves), stars: Math.max(1, Math.min(3, Math.floor(stars))) };
      }
    }
    if (Array.isArray(parsed.seen)) {
      for (const id of parsed.seen) {
        if (typeof id === 'string' && id && !data.seen.includes(id)) data.seen.push(id);
      }
    }
    data.shop = readShop(parsed.shop);
    data.daily = readDaily(parsed.daily);
    if (parsed.settings && typeof parsed.settings === 'object') {
      for (const k of Object.keys(SETTING_DEFAULTS)) {
        if (typeof parsed.settings[k] === 'boolean') data.settings[k] = parsed.settings[k];
      }
    }
  } catch (e) {
    // unreadable or unavailable: start fresh, in memory only
  }
  return data;
}

// -> true when the save reached storage
export function writeSave(data) {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify({ levels: data.levels, seen: data.seen || [], shop: data.shop || freshShop(), daily: data.daily || {}, settings: data.settings }));
    return true;
  } catch (e) {
    return false;
  }
}

// Records a finished attempt. Keeps the fewest moves and the most star moss. -> the stored record
export function recordResult(data, id, moves, stars) {
  const old = data.levels[id];
  const record = old
    ? { moves: Math.min(old.moves, moves), stars: Math.max(old.stars, stars) }
    : { moves, stars };
  data.levels[id] = record;
  return record;
}

// Reset progress: every level, the story and the Daily Glimmer records start over; the settings and the shop stay.
export function clearProgress(data) {
  data.levels = {};
  data.seen = [];
  data.daily = {};
}
