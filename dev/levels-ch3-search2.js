// Scratch search 2: finale skeleton with a second bud. Enumerates bud position (a wall cell next to the
// room), and W / S / M starts. Lists the longest shortest solutions that pass checkLevel.
import { parseLevel } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

const SKEL = {
  room: [
    '#######',
    '#..####',
    '#...###',
    '#...###',
    '#...###',
    '#>~.a.#',
    '###A###',
    '#G..###',
    '#######' ],
  wide: [
    '#######',
    '#...###',
    '#....##',
    '#....##',
    '#...###',
    '#>~.a.#',
    '###A###',
    '#G..###',
    '#######' ],
};
const base = SKEL[process.argv[2] || 'room'];
const put = (map, x, y, ch) => { const m = map.slice(); m[y] = m[y].slice(0, x) + ch + m[y].slice(x + 1); return m; };
const at = (map, x, y) => (map[y] || '')[x];
const floors = [];
const budSpots = [];
for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) {
  const ch = at(base, x, y);
  if (ch === '.') floors.push([x, y]);
  if (ch === '#' && y <= 4) {
    const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(base, x + dx, y + dy) === '.' && y + dy <= 4);
    if (near) budSpots.push([x, y]);
  }
}
const mothCells = floors.filter(([x, y]) => y === 5);
const roomCells = floors.filter(([x, y]) => y <= 4);
const results = [];
for (const [bx, by] of budSpots) {
  const m0 = put(base, bx, by, 'G');
  for (const [mx, my] of mothCells) {
    const m1 = put(m0, mx, my, 'M');
    for (const [sx, sy] of floors) {
      if (at(m1, sx, sy) !== '.') continue;
      const m2 = put(m1, sx, sy, 'S');
      for (const [wx, wy] of roomCells) {
        if (at(m2, wx, wy) !== '.') continue;
        const map = put(m2, wx, wy, 'W');
        let st;
        try { st = parseLevel({ id: 'x', map }); } catch { continue; }
        if (st.solved) continue;
        const r = solve(st, { maxStates: 150000 });
        if (r.solved) results.push({ len: r.moves.length, moves: r.moves.join(''), explored: r.explored, map });
      }
    }
  }
}
results.sort((a, b) => b.len - a.len);
const hist = {};
for (const r of results) hist[r.len] = (hist[r.len] || 0) + 1;
console.log(`${results.length} solvable; histogram ${JSON.stringify(hist)}`);
let shown = 0;
for (const r of results) {
  const chk = checkLevel({ id: 'x', feature: 'TSM', par: r.len, map: r.map });
  if (!chk.ok) continue;
  console.log(`len ${r.len} explored ${r.explored} ${r.moves}\n${r.map.join('\n')}`);
  if (++shown >= 5) break;
}
