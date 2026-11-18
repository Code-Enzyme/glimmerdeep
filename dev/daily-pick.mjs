// Sifts levels found by dev/levels-gen.js into candidates for the Daily Glimmer pool (SPEC section 15).
//
//   node dev/daily-pick.mjs out.json gen-a.json gen-b.json gen-ch7.json:shutter ...
//
// Each input is a levels-gen result file; ':shutter' marks results searched with the shutter on. Every
// result is trimmed of spare wall, a gate with no root becomes wall and a root with no gate floor, and
// then it is kept only if: it is not a copy of a shipped level or of another candidate, it wastes at most
// one move, it still solves at exactly its par, at least one species is necessary, and no species is
// necessary only by holding open a gate that starts open. Writes the survivors, with every element they
// need, to out.json, and prints a summary per species. A person still picks the pool from that list.
import fs from 'fs';
import { parseLevel } from '../src/engine.js';
import { checkLevel } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';

const [out, ...inputs] = process.argv.slice(2);
if (!out || !inputs.length) {
  console.error('usage: node dev/daily-pick.mjs out.json gen.json[:shutter] ...');
  process.exit(2);
}

const SPECIES = { M: 'M', S: 'S', '^': 'T', '>': 'T', v: 'T', '<': 'T', n: 'D', e: 'D', s: 'D', w: 'D', K: 'K', O: 'O', '/': 'R', '\\': 'R' };
const ORDER = 'MSTDKORLA';
const wallRow = (row) => /^#+$/.test(row);

function tidy(result) {
  let map = result.map.slice();
  let under = result.under ? { ...result.under } : undefined;
  let dx = 0;
  let dy = 0;
  while (map.length > 3 && wallRow(map[0]) && wallRow(map[1])) { map.shift(); dy++; }
  while (map.length > 3 && wallRow(map[map.length - 1]) && wallRow(map[map.length - 2])) map.pop();
  const col = (x) => map.map((row) => row[x]).join('');
  while (map[0].length > 3 && wallRow(col(0)) && wallRow(col(1))) { map = map.map((row) => row.slice(1)); dx++; }
  while (map[0].length > 3 && wallRow(col(map[0].length - 1)) && wallRow(col(map[0].length - 2))) map = map.map((row) => row.slice(0, -1));
  if (under) {
    const moved = {};
    for (const [k, v] of Object.entries(under)) {
      const [x, y] = k.split(',').map(Number);
      moved[`${x - dx},${y - dy}`] = v;
    }
    under = moved;
  }
  const all = map.join('') + Object.values(under || {}).join('');
  map = map.map((row) => row.split('').map((ch) => {
    if (/[ABC]/.test(ch) && !all.includes(ch.toLowerCase())) return '#';
    if (/[abc]/.test(ch) && !all.includes(ch.toUpperCase())) return '.';
    return ch;
  }).join(''));
  if (under) for (const [k, v] of Object.entries(under)) if (!all.includes(v.toUpperCase())) delete under[k];
  if (under && !Object.keys(under).length) under = undefined;
  return { map, under };
}

const key = (def) => def.map.join('|') + JSON.stringify(def.under || {});
const seen = new Set(LEVELS.map(key));
const kept = [];
let read = 0;

for (const input of inputs) {
  const [file, flag] = input.split(':');
  const shutter = flag === 'shutter';
  const results = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const result of results) {
    read++;
    if (!result || !Array.isArray(result.map) || result.idle > 1) continue;
    const { map, under } = tidy(result);
    const base = { id: 'x', name: 'x', par: result.par, map, ...(under ? { under } : {}), ...(shutter ? { shutter: true } : {}) };
    if (seen.has(key(base))) continue;
    seen.add(key(base));
    const present = [...new Set(map.join('').split('').map((ch) => SPECIES[ch]).filter(Boolean))];
    const need = [...present, 'L', ...(shutter ? ['A'] : [])].filter((f) => checkLevel({ ...base, feature: f }).featureOk[f]);
    if (!need.some((f) => present.includes(f))) continue;
    // the open-gate trick: a species that only holds open a gate that is open from the start
    const start = parseLevel(base);
    const openCh = Object.entries(start.gates).filter(([, open]) => open).map(([ch]) => ch);
    if (openCh.length) {
      const strip = (row) => row.split('').map((ch) => (/[abcABC]/.test(ch) && openCh.includes(ch.toUpperCase()) ? '.' : ch)).join('');
      const u2 = {};
      for (const [k, v] of Object.entries(under || {})) if (!openCh.includes(v.toUpperCase())) u2[k] = v;
      const variant = { ...base, map: map.map(strip), under: Object.keys(u2).length ? u2 : undefined };
      if (need.some((f) => !checkLevel({ ...variant, feature: f }).featureOk[f])) continue;
    }
    const feature = need.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('');
    const check = checkLevel({ ...base, feature });
    if (!check.ok) continue;
    kept.push({ ...base, feature, score: result.score, from: file.replace(/^.*\//, '') });
  }
}

fs.writeFileSync(out, JSON.stringify(kept, null, 1));
const bySpecies = {};
for (const def of kept) for (const f of def.feature.replace(/[LA]/g, '')) bySpecies[f] = (bySpecies[f] || 0) + 1;
console.log(`${read} results read, ${kept.length} kept -> ${out}`);
console.log('levels needing each species: ' + Object.entries(bySpecies).map(([f, n]) => `${f} ${n}`).join(', '));
