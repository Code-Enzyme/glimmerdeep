// Scratch runner for chapter 3 candidates.
//   node dev/levels-ch3-try.js <file.js> [id ...] [--replay] [--moves=EESL..]
// <file.js> default-exports an array of level definitions (same format as src/levels/chN.js).
// Prints checkLevel's verdict, the shortest solution, the size of the full reachable space and
// (with --replay) every board of the solution. --moves replays a given move string instead.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyse, printReplay } from './levels-ch3-lib.js';

const args = process.argv.slice(2);
const file = args.find((a) => a.endsWith('.js'));
const ids = args.filter((a) => !a.startsWith('--') && !a.endsWith('.js'));
const doReplay = args.includes('--replay');
const movesArg = (args.find((a) => a.startsWith('--moves=')) || '').slice(8);

const mod = await import(pathToFileURL(path.resolve(file)).href);
for (const def of mod.default) {
  if (ids.length && !ids.includes(def.id)) continue;
  if (movesArg) {
    console.log(`== ${def.id} replay of ${movesArg}`);
    const final = printReplay(def, movesArg);
    console.log(`   final solved: ${final.solved}`);
  } else {
    analyse(def, { replayIt: doReplay });
  }
}
