/*!
 * app.js — screens, camera loop and playback for the Rubik's Solver.
 *
 * Three screens: scan the six faces, check what was read, then step through
 * the turns. The scan screen never blocks you — every sticker stays editable
 * on the review screen, because a camera will occasionally misread one and
 * arguing with it is worse than tapping it.
 */
(function () {
  'use strict';

  var Cube = RS.Cube, Solver = RS.Solver, Colour = RS.Colour;
  var Cube3D = RS.Cube3D, ScannerMod = RS.Scanner;

  function $(id) { return document.getElementById(id); }

  var SCAN_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_LABEL = { U: 'Top', R: 'Right', F: 'Front', D: 'Bottom', L: 'Left', B: 'Back' };
  var FACE_WORD = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };

  // Naming the face that points at the camera *and* the one that points up
  // pins the cube's orientation exactly, without assuming any colour scheme.
  var SCAN_HINT = {
    U: 'Tilt the cube so the top face looks at the camera, with the front face pointing down at the floor.',
    R: 'Turn the cube so the right face looks at the camera, keeping the top face up.',
    F: 'Hold the cube normally: front face at the camera, top face up.',
    D: 'Tilt the cube so the bottom face looks at the camera, with the front face pointing up at the ceiling.',
    L: 'Turn the cube so the left face looks at the camera, keeping the top face up.',
    B: 'Turn the cube right round so the back face looks at the camera, keeping the top face up.'
  };

  // Where each facelet sits in the flattened net, as [row, column].
  var NET_ORIGIN = { U: [0, 3], R: [3, 6], F: [3, 3], D: [6, 3], L: [3, 0], B: [3, 9] };

  var STEADY_FRAMES = 7;        // ~0.8s of an unchanged reading
  var SAMPLE_INTERVAL = 110;    // ms between live reads
  var CAPTURE_COOLDOWN = 1100;  // ms before auto-capture can fire again

  var app = {
    step: 'scan',
    scanIndex: 0,
    captured: {},              // face letter -> nine {r,g,b} samples
    facelets: null,            // 54 face letters
    names: Colour.defaultNames(),
    suspect: [],
    paintWith: 'U',
    solution: null,
    states: null,              // cube state after each move
    playAt: 0,
    playing: false,
    playTimer: null,
    mirrored: false,
    facing: 'environment',
    lastCapture: 0,
    steady: 0,
    steadyKey: '',
    liveNames: null
  };

  var scanner = new ScannerMod.Scanner();
  var gridCells = [];
  var guideCube = null, reviewCube = null, solveCube = null;

  // ------------------------------------------------------------------ chrome

  function setStep(step) {
    app.step = step;
    ['scan', 'review', 'solve'].forEach(function (name) {
      $('panel-' + name).hidden = name !== step;
    });
    var order = ['scan', 'review', 'solve'];
    document.querySelectorAll('.steps__item').forEach(function (item) {
      var target = item.dataset.goto;
      item.classList.toggle('is-current', target === step);
      item.classList.toggle('is-done', order.indexOf(target) < order.indexOf(step));
    });
    if (step !== 'scan') stopCamera();
    if (step !== 'solve') pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function enableStep(step, on) {
    var btn = document.querySelector('.steps__item[data-goto="' + step + '"]');
    if (btn) btn.disabled = !on;
  }

  function busy(text) {
    $('busyText').textContent = text;
    $('busy').hidden = false;
  }
  function idle() { $('busy').hidden = true; }

  function notice(host, kind, text, hint) {
    if (!text) { host.innerHTML = ''; return; }
    var icon = kind === 'bad' ? '!' : kind === 'warn' ? '!' : '✓';
    host.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'notice notice--' + kind;
    var mark = document.createElement('span');
    mark.className = 'notice__icon';
    mark.textContent = icon;
    var body = document.createElement('div');
    var strong = document.createElement('strong');
    strong.textContent = text;
    body.appendChild(strong);
    if (hint) {
      body.appendChild(document.createElement('br'));
      var span = document.createElement('span');
      span.className = 'muted';
      span.textContent = hint;
      body.appendChild(span);
    }
    box.appendChild(mark);
    box.appendChild(body);
    host.appendChild(box);
  }

  // ------------------------------------------------------------------- scan

  function buildGrid() {
    var grid = $('grid');
    grid.innerHTML = '';
    gridCells = [];
    for (var i = 0; i < 9; i++) {
      var cell = document.createElement('div');
      cell.className = 'stage__cell';
      cell.dataset.colour = 'blank';
      grid.appendChild(cell);
      gridCells.push(cell);
    }
  }

  function buildFaceChips() {
    var host = $('faceChips');
    host.innerHTML = '';
    SCAN_ORDER.forEach(function (face, index) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'face-chip';
      chip.dataset.face = face;
      var mini = document.createElement('span');
      mini.className = 'face-chip__mini';
      for (var i = 0; i < 9; i++) mini.appendChild(document.createElement('i'));
      var name = document.createElement('span');
      name.className = 'face-chip__name';
      name.textContent = FACE_LABEL[face];
      chip.appendChild(mini);
      chip.appendChild(name);
      chip.title = 'Scan the ' + FACE_WORD[face] + ' face again';
      chip.addEventListener('click', function () {
        app.scanIndex = index;
        refreshScan();
      });
      host.appendChild(chip);
    });
  }

  function refreshScan() {
    var face = SCAN_ORDER[app.scanIndex];
    var done = SCAN_ORDER.filter(function (f) { return app.captured[f]; }).length;

    $('guideStep').textContent = 'Face ' + (app.scanIndex + 1) + ' of 6';
    $('guideTitle').textContent = FACE_LABEL[face] + ' face';
    $('guideHint').textContent = SCAN_HINT[face];

    document.querySelectorAll('.face-chip').forEach(function (chip) {
      var f = chip.dataset.face;
      chip.classList.toggle('is-current', f === face);
      chip.classList.toggle('is-done', !!app.captured[f]);
      var cells = chip.querySelectorAll('.face-chip__mini i');
      var samples = app.captured[f];
      for (var i = 0; i < 9; i++) {
        var guess = samples ? Colour.guessName(samples[i].r, samples[i].g, samples[i].b) : null;
        cells[i].dataset.colour = guess || 'blank';
      }
    });

    $('btnRedoFace').disabled = done === 0;
    $('btnCapture').disabled = !scanner.isRunning();
    $('btnCapture').textContent = app.captured[face]
      ? 'Replace ' + FACE_WORD[face] + ' face'
      : 'Capture ' + FACE_WORD[face] + ' face';

    // The guide cube shows what has been read so far and turns to present
    // whichever face is next.
    var preview = [];
    SCAN_ORDER.forEach(function (f) {
      var samples = app.captured[f];
      for (var i = 0; i < 9; i++) {
        preview.push(samples ? (Colour.guessName(samples[i].r, samples[i].g, samples[i].b) || 'blank') : 'blank');
      }
    });
    guideCube.setColours(preview);
    guideCube.faceTowardsViewer(face);
  }

  function startCamera() {
    busy('Starting camera…');
    scanner.start($('video'), app.facing).then(function (ok) {
      idle();
      if (!ok) throw new Error('no-frame');
      $('camIdle').hidden = true;
      $('steady').hidden = !$('chkAuto').checked;
      notice($('scanNotice'), 'good', 'Camera ready.',
        'Fill the nine squares with one face of the cube.');
      setTimeout(function () { notice($('scanNotice'), 'good', null); }, 2600);
      scanner.hasMultipleCameras().then(function (many) { $('btnSwitchCam').hidden = !many; });
      refreshScan();
      loop();
    }).catch(function (err) {
      idle();
      var message = 'Could not open the camera.';
      var hint = 'Check the permission prompt, or type the colours in by hand.';
      if (err && err.message === 'no-camera-api') {
        message = 'This browser has no camera access here.';
        hint = 'Camera access needs a secure page (https or localhost). You can still type the colours in by hand.';
      }
      notice($('scanNotice'), 'warn', message, hint);
      $('camIdleText').textContent = hint;
    });
  }

  function stopCamera() {
    scanner.stop();
    $('camIdle').hidden = false;
    $('steady').hidden = true;
    $('btnCapture').disabled = true;
  }

  var lastSampleAt = 0;

  function loop(now) {
    if (!scanner.isRunning() || app.step !== 'scan') return;
    requestAnimationFrame(loop);
    now = now || 0;
    if (now - lastSampleAt < SAMPLE_INTERVAL) return;
    lastSampleAt = now;

    var samples = scanner.readCells($('video'), gridCells, app.mirrored);
    if (!samples) return;

    var guesses = samples.map(function (s) { return Colour.guessName(s.r, s.g, s.b); });
    app.liveNames = guesses;
    for (var i = 0; i < 9; i++) gridCells[i].dataset.colour = guesses[i] || 'blank';

    var quality = Colour.frameQuality(samples);
    if (quality.message) {
      notice($('scanNotice'), 'warn', quality.message, 'Colours read in poor light are often wrong.');
    } else if ($('scanNotice').dataset.sticky !== '1') {
      notice($('scanNotice'), 'warn', null);
    }

    // Auto-capture waits for the reading to settle, which also filters out
    // frames caught mid-move.
    var ready = guesses.every(function (g) { return !!g; }) && !quality.tooDark;
    var key = guesses.join(',');
    if (!ready) { app.steady = 0; app.steadyKey = ''; }
    else if (key === app.steadyKey) app.steady++;
    else { app.steady = 1; app.steadyKey = key; }

    var progress = Math.min(1, app.steady / STEADY_FRAMES);
    $('steadyBar').style.setProperty('--progress', (progress * 100) + '%');

    if ($('chkAuto').checked && app.steady >= STEADY_FRAMES &&
        Date.now() - app.lastCapture > CAPTURE_COOLDOWN) {
      capture(samples);
    }
  }

  function capture(samples) {
    if (!samples) {
      samples = scanner.readCells($('video'), gridCells, app.mirrored);
      if (!samples) return;
    }
    var face = SCAN_ORDER[app.scanIndex];
    app.captured[face] = samples;
    app.lastCapture = Date.now();
    app.steady = 0;
    app.steadyKey = '';

    $('flash').classList.remove('is-firing');
    void $('flash').offsetWidth;
    $('flash').classList.add('is-firing');

    var next = SCAN_ORDER.findIndex(function (f) { return !app.captured[f]; });
    if (next >= 0) {
      app.scanIndex = next;
      refreshScan();
    } else {
      refreshScan();
      finishScan();
    }
  }

  function finishScan() {
    var samples = [];
    SCAN_ORDER.forEach(function (face) {
      app.captured[face].forEach(function (s) { samples.push(s); });
    });
    var read = Colour.assign(samples);
    app.facelets = read.faces;
    app.names = read.names;
    app.suspect = read.confidence.map(function (c) { return c < 0.34; });
    stopCamera();
    openReview();
  }

  // ----------------------------------------------------------------- review

  function buildNet() {
    var net = $('net');
    net.innerHTML = '';
    for (var i = 0; i < 54; i++) {
      var face = Cube.FACES[(i / 9) | 0];
      var origin = NET_ORIGIN[face];
      var local = i % 9;
      var cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'net__cell';
      cell.dataset.index = String(i);
      cell.style.gridRow = String(origin[0] + ((local / 3) | 0) + 1);
      cell.style.gridColumn = String(origin[1] + (local % 3) + 1);
      if (local === 4) {
        cell.classList.add('is-centre');
        cell.disabled = true;
        cell.title = FACE_LABEL[face] + ' centre — fixed';
      } else {
        cell.title = FACE_LABEL[face] + ' face';
      }
      net.appendChild(cell);
    }

    net.addEventListener('click', function (event) {
      var cell = event.target.closest('.net__cell');
      if (!cell || cell.disabled) return;
      var index = Number(cell.dataset.index);
      app.facelets[index] = app.paintWith;
      app.suspect[index] = false;
      paintReview();
    });
  }

  function buildPalette() {
    var host = $('palette');
    host.innerHTML = '';
    Cube.FACES.forEach(function (face) {
      var swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'palette__swatch';
      swatch.dataset.face = face;
      var chip = document.createElement('span');
      chip.className = 'palette__chip';
      var count = document.createElement('span');
      count.className = 'palette__count';
      swatch.appendChild(chip);
      swatch.appendChild(count);
      swatch.addEventListener('click', function () {
        app.paintWith = face;
        paintReview();
      });
      host.appendChild(swatch);
    });
  }

  function paintReview() {
    var counts = {};
    app.facelets.forEach(function (f) { counts[f] = (counts[f] || 0) + 1; });

    document.querySelectorAll('.net__cell').forEach(function (cell) {
      var index = Number(cell.dataset.index);
      var letter = app.facelets[index];
      cell.dataset.colour = app.names[letter];
      cell.classList.toggle('is-suspect', !!app.suspect[index]);
    });

    document.querySelectorAll('.palette__swatch').forEach(function (swatch) {
      var face = swatch.dataset.face;
      var n = counts[face] || 0;
      swatch.dataset.colour = app.names[face];
      swatch.querySelector('.palette__count').textContent = n + '/9';
      swatch.classList.toggle('is-active', face === app.paintWith);
      swatch.classList.toggle('is-over', n > 9);
      swatch.classList.toggle('is-exact', n === 9);
      swatch.title = Colour.PALETTE[app.names[face]].label + ' — ' + FACE_LABEL[face] + ' face';
    });

    var flagged = app.suspect.filter(Boolean).length;
    $('netLegend').hidden = flagged === 0;
    $('netCount').textContent = flagged
      ? flagged + ' sticker' + (flagged === 1 ? '' : 's') + ' to confirm'
      : 'all stickers read clearly';

    reviewCube.setState(app.facelets, app.names);

    var check = Cube.validate(app.facelets);
    if (check.ok) {
      notice($('reviewStatus'), 'good', 'This is a valid cube.', 'Ready to solve.');
      $('btnSolve').disabled = false;
    } else {
      notice($('reviewStatus'), 'bad', check.error, check.hint);
      $('btnSolve').disabled = true;
    }
  }

  function openReview() {
    enableStep('review', true);
    setStep('review');
    paintReview();
  }

  function loadState(stateString) {
    app.facelets = Cube.toArray(stateString);
    app.names = Colour.defaultNames();
    app.suspect = new Array(54).fill(false);
    app.captured = {};
    app.scanIndex = 0;
    openReview();
  }

  // ------------------------------------------------------------------ solve

  function runSolve() {
    var first = !Solver.tablesReady();
    busy(first ? 'Building solver tables…' : 'Solving…');
    // Let the veil paint before the tables go up.
    setTimeout(function () {
      try {
        app.solution = Solver.solve(app.facelets);
      } catch (err) {
        idle();
        notice($('reviewStatus'), 'bad', 'Could not solve this cube.', err.message);
        return;
      }
      app.states = [Cube.toArray(app.facelets)];
      app.solution.moves.forEach(function (m) {
        app.states.push(Cube.applyMove(app.states[app.states.length - 1], m));
      });
      app.playAt = 0;
      idle();
      enableStep('solve', true);
      setStep('solve');
      buildStageList();
      renderPlayback();

    }, 40);
  }

  function stageOfMove(index) {
    var seen = 0;
    for (var i = 0; i < app.solution.stages.length; i++) {
      var stage = app.solution.stages[i];
      if (index < seen + stage.moves.length) return { stage: stage, at: i, offset: seen };
      seen += stage.moves.length;
    }
    var last = app.solution.stages.length - 1;
    return { stage: app.solution.stages[last], at: last, offset: seen - app.solution.stages[last].moves.length };
  }

  function buildStageList() {
    var host = $('stages');
    host.innerHTML = '';
    var running = 0;
    app.solution.stages.forEach(function (stage, stageIndex) {
      var block = document.createElement('div');
      block.className = 'stage-block';
      block.dataset.stage = String(stageIndex);

      var title = document.createElement('div');
      title.className = 'stage-block__title';
      title.textContent = stage.name;
      var count = document.createElement('span');
      count.textContent = stage.moves.length + ' moves';
      title.appendChild(count);

      var list = document.createElement('div');
      list.className = 'move-list';
      stage.moves.forEach(function (move, i) {
        var index = running + i;
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'move';
        btn.dataset.move = String(index);
        btn.textContent = move;
        btn.addEventListener('click', function () { goTo(index + 1); });
        list.appendChild(btn);
      });
      running += stage.moves.length;

      block.appendChild(title);
      block.appendChild(list);
      host.appendChild(block);
    });

    var up = Colour.PALETTE[app.names.U].label;
    var front = Colour.PALETTE[app.names.F].label;
    $('holdText').textContent = 'Keep the ' + up.toLowerCase() + ' centre facing up and the ' +
      front.toLowerCase() + ' centre towards you for the whole solution. Every turn is named ' +
      'from that position.';
  }

  function describeMove(move) {
    if (!move) return { glyph: '✓', title: 'Solved', detail: 'That is the whole cube done.' };
    var direction = move.length === 1 ? 'a quarter turn clockwise'
      : move[1] === '2' ? 'a half turn'
      : 'a quarter turn anticlockwise';
    return {
      glyph: move,
      title: FACE_LABEL[move[0]] + ' face',
      detail: 'Turn it ' + direction + ', as you look straight at that face.'
    };
  }

  function renderPlayback() {
    var total = app.solution.moves.length;
    var at = app.playAt;
    var nextMove = at < total ? app.solution.moves[at] : null;

    solveCube.setState(app.states[at], app.names);
    solveCube.highlight(nextMove);

    var described = describeMove(nextMove);
    $('moveGlyph').textContent = described.glyph;
    $('moveGlyph').classList.toggle('is-empty', !nextMove);
    $('moveTitle').textContent = described.title;
    $('moveDetail').textContent = described.detail;
    $('solveProgress').textContent = at + ' / ' + total;

    var where = stageOfMove(Math.min(at, Math.max(0, total - 1)));
    $('solveStageTag').textContent = 'Stage ' + (where.at + 1) + ' of ' + app.solution.stages.length;
    $('solveStageName').textContent = at >= total ? 'Finished' : where.stage.name;
    $('solveStageNote').textContent = at >= total
      ? 'Every face is one colour. Nicely done.'
      : where.stage.note;

    document.querySelectorAll('.move').forEach(function (btn) {
      var index = Number(btn.dataset.move);
      btn.classList.toggle('is-done', index < at);
      btn.classList.toggle('is-current', index === at);
    });
    document.querySelectorAll('.stage-block').forEach(function (block) {
      block.classList.toggle('is-current', Number(block.dataset.stage) === where.at);
    });

    var current = document.querySelector('.move.is-current');
    if (current) current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });

    $('btnPrev').disabled = at === 0;
    $('btnFirst').disabled = at === 0;
    $('btnNext').disabled = at >= total;
    $('btnLast').disabled = at >= total;
    $('btnPlay').disabled = at >= total && !app.playing;
    $('btnPlay').textContent = app.playing ? '❚❚ Pause' : '▶ Play';
  }

  function goTo(index) {
    app.playAt = Math.max(0, Math.min(app.solution.moves.length, index));
    renderPlayback();
    if (app.playAt >= app.solution.moves.length) pause();
  }

  function play() {
    if (app.playing || app.playAt >= app.solution.moves.length) return;
    app.playing = true;
    app.playTimer = setInterval(function () { goTo(app.playAt + 1); }, 800);
    renderPlayback();
  }
  function pause() {
    app.playing = false;
    if (app.playTimer) clearInterval(app.playTimer);
    app.playTimer = null;
    if (app.solution) renderPlayback();
  }

  // ------------------------------------------------------------------- wire

  function init() {
    buildGrid();
    buildFaceChips();
    buildNet();
    buildPalette();

    guideCube = Cube3D.create($('guideCube'), { size: 74, spin: false, tiltX: -20, tiltY: -30 });
    reviewCube = Cube3D.create($('reviewCube'), { size: 150 });
    solveCube = Cube3D.create($('solveCube'), { size: 200, spin: false });

    $('tableNote').textContent = 'Everything runs in your browser — the camera feed never leaves ' +
      'this device. Solutions come from searching 190,080 bottom-cross states and all 62,208 ' +
      'last-layer states.';

    app.facelets = Cube.toArray(Cube.SOLVED);
    app.suspect = new Array(54).fill(false);
    reviewCube.setState(app.facelets, app.names);
    solveCube.setState(app.facelets, app.names);
    refreshScan();

    if (!ScannerMod.supported()) {
      $('camIdleText').textContent =
        'Camera access needs a secure page (https or localhost). You can type the colours in by hand instead.';
      $('btnStartCam').disabled = true;
    }

    $('btnStartCam').addEventListener('click', startCamera);
    $('btnCapture').addEventListener('click', function () { capture(null); });

    $('btnMirror').addEventListener('click', function () {
      app.mirrored = !app.mirrored;
      $('stage').classList.toggle('is-mirrored', app.mirrored);
      $('btnMirror').classList.toggle('is-on', app.mirrored);
    });

    $('btnSwitchCam').addEventListener('click', function () {
      app.facing = app.facing === 'environment' ? 'user' : 'environment';
      if (scanner.isRunning()) startCamera();
    });

    $('chkAuto').addEventListener('change', function () {
      $('steady').hidden = !($('chkAuto').checked && scanner.isRunning());
    });

    $('btnRedoFace').addEventListener('click', function () {
      var done = SCAN_ORDER.filter(function (f) { return app.captured[f]; });
      if (!done.length) return;
      var last = done[done.length - 1];
      delete app.captured[last];
      app.scanIndex = SCAN_ORDER.indexOf(last);
      app.steady = 0;
      refreshScan();
    });

    $('btnManual').addEventListener('click', function () { loadState(Cube.SOLVED); });
    $('btnDemo').addEventListener('click', function () { loadState(Cube.randomState()); });

    $('btnSolve').addEventListener('click', runSolve);
    $('btnRescan').addEventListener('click', function () {
      app.captured = {};
      app.scanIndex = 0;
      refreshScan();
      setStep('scan');
    });

    $('btnFirst').addEventListener('click', function () { pause(); goTo(0); });
    $('btnPrev').addEventListener('click', function () { pause(); goTo(app.playAt - 1); });
    $('btnNext').addEventListener('click', function () { pause(); goTo(app.playAt + 1); });
    $('btnLast').addEventListener('click', function () { pause(); goTo(app.solution.moves.length); });
    $('btnPlay').addEventListener('click', function () { app.playing ? pause() : play(); });

    $('btnCopy').addEventListener('click', function () {
      var text = app.solution.moves.join(' ');
      var done = function () {
        $('btnCopy').textContent = 'Copied';
        setTimeout(function () { $('btnCopy').textContent = 'Copy'; }, 1400);
      };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done);
      else done();
    });

    $('btnBackReview').addEventListener('click', function () { setStep('review'); });
    $('btnNewScan').addEventListener('click', function () {
      app.captured = {};
      app.scanIndex = 0;
      app.solution = null;
      enableStep('solve', false);
      refreshScan();
      setStep('scan');
    });

    document.querySelectorAll('.steps__item').forEach(function (item) {
      item.addEventListener('click', function () {
        if (!item.disabled) setStep(item.dataset.goto);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (app.step !== 'solve' || !app.solution) return;
      if (event.key === 'ArrowRight') { pause(); goTo(app.playAt + 1); }
      else if (event.key === 'ArrowLeft') { pause(); goTo(app.playAt - 1); }
      else if (event.key === ' ') { event.preventDefault(); app.playing ? pause() : play(); }
    });

    // Free the camera when the page is hidden, and pick it up again after.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopCamera(); pause(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
