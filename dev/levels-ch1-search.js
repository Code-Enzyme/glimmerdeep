// Scratch: mutation search for chapter 1 raw material. Output is JSONL in the given file; curate by hand.
//   node dev/levels-ch1-search.js out.jsonl --w 7 --h 7 --moths 1 --buds 1 --puddles 3 --needL 1 --seed 1 --iters 20000
import fs from 'node:fs';
import { ACTIONS, parseLevel, step, key, solve } from './levels-ch1-lib.js';
import { winnability } from './levels-ch1-lib.js';

const argv = process.argv.slice(2);
const out = argv[0];
const opt = { w: 7, h: 7, moths: 1, buds: 1, puddles: 3, needL: 0, seed: 1, iters: 20000, minLen: 8, maxLen: 30, startL: 0, restarts: 40 };
for (let i = 1; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = Number(argv[i + 1]);

// Small deterministic RNG (mulberry32).
let rs = opt.seed >>> 0;
const rnd = () => { rs = (rs + 0x6D2B79F5) >>> 0; let t = rs; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const ri = (n) => Math.floor(rnd() * n);

const W = opt.w, H = opt.h;
const interior = [];
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) interior.push([x, y]);

function randomGrid() {
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  for (const [x, y] of interior) g[y][x] = rnd() < 0.5 ? '.' : '#';
  const cells = interior.slice().sort(() => rnd() - 0.5);
  let i = 0;
  const put = (ch) => { const [x, y] = cells[i++]; g[y][x] = ch; };
  put('W');
  for (let k = 0; k < opt.moths; k++) put('M');
  for (let k = 0; k < opt.buds; k++) put('G');
  for (let k = 0; k < opt.puddles; k++) put('~');
  if (opt.startL) put('L');
  return g;
}

function mutate(g0) {
  const g = g0.map((r) => r.slice());
  const n = 1 + (rnd() < 0.3 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const [x, y] = interior[ri(interior.length)];
    const c = g[y][x];
    if (c === '#' || c === '.' || c === '~') {
      // toggle terrain, keeping the puddle count bounded
      const r = rnd();
      const puddles = g.flat().filter((ch) => ch === '~').length;
      if (c === '~') g[y][x] = r < 0.5 ? '.' : '#';
      else if (r < 0.2 && puddles < opt.puddles) g[y][x] = '~';
      else g[y][x] = c === '#' ? '.' : '#';
    } else {
      // move a thing to a random terrain cell (swap)
      const [x2, y2] = interior[ri(interior.length)];
      const c2 = g[y2][x2];
      if (c2 === '#' || c2 === '.' || c2 === '~') { g[y2][x2] = c; g[y][x] = c2 === '~' ? '~' : (rnd() < 0.5 ? '.' : '#'); }
    }
  }
  return g;
}

const toMap = (g) => g.map((r) => r.join(''));
const noL = ACTIONS.filter((a) => a !== 'L');

function evaluate(g) {
  const map = toMap(g);
  let start;
  try { start = parseLevel({ id: 's', map }); } catch { return null; }
  if (start.solved) return null;
  const main = solve(start, { maxStates: 30000 });
  if (!main.solved) return null;
  const len = main.moves.length;
  if (len > opt.maxLen) return null;
  // every moth must be necessary on its own
  const cells = [];
  map.forEach((r, y) => [...r].forEach((ch, x) => { if (ch === 'M') cells.push([x, y]); }));
  for (const [mx, my] of cells) {
    const m2 = map.map((r, y) => (y === my ? r.slice(0, mx) + '.' + r.slice(mx + 1) : r));
    const wo = solve(parseLevel({ id: 's', map: m2 }), { maxStates: 30000 });
    if (wo.solved || !wo.exhausted) return null;
  }
  const nl = solve(start, { maxStates: 30000, actions: noL });
  const lNeeded = !nl.solved && nl.exhausted;
  if (opt.needL === 1 && !lNeeded) return null;
  if (opt.needL === -1 && lNeeded) return null;
  const dry = parseLevel({ id: 's', map: map.map((r) => r.replace(/[M~]/g, '.')) });
  const dr = solve(dry, { maxStates: 30000 });
  const naive = dr.solved ? dr.moves.length : len;
  const floor = map.join('').replace(/#/g, '').length;
  const moves = main.moves.join('');
  const waits = (moves.match(/Z/g) || []).length + (moves.match(/LL/g) || []).length;
  const win = winnability(start, { cap: 30000 });
  if (win.capped) return null;
  const winShare = win.winCount / win.size;
  let deadFirst = 0;
  for (const a of ACTIONS) {
    const nx = step(start, a);
    if (!nx || nx.solved) continue;
    if (!solve(nx, { maxStates: 30000 }).solved) deadFirst++;
  }
  const score = (len - naive) * 1.0 + len * 0.3 - floor * 0.3 + (1 - winShare) * 10 - waits * 3 - deadFirst * 6 + (lNeeded ? 2 : 0);
  return { map, len, naive, lNeeded, floor, moves, waits, score: +score.toFixed(2), full: win.size, winShare: +winShare.toFixed(2), firstDead: win.firstDead, deadFirst };
}

function finalChecks(e) {
  // expensive: full space, dead starts
  const start = parseLevel({ id: 's', map: e.map });
  const win = winnability(start, { cap: 150000 });
  if (win.capped) return null;
  let deadFirst = 0;
  for (const a of ACTIONS) {
    const nx = step(start, a);
    if (!nx || nx.solved) continue;
    if (!solve(nx, { maxStates: 150000 }).solved) deadFirst++;
  }
  return { full: win.size, winShare: +(win.winCount / win.size).toFixed(2), firstDead: win.firstDead, deadFirst };
}

const seen = new Set();
let logged = 0;
for (let r = 0; r < opt.restarts; r++) {
  let g = null, e = null;
  for (let tries = 0; tries < 3000 && !e; tries++) { g = randomGrid(); e = evaluate(g); }
  if (!e) continue;
  let best = e;
  const per = Math.floor(opt.iters / opt.restarts);
  for (let it = 0; it < per; it++) {
    const g2 = mutate(g);
    const e2 = evaluate(g2);
    if (!e2) continue;
    const temp = 1.5 * (1 - it / per);
    if (e2.score >= e.score || rnd() < Math.exp((e2.score - e.score) / Math.max(temp, 0.01))) { g = g2; e = e2; }
    if (e.score > best.score) best = e;
  }
  if (best.len >= opt.minLen) {
    const k = best.map.join('|');
    if (!seen.has(k)) {
      seen.add(k);
      const f = {};
      if (best.deadFirst === 0) { fs.appendFileSync(out, JSON.stringify({ ...best, ...f, opt: `${W}x${H} m${opt.moths} b${opt.buds} s${opt.seed}` }) + '\n'); logged++; }
    }
  }
}
console.log(`done: ${logged} candidates -> ${out}`);
