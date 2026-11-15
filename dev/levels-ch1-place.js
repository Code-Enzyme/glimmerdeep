// Scratch: on a fixed layout, try every start placement of Wren and k moths and rank the results.
//   node dev/levels-ch1-place.js <cand-name> [--moths 1] [--top 25] [--minlen 6] [--needL] [--keep]
// The candidate's own W and M are removed first (unless --keep, which keeps the moths and only moves Wren).
import { ACTIONS, parseLevel, step, solve, winnability } from './levels-ch1-lib.js';
import C from './levels-ch1-cands.js';

const args = process.argv.slice(2);
const name = args[0];
const num = (flag, d) => { const i = args.indexOf(flag); return i >= 0 ? Number(args[i + 1]) : d; };
const moths = num('--moths', 1);
const top = num('--top', 25);
const minlen = num('--minlen', 6);
const needL = args.includes('--needL');
const keep = args.includes('--keep');
const brief = args.includes('--brief');
const def = C[name];
if (!def) { console.error('no candidate ' + name); process.exit(1); }

const base = def.map.map((r) => r.replace(/W/g, '.'));
const grid = keep ? base : base.map((r) => r.replace(/M/g, '.'));
const floors = [];
grid.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === '.') floors.push([x, y]); }));
const noL = ACTIONS.filter((a) => a !== 'L');

function* combos(arr, k, from = 0) {
  if (k === 0) { yield []; return; }
  for (let i = from; i < arr.length; i++) for (const rest of combos(arr, k - 1, i + 1)) yield [arr[i], ...rest];
}

const results = [];
for (const [wx, wy] of floors) {
  for (const ms of combos(floors, keep ? 0 : moths)) {
    if (ms.some(([x, y]) => x === wx && y === wy)) continue;
    const g = grid.map((r) => [...r]);
    g[wy][wx] = 'W';
    for (const [x, y] of ms) g[y][x] = 'M';
    const map = g.map((r) => r.join(''));
    let start;
    try { start = parseLevel({ id: 'p', map }); } catch { continue; }
    if (start.solved) continue;
    const main = solve(start, { maxStates: 150000 });
    if (!main.solved || main.moves.length < minlen) continue;
    const bare = solve(parseLevel({ id: 'p', map: map.map((r) => r.replace(/M/g, '.')) }), { maxStates: 150000 });
    if (bare.solved) continue;
    const nl = solve(start, { maxStates: 150000, actions: noL });
    const lNeeded = !nl.solved;
    if (needL && !lNeeded) continue;
    const win = winnability(start, { cap: 150000 });
    let deadFirst = 0;
    let firstCount = 0;
    for (const a of ACTIONS) {
      const nx = step(start, a);
      if (!nx || nx.solved) continue;
      firstCount++;
      if (!solve(nx, { maxStates: 150000 }).solved) deadFirst++;
    }
    const moves = main.moves.join('');
    results.push({ w: `W${wx},${wy}`, m: ms.map(([x, y]) => `M${x},${y}`).join(' '), map, len: moves.length, moves, lNeeded, noL: nl.solved ? nl.moves.length : '-', full: win.size, winShare: win.winCount / win.size, firstDead: win.firstDead, deadFirst, firstCount });
  }
}
results.sort((a, b) => (a.deadFirst - b.deadFirst) || (a.winShare - b.winShare) || (b.len - a.len));
console.log(`${results.length} placements pass`);
for (const r of results.slice(0, top)) {
  console.log(`len ${r.len} ${r.moves}  L:${r.lNeeded ? 'needed' : 'no(' + r.noL + ')'} full ${r.full} win ${(100 * r.winShare).toFixed(0)}% firstDead ${r.firstDead} deadFirst ${r.deadFirst}/${r.firstCount}`);
  if (brief) console.log(`   ${r.w} ${r.m}`); else console.log(r.map.map((s) => '   ' + s).join('\n'));
}
