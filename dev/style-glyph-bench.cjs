// scratch: alternate the style-preview bench between styles and print medians (run style-shot.cjs first)
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const out = path.resolve(__dirname, 'style-preview.html');
  const styles = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(out).href + `?static=1&style=${styles.join(',')}`);
  await page.waitForFunction(() => window.__preview && window.__preview.ready);
  await page.waitForTimeout(300);
  const r = Object.fromEntries(styles.map((s) => [s, []]));
  for (const s of styles) await page.evaluate((k) => window.__preview.bench(k, 120), s); // warm caches
  for (let i = 0; i < 10; i++) for (const s of styles) r[s].push(await page.evaluate((k) => window.__preview.bench(k, 120), s));
  for (const s of styles) { const v = r[s].sort((a, b) => a - b); console.log(s, 'median', v[5].toFixed(2), 'min', v[0].toFixed(2)); }
  await browser.close();
})();
