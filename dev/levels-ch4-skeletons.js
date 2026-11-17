// Chapter 4 skeletons for dev/levels-ch4-search.js (scratch tooling, not shipped).
// Maps without Wren and the newt; `wren` / `newt` optionally restrict where they may start.
export const SKELETONS = {
  // 4-1: the newt walks onto the root in your light
  first: {
    map: [
      '#######',
      '#.....#',
      '#.....#',
      '#.a...#',
      '###A###',
      '###.###',
      '###G###',
      '#######',
    ],
  },
  // 4-2: plant the lantern and turn the newt with Wren
  halls: {
    feature: 'DL',
    map: [
      '#######',
      '#.....#',
      '#.#.#.#',
      '#.....#',
      '#.#a#.#',
      '#.....#',
      '###A###',
      '###.###',
      '###G###',
      '#######',
    ],
  },
  lanes: {
    feature: 'DL',
    map: [
      '########',
      '#......#',
      '#.####.#',
      '#......#',
      '#.##.a.#',
      '#......#',
      '#####A##',
      '#####.##',
      '#####G##',
      '########',
    ],
  },
  // 4-4: a moth bridges the pool for the newt
  pool: {
    feature: 'DM',
    extraCells: [[1, 1], [5, 1], [1, 2], [5, 2], [3, 1]],
    map: [
      '#######',
      '#.....#',
      '#.....#',
      '#~~~~~#',
      '#.a...#',
      '###A###',
      '###.###',
      '###G###',
      '#######',
    ],
  },
  // a Stumpcap marches in the light while the newt stops: the newt as a doorstop
  doorstop: {
    feature: 'DT',
    wren: [[1, 1], [5, 1], [1, 5], [5, 5]],
    newt: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5]],
    extraCells: [[1, 3], [1, 2], [1, 4], [3, 2], [3, 4]],
    map: [
      '#######',
      '#.....#',
      '#.#.#.#',
      '#...a.#',
      '#.#.#.#',
      '#.....#',
      '####A##',
      '####.##',
      '####G##',
      '#######',
    ],
  },
  // the Stumpcap steps out into the hall and turns the newt down the side passage
  turnstile: {
    feature: 'DT',
    map: [
      '#########',
      '#.......#',
      '#.#####.#',
      '#.......#',
      '###.^####',
      '###a.####',
      '####A####',
      '####.####',
      '####G####',
      '#########',
    ],
  },
  turnstile2: {
    feature: 'DT',
    map: [
      '#########',
      '#########',
      '#.......#',
      '###.^##.#',
      '###a.##.#',
      '####A##.#',
      '####.#..#',
      '####G####',
      '#########',
    ],
  },
  // two newts, two rooms, two gates in a row
  twins: {
    feature: 'D',
    newt: [[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [1, 2], [2, 2], [3, 2], [4, 2], [5, 2], [1, 3], [2, 3], [4, 3], [5, 3]],
    wren: [[1, 1], [5, 1], [1, 3], [5, 3]],
    extraCells: [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5], [1, 6], [2, 6], [4, 6], [5, 6]],
    map: [
      '#######',
      '#.....#',
      '#.....#',
      '#..a..#',
      '####A##',
      '#.....#',
      '#..b..#',
      '##B####',
      '##.####',
      '##G####',
      '#######',
    ],
  },
  // 4-5: a Stumpcap marches in the light while the newt stops
  daynight: {
    feature: 'DT',
    map: [
      '#######',
      '#.....#',
      '#.#.#.#',
      '#.....#',
      '#a#.#b#',
      '#A###B#',
      '#.#G#.#',
      '#.....#',
      '#######',
    ],
  },
};
