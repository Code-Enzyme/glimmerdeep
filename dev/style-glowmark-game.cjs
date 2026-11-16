// Scratch: screenshots of the built game at phone size.  node dev/style-glowmark-game.cjs 3-5 2-5
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  for (const arg of process.argv.slice(2)) {
    // "2-5:lNNN" = level 2-5, then plant (l) and walk north three times
    const [lv, keys = ''] = arg.split(':');
    await page.goto(pathToFileURL(path.join(root, 'dist/glimmerdeep.html')).href + '?level=' + lv);
    await page.waitForTimeout(1500);
    const K = { N: 'ArrowUp', E: 'ArrowRight', S: 'ArrowDown', W: 'ArrowLeft', l: 'l', z: '.' };
    for (const k of keys) { await page.keyboard.press(K[k] || k); await page.waitForTimeout(450); }
    await page.waitForTimeout(1200);
    const file = path.join(root, `dev/style-shots/glowmark-game-${arg.replace(':', '-')}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 5).join(' | ') : 'no console errors');
  await browser.close();
})();
