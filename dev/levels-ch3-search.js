// Scratch search: for a fixed terrain, try every start placement of the movable things and list the
// placements with the longest shortest solution. Results are raw material only; curate by hand.
//   node dev/levels-ch3-search.js <name>
import { parseLevel } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

const TEMPLATES = {
  // '.' cells are candidates for W / S / M starts; the Stumpcap and terrain are fixed.
  finaleU: { feature: 'TSM', place: 'WSM', map: [
    '#######',
    '#..####',
    '#...###',
    '#.#.###',
    '#.#.###',
    '#>~.a.#',
    '###A###',
    '#G..###',
    '#######' ], zone: (x, y) => y <= 5 },
  finaleRoom: { feature: 'TSM', place: 'WSM', map: [
    '#######',
    '#..####',
    '#...###',
    '#...###',
    '#...###',
    '#>~.a.#',
    '###A###',
    '#G..###',
    '#######' ], zone: (x, y) => y <= 5 },
  whelk: { feature: 'TS', place: 'WS', map: [
    '######',
    '#..###',
    '#..###',
    '#..###',
    '#..###',
    '#>.a.#',
    '##A###',
    '#G.###',
    '######' ], zone: (x, y) => y <= 5 },
};

const name = process.argv[2];
const t = TEMPLATES[name];
const cells = [];
t.map.forEach((row, y) => [...row].forEach((ch, x) => { if (ch === '.' && t.zone(x, y)) cells.push([x, y]); }));
const results = [];
const put = (map, x, y, ch) => { map[y] = map[y].slice(0, x) + ch + map[y].slice(x + 1); };
function rec(i, map, used) {
  if (i === t.place.length) {
    const def = { id: 'x', feature: t.feature, par: 0, map };
    let st;
    try { st = parseLevel(def); } catch { return; }
    if (st.solved) return;
    const r = solve(st, { maxStates: 150000 });
    if (!r.solved) return;
    results.push({ len: r.moves.length, moves: r.moves.join(''), explored: r.explored, map: map.slice() });
    return;
  }
  for (const [x, y] of cells) {
    const k = x + ',' + y;
    if (used.has(k)) continue;
    const m2 = map.slice();
    put(m2, x, y, t.place[i]);
    used.add(k);
    rec(i + 1, m2, used);
    used.delete(k);
  }
}
rec(0, t.map.slice(), new Set());
results.sort((a, b) => b.len - a.len);
console.log(`${name}: ${results.length} solvable placements; length histogram:`);
const hist = {};
for (const r of results) hist[r.len] = (hist[r.len] || 0) + 1;
console.log(JSON.stringify(hist));
let shown = 0;
for (const r of results) {
  const chk = checkLevel({ id: 'x', feature: t.feature, par: r.len, map: r.map });
  if (!chk.ok) continue;
  console.log(`len ${r.len} explored ${r.explored} ${r.moves}`);
  console.log(r.map.join('\n'));
  if (++shown >= 4) break;
}
