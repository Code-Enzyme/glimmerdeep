// Scratch: interleaved warm bench of the dark scene, felt vs faces, on one page (uses the built style-preview.html).
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(root, 'dev/style-preview.html')).href + '?static=1&style=faces,felt');
  await page.waitForFunction(() => window.__preview && window.__preview.ready);
  const r = await page.evaluate(() => {
    const out = { faces: [], felt: [] };
    for (let i = 0; i < 8; i++) for (const k of ['faces', 'felt']) out[k].push(window.__preview.bench(k, 120));
    return out;
  });
  for (const k in r) {
    const v = r[k].slice().sort((a, b) => a - b);
    console.log(k, 'first', r[k][0].toFixed(2), 'min', v[0].toFixed(2), 'median', v[4].toFixed(2));
  }
  await browser.close();
})();
