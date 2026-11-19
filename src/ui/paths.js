// Open ahead (SPEC section 29): which caverns the map opens. Pure: no DOM. The purchase (section 14) is
// checked by the caller; this is the order alone.
// chapters: [{ id, levels: [def, ...] }, ...] in map order; records: { [id]: record } for the lit caverns.

export const AHEAD = 3;

function place(def, chapters) {
  for (let c = 0; c < chapters.length; c++) {
    const i = (chapters[c].levels || []).indexOf(def);
    if (i >= 0) return { c, i };
  }
  return null;
}

// How many caverns before it, in its chapter, can open it: one in chapter 1, else AHEAD.
const reachOf = (c) => (c === 0 ? 1 : AHEAD);

export function levelOpen(def, chapters, records) {
  if (records[def.id]) return true;
  const at = place(def, chapters);
  if (!at) return false;
  const { c, i } = at;
  if (i === 0) {
    // a chapter's first cavern waits for the last cavern of the chapter before (empty chapters are skipped)
    for (let p = c - 1; p >= 0; p--) {
      const prev = chapters[p].levels || [];
      if (prev.length) return !!records[prev[prev.length - 1].id];
    }
    return true;
  }
  const levels = chapters[c].levels;
  for (let k = 1; k <= reachOf(c) && i - k >= 0; k++) {
    if (records[levels[i - k].id]) return true;
  }
  return false;
}

// What a locked cavern's label says opens it.
export function lockedWhy(def, chapters) {
  const at = place(def, chapters);
  const n = at ? Math.min(at.i, reachOf(at.c)) : 1;
  if (n <= 1) return 'Solve the level before it first.';
  return `Solve one of the ${n === 2 ? 'two' : 'three'} levels before it first.`;
}

// How many caverns other than def are open and not yet lit (isOpen includes the purchase).
export function othersOpen(def, levels, isOpen, records) {
  return levels.filter((d) => d !== def && !records[d.id] && isOpen(d)).length;
}
