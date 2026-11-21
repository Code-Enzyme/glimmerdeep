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
import { checkLevel } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { SPECIES, differ, tidy, hasNook, noteFor, entryLines, q } from './grow-lib.mjs';

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
const ORDER = 'MSTDKOR*LAH';

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
const blocks = chosen.map((d, i) => entryLines({ ...d, name: NAMES[i].name }, [`    tip: ${q(NAMES[i].tip)},`]).join('\n'));
const file = path.join(ROOT, 'src/levels/night.js');
const text = fs.readFileSync(file, 'utf8');
const end = text.indexOf('];', text.indexOf("id: 'N-1'"));
fs.writeFileSync(file, `${text.slice(0, end)}${blocks.join('\n')}\n${text.slice(end)}`);
console.log(`wrote ${chosen.length} deep puzzles`);
