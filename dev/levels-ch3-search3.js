// Scratch search 3: two-wing finale skeleton; enumerate W and S starts (moth fixed), list longest that pass checkLevel.
import { parseLevel } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';
import { fullSpace } from './levels-ch3-lib.js';
const SK = {
  wing: [
    '#######',
    '#...~v#',
    '#....a#',
    '#...#.#',
    '#...###',
    '#>~.aM#',
    '###A###',
    '#G..###',
    '#######' ],
  budwing: [
    '#######',
    '#...~v#',
    '#....a#',
    '#...#.#',
    '#...#G#',
    '#>~.aM#',
    '###A###',
    '#G..###',
    '#######' ],
  ledge: [
    '#######',
    '###.~v#',
    '#....a#',
    '#...#.#',
    '#...#G#',
    '#>~.aM#',
    '###A###',
    '#G..###',
    '#######' ],
  wing2: [
    '#######',
    '##..~v#',
    '#....a#',
    '#...#.#',
    '#...###',
    '#>~.aM#',
    '###A###',
    '#G..###',
    '#######' ],
};
const base = SK[process.argv[2] || 'wing'];
const feature = 'TSML';
const put = (map, x, y, ch) => { const m = map.slice(); m[y] = m[y].slice(0, x) + ch + m[y].slice(x + 1); return m; };
const cells = [];
for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) if (base[y][x] === '.') cells.push([x, y]);
const results = [];
for (const [sx, sy] of cells) for (const [wx, wy] of cells) {
  if (sx === wx && sy === wy) continue;
  const map = put(put(base, sx, sy, 'S'), wx, wy, 'W');
  const st = parseLevel({ id: 'x', map });
  const r = solve(st, { maxStates: 150000 });
  if (r.solved) results.push({ len: r.moves.length, moves: r.moves.join(''), explored: r.explored, map });
}
results.sort((a, b) => b.len - a.len);
const hist = {};
for (const r of results) hist[r.len] = (hist[r.len] || 0) + 1;
console.log(`${results.length} solvable of ${cells.length * (cells.length - 1)}; histogram ${JSON.stringify(hist)}`);
let shown = 0;
for (const r of results) {
  const chk = checkLevel({ id: 'x', feature, par: r.len, map: r.map });
  if (!chk.ok) { continue; }
  const fs = fullSpace(parseLevel({ id: 'x', map: r.map }));
  console.log(`len ${r.len} explored ${r.explored} full ${fs.size}${fs.capped ? '+' : ''} ${r.moves}\n${r.map.join('\n')}`);
  if (++shown >= 4) break;
}
