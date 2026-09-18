/*
 * Browser tests for the apps in this repo. Run with:
 *
 *   npm install          # once, to fetch playwright
 *   node tests/browser.test.mjs
 *
 * It starts its own static server, so nothing needs to be running first.
 *
 * The camera is faked with a canvas that draws nine coloured squares and is
 * handed to the page as a MediaStream. That means the real scanning path gets
 * exercised — including the object-fit crop and the mirror flip — rather than
 * being stubbed out. The whole six-face scan runs, and the colours the app
 * ends up with are compared against the cube that was drawn.
 *
 * Screenshots land in tests/screenshots/ for a quick look at the layouts.
 */
import { createServer } from 'node:http';
import { writeCubePhotos } from './fixtures.mjs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'tests', 'screenshots');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('\nplaywright is not installed — skipping browser tests.');
  console.log('install it with:  npm install\n');
  process.exit(0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png'
};

/*
 * Deliberately strict about folders: only the site root resolves to
 * index.html, and any other path ending in `/` is a 404.
 *
 * A normal web server would serve `apps/foo/` as `apps/foo/index.html`, which
 * hid a bug — the Android WebView reads files straight out of the APK and has
 * no such rule, so tapping an app in the installed app failed. Matching the
 * stricter behaviour here means a folder link fails in the tests instead of
 * on someone's phone.
 */
const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    else if (path.endsWith('/')) { res.writeHead(404).end('no directory listings'); return; }
    const file = join(ROOT, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const BASE = 'http://127.0.0.1:' + server.address().port;

await (await import('node:fs/promises')).mkdir(SHOTS, { recursive: true });

let failed = 0;
const settle = (p) => p.waitForTimeout(500);   // sticker colour + rotation transitions
const ok = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -> ' + detail : ''}`);
  if (!pass) failed++;
};

// A canvas pretending to be a camera: 16:9 so the app's object-fit cover crop
// is genuinely exercised, with the nine squares drawn larger than the app's
// reading grid so a correct mapping lands inside them and a wrong one doesn't.
const FAKE_CAMERA = `
window.__face = ['#232833','#232833','#232833','#232833','#232833','#232833','#232833','#232833','#232833'];
window.__setFace = (hexes) => { window.__face = hexes; };
(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 1280; canvas.height = 720;
  const ctx = canvas.getContext('2d');
  const draw = () => {
    ctx.fillStyle = '#0b0b0d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const span = Math.min(canvas.width, canvas.height) * 0.85;
    const cell = span / 3, gap = cell * 0.06;
    const x0 = (canvas.width - span) / 2, y0 = (canvas.height - span) / 2;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
      ctx.fillStyle = window.__face[r * 3 + c];
      ctx.fillRect(x0 + c * cell + gap / 2, y0 + r * cell + gap / 2, cell - gap, cell - gap);
    }
    requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(30);
  navigator.mediaDevices.getUserMedia = () => Promise.resolve(stream);
  navigator.mediaDevices.enumerateDevices = () => Promise.resolve([
    { kind: 'videoinput', deviceId: 'fake-back', label: 'back' },
    { kind: 'videoinput', deviceId: 'fake-front', label: 'front' }
  ]);
})();
`;

/*
 * Prefer the browser playwright manages. Fall back to a chromium already on
 * the machine (CHROMIUM_PATH, or the usual playwright cache location) so this
 * still runs where browsers are pre-installed and downloads are not wanted.
 */
async function launch() {
  const args = ['--autoplay-policy=no-user-gesture-required'];
  const candidates = [
    undefined,
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium',
    '/usr/bin/chromium',
    '/usr/bin/google-chrome'
  ];
  let lastError;
  for (const executablePath of candidates) {
    if (executablePath === null) continue;
    try {
      return await chromium.launch(executablePath ? { args, executablePath } : { args });
    } catch (err) { lastError = err; }
  }
  console.log('\ncould not start a browser — skipping browser tests.');
  console.log(String(lastError && lastError.message).split('\n')[0]);
  console.log('run `npx playwright install chromium`, or set CHROMIUM_PATH.\n');
  server.close();
  process.exit(0);
}

const browser = await launch();

function watch(page, label) {
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`${label}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`${label}: ${e.message}`));
  page.on('requestfailed', (r) => problems.push(`${label}: request failed ${r.url()}`));
  return problems;
}

// ---------------------------------------------------------------- launcher
console.log('\nlauncher');
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = watch(page, 'launcher');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  ok('page loads clean', problems.length === 0, problems.join(' | '));
  ok('one app card rendered', await page.locator('.app-card').count() === 1);
  ok('card links to the app',
    (await page.locator('.app-card').first().getAttribute('href')) === 'apps/rubiks-solver/index.html');
  ok('count chip reads 1 app', (await page.locator('#count').textContent()).trim() === '1 app');
  await page.fill('#search', 'camera');
  ok('search matches on tags', await page.locator('.app-card').count() === 1);
  await page.fill('#search', 'zzzz');
  ok('search can come up empty', await page.locator('.app-card').count() === 0 && !(await page.locator('#empty').isHidden()));
  await page.fill('#search', '');
  await page.screenshot({ path: `${SHOTS}/1-launcher.png` });
  await page.close();
}

// ------------------------------------------------------------------- pwa
console.log('\ninstallable + offline');
{
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });

  const manifest = await page.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    if (!link) return null;
    const res = await fetch(link.href);
    const data = await res.json();
    const icons = await Promise.all(data.icons.map(async (icon) => {
      const url = new URL(icon.src, link.href).href;
      const head = await fetch(url);
      return head.ok;
    }));
    return { name: data.name, display: data.display, start: data.start_url,
             icons: icons.every(Boolean), maskable: data.icons.some((i) => i.purpose === 'maskable'),
             shortcuts: (data.shortcuts || []).length };
  });
  ok('launcher has a usable manifest', !!manifest && manifest.name === 'Apps' && manifest.display === 'standalone');
  ok('every manifest icon actually loads', !!manifest && manifest.icons);
  ok('a maskable icon is provided', !!manifest && manifest.maskable);
  ok('manifest offers a shortcut to the app', !!manifest && manifest.shortcuts === 1);

  const registered = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => !!r.active).catch(() => false));
  ok('service worker activates', registered);

  // Reload so the worker is in control, then pull the network away entirely.
  await page.reload({ waitUntil: 'networkidle' });
  const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
  ok('service worker controls the page', controlled);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const offlineCards = await page.locator('.app-card').count();
  ok('launcher still works with no network', offlineCards === 1, String(offlineCards));

  await context.setOffline(false);
  const appPage = await context.newPage();
  await appPage.goto(BASE + '/apps/rubiks-solver/index.html', { waitUntil: 'networkidle' });
  const appManifest = await appPage.evaluate(async () => {
    const link = document.querySelector('link[rel="manifest"]');
    const data = await (await fetch(link.href)).json();
    return data.name;
  });
  ok("the solver has its own manifest", appManifest === "Rubik's Solver", String(appManifest));
  await appPage.evaluate(() => navigator.serviceWorker.ready);
  await appPage.reload({ waitUntil: 'networkidle' });
  await context.setOffline(true);
  await appPage.reload({ waitUntil: 'domcontentloaded' });
  const offlineSolver = await appPage.evaluate(() => ({
    cells: document.querySelectorAll('.stage__cell').length,
    engine: typeof RS !== 'undefined' && typeof RS.Solver.solve === 'function'
  }));
  ok('the solver loads offline, engine included',
    offlineSolver.cells === 9 && offlineSolver.engine, JSON.stringify(offlineSolver));
  await context.setOffline(false);
  ok('no page errors in the offline run', problems.length === 0, problems.join(' | '));
  await context.close();

  /*
   * Inside the Android app the files are already on the device, and a service
   * worker there would try to fetch from the asset host over the real network
   * and serve a blank page. The page detects the shell by its user agent and
   * stands down, so check that with a user agent that looks like the shell.
   */
  const shell = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36 AppsAndroidShell'
  });
  const shellPage = await shell.newPage();
  await shellPage.goto(BASE + '/', { waitUntil: 'networkidle' });
  await shellPage.waitForTimeout(600);
  const shellWorkers = await shellPage.evaluate(() =>
    navigator.serviceWorker.getRegistrations().then((r) => r.length));
  ok('no service worker is registered inside the android shell',
    shellWorkers === 0, String(shellWorkers));
  ok('the launcher still renders inside the android shell',
    await shellPage.locator('.app-card').count() === 1);
  await shell.close();
}

// ------------------------------------------------------ solver: photo path
console.log('\nsolver — photographs, colours and editing');
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const problems = watch(page, 'solver');
await page.addInitScript(FAKE_CAMERA);
await page.goto(BASE + '/apps/rubiks-solver/index.html', { waitUntil: 'networkidle' });
ok('app loads clean', problems.length === 0, problems.join(' | '));
ok('photos are the first screen', !(await page.locator('#panel-scan').isHidden()));
ok('six face slots', await page.locator('.face-chip').count() === 6);
ok('guide cube has 54 stickers', await page.locator('#guideCube .cube3d__sticker').count() === 54);
ok('switch-camera button stays hidden before the camera starts',
  await page.locator('#btnSwitchCam').isHidden());
await settle(page);
await page.screenshot({ path: `${SHOTS}/2-photos-empty.png` });

// --- the cube's own colours -------------------------------------------------
await page.click('#btnColours');
ok('the colour editor opens', !(await page.locator('#paletteSheet').isHidden()));
ok('presets offered', await page.locator('.preset').count() >= 3);
ok('one row per face', await page.locator('.prow').count() === 6);

const readVar = (name) => page.evaluate((n) =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

await page.fill('#hex-R', '#ff00aa');
await page.waitForTimeout(120);
ok('typing a hex recolours the cube', await readVar('--face-R') === '#ff00aa');

await page.fill('#hex-R', 'nonsense');
await page.waitForTimeout(120);
ok('nonsense is refused rather than applied',
  await readVar('--face-R') === '#ff00aa' &&
  await page.locator('#hex-R').evaluate((el) => el.classList.contains('is-bad')));

await page.click('.preset[data-preset="japanese"]');
await page.waitForTimeout(120);
ok('a preset sets all six at once',
  await readVar('--face-D') === '#1f6df0' && await readVar('--face-B') === '#ffd21f');

// Two faces the camera could not tell apart should be called out.
await page.fill('#hex-R', '#18b55d');
await page.waitForTimeout(150);
ok('colours too alike to distinguish are refused',
  (await page.locator('#paletteStatus').textContent()).includes('too alike'));

await page.click('.preset[data-preset="western"]');
await page.waitForTimeout(120);
ok('back to the standard scheme', await readVar('--face-R') === '#e02f3c');
await settle(page);
await page.screenshot({ path: `${SHOTS}/3-colours.png` });
await page.click('#btnSheetDone');
ok('the colour editor closes', await page.locator('#paletteSheet').isHidden());

// the palette is remembered between visits
await page.click('#btnColours');
await page.click('.preset[data-preset="pastel"]');
await page.click('#btnSheetDone');
await page.reload({ waitUntil: 'networkidle' });
ok('the palette survives a reload', await readVar('--face-U') === '#f7f4ef');
await page.click('#btnColours');
await page.click('.preset[data-preset="western"]');
await page.click('#btnSheetDone');

// --- photographs -------------------------------------------------------------
const truth = await page.evaluate(() => RS.Cube.randomState());
const photos = writeCubePhotos(join(ROOT, 'tests', 'photos'), truth);

await page.setInputFiles('#filePick', photos);
await page.waitForFunction(() => !document.getElementById('btnRead').disabled,
  null, { timeout: 20000 });
ok('six photos fill all six faces', await page.locator('.face-chip.is-done').count() === 6);
ok('the grid has four draggable corners', await page.locator('.handle').count() === 4);
ok('the nine readings are shown on the photo', await page.locator('.shot__read').count() === 9);

const readsFor = () => page.$$eval('.shot__read', (els) => els.map((e) => e.dataset.face).join(''));
ok('the grid reads the face it is sitting on', await readsFor() === truth.slice(0, 9),
  `${await readsFor()} vs ${truth.slice(0, 9)}`);

// the photo should be scaled to the stage, not left at its own pixel size
const fitted = await page.evaluate(() => {
  const f = document.getElementById('shotFrame').getBoundingClientRect();
  const s = document.getElementById('shot').getBoundingClientRect();
  return { frame: f.height, stage: s.height };
});
ok('the photo is scaled up to fill the stage', fitted.frame > fitted.stage * 0.8,
  `${Math.round(fitted.frame)} in ${Math.round(fitted.stage)}`);
await settle(page);
await page.screenshot({ path: `${SHOTS}/4-align.png` });

// dragging a corner must change what is read, and reset must undo it
const before = await readsFor();
const handle = await page.locator('.handle[data-corner="0"]').boundingBox();
await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
await page.mouse.down();
await page.mouse.move(handle.x + handle.width / 2 + 95, handle.y + handle.height / 2 + 95, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(250);
ok('dragging a corner re-reads the colours', await readsFor() !== before);
await page.click('#btnResetGrid');
await page.waitForTimeout(200);
ok('resetting the grid restores the reading', await readsFor() === before);

// --- reading the whole cube ---------------------------------------------------
await page.click('#btnRead');
await page.waitForSelector('#panel-review:not([hidden])', { timeout: 20000 });
const got = await page.$$eval('.net__cell', (els) => els
  .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
  .map((e) => e.dataset.face).join(''));
const wrong = [...got].filter((c, i) => c !== truth[i]).length;
ok('six differently lit photos are read correctly', wrong === 0,
  wrong ? `${wrong} stickers wrong` : '54/54');
ok('the read cube validates',
  (await page.locator('#reviewStatus').textContent()).includes('valid cube'));

// --- editing, in both views ---------------------------------------------------
ok('3D is the default view', !(await page.locator('#view3d').isHidden()));
ok('the review cube has 54 stickers',
  await page.locator('#reviewCube .cube3d__sticker').count() === 54);

await page.click('.palette__swatch[data-face="D"]');
const sticker = page.locator('#reviewCube .cube3d__face[data-face="F"] .cube3d__sticker').nth(0);
await sticker.click();
await page.waitForTimeout(150);
ok('tapping a sticker in 3D paints it', await sticker.getAttribute('data-face') === 'D');
ok('painting a wrong colour is caught',
  (await page.locator('#reviewStatus').textContent()).includes('9 times'));
ok('solving is blocked while the cube is impossible',
  await page.locator('#btnSolve').isDisabled());

await page.click('#btnViewFlat');
ok('the flat view shows the same 54 stickers', await page.locator('.net__cell').count() === 54);
ok('both views agree',
  await page.locator('.net__cell[data-index="18"]').getAttribute('data-face') === 'D');

await page.click(`.palette__swatch[data-face="${truth[18]}"]`);
await page.click('.net__cell[data-index="18"]');
await page.waitForTimeout(150);
ok('putting it back restores a valid cube',
  (await page.locator('#reviewStatus').textContent()).includes('valid cube'));

// spinning must not be mistaken for a tap
await page.click('#btnView3d');
const spinTarget = page.locator('#reviewCube .cube3d__face[data-face="F"] .cube3d__sticker').nth(2);
const spinBox = await spinTarget.boundingBox();
const spinBefore = await spinTarget.getAttribute('data-face');
await page.mouse.move(spinBox.x + spinBox.width / 2, spinBox.y + spinBox.height / 2);
await page.mouse.down();
await page.mouse.move(spinBox.x + spinBox.width / 2 + 70, spinBox.y + spinBox.height / 2, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
ok('dragging the cube spins it instead of painting',
  await spinTarget.getAttribute('data-face') === spinBefore);
await settle(page);
await page.screenshot({ path: `${SHOTS}/5-review.png` });

// a centre names its face's colour, so setting one trades the two faces
await page.click('#btnViewFlat');
const beforeSwap = { F: await readVar('--face-F'), D: await readVar('--face-D') };
await page.click('.palette__swatch[data-face="D"]');
await page.click('.net__cell[data-index="22"]');
await page.waitForTimeout(150);
const afterSwap = { F: await readVar('--face-F'), D: await readVar('--face-D') };
ok('setting a centre swaps the two faces\' colours',
  beforeSwap.F === afterSwap.D && beforeSwap.D === afterSwap.F);
ok('and says so', (await page.locator('#reviewStatus').textContent()).includes('Swapped'));
ok('the cube is still solvable after a swap', !(await page.locator('#btnSolve').isDisabled()));
await page.click('.palette__swatch[data-face="F"]');
await page.click('.net__cell[data-index="22"]');
await page.waitForTimeout(150);

// --- solving -------------------------------------------------------------------
await page.click('#btnSolve');
await page.waitForSelector('#panel-solve:not([hidden])', { timeout: 20000 });
const check = await page.evaluate(() => {
  const start = Array.from(document.querySelectorAll('.net__cell'))
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
    .map((c) => c.dataset.face);
  const moves = Array.from(document.querySelectorAll('.move')).map((m) => m.textContent);
  return { solves: RS.Cube.isSolved(RS.Cube.applySeq(start, moves)), count: moves.length };
});
ok('the listed turns solve the photographed cube', check.solves);
ok('a plausible number of moves', check.count > 20 && check.count < 130, String(check.count));
ok('hold-it-like-this names the centres by colour',
  (await page.locator('#holdText').textContent()).includes('centre facing up'));
await settle(page);
await page.screenshot({ path: `${SHOTS}/6-solve.png` });

await page.click('#btnLast');
await settle(page);
const atEnd = await page.evaluate(() => ({
  stage: document.getElementById('solveStageName').textContent.trim(),
  faces: Array.from(document.querySelectorAll('#solveCube .cube3d__face')).map((f) =>
    new Set(Array.from(f.querySelectorAll('.cube3d__sticker')).map((s) => s.dataset.face)).size)
}));
ok('the end of the solution says finished', atEnd.stage === 'Finished');
ok('each face of the 3D cube ends one colour', atEnd.faces.every((n) => n === 1),
  JSON.stringify(atEnd.faces));
await page.screenshot({ path: `${SHOTS}/7-solved.png` });

await page.click('#btnFirst');
await page.keyboard.press('ArrowRight');
ok('arrow keys step through the turns',
  (await page.locator('#solveProgress').textContent()).trim().startsWith('1 /'));

// ------------------------------------------------- solver: the live camera
console.log('\nsolver — the live camera still works');
await page.click('#btnNewScan');
await page.waitForSelector('#panel-scan:not([hidden])');
await page.click('#btnSwitchToCamera');
await page.waitForFunction(() => document.getElementById('video').videoWidth > 0,
  null, { timeout: 8000 });
ok('the camera starts when asked for', await page.locator('#stageIdle').isHidden());
ok('switch-camera appears with two cameras', !(await page.locator('#btnSwitchCam').isHidden()));

const geometry = await page.evaluate(() => {
  window.__setFace(['#e02f3c', '#18b55c', '#1f6df0', '#ffd21f', '#f3f5f8', '#ff8114',
                    '#18b55c', '#e02f3c', '#1f6df0']);
  return new Promise((resolve) => setTimeout(() => {
    const scanner = new RS.Scanner.Scanner();
    const cells = document.querySelectorAll('.stage__cell');
    const video = document.getElementById('video');
    const palette = RS.Colour.defaultPalette();
    const name = (s) => RS.Colour.nearestFace(s, palette);
    resolve({
      plain: scanner.readCells(video, cells, false).map(name),
      mirrored: scanner.readCells(video, cells, true).map(name)
    });
  }, 400));
});
ok('the reading grid lands on the right squares',
  geometry.plain.join(',') === 'R,F,B,D,U,L,F,R,B', geometry.plain.join(','));
ok('mirroring flips the columns back',
  geometry.mirrored.join(',') === 'B,F,R,L,U,D,B,R,F', geometry.mirrored.join(','));

const HEX = { U: '#f3f5f8', R: '#e02f3c', F: '#18b55c', D: '#ffd21f', L: '#ff8114', B: '#1f6df0' };
const ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
const camTruth = await page.evaluate(() => { window.__truth = RS.Cube.randomState(); return window.__truth; });
for (let f = 0; f < 6; f++) {
  const colours = [];
  for (let i = 0; i < 9; i++) colours.push(HEX[camTruth[f * 9 + i]]);
  await page.evaluate((c) => window.__setFace(c), colours);
  if (f < 5) {
    await page.waitForFunction((want) =>
      document.getElementById('guideStep').textContent.includes(`Face ${want} of 6`),
      f + 2, { timeout: 12000 });
  } else {
    await page.waitForSelector('#panel-review:not([hidden])', { timeout: 12000 });
  }
}
const camRead = await page.$$eval('.net__cell', (els) => els
  .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
  .map((e) => e.dataset.face).join(''));
ok('the camera path still reads a cube exactly', camRead === camTruth,
  camRead === camTruth ? '' : 'mismatch');

ok('no console errors across the whole run', problems.length === 0, problems.join(' | '));
await page.close();

// ------------------------------------------------------------------ mobile
console.log('\nmobile layout');
{
  const m = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const mProblems = watch(m, 'mobile');
  await m.addInitScript(FAKE_CAMERA);
  await m.goto(BASE + '/apps/rubiks-solver/index.html', { waitUntil: 'networkidle' });
  const noScroll = await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  ok('step labels stay readable on a phone',
    await m.locator('.steps__item[data-goto="review"] .steps__label').isVisible());
  ok('header button does not wrap', await m.evaluate(() => {
    const b = document.querySelector('.topbar .btn');
    return b.getBoundingClientRect().height < 56;
  }));
  ok('scan screen has no sideways scroll', noScroll,
    await m.evaluate(() => `${document.documentElement.scrollWidth} > ${window.innerWidth}`));
  await settle(m);
await m.screenshot({ path: `${SHOTS}/7-mobile-scan.png` });
  await m.click('#btnDemo');
  await m.waitForSelector('#panel-review:not([hidden])');
  ok('review screen has no sideways scroll',
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await settle(m);
await m.screenshot({ path: `${SHOTS}/8-mobile-review.png`, fullPage: true });
  await m.click('#btnSolve');
  await m.waitForSelector('#panel-solve:not([hidden])', { timeout: 20000 });
  ok('solve screen has no sideways scroll',
    await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await settle(m);
await m.screenshot({ path: `${SHOTS}/9-mobile-solve.png`, fullPage: true });
  const mLauncher = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await mLauncher.goto(BASE + '/', { waitUntil: 'networkidle' });
  await mLauncher.screenshot({ path: `${SHOTS}/10-mobile-launcher.png`, fullPage: true });
  await mLauncher.close();
  ok('mobile run clean', mProblems.length === 0, mProblems.join(' | '));
  await m.close();
}

await browser.close();
server.close();
console.log('\n' + (failed === 0 ? 'all browser checks passed' : failed + ' browser check(s) failed'));
console.log('screenshots in tests/screenshots/\n');
process.exit(failed === 0 ? 0 : 1);
