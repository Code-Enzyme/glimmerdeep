// Chapter 7 skeletons for dev/levels-ch5-search.js --set=ch7 (scratch tooling, not shipped).
// `place` lists the pieces the search puts on free floor (R tries both shells); `cells` can restrict where
// each one goes. Every chapter 7 level has a shutter.
export const SKELETONS = {
  // 7-2: the bud lies at the foot of a flooded shaft that only a turned beam can reach; a beetle waits in a
  // niche above the corridor
  shaft: {
    feature: 'RA', shutter: true,
    place: ['W', 'R'],
    map: [
      '#########',
      '#######.#',
      '#.......#',
      '######~##',
      '######~##',
      '######G##',
      '#########',
    ],
  },
  // a niche west of the shaft: a beetle that starts there drops into the corridor and crawls toward the lantern
  shaft3: {
    feature: 'RA', shutter: true,
    place: ['W', 'R'],
    map: [
      '#########',
      '###.#####',
      '#.......#',
      '######~##',
      '######~##',
      '######G##',
      '#########',
    ],
  },
  // the same shaft, with a room for the lantern and a longer corridor for the beetle
  shaft2: {
    feature: 'RA', shutter: true,
    place: ['W', 'R'],
    map: [
      '#########',
      '#...#####',
      '#.......#',
      '#...##~##',
      '######~##',
      '######~##',
      '######G##',
      '#########',
    ],
  },
  // 7-4: a periscope. The bud is east of a niche (5,2) between two corridors; a beam reaches it only by
  // turning twice, on a beetle in the niche and on one in a corridor
  periscope: {
    feature: 'RA', shutter: true,
    place: ['W', 'R', 'R'],
    map: [
      '#########',
      '##....###',
      '#..#.~~G#',
      '#...~####',
      '#.......#',
      '#########',
    ],
  },
  // the periscope with both beetles starting up top: one drops into the niche, the other is led round
  periscope2: {
    feature: 'RA', shutter: true,
    place: ['W', 'R', 'R'],
    cells: { R: [[2, 1], [3, 1], [4, 1], [5, 1], [1, 2], [2, 2], [1, 3], [2, 3], [3, 3]] },
    map: [
      '#########',
      '##....###',
      '#..#.~~G#',
      '#...~####',
      '#.......#',
      '#########',
    ],
  },
  // 7-3: a beam marches a Stumpcap to the fifth tile, onto its root; round light only gets it to the third
  ruler: {
    feature: 'ATL', shutter: true,
    place: ['W'],
    map: [
      '#########',
      '#...#####',
      '#..~>..a#',
      '#...#####',
      '###A#####',
      '#.....G##',
      '#########',
    ],
  },
  // 7-4: the Stumpcap's shaft is only reached by a beam turned on a beetle at its head
  relay: {
    feature: 'RAT', shutter: true,
    place: ['W', 'R'],
    map: [
      '#########',
      '#.......#',
      '###A##~.#',
      '#...##v##',
      '#.G.##.##',
      '#...##.##',
      '######a##',
      '#########',
    ],
  },
  // a bigger periscope for the finale: more room up top, a longer lower corridor
  periscope3: {
    feature: 'RA', shutter: true,
    place: ['W', 'R', 'R'],
    map: [
      '#########',
      '#.......#',
      '#.##.####',
      '#..#.~~G#',
      '#...~####',
      '#.......#',
      '#########',
    ],
  },
};
