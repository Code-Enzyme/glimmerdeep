// The Night Garden (SPEC section 20): when its deep puzzles open. No DOM in here, so it can be tested in Node.

import { CHAPTERS } from '../levels/index.js';

export const GARDEN_MOSS = 100;   // [PLACEHOLDER - PLAYTEST] star moss the chapters must have earned
const lastChapter = CHAPTERS[CHAPTERS.length - 1];
// the last level of the last chapter: lighting it ends the story
export const STORY_END = lastChapter.levels[lastChapter.levels.length - 1].id;

// The star moss the chapters' levels have earned (not the garden's own, not the daily caverns').
export function chapterMoss(save, levels) {
  let moss = 0;
  for (const def of levels) {
    const record = save.levels[def.id];
    if (record) moss += record.stars || 0;
  }
  return moss;
}

// -> { open, story, moss, need }: whether the garden's first puzzle opens, whether the story is done, and the
// star moss there is and is needed. The purchase and the Unlock all setting are the caller's.
export function gardenState(save, levels) {
  const story = !!save.levels[STORY_END];
  const moss = chapterMoss(save, levels);
  return { open: story && moss >= GARDEN_MOSS, story, moss, need: GARDEN_MOSS };
}

// The map's line about what the garden waits for; empty once it is open.
export function gardenNote(state) {
  if (state.open) return '';
  const have = state.moss >= state.need ? 'You have it.' : `You have ${state.moss}.`;
  return `Opens when the story is done and you have ${state.need} star moss. ${have}`;
}

// Whether a deep puzzle is open, the purchase aside (the caller checks it). The first opens with the garden;
// after that a puzzle opens when it or the one before it is lit. Unlock all skips both.
export function puzzleOpen(def, save, night, levels, unlockAll) {
  const i = night.indexOf(def);
  if (i < 0) return false;
  if (unlockAll || save.levels[def.id]) return true;
  return i === 0 ? gardenState(save, levels).open : !!save.levels[night[i - 1].id];
}

// What the level screen and the result call a level: "Night Garden 3" for N-3, else "Level 1-2".
export function levelTitle(def) {
  if (!def || def.id === undefined) return 'Test cavern';
  const m = /^N-(\d+)$/.exec(String(def.id));
  return m ? `Night Garden ${m[1]}` : `Level ${def.id}`;
}
