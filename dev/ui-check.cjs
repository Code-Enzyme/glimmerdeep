// Plays the built game in headless Chromium the way a phone would, and fails on anything broken.
//
//   node dev/ui-check.cjs              build, run every check, write screenshots to dev/ui-shots/
//   node dev/ui-check.cjs --no-build   reuse dist/glimmerdeep.html
//   node dev/ui-check.cjs --shots      only take the screenshots (phone, small phone, tablet)
//   node dev/ui-check.cjs --only=workshop   only the Workshop's checks (SPEC section 26), while working on it
//   node dev/ui-check.cjs --only=controls   only the controls' checks (SPEC section 27)
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
const ONLY = (args.find((a) => a.startsWith('--only=')) || '').slice('--only='.length);

const DIRV = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
const KEY_OF = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft', L: ' ', Z: '.' };
const SAVE_KEY = 'glimmerdeep.v1';   // the app's save in localStorage (src/ui/store.js)

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
  const { STORY, NOTES } = await import(pathToFileURL(path.join(ROOT, 'src/ui/story.js')).href);
  const { DAILY } = await import(pathToFileURL(path.join(ROOT, 'src/levels/daily.js')).href);
  const { NIGHT } = await import(pathToFileURL(path.join(ROOT, 'src/levels/night.js')).href);
  const { dailyLevel } = await import(pathToFileURL(path.join(ROOT, 'src/ui/daily.js')).href);
  const hints = await import(pathToFileURL(path.join(ROOT, 'src/ui/hints.js')).href);
  const { previewOf } = await import(pathToFileURL(path.join(ROOT, 'src/ui/preview.js')).href);
  const talkWords = await import(pathToFileURL(path.join(ROOT, 'src/ui/talk.js')).href);
  // A legal move from `state` that leaves the hint's way (SPEC section 18) and from which the level still solves.
  const offTheWay = (def, state) => {
    const ladder = new hints.HintLadder(engine.parseLevel(def), solutionOf(def), def.feature);
    for (const m of ['Z', 'W', 'N', 'S', 'E', 'L']) {
      const next = engine.step(state, m);
      if (next && !next.solved && ladder.at(next) < 0 && solver.solve(next, { maxStates: 150000 }).solved) return m;
    }
    throw new Error(`ui-check: no move off the way in ${def.id}`);
  };
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
    const tag = opts.tag || 'phone';
    // opts.seed: a save the check writes once, before the app first starts. (An init script that writes a save
    // whenever it finds none can, now and then, find none in a new tab of headless Chromium and write over the
    // real one.) The app writes nothing until something changes, so loading it once to reach its storage is safe.
    let seed = opts.seed ? JSON.stringify(opts.seed) : null;
    const watch = (pg) => {
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[${tag}] console: ${m.text()}`);
      });
      pg.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
      pg.on('dialog', (d) => {
        errors.push(`[${tag}] a native ${d.type()} dialog opened: ${d.message()}`);
        d.dismiss().catch(() => {});
      });
    };
    let page = await context.newPage();
    watch(page);
    let cdp = await context.newCDPSession(page);
    const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    const h = {
      context, page,
      open: async (query = '') => {
        if (seed) {
          await page.goto(URL0);
          await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, seed]);
          seed = null;
        }
        await page.goto(URL0 + query);
        await page.waitForFunction(() => window.__gd && window.__gd.screen());
      },
      // The app started again from its save, in a new tab of the same browser: what a relaunch does.
      reopen: async (query = '') => {
        await page.close();
        page = await context.newPage();
        watch(page);
        cdp = await context.newCDPSession(page);
        h.page = page;
        await h.open(query);
      },
      // the app opens on the title screen; Play goes to the map
      toMap: async () => {
        if ((await page.evaluate(() => window.__gd.screen())) === 'title') await page.locator('#btn-play').tap();
        // story pages that are due come first (SPEC section 13): read through them
        for (let i = 0; i < 12 && (await page.evaluate(() => window.__gd.screen())) === 'story'; i++) await page.locator('#story-next').tap();
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
  // The hidden critter (SPEC section 23): tapped in its corner of the tile, as a finger would, once it shows.
  async function tapCritter(h) {
    const c = await h.gd('critter');
    if (!c || !c.shows || c.found) return false;
    const p = await h.tile(c.x, c.y);
    await h.tap({ x: p.x + p.size * 0.25, y: p.y + p.size * 0.24 });
    await h.page.waitForFunction(() => window.__gd.critter().found, null, { timeout: 2000 });
    return true;
  }
  // sketch: also find the level's critter on the way (a tap, or C on the keyboard)
  async function playByTouch(h, moves, sketch = false) {
    for (const m of moves) {
      if (DIRV[m]) await h.swipe(m);
      else if (m === 'L') await h.tap(await h.wren());
      else await h.page.locator('#btn-wait').tap();
      await h.idle();
      if (sketch && !(await h.gd('state')).solved) await tapCritter(h);
    }
  }
  async function playByKeys(h, moves, sketch = false) {
    for (const m of moves) {
      await h.page.keyboard.press(KEY_OF[m]);
      await h.idle();
      if (!sketch || (await h.gd('state')).solved) continue;
      const c = await h.gd('critter');
      if (c && c.shows && !c.found) await h.page.keyboard.press('c');
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
  // Every visible button labelled for screen readers, none but Back in the top 12 percent (out of thumb
  // reach), no text under 14 px.
  const auditPage = async (ph, label) => {
    const a = await ph.page.evaluate(() => {
      const out = { unlabeled: [], high: [], small: [] };
      const H = window.innerHeight;
      const seen = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
      };
      for (const b of document.querySelectorAll('button')) {
        if (!seen(b)) continue;
        if (!(b.getAttribute('aria-label') || '').trim()) out.unlabeled.push(b.id || b.className);
        // Describe (SPEC section 28) is rare, and TalkBack finds it by focus, not by reach
        if (b.getBoundingClientRect().top < H * 0.12 && !['back', 'journal-back', 'workshop-back', 'editor-back', 'btn-describe'].includes(b.id)) out.high.push(b.id || b.className);
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
  const earned = (h) => h.page.locator('#result-marks li.earned').count();

  // ------------------------------------------------------------------ controls (SPEC section 27)
  async function controlsChecks() {
    console.log('controls');
    const seen = ['prologue', ...CHAPTERS.map((c) => 'ch' + c.id)];
    const c = await phone({ tag: 'controls', seed: { levels: {}, seen, critters: [], settings: { tutorials: false } } });
    const txt = async (sel) => ((await c.page.locator(sel).textContent()) || '').trim();
    const pressed = (sel) => c.page.locator(sel).getAttribute('aria-pressed');
    const box = (sel) => c.page.locator(sel).boundingBox();
    const openSheet = async () => {
      await c.page.locator('#set-comfort').tap();
      await c.page.waitForFunction(() => window.__gd.panel() === 'comfort');
    };
    const choose = async (sel) => {
      await c.page.locator(sel).scrollIntoViewIfNeeded();
      await c.page.locator(sel).tap();
    };
    const openFirst = async () => {
      await c.gd('loadLevel', first.id);
      if ((await c.gd('panel')) === 'card') await c.page.keyboard.press('Escape');
      await c.idle();
    };
    await c.open();
    await c.toMap();
    await openSheet();
    eq('controls: the Comfort sheet has Arrows, Hand and Swipe', await c.page.evaluate(() => [...document.querySelectorAll('#comfort h4')].map((h) => h.textContent)),
      ['Text size', 'Readable font', 'Motion', 'Arrows', 'Hand', 'Swipe', 'Board talk']);   // Board talk: SPEC section 28
    eq('controls: the defaults are pressed', await c.page.evaluate(() => [...document.querySelectorAll('#comfort .choice[aria-pressed="true"]')].map((b) => b.dataset.arrows || b.dataset.hand || b.dataset.swipe).filter(Boolean)),
      ['false', 'right', 'normal']);
    eq('controls: the choices', await c.page.evaluate(() => [...document.querySelectorAll('#comfort .choice[data-arrows], #comfort .choice[data-hand], #comfort .choice[data-swipe]')].map((b) => b.textContent)),
      ['Off', 'On', 'Right', 'Left', 'Short', 'Normal', 'Long']);
    await auditPage(c, 'controls sheet');

    // the arrows
    await c.page.keyboard.press('Escape');
    await openFirst();
    eq('controls: no arrows by default', await c.page.locator('#arrows').isVisible(), false);
    const plain = await c.gd('layout');
    await c.page.locator('#back').tap();
    await c.page.waitForFunction(() => window.__gd.screen() === 'map');
    await openSheet();
    await choose('#comfort .choice[data-arrows="true"]');
    eq('controls: arrows on, saved', [(await c.gd('save')).settings.arrows, await pressed('#comfort .choice[data-arrows="true"]')], [true, 'true']);
    eq('controls: the Comfort setting shows a change', await pressed('#set-comfort'), 'true');
    await c.page.keyboard.press('Escape');
    await openFirst();
    ok('controls: the arrows show in a level', await c.page.locator('#arrows').isVisible());
    eq('controls: west, north, south, east', await c.page.locator('#arrows .arrow').evaluateAll((els) => els.map((e) => [e.dataset.dir, e.getAttribute('aria-label')])),
      [['W', 'Step west'], ['N', 'Step north'], ['S', 'Step south'], ['E', 'Step east']]);
    {
      const canvas = await box('#board');
      const arrows = await box('#arrows');
      const bar = await box('.bar.tools');
      ok('controls: the arrows sit between the board and the thumb bar', canvas.y + canvas.height <= arrows.y + 1 && arrows.y + arrows.height <= bar.y + 1, JSON.stringify({ canvas, arrows, bar }));
      const one = await box('#arrows .arrow[data-dir="N"]');
      ok('controls: each arrow is a good size', one.width >= 52 && one.height >= 52, JSON.stringify(one));
      const L = await c.gd('layout');
      ok('controls: the board still has room', L.size >= 36 && L.size <= plain.size, JSON.stringify({ with: L.size, without: plain.size }));
    }
    await auditPage(c, 'level with arrows');
    await c.shot('controls-arrows');
    {
      const sol = solutionOf(first);
      for (const m of sol) {
        if (DIRV[m]) await c.page.locator(`#arrows .arrow[data-dir="${m}"]`).tap();
        else if (m === 'L') await c.page.locator('#btn-lantern').tap();
        else await c.page.locator('#btn-wait').tap();
        await c.idle();
      }
      await waitResult(c);
      eq('controls: a level solves with the arrows alone', [(await c.gd('state')).solved, await c.gd('moves')], [true, sol.length]);
      await c.page.locator('#result-replay').tap();
      await c.idle();
    }
    {
      const before = (await c.gd('state')).wren;
      const wall = engine.parseLevel(first).tiles[before.y][before.x - 1] === '#';
      await c.page.locator('#arrows .arrow[data-dir="W"]').tap();
      await c.idle();
      if (wall) eq('controls: an arrow into a wall is refused like a swipe', [(await c.gd('state')).wren, await c.gd('moves')], [before, 0]);
    }

    // the left hand
    await c.page.locator('#back').tap();
    await c.page.waitForFunction(() => window.__gd.screen() === 'map');
    await openSheet();
    await choose('#comfort .choice[data-hand="left"]');
    eq('controls: left hand, saved', (await c.gd('save')).settings.hand, 'left');
    await c.page.keyboard.press('Escape');
    await openFirst();
    {
      const back = await box('#back');
      const counter = await box('#counter');
      const hint = await box('#btn-hint');
      const undo = await box('#btn-undo');
      const w = await box('#arrows .arrow[data-dir="W"]');
      const e = await box('#arrows .arrow[data-dir="E"]');
      ok('controls: left hand puts Back on the right of the counter', back.x > counter.x, JSON.stringify({ back, counter }));
      ok('controls: and Hint at the left, Undo at the right', hint.x < undo.x, JSON.stringify({ hint, undo }));
      ok('controls: the arrows keep their order', w.x < e.x, JSON.stringify({ w, e }));
      ok('controls: everything still on screen', back.x + back.width <= 390 && counter.x >= 0 && undo.x + undo.width <= 390 && hint.x >= 0);
    }
    await c.shot('controls-left');

    // swipe length: a swipe of 30 px steps with Normal and Short, not with Long; 18 px only with Short
    const steps = async (dist) => {
      await c.page.keyboard.press('r');
      await c.idle();
      const from = { x: 195, y: (await c.tile(0, 0)).y + 30 };
      await c.swipe('E', from, dist);
      await c.page.waitForTimeout(150);
      await c.idle();
      return c.gd('moves');
    };
    const setSwipe = async (v) => {
      await c.page.locator('#back').tap();
      await c.page.waitForFunction(() => window.__gd.screen() === 'map');
      await openSheet();
      await choose(`#comfort .choice[data-swipe="${v}"]`);
      await c.page.keyboard.press('Escape');
      await openFirst();
    };
    const east = engine.step(engine.parseLevel(first), 'E');
    if (east) {
      eq('controls: Normal: 18 px is not a step, 30 px is', [await steps(18), await steps(30)], [0, 1]);
      await setSwipe('long');
      eq('controls: Long: 30 px is not a step, 48 px is', [await steps(30), await steps(48)], [0, 1]);
      await setSwipe('short');
      eq('controls: Short: 18 px is a step', await steps(18), 1);
    } else {
      ok('controls: the first level can step east from the start', false);
    }

    // kept over a reload, and by Reset progress
    await c.page.reload();
    await c.page.waitForFunction(() => window.__gd && window.__gd.screen());
    await c.toMap();
    const keep = async () => {
      const s = (await c.gd('save')).settings;
      return [s.arrows, s.hand, s.swipe];
    };
    eq('controls: kept over a reload', await keep(), [true, 'left', 'short']);
    await c.page.locator('#set-reset').tap();
    await c.page.locator('#confirm-yes').tap();
    eq('controls: Reset progress keeps them', await keep(), [true, 'left', 'short']);
    await c.close();

    // a small phone: the sheet's heading and Done on screen, the last choice in reach
    const sm = await phone({ tag: 'controls-small', viewport: { width: 360, height: 640 }, seed: { levels: {}, seen, critters: [], settings: { tutorials: false } } });
    await sm.open();
    await sm.toMap();
    await sm.page.locator('#set-comfort').tap();
    await sm.page.waitForFunction(() => window.__gd.panel() === 'comfort');
    const within = async (sel) => {
      const b = await sm.page.locator(sel).boundingBox();
      return !!b && b.y >= 0 && b.y + b.height <= 640 ? true : `${sel} ${JSON.stringify(b)}`;
    };
    eq('controls: on a small phone the heading and Done are on screen', [await within('#comfort-title'), await within('#comfort-close')], [true, true]);
    await sm.page.locator('#comfort .sheet-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // the last choice is Board talk's since SPEC section 28
    eq('controls: the last choice scrolls into view, Done still there', [await within('#comfort .choice[data-talk="true"]'), await within('#comfort-close')], [true, true]);
    await sm.shot('controls-small-sheet');
    // with the arrows on, a small phone's board keeps tiles of 30 px or more
    await sm.page.locator('#comfort .choice[data-arrows="true"]').scrollIntoViewIfNeeded();
    await sm.page.locator('#comfort .choice[data-arrows="true"]').tap();
    await sm.page.keyboard.press('Escape');
    await sm.gd('loadLevel', first.id);
    if ((await sm.gd('panel')) === 'card') await sm.page.keyboard.press('Escape');
    {
      const L = await sm.gd('layout');
      ok('controls: small phone, arrows on: tiles of 30 px or more', L.size >= 30, JSON.stringify(L));
      const arrows = await sm.page.locator('#arrows').boundingBox();
      const bar = await sm.page.locator('.bar.tools').boundingBox();
      ok('controls: small phone, arrows and bar on screen', arrows.y >= 0 && bar.y + bar.height <= 640 + 1, JSON.stringify({ arrows, bar }));
    }
    await sm.shot('controls-small-level');
    await sm.close();
  }

  // ------------------------------------------------------------------ the Workshop (SPEC section 26)
  async function workshopChecks() {
    console.log('workshop');
    const ws = await import(pathToFileURL(path.join(ROOT, 'src/ui/workshop.js')).href);
    const codes = await import(pathToFileURL(path.join(ROOT, 'src/ui/codes.js')).href);
    const seen = ['prologue', ...CHAPTERS.map((c) => 'ch' + c.id)];
    const mossmouth = {};
    CHAPTERS[0].levels.forEach((def) => { mossmouth[def.id] = { moves: def.par, stars: 3 }; });
    const shop = { full: true, glimmer: 3, freeAt: 0, paid: [] };

    // a phone with helpers for the editor's canvas
    const studio = async (opts) => {
      const h = await phone(opts);
      // h.page changes when the app is started again (h.reopen), so every helper reads it when it runs
      let cdp = null;
      let cdpPage = null;
      const touch = async (type, touchPoints) => {
        if (cdpPage !== h.page) {
          cdp = await h.context.newCDPSession(h.page);
          cdpPage = h.page;
        }
        await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      };
      const etile = async (x, y) => {
        const L = await h.gd('editorLayout');
        return { x: L.left + L.ox + (x + 0.5) * L.size, y: L.top + L.oy + (y + 0.5) * L.size, size: L.size };
      };
      return Object.assign(h, {
        txt: async (sel) => ((await h.page.locator(sel).textContent()) || '').trim(),
        etile,
        drag: async (from, to) => {
          const a = await etile(from[0], from[1]);
          const b = await etile(to[0], to[1]);
          await touch('touchStart', [{ x: a.x, y: a.y, id: 1 }]);
          for (let i = 1; i <= 8; i++) await touch('touchMove', [{ x: a.x + ((b.x - a.x) * i) / 8, y: a.y + ((b.y - a.y) * i) / 8, id: 1 }]);
          await touch('touchEnd', []);
        },
        tapTile: async (x, y) => {
          const p = await etile(x, y);
          await touch('touchStart', [{ x: p.x, y: p.y, id: 1 }]);
          await touch('touchEnd', []);
        },
        ed: () => h.gd('editor'),
        tool: (id) => h.page.locator(`#editor-tools .paint-tool[data-tool="${id}"]`).tap(),
        lastHeard: async () => (await h.gd('heard')).slice(-1)[0],
        screenIs: (name) => h.page.waitForFunction((n) => window.__gd.screen() === n, name, { timeout: 4000 }),
        panelIs: (name) => h.page.waitForFunction((n) => window.__gd.panel() === n, name, { timeout: 4000 }),
        inView: async (sel, W, H) => {
          const b = await h.page.locator(sel).boundingBox();
          return !!b && b.x >= -1 && b.y >= -1 && b.x + b.width <= W + 1 && b.y + b.height <= H + 1 ? true : `${sel} ${JSON.stringify(b)}`;
        },
      });
    };

    // ---- closed until Mossmouth is lit
    {
      const w = await studio({ tag: 'workshop-closed', seed: { levels: {}, seen, critters: [], shop, settings: { tutorials: false } } });
      await w.open();
      await w.toMap();
      ok('workshop: the map has a Workshop card', await w.page.locator('#workshop-card').isVisible());
      eq('workshop: it comes after the Night Garden', await w.page.evaluate(() => {
        const list = [...document.querySelectorAll('#chapters > section')];
        return list.indexOf(document.getElementById('workshop-card')) === list.length - 1 && list.indexOf(document.getElementById('garden')) === list.length - 2;
      }), true);
      eq('workshop: closed, it says when it opens', await w.txt('#workshop-note'), 'Opens when Mossmouth is lit.');
      eq('workshop: its button is disabled', await w.page.locator('#workshop-open').getAttribute('aria-disabled'), 'true');
      await w.page.locator('#workshop-open').tap({ force: true });
      eq('workshop: a tap on it is refused', [await w.gd('screen'), await w.lastHeard()], ['map', 'blocked']);
      await w.page.locator('#set-unlock').tap();
      eq('workshop: Unlock all opens it', await w.page.locator('#workshop-open').getAttribute('aria-disabled'), null);
      await w.close();
    }

    // ---- Mossmouth lit: make a cavern
    const w = await studio({ tag: 'workshop', seed: { levels: { ...mossmouth }, seen, critters: [], shop, settings: { tutorials: false } } });
    await w.open();
    await w.toMap();
    eq('workshop: open, it says what it is', await w.txt('#workshop-note'), 'Make your own caverns and share them with a code.');
    eq('workshop: no caverns yet', await w.txt('#workshop-tally'), 'No caverns yet');
    await w.page.locator('#workshop-card').scrollIntoViewIfNeeded();
    await w.shot('workshop-card');
    await w.page.locator('#workshop-open').tap();
    await w.screenIs('workshop');
    eq('workshop: the screen opens empty', [await w.page.locator('#caverns .cavern').count(), await w.txt('#workshop-count')], [0, '0 of 12']);
    eq('workshop: it says what to do', await w.txt('.workshop-intro'), 'Make your own caverns and share them with a code.');
    await auditPage(w, 'workshop');
    await w.page.keyboard.press('Escape');
    eq('workshop: Escape (Back) goes to the map', await w.gd('screen'), 'map');
    await w.page.locator('#workshop-open').tap();
    await w.screenIs('workshop');

    await w.page.locator('#workshop-new').tap();
    await w.screenIs('editor');
    let made = (await w.gd('save')).workshop;
    eq('editor: New cavern makes one and saves it', made.length, 1);
    const seed = made[0].seed;
    eq('editor: a new cavern is the 7 by 7 starter', made[0].map, ws.newCavern(seed).map);
    eq('editor: the top shows its name and size', [await w.txt('#editor-name'), await w.txt('#editor-size')], [ws.cavernName(seed), '7 by 7']);
    const met = ws.metInWorkshop({ levels: mossmouth }, [...LEVELS, ...NIGHT], false);
    eq('editor: the tools are the ones met in Mossmouth, in order',
      await w.page.locator('#editor-tools .paint-tool').evaluateAll((els) => els.map((e) => e.dataset.tool)), met.tools);
    eq('editor: every tool has a picture and a label',
      await w.page.locator('#editor-tools .paint-tool').evaluateAll((els) => els.every((e) => /url\(/.test(e.querySelector('.tool-art').style.backgroundImage) && e.getAttribute('aria-label'))), true);
    eq('editor: Wall is chosen to start', [(await w.ed()).tool, await w.page.locator('.paint-tool[aria-pressed="true"]').getAttribute('data-tool')], ['wall', 'wall']);
    eq('editor: the status says how to paint', await w.txt('#editor-status'), 'Wall: tap or drag to paint.');
    {
      const px = await w.page.evaluate(() => {
        const c = document.getElementById('editor-canvas');
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        const colours = new Set();
        for (let i = 0; i < d.length; i += 4 * 97) colours.add(`${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`);
        return { w: c.width, colours: colours.size };
      });
      ok('editor: the cavern is drawn', px.w > 100 && px.colours > 20, JSON.stringify(px));
    }
    await auditPage(w, 'editor');
    await w.shot('editor');

    // painting: a tap, a drag, undo by strokes
    await w.tapTile(2, 1);
    eq('editor: a tap paints a wall', (await w.ed()).map[1][2], '#');
    eq('editor: and the cavern is saved', (await w.gd('save')).workshop[0].map[1][2], '#');
    await w.tool('puddle');
    eq('editor: picking a tool says so', [await w.txt('#editor-status'), await w.page.locator('.paint-tool[aria-pressed="true"]').getAttribute('data-tool')],
      ['Puddle: tap or drag to paint.', 'puddle']);
    await w.drag([1, 5], [5, 5]);
    eq('editor: a drag paints every tile it passes', (await w.ed()).map[5], '#~~~~~#');
    await w.page.locator('#editor-undo').tap();
    eq('editor: Undo takes back the whole drag', [(await w.ed()).map[5], (await w.ed()).map[1][2]], ['#.....#', '#']);
    await w.page.locator('#editor-undo').tap();
    eq('editor: and then the tap', (await w.ed()).map[1][2], '.');
    eq('editor: Undo is saved too', (await w.gd('save')).workshop[0].map, ws.newCavern(seed).map);
    await w.page.locator('#editor-undo').tap();
    eq('editor: nothing left to undo is refused', await w.lastHeard(), 'blocked');

    // Wren moves, and is never painted over
    await w.tool('wren');
    await w.tapTile(3, 2);
    eq('editor: Wren moves where you tap', [(await w.ed()).map[2][3], (await w.ed()).map[3][1]], ['W', '.']);
    await w.tool('wall');
    await w.tapTile(3, 2);
    eq('editor: a wall is not painted over Wren', [(await w.ed()).map[2][3], await w.lastHeard()], ['W', 'blocked']);
    await w.tool('wren');
    await w.tapTile(1, 3);
    eq('editor: Wren back home', (await w.ed()).map, ws.newCavern(seed).map);

    // check, share, play
    eq('editor: Share waits for a check', await w.page.locator('#editor-share').getAttribute('aria-disabled'), 'true');
    await w.page.locator('#editor-share').tap({ force: true });
    eq('editor: Share before a check says why', [await w.gd('panel'), await w.txt('#editor-status'), await w.lastHeard()],
      [null, 'Check it first: a code carries its par.', 'blocked']);
    await w.page.locator('#editor-check').tap();
    const want = ws.checkCavern(ws.newCavern(seed));
    await w.page.waitForFunction(() => window.__gd.editor().check !== null, null, { timeout: 8000 });
    eq('editor: Check finds the par', [await w.txt('#editor-status'), (await w.ed()).check, (await w.ed()).par], [want.text, 'lit', want.par]);
    eq('editor: the check is saved', [(await w.gd('save')).workshop[0].check, (await w.gd('save')).workshop[0].par], ['lit', want.par]);
    eq('editor: Share is ready', await w.page.locator('#editor-share').getAttribute('aria-disabled'), 'false');
    await w.page.locator('#editor-share').tap();
    await w.panelIs('share');
    const code = codes.encodeCavern({ ...ws.newCavern(seed), par: want.par });
    eq('share: the code and the name', [await w.txt('#share-code'), await w.txt('#share-name')], [code, ws.cavernName(seed)]);
    await w.page.evaluate(() => {
      const writeText = (t) => { window.__copied = t; return Promise.resolve(); };
      try { Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); } catch (e) { navigator.clipboard.writeText = writeText; }
    });
    await w.page.locator('#share-copy').tap();
    await w.page.waitForFunction(() => document.getElementById('share-note').textContent === 'Copied.', null, { timeout: 2000 }).catch(() => {});
    eq('share: Copy copies it', [await w.page.evaluate(() => window.__copied), await w.txt('#share-note')], [code, 'Copied.']);
    eq('share: Done on screen', await w.inView('#share-close', 390, 844), true);
    await auditPage(w, 'share');
    await w.shot('workshop-share');
    await w.page.locator('#share-close').tap();
    eq('share: Done closes it', await w.gd('panel'), null);

    const before = await w.gd('save');
    await w.page.locator('#editor-play').tap();
    await w.screenIs('level');
    eq('play: it plays as your cavern', [await w.txt('#level-id'), await w.txt('#level-name')], ['Your cavern', ws.cavernName(seed)]);
    eq('play: Back is labelled for the editor', await w.page.locator('#back').getAttribute('aria-label'), 'Back to the editor');
    await w.page.locator('#back').tap();
    await w.screenIs('editor');
    eq('play: Back returns to the editor', (await w.ed()).map, ws.newCavern(seed).map);
    await w.page.locator('#editor-play').tap();
    await w.screenIs('level');
    await playByKeys(w, solutionOf(ws.levelDef({ ...ws.newCavern(seed), par: want.par })));
    await waitResult(w);
    eq('play: lit', [await w.txt('#result-id'), await w.page.locator('#result-next').isVisible(), await w.txt('#result-map')], ['Your cavern lit', false, 'Back']);
    eq('play: it records nothing and pays nothing',
      [(await w.gd('save')).levels, (await w.gd('save')).shop, (await w.gd('save')).critters], [before.levels, before.shop, before.critters]);
    await w.shot('workshop-lit');
    await w.page.keyboard.press('r');
    await w.page.waitForFunction(() => window.__gd.panel() === null && window.__gd.moves() === 0, null, { timeout: 4000 });
    eq('play: R replays it, and Back still goes to the editor', [await w.txt('#level-id'), await w.page.locator('#back').getAttribute('aria-label')],
      ['Your cavern', 'Back to the editor']);
    await playByKeys(w, solutionOf(ws.levelDef({ ...ws.newCavern(seed), par: want.par })));
    await waitResult(w);
    await w.page.locator('#result-map').tap();
    await w.screenIs('editor');
    eq('play: the result\'s Back returns to the editor', (await w.ed()).check, 'lit');

    // any change clears the check
    await w.tool('wall');
    await w.tapTile(3, 1);
    eq('editor: a change clears the check', [(await w.ed()).check, (await w.ed()).par, await w.page.locator('#editor-share').getAttribute('aria-disabled')], [null, null, 'true']);
    // a cavern that cannot be lit
    for (const [x, y] of [[4, 2], [4, 3], [4, 4], [5, 2], [5, 4]]) await w.tapTile(x, y);
    await w.page.locator('#editor-check').tap();
    await w.page.waitForFunction(() => window.__gd.editor().check !== null, null, { timeout: 8000 });
    eq('editor: a shut-in Glowbud cannot be lit', [await w.txt('#editor-status'), (await w.ed()).check], ['Can\'t be lit: every way was tried.', 'unlit']);
    // a problem in plain words, and Play refuses it
    await w.tool('floor');
    await w.tapTile(5, 3);
    await w.tool('wall');
    await w.tapTile(5, 3);
    await w.page.locator('#editor-play').tap();
    eq('editor: Play with no Glowbud says what is missing', [await w.gd('screen'), await w.txt('#editor-status'), await w.lastHeard()], ['editor', 'Add a Glowbud.', 'blocked']);

    // size and options
    await w.page.locator('#editor-options').tap();
    await w.panelIs('cavern');
    eq('size: it shows the size', [await w.txt('#width-val'), await w.txt('#height-val')], ['7', '7']);
    eq('size: the Gloam option once a Gloam encounter is lit (1-11), no shutter option before one is met',
      [await w.page.locator('#opt-gloam-box').isVisible(), await w.page.locator('#opt-shutter-box').isVisible()], [met.gloam, met.shutter]);
    ok('size: Mossmouth has its Gloam encounter and no shutter', met.gloam && !met.shutter, JSON.stringify(met));
    await w.page.locator('#width-more').tap();
    eq('size: wider adds a wall column', [await w.txt('#width-val'), (await w.ed()).map[0].length, (await w.ed()).map[3][7], await w.txt('#editor-size')], ['8', 8, '#', '8 by 7']);
    await w.page.locator('#width-less').tap();
    await w.page.locator('#width-less').tap();
    eq('size: narrower takes the last column', (await w.ed()).map[0].length, 6);
    for (let i = 0; i < 4; i++) await w.page.locator('#height-less').tap();
    eq('size: shorter, until Wren is in the last row', [(await w.ed()).map.length, await w.txt('#cavern-why'), await w.lastHeard()],
      [4, 'Wren, a Glowbud or the lantern is in the last row. Move it first.', 'blocked']);
    eq('size: Done on screen', await w.inView('#cavern-close', 390, 844), true);
    await auditPage(w, 'size');
    await w.shot('workshop-size');
    await w.page.locator('#cavern-close').tap();
    eq('size: Done closes it', [await w.gd('panel'), await w.page.locator('#cavern-why').isVisible()], [null, false]);
    eq('size: the cavern is saved at its new size', (await w.gd('save')).workshop[0].map.length, 4);

    // back to the list
    await w.page.locator('#editor-back').tap();
    await w.screenIs('workshop');
    eq('workshop: the list shows the cavern', await w.page.locator('#caverns .cavern').count(), 1);
    eq('workshop: its row says name, size and check', await w.page.locator('#caverns .cavern').first().getAttribute('aria-label'),
      `${ws.cavernName(seed)}, 6 by 4, Not checked`);
    ok('workshop: with its picture', await w.page.locator('#caverns .cavern svg').count() === 1);
    eq('workshop: the count', await w.txt('#workshop-count'), '1 of 12');
    await w.page.locator('#caverns .cavern').first().tap();
    await w.screenIs('editor');
    eq('workshop: a tap on a row opens it', (await w.ed()).index, 0);
    await w.page.keyboard.press('Escape');
    eq('editor: Escape (Back) goes to the list', await w.gd('screen'), 'workshop');

    // play a code
    const shared = { ...ws.newCavern(500), map: ['#######', '#W.#..#', '#..#G.#', '#.....#', '#######'] };
    const sharedCheck = ws.checkCavern(shared);
    const sharedCode = codes.encodeCavern({ ...shared, par: sharedCheck.par });
    await w.page.locator('#workshop-code').tap();
    await w.panelIs('code');
    eq('code: Play a code opens its sheet, ready to type', [await w.page.locator('#code-input').isVisible(), await w.page.evaluate(() => document.activeElement.id)], [true, 'code-input']);
    const playIt = async () => {
      await w.page.locator('#code-play').tap();
      await w.page.waitForFunction(() => !window.__gd.checking(), null, { timeout: 8000 });
    };
    await playIt();
    eq('code: an empty code', [await w.txt('#code-why'), await w.gd('panel')], ['That code is not complete.', 'code']);
    const plain = sharedCode.replace(/-/g, '');
    await w.page.locator('#code-input').fill(plain.slice(0, 9) + (plain[9] === '7' ? '8' : '7') + plain.slice(10));
    await playIt();
    eq('code: a typo', await w.txt('#code-why'), 'That code has a typo in it.');
    await w.page.locator('#code-input').fill(codes.encodeCavern({ ...shared, par: sharedCheck.par + 1 }));
    await playIt();
    eq('code: a code whose par is wrong', await w.txt('#code-why'), 'That cavern can\'t be lit at its par.');
    eq('code: Play on screen above the keyboard line', await w.inView('#code-play', 390, 844), true);
    await auditPage(w, 'code');
    await w.shot('workshop-code');
    await w.page.locator('#code-input').fill(' ' + sharedCode.toLowerCase() + ' ');
    await w.page.locator('#code-input').press('Enter');
    await w.screenIs('level');
    eq('code: a good code plays as a shared cavern', [await w.txt('#level-id'), await w.txt('#level-name')], ['Shared cavern', ws.cavernName(500)]);
    eq('code: Back is labelled for the Workshop', await w.page.locator('#back').getAttribute('aria-label'), 'Back to the Workshop');
    await playByKeys(w, sharedCheck.par ? solutionOf(ws.levelDef({ ...shared, par: sharedCheck.par })) : []);
    await waitResult(w);
    eq('code: lit', [await w.txt('#result-id'), await w.txt('#result-moves')], ['Shared cavern lit', `${sharedCheck.par} moves  ·  par ${sharedCheck.par}`]);
    await w.page.locator('#result-map').tap();
    await w.screenIs('workshop');
    eq('code: playing a code changes nothing in your caverns', (await w.gd('save')).workshop.length, 1);

    // delete, asking twice
    await w.page.locator('#caverns .cavern').first().tap();
    await w.screenIs('editor');
    await w.page.locator('#editor-options').tap();
    await w.panelIs('cavern');
    await w.page.locator('#cavern-delete').tap();
    eq('delete: the first tap asks again', [await w.txt('#cavern-delete'), (await w.gd('save')).workshop.length], ['Delete for good?', 1]);
    await w.page.locator('#cavern-delete').tap();
    await w.screenIs('workshop');
    eq('delete: the second deletes it', [(await w.gd('save')).workshop.length, await w.page.locator('#caverns .cavern').count(), await w.gd('panel')], [0, 0, null]);

    // kept through a relaunch and Reset progress
    await w.page.locator('#workshop-new').tap();
    await w.screenIs('editor');
    await w.reopen();
    await w.toMap();
    eq('workshop: caverns are kept when the app starts again', (await w.gd('save')).workshop.length, 1);
    await w.page.locator('#set-reset').tap();
    await w.page.locator('#confirm-yes').tap();
    eq('workshop: Reset progress keeps them', (await w.gd('save')).workshop.length, 1);
    eq('workshop: but the card is closed again', await w.page.locator('#workshop-open').getAttribute('aria-disabled'), 'true');
    await w.close();

    // ---- everything met: the whole palette, turning, options, a full list, Android sizes
    const twelve = Array.from({ length: 12 }, (_, i) => ({ ...ws.newCavern(i * 80), par: null, check: null }));
    const all = await studio({ tag: 'workshop-all', seed: { levels: {}, seen, critters: [], shop, workshop: twelve, settings: { tutorials: false, unlockAll: true } } });
    await all.open();
    await all.toMap();
    eq('workshop: the card counts your caverns', await all.txt('#workshop-tally'), '12 caverns');
    await all.page.locator('#workshop-open').tap();
    await all.screenIs('workshop');
    eq('workshop: twelve is the most', [await all.txt('#workshop-count'), await all.page.locator('#workshop-full').isVisible()], ['12 of 12', true]);
    await all.page.locator('#workshop-new').tap({ force: true });   // aria-disabled, but a player can still tap it
    eq('workshop: New cavern is refused when full', [await all.gd('screen'), await all.lastHeard(), (await all.gd('save')).workshop.length], ['workshop', 'blocked', 12]);
    {
      const list = await all.page.locator('#cavern-list').evaluate((el) => ({ scroll: el.scrollHeight, client: el.clientHeight }));
      ok('workshop: a long list scrolls', list.scroll > list.client, JSON.stringify(list));
    }
    await all.shot('workshop-list');
    await all.page.locator('#caverns .cavern').nth(3).tap();
    await all.screenIs('editor');
    eq('editor: Unlock all shows every tool', await all.page.locator('#editor-tools .paint-tool').evaluateAll((els) => els.map((e) => e.dataset.tool)), ws.TOOLS.map((t) => t.id));
    await all.tool('stumpcap');
    eq('editor: a turning tool says so', await all.txt('#editor-status'), 'Stumpcap: tap one again to turn it.');
    await all.tapTile(3, 1);
    await all.tapTile(3, 1);
    eq('editor: a second tap turns it', (await all.ed()).map[1][3], '>');
    await all.drag([1, 1], [5, 1]);
    eq('editor: a drag passes over it without turning', (await all.ed()).map[1], '#^^>^^#');
    await all.page.locator('#editor-tools').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    eq('editor: the last tool scrolls into reach', await all.inView('.paint-tool[data-tool="beetle"]', 390, 844), true);
    await all.page.locator('#editor-options').tap();
    await all.panelIs('cavern');
    eq('size: the options show once met', [await all.page.locator('#opt-gloam-box').isVisible(), await all.page.locator('#opt-shutter-box').isVisible()], [true, true]);
    await all.page.locator('#cavern-sheet .choice[data-shutter="true"]').tap();
    eq('size: the shutter option is kept', (await all.ed()).shutter, true);
    eq('size: Done on screen with every option', await all.inView('#cavern-close', 390, 844), true);
    await all.page.keyboard.press('Escape');
    eq('size: Escape closes it', [await all.gd('panel'), await all.gd('screen')], [null, 'editor']);
    await all.shot('editor-all');
    await all.close();

    // ---- a small phone
    const sm = await studio({ tag: 'workshop-small', viewport: { width: 360, height: 640 }, seed: { levels: {}, seen, critters: [], shop, workshop: twelve.slice(0, 2), settings: { tutorials: false, unlockAll: true } } });
    await sm.open();
    await sm.toMap();
    await sm.page.locator('#workshop-open').tap();
    await sm.screenIs('workshop');
    eq('small: the Workshop buttons on screen', [await sm.inView('#workshop-new', 360, 640), await sm.inView('#workshop-code', 360, 640)], [true, true]);
    await sm.page.locator('#caverns .cavern').first().tap();
    await sm.screenIs('editor');
    {
      const L = await sm.gd('editorLayout');
      ok('small: the cavern gets room to paint', L && L.size >= 30, JSON.stringify(L));
    }
    for (const id of ['editor-undo', 'editor-options', 'editor-check', 'editor-play', 'editor-share']) {
      eq(`small: #${id} on screen`, await sm.inView(`#${id}`, 360, 640), true);
    }
    eq('small: the page does not scroll sideways', await sm.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await auditPage(sm, 'editor small');
    await sm.shot('editor-small');
    await sm.page.locator('#editor-options').tap();
    await sm.panelIs('cavern');
    eq('small: the size sheet\'s Done on screen', await sm.inView('#cavern-close', 360, 640), true);
    await sm.shot('editor-small-size');
    await sm.close();
  }

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
    for (let i = 0; i < 2; i++) {
      await h.page.locator('#btn-hint').tap();
      await h.page.waitForTimeout(120);
    }
    await h.page.waitForFunction(() => window.__gd.way() !== null);
    await h.shot(name('07b-hint-way'));

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

  if (!SHOTS_ONLY && !ONLY) {
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
    eq('title: on a fresh save Play opens the prologue first', [await h.gd('screen'), ((await h.gd('story')) || {}).id], ['story', 'prologue']);
    await h.page.locator('#story-next').tap();
    eq('title: then the map', await h.gd('screen'), 'map');
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
    eq('map: one section per chapter, and the Night Garden last', await h.page.locator('.chapter').count(), CHAPTERS.length + 1);
    eq('map: one node per level', await h.page.locator('.node').count(), LEVELS.length + NIGHT.length);
    for (const ch of CHAPTERS) {
      ok(`map: chapter name "${ch.name}" shown`, (await h.page.locator('.chapter h2').allTextContents()).includes(ch.name));
    }
    eq('map: empty chapters carry a note', await h.page.locator('.chapter .empty').count(), CHAPTERS.filter((c) => !c.levels.length).length);
    ok('map: first level is open', !(await h.page.locator(`.node[data-level="${first.id}"]`).getAttribute('class')).includes('locked'));
    eq('map: locked levels', await h.page.locator('.node.locked').count(), LEVELS.length + NIGHT.length - 1);
    eq('map: no star moss earned yet', await h.page.locator('.node .moss.on').count(), 0);
    eq('map: every node has three marks', await h.page.locator('.node .moss').count(), (LEVELS.length + NIGHT.length) * 3);
    ok('map: no designer note on screen', !(await h.page.evaluate(() => document.body.innerText)).includes(first.note || '\u0000'));

    // every button has an aria-label; nothing but paper is in the top 12 percent
    const audit = (label) => auditPage(h, label);
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
    // preview: what a held creature does next turn (SPEC section 21), from src/ui/preview.js, or null
    const cardCheck = async (what, x, y, title, text, preview = null, shot = null) => {
      await h.hold(await h.tile(x, y), 620);
      await h.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 2000 }).catch(() => {});
      eq(`rule card (${what}): title`, await h.page.locator('#card-title').textContent(), title);
      eq(`rule card (${what}): text as in SPEC`, await h.page.locator('#card-text').textContent(), text);
      ok(`rule card (${what}): visible`, await h.page.locator('#card').isVisible());
      if (preview) {
        eq(`rule card (${what}): says what it does next turn`, await h.page.locator('#card-preview').textContent(), preview.text);
        ok(`rule card (${what}): the preview line shows`, await h.page.locator('#card-preview').isVisible());
        eq(`rule card (${what}): the board shows its next step`, await h.gd('preview'), { x: preview.x, y: preview.y, to: preview.to });
        if (shot) await h.shot(shot);
      } else {
        ok(`rule card (${what}): no preview line`, !(await h.page.locator('#card-preview').isVisible()));
        eq(`rule card (${what}): nothing previewed on the board`, await h.gd('preview'), null);
      }
      await h.page.keyboard.press('Escape');
      eq(`rule card (${what}): Escape closes it`, await h.gd('panel'), null);
      eq(`rule card (${what}): and the preview goes`, await h.gd('preview'), null);
    };
    {
      const s = engine.parseLevel(first);
      const kBefore = await h.gd('key');
      await cardCheck('Wren', s.wren.x, s.wren.y, 'Wren', CARDS.Wren);
      const m = s.creatures.find((c) => c.type === 'M');
      ok('rule card: level 1-1 has a Fluffmoth to hold', !!m);
      await cardCheck('Fluffmoth', m.x, m.y, 'Fluffmoth', CARDS.Fluffmoth, previewOf(s, m.id), '06b-hold-preview');
      const b = s.buds[0];
      await cardCheck('Glowbud', b.x, b.y, 'Glowbud', CARDS.Glowbud);
      const py = s.tiles.findIndex((row) => row.includes('~'));
      if (py >= 0) await cardCheck('Puddle', s.tiles[py].indexOf('~'), py, 'Puddle', CARDS.Puddle);
      eq('long-press never moves anything', await h.gd('key'), kBefore);
      // a short tap is not a long-press, and a hold on plain floor opens nothing
      await h.hold(await h.tile(0, 0), 620);
      eq('hold on a wall: no card', await h.gd('panel'), null);
    }

    // ---------------------------------------------------------------- 7. hint, in three steps (SPEC section 18)
    await h.gd('loadLevel', first.id);
    {
      const status = async () => ((await h.page.locator('#status').textContent()) || '').trim();
      const val = async () => ((await h.page.locator('#hint-val').textContent()) || '').trim();
      const aria = () => h.page.locator('#btn-hint').getAttribute('aria-label');
      const pressHint = async () => {
        await h.page.locator('#btn-hint').tap();
        await h.page.waitForFunction(() => !document.querySelector('#btn-hint').classList.contains('thinking'), null, { timeout: 8000 }).catch(() => {});
        await h.page.waitForTimeout(80);
      };
      const glimmer = (await h.gd('shop')).glimmer;
      const piece = hints.keyPiece(engine.parseLevel(first), sol, first.feature);
      await pressHint();
      eq('hint step 1: rings the key piece', [await h.gd('hint'), await h.gd('hintAt')], ['key', { x: piece.x, y: piece.y }]);
      eq('hint step 1: names it', await status(), hints.pieceText(piece));
      if (first.id === '1-1') eq('hint step 1: in level 1-1 it is the Fluffmoth', await status(), 'Hint: think about the Fluffmoth.');
      eq('hint: counted', await h.gd('hints'), 1);
      eq('hint step 1: the next step is free', [await val(), await aria()], ['more', 'Hint, next step free']);
      const spent = glimmer - (await h.gd('shop')).glimmer;
      await pressHint();
      eq('hint step 2: points along the shortest solution', await h.gd('hint'), DIRV[sol[0]] ? sol[0] : 'ring');
      if (first.id === '1-1') eq('hint step 2: level 1-1 starts east', await h.gd('hint'), 'E');
      ok('hint step 2: status line says so', (await status()).startsWith('Hint:'));
      eq('hint step 2: free, and still one hint', [(await h.gd('shop')).glimmer, await h.gd('hints')], [glimmer - spent, 1]);
      await pressHint();
      eq('hint step 3: the whole way is up', await h.gd('way'), { index: 0, total: sol.length });
      ok('hint step 3: the status row counts the moves', (await status()).startsWith(`Move 1 of ${sol.length}`), await status());
      eq('hint step 3: and shows the moves still to make', await h.page.locator('#status .way-move').count(), Math.min(sol.length, 10));
      eq('hint step 3: the next one first', await h.page.locator('#status .way-move.next').count(), 1);
      eq('hint step 3: the board points at the next move', await h.gd('hint'), DIRV[sol[0]] ? sol[0] : 'ring');
      eq('hint step 3: the Hint button says it is shown', [await val(), await aria()], ['shown', 'Hint, the way is shown']);
      eq('hint step 3: free, and still one hint', [(await h.gd('shop')).glimmer, await h.gd('hints')], [glimmer - spent, 1]);
      await pressHint();
      eq('hint again: the way stays up, nothing spent', [await h.gd('way'), (await h.gd('shop')).glimmer], [{ index: 0, total: sol.length }, glimmer - spent]);
      await h.page.keyboard.press(KEY_OF[sol[0]]);
      await h.idle();
      eq('the way follows the player', await h.gd('way'), { index: 1, total: sol.length });
      eq('the way: the board points at the move after', await h.gd('hint'), DIRV[sol[1]] ? sol[1] : 'ring');
      ok('the way: the count moves on', (await status()).startsWith(`Move 2 of ${sol.length}`), await status());
      const off = offTheWay(first, await h.gd('state'));
      await h.page.keyboard.press(KEY_OF[off]);
      await h.idle();
      eq('off the way: the way hides', [await h.gd('way'), await h.gd('hint')], [null, null]);
      eq('off the way: says so', await status(), 'Off the way. Undo to get back on it.');
      ok('off the way: Hint has its price again', !['more', 'shown'].includes(await val()), await val());
      await h.page.locator('#btn-undo').tap();
      await h.idle();
      eq('undo back onto the way: it comes back', await h.gd('way'), { index: 1, total: sol.length });
      await playByKeys(h, sol.slice(1));
      await waitResult(h);
      // a hint costs no star moss (SPEC section 23): solved and at par, and the critter is still hiding
      eq('result after a hint: two star moss', await earned(h), 2);
      eq('result after a hint: the third waits for the critter', await h.page.locator('#result-marks li.missed').textContent(), 'A critter hides in the dark (not earned)');
      eq('result after a hint: saved', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 2 });
      await h.page.locator('#result-replay').tap();
      eq('replay: fresh attempt', [await h.gd('moves'), await h.gd('hints'), await h.gd('panel')], [0, 0, null]);
      eq('replay: the old hint is gone', [await h.gd('way'), await h.gd('hintStep')], [null, 0]);
      ok('replay: Hint has its price again', !['more', 'shown'].includes(await val()), await val());
      // a restart ends a hint too, even at the position it was asked at
      await pressHint();
      await h.page.keyboard.press(KEY_OF[sol[0]]);
      await h.idle();
      await h.page.locator('#btn-restart').tap();
      await h.idle();
      eq('restart: the hint is gone', [await h.gd('hint'), await h.gd('hintStep'), await h.gd('hints')], [null, 0, 0]);
      ok('restart: Hint has its price again', !['more', 'shown'].includes(await val()), await val());
    }

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
    await playByTouch(h, sol, true);
    await waitResult(h);
    ok('touch solve: result panel visible', await h.page.locator('#result').isVisible());
    eq('touch solve: three star moss', await earned(h), 3);
    eq('touch solve: the third for the critter', await h.page.locator('#result-marks li').nth(2).textContent(), 'Found the Dewmite (earned)');
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

    // ---------------------------------------------------------------- 9b. hidden Journal critters (SPEC section 23)
    console.log('hidden critters');
    {
      // a fresh player, so this is the first critter ever (the touch solve above already found 1-1's)
      const k = await phone({ tag: 'critters' });
      await k.open();
      await k.toMap();
      // two chapter 1 levels without tutorial steps, so the status row is free to speak
      const [plain, other] = CHAPTERS[0].levels.filter((def) => !def.tutorial && def !== first);
      const routeTo = (def) => solver.lightRoute(engine.parseLevel(def), def.critter[0], def.critter[1]);
      await k.gd('loadLevel', plain.id);
      eq('critter: hidden in the dark at the start', await k.gd('critter'),
        { x: plain.critter[0], y: plain.critter[1], shows: false, found: false, kind: 'dewmite', name: 'Dewmite' });
      const route = routeTo(plain);
      await playByKeys(k, route);
      eq('critter: it peeks out once its nook is lit', [(await k.gd('critter')).shows, (await k.gd('critter')).found], [true, false]);
      eq('critter: the first one ever says how to find it', await k.page.locator('#status').textContent(),
        'Something small peeks out of the dark. Tap it to sketch it.');
      await k.shot('critter-peek');
      const moves = await k.gd('moves');
      await tapCritter(k);
      eq('critter: a tap sketches it, and is not a move', [(await k.gd('critter')).found, await k.gd('moves')], [true, moves]);
      eq('critter: the status row says so', await k.page.locator('#status').textContent(), 'Wren sketched a Dewmite for the Journal.');
      ok('critter: with a chirp', (await k.gd('heard')).includes('spot'), JSON.stringify(await k.gd('heard')));
      eq('critter: saved at once, before the level is lit', (await k.gd('save')).critters, [plain.id]);
      await k.shot('critter-sketched');
      await k.page.locator('#btn-undo').tap();
      await k.idle();
      eq('critter: undo keeps it, and the note goes', [(await k.gd('critter')).found, (await k.page.locator('#status').textContent()).includes('sketched')], [true, false]);
      await k.gd('restart');
      await k.idle();
      await playByKeys(k, solutionOf(plain));
      await waitResult(k);
      eq('critter: lit at par with the critter found: three star moss', await earned(k), 3);
      eq('critter: the result names it', await k.page.locator('#result-marks li').nth(2).textContent(), 'Found the Dewmite (earned)');
      await k.page.locator('#result-map').tap();
      // C on the keyboard, in another cavern
      await k.gd('loadLevel', other.id);
      await playByKeys(k, routeTo(other));
      await k.page.keyboard.press('c');
      eq('critter: C sketches it too', [(await k.gd('critter')).found, (await k.gd('save')).critters], [true, [plain.id, other.id]]);
      eq('critter: once one is found, no more how-to', (await k.page.locator('#status').textContent()).includes('peeks'), false);
      // the Journal's Critters tab
      await k.page.locator('#back').tap();
      await k.page.locator('#btn-journal').tap();
      await k.page.locator('#tab-critters').tap();
      eq('journal: the Critters tab is selected', await k.page.locator('#tab-critters').getAttribute('aria-selected'), 'true');
      const all = LEVELS.length + NIGHT.length;
      eq('journal: critters counted', await k.page.locator('#journal-count').textContent(), `2 of ${all} found`);
      eq('journal: one entry a chapter, and the garden', await k.page.locator('.critter-entry').count(), CHAPTERS.length + 1);
      eq('journal: a found kind says where', await k.page.locator('.critter-entry').first().locator('.kicker').textContent(),
        `Found 2 of ${CHAPTERS[0].levels.length} in Mossmouth`);
      eq('journal: and its name', await k.page.locator('.critter-entry').first().locator('h3').textContent(), 'Dewmite');
      eq('journal: no lore until all are found', await k.page.locator('.critter-entry .lore').count(), 0);
      eq('journal: a kind not found yet says where to look', await k.page.locator('.critter-entry').nth(1).locator('.rule').textContent(),
        'Hiding in the dark corners of Whelk Grottos.');
      await auditPage(k, 'journal critters');
      await k.shot('journal-critters');
      await k.page.locator('#journal-back').tap();
      await k.page.waitForFunction(() => window.__gd.screen() === 'map');
      await k.close();
    }

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
    eq('contrast: toggles off again', (await h.gd('save')).settings, { sound: true, contrast: false, unlockAll: false, tutorials: true, textSize: 1, readable: false, motion: 'system', lantern: 'tallow',
      arrows: false, hand: 'right', swipe: 'normal', talk: false });   // talk: SPEC section 28

    // Unlock all skips the level order, never the purchase (SPEC section 14)
    const paidCount = LEVELS.filter((def) => !CHAPTERS.find((c) => c.id === 1).levels.includes(def)).length + NIGHT.length;
    await h.page.locator('#set-unlock').tap();
    eq('unlock all: only the Full Expedition\'s levels stay locked', await h.page.locator('.node.locked').count(), paidCount);
    eq('unlock all: every free level is open', await h.page.locator('.chapter:not(.paid) .node.locked').count(), 0);
    await h.page.locator('#set-unlock').tap();

    await h.page.locator('#set-reset').tap();
    ok('reset: asks first, inside the page', await h.page.locator('#confirm').isVisible());
    eq('reset: the question sits above the settings', await confirmClear(h), true);
    await h.page.locator('#confirm-no').tap();
    eq('reset: Keep keeps', (await h.gd('save')).levels[first.id], { moves: sol.length, stars: 3 });
    await h.page.locator('#set-reset').tap();
    await h.page.locator('#confirm-yes').tap();
    eq('reset: Erase erases', (await h.gd('save')).levels, {});
    eq('reset: the critters too', (await h.gd('save')).critters, []);
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
      await cardCheck('Shellwhelk', w.x, w.y, 'Shellwhelk', CARDS.Shellwhelk, previewOf(s, w.id));
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
      await cardCheck('Stumpcap', t.x, t.y, 'Stumpcap', CARDS.Stumpcap, previewOf(s, t.id));
    }
    // newt: its card, and its markings glow in the dark where it wanders
    await h.gd('loadLevelDef', ADHOC.newt);
    {
      const s = engine.parseLevel(ADHOC.newt);
      const n = s.creatures[0];
      eq('ad-hoc newt: starts in the dark', s.lit[n.y * s.w + n.x], 0);
      await cardCheck('Dozer newt', n.x, n.y, 'Dozer newt', CARDS['Dozer newt'], previewOf(s, n.id));
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
      await cardCheck('Emberwick', k.x, k.y, 'Emberwick', CARDS.Emberwick, previewOf(s, k.id));
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
    // gloam: its card; its violet edge shows in its own shadow; beside Wren it puts the lantern out, with a sound
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
      const def = { id: 'T-8', name: 'Gloam Drift', map: ['#########', '#W....O.#', '#########'] };
      await h.gd('loadLevelDef', def);
      await h.page.waitForTimeout(300);
      eq('ad-hoc gloam: stands in its own shadow', engine.parseLevel(def).lit[1 * 9 + 6], 0);
      // the floor it is measured against is out of the lantern's light and out of the Gloamling's reach
      const onGloam = await bright(6, 1, 300);
      const onFloor = await bright(4, 1, 300);
      ok('ad-hoc gloam: its edge shows in the dark', onGloam > 0.006 && onGloam > onFloor * 4, JSON.stringify({ onGloam, onFloor }));
      await cardCheck('Gloamling', 6, 1, 'Gloamling', CARDS.Gloamling, previewOf(engine.parseLevel(def), 'O1'));
      await h.gd('act', 'E');
      await h.idle();
      await h.page.waitForTimeout(200);
      eq('ad-hoc gloam: one step closer, the lantern still shines', (await h.gd('state')).lit[1 * 9 + 2], 1);
      const shining = await bright(2, 1, 450);
      ok('ad-hoc gloam: it drifted with a sound of its own', (await h.gd('heard')).includes('gloamDrift'), JSON.stringify(await h.gd('heard')));
      await h.gd('act', 'E');
      await h.idle();
      await h.page.waitForTimeout(250);
      const s = await h.gd('state');
      eq('ad-hoc gloam: beside Wren it eats the lantern\'s light', [s.creatures[0].x, s.lit.indexOf(1)], [4, -1]);
      ok('ad-hoc gloam: the light going out has a sound', (await h.gd('heard')).includes('gloamSnuff'), JSON.stringify(await h.gd('heard')));
      const snuffed = await bright(3, 1, 450);
      ok('ad-hoc gloam: the lantern looks out on screen', snuffed < shining * 0.5, JSON.stringify({ shining, snuffed }));
      await h.shot('gloam-snuffed');
    }
    // beam: the Shutter and Mirrorbeetle cards; beside the planted lantern the button aims it; the beam reaches
    // further on screen; a beetle's mirror shows in the dark, it crawls and glints with sounds of its own
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
      const def = { id: 'T-9', name: 'Beam Test', shutter: true, map: ['#########', '#WL....\\#', '#########'] };
      await h.gd('loadLevelDef', def);
      await h.page.waitForTimeout(300);
      eq('ad-hoc beam: the beetle starts in the dark', engine.parseLevel(def).lit[1 * 9 + 7], 0);
      const onBeetle = await bright(7, 1, 300);
      const onFloor = await bright(5, 1, 300);
      ok('ad-hoc beam: a beetle\'s mirror shows in the dark', onBeetle > 0.006 && onBeetle > onFloor * 4, JSON.stringify({ onBeetle, onFloor }));
      await cardCheck('Mirrorbeetle', 7, 1, 'Mirrorbeetle', CARDS.Mirrorbeetle, previewOf(engine.parseLevel(def), 'R1'));
      await cardCheck('shutter lantern', 2, 1, 'Shutter', CARDS.Shutter);
      eq('ad-hoc beam: beside the lantern the button aims', await h.page.locator('#btn-lantern .lbl').textContent(), 'Aim');
      eq('ad-hoc beam: and says so to a screen reader', await h.page.locator('#btn-lantern').getAttribute('aria-label'), 'Aim the lantern');
      await h.gd('act', 'Z');
      await h.idle();
      eq('ad-hoc beam: in the dark the beetle crawls toward the lantern', (await h.gd('state')).creatures[0].x, 6);
      ok('ad-hoc beam: it crawls with a sound of its own', (await h.gd('heard')).includes('beetleCrawl'), JSON.stringify(await h.gd('heard')));
      await h.page.waitForTimeout(200);
      const before = await bright(5, 1, 450);
      await h.tap(await h.wren());
      await h.idle();
      await h.page.waitForTimeout(250);
      eq('ad-hoc beam: tapping Wren aims the lantern away from her', (await h.gd('state')).lantern.beam, 'E');
      const heard = await h.gd('heard');
      ok('ad-hoc beam: the shutter has a sound', heard.includes('aim'), JSON.stringify(heard));
      ok('ad-hoc beam: the beam catching the beetle has a sound', heard.includes('beetleGlint'), JSON.stringify(heard));
      eq('ad-hoc beam: aimed back at it, the button opens it', await h.page.locator('#btn-lantern .lbl').textContent(), 'Open');
      const after = await bright(5, 1, 450);
      ok('ad-hoc beam: the beam reaches past round light on screen', after > before * 3 && after > 0.05, JSON.stringify({ before, after }));
      await h.shot('beam-mirror');
      await h.page.locator('#btn-lantern').tap();
      await h.idle();
      eq('ad-hoc beam: the button opens it back to round light', (await h.gd('state')).lantern.beam, undefined);
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
      // 1-1 is lit here, so 1-2 is open and not lit: the nudge points at it (SPEC section 29)
      const STUCK = 'Stuck? Hint helps a step at a time, and one other cavern is open on the map.';
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
    // the Workshop's editor (SPEC section 26) has its own, drawn only when the cavern changes, never in a loop
    eq('page: the only other canvases are the title picture and the Workshop editor',
      await h.page.locator('canvas:not(#screen-level canvas)').evaluateAll((els) => els.map((e) => e.id)), ['title-art', 'editor-canvas']);
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
      eq('no storage: map renders', await g.page.locator('.node').count(), LEVELS.length + NIGHT.length);
      await g.page.locator(`.node[data-level="${first.id}"]`).tap();
      await playByTouch(g, sol, true);
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
      await playByTouch(g, sol, true);
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

  if (!SHOTS_ONLY && !ONLY) {
    // ---------------------------------------------------------------- story pages and the Field Journal (SPEC 13)
    console.log('story and journal');
    const s = await phone({ tag: 'story' });
    const text = async (sel) => ((await s.page.locator(sel).textContent()) || '').trim();
    const chapter = (n) => CHAPTERS.find((c) => c.id === n);
    const lastOf = (n) => chapter(n).levels[chapter(n).levels.length - 1];
    const solveHere = async (def) => {
      await s.gd('loadLevel', def.id);
      if ((await s.gd('panel')) === 'card') await s.page.keyboard.press('Escape');
      for (const m of solutionOf(def)) await s.gd('act', m);
      await waitResult(s);
    };
    const onScreen = async (sel) => {
      const b = await s.page.locator(sel).boundingBox();
      return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 390 && b.y + b.height <= 844 ? true : JSON.stringify(b);
    };

    await s.open();
    await s.page.locator('#btn-play').tap();
    await s.page.waitForFunction(() => window.__gd.screen() === 'story');
    const prologue = STORY[0];
    eq('story: Play on a fresh save opens the prologue', await s.gd('story'), { id: 'prologue', index: 0, count: 1, reading: false });
    eq('story: the page title', await text('#story-title'), prologue.title);
    eq('story: the kicker', await text('#story-kicker'), 'Prologue');
    eq('story: Wren\'s lines', await s.page.locator('#story-lines p').allTextContents(), prologue.lines);
    ok('story: no page count in a one-page book', !(await s.page.locator('#story-count').isVisible()));
    eq('story: the last page\'s button says Continue', await text('#story-next'), 'Continue');
    ok('story: turning to it plays the page sound', (await s.gd('heard')).includes('page'), JSON.stringify(await s.gd('heard')));
    eq('story: a page counts as seen once it shows', (await s.gd('save')).seen, ['prologue']);
    {
      const art = await s.page.evaluate(() => {
        const el = document.getElementById('story-art');
        const r = el.getBoundingClientRect();
        return { bg: getComputedStyle(el).backgroundImage.slice(0, 30), len: getComputedStyle(el).backgroundImage.length, w: r.width, h: r.height };
      });
      ok('story: the page has a picture', art.bg.startsWith('url("data:image/png') && art.len > 4000 && art.w >= 240 && art.h >= 120, JSON.stringify(art));
    }
    eq('story: the button is on screen', await onScreen('#story-next'), true);
    await auditPage(s, 'story');
    await s.shot('story-prologue');
    await s.page.locator('#story-next').tap();
    eq('story: Continue goes on to the map', await s.gd('screen'), 'map');
    await s.page.keyboard.press('Escape');
    await s.page.locator('#btn-play').tap();
    eq('story: a seen page does not show again', await s.gd('screen'), 'map');

    // the Journal, fresh
    ok('journal: the map has a Journal button', await s.page.locator('#btn-journal').isVisible());
    eq('journal: the button is on screen, in thumb reach', [await onScreen('#btn-journal'), (await s.page.locator('#btn-journal').boundingBox()).y > 844 / 2], [true, true]);
    eq('journal: the button counts creatures met', await text('#btn-journal .val'), '0 of 7 met');
    await s.page.locator('#btn-journal').tap();
    eq('journal: opens', await s.gd('screen'), 'journal');
    eq('journal: Creatures is the first tab', await s.page.locator('#tab-creatures').getAttribute('aria-selected'), 'true');
    eq('journal: one entry per species', await s.page.locator('#journal-list .entry').count(), 7);
    eq('journal: nothing met on a fresh save', await s.page.locator('#journal-list .entry.met').count(), 0);
    eq('journal: the count', await text('#journal-count'), '0 of 7 met');
    eq('journal: an unmet creature', await s.page.locator('#journal-list .entry').first().locator('h3').textContent(), 'Not met yet');
    ok('journal: says where to find it', (await s.page.locator('#journal-list .entry').first().textContent()).includes('Somewhere in Mossmouth.'));
    await auditPage(s, 'journal');
    eq('journal: the tabs are on screen, in thumb reach', [await onScreen('#tab-creatures'), await onScreen('#tab-story'),
      (await s.page.locator('#tab-story').boundingBox()).y > 844 / 2], [true, true, true]);
    await s.page.locator('#journal-back').tap();
    eq('journal: its back button goes to the map', await s.gd('screen'), 'map');

    // meeting the Fluffmoth
    await solveHere(LEVELS[0]);
    await s.page.locator('#result-map').tap();
    eq('story: no page after a level that ends no chapter', await s.gd('screen'), 'map');
    await s.page.locator('#btn-journal').tap();
    eq('journal: one met after 1-1', await s.page.locator('#journal-list .entry.met').count(), 1);
    eq('journal: the count goes up', await text('#journal-count'), '1 of 7 met');
    {
      const moth = s.page.locator('#journal-list .entry').first();
      eq('journal: the Fluffmoth by name', await moth.locator('h3').textContent(), 'Fluffmoth');
      const all = await moth.textContent();
      ok('journal: where it was met', all.includes('Met in Mossmouth'), all);
      ok('journal: its rule card text', all.includes(CARDS.Fluffmoth), all);
      ok('journal: Wren\'s note', all.includes(NOTES.M), all);
      const bg = await moth.locator('.entry-art').evaluate((el) => getComputedStyle(el).backgroundImage.slice(0, 26));
      ok('journal: its portrait', bg.startsWith('url("data:image/png'), bg);
    }
    {
      const over = await s.page.evaluate(() => [...document.querySelectorAll('#journal-list .entry')]
        .filter((el) => { const r = el.getBoundingClientRect(); return r.left < -0.5 || r.right > window.innerWidth + 0.5; }).length);
      eq('journal: entries fit the screen', over, 0);
      const list = await s.page.evaluate(() => { const l = document.getElementById('journal-list'); return { sh: l.scrollHeight, ch: l.clientHeight }; });
      ok('journal: the list scrolls inside its screen', list.sh > list.ch, JSON.stringify(list));
      await s.swipe('N', { x: 195, y: 700 }, 260);
      await s.page.waitForTimeout(400);
      ok('journal: a finger scrolls the list', (await s.page.evaluate(() => document.getElementById('journal-list').scrollTop)) > 20);
    }
    await s.shot('journal-creatures');

    // the Story tab
    await s.page.locator('#tab-story').tap();
    await auditPage(s, 'journal story');
    eq('journal: the Story tab', [await s.page.locator('#tab-story').getAttribute('aria-selected'), await s.page.locator('#tab-creatures').getAttribute('aria-selected')], ['true', 'false']);
    eq('journal: one entry per story page', await s.page.locator('#journal-list .entry').count(), STORY.length);
    eq('journal: the count of pages', await text('#journal-count'), `1 of ${STORY.length} pages`);
    {
      const entries = s.page.locator('#journal-list .entry');
      eq('journal: the prologue is there to read', await entries.nth(0).locator('h3').textContent(), prologue.title);
      eq('journal: chapter 1\'s page is still dark', await entries.nth(1).locator('h3').textContent(), 'Still dark');
      ok('journal: and says how to light it', (await entries.nth(1).textContent()).includes('Light the last cavern of Mossmouth to read it.'));
      eq('journal: a dark page is not a button', await entries.nth(1).locator('button').count(), 0);
      await entries.nth(0).locator('button').tap();
    }
    eq('journal: a page opens to read again', await s.gd('story'), { id: 'prologue', index: 0, count: 1, reading: true });
    eq('journal: reading, the button goes back', await text('#story-next'), 'Back to journal');
    await s.page.locator('#story-next').tap();
    eq('journal: back on the Story tab', [await s.gd('screen'), await s.page.locator('#tab-story').getAttribute('aria-selected')], ['journal', 'true']);
    await s.page.locator('#journal-list .entry button').first().tap();
    await s.page.keyboard.press('Escape');
    eq('journal: Escape on a page read again goes back to the journal', await s.gd('screen'), 'journal');
    await s.page.keyboard.press('Escape');
    eq('journal: Escape goes to the map', await s.gd('screen'), 'map');

    // finishing a chapter: its page comes after the result, then on to where the player was going
    await solveHere(lastOf(1));
    await s.page.locator('#result-next').tap();
    eq('story: a chapter\'s page after its last level', [await s.gd('screen'), ((await s.gd('story')) || {}).id], ['story', 'ch1']);
    eq('story: its kicker names the chapter', await text('#story-kicker'), 'Chapter 1: Mossmouth');
    eq('story: its title', await text('#story-title'), STORY[1].title);
    await s.shot('story-chapter-1');
    await s.page.locator('#story-next').tap();
    // chapter 2 is part of the Full Expedition: Continue goes to the map with the store open (SPEC section 14)
    eq('story: Continue opens the store when the next chapter is locked', [await s.gd('screen'), await s.gd('panel')], ['map', 'shop']);
    eq('story: the store says why', await text('#shop-why'), `Chapter 2, ${chapter(2).name}, is part of the Full Expedition.`);
    await s.page.locator('#shop-close').tap();
    // the page was read: Next at the end of chapter 1 now opens the store straight away
    await solveHere(lastOf(1));
    await s.page.locator('#result-next').tap();
    eq('store: Next after chapter 1 opens the store again, with no page', [await s.gd('screen'), await s.gd('panel'), await s.gd('story')], ['map', 'shop', null]);
    await s.page.locator('#shop-full').tap();
    await s.page.waitForFunction(() => window.__gd.shop().full === true);
    await s.page.locator('#shop-close').tap();
    await solveHere(lastOf(1));
    await s.page.locator('#result-next').tap();
    eq('store: once bought, Next opens the next chapter', [await s.gd('screen'), await text('#level-id')], ['level', `Level ${chapter(2).levels[0].id}`]);

    // two chapters finished: a book of two pages
    await solveHere(lastOf(2));
    await solveHere(lastOf(3));
    await s.page.locator('#result-map').tap();
    eq('story: two pages due make a book', await s.gd('story'), { id: 'ch2', index: 0, count: 2, reading: false });
    eq('story: page count', await text('#story-count'), 'Page 1 of 2');
    eq('story: Next page while more follow', await text('#story-next'), 'Next page');
    await s.page.locator('#story-next').tap();
    eq('story: the second page', [((await s.gd('story')) || {}).id, await text('#story-count'), await text('#story-next')], ['ch3', 'Page 2 of 2', 'Continue']);
    await s.page.locator('#story-next').tap();
    eq('story: then the map', await s.gd('screen'), 'map');

    // Back closes a book at once; its other pages count as seen
    await solveHere(lastOf(4));
    await solveHere(lastOf(5));
    await s.page.keyboard.press('Escape');
    eq('story: Back from a result shows due pages too', ((await s.gd('story')) || {}).id, 'ch4');
    await s.page.keyboard.press('Escape');
    eq('story: Escape closes the book and goes on', await s.gd('screen'), 'map');
    eq('story: the closed book\'s pages count as seen', (await s.gd('save')).seen, ['prologue', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5']);
    await s.page.locator('#btn-journal').tap();
    await s.page.locator('#tab-story').tap();
    eq('journal: every seen page readable', await s.page.locator('#journal-list .entry button').count(), 6);
    await s.page.locator('#journal-back').tap();

    // Replay shows nothing; Reset brings the story back
    await solveHere(lastOf(6));
    await s.page.locator('#result-replay').tap();
    eq('story: Replay shows no page', [await s.gd('screen'), await s.gd('panel')], ['level', null]);
    await s.page.locator('#back').tap();
    eq('story: the map button on a level shows no page', await s.gd('screen'), 'map');
    await s.page.locator('#set-reset').tap();
    await s.page.locator('#confirm-yes').tap();
    eq('reset: clears the seen story pages', (await s.gd('save')).seen, []);
    await s.page.keyboard.press('Escape');
    await s.page.locator('#btn-play').tap();
    eq('reset: the prologue shows again', ((await s.gd('story')) || {}).id, 'prologue');

    // a page straight from a link never starts with the prologue
    const fresh = await phone({ tag: 'story-link' });
    await fresh.open(`?level=${LEVELS[0].id}`);
    for (const m of solutionOf(LEVELS[0])) await fresh.gd('act', m);
    await waitResult(fresh);
    await fresh.page.locator('#result-map').tap();
    eq('story: no prologue after a level opened from a link', await fresh.gd('screen'), 'map');
    await fresh.close();
    await s.close();

    // ---------------------------------------------------------------- store (SPEC section 14)
    console.log('store');
    {
      const st = await phone({ tag: 'store' });
      const txt = async (sel) => ((await st.page.locator(sel).textContent()) || '').trim();
      const ch = (n) => CHAPTERS.find((c) => c.id === n);
      const paid = CHAPTERS.filter((c) => c.id !== 1);
      const paidLevels = LEVELS.filter((def) => !ch(1).levels.includes(def));
      const inView = async (sel) => {
        const b = await st.page.locator(sel).boundingBox();
        return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 390 && b.y + b.height <= 844 ? true : JSON.stringify(b);
      };
      const shopOpen = () => st.page.waitForFunction(() => window.__gd.panel() === 'shop');

      await st.open();
      await st.toMap();
      eq('store: debug and browser builds use the test store', (await st.gd('shop')).kind, 'test');
      eq('store: a fresh save owns nothing and has 3 Glimmer', [(await st.gd('shop')).full, (await st.gd('shop')).glimmer], [false, 3]);
      // the later chapters and the Night Garden (SPEC section 20)
      eq('store: later chapters are marked as the Full Expedition', await st.page.locator('.chapter.paid').count(), paid.length + 1);
      eq('store: each locked chapter has an Unlock button', await st.page.locator('.chapter-unlock').count(), paid.length + 1);
      ok('store: the Night Garden is part of it', (await st.page.locator('#garden').getAttribute('class')).includes('paid'));
      eq('store: chapter 1 is free', await st.page.locator(`.chapter.paid .node[data-level="${first.id}"]`).count(), 0);
      const ch2first = ch(2).levels[0];
      eq('store: a locked level says why', await st.page.locator(`.node[data-level="${ch2first.id}"]`).getAttribute('aria-label'),
        `Level ${ch2first.id}, locked. Part of the Full Expedition.`);
      eq('store: a locked paid level still acts (it opens the store)', await st.page.locator(`.node[data-level="${ch2first.id}"]`).getAttribute('aria-disabled'), null);
      eq('store: the Unlock button is labelled', await st.page.locator('.chapter-unlock').first().getAttribute('aria-label'),
        `Unlock chapter ${paid[0].id} with the Full Expedition`);

      // the map's Store button
      ok('store: the map has a Store button', await st.page.locator('#btn-shop').isVisible());
      eq('store: the button is on screen, in thumb reach', [await inView('#btn-shop'), (await st.page.locator('#btn-shop').boundingBox()).y > 844 / 2], [true, true]);
      await st.page.locator('#btn-shop').tap();
      await shopOpen();
      ok('store: the panel shows', await st.page.locator('#shop').isVisible());
      ok('store: no reason line from the Store button', !(await st.page.locator('#shop-why').isVisible()));
      eq('store: test prices', [await txt('#shop-full'), await txt('#shop-jar')], ['$4.99', '$0.99']);
      eq('store: the Full Expedition offer', await txt('#shop-full-text'),
        `Chapters 2 to ${paid[paid.length - 1].id} and the Night Garden: ${paidLevels.length + NIGHT.length} more caverns and the rest of Wren's story. One payment, no ads.`);
      eq('store: the jar offer counts the Glimmer left', await txt('#shop-jar-text'), '10 instant hints. You have 3 Glimmer, and a free hint is ready now.');
      ok('store: says purchases are free in a test build', await st.page.locator('#shop-test').isVisible());
      eq('store: Close has the focus', await st.page.evaluate(() => document.activeElement && document.activeElement.id), 'shop-close');
      for (const id of ['shop-full', 'shop-jar', 'shop-restore', 'shop-close']) eq(`store: #${id} on screen`, await inView(`#${id}`), true);
      await auditPage(st, 'store');
      await st.shot('store');
      await st.page.keyboard.press('Escape');
      eq('store: Escape (Back) closes it', [await st.gd('screen'), await st.gd('panel'), await st.page.locator('#shop').isVisible()], ['map', null, false]);

      // a locked chapter opens it, and says which chapter
      await st.page.locator(`.node[data-level="${ch2first.id}"]`).tap();
      await shopOpen();
      eq('store: a locked level opens it', [await st.gd('screen'), await txt('#shop-why')], ['map', `Chapter 2, ${ch(2).name}, is part of the Full Expedition.`]);
      await st.page.locator('#shop-close').tap();
      eq('store: Close closes it', await st.gd('panel'), null);
      await st.page.locator('.chapter-unlock').nth(1).tap();
      await shopOpen();
      eq('store: an Unlock button opens it', await txt('#shop-why'), `Chapter ${paid[1].id}, ${paid[1].name}, is part of the Full Expedition.`);
      {
        const top = (await st.page.locator('#shop').boundingBox()).y;
        ok('store: the panel leaves room above it', top > 60, top);
        await st.page.touchscreen.tap(195, Math.min(40, top / 2));
        eq('store: a tap outside closes it', await st.gd('panel'), null);
      }

      // a Glimmer jar
      await st.page.locator('#btn-shop').tap();
      await shopOpen();
      await st.page.locator('#shop-jar').tap();
      await st.page.waitForFunction(() => window.__gd.shop().glimmer === 13);
      eq('store: a jar adds 10 Glimmer', (await st.gd('shop')).glimmer, 13);
      eq('store: and says thank you', await txt('#shop-note'), 'Thank you! 10 Glimmer added.');
      ok('store: a purchase plays the solve sound', (await st.gd('heard')).includes('solve'));
      eq('store: the jar offer updates', await txt('#shop-jar-text'), '10 instant hints. You have 13 Glimmer, and a free hint is ready now.');
      eq('store: the jar can be bought again', await st.page.locator('#shop-jar').getAttribute('aria-disabled'), 'false');

      // the Full Expedition
      await st.page.locator('#shop-full').tap();
      await st.page.waitForFunction(() => window.__gd.shop().full === true);
      eq('store: the Full Expedition says thank you', await txt('#shop-note'), 'Thank you! Every chapter is open now.');
      eq('store: and shows as owned', [await txt('#shop-full'), await st.page.locator('#shop-full').getAttribute('aria-disabled')], ['Owned', 'true']);
      // SPEC section 16: a browser has no second copy, so the save is "on disk" at once, and every write counts
      eq('save: in a browser __gd.saved() answers true', await st.page.evaluate(() => window.__gd.saved()), true);
      {
        const stored = await st.page.evaluate(() => JSON.parse(localStorage.getItem('glimmerdeep.v1')));
        ok('save: the stored save counts its writes', Number.isInteger(stored.rev) && stored.rev >= 2, stored.rev);
        eq('save: and the game holds the same revision', (await st.gd('save')).rev, stored.rev);
      }
      await st.page.locator('#shop-restore').tap();
      await st.page.waitForFunction(() => !/Waiting/.test(document.getElementById('shop-note').textContent));
      eq('store: Restore with nothing new', await txt('#shop-note'), 'Nothing new to restore.');
      await st.page.locator('#shop-close').tap();
      eq('store: no chapter is marked as paid any more', [await st.page.locator('.chapter.paid').count(), await st.page.locator('.chapter-unlock').count()], [0, 0]);
      eq('store: later levels follow the usual order', await st.page.locator(`.node[data-level="${ch2first.id}"]`).getAttribute('aria-label'),
        `Level ${ch2first.id}, locked. Solve the level before it first.`);
      await st.page.locator('#set-unlock').tap();
      eq('store: bought, Unlock all opens everything', await st.page.locator('.node.locked').count(), 0);
      await st.page.locator('#set-unlock').tap();

      // kept over a reload, and over Reset progress
      await st.page.reload();
      await st.page.waitForFunction(() => window.__gd && window.__gd.screen());
      await st.toMap();
      eq('store: purchases survive a reload', [(await st.gd('shop')).full, (await st.gd('shop')).glimmer], [true, 13]);
      eq('store: still no paid chapters after a reload', await st.page.locator('.chapter.paid').count(), 0);
      await st.page.locator('#set-reset').tap();
      await st.page.locator('#confirm-yes').tap();
      eq('store: Reset progress keeps purchases', [(await st.gd('shop')).full, (await st.gd('shop')).glimmer], [true, 13]);
      await st.close();
    }
    // ---------------------------------------------------------------- Daily Glimmer (SPEC section 15)
    console.log('daily glimmer');
    {
      const dg = await phone({ tag: 'daily' });
      const txt = async (sel) => ((await dg.page.locator(sel).textContent()) || '').trim();
      const TODAY = '2026-11-18';
      const today = dailyLevel(DAILY, TODAY);
      const solveDaily = async (def) => {
        await dg.page.waitForFunction(() => window.__gd.screen() === 'level');
        if ((await dg.gd('panel')) === 'card') await dg.page.keyboard.press('Escape');
        for (const m of solutionOf(def)) {
          await dg.gd('act', m);
          const c = await dg.gd('critter');
          if (c.shows && !c.found && !(await dg.gd('state')).solved) await dg.gd('sketch');
        }
        await waitResult(dg);
      };
      await dg.open();
      await dg.gd('setToday', TODAY);
      await dg.toMap();
      eq('daily: the card comes first on the map', await dg.page.evaluate(() => document.querySelector('#chapters > *').id), 'daily');
      eq('daily: its title and date', [await txt('#daily .kicker'), await txt('#daily-date')], ['Daily Glimmer', 'Wed 18 Nov']);
      eq('daily: today\'s cavern by name', await txt('#daily-name'), today.name);
      eq('daily: no streak yet', await txt('#daily-streak'), 'Light today\'s cavern to start a streak.');
      eq('daily: a row of seven days', await dg.page.locator('#daily-week .day').count(), 7);
      eq('daily: the last day is today', await dg.page.locator('#daily-week .day').last().getAttribute('class'), 'day today');
      eq('daily: archive days are locked without the Full Expedition', await dg.page.locator('#daily-week .day.locked').count(), 6);
      eq('daily: a day says what it is', await dg.page.locator('#daily-week .day').nth(5).getAttribute('aria-label'),
        'Tue 17 Nov, not lit. Part of the Full Expedition.');
      eq('daily: today says what it is', await dg.page.locator('#daily-week .day').last().getAttribute('aria-label'), 'Wed 18 Nov, today, not lit yet');
      eq('daily: Play is labelled', await dg.page.locator('#daily-play').getAttribute('aria-label'), `Play today's Daily Glimmer, ${today.name}`);
      await auditPage(dg, 'map with the daily card');
      await dg.shot('daily-card');

      // a locked archive day opens the store
      await dg.page.locator('#daily-week .day').nth(5).tap();
      await dg.page.waitForFunction(() => window.__gd.panel() === 'shop');
      eq('daily: a locked day opens the store, and says why', await txt('#shop-why'), 'The Daily Glimmer archive is part of the Full Expedition.');
      await dg.page.locator('#shop-close').tap();

      // today's cavern
      await dg.page.locator('#daily-play').tap();
      await dg.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('daily: the level screen says Daily Glimmer and the date', [await txt('#level-id'), await txt('#level-name')], ['Daily Glimmer, 18 Nov', today.name]);
      eq('daily: a creature not met in the chapters shows its rule card first', await dg.gd('panel'), 'card');
      await solveDaily(today);
      ok('daily: no Next level after a daily cavern', await dg.page.locator('#result-next').isHidden());
      eq('daily: the result panel names it', await txt('#result-id'), 'Daily Glimmer, 18 Nov');
      ok('daily: the first light gives a Glimmer, and says so', (await txt('#result-best')).includes('+1 Glimmer'), await txt('#result-best'));
      eq('daily: one Glimmer added', (await dg.gd('shop')).glimmer, 4);
      eq('daily: the record is kept by date', (await dg.gd('save')).daily, { [TODAY]: { moves: today.par, stars: 3 } });
      eq('daily: no level record from it', (await dg.gd('save')).levels, {});
      await dg.page.locator('#result-replay').tap();
      eq('daily: no rule card once the day is lit', await dg.gd('panel'), null);
      await solveDaily(today);
      ok('daily: a replay says nothing about Glimmer', !(await txt('#result-best')).includes('Glimmer'), await txt('#result-best'));
      eq('daily: and gives none', (await dg.gd('shop')).glimmer, 4);
      await dg.page.locator('#result-map').tap();
      eq('daily: Map goes back to the map, with no story page', [await dg.gd('screen'), await dg.gd('story')], ['map', null]);
      eq('daily: the streak starts', await txt('#daily-streak'), '1-day streak, best 1');
      eq('daily: today is lit in the row', await dg.page.locator('#daily-week .day').last().getAttribute('class'), 'day today lit');
      eq('daily: Play shows today\'s star moss', await dg.page.locator('#daily-play .moss.on').count(), 3);
      eq('daily: chapter tallies do not count it', await txt('.chapter .tally'), `0 of ${CHAPTERS[0].levels.length} lit`);

      // the next day: yesterday keeps the streak alive until today is lit
      await dg.gd('setToday', '2026-11-19');
      eq('daily: a new day, a new date', await txt('#daily-date'), 'Thu 19 Nov');
      eq('daily: a new cavern', await txt('#daily-name'), dailyLevel(DAILY, '2026-11-19').name);
      eq('daily: yesterday keeps the streak', await txt('#daily-streak'), '1-day streak, best 1');
      eq('daily: and shows lit in the row', await dg.page.locator('#daily-week .day').nth(5).getAttribute('class'), 'day lit locked');

      // the archive, with the Full Expedition
      await dg.page.locator('#btn-shop').tap();
      await dg.page.locator('#shop-full').tap();
      await dg.page.waitForFunction(() => window.__gd.shop().full === true);
      await dg.page.locator('#shop-close').tap();
      eq('daily: bought, the archive opens', await dg.page.locator('#daily-week .day.locked').count(), 0);
      eq('daily: an open archive day says so', await dg.page.locator('#daily-week .day').nth(4).getAttribute('aria-label'), 'Tue 17 Nov, not lit');
      await dg.page.locator('#daily-week .day').nth(4).tap();
      const tue = dailyLevel(DAILY, '2026-11-17');
      eq('daily: an archive day plays its own cavern', [await txt('#level-id'), await txt('#level-name')], ['Daily Glimmer, 17 Nov', tue.name]);
      await solveDaily(tue);
      ok('daily: an archive day gives no Glimmer', !(await txt('#result-best')).includes('Glimmer'), await txt('#result-best'));
      eq('daily: no Glimmer from it', (await dg.gd('shop')).glimmer, 4);
      await dg.page.keyboard.press('Escape');
      eq('daily: Escape on its result goes to the map', await dg.gd('screen'), 'map');
      eq('daily: the archive mends the streak', await txt('#daily-streak'), '2-day streak, best 2');

      // kept over a reload; Back from a daily level; Reset clears it
      await dg.page.reload();
      await dg.page.waitForFunction(() => window.__gd && window.__gd.screen());
      await dg.gd('setToday', '2026-11-19');
      await dg.toMap();
      eq('daily: records survive a reload', Object.keys((await dg.gd('save')).daily).sort(), ['2026-11-17', TODAY]);
      await dg.page.locator('#daily-play').tap();
      await dg.page.waitForFunction(() => window.__gd.screen() === 'level');
      if ((await dg.gd('panel')) === 'card') await dg.page.keyboard.press('Escape');
      await dg.page.locator('#back').tap();
      eq('daily: Back from a daily cavern goes to the map', await dg.gd('screen'), 'map');
      await dg.page.locator('#set-reset').tap();
      await dg.page.locator('#confirm-yes').tap();
      eq('daily: Reset progress clears the records', (await dg.gd('save')).daily, {});
      eq('daily: and the streak', await txt('#daily-streak'), 'Light today\'s cavern to start a streak.');
      eq('daily: Reset keeps the Glimmer', (await dg.gd('shop')).glimmer, 4);
      await dg.close();
    }
    {
      // the Hint button's price line, on a fresh save
      const hp = await phone({ tag: 'hints' });
      const txt = async (sel) => ((await hp.page.locator(sel).textContent()) || '').trim();
      const askHint = async () => {
        await hp.page.locator('#btn-hint').tap();
        await hp.page.waitForFunction(() => !document.querySelector('#btn-hint').classList.contains('thinking'));
        await hp.page.waitForTimeout(80);
      };
      await hp.open();
      await hp.toMap();
      await hp.page.locator(`.node[data-level="${first.id}"]`).tap();
      await hp.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('hint price: the first hint is free', [await txt('#hint-val'), await hp.page.locator('#btn-hint').getAttribute('aria-label')], ['free', 'Hint, free']);
      await askHint();
      ok('hint price: the free hint shows a hint', (await hp.gd('hint')) !== null);
      ok('hint price: the free hint is timed', (await hp.gd('shop')).freeAt > 0);
      eq('hint price: its next step is free', [await txt('#hint-val'), (await hp.gd('shop')).glimmer], ['more', 3]);
      await hp.gd('act', solutionOf(first)[0]);
      await hp.idle();
      eq('hint price: so is every position along its way', await txt('#hint-val'), 'more');
      await askHint();
      eq('hint price: a step along the way spends nothing', [(await hp.gd('shop')).glimmer, await hp.gd('hints')], [3, 1]);
      await hp.gd('act', offTheWay(first, await hp.gd('state')));
      await hp.idle();
      eq('hint price: off the way, then Glimmer', [await txt('#hint-val'), await hp.page.locator('#btn-hint').getAttribute('aria-label')], ['3 left', 'Hint, 3 Glimmer left']);
      await askHint();
      eq('hint price: a new hint spends one Glimmer', [(await hp.gd('shop')).glimmer, await txt('#hint-val')], [2, 'more']);
      ok('hint price: and shows a hint', (await hp.gd('hint')) !== null);
      await hp.close();
    }
    {
      // nothing left to pay with: the Hint opens the store instead
      const np = await phone({
        tag: 'no-glimmer',
        seed: { levels: {}, seen: ['prologue'], shop: { full: false, glimmer: 0, freeAt: Date.now(), paid: [] },
          settings: { sound: true, contrast: false, unlockAll: false, tutorials: false } },
      });
      const txt = async (sel) => ((await np.page.locator(sel).textContent()) || '').trim();
      await np.open();
      await np.toMap();
      await np.page.locator(`.node[data-level="${first.id}"]`).tap();
      await np.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('no Glimmer: the Hint button says when', [await txt('#hint-val'), await np.page.locator('#btn-hint').getAttribute('aria-label')],
        ['in 10 min', 'Hint, next free hint in 10 min']);
      await np.page.locator('#btn-hint').tap();
      await np.page.waitForFunction(() => window.__gd.panel() === 'shop');
      eq('no Glimmer: Hint opens the store', [await np.gd('screen'), await np.gd('panel')], ['level', 'shop']);
      eq('no Glimmer: the store says when the next free hint comes', await txt('#shop-why'), 'No Glimmer left. The next free hint comes in 10 min.');
      eq('no Glimmer: no hint, nothing spent', [await np.gd('hint'), await np.gd('hints'), (await np.gd('shop')).glimmer], [null, 0, 0]);
      await auditPage(np, 'store from a level');
      await np.shot('store-no-glimmer');
      await np.page.locator('#shop-jar').tap();
      await np.page.waitForFunction(() => window.__gd.shop().glimmer === 10);
      await np.page.keyboard.press('Escape');
      eq('no Glimmer: Escape closes the store and stays on the level', [await np.gd('screen'), await np.gd('panel')], ['level', null]);
      eq('no Glimmer: a jar refills the Hint button', await txt('#hint-val'), '10 left');
      await np.page.locator('#btn-hint').tap();
      await np.page.waitForFunction(() => window.__gd.hint() !== null, null, { timeout: 8000 }).catch(() => {});
      eq('no Glimmer: then a hint costs one', [(await np.gd('hint')) !== null, (await np.gd('shop')).glimmer, await txt('#hint-val')], [true, 9, 'more']);
      await np.close();
    }

    // ---------------------------------------------------------------- Gloam encounters (SPEC section 17)
    console.log('gloam encounters');
    {
      const ge = await phone({ tag: 'gloam' });
      const txt = async (sel) => ((await ge.page.locator(sel).textContent()) || '').trim();
      // the Hush creeps east a tile a turn; Wren waits at x 5 without the lantern and is caught on turn 4
      const CREEP = { id: 'T-G', name: 'Creep Test', par: 9, feature: 'H', gloam: true, map: ['#########', '#H...W..#', '#######L#', '#G#######'] };
      const CAUGHT = 'The Hush caught you. Three steps back.';
      await ge.open();
      await ge.gd('loadLevelDef', CREEP);
      await ge.hold(await ge.tile(1, 1), 620);
      await ge.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 2000 }).catch(() => {});
      eq('gloam: holding the Hush opens the Gloam\'s card', [await txt('#card-title'), await txt('#card-text')],
        ["The Gloam's Hush", "The Gloam's Hush creeps onto every dark floor tile beside it, one step each turn. Light holds it back. If it reaches Wren, you step back three turns."]);
      await ge.page.keyboard.press('Escape');
      for (let i = 0; i < 3; i++) {
        await ge.gd('act', 'Z');
        await ge.idle();
      }
      eq('gloam: the Hush crept a tile a turn', (await ge.gd('state')).hush, ['2,1', '3,1', '4,1']);
      await ge.gd('act', 'Z');
      eq('gloam: Wren is caught', [await ge.gd('caught'), await ge.gd('catches')], [true, 1]);
      eq('gloam: the status row says so', await txt('#status'), CAUGHT);
      ok('gloam: nothing moves while caught', (await ge.gd('state')).caught && !(await ge.page.evaluate(() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        return window.__gd.state().turn !== 4;
      })));
      await ge.page.waitForTimeout(250);
      await ge.shot('gloam-caught');
      await ge.page.waitForFunction(() => !window.__gd.caught(), null, { timeout: 5000 }).catch(() => {});
      ok('gloam: the catch plays its sound', (await ge.gd('heard')).includes('caught'));
      eq('gloam: then three moves go back', [await ge.gd('caught'), await ge.gd('moves'), (await ge.gd('state')).hush], [false, 1, ['2,1']]);
      eq('gloam: the message stays until the next move', await txt('#status'), CAUGHT);
      ok('gloam: one catch does not pulse Hint', !(await ge.page.locator('#btn-hint').getAttribute('class')).includes('pulse'));
      for (let i = 0; i < 3; i++) {
        await ge.gd('act', 'Z');
        await ge.idle().catch(() => {});
      }
      await ge.page.waitForFunction(() => window.__gd.catches() === 2 && !window.__gd.caught(), null, { timeout: 5000 }).catch(() => {});
      eq('gloam: caught again, and back again', [await ge.gd('catches'), await ge.gd('moves')], [2, 1]);
      ok('gloam: after two catches Hint pulses', (await ge.page.locator('#btn-hint').getAttribute('class')).includes('pulse'));
      await ge.page.locator('#btn-undo').tap();
      ok('gloam: an undo sends the pulse away', !(await ge.page.locator('#btn-hint').getAttribute('class')).includes('pulse'));
      await auditPage(ge, 'gloam encounter');
      // the map: every chapter ends with its encounter, ringed with Hush
      await ge.gd('setToday', '2026-11-18');
      await ge.open();
      await ge.toMap();
      const enc = CHAPTERS.map((c) => c.levels[c.levels.length - 1]);
      ok('gloam: every chapter ends with an encounter', enc.every((d) => d.gloam === true), enc.map((d) => d.id).join(' '));
      eq('gloam: their nodes are marked, the Night Garden\'s too', await ge.page.locator('.node.gloam').count(), CHAPTERS.length + NIGHT.filter((d) => d.gloam).length);
      ok('gloam: and say so', (await ge.page.locator(`.node[data-level="${enc[0].id}"]`).getAttribute('aria-label')).includes('Gloam encounter'));
      await ge.close();
    }

    // ---------------------------------------------------------------- the Night Garden (SPEC sections 19 and 20)
    console.log('night garden');
    {
      ok('garden: ten deep puzzles at least', NIGHT.length >= 10, NIGHT.length);
      const [n1, n2] = NIGHT;
      const allLit = (stars) => Object.fromEntries(LEVELS.map((d) => [d.id, { moves: d.par, stars }]));
      // a save where the story is done (every chapter level lit), with every story page read
      const seeded = (levels, full, tutorials) => ({
        levels, seen: STORY.map((p) => p.id),
        shop: { full, glimmer: 3, freeAt: 0, paid: [] },
        settings: { sound: true, contrast: false, unlockAll: false, tutorials },
      });
      const at = (ph) => async (sel) => ((await ph.page.locator(sel).textContent()) || '').trim();
      const note = (moss) => `Opens when the story is done and you have 100 star moss. You have ${moss}.`;
      // the map back at its top, so the thumb-reach audit sees what a player sees there
      const toTop = (ph) => ph.page.evaluate(() => {
        window.scrollTo(0, 0);
        for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0;
      });

      // bought, the story done, but one star moss a cavern: not enough
      const poor = await phone({ tag: 'garden-closed', seed: seeded(allLit(1), true, true) });
      let txt = at(poor);
      await poor.open();
      eq('garden: deep puzzles do not count toward the caverns lit', await txt('#title-progress'), `${LEVELS.length} of ${LEVELS.length} caverns lit`);
      await poor.toMap();
      eq('garden: the last section of the map', await poor.page.evaluate(() => {
        const all = document.querySelectorAll('.chapter');
        return all[all.length - 1].id;
      }), 'garden');
      eq('garden: "Deep puzzles" over "The Night Garden"', [await txt('#garden .kicker'), await txt('#garden h2')], ['Deep puzzles', 'The Night Garden']);
      eq('garden: says what it waits for', await txt('#garden-note'), note(LEVELS.length));
      eq('garden: no tally while closed', await poor.page.locator('#garden .tally').count(), 0);
      eq('garden: a node for each puzzle', await poor.page.locator('#garden .node').count(), NIGHT.length);
      eq('garden: its first puzzle is locked, and says why', await poor.page.locator(`.node[data-level="${n1.id}"]`).getAttribute('aria-label'),
        `Night Garden 1, locked. ${note(LEVELS.length)}`);
      await poor.page.locator(`.node[data-level="${n1.id}"]`).tap({ force: true });   // aria-disabled, but a finger can still tap it
      eq('garden: a closed puzzle does not open', [await poor.gd('screen'), await poor.gd('panel')], ['map', null]);
      await toTop(poor);
      await auditPage(poor, 'garden closed');
      await poor.close();

      // not bought: the garden is part of the Full Expedition
      const unpaid = await phone({ tag: 'garden-unpaid', seed: seeded(allLit(3), false, true) });
      txt = at(unpaid);
      await unpaid.open();
      await unpaid.toMap();
      eq('garden: not bought, an Unlock button', await unpaid.page.locator('#garden .chapter-unlock').getAttribute('aria-label'),
        'Unlock The Night Garden with the Full Expedition');
      eq('garden: its puzzles say so', await unpaid.page.locator(`.node[data-level="${n1.id}"]`).getAttribute('aria-label'),
        'Night Garden 1, locked. Part of the Full Expedition.');
      await unpaid.page.locator('#garden .chapter-unlock').tap();
      await unpaid.page.waitForFunction(() => window.__gd.panel() === 'shop');
      eq('garden: Unlock opens the store, and says why', await txt('#shop-why'), 'The Night Garden is part of the Full Expedition.');
      await unpaid.close();

      // bought, the story done, two star moss a cavern: open
      const gd = await phone({ tag: 'garden', seed: seeded(allLit(2), true, true) });
      txt = at(gd);
      await gd.open();
      await gd.toMap();
      eq('garden: open, the note goes', await gd.page.locator('#garden-note').count(), 0);
      eq('garden: and the tally counts its puzzles', await txt('#garden .tally'), `0 of ${NIGHT.length} lit`);
      ok('garden: its first puzzle is next', (await gd.page.locator(`.node[data-level="${n1.id}"]`).getAttribute('class')).includes('next'));
      eq('garden: and labelled', await gd.page.locator(`.node[data-level="${n1.id}"]`).getAttribute('aria-label'), `Night Garden 1, ${n1.name}, not solved yet`);
      ok('garden: the second still waits', (await gd.page.locator(`.node[data-level="${n2.id}"]`).getAttribute('class')).includes('locked'));
      await toTop(gd);
      await auditPage(gd, 'garden open');
      await gd.page.locator('#garden').scrollIntoViewIfNeeded();
      await gd.shot('garden-map');
      await gd.page.locator(`.node[data-level="${n1.id}"]`).tap();
      await gd.page.waitForFunction(() => window.__gd.screen() === 'level');
      eq('garden: the level screen says "Night Garden 1"', await txt('#level-id'), 'Night Garden 1');
      await gd.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 3000 }).catch(() => {});
      eq('garden: the first puzzle opens with the Crystal card', [await txt('#card-title'), await txt('#card-text')], ['Crystal', CARDS.Crystal]);
      await gd.page.keyboard.press('Escape');
      await gd.page.waitForFunction(() => window.__gd.panel() === null);
      // holding a crystal wall shows its card too
      const start = engine.parseLevel(n1);
      let crystal = null;
      n1.map.forEach((row, y) => Array.from(row).forEach((ch, x) => { if (ch === '*' && !crystal) crystal = [x, y]; }));
      await gd.hold(await gd.tile(crystal[0], crystal[1]), 620);
      await gd.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 2000 }).catch(() => {});
      eq('garden: holding a crystal wall opens its card', await txt('#card-title'), 'Crystal');
      await gd.page.keyboard.press('Escape');
      await gd.page.waitForFunction(() => window.__gd.panel() === null);
      eq('garden: nothing moved', (await gd.gd('state')).turn, start.turn);
      await auditPage(gd, 'garden level');
      const sol = solutionOf(n1);
      await playByKeys(gd, sol.slice(0, Math.ceil(sol.length / 2)), true);
      await gd.shot('garden-level');
      await playByKeys(gd, sol.slice(Math.ceil(sol.length / 2)), true);
      await waitResult(gd);
      eq('garden: the result says "Night Garden 1 lit"', await txt('#result-id'), 'Night Garden 1 lit');
      eq('garden: its record is kept', (await gd.gd('save')).levels[n1.id], { moves: sol.length, stars: 3 });
      ok('garden: Next level goes on through the garden', await gd.page.locator('#result-next').isVisible());
      await gd.page.locator('#result-next').tap();
      await gd.page.waitForFunction(() => window.__gd.screen() === 'level' && window.__gd.panel() !== 'result');
      eq('garden: to Night Garden 2', await txt('#level-id'), 'Night Garden 2');
      await gd.gd('loadLevel', NIGHT[NIGHT.length - 1].id);
      eq('garden: __gd.loadLevel finds deep puzzles', await txt('#level-id'), `Night Garden ${NIGHT.length}`);
      await gd.reopen();
      eq('garden: still every chapter cavern lit, no more', await txt('#title-progress'), `${LEVELS.length} of ${LEVELS.length} caverns lit`);
      await gd.toMap();
      eq('garden: the tally counts the lit puzzle', await txt('#garden .tally'), `1 of ${NIGHT.length} lit`);
      ok('garden: and the second opened', !(await gd.page.locator(`.node[data-level="${n2.id}"]`).getAttribute('class')).includes('locked'));
      await gd.close();
    }

    // ---------------------------------------------------------------- comfort settings (SPEC section 22)
    console.log('comfort');
    {
      const cf = await phone({ tag: 'comfort' });
      const txt = async (sel) => ((await cf.page.locator(sel).textContent()) || '').trim();
      const pressed = (sel) => cf.page.locator(sel).getAttribute('aria-pressed');
      const px = (sel, prop) => cf.page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);
      // nothing on the page wider than the screen, and nothing inside a sheet wider than the sheet
      const sideways = () => cf.page.evaluate(() => {
        const out = [];
        const W = window.innerWidth;
        if (document.documentElement.scrollWidth > W + 1) out.push(`page ${document.documentElement.scrollWidth}`);
        for (const el of document.querySelectorAll('#app *')) {
          const r = el.getBoundingClientRect();
          if (!r.width || getComputedStyle(el).visibility === 'hidden' || el.closest('[hidden]')) continue;
          if (el.closest('.chapters, .trail, .daily-week, canvas')) continue;   // the map's own scrolling column
          if (r.right > W + 1 || r.left < -1) out.push(`${el.id || el.className || el.tagName} ${Math.round(r.left)}..${Math.round(r.right)}`);
          if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'hidden' && el.clientWidth > 0
            && /^(P|H[1-6]|SPAN|LI|BUTTON|ASIDE)$/.test(el.tagName)) out.push(`${el.id || el.className || el.tagName} scrolls sideways`);
        }
        return out.slice(0, 8);
      });
      await cf.open();
      await cf.toMap();
      eq('comfort: a sixth setting, at 100%', [await txt('#set-comfort .lbl'), await txt('#set-comfort .val'), await pressed('#set-comfort')], ['Comfort', '100%', 'false']);
      await cf.page.locator('#set-comfort').tap();
      await cf.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      ok('comfort: the sheet opens', await cf.page.locator('#comfort').isVisible());
      eq('comfort: Done has the focus', await cf.page.evaluate(() => document.activeElement && document.activeElement.id), 'comfort-close');
      eq('comfort: the defaults are pressed', await cf.page.evaluate(() => [...document.querySelectorAll('#comfort .choice[aria-pressed="true"]')].map((b) => b.textContent)),
        ['100%', 'Off', 'As phone', 'Off', 'Right', 'Normal', 'Off']);   // then the controls (SPEC section 27) and Board talk (28)
      await auditPage(cf, 'comfort sheet');
      await cf.shot('comfort-sheet');
      await cf.page.locator('#comfort .choice[data-size="2"]').tap();
      eq('comfort: 200% chosen', [await pressed('#comfort .choice[data-size="2"]'), await pressed('#comfort .choice[data-size="1"]')], ['true', 'false']);
      eq('comfort: saved', (await cf.gd('save')).settings.textSize, 2);
      eq('comfort: the setting shows it', [await txt('#set-comfort .val'), await pressed('#set-comfort')], ['200%', 'true']);
      eq('comfort: the sheet itself fits sideways at 200%', await sideways(), []);
      await cf.page.locator('#comfort-close').tap();
      eq('comfort: Done closes it', await cf.gd('panel'), null);
      await cf.page.locator('#set-comfort').tap();
      await cf.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      await cf.page.keyboard.press('Escape');
      eq('comfort: Escape closes it', [await cf.gd('panel'), await cf.gd('screen')], [null, 'map']);
      await cf.page.locator('#set-comfort').tap();
      await cf.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      await cf.page.touchscreen.tap(195, 30);
      eq('comfort: a tap outside closes it', await cf.gd('panel'), null);
      eq('comfort: the map at 200% does not spill sideways', await sideways(), []);

      // reading text doubles, controls keep their size
      await cf.gd('loadLevel', first.id);
      eq('comfort: the status row at 200%', await px('#status', 'fontSize'), '30px');
      eq('comfort: buttons keep their size', await px('#btn-undo .lbl', 'fontSize'), await (async () => {
        const plain = await phone({ tag: 'comfort-plain' });
        await plain.open();
        await plain.gd('loadLevel', first.id);
        const v = await plain.page.evaluate(() => getComputedStyle(document.querySelector('#btn-undo .lbl')).fontSize);
        await plain.close();
        return v;
      })());
      eq('comfort: the level at 200% does not spill sideways', await sideways(), []);
      const s1 = engine.parseLevel(first);
      const moth = s1.creatures.find((c) => c.type === 'M');
      await cf.hold(await cf.tile(moth.x, moth.y), 620);
      await cf.page.waitForFunction(() => window.__gd.panel() === 'card', null, { timeout: 2000 }).catch(() => {});
      eq('comfort: a rule card at 200%', [await px('#card-text', 'fontSize'), await px('#card-preview', 'fontSize')], ['36px', '34px']);
      {
        const box = await cf.page.locator('#card').boundingBox();
        ok('comfort: the card stays on screen', box.y >= 0 && box.y + box.height <= 844 + 1, JSON.stringify(box));
        await cf.page.locator('#card-close').scrollIntoViewIfNeeded();
        ok('comfort: and Got it can be reached', await cf.page.locator('#card-close').isVisible());
      }
      eq('comfort: the card does not spill sideways', await sideways(), []);
      await cf.page.evaluate(() => { document.getElementById('card').scrollTop = 0; });
      await cf.shot('comfort-card-200');
      await cf.page.keyboard.press('Escape');

      // the readable font
      await cf.page.locator('#back').tap();
      await cf.page.waitForFunction(() => window.__gd.screen() === 'map');
      await cf.page.locator('#set-comfort').tap();
      await cf.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      await cf.page.locator('#comfort .choice[data-readable="true"]').tap();
      ok('comfort: readable font on', await cf.page.evaluate(() => document.getElementById('app').classList.contains('readable')));
      ok('comfort: the sheet now reads in a plain sans', /^Verdana/.test(await px('#comfort .opt-note', 'fontFamily')), await px('#comfort .opt-note', 'fontFamily'));
      eq('comfort: and upright', await px('#comfort .opt-note', 'fontStyle'), 'normal');
      eq('comfort: still nothing sideways with both on', await sideways(), []);
      await cf.page.keyboard.press('Escape');
      await cf.gd('loadLevel', first.id);
      eq('comfort: the status row is upright too', await px('#status', 'fontStyle'), 'normal');
      eq('comfort: the level does not spill sideways with both on', await sideways(), []);
      await cf.shot('comfort-level-readable');

      // motion: Reduced holds the board still on a phone that asks for nothing
      eq('comfort: As phone, a phone asking for nothing moves', await cf.gd('reduced'), false);
      await cf.page.locator('#back').tap();
      await cf.page.waitForFunction(() => window.__gd.screen() === 'map');
      await cf.page.locator('#set-comfort').tap();
      await cf.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      await cf.page.locator('#comfort .choice[data-motion="reduced"]').tap();
      eq('comfort: Reduced holds still', [await cf.gd('reduced'), (await cf.gd('save')).settings.motion], [true, 'reduced']);
      ok('comfort: and stops the page\'s animations', await cf.page.evaluate(() => document.getElementById('app').classList.contains('motion-reduced')));
      await cf.page.keyboard.press('Escape');
      // kept over a reload
      await cf.page.reload();
      await cf.page.waitForFunction(() => window.__gd && window.__gd.screen());
      await cf.toMap();
      eq('comfort: kept over a reload', [(await cf.gd('save')).settings.textSize, (await cf.gd('save')).settings.readable, (await cf.gd('save')).settings.motion, await cf.gd('reduced')],
        [2, true, 'reduced', true]);
      eq('comfort: and applied again', await cf.page.evaluate(() => document.getElementById('app').style.getPropertyValue('--ts')), '2');
      await cf.close();

      // a phone that asks for reduced motion: As phone follows it, Full overrides it
      const rm = await phone({ tag: 'comfort-motion', reducedMotion: 'reduce' });
      await rm.open();
      await rm.toMap();
      eq('comfort: As phone follows a phone that asks for less', await rm.gd('reduced'), true);
      await rm.page.locator('#set-comfort').tap();
      await rm.page.waitForFunction(() => window.__gd.panel() === 'comfort');
      await rm.page.locator('#comfort .choice[data-motion="full"]').tap();
      eq('comfort: Full plays everything anyway', await rm.gd('reduced'), false);
      ok('comfort: the page too', await rm.page.evaluate(() => document.getElementById('app').classList.contains('motion-full')));
      await rm.close();
    }

    // ---------------------------------------------------------------- lantern styles (SPEC section 24)
    console.log('lantern styles');
    {
      // 64 star moss: 21 levels with three and one with one. Tallow, Mossglow and Ember rose are open.
      const levels = {};
      LEVELS.slice(0, 21).forEach((def) => { levels[def.id] = { moves: def.par, stars: 3 }; });
      levels[LEVELS[21].id] = { moves: LEVELS[21].par + 9, stars: 1 };
      const ln = await phone({
        tag: 'lanterns',
        seed: { levels, seen: ['prologue', ...CHAPTERS.map((c) => 'ch' + c.id)], critters: [], shop: { full: true, glimmer: 3, freeAt: 0, paid: [] }, settings: { tutorials: false } },
      });
      const txt = async (sel) => ((await ln.page.locator(sel).textContent()) || '').trim();
      const inView = async (sel, W = 390, H = 844) => {
        const b = await ln.page.locator(sel).boundingBox();
        return !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= W && b.y + b.height <= H ? true : JSON.stringify(b);
      };
      const sheetOpen = () => ln.page.waitForFunction(() => window.__gd.panel() === 'lanterns');
      const labels = () => ln.page.locator('#lantern-list .style').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
      const pressedStyles = () => ln.page.locator('#lantern-list .style[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.dataset.style));
      const lastHeard = async () => (await ln.gd('heard')).slice(-1)[0];
      // the average colour of a lit floor tile beside Wren, as drawn
      const litColour = async () => {
        await ln.page.waitForTimeout(300);
        const w = (await ln.gd('state')).wren;
        const t = await ln.tile(w.x + 1, w.y);
        const png = await ln.page.screenshot({ clip: { x: t.x - t.size / 4, y: t.y - t.size / 4, width: t.size / 2, height: t.size / 2 } });
        return ln.page.evaluate(async (b64) => {
          const img = new Image();
          img.src = 'data:image/png;base64,' + b64;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const sum = [0, 0, 0];
          for (let i = 0; i < d.length; i += 4) { sum[0] += d[i]; sum[1] += d[i + 1]; sum[2] += d[i + 2]; }
          return sum.map((v) => Math.round(v / (d.length / 4)));
        }, png.toString('base64'));
      };
      const openFirst = async () => {
        await ln.page.locator(`.node[data-level="${first.id}"]`).tap();
        await ln.page.waitForFunction(() => window.__gd.screen() === 'level');
        if ((await ln.gd('panel')) === 'card') await ln.page.keyboard.press('Escape');
      };
      const backToMap = async () => {
        await ln.page.locator('#back').tap();
        await ln.page.waitForFunction(() => window.__gd.screen() === 'map');
      };

      await ln.open();
      await ln.toMap();
      eq('lanterns: a fresh choice is Tallow, in use', [(await ln.gd('save')).settings.lantern, await ln.gd('lantern')], ['tallow', 'tallow']);
      ok('lanterns: the map has a Lantern button', await ln.page.locator('#btn-lanterns').isVisible());
      eq('lanterns: it is labelled', [await ln.page.locator('#btn-lanterns').getAttribute('aria-label'), await txt('#btn-lanterns .lbl')], ['Lantern styles', 'Lantern']);
      for (const id of ['btn-journal', 'btn-shop', 'btn-lanterns']) {
        eq(`lanterns: #${id} on screen, in thumb reach`, [await inView(`#${id}`), (await ln.page.locator(`#${id}`).boundingBox()).y > 844 / 2], [true, true]);
      }

      // a level drawn in Tallow, to compare with
      await openFirst();
      const tallowLight = await litColour();
      await backToMap();

      await ln.page.locator('#btn-lanterns').tap();
      await sheetOpen();
      ok('lanterns: the sheet shows', await ln.page.locator('#lanterns').isVisible());
      eq('lanterns: its heading', [await txt('#lanterns .kicker'), await txt('#lanterns-title')], ["Wren's lantern", 'Lantern styles']);
      eq('lanterns: it counts the star moss', await txt('#lanterns-moss'), 'You have 64 star moss.');
      eq('lanterns: Done has the focus', await ln.page.evaluate(() => document.activeElement && document.activeElement.id), 'lanterns-close');
      eq('lanterns: one button per style, in order', await ln.page.locator('#lantern-list .style').evaluateAll((els) => els.map((e) => e.dataset.style)),
        ['tallow', 'mossglow', 'emberrose', 'moonglass', 'heartroot', 'gloamlight']);
      eq('lanterns: each says its state', await labels(), ['Tallow. In use.', 'Mossglow. Use it.', 'Ember rose. Use it.',
        'Moonglass. Needs 100 star moss.', 'Heartroot. Needs 150 star moss.', 'Gloamlight. Needs 200 star moss.']);
      eq('lanterns: the one in use is pressed', await pressedStyles(), ['tallow']);
      eq('lanterns: the locked ones are disabled, with a lock',
        [await ln.page.locator('#lantern-list .style[aria-disabled="true"]').count(), await ln.page.locator('#lantern-list .style.locked .ico').count()], [3, 3]);
      eq('lanterns: every style shows its picture',
        await ln.page.locator('#lantern-list .style-art').evaluateAll((els) => els.filter((e) => /url\(/.test(e.style.backgroundImage)).length), 6);
      eq('lanterns: and its note', await ln.page.locator('#lantern-list .style-note').evaluateAll((els) => els.every((e) => e.textContent.length > 10)), true);
      eq('lanterns: Done on screen', await inView('#lanterns-close'), true);
      await auditPage(ln, 'lanterns');
      await ln.shot('lanterns');

      // choosing one
      await ln.page.locator('.style[data-style="mossglow"]').tap();
      eq('lanterns: an open style is used at once', [(await ln.gd('save')).settings.lantern, await ln.gd('lantern')], ['mossglow', 'mossglow']);
      eq('lanterns: it plays the plant sound', await lastHeard(), 'plant');
      eq('lanterns: the sheet stays open', await ln.gd('panel'), 'lanterns');
      eq('lanterns: the states follow', (await labels()).slice(0, 2), ['Tallow. Use it.', 'Mossglow. In use.']);
      eq('lanterns: the new one is pressed', await pressedStyles(), ['mossglow']);
      await ln.page.locator('.style[data-style="moonglass"]').tap({ force: true });   // aria-disabled, but a player can still tap it
      eq('lanterns: a locked style plays blocked', await lastHeard(), 'blocked');
      eq('lanterns: and changes nothing', [(await ln.gd('save')).settings.lantern, await ln.gd('lantern')], ['mossglow', 'mossglow']);
      await ln.shot('lanterns-mossglow');
      await ln.page.keyboard.press('Escape');
      eq('lanterns: Escape (Back) closes it', [await ln.gd('screen'), await ln.gd('panel'), await ln.page.locator('#lanterns').isVisible()], ['map', null, false]);
      await ln.page.locator('#btn-lanterns').tap();
      await sheetOpen();
      await ln.page.locator('#lanterns-close').tap();
      eq('lanterns: Done closes it', await ln.gd('panel'), null);
      await ln.page.locator('#btn-lanterns').tap();
      await sheetOpen();
      await ln.page.touchscreen.tap(5, 422);
      eq('lanterns: a tap outside closes it', await ln.gd('panel'), null);

      // the board's light takes the style's colour
      await openFirst();
      eq('lanterns: the level uses it', await ln.gd('lantern'), 'mossglow');
      {
        const moss = await litColour();
        ok('lanterns: lit tiles turn greener in Mossglow', moss[1] - moss[0] > tallowLight[1] - tallowLight[0] + 6, JSON.stringify({ tallow: tallowLight, mossglow: moss }));
      }
      await ln.shot('lanterns-level');
      await backToMap();

      // Unlock all never unlocks a style
      await ln.page.locator('#set-unlock').tap();
      await ln.page.locator('#btn-lanterns').tap();
      await sheetOpen();
      eq('lanterns: Unlock all opens no style', (await labels())[3], 'Moonglass. Needs 100 star moss.');
      await ln.page.keyboard.press('Escape');
      await ln.page.locator('#set-unlock').tap();

      // kept when the app starts again
      await ln.reopen();
      await ln.toMap();
      eq('lanterns: the choice is kept', [(await ln.gd('save')).settings.lantern, await ln.gd('lantern')], ['mossglow', 'mossglow']);

      // Reset progress keeps the choice, but the moss starts again, so Tallow is back
      await ln.page.locator('#set-reset').tap();
      await ln.page.locator('#confirm-yes').tap();
      eq('lanterns: Reset keeps the choice, Tallow is in use', [(await ln.gd('save')).settings.lantern, await ln.gd('lantern')], ['mossglow', 'tallow']);
      await ln.page.locator('#btn-lanterns').tap();
      await sheetOpen();
      eq('lanterns: no star moss after Reset', await txt('#lanterns-moss'), 'You have 0 star moss.');
      eq('lanterns: Mossglow locked again', (await labels()).slice(0, 2), ['Tallow. In use.', 'Mossglow. Needs 30 star moss.']);
      await ln.close();

      // a small phone: the three buttons fit side by side
      const sm = await phone({ tag: 'lanterns-small', viewport: { width: 360, height: 640 } });
      await sm.open();
      await sm.toMap();
      const boxes = [];
      for (const id of ['btn-journal', 'btn-shop', 'btn-lanterns']) boxes.push(await sm.page.locator(`#${id}`).boundingBox());
      eq('lanterns: on a small phone the row fits the screen', boxes.every((b) => b.x >= 0 && b.x + b.width <= 360) || JSON.stringify(boxes), true);
      eq('lanterns: in one row, none overlapping',
        boxes.every((b, i) => i === 0 || (b.x >= boxes[i - 1].x + boxes[i - 1].width && Math.abs(b.y - boxes[0].y) < 20)) || JSON.stringify(boxes), true);
      eq('lanterns: and the page does not scroll sideways', await sm.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      // the sheet's heading and Done stay put on a short screen; the styles scroll between them
      await sm.page.locator('#btn-lanterns').tap();
      await sm.page.waitForFunction(() => window.__gd.panel() === 'lanterns');
      const within = async (sel) => {
        const b = await sm.page.locator(sel).boundingBox();
        return !!b && b.y >= 0 && b.y + b.height <= 640 ? true : JSON.stringify(b);
      };
      eq('lanterns: on a small phone the heading and Done are on screen', [await within('#lanterns-title'), await within('#lanterns-close')], [true, true]);
      await sm.page.locator('#lantern-list').evaluate((el) => { el.scrollTop = el.scrollHeight; });
      eq('lanterns: the last style scrolls into view, Done still on screen',
        [await within('.style[data-style="gloamlight"]'), await within('#lanterns-title'), await within('#lanterns-close')], [true, true, true]);
      await sm.shot('lanterns-small');
      await sm.close();
    }
  }


  // ------------------------------------------------------------------ Board talk (SPEC section 28)
  async function talkChecks() {
    console.log('talk');
    const seen = ['prologue', ...CHAPTERS.map((c) => 'ch' + c.id)];
    const t = await phone({ tag: 'talk', seed: { levels: {}, seen, critters: [], settings: { tutorials: false } } });
    const pressed = (sel) => t.page.locator(sel).getAttribute('aria-pressed');
    const live = () => t.gd('boardTalk');
    const spoken = () => t.gd('spoken');
    const openSheet = async () => {
      await t.page.locator('#set-comfort').tap();
      await t.page.waitForFunction(() => window.__gd.panel() === 'comfort');
    };
    const toMap = async () => {
      await t.page.locator('#back').tap();
      await t.page.waitForFunction(() => window.__gd.screen() === 'map');
    };
    const openFirst = async () => {
      await t.gd('loadLevel', first.id);
      if ((await t.gd('panel')) === 'card') await t.page.keyboard.press('Escape');
      await t.idle();
    };
    const words = async () => talkWords.describeBoard(await t.gd('state'), { par: first.par });
    const sol = solutionOf(first);
    const press = async (m) => {
      if (DIRV[m]) await t.page.keyboard.press({ N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft' }[m]);
      else if (m === 'L') await t.page.locator('#btn-lantern').tap();
      else await t.page.locator('#btn-wait').tap();
      await t.idle();
    };
    const wall = (() => {
      const s0 = engine.parseLevel(first);
      return ['N', 'S', 'W', 'E'].find((d) => engine.step(s0, d) === null && talkWords.describeRefusal(s0, d).startsWith("Can't go"));
    })();

    await t.open();
    await t.toMap();
    await openSheet();
    eq('talk: Board talk is the last choice on the Comfort sheet', await t.page.evaluate(() => [...document.querySelectorAll('#comfort h4')].map((h) => h.textContent).pop()), 'Board talk');
    eq('talk: Off and On, Off pressed', await t.page.evaluate(() => [...document.querySelectorAll('#comfort .choice[data-talk]')].map((b) => [b.textContent, b.getAttribute('aria-pressed')])),
      [['Off', 'true'], ['On', 'false']]);
    await t.page.keyboard.press('Escape');

    // off: TalkBack still gets the words, the voice says nothing, no Describe
    await openFirst();
    eq('talk: off, no Describe button', await t.page.locator('#btn-describe').isVisible(), false);
    const label0 = await t.gd('boardLabel');
    eq('talk: the board label is the whole board in words', label0, `The cave board. ${(await words()).join(' ')}`);
    ok('talk: opening a level tells TalkBack its name and the board', (await live()).includes(first.name) && (await live()).includes('Move 0'), await live());
    eq('talk: off, the voice is quiet', await spoken(), '');
    await press(sol[0]);
    eq('talk: a move goes to the live region in words', await live(), talkWords.describeTurn(await t.gd('state')));
    ok('talk: the board label follows the move', (await t.gd('boardLabel')).includes(`Move 1, par ${first.par}.`), await t.gd('boardLabel'));
    await t.page.keyboard.press('r');
    await t.idle();
    ok('talk: a restart says so', (await live()).startsWith('Back to the start.'), await live());
    if (wall) {
      const s0 = await t.gd('state');
      await press(wall);
      eq('talk: a refused move says why', await live(), talkWords.describeRefusal(s0, wall));
      await press(wall);
      eq('talk: the same refusal twice is still new words for TalkBack', (await live()).trim(), talkWords.describeRefusal(s0, wall));
      ok('talk: ... with a different text', (await live()) !== talkWords.describeRefusal(s0, wall));
    } else {
      ok('talk: the first level has a wall beside Wren at the start', false);
    }
    eq('talk: off, still no voice', await spoken(), '');

    // on
    await toMap();
    await openSheet();
    await t.page.locator('#comfort .choice[data-talk="true"]').scrollIntoViewIfNeeded();
    await t.page.locator('#comfort .choice[data-talk="true"]').tap();
    eq('talk: on, saved and pressed', [(await t.gd('save')).settings.talk, await pressed('#comfort .choice[data-talk="true"]'), await pressed('#comfort .choice[data-talk="false"]')], [true, 'true', 'false']);
    eq('talk: turning it on says so', await spoken(), 'Board talk is on.');
    eq('talk: the Comfort setting shows a change', await pressed('#set-comfort'), 'true');
    await t.page.keyboard.press('Escape');
    await openFirst();
    ok('talk: on, opening a level speaks its name and the whole board', (await spoken()).includes(first.name) && (await spoken()).endsWith((await words()).join(' ')), await spoken());
    ok('talk: on, Describe shows in the top bar', await t.page.locator('#btn-describe').isVisible());
    eq('talk: Describe is labelled', await t.page.locator('#btn-describe').getAttribute('aria-label'), 'Describe the board');
    {
      const r = await t.page.evaluate(() => {
        const box = (id) => document.getElementById(id).getBoundingClientRect();
        const bar = document.querySelector('#screen-level .topbar').getBoundingClientRect();
        const d = box('btn-describe');
        return { inBar: d.top >= bar.top - 1 && d.bottom <= bar.bottom + 1, order: box('back').left < box('btn-describe').left && d.right <= box('counter').left + 1, size: [d.width, d.height] };
      });
      eq('talk: Describe sits in the top bar, before the counter', [r.inBar, r.order], [true, true]);
      ok('talk: Describe is a good size', r.size[0] >= 44 && r.size[1] >= 44, JSON.stringify(r.size));
    }
    await press(sol[0]);
    eq('talk: on, a move is spoken', await spoken(), talkWords.describeTurn(await t.gd('state')));
    eq('talk: ... and still goes to the live region', await live(), await spoken());
    await t.page.locator('#btn-describe').tap();
    await t.page.waitForFunction(() => window.__gd.panel() === 'talk');
    eq('talk: Describe opens the board in words, one sentence a line', await t.page.locator('#talk-lines li').allTextContents(), await words());
    eq('talk: ... and speaks it', await spoken(), (await words()).join(' '));
    eq('talk: Done has the focus', await t.page.evaluate(() => document.activeElement && document.activeElement.id), 'talk-close');
    await auditPage(t, 'talk sheet');
    await t.shot('talk-sheet');
    await t.page.keyboard.press('Escape');
    eq('talk: Back closes the sheet and stops the voice', [await t.gd('panel'), await spoken()], [null, '']);
    await t.page.locator('#btn-describe').tap();
    await t.page.waitForFunction(() => window.__gd.panel() === 'talk');
    await t.page.locator('#talk-close').tap();
    eq('talk: Done closes it too', [await t.gd('panel'), await spoken()], [null, '']);
    await t.page.locator('#btn-describe').tap();
    await t.page.waitForFunction(() => window.__gd.panel() === 'talk');
    await t.page.mouse.click(195, 30);
    eq('talk: a tap outside closes it too', await t.gd('panel'), null);
    await t.gd('undo');
    ok('talk: an undo is spoken', (await spoken()).startsWith('Back one move. '), await spoken());
    await auditPage(t, 'level with Describe');
    await t.shot('talk-level');
    {
      for (const m of sol) await press(m);
      await waitResult(t);
      eq('talk: the last move says every bud is in bloom', (await spoken()).endsWith('Every bud is in bloom.'), true);
      await t.page.locator('#result-replay').tap();
      await t.idle();
    }
    await toMap();
    eq('talk: leaving the level stops the voice', await spoken(), '');

    // the left hand mirrors the top bar, Describe included
    await openSheet();
    await t.page.locator('#comfort .choice[data-hand="left"]').scrollIntoViewIfNeeded();
    await t.page.locator('#comfort .choice[data-hand="left"]').tap();
    await t.page.keyboard.press('Escape');
    await openFirst();
    {
      const r = await t.page.evaluate(() => ['back', 'btn-describe', 'counter'].map((id) => document.getElementById(id).getBoundingClientRect().left));
      ok('talk: left hand, Describe sits between the counter and Back', r[2] < r[1] && r[1] < r[0], JSON.stringify(r));
    }

    // kept over a reload and by Reset progress; Off stops the voice
    await t.page.reload();
    await t.page.waitForFunction(() => window.__gd && window.__gd.screen());
    await t.toMap();
    eq('talk: kept over a reload', (await t.gd('save')).settings.talk, true);
    await t.page.locator('#set-reset').tap();
    await t.page.locator('#confirm-yes').tap();
    eq('talk: Reset progress keeps it', (await t.gd('save')).settings.talk, true);
    await openSheet();
    await t.page.locator('#comfort .choice[data-talk="false"]').scrollIntoViewIfNeeded();
    await t.page.locator('#comfort .choice[data-talk="false"]').tap();
    eq('talk: off again, saved, and the voice stops', [(await t.gd('save')).settings.talk, await spoken()], [false, '']);
    await t.close();

    // a small phone: the top bar keeps room for the name, the sheet keeps Done in reach
    const sm = await phone({ tag: 'talk-small', viewport: { width: 360, height: 640 }, seed: { levels: {}, seen, critters: [], settings: { tutorials: false, talk: true } } });
    await sm.open();
    await sm.toMap();
    const longest = [...LEVELS].sort((a, b) => b.name.length - a.name.length)[0];
    await sm.gd('loadLevel', longest.id);
    if ((await sm.gd('panel')) === 'card') await sm.page.keyboard.press('Escape');
    await sm.idle();
    {
      const r = await sm.page.evaluate(() => {
        const box = (sel) => document.querySelector(sel).getBoundingClientRect();
        return { right: box('#counter').right, left: box('#back').left, name: box('#level-name').width, d: box('#btn-describe').width };
      });
      ok('talk: on a small phone the top bar fits, with room for the name', r.left >= 0 && r.right <= 360 && r.name >= 90 && r.d >= 44, JSON.stringify(r));
    }
    await sm.shot('talk-small-level');
    await sm.page.locator('#btn-describe').tap();
    await sm.page.waitForFunction(() => window.__gd.panel() === 'talk');
    const within = async (sel) => {
      const b = await sm.page.locator(sel).boundingBox();
      return !!b && b.y >= 0 && b.y + b.height <= 640 ? true : `${sel} ${JSON.stringify(b)}`;
    };
    eq('talk: on a small phone the sheet\'s heading and Done are on screen', [await within('#talk-title'), await within('#talk-close')], [true, true]);
    await sm.page.locator('#talk-sheet .sheet-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    eq('talk: the last line scrolls into view', await within('#talk-lines li:last-child'), true);
    await sm.shot('talk-small-sheet');
    await sm.close();
  }

  // ------------------------------------------------------------------ open ahead (SPEC section 29)
  async function pathsChecks() {
    console.log('paths');
    const seen = ['prologue', ...CHAPTERS.map((c) => 'ch' + c.id)];
    const shop = { full: true, glimmer: 3, freeAt: 0, paid: [] };
    const ch1 = CHAPTERS[0].levels;
    const ch2 = CHAPTERS[1].levels;
    const rec = (defs) => Object.fromEntries(defs.map((d) => [d.id, { moves: d.par, stars: 3 }]));
    const nodeState = (ph, def) => ph.page.locator(`.node[data-level="${def.id}"]`).evaluate((n) => ({
      locked: n.classList.contains('locked'), next: n.classList.contains('next'), label: n.getAttribute('aria-label'),
    }));
    const openIds = (ph, defs) => ph.page.evaluate((ids) => ids.filter((id) => !document.querySelector(`.node[data-level="${id}"]`).classList.contains('locked')), defs.map((d) => d.id));

    // chapter 1 lit and 2-1, 2-2: 2-3, 2-4 and 2-5 are open, 2-6 not
    const p = await phone({ tag: 'paths', seed: { levels: rec([...ch1, ch2[0], ch2[1]]), seen, critters: [], shop, settings: { tutorials: true } } });
    await p.open();
    await p.toMap();
    eq('paths: from chapter 2, the three caverns after a lit one are open', await openIds(p, ch2), ch2.slice(0, 5).map((d) => d.id));
    eq('paths: the marker is on the first open cavern not lit', (await nodeState(p, ch2[2])).next, true);
    eq('paths: a locked cavern says what opens it', (await nodeState(p, ch2[5])).label,
      `Level ${ch2[5].id}, locked. Solve one of the three levels before it first.`);
    await p.page.locator(`.node[data-level="${ch2[4].id}"]`).scrollIntoViewIfNeeded();
    await p.shot('paths-map');
    // a tap on the third open one plays it
    await p.page.locator(`.node[data-level="${ch2[4].id}"]`).tap();
    await p.page.waitForFunction(() => window.__gd.screen() === 'level');
    eq('paths: a cavern two ahead plays', (await p.gd('state')) && (await p.page.locator('#level-id').textContent()).includes(ch2[4].id), true);
    // stuck there: the nudge names the two other open caverns
    if ((await p.gd('panel')) === 'card') await p.page.keyboard.press('Escape');
    const s0 = engine.parseLevel(ch2[4]);
    const pair = ['E', 'W', 'N', 'S'].map((d) => [d, { E: 'W', W: 'E', N: 'S', S: 'N' }[d]]).find(([a, b]) => {
      const one = engine.step(s0, a);
      return one && !one.solved && engine.step(one, b);
    });
    if (pair) {
      for (let k = 0; k < ch2[4].par + 6; k++) {
        await p.gd('act', pair[k % 2]);
      }
      await p.idle();
      eq('paths: the stuck nudge points at the other open caverns', ((await p.page.locator('#status').textContent()) || '').trim(),
        'Stuck? Hint helps a step at a time, and two other caverns are open on the map.');
      await p.shot('paths-stuck');
    } else {
      ok(`paths: ${ch2[4].id} has a step and its way back from the start`, false);
    }
    await p.close();

    // 2-3 skipped: 2-4 and 2-5 lit, 2-3 stays open and the marker waits there; the window moves on to 2-8
    const q = await phone({ tag: 'paths-skip', seed: { levels: rec([...ch1, ch2[0], ch2[1], ch2[3], ch2[4]]), seen, critters: [], shop, settings: { tutorials: false } } });
    await q.open();
    await q.toMap();
    eq('paths: a skipped cavern stays open, and the window moves on', await openIds(q, ch2), ch2.slice(0, 8).map((d) => d.id));
    eq('paths: the marker waits on the skipped one', [(await nodeState(q, ch2[2])).next, (await nodeState(q, ch2[5])).next], [true, false]);
    eq('paths: the next chapter still waits for this one\'s last cavern', (await nodeState(q, CHAPTERS[2].levels[0])).locked, true);
    await q.close();

    // chapter 1 keeps its order
    const r = await phone({ tag: 'paths-ch1', seed: { levels: rec([ch1[0], ch1[1]]), seen, critters: [], settings: { tutorials: true } } });
    await r.open();
    await r.toMap();
    eq('paths: chapter 1 keeps its order', await openIds(r, ch1), ch1.slice(0, 3).map((d) => d.id));
    eq('paths: and its locked caverns say so', (await nodeState(r, ch1[3])).label, `Level ${ch1[3].id}, locked. Solve the level before it first.`);
    // with no other cavern open, the stuck nudge is the plain one
    {
      const def = ch1[2];
      await r.page.locator(`.node[data-level="${def.id}"]`).tap();
      await r.page.waitForFunction(() => window.__gd.screen() === 'level');
      if ((await r.gd('panel')) === 'card') await r.page.keyboard.press('Escape');
      const s1 = engine.parseLevel(def);
      const back = ['E', 'W', 'N', 'S'].map((d) => [d, { E: 'W', W: 'E', N: 'S', S: 'N' }[d]]).find(([a, b]) => {
        const one = engine.step(s1, a);
        return one && !one.solved && engine.step(one, b);
      });
      if (back) {
        for (let k = 0; k < def.par + 6; k++) await r.gd('act', back[k % 2]);
        await r.idle();
        eq('paths: with nothing else open, the stuck nudge is the plain one', ((await r.page.locator('#status').textContent()) || '').trim(),
          'Stuck? Hint helps a step at a time, and Undo steps back.');
      } else {
        ok(`paths: ${def.id} has a step and its way back from the start`, false);
      }
    }
    await r.close();
  }

  if (!SHOTS_ONLY && (!ONLY || ONLY === 'workshop')) await workshopChecks();
  if (!SHOTS_ONLY && (!ONLY || ONLY === 'controls')) await controlsChecks();
  if (!SHOTS_ONLY && (!ONLY || ONLY === 'talk')) await talkChecks();
  if (!SHOTS_ONLY && (!ONLY || ONLY === 'paths')) await pathsChecks();

  // ------------------------------------------------------------------ screenshots
  if (!ONLY) {
    console.log('screenshots');
    await shots('', { width: 390, height: 844 }, 2);
    await shots('small', { width: 360, height: 640 }, 2);
    await shots('tablet', { width: 820, height: 1180 }, 1);
  }

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
