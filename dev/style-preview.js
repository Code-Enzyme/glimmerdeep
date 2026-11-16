// Side-by-side preview of the character styles in src/chars/. Used for screenshots while designing and
// as the page the player looks at to choose a style. URL: ?style=glowmark,felt  ?static=1
import { drawDarkness, drawBackdrop, PALETTE } from '../src/sprites.js';
import { parseLevel, step, isLit, isHidden, isAwake } from '../src/engine.js';
import { LEVELS } from '../src/levels/index.js';
import { CHAR_STYLES, setCharStyle, drawTile } from '../src/chars.js';

export const BLURBS = {
  faces: 'The art in the prototype today, for comparison.',
  glowmark: 'Dark velvet silhouettes with glowing markings that brighten in the light. Wren is a hooded cloak with a shadowed hood.',
  felt: 'Soft felt toys with stitched seams. Mood shows through posture: tucked up in the dark, stretched out in the light.',
  glyph: 'Bold cut-glass emblems, like lantern panes. Each creature is one clear shape that changes shape with its state.',
};

const KIND = { '#': 'wall', '.': 'floor', '~': 'puddle', G: 'bud', H: 'hush', a: 'root', b: 'root', c: 'root', A: 'gate', B: 'gate', C: 'gate' };
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
const STATIC = params.get('static') === '1';
const only = (params.get('style') || '').split(',').filter((s) => CHAR_STYLES[s]);
const order = only.length ? only : Object.keys(CHAR_STYLES);

function sceneState() {
  const def = LEVELS.find((l) => l.id === '3-5');
  let s = parseLevel(def);
  for (const a of 'WWNNEEEESNWWNL') s = step(s, a) || s;
  return s;
}
const SCENE = sceneState();

const CAST = [
  { size: 64, cells: [
    { label: 'Wren', tile: 'floor', what: 'wren', dir: 'S', carrying: true },
    { label: 'walks east', tile: 'floor', what: 'wren', dir: 'E', carrying: true },
    { label: 'walks north', tile: 'floor', what: 'wren', dir: 'N', carrying: true },
    { label: 'no lantern', tile: 'floor', what: 'wren', dir: 'W', carrying: false },
    { label: 'in the Hush', tile: 'hush', what: 'wren', dir: 'S', carrying: true, smothered: true },
    { label: 'lantern', tile: 'floor', what: 'lantern' },
  ] },
  { size: 64, cells: [
    { label: 'moth dark', tile: 'floor', what: 'M', lit: false },
    { label: 'moth lit', tile: 'floor', what: 'M', lit: true },
    { label: 'whelk out', tile: 'floor', what: 'S', lit: false, hidden: false },
    { label: 'whelk hides', tile: 'floor', what: 'S', lit: true, hidden: true },
    { label: 'stump sleeps', tile: 'floor', what: 'T', dir: 'E', lit: false, awake: false },
    { label: 'stump awake', tile: 'floor', what: 'T', dir: 'E', lit: true, awake: true },
  ] },
  { size: 64, cells: [
    { label: 'north', tile: 'floor', what: 'T', dir: 'N', lit: true, awake: true },
    { label: 'south', tile: 'floor', what: 'T', dir: 'S', lit: true, awake: true },
    { label: 'west', tile: 'floor', what: 'T', dir: 'W', lit: true, awake: true },
    { label: 'asleep S', tile: 'floor', what: 'T', dir: 'S', lit: false, awake: false },
    { label: 'bridge', tile: 'bridge', what: null },
    { label: 'on a root', tile: 'root', what: 'S', lit: true, hidden: true, pressed: true },
  ] },
  { size: 40, cells: [
    { label: '', tile: 'floor', what: 'wren', dir: 'S', carrying: true },
    { label: '', tile: 'floor', what: 'wren', dir: 'E', carrying: false },
    { label: '', tile: 'floor', what: 'M', lit: true },
    { label: '', tile: 'floor', what: 'M', lit: false },
    { label: '', tile: 'floor', what: 'S', lit: false, hidden: false },
    { label: '', tile: 'floor', what: 'S', lit: true, hidden: true },
    { label: '', tile: 'floor', what: 'T', dir: 'E', lit: false, awake: false },
    { label: '', tile: 'floor', what: 'T', dir: 'E', lit: true, awake: true },
    { label: '', tile: 'floor', what: 'lantern' },
  ] },
];

function drawCast(ctx, mod, t, width) {
  let y = 6;
  for (const row of CAST) {
    const n = row.cells.length;
    const gap = Math.max(2, Math.floor((width - n * row.size) / (n + 1)));
    let x = Math.floor((width - (n * row.size + (n - 1) * gap)) / 2);
    for (const c of row.cells) {
      drawTile(ctx, c.tile, x, y, row.size, { t, seed: x + y, pressed: !!c.pressed, channel: 'a', neighbors: {} });
      if (c.what === 'wren') mod.drawWren(ctx, x, y, row.size, { t, dir: c.dir, carrying: c.carrying, smothered: !!c.smothered });
      else if (c.what === 'lantern') mod.drawLantern(ctx, x, y, row.size, { t });
      else if (c.what) mod.drawCreature(ctx, c.what, x, y, row.size, { t, dir: c.dir || null, lit: c.lit, hidden: c.hidden, awake: c.awake });
      if (c.label) {
        ctx.fillStyle = 'rgba(244,234,213,0.82)';
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(c.label, x + row.size / 2, y + row.size + 13);
      }
      x += row.size + gap;
    }
    y += row.size + (row.cells[0].label ? 24 : 10);
  }
  return y;
}
function castHeight() {
  return 6 + CAST.reduce((h, r) => h + r.size + (r.cells[0].label ? 24 : 10), 0);
}

function drawScene(ctx, mod, t, width, size) {
  const s = SCENE;
  const ox = Math.floor((width - s.w * size) / 2);
  const oy = 8;
  const kindAt = (x, y) => (x < 0 || y < 0 || x >= s.w || y >= s.h ? 'wall' : KIND[s.tiles[y][x]] || 'floor');
  let bud = 0;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const ch = s.tiles[y][x];
      let kind = KIND[ch] || 'floor';
      const o = { t, seed: x * 7 + y * 13 + 1 };
      if (kind === 'wall' || kind === 'puddle' || kind === 'hush') {
        const same = (dx, dy) => kindAt(x + dx, y + dy) === kind;
        o.neighbors = { n: same(0, -1), e: same(1, 0), s: same(0, 1), w: same(-1, 0) };
      }
      if (kind === 'puddle' && s.bridges.includes(x + ',' + y)) kind = 'bridge';
      if (kind === 'bud') { o.lit = s.bloom[bud++] === 1; o.accent = '#B5D46A'; }
      if (kind === 'root') { o.channel = ch; const c = s.creatures.find((k) => k.x === x && k.y === y); o.pressed = !!c && (c.type === 'T' || (c.type === 'S' && isHidden(s, c))); }
      if (kind === 'gate') { o.channel = ch; o.open = s.gates[ch] === true; }
      drawTile(ctx, kind, ox + x * size, oy + y * size, size, o);
    }
  }
  const things = s.creatures.map((c) => ({ y: c.y, c }));
  if (!s.lantern.carried) things.push({ y: s.lantern.y, lantern: true });
  things.push({ y: s.wren.y + 0.01, wren: true });
  things.sort((a, b) => a.y - b.y);
  for (const th of things) {
    if (th.lantern) mod.drawLantern(ctx, ox + (s.lantern.x + 0.22) * size, oy + s.lantern.y * size, size, { t });
    else if (th.wren) mod.drawWren(ctx, ox + (s.wren.x - 0.12) * size, oy + s.wren.y * size, size, { t, dir: 'N', carrying: s.lantern.carried });
    else {
      const c = th.c;
      mod.drawCreature(ctx, c.type, ox + c.x * size, oy + c.y * size, size, { t, dir: c.dir, lit: isLit(s, c.x, c.y), hidden: isHidden(s, c), awake: isAwake(s, c) });
    }
  }
  const src = s.lantern.carried ? { x: s.wren.x, y: s.wren.y, radius: 1 } : { x: s.lantern.x, y: s.lantern.y, radius: 2 };
  drawDarkness(ctx, { ox, oy, size, w: s.w, h: s.h, lit: s.lit, source: src, t, highContrast: false });
  return oy + s.h * size + 8;
}

function makeCanvas(parent, cssW, cssH) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const c = document.createElement('canvas');
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = cssW + 'px';
  c.style.height = cssH + 'px';
  parent.appendChild(c);
  const ctx = c.getContext('2d');
  return { c, ctx, dpr, cssW, cssH };
}

export function mount(root, { onPick } = {}) {
  const width = Math.min(420, Math.max(320, root.clientWidth || 390));
  const size = Math.floor((width - 16) / SCENE.w);
  const views = [];
  for (const key of order) {
    const st = CHAR_STYLES[key];
    const sec = document.createElement('section');
    sec.className = 'style';
    sec.id = 'style-' + key;
    sec.innerHTML = `<h2>${st.name}</h2><p>${BLURBS[key] || ''}</p>`;
    root.appendChild(sec);
    const cast = makeCanvas(sec, width, castHeight());
    const sceneLabel = document.createElement('p');
    sceneLabel.className = 'scene-label';
    sceneLabel.textContent = 'In the dark, mid-level (Many Hands, move 14)';
    sec.appendChild(sceneLabel);
    const scene = makeCanvas(sec, width, SCENE.h * size + 16);
    views.push({ key, mod: st.mod, cast, scene });
  }
  const t0 = performance.now();
  function frame(now) {
    const t = STATIC ? 1.3 : (now - t0) / 1000;
    for (const v of views) {
      setCharStyle(v.key);
      for (const [view, fn] of [[v.cast, (ctx) => drawCast(ctx, v.mod, t, width)], [v.scene, (ctx) => drawScene(ctx, v.mod, t, width, size)]]) {
        const { ctx, dpr, cssW, cssH } = view;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackdrop(ctx, cssW, cssH, { t, accent: PALETTE.teal || '#5FBFA8' });
        fn(ctx);
      }
    }
    if (!STATIC) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__preview = {
    ready: true,
    bench(key, frames = 200) {
      const v = views.find((x) => x.key === key);
      setCharStyle(key);
      const a = performance.now();
      for (let i = 0; i < frames; i++) {
        const { ctx, dpr, cssW, cssH } = v.scene;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawBackdrop(ctx, cssW, cssH, { t: i / 60 });
        drawScene(ctx, v.mod, i / 60, width, size);
        ctx.getImageData(0, 0, 1, 1);
      }
      return (performance.now() - a) / frames;
    },
  };
}

if (typeof document !== 'undefined' && document.getElementById('preview')) mount(document.getElementById('preview'));
