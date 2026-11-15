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

export default C;
