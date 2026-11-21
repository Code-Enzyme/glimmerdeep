// The Workshop (SPEC section 26): your own caverns, painted tile by tile, checked with the solver and shared
// by code (src/ui/codes.js). Making, painting, sizes, what you have met, checking and the saved list live
// here. No DOM, so it can be tested in Node.
import { parseLevel } from '../engine.js';
import { solve } from '../solver.js';
import { SYMBOLS, decodeCavern } from './codes.js';
import { CHAPTERS } from '../levels/index.js';
import { PALETTE } from '../sprites.js';

export const MAX_CAVERNS = 12;
export const CHECK_STATES = 150000;
const MIN_W = 3;
const MAX_W = 9;
const MIN_H = 3;
const MAX_H = 11;

const FIRST = ['Mossy', 'Quiet', 'Dim', 'Glowing', 'Hidden', 'Drowsy', 'Damp', 'Little', 'Winding', 'Silver',
  'Amber', 'Velvet', 'Gentle', 'Deep', 'Crooked', 'Sleepy', 'Misty', 'Rooty', 'Pebbly', 'Starlit', 'Hushed',
  'Mellow', 'Tangled', 'Dripping', 'Echoing', 'Shady', 'Cosy', 'Lost', 'Narrow', 'Wide', 'Golden', 'Twinkling'];
const SECOND = ['Hollow', 'Nook', 'Grotto', 'Burrow', 'Cellar', 'Passage', 'Chamber', 'Den', 'Tunnel', 'Pool',
  'Steps', 'Hall', 'Corner', 'Crossing', 'Gallery', 'Vault', 'Hideaway', 'Landing', 'Alcove', 'Warren', 'Cleft',
  'Glade', 'Garden', 'Well', 'Bend', 'Ledge', 'Rest', 'Loop', 'Maze', 'Pocket', 'Cove', 'Archway'];

// seed 0 to 1023 -> "Mossy Hollow"
export function cavernName(seed) {
  const s = Number.isInteger(seed) ? seed & 1023 : 0;
  return `${FIRST[s >> 5]} ${SECOND[s & 31]}`;
}

export function newCavern(seed) {
  return {
    seed,
    map: ['#######', '#.....#', '#.....#', '#W...G#', '#.....#', '#.....#', '#######'],
    gloam: false,
    shutter: false,
    par: null,
    check: null,
  };
}

// The palette. `chars` are what the tool paints; painting it on its own kind turns it to the next one.
// `short` is the label under its picture when the name is long.
export const TOOLS = [
  { id: 'floor', name: 'Floor', chars: '.' },
  { id: 'wall', name: 'Wall', chars: '#' },
  { id: 'puddle', name: 'Puddle', chars: '~' },
  { id: 'bud', name: 'Glowbud', chars: 'G' },
  { id: 'wren', name: 'Wren', chars: 'W' },
  { id: 'lantern', name: 'Lantern', chars: 'L' },
  { id: 'hush', name: 'Hush', chars: 'H' },
  { id: 'root', name: 'Root', chars: 'abc' },
  { id: 'gate', name: 'Gate', chars: 'ABC' },
  { id: 'crystal', name: 'Crystal', chars: '*' },
  { id: 'moth', name: 'Fluffmoth', short: 'Moth', chars: 'M' },
  { id: 'whelk', name: 'Shellwhelk', short: 'Whelk', chars: 'S' },
  { id: 'stumpcap', name: 'Stumpcap', chars: '^>v<' },
  { id: 'newt', name: 'Dozer newt', short: 'Newt', chars: 'nesw' },
  { id: 'ember', name: 'Emberwick', short: 'Ember', chars: 'K' },
  { id: 'gloamling', name: 'Gloamling', chars: 'O' },
  { id: 'beetle', name: 'Mirrorbeetle', short: 'Beetle', chars: '/\\' },
];
const BASE = ['floor', 'wall', 'puddle', 'bud', 'wren', 'lantern'];
const ONLY_ONE = { wren: 'W', lantern: 'L' };

const changed = (cavern, map) => ({ ...cavern, map, par: null, check: null });

// Paints one tile. -> a new cavern, or null when nothing changes (outside, the same tile, or over Wren or
// the planted lantern). opts.turn false (a drag passing over) leaves a creature of the tool's own kind as it is.
export function paint(cavern, toolId, x, y, { turn: turning = true } = {}) {
  const tool = TOOLS.find((t) => t.id === toolId);
  const map = cavern.map;
  if (!tool || y < 0 || y >= map.length || x < 0 || x >= map[0].length) return null;
  const here = map[y][x];
  if (here === 'W' || here === 'L') return null;
  let ch = tool.chars[0];
  const turn = tool.chars.indexOf(here);
  if (turn >= 0) {
    if (tool.chars.length === 1 || !turning) return null;
    ch = tool.chars[(turn + 1) % tool.chars.length];
  }
  const rows = map.map((row) => row.split(''));
  const one = ONLY_ONE[tool.id];
  if (one) for (const row of rows) for (let i = 0; i < row.length; i++) if (row[i] === one) row[i] = '.';
  rows[y][x] = ch;
  return changed(cavern, rows.map((row) => row.join('')));
}

// Grows (+1) or shrinks (-1) the width or height. -> a new cavern, or null when the size would leave 3 to 9
// wide or 3 to 11 tall, or the line taken away holds Wren, a Glowbud or the planted lantern
export function resize(cavern, dw, dh) {
  let map = cavern.map;
  const w = map[0].length + dw;
  const h = map.length + dh;
  if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) return null;
  const keeps = (line) => !/[WGL]/.test(line);
  if (dw > 0) map = map.map((row) => row + '#'.repeat(dw));
  if (dw < 0) {
    if (!map.every((row) => keeps(row.slice(w)))) return null;
    map = map.map((row) => row.slice(0, w));
  }
  if (dh > 0) map = [...map, ...Array.from({ length: dh }, () => '#'.repeat(w))];
  if (dh < 0) {
    if (!map.slice(h).every(keeps)) return null;
    map = map.slice(0, h);
  }
  return changed(cavern, map);
}

// A cavern as a level definition for the engine, the solver and a session.
export function levelDef(cavern) {
  const def = { id: 'workshop', name: cavernName(cavern.seed), map: cavern.map, gloam: !!cavern.gloam, shutter: !!cavern.shutter, feature: '' };
  if (Number.isInteger(cavern.par)) def.par = cavern.par;
  return def;
}

// What stops a cavern from being played, in plain words. -> [] when it can be played
export function cavernProblems(cavern) {
  const tiles = cavern.map.join('');
  const problems = [];
  if (!tiles.includes('W')) problems.push('Put Wren in the cavern.');
  if (!tiles.includes('G')) problems.push('Add a Glowbud.');
  if (cavern.gloam && !tiles.includes('H')) problems.push('A Gloam encounter needs some Hush.');
  if (problems.length) return problems;
  let start;
  try {
    start = parseLevel(levelDef(cavern));
  } catch (e) {
    return ['Something in this cavern cannot be read.'];
  }
  if (start.solved) problems.push('It starts lit already.');
  return problems;
}

// Checks a cavern with the solver. -> { check: 'lit' | 'unlit' | 'big' | 'problem', par, text }
export function checkCavern(cavern, { maxStates = CHECK_STATES } = {}) {
  const problems = cavernProblems(cavern);
  if (problems.length) return { check: 'problem', par: null, text: problems[0] };
  const result = solve(parseLevel(levelDef(cavern)), { maxStates });
  if (result.solved) {
    const n = result.moves.length;
    return { check: 'lit', par: n, text: `Lights in ${n} move${n === 1 ? '' : 's'}. That is its par.` };
  }
  if (result.exhausted) return { check: 'unlit', par: null, text: 'Can\'t be lit: every way was tried.' };
  return { check: 'big', par: null, text: 'Too big to check: try fewer creatures or a smaller cavern.' };
}

// The tools (and the Gloam encounter and shutter options) whose things appear in a level you have lit.
// levels: every chapter, Night Garden and daily level. -> { tools: [ids in palette order], gloam, shutter }
export function metInWorkshop(save, levels, unlockAll) {
  if (unlockAll) return { tools: TOOLS.map((t) => t.id), gloam: true, shutter: true };
  const lit = (save && save.levels) || {};
  let chars = '';
  let gloam = false;
  let shutter = false;
  for (const def of levels) {
    if (!lit[def.id]) continue;
    chars += def.map.join('') + Object.values(def.under || {}).join('');
    if (def.gloam) gloam = true;
    if (def.shutter) shutter = true;
  }
  const tools = TOOLS.filter((t) => BASE.includes(t.id)
    || (t.id === 'hush' && gloam)
    || Array.from(t.chars).some((ch) => chars.includes(ch))).map((t) => t.id);
  return { tools, gloam, shutter };
}

// The Workshop opens once Mossmouth's last cavern (its Gloam encounter) is lit, or with Unlock all.
const MOSSMOUTH = CHAPTERS[0].levels;
export function workshopOpen(save, unlockAll) {
  return !!unlockAll || !!(save && save.levels && save.levels[MOSSMOUTH[MOSSMOUTH.length - 1].id]);
}

function goodMap(map) {
  if (!Array.isArray(map) || map.length < MIN_H || map.length > MAX_H) return false;
  if (typeof map[0] !== 'string') return false;
  const w = map[0].length;
  if (w < MIN_W || w > MAX_W) return false;
  return map.every((row) => typeof row === 'string' && row.length === w && Array.from(row).every((ch) => SYMBOLS.includes(ch)));
}

// The saved list, made safe: malformed caverns are dropped, the rest tidied, at most MAX_CAVERNS.
export function readWorkshop(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const c of value) {
    if (out.length >= MAX_CAVERNS) break;
    if (!c || typeof c !== 'object' || !Number.isInteger(c.seed) || c.seed < 0 || c.seed > 1023 || !goodMap(c.map)) continue;
    const check = ['lit', 'unlit', 'big'].includes(c.check) ? c.check : null;
    const par = check === 'lit' && Number.isInteger(c.par) && c.par >= 0 && c.par <= 255 ? c.par : null;
    out.push({
      seed: c.seed,
      map: c.map.slice(),
      gloam: c.gloam === true,
      shutter: c.shutter === true,
      par,
      check: check === 'lit' && par === null ? null : check,
    });
  }
  return out;
}

// A seed for a new cavern: the one r (0 to 1) picks, or the next one up that no cavern has.
export function nextSeed(caverns, r) {
  const used = new Set((caverns || []).map((c) => c.seed));
  let s = Math.min(1023, Math.max(0, Math.floor(r * 1024)));
  for (let i = 0; i < 1024 && used.has(s); i++) s = (s + 1) % 1024;
  return s;
}

// ---------------------------------------------------------------- what the editor and the list show

const TERRAIN_KIND = {
  '#': 'wall', '.': 'floor', '~': 'puddle', G: 'bud', H: 'hush',
  a: 'root', b: 'root', c: 'root', A: 'gate', B: 'gate', C: 'gate', '*': 'crystal',
};
const JOINS = ['wall', 'puddle', 'hush', 'crystal'];   // tiles drawn joined to their own kind next door
const CREATURE = {
  M: ['M', null], S: ['S', null], K: ['K', null], O: ['O', null],
  '^': ['T', 'N'], '>': ['T', 'E'], v: ['T', 'S'], '<': ['T', 'W'],
  n: ['D', 'N'], e: ['D', 'E'], s: ['D', 'S'], w: ['D', 'W'],
  '/': ['R', '/'], '\\': ['R', '\\'],
};

// A map as the editor draws it: every tile's terrain (a thing stands on floor) and the things on top.
// -> { w, h, tiles: [{ x, y, kind, channel?, neighbors? }] row by row, things: [{ x, y, who, type?, dir? }] }
export function cavernPicture(map) {
  const h = map.length;
  const w = map[0].length;
  const kindAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 'wall' : TERRAIN_KIND[map[y][x]] || 'floor');
  const tiles = [];
  const things = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      const kind = kindAt(x, y);
      const tile = { x, y, kind };
      if (kind === 'root' || kind === 'gate') tile.channel = ch;
      if (JOINS.includes(kind)) {
        const same = (dx, dy) => kindAt(x + dx, y + dy) === kind;
        tile.neighbors = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };
      }
      tiles.push(tile);
      if (ch === 'W') things.push({ x, y, who: 'wren' });
      else if (ch === 'L') things.push({ x, y, who: 'lantern' });
      else if (CREATURE[ch]) things.push({ x, y, who: 'creature', type: CREATURE[ch][0], dir: CREATURE[ch][1] });
    }
  }
  return { w, h, tiles, things };
}

const THUMB = {
  wall: PALETTE.wall, floor: PALETTE.floor, puddle: '#3D5C8C', bud: PALETTE.teal, hush: PALETTE.hush,
  gate: null, root: null, crystal: '#BCE6EE',
};
const DOT = { wren: PALETTE.cream, lantern: PALETTE.amber, creature: PALETTE.rose };

// A cavern's little picture for the Workshop list: an SVG with a square per tile and a dot per thing.
export function cavernThumb(map) {
  const { w, h, tiles, things } = cavernPicture(map);
  let out = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" aria-hidden="true" shape-rendering="crispEdges">`;
  for (const t of tiles) {
    const channel = t.channel ? PALETTE.channels[t.channel.toUpperCase()] : null;
    const fill = t.kind === 'gate' ? channel : t.kind === 'root' ? PALETTE.floor : THUMB[t.kind];
    out += `<rect x="${t.x}" y="${t.y}" width="1" height="1" fill="${fill}"/>`;
    if (t.kind === 'root') out += `<rect x="${t.x + 0.3}" y="${t.y + 0.3}" width="0.4" height="0.4" fill="${channel}"/>`;
  }
  for (const t of things) out += `<circle cx="${t.x + 0.5}" cy="${t.y + 0.5}" r="0.32" fill="${DOT[t.who]}"/>`;
  return out + '</svg>';
}

// What a cavern's row in the Workshop list says.
export function cavernSummary(cavern) {
  const n = cavern.par;
  const check = cavern.check === 'lit' ? `Lights in ${n} move${n === 1 ? '' : 's'}`
    : cavern.check === 'unlit' ? 'Can\'t be lit' : cavern.check === 'big' ? 'Too big to check' : 'Not checked';
  return { name: cavernName(cavern.seed), size: `${cavern.map[0].length} by ${cavern.map.length}`, check };
}

// Share needs a check that lit it: the code carries its par.
export function canShare(cavern) {
  return !!cavern && cavern.check === 'lit' && Number.isInteger(cavern.par);
}

export const NOT_AT_PAR = 'That cavern can\'t be lit at its par.';

// A typed code -> { ok: true, def } (a level to play) or { ok: false, why }. It plays only when the solver
// lights it in exactly its par, so a code that was tampered with, or made by hand, is turned away.
export function playCode(code, { maxStates = CHECK_STATES } = {}) {
  const read = decodeCavern(code);
  if (!read.ok) return read;
  const cavern = { ...read.cavern, check: null };
  if (cavernProblems(cavern).length) return { ok: false, why: NOT_AT_PAR };
  const result = solve(parseLevel(levelDef({ ...cavern, par: null })), { maxStates });
  if (!result.solved || result.moves.length !== cavern.par) return { ok: false, why: NOT_AT_PAR };
  return { ok: true, def: { ...levelDef(cavern), id: 'shared' } };
}
