/*
 * app.js — draws the training and history views and wires up the controls.
 *
 * All the rules (what a set prefills to, when to go heavier, which tab to
 * open) live in store.js; this file only reads them and draws.
 */
(function () {
  'use strict';

  var DAYS = window.GYM_DAYS;
  var Fig = window.GymFigures;
  var S = window.GymStore;

  var data = S.load(window.localStorage);
  var now = new Date();
  var view = { day: S.openDay(data, DAYS, now) };
  var open = {};   // which "How to do it" panels are open, kept across redraws

  function today() { return S.dateKey(new Date()); }
  function week() { return S.weekKey(new Date()); }
  function persist() { S.save(window.localStorage, data); }
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, text) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (text != null) n.textContent = text;
    return n;
  }
  function listOf(tag, items, cls) {
    var l = el(tag, cls ? { 'class': cls } : null);
    items.forEach(function (t) { l.appendChild(el('li', null, t)); });
    return l;
  }

  /* ---------- formatting ---------- */

  function nice(d) {
    var p = d.split('-');
    return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function weight(kg) {
    if (kg == null) return null;
    if (kg === 0) return 'Body weight';
    return S.toDisplay(kg, data.unit) + ' ' + data.unit;
  }
  function fmt(ex, e) {
    var type = S.logType(ex);
    if (type === 'secs') return e.t + ' s';
    if (type === 'mins') return e.t + ' min';
    if (type === 'reps') return e.r + ' reps';
    var w = weight(e.w);
    return (w || 'Add weight') + ' × ' + e.r;
  }
  // "20 kg × 12, 12, 11" when the weight held, else each set in full.
  function fmtList(ex, list) {
    var got = list.filter(Boolean);
    if (!got.length) return '';
    var type = S.logType(ex);
    if (type === 'secs' || type === 'mins') return got.map(function (e) { return e.t; }).join(', ') + (type === 'secs' ? ' s' : ' min');
    if (type === 'reps') return got.map(function (e) { return e.r; }).join(', ') + ' reps';
    var same = got.every(function (e) { return e.w === got[0].w; });
    if (same) return weight(got[0].w) + ' × ' + got.map(function (e) { return e.r; }).join(', ');
    return got.map(function (e) { return fmt(ex, e); }).join(', ');
  }
  var KNEE_WORD = { fine: 'Knee fine', sore: 'Knee a bit sore', off: 'Knee felt off' };

  function adviceText(ex, kind) {
    var type = S.logType(ex);
    var more = type === 'secs' ? 'hold 5 seconds longer' : 'add a rep';
    switch (kind) {
      case 'up':
        if (type === 'wr') return ['up', 'Knee was fine and you hit the top of the range. Go up one step (' + S.step(data.unit) + ' ' + data.unit + '), or keep the weight and ' + more + '.'];
        return ['up', 'Knee was fine and you hit the top of the range. Keep it slow and ' + more + '.'];
      case 'rep': return ['up', 'Knee was fine. Same ' + (type === 'wr' ? 'weight' : 'again') + ', try to ' + more + '.'];
      case 'same': return ['up', 'Knee was fine. Same again.'];
      case 'hold': return ['hold', 'Knee was a bit sore last time. Repeat last time, don’t add.'];
      case 'hold-off': return ['off', 'Knee felt off last time. Same weight or lighter, and stop if it hurts.'];
      case 'check': return ['', 'Log how the knee felt after the session to get a go-up hint.'];
    }
    return null;
  }

  /* ---------- training view ---------- */

  function renderTabs() {
    var tabs = $('tabs');
    tabs.textContent = '';
    DAYS.forEach(function (day, idx) {
      var c = S.dayCounts(data, week(), day);
      var b = el('button', { type: 'button', 'class': 'tab' + (c.got === c.total ? ' complete' : ''), role: 'tab', 'aria-selected': String(idx === view.day) });
      b.appendChild(el('span', { 'class': 'd' }, day.name));
      b.appendChild(el('span', { 'class': 't' }, day.tag));
      b.addEventListener('click', function () { view.day = idx; render(); window.scrollTo(0, 0); });
      tabs.appendChild(b);
    });
  }

  function renderProgress() {
    var day = DAYS[view.day], c = S.dayCounts(data, week(), day);
    var pct = c.total ? Math.round((c.got / c.total) * 100) : 0;
    $('dayLabel').textContent = day.title + ': ' + c.got + ' of ' + c.total + ' sets';
    $('pct').textContent = pct + '%';
    $('fill').style.width = pct + '%';
    $('dayNote').textContent = day.note || '';
    $('dayNote').hidden = !day.note;
  }

  function renderFigure(ex) {
    var art = Fig.ART[ex.art];
    if (!art) return null;
    var wrap = el('div');
    var figs = el('div', { 'class': 'figs' });
    art.f.forEach(function (frame, i) {
      var box = el('div', { 'class': 'fig' });
      box.appendChild(Fig.drawFrame(frame, ex.name + ': ' + art.l[i]));
      box.appendChild(el('span', null, art.l[i]));
      figs.appendChild(box);
    });
    wrap.appendChild(figs);
    if (ex.imgNote) wrap.appendChild(el('p', { 'class': 'imgnote' }, ex.imgNote));
    return wrap;
  }

  function renderLast(card, ex) {
    var prev = S.previous(data, ex.id, week());
    if (!prev) return;
    var p = el('p', { 'class': 'last' });
    p.appendChild(document.createTextNode('Last time, ' + nice(prev.date) + ': '));
    p.appendChild(el('strong', null, fmtList(ex, prev.sets[ex.id])));
    card.appendChild(p);
    var a = adviceText(ex, S.advice(ex, prev));
    if (a) card.appendChild(el('p', { 'class': 'hint' + (a[0] ? ' hint--' + a[0] : '') }, a[1]));
  }

  function renderSets(card, day, ex) {
    var cur = S.findSession(data, week(), day.id);
    var sets = el('div', { 'class': 'sets' });
    for (var i = 0; i < ex.sets; i++) {
      (function (i) {
        var logged = S.entry(cur, ex.id, i);
        var shown = logged || S.suggest(data, week(), day.id, ex, i);
        var label = ex.sets === 1 ? 'Done' : 'Set ' + (i + 1);
        var row = el('div', { 'class': 'setrow' });
        var tick = el('button', { type: 'button', 'class': 'set', 'aria-pressed': String(!!logged), 'aria-label': label + (logged ? ', logged' : ', tap to log ' + fmt(ex, shown)) }, label);
        tick.addEventListener('click', function () {
          if (logged) { S.clearSet(data, week(), day.id, ex.id, i); save(); return; }
          // Nothing to repeat yet: ask for the weight instead of guessing.
          if (S.logType(ex) === 'wr' && shown.w == null) { openSheet(day, ex, i); return; }
          S.logSet(data, week(), day.id, today(), ex.id, i, shown);
          save();
        });
        var val = el('button', { type: 'button', 'class': 'val' + (logged ? ' is-done' : ''), 'aria-label': 'Edit ' + label.toLowerCase() + ': ' + fmt(ex, shown) });
        val.appendChild(el('span', null, fmt(ex, shown)));
        val.appendChild(el('span', { 'class': 'edit', 'aria-hidden': 'true' }, 'Edit'));
        val.addEventListener('click', function () { openSheet(day, ex, i); });
        row.appendChild(tick);
        row.appendChild(val);
        sets.appendChild(row);
      })(i);
    }
    card.appendChild(sets);
  }

  function renderList() {
    var list = $('list');
    list.textContent = '';
    var day = DAYS[view.day];
    var cur = S.findSession(data, week(), day.id);
    day.ex.forEach(function (ex) {
      var done = S.exDone(cur, ex);
      var card = el('section', { 'class': 'card ex' + (done ? ' done' : ''), 'data-ex': ex.id });
      var head = el('div', { 'class': 'ex-head' });
      var left = el('div');
      left.appendChild(el('h2', null, ex.name));
      left.appendChild(el('div', { 'class': 'meta' }, ex.sets + (ex.sets === 1 ? ' set' : ' sets') + ' of ' + ex.reps));
      head.appendChild(left);
      head.appendChild(el('div', { 'class': 'badge', 'aria-hidden': 'true' }, '✓'));
      card.appendChild(head);

      renderLast(card, ex);
      var fig = renderFigure(ex);
      if (fig) card.appendChild(fig);
      renderSets(card, day, ex);

      var det = el('details');
      var openKey = day.id + ':' + ex.id;
      if (open[openKey]) det.setAttribute('open', '');
      det.addEventListener('toggle', function () { open[openKey] = det.open; });
      det.appendChild(el('summary', null, 'How to do it'));
      var body = el('div', { 'class': 'body' });
      body.appendChild(el('h3', null, 'Steps'));
      body.appendChild(listOf('ol', ex.steps));
      body.appendChild(el('h3', null, 'Avoid'));
      body.appendChild(listOf('ul', ex.avoid, 'avoid'));
      body.appendChild(el('p', { 'class': 'knee-note' }, 'Knee: ' + ex.knee));
      det.appendChild(body);
      card.appendChild(det);
      list.appendChild(card);
    });
  }

  function renderFinish() {
    var day = DAYS[view.day];
    var cur = S.findSession(data, week(), day.id);
    var knee = cur && cur.knee;
    Array.prototype.forEach.call($('kneePick').querySelectorAll('.pick'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-knee') === knee));
    });
    $('kneeOffNote').hidden = knee !== 'off';
    $('bwUnit').textContent = data.unit;
    var input = $('bwInput');
    if (document.activeElement !== input) {
      input.value = cur && cur.bw ? S.toDisplay(cur.bw, data.unit) : '';
    }
    var last = S.lastBodyWeight(data);
    input.placeholder = last ? String(S.toDisplay(last, data.unit)) : '';
  }

  // Stays up until a later session's knee check says otherwise.
  function renderKneeAlert() {
    var last = S.lastKnee(data), box = $('kneeAlert');
    var show = last && last.knee === 'off';
    box.hidden = !show;
    if (!show) return;
    box.textContent = '';
    var span = el('span');
    span.appendChild(el('strong', null, 'Your knee felt off on ' + nice(last.date) + '. '));
    span.appendChild(document.createTextNode('If it swelled, gave way, locked or hurt sharply, see your doctor before training. Otherwise keep every weight the same or lighter, and stop if it hurts.'));
    box.appendChild(span);
  }

  /* ---------- history view ---------- */

  function renderHistory() {
    var all = S.history(data);
    var checks = all.filter(function (s) { return s.knee; });

    var since = new Date(); since.setDate(since.getDate() - 28);
    var recent = checks.filter(function (s) { return s.date >= S.dateKey(since); });
    var count = { fine: 0, sore: 0, off: 0 };
    recent.forEach(function (s) { count[s.knee]++; });
    $('kneeSummary').textContent = checks.length
      ? 'Last 4 weeks: ' + count.fine + ' fine, ' + count.sore + ' a bit sore, ' + count.off + ' felt off. Newest on the right.'
      : 'No knee checks yet. Pick one at the bottom of a day after you train.';
    var dots = $('kneeDots');
    dots.textContent = '';
    checks.slice(0, 16).reverse().forEach(function (s) {
      dots.appendChild(el('span', { 'class': 'dot dot--' + s.knee, title: nice(s.date) + ': ' + KNEE_WORD[s.knee], role: 'img', 'aria-label': nice(s.date) + ': ' + KNEE_WORD[s.knee] }));
    });

    var weights = all.filter(function (s) { return s.bw; });
    if (!weights.length) {
      $('bwSummary').textContent = 'Nothing logged yet. Add it in the knee check after a session.';
    } else {
      var latest = weights[0], text = S.toDisplay(latest.bw, data.unit) + ' ' + data.unit + ' on ' + nice(latest.date);
      var first = weights[weights.length - 1];
      if (first !== latest) {
        var diff = S.toDisplay(latest.bw, data.unit) - S.toDisplay(first.bw, data.unit);
        diff = Math.round(diff * 10) / 10;
        text += ' (' + (diff > 0 ? '+' : diff < 0 ? '−' : '±') + Math.abs(diff) + ' ' + data.unit + ' since ' + nice(first.date) + ')';
      }
      $('bwSummary').textContent = text + '.';
    }

    var box = $('sessions');
    box.textContent = '';
    if (!all.length) box.appendChild(el('p', { 'class': 'empty' }, 'Sessions you log show up here.'));
    all.forEach(function (s) {
      var day = DAYS.filter(function (d) { return d.id === s.dayId; })[0];
      var det = el('details', { 'class': 'sess' });
      var sum = el('summary');
      var main = el('span', { 'class': 'sess__main' });
      main.appendChild(el('b', null, nice(s.date) + ' · ' + (day ? day.name + ' ' + day.tag : s.dayId)));
      var bits = [S.loggedCount(s) + ' sets'];
      if (s.bw) bits.push(S.toDisplay(s.bw, data.unit) + ' ' + data.unit);
      main.appendChild(el('span', null, bits.join(' · ')));
      sum.appendChild(main);
      sum.appendChild(el('span', { 'class': 'knee-tag' + (s.knee ? ' knee-tag--' + s.knee : '') }, s.knee ? KNEE_WORD[s.knee] : 'No knee check'));
      det.appendChild(sum);
      var body = el('div', { 'class': 'sess__body' });
      (day ? day.ex : []).forEach(function (ex) {
        var list = s.sets[ex.id];
        if (!list || !list.some(Boolean)) return;
        var p = el('p');
        p.appendChild(el('span', null, ex.name));
        p.appendChild(el('span', null, fmtList(ex, list)));
        body.appendChild(p);
      });
      if (!body.childNodes.length) body.appendChild(el('p', { 'class': 'faint' }, 'Knee check only.'));
      det.appendChild(body);
      box.appendChild(det);
    });

    Array.prototype.forEach.call(document.querySelectorAll('.seg__b'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-unit') === data.unit));
    });
  }

  /* ---------- view switching ---------- */

  function showing() { return location.hash === '#history' ? 'history' : 'train'; }

  function render(keepScroll) {
    var y = window.scrollY;
    var v = showing();
    $('train').hidden = v !== 'train';
    $('history').hidden = v !== 'history';
    $('viewTitle').textContent = v === 'history' ? 'History' : 'Gym';
    $('viewSub').textContent = v === 'history' ? 'Sessions and knee checks' : 'Knee-safe guide and log';
    var sw = $('viewSwitch');
    sw.textContent = v === 'history' ? 'Back to training' : 'History';
    sw.setAttribute('href', v === 'history' ? '#' : '#history');
    if (v === 'history') renderHistory();
    else { renderKneeAlert(); renderTabs(); renderProgress(); renderList(); renderFinish(); }
    if (keepScroll) window.scrollTo(0, y);
  }
  function save() { persist(); render(true); }

  window.addEventListener('hashchange', function () { render(); window.scrollTo(0, 0); });

  /* ---------- log sheet ---------- */

  var sheet = $('sheet'), editing = null;

  function openSheet(day, ex, i) {
    var cur = S.findSession(data, week(), day.id);
    var logged = S.entry(cur, ex.id, i);
    var v = logged || S.suggest(data, week(), day.id, ex, i);
    var type = S.logType(ex);
    editing = { day: day, ex: ex, i: i, type: type };

    $('sheetTitle').textContent = ex.name + (ex.sets > 1 ? ' · set ' + (i + 1) : '');
    var prev = S.previous(data, ex.id, week());
    var prevSet = prev && prev.sets[ex.id][i];
    $('sheetSub').textContent = 'Target ' + ex.reps + '.' + (prevSet ? ' Last time this set: ' + fmt(ex, prevSet) + '.' : '');

    $('fieldW').hidden = type !== 'wr';
    $('wUnit').textContent = data.unit;
    $('inW').value = v.w != null ? S.toDisplay(v.w, data.unit) : '';
    $('rLabel').textContent = type === 'secs' ? 'Seconds' : type === 'mins' ? 'Minutes' : 'Reps';
    $('inR').value = type === 'secs' || type === 'mins' ? v.t : v.r;
    $('sheetRemove').hidden = !logged;

    if (sheet.showModal) sheet.showModal(); else sheet.setAttribute('open', '');
    // Straight to the weight when there is none yet; otherwise leave the
    // keyboard closed so a one-handed tap on Save is all it takes.
    if (type === 'wr' && $('inW').value === '') $('inW').focus();
  }
  function closeSheet() {
    if (sheet.close) sheet.close(); else sheet.removeAttribute('open');
    editing = null;
  }

  Array.prototype.forEach.call(document.querySelectorAll('.stepper__b'), function (b) {
    b.addEventListener('click', function () {
      var which = b.getAttribute('data-step'), dir = +b.getAttribute('data-dir');
      var input = which === 'w' ? $('inW') : $('inR');
      var by = which === 'w' ? S.step(data.unit) : editing && editing.type === 'secs' ? 5 : 1;
      var cur = parseFloat(input.value) || 0;
      var next = Math.max(0, Math.round((cur + dir * by) * 100) / 100);
      input.value = next;
    });
  });

  $('sheetForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!editing) return;
    var n = parseFloat($('inR').value);
    if (!(n > 0)) { $('inR').focus(); return; }
    var value;
    if (editing.type === 'secs' || editing.type === 'mins') value = { t: n };
    else if (editing.type === 'reps') value = { r: Math.round(n) };
    else {
      var w = parseFloat($('inW').value);
      if (!(w >= 0)) { $('inW').focus(); return; }
      value = { w: S.fromDisplay(w, data.unit), r: Math.round(n) };
    }
    S.logSet(data, week(), editing.day.id, today(), editing.ex.id, editing.i, value);
    closeSheet();
    save();
  });
  $('sheetCancel').addEventListener('click', closeSheet);
  $('sheetRemove').addEventListener('click', function () {
    if (editing) S.clearSet(data, week(), editing.day.id, editing.ex.id, editing.i);
    closeSheet();
    save();
  });
  // Tap outside the sheet to dismiss it.
  sheet.addEventListener('click', function (e) { if (e.target === sheet) closeSheet(); });

  /* ---------- knee check and body weight ---------- */

  Array.prototype.forEach.call($('kneePick').querySelectorAll('.pick'), function (b) {
    b.addEventListener('click', function () {
      S.setKnee(data, week(), DAYS[view.day].id, today(), b.getAttribute('data-knee'));
      save();
    });
  });
  $('bwInput').addEventListener('change', function () {
    var v = parseFloat($('bwInput').value);
    S.setBodyWeight(data, week(), DAYS[view.day].id, today(), v > 0 ? S.fromDisplay(v, data.unit) : null);
    save();
  });

  $('clearDay').addEventListener('click', function () {
    var day = DAYS[view.day];
    if (!S.dayCounts(data, week(), day).got) return;
    if (!window.confirm('Clear every set you logged for ' + day.title + ' this week?')) return;
    S.clearDay(data, week(), day.id);
    save();
  });

  /* ---------- settings and backup ---------- */

  Array.prototype.forEach.call(document.querySelectorAll('.seg__b'), function (b) {
    b.addEventListener('click', function () { data.unit = b.getAttribute('data-unit'); save(); });
  });

  function message(text, kind) {
    var m = $('dataMsg');
    m.textContent = text;
    m.className = 'notice' + (kind ? ' notice--' + kind : '');
    m.hidden = false;
  }

  $('exportBtn').addEventListener('click', function () {
    var blob = new Blob([S.exportText(data)], { type: 'application/json' });
    var a = el('a', { href: URL.createObjectURL(blob), download: 'gym-log-' + today() + '.json' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    message('Backup saved as ' + a.getAttribute('download') + '.', 'good');
  });

  $('importFile').addEventListener('change', function () {
    var file = this.files && this.files[0];
    this.value = '';
    if (!file) return;
    file.text().then(function (text) {
      var next;
      try { next = S.parse(text); } catch (err) { message(err.message, 'bad'); return; }
      if (!window.confirm('Replace everything on this device with the ' + next.sessions.length + ' session(s) in this backup?')) return;
      data = next;
      persist();
      view.day = S.openDay(data, DAYS, new Date());
      render();
      message('Imported ' + next.sessions.length + ' session(s).', 'good');
    });
  });

  /* ---------- offline ---------- */

  var secure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* offline is a bonus */ });
    });
  }

  render();
})();
