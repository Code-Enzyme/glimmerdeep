// The board: one canvas, drawn every frame from the engine state plus whatever is animating.
// No game rules in here. The game hands over states and events; this module decides what is where on
// screen at a given moment and paints it with sprites.js.

import { DIRS, terrainAt } from '../engine.js';
import { drawDarkness, drawBackdrop, PALETTE } from '../sprites.js';
import { drawTile, drawWren, drawLantern, drawCreature, drawGlow } from '../chars.js';

const KIND = {
  '#': 'wall', '.': 'floor', '~': 'puddle', G: 'bud', H: 'hush',
  a: 'root', b: 'root', c: 'root', A: 'gate', B: 'gate', C: 'gate',
};
const SOUND_OF_MOVE = { M: 'moth', S: 'whelkMove', T: 'stumpStep', D: 'newtStep', K: 'emberStep', O: 'gloamDrift' };
// an Emberwick warming, going cold and catching
const SOUND_OF_HEAT = { warm: 'emberWarm', cool: 'emberCool', ignite: 'emberIgnite' };
// a creature changing state: Stumpcaps wake in the light, newts wake in the dark and doze in the light
const SOUND_OF_STATE = { wake: { T: 'stumpWake', D: 'newtWake' }, sleep: { D: 'newtDoze' } };

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (p) => 1 - (1 - p) * (1 - p) * (1 - p);
const lerp = (a, b, p) => a + (b - a) * p;
const TAU = Math.PI * 2;
const COACH = '#9CF5E3';   // a tutorial's pointer: mint, so it never reads as a hint (amber)

// The lantern's own tile is lit unless it is smothered or in a Gloamling's shadow.
function lanternLit(s) {
  return s.lit[s.lantern.y * s.w + s.lantern.x] === 1;
}

function findById(list, id) {
  for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

export class BoardView {
  // hooks: { onCue(soundName), onSettled(), onCelebrated() }
  constructor(canvas, hooks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.hooks = hooks || {};
    this.state = null;
    this.tiles = [];
    this.accent = PALETTE.teal;
    this.facing = 'S';
    this.highContrast = false;
    this.reduced = false;
    this.anim = null;
    this.celebration = null;
    this.effects = [];
    this.shake = null;
    this.hint = null;      // { dir } | { ring: true } | null
    this.path = null;      // [{ x, y }] tiles still ahead on a tap-to-walk, the last one is the target
    this.press = null;     // { x, y, t0 } while a finger rests on something that has a rule card
    this.coach = null;     // { kind: 'wren' | 'creature' | 'tile', id?, x, y, gesture } a tutorial's pointer
    this.cssW = 0;
    this.cssH = 0;
    this.dpr = 1;
    this.rect = { left: 0, top: 0 };
    this.layout = null;    // { size, ox, oy, w, h }
    this.source = { x: 0, y: 0, radius: 1 };
    this.things = [];
    this.frames = 0;
  }

  // ---------------------------------------------------------------- level and size

  setLevel(state, opts) {
    this.state = state;
    this.accent = (opts && opts.accent) || PALETTE.teal;
    this.facing = (opts && opts.facing) || 'S';
    this.anim = null;
    this.celebration = null;
    this.effects.length = 0;
    this.shake = null;
    this.hint = null;
    this.path = null;
    this.press = null;
    this.coach = null;
    this.buildTiles(state);
    this.computeLayout();
  }

  // Everything about a tile that never changes during a level is worked out once.
  buildTiles(state) {
    const { w, h } = state;
    const kindAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 'wall' : KIND[state.tiles[y][x]] || 'floor');
    const tiles = [];
    let bud = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const ch = state.tiles[y][x];
        const kind = KIND[ch] || 'floor';
        const opts = { t: 0, seed: x * 7 + y * 13 + 1 };
        if (kind === 'wall' || kind === 'puddle' || kind === 'hush') {
          const same = (dx, dy) => kindAt(x + dx, y + dy) === kind;
          opts.neighbors = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };
        }
        const tile = { x, y, ch, kind, opts, bud: -1, channel: null };
        if (kind === 'bud') {
          tile.bud = bud++;
          opts.lit = false;
          opts.accent = this.accent;
        } else if (kind === 'root') {
          tile.channel = ch.toUpperCase();
          opts.channel = ch;
          opts.pressed = false;
        } else if (kind === 'gate') {
          tile.channel = ch;
          opts.channel = ch;
          opts.open = false;
        }
        tiles.push(tile);
      }
    }
    this.tiles = tiles;
  }

  // Call when the canvas box may have changed (resize, rotation, screen shown). Reads layout once.
  resize() {
    const canvas = this.canvas;
    const box = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(box.width));
    const cssH = Math.max(1, Math.round(box.height));
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.rect = { left: box.left, top: box.top };
    if (cssW !== this.cssW || cssH !== this.cssH || dpr !== this.dpr) {
      this.cssW = cssW;
      this.cssH = cssH;
      this.dpr = dpr;
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    this.computeLayout();
  }

  // The largest whole-pixel tile that fits the grid with a margin, centred.
  computeLayout() {
    const s = this.state;
    if (!s || this.cssW < 2) {
      this.layout = null;
      return;
    }
    const margin = Math.max(8, Math.min(20, Math.round(Math.min(this.cssW, this.cssH) * 0.025)));
    let size = Math.floor(Math.min((this.cssW - margin * 2) / s.w, (this.cssH - margin * 2) / s.h));
    size = Math.max(12, Math.min(96, size));
    this.layout = {
      size,
      w: s.w,
      h: s.h,
      ox: Math.round((this.cssW - size * s.w) / 2),
      oy: Math.round((this.cssH - size * s.h) / 2),
    };
  }

  // Tile under a point in client coordinates, or null outside the grid.
  tileAt(clientX, clientY) {
    const L = this.layout;
    if (!L) return null;
    const x = Math.floor((clientX - this.rect.left - L.ox) / L.size);
    const y = Math.floor((clientY - this.rect.top - L.oy) / L.size);
    return x >= 0 && y >= 0 && x < L.w && y < L.h ? { x, y } : null;
  }

  // ---------------------------------------------------------------- animation

  get busy() {
    return this.anim !== null && !this.anim.settled;
  }

  timing() {
    return this.reduced ? { slide: 60, lag: 0, drop: 90, hold: 60 } : { slide: 150, lag: 40, drop: 210, hold: 90 };
  }

  // Shows `next` by animating its events from `prev`. opts: { now, facing, speed }
  playTurn(prev, next, opts) {
    this.begin(prev, next, next.events, opts || {}, false);
  }

  // Undo and restart: everything glides to where it was. Quiet, quick, and no creature lag.
  playTween(prev, next, opts) {
    const events = [];
    if (prev.wren.x !== next.wren.x || prev.wren.y !== next.wren.y) {
      events.push({ type: 'move', who: 'wren', from: prev.wren, to: next.wren });
    }
    for (const c of next.creatures) {
      const was = findById(prev.creatures, c.id);
      if (was && (was.x !== c.x || was.y !== c.y)) events.push({ type: 'move', who: c.id, from: was, to: c });
    }
    this.begin(prev, next, events, opts || {}, true);
  }

  begin(prev, next, events, o, tween) {
    this.dropAnim();
    this.shake = null;
    this.state = next;
    if (o.facing) this.facing = o.facing;
    const T = this.timing();
    const slide = tween ? Math.min(T.slide, 100) : T.slide;
    const lag = tween ? 0 : T.lag;
    const a = {
      t0: o.now !== undefined ? o.now : performance.now(),
      speed: o.speed || 1,
      prev,
      tween,
      slide,
      lag,
      wren: null,                 // { from, to }
      moves: new Map(),           // creature id -> { from, to }
      bumps: new Map(),           // creature id -> [dx, dy]
      turns: new Map(),           // newt id -> the facing it had before it turned
      ghosts: [],                 // moths that settle this turn: { from, to, x, y }
      bridgeAt: Infinity,         // when a settling moth's puddle turns into a bridge
      radius: null,               // { from, to } while the lantern is being planted or picked up
      budAt: new Map(),           // bud index -> time it comes into bloom
      cues: [],
      cue: 0,
      litAt: 0,
      settleAt: 0,
      endAt: 0,
      doneAt: 0,
      settled: false,
    };
    const cue = (at, sound, fx) => a.cues.push({ at, sound, fx });
    const heard = new Set();
    const once = (at, sound) => {
      if (!sound || heard.has(sound)) return;
      heard.add(sound);
      cue(at, sound);
    };
    let creatureMoved = false;
    for (const e of events) {
      if (e.type === 'move') {
        if (e.who === 'wren') {
          a.wren = { from: e.from, to: e.to };
          if (!tween) cue(0, 'step');
        } else {
          a.moves.set(e.who, { from: e.from, to: e.to });
          creatureMoved = true;
          const who = findById(prev.creatures, e.who);
          if (!tween && who) once(lag, SOUND_OF_MOVE[who.type]);
        }
      } else if (e.type === 'bump') {
        const who = findById(prev.creatures, e.id);
        if (who && who.dir) a.bumps.set(e.id, DIRS[who.dir]);
        once(lag, 'stumpBump');
      } else if (e.type === 'turn') {
        const who = findById(prev.creatures, e.id);
        if (who) a.turns.set(e.id, who.dir);
        if (!tween) once(lag, 'newtTurn');
      }
    }
    const wrenEnd = a.wren ? slide : 0;
    const creatureEnd = creatureMoved ? lag + slide : 0;
    a.settleAt = Math.max(wrenEnd, creatureEnd, a.bumps.size || a.turns.size ? lag + slide : 0);
    a.litAt = a.wren ? slide * 0.5 : 0;
    // a Gloamling's shadow fell on the lantern itself (the Hush going dark is not this)
    if (!tween && lanternLit(prev) && !lanternLit(next) && !(next.lantern.carried && terrainAt(next, next.wren.x, next.wren.y) === 'H')) {
      let drifted = false;
      for (const c of next.creatures) if (c.type === 'O' && a.moves.has(c.id)) drifted = true;
      once(drifted ? a.settleAt : a.litAt, 'gloamSnuff');
    }
    let buds = 0;
    for (const e of events) {
      switch (e.type) {
        case 'plant':
          a.radius = { from: 1, to: 2 };
          cue(0, 'plant', { type: 'ring', x: e.x, y: e.y, grow: true });
          break;
        case 'pickup':
          a.radius = { from: 2, to: 1 };
          cue(0, 'pickup', { type: 'ring', x: e.x, y: e.y, grow: false });
          break;
        case 'wait':
          cue(0, 'wait', { type: 'wait', x: next.wren.x, y: next.wren.y });
          break;
        case 'settle': {
          const mv = a.moves.get(e.id);
          a.ghosts.push({ from: mv ? mv.from : e, to: { x: e.x, y: e.y }, x: e.x, y: e.y });
          a.bridgeAt = creatureEnd + T.drop * 0.55;
          cue(creatureEnd, 'settle', { type: 'ripple', x: e.x, y: e.y });
          break;
        }
        case 'hide': once(a.settleAt, 'whelkHide'); break;
        case 'emerge': once(a.settleAt, 'whelkEmerge'); break;
        case 'wake':
        case 'sleep': {
          const who = findById(next.creatures, e.id);
          if (who) once(a.settleAt, SOUND_OF_STATE[e.type][who.type]);
          break;
        }
        case 'warm':
        case 'cool':
          if (!tween) once(a.settleAt, SOUND_OF_HEAT[e.type]);
          break;
        case 'ignite': {
          const who = findById(next.creatures, e.id);
          if (!tween) once(a.settleAt, 'emberIgnite');
          if (who) cue(a.settleAt, null, { type: 'ring', x: who.x, y: who.y, grow: true });
          break;
        }
        case 'gate': once(a.settleAt, e.open ? 'gateOpen' : 'gateClose'); break;
        case 'bud': {
          const index = next.buds.findIndex((b) => b.x === e.x && b.y === e.y);
          const at = a.settleAt + buds * 110;
          buds++;
          if (index >= 0) a.budAt.set(index, at);
          cue(at, 'budOn', { type: 'bloom', x: e.x, y: e.y });
          break;
        }
        default: break;
      }
    }
    a.cues.sort((p, q) => p.at - q.at);
    a.endAt = Math.max(a.settleAt + (a.ghosts.length ? T.drop : 0), tween ? 0 : T.hold);
    a.doneAt = Math.max(a.endAt, a.radius ? 240 : 0, a.cues.length ? a.cues[a.cues.length - 1].at : 0);
    this.anim = a;
  }

  // Lets go of the running animation. Sounds and sparkles it still owed are given at once, so a bloom
  // is never silent just because the player was quick.
  dropAnim() {
    const a = this.anim;
    if (!a) return;
    this.runCues(a, Infinity, performance.now());
    this.anim = null;
  }

  // Jump to the end of the running animation (test hooks, hidden page). Does not call onSettled.
  finish() {
    this.dropAnim();
  }

  runCues(a, tau, now) {
    while (a.cue < a.cues.length && a.cues[a.cue].at <= tau) {
      const c = a.cues[a.cue++];
      if (c.sound && this.hooks.onCue) this.hooks.onCue(c.sound);
      if (c.fx) this.addEffect(c.fx, now);
    }
  }

  addEffect(fx, now) {
    const dur = fx.type === 'bloom' ? 620 : fx.type === 'cross' ? 420 : 380;
    if (this.reduced && fx.type !== 'bloom' && fx.type !== 'cross') return;
    if (this.effects.length > 24) this.effects.shift();
    this.effects.push({ type: fx.type, x: fx.x, y: fx.y, grow: !!fx.grow, t0: now !== undefined ? now : performance.now(), dur });
  }

  // A tiny shake of Wren for a move that is not allowed. dir is 'N' | 'E' | 'S' | 'W' or null.
  nudge(dir) {
    if (this.reduced) return;
    this.shake = { d: dir ? DIRS[dir] : null, t0: performance.now(), dur: 170 };
  }

  startCelebration() {
    const s = this.state;
    if (!s) return;
    const lit = new Array(s.w * s.h);
    for (let i = 0; i < lit.length; i++) lit[i] = s.lit[i];
    const hush = [];
    for (const tile of this.tiles) hush.push(tile.kind === 'hush');
    this.celebration = {
      t0: performance.now(),
      dur: this.reduced ? 450 : 1500,
      lit,
      hush,
      cx: s.lantern.x,
      cy: s.lantern.y,
      r0: s.lantern.carried ? 1 : 2,
      shown: -1,
      told: false,
    };
  }

  endCelebration() {
    this.celebration = null;
  }

  // ---------------------------------------------------------------- drawing

  draw(now) {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const s = this.state;
    const L = this.layout;
    if (!s || !L) return;
    this.frames++;
    const t = now / 1000;
    const { size, ox, oy } = L;
    const w = s.w;

    let a = this.anim;
    let tau = 0;
    let settledNow = false;
    if (a) {
      tau = Math.max(0, (now - a.t0) * a.speed);
      this.runCues(a, tau, now);
      if (!a.settled && tau >= a.endAt) {
        a.settled = true;
        settledNow = true;
      }
      if (tau >= a.doneAt) {
        this.anim = null;
        a = null;
      }
    }

    // What is showing right now ------------------------------------------------------------
    // Wren
    let wx = s.wren.x;
    let wy = s.wren.y;
    let hop = 0;
    if (a && a.wren) {
      const raw = clamp01(tau / a.slide);
      const p = easeOut(raw);
      wx = lerp(a.wren.from.x, a.wren.to.x, p);
      wy = lerp(a.wren.from.y, a.wren.to.y, p);
      if (!this.reduced && !a.tween) hop = Math.sin(raw * Math.PI) * 0.06;
    }
    let sx = 0;
    let sy = 0;
    if (this.shake) {
      const p = (now - this.shake.t0) / this.shake.dur;
      if (p >= 1) {
        this.shake = null;
      } else if (this.shake.d) {
        const k = Math.sin(p * Math.PI) * 0.13;
        sx = this.shake.d[0] * k;
        sy = this.shake.d[1] * k;
      } else {
        sx = Math.sin(p * TAU * 2) * 0.06 * (1 - p);
      }
    }

    // Light: the engine's stored map, switched half-way through Wren's step; or the swelling light of a
    // solved level.
    const cel = this.celebration;
    const lightState = a && tau < a.litAt ? a.prev : s;
    let lit = lightState.lit;
    let source = this.source;
    const carried = lightState.lantern.carried;
    let radius = carried ? 1 : 2;
    if (a && a.radius) radius = lerp(a.radius.from, a.radius.to, easeOut(clamp01(tau / 220)));
    // the lantern lights nothing while smothered in the Hush or eaten by a Gloamling's shadow
    const smothered = !lanternLit(lightState);
    if (carried) {
      source.x = wx;
      source.y = wy;
    } else {
      source.x = lightState.lantern.x;
      source.y = lightState.lantern.y;
    }
    source.radius = radius;
    if (smothered) source = null;
    let celT = 0;
    if (cel) {
      celT = now - cel.t0;
      const reach = cel.r0 + (celT / cel.dur) * (s.w + s.h) * 1.15;
      const ring = Math.floor(reach * 2);
      if (ring !== cel.shown) {
        cel.shown = ring;
        for (let i = 0; i < cel.lit.length; i++) {
          if (cel.lit[i] || cel.hush[i]) continue;
          const dx = (i % w) - cel.cx;
          const dy = Math.floor(i / w) - cel.cy;
          if (dx * dx + dy * dy <= reach * reach) cel.lit[i] = 1;
        }
      }
      lit = cel.lit;
      source = this.source;
      source.x = cel.cx;
      source.y = cel.cy;
      source.radius = Math.min(reach, s.w + s.h);
    }

    // Creatures (and moths on their way into a puddle)
    const things = this.things;
    things.length = 0;
    for (let i = 0; i < s.creatures.length; i++) {
      const c = s.creatures[i];
      let x = c.x;
      let y = c.y;
      let moving = false;
      let dir = c.dir;
      if (a) {
        const mv = a.moves.get(c.id);
        if (mv) {
          const raw = clamp01((tau - a.lag) / a.slide);
          const p = easeOut(raw);
          x = lerp(mv.from.x, mv.to.x, p);
          y = lerp(mv.from.y, mv.to.y, p);
          moving = raw < 1;
        }
        const bump = a.bumps.get(c.id);
        if (bump && !this.reduced) {
          const k = Math.sin(clamp01((tau - a.lag) / a.slide) * Math.PI) * 0.16;
          x += bump[0] * k;
          y += bump[1] * k;
        }
        // a newt that was blocked swings round to its new facing halfway through the turn
        const was = a.turns.get(c.id);
        if (was && tau < a.lag + a.slide * 0.5) dir = was;
      }
      const cellLit = lit[Math.round(y) * w + Math.round(x)] === 1;
      things.push({
        z: 1, x, y, c, dir, alpha: 1, drop: 0,
        lit: cellLit,
        hidden: c.type === 'S' && cellLit && !moving,
        awake: c.type === 'T' ? cellLit || moving : c.type === 'D' && (!cellLit || moving),
        heat: c.heat,
      });
    }
    if (a) {
      for (let i = 0; i < a.ghosts.length; i++) {
        const g = a.ghosts[i];
        const raw = clamp01((tau - a.lag) / a.slide);
        const p = easeOut(raw);
        const q = clamp01((tau - a.lag - a.slide) / (a.endAt - a.lag - a.slide || 1));
        if (q >= 1) continue;
        things.push({
          z: 1, x: lerp(g.from.x, g.to.x, p), y: lerp(g.from.y, g.to.y, p),
          c: GHOST_MOTH, alpha: 1 - q * q, drop: q * 0.22, lit: true, hidden: false, awake: false,
        });
      }
    }
    // A planted lantern under Wren's feet would be hidden by her: the two step apart a little, lantern in front.
    let share = 0;
    if (!s.lantern.carried) {
      share = clamp01(1 - Math.hypot(wx - s.lantern.x, wy - s.lantern.y) * 1.6);
      things.push({ z: share > 0 ? 3 : 0, x: s.lantern.x, y: s.lantern.y, c: null, alpha: 1, drop: 0 });
    }
    let celebrateHop = 0;
    if (cel && !this.reduced && celT < 900) celebrateHop = Math.abs(Math.sin(celT * 0.0105)) * 0.14 * (1 - celT / 900);
    things.push({ z: 2, x: wx, y: wy, c: null, alpha: 1, drop: 0 });
    things.sort(byRow);

    // Paint -----------------------------------------------------------------------------------
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    drawBackdrop(ctx, this.cssW, this.cssH, { t, accent: this.accent });
    this.drawFrame(ctx, L);

    const gates = a && !a.tween && tau < a.settleAt ? a.prev.gates : s.gates;
    const tiles = this.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const tile = tiles[i];
      const o = tile.opts;
      o.t = t;
      let kind = tile.kind;
      if (kind === 'puddle') {
        if (terrainAt(s, tile.x, tile.y) === 'bridge' && !(a && tau < a.bridgeAt && isGhostTile(a, tile))) kind = 'bridge';
      } else if (kind === 'bud') {
        let bloom = s.bloom[tile.bud] === 1;
        if (bloom && a && !a.tween && a.prev.bloom[tile.bud] !== 1) {
          const at = a.budAt.get(tile.bud);
          bloom = at === undefined || tau >= at;
        }
        o.lit = bloom;
      } else if (kind === 'gate') {
        o.open = gates[tile.channel] === true;
      } else if (kind === 'root') {
        o.pressed = false;
        for (let k = 0; k < things.length; k++) {
          const th = things[k];
          if (th.z === 1 && th.c !== GHOST_MOTH && Math.round(th.x) === tile.x && Math.round(th.y) === tile.y) {
            o.pressed = th.c.type === 'T' || th.c.type === 'D' || (th.c.type === 'S' && th.lit);
            break;
          }
        }
      }
      drawTile(ctx, kind, ox + tile.x * size, oy + tile.y * size, size, o);
    }

    for (let i = 0; i < things.length; i++) {
      const th = things[i];
      const px = ox + th.x * size;
      const py = oy + th.y * size;
      if (th.z === 0 || th.z === 3) {
        drawLantern(ctx, px + share * 0.27 * size, py + share * 0.07 * size, size, { t, out: smothered });
      } else if (th.z === 1) {
        if (th.alpha < 1) ctx.globalAlpha = th.alpha;
        drawCreature(ctx, th.c.type, px, py + th.drop * size, size, { t, dir: th.dir, lit: th.lit, hidden: th.hidden, awake: th.awake, heat: th.heat });
        ctx.globalAlpha = 1;
      } else {
        drawWren(ctx, px + (sx - share * 0.15) * size, py + (sy - hop - celebrateHop) * size, size, {
          t, dir: this.facing, carrying: s.lantern.carried, smothered: s.lantern.carried && smothered,
        });
      }
    }

    drawDarkness(ctx, { ox, oy, size, w: s.w, h: s.h, lit, source, t, highContrast: this.highContrast });

    // Glowing markings shine through the dark, so creatures and Wren can be found in unlit tiles.
    for (let i = 0; i < things.length; i++) {
      const th = things[i];
      const px = ox + th.x * size;
      const py = oy + th.y * size;
      if (th.z === 1) {
        if (th.alpha < 1) ctx.globalAlpha = th.alpha;
        drawGlow(ctx, th.c.type, px, py + th.drop * size, size, { t, dir: th.dir, lit: th.lit, hidden: th.hidden, awake: th.awake, heat: th.heat });
        ctx.globalAlpha = 1;
      } else if (th.z === 2) {
        const tx = Math.round(th.x);
        const ty = Math.round(th.y);
        const wrenLit = tx >= 0 && ty >= 0 && tx < s.w && ty < s.h && !!lit[ty * s.w + tx];
        drawGlow(ctx, 'wren', px + (sx - share * 0.15) * size, py + (sy - hop - celebrateHop) * size, size, {
          t, dir: this.facing, carrying: s.lantern.carried, smothered: s.lantern.carried && smothered, lit: wrenLit,
        });
      }
    }

    this.drawOverlays(ctx, L, now, t, wx, wy, celT);

    // Tell the game last, so whatever it starts in answer begins on a finished frame.
    if (settledNow && this.hooks.onSettled) this.hooks.onSettled();
    if (cel && !cel.told && celT >= cel.dur * 0.72) {
      cel.told = true;
      if (this.hooks.onCelebrated) this.hooks.onCelebrated();
    }
  }

  // The tutorial pointer at (x, y) in canvas pixels. gesture: 'swipe-N' | 'swipe-E' | 'swipe-S' | 'swipe-W' |
  // 'tap' | 'hold' | null. With reduced motion everything holds still.
  drawCoach(ctx, x, y, size, line, t, gesture) {
    const still = this.reduced;
    const beat = still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 3.4);
    const r = size * (0.56 + 0.05 * beat);
    const inked = (width) => {
      ctx.lineWidth = width * 2;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.lineWidth = width;
      ctx.strokeStyle = COACH;
      ctx.stroke();
    };
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    inked(line * 1.3);
    if (!gesture) return;
    if (gesture.startsWith('swipe-') && DIRS[gesture.slice(6)]) {
      // three chevrons travelling out of the ring the way to swipe
      const d = DIRS[gesture.slice(6)];
      const phase = still ? 0 : (t * 0.8) % 1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(d[1], d[0]));
      for (let i = 0; i < 3; i++) {
        const k = (i / 3 + phase) % 1;
        ctx.globalAlpha = still ? 1 - i * 0.25 : Math.sin(k * Math.PI);
        const at = r + size * (0.12 + 0.42 * (still ? i / 3 : k));
        const u = size * 0.12;
        ctx.beginPath();
        ctx.moveTo(at - u * 0.6, -u);
        ctx.lineTo(at + u * 0.4, 0);
        ctx.lineTo(at - u * 0.6, u);
        inked(line * 1.2);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else if (gesture === 'tap') {
      // a fingertip that presses, and a ripple
      const k = still ? 0.5 : (t * 0.9) % 1;
      const press = still ? 0 : Math.max(0, Math.sin(k * TAU * 2)) * 0.02;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath();
      ctx.arc(x, y, size * (0.14 + 0.3 * k), 0, TAU);
      inked(line);
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(x + r * 0.62, y + r * 0.62, size * (0.1 - press), 0, TAU);
      ctx.lineWidth = line * 2;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.fillStyle = COACH;
      ctx.fill();
    } else if (gesture === 'hold') {
      // the long-press ring filling up, again and again
      const k = still ? 0.75 : clamp01(((t * 0.7) % 1) * 1.3);
      ctx.beginPath();
      ctx.arc(x, y, size * 0.44, -Math.PI / 2, -Math.PI / 2 + TAU * k);
      inked(line * 1.4);
      ctx.beginPath();
      ctx.arc(x + r * 0.62, y + r * 0.62, size * 0.1, 0, TAU);
      ctx.lineWidth = line * 2;
      ctx.strokeStyle = PALETTE.ink;
      ctx.stroke();
      ctx.fillStyle = COACH;
      ctx.fill();
    }
  }

  // A soft dark mat with a sketched ink line, so the grid does not end in a hard rectangle.
  drawFrame(ctx, L) {
    const { size, ox, oy, w, h } = L;
    const bw = w * size;
    const bh = h * size;
    const r = Math.max(6, size * 0.2);
    ctx.fillStyle = 'rgba(14, 9, 22, 0.2)';
    for (let i = 4; i >= 1; i--) {
      const g = i * Math.max(2, size * 0.07);
      roundRect(ctx, ox - g, oy - g + 2, bw + g * 2, bh + g * 2, r + g);
      ctx.fill();
    }
    ctx.fillStyle = PALETTE.ink;
    roundRect(ctx, ox - 3, oy - 3, bw + 6, bh + 6, r * 0.6);
    ctx.fill();
  }

  drawOverlays(ctx, L, now, t, wx, wy, celT) {
    const { size, ox, oy } = L;
    const cx = (x) => ox + (x + 0.5) * size;
    const cy = (y) => oy + (y + 0.5) * size;
    const line = Math.max(1.5, size * 0.045);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // walk path: dots to the target, a ring on it
    const path = this.path;
    if (path && path.length) {
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        const last = i === path.length - 1;
        ctx.beginPath();
        if (last) {
          ctx.arc(cx(p.x), cy(p.y), size * (0.24 + 0.02 * Math.sin(t * 6)), 0, TAU);
          ctx.lineWidth = line * 2.2;
          ctx.strokeStyle = PALETTE.ink;
          ctx.stroke();
          ctx.lineWidth = line * 1.1;
          ctx.strokeStyle = PALETTE.amber;
          ctx.stroke();
        } else {
          ctx.arc(cx(p.x), cy(p.y), size * 0.075, 0, TAU);
          ctx.fillStyle = PALETTE.amber;
          ctx.fill();
          ctx.lineWidth = line * 0.8;
          ctx.strokeStyle = PALETTE.ink;
          ctx.stroke();
        }
      }
    }

    // a tutorial's pointer: a soft ring that follows what it points at, with the gesture drawn on it
    const coach = this.coach;
    if (coach && !this.hint && !this.celebration) {
      let x = coach.x;
      let y = coach.y;
      if (coach.kind === 'wren') {
        x = wx;
        y = wy;
      } else if (coach.kind === 'creature') {
        for (const th of this.things) {
          if (th.z === 1 && th.c && th.c.id === coach.id) {
            x = th.x;
            y = th.y;
            break;
          }
        }
      }
      this.drawCoach(ctx, cx(x), cy(y), size, line, t, coach.gesture);
    }

    // hint
    const hint = this.hint;
    if (hint) {
      const beat = this.reduced ? 0.5 : 0.5 + 0.5 * Math.sin(t * 5.2);
      if (hint.dir) {
        const d = DIRS[hint.dir];
        const reach = 0.66 + 0.07 * beat;
        ctx.save();
        ctx.translate(cx(wx) + d[0] * reach * size, cy(wy) + d[1] * reach * size);
        ctx.rotate(Math.atan2(d[1], d[0]));
        const u = size;
        ctx.beginPath();
        ctx.moveTo(-0.3 * u, -0.085 * u);
        ctx.lineTo(0.02 * u, -0.085 * u);
        ctx.lineTo(0.02 * u, -0.23 * u);
        ctx.lineTo(0.31 * u, 0);
        ctx.lineTo(0.02 * u, 0.23 * u);
        ctx.lineTo(0.02 * u, 0.085 * u);
        ctx.lineTo(-0.3 * u, 0.085 * u);
        ctx.closePath();
        ctx.lineWidth = line * 2.6;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        ctx.fillStyle = PALETTE.amber;
        ctx.fill();
        ctx.lineWidth = line * 0.7;
        ctx.strokeStyle = PALETTE.cream;
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(cx(wx), cy(wy), size * (0.5 + 0.08 * beat), 0, TAU);
        ctx.lineWidth = line * 2.4;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        ctx.setLineDash([size * 0.16, size * 0.14]);
        ctx.lineWidth = line * 1.2;
        ctx.strokeStyle = PALETTE.amber;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // a finger resting on something with a rule card: a ring fills while the card is on its way
    const press = this.press;
    if (press) {
      const p = clamp01((now - press.t0 - 120) / (press.dur - 120));
      if (p > 0) {
        ctx.beginPath();
        ctx.arc(cx(press.x), cy(press.y), size * 0.56, -Math.PI / 2, -Math.PI / 2 + TAU * p);
        ctx.lineWidth = line * 2.4;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        ctx.lineWidth = line * 1.2;
        ctx.strokeStyle = PALETTE.cream;
        ctx.stroke();
      }
    }

    // passing effects
    const effects = this.effects;
    for (let i = effects.length - 1; i >= 0; i--) {
      const fx = effects[i];
      const p = (now - fx.t0) / fx.dur;
      if (p >= 1) {
        effects.splice(i, 1);
        continue;
      }
      if (p < 0) continue;
      const x = cx(fx.x);
      const y = cy(fx.y);
      const e = easeOut(p);
      if (fx.type === 'bloom') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (1 - p) * 0.9;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.25 + 0.75 * e), 0, TAU);
        ctx.lineWidth = line * 2.2 * (1 - p) + 0.5;
        ctx.strokeStyle = this.accent;
        ctx.stroke();
        ctx.fillStyle = PALETTE.flame;
        for (let k = 0; k < 7; k++) {
          const ang = k * (TAU / 7) + fx.x * 1.3 + fx.y * 0.7;
          const far = size * (0.3 + 0.7 * e);
          ctx.beginPath();
          ctx.arc(x + Math.cos(ang) * far, y + Math.sin(ang) * far - e * size * 0.1, size * 0.045 * (1 - p) + 0.4, 0, TAU);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
      } else if (fx.type === 'ripple') {
        ctx.globalAlpha = (1 - p) * 0.8;
        ctx.lineWidth = line;
        ctx.strokeStyle = PALETTE.cream;
        for (let k = 0; k < 2; k++) {
          const q = clamp01(e - k * 0.25);
          if (q <= 0) continue;
          ctx.beginPath();
          ctx.ellipse(x, y + size * 0.08, size * 0.42 * q, size * 0.26 * q, 0, 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      } else if (fx.type === 'ring') {
        const q = fx.grow ? e : 1 - e;
        ctx.globalAlpha = (1 - p) * 0.7;
        ctx.beginPath();
        ctx.arc(x, y, size * (0.4 + 1.1 * q), 0, TAU);
        ctx.lineWidth = line * 1.4;
        ctx.strokeStyle = PALETTE.flame;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else if (fx.type === 'wait') {
        ctx.globalAlpha = (1 - p) * 0.75;
        ctx.fillStyle = PALETTE.cream;
        for (let k = 0; k < 3; k++) {
          const q = clamp01(p * 2.2 - k * 0.25);
          if (q <= 0) continue;
          ctx.beginPath();
          ctx.arc(x + (k - 1) * size * 0.17, y - size * (0.62 + 0.1 * e), size * 0.05, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      } else if (fx.type === 'cross') {
        const k = size * 0.16;
        ctx.globalAlpha = 1 - p;
        ctx.beginPath();
        ctx.moveTo(x - k, y - k);
        ctx.lineTo(x + k, y + k);
        ctx.moveTo(x + k, y - k);
        ctx.lineTo(x - k, y + k);
        ctx.lineWidth = line * 2.6;
        ctx.strokeStyle = PALETTE.ink;
        ctx.stroke();
        ctx.lineWidth = line * 1.2;
        ctx.strokeStyle = PALETTE.cream;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // solved: every bloom breathes
    const cel = this.celebration;
    if (cel) {
      const s = this.state;
      const swell = this.reduced ? 0.6 : 0.55 + 0.45 * Math.sin(celT * 0.007);
      const fade = clamp01(celT / 250);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < s.buds.length; i++) {
        const b = s.buds[i];
        const x = cx(b.x);
        const y = cy(b.y);
        const r = size * (0.75 + 0.45 * swell);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, 'rgba(255, 236, 170, 0.55)');
        g.addColorStop(0.45, 'rgba(255, 214, 130, 0.22)');
        g.addColorStop(1, 'rgba(255, 214, 130, 0)');
        ctx.globalAlpha = fade * (0.45 + 0.4 * swell);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }
  }
}

const GHOST_MOTH = Object.freeze({ id: '', type: 'M', dir: null });

function isGhostTile(a, tile) {
  for (let i = 0; i < a.ghosts.length; i++) if (a.ghosts[i].x === tile.x && a.ghosts[i].y === tile.y) return true;
  return false;
}

function byRow(p, q) {
  return p.y - q.y || p.z - q.z;
}

function roundRect(ctx, x, y, w, h, r) {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}
