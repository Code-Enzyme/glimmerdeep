// Saving. One localStorage key holds per-level bests, the story pages already shown, the shop (purchases and
// Glimmer, SPEC section 14), the Daily Glimmer records (section 15) and the settings. Every read and write is guarded:
// the game must play the same with storage missing, full or blocked (private mode, file:// policies).
// SPEC section 16: the save counts its writes (`rev`), and every write can also go to a second copy (the mirror,
// a file in the Android app) whose promise `savedDurably` hands out. No Capacitor here: game.js plugs the mirror in.

import { freshShop, readShop } from './shop.js';
import { readDaily } from './daily.js';
import { COMFORT_DEFAULTS, readComfort, CONTROL_DEFAULTS, readControls } from './comfort.js';
import { DEFAULT_LANTERN, readLantern } from './lanterns.js';
import { readWorkshop } from './workshop.js';

export const SAVE_KEY = 'glimmerdeep.v1';

const SETTING_DEFAULTS = {
  sound: true, contrast: false, unlockAll: false, tutorials: true, ...COMFORT_DEFAULTS, lantern: DEFAULT_LANTERN, ...CONTROL_DEFAULTS,
};

function freshSave() {
  return { levels: {}, seen: [], critters: [], shop: freshShop(), daily: {}, workshop: [], settings: { ...SETTING_DEFAULTS }, rev: 0 };
}

// -> { levels: { [id]: { moves, stars } }, seen: [story page id], critters: [level id] (section 23),
//      shop: { full, glimmer, freeAt, paid },
//      daily: { [YYYY-MM-DD]: { moves, stars } }, workshop: [cavern] (section 26),
//      settings: { sound, contrast, unlockAll, tutorials, textSize, readable, motion, lantern, arrows, hand, swipe }, rev }
export function loadSave() {
  let raw = null;
  try {
    raw = window.localStorage.getItem(SAVE_KEY);
  } catch (e) {
    // unavailable: start fresh, in memory only
  }
  return parseSave(raw);
}

// A saved string (from localStorage or the second copy) -> a save; anything unreadable -> a fresh save
export function parseSave(raw) {
  const data = freshSave();
  try {
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
    if (Array.isArray(parsed.critters)) {
      for (const id of parsed.critters) {
        if (typeof id === 'string' && id && !data.critters.includes(id)) data.critters.push(id);
      }
    }
    data.shop = readShop(parsed.shop);
    data.daily = readDaily(parsed.daily);
    data.workshop = readWorkshop(parsed.workshop);   // SPEC section 26
    if (parsed.settings && typeof parsed.settings === 'object') {
      for (const k of Object.keys(SETTING_DEFAULTS)) {
        if (typeof parsed.settings[k] === 'boolean' && typeof SETTING_DEFAULTS[k] === 'boolean') data.settings[k] = parsed.settings[k];
      }
      Object.assign(data.settings, readComfort(parsed.settings));   // SPEC section 22
      data.settings.lantern = readLantern(parsed.settings.lantern);  // SPEC section 24
      Object.assign(data.settings, readControls(parsed.settings));  // SPEC section 27
    }
    const rev = Number(parsed.rev);
    if (Number.isFinite(rev) && rev > 0) data.rev = Math.floor(rev);
  } catch (e) {
    // unreadable: start fresh
  }
  return data;
}

// Of two saves, the one written more often; a tie (or no second save) keeps the first.
export function newerSave(a, b) {
  return b && b.rev > a.rev ? b : a;
}

// Takes every part of `other` into `data` when `other` is the newer save (SPEC section 16). -> true when it did
export function adoptInto(data, other) {
  if (newerSave(data, other) === data) return false;
  for (const k of Object.keys(freshSave())) data[k] = other[k];
  return true;
}

let mirror = null; // (json) -> Promise, resolved once the copy is on disk
let durable = Promise.resolve();
let writes = 0;

// Plugs in the second copy (or takes it out with null).
export function setSaveMirror(fn) {
  mirror = typeof fn === 'function' ? fn : null;
}

// How many writes this run has made, so a late read can tell whether the save moved on meanwhile.
export function saveWrites() {
  return writes;
}

// Resolves once every write so far has reached the second copy (or failed to): never rejects.
export function savedDurably() {
  return durable;
}

// -> true when the save reached localStorage. Counts up the revision and hands the same text to the mirror.
export function writeSave(data) {
  data.rev = (Number.isFinite(data.rev) ? data.rev : 0) + 1;
  writes += 1;
  const json = JSON.stringify({
    levels: data.levels, seen: data.seen || [], critters: data.critters || [], shop: data.shop || freshShop(), daily: data.daily || {},
    workshop: data.workshop || [], settings: data.settings, rev: data.rev,
  });
  let ok = false;
  try {
    window.localStorage.setItem(SAVE_KEY, json);
    ok = true;
  } catch (e) {
    // storage full or blocked: the mirror may still keep it
  }
  if (mirror) {
    let copy;
    try {
      copy = Promise.resolve(mirror(json));
    } catch (e) {
      copy = Promise.resolve();
    }
    durable = Promise.all([durable, copy.catch(() => {})]).then(() => {});
  }
  return ok;
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

// Reset progress: every level, the story, the found critters and the Daily Glimmer records start over; the settings,
// the shop, the Workshop's caverns and the revision stay (the revision never goes back, SPEC section 16).
export function clearProgress(data) {
  data.levels = {};
  data.seen = [];
  data.critters = [];
  data.daily = {};
}
