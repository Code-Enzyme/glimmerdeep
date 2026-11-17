// On-device check, run by CI on an Android emulator: node dev/device-check.cjs path/to/app-debug.apk
// Installs the debug APK, opens the app, and through the app's own WebView:
//   1. the app opens on the title screen, Play shows the map, and the page has no script errors,
//   2. level 1-1 and the last level of each chapter solve at par through the game's moves,
//   3. the save survives the app being killed and opened again.
// Screenshots of the real device screen go to dev/device-shots/. Needs adb on PATH and one device.
const { _android: android } = require('playwright');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

const PKG = 'com.codeenzyme.glimmerdeep';
const ACTIVITY = `${PKG}/.MainActivity`;

function fail(msg) {
  console.error('FAIL ' + msg);
  process.exitCode = 1;
}

async function openApp(device) {
  await device.shell(`am start -W -n ${ACTIVITY}`);
  const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
  const page = await webview.page();
  // the app opens on the title screen; Play goes to the map
  await page.waitForFunction(() => window.__gd && window.__gd.screen() === 'title', null, { timeout: 30000 });
  return { webview, page };
}

async function play(page) {
  await page.evaluate(() => document.getElementById('btn-play').click());
  await page.waitForFunction(() => window.__gd.screen() === 'map', null, { timeout: 10000 });
}

async function killApp(device, webview) {
  const closed = new Promise((resolve) => webview.once('close', resolve));
  await device.shell(`am force-stop ${PKG}`);
  // wait until Playwright has seen the old WebView go, so the next webView() is the new one
  await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 15000))]);
}

(async () => {
  const root = path.resolve(__dirname, '..');
  const apk = path.resolve(process.argv[2] || 'android/app/build/outputs/apk/debug/app-debug.apk');
  const shots = path.join(root, 'dev/device-shots');
  fs.mkdirSync(shots, { recursive: true });
  const { LEVELS, CHAPTERS } = await import(pathToFileURL(path.join(root, 'src/levels/index.js')).href);
  // level 1-1 and the last level of every chapter
  const LEVEL_IDS = [LEVELS[0].id, ...CHAPTERS.filter((c) => c.levels.length).map((c) => c.levels[c.levels.length - 1].id)];
  const { parseLevel } = await import(pathToFileURL(path.join(root, 'src/engine.js')).href);
  const { solve } = await import(pathToFileURL(path.join(root, 'src/solver.js')).href);

  const [device] = await android.devices({ omitDriverInstall: true });
  if (!device) throw new Error('no Android device');
  console.log(`device: ${device.model()} (${device.serial()})`);
  await device.installApk(fs.readFileSync(apk));
  await device.shell(`pm clear ${PKG}`);

  const errors = [];
  let { webview, page } = await openApp(device);
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.waitForTimeout(800);
  await device.screenshot({ path: path.join(shots, 'title.png') });
  console.log('title shown');
  await play(page);
  await page.waitForTimeout(400);
  await device.screenshot({ path: path.join(shots, 'map.png') });
  console.log('Play shows the map');

  for (const id of LEVEL_IDS) {
    const level = LEVELS.find((l) => l.id === id);
    const sol = solve(parseLevel(level));
    await page.evaluate((x) => window.__gd.loadLevel(x), id);
    await page.waitForTimeout(400);
    if (id === LEVEL_IDS[LEVEL_IDS.length - 1]) await device.screenshot({ path: path.join(shots, `level-${id}.png`) });
    let legal = true;
    for (const a of sol.moves) {
      if (!(await page.evaluate((m) => window.__gd.act(m), a))) { legal = false; break; }
    }
    await page.waitForFunction(() => window.__gd.panel() === 'result', null, { timeout: 15000 }).catch(() => {});
    const info = await page.evaluate(() => ({ solved: window.__gd.state().solved, moves: window.__gd.moves(), panel: window.__gd.panel() }));
    const ok = legal && info.solved && info.moves === level.par && info.panel === 'result';
    console.log(`${id} ${ok ? 'OK' : 'FAIL'} moves=${info.moves} par=${level.par} panel=${info.panel}`);
    if (!ok) fail(`level ${id} did not solve at par on the device`);
  }
  await device.screenshot({ path: path.join(shots, 'result.png') });
  const before = await page.evaluate(() => Object.keys(window.__gd.save().levels).sort());

  // kill the app and open it again: the bests must still be there
  await killApp(device, webview);
  ({ webview, page } = await openApp(device));
  await play(page);
  const after = await page.evaluate(() => Object.keys(window.__gd.save().levels).sort());
  if (JSON.stringify(after) !== JSON.stringify(before)) fail(`save lost across restart: before ${before} after ${after}`);
  else console.log(`save kept across restart: ${after.join(', ')}`);
  await device.screenshot({ path: path.join(shots, 'map-after-restart.png') });

  const pid = (await device.shell(`pidof ${PKG}`)).toString().trim();
  if (!pid) fail('app is not running at the end');
  if (errors.length) fail(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  await device.close();
  console.log(process.exitCode ? 'device check FAILED' : 'device check passed');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
