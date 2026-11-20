// What's new (SPEC section 30): short notes after an update. Pure: no DOM.
// NEWS is newest first. A new note goes at the top with a new id; an old note is never edited into a new one.

export const NEWS = [
  {
    id: 'daily-year',
    title: 'A year of Daily Glimmers',
    text: 'The Daily Glimmer now has 365 caverns, so each one comes back only once a year.',
  },
  {
    id: 'bramble',
    title: 'Bramble flies along',
    text: "Once 1-1 is lit, Wren's moth flutters by the lantern, cheers you on and flies to each hint. Comfort can keep Bramble home.",
  },
  {
    id: 'open-ahead',
    title: 'More ways forward',
    text: 'From chapter 2, every lit cavern opens the three after it, so a stuck cavern can wait while you try another.',
  },
  {
    id: 'board-talk',
    title: 'Board talk',
    text: 'The board can be had in words. Turn on Board talk in Comfort to hear each move and to describe a cavern.',
  },
  {
    id: 'controls',
    title: 'Arrows and a left hand',
    text: 'Comfort now holds arrow buttons under the board, a left-handed layout and a short, normal or long swipe.',
  },
  {
    id: 'workshop',
    title: 'The Workshop',
    text: 'Once Mossmouth is lit, paint caverns of your own, check them with the solver and share them as a code.',
  },
  {
    id: 'lanterns',
    title: 'Lantern colours',
    text: 'Star moss earns the lantern new colours. They change how the light looks, never where it reaches.',
  },
  {
    id: 'critters',
    title: 'Hidden critters',
    text: 'A small critter hides in a dark nook of every cavern. Light the nook, tap it, and Wren sketches it in the Journal.',
  },
];

export const NEWS_IDS = NEWS.map((n) => n.id);

const DUE_MAX = 3;

// The notes not in `seen`, newest first, at most three.
export function newsDue(seen) {
  const known = new Set(Array.isArray(seen) ? seen : []);
  return NEWS.filter((n) => !known.has(n.id)).slice(0, DUE_MAX);
}

// The saved list of seen ids: an array keeps its strings; anything else is none seen.
export function readNews(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((id) => typeof id === 'string' && id);
}
