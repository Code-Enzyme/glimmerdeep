// Scratch: node dev/style-felt-frames.cjs -> dev/style-felt-frames.png
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const res = await build({ entryPoints: [path.join(root, 'dev/style-felt-frames.js')], bundle: true, format: 'iife', write: false, logLevel: 'error' });
  const html = `<!doctype html><html><body style="margin:0;background:#2B1E3A"><script>${res.outputFiles[0].text}</script></body></html>`;
  const out = path.join(root, 'dev/style-felt-frames.html');
  fs.writeFileSync(out, html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 500, height: 800 }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.log('ERR', String(e)));
  await page.goto(pathToFileURL(out).href);
  await page.waitForFunction(() => window.__done);
  console.log(JSON.stringify(await page.evaluate(() => window.__probe)));
  await page.locator('canvas').first().screenshot({ path: path.join(root, 'dev/style-felt-frames.png') });
  await browser.close();
})();
