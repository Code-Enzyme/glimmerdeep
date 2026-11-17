// Chapter 3 level-design helpers (scratch tooling, not shipped).
import { ACTIONS, parseLevel, step, key } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

const FACE = { N: '^', E: '>', S: 'v', W: '<' };
const NEWT = { N: 'n', E: 'e', S: 's', W: 'w' };

// Draws a state as text. Lit floor is shown as ':' and unlit floor as '.', so the light is visible.
export function render(state) {
  const rows = [];
  for (let y = 0; y < state.h; y++) {
    let row = '';
    for (let x = 0; x < state.w; x++) {
      let ch = state.tiles[y][x];
      const lit = state.lit[y * state.w + x] === 1;
      if (ch === '~' && state.bridges.includes(`${x},${y}`)) ch = '=';
      if (ch === 'G') {
        const i = state.buds.findIndex((b) => b.x === x && b.y === y);
        ch = state.bloom[i] === 1 ? '*' : 'G';
      }
      if ('ABC'.includes(ch) && state.gates[ch]) ch = ch === 'A' ? '1' : ch === 'B' ? '2' : '3';   // open gate
      if (ch === '.' && lit) ch = ':';
      const c = state.creatures.find((k) => k.x === x && k.y === y);
      if (c) ch = c.type === 'T' ? FACE[c.dir] : c.type === 'D' ? NEWT[c.dir] : c.type;
      if (!state.lantern.carried && state.lantern.x === x && state.lantern.y === y) ch = 'L';
      if (state.wren.x === x && state.wren.y === y) {
        ch = state.lantern.carried ? 'W' : (state.lantern.x === x && state.lantern.y === y ? '@' : 'w');
      }
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

// Size of the whole reachable space (does not stop at a solution; solved positions are counted and are terminal).
export function fullSpace(start, cap = 400000, actions = ACTIONS) {
  const seen = new Set([key(start)]);
  const queue = [start];
  let solvedCount = 0;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    queue[head] = null;
    for (const a of actions) {
      const next = step(cur, a);
      if (next === null) continue;
      const k = key(next) + (next.solved ? '!' : '');
      if (seen.has(k)) continue;
      if (seen.size >= cap) return { size: seen.size, capped: true, solvedCount };
      seen.add(k);
      if (next.solved) { solvedCount++; continue; }
      queue.push(next);
    }
  }
  return { size: seen.size, capped: false, solvedCount };
}

// Replays a move string and returns the boards, side by side friendly.
export function replay(def, moves) {
  let s = parseLevel(def);
  const frames = [{ move: 'start', rows: render(s), events: [] }];
  for (const m of moves) {
    const n = step(s, m);
    if (n === null) { frames.push({ move: m + ' ILLEGAL', rows: render(s), events: [] }); break; }
    s = n;
    frames.push({ move: m, rows: render(s), events: s.events });
  }
  return { frames, final: s };
}

export function printReplay(def, moves, perLine = 8) {
  const { frames, final } = replay(def, moves);
  const h = frames[0].rows.length;
  const w = frames[0].rows[0].length;
  for (let i = 0; i < frames.length; i += perLine) {
    const chunk = frames.slice(i, i + perLine);
    console.log(chunk.map((f, j) => `${i + j}:${f.move}`.padEnd(w + 2)).join(''));
    for (let y = 0; y < h; y++) console.log(chunk.map((f) => f.rows[y].padEnd(w + 2)).join(''));
    console.log('');
  }
  return final;
}

export function analyse(def, { full = true, replayIt = false, quiet = false } = {}) {
  const def2 = { par: 0, feature: 'T', id: '?', ...def };
  const start = parseLevel(def2);
  const main = solve(start, { maxStates: 400000 });
  const out = { id: def2.id, solved: main.solved, len: main.moves.length, moves: main.moves.join(''), explored: main.explored };
  const chk = checkLevel({ ...def2, par: main.solved ? main.moves.length : def2.par }, { maxStates: 400000 });
  out.featureOk = chk.featureOk;
  out.problems = chk.problems;
  out.searched = chk.searched;
  if (full) {
    const fs = fullSpace(start);
    out.full = fs.size + (fs.capped ? '+' : '');
  }
  if (!quiet) {
    console.log(`== ${def2.id} ${def2.name || ''}  ${def2.map[0].length}x${def2.map.length}  feature ${def2.feature}`);
    for (const r of def2.map) console.log('   ' + r);
    console.log(`   solved:${out.solved} len:${out.len} moves:${out.moves} explored:${out.explored} full:${out.full}`);
    console.log(`   featureOk:${JSON.stringify(out.featureOk)} ${out.problems.length ? 'PROBLEMS: ' + out.problems.join(' | ') : 'check OK'}`);
    if (def2.par && main.solved && def2.par !== main.moves.length) console.log(`   NOTE declared par ${def2.par} != ${main.moves.length}`);
    if (replayIt && main.solved) printReplay(def2, main.moves);
  }
  return out;
}
