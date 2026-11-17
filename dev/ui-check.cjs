// Plays the built game in headless Chromium the way a phone would, and fails on anything broken.
//
//   node dev/ui-check.cjs              build, run every check, write screenshots to dev/ui-shots/
//   node dev/ui-check.cjs --no-build   reuse dist/glimmerdeep.html
//   node dev/ui-check.cjs --shots      only take the screenshots (phone, small phone, tablet)
//
// The page is opened from file://, in a 390 by 844 touch context. Any console error or page error fails
// the run. Expectations about levels come from the real modules (levels, engine, solver) and the rule
// card texts from SPEC.md section 8, so nothing here needs editing when levels are added.

const { chromium } = require('playwright');
const { execSync } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', 'glimmerdeep.html');
const URL0 = pathToFileURL(DIST).href;
const SHOTS = path.join(__dirname, 'ui-shots');
const args = process.argv.slice(2);
const SHOTS_ONLY = args.includes('--shots');

const DIRV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const KEY_OF = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft', L: ' ', Z: '.' };

// Ad-hoc levels for the mechanics the shipped levels may not reach yet.
const ADHOC = {
  whelk: {
    id: 'T-1', name: 'Whelk and Gate', par: 7,
    map: ['#######', '#W.S.a#', '####A##', '####.##', '####G##', '#######'],
    tip: 'A test cavern: wait for the whelk to back onto the root.',
    note: 'DESIGNER NOTE MUST NOT SHOW',
  },
  stump: {
    id: 'T-2', name: 'Stump March',
    map: ['#######', '#W>..b#', '####B##', '####.##', '####G##', '#######'],
  },
  newt: {
    id: 'T-5', name: 'Newt Gate',
    map: ['########', '#W..A.G#', '####.###', '###ea.##', '########'],
  },
  ember: {
    id: 'T-6', name: 'Ember Light',
    map: ['######', '#L~K.#', '###..#', '#G...#', '##.W.#', '######'],
  },
  trio: {
    id: 'T-3', name: 'All Three',
    map: ['#########', '#G.....G#', '#A##H##.#', '#.W.L.S.#', '#.#~#.#.#', '#.M...>a#', '#########'],
  },
  tall: {
    id: 'T-4', name: 'Full Size Cavern With A Long Name',
    map: [
      '#########', '#W......#', '#.#####.#', '#.#G..#.#', '#.#.#.#.#', '#.#.#.#.#',
      '#.#.#.#.#', '#.#.#...#', '#.#.#####', '#.......#', '#########',
    ],
  },
};

const results = [];
function ok(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: cond ? '' : detail === undefined ? '' : String(detail) });
  if (!cond) console.log(`  FAIL  ${name}${detail !== undefined ? '  -> ' + detail : ''}`);
  else if (args.includes('--verbose')) console.log(`  ok    ${name}`);
}
function eq(name, got, want) {
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

function ruleCards() {
  const spec = fs.readFileSync(path.join(ROOT, 'SPEC.md'), 'utf8');
  const cards = {};
  for (const m of spec.matchAll(/^- \*\*(.+?):\*\* "(.+)"\s*$/gm)) cards[m[1]] = m[2];
  return cards;
}

async function main() {
  if (!args.includes('--no-build')) execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });
  fs.mkdirSync(SHOTS, { recursive: true });

  const engine = await import(pathToFileURL(path.join(ROOT, 'src/engine.js')).href);
  const solver = await import(pathToFileURL(path.join(ROOT, 'src/solver.js')).href);
  const { CHAPTERS, LEVELS } = await import(pathToFileURL(path.join(ROOT, 'src/levels/index.js')).href);
  const CARDS = ruleCards();
  const first = LEVELS[0];
  const solutionOf = (def) => {
    const r = solver.solve(engine.parseLevel(def), { maxStates: 400000 });
    if (!r.solved) throw new Error(`ui-check: level ${def.id} has no solution`);
    return r.moves;
  };

  const browser = await chromium.launch();
  const errors = [];

  // A phone: its own context (own storage), console errors collected.
  async function phone(opts = {}) {
    const context = await browser.newContext({
      viewport: opts.viewport || { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: opts.dpr || 1,
      reducedMotion: opts.reducedMotion || 'no-preference',
    });
    if (opts.init) await context.addInitScript(opts.init);
    const page = await context.newPage();
    const tag = opts.tag || 'phone';
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
    page.on('dialog', (d) => {
      errors.push(`[${tag}] a native ${d.type()} dialog opened: ${d.message()}`);
      d.dismiss().catch(() => {});
    });
    const cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const h = {
      context, page,
      open: async (query = '') => {
        await page.goto(URL0 + query);
        await page.waitForFunction(() => window.__gd && window.__gd.screen());
      },
      // the app opens on the title screen; Play goes to the map
      toMap: async () => {
        if ((await page.evaluate(() => window.__gd.screen())) === 'title') await page.locator('#btn-play').tap();
        await page.waitForFunction(() => window.__gd.screen() === 'map');
      },
      gd: (fn, arg) => page.evaluate(([f, a]) => window.__gd[f](a), [fn, arg]),
      idle: () => page.waitForFunction(() => !window.__gd.busy(), null, { timeout: 8000 }),
      // centre of a tile in client pixels
      tile: async (x, y) => {
        const L = await page.evaluate(() => window.__gd.layout());
        return { x: L.left + L.ox + (x + 0.5) * L.size, y: L.top + L.oy + (y + 0.5) * L.size, size: L.size };
      },
      wren: async () => {
        const w = await page.evaluate(() => window.__gd.state().wren);
        return h.tile(w.x, w.y);
      },
      tap: async (p) => {
        await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
        await touch('touchEnd', []);
      },
      hold: async (p, ms) => {
        await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
        await page.waitForTimeout(ms);
        await touch('touchEnd', []);
      },
      // a real finger swipe on the board, starting anywhere
      swipe: async (dir, from, dist = 44) => {
        const p = from || { x: 195, y: (await h.tile(0, 0)).y + 30 };
        const [dx, dy] = DIRV[dir];
        await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
        for (let i = 1; i <= 4; i++) {
          await touch('touchMove', [{ x: p.x + (dx * dist * i) / 4, y: p.y + (dy * dist * i) / 4, id: 1 }]);
        }
        await touch('touchEnd', []);
      },
      shot: async (name) => {
        await page.waitForTimeout(120);
        await page.screenshot({ path: path.join(SHOTS, name + '.png') });
      },
      close: () => context.close(),
    };
    return h;
  }

  // Plays a list of engine actions with touch: swipes, a tap on Wren for the lantern, the Wait button.
  async function playByTouch(h, moves) {
    for (const m of moves) {
      if (DIRV[m]) await h.swipe(m);
      else if (m === 'L') await h.tap(await h.wren());
      else await h.page.locator('#btn-wait').tap();
      await h.idle();
    }
  }
  async function playByKeys(h, moves) {
    for (const m of moves) {
      await h.page.keyboard.press(KEY_OF[m]);
      await h.idle();
    }
  }
  const waitResult = (h) => h.page.waitForFunction(() => window.__gd.panel() === 'result', null, { timeout: 8000 });
  // Settings labels that do not fit inside their buttons on the map, with the page's fonts and again with
  // a wide one (DejaVu Sans, a common Linux fallback), so the layout does not depend on one machine's fonts.
  const crampedSettings = (h) => h.page.evaluate(async () => {
    const out = [];
    const root = document.documentElement;
    const was = root.style.getPropertyValue('--sans');
    for (const font of [null, "'DejaVu Sans', Verdana, sans-serif"]) {
      if (font) root.style.setProperty('--sans', font);
      await new Promise((r) => requestAnimationFrame(() => r()));
      for (const b of document.querySelectorAll('.settings .tool')) {
        const r = b.getBoundingClientRect();
        for (const el of b.querySelectorAll('.lbl, .val')) {
          const e = el.getBoundingClientRect();
          if (e.left < r.left + 3 || e.right > r.right - 3) out.push(`${el.textContent}${font ? ' (wide font)' : ''}`);
        }
      }
    }
    if (was) root.style.setProperty('--sans', was);
    else root.style.removeProperty('--sans');
    return out;
  });
  // The reset question must sit above the settings bar, not on it.
  const confirmClear = async (h) => {
    await h.page.waitForTimeout(400);   // let it finish rising
    return h.page.evaluate(() => {
      const c = document.getElementById('confirm').getBoundingClientRect();
      const bar = document.querySelector('.settings').getBoundingClientRect();
      return c.bottom <= bar.top + 1 && c.top >= 0 ? true : JSON.stringify({ confirm: [c.top, c.bottom], bar: bar.top });
    });
  };
  const earned = (h) => h.page.locator('#result-marks li.earned').count();

  // ------------------------------------------------------------------ screenshots at three sizes
  async function shots(prefix, viewport, dpr) {
    const h = await phone({ viewport, dpr, tag: prefix || 'shots' });
    const name = (n) => (prefix ? `${prefix}-${n}` : n);
    await h.open();
    await h.page.waitForTimeout(350);
    await h.shot(name('00-title'));
    await h.toMap();
    await h.shot(name('01-map'));
    await h.page.locator(`.node[data-level="${first.id}"]`).tap();
    await h.page.waitForFunction(() => window.__gd.screen() === 'level');
    await h.page.waitForTimeout(350);
    await h.shot(name('02-level-start'));

    // mid-play with the lantern planted
    const sol = solutionOf(first);
    await playByKeys(h, sol.slice(0, 2));
    await h.gd('act', 'L');
    await h.idle();
    await h.page.waitForTimeout(350);
    await h.shot(name('03-planted-lantern'));

    // a hint arrow
    await h.gd('loadLevel', first.id);
    await h.page.locator('#btn-hint').tap();
    await h.page.waitForFunction(() => window.__gd.hint() !== null);
    await h.page.waitForTimeout(200);
    await h.shot(name('07-hint'));

    // all three species, Hush, a planted lantern, two buds
    await h.gd('loadLevelDef', ADHOC.trio);
    await h.page.waitForTimeout(350);
    await h.shot(name('04-three-species'));
    await playByKeys(h, ['E', 'E', 'L', 'N']);
    await h.page.waitForTimeout(300);
    await h.shot(name('04b-in-the-hush'));

    await h.gd('loadLevelDef', ADHOC.whelk);
    await playByKeys(h, solutionOf(ADHOC.whelk).slice(0, 5));
    await h.page.waitForTimeout(300);
    await h.shot(name('04c-whelk-gate-open'));

    await h.gd('loadLevelDef', ADHOC.tall);
    await h.page.waitForTimeout(350);
    await h.shot(name('04d-full-size'));

    // rule card
    await h.gd('loadLevel', first.id);
    await h.page.waitForTimeout(200);
    const moth = await h.page.evaluate(() => window.__gd.state().creatures[0] || null);
    const target = moth ? await h.tile(moth.x, moth.y) : await h.wren();
    await h.hold(target, 600);
    await h.page.waitForFunction(() => window.__gd.panel() === 'card');
    await h.page.waitForTimeout(350);
    await h.shot(name('05-rule-card'));
    await h.page.locator('#card-close').tap();

    // result panel
    await playByKeys(h, sol);
    await waitResult(h);
    await h.page.waitForTimeout(700);
    await h.shot(name('06-result'));

    // high contrast board, then the map with progress on it
    await h.page.locator('#result-map').tap();
    await h.page.locator('#set-contrast').tap();
    await h.shot(name('09-map-progress-contrast'));
    await h.gd('loadLevelDef', ADHOC.trio);
    await h.page.waitForTimeout(350);
    await h.shot(name('08-high-contrast'));
    await h.page.locator('#back').tap();
    await h.page.locator('#set-contrast').tap();
    await h.page.locator('#set-reset').tap();
    await h.page.waitForTimeout(300);
    await h.shot(name('10-reset-confirm'));
    await h.close();
  }

  if (!SHOTS_ONLY) {
    // ---------------------------------------------------------------- 0. title screen
    console.log('title');
    const h = await phone();
    await h.open();
    eq('title: the app opens on the title screen', await h.gd('screen'), 'title');
    ok('title: the map is hidden', !(await h.page.locator('#screen-map').isVisible()));
    eq('title: name', await h.page.locator('#screen-title h1').textContent(), 'Glimmerdeep');
    {
      const b = await h.page.locator('#btn-play').boundingBox();
      ok('title: Play is a big button', b && b.width >= 160 && b.height >= 56, JSON.stringify(b));
      ok('title: Play is on screen, in the lower half (thumb reach)', b && b.y > 844 / 2 && b.y + b.height <= 844 && b.x >= 0 && b.x + b.width <= 390, JSON.stringify(b));
      eq('title: Play says Play', (await h.page.locator('#btn-play').textContent()).trim(), 'Play');
    }
    ok('title: no progress line on a fresh save', !(await h.page.locator('#title-progress').isVisible()));
    await h.page.waitForTimeout(300);
    {
      const art = await h.page.evaluate(() => {
        const c = document.getElementById('title-art');
        const r = c.getBoundingClientRect();
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let lit = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i] > 0) lit++;
        return { w: r.width, h: r.height, lit, frac: lit / (d.length / 4) };
      });
      ok('title: Wren and the lantern are drawn', art.w >= 120 && art.h >= 120 && art.frac > 0.05, JSON.stringify(art));
      const f0 = await h.gd('titleFrames');
      await h.page.waitForTimeout(250);
      ok('title: the art is animated', (await h.gd('titleFrames')) > f0 + 3);
    }
    await h.page.locator('#btn-play').tap();
    eq('title: Play opens the map', await h.gd('screen'), 'map');
    {
      const f0 = await h.gd('titleFrames');
      await h.page.waitForTimeout(250);
      eq('map: the title art stops animating', await h.gd('titleFrames'), f0);
    }
    await h.page.keyboard.press('Escape');
    eq('map: Escape goes back to the title', await h.gd('screen'), 'title');
    await h.page.keyboard.press('Enter');
    eq('title: Enter plays', await h.gd('screen'), 'map');
    await h.page.keyboard.press('Escape');
    await h.page.waitForFunction(() => window.__gd.screen() === 'title');

    // ---------------------------------------------------------------- 1. map
    console.log('map');
    await h.toMap();
    eq('map: title', await h.page.locator('#screen-map h1').textContent(), 'Glimmerdeep');
    eq('map: one section per chapter', await h.page.locator('.chapter').count(), CHAPTERS.length);
    eq('map: one node per level', await h.page.locator('.node').count(), LEVELS.length);
    for (const ch of CHAPTERS) {
      ok(`map: chapter name "${ch.name}" shown`, (await h.page.locator('.chapter h2').allTextContents()).includes(ch.name));
    }
    eq('map: empty chapters carry a note', await h.page.locator('.chapter .empty').count(), CHAPTERS.filter((c) => !c.levels.length).length);
    ok('map: first level is open', !(await h.page.locator(`.node[data-level="${first.id}"]`).getAttribute('class')).includes('locked'));
    eq('map: locked levels', await h.page.locator('.node.locked').count(), Math.max(0, LEVELS.length - 1));
    eq('map: no star moss earned yet', await h.page.locator('.node .moss.on').count(), 0);
    eq('map: every node has three marks', await h.page.locator('.node .moss').count(), LEVELS.length * 3);
    ok('map: no designer note on screen', !(await h.page.evaluate(() => document.body.innerText)).includes(first.note || '\u0000'));

    // every button has an aria-label; nothing but paper is in the top 12 percent
    const audit = async (label) => {
      const a = await h.page.evaluate(() => {
        const out = { unlabeled: [], high: [], small: [] };
        const H = window.innerHeight;
        const seen = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        for (const b of document.querySelectorAll('button')) {
          if (!seen(b)) continue;
          if (!(b.getAttribute('aria-label') || '').trim()) out.unlabeled.push(b.id || b.className);
          if (b.getBoundingClientRect().top < H * 0.12 && b.id !== 'back') out.high.push(b.id || b.className);
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (!node.textContent.trim()) continue;
          const el = node.parentElement;
          if (!el || !seen(el) || el.closest('script,style,noscript,.sr')) continue;
          const px = parseFloat(getComputedStyle(el).fontSize);
          if (px < 14) out.small.push(`${node.textContent.trim().slice(0, 20)} (${px}px)`);
        }
        return out;
      });
      eq(`${label}: every button has an aria-label`, a.unlabeled, []);
      eq(`${label}: no button in the top 12 percent but Back`, a.high, []);
      eq(`${label}: no text under 14 px`, a.small, []);
    };
    await audit('map');
    await h.page.keyboard.press('Escape');
    await h.page.waitForFunction(() => window.__gd.screen() === 'title');
    await audit('title');
    await h.toMap();

    // ---------------------------------------------------------------- 2. open 1-1 by tapping its node
    console.log('level: open, illegal moves, undo, restart');
    await h.page.locator(`.node[data-level="${first.id}"]`).tap();
    await h.page.waitForFunction(() => window.__gd.screen() === 'level');
    eq('level: opened by tapping its node', (await h.gd('state')).turn, 0);
    eq('level: counter shows moves and par', await h.page.locator('#counter').textContent(), `0 / par ${first.par}`);
    eq('level: heading shows id', await h.page.locator('#level-id').textContent(), `Level ${first.id}`);
    eq('level: heading shows name', await h.page.locator('#level-name').textContent(), first.name);
    await audit('level');
    const L0 = await h.gd('layout');
    const st0 = await h.gd('state');
    ok('level: tile size at least 36 px', L0.size >= 36, L0.size);
    ok('level: board centred horizontally', Math.abs(L0.ox - (390 - L0.size * st0.w) / 2) <= 1, JSON.stringify(L0));
    ok('level: board inside the canvas with a margin', L0.ox >= 6 && L0.oy >= 6, JSON.stringify(L0));
    const box = await h.page.locator('#board').boundingBox();
    const head = await h.page.locator('.level-head').boundingBox();
    const bar = await h.page.locator('.bar.tools').boundingBox();
    ok('level: canvas fills the space between the bars', Math.abs(box.y - (head.y + head.height)) <= 1 && Math.abs(box.y + box.height - bar.y) <= 1 && box.width === 390,
      JSON.stringify({ box, head, bar }));
    for (const id of ['btn-undo', 'btn-restart', 'btn-wait', 'btn-lantern', 'btn-hint']) {
      const b = await h.page.locator('#' + id).boundingBox();
      ok(`level: ${id} is at least 52 px`, b.width >= 52 && b.height >= 52, JSON.stringify(b));
    }
    const frames0 = (await h.gd('layout')).frames;
    await h.page.waitForTimeout(400);
    ok('level: the frame loop runs', (await h.gd('layout')).frames > frames0 + 10);

    // ---------------------------------------------------------------- 3. illegal moves cost nothing
    const k0 = await h.gd('key');
    // find a direction Wren cannot go from the start
    const blockedDir = ['N', 'E', 'S', 'W'].find((d) => engine.step(engine.parseLevel(first), d) === null);
    if (blockedDir) {
      await h.swipe(blockedDir);
      await h.page.waitForTimeout(250);
      eq('illegal swipe: move counter unchanged', await h.page.locator('#counter').textContent(), `0 / par ${first.par}`);
      eq('illegal swipe: position unchanged', await h.gd('key'), k0);
      eq('illegal swipe: hook says illegal', await h.gd('act', blockedDir), false);
      await h.page.keyboard.press(KEY_OF[blockedDir]);
      await h.page.waitForTimeout(200);
      eq('illegal key: move counter unchanged', await h.gd('moves'), 0);
    }

    // ---------------------------------------------------------------- 4. undo and restart are exact
    const sol = solutionOf(first);
    const keys = [k0];
    for (const m of sol.slice(0, 3)) {
      eq(`act ${m} is legal`, await h.gd('act', m), true);
      keys.push(await h.gd('key'));
    }
    await h.idle();
    eq('counter after three moves', await h.page.locator('#counter').textContent(), `3 / par ${first.par}`);
    await h.page.locator('#btn-undo').tap();
    eq('undo button: back one position', await h.gd('key'), keys[2]);
    eq('undo button: counter', await h.page.locator('#counter').textContent(), `2 / par ${first.par}`);
    await h.page.keyboard.press('z');
    eq('undo key: back one more', await h.gd('key'), keys[1]);
    eq('undo hook', await h.gd('undo'), true);
    eq('undo hook: at the start again', await h.gd('key'), k0);
    eq('undo with nothing to undo', await h.gd('undo'), false);
    const stA = await h.gd('state');
    eq('undo: state equals the opening state', JSON.stringify({ ...stA, events: [] }), JSON.stringify({ ...st0, events: [] }));
    for (const m of sol.slice(0, 3)) await h.gd('act', m);
    await h.idle();
    await h.page.locator('#btn-restart').tap();
    eq('restart button: opening position', await h.gd('key'), k0);
    eq('restart button: counter', await h.page.locator('#counter').textContent(), `0 / par ${first.par}`);
    await h.page.locator('#btn-undo').tap();
    eq('undo after restart brings the game back', await h.gd('key'), keys[3]);
    eq('restart hook', await h.gd('restart'), true);
    eq('restart hook: opening position', await h.gd('key'), k0);
    await h.page.keyboard.press('ArrowRight');
    await h.idle();
    await h.page.keyboard.press('r');
    eq('restart key', await h.gd('key'), k0);

    // ---------------------------------------------------------------- 5. tap to walk, tap Wren
    console.log('level: taps, long-press, hint');
    await h.gd('loadLevel', first.id);
    {
      // the farthest tile Wren can walk to right now, by the real rules
      const s = engine.parseLevel(first);
      let far = null;
      const seen = new Map([[`${s.wren.x},${s.wren.y}`, 0]]);
      const q = [[s.wren.x, s.wren.y]];
      while (q.length) {
        const [x, y] = q.shift();
        for (const [dx, dy] of Object.values(DIRV)) {
          const nx = x + dx;
          const ny = y + dy;
          if (seen.has(`${nx},${ny}`) || !engine.canEnter(s, 'wren', nx, ny)) continue;
          seen.set(`${nx},${ny}`, seen.get(`${x},${y}`) + 1);
          q.push([nx, ny]);
          far = { x: nx, y: ny, d: seen.get(`${nx},${ny}`) };
        }
      }
      if (far) {
        await h.tap(await h.tile(far.x, far.y));
        await h.page.waitForFunction(([x, y]) => {
          const w = window.__gd.state().wren;
          return w.x === x && w.y === y && !window.__gd.busy();
        }, [far.x, far.y], { timeout: 6000 }).catch(() => {});
        const w = (await h.gd('state')).wren;
        eq('tap to walk: Wren reaches the tapped tile', [w.x, w.y], [far.x, far.y]);
        eq('tap to walk: one move per tile', await h.gd('moves'), far.d);
      }
      // a tap on a wall far away does nothing
      const before = await h.gd('key');
      await h.tap(await h.tile(0, 0));
      await h.page.waitForTimeout(200);
      eq('tap on a wall: nothing moves', await h.gd('key'), before);
    }
    await h.gd('loadLevel', first.id);
    await h.tap(await h.wren());
    await h.idle();
    eq('tap Wren: lantern planted', (await h.gd('state')).lantern.carried, false);
    eq('tap Wren: counts as a move', await h.gd('moves'), 1);
    eq('lantern button label after planting', await h.page.locator('#btn-lantern .lbl').textContent(), 'Pick up');
    await h.tap(await h.wren());
    await h.idle();
    eq('tap Wren again: lantern picked up', (await h.gd('state')).lantern.carried, true);
    await h.page.locator('#btn-lantern').tap();
    await h.idle();
    eq('lantern button plants', (await h.gd('state')).lantern.carried, false);
    await h.swipe('E');
    await h.idle();
    eq('lantern button looks disabled away from the lantern', await h.page.locator('#btn-lantern').getAttribute('aria-disabled'), 'true');
    const kL = await h.gd('key');
    await h.page.locator('#btn-lantern').tap({ force: true });
    await h.page.waitForTimeout(150);
    eq('lantern button does nothing when not legal', await h.gd('key'), kL);
    await h.page.keyboard.press('.');
    await h.idle();
    eq('wait key spends a turn', await h.gd('moves'), 5);
    await h.page.locator('#btn-wait').tap();
    await h.idle();
    eq('wait button spends a turn', await h.gd('moves'), 6);

    // fast swiping: inputs during an animation are queued, at most two
    await h.gd('loadLevel', first.id);
    {
      const s = engine.parseLevel(first);
      const back = { N: 'S', S: 'N', E: 'W', W: 'E' };
      const d = ['E', 'S', 'W', 'N'].find((dir) => engine.step(s, dir));
      const seq = [d, back[d], d, back[d], d, back[d]];
      for (const dir of seq) await h.swipe(dir);
      await h.idle();
      await h.page.waitForTimeout(300);
      await h.idle();
      const n = await h.gd('moves');
      ok('fast swipes: queued, never more than two waiting', n >= 2 && n <= seq.length, n);
    }

    // ---------------------------------------------------------------- 6. long-press rule cards
    await h.gd('loadLevel', first.id);
    const cardCheck = async (what, x, y, title, text) => {
      await h.hold(await h.tile(x, y), 620);
      await h.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 2000 }).catch(() => {});
      eq(`rule card (${what}): title`, await h.page.locator('#card-title').textContent(), title);
      eq(`rule card (${what}): text as in SPEC`, await h.page.locator('#card-text').textContent(), text);
      ok(`rule card (${what}): visible`, await h.page.locator('#card').isVisible());
      await h.page.keyboard.press('Escape');
      eq(`rule card (${what}): Escape closes it`, await h.gd('panel'), null);
    };
    {
      const s = engine.parseLevel(first);
      const kBefore = await h.gd('key');
      await cardCheck('Wren', s.wren.x, s.wren.y, 'Wren', CARDS.Wren);
      const m = s.creatures.find((c) => c.type === 'M');
      if (m) await cardCheck('Fluffmoth', m.x, m.y, 'Fluffmoth', CARDS.Fluffmoth);
      const b = s.buds[0];
      await cardCheck('Glowbud', b.x, b.y, 'Glowbud', CARDS.Glowbud);
      const py = s.tiles.findIndex((row) => row.includes('~'));
      if (py >= 0) await cardCheck('Puddle', s.tiles[py].indexOf('~'), py, 'Puddle', CARDS.Puddle);
      eq('long-press never moves anything', await h.gd('key'), kBefore);
      // a short tap is not a long-press, and a hold on plain floor opens nothing
      await h.hold(await h.tile(0, 0), 620);
      eq('hold on a wall: no card', await h.gd('panel'), null);
    }

    // ---------------------------------------------------------------- 7. hint
    await h.gd('loadLevel', first.id);
    await h.page.locator('#btn-hint').tap();
    await h.page.waitForFunction(() => window.__gd.hint() !== null, null, { timeout: 8000 }).catch(() => {});
    eq('hint: points along the shortest solution', await h.gd('hint'), DIRV[sol[0]] ? sol[0] : 'ring');
    if (first.id === '1-1') eq('hint: level 1-1 starts east', await h.gd('hint'), 'E');
    eq('hint: counted', await h.gd('hints'), 1);
    ok('hint: status line says so', (await h.page.locator('#status').textContent()).startsWith('Hint:'));
    await h.page.keyboard.press(KEY_OF[sol[0]]);
    await h.idle();
    eq('hint: cleared by the next move', await h.gd('hint'), null);
    await playByKeys(h, sol.slice(1));
    await waitResult(h);
    eq('result after a hint: two star moss', await earned(h), 2);
    eq('result after a hint: saved', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 2 });
    await h.page.locator('#result-replay').tap();
    eq('replay: fresh attempt', [await h.gd('moves'), await h.gd('hints'), await h.gd('panel')], [0, 0, null]);

    // a dead end: hint says so and points at Undo
    await h.gd('loadLevelDef', { id: 'T-0', name: 'Dead End', map: ['######', '#WM~G#', '######'] });
    await h.gd('act', 'Z');
    await h.gd('act', 'L');
    await h.idle();
    // (planting parks nothing here; the cave may or may not be stuck, so only check the null path when it is)
    {
      const stuck = solver.nextMove(await h.gd('state'), { maxStates: 150000 }) === null;
      await h.page.locator('#btn-hint').tap();
      await h.page.waitForFunction(() => !document.querySelector('#btn-hint').classList.contains('thinking'));
      await h.page.waitForTimeout(100);
      if (stuck) {
        ok('hint in a dead end: gentle message', /No way forward/.test(await h.page.locator('#status').textContent()));
        ok('hint in a dead end: Undo pulses', (await h.page.locator('#btn-undo').getAttribute('class')).includes('pulse'));
      }
    }

    // ---------------------------------------------------------------- 8. solve 1-1 with touch swipes
    console.log('level: solve by touch and by keyboard');
    await h.gd('loadLevel', first.id);
    await playByTouch(h, sol);
    await waitResult(h);
    ok('touch solve: result panel visible', await h.page.locator('#result').isVisible());
    eq('touch solve: three star moss', await earned(h), 3);
    eq('touch solve: level name on the panel', await h.page.locator('#result-name').textContent(), first.name);
    ok('touch solve: moves and par on the panel', (await h.page.locator('#result-moves').textContent()).replace(/\s+/g, ' ').includes(`${sol.length} moves · par ${first.par}`),
      await h.page.locator('#result-moves').textContent());
    eq('touch solve: best saved', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 3 });
    eq('touch solve: Next level offered only when there is one', await h.page.locator('#result-next').isVisible(), LEVELS.length > 1);
    eq('touch solve: engine refuses moves after solving', await h.gd('act', 'Z'), false);
    await h.page.locator('#result-map').tap();
    eq('result: Map goes to the map', await h.gd('screen'), 'map');
    eq('map: three marks earned on the node', await h.page.locator(`.node[data-level="${first.id}"] .moss.on`).count(), 3);
    ok('map: node marked solved', (await h.page.locator(`.node[data-level="${first.id}"]`).getAttribute('class')).includes('solved'));
    if (LEVELS.length > 1) {
      ok('map: the next level unlocked', !(await h.page.locator(`.node[data-level="${LEVELS[1].id}"]`).getAttribute('class')).includes('locked'));
    }

    // ---------------------------------------------------------------- 9. progress survives a reload
    await h.page.reload();
    await h.page.waitForFunction(() => window.__gd && window.__gd.screen());
    eq('reload: opens on the title', await h.gd('screen'), 'title');
    eq('title: progress line counts lit caverns', (await h.page.locator('#title-progress').textContent()).trim(), `1 of ${LEVELS.length} caverns lit`);
    await h.toMap();
    eq('reload: record kept', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 3 });
    eq('reload: marks on the map', await h.page.locator(`.node[data-level="${first.id}"] .moss.on`).count(), 3);

    // keyboard solve, slower than par: two star moss, best stays
    await h.page.locator(`.node[data-level="${first.id}"]`).tap();
    await h.page.keyboard.press('.');
    await h.idle();
    await h.page.keyboard.press('u');
    await h.idle();
    eq('keyboard: U undoes', await h.gd('moves'), 0);
    await playByKeys(h, sol);
    await waitResult(h);
    eq('keyboard solve: three star moss', await earned(h), 3);
    await h.page.keyboard.press('r');
    eq('result: R replays', [await h.gd('panel'), await h.gd('moves')], [null, 0]);
    // WASD and Space
    for (const m of sol) {
      await h.page.keyboard.press({ N: 'w', E: 'd', S: 's', W: 'a', L: 'l', Z: '.' }[m]);
      await h.idle();
    }
    await waitResult(h);
    eq('WASD solve: solved', (await h.gd('state')).solved, true);
    await h.page.keyboard.press('Backspace');
    eq('Backspace undoes out of the result panel', [await h.gd('panel'), await h.gd('moves')], [null, sol.length - 1]);
    await h.page.keyboard.press('.');
    await h.idle();
    if (!(await h.gd('state')).solved) {
      await h.page.keyboard.press(KEY_OF[sol[sol.length - 1]]);
      await h.idle();
    }
    await waitResult(h);
    eq('slower solve: par mark missed', await earned(h), 2);
    eq('slower solve: best is kept', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 3 });
    ok('result: best line shown', /best/i.test(await h.page.locator('#result-best').textContent()));
    await h.page.keyboard.press('Escape');
    eq('Escape on the result goes to the map', await h.gd('screen'), 'map');

    // ---------------------------------------------------------------- 10. settings
    console.log('settings');
    eq('contrast: off by default', await h.page.locator('#set-contrast').getAttribute('aria-pressed'), 'false');
    await h.page.locator('#set-contrast').tap();
    eq('contrast: toggles on', await h.page.locator('#set-contrast').getAttribute('aria-pressed'), 'true');
    eq('contrast: state text', await h.page.locator('#set-contrast .val').textContent(), 'on');
    ok('contrast: app class', await h.page.evaluate(() => document.getElementById('app').classList.contains('hc')));
    eq('contrast: saved', (await h.gd('save')).settings.contrast, true);
    await h.page.locator('#set-sound').tap();
    eq('sound: toggles off', [await h.page.locator('#set-sound').getAttribute('aria-pressed'), await h.page.locator('#set-sound .val').textContent()], ['false', 'off']);
    await h.page.reload();
    await h.page.waitForFunction(() => window.__gd && window.__gd.screen());
    await h.toMap();
    eq('contrast: persists over a reload', await h.page.locator('#set-contrast').getAttribute('aria-pressed'), 'true');
    ok('contrast: app class after reload', await h.page.evaluate(() => document.getElementById('app').classList.contains('hc')));
    eq('sound: persists over a reload', await h.page.locator('#set-sound').getAttribute('aria-pressed'), 'false');
    await h.gd('loadLevel', first.id);
    eq('contrast: handed to the board', await h.page.evaluate(() => window.__gd.contrast()), true);
    await h.page.locator('#back').tap();
    await h.page.locator('#set-contrast').tap();
    await h.page.locator('#set-sound').tap();
    eq('contrast: toggles off again', (await h.gd('save')).settings, { sound: true, contrast: false, unlockAll: false, tutorials: true });

    await h.page.locator('#set-unlock').tap();
    eq('unlock all: nothing locked', await h.page.locator('.node.locked').count(), 0);
    await h.page.locator('#set-unlock').tap();

    await h.page.locator('#set-reset').tap();
    ok('reset: asks first, inside the page', await h.page.locator('#confirm').isVisible());
    eq('reset: the question sits above the settings', await confirmClear(h), true);
    await h.page.locator('#confirm-no').tap();
    eq('reset: Keep keeps', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 3 });
    await h.page.locator('#set-reset').tap();
    await h.page.locator('#confirm-yes').tap();
    eq('reset: Erase erases', (await h.gd('save')).levels, {});
    eq('reset: map shows no marks', await h.page.locator('.node .moss.on').count(), 0);
    ok('reset: panel closed', !(await h.page.locator('#confirm').isVisible()));
    await h.page.reload();
    await h.page.waitForFunction(() => window.__gd && window.__gd.screen());
    eq('reset: survives a reload', (await h.gd('save')).levels, {});

    // ---------------------------------------------------------------- 11. URL parameters
    await h.open(`?level=${first.id}`);
    eq('?level opens the level', [await h.gd('screen'), (await h.gd('state')).turn], ['level', 0]);
    await h.open('?unlock=1');
    await h.toMap();
    eq('?unlock=1 unlocks everything', await h.page.locator('.node.locked').count(), 0);
    await h.open('?level=no-such-level');
    eq('?level with an unknown id stays on the title', await h.gd('screen'), 'title');

    // ---------------------------------------------------------------- 12. ad-hoc levels
    console.log('ad-hoc levels');
    await h.open();
    for (const name of ['whelk', 'stump', 'newt', 'ember', 'trio']) {
      const def = ADHOC[name];
      const moves = solutionOf(def);
      eq(`ad-hoc ${name}: loads`, await h.gd('loadLevelDef', def), true);
      eq(`ad-hoc ${name}: on the level screen`, await h.gd('screen'), 'level');
      await h.page.waitForTimeout(250);
      if (def.tip) eq(`ad-hoc ${name}: tip shown before the first move`, await h.page.locator('#status').textContent(), def.tip);
      ok(`ad-hoc ${name}: note never shown`, !(await h.page.locator('#screen-level').textContent()).includes('DESIGNER NOTE'));
      // play it with a mix of inputs: keys for the first half, touch for the rest
      const half = Math.floor(moves.length / 2);
      await playByKeys(h, moves.slice(0, half));
      if (def.tip) ok(`ad-hoc ${name}: tip gone after the first move`, (await h.page.locator('#status').textContent()) !== def.tip);
      await playByTouch(h, moves.slice(half));
      await waitResult(h).catch(() => {});
      eq(`ad-hoc ${name}: solved through the UI in ${moves.length}`, [(await h.gd('state')).solved, await h.gd('moves')], [true, moves.length]);
      eq(`ad-hoc ${name}: not written to the save`, Object.keys((await h.gd('save')).levels), []);
      ok(`ad-hoc ${name}: no Next button`, !(await h.page.locator('#result-next').isVisible()));
    }

    // whelk: the gate really opens and closes on screen state, and the cards are right
    await h.gd('loadLevelDef', ADHOC.whelk);
    {
      const s = engine.parseLevel(ADHOC.whelk);
      const w = s.creatures[0];
      await cardCheck('Shellwhelk', w.x, w.y, 'Shellwhelk', CARDS.Shellwhelk);
      await cardCheck('root', 5, 1, 'Pressure root and gate', CARDS['Pressure root and gate']);
      await cardCheck('gate', 4, 2, 'Pressure root and gate', CARDS['Pressure root and gate']);
      const moves = solutionOf(ADHOC.whelk);
      let opened = false;
      for (const m of moves) {
        await h.gd('act', m);
        if ((await h.gd('state')).gates.A) opened = true;
      }
      ok('ad-hoc whelk: gate A opened on the way', opened);
    }
    await h.gd('loadLevelDef', ADHOC.stump);
    {
      const s = engine.parseLevel(ADHOC.stump);
      const t = s.creatures[0];
      await cardCheck('Stumpcap', t.x, t.y, 'Stumpcap', CARDS.Stumpcap);
    }
    // newt: its card, and its markings glow in the dark where it wanders
    await h.gd('loadLevelDef', ADHOC.newt);
    {
      const s = engine.parseLevel(ADHOC.newt);
      const n = s.creatures[0];
      eq('ad-hoc newt: starts in the dark', s.lit[n.y * s.w + n.x], 0);
      await cardCheck('Dozer newt', n.x, n.y, 'Dozer newt', CARDS['Dozer newt']);
      await h.page.waitForTimeout(300);
      // bright pixels in a tile: the newt's tile against a plain dark floor tile two steps east
      const bright = (x, y) => h.page.evaluate(([tx, ty]) => {
        const L = window.__gd.layout();
        const c = document.querySelector('#screen-level canvas');
        const k = L.dpr;
        const d = c.getContext('2d').getImageData(Math.round((L.ox + tx * L.size) * k), Math.round((L.oy + ty * L.size) * k),
          Math.round(L.size * k), Math.round(L.size * k)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 300) n++;
        return n / (d.length / 4);
      }, [x, y]);
      const onNewt = await bright(n.x, n.y);
      const onFloor = await bright(n.x + 2, n.y);
      ok('ad-hoc newt: its markings glow in the dark', onNewt > 0.01 && onNewt > onFloor * 4, JSON.stringify({ onNewt, onFloor }));
    }
    // ember: its card; cold, its drips glow in the dark; caught, a flame burns on its wick
    {
      const bright = (x, y, over) => h.page.evaluate(([tx, ty, o]) => {
        const L = window.__gd.layout();
        const c = document.querySelector('#screen-level canvas');
        const k = L.dpr;
        const d = c.getContext('2d').getImageData(Math.round((L.ox + tx * L.size) * k), Math.round((L.oy + ty * L.size) * k),
          Math.round(L.size * k), Math.round(L.size * k)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > o) n++;
        return n / (d.length / 4);
      }, [x, y, over]);
      // the floor it is measured against is two steps from both the ember and the lantern's light
      const dark = { id: 'T-7', name: 'Cold Ember', map: ['#########', '#W....K.#', '#########'] };
      await h.gd('loadLevelDef', dark);
      await h.page.waitForTimeout(300);
      eq('ad-hoc ember: starts in the dark', engine.parseLevel(dark).lit[1 * 9 + 6], 0);
      const onEmber = await bright(6, 1, 300);
      const onFloor = await bright(4, 1, 300);
      ok('ad-hoc ember: a cold one\'s drips glow in the dark', onEmber > 0.006 && onEmber > onFloor * 4, JSON.stringify({ onEmber, onFloor }));
      await h.gd('loadLevelDef', ADHOC.ember);
      const s = engine.parseLevel(ADHOC.ember);
      const k = s.creatures[0];
      await cardCheck('Emberwick', k.x, k.y, 'Emberwick', CARDS.Emberwick);
      await h.page.waitForTimeout(200);
      const cold = await bright(k.x, k.y, 690);
      await h.gd('act', 'Z');
      await h.gd('act', 'Z');
      await h.idle();
      eq('ad-hoc ember: two lit turns and it catches', (await h.gd('state')).creatures[0].heat, 2);
      await h.page.waitForTimeout(200);
      const flame = await bright(k.x, k.y, 690);
      ok('ad-hoc ember: a flame burns on its wick once it catches', flame > 0.01 && flame > cold * 3, JSON.stringify({ cold, flame }));
      await h.shot('ember-glowing');
    }
    // trio: starts with a planted lantern, has Hush and two buds
    await h.gd('loadLevelDef', ADHOC.trio);
    {
      const s = await h.gd('state');
      eq('ad-hoc trio: lantern starts planted', s.lantern.carried, false);
      eq('ad-hoc trio: two buds, none in bloom', s.bloom, [0, 0]);
      eq('ad-hoc trio: lantern button disabled until Wren reaches it', await h.page.locator('#btn-lantern').getAttribute('aria-disabled'), 'true');
      await cardCheck('Hush', 4, 2, 'Hush', CARDS.Hush);
      await cardCheck('planted lantern', 4, 3, 'Wren', CARDS.Wren);
      ok('ad-hoc trio: status counts the buds', /0 of 2 Glowbuds in bloom/.test(await h.page.locator('#status').textContent()), await h.page.locator('#status').textContent());
      // walk to the lantern by tapping it, pick it up, carry it into the Hush
      await h.tap(await h.tile(4, 3));
      await h.page.waitForFunction(() => window.__gd.state().wren.x === 4 && !window.__gd.busy(), null, { timeout: 5000 }).catch(() => {});
      await h.tap(await h.wren());
      await h.idle();
      eq('ad-hoc trio: picked the lantern up', (await h.gd('state')).lantern.carried, true);
      await h.swipe('N');
      await h.idle();
      const dark = await h.gd('state');
      eq('ad-hoc trio: in the Hush nothing is lit', dark.lit.reduce((a, b) => a + b, 0), 0);
      await h.page.waitForTimeout(200);
      await h.page.locator('#btn-lantern').tap({ force: true });
      await h.page.waitForTimeout(150);
      eq('ad-hoc trio: cannot plant on Hush', (await h.gd('state')).lantern.carried, true);
      await h.swipe('N');
      await h.idle();
      await h.swipe('W');
      await h.idle();
      await h.swipe('W');
      await h.idle();
      const one = await h.gd('state');
      eq('ad-hoc trio: first bud in bloom', one.bloom, [1, 0]);
      ok('ad-hoc trio: status follows', /1 of 2 Glowbuds in bloom/.test(await h.page.locator('#status').textContent()));
      await h.page.locator('#btn-undo').tap();
      eq('ad-hoc trio: undo takes the bloom back', (await h.gd('state')).bloom, [0, 0]);
    }
    // a full-size board fits
    await h.gd('loadLevelDef', ADHOC.tall);
    {
      const L = await h.gd('layout');
      const c = await h.page.locator('#board').boundingBox();
      ok('full-size board: tile size at least 36', L.size >= 36, L.size);
      ok('full-size board: fits the canvas', L.ox >= 6 && L.oy >= 6 && L.ox + L.size * 9 <= c.width - 6 && L.oy + L.size * 11 <= c.height - 6, JSON.stringify(L));
    }
    eq('a malformed level is refused', await h.gd('loadLevelDef', { id: 'bad', map: ['#W', '#'] }), false);

    // ---------------------------------------------------------------- 12b. tutorials (SPEC section 12)
    console.log('tutorials');
    {
      const byId = (id) => LEVELS.find((l) => l.id === id);
      const t = await phone({ tag: 'tutorials' });
      const status = () => t.page.locator('#status').textContent();
      const hasClass = (id, cls) => t.page.evaluate(([i, c]) => document.getElementById(i).classList.contains(c), [id, cls]);
      const STUCK = 'Stuck? Hint shows the next move, and Undo steps back.';
      // pixels of the coach colour in the 3 x 3 tiles around (x, y): the pointer is really drawn
      const coachPixels = (x, y) => t.page.evaluate(([tx, ty]) => {
        const L = window.__gd.layout();
        const c = document.querySelector('#screen-level canvas');
        const k = L.dpr;
        const d = c.getContext('2d').getImageData(Math.round((L.ox + (tx - 1) * L.size) * k), Math.round((L.oy + (ty - 1) * L.size) * k),
          Math.round(L.size * 3 * k), Math.round(L.size * 3 * k)).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - 0x9C) < 26 && Math.abs(d[i + 1] - 0xF5) < 26 && Math.abs(d[i + 2] - 0xE3) < 26) n++;
        }
        return n;
      }, [x, y]);
      const act = async (moves) => {
        for (const m of moves) eq(`tutorials: ${m} is legal`, await t.gd('act', m), true);
        await t.idle();
      };

      await t.open();
      await t.toMap();
      eq('tutorials: the setting is on by default', [await t.page.locator('#set-tutorials').getAttribute('aria-pressed'), await t.page.locator('#set-tutorials .val').textContent()], ['true', 'on']);
      eq('tutorials: every settings label fits its button', await crampedSettings(t), []);

      // 1-1, first visit: guided, one step at a time
      const l11 = byId('1-1');
      await t.page.locator('.node[data-level="1-1"]').tap();
      await t.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('tutorials: 1-1 opens on its first step', await status(), l11.tutorial[0].say);
      eq('tutorials: the first step points at Wren with a swipe', await t.gd('coach'), { kind: 'wren', x: 1, y: 1, gesture: 'swipe-E' });
      await t.page.waitForTimeout(300);
      const lit = await coachPixels(1, 1);
      ok('tutorials: the pointer is drawn on the board', lit > 40, lit);
      await t.shot('tutorial-1-1');
      await playByTouch(t, ['E']);
      eq('tutorials: a swipe finishes the first step', await status(), l11.tutorial[1].say);
      eq('tutorials: the second step points at the bridge', await t.gd('coach'), { kind: 'tile', x: 4, y: 1, gesture: null });
      await playByTouch(t, ['E']);
      await t.gd('undo');
      eq('tutorials: undo never takes a step back', await status(), l11.tutorial[1].say);
      await t.gd('restart');
      eq('tutorials: restart goes back to the first step', await status(), l11.tutorial[0].say);
      await playByTouch(t, ['E', 'E', 'E']);
      eq('tutorials: arriving finishes a step', await status(), l11.tutorial[2].say);
      eq('tutorials: the last step points at the Glowbud', await t.gd('coach'), { kind: 'tile', x: 7, y: 1, gesture: null });
      await playByTouch(t, ['E', 'E']);
      await waitResult(t);
      eq('tutorials: solving ends it', await t.gd('coach'), null);
      await t.page.locator('#result-map').tap();
      await t.page.locator('.node[data-level="1-1"]').tap();
      await t.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('tutorials: a solved level shows its tip, not the tutorial', await status(), l11.tip);
      eq('tutorials: and nothing is pointed at', await t.gd('coach'), null);
      await t.page.waitForTimeout(250);
      const unlit = await coachPixels(1, 1);
      ok('tutorials: no pointer drawn', unlit < 10, unlit);

      // 1-6: a thumb-bar button, and a step that waits for the lantern to be planted
      const l16 = byId('1-6');
      await t.gd('loadLevel', '1-6');
      eq('tutorials: 1-6 points at the Wait button', [await status(), await hasClass('btn-wait', 'coach')], [l16.tutorial[0].say, true]);
      await act(['N']);
      eq('tutorials: the button stops pulsing', await hasClass('btn-wait', 'coach'), false);
      eq('tutorials: a planted-lantern step hides while the lantern is carried', await t.gd('coach'), null);
      await act(['S', 'L']);
      eq('tutorials: it shows once the lantern is down', [await status(), await t.gd('coach')], [l16.tutorial[1].say, { kind: 'tile', x: 1, y: 2, gesture: 'tap' }]);
      await act(['N', 'Z', 'S', 'L']);
      eq('tutorials: picking the lantern up finishes 1-6\'s tutorial', await t.gd('coach'), null);

      // 2-1: a new creature is met through its card
      const l21 = byId('2-1');
      await t.gd('loadLevel', '2-1');
      eq('tutorials: 2-1 opens the Shellwhelk card', [await t.gd('panel'), await t.page.locator('#card-title').textContent()], ['card', 'Shellwhelk']);
      await t.page.waitForTimeout(450);
      await t.page.locator('#card-close').tap();
      eq('tutorials: closing the card moves on', [await t.gd('panel'), await status()], [null, l21.tutorial[1].say]);
      eq('tutorials: the step points at the root', await t.gd('coach'), { kind: 'tile', x: 5, y: 4, gesture: null });
      await act(['E', 'E']);
      await t.gd('restart');
      eq('tutorials: restart skips the card', [await t.gd('panel'), await status()], [null, l21.tutorial[1].say]);

      // stuck: par + 6 moves on a level never solved
      const wander = (n) => Array.from({ length: n }, (_, i) => (i % 2 ? 'W' : 'E'));
      await act(wander(l21.par + 5));
      ok('tutorials: no nudge before par + 6', (await status()) !== STUCK);
      await act(['E']);
      eq('tutorials: the nudge at par + 6', [await status(), await hasClass('btn-hint', 'pulse')], [STUCK, true]);
      await t.shot('tutorial-stuck');
      await act(['W', 'E', 'W']);
      eq('tutorials: the nudge stays for three more moves', await status(), STUCK);
      await act(['E']);
      eq('tutorials: and goes after four', [(await status()) === STUCK, await hasClass('btn-hint', 'pulse')], [false, false]);
      await act(wander(12));
      ok('tutorials: once per visit', (await status()) !== STUCK);
      await t.gd('loadLevel', '2-1');
      await t.page.keyboard.press('Escape');
      await act(wander(l21.par + 6));
      eq('tutorials: the nudge comes back on the next visit', await status(), STUCK);
      await t.gd('undo');
      eq('tutorials: undo sends it away', [(await status()) === STUCK, await hasClass('btn-hint', 'pulse')], [false, false]);

      // the setting
      await t.page.locator('#back').tap();
      await t.page.locator('#set-tutorials').tap();
      eq('tutorials: the setting turns off', [await t.page.locator('#set-tutorials').getAttribute('aria-pressed'), await t.page.locator('#set-tutorials .val').textContent(), (await t.gd('save')).settings.tutorials], ['false', 'off', false]);
      await t.gd('loadLevel', '1-2');
      eq('tutorials off: the tip shows', await status(), byId('1-2').tip);
      eq('tutorials off: nothing is pointed at', await t.gd('coach'), null);
      await t.gd('loadLevel', '2-1');
      eq('tutorials off: no card', await t.gd('panel'), null);
      await act(wander(l21.par + 6));
      ok('tutorials off: no nudge', (await status()) !== STUCK);
      await t.page.reload();
      await t.page.waitForFunction(() => window.__gd && window.__gd.screen());
      await t.toMap();
      eq('tutorials off: persists over a reload', await t.page.locator('#set-tutorials').getAttribute('aria-pressed'), 'false');
      await t.page.locator('#set-tutorials').tap();
      await t.page.locator('#set-reset').tap();
      await t.page.locator('#confirm-yes').tap();
      await t.page.locator('.node[data-level="1-1"]').tap();
      await t.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('tutorials: resetting progress brings them back', await status(), l11.tutorial[0].say);
      await t.close();
    }

    // ---------------------------------------------------------------- 13. page behaviour
    console.log('page behaviour');
    await h.gd('loadLevel', first.id);
    const style = await h.page.evaluate(() => {
      const c = getComputedStyle(document.getElementById('board'));
      const b = getComputedStyle(document.body);
      const vp = document.querySelector('meta[name=viewport]').content;
      return { touch: c.touchAction, select: b.userSelect || b.webkitUserSelect, overflow: getComputedStyle(document.documentElement).overflow, vp, scroll: document.scrollingElement.scrollHeight - window.innerHeight };
    });
    eq('board: touch-action none', style.touch, 'none');
    eq('page: no text selection', style.select, 'none');
    ok('page: viewport-fit=cover', style.vp.includes('viewport-fit=cover'), style.vp);
    ok('page: nothing to scroll', style.scroll <= 0, style.scroll);
    eq('page: the level draws on one canvas', await h.page.locator('#screen-level canvas').count(), 1);
    eq('page: the only other canvas is the title picture', await h.page.locator('canvas:not(#screen-level canvas)').evaluateAll((els) => els.map((e) => e.id)), ['title-art']);
    // hidden page: the loop stops
    await h.page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await h.page.waitForTimeout(100);
    const f1 = (await h.gd('layout')).frames;
    await h.page.waitForTimeout(300);
    eq('hidden page: no frames drawn', (await h.gd('layout')).frames, f1);
    await h.page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await h.page.waitForTimeout(300);
    ok('visible again: frames resume', (await h.gd('layout')).frames > f1 + 5);
    // the map does not draw frames either
    await h.page.locator('#back').tap();
    const f2 = await h.page.evaluate(() => window.__gd.frames());
    await h.page.waitForTimeout(250);
    eq('map: the board loop is paused', await h.page.evaluate(() => window.__gd.frames()), f2);
    // rotation and resize
    await h.gd('loadLevelDef', ADHOC.tall);
    await h.page.setViewportSize({ width: 844, height: 390 });
    await h.page.waitForTimeout(300);
    {
      const L = await h.gd('layout');
      const c = await h.page.locator('#board').boundingBox();
      ok('landscape: board still fits', L.ox >= 0 && L.oy >= 0 && L.oy + L.size * 11 <= c.height + 0.5 && L.ox + L.size * 9 <= c.width + 0.5, JSON.stringify({ L, c }));
      eq('landscape: canvas backing store follows', await h.page.evaluate(() => document.getElementById('board').width), Math.round(c.width * L.dpr));
    }
    await h.page.setViewportSize({ width: 390, height: 844 });
    await h.page.waitForTimeout(300);
    await h.close();

    // ---------------------------------------------------------------- 14. other phones
    console.log('other contexts');
    {
      // storage that throws on every call
      const g = await phone({
        tag: 'no-storage',
        init: () => {
          const boom = () => { throw new Error('storage is off'); };
          Storage.prototype.getItem = boom;
          Storage.prototype.setItem = boom;
          Storage.prototype.removeItem = boom;
        },
      });
      await g.open();
      await g.toMap();
      eq('no storage: map renders', await g.page.locator('.node').count(), LEVELS.length);
      await g.page.locator(`.node[data-level="${first.id}"]`).tap();
      await playByTouch(g, sol);
      await waitResult(g);
      eq('no storage: solvable, three star moss', await earned(g), 3);
      await g.page.locator('#result-map').tap();
      eq('no storage: progress kept in memory', await g.page.locator(`.node[data-level="${first.id}"] .moss.on`).count(), 3);
      await g.page.locator('#set-contrast').tap();
      eq('no storage: settings still toggle', await g.page.locator('#set-contrast').getAttribute('aria-pressed'), 'true');
      await g.close();
    }
    {
      // reduced motion, device pixel ratio 3 (capped at 2)
      const g = await phone({ tag: 'reduced-motion', reducedMotion: 'reduce', dpr: 3 });
      await g.open(`?level=${first.id}`);
      const L = await g.gd('layout');
      eq('dpr: capped at 2', L.dpr, 2);
      eq('dpr: canvas is crisp', await g.page.evaluate(() => document.getElementById('board').width), 390 * 2);
      const t0 = Date.now();
      await playByTouch(g, sol);
      await waitResult(g);
      eq('reduced motion: solvable', await earned(g), 3);
      ok('reduced motion: quick', Date.now() - t0 < 6000, Date.now() - t0);
      await g.close();
    }
    for (const [tag, viewport] of [['small', { width: 360, height: 640 }], ['tablet', { width: 820, height: 1180 }]]) {
      const g = await phone({ tag, viewport });
      await g.open();
      {
        const b = await g.page.locator('#btn-play').boundingBox();
        ok(`${tag}: Play on screen`, b && b.x >= 0 && b.y >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height, JSON.stringify(b));
        const t = await g.page.locator('#screen-title h1').boundingBox();
        ok(`${tag}: title name fits`, t && t.x >= 0 && t.x + t.width <= viewport.width && t.y + t.height <= b.y, JSON.stringify(t));
      }
      await g.toMap();
      const over = await g.page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.node, .tool, .chapter, .title')) {
          const r = el.getBoundingClientRect();
          if (r.width && (r.left < -0.5 || r.right > window.innerWidth + 0.5)) out.push(el.className);
        }
        return out;
      });
      eq(`${tag}: nothing off the sides of the map`, over, []);
      eq(`${tag}: settings labels fit their buttons`, await crampedSettings(g), []);
      await g.page.locator('#set-reset').tap();
      eq(`${tag}: the reset question sits above the settings`, await confirmClear(g), true);
      await g.page.locator('#confirm-no').tap();
      await g.gd('loadLevelDef', ADHOC.tall);
      const L = await g.gd('layout');
      const c = await g.page.locator('#board').boundingBox();
      ok(`${tag}: full-size board fits, tiles at least 36`, L.size >= 36 && L.size <= 96 && L.ox >= 6 && L.oy >= 6 && L.oy + L.size * 11 <= c.height - 6, JSON.stringify(L));
      for (const id of ['btn-undo', 'btn-restart', 'btn-wait', 'btn-lantern', 'btn-hint', 'back']) {
        const b = await g.page.locator('#' + id).boundingBox();
        ok(`${tag}: ${id} at least 52 px and on screen`, b.width >= 52 && b.height >= 52 && b.x >= 0 && b.x + b.width <= viewport.width && b.y + b.height <= viewport.height, JSON.stringify(b));
      }
      const fit = await g.page.evaluate(() => {
        const out = [];
        for (const el of document.querySelectorAll('.tool .lbl, #level-name, #counter')) {
          if (el.scrollWidth > el.clientWidth + 1 && el.id !== 'level-name') out.push(el.textContent);
        }
        return out;
      });
      eq(`${tag}: labels are not cut off`, fit, []);
      await g.gd('loadLevel', first.id);
      await playByTouch(g, sol);
      await waitResult(g);
      await g.page.waitForTimeout(500);   // let the panel finish rising
      const panel = await g.page.locator('#result').boundingBox();
      ok(`${tag}: result panel on screen`, panel.x >= 0 && panel.y >= 0 && panel.x + panel.width <= viewport.width && panel.y + panel.height <= viewport.height, JSON.stringify(panel));
      await g.close();
    }
  }

  // ------------------------------------------------------------------ screenshots
  console.log('screenshots');
  await shots('', { width: 390, height: 844 }, 2);
  await shots('small', { width: 360, height: 640 }, 2);
  await shots('tablet', { width: 820, height: 1180 }, 1);

  await browser.close();

  for (const e of errors) console.log(`  ERROR ${e}`);
  const failed = results.filter((r) => !r.pass);
  console.log(`\nui-check: ${results.length - failed.length} of ${results.length} checks passed, ${errors.length} console or page errors`);
  console.log(`screenshots in ${SHOTS}`);
  if (failed.length || errors.length) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
