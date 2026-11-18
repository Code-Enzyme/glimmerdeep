// The story and the Field Journal (SPEC section 13). No DOM in here: the pages, Wren's notes, when a page
// is due and what the Journal shows, so all of it can be tested in Node. The app draws the pictures.

// Which map characters stand for each species (as in the solver).
const SPECIES_CHARS = { M: 'M', S: 'S', T: '^>v<', D: 'nesw', K: 'K', O: 'O', R: '/\\' };
const SPECIES_ORDER = ['M', 'S', 'T', 'D', 'K', 'O', 'R'];
const SPECIES_NAME = {
  M: 'Fluffmoth', S: 'Shellwhelk', T: 'Stumpcap', D: 'Dozer newt', K: 'Emberwick', O: 'Gloamling', R: 'Mirrorbeetle',
};
const CAST = ['wren', ...SPECIES_ORDER];
const GLOAMS = [null, 'small', 'near'];
const ROOTS = [null, 'dim', 'bright', 'gentle'];
const TITLE_MAX = 40;
const LINE_MAX = 160;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

// One page before the first chapter, then one after each chapter. Wren writes these in the journal.
export const STORY = [
  {
    id: 'prologue',
    chapter: 0,
    title: 'Down into the dark',
    lines: [
      'Wickmoor\'s lamps are dimming. Far below the town, the Heartroot that feeds them is fading, and a darkness called the Hush is rising.',
      'I\'m the youngest lamplighter, and I\'m going down with my lantern and this journal.',
      'A Fluffmoth has already started following the light. I\'m calling it Bramble.',
    ],
    scene: { cast: ['wren', 'M'], gloam: null, root: null },
  },
  {
    id: 'ch1',
    chapter: 1,
    title: 'The shadow at Mossmouth',
    lines: [
      'At the end of Mossmouth a shadow as big as a house slid across the tunnel and swallowed my lantern\'s glow.',
      'Bramble hid in my hood. Everyone in town says the Gloam eats light.',
      'But when the light touched it, it flinched and pulled away.',
    ],
    scene: { cast: ['wren', 'M'], gloam: 'near', root: null },
  },
  {
    id: 'ch2',
    chapter: 2,
    title: 'A small, dark thing',
    lines: [
      'In the grottos I found a rusted lamplighter\'s tin, with a note from Warden Sootley nailed above it: bring every spark up to town.',
      'When the last buds bloomed, their light showed me a memory that wasn\'t mine: a tiny Gloamling curled beside a dim, quiet root.',
    ],
    scene: { cast: ['wren', 'S'], gloam: 'small', root: 'dim' },
  },
  {
    id: 'ch3',
    chapter: 3,
    title: 'Light shared out',
    lines: [
      'The Hush is thinner in Stumpwood, wherever the light is shared out evenly instead of piled up in one place.',
      'Another memory in the bloom: the little Gloamling, bigger now, dozing in the root\'s soft glow. It looked safe there.',
    ],
    scene: { cast: ['wren', 'T'], gloam: 'small', root: 'gentle' },
  },
  {
    id: 'ch4',
    chapter: 4,
    title: 'The flare',
    lines: [
      'The newts of the Flats have always lived in the dark, and they seem happy about it.',
      'The memory this time hurt to watch: buckets and pipes drawing light upward, and the Heartroot flaring white and painful.',
      'The grown Gloam shrank back from the glare.',
    ],
    scene: { cast: ['wren', 'D'], gloam: null, root: 'bright' },
  },
  {
    id: 'ch5',
    chapter: 5,
    title: 'Shade, not hunger',
    lines: [
      'Emberwicks follow me now like little lanterns.',
      'In the last memory the Gloam wrapped itself around the burning root, coil by coil, until the glare softened.',
      'It was never eating the light. It was shading it, so it could bear to stay.',
    ],
    scene: { cast: ['wren', 'K'], gloam: 'near', root: 'bright' },
  },
  {
    id: 'ch6',
    chapter: 6,
    title: 'Gently',
    lines: [
      'I reached the Heartroot. The Gloam lay curled around it, shaking, and the root was barely breathing.',
      'I didn\'t light it brighter. I lit it gently, a little at a time, and the Gloam loosened its coils.',
      'Now they glow together, root and shadow.',
    ],
    scene: { cast: ['wren', 'O'], gloam: 'near', root: 'gentle' },
  },
  {
    id: 'ch7',
    chapter: 7,
    title: 'Light both ways',
    lines: [
      'Under the root sit the Guild\'s old vaults: beetle mirrors that drank the root\'s light and sent all of it up to Wickmoor.',
      'Warden Sootley came down to take the last of it. Instead, together, we turned half the mirrors back toward the caves.',
      'Wickmoor\'s lamps will burn a little lower, and Glimmerdeep will stay alive. That seems fair. Bramble agrees.',
    ],
    scene: { cast: ['wren', 'R', 'M'], gloam: null, root: 'gentle' },
  },
];

// Wren's own note on each species, for its Journal entry.
export const NOTES = {
  M: 'Soft as dandelion fluff and drawn to any lantern. Bramble is one. They love puddles, which is handy, because I can\'t swim.',
  S: 'Shy little things. Shine at one and it pops into its shell and sits there, as heavy as a stone.',
  T: 'Sleepy mushrooms. Wake one with light and off it marches, straight ahead, until it bumps into something.',
  D: 'The newts of the Flats wander about in the dark and nap the moment a light finds them.',
  K: 'Keep one warm and it lights up on its own, then trots after me like a second lantern.',
  O: 'Born in the dark, and bright light hurts them. I think the Gloam was one of these, a long time ago.',
  R: 'Its shell is a tiny mirror. The Guild kept whole vaults of them to bounce light up the shafts.',
};

// The species standing in a level, in SPECIES_ORDER.
export function speciesOf(def) {
  const rows = (def && def.map) || [];
  return SPECIES_ORDER.filter((kind) => rows.some((row) => Array.from(row).some((ch) => SPECIES_CHARS[kind].includes(ch))));
}

const solved = (save, def) => !!(save && save.levels && save.levels[def.id]);
const seenSet = (save) => new Set(save && Array.isArray(save.seen) ? save.seen : []);

// A page unlocks when its chapter's last level is solved, and stays unlocked once seen (SPEC section 17: the
// encounters became the chapters' last levels after some pages had been read).
function unlocked(page, save, chapters) {
  if (page.chapter === 0 || seenSet(save).has(page.id)) return true;
  const chapter = chapters.find((c) => c.id === page.chapter);
  const levels = (chapter && chapter.levels) || [];
  return levels.length > 0 && solved(save, levels[levels.length - 1]);
}

// The ids of the story pages due now: unlocked and not yet seen, in story order. `at` is the moment:
// 'play' (Play on the title) or 'result' (leaving a result panel); the prologue waits for Play.
export function storyDue(save, chapters, { at = 'play' } = {}, story = STORY) {
  const seen = seenSet(save);
  return story
    .filter((page) => !seen.has(page.id) && unlocked(page, save, chapters) && (page.chapter !== 0 || at === 'play'))
    .map((page) => page.id);
}

// What the Field Journal shows.
// -> { creatures: [{ kind, name, met, chapter: { id, name } }], met, total,
//      pages: [{ id, chapter: { id, name } | null, title, kicker, unlocked, seen }] }
export function journal(save, chapters, story = STORY) {
  const creatures = [];
  for (const chapter of chapters) {
    for (const def of chapter.levels || []) {
      for (const kind of speciesOf(def)) {
        let entry = creatures.find((c) => c.kind === kind);
        if (!entry) {
          entry = { kind, name: SPECIES_NAME[kind], met: false, chapter: { id: chapter.id, name: chapter.name } };
          creatures.push(entry);
        }
        if (solved(save, def)) entry.met = true;
      }
    }
  }
  const seen = seenSet(save);
  const pages = story.map((page) => {
    const chapter = chapters.find((c) => c.id === page.chapter);
    return {
      id: page.id,
      chapter: chapter ? { id: chapter.id, name: chapter.name } : null,
      title: page.title,
      kicker: chapter ? `Chapter ${chapter.id}: ${chapter.name}` : 'Prologue',
      unlocked: unlocked(page, save, chapters),
      seen: seen.has(page.id),
    };
  });
  return { creatures, met: creatures.filter((c) => c.met).length, total: creatures.length, pages };
}

export function pageById(id, story = STORY) {
  return story.find((page) => page.id === id) || null;
}

// Lists what breaks the text rules of SPEC section 13. -> [] when all is well.
export function checkStory(chapters, story = STORY, notes = NOTES) {
  const problems = [];
  const gendered = (where, text) => {
    const m = GENDERED.exec(text);
    if (m) problems.push(`${where} uses "${m[0]}"`);
  };
  const ids = new Set();
  for (const page of story) {
    const id = page.id;
    if (ids.has(id)) problems.push(`${id} appears more than once`);
    ids.add(id);
    if (typeof page.title !== 'string' || !page.title || page.title.length > TITLE_MAX) {
      problems.push(`${id}: the title must be 1 to ${TITLE_MAX} characters`);
    } else {
      gendered(id, page.title);
    }
    const lines = Array.isArray(page.lines) ? page.lines : [];
    if (lines.length < 1 || lines.length > 4) problems.push(`${id}: a page has 1 to 4 lines`);
    lines.forEach((line, i) => {
      if (typeof line !== 'string' || !line || line.length > LINE_MAX) problems.push(`${id}: line ${i + 1} must be 1 to ${LINE_MAX} characters`);
      else gendered(id, line);
    });
    const scene = page.scene || {};
    const cast = Array.isArray(scene.cast) ? scene.cast : [];
    if (!cast.length) problems.push(`${id}: the scene has no cast`);
    for (const who of cast) if (!CAST.includes(who)) problems.push(`${id}: unknown cast member ${who}`);
    if (!GLOAMS.includes(scene.gloam === undefined ? null : scene.gloam)) problems.push(`${id}: unknown gloam ${scene.gloam}`);
    if (!ROOTS.includes(scene.root === undefined ? null : scene.root)) problems.push(`${id}: unknown root ${scene.root}`);
  }
  if (!story.some((page) => page.id === 'prologue' && page.chapter === 0)) problems.push('there is no prologue');
  for (const chapter of chapters) {
    const pages = story.filter((page) => page.chapter === chapter.id);
    if (!pages.length) problems.push(`chapter ${chapter.id} has no story page`);
    else if (pages.some((page) => page.id !== `ch${chapter.id}`)) problems.push(`chapter ${chapter.id}'s page must have the id ch${chapter.id}`);
  }
  const found = new Set();
  for (const chapter of chapters) for (const def of chapter.levels || []) for (const kind of speciesOf(def)) found.add(kind);
  for (const kind of SPECIES_ORDER) {
    if (!found.has(kind)) continue;
    if (typeof notes[kind] !== 'string' || !notes[kind]) problems.push(`${kind} (${SPECIES_NAME[kind]}) has no note`);
    else gendered(`the note for ${kind}`, notes[kind]);
  }
  return problems;
}
