// Chooses the hidden Journal critter's tile for every chapter, Night Garden and Daily Glimmer level and writes it
// into the level files as `critter: [x, y]` (SPEC section 23). The same levels always give the same tiles.
//
//   node tools/place-critters.mjs            choose and write
//   node tools/place-critters.mjs --dry      only print what it would choose
//
// The rule: a tile written '.' (plain floor, nothing under it), dark at the start, that some play lights. First the
// tiles lit in some position along the solver's shortest solution before the last; among those the one with the
// most walls round it ('#' or the map's edge among its four neighbours), then the one lit in the most of those
// positions, then reading order. When none is lit along the way: the most walls, then the one lit soonest by any
// play, then reading order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { DAILY } from '../src/levels/daily.js';
import { ACTIONS, parseLevel, step, key, isLit } from '../src/engine.js';
import { solve } from '../src/solver.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const MAX_STATES = 250000;

function litTiles(state) {
  const out = [];
  for (let i = 0; i < state.lit.length; i++) if (state.lit[i]) out.push(i);
  return out;
}

// Breadth-first over every reachable position (solved ones are not expanded): the fewest actions after which each
// wanted tile is lit. -> Map(tile index -> actions)
function firstLit(start, wanted) {
  const depth = new Map();
  const note = (state, d) => {
    for (const i of wanted) if (!depth.has(i) && state.lit[i]) depth.set(i, d);
  };
  note(start, 0);
  const seen = new Set([key(start)]);
  let frontier = [start];
  for (let d = 1; frontier.length && depth.size < wanted.length && seen.size < MAX_STATES; d++) {
    const next = [];
    for (const s of frontier) {
      for (const a of ACTIONS) {
        const n = step(s, a);
        if (n === null || n.caught) continue;
        note(n, d);
        if (n.solved) continue;
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push(n);
      }
    }
    frontier = next;
  }
  return depth;
}

function walls(def, x, y) {
  let n = 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const row = def.map[y + dy];
    const ch = row === undefined ? undefined : row[x + dx];
    if (ch === undefined || ch === '#') n++;
  }
  return n;
}

export function placeCritter(def) {
  const start = parseLevel(def);
  const w = start.w;
  const candidates = [];
  def.map.forEach((row, y) => Array.from(row).forEach((ch, x) => {
    if (ch !== '.') return;
    if (def.under && def.under[`${x},${y}`] !== undefined) return;
    if (isLit(start, x, y)) return;
    candidates.push(y * w + x);
  }));
  // how many positions along the way (the start, then after each move but the last) light each tile
  const along = new Map();
  const count = (state) => { for (const i of litTiles(state)) along.set(i, (along.get(i) || 0) + 1); };
  const sol = solve(start);
  let s = start;
  count(s);
  for (const a of sol.moves.slice(0, -1)) {
    s = step(s, a);
    count(s);
  }
  const wallsAt = (i) => walls(def, i % w, Math.floor(i / w));
  const onWay = candidates.filter((i) => along.has(i));
  if (onWay.length) {
    onWay.sort((a, b) => wallsAt(b) - wallsAt(a) || along.get(b) - along.get(a) || a - b);
    const best = onWay[0];
    return { x: best % w, y: Math.floor(best / w), onWay: true, shows: along.get(best) };
  }
  const depth = firstLit(start, candidates);
  const reachable = candidates.filter((i) => depth.has(i));
  if (!reachable.length) return null;
  reachable.sort((a, b) => wallsAt(b) - wallsAt(a) || depth.get(a) - depth.get(b) || a - b);
  const best = reachable[0];
  return { x: best % w, y: Math.floor(best / w), onWay: false, shows: 0, depth: depth.get(best) };
}

function fileFor(id) {
  if (id.startsWith('N-')) return 'src/levels/night.js';
  if (id.startsWith('D-')) return 'src/levels/daily.js';
  return `src/levels/ch${id.split('-')[0]}.js`;
}

// Puts `critter: [x, y],` on the line after the level's `par:` line, or replaces the one already there.
function writeCritter(text, id, x, y) {
  const at = text.indexOf(`id: '${id}',`);
  if (at < 0) throw new Error(`level ${id} not found`);
  const nextId = text.indexOf("id: '", at + 5);
  const end = nextId < 0 ? text.length : nextId;
  const chunk = text.slice(at, end);
  const line = `critter: [${x}, ${y}],`;
  let out;
  if (/\n(\s*)critter: \[[^\]]*\],/.test(chunk)) {
    out = chunk.replace(/critter: \[[^\]]*\],/, line);
  } else {
    const m = /\n(\s*)par: \d+,[^\n]*/.exec(chunk);
    if (!m) throw new Error(`level ${id} has no par line`);
    const cut = m.index + m[0].length;
    out = chunk.slice(0, cut) + `\n${m[1]}${line}` + chunk.slice(cut);
  }
  return text.slice(0, at) + out + text.slice(end);
}

const files = new Map();
let onWay = 0;
let failed = 0;
for (const def of [...LEVELS, ...NIGHT, ...DAILY]) {
  const t0 = Date.now();
  const p = placeCritter(def);
  if (!p) {
    console.log(`${def.id.padEnd(5)} NO TILE`);
    failed++;
    continue;
  }
  if (p.onWay) onWay++;
  const where = p.onWay ? `shows in ${p.shows} positions along the way` : `off the way, lit after ${p.depth}`;
  console.log(`${def.id.padEnd(5)} [${p.x}, ${p.y}]  walls ${walls(def, p.x, p.y)}  ${where}  ${Date.now() - t0} ms`);
  const file = fileFor(def.id);
  if (!files.has(file)) files.set(file, fs.readFileSync(path.join(ROOT, file), 'utf8'));
  files.set(file, writeCritter(files.get(file), def.id, p.x, p.y));
}
console.log(`${onWay} along the way, ${failed} without a tile`);
if (!DRY) for (const [file, text] of files) fs.writeFileSync(path.join(ROOT, file), text);
process.exit(failed ? 1 : 0);
