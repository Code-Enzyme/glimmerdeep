// Hidden Journal critters (SPEC section 23): one small critter hides in a dark nook of every cavern. Lighting the
// nook finds it, which is a level's third star moss. The kinds, their notes, finding and the Journal's Critters
// tab live here. No DOM, so it can be tested in Node.

// One kind per chapter, then the Night Garden's. Notes and lore follow the story's text rules (section 13).
export const CRITTERS = [
  {
    kind: 'dewmite', name: 'Dewmite', chapter: 1,
    note: 'A bead of dew on six tiny legs. Dewmites sip the drip off the moss, and the moss glows brighter wherever they gather.',
    lore: 'Every Dewmite in Mossmouth sat on the side of its nook nearest the Heartroot, the way you sit close to a fire.',
  },
  {
    kind: 'pebblecrab', name: 'Pebble crab', chapter: 2,
    note: 'A crab the size of a button that wears a pebble for a shell. When it grows it swaps pebbles and leaves the old ones in rows.',
    lore: 'The pebble rows are lamplighter marks: danger, go back, too much. Someone taught the crabs, a long time ago.',
  },
  {
    kind: 'sporeling', name: 'Sporeling', chapter: 3,
    note: 'A puff of spores on tiny legs. It hops when the light finds it and sneezes glitter. Stumpcaps let it ride on their caps.',
    lore: 'Sporelings only grow where light comes and goes, never where it burns all day. Too much light and the whole wood would wilt.',
  },
  {
    kind: 'skimmer', name: 'Lake skimmer', chapter: 4,
    note: 'Skates on still water on long thin legs and leaves rings of light behind it. The newts follow the rings home.',
    lore: 'The newts say the skimmers came when the lake went dark, to light the way. They are not scared of the dark at all.',
  },
  {
    kind: 'cinderfly', name: 'Cinderfly', chapter: 5,
    note: 'A fly with a tail like a fresh coal. It warms its wings on old embers and never strays far from a fire.',
    lore: 'Cinderflies live on the warmth the Heartroot gives away. Fewer every year, the old journals say. Something takes more than it needs.',
  },
  {
    kind: 'rootworm', name: 'Rootworm', chapter: 6,
    note: 'A glowworm that lives in the bark of the Heartroot. Its glow rises and falls slowly, like breathing.',
    lore: 'Sitting still, I saw the rootworms glow in time with the Gloam breathing far below. The root and the Gloam are tied together.',
  },
  {
    kind: 'cogmite', name: 'Cogmite', chapter: 7,
    note: 'A tiny beetle with a shell like a brass gear. It lives in the Guild\'s old machines and keeps every cog clean.',
    lore: 'The cogmites have chewed through every pipe that pulled light out of the root. I think they were trying to stop the machines.',
  },
  {
    kind: 'glasswing', name: 'Glasswing', chapter: 'night',
    note: 'A midge with wings of clear crystal. In the Night Garden it hums, and the crystal walls hum back.',
    lore: 'Glasswings only hatch where light is shared, a little for the garden and a little for the town. So this is what balance looks like.',
  },
];

const TEXT_MAX = 160;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;
// the species letters, by the map characters that bring them in (as in a level's `feature`)
const SPECIES = 'MSTDKOR';

// A chapter (or the Night Garden) -> its kind of critter, or null.
export function critterKind(chapter) {
  if (!chapter) return null;
  if (chapter.night) return CRITTERS.find((c) => c.chapter === 'night') || null;
  return CRITTERS.find((c) => c.chapter === chapter.id) || null;
}

// A Daily Glimmer cavern hides the kind of the chapter that brings in the first species of its feature
// (chapter 1's when it features none).
export function dailyCritterKind(def, chapters) {
  const first = Array.from(String((def && def.feature) || '')).find((ch) => SPECIES.includes(ch));
  const chapter = (first && chapters.find((c) => c.species === first)) || chapters[0];
  return critterKind(chapter);
}

// Whether the critter of a chapter or Night Garden level has been found (it stays found).
export function isFound(save, def) {
  return Array.isArray(save.critters) && save.critters.includes(def.id);
}

// Marks a chapter or Night Garden level's critter found. A level already lit gains its moss at once: one for
// lighting it, one if its best is at or under par, one for the critter; moss already earned is kept.
// -> true when it was not found before
export function markFound(save, def) {
  if (!Array.isArray(save.critters)) save.critters = [];
  if (save.critters.includes(def.id)) return false;
  save.critters.push(def.id);
  const record = save.levels && save.levels[def.id];
  if (record) {
    const par = typeof def.par !== 'number' || record.moves <= def.par;
    record.stars = Math.max(record.stars || 0, 1 + (par ? 1 : 0) + 1);
  }
  return true;
}

// The Journal's Critters tab: one entry per kind, in order, with how many of its chapter's critters are found.
// chapters: the chapters and the Night Garden, each with its levels.
// -> { entries: [{ kind, name, chapter: { id, name }, found, total, note, lore }], found, total }
//    note once one is found, lore once all are (else null)
export function critterJournal(save, chapters) {
  const have = new Set(Array.isArray(save.critters) ? save.critters : []);
  const entries = [];
  for (const critter of CRITTERS) {
    const chapter = chapters.find((c) => critterKind(c) === critter);
    if (!chapter) continue;
    const levels = chapter.levels || [];
    const found = levels.filter((def) => have.has(def.id)).length;
    entries.push({
      kind: critter.kind,
      name: critter.name,
      chapter: { id: chapter.id, name: chapter.name },
      found,
      total: levels.length,
      note: found > 0 ? critter.note : null,
      lore: found > 0 && found === levels.length ? critter.lore : null,
    });
  }
  return {
    entries,
    found: entries.reduce((n, e) => n + e.found, 0),
    total: entries.reduce((n, e) => n + e.total, 0),
  };
}

// Lists what breaks the text rules (SPEC sections 13 and 23). -> [] when all is well.
export function checkCritters(critters = CRITTERS) {
  const problems = [];
  const kinds = new Set();
  for (const c of critters) {
    if (kinds.has(c.kind)) problems.push(`${c.kind} is listed twice`);
    kinds.add(c.kind);
    if (!c.name) problems.push(`${c.kind} has no name`);
    for (const field of ['note', 'lore']) {
      const text = c[field];
      if (typeof text !== 'string' || !text) {
        problems.push(`${c.kind} has no ${field}`);
        continue;
      }
      if (text.length > TEXT_MAX) problems.push(`${c.kind} ${field} is ${text.length} characters (at most ${TEXT_MAX})`);
      const m = GENDERED.exec(text);
      if (m) problems.push(`${c.kind} ${field} uses "${m[0]}"`);
    }
  }
  return problems;
}
