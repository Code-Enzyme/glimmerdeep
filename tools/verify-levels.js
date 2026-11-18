// Checks every level in src/levels/index.js and the Daily Glimmer pool in src/levels/daily.js with the solver and prints one line per level:
// id, name, declared par, shortest solution found, positions explored, feature necessity, time, OK or FAIL.
// A level's tutorial (SPEC section 12) is checked too.
// Exits with status 1 if any level is not ok.
//
//   node tools/verify-levels.js                    check all levels
//   node tools/verify-levels.js --max-states N     give each search a budget of N positions (default 300000)
//   node tools/verify-levels.js --bench            also time the solver on a fixed mid-size board
import { LEVELS as CHAPTER_LEVELS } from '../src/levels/index.js';
import { DAILY } from '../src/levels/daily.js';
import { parseLevel } from '../src/engine.js';
import { checkLevel, solve } from '../src/solver.js';
import { checkTutorial } from '../src/ui/tutorial.js';

const args = process.argv.slice(2);
const opts = {};
let bench = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--bench') {
    bench = true;
  } else if (args[i] === '--max-states' && Number(args[i + 1]) > 0) {
    opts.maxStates = Number(args[++i]);
  } else {
    console.error(`unknown argument: ${args[i]}\nusage: node tools/verify-levels.js [--max-states N] [--bench]`);
    process.exit(2);
  }
}

const perSecond = (count, ms) => (ms > 0 ? Math.round((count / ms) * 1000).toLocaleString('en-US') : 'n/a');
const pad = (value, width) => String(value).padEnd(width);
const padLeft = (value, width) => String(value).padStart(width);

let failed = 0;
let searched = 0;
let totalMs = 0;
const seenIds = new Set();
const LEVELS = [...CHAPTER_LEVELS, ...DAILY];

if (LEVELS.length > 0) {
  const nameWidth = Math.max(4, ...LEVELS.map((level) => String(level && level.name).length));
  console.log(`${pad('id', 6)}${pad('name', nameWidth + 2)}${padLeft('par', 4)}${padLeft('shortest', 10)}${padLeft('explored', 10)}  ${pad('necessary', 16)}${padLeft('ms', 8)}  result`);
  for (const level of LEVELS) {
    const started = performance.now();
    const result = checkLevel(level, opts);
    const ms = performance.now() - started;
    totalMs += ms;
    searched += result.searched;

    const problems = [...result.problems, ...checkTutorial(level || {}).map((p) => `tutorial ${p}`)];
    if (seenIds.has(result.id)) problems.push(`duplicate level id '${result.id}'`);
    seenIds.add(result.id);
    const ok = result.ok && problems.length === 0;
    if (!ok) failed++;

    const necessity = Object.entries(result.featureOk).map(([f, yes]) => `${f}:${yes ? 'yes' : 'NO'}`).join(' ') || '-';
    console.log(
      pad(result.id, 6) + pad(level && level.name, nameWidth + 2) + padLeft(result.par, 4)
      + padLeft(result.shortest === null ? '-' : result.shortest, 10) + padLeft(result.explored, 10)
      + '  ' + pad(necessity, 16) + padLeft(ms.toFixed(1), 8) + '  ' + (ok ? 'OK' : 'FAIL'),
    );
    for (const problem of problems) console.log(`      - ${problem}`);
  }
}

const count = LEVELS.length;
console.log(`\n${count} level${count === 1 ? '' : 's'}: ${count - failed} OK, ${failed} FAIL`);
console.log(`searched ${searched.toLocaleString('en-US')} positions in ${totalMs.toFixed(1)} ms (${perSecond(searched, totalMs)} positions/s)`);

if (bench) {
  // A 9x7 board with a moth, a whelk, two Stumpcaps, a root and a gate and no Glowbud, so the search has
  // to walk the whole reachable space (about 427,000 positions).
  const board = parseLevel({
    id: 'bench',
    map: ['W....~...', '.........', '.>..a..S.', '....A....', '.M.......', '......^..', '.........'],
  });
  solve(board, { maxStates: 50000 });   // warm up the JIT
  const started = performance.now();
  const result = solve(board, { maxStates: 2000000 });
  const ms = performance.now() - started;
  console.log(`bench: ${result.explored.toLocaleString('en-US')} positions in ${ms.toFixed(0)} ms (${perSecond(result.explored, ms)} positions/s)`);
}

process.exit(failed > 0 ? 1 : 0);
