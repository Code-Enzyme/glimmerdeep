// Chapter 5 and 6 level-design search (scratch tooling, not shipped).
//   node dev/levels-ch5-search.js <skeleton> [--set=ch6] [--min=6] [--max=40] [--top=12] [--states=120000]
// The skeleton is a map with some pieces left out. `place` lists the pieces to put on it (for example
// ['W', 'K'] or ['W', 'K', 'S']); each goes on every free floor cell, or on the cells listed under its
// character in `cells`. Every placement is solved; those that pass checkLevel are listed, longest first,
// with the solution and when the Emberwick caught.
import { parseLevel, step } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const set = opt('set', 'ch5');
const { SKELETONS } = await import(`./levels-${set}-skeletons.js`);
const name = args.find((a) => !a.startsWith('--'));
const sk = SKELETONS[name];
if (!sk) throw new Error(`no skeleton ${name}; have ${Object.keys(SKELETONS).join(', ')}`);
const base = sk.map;
const feature = opt('feature', sk.feature || (set === 'ch6' ? 'O' : 'K'));
const min = Number(opt('min', 6));
const max = Number(opt('max', 40));
const top = Number(opt('top', 12));
const budget = Number(opt('states', 120000));
const place = sk.place || ['W', 'K'];
// --shard=i/n: only every n-th placement, starting at i, so n processes can share one search
const [shardI, shardN] = opt('shard', '0/1').split('/').map(Number);
let placed = 0;

const put = (map, x, y, ch) => { const m = map.slice(); m[y] = m[y].slice(0, x) + ch + m[y].slice(x + 1); return m; };
const floor = [];
for (let y = 0; y < base.length; y++) for (let x = 0; x < base[0].length; x++) if (base[y][x] === '.') floor.push([x, y]);
const cellsOf = (ch) => (sk.cells && sk.cells[ch]) || floor;
// a piece char may stand for several variants (a newt's four facings, say)
const VARIANTS = { D: 'nesw', T: '^>v<' };

function story(def, moves) {
  let s = parseLevel(def);
  const n = { ignite: -1, plant: 0, Z: 0 };
  moves.forEach((m, i) => {
    if (m === 'Z') n.Z++;
    if (m === 'L') n.plant++;
    s = step(s, m);
    for (const e of s.events) if (e.type === 'ignite' && n.ignite < 0) n.ignite = i + 1;
  });
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' };
  n.idle = n.Z;
  for (let i = 1; i < moves.length; i++) if (opp[moves[i]] === moves[i - 1]) n.idle++;
  return n;
}

const out = [];
let tried = 0;
const why = { unsolvable: 0, 'too big': 0, 'par out of range': 0 };
function rec(map, i, used, last) {
  if (i === place.length) {
    if (placed++ % shardN !== shardI) return;
    const def = { id: 'x', name, map, par: 0, feature, under: sk.under };
    let st;
    try { st = parseLevel(def); } catch (e) { return; }
    if (st.solved) return;
    tried++;
    const r = solve(st, { maxStates: budget });
    if (!r.solved) { why[r.exhausted ? 'unsolvable' : 'too big']++; return; }
    if (r.moves.length < min || r.moves.length > max) { why['par out of range']++; return; }
    const chk = checkLevel({ ...def, par: r.moves.length }, { maxStates: budget });
    if (!chk.ok) {
      const p = chk.problems[0].replace(/\d+/g, 'n').replace(/\(.*\)/, '');
      why[p] = (why[p] || 0) + 1;
      return;
    }
    out.push({ len: r.moves.length, moves: r.moves.join(''), explored: chk.searched, story: story(def, r.moves), map });
    return;
  }
  const ch = place[i];
  const list = cellsOf(ch);
  // two pieces of the same kind are placed in cell order only, so each pair is tried once
  const from = i > 0 && place[i - 1] === ch ? last + 1 : 0;
  for (let j = from; j < list.length; j++) {
    const [x, y] = list[j];
    const k = `${x},${y}`;
    if (used.has(k) || base[y][x] !== '.') continue;
    used.add(k);
    for (const v of VARIANTS[ch] || ch) rec(put(map, x, y, v), i + 1, used, j);
    used.delete(k);
  }
}
rec(base, 0, new Set(), -1);

const maxIdle = Number(opt('idle', 99));
const maxIgnite = Number(opt('ignite', 99));
const kept = out.filter((o) => (!sk.keep || sk.keep(o)) && o.story.idle <= maxIdle && o.story.ignite <= maxIgnite);
if (opt('order', 'long') === 'short') kept.sort((a, b) => a.len - b.len || a.story.idle - b.story.idle);
else kept.sort((a, b) => b.len - a.len || a.story.idle - b.story.idle);
console.log(`${name}: ${tried} placements tried, ${out.length} pass checkLevel with par ${min}..${max}, ${kept.length} kept`);
console.log('  rejected: ' + JSON.stringify(why));
for (const o of kept.slice(0, top)) {
  console.log(`par ${o.len}  ${o.moves}  searched ${o.explored}  ${JSON.stringify(o.story)}`);
  for (const r of o.map) console.log('   ' + r);
}
