// Chapter 1: Mossmouth. Featured species: Fluffmoth ('M').
// Level format is defined in SPEC.md section 6. Every level must solve at exactly `par`.
export default [
  {
    id: '1-1',
    name: 'First Light',
    feature: 'M',
    par: 5,
    map: [
      '#########',
      '#W..~..G#',
      '####M####',
      '#########',
    ],
    note: 'The moth flies to the lantern, lands in the puddle and becomes a bridge.',
    tip: 'Swipe to walk. The Fluffmoth flies toward your lantern.',
  },
  {
    id: '1-2',
    name: 'Across the Water',
    feature: 'ML',
    par: 9,
    map: [
      '#####',
      '#W#G#',
      '#.#~#',
      '#.#.#',
      '#~#.#',
      '#.M.#',
      '#####',
    ],
    note: 'The moth bridges the first puddle by itself; the second has no moth, so the lantern must be planted at its edge to shine across.',
    tip: 'Tap Wren to set the lantern down. A planted lantern shines further.',
  },
];
