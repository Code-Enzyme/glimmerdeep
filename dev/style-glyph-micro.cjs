const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const r = await build({ entryPoints: [path.join(root, 'dev/style-glyph-micro.js')], bundle: true, format: 'iife', write: false });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log(String(e)));
  await page.setContent(`<body><script>${r.outputFiles[0].text}</script></body>`);
  console.log(await page.evaluate(() => window.__res));
  await browser.close();
})();
