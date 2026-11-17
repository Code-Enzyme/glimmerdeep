// Chapter 5 skeletons for dev/levels-ch5-search.js (scratch tooling, not shipped).
// `place` lists the pieces the search puts on free floor; `cells` can restrict where each one goes.
export const SKELETONS = {
  // 5-1: the lantern stays to hold the whelk on its root; the Emberwick lights the way past the gate
  first: {
    map: [
      '#########',
      '#S...A..#',
      '#.#.##G.#',
      '#.....#.#',
      '#.....#.#',
      '#########',
    ],
    under: { '1,1': 'a' },
  },
  first2: {
    map: [
      '#######',
      '#S.A..#',
      '#..#G.#',
      '#...#.#',
      '#...#.#',
      '#######',
    ],
    under: { '1,1': 'a' },
  },
  // roomier: a hall by the whelk, a gate to a small room with the bud in a niche
  hall: {
    map: [
      '#######',
      '#S....#',
      '#.....#',
      '#.....#',
      '###A###',
      '##...##',
      '##.#G##',
      '#######',
    ],
    under: { '1,1': 'a' },
  },
  hall2: {
    map: [
      '########',
      '#S.....#',
      '#......#',
      '#####A##',
      '#G....##',
      '########',
    ],
    under: { '1,1': 'a' },
  },
  // 5-2: park the Emberwick by the whelk so the lantern can go through the gate and be planted
  park: {
    map: [
      '#########',
      '#.S....A#',
      '#.#..##.#',
      '#.....#~#',
      '#.....#G#',
      '#########',
    ],
    under: { '2,1': 'a' },
  },
  park2: {
    map: [
      '#########',
      '#.S....A#',
      '#.#.#.#.#',
      '#.......#',
      '#.#.#.#~#',
      '#.....#G#',
      '#########',
    ],
    under: { '2,1': 'a' },
  },
  // Emberwicks will not enter the Hush: leave one by the whelk and cross with the smothered lantern
  hush: {
    map: [
      '#########',
      '##S######',
      '#..HHHA.#',
      '#...###.#',
      '#...###~#',
      '#...###G#',
      '#########',
    ],
    under: { '2,1': 'a' },
  },
  hush2: {
    map: [
      '#########',
      '##S######',
      '#..HHHA.#',
      '#..####.#',
      '#.....#~#',
      '#.....#G#',
      '#########',
    ],
    under: { '2,1': 'a' },
  },
  hush3: {
    map: [
      '#########',
      '##S######',
      '#..HHHA.#',
      '#.#####.#',
      '#.....#~#',
      '#.....#G#',
      '#########',
    ],
    under: { '2,1': 'a' },
  },
  // a newt holds the root while the lantern goes on; the Emberwick keeps it dozing there
  newt: {
    place: ['W', 'K', 'D'],
    map: [
      '#########',
      '#.......#',
      '#.#...#.#',
      '#...a...#',
      '#####A###',
      '#####.###',
      '#####~###',
      '#####G###',
      '#########',
    ],
  },
  // two whelks, two Emberwicks, one Hush crossing between them
  two: {
    place: ['W', 'K', 'K'],
    map: [
      '#########',
      '##S###S##',
      '#..HHH..#',
      '#.##H##.#',
      '#.##A##.#',
      '#..#.#..#',
      '#..#~#..#',
      '#..#G#..#',
      '#########',
    ],
    under: { '2,1': 'a', '6,1': 'a' },
  },
};
