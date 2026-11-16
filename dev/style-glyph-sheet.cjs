// scratch: node dev/style-glyph-sheet.cjs [t] -> dev/style-shots/glyph-sheet.png (not a style name, so harmless)
const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const r = await build({ entryPoints: [path.join(root, 'dev/style-glyph-sheet.js')], bundle: true, format: 'iife', write: false });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log(String(e)));
  const fs = require('fs');
  const html = path.join(root, 'dev/style-glyph-sheet.html');
  fs.writeFileSync(html, `<body><script>${r.outputFiles[0].text}</script></body>`);
  await page.goto(pathToFileURL(html).href + '?t=' + (process.argv[2] || '1.3') + '&z=' + (process.argv[3] || '0.62'));
  await page.waitForFunction(() => window.__done);
  await page.locator('canvas').screenshot({ path: path.join(root, 'dev/style-glyph-sheet.png') });
  await browser.close();
})();
