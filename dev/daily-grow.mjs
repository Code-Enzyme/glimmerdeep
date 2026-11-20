// Grows the Daily Glimmer pool (SPEC section 15) to a year of caverns from dev/daily-pick.mjs candidates.
//
//   node dev/daily-grow.mjs picked.json [more.json ...] [--size=365] [--dry]
//
// Keeps the caverns already in src/levels/daily.js where they are and appends new ones until the pool has
// --size caverns. A candidate may join when its par is 12 to 26, it differs from every chapter level and every
// cavern already in the pool in at least 6 tiles, and its critter has a nook (a plain dark floor tile that
// some play lights, SPEC section 23). Candidates are taken in turn from each set of needed creatures, best
// score first, so no set crowds out the others. Then the new caverns are ordered so consecutive days (and the
// last back round to the first) never feature the same creatures, and each gets a name of its own from the
// word lists below. Run `node tools/place-critters.mjs` afterwards to write their critters.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLevel } from '../src/engine.js';
import { checkLevel, lightRoute } from '../src/solver.js';
import { LEVELS } from '../src/levels/index.js';
import { NIGHT } from '../src/levels/night.js';
import { DAILY } from '../src/levels/daily.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const inputs = args.filter((a) => !a.startsWith('--'));
const SIZE = Number((args.find((a) => a.startsWith('--size=')) || '--size=365').slice(7));
const DRY = args.includes('--dry');

const creatures = (feature) => feature.replace(/[LA]/g, '').split('').sort().join('');
const differ = (a, b) => {
  if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
  let n = 0;
  for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
  return n;
};

// a plain dark floor tile that some play lights
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

// ---------------------------------------------------------------- choosing

const pool = DAILY.slice();
const chosen = [];
const groups = new Map();
for (const file of inputs) {
  for (const c of JSON.parse(fs.readFileSync(file, 'utf8'))) {
    // never the shutter (A in the feature) or a Mirrorbeetle (R, drawn / or \ on the map); gates (A on the map) are fine
    if (c.par < 12 || c.par > 26 || c.shutter || /[RA]/.test(c.feature) || c.map.some((row) => /[/\\]/.test(row))) continue;
    const set = creatures(c.feature);
    if (!set) continue;
    if (!groups.has(set)) groups.set(set, []);
    groups.get(set).push(c);
  }
}
for (const list of groups.values()) list.sort((a, b) => b.score - a.score);
const want = SIZE - pool.length;
const near = (c) => LEVELS.some((l) => differ(c, l) < 6) || pool.some((d) => differ(c, d) < 6) || chosen.some((d) => differ(c, d) < 6);
let progress = true;
while (chosen.length < want && progress) {
  progress = false;
  // the sets with the fewest caverns so far go first, so the rarer creatures get their share
  const order = [...groups.keys()].sort((a, b) => chosen.filter((d) => creatures(d.feature) === a).length - chosen.filter((d) => creatures(d.feature) === b).length || a.localeCompare(b));
  for (const set of order) {
    if (chosen.length >= want) break;
    const list = groups.get(set);
    while (list.length) {
      const c = list.shift();
      if (near(c)) continue;
      const def = { id: 'x', name: 'x', feature: c.feature, par: c.par, map: c.map, ...(c.under ? { under: c.under } : {}) };
      if (!checkLevel(def).ok || !hasNook(def)) continue;
      chosen.push(def);
      progress = true;
      break;
    }
  }
}
if (chosen.length < want) {
  console.error(`only ${chosen.length} of ${want} new caverns found; generate more candidates`);
  process.exit(1);
}

// ---------------------------------------------------------------- ordering

const first = creatures(pool[0].feature);
let prev = creatures(pool[pool.length - 1].feature);
const left = new Map();
for (const d of chosen) {
  const set = creatures(d.feature);
  if (!left.has(set)) left.set(set, []);
  left.get(set).push(d);
}
const ordered = [];
while (ordered.length < chosen.length) {
  const last = ordered.length === chosen.length - 1;
  const sets = [...left.keys()].filter((s) => left.get(s).length && s !== prev && !(last && s === first));
  if (!sets.length) {
    console.error(`no order keeps consecutive days apart (stuck after ${ordered.length})`);
    process.exit(1);
  }
  sets.sort((a, b) => left.get(b).length - left.get(a).length || a.localeCompare(b));
  const d = left.get(sets[0]).shift();
  ordered.push(d);
  prev = sets[0];
}

// ---------------------------------------------------------------- names

// A creature word (from the first creature the cavern needs) and a place. Every name is its own.
const WORD = {
  M: ['Moth', 'Flutter', 'Puddle', 'Fluff', 'Wingbeat', 'Dandelion', 'Paddle', 'Splash'],
  S: ['Shell', 'Whelk', 'Timid', 'Bashful', 'Spiral', 'Coiled', 'Shy', 'Tucked'],
  T: ['Stump', 'Marching', 'Toadstool', 'Stomping', 'Mushroom', 'Trudging', 'Plodding', 'Capped'],
  D: ['Newt', 'Drowsy', 'Sleepy', 'Dozing', 'Napping', 'Yawning', 'Snoozing', 'Restless'],
  K: ['Ember', 'Spark', 'Wick', 'Candle', 'Kindling', 'Smoulder', 'Tinder', 'Flicker'],
  O: ['Gloam', 'Shadow', 'Shade', 'Dusky', 'Murky', 'Dusk', 'Hushed', 'Inky'],
};
const PLACE = [
  'Hollow', 'Nook', 'Steps', 'Ledge', 'Crossing', 'Pass', 'Bend', 'Corner', 'Stair', 'Shelf', 'Pocket', 'Warren',
  'Run', 'Loop', 'Gallery', 'Landing', 'Alcove', 'Cellar', 'Burrow', 'Chamber', 'Grotto', 'Tunnel', 'Fork', 'Crook',
  'Niche', 'Vault', 'Well', 'Walk', 'Lane', 'Rise', 'Dip', 'Ford', 'Gap', 'Den', 'Track', 'Hall', 'Cove', 'Ridge',
];
const taken = new Set([...LEVELS, ...NIGHT, ...pool].map((d) => d.name));
let seed = 20261120;
const rand = () => {
  seed = (seed + 0x6D2B79F5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const CREATURE_ORDER = 'MSTDKO';
function nameFor(def) {
  const lead = [...creatures(def.feature)].sort((a, b) => CREATURE_ORDER.indexOf(a) - CREATURE_ORDER.indexOf(b));
  for (let tries = 0; tries < 400; tries++) {
    const c = lead[tries % lead.length];
    const words = WORD[c];
    const name = `${words[Math.floor(rand() * words.length)]} ${PLACE[Math.floor(rand() * PLACE.length)]}`;
    if (!taken.has(name) && name.length <= 20) {
      taken.add(name);
      return name;
    }
  }
  throw new Error(`no name left for ${def.feature}`);
}

// ---------------------------------------------------------------- writing

const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
const blocks = ordered.map((d, i) => {
  d.id = `D-${String(pool.length + i + 1).padStart(2, '0')}`;
  d.name = nameFor(d);
  const lines = ['  {', `    id: ${q(d.id)},`, `    name: ${q(d.name)},`, `    feature: ${q(d.feature)},`, `    par: ${d.par},`, '    map: ['];
  for (const row of d.map) lines.push(`      ${q(row)},`);
  lines.push('    ],');
  if (d.under) lines.push(`    under: { ${Object.entries(d.under).map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ')} },`);
  lines.push('  },');
  return lines.join('\n');
});
const sets = {};
for (const d of [...pool, ...ordered]) for (const c of creatures(d.feature)) sets[c] = (sets[c] || 0) + 1;
console.log(`${ordered.length} new caverns, ${pool.length + ordered.length} in all; needed per creature: ${JSON.stringify(sets)}`);
if (!DRY) {
  const file = path.join(ROOT, 'src/levels/daily.js');
  const text = fs.readFileSync(file, 'utf8');
  const end = text.lastIndexOf('];');
  fs.writeFileSync(file, `${text.slice(0, end)}${blocks.join('\n')}\n${text.slice(end)}`);
}
