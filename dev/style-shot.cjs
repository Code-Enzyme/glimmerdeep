// node dev/style-shot.cjs [style ...]   -> dev/style-shots/<style>.png (full page, phone width, dpr 2)
// Prints console errors and the average ms per frame of the dark scene for each style.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
(async () => {
  const root = path.resolve(__dirname, '..');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const res = await build({ entryPoints: [path.join(root, 'dev/style-preview.js')], bundle: true, format: 'iife', target: 'es2019', write: false, logLevel: 'error' });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#2B1E3A;color:#F4EAD5;font-family:system-ui,sans-serif}#preview{max-width:420px;margin:0 auto;padding:8px 0}
h2{font-family:Georgia,serif;margin:18px 12px 4px}p{margin:0 12px 8px;font-size:14px;opacity:.85}.scene-label{margin-top:8px;font-style:italic}canvas{display:block;margin:0 auto}</style>
</head><body><div id="preview"></div><script>${js}</script></body></html>`;
  const out = path.join(root, 'dev/style-preview.html');
  fs.writeFileSync(out, html);
  const styles = process.argv.slice(2);
  const shots = path.join(root, 'dev/style-shots');
  fs.mkdirSync(shots, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 400, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  const list = styles.length ? styles : ['faces', 'glowmark', 'felt', 'glyph'];
  for (const s of list) {
    await page.goto(pathToFileURL(out).href + `?static=1&style=${s}`);
    await page.waitForFunction(() => window.__preview && window.__preview.ready);
    await page.waitForTimeout(300);
    const file = path.join(shots, `${s}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const ms = await page.evaluate((k) => window.__preview.bench(k, 120), s);
    console.log(`${s}: ${file}  scene ${ms.toFixed(2)} ms/frame`);
  }
  console.log(errors.length ? 'ERRORS: ' + errors.slice(0, 5).join(' | ') : 'no console errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
