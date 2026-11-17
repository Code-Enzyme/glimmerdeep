// Chapter 4 level-design search (scratch tooling, not shipped).
//   node dev/levels-ch4-search.js <skeleton> [--feature=D] [--min=8] [--max=30] [--top=12] [--extra=M]
// The skeleton is a map with Wren and creatures left out. Every placement of Wren and one newt (every
// floor cell, every facing) is solved; those that pass checkLevel are listed, longest first, with the
// solution and how often the newt turned, dozed and woke on the way. --extra=S places one more creature
// of that kind on every remaining floor cell as well.
import { parseLevel, step } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';
import { SKELETONS } from './levels-ch4-skeletons.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const name = args.find((a) => !a.startsWith('--'));
const sk = SKELETONS[name];
if (!sk) throw new Error(`no skeleton ${name}; have ${Object.keys(SKELETONS).join(', ')}`);
const base = sk.map;
const feature = opt('feature', sk.feature || 'D');
const min = Number(opt('min', 6));
const max = Number(opt('max', 40));
const top = Number(opt('top', 12));
const extra = opt('extra', '');
const budget = Number(opt('states', 120000));

const put = (map, x, y, ch) => { const m = map.slice(); m[y] = m[y].slice(0, x) + ch + m[y].slice(x + 1); return m; };
const cells = [];
for (let y = 0; y < base.length; y++) for (let x = 0; x < base[0].length; x++) if (base[y][x] === '.') cells.push([x, y]);
const wrenOpt = opt('wren', '');
const wrenCells = wrenOpt ? [wrenOpt.split(',').map(Number)] : sk.wren ? sk.wren : cells;
const newtCells = sk.newt ? sk.newt : cells;
const extraCells = extra ? (sk.extraCells || cells) : [null];

function story(def, moves) {
  let s = parseLevel(def);
  const n = { turn: 0, sleep: 0, wake: 0, Z: 0, L: 0 };
  for (const m of moves) {
    if (m === 'Z' || m === 'L') n[m]++;
    s = step(s, m);
    for (const e of s.events) if (n[e.type] !== undefined) n[e.type]++;
  }
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' };
  n.idle = n.Z;
  for (let i = 1; i < moves.length; i++) if (opp[moves[i]] === moves[i - 1]) n.idle++;
  return n;
}

const out = [];
let tried = 0;
for (const [wx, wy] of wrenCells) {
  for (const [nx, ny] of newtCells) {
    if (nx === wx && ny === wy) continue;
    for (const f of 'nesw') {
      for (const ec of extraCells) {
        if (ec && ((ec[0] === wx && ec[1] === wy) || (ec[0] === nx && ec[1] === ny))) continue;
       for (const ex of extra === 'T' ? '^>v<' : extra === 'D' ? 'nesw' : [extra]) {
        let map = put(put(base, wx, wy, 'W'), nx, ny, f);
        if (ec) map = put(map, ec[0], ec[1], ex);
        const def = { id: 'x', name, map, par: 0, feature, under: sk.under };
        let st;
        try { st = parseLevel(def); } catch (e) { continue; }
        tried++;
        const r = solve(st, { maxStates: budget });
        if (!r.solved || r.moves.length < min || r.moves.length > max) continue;
        const chk = checkLevel({ ...def, par: r.moves.length }, { maxStates: budget });
        if (!chk.ok) continue;
        out.push({ len: r.moves.length, moves: r.moves.join(''), explored: r.explored, story: story(def, r.moves), map });
       }
      }
    }
  }
}
if (opt('json', '')) (await import('node:fs')).writeFileSync(opt('json', ''), JSON.stringify(out));
const maxIdle = Number(opt('idle', 99));
const minTurn = Number(opt('turns', 0));
const kept = out.filter((o) => o.story.idle <= maxIdle && o.story.turn >= minTurn);
kept.sort((a, b) => b.len - a.len || a.story.idle - b.story.idle || b.story.turn - a.story.turn);
console.log(`${name}: ${tried} placements tried, ${out.length} pass checkLevel with par ${min}..${max}, ${kept.length} with idle <= ${maxIdle} and turns >= ${minTurn}`);
for (const o of kept.slice(0, top)) {
  console.log(`par ${o.len}  ${o.moves}  explored ${o.explored}  ${JSON.stringify(o.story)}`);
  for (const r of o.map) console.log('   ' + r);
}
