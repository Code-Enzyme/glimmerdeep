// Scratch: final check of src/levels/ch2.js. `node dev/levels-ch2-final.js [id-to-replay ...]`
import levels from '../src/levels/ch2.js';
import { parseLevel, solve, checkLevel, analyse, replay, trapPaths } from './levels-ch2-lib.js';
for (const def of levels) {
  const res = checkLevel(def);
  const sol = solve(parseLevel(def));
  const an = analyse(parseLevel(def));
  console.log(`${def.id} "${def.name}" ${def.map[0].length}x${def.map.length} par ${def.par} ok ${res.ok} sol ${sol.moves.join('')} searched ${res.searched} reachable ${an.size} dead ${an.dead} traps ${trapPaths(def, 3).join(',')}`);
  if (process.argv.includes(def.id)) replay(def, sol.moves);
}
