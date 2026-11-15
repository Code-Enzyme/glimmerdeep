// Scratch: show the best search results. node dev/levels-ch1-top.js <n> <file.jsonl>...
import fs from 'node:fs';
const n = Number(process.argv[2]);
const lines = process.argv.slice(3).flatMap((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []));
lines.sort((a, b) => b.score - a.score);
console.log(lines.length + ' candidates');
for (const l of lines.slice(0, n)) {
  console.log(l.map.join('\n'));
  console.log(`${l.opt} len ${l.len} naive ${l.naive} ${l.moves} L:${l.lNeeded} full ${l.full} win ${l.winShare} firstDead ${l.firstDead} waits ${l.waits} score ${l.score}\n`);
}
