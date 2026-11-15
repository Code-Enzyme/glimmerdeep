// Chapter 1 level-design helpers (scratch). Used by levels-ch1-try.js and the search scripts.
import { ACTIONS, parseLevel, step, key } from '../src/engine.js';
import { solve, checkLevel } from '../src/solver.js';

export { ACTIONS, parseLevel, step, key, solve, checkLevel };

// Full reachable space: BFS over step/key that does not stop at solutions (solved states are terminal).
// Returns { size, capped, states: Map key -> {state, parentKey, via, depth, solved} } when keep is true.
export function fullSpace(start, { cap = 400000, keep = false } = {}) {
  const seen = new Map();
  const k0 = key(start);
  seen.set(k0, 0);
  const queue = [start];
  const depth = [0];
  const solvedFlags = [start.solved];
  const edges = keep ? [[]] : null;   // edges[i] = list of child indexes
  let capped = false;
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    if (cur.solved) continue;
    for (const a of ACTIONS) {
      const nx = step(cur, a);
      if (nx === null) continue;
      // A solved state is one terminal node per distinct key (key has no "solved", bloom is in it).
      const k = key(nx);
      let idx = seen.get(k);
      if (idx === undefined) {
        if (seen.size >= cap) { capped = true; continue; }
        idx = queue.length;
        seen.set(k, idx);
        queue.push(nx);
        depth.push(depth[head] + 1);
        solvedFlags.push(nx.solved);
        if (keep) edges.push([]);
      }
      if (keep) edges[head].push(idx);
    }
  }
  return { size: seen.size, capped, queue, depth, solvedFlags, edges };
}

// Winnability of every reachable state (backward closure from solved states).
export function winnability(start, opts) {
  const sp = fullSpace(start, { ...opts, keep: true });
  const n = sp.queue.length;
  const rev = Array.from({ length: n }, () => []);
  for (let i = 0; i < n; i++) for (const j of sp.edges[i]) rev[j].push(i);
  const win = new Uint8Array(n);
  const stack = [];
  for (let i = 0; i < n; i++) if (sp.solvedFlags[i]) { win[i] = 1; stack.push(i); }
  while (stack.length) {
    const j = stack.pop();
    for (const i of rev[j]) if (!win[i]) { win[i] = 1; stack.push(i); }
  }
  let winCount = 0;
  let firstDead = Infinity;
  for (let i = 0; i < n; i++) {
    if (win[i]) winCount++;
    else if (sp.depth[i] < firstDead) firstDead = sp.depth[i];
  }
  return { ...sp, win, winCount, firstDead };
}

export function render(state) {
  const rows = [];
  for (let y = 0; y < state.h; y++) {
    let row = '';
    for (let x = 0; x < state.w; x++) {
      const t = state.tiles[y][x];
      const lit = state.lit[y * state.w + x] === 1;
      let ch;
      const isWren = state.wren.x === x && state.wren.y === y;
      const isLan = !state.lantern.carried && state.lantern.x === x && state.lantern.y === y;
      const cr = state.creatures.find((c) => c.x === x && c.y === y);
      if (isWren && isLan) ch = '@';
      else if (isWren) ch = state.lantern.carried ? 'W' : 'w';
      else if (isLan) ch = 'L';
      else if (cr) ch = lit ? 'M' : 'm';
      else if (t === '#') ch = lit ? '%' : '#';
      else if (t === '~') ch = state.bridges.includes(`${x},${y}`) ? '=' : '~';
      else if (t === 'G') {
        const bi = state.buds.findIndex((b) => b.x === x && b.y === y);
        ch = state.bloom[bi] ? '*' : 'G';
      } else ch = lit ? ':' : '.';
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

export function replay(def, moves, print = console.log) {
  let s = parseLevel(def);
  print(`start`);
  for (const r of render(s)) print('   ' + r);
  let i = 0;
  for (const m of moves) {
    const nx = step(s, m);
    i++;
    if (nx === null) { print(`${i}. ${m}  ILLEGAL`); return null; }
    s = nx;
    const ev = s.events.filter((e) => e.type !== 'move' || e.who !== 'wren')
      .map((e) => (e.type === 'move' ? `${e.who}:${e.from.x},${e.from.y}>${e.to.x},${e.to.y}` : e.type === 'settle' ? `settle@${e.x},${e.y}` : e.type === 'bud' ? `bud@${e.x},${e.y}` : e.type))
      .join(' ');
    print(`${i}. ${m}   ${ev}`);
    for (const r of render(s)) print('   ' + r);
  }
  return s;
}

// Count the distinct shortest solutions (paths) up to a cap, and which first moves start one.
export function shortestInfo(start, par) {
  // BFS layers with path counts.
  let layer = new Map([[key(start), { s: start, n: 1, first: new Set() }]]);
  const seen = new Set([key(start)]);
  let total = 0;
  const firsts = new Set();
  for (let d = 1; d <= par; d++) {
    const next = new Map();
    for (const { s, n, first } of layer.values()) {
      for (const a of ACTIONS) {
        const nx = step(s, a);
        if (!nx) continue;
        const f = d === 1 ? new Set([a]) : first;
        if (nx.solved) {
          if (d === par) { total += n; for (const x of f) firsts.add(x); }
          continue;
        }
        const k = key(nx);
        if (seen.has(k) && !next.has(k)) continue;
        const e = next.get(k);
        if (e) { e.n += n; for (const x of f) e.first.add(x); } else next.set(k, { s: nx, n, first: new Set(f) });
      }
    }
    for (const k of next.keys()) seen.add(k);
    layer = next;
  }
  return { count: total, firsts: [...firsts].join('') };
}

export function analyse(def, { verbose = true, doReplay = false, print = console.log } = {}) {
  const start = parseLevel(def);
  const main = solve(start);
  const d = { ...def, par: def.par ?? (main.solved ? main.moves.length : 0) };
  const chk = checkLevel(d);
  const noL = solve(start, { actions: ACTIONS.filter((a) => a !== 'L') });
  const noZ = solve(start, { actions: ACTIONS.filter((a) => a !== 'Z') });
  const win = winnability(start);
  const out = {
    ok: chk.ok, shortest: chk.shortest, moves: main.moves.join(''), explored: chk.explored, searched: chk.searched,
    featureOk: chk.featureOk, problems: chk.problems, full: win.size, capped: win.capped,
    winShare: win.winCount / win.size, firstDead: win.firstDead,
    noL: noL.solved ? noL.moves.length : (noL.exhausted ? 'unsolvable' : '?'),
    noZ: noZ.solved ? noZ.moves.length : (noZ.exhausted ? 'unsolvable' : '?'),
  };
  if (verbose) {
    print(`size ${start.w}x${start.h}  feature ${def.feature}  ok ${chk.ok}  shortest ${chk.shortest}  moves ${out.moves}`);
    print(`explored ${chk.explored}  searched ${chk.searched}  FULL ${win.size}${win.capped ? ' (CAPPED)' : ''}  winnable ${win.winCount} (${(100 * out.winShare).toFixed(0)}%)  first dead at depth ${win.firstDead}`);
    print(`necessary ${JSON.stringify(chk.featureOk)}  withoutL: ${out.noL}  withoutZ: ${out.noZ}`);
    for (const p of chk.problems) print('  PROBLEM: ' + p);
    if (main.solved) {
      const si = shortestInfo(start, main.moves.length);
      print(`shortest solutions: ${si.count} path(s), first moves ${si.firsts}`);
      // First-move fairness: which first actions keep the level winnable.
      const fm = ACTIONS.map((a) => {
        const nx = step(start, a);
        if (!nx) return `${a}:-`;
        if (nx.solved) return `${a}:win`;
        const r = solve(nx);
        return `${a}:${r.solved ? r.moves.length + 1 : 'DEAD'}`;
      });
      print(`first moves: ${fm.join('  ')}`);
    }
    if (doReplay && main.solved) replay(def, main.moves, print);
  }
  return out;
}
