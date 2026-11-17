// Chapter 6 skeletons for dev/levels-ch5-search.js --set=ch6 (scratch tooling, not shipped).
// `place` lists the pieces the search puts on free floor; `cells` can restrict where each one goes.
export const SKELETONS = {
  // 6-1: a newt circles a loop past a root. Waiting by the gate with the lantern would doze the newt one
  // tile short of the root; with a Gloamling beside her, Wren's light is out and the newt walks on.
  loop: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.#####.#',
      '#..a..w.#',
      '####...##',
      '####A####',
      '####.####',
      '####G####',
      '#########',
    ],
  },
  // the same newt and gate, but beyond the gate the Gloamling has to be shed in the Hush
  shed: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.#####.#',
      '#..a..w.#',
      '####...##',
      '####A####',
      '####H####',
      '####.####',
      '####G####',
      '#########',
    ],
  },
  // a Stumpcap marches east under a planted lantern's light; the Gloamling, drifting to the lantern, is the
  // stopper that holds it on the root
  stopper: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#>...a..#',
      '#.......#',
      '#.......#',
      '#####A###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  // a whelk hides on its root in the lantern's light; in the Gloamling's shadow it creeps off again
  whelk: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.S.....#',
      '#.......#',
      '###a#A###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  // the Stumpcap marches onto the root in Wren's light; the Gloamling, stuck in the pocket beside it, keeps
  // it dark there while Wren goes past it to the gate
  post1: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#..>.a.##',
      '#.....###',
      '#####A###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  post2: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#>...a.##',
      '#.....###',
      '#####A###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  post3: {
    place: ['W', 'O'],
    map: [
      '#########',
      '###....##',
      '#.>..a..#',
      '#.....#.#',
      '#####A#.#',
      '#####.#.#',
      '#####G..#',
      '#########',
    ],
  },
  post4: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.>..a.##',
      '#.##.#.##',
      '#....A..#',
      '#.####.##',
      '#.....G.#',
      '#########',
    ],
  },
  // a newt marching along a hall turns right when something blocks it: the Gloamling, drifting to the lantern,
  // can stand in its way at the turning to the root
  steer1: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#e......#',
      '#.#.###.#',
      '#.#a###.#',
      '#.#####.#',
      '#...A.G##',
      '#########',
    ],
  },
  steer2: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#e......#',
      '###.#.###',
      '###a#.###',
      '#####A###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  // the Stumpcap stopper again, but the Gloamling's corridor can only be drawn on by a planted lantern
  lure1: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.>..a.##',
      '#.....#.#',
      '#####A#.#',
      '#####.#.#',
      '#####G#.#',
      '#########',
    ],
  },
  lure2: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#...#...#',
      '#.>..a..#',
      '#.....#.#',
      '#####A#.#',
      '#####.#.#',
      '#####G..#',
      '#########',
    ],
  },
  // the Stumpcap stopper with room for the Gloamling to follow: Wren sheds it in the Hush
  hush1: {
    place: ['W', 'O'],
    map: [
      '#########',
      '###....##',
      '#.>..a..#',
      '#.......#',
      '#####A###',
      '#####H###',
      '#####.###',
      '#####G###',
      '#########',
    ],
  },
  hush2: {
    place: ['W', 'O'],
    map: [
      '#########',
      '#.......#',
      '#.>..a..#',
      '#....#..#',
      '#HH#.A..#',
      '#.##.##.#',
      '#G##.##.#',
      '#########',
    ],
  },
  // two Stumpcaps, two roots, two Gloamlings
  twin: {
    place: ['W', 'O', 'O'],
    map: [
      '#########',
      '#>..a...#',
      '#.......#',
      '#..b..<.#',
      '##A###B##',
      '##.###.##',
      '##...G..#',
      '#########',
    ],
  },
  // finale: the Gloamling has to stand by the root as Wren passes, and then be left behind with the planted
  // lantern while a caught Emberwick follows Wren down and lights the Glowbud
  decoy: {
    place: ['K', 'W', 'O'],
    cells: { K: [[3, 1], [6, 1], [1, 3], [7, 3], [1, 2], [7, 2]] },
    map: [
      '#########',
      '###....##',
      '#.>..a..#',
      '#.......#',
      '#####A###',
      '#####.###',
      '####G.###',
      '#####.###',
      '#########',
    ],
  },
};
