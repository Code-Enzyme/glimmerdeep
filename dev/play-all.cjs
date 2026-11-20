// Integration check: play every shipped level, the Daily Glimmer's caverns too, through the real UI with the
// solver's shortest solution. The chapters and the Night Garden play in order in one phone (the story at the end
// needs them all lit); the Daily Glimmer's caverns, which touch nothing else, share out over DAILY_PHONES more
// phones playing at the same time, so a year of caverns does not take a quarter of an hour.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { LEVELS } = await import(pathToFileURL(path.join(root, 'src/levels/index.js')).href);
  const { DAILY } = await import(pathToFileURL(path.join(root, 'src/levels/daily.js')).href);
  const { NIGHT } = await import(pathToFileURL(path.join(root, 'src/levels/night.js')).href);
  const { parseLevel } = await import(pathToFileURL(path.join(root, 'src/engine.js')).href);
  const { solve } = await import(pathToFileURL(path.join(root, 'src/solver.js')).href);
  const shots = path.join(root, 'dev/play-shots');
  require('fs').mkdirSync(shots, { recursive: true });
  const DAILY_PHONES = 3;
  const browser = await chromium.launch();
  const errors = [];
  const phone = async () => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const pg = await ctx.newPage();
    pg.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    pg.on('pageerror', (e) => errors.push(String(e)));
    await pg.goto(pathToFileURL(path.join(root, 'dist/glimmerdeep.html')).href + '?unlock=1');
    await pg.waitForFunction(() => window.__gd);
    return pg;
  };
  let bad = 0;
  // Plays each level with its shortest solution; it must end lit, at exactly par, on the result panel.
  const playAll = async (page, levels) => {
    for (const level of levels) {
      const sol = solve(parseLevel(level));
      if (DAILY.includes(level)) await page.evaluate((def) => window.__gd.loadLevelDef(def), level);
      else await page.evaluate((id) => window.__gd.loadLevel(id), level.id);
      await page.waitForTimeout(250);
      // a chapter's first level meets its creature with a rule card (SPEC section 12): read it, close it
      if (await page.evaluate(() => window.__gd.panel() === 'card')) await page.keyboard.press('Escape');
      if (['1-4', '2-5', '3-5'].includes(level.id)) await page.screenshot({ path: path.join(shots, `level-${level.id}-start.png`) });
      let legal = true;
      for (let i = 0; i < sol.moves.length; i++) {
        const ok = await page.evaluate((a) => window.__gd.act(a), sol.moves[i]);
        if (!ok) { legal = false; break; }
        if (level.id === '3-5' && i === 13) { await page.waitForTimeout(500); await page.screenshot({ path: path.join(shots, 'level-3-5-mid.png') }); }
      }
      if (legal) await page.waitForFunction(() => window.__gd.panel() === 'result', null, { timeout: 8000 }).catch(() => {});
      const info = await page.evaluate(() => ({ solved: window.__gd.state().solved, moves: window.__gd.moves(), panel: window.__gd.panel() }));
      const ok = legal && info.solved && info.moves === level.par && info.panel === 'result';
      if (!ok) bad++;
      console.log(`${level.id} ${ok ? 'OK' : 'FAIL'} moves=${info.moves} par=${level.par} panel=${info.panel}`);
      if (level.id === '3-5') await page.screenshot({ path: path.join(shots, 'result-3-5.png') });
    }
  };
  const page = await phone();
  const shares = Array.from({ length: DAILY_PHONES }, (_, k) => DAILY.filter((d, i) => i % DAILY_PHONES === k));
  await Promise.all([playAll(page, [...LEVELS, ...NIGHT]), ...shares.map(async (share) => playAll(await phone(), share))]);
  await page.goto(pathToFileURL(path.join(root, 'dist/glimmerdeep.html')).href);
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => window.__gd.screen());
  if (opened !== 'title') { console.log(`FAIL the app opened on "${opened}", not the title`); bad++; }
  await page.screenshot({ path: path.join(shots, 'title.png') });
  await page.locator('#btn-play').tap();
  // every chapter was finished above, so Play first shows the story so far as one book (SPEC section 13)
  const book = await page.evaluate(() => window.__gd.story());
  const want = 1 + (await import(pathToFileURL(path.join(root, 'src/levels/index.js')).href)).CHAPTERS.length;
  if (!book || book.count !== want) { console.log(`FAIL Play showed ${JSON.stringify(book)}, not a book of ${want} story pages`); bad++; }
  for (let i = 0; i < 12 && (await page.evaluate(() => window.__gd.screen())) === 'story'; i++) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(shots, `story-${i}.png`) });
    await page.locator('#story-next').tap();
  }
  await page.waitForFunction(() => window.__gd.screen() === 'map');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'map.png'), fullPage: true });
  console.log('console errors:', errors.length, errors.slice(0, 5));
  await browser.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
