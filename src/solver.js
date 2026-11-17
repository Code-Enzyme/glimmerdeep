// Glimmerdeep solver. Pure: breadth-first search over engine.step, nothing else. Contract in SPEC.md section 7.

import { ACTIONS, parseLevel, step, key } from './engine.js';

// Breadth-first search, so the first solution found is a shortest one. Among equally short solutions the
// one that uses earlier entries of `actions` first wins, which keeps the result deterministic.
//
// -> { solved, moves, explored, exhausted }
//    explored:  how many distinct positions were reached (never more than maxStates).
//    exhausted: true only when the whole reachable space was searched without finding a solution, which
//               proves there is none. False when a solution was found or the search stopped at maxStates.
export function solve(state, { maxStates = 300000, actions = ACTIONS } = {}) {
  if (state.solved) return { solved: true, moves: [], explored: 1, exhausted: false };

  const seen = new Set([key(state)]);
  const queue = [state];   // states still to expand, read from `head`; nothing is ever shifted off the front
  const parent = [-1];     // parent[i]: queue index of the state queue[i] was reached from
  const via = [-1];        // via[i]: index into `actions` of the move that reached queue[i]
  const actionCount = actions.length;

  for (let head = 0; head < queue.length; head++) {
    const current = queue[head];
    queue[head] = null;    // an expanded state is never needed again; the path lives in parent/via
    for (let a = 0; a < actionCount; a++) {
      const next = step(current, actions[a]);
      if (next === null) continue;
      if (next.solved) {
        const moves = [actions[a]];
        for (let i = head; parent[i] >= 0; i = parent[i]) moves.push(actions[via[i]]);
        moves.reverse();
        return { solved: true, moves, explored: seen.size, exhausted: false };
      }
      const k = key(next);
      if (seen.has(k)) continue;
      if (seen.size >= maxStates) return { solved: false, moves: [], explored: seen.size, exhausted: false };
      seen.add(k);
      queue.push(next);
      parent.push(head);
      via.push(a);
    }
  }
  return { solved: false, moves: [], explored: seen.size, exhausted: true };
}

// The first action of a shortest solution from this state, or null if the state is already solved, cannot
// be solved, or no solution was found within opts.maxStates.
export function nextMove(state, opts) {
  const result = solve(state, opts || {});
  return result.solved && result.moves.length > 0 ? result.moves[0] : null;
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// SPEC section 5: no search of a level, or of a feature-removed variant of it, may explore more positions
// than this, so that hints stay instant on a phone.
const SIZE_LIMIT = 150000;

const SPECIES = {
  M: { chars: 'M', name: 'Fluffmoth' },
  S: { chars: 'S', name: 'Shellwhelk' },
  T: { chars: '^>v<', name: 'Stumpcap' },
  D: { chars: 'nesw', name: 'Dozer newt' },
  K: { chars: 'K', name: 'Emberwick' },
  O: { chars: 'O', name: 'Gloamling' },
  R: { chars: '/\\', name: 'Mirrorbeetle' },
};
const FEATURES = 'M, S, T, D, K, O, R, L, A';

// The level with every creature of one species taken out. Whatever terrain was under a creature stays.
function withoutSpecies(levelDef, species) {
  const chars = SPECIES[species].chars;
  const under = { ...(levelDef.under || {}) };
  const map = levelDef.map.map((row, y) => Array.from(row, (ch, x) => {
    if (!chars.includes(ch)) return ch;
    const at = `${x},${y}`;
    const terrain = Object.prototype.hasOwnProperty.call(under, at) ? under[at] : '.';
    delete under[at];
    return terrain;
  }).join(''));
  return { ...levelDef, map, under };
}

// Checks one level definition (SPEC.md sections 5 and 6).
// -> { id, ok, par, shortest, explored, searched, featureOk, problems }
//    ok:        solvable, shortest === par, does not start solved, every listed feature is proven necessary,
//               and no search explored more than 150,000 positions.
//    explored:  positions reached by the search for the shortest solution.
//    searched:  positions reached by all searches together, the necessity searches included.
//    featureOk: one entry per character of `feature`; true only when the level without that feature was
//               searched exhaustively and has no solution.
//    problems:  one sentence per reason the level is not ok.
// `opts` are the solve() options and apply to every search.
export function checkLevel(levelDef, opts) {
  const options = opts || {};
  const result = {
    id: levelDef ? levelDef.id : undefined,
    ok: false,
    par: levelDef ? levelDef.par : undefined,
    shortest: null,
    explored: 0,
    searched: 0,
    featureOk: {},
    problems: [],
  };
  const problems = result.problems;

  let start;
  try {
    start = parseLevel(levelDef);
  } catch (error) {
    problems.push(`malformed: ${error.message}`);
    return result;
  }
  if (start.solved) problems.push('the level starts solved');
  const checkSize = (search, what) => {
    if (search.explored > SIZE_LIMIT) {
      problems.push(`too big: the search ${what} explored ${search.explored} positions, the limit is ${SIZE_LIMIT}`);
    }
  };

  const main = solve(start, options);
  result.explored = main.explored;
  result.searched = main.explored;
  checkSize(main, 'for the shortest solution');
  if (main.solved) {
    result.shortest = main.moves.length;
    if (result.shortest !== levelDef.par) {
      problems.push(`par is ${levelDef.par} but the shortest solution takes ${plural(result.shortest, 'move')} (${main.moves.join('')})`);
    }
  } else if (main.exhausted) {
    problems.push(`unsolvable: all ${plural(main.explored, 'reachable position')} were searched`);
  } else {
    problems.push(`no solution found within maxStates (${plural(main.explored, 'position')} searched)`);
  }

  const feature = levelDef.feature;
  if (typeof feature !== 'string' || feature.length === 0) {
    problems.push(`feature must list at least one of ${FEATURES}`);
    return result;
  }
  for (const f of new Set(feature)) {
    result.featureOk[f] = false;
    let without;   // the search with the feature taken away
    let what;
    if (f === 'L') {
      what = 'planting the lantern';
      without = solve(start, { ...options, actions: (options.actions || ACTIONS).filter((a) => a !== 'L') });
    } else if (f === 'A') {
      what = 'aiming the lantern';
      if (!start.shutter) {
        problems.push("feature 'A': the level has no shutter (shutter: true)");
        continue;
      }
      without = solve(parseLevel({ ...levelDef, shutter: false }), options);
    } else if (Object.prototype.hasOwnProperty.call(SPECIES, f)) {
      what = `any ${SPECIES[f].name}`;
      if (!start.creatures.some((c) => c.type === f)) {
        problems.push(`feature '${f}': the level has no ${SPECIES[f].name}`);
        continue;
      }
      without = solve(parseLevel(withoutSpecies(levelDef, f)), options);
    } else {
      problems.push(`feature '${f}' is not one of ${FEATURES}`);
      continue;
    }
    result.searched += without.explored;
    checkSize(without, `without ${what}`);
    if (without.solved) {
      problems.push(`feature '${f}' is not necessary: solvable in ${plural(without.moves.length, 'move')} without ${what} (${without.moves.join('')})`);
    } else if (!without.exhausted) {
      problems.push(`feature '${f}': necessity not proven, the search without ${what} stopped at maxStates (${plural(without.explored, 'position')})`);
    } else {
      result.featureOk[f] = true;
    }
  }

  result.ok = problems.length === 0;
  return result;
}
