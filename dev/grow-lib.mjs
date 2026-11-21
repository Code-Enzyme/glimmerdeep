// Shared by the level growers (dev/night-grow.mjs, dev/chapter-grow.mjs): tidying a dev/levels-gen.js result,
// the near-copy count, the critter nook (SPEC section 23), a designer's note from the shortest solution, and
// writing a level as source.
import { parseLevel, step } from '../src/engine.js';
import { solve, lightRoute } from '../src/solver.js';

// map character -> species letter (SPEC section 6)
export const SPECIES = { M: 'M', S: 'S', '^': 'T', '>': 'T', v: 'T', '<': 'T', n: 'D', e: 'D', s: 'D', w: 'D', K: 'K', O: 'O', '/': 'R', '\\': 'R' };
export const NAME = { M: 'moth', S: 'whelk', T: 'Stumpcap', D: 'newt', K: 'Emberwick', O: 'Gloamling', R: 'Mirrorbeetle' };

const wallRow = (row) => /^#+$/.test(row);

// How many tiles two levels differ in; Infinity when their sizes differ.
export function differ(a, b) {
  if (a.map.length !== b.map.length || a.map[0].length !== b.map[0].length) return Infinity;
  let n = 0;
  for (let y = 0; y < a.map.length; y++) for (let x = 0; x < a.map[0].length; x++) if (a.map[y][x] !== b.map[y][x]) n++;
  return n;
}

// Trims rows and columns of spare wall (two walls deep), moving `under` with the map. -> { map, under }
export function tidy(result) {
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

// A plain dark floor tile that some play lights: somewhere for the critter to hide.
export function hasNook(def) {
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

// A designer's note from the shortest solution: what happens on which move, and what the level needs.
export function noteFor(def) {
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
  const need = [
    ...(def.feature.includes('*') ? ['the crystal'] : []),
    ...def.feature.replace(/[^MSTDKOR]/g, '').split('').map((c) => `the ${NAME[c]}`),
  ];
  const lantern = plants.length ? ` The lantern is planted on move${plants.length > 1 ? 's' : ''} ${plants.join(', ')}.` : ' The lantern stays in hand.';
  const without = need.length === 1 ? need[0] : `${need.slice(0, -1).join(', ')} or ${need[need.length - 1]}`;
  return `Shortest way, ${moves.length} moves: ${bits.join('; ')}.${lantern} Without ${without}, it cannot be solved.`;
}

// A JavaScript string literal in single quotes.
export const q = (s) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// A level as the lines of an entry in a level file. extra: more `key: value` lines after the note.
export function entryLines(d, extra = []) {
  const lines = ['  {', `    id: ${q(d.id)},`, `    name: ${q(d.name)},`, `    feature: ${q(d.feature)},`, `    par: ${d.par},`];
  if (d.shutter) lines.push('    shutter: true,');
  lines.push('    map: [');
  for (const row of d.map) lines.push(`      ${q(row)},`);
  lines.push('    ],');
  if (d.under) lines.push(`    under: { ${Object.entries(d.under).map(([k, v]) => `${q(k)}: ${q(v)}`).join(', ')} },`);
  lines.push(`    note: ${q(d.note)},`, ...extra, '  },');
  return lines;
}
