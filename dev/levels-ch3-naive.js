// Scratch: after a "naive" opening, is the level still solvable? (Shows that the obvious approach fails.)
//   node dev/levels-ch3-naive.js            uses src/levels/ch3.js plus dev/levels-ch3-cand.js
import { parseLevel, step } from '../src/engine.js';
import { solve } from '../src/solver.js';
import ch3 from '../src/levels/ch3.js';
import cand from './levels-ch3-cand.js';
const byId = Object.fromEntries([...ch3, ...cand].map((l) => [l.id, l]));
const CASES = [
  ['3-1', 'ESS', 'walk straight down beside it'],
  ['3-1', 'ESWSSEN', 'cut the corner next to the root'],
  ['3-2', 'EZZZ', 'wait beside the Stumpcap'],
  ['3-2', 'SZZZZZ', 'wait at the bank in column 1'],
  ['3-3', 'S', 'wake the Stumpcap first'],
  ['3-3', 'NNZZZZ', 'correct opening (control)'],
  ['3-4', 'NNNWLZ', 'plant in the left niche'],
  ['3-4', 'NNNNLLSWZ', 'carry the lantern into the left niche afterwards'],
  ['3-4', 'NNNELZZZ', 'plant in the right niche (control: this one is fine)'],
  ['3-5', 'NZZ', 'dawdle in column 3: the moth leaves the lane'],
  ['3-5', 'WWZZEE', 'bridge, then push the lower Stumpcap first'],
  ['3-5', 'WWNNEEEL', 'bridge, then plant in the niche'],
  ['3-5', 'WWNNNEELL', 'launch the upper Stumpcap before lighting the pocket bud (control?)'],
];
for (const [id, moves, what] of CASES) {
  const def = byId[id];
  if (!def) continue;
  let s = parseLevel(def);
  let ok = true;
  for (const m of moves) { const n = step(s, m); if (!n) { ok = false; break; } s = n; }
  if (!ok) { console.log(`${id} ${moves}: illegal move`); continue; }
  const r = s.solved ? { solved: true, moves: [] } : solve(s, { maxStates: 300000 });
  console.log(`${id} after ${moves.padEnd(10)} (${what}): ${r.solved ? 'still solvable in ' + r.moves.length : 'LOST'}`);
}
