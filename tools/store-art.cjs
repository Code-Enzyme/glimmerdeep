// node tools/store-art.cjs  -> the Play listing's images in store/listing/en-US/images (SPEC section 33):
// a 1024x500 feature graphic drawn from the game's own art (tools/store-art-entry.js), and phone screenshots
// at 1080x1920 taken from the built game (dist/glimmerdeep.html, so run `npm run build` first) on a
// 360x640 screen at 3x. JPEG throughout, since Play takes no transparency. Each screenshot is a real board,
// played part way along its shortest solution; the text shows in this machine's fonts.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'store/listing/en-US/images');
const SHOTS = path.join(OUT, 'phoneScreenshots');
const DIST = path.join(ROOT, 'dist/glimmerdeep.html');
const KEY_OF = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft', L: ' ', Z: '.' };
const esm = (p) => import(pathToFileURL(path.join(ROOT, p)).href);

(async () => {
  if (!fs.existsSync(DIST)) throw new Error('no dist/glimmerdeep.html: run npm run build first');
  const { build } = await esm('node_modules/esbuild/lib/main.js');
  const { CHAPTERS, LEVELS } = await esm('src/levels/index.js');
  const { NIGHT } = await esm('src/levels/night.js');
  const { STORY } = await esm('src/ui/story.js');
  const { NEWS_IDS } = await esm('src/ui/news.js');
  const { SAVE_KEY, LAYOUT } = await esm('src/ui/store.js');
  const engine = await esm('src/engine.js');
  const solver = await esm('src/solver.js');
  const byId = (id) => [...LEVELS, ...NIGHT].find((l) => l.id === id);
  const solution = (id) => solver.solve(engine.parseLevel(byId(id)), { maxStates: 400000 }).moves;

  const browser = await chromium.launch();
  const errors = [];
  const watch = (page) => page.on('pageerror', (e) => errors.push(String(e)));

  // ---------------------------------------------------------------- the feature graphic
  const res = await build({ entryPoints: [path.join(__dirname, 'store-art-entry.js')], bundle: true, format: 'iife', write: false, logLevel: 'error' });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const art = await browser.newPage();
  watch(art);
  await art.setContent(`<!doctype html><html><body><script>${js}</script></body></html>`);
  await art.waitForFunction(() => window.__storeArt && window.__storeArt.ready);
  const url = await art.evaluate(() => window.__storeArt.feature(1024, 500));
  if (!url.startsWith('data:image/jpeg')) throw new Error('the browser could not encode a JPEG');
  fs.mkdirSync(SHOTS, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'featureGraphic.jpg'), Buffer.from(url.split(',')[1], 'base64'));

  // ---------------------------------------------------------------- the screenshots
  // A player part way through: the first three chapters lit (most at par), the fourth begun, a few critters
  // sketched, the Full Expedition bought. Tutorials are off, so no pointer covers the board.
  const levels = {};
  const lit = [...CHAPTERS[0].levels, ...CHAPTERS[1].levels, ...CHAPTERS[2].levels, ...CHAPTERS[3].levels.slice(0, 5)];
  lit.forEach((def, i) => {
    const stars = i % 5 === 3 ? 1 : i % 3 === 1 ? 2 : 3;
    levels[def.id] = { moves: def.par + (stars === 3 ? 0 : 2), stars };
  });
  const seed = {
    levels,
    seen: STORY.map((p) => p.id),
    critters: lit.filter((_, i) => i % 3 === 0).map((d) => d.id),
    shop: { full: true, glimmer: 7, freeAt: 0, paid: [] },
    daily: {},
    workshop: [],
    news: NEWS_IDS,
    notes: {},
    settings: { tutorials: false },
    layout: LAYOUT,
    rev: 1,
  };
  const context = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  watch(page);
  const home = pathToFileURL(DIST).href;
  await page.goto(home);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SAVE_KEY, JSON.stringify(seed)]);
  await page.goto(home);
  await page.waitForFunction(() => window.__gd && window.__gd.screen());
  const gd = (fn, arg) => page.evaluate(([f, a]) => window.__gd[f](a), [fn, arg]);
  const idle = () => page.waitForFunction(() => !window.__gd.busy(), null, { timeout: 8000 });
  const settle = (ms = 600) => page.waitForTimeout(ms);
  const shot = async (name) => {
    await settle();
    await page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 90 });
  };
  // a level, played `n` moves along its shortest solution
  const play = async (id, n) => {
    await gd('loadLevel', id);
    await page.waitForFunction(() => window.__gd.screen() === 'level');
    await settle(400);
    for (const m of solution(id).slice(0, n)) {
      await page.keyboard.press(KEY_OF[m]);
      await idle();
    }
  };
  const toMap = async () => {
    await page.locator('#btn-play').tap();
    await page.waitForFunction(() => window.__gd.screen() === 'map');
  };

  for (const f of fs.readdirSync(SHOTS)) fs.unlinkSync(path.join(SHOTS, f));
  // Play shows them in this order, so the boards come first: moths, a whelk and stumpcaps round the lantern;
  // a Mirrorbeetle's beam; a Gloam encounter with the Hush creeping; the Night Garden's crystal walls; a hint
  // laying out the way; the Field Journal; the title.
  await play('3-8', 22);
  await shot('1-cavern');
  await play('7-14', 25);
  await shot('2-mirror-beam');
  await play('4-19', 22);
  await shot('3-gloam');
  await play('N-3', 20);
  await shot('4-night-garden');
  await play('4-3', 3);
  await page.locator('#btn-hint').tap();
  await page.waitForFunction(() => window.__gd.hint() !== null);
  for (let i = 0; i < 2; i++) {
    await page.locator('#btn-hint').tap();
    await settle(150);
  }
  await page.waitForFunction(() => window.__gd.way() !== null);
  await shot('5-hint');
  await page.goto(home);
  await page.waitForFunction(() => window.__gd && window.__gd.screen() === 'title');
  await settle(800);
  await toMap();
  await page.locator('#btn-journal').tap();
  await page.waitForFunction(() => window.__gd.screen() === 'journal');
  await shot('6-field-journal');
  await page.goto(home);
  await page.waitForFunction(() => window.__gd && window.__gd.screen() === 'title');
  await settle(800);
  await shot('7-title');

  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`wrote the feature graphic and ${fs.readdirSync(SHOTS).length} screenshots to ${path.relative(ROOT, OUT)}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
