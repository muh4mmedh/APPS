/*
 * Browser tests for the gym app: drives the real page in Chromium at phone
 * size. Needs playwright (npm install at the repo root); skips without it.
 *
 *   node gym/tests/browser.test.mjs
 *
 * Screenshots land in gym/tests/screenshots/.
 */
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(APP, 'tests', 'screenshots');

let chromium;
try {
  ({ chromium } = await import('playwright'));
} catch {
  console.log('\nplaywright is not installed — skipping gym browser tests.\n');
  process.exit(0);
}

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png'
};
const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(APP, normalize(path).replace(/^([/\\])+/, ''));
    if (!file.startsWith(APP)) { res.writeHead(403).end(); return; }
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const URL_ = 'http://127.0.0.1:' + server.address().port + '/index.html';
await mkdir(SHOTS, { recursive: true });

let failed = 0;
const ok = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? '  -> ' + detail : ''}`);
  if (!pass) failed++;
};

// Prefer playwright's own browser; fall back to one already on the machine.
async function launch() {
  for (const executablePath of [undefined, process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', '/usr/bin/chromium']) {
    try { return await chromium.launch(executablePath ? { executablePath } : {}); } catch { /* try the next */ }
  }
  console.log('\ncould not start a browser — skipping gym browser tests.\n');
  server.close();
  process.exit(0);
}
const browser = await launch();
try {
  // A Monday, so Day 1 opens.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.clock.setFixedTime(new Date(2026, 9, 5, 18, 0));
  await page.goto(URL_);

  console.log('\nfirst open');
  ok('opens on Day 1 on a Monday', (await page.textContent('.tab[aria-selected="true"] .d')) === 'Day 1');
  ok('draws every exercise with pictures', (await page.locator('#list .ex').count()) === 5 && (await page.locator('#list .ex').first().locator('svg').count()) === 2);
  ok('nothing logged yet', (await page.textContent('#dayLabel')).includes('0 of 15'));
  ok('no tap target under 44px in the set rows', await page.evaluate(() =>
    [...document.querySelectorAll('.set, .val, .pick, .tab')].every((b) => b.getBoundingClientRect().height >= 44)));
  ok('no sideways scroll at phone width', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.screenshot({ path: join(SHOTS, '1-day1.png') });

  console.log('\nlogging a set');
  const first = page.locator('.ex[data-ex="incline-db"]');
  await first.locator('.set').first().click();
  ok('with no weight known, ticking asks for it', await page.locator('#sheet[open]').isVisible());
  await page.screenshot({ path: join(SHOTS, '2-sheet.png') });
  await page.fill('#inW', '15');
  await page.click('.stepper__b[data-step="w"][data-dir="1"]');
  await page.click('.stepper__b[data-step="r"][data-dir="1"]');
  await page.click('.stepper__b[data-step="r"][data-dir="1"]');
  await page.click('#sheetSave');
  ok('sheet closes on save', !(await page.locator('#sheet[open]').count()));
  ok('set 1 shows 17.5 kg × 10', (await first.locator('.val').first().textContent()).startsWith('17.5 kg × 10'));
  ok('set 1 is ticked', (await first.locator('.set').first().getAttribute('aria-pressed')) === 'true');
  await first.locator('.set').nth(1).click();
  ok('one tap logs set 2 at the same weight and reps', (await first.locator('.val').nth(1).textContent()).startsWith('17.5 kg × 10'));
  await first.locator('.set').nth(2).click();
  ok('exercise is marked done', await first.evaluate((n) => n.classList.contains('done')));
  ok('progress counts 3 sets', (await page.textContent('#dayLabel')).includes('3 of 15'));

  console.log('\nknee check');
  await page.click('.pick[data-knee="off"]');
  ok('"felt off" shows the stop warning', await page.locator('#kneeOffNote').isVisible());
  ok('and the banner at the top', (await page.textContent('#kneeAlert')).includes('felt off'));
  await page.fill('#bwInput', '80');
  await page.locator('#bwInput').blur();
  await page.screenshot({ path: join(SHOTS, '3-knee-off.png'), fullPage: true });

  console.log('\nnext week');
  await page.clock.setFixedTime(new Date(2026, 9, 12, 18, 0));
  await page.reload();
  ok('saved across reloads, ticks reset', (await page.textContent('#dayLabel')).includes('0 of 15'));
  const again = page.locator('.ex[data-ex="incline-db"]');
  ok('shows last time\'s numbers', (await again.locator('.last').textContent()).includes('17.5 kg × 10, 10, 10'));
  ok('says hold because the knee felt off', (await again.locator('.hint').textContent()).includes('Same weight or lighter'));
  ok('prefills last week\'s weight', (await again.locator('.val').first().textContent()).startsWith('17.5 kg'));
  ok('off banner still up until a newer check', await page.locator('#kneeAlert').isVisible());
  await page.click('.pick[data-knee="fine"]');
  ok('a fine check clears the banner', await page.locator('#kneeAlert').isHidden());

  console.log('\nhistory and units');
  await page.click('#viewSwitch');
  await page.locator('#history').waitFor();
  ok('history lists both sessions', (await page.locator('.sess').count()) === 2, String(await page.locator('.sess').count()));
  ok('body weight shows', (await page.textContent('#bwSummary')).includes('80 kg'));
  ok('knee dots in order', (await page.locator('#kneeDots .dot').evaluateAll((d) => d.map((x) => x.className))).join() === 'dot dot--off,dot dot--fine');
  await page.click('.seg__b[data-unit="lb"]');
  ok('switching to lb converts body weight', (await page.textContent('#bwSummary')).includes('176.5 lb'));
  await page.locator('.sess').last().locator('summary').click();
  ok('session details convert too', (await page.locator('.sess').last().textContent()).includes('38.5 lb'));
  await page.screenshot({ path: join(SHOTS, '4-history.png'), fullPage: true });
  await page.goBack();
  await page.locator('#train').waitFor();
  ok('back button returns to training', await page.locator('#train').isVisible());
  ok('training view uses lb', (await page.locator('.ex[data-ex="incline-db"] .val').first().textContent()).startsWith('38.5 lb'));

  console.log('\noffline');
  await page.goto(URL_);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.reload();
  ok('reloads with no network', (await page.locator('#list .ex').count()) === 5);
  await context.setOffline(false);

  ok('no script errors', errors.length === 0, errors.join(' | '));
  await context.close();
} finally {
  await browser.close();
  server.close();
}

console.log('\n' + (failed === 0 ? 'all browser checks passed' : failed + ' browser check(s) failed') + '\n');
process.exit(failed === 0 ? 0 : 1);
