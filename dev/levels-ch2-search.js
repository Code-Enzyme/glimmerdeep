// Scratch: mutation search for raw material for chapter 2 levels. Results are curated by hand afterwards.
//   node dev/levels-ch2-search.js --w 7 --h 7 --S 1 --buds 1 --ch 1 --M 0 --P 0 --needL 0 --time 30 --seed 1
//   --base FILE.json   start from (and keep the fixed cells of) a skeleton: { map: [...], fixed: [...] }
//                      where `fixed` is a same-size mask, 'x' marks cells the search may not change.
import { writeFileSync, readFileSync } from 'node:fs';
import { parseLevel, solve, ACTIONS, analyse } from './levels-ch2-lib.js';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const W = +arg('w', 7);
const H = +arg('h', 7);
const N_S = +arg('S', 1);
const N_M = +arg('M', 0);
const N_P = +arg('P', 0);
const N_BUD = +arg('buds', 1);
const N_CH = +arg('ch', 1);          // channels, each one root + one gate (roots2 adds a second root on channel A)
const ROOTS2 = +arg('roots2', 0);
const NEED_L = +arg('needL', 0);     // 1: L must be necessary. -1: L must NOT be needed (solvable without L at same length)
const TIME = +arg('time', 30) * 1000;
const SEED = +arg('seed', 1);
const CAP = +arg('cap', 60000);
const MINFLOOR = +arg('minfloor', 0);
const OUT = arg('out', null);
const BASE = arg('base', null);

let seed = SEED >>> 0;
function rnd() {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (n) => Math.floor(rnd() * n);

const without = (map, chars, to = '.') => map.map((r) => Array.from(r, (c) => (chars.includes(c) ? to : c)).join(''));

export function evaluate(map, { cap = CAP, needL = NEED_L } = {}) {
  let start;
  try { start = parseLevel({ id: 'x', map }); } catch { return null; }
  if (start.solved) return null;
  const sol = solve(start, { maxStates: cap });
  if (!sol.solved) return null;
  const unsolvable = (m, opts = {}) => {
    let s;
    try { s = parseLevel({ id: 'x', map: m }); } catch { return false; }
    if (s.solved) return false;
    const r = solve(s, { maxStates: cap, ...opts });
    return !r.solved && r.exhausted;
  };
  const flat = map.join('');
  if (flat.includes('S') && !unsolvable(without(map, 'S'))) return null;
  if (flat.includes('M') && !unsolvable(without(map, 'M'))) return null;
  // every single whelk matters
  const cells = [];
  map.forEach((r, y) => Array.from(r).forEach((c, x) => { if (c === 'S') cells.push([x, y]); }));
  if (cells.length > 1) {
    for (const [x, y] of cells) {
      const m = map.map((r, yy) => (yy === y ? r.slice(0, x) + '.' + r.slice(x + 1) : r));
      if (!unsolvable(m)) return null;
    }
  }
  // every gate channel matters: as walls the level is unsolvable
  for (const g of 'ABC') {
    if (flat.includes(g) && !unsolvable(without(map, g, '#'))) return null;
  }
  // every puddle matters: as floor the level gets shorter or as wall unsolvable (skip: keep simple)
  let lNeeded = false;
  {
    const r = solve(start, { maxStates: cap, actions: ACTIONS.filter((a) => a !== 'L') });
    lNeeded = !r.solved && r.exhausted;
    if (needL === 1 && !lNeeded) return null;
    if (needL === -1 && !(r.solved && r.moves.length === sol.moves.length)) return null;
  }
  // baseline: no creatures, gates open
  let base = 0;
  try {
    const b = solve(parseLevel({ id: 'x', map: without(without(map, 'SM'), 'ABC') }), { maxStates: cap });
    base = b.solved ? b.moves.length : 0;
  } catch { base = 0; }
  const floor = Array.from(flat).filter((c) => c !== '#').length;
  const len = sol.moves.length;
  const waits = sol.moves.filter((m) => m === 'Z').length;
  const score = (len - base) * 3 + len - floor * 0.6 - waits * 1.5;
  return { score, len, base, floor, lNeeded, moves: sol.moves.join(''), explored: sol.explored };
}

function randomMap() {
  const g = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => (
    x === 0 || y === 0 || x === W - 1 || y === H - 1 ? '#' : (rnd() < 0.45 ? '#' : '.'))));
  const objs = ['W'];
  for (let i = 0; i < N_S; i++) objs.push('S');
  for (let i = 0; i < N_M; i++) objs.push('M');
  for (let i = 0; i < N_P; i++) objs.push('~');
  for (let i = 0; i < N_BUD; i++) objs.push('G');
  for (let i = 0; i < N_CH; i++) { objs.push('abc'[i]); objs.push('ABC'[i]); }
  for (let i = 0; i < ROOTS2; i++) objs.push('a');
  for (const o of objs) {
    for (let tries = 0; tries < 200; tries++) {
      const x = 1 + ri(W - 2);
      const y = 1 + ri(H - 2);
      if (g[y][x] === '#' || g[y][x] === '.') { g[y][x] = o; break; }
    }
  }
  return g;
}

function mutate(g, fixed) {
  const n = g.map((r) => r.slice());
  const free = (x, y) => !fixed || fixed[y][x] !== 'x';
  const k = 1 + (rnd() < 0.3 ? 1 : 0) + (rnd() < 0.1 ? 1 : 0);
  for (let i = 0; i < k; i++) {
    const x = 1 + ri(W - 2);
    const y = 1 + ri(H - 2);
    if (!free(x, y)) continue;
    const c = n[y][x];
    if (c === '#') n[y][x] = '.';
    else if (c === '.') n[y][x] = '#';
    else {
      // move the object somewhere else
      const x2 = 1 + ri(W - 2);
      const y2 = 1 + ri(H - 2);
      if (!free(x2, y2)) continue;
      const c2 = n[y2][x2];
      if (c2 === '#' || c2 === '.') { n[y2][x2] = c; n[y][x] = rnd() < 0.5 ? '.' : c2; }
      else { n[y2][x2] = c; n[y][x] = c2; }
    }
  }
  return n;
}

const toMap = (g) => g.map((r) => r.join(''));

function main() {
  const t0 = Date.now();
  const best = [];   // archive of distinct good maps
  let base = null;
  if (BASE) base = JSON.parse(readFileSync(BASE, 'utf8'));
  let rounds = 0;
  while (Date.now() - t0 < TIME) {
    rounds++;
    let cur = base ? base.map.map((r) => Array.from(r)) : randomMap();
    let curEval = evaluate(toMap(cur));
    let tries = 0;
    while (!curEval && tries < 400 && !base) { cur = randomMap(); curEval = evaluate(toMap(cur)); tries++; }
    if (!curEval) { if (base) { console.log('base does not evaluate'); return; } continue; }
    let stale = 0;
    const roundEnd = Date.now() + Math.min(TIME / 4, 20000);
    while (stale < 300 && Date.now() < roundEnd && Date.now() - t0 < TIME) {
      const cand = mutate(cur, base ? base.fixed : null);
      const e = evaluate(toMap(cand));
      if (e && e.floor >= MINFLOOR && e.score >= curEval.score) {
        if (e.score > curEval.score) stale = 0; else stale++;
        cur = cand;
        curEval = e;
      } else stale++;
    }
    best.push({ map: toMap(cur), ...curEval });
  }
  best.sort((a, b) => b.score - a.score);
  const seen = new Set();
  const top = [];
  for (const b of best) {
    const k = b.map.join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    top.push(b);
    if (top.length >= 8) break;
  }
  for (const b of top) {
    const an = analyse(parseLevel({ id: 'x', map: b.map }), 300000);
    console.log(`score ${b.score.toFixed(1)} len ${b.len} base ${b.base} floor ${b.floor} L ${b.lNeeded} reach ${an.size} dead ${an.dead} trap@${an.firstTrap} ways ${an.shortestWays}  ${b.moves}`);
    console.log(b.map.map((r) => `      '${r}',`).join('\n'));
  }
  console.log(`rounds ${rounds}`);
  if (OUT) writeFileSync(OUT, JSON.stringify(top, null, 1));
}

if (process.argv[1] && process.argv[1].endsWith('levels-ch2-search.js')) main();
