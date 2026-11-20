// Grows the Night Garden (SPEC section 20) from dev/levels-gen.js results.
//
//   node dev/night-grow.mjs gen-a.json gen-b.json ... [--size=30] [--names=names.json] [--dry]
//
// Keeps the deep puzzles already in src/levels/night.js and appends new ones until there are --size. A result
// may join when, trimmed of spare wall, it needs its crystal walls and at least two kinds of creature, wastes at
// most two moves (a deep puzzle may ask Wren to wait for a creature), solves at exactly a par from 22 to 40 (the
// level check, size limit included), differs from every chapter level and deep puzzle in at least 6 tiles, and
// its critter has a nook (SPEC section 23). Results are taken in turn from each input file, best score first, no
// set of needed creatures takes more than five places, and the new puzzles are ordered by par. Each gets a
// designer's note written from its shortest solution. --names gives each one's name and tip, as
// [{ "name": "...", "tip": "..." }, ...] in the order --dry prints them; without it --dry only lists them.
// Run `node tools/place-critters.mjs` afterwards to write their critters.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel, step } from '../src/engine.js';
import { checkLevel, solve, lightRoute } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const inputs = args.filter((a) => !a.startsWith('--'));
const SIZE = Number(opt('size', 30));
const DRY = args.includes('--dry');
const NAMES = opt('names', null) ? JSON.parse(fs.readFileSync(opt('names'), 'utf8')) : null;

const SPECIES = { M: 'M', S: 'S', '^': 'T', '>': 'T', v: 'T', '<': 'T', n: 'D', e: 'D', s: 'D', w: 'D', K: 'K', O: 'O', '/': 'R', '\\': 'R' };
const ORDER = 'MSTDKOR*LAH';
const NAME = { M: 'moth', S: 'whelk', T: 'Stumpcap', D: 'newt', K: 'Emberwick', O: 'Gloamling', R: 'Mirrorbeetle' };
const wallRow = (row) => /^#+$/.test(row);
const differ = (a, b) => {
  if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
  let n = 0;
  for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
  return n;
};

// trims rows and columns of spare wall (two walls deep), moving `under` with the map
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
    under = Object.keys(moved).length ? moved : undefined;
  }
  return { map, under };
}

function hasNook(def) {
  const s = parseLevel(def);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (def.map[y][x] !== '.' || s.lit[y * s.w + x]) continue;
      const route = lightRoute(s, x, y);
      if (Array.isArray(route) && route.length) return true;
    }
  }
  return false;
}

// A designer's note from the shortest solution: what happens on which move.
function noteFor(def) {
  let s = parseLevel(def);
  const { moves } = solve(s);
  const bits = [];
  const plants = [];
  moves.forEach((m, i) => {
    const next = step(s, m);
    const n = i + 1;
    for (const e of next.events) {
      if (e.type === 'plant') plants.push(n);
      else if (e.type === 'settle') bits.push(`the moth settles into the puddle at (${e.x}, ${e.y}) on move ${n}`);
      else if (e.type === 'gate' && e.open) bits.push(`gate ${e.channel} opens on move ${n}`);
      else if (e.type === 'ignite') bits.push(`the Emberwick catches on move ${n}`);
      else if (e.type === 'aim' && e.dir) bits.push(`the beam is aimed ${e.dir} on move ${n}`);
      else if (e.type === 'bud') bits.push(`the bud at (${e.x}, ${e.y}) blooms on move ${n}`);
    }
    s = next;
  });
  const need = def.feature.replace(/[^MSTDKOR]/g, '').split('').map((c) => `the ${NAME[c]}`);
  const lantern = plants.length ? ` The lantern is planted on move${plants.length > 1 ? 's' : ''} ${plants.join(', ')}.` : ' The lantern stays in hand.';
  return `Shortest way, ${moves.length} moves: ${bits.join('; ')}.${lantern} Without the crystal, ${need.join(' or ')}, it cannot be solved.`;
}

// ---------------------------------------------------------------- choosing

const groups = new Map();
let read = 0;
for (const file of inputs) {
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    read++;
    if (!r || !Array.isArray(r.map) || r.idle > 2 || r.par < 22 || r.par > 40) continue;
    const { map, under } = tidy(r);
    const all = map.join('');
    const shutter = /[/\\]/.test(all);
    const present = [...new Set(all.split('').map((ch) => SPECIES[ch]).filter(Boolean))];
    if (present.length < 2) continue;
    const base = { id: 'x', name: 'x', par: r.par, map, ...(under ? { under } : {}), ...(shutter ? { shutter: true } : {}) };
    groups.set(file, groups.get(file) || []);
    groups.get(file).push({ base, present, shutter, score: r.score });
  }
}
const chosen = [];
const near = (d) => LEVELS.some((l) => differ(d, l) < 6) || NIGHT.some((l) => differ(d, l) < 6) || chosen.some((l) => differ(d, l) < 6);
const take = (c) => {
  const { base, present, shutter } = c;
  if (near(base)) return null;
  const candidates = [...present, '*', 'L', ...(shutter ? ['A'] : [])];
  const need = candidates.filter((f) => checkLevel({ ...base, feature: f }).featureOk[f]);
  if (!need.includes('*') || need.filter((f) => present.includes(f)).length < 2) return null;
  const feature = need.sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('');
  const def = { ...base, feature };
  if (!checkLevel(def).ok || !hasNook(def)) return null;
  return def;
};
for (const list of groups.values()) list.sort((a, b) => b.score - a.score);
const want = SIZE - NIGHT.length;
let progress = true;
const sets = new Map();
while (chosen.length < want && progress) {
  progress = false;
  for (const list of groups.values()) {
    if (chosen.length >= want) break;
    while (list.length) {
      const def = take(list.shift());
      if (!def) continue;
      const set = def.feature.replace(/[^MSTDKOR]/g, '');
      if ((sets.get(set) || 0) >= 5) continue;   // no set takes more than five places
      sets.set(set, (sets.get(set) || 0) + 1);
      chosen.push(def);
      progress = true;
      break;
    }
  }
}
console.log(`${read} results read, ${chosen.length} of ${want} chosen`);
if (chosen.length < want) process.exit(1);
chosen.sort((a, b) => a.par - b.par);

// ---------------------------------------------------------------- writing

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
chosen.forEach((d, i) => {
  d.id = `N-${NIGHT.length + i + 1}`;
  d.note = noteFor(d);
});
if (DRY || !NAMES) {
  chosen.forEach((d, i) => {
    console.log(`\n#${i} ${d.id} ${d.feature} par ${d.par}\n${d.map.map((r) => '   ' + r).join('\n')}${d.under ? `\n   under ${JSON.stringify(d.under)}` : ''}\n   ${d.note}`);
  });
  process.exit(0);
}
if (NAMES.length !== chosen.length) throw new Error(`${NAMES.length} names for ${chosen.length} puzzles`);
const blocks = chosen.map((d, i) => {
  const lines = ['  {', `    id: ${q(d.id)},`, `    name: ${q(NAMES[i].name)},`, `    feature: ${q(d.feature)},`, `    par: ${d.par},`];
  if (d.shutter) lines.push('    shutter: true,');
  lines.push('    map: [');
  for (const row of d.map) lines.push(`      ${q(row)},`);
  lines.push('    ],');
  if (d.under) lines.push(`    under: { ${Object.entries(d.under).map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ')} },`);
  lines.push(`    note: ${q(d.note)},`, `    tip: ${q(NAMES[i].tip)},`, '  },');
  return lines.join('\n');
});
const file = path.join(ROOT, 'src/levels/night.js');
const text = fs.readFileSync(file, 'utf8');
const end = text.indexOf('];', text.indexOf("id: 'N-1'"));
fs.writeFileSync(file, `${text.slice(0, end)}${blocks.join('\n')}\n${text.slice(end)}`);
console.log(`wrote ${chosen.length} deep puzzles`);
