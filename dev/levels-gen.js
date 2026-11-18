// Level generator (scratch tooling, not shipped): random small caves improved by hill climbing.
//
//   node dev/levels-gen.js --spec=dev/gen-specs/ch1.json --restarts=20 --iters=300 --seed=1 --out=/tmp/c1.json
//
// The spec says what a level may hold:
//   { "w": 9, "h": 7,                 // outer size, walls included
//     "feature": "M",                 // must all be necessary (SPEC section 6)
//     "pieces": { "M": [1, 3], "S": [0, 1] },   // how many of each creature, min and max
//     "puddles": [0, 4], "buds": [1, 2], "hush": [0, 0], "roots": [0, 1],   // a root brings its gate
//     "planted": false,               // may start with the lantern planted (L)
//     "shutter": false,
//     "par": [14, 30],                // keep levels whose shortest solution is in this range
//     "floor": 30 }                   // at most this many open tiles, so length comes from the puzzle
//
// Each restart builds a random cave, then mutates it (walls, pieces, puddles, facings) and keeps a change
// when the level still passes the checks and scores no worse: score = par + creature moves / 6 - 1.5 x idle
// moves (waits, steps straight back, the lantern set down and picked straight up again).
// The best level of each restart is written out with its solution.
import { parseLevel, step } from '../src/engine.js';
import { solve } from '../src/solver.js';
import fs from 'fs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const spec = JSON.parse(fs.readFileSync(opt('spec'), 'utf8'));
const RESTARTS = Number(opt('restarts', 10));
const ITERS = Number(opt('iters', 300));
// a small search budget while climbing keeps it quick; pick a result and run the full level check on it
const STATES = Number(opt('states', 30000));
let seed = Number(opt('seed', 1)) >>> 0;
const out = opt('out', null);
const W = spec.w;
const H = spec.h;
const [parMin, parMax] = spec.par || [10, 40];
const maxFloor = spec.floor || 99;

function rand() {
  // mulberry32
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (n) => Math.floor(rand() * n);
const pick = (list) => list[ri(list.length)];
const between = ([a, b]) => a + ri(b - a + 1);

const VARIANTS = { M: 'M', S: 'S', T: '^>v<', D: 'nesw', K: 'K', O: 'O', R: '/\\' };
const KIND_OF = {};
for (const [k, v] of Object.entries(VARIANTS)) for (const ch of v) KIND_OF[ch] = k;

// A level is a grid of terrain plus a list of things standing on it.
// grid: rows of chars from '#', '.', '~', 'G', 'H', 'a', 'A'. things: [{ ch, x, y }] (W, L, creatures).
function toDef(lv) {
  const rows = lv.grid.map((r) => r.slice());
  const under = {};
  for (const t of lv.things) {
    const ter = rows[t.y][t.x];
    if (ter !== '.') under[`${t.x},${t.y}`] = ter;
    rows[t.y][t.x] = t.ch;
  }
  const def = { id: 'g', name: 'gen', par: 0, feature: spec.feature, map: rows.map((r) => r.join('')) };
  if (Object.keys(under).length) def.under = under;
  if (spec.shutter) def.shutter = true;
  return def;
}

// the tiles inside the outer wall, for a level of this size
const innerCache = new Map();
function inner(lv) {
  const h = lv.grid.length;
  const w = lv.grid[0].length;
  const k = `${w}x${h}`;
  if (!innerCache.has(k)) {
    const list = [];
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) list.push([x, y]);
    innerCache.set(k, list);
  }
  return innerCache.get(k);
}
const isFree = (lv, x, y) => lv.grid[y][x] === '.' && !lv.things.some((t) => t.x === x && t.y === y);
const freeCells = (lv) => inner(lv).filter(([x, y]) => isFree(lv, x, y));
const floorCount = (lv) => inner(lv).filter(([x, y]) => lv.grid[y][x] !== '#').length;
const SPECIAL = 'G~HabcABC';
const GATES = 'ABC';

// A shipped level as a starting point (--from=chN): its terrain, Wren and its creatures.
function fromDef(def) {
  const grid = [];
  const things = [];
  def.map.forEach((row, y) => {
    const r = [];
    Array.from(row).forEach((ch, x) => {
      if (ch === 'W' || ch === 'L' || KIND_OF[ch]) {
        things.push({ ch, x, y });
        r.push((def.under && def.under[`${x},${y}`]) || '.');
      } else r.push(ch);
    });
    grid.push(r);
  });
  return { grid, things };
}

function randomLevel() {
  const grid = [];
  for (let y = 0; y < H; y++) {
    const row = [];
    for (let x = 0; x < W; x++) row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 || rand() < 0.38 ? '#' : '.');
    grid.push(row);
  }
  const lv = { grid, things: [] };
  const put = (ch) => {
    const cells = freeCells(lv);
    if (!cells.length) return;
    const [x, y] = pick(cells);
    lv.grid[y][x] = ch;
  };
  for (let i = between(spec.buds || [1, 1]); i > 0; i--) put('G');
  for (let i = between(spec.puddles || [0, 0]); i > 0; i--) put('~');
  for (let i = between(spec.hush || [0, 0]); i > 0; i--) put('H');
  for (let i = between(spec.roots || [0, 0]); i > 0; i--) {
    put('a');
    put('A');
  }
  const place = (ch) => {
    const cells = freeCells(lv);
    if (!cells.length) return;
    const [x, y] = pick(cells);
    lv.things.push({ ch, x, y });
  };
  place('W');
  if (spec.planted && rand() < 0.5) place('L');
  for (const [kind, range] of Object.entries(spec.pieces || {})) {
    for (let i = between(range); i > 0; i--) place(pick(VARIANTS[kind]));
  }
  return lv;
}

const clone = (lv) => ({ grid: lv.grid.map((r) => r.slice()), things: lv.things.map((t) => ({ ...t })) });

function countOf(lv, kind) {
  return lv.things.filter((t) => KIND_OF[t.ch] === kind).length;
}

function mutate(lv0) {
  const lv = clone(lv0);
  const r = rand();
  if (r < 0.4) {
    // flip a wall and a floor tile
    const [x, y] = pick(inner(lv));
    if (lv.things.some((t) => t.x === x && t.y === y)) return lv;
    if (lv.grid[y][x] === '#') lv.grid[y][x] = '.';
    else if (lv.grid[y][x] === '.') lv.grid[y][x] = '#';
  } else if (r < 0.65) {
    // move a thing
    if (!lv.things.length) return lv;
    const t = pick(lv.things);
    const cells = inner(lv).filter(([x, y]) => lv.grid[y][x] !== '#' && lv.grid[y][x] !== 'G' && !GATES.includes(lv.grid[y][x])
      && (lv.grid[y][x] !== '~' || t.ch === 'M') && lv.grid[y][x] !== 'H'
      && !lv.things.some((o) => o.x === x && o.y === y));
    if (!cells.length) return lv;
    const [x, y] = pick(cells);
    if (lv.grid[y][x] === '~') return lv;   // creatures start on dry ground
    t.x = x;
    t.y = y;
  } else if (r < 0.75) {
    // move a terrain feature (bud, puddle, hush, root or gate)
    const special = inner(lv).filter(([x, y]) => SPECIAL.includes(lv.grid[y][x]));
    if (!special.length) return lv;
    const [x, y] = pick(special);
    const cells = freeCells(lv);
    if (!cells.length) return lv;
    const [nx, ny] = pick(cells);
    lv.grid[ny][nx] = lv.grid[y][x];
    lv.grid[y][x] = '.';
  } else if (r < 0.83) {
    // add or remove a puddle (or hush)
    const kind = spec.hush && spec.hush[1] > 0 && rand() < 0.3 ? 'H' : '~';
    const range = kind === 'H' ? spec.hush : (spec.puddles || [0, 0]);
    const have = inner(lv).filter(([x, y]) => lv.grid[y][x] === kind);
    if (have.length < range[1] && (rand() < 0.5 || have.length <= range[0])) {
      const cells = freeCells(lv);
      if (cells.length) {
        const [x, y] = pick(cells);
        lv.grid[y][x] = kind;
      }
    } else if (have.length > range[0]) {
      const [x, y] = pick(have);
      lv.grid[y][x] = '.';
    }
  } else if (r < 0.9) {
    // turn a creature with a facing
    const turnable = lv.things.filter((t) => VARIANTS[KIND_OF[t.ch]] && VARIANTS[KIND_OF[t.ch]].length > 1);
    if (turnable.length) {
      const t = pick(turnable);
      t.ch = pick(VARIANTS[KIND_OF[t.ch]]);
    }
  } else {
    // add or remove a creature
    const kinds = Object.keys(spec.pieces || {});
    if (!kinds.length) return lv;
    const kind = pick(kinds);
    const [lo, hi] = spec.pieces[kind];
    const n = countOf(lv, kind);
    if (n < hi && (rand() < 0.5 || n <= lo)) {
      const cells = freeCells(lv);
      if (cells.length) {
        const [x, y] = pick(cells);
        lv.things.push({ ch: pick(VARIANTS[kind]), x, y });
      }
    } else if (n > lo) {
      const list = lv.things.filter((t) => KIND_OF[t.ch] === kind);
      const t = pick(list);
      lv.things.splice(lv.things.indexOf(t), 1);
    }
  }
  return lv;
}

function withoutKind(def, kind) {
  const chars = VARIANTS[kind];
  const under = { ...(def.under || {}) };
  const map = def.map.map((row, y) => Array.from(row, (ch, x) => {
    if (!chars.includes(ch)) return ch;
    const at = `${x},${y}`;
    const t = Object.prototype.hasOwnProperty.call(under, at) ? under[at] : '.';
    delete under[at];
    return t;
  }).join(''));
  return { ...def, map, under };
}

const ACTIONS = ['N', 'E', 'S', 'W', 'L', 'Z'];
// -> null when the level fails, else { par, moves, score, explored, idle, creatureMoves }
const memo = new Map();
function evaluate(lv) {
  const key = JSON.stringify(toDef(lv));
  if (memo.has(key)) return memo.get(key);
  const ev = evaluateNow(lv);
  if (memo.size > 20000) memo.clear();
  memo.set(key, ev);
  return ev;
}
function evaluateNow(lv) {
  if (floorCount(lv) > maxFloor) return null;
  const def = toDef(lv);
  let start;
  try {
    start = parseLevel(def);
  } catch (e) {
    return null;
  }
  if (start.solved) return null;
  const main = solve(start, { maxStates: STATES });
  if (!main.solved) return null;
  const par = main.moves.length;
  if (par < 4) return null;
  let searched = main.explored;
  for (const f of new Set(spec.feature)) {
    let without;
    if (f === 'L') without = solve(start, { maxStates: STATES, actions: ACTIONS.filter((a) => a !== 'L') });
    else if (f === 'A') without = solve(parseLevel({ ...def, shutter: false }), { maxStates: STATES });
    else {
      if (!start.creatures.some((c) => c.type === f)) return null;
      without = solve(parseLevel(withoutKind(def, f)), { maxStates: STATES });
    }
    if (without.solved || !without.exhausted) return null;
    searched += without.explored;
  }
  // how the solution plays: waits and steps straight back count as idle; creature moves as activity
  let s = start;
  let creatureMoves = 0;
  let idle = 0;
  const opp = { N: 'S', S: 'N', E: 'W', W: 'E' };
  main.moves.forEach((m, i) => {
    s = step(s, m);
    // a wait, a step straight back, or picking the lantern straight back up (or setting it straight back down)
    // (spec.idleBack false: steps straight back are how a whelk is herded, so they do not count)
    const back = spec.idleBack !== false && i > 0 && opp[m] === main.moves[i - 1];
    if (m === 'Z' || back || (i > 0 && m === 'L' && main.moves[i - 1] === 'L')) idle++;
    for (const e of s.events) if (e.type === 'move' && e.who !== 'wren') creatureMoves++;
  });
  // every creature beyond the fewest the spec allows costs a little: a puzzle should not be clutter
  let extra = 0;
  for (const [kind, [lo]] of Object.entries(spec.pieces || {})) extra += Math.max(0, start.creatures.filter((c) => c.type === kind).length - lo);
  const score = par + creatureMoves / 6 - 1.5 * idle - 1.5 * extra;
  return { par, moves: main.moves.join(''), score, explored: main.explored, searched, idle, creatureMoves, def };
}

// --from=chN: start each restart from one of that chapter's shipped levels, shaken up a little, and only
// keep a result that differs from it in at least 6 tiles
const FROM = opt('from', null);
const seeds = FROM ? (await import(`../src/levels/${FROM}.js`)).default.map((d) => ({ def: d, lv: fromDef(d) })) : [];
const differs = (a, b) => {
  if (a.grid.length !== b.grid.length || a.grid[0].length !== b.grid[0].length) return 99;
  const da = toDef(a).map;
  const db = toDef(b).map;
  let n = 0;
  for (let y = 0; y < da.length; y++) for (let x = 0; x < da[0].length; x++) if (da[y][x] !== db[y][x]) n++;
  return n;
};

const results = [];
const t0 = Date.now();
for (let r = 0; r < RESTARTS; r++) {
  const seedLevel = seeds.length ? pick(seeds) : null;
  let lv = seedLevel ? clone(seedLevel.lv) : randomLevel();
  if (seedLevel) for (let k = 3 + ri(10); k > 0; k--) lv = mutate(lv);
  let ev = evaluate(lv);
  for (let tries = 0; !ev && tries < 400; tries++) {
    lv = mutate(lv);
    ev = evaluate(lv);
    if (!ev && tries % 60 === 59) lv = seedLevel ? clone(seedLevel.lv) : randomLevel();
  }
  if (!ev) continue;
  let best = { lv, ev };
  for (let i = 0; i < ITERS; i++) {
    const cand = mutate(lv);
    const ce = evaluate(cand);
    if (!ce) continue;
    if (ce.score >= ev.score - (rand() < 0.05 ? 1.5 : 0)) {
      lv = cand;
      ev = ce;
      if (ev.score > best.ev.score && ev.par <= parMax) best = { lv, ev };
    }
    if (ev.par > parMax + 6) {
      lv = best.lv;
      ev = best.ev;
    }
  }
  // polish: take away whatever the puzzle does not need (creatures, puddles, buds, open floor), as long as
  // the level stays valid and its par does not drop
  {
    let { lv: plv, ev: pev } = best;
    let changed = true;
    while (changed) {
      changed = false;
      const tries = [];
      plv.things.forEach((t, i) => { if (t.ch !== 'W') tries.push((l) => { l.things.splice(i, 1); }); });
      for (const [x, y] of inner(plv)) {
        const ter = plv.grid[y][x];
        if (ter === '#') continue;
        if (plv.things.some((t) => t.x === x && t.y === y)) continue;
        tries.push((l) => { l.grid[y][x] = '#'; });
        if (ter !== '.') tries.push((l) => { l.grid[y][x] = '.'; });
      }
      for (const f of tries) {
        const cand = clone(plv);
        f(cand);
        const ce = evaluate(cand);
        if (ce && ce.par >= pev.par && ce.idle <= pev.idle) {
          plv = cand;
          pev = ce;
          changed = true;
          break;
        }
      }
    }
    best = { lv: plv, ev: pev };
  }
  const e = best.ev;
  if (seedLevel && seeds.some((sd) => differs(best.lv, sd.lv) < 6)) {
    process.stderr.write(`restart ${r}: too close to a shipped level\n`);
  } else if (e.par >= parMin && e.par <= parMax) {
    results.push({ from: seedLevel ? seedLevel.def.id : null, par: e.par, score: +e.score.toFixed(2), idle: e.idle, creatureMoves: e.creatureMoves, explored: e.explored, searched: e.searched, moves: e.moves, map: e.def.map, under: e.def.under });
    process.stderr.write(`restart ${r}: par ${e.par} score ${e.score.toFixed(1)} idle ${e.idle} (${Math.round((Date.now() - t0) / 1000)}s)\n`);
    // written as it goes, so a long run that is stopped early still leaves its results
    if (out) fs.writeFileSync(out, JSON.stringify([...results].sort((a, b) => b.score - a.score), null, 1));
  } else {
    process.stderr.write(`restart ${r}: best par ${e.par} out of range\n`);
  }
}
results.sort((a, b) => b.score - a.score);
if (out) fs.writeFileSync(out, JSON.stringify(results, null, 1));
for (const r of results.slice(0, Number(opt('top', 8)))) {
  console.log(`par ${r.par} score ${r.score} idle ${r.idle} cm ${r.creatureMoves} explored ${r.explored} ${r.moves}`);
  for (const row of r.map) console.log('   ' + row);
  if (r.under) console.log('   under ' + JSON.stringify(r.under));
}
