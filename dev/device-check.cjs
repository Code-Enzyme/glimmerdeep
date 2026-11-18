// On-device check, run by CI on an Android emulator: node dev/device-check.cjs path/to/app-debug.apk
// Installs the debug APK, opens the app, and through the app's own WebView:
//   1. the app opens on the title screen, Play shows the map, and the page has no script errors,
//   2. level 1-1 and the last level of each chapter solve at par through the game's moves,
//   3. the store (SPEC section 14): the Billing plugin is in the app, a debug build uses the free test store,
//      and the Full Expedition bought there opens the later chapters,
//   4. the save, purchases included, survives the app being killed and opened again.
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

// Play, then read through any story pages that are due (SPEC section 13). -> how many pages showed
async function play(page) {
  await page.evaluate(() => document.getElementById('btn-play').click());
  let pages = 0;
  while (pages < 12 && (await page.evaluate(() => window.__gd.screen())) === 'story') {
    pages++;
    await page.waitForTimeout(200);
    await page.evaluate(() => document.getElementById('story-next').click());
  }
  await page.waitForFunction(() => window.__gd.screen() === 'map', null, { timeout: 10000 });
  return pages;
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
  const prologue = await play(page);
  if (prologue !== 1) fail(`Play on a fresh install showed ${prologue} story pages, not the prologue`);
  await page.waitForTimeout(400);
  await device.screenshot({ path: path.join(shots, 'map.png') });
  console.log('Play shows the prologue, then the map');

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

  // the store: the native Billing plugin answers, and a debug build keeps to the free test store
  const billing = await page.evaluate(async () => {
    const cap = window.Capacitor;
    const available = !!(cap && cap.isPluginAvailable && cap.isPluginAvailable('Billing'));
    let info = null;
    try {
      if (available) info = cap.Plugins && cap.Plugins.Billing ? await cap.Plugins.Billing.info() : await cap.nativePromise('Billing', 'info', {});
    } catch (e) {
      info = { error: String(e) };
    }
    return { available, info, kind: window.__gd.shop().kind };
  });
  if (!billing.available) fail('the Billing plugin is not registered in the app');
  else if (!billing.info || billing.info.play !== false) fail(`Billing.info() on a debug build said ${JSON.stringify(billing.info)}, not play: false`);
  if (billing.kind !== 'test') fail(`a debug build uses the ${billing.kind} store, not the test store`);
  console.log(`store: Billing plugin ${billing.available ? 'present' : 'missing'}, info ${JSON.stringify(billing.info)}, ${billing.kind} store`);
  await page.evaluate(() => document.getElementById('btn-shop').click());
  await page.waitForFunction(() => window.__gd.panel() === 'shop', null, { timeout: 10000 });
  await page.waitForTimeout(400);
  await device.screenshot({ path: path.join(shots, 'store.png') });
  await page.evaluate(() => document.getElementById('shop-full').click());
  await page.waitForFunction(() => window.__gd.shop().full === true, null, { timeout: 10000 }).catch(() => {});
  if (!(await page.evaluate(() => window.__gd.shop().full))) fail('the Full Expedition from the test store was not granted');
  else console.log('store: the Full Expedition bought in the test store');

  // kill the app and open it again: the bests must still be there
  await killApp(device, webview);
  ({ webview, page } = await openApp(device));
  const book = await play(page);
  // every chapter's last level was solved, so the story so far shows as one book after the restart
  if (book !== CHAPTERS.length) fail(`after the restart Play showed ${book} story pages, not ${CHAPTERS.length}`);
  const after = await page.evaluate(() => Object.keys(window.__gd.save().levels).sort());
  if (JSON.stringify(after) !== JSON.stringify(before)) fail(`save lost across restart: before ${before} after ${after}`);
  else console.log(`save kept across restart: ${after.join(', ')}`);
  if (!(await page.evaluate(() => window.__gd.shop().full))) fail('the Full Expedition was lost across the restart');
  else console.log('purchases kept across restart');
  const seen = await page.evaluate(() => window.__gd.save().seen.length);
  if (seen !== CHAPTERS.length + 1) fail(`${seen} story pages counted as seen, not ${CHAPTERS.length + 1}`);
  else console.log(`story pages seen: ${seen}`);
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
