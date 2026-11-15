import { trapPaths } from './levels-ch2-lib.js';
import cands from './levels-ch2-cand.js';
for (const name of process.argv.slice(2)) console.log(name, trapPaths(cands[name], 6).join(' '));
