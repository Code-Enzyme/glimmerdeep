// Scratch helpers for designing chapter 2 levels. Not part of the game.
import { ACTIONS, parseLevel, step, key } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

export { parseLevel, step, key, solve, checkLevel, ACTIONS };

// The board as text: terrain, with creatures, Wren and the lantern drawn on top.
// Wren carrying 'W', Wren without the lantern 'w', planted lantern 'L' ('*' when Wren stands on it).
// Lower-case 's' is an unlit whelk, 'S' a lit (hiding) one. Lit floor is ':' instead of '.'.
export function draw(state) {
  const rows = state.tiles.map((r) => Array.from(r));
  for (let y = 0; y < state.h; y++) {
    for (let x = 0; x < state.w; x++) {
      const lit = state.lit[y * state.w + x] === 1;
      const ch = rows[y][x];
      if (ch === '.' && lit) rows[y][x] = ':';
      if (ch === '~' && state.bridges.includes(`${x},${y}`)) rows[y][x] = '=';
      if ('ABC'.includes(ch) && state.gates[ch]) rows[y][x] = '_';
    }
  }
  state.buds.forEach((b, i) => { if (state.bloom[i]) rows[b.y][b.x] = '@'; });
  for (const c of state.creatures) {
    const lit = state.lit[c.y * state.w + c.x] === 1;
    rows[c.y][c.x] = c.type === 'S' ? (lit ? 'S' : 's') : c.type === 'M' ? 'M' : c.dir[0].toLowerCase();
  }
  const l = state.lantern;
  if (!l.carried) rows[l.y][l.x] = 'L';
  const w = state.wren;
  rows[w.y][w.x] = l.carried ? 'W' : (l.x === w.x && l.y === w.y ? '*' : 'w');
  return rows.map((r) => r.join(''));
}

// The whole reachable space, not stopping at solutions. -> { size, capped }
export function reachable(start, cap = 400000) {
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    queue[head] = null;
    for (const a of ACTIONS) {
      const n = step(cur, a);
      if (n === null) continue;
      const k = key(n);
      if (seen.has(k)) continue;
      if (seen.size >= cap) return { size: seen.size, capped: true };
      seen.add(k);
      queue.push(n);
    }
  }
  return { size: seen.size, capped: false };
}

// Full analysis of the state graph: distance to solution for every reachable state.
// -> { size, dead, shortest, startDead, firstTrap, nSolutions? }
//    dead: reachable unsolved states from which no solution exists.
//    firstTrap: the smallest depth (turn) at which a dead state can be reached.
export function analyse(start, cap = 400000) {
  const ids = new Map([[key(start), 0]]);
  const states = [start];
  const depth = [0];
  const succ = [];
  const solvedFlag = [start.solved];
  for (let head = 0; head < states.length; head++) {
    const cur = states[head];
    const out = [];
    if (!cur.solved) {
      for (const a of ACTIONS) {
        const n = step(cur, a);
        if (n === null) continue;
        const k = key(n) + (n.solved ? '!' : '');
        let id = ids.get(k);
        if (id === undefined) {
          if (states.length >= cap) return { size: states.length, capped: true };
          id = states.length;
          ids.set(k, id);
          states.push(n);
          depth.push(depth[head] + 1);
          solvedFlag.push(n.solved);
        }
        out.push(id);
      }
    }
    succ.push(out);
    states[head] = head === 0 ? cur : null;
  }
  // backward BFS from solved states
  const n = succ.length;
  const pred = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const j of succ[i]) pred[j].push(i);
  const dist = new Int32Array(n).fill(-1);
  let frontier = [];
  for (let i = 0; i < n; i++) if (solvedFlag[i]) { dist[i] = 0; frontier.push(i); }
  while (frontier.length) {
    const next = [];
    for (const i of frontier) for (const p of pred[i]) if (dist[p] < 0) { dist[p] = dist[i] + 1; next.push(p); }
    frontier = next;
  }
  let dead = 0;
  let firstTrap = -1;
  for (let i = 0; i < n; i++) {
    if (dist[i] < 0) {
      dead++;
      if (firstTrap < 0 || depth[i] < firstTrap) firstTrap = depth[i];
    }
  }
  // number of distinct shortest solutions (paths), capped
  const ways = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i).filter((i) => dist[i] >= 0).sort((a, b) => dist[a] - dist[b]);
  for (const i of order) {
    if (dist[i] === 0) { ways[i] = 1; continue; }
    let s = 0;
    for (const j of succ[i]) if (dist[j] === dist[i] - 1) s += ways[j];
    ways[i] = s;
  }
  return { size: n, capped: false, dead, shortest: dist[0], firstTrap, shortestWays: ways[0] };
}

export function replay(def, moves, { show = true } = {}) {
  let s = parseLevel(def);
  const frames = [draw(s)];
  const labels = ['start'];
  for (const m of moves) {
    const n = step(s, m);
    if (n === null) { labels.push(`${m} ILLEGAL`); frames.push(draw(s)); break; }
    s = n;
    labels.push(`${s.turn}:${m}${s.solved ? ' SOLVED' : ''}`);
    frames.push(draw(s));
  }
  if (show) {
    // print frames side by side, 8 per band
    const per = 9;
    for (let i = 0; i < frames.length; i += per) {
      const band = frames.slice(i, i + per);
      const lab = labels.slice(i, i + per);
      const wdt = band[0][0].length + 2;
      console.log(lab.map((l) => l.padEnd(wdt)).join(''));
      for (let r = 0; r < band[0].length; r++) console.log(band.map((f) => f[r].padEnd(wdt)).join(''));
      console.log('');
    }
  }
  return s;
}

export function report(name, def, { boards = true, moves = null } = {}) {
  const d = { id: name, name, feature: 'S', par: 0, ...def };
  const res = checkLevel(d);
  const start = parseLevel(d);
  const sol = solve(start);
  const an = analyse(start);
  const [w, h] = [d.map[0].length, d.map.length];
  console.log(`== ${name}  ${w}x${h}  feature ${d.feature}  par ${d.par}  shortest ${res.shortest}  ok ${res.ok}`);
  console.log(`   solution: ${sol.moves.join('')}`);
  console.log(`   explored ${res.explored}, searched ${res.searched}, reachable ${an.capped ? '>' : ''}${an.size}, dead ${an.dead}, first trap at turn ${an.firstTrap}, shortest paths ${an.shortestWays}`);
  console.log(`   featureOk ${JSON.stringify(res.featureOk)}`);
  for (const p of res.problems) console.log(`   - ${p}`);
  if (boards) replay(d, moves ? Array.from(moves) : sol.moves);
  return { res, sol, an };
}

// The shortest move strings that reach a dead position (one from which no solution exists).
export function trapPaths(def, limit = 4) {
  const d = { id: 'x', name: 'x', feature: 'S', par: 0, ...def };
  const start = parseLevel(d);
  const ids = new Map([[key(start), 0]]);
  const states = [start];
  const par = [-1];
  const via = [''];
  const succ = [];
  for (let head = 0; head < states.length; head++) {
    const cur = states[head];
    const out = [];
    if (!cur.solved) {
      for (const a of ACTIONS) {
        const n = step(cur, a);
        if (n === null) continue;
        const k = key(n) + (n.solved ? '!' : '');
        let id = ids.get(k);
        if (id === undefined) { id = states.length; ids.set(k, id); states.push(n); par.push(head); via.push(a); }
        out.push(id);
      }
    }
    succ.push(out);
  }
  const n = states.length;
  const pred = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const j of succ[i]) pred[j].push(i);
  const ok = new Uint8Array(n);
  let frontier = [];
  for (let i = 0; i < n; i++) if (states[i].solved) { ok[i] = 1; frontier.push(i); }
  while (frontier.length) {
    const next = [];
    for (const i of frontier) for (const p of pred[i]) if (!ok[p]) { ok[p] = 1; next.push(p); }
    frontier = next;
  }
  const res = [];
  for (let i = 0; i < n && res.length < limit; i++) {
    if (ok[i]) continue;
    if (par[i] >= 0 && !ok[par[i]]) continue;   // only the first step into dead territory
    let s = '';
    for (let j = i; par[j] >= 0; j = par[j]) s = via[j] + s;
    res.push(s);
  }
  return res;
}
