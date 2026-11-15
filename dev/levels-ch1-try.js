// Scratch: try a chapter 1 candidate.
//   node dev/levels-ch1-try.js <name> [--replay] [--moves NESW..]     a candidate from dev/levels-ch1-cands.js
//   node dev/levels-ch1-try.js --all                                  one summary line per candidate
//   node dev/levels-ch1-try.js --ch1 [--replay]                       the levels in src/levels/ch1.js
//   echo "rows" | node dev/levels-ch1-try.js --stdin ML [--replay]    a map from stdin, feature as next arg
import fs from 'node:fs';
import { analyse, replay, parseLevel, render } from './levels-ch1-lib.js';

const args = process.argv.slice(2);
const doReplay = args.includes('--replay');
const movesAt = args.indexOf('--moves');
const moves = movesAt >= 0 ? args[movesAt + 1] : null;

async function cands() {
  return (await import('./levels-ch1-cands.js')).default;
}

function show(name, def) {
  console.log(`=== ${name}`);
  for (const r of def.map) console.log('   ' + r);
  if (moves) {
    const end = replay(def, moves.split(''));
    console.log(end ? `after ${moves.length} moves: solved=${end.solved}` : 'illegal');
    return;
  }
  analyse(def, { doReplay });
}

if (args[0] === '--stdin') {
  const map = fs.readFileSync(0, 'utf8').split('\n').map((s) => s.trimEnd()).filter((s) => s.length);
  show('stdin', { id: 'x', feature: args[1] || 'M', map });
} else if (args[0] === '--all') {
  const c = await cands();
  for (const [name, def] of Object.entries(c)) {
    let o;
    try { o = analyse(def, { verbose: false }); } catch (e) { console.log(`${name.padEnd(14)} ERROR ${e.message}`); continue; }
    console.log(`${name.padEnd(14)} ${def.map[0].length}x${def.map.length} ${def.feature.padEnd(3)} ok=${o.ok ? 'Y' : 'n'} len=${String(o.shortest).padStart(2)} full=${String(o.full).padStart(6)} win=${(100 * o.winShare).toFixed(0).padStart(3)}% dead@${o.firstDead} noL=${o.noL} ${o.moves} ${o.problems.join(' | ')}`);
  }
} else if (args[0] === '--ch1') {
  const levels = (await import('../src/levels/ch1.js')).default;
  for (const def of levels) show(`${def.id} ${def.name} (par ${def.par})`, def);
} else {
  const c = await cands();
  const def = c[args[0]];
  if (!def) { console.error(`no candidate '${args[0]}'. Have: ${Object.keys(c).join(', ')}`); process.exit(1); }
  show(args[0], def);
}
