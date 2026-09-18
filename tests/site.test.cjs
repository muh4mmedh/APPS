/*
 * Site-level checks that need no browser. Run with: node tests/site.test.cjs
 *
 * These exist because of a bug that shipped: the launcher linked to
 * `apps/rubiks-solver/` and every app linked back to `../../`. A web server
 * answers a folder with its index.html, so it worked in a browser — but the
 * Android WebView serves files straight out of the APK with no such rule, and
 * neither does file://. Tapping an app in the installed app failed with
 * ERR_INVALID_RESPONSE.
 *
 * So: every internal link must name a file that exists.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

function htmlFiles() {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '.git', 'dist', 'build', 'screenshots'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.html')) found.push(full);
    }
  };
  walk(ROOT);
  return found;
}

const EXTERNAL = /^(https?:|data:|mailto:|tel:|javascript:|#|\/\/)/i;

console.log('\ninternal links');

const broken = [];
const directoryLinks = [];

for (const file of htmlFiles()) {
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const refs = [];
  for (const match of html.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/g)) refs.push(match[1]);
  // the redirect in a per-app zip, and any other meta refresh
  for (const match of html.matchAll(/content\s*=\s*"[^"]*url=([^"]+)"/gi)) refs.push(match[1].trim());

  for (const ref of refs) {
    if (!ref || EXTERNAL.test(ref)) continue;
    const clean = ref.split('#')[0].split('?')[0];
    if (!clean) continue;
    const target = path.resolve(dir, clean);
    const rel = path.relative(ROOT, file);
    if (clean.endsWith('/')) {
      directoryLinks.push(`${rel} -> ${ref}`);
      continue;
    }
    if (!fs.existsSync(target)) broken.push(`${rel} -> ${ref}`);
    else if (fs.statSync(target).isDirectory()) directoryLinks.push(`${rel} -> ${ref}`);
  }
}

check('every internal link points at a file that exists', broken.length === 0, broken.join(', '));
check('no link points at a folder (the APK cannot resolve those)',
  directoryLinks.length === 0, directoryLinks.join(', '));

console.log('\napp registry');

global.window = {};
require(path.join(ROOT, 'assets/js/registry.js'));
const apps = global.window.APPS;

check('registry has at least one app', apps.length > 0);
check('every registered app has an index.html',
  apps.every((app) => fs.existsSync(path.join(ROOT, 'apps', app.id, 'index.html'))),
  apps.filter((app) => !fs.existsSync(path.join(ROOT, 'apps', app.id, 'index.html')))
      .map((app) => app.id).join(', '));
check('every registered app has an id, name and tagline',
  apps.every((app) => app.id && app.name && app.tagline));

// The launcher builds card links itself, so a folder link there would not be
// caught by the scan above.
const launcher = fs.readFileSync(path.join(ROOT, 'assets/js/launcher.js'), 'utf8');
check('the launcher links cards to a file, not a folder',
  /link\.href\s*=\s*'apps\/'\s*\+\s*app\.id\s*\+\s*'\/index\.html'/.test(launcher),
  launcher.match(/link\.href\s*=.*/)?.[0]);

console.log('\nversion and offline cache');

const version = fs.readFileSync(path.join(ROOT, 'release/VERSION'), 'utf8').trim();
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const swVersion = (sw.match(/^const VERSION = '([^']+)';$/m) || [])[1];

check('release/VERSION looks like a version', /^\d+\.\d+\.\d+$/.test(version), version);
check('sw.js VERSION matches release/VERSION', swVersion === version,
  `sw.js has ${swVersion}, release/VERSION has ${version}`);

// Anything the worker precaches must exist, or the install silently skips it.
const shell = (sw.match(/const SHELL = \[([\s\S]*?)\];/) || [])[1] || '';
const shellPaths = [...shell.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const missingShell = shellPaths.filter((p) => p !== './' && !fs.existsSync(path.join(ROOT, p)));
check('every precached file exists', missingShell.length === 0, missingShell.join(', '));

console.log('\nmanifests');

for (const rel of ['manifest.webmanifest', 'apps/rubiks-solver/manifest.webmanifest']) {
  const file = path.join(ROOT, rel);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const dir = path.dirname(file);
  const icons = data.icons.filter((icon) => !fs.existsSync(path.join(dir, icon.src)));
  check(`${rel}: every icon exists`, icons.length === 0, icons.map((i) => i.src).join(', '));
  const shortcuts = (data.shortcuts || []).filter((s) => {
    const target = path.resolve(dir, s.url);
    return !fs.existsSync(target) || fs.statSync(target).isDirectory();
  });
  check(`${rel}: every shortcut points at a file`, shortcuts.length === 0,
    shortcuts.map((s) => s.url).join(', '));
}

console.log('\n' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
