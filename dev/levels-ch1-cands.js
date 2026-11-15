// Scratch: chapter 1 candidate layouts. name -> { feature, map }.
const C = {};
const add = (name, feature, map) => { C[name] = { id: name, feature, map: map.trim().split('\n').map((s) => s.trim()) }; };

// ---- planting
add('plantU', 'ML', `
#####
#W#G#
#.#~#
#.#.#
#~#.#
#.M.#
#####`);

add('plantS', 'ML', `
#######
#W.~..#
###M#.#
#G~...#
#######`);

// ---- stand in the way (planted beacon, Wren blocks)
add('block1', 'ML', `
#######
##....#
#W.~#M#
###.###
###G###
#######`);

// ---- pond room: lead the moth around the pond, not across it
add('pondA', 'M', `
#######
#....##
#.~.~.#
#...#G#
#######`);
add('pondB', 'M', `
#######
#....##
#.~.~.#
#...#G#
#...###
#######`);
// ---- two buds, zones: east bud is in the zone that sends the moth into the decoy
add('zone2', 'M', `
######
#..W.#
#.##.#
#~M#.#
#.~#.#
#G##.#
####G#
######`);

export default C;
