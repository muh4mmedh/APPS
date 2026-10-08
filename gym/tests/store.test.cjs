/*
 * Logic tests for the gym app. Plain node, no dependencies:
 *
 *   node gym/tests/store.test.cjs
 */
'use strict';

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '..');
global.window = {};
require(path.join(APP, 'js/data.js'));
const DAYS = global.window.GYM_DAYS;
const S = require(path.join(APP, 'js/store.js'));

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail !== undefined ? '  -> ' + JSON.stringify(detail) : ''));
}
const day = (id) => DAYS.find((d) => d.id === id);
const ex = (dayId, exId) => day(dayId).ex.find((e) => e.id === exId);
function fillDay(data, week, dayId, date) {
  day(dayId).ex.forEach((e) => {
    for (let i = 0; i < e.sets; i++) S.logSet(data, week, dayId, date, e.id, i, S.suggest(data, week, dayId, e, i).w === null ? { w: 10, r: 10 } : S.suggest(data, week, dayId, e, i));
  });
}

console.log('\ndates');
check('week starts on Monday', S.weekKey(new Date(2026, 9, 8)) === '2026-10-05', S.weekKey(new Date(2026, 9, 8)));
check('a Sunday belongs to the week before', S.weekKey(new Date(2026, 9, 11)) === '2026-10-05');
check('a Monday is its own week', S.weekKey(new Date(2026, 9, 12)) === '2026-10-12');

console.log('\ndata');
const ids = DAYS.flatMap((d) => d.ex.map((e) => d.id + ':' + e.id));
check('exercise ids are unique within a day', new Set(ids).size === ids.length);
check('every exercise has a target range', DAYS.every((d) => d.ex.every((e) => S.range(e)[0] > 0)));
check('ranges read right', JSON.stringify(S.range({ reps: '8-12 reps' })) === '[8,12]' && JSON.stringify(S.range({ reps: '20 minutes' })) === '[20,20]');
global.window = {};
require(path.join(APP, 'js/figures.js'));
const missingArt = DAYS.flatMap((d) => d.ex).filter((e) => !global.window.GymFigures.ART[e.art]).map((e) => e.id);
check('every exercise has a drawing', missingArt.length === 0, missingArt);

console.log('\nlogging and ticks');
let data = S.empty();
const W1 = '2026-09-28', W2 = '2026-10-05';
const incline = ex('d1', 'incline-db');
check('first time there is no weight to repeat', S.suggest(data, W1, 'd1', incline, 0).w === null);
check('first time reps start at the bottom of the range', S.suggest(data, W1, 'd1', incline, 0).r === 8);
S.logSet(data, W1, 'd1', '2026-09-29', 'incline-db', 0, { w: 20, r: 12 });
check('set 2 follows the weight just used', S.suggest(data, W1, 'd1', incline, 1).w === 20);
S.logSet(data, W1, 'd1', '2026-09-29', 'incline-db', 1, { w: 20, r: 12 });
S.logSet(data, W1, 'd1', '2026-09-29', 'incline-db', 2, { w: 20, r: 11 });
check('exercise counts as done when every set is logged', S.exDone(S.findSession(data, W1, 'd1'), incline));
check('day progress counts sets', S.dayCounts(data, W1, day('d1')).got === 3);
check('one session per day per week', data.sessions.length === 1);
check('ticks start fresh the next week', S.dayCounts(data, W2, day('d1')).got === 0);

console.log('\nlast session');
check('next week prefills last week\'s weight', S.suggest(data, W2, 'd1', incline, 2).w === 20);
check('and last week\'s reps for the same set', S.suggest(data, W2, 'd1', incline, 2).r === 11);
check('previous ignores the current week', S.previous(data, 'incline-db', W1) === null);
check('previous finds last week', S.previous(data, 'incline-db', W2).week === W1);

console.log('\nprogression only when the knee felt fine');
const prev = () => S.previous(data, 'incline-db', W2);
check('no knee check: asks for one', S.advice(incline, prev()) === 'check');
S.setKnee(data, W1, 'd1', '2026-09-29', 'fine');
check('fine but 11 on the last set: add a rep', S.advice(incline, prev()) === 'rep');
S.logSet(data, W1, 'd1', '2026-09-29', 'incline-db', 2, { w: 20, r: 12 });
check('fine and top of the range on every set: go up', S.advice(incline, prev()) === 'up');
S.setKnee(data, W1, 'd1', '2026-09-29', 'sore');
check('sore: hold', S.advice(incline, prev()) === 'hold');
S.setKnee(data, W1, 'd1', '2026-09-29', 'off');
check('off: hold, with the warning', S.advice(incline, prev()) === 'hold-off');
check('off is the latest knee check', S.lastKnee(data).knee === 'off');
S.setKnee(data, W2, 'd2', '2026-10-06', 'fine');
check('a later fine check replaces it', S.lastKnee(data).knee === 'fine');
S.setKnee(data, W2, 'd2', '2026-10-06', 'fine');
check('tapping the same answer again clears it, and the empty session goes', S.findSession(data, W2, 'd2') === null);

console.log('\nlog types');
const plank = ex('d3', 'plank'), bridge = ex('d3', 'bridge'), bike = ex('d3', 'cardio-3');
check('plank logs seconds from the range', S.suggest(data, W2, 'd3', plank, 0).t === 30);
check('bridge logs reps only', JSON.stringify(S.suggest(data, W2, 'd3', bridge, 0)) === '{"r":12}');
check('cardio logs minutes', S.suggest(data, W2, 'd3', bike, 0).t === 20);

console.log('\nclearing');
S.clearSet(data, W1, 'd1', 'incline-db', 2);
check('clearing a set unticks it', S.dayCounts(data, W1, day('d1')).got === 2);
S.clearDay(data, W1, 'd1');
check('clearing the day keeps the knee check', S.findSession(data, W1, 'd1').knee === 'off');

console.log('\nwhich tab opens');
data = S.empty();
const monday = new Date(2026, 9, 5), tuesday = new Date(2026, 9, 6), wednesday = new Date(2026, 9, 7), thursday = new Date(2026, 9, 8);
check('Monday opens Day 1', S.openDay(data, DAYS, monday) === 0);
check('Thursday opens Day 3 even with Day 1 missed', S.openDay(data, DAYS, thursday) === 2);
check('Wednesday opens the missed Day 1', S.openDay(data, DAYS, wednesday) === 0);
fillDay(data, W2, 'd1', '2026-10-05');
check('Tuesday opens Day 2', S.openDay(data, DAYS, tuesday) === 1);
fillDay(data, W2, 'd2', '2026-10-06');
check('Wednesday after two days opens Day 3', S.openDay(data, DAYS, wednesday) === 2);
fillDay(data, W2, 'd3', '2026-10-08');
fillDay(data, W2, 'd4', '2026-10-09');
check('all four done opens Rehab', DAYS[S.openDay(data, DAYS, new Date(2026, 9, 10))].id === 'k');

console.log('\nunits');
check('kg stays kg', S.toDisplay(22.5, 'kg') === 22.5);
check('lb round trip is stable', S.toDisplay(S.fromDisplay(45, 'lb'), 'lb') === 45);
check('100 lb is about 45.4 kg', Math.abs(S.fromDisplay(100, 'lb') - 45.359) < 0.001);
check('body weight 0 is allowed', S.fromDisplay(0, 'kg') === 0);

console.log('\nsave, load, import');
const mem = { v: {}, getItem(k) { return this.v[k] || null; }, setItem(k, x) { this.v[k] = x; } };
data.unit = 'lb';
S.setBodyWeight(data, W2, 'd1', '2026-10-05', 80);
S.save(mem, data);
const back = S.load(mem);
check('load returns what was saved', JSON.stringify(back) === JSON.stringify(data));
check('export imports cleanly', JSON.stringify(S.parse(S.exportText(data))) === JSON.stringify(data));
check('a broken store loads as empty, not a crash', S.load({ getItem: () => '{nope' }).sessions.length === 0);
check('blocked storage loads as empty', S.load({ getItem() { throw new Error('blocked'); } }).sessions.length === 0);
let reason = '';
try { S.parse('{"v":1,"sessions":[{"week":"x"}]}'); } catch (e) { reason = e.message; }
check('a damaged backup is refused with a reason', /damaged/.test(reason), reason);
try { S.parse('[1,2]'); reason = ''; } catch (e) { reason = e.message; }
check('a random JSON file is refused', /not a gym log/.test(reason), reason);
check('a negative weight is refused', (() => { try { S.parse(JSON.stringify({ v: 1, sessions: [{ week: W2, dayId: 'd1', date: W2, sets: { a: [{ w: -1, r: 1 }] } }] })); return false; } catch (e) { return true; } })());

console.log('\noffline cache');
const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
const cached = [...(sw.match(/const FILES = \[([\s\S]*?)\];/) || [])[1].matchAll(/'\.\/([^']+)'/g)].map((m) => m[1]);
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const used = [...html.matchAll(/(?:href|src)\s*=\s*"([^"#:]+)"/g)].map((m) => m[1]);
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
used.push(...manifest.icons.map((i) => i.src));
const notCached = [...new Set(used)].filter((u) => !cached.includes(u));
check('every file the app loads is precached', notCached.length === 0, notCached);
const missing = cached.filter((f) => !fs.existsSync(path.join(APP, f)));
check('every precached file exists', missing.length === 0, missing);
const outside = used.filter((u) => u.startsWith('..'));
check('nothing is loaded from outside the app folder', outside.length === 0, outside);

console.log('\n' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
