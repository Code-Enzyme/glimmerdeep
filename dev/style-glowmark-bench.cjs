// Scratch: fairer frame-time comparison (warm-up, then alternating runs). Uses dev/style-preview.html
// as last built by dev/style-shot.cjs.  node dev/style-glowmark-bench.cjs
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const out = path.resolve(__dirname, 'style-preview.html');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(out).href + '?static=1&style=faces,glowmark');
  await page.waitForFunction(() => window.__preview && window.__preview.ready);
  const r = await page.evaluate(() => {
    const P = window.__preview;
    P.bench('faces', 60); P.bench('glowmark', 60);
    const acc = { faces: [], glowmark: [] };
    for (let i = 0; i < 6; i++) for (const k of i % 2 ? ['glowmark', 'faces'] : ['faces', 'glowmark']) acc[k].push(P.bench(k, 120));
    return acc;
  });
  const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
  console.log('faces', r.faces.map((x) => x.toFixed(2)).join(' '), 'median', med(r.faces).toFixed(2));
  console.log('glowmark', r.glowmark.map((x) => x.toFixed(2)).join(' '), 'median', med(r.glowmark).toFixed(2));
  console.log('ratio', (med(r.glowmark) / med(r.faces)).toFixed(2));
  await browser.close();
})();
