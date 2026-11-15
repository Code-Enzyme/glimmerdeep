// Dev gallery for src/sprites.js: every tile, creature, icon and a mock board, for looking at.
// Not part of the game. The mock board is hand-written here because it predates the engine.
import * as S from '../src/sprites.js';

const params = new URLSearchParams(location.search);
const T0 = Number(params.get('t') || 1.3);
const LIVE = params.get('live') === '1';
const dpr = window.devicePixelRatio || 1;
const root = document.getElementById('root');

function sheet(name, title, w, h) {
  const sec = document.createElement('section');
  const h2 = document.createElement('h2');
  h2.textContent = title;
  const c = document.createElement('canvas');
  c.id = name;
  c.dataset.shot = name;
  c.width = Math.round(w * dpr);
  c.height = Math.round(h * dpr);
  c.style.width = w + 'px';
  c.style.height = h + 'px';
  sec.append(h2, c);
  root.append(sec);
  const ctx = c.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#1a1226';
  ctx.fillRect(0, 0, w, h);
  return ctx;
}

// ---------------------------------------------------------------------------
// A tiny board renderer, drawing the way the game is expected to
// ---------------------------------------------------------------------------

const KIND = { '#': 'wall', '.': 'floor', '~': 'puddle', '=': 'bridge', G: 'bud', g: 'bud', H: 'hush' };

function tileAt(rows, x, y) {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return null;
  return rows[y][x];
}

function kindOf(ch) {
  if (ch === null || ch === undefined) return null;
  if (KIND[ch]) return KIND[ch];
  if ('abc'.includes(ch) || '123'.includes(ch)) return 'root';
  if ('ABC'.includes(ch) || '456'.includes(ch)) return 'gate';
  return 'floor';
}

// Section 4 of the SPEC, just enough to light the mock board.
function floodLight(board) {
  const { rows, lantern, creatures } = board;
  const w = rows[0].length;
  const h = rows.length;
  const lit = new Array(w * h).fill(0);
  if (!lantern || lantern.smothered) return lit;
  const r = lantern.carried ? 1 : 2;
  const blocked = (x, y) => {
    const ch = tileAt(rows, x, y);
    if (ch === '#' || ch === 'H' || ch === null) return true;
    return creatures.some((c) => c.x === x && c.y === y);
  };
  let frontier = [[lantern.x, lantern.y]];
  lit[lantern.y * w + lantern.x] = 1;
  for (let d = 0; d < r; d++) {
    const next = [];
    for (const [x, y] of frontier) {
      if (d > 0 && blocked(x, y)) continue;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx;
        const ny = y + dy;
        const ch = tileAt(rows, nx, ny);
        if (ch === null || ch === 'H' || lit[ny * w + nx]) continue;
        lit[ny * w + nx] = 1;
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return lit;
}

function drawBoard(ctx, board, ox, oy, size, t, lit) {
  const { rows } = board;
  const w = rows[0].length;
  const h = rows.length;
  const isLit = (x, y) => !!(lit && lit[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const ch = rows[y][x];
      const kind = kindOf(ch);
      const same = (dx, dy) => {
        const other = kindOf(tileAt(rows, x + dx, y + dy));
        if (other === null) return kind === 'wall' && !board.looseEdges; // off the board counts as wall, as in the engine
        return other === kind || (kind === 'puddle' && other === 'bridge') || (kind === 'bridge' && other === 'puddle');
      };
      const opts = { t, seed: y * w + x };
      if (kind === 'wall' || kind === 'puddle' || kind === 'bridge' || kind === 'hush') {
        opts.neighbors = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };
      }
      if (kind === 'bud') opts.lit = ch === 'g' || isLit(x, y);
      if (kind === 'root') {
        opts.channel = 'abc'.includes(ch) ? ch : 'abc'['123'.indexOf(ch)];
        opts.pressed = '123'.includes(ch) || !!(board.pressed && board.pressed[opts.channel]);
      }
      if (kind === 'gate') {
        opts.channel = 'ABC'.includes(ch) ? ch : 'ABC'['456'.indexOf(ch)];
        opts.open = '456'.includes(ch) || !!(board.open && board.open[opts.channel]);
      }
      S.drawTile(ctx, kind, ox + x * size, oy + y * size, size, opts);
    }
  }
  const things = [];
  if (board.lantern && !board.lantern.carried) things.push({ y: board.lantern.y, z: 0, draw: () => S.drawLantern(ctx, ox + board.lantern.x * size, oy + board.lantern.y * size, size, { t }) });
  for (const c of board.creatures || []) {
    const l = isLit(c.x, c.y);
    things.push({ y: c.y, z: 1, draw: () => S.drawCreature(ctx, c.type, ox + c.x * size, oy + c.y * size, size, { t, dir: c.dir, lit: l, hidden: c.type === 'S' && l, awake: c.type === 'T' && l }) });
  }
  if (board.wren) things.push({ y: board.wren.y, z: 2, draw: () => S.drawWren(ctx, ox + board.wren.x * size, oy + board.wren.y * size, size, { t, dir: board.wren.dir, carrying: !!(board.lantern && board.lantern.carried) }) });
  things.sort((a, b) => a.y - b.y || a.z - b.z);
  for (const th of things) th.draw();
}

// ---------------------------------------------------------------------------
// The mock 7 x 9 board
// ---------------------------------------------------------------------------

const MOCK_ROWS = [
  '#######',
  '#G..~H#',
  '#.#.=H#',
  '#.....#',
  '#a..#A#',
  '#....G#',
  '#.....#',
  '#.....#',
  '#######',
];
const MOCK = {
  rows: MOCK_ROWS,
  wren: { x: 3, y: 6, dir: 'S' },
  lantern: { x: 3, y: 5, carried: false },
  creatures: [
    { type: 'S', x: 2, y: 3 },
    { type: 'T', x: 1, y: 6, dir: 'E' },
    { type: 'M', x: 4, y: 6 },
  ],
};
// Wren has carried the lantern into the Hush: nothing is lit.
const MOCK_SMOTHERED = {
  rows: MOCK_ROWS,
  wren: { x: 5, y: 2, dir: 'N' },
  lantern: { x: 5, y: 2, carried: true, smothered: true },
  creatures: MOCK.creatures,
};

const MOCK_LIT = floodLight(MOCK);
const MOCK_DARK = floodLight(MOCK_SMOTHERED);
const ALL_LIT = new Array(63).fill(1);

function drawMock(ctx, mode, ox, oy, size, t) {
  const w = 7;
  const h = 9;
  if (mode === 'lit') {
    drawBoard(ctx, MOCK, ox, oy, size, t, MOCK_LIT);
  } else if (mode === 'dark' || mode === 'contrast') {
    drawBoard(ctx, MOCK, ox, oy, size, t, MOCK_LIT);
    S.drawDarkness(ctx, { ox, oy, size, w, h, lit: MOCK_LIT, source: { x: 3, y: 5, radius: 2 }, t, highContrast: mode === 'contrast' });
  } else {
    drawBoard(ctx, MOCK_SMOTHERED, ox, oy, size, t, MOCK_DARK);
    S.drawDarkness(ctx, { ox, oy, size, w, h, lit: MOCK_DARK, source: null, t, highContrast: false });
  }
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------

const SIZES = [40, 64, 96];

const TILE_ROWS = [
  '.............',
  '.G.g.a.b.c...',
  '.1.2.3.A.B.C.',
  '.4.5.6.~.=.H.',
  '.............',
  '.#.##..~~.HH.',
  '....#..~~.H..',
  '.###...=.....',
  '.#.#.#.~.HHH.',
  '.###.#....H..',
  '.............',
];

function tilesSheet(size, t) {
  const w = TILE_ROWS[0].length;
  const h = TILE_ROWS.length;
  const ctx = sheet('tiles-' + size, `Tiles at ${size}px: floors / buds (asleep, lit), roots A B C / pressed roots, closed gates / open gates, puddle, bridge, hush / merging walls, puddles, hush`, w * size, h * size);
  drawBoard(ctx, { rows: TILE_ROWS, creatures: [] }, 0, 0, size, t, null);
  return ctx;
}

const CREATURE_CELLS = [
  [
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'S', carrying: true }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'E', carrying: true }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'N', carrying: true }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'W', carrying: true }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'S', carrying: false }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'E', carrying: false }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'N', carrying: false }),
    (c, x, y, s, t) => S.drawWren(c, x, y, s, { t, dir: 'W', carrying: false }),
    (c, x, y, s, t) => S.drawLantern(c, x, y, s, { t }),
    (c, x, y, s, t) => S.drawCreature(c, 'M', x, y, s, { t, lit: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'M', x, y, s, { t, lit: true }),
  ],
  [
    (c, x, y, s, t) => S.drawCreature(c, 'S', x, y, s, { t, hidden: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'S', x, y, s, { t, hidden: true }),
    null,
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'S', awake: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'E', awake: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'N', awake: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'W', awake: false }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'S', awake: true }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'E', awake: true }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'N', awake: true }),
    (c, x, y, s, t) => S.drawCreature(c, 'T', x, y, s, { t, dir: 'W', awake: true }),
  ],
];

function creaturesSheet(size, t) {
  const pitch = Math.round(size * 1.3);
  const cols = CREATURE_CELLS[0].length;
  const ctx = sheet('creatures-' + size, `Creatures at ${size}px: Wren S E N W carrying, S E N W hands free, planted lantern, moth, moth lit / whelk out, whelk hidden, stumpcap asleep S E N W, awake S E N W`, cols * pitch + size * 0.3, 2 * pitch + size * 0.3);
  const off = size * 0.3;
  for (let r = 0; r < 2; r++) {
    for (let i = 0; i < cols; i++) {
      const fn = CREATURE_CELLS[r][i];
      if (!fn) continue;
      const x = off + i * pitch;
      const y = off + r * pitch;
      S.drawTile(ctx, 'floor', x, y, size, { seed: r * 20 + i });
      fn(ctx, x, y, size, t);
    }
  }
  return ctx;
}

const ICON_NAMES = ['undo', 'restart', 'wait', 'hint', 'lantern', 'map', 'sound', 'mute', 'star', 'lock', 'contrast'];

function iconsSheet() {
  const sizes = [24, 32, 48];
  const ctx = sheet('icons', 'Icons at 24, 32, 48px: undo restart wait hint lantern map sound mute star lock contrast', 11 * 64 + 16, 24 + 32 + 48 + 64);
  ctx.fillStyle = S.PALETTE.plum;
  ctx.fillRect(0, 0, 11 * 64 + 16, 200);
  let y = 12;
  for (const s of sizes) {
    ICON_NAMES.forEach((n, i) => S.drawIcon(ctx, n, 16 + i * 64, y, s));
    y += s + 16;
  }
}

function boardsSheet(size, t, name) {
  const bw = 7 * size;
  const bh = 9 * size;
  const gap = Math.round(size * 0.6);
  const W = 4 * bw + 5 * gap;
  const H = bh + 2 * gap;
  const ctx = sheet(name || 'boards-' + size, `Mock board at ${size}px: fully lit / planted lantern, radius 2 / the same in high contrast / smothered`, W, H);
  S.drawBackdrop(ctx, W, H, { t });
  ['lit', 'dark', 'contrast', 'smothered'].forEach((mode, i) => drawMock(ctx, mode, gap + i * (bw + gap), gap, size, t));
  return ctx;
}

function animSheet() {
  const size = 64;
  const frames = 8;
  const rowsFn = [
    (c, x, y, t) => S.drawCreature(c, 'M', x, y, size, { t }),
    (c, x, y, t) => S.drawCreature(c, 'M', x, y, size, { t, lit: true }),
    (c, x, y, t) => S.drawCreature(c, 'S', x, y, size, { t: t * 4, hidden: false }),
    (c, x, y, t) => S.drawCreature(c, 'T', x, y, size, { t, dir: 'E', awake: true }),
    (c, x, y, t) => S.drawCreature(c, 'T', x, y, size, { t: t * 4, dir: 'S', awake: false }),
    (c, x, y, t) => S.drawLantern(c, x, y, size, { t }),
    (c, x, y, t) => S.drawWren(c, x, y, size, { t, dir: 'S', carrying: true }),
    (c, x, y, t) => S.drawTile(c, 'bud', x, y, size, { t: t * 4, lit: true, seed: 3 }),
    (c, x, y, t) => S.drawTile(c, 'hush', x, y, size, { t: t * 8, seed: 3 }),
  ];
  const pitch = 80;
  const ctx = sheet('anim', 'Animation strips (8 moments, 0.1s apart; slow ones sped up): moth, lit moth, whelk, awake stumpcap, sleeping stumpcap, lantern, Wren, lit bud, hush', frames * pitch + 16, rowsFn.length * pitch + 16);
  rowsFn.forEach((fn, r) => {
    for (let f = 0; f < frames; f++) {
      const x = 16 + f * pitch;
      const y = 16 + r * pitch;
      if (r < 7) S.drawTile(ctx, 'floor', x, y, size, { seed: 2 });
      fn(ctx, x, y, f * 0.1);
    }
  });
}

// Enlarged, unsmoothed copy of a 40px sheet, to judge what survives at phone size.
function zoomSheet(name, title, srcCtx, k) {
  const src = srcCtx.canvas;
  const w = src.width / dpr;
  const h = src.height / dpr;
  const ctx = sheet(name, title, w * k, h * k);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(src, 0, 0, w * k, h * k);
}

function backdropSheet(t) {
  const ctx = sheet('backdrop', 'Backdrop alone, 360 x 640', 360, 640);
  S.drawBackdrop(ctx, 360, 640, { t, accent: S.PALETTE.teal });
}

function renderAll(t) {
  root.textContent = '';
  const made = {};
  boardsSheet(40, t);
  boardsSheet(64, t);
  for (const s of SIZES) made['c' + s] = creaturesSheet(s, t);
  for (const s of SIZES) made['t' + s] = tilesSheet(s, t);
  iconsSheet();
  animSheet();
  backdropSheet(t);
  zoomSheet('zoom-creatures-40', 'Creatures at 40px, enlarged 3x', made.c40, 3);
  zoomSheet('zoom-tiles-40', 'Tiles at 40px, enlarged 3x', made.t40, 3);
}

// ---------------------------------------------------------------------------
// Frame-time measurement
// ---------------------------------------------------------------------------

async function measure() {
  const out = {};
  const run = (label, size, scale, frames, body) => {
    const c = document.createElement('canvas');
    const W = 7 * size + 40;
    const H = 9 * size + 40;
    c.width = Math.round(W * scale);
    c.height = Math.round(H * scale);
    const ctx = c.getContext('2d');
    ctx.scale(scale, scale);
    // warm the caches so we measure steady-state frames
    for (let i = 0; i < 12; i++) body(ctx, i / 60, W, H, size);
    ctx.getImageData(0, 0, 1, 1);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) body(ctx, 1 + i / 60, W, H, size);
    const t1 = performance.now();
    ctx.getImageData(0, 0, 1, 1); // force any deferred drawing to finish
    const t2 = performance.now();
    // and once more with a flush after every frame (closer to what a real frame costs end to end)
    const t3 = performance.now();
    for (let i = 0; i < frames; i++) {
      body(ctx, 7 + i / 60, W, H, size);
      ctx.getImageData(0, 0, 1, 1);
    }
    const t4 = performance.now();
    out[label] = { msPerFrame: +((t2 - t0) / frames).toFixed(3), msPerFrameRecordOnly: +((t1 - t0) / frames).toFixed(3), msPerFrameFlushedEachFrame: +((t4 - t3) / frames).toFixed(3) };
  };
  const board = (ctx, t, W, H, size) => drawMock(ctx, 'dark', 20, 20, size, t);
  const full = (ctx, t, W, H, size) => {
    S.drawBackdrop(ctx, W, H, { t });
    drawMock(ctx, 'dark', 20, 20, size, t);
  };
  // lantern sliding: the darkness mask is rebuilt on most frames (the worst case)
  const moving = (ctx, t, W, H, size) => {
    S.drawBackdrop(ctx, W, H, { t });
    drawBoard(ctx, MOCK, 20, 20, size, t, MOCK_LIT);
    S.drawDarkness(ctx, { ox: 20, oy: 20, size, w: 7, h: 9, lit: MOCK_LIT, source: { x: 3 + Math.sin(t * 3), y: 5, radius: 2 }, t });
  };
  const onlyBack = (ctx, t, W, H) => S.drawBackdrop(ctx, W, H, { t });
  const onlyBoard = (ctx, t, W, H, size) => drawBoard(ctx, MOCK, 20, 20, size, t, MOCK_LIT);
  const onlyDark = (ctx, t, W, H, size) => S.drawDarkness(ctx, { ox: 20, oy: 20, size, w: 7, h: 9, lit: MOCK_LIT, source: { x: 3, y: 5, radius: 2 }, t });
  if (params.get('parts') === '1') {
    run('parts dpr3: backdrop only', 40, 3, 100, onlyBack);
    run('parts dpr3: tiles+things only', 40, 3, 100, onlyBoard);
    run('parts dpr3: darkness only', 40, 3, 100, onlyDark);
  }
  run('board+darkness, 40px, dpr1 (300 frames)', 40, 1, 300, board);
  run('backdrop+board+darkness, 40px, dpr1', 40, 1, 300, full);
  run('backdrop+board+darkness, 40px, dpr3', 40, 3, 300, full);
  run('same, lantern moving every frame, dpr3', 40, 3, 300, moving);
  return out;
}

window.__measure = measure;
document.getElementById('run-perf').addEventListener('click', async () => {
  document.getElementById('perf').textContent = JSON.stringify(await measure(), null, 1);
});

renderAll(T0);
if (LIVE) {
  const start = performance.now();
  const ctx = sheet('live', 'Live', 7 * 56 + 40, 9 * 56 + 40);
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    S.drawBackdrop(ctx, 7 * 56 + 40, 9 * 56 + 40, { t });
    drawMock(ctx, 'dark', 20, 20, 56, t);
    requestAnimationFrame(tick);
  };
  tick();
}
window.__ready = true;
