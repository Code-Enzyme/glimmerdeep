// Integration check: play every shipped level through the real UI with the solver's shortest solution.
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { LEVELS } = await import(pathToFileURL(path.join(root, 'src/levels/index.js')).href);
  const { parseLevel } = await import(pathToFileURL(path.join(root, 'src/engine.js')).href);
  const { solve } = await import(pathToFileURL(path.join(root, 'src/solver.js')).href);
  const shots = path.join(root, 'dev/play-shots');
  require('fs').mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(pathToFileURL(path.join(root, 'dist/glimmerdeep.html')).href + '?unlock=1');
  await page.waitForFunction(() => window.__gd);
  let bad = 0;
  for (const level of LEVELS) {
    const sol = solve(parseLevel(level));
    await page.evaluate((id) => window.__gd.loadLevel(id), level.id);
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
    await page.waitForTimeout(1800);
    const info = await page.evaluate(() => ({ solved: window.__gd.state().solved, moves: window.__gd.moves(), panel: window.__gd.panel() }));
    const ok = legal && info.solved && info.moves === level.par && info.panel === 'result';
    if (!ok) bad++;
    console.log(`${level.id} ${ok ? 'OK' : 'FAIL'} moves=${info.moves} par=${level.par} panel=${info.panel}`);
    if (level.id === '3-5') await page.screenshot({ path: path.join(shots, 'result-3-5.png') });
  }
  await page.goto(pathToFileURL(path.join(root, 'dist/glimmerdeep.html')).href);
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => window.__gd.screen());
  if (opened !== 'title') { console.log(`FAIL the app opened on "${opened}", not the title`); bad++; }
  await page.screenshot({ path: path.join(shots, 'title.png') });
  await page.locator('#btn-play').tap();
  await page.waitForFunction(() => window.__gd.screen() === 'map');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'map.png'), fullPage: true });
  console.log('console errors:', errors.length, errors.slice(0, 5));
  await browser.close();
  process.exit(bad || errors.length ? 1 : 0);
})();
