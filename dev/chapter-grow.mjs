// Grows each chapter to 19 caverns (SPEC section 32) from dev/levels-gen.js results.
//
//   node dev/chapter-grow.mjs r-ch1.json r-ch1-wide.json r-ch2.json ... [--names=names.json] [--dry]
//
// A result belongs to the chapter its file name names (`ch3` in r-ch3-ts.json). For each chapter of 11 it
// chooses 8 new caverns and writes them as x-11 to x-18, before the Gloam encounter, which becomes x-19. A
// result may join when, trimmed of spare wall, it wastes at most two moves (waiting for a newt is fair), solves
// at exactly a par from 16 to 36 (the level check, size limit included), needs the chapter's creature, uses only
// what the player has met by then (creatures of this chapter or an earlier one; Hush pools from chapter 5, roots
// and gates from chapter 2, the shutter in chapter 7, where each one aims it; never crystal), differs from every
// level in at least 6 tiles, and its critter has a nook (SPEC section 23). Results are taken in turn from each
// file, best score first, four with a par under 19 + the chapter's number and four at or over it, and no mix of
// needed creatures takes more than three places (the chapter's creature alone may take any). The eight are
// sorted by par and taken shortest, fifth, second, sixth, third, seventh, fourth, eighth, so a breather follows
// each harder cavern. Each gets a designer's note from its shortest solution. --names gives their names, as
// { "1": ["...", × 8], "2": [...], ... } in the order --dry prints them; without it --dry only lists them.
// Run `node tools/place-critters.mjs` afterwards to write their critters.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkLevel } from '../src/solver.js';
import { CHAPTERS, LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { DAILY } from '../src/levels/daily.js';
import { SPECIES, differ, tidy, hasNook, noteFor, entryLines } from './grow-lib.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const inputs = args.filter((a) => !a.startsWith('--'));
const DRY = args.includes('--dry');
const NAMES = opt('names', null) ? JSON.parse(fs.readFileSync(opt('names'), 'utf8')) : null;
const NEW = 8;
const SAWTOOTH = [0, 4, 1, 5, 2, 6, 3, 7];
const ORDER = 'MSTDKORLA';

// ---------------------------------------------------------------- reading

const byChapter = new Map();   // chapter id -> Map(file -> [result])
let read = 0;
for (const file of inputs) {
  const m = /ch(\d+)/.exec(path.basename(file));
  if (!m) throw new Error(`${file}: no chapter in its name`);
  const id = Number(m[1]);
  const list = [];
  for (const r of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    read++;
    if (!r || !Array.isArray(r.map) || r.idle > 2 || r.par < 16 || r.par > 36) continue;
    list.push(r);
  }
  list.sort((a, b) => b.score - a.score);
  if (!byChapter.has(id)) byChapter.set(id, new Map());
  byChapter.get(id).set(file, list);
}

// ---------------------------------------------------------------- choosing

const others = [...LEVELS, ...NIGHT, ...DAILY];
const chosenAll = [];
const near = (d) => others.some((l) => differ(d, l) < 6) || chosenAll.some((l) => differ(d, l) < 6);

function take(r, chapter, met) {
  const { map, under } = tidy(r);
  const all = map.join('') + Object.values(under || {}).join('');
  if (all.includes('*')) return null;
  if (chapter.id < 5 && all.includes('H')) return null;
  if (chapter.id < 2 && /[abcABC]/.test(all)) return null;
  const shutter = chapter.id === 7;   // the chapter 7 specs all have the shutter, and its caverns all aim it
  const present = [...new Set(all.split('').map((ch) => SPECIES[ch]).filter(Boolean))];
  if (!present.includes(chapter.species) || present.some((k) => !met.includes(k))) return null;
  const base = { id: 'x', name: 'x', par: r.par, map, ...(under ? { under } : {}), ...(shutter ? { shutter: true } : {}) };
  if (near(base)) return null;
  const candidates = [...present, 'L', ...(shutter ? ['A'] : [])];
  const featureOk = checkLevel({ ...base, feature: candidates.join('') }).featureOk || {};
  const need = candidates.filter((f) => featureOk[f]);
  if (!need.includes(chapter.species) || (shutter && !need.includes('A'))) return null;
  // the chapter's creature first, then the rest in the usual order
  const feature = [chapter.species, ...need.filter((f) => f !== chapter.species).sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))].join('');
  const def = { ...base, feature };
  if (!checkLevel(def).ok || !hasNook(def)) return null;
  return def;
}

const grown = [];   // [{ chapter, defs }]
CHAPTERS.forEach((chapter, c) => {
  if (chapter.levels.length !== 11) return;   // already grown
  const met = CHAPTERS.slice(0, c + 1).map((ch) => ch.species);
  const files = [...(byChapter.get(chapter.id) || new Map()).values()];
  const defs = [];
  const sets = new Map();
  // Up to n from the results whose par passes `fits`, in turn from each file, best score first.
  const choose = (n, fits) => {
    const want = defs.length + n;
    let progress = true;
    while (defs.length < want && progress) {
      progress = false;
      for (const list of files) {
        if (defs.length >= want) break;
        for (let i = 0; i < list.length; i++) {
          if (!fits(list[i].par)) continue;
          const def = take(list.splice(i--, 1)[0], chapter, met);
          if (!def) continue;
          const set = def.feature.replace(/[LA]/g, '');
          if (set !== chapter.species && (sets.get(set) || 0) >= 3) continue;
          sets.set(set, (sets.get(set) || 0) + 1);
          defs.push(def);
          chosenAll.push(def);
          progress = true;
          break;
        }
      }
    }
  };
  // four breathers and four harder caverns; the line between them rises a step a chapter
  const line = 19 + chapter.id;
  choose(NEW / 2, (par) => par < line);
  choose(NEW - defs.length, (par) => par >= line);
  choose(NEW - defs.length, () => true);
  console.log(`chapter ${chapter.id}: ${defs.length} of ${NEW} chosen`);
  defs.sort((a, b) => a.par - b.par);
  grown.push({ chapter, defs: defs.length === NEW ? SAWTOOTH.map((i) => defs[i]) : defs });
});
console.log(`${read} results read`);
if (!DRY && grown.some((g) => g.defs.length < NEW)) process.exit(1);   // --dry lists what there is

// ---------------------------------------------------------------- writing

for (const { chapter, defs } of grown) {
  defs.forEach((d, i) => {
    d.id = `${chapter.id}-${11 + i}`;
    d.note = noteFor(d);
  });
}
if (DRY || !NAMES) {
  for (const { chapter, defs } of grown) {
    console.log(`\n================ chapter ${chapter.id}: ${chapter.name}`);
    defs.forEach((d) => {
      console.log(`\n${d.id} ${d.feature} par ${d.par}\n${d.map.map((r) => '   ' + r).join('\n')}${d.under ? `\n   under ${JSON.stringify(d.under)}` : ''}\n   ${d.note}`);
    });
  }
  process.exit(0);
}
for (const { chapter, defs } of grown) {
  const names = NAMES[chapter.id];
  if (!Array.isArray(names) || names.length !== NEW) throw new Error(`chapter ${chapter.id}: ${names ? names.length : 0} names for ${NEW} caverns`);
  const file = path.join(ROOT, `src/levels/ch${chapter.id}.js`);
  let text = fs.readFileSync(file, 'utf8');
  const enc = `id: '${chapter.id}-11'`;
  if (text.split(enc).length !== 2) throw new Error(`${file}: no single ${enc}`);
  text = text.replace(enc, `id: '${chapter.id}-19'`);
  // the encounter's entry starts at the last '  {' before its id
  const at = text.lastIndexOf('\n  {', text.indexOf(`id: '${chapter.id}-19'`)) + 1;
  const blocks = defs.map((d, i) => entryLines({ ...d, name: names[i] }).join('\n'));
  fs.writeFileSync(file, `${text.slice(0, at)}${blocks.join('\n')}\n${text.slice(at)}`);
  console.log(`chapter ${chapter.id}: wrote ${chapter.id}-11 to ${chapter.id}-18, the encounter is ${chapter.id}-19`);
}
