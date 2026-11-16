// node tools/make-icons.cjs  -> launcher icons and the splash figure under android/app/src/main/res,
// drawn from the game's own Glowmark art (Wren with a lit lantern on plum). Re-run after art changes.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const RES = 'android/app/src/main/res';
const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const root = path.resolve(__dirname, '..');
  const { build } = await import(pathToFileURL(path.join(root, 'node_modules/esbuild/lib/main.js')).href);
  const res = await build({ entryPoints: [path.join(__dirname, 'icons-entry.js')], bundle: true, format: 'iife', write: false, logLevel: 'error' });
  const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent(`<!doctype html><html><body><script>${js}</script></body></html>`);
  await page.waitForFunction(() => window.__icons && window.__icons.ready);
  const jobs = [];
  for (const [d, k] of Object.entries(DENSITIES)) {
    jobs.push(['legacy', 48 * k, 48 * k, `mipmap-${d}/ic_launcher.webp`]);
    jobs.push(['round', 48 * k, 48 * k, `mipmap-${d}/ic_launcher_round.webp`]);
    jobs.push(['foreground', 108 * k, 108 * k, `mipmap-${d}/ic_launcher_foreground.webp`]);
    jobs.push(['splash', 200 * k, 200 * k, `drawable-${d}/splash_wren.webp`]);
  }
  jobs.push(['store', 512, 512, '../../../../../store/icon-512.png']);
  for (const [kind, w, h, rel] of jobs) {
    const type = rel.endsWith('.webp') ? 'image/webp' : 'image/png';
    const url = await page.evaluate(([k, a, b, t]) => window.__icons.render(k, a, b, t), [kind, w, h, type]);
    if (!url.startsWith(`data:${type}`)) throw new Error(`browser could not encode ${type}`);
    const file = path.join(root, RES, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Android refuses two resources with the same name, so drop the other format if it is there
    const other = file.replace(/\.(png|webp)$/, (m) => (m === '.png' ? '.webp' : '.png'));
    if (other !== file && fs.existsSync(other)) fs.unlinkSync(other);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log(`wrote ${jobs.length} images`);
})();
