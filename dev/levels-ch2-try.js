// Scratch: check candidate chapter 2 levels.
//   node dev/levels-ch2-try.js                 list candidates
//   node dev/levels-ch2-try.js NAME [NAME...]  full report with replay of the shortest solution
//   node dev/levels-ch2-try.js NAME --moves EESSL   replay a given move string instead
//   node dev/levels-ch2-try.js --all           one-line summary for every candidate
import { report, replay, parseLevel, checkLevel, analyse, solve } from './levels-ch2-lib.js';
import cands from './levels-ch2-cand.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log(Object.keys(cands).join('\n'));
} else if (args[0] === '--all') {
  for (const [name, def] of Object.entries(cands)) {
    const d = { id: name, name, feature: 'S', par: 0, ...def };
    try {
      const res = checkLevel(d);
      const an = analyse(parseLevel(d));
      const sol = solve(parseLevel(d));
      console.log(`${name.padEnd(14)} ${d.map[0].length}x${d.map.length} feat ${d.feature.padEnd(3)} shortest ${String(res.shortest).padStart(3)} reach ${String(an.size).padStart(6)} dead ${String(an.dead).padStart(6)} trap@${String(an.firstTrap).padStart(2)} ways ${String(an.shortestWays).padStart(4)} ${Object.entries(res.featureOk).map(([f, y]) => f + (y ? '+' : '-')).join('')} ${sol.moves.join('')}`);
    } catch (e) {
      console.log(`${name.padEnd(14)} ERROR ${e.message}`);
    }
  }
} else {
  const mi = args.indexOf('--moves');
  const moves = mi >= 0 ? args[mi + 1] : null;
  const names = args.filter((a, i) => a !== '--moves' && (mi < 0 || i !== mi + 1));
  for (const name of names) {
    if (!cands[name]) { console.log(`no candidate ${name}`); continue; }
    report(name, cands[name], { moves });
  }
}
