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

// ------------------------------------------------------------ solver: demo
console.log('\nsolver — demo cube, review and playback');
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
const problems = watch(page, 'solver');
await page.addInitScript(FAKE_CAMERA);
await page.goto(BASE + '/apps/rubiks-solver/index.html', { waitUntil: 'networkidle' });
ok('app loads clean', problems.length === 0, problems.join(' | '));
ok('scan panel is the first screen', !(await page.locator('#panel-scan').isHidden()));
ok('nine reading squares exist', await page.locator('.stage__cell').count() === 9);
ok('guide cube has 54 stickers', await page.locator('#guideCube .cube3d__sticker').count() === 54);
ok('switch-camera button stays hidden before the camera starts',
  await page.locator('#btnSwitchCam').isHidden());
await settle(page);
await page.screenshot({ path: `${SHOTS}/2-scan-idle.png` });

// Reaching the app the way a person does — tapping its card on the launcher.
{
  const launcher = await browser.newPage({ viewport: { width: 1100, height: 800 } });
  const launcherProblems = [];
  launcher.on('requestfailed', (r) => launcherProblems.push(r.url()));
  await launcher.goto(BASE + '/', { waitUntil: 'networkidle' });
  const cardHref = await launcher.locator('.app-card').first().getAttribute('href');
  ok('card links straight to a file', cardHref.endsWith('/index.html'), cardHref);
  await launcher.click('.app-card');
  await launcher.waitForSelector('#panel-scan:not([hidden])', { timeout: 10000 });
  ok('tapping a card opens the app', launcher.url().includes('/apps/rubiks-solver/'));
  await launcher.click('.topbar .btn');
  await launcher.waitForSelector('.app-card', { timeout: 10000 });
  ok('"All apps" gets back to the launcher', await launcher.locator('.app-card').count() === 1);
  ok('no failed requests navigating in and out', launcherProblems.length === 0,
    launcherProblems.slice(0, 3).join(' | '));
  await launcher.close();
}

await page.click('#btnDemo');
await page.waitForSelector('#panel-review:not([hidden])');
ok('demo jumps to review', !(await page.locator('#panel-review').isHidden()));
ok('net has 54 cells', await page.locator('.net__cell').count() === 54);
ok('9 centres are locked', await page.locator('.net__cell.is-centre[disabled]').count() === 6);
ok('demo cube validates', (await page.locator('#reviewStatus').textContent()).includes('valid cube'));
ok('the flagged-sticker legend hides when nothing is flagged',
  await page.locator('#netLegend').isHidden());
ok('solve button enabled', !(await page.locator('#btnSolve').isDisabled()));
await settle(page);
await page.screenshot({ path: `${SHOTS}/3-review.png` });

// The 3D cube must render flat, exact sticker colours. If an ancestor ever
// regains a backdrop-filter (or anything else that flattens preserve-3d), the
// back faces bleed through and the palette colours stop appearing exactly.
{
  const shot = await page.locator('#reviewCube').screenshot();
  const counts = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const want = ['#f3f5f8', '#ffd21f', '#e02f3c', '#ff8114', '#18b55c', '#1f6df0']
      .map((h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
    const hits = want.map(() => 0);
    for (let i = 0; i < px.length; i += 4) {
      for (let k = 0; k < want.length; k++) {
        if (px[i] === want[k][0] && px[i + 1] === want[k][1] && px[i + 2] === want[k][2]) { hits[k]++; break; }
      }
    }
    return hits;
  }, shot.toString('base64'));
  const solid = counts.filter((n) => n > 300).length;
  ok('3D cube renders exact sticker colours', solid >= 3,
    'palette colours with solid areas: ' + solid + ' of 6 -> ' + JSON.stringify(counts));
}

// editing a sticker must break validity, and putting it back must restore it
const before = await page.evaluate(() => document.querySelectorAll('.net__cell')[0].dataset.colour);
// Paint it with a colour it is not already, or nothing changes and the cube
// stays legitimately valid.
const wrongFace = await page.evaluate((current) => {
  const names = { white: 'U', red: 'R', green: 'F', yellow: 'D', orange: 'L', blue: 'B' };
  return ['U', 'R', 'F', 'D', 'L', 'B'].find((f) => f !== names[current]);
}, before);
await page.click(`.palette__swatch[data-face="${wrongFace}"]`);
await page.click('.net__cell[data-index="0"]');
const broken = await page.locator('#reviewStatus').textContent();
ok('editing to a wrong colour is caught', broken.includes('9 times') || broken.includes('exactly 9'), broken.trim().slice(0, 70));
ok('solve is blocked while invalid', await page.locator('#btnSolve').isDisabled());
const faceOf = await page.evaluate((c) => {
  const names = { white: 'U', red: 'R', green: 'F', yellow: 'D', orange: 'L', blue: 'B' };
  return names[c];
}, before);
await page.click(`.palette__swatch[data-face="${faceOf}"]`);
await page.click('.net__cell[data-index="0"]');
ok('putting it back restores validity', (await page.locator('#reviewStatus').textContent()).includes('valid cube'));

// solve and verify the answer against the engine, in the page
const scanned = await page.evaluate(() => Array.from(document.querySelectorAll('.net__cell'))
  .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index))
  .map((c) => c.dataset.colour));
await page.click('#btnSolve');
await page.waitForSelector('#panel-solve:not([hidden])', { timeout: 20000 });
ok('solve screen opens', !(await page.locator('#panel-solve').isHidden()));

const check = await page.evaluate((names) => {
  const letters = { white: 'U', red: 'R', green: 'F', yellow: 'D', orange: 'L', blue: 'B' };
  const start = names.map((n) => letters[n]);
  const moves = Array.from(document.querySelectorAll('.move')).map((m) => m.textContent);
  const end = RS.Cube.applySeq(start, moves);
  return { solves: RS.Cube.isSolved(end), count: moves.length,
           progress: document.getElementById('solveProgress').textContent };
}, scanned);
ok('the listed turns actually solve the cube', check.solves);
ok('progress starts at zero', check.progress.trim() === '0 / ' + check.count, check.progress);
ok('a plausible number of moves', check.count > 20 && check.count < 130, String(check.count));
ok('solve cube has 54 stickers', await page.locator('#solveCube .cube3d__sticker').count() === 54);
ok('stage blocks rendered', await page.locator('.stage-block').count() >= 3);
ok('hold-it-like-this names the centres', (await page.locator('#holdText').textContent()).includes('centre facing up'));
await settle(page);
await page.screenshot({ path: `${SHOTS}/4-solve.png` });

// step forward through every move and confirm the cube ends solved on screen
await page.click('#btnLast');
const atEnd = await page.evaluate(() => ({
  progress: document.getElementById('solveProgress').textContent.trim(),
  stage: document.getElementById('solveStageName').textContent.trim(),
  glyph: document.getElementById('moveGlyph').textContent.trim(),
  faces: Array.from(document.querySelectorAll('#solveCube .cube3d__face')).map((f) =>
    new Set(Array.from(f.querySelectorAll('.cube3d__sticker')).map((s) => s.dataset.colour)).size)
}));
ok('jumping to the end reports finished', atEnd.stage === 'Finished', atEnd.stage);
ok('progress shows every move done', atEnd.progress === `${check.count} / ${check.count}`, atEnd.progress);
ok('each face of the 3D cube is one colour', atEnd.faces.every((n) => n === 1), JSON.stringify(atEnd.faces));
await settle(page);
await page.screenshot({ path: `${SHOTS}/5-solved.png` });

// stepping backwards and playing
await page.click('#btnPrev');
ok('previous steps back one', (await page.locator('#solveProgress').textContent()).trim() === `${check.count - 1} / ${check.count}`);
await page.click('#btnFirst');
ok('first returns to the start', (await page.locator('#solveProgress').textContent()).trim() === `0 / ${check.count}`);
await page.click('#btnPlay');
await page.waitForTimeout(1900);
const playedTo = Number((await page.locator('#solveProgress').textContent()).split('/')[0].trim());
ok('play advances on its own', playedTo >= 2, String(playedTo));
await page.click('#btnPlay');
await page.keyboard.press('ArrowRight');
ok('arrow keys step', Number((await page.locator('#solveProgress').textContent()).split('/')[0].trim()) === playedTo + 1);

// ------------------------------------------------------- solver: camera scan
console.log('\nsolver — full scan through the camera path');
await page.click('#btnNewScan');
await page.waitForSelector('#panel-scan:not([hidden])');

const truth = await page.evaluate(() => {
  const state = RS.Cube.randomState();
  window.__truth = state;
  return state;
});
const HEX = { U: '#f3f5f8', R: '#e02f3c', F: '#18b55c', D: '#ffd21f', L: '#ff8114', B: '#1f6df0' };
const ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

await page.click('#btnStartCam');
await page.waitForFunction(() => document.getElementById('video').videoWidth > 0, null, { timeout: 8000 });
ok('camera preview starts', await page.locator('#camIdle').isHidden());
ok('switch-camera button appears with two cameras', !(await page.locator('#btnSwitchCam').isHidden()));

// Sanity-check the sampling geometry directly: what the app reads under the
// grid must match the squares drawn on the fake camera.
const geometry = await page.evaluate((hexes) => {
  const order = ['U', 'R', 'F', 'D', 'L', 'B'];
  window.__setFace(['#e02f3c', '#18b55c', '#1f6df0', '#ffd21f', '#f3f5f8', '#ff8114', '#18b55c', '#e02f3c', '#1f6df0']);
  return new Promise((resolve) => setTimeout(() => {
    const scanner = new RS.Scanner.Scanner();
    const cells = document.querySelectorAll('.stage__cell');
    const plain = scanner.readCells(document.getElementById('video'), cells, false);
    const mirrored = scanner.readCells(document.getElementById('video'), cells, true);
    const name = (s) => RS.Colour.guessName(s.r, s.g, s.b);
    resolve({ plain: plain.map(name), mirrored: mirrored.map(name) });
  }, 400));
}, HEX);
ok('grid samples land on the right squares',
  geometry.plain.join(',') === 'red,green,blue,yellow,white,orange,green,red,blue',
  geometry.plain.join(','));
ok('mirroring flips the columns back',
  geometry.mirrored.join(',') === 'blue,green,red,orange,white,yellow,blue,red,green',
  geometry.mirrored.join(','));

// Now scan all six faces for real, letting auto-capture fire each time.
for (let f = 0; f < 6; f++) {
  const face = ORDER[f];
  const colours = [];
  for (let i = 0; i < 9; i++) colours.push(HEX[truth[f * 9 + i]]);
  await page.evaluate((c) => window.__setFace(c), colours);
  if (f < 5) {
    await page.waitForFunction(
      (want) => document.getElementById('guideStep').textContent.includes(`Face ${want} of 6`),
      f + 2, { timeout: 12000 });
  } else {
    await page.waitForSelector('#panel-review:not([hidden])', { timeout: 12000 });
  }
  if (f === 1) {
    await page.uncheck('#chkAuto');          // hold the live view still to capture it
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/6-scanning.png` });
    await page.check('#chkAuto');
  }
}
ok('scanning all six faces lands on review', !(await page.locator('#panel-review').isHidden()));

const read = await page.evaluate(() => {
  const letters = { white: 'U', red: 'R', green: 'F', yellow: 'D', orange: 'L', blue: 'B' };
  const cells = Array.from(document.querySelectorAll('.net__cell'))
    .sort((a, b) => Number(a.dataset.index) - Number(b.dataset.index));
  return { got: cells.map((c) => letters[c.dataset.colour]).join(''), truth: window.__truth };
});
ok('the camera read the cube exactly right', read.got === read.truth,
  read.got === read.truth ? '' : `read ${read.got} want ${read.truth}`);
ok('scanned cube validates', (await page.locator('#reviewStatus').textContent()).includes('valid cube'));

await page.click('#btnSolve');
await page.waitForSelector('#panel-solve:not([hidden])', { timeout: 20000 });
const scanSolve = await page.evaluate(() => {
  const moves = Array.from(document.querySelectorAll('.move')).map((m) => m.textContent);
  return RS.Cube.isSolved(RS.Cube.applySeq(RS.Cube.toArray(window.__truth), moves));
});
ok('the scanned cube gets a working solution', scanSolve);

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
