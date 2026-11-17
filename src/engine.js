// Glimmerdeep rules engine. Pure: no DOM, no timers, no randomness. SPEC.md sections 1 to 7 are the
// source of truth; section numbers in the comments below refer to that file.
//
// States are plain JSON-safe objects and are never mutated. A new state shares everything that did not
// change with the state it came from (tiles, buds, and usually creatures, bridges, gates and the light map).

export const ACTIONS = ['N', 'E', 'S', 'W', 'L', 'Z'];
export const DIRS = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

const MAX_W = 9;
const MAX_H = 11;
const RADIUS_CARRIED = 1;   // lightMap() caches on the assumption that these two radii
const RADIUS_PLANTED = 2;   // are at most 1 and 2; see the comment there before changing them
const CHANNELS = 'ABC';

// Terrain codes. Roots are ROOT + channel (5..7), gates are GATE + channel (8..10).
const WALL = 0;
const FLOOR = 1;
const PUDDLE = 2;
const BUD = 3;
const HUSH = 4;
const ROOT = 5;
const GATE = 8;

const TERRAIN_CODE = { '#': WALL, '.': FLOOR, '~': PUDDLE, G: BUD, H: HUSH, a: 5, b: 6, c: 7, A: 8, B: 9, C: 10 };
const FACING = { '^': 'N', '>': 'E', v: 'S', '<': 'W' };           // Stumpcaps
const NEWT_FACING = { n: 'N', e: 'E', s: 'S', w: 'W' };            // Dozer newts
const CLOCKWISE = { N: 'E', E: 'S', S: 'W', W: 'N' };
const SPECIES_NAME = { M: 'Fluffmoth', S: 'Shellwhelk', T: 'Stumpcap', D: 'Dozer newt', K: 'Emberwick', O: 'Gloamling' };
const GLOWING = 2;   // an Emberwick's heat once it has caught (section 3)

const own = (object, k) => Object.prototype.hasOwnProperty.call(object, k);

// ---------------------------------------------------------------- per-level static data

// Everything that depends only on the terrain is worked out once per `tiles` array and kept beside the
// states, not inside them, so that states stay plain data. All states of one level share one `tiles`.
const META = new WeakMap();
let lastTiles = null;
let lastMeta = null;

function metaOf(state) {
  const tiles = state.tiles;
  if (tiles === lastTiles) return lastMeta;
  let meta = META.get(tiles);
  if (meta === undefined) {
    meta = buildMeta(tiles, state.w, state.h);
    META.set(tiles, meta);
  }
  lastTiles = tiles;
  lastMeta = meta;
  return meta;
}

function buildMeta(tiles, w, h) {
  const n = w * h;
  const terr = new Uint8Array(n);
  const roots = [[], [], []];      // tile indexes of the roots, per channel
  const present = [false, false, false];
  const buds = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = TERRAIN_CODE[tiles[y][x]];
      terr[i] = t;
      if (t === BUD) buds.push(i);
      else if (t >= GATE) present[t - GATE] = true;
      else if (t >= ROOT) { present[t - ROOT] = true; roots[t - ROOT].push(i); }
    }
  }
  const channels = [0, 1, 2].filter((c) => present[c]);
  return {
    w, h, n, terr, roots, channels, buds,
    dark: Object.freeze(new Array(n).fill(0)),   // the light map of a smothered lantern
    light: new Array(n * 17),                    // light-map cache, see lightMap()
  };
}

// ---------------------------------------------------------------- parseLevel (SPEC section 6)

export function parseLevel(levelDef) {
  const label = levelDef && levelDef.id !== undefined ? `Level ${levelDef.id}: ` : 'Level: ';
  const fail = (message) => { throw new Error(label + message); };

  const map = levelDef ? levelDef.map : undefined;
  if (!Array.isArray(map) || map.length === 0) fail('map must be a non-empty array of strings');
  const h = map.length;
  for (let y = 0; y < h; y++) {
    if (typeof map[y] !== 'string') fail(`map row ${y} is not a string`);
  }
  const w = map[0].length;
  if (w === 0) fail('map rows must not be empty');
  for (let y = 0; y < h; y++) {
    if (map[y].length !== w) fail(`map row ${y} is ${map[y].length} wide, row 0 is ${w} wide`);
  }
  if (w > MAX_W) fail(`map is ${w} columns wide, the most is ${MAX_W}`);
  if (h > MAX_H) fail(`map is ${h} rows tall, the most is ${MAX_H}`);

  const under = levelDef.under === undefined || levelDef.under === null ? {} : levelDef.under;
  if (typeof under !== 'object') fail('under must be an object like { "3,4": "a" }');
  for (const k of Object.keys(under)) {
    const m = /^(\d+),(\d+)$/.exec(k);
    if (!m || k !== `${+m[1]},${+m[2]}`) fail(`under key '${k}' is not 'x,y'`);
    if (+m[1] >= w || +m[2] >= h) fail(`under key '${k}' is outside the map`);
    if (typeof under[k] !== 'string' || !own(TERRAIN_CODE, under[k])) {
      fail(`under['${k}'] is '${under[k]}', which is not a terrain character`);
    }
    if (own(TERRAIN_CODE, map[+m[2]][+m[1]])) {
      fail(`under['${k}'] has nothing standing on it: the map shows terrain '${map[+m[2]][+m[1]]}' there`);
    }
  }

  const tiles = [];
  const creatures = [];
  const buds = [];
  const counters = { M: 0, S: 0, T: 0, D: 0, K: 0, O: 0 };
  let wren = null;
  let planted = null;
  let wrens = 0;
  let lanterns = 0;
  const standing = [];   // [what, x, y, terrain] for the start-position check below

  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < w; x++) {
      const ch = map[y][x];
      if (own(TERRAIN_CODE, ch)) {
        row += ch;
        if (ch === 'G') buds.push({ x, y });
        continue;
      }
      const base = own(under, `${x},${y}`) ? under[`${x},${y}`] : '.';
      row += base;
      if (ch === 'W') {
        wrens++;
        wren = { x, y };
        standing.push(['Wren', x, y, base]);
      } else if (ch === 'L') {
        lanterns++;
        planted = { x, y, carried: false };
        standing.push(['lantern', x, y, base]);
      } else if (ch === 'M' || ch === 'S' || ch === 'K' || ch === 'O' || own(FACING, ch) || own(NEWT_FACING, ch)) {
        const type = own(FACING, ch) ? 'T' : own(NEWT_FACING, ch) ? 'D' : ch;
        const dir = type === 'T' ? FACING[ch] : type === 'D' ? NEWT_FACING[ch] : null;
        const id = `${type}${++counters[type]}`;
        creatures.push(type === 'K' ? { id, type, x, y, dir, heat: 0 } : { id, type, x, y, dir });
        standing.push([SPECIES_NAME[type], x, y, base]);
      } else {
        fail(`unknown map character '${ch}' at ${x},${y}`);
      }
    }
    tiles.push(row);
  }
  if (wrens !== 1) fail(`the map needs exactly one Wren ('W'), found ${wrens}`);
  if (lanterns > 1) fail(`the map may have at most one planted lantern ('L'), found ${lanterns}`);

  // Nothing may start where the terrain table (section 1) and the planting rule (section 2) say it can never be.
  for (const [what, x, y, base] of standing) {
    const t = TERRAIN_CODE[base];
    let ok = t === FLOOR || (t >= ROOT && t < GATE);
    if (what === 'Wren') ok = ok || t >= GATE || (t === HUSH && planted === null);
    else if (what !== 'lantern') ok = ok || t >= GATE;
    if (!ok) {
      const why = what === 'Wren' && t === HUSH ? ' without the lantern in hand' : '';
      fail(`${what === 'lantern' ? 'the planted lantern' : what} cannot start on '${base}' at ${x},${y}${why}`);
    }
  }

  const state = {
    w,
    h,
    tiles,
    wren,
    lantern: planted || { x: wren.x, y: wren.y, carried: true },
    creatures,
    bridges: [],
    lit: null,
    gates: {},
    buds,
    bloom: null,
    turn: 0,
    solved: false,
    events: [],
  };
  // Phases 4 to 6 run once for the initial state (section 2): a bud lit at the start is already in bloom.
  const meta = metaOf(state);
  state.lit = lightOf(meta, state.lantern, creatures);
  for (const c of meta.channels) state.gates[CHANNELS[c]] = channelOpen(meta, c, creatures, state.lit);
  state.bloom = meta.buds.map((b) => state.lit[b]);
  state.solved = allInBloom(state.bloom);
  return state;
}

// ---------------------------------------------------------------- light (SPEC section 4)

// The whole light map: the lantern's, plus a radius-1 cross around every glowing Emberwick, minus every
// tile a Gloamling shadows. Embers and Gloamlings are rare, so the lantern's cached map is returned as it is
// when there are none.
function lightOf(meta, lantern, creatures) {
  const shade = shadowOf(meta, creatures);
  let base;
  if (shade === null) {
    base = lightMap(meta, lantern, creatures);
  } else {
    const p = lantern.y * meta.w + lantern.x;
    const radius = lantern.carried ? RADIUS_CARRIED : RADIUS_PLANTED;
    if (shade[p] === 1 || (lantern.carried && meta.terr[p] === HUSH)) base = meta.dark;
    else if (!shadeNear(meta, shade, p, radius)) base = lightMap(meta, lantern, creatures);
    else base = Object.freeze(flood(meta, p, radius, creatures, shade));
  }
  let out = base;
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (c === null || c.type !== 'K' || c.heat !== GLOWING) continue;
    if (shade !== null && shade[c.y * meta.w + c.x] === 1) continue;   // a shadowed source lights nothing
    if (out === base) out = base.slice();
    glow(meta, out, c.x, c.y);
  }
  if (shade !== null) {
    for (let t = 0; t < meta.n; t++) {
      if (shade[t] === 1 && out[t] === 1) {
        if (out === base) out = base.slice();
        out[t] = 0;
      }
    }
  }
  return out === base ? base : Object.freeze(out);
}

// The tiles the Gloamlings shadow (their own and the four neighbours), or null when there are none.
function shadowOf(meta, creatures) {
  let shade = null;
  const { w, h } = meta;
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (c === null || c.type !== 'O') continue;
    if (shade === null) shade = new Uint8Array(meta.n);
    const p = c.y * w + c.x;
    shade[p] = 1;
    if (c.y > 0) shade[p - w] = 1;
    if (c.x + 1 < w) shade[p + 1] = 1;
    if (c.y + 1 < h) shade[p + w] = 1;
    if (c.x > 0) shade[p - 1] = 1;
  }
  return shade;
}

// Whether any shadowed tile lies within `radius` 4-neighbour steps of p (the only ones a flood can touch).
function shadeNear(meta, shade, p, radius) {
  const w = meta.w;
  const px = p % w;
  const py = (p - px) / w;
  for (let t = 0; t < meta.n; t++) {
    if (shade[t] !== 1) continue;
    const x = t % w;
    if (Math.abs(x - px) + Math.abs((t - x) / w - py) <= radius) return true;
  }
  return false;
}

// A source of radius 1 lights its own tile and its four neighbours (Hush excepted), whatever stands there.
function glow(meta, lit, x, y) {
  const { w, h, terr } = meta;
  const p = y * w + x;
  lit[p] = 1;
  if (y > 0 && terr[p - w] !== HUSH) lit[p - w] = 1;
  if (x + 1 < w && terr[p + 1] !== HUSH) lit[p + 1] = 1;
  if (y + 1 < h && terr[p + w] !== HUSH) lit[p + w] = 1;
  if (x > 0 && terr[p - 1] !== HUSH) lit[p - 1] = 1;
}

// The light map for a lantern position and a set of creatures: an array of 0/1, index y*w+x.
//
// Maps are cached per level and shared between states (they are frozen). With a radius of at most 2 the
// only tiles that pass light on are the lantern's own and its four neighbours, so the map depends only on
// the lantern tile, whether it is carried, and (when planted) which of the four neighbours hold a creature.
function lightMap(meta, lantern, creatures) {
  const w = meta.w;
  const p = lantern.y * w + lantern.x;
  let slot;
  if (lantern.carried) {
    if (meta.terr[p] === HUSH) return meta.dark;   // smothered
    slot = p;
  } else {
    let mask = 0;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c === null) continue;
      const dx = c.x - lantern.x;
      const dy = c.y - lantern.y;
      if (dy === 0) {
        if (dx === 1) mask |= 1; else if (dx === -1) mask |= 2;
      } else if (dx === 0) {
        if (dy === 1) mask |= 4; else if (dy === -1) mask |= 8;
      }
    }
    slot = meta.n + p * 16 + mask;
  }
  let lit = meta.light[slot];
  if (lit === undefined) {
    lit = Object.freeze(flood(meta, p, lantern.carried ? RADIUS_CARRIED : RADIUS_PLANTED, creatures));
    meta.light[slot] = lit;
  }
  return lit;
}

// Literal flood of section 4: light spreads from p one 4-neighbour step at a time, up to `radius` steps.
// A lit tile passes light on only if it is p or it is transparent; Hush is never lit. Shadowed tiles
// (`shade`, optional) do not pass light on; lightOf() takes them out of the result.
function flood(meta, p, radius, creatures, shade) {
  const { w, h, n, terr } = meta;
  const lit = new Array(n).fill(0);
  lit[p] = 1;
  const opaque = new Uint8Array(n);
  for (let i = 0; i < n; i++) opaque[i] = terr[i] === WALL || terr[i] === HUSH || (shade && shade[i] === 1) ? 1 : 0;
  for (const c of creatures) if (c !== null) opaque[c.y * w + c.x] = 1;

  let frontier = [p];
  for (let d = 0; d < radius; d++) {
    const next = [];
    const reach = (t) => {
      if (lit[t] === 0 && terr[t] !== HUSH) { lit[t] = 1; next.push(t); }
    };
    for (const q of frontier) {
      if (q !== p && opaque[q] === 1) continue;
      const x = q % w;
      const y = (q - x) / w;
      if (y > 0) reach(q - w);
      if (x + 1 < w) reach(q + 1);
      if (y + 1 < h) reach(q + w);
      if (x > 0) reach(q - 1);
    }
    frontier = next;
  }
  return lit;
}

// ---------------------------------------------------------------- roots, gates, goal (SPEC section 2, phases 5 and 6)

// A channel is open iff it has at least one root and every root carries a Stumpcap, a Dozer newt or a lit
// Shellwhelk.
function channelOpen(meta, channel, creatures, lit) {
  const roots = meta.roots[channel];
  if (roots.length === 0) return false;
  const w = meta.w;
  for (let r = 0; r < roots.length; r++) {
    const root = roots[r];
    let pressed = false;
    for (let i = 0; i < creatures.length; i++) {
      const c = creatures[i];
      if (c.y * w + c.x === root) {
        pressed = c.type === 'T' || c.type === 'D' || (c.type === 'S' && lit[root] === 1);
        break;
      }
    }
    if (!pressed) return false;
  }
  return true;
}

// Solved iff there is at least one Glowbud and every one is in bloom.
function allInBloom(bloom) {
  if (bloom.length === 0) return false;
  for (let i = 0; i < bloom.length; i++) if (bloom[i] !== 1) return false;
  return true;
}

// ---------------------------------------------------------------- queries

export function isLit(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return false;
  return state.lit[y * state.w + x] === 1;
}

export function terrainAt(state, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return '#';
  const ch = state.tiles[y][x];
  return ch === '~' && hasBridge(state, x, y) ? 'bridge' : ch;
}

export function creatureAt(state, x, y) {
  const index = creatureIndexAt(state.creatures, x, y);
  return index < 0 ? null : state.creatures[index];
}

export function canEnter(state, who, x, y) {
  return enterable(metaOf(state), state, who, x, y);
}

export function isGateOpen(state, channel) {
  return state.gates[channel] === true;
}

export function isHidden(state, creature) {
  return creature.type === 'S' && isLit(state, creature.x, creature.y);
}

// A Stumpcap is awake in the light; a Dozer newt is awake (wandering) in the dark and dozes in the light.
export function isAwake(state, creature) {
  if (creature.type === 'T') return isLit(state, creature.x, creature.y);
  if (creature.type === 'D') return !isLit(state, creature.x, creature.y);
  return false;
}

function hasBridge(state, x, y) {
  return state.bridges.length !== 0 && state.bridges.includes(`${x},${y}`);
}

// Index of the creature on a tile, or -1. Tolerates the null holes step() leaves while a turn is in progress.
function creatureIndexAt(creatures, x, y) {
  for (let i = 0; i < creatures.length; i++) {
    const c = creatures[i];
    if (c !== null && c.x === x && c.y === y) return i;
  }
  return -1;
}

// The one terrain-and-occupancy check behind canEnter() and every move in step() (sections 1 to 3).
// Gates are read from `state.gates`, which during a turn still holds the state stored at the end of the
// previous turn.
function enterable(meta, state, who, x, y) {
  if (x < 0 || y < 0 || x >= state.w || y >= state.h) return false;
  const t = meta.terr[y * state.w + x];
  const isWren = who === 'wren';
  if (t !== FLOOR) {
    if (t === WALL || t === BUD) return false;
    if (t === PUDDLE) {
      if (who !== 'M' && !hasBridge(state, x, y)) return false;
    } else if (t === HUSH) {
      if (!isWren || !state.lantern.carried) return false;
    } else if (t >= GATE && state.gates[CHANNELS[t - GATE]] !== true) {
      return false;
    }
  }
  if (creatureIndexAt(state.creatures, x, y) >= 0) return false;
  if (isWren) return true;
  if (state.wren.x === x && state.wren.y === y) return false;
  const lantern = state.lantern;
  return lantern.carried || lantern.x !== x || lantern.y !== y;
}

// ---------------------------------------------------------------- step (SPEC section 2)

const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);

// Creature indexes in reading order of their positions (top row first, left to right). The result is a
// scratch array that is overwritten by the next call; step() is the only caller and is not re-entrant.
const ORDER = [];
function readingOrder(creatures, w) {
  const n = creatures.length;
  for (let k = 0; k < n; k++) {
    const c = creatures[k];
    const pos = c.y * w + c.x;
    let j = k - 1;
    while (j >= 0) {
      const o = creatures[ORDER[j]];
      if (o.y * w + o.x <= pos) break;
      ORDER[j + 1] = ORDER[j];
      j--;
    }
    ORDER[j + 1] = k;
  }
  return ORDER;
}

export function step(state, action) {
  if (state.solved) return null;
  const meta = metaOf(state);
  const w = meta.w;
  const terr = meta.terr;
  const wren0 = state.wren;
  const lantern0 = state.lantern;
  let wren = wren0;
  let lantern = lantern0;
  let events;   // always starts as a one-element literal: most turns produce exactly one event

  // Phase 1: the player.
  switch (action) {
    case 'Z':
      events = [{ type: 'wait' }];
      break;
    case 'L': {
      const x = wren0.x;
      const y = wren0.y;
      if (lantern0.carried) {
        const t = terr[y * w + x];
        const plantable = t === FLOOR || (t >= ROOT && t < GATE) || (t === PUDDLE && hasBridge(state, x, y));
        if (!plantable) return null;
        lantern = { x, y, carried: false };
        events = [{ type: 'plant', x, y }];
      } else {
        if (lantern0.x !== x || lantern0.y !== y) return null;
        lantern = { x, y, carried: true };
        events = [{ type: 'pickup', x, y }];
      }
      break;
    }
    case 'N':
    case 'E':
    case 'S':
    case 'W': {
      const d = DIRS[action];
      const x = wren0.x + d[0];
      const y = wren0.y + d[1];
      if (!enterable(meta, state, 'wren', x, y)) return null;
      wren = { x, y };
      if (lantern0.carried) lantern = { x, y, carried: true };
      events = [{ type: 'move', who: 'wren', from: { x: wren0.x, y: wren0.y }, to: { x, y } }];
      break;
    }
    default:
      return null;
  }

  // The state under construction. Until phase 5 its `gates` are the ones stored at the end of the previous
  // turn, which is what governs movement during this turn. It is ours alone until it is returned.
  const next = {
    w: state.w,
    h: state.h,
    tiles: state.tiles,
    wren,
    lantern,
    creatures: state.creatures,
    bridges: state.bridges,
    lit: state.lit,
    gates: state.gates,
    buds: state.buds,
    bloom: state.bloom,
    turn: state.turn + 1,
    solved: false,
    events,
  };

  const before = state.creatures;
  const count = before.length;
  let after = before;    // becomes a private copy as soon as a creature moves
  let settled = false;
  let order = null;

  if (count > 0) {
    // Phase 2: Light A, with the new Wren and lantern positions and the creatures where they stood.
    const lightA = lightOf(meta, lantern, before);
    const smothered = lantern.carried && terr[lantern.y * w + lantern.x] === HUSH;

    // Phase 3: every creature acts once, in reading order of its position at the start of the phase.
    order = readingOrder(before, w);
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const c = before[i];
      const type = c.type;
      let x = c.x;
      let y = c.y;
      let dir = c.dir;
      if (type === 'D') {
        if (lightA[y * w + x] === 1) continue;                    // dozing (smothered counts as dark)
        const d = DIRS[dir];
        if (enterable(meta, next, 'D', x + d[0], y + d[1])) {
          x += d[0];
          y += d[1];
        } else {
          dir = CLOCKWISE[dir];                                    // blocked: stay and turn right
          if (after === before) {
            after = before.slice();
            next.creatures = after;
          }
          after[i] = { id: c.id, type, x, y, dir };
          events.push({ type: 'turn', id: c.id, dir });
          continue;
        }
      } else if (type === 'T') {
        if (lightA[y * w + x] !== 1) continue;                    // asleep
        const d = DIRS[c.dir];
        x += d[0];
        y += d[1];
        if (!enterable(meta, next, 'T', x, y)) {
          events.push({ type: 'bump', id: c.id });
          continue;
        }
      } else if (type === 'K' && c.heat !== GLOWING) {
        const heat = lightA[y * w + x] === 1 ? c.heat + 1 : 0;   // two lit turns in a row and it catches
        if (heat === c.heat) continue;
        if (after === before) {
          after = before.slice();
          next.creatures = after;
        }
        after[i] = { id: c.id, type, x, y, dir, heat };
        events.push({ type: heat === GLOWING ? 'ignite' : heat === 1 ? 'warm' : 'cool', id: c.id });
        continue;
      } else if (type === 'K') {                                   // glowing: follows Wren, not the lantern
        const hx = sign(wren.x - x);
        const vy = sign(wren.y - y);
        if (hx !== 0 && enterable(meta, next, type, x + hx, y)) x += hx;
        else if (vy !== 0 && enterable(meta, next, type, x, y + vy)) y += vy;
        else continue;
      } else {
        if (smothered) continue;
        let hx;
        let vy;
        if (type === 'M' || type === 'O') {                        // toward the lantern
          hx = sign(lantern.x - x);
          vy = sign(lantern.y - y);
        } else {
          if (lightA[y * w + x] === 1) continue;                   // a lit whelk hides
          hx = sign(x - lantern.x);                                // away from the lantern
          vy = sign(y - lantern.y);
        }
        // The greedy step: horizontal first, else vertical, else stay.
        if (hx !== 0 && enterable(meta, next, type, x + hx, y)) x += hx;
        else if (vy !== 0 && enterable(meta, next, type, x, y + vy)) y += vy;
        else continue;
      }
      if (after === before) {
        after = before.slice();
        next.creatures = after;
      }
      events.push({ type: 'move', who: c.id, from: { x: c.x, y: c.y }, to: { x, y } });
      if (type === 'M' && terr[y * w + x] === PUDDLE && !hasBridge(next, x, y)) {
        after[i] = null;   // settled; the hole is removed after the phase
        settled = true;
        next.bridges = next.bridges.concat(`${x},${y}`).sort();
        events.push({ type: 'settle', id: c.id, x, y });
      } else {
        after[i] = type === 'K' ? { id: c.id, type, x, y, dir, heat: c.heat } : { id: c.id, type, x, y, dir };
      }
    }
  }

  // Phase 4: Light B, the light stored in the state.
  const lit0 = state.lit;
  const lit = lightOf(meta, lantern, after);
  next.lit = lit;
  if (count > 0) {
    for (let k = 0; k < count; k++) {
      const i = order[k];
      const c0 = before[i];
      if (c0.type === 'M' || c0.type === 'K' || c0.type === 'O') continue;
      const c1 = after[i];
      const was = lit0[c0.y * w + c0.x] === 1;
      const now = lit[c1.y * w + c1.x] === 1;
      if (was !== now) {
        let type;
        if (c0.type === 'S') type = now ? 'hide' : 'emerge';
        else if (c0.type === 'D') type = now ? 'sleep' : 'wake';   // a newt dozes off in the light
        else type = now ? 'wake' : 'sleep';
        events.push({ type, id: c0.id });
      }
    }
    if (settled) {
      after = after.filter((c) => c !== null);
      next.creatures = after;
    }
  }

  // Phase 5: roots and gates.
  const channels = meta.channels;
  let gates = state.gates;
  for (let k = 0; k < channels.length; k++) {
    const name = CHANNELS[channels[k]];
    const open = channelOpen(meta, channels[k], after, lit);
    if (gates[name] !== open) {
      if (gates === state.gates) gates = { ...gates };
      gates[name] = open;
      events.push({ type: 'gate', channel: name, open });
    }
  }
  next.gates = gates;

  // Phase 6: the goal. Every bud lit in Light B comes into bloom and stays so; `bloom` is parallel to
  // `buds`, both in reading order. The level was not solved before, so only a new bloom can solve it.
  const buds = meta.buds;
  let bloom = state.bloom;
  for (let k = 0; k < buds.length; k++) {
    const b = buds[k];
    if (lit[b] === 1 && bloom[k] !== 1) {
      if (bloom === state.bloom) bloom = bloom.slice();
      bloom[k] = 1;
      events.push({ type: 'bud', x: b % w, y: (b - (b % w)) / w, lit: true });
    }
  }
  if (bloom !== state.bloom) {
    next.bloom = bloom;
    if (allInBloom(bloom)) {
      next.solved = true;
      events.push({ type: 'solved' });
    }
  }
  return next;   // phase 7: `turn` was already counted up above
}

// ---------------------------------------------------------------- key (SPEC section 7)

// One-character strings for the small numbers a key is made of (all below 99 * 16).
const CHAR = Array.from({ length: 1600 }, (_, i) => String.fromCharCode(48 + i));
// Creature and bridge kinds in a key code: moth, whelk, Stumpcap by facing, newt by facing, bridge.
const KIND = { M: 0, S: 1, TN: 2, TE: 3, TS: 4, TW: 5, DN: 6, DE: 7, DS: 8, DW: 9, K0: 10, K1: 11, K2: 12, O: 13 };
const BRIDGE_KIND = 15;
const CODES = [];   // scratch for key()

// Identifies a position: Wren, the lantern (tile and carried), the bloom flags, every creature (species,
// tile, facing) and every bridge. Light, gates and `solved` follow from those, so they are not part of it;
// `turn`, `events` and creature ids are deliberately left out. Two characters, one more per nine buds, and
// one per creature and per bridge.
export function key(state) {
  const w = state.w;
  const lantern = state.lantern;
  let k = CHAR[state.wren.y * w + state.wren.x] + CHAR[(lantern.y * w + lantern.x) * 2 + (lantern.carried ? 1 : 0)];
  // The bloom flags, nine to a character. A level has a fixed number of buds, so this part has a fixed
  // length and cannot be confused with the creature and bridge codes that follow it.
  const bloom = state.bloom;
  for (let i = 0; i < bloom.length; i += 9) {
    let bits = 0;
    for (let j = i; j < i + 9 && j < bloom.length; j++) if (bloom[j] === 1) bits |= 1 << (j - i);
    k += CHAR[bits];
  }
  const creatures = state.creatures;
  const bridges = state.bridges;
  const n = creatures.length + bridges.length;
  if (n === 0) return k;

  // One code per creature and per bridge: tile index * 16 + kind. The codes are sorted, which makes the
  // key independent of the order of the creatures array.
  for (let i = 0; i < n; i++) {
    let code;
    if (i < creatures.length) {
      const c = creatures[i];
      const kind = c.type === 'M' || c.type === 'S' || c.type === 'O' ? KIND[c.type] : c.type === 'K' ? KIND[`K${c.heat}`] : KIND[c.type + c.dir];
      code = (c.y * w + c.x) * 16 + kind;
    } else {
      const b = bridges[i - creatures.length];
      const comma = b.indexOf(',');
      code = (+b.slice(comma + 1) * w + +b.slice(0, comma)) * 16 + BRIDGE_KIND;
    }
    let j = i - 1;
    while (j >= 0 && CODES[j] > code) {
      CODES[j + 1] = CODES[j];
      j--;
    }
    CODES[j + 1] = code;
  }
  for (let i = 0; i < n; i++) k += CHAR[CODES[i]];
  return k;
}
