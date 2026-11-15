// Screenshots of the sprite gallery, plus a frame-time measurement.
//   node dev/sprites-shot.cjs            all sheets -> dev/sprites-shots/*.png, then the timing
//   node dev/sprites-shot.cjs boards     only sheets whose name contains "boards"
//   node dev/sprites-shot.cjs --no-perf  skip the timing
// Serves the project folder from a throwaway local http server, because Chromium will not load ES
// modules from file:// pages.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'sprites-shots');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

const args = process.argv.slice(2);
const noPerf = args.includes('--no-perf');
const filters = args.filter((a) => !a.startsWith('--'));
const grey = args.includes('--grey');

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]);
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await serve();
  const port = server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') problems.push(`console ${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push('page error: ' + e.message + '\n' + (e.stack || '')));
  await page.goto(`http://127.0.0.1:${port}/dev/sprites.html?t=1.3${args.includes('--parts') ? '&parts=1' : ''}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 15000 }).catch(() => problems.push('gallery never became ready'));

  const names = await page.$$eval('canvas[data-shot]', (els) => els.map((e) => e.dataset.shot));
  for (const name of names) {
    if (filters.length && !filters.some((f) => name.includes(f))) continue;
    const el = await page.$(`canvas[data-shot="${name}"]`);
    await el.screenshot({ path: path.join(OUT, name + '.png') });
    console.log('wrote dev/sprites-shots/' + name + '.png');
  }
  if (grey || !filters.length) {
    // the same pictures without colour, to check that state reads by shape and value alone
    await page.addStyleTag({ content: 'canvas { filter: grayscale(1); }' });
    for (const name of ['boards-64', 'zoom-creatures-40', 'zoom-tiles-40']) {
      if (!names.includes(name)) continue;
      const el = await page.$(`canvas[data-shot="${name}"]`);
      await el.screenshot({ path: path.join(OUT, name + '-grey.png') });
      console.log('wrote dev/sprites-shots/' + name + '-grey.png');
    }
  }
  if (!noPerf) {
    const perf = await page.evaluate(() => window.__measure());
    console.log('frame times (ms):');
    for (const [k, v] of Object.entries(perf)) console.log('  ' + k + ': ' + JSON.stringify(v));
  }
  if (problems.length) {
    console.log('PROBLEMS:\n' + problems.join('\n'));
    process.exitCode = 1;
  }
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
