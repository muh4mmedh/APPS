/*
 * store.js — everything the app remembers, and the rules that read it.
 *
 * No DOM in here, so the tests can run it under plain node.
 *
 * Shape of the saved data (one localStorage key, see KEY):
 *
 *   {
 *     v: 1,
 *     unit: "kg" | "lb",            display only; weights are always stored in kg
 *     sessions: [{
 *       week:  "2026-10-05",        Monday of the week it belongs to
 *       dayId: "d1",
 *       date:  "2026-10-06",        the day the first set was logged
 *       sets:  { "incline-db": [ {w: 20, r: 10}, null, ... ] },
 *       knee:  null | "fine" | "sore" | "off",
 *       bw:    null | 80.5          body weight in kg
 *     }]
 *   }
 *
 * One session per day per week. Ticks are not stored separately: a set is
 * done when it has a logged entry in this week's session. So the weekly
 * reset falls out for free, and nothing logged is ever thrown away by it.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GymStore = factory();
})(this, function () {
  'use strict';

  var KEY = 'gym-log-v1';
  var LB = 0.45359237;
  var KNEE = ['fine', 'sore', 'off'];
  var GYM_DAYS = { 1: 'd1', 2: 'd2', 4: 'd3', 5: 'd4' };   // Mon, Tue, Thu, Fri

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dateKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function weekKey(d) {
    var m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - (m.getDay() + 6) % 7);
    return dateKey(m);
  }

  function empty() { return { v: 1, unit: 'kg', sessions: [] }; }

  /* ---------- load, save, import ---------- */

  function isEntry(e) {
    if (e === null) return true;
    if (!e || typeof e !== 'object') return false;
    for (var k in e) if (['w', 'r', 't'].indexOf(k) < 0 || typeof e[k] !== 'number' || !isFinite(e[k]) || e[k] < 0) return false;
    return true;
  }
  function isSession(s) {
    if (!s || typeof s !== 'object') return false;
    if (!/^\d{4}-\d\d-\d\d$/.test(s.week) || !/^\d{4}-\d\d-\d\d$/.test(s.date)) return false;
    if (typeof s.dayId !== 'string' || !s.sets || typeof s.sets !== 'object') return false;
    if (s.knee != null && KNEE.indexOf(s.knee) < 0) return false;
    if (s.bw != null && (typeof s.bw !== 'number' || !(s.bw > 0))) return false;
    for (var ex in s.sets) {
      if (!Array.isArray(s.sets[ex]) || !s.sets[ex].every(isEntry)) return false;
    }
    return true;
  }

  /* Returns clean data, or throws with a reason a person can read. */
  function parse(text) {
    var raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error('That file is not valid JSON.'); }
    if (!raw || raw.v !== 1 || !Array.isArray(raw.sessions)) throw new Error('That file is not a gym log export.');
    var bad = raw.sessions.filter(function (s) { return !isSession(s); }).length;
    if (bad) throw new Error(bad + ' session(s) in that file are damaged, so nothing was imported.');
    return {
      v: 1,
      unit: raw.unit === 'lb' ? 'lb' : 'kg',
      sessions: raw.sessions.map(function (s) {
        return { week: s.week, dayId: s.dayId, date: s.date, sets: s.sets, knee: s.knee || null, bw: s.bw || null };
      })
    };
  }

  function load(storage) {
    var text = null;
    try { text = storage.getItem(KEY); } catch (e) { /* storage blocked */ }
    if (!text) return empty();
    try { return parse(text); } catch (e) { return empty(); }
  }
  function save(storage, data) {
    try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; }
  }
  function exportText(data) { return JSON.stringify(data, null, 1); }

  /* ---------- sessions and sets ---------- */

  function findSession(data, week, dayId) {
    for (var i = 0; i < data.sessions.length; i++) {
      var s = data.sessions[i];
      if (s.week === week && s.dayId === dayId) return s;
    }
    return null;
  }
  function session(data, week, dayId, today) {
    var s = findSession(data, week, dayId);
    if (!s) {
      s = { week: week, dayId: dayId, date: today, sets: {}, knee: null, bw: null };
      data.sessions.push(s);
    }
    return s;
  }
  function entry(s, exId, i) { return (s && s.sets[exId] && s.sets[exId][i]) || null; }

  function logSet(data, week, dayId, today, exId, i, value) {
    var s = session(data, week, dayId, today);
    var list = s.sets[exId] || (s.sets[exId] = []);
    while (list.length <= i) list.push(null);
    list[i] = value;
    return s;
  }
  function clearSet(data, week, dayId, exId, i) {
    var s = findSession(data, week, dayId);
    if (!s || !s.sets[exId]) return;
    s.sets[exId][i] = null;
    prune(data, s);
  }
  function clearDay(data, week, dayId) {
    var s = findSession(data, week, dayId);
    if (!s) return;
    s.sets = {};
    prune(data, s);
  }
  // A session with nothing logged and no knee check is just noise in history.
  function prune(data, s) {
    var any = Object.keys(s.sets).some(function (k) { return s.sets[k].some(Boolean); });
    if (!any && !s.knee && !s.bw) data.sessions.splice(data.sessions.indexOf(s), 1);
  }

  function setKnee(data, week, dayId, today, knee) {
    var s = session(data, week, dayId, today);
    s.knee = s.knee === knee ? null : knee;
    prune(data, s);
  }
  function setBodyWeight(data, week, dayId, today, kg) {
    var s = session(data, week, dayId, today);
    s.bw = kg > 0 ? kg : null;
    prune(data, s);
  }

  function exDone(s, ex) {
    for (var i = 0; i < ex.sets; i++) if (!entry(s, ex.id, i)) return false;
    return true;
  }
  function dayCounts(data, week, day) {
    var s = findSession(data, week, day.id), total = 0, got = 0;
    day.ex.forEach(function (ex) {
      for (var i = 0; i < ex.sets; i++) { total++; if (entry(s, ex.id, i)) got++; }
    });
    return { total: total, got: got };
  }
  function loggedCount(s) {
    var n = 0;
    for (var k in s.sets) s.sets[k].forEach(function (e) { if (e) n++; });
    return n;
  }

  /*
   * Which tab to open. Today's gym day if it is not finished, otherwise the
   * first gym day not finished this week (so a missed Tuesday shows up on
   * Wednesday), otherwise rehab once the four gym days are done.
   */
  function openDay(data, days, now) {
    var week = weekKey(now), todays = GYM_DAYS[now.getDay()];
    function complete(day) { var c = dayCounts(data, week, day); return c.got === c.total; }
    var gym = days.filter(function (d) { return d.id !== 'k'; });
    var pick = gym.filter(function (d) { return d.id === todays && !complete(d); })[0] ||
               gym.filter(function (d) { return !complete(d); })[0];
    if (pick) return days.indexOf(pick);
    var rehab = days.filter(function (d) { return d.id === 'k'; })[0];
    return rehab ? days.indexOf(rehab) : 0;
  }

  /* ---------- history ---------- */

  function byNewest(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.week < b.week ? 1 : a.week > b.week ? -1 : 0;
  }
  function history(data) { return data.sessions.slice().sort(byNewest); }

  /* The most recent session before this week that logged this exercise. */
  function previous(data, exId, week) {
    var best = null;
    data.sessions.forEach(function (s) {
      if (s.week >= week || !s.sets[exId] || !s.sets[exId].some(Boolean)) return;
      if (!best || byNewest(s, best) < 0) best = s;
    });
    return best;
  }

  /* The latest knee check, from any session. */
  function lastKnee(data) {
    var h = history(data).filter(function (s) { return s.knee; });
    return h[0] || null;
  }
  function lastBodyWeight(data) {
    var h = history(data).filter(function (s) { return s.bw; });
    return h[0] ? h[0].bw : null;
  }

  /* ---------- targets, prefill, progression ---------- */

  function logType(ex) { return ex.log || 'wr'; }
  function range(ex) {
    var m = /(\d+)(?:\s*-\s*(\d+))?/.exec(ex.reps || '');
    if (!m) return [0, 0];
    var lo = +m[1];
    return [lo, m[2] ? +m[2] : lo];
  }

  /*
   * What a set should say before it is logged, so one tap repeats last time.
   * Weight follows the set before it in this session (change set 1 and set 2
   * follows), then last session's same set, then its last set. Reps or time
   * come from last session's same set, then the bottom of the target range.
   * Returns null for weight when nothing is known yet.
   */
  function suggest(data, week, dayId, ex, i) {
    var type = logType(ex), lo = range(ex)[0];
    var cur = findSession(data, week, dayId);
    var prev = previous(data, ex.id, week);
    var prevList = prev ? prev.sets[ex.id] : [];
    var prevSame = prevList[i] || null;
    var prevAny = null;
    for (var j = prevList.length - 1; j >= 0; j--) if (prevList[j]) { prevAny = prevList[j]; break; }
    var before = null;
    for (var k = i - 1; k >= 0; k--) if (entry(cur, ex.id, k)) { before = entry(cur, ex.id, k); break; }

    if (type === 'secs' || type === 'mins') {
      return { t: (prevSame || before || prevAny || {}).t || lo };
    }
    var r = (prevSame && prevSame.r) || (before && before.r) || lo;
    if (type === 'reps') return { r: r };
    var w = before && before.w != null ? before.w
          : prevSame && prevSame.w != null ? prevSame.w
          : prevAny && prevAny.w != null ? prevAny.w : null;
    return { w: w, r: r };
  }

  /*
   * One line of advice from last session. Going up needs a knee that felt
   * fine last time; anything else says hold.
   *   up    knee fine and every set reached the top of the range
   *   rep   knee fine, not there yet: same weight, one more rep
   *   hold  knee sore or off: repeat or go lighter
   *   check knee not recorded
   */
  function advice(ex, prev) {
    if (!prev) return null;
    if (prev.knee === 'off') return 'hold-off';
    if (prev.knee === 'sore') return 'hold';
    if (prev.knee !== 'fine') return 'check';
    var type = logType(ex), top = range(ex)[1];
    var list = (prev.sets[ex.id] || []).filter(Boolean);
    if (type === 'mins') return 'same';
    var hit = list.length >= ex.sets && list.every(function (e) {
      return (type === 'secs' ? e.t : e.r) >= top;
    });
    return hit ? 'up' : 'rep';
  }

  /* ---------- units ---------- */

  function toDisplay(kg, unit) {
    if (kg == null) return null;
    if (unit === 'lb') return Math.round(kg / LB * 2) / 2;
    return Math.round(kg * 100) / 100;
  }
  function fromDisplay(value, unit) {
    if (!(value >= 0)) return null;
    var kg = unit === 'lb' ? value * LB : value;
    return Math.round(kg * 1000) / 1000;
  }
  function step(unit) { return unit === 'lb' ? 5 : 2.5; }

  return {
    KEY: KEY, KNEE: KNEE,
    dateKey: dateKey, weekKey: weekKey, empty: empty,
    parse: parse, load: load, save: save, exportText: exportText,
    findSession: findSession, entry: entry, logSet: logSet, clearSet: clearSet, clearDay: clearDay,
    setKnee: setKnee, setBodyWeight: setBodyWeight,
    exDone: exDone, dayCounts: dayCounts, loggedCount: loggedCount, openDay: openDay,
    history: history, previous: previous, lastKnee: lastKnee, lastBodyWeight: lastBodyWeight,
    logType: logType, range: range, suggest: suggest, advice: advice,
    toDisplay: toDisplay, fromDisplay: fromDisplay, step: step
  };
});
