/*!
 * app.js — screens, photo alignment, colour editing and playback.
 *
 * Three screens: photograph the six faces, check what was read, follow the
 * turns. Photographs rather than a live feed, because aiming a moving camera
 * one-handed at a cube you are also holding is miserable and whatever it
 * grabs, it grabs. A still photo can be lined up at leisure, and the colours
 * it reads are shown while you drag. The live camera is still here for anyone
 * who prefers it.
 *
 * Nothing about the cube's colours is assumed: they are six hex values the
 * user can edit, used both to draw the cube and to read the photos.
 */
(function () {
  'use strict';

  var Cube = RS.Cube, Solver = RS.Solver, Colour = RS.Colour;
  var Recognise = RS.Recognise, Photo = RS.Photo;
  var Cube3D = RS.Cube3D, ScannerMod = RS.Scanner;

  function $(id) { return document.getElementById(id); }

  var SCAN_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_LABEL = { U: 'Top', R: 'Right', F: 'Front', D: 'Bottom', L: 'Left', B: 'Back' };
  var FACE_WORD = { U: 'top', R: 'right', F: 'front', D: 'bottom', L: 'left', B: 'back' };

  // Naming the face pointing at the camera *and* the one pointing up pins the
  // cube's orientation exactly, without assuming any colour scheme.
  var SHOT_HINT = {
    U: 'Photograph the top face straight on, with the front face pointing down at the floor.',
    R: 'Photograph the right face straight on, keeping the top face up.',
    F: 'Photograph the front face straight on, keeping the top face up.',
    D: 'Photograph the bottom face straight on, with the front face pointing up at the ceiling.',
    L: 'Photograph the left face straight on, keeping the top face up.',
    B: 'Photograph the back face straight on, keeping the top face up.'
  };

  var NET_ORIGIN = { U: [0, 3], R: [3, 6], F: [3, 3], D: [6, 3], L: [3, 0], B: [3, 9] };

  var STEADY_FRAMES = 7;
  var SAMPLE_INTERVAL = 110;
  var CAPTURE_COOLDOWN = 1100;
  var STORE_KEY = 'rubiks-solver.palette';

  var app = {
    step: 'scan',
    mode: 'photos',
    palette: Colour.defaultPalette(),
    faceIndex: 0,
    shots: {},              // face letter -> { sheet, corners, samples, url }
    captured: {},           // face letter -> nine samples, from the live camera
    facelets: null,
    suspect: [],
    paintWith: 'U',
    view: '3d',
    reading: null,          // what the last read reported
    solution: null,
    states: null,
    playAt: 0,
    playing: false,
    playTimer: null,
    turnMs: 320,
    restMs: 260,
    mirrored: false,
    facing: 'environment',
    lastCapture: 0,
    steady: 0,
    steadyKey: ''
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
    if (step !== 'scan' || app.mode !== 'camera') stopCamera();
    if (step !== 'solve') pause();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function enableStep(step, on) {
    var btn = document.querySelector('.steps__item[data-goto="' + step + '"]');
    if (btn) btn.disabled = !on;
  }

  function busy(text) { $('busyText').textContent = text; $('busy').hidden = false; }
  function idle() { $('busy').hidden = true; }

  function notice(host, kind, text, hint) {
    if (!text) { host.innerHTML = ''; return; }
    host.innerHTML = '';
    var box = document.createElement('div');
    box.className = 'notice notice--' + kind;
    var mark = document.createElement('span');
    mark.className = 'notice__icon';
    mark.textContent = kind === 'good' ? '✓' : '!';
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

  // ----------------------------------------------------------------- palette

  /**
   * Push the palette into CSS variables. Everything that draws a sticker reads
   * these, so one write recolours the net, the 3D cube, the face slots, the
   * paint swatches and the live camera overlay together.
   */
  function applyPalette() {
    SCAN_ORDER.forEach(function (face) {
      var hex = Colour.normaliseHex(app.palette[face]) || '#888888';
      document.documentElement.style.setProperty('--face-' + face, hex);
    });
  }

  function loadPalette() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
      if (!saved) return;
      var clean = {};
      var complete = SCAN_ORDER.every(function (face) {
        var hex = Colour.normaliseHex(saved[face]);
        if (hex) clean[face] = hex;
        return !!hex;
      });
      if (complete) app.palette = clean;
    } catch (err) { /* a cube's colours are not worth failing to start over */ }
  }

  function savePalette() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(app.palette)); } catch (err) { /* private mode */ }
  }

  function matchingPreset() {
    return Object.keys(Colour.PRESETS).filter(function (key) {
      return SCAN_ORDER.every(function (face) {
        return Colour.normaliseHex(Colour.PRESETS[key].colours[face]) ===
               Colour.normaliseHex(app.palette[face]);
      });
    })[0] || null;
  }

  function buildSheet() {
    var presets = $('presets');
    presets.innerHTML = '';
    Object.keys(Colour.PRESETS).forEach(function (key) {
      var preset = Colour.PRESETS[key];
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'preset';
      btn.dataset.preset = key;
      btn.title = preset.note;
      var dots = document.createElement('span');
      dots.className = 'preset__dots';
      SCAN_ORDER.forEach(function (face) {
        var dot = document.createElement('i');
        dot.style.background = preset.colours[face];
        dots.appendChild(dot);
      });
      btn.appendChild(dots);
      btn.appendChild(document.createTextNode(preset.label));
      btn.addEventListener('click', function () {
        SCAN_ORDER.forEach(function (face) { app.palette[face] = preset.colours[face]; });
        onPaletteChanged();
      });
      presets.appendChild(btn);
    });

    var rows = $('paletteRows');
    rows.innerHTML = '';
    SCAN_ORDER.forEach(function (face) {
      var row = document.createElement('div');
      row.className = 'prow';

      var name = document.createElement('span');
      name.className = 'prow__name';
      name.textContent = FACE_LABEL[face];

      var swatch = document.createElement('input');
      swatch.type = 'color';
      swatch.className = 'prow__swatch';
      swatch.id = 'swatch-' + face;
      swatch.setAttribute('aria-label', FACE_LABEL[face] + ' colour');

      var hex = document.createElement('input');
      hex.type = 'text';
      hex.className = 'prow__hex';
      hex.id = 'hex-' + face;
      hex.spellcheck = false;
      hex.autocomplete = 'off';
      hex.setAttribute('aria-label', FACE_LABEL[face] + ' colour as hex');

      swatch.addEventListener('input', function () {
        app.palette[face] = swatch.value;
        onPaletteChanged();
      });
      hex.addEventListener('input', function () {
        var value = Colour.normaliseHex(hex.value);
        hex.classList.toggle('is-bad', !value && hex.value.trim() !== '');
        if (!value) return;
        app.palette[face] = value;
        onPaletteChanged({ keepTyping: face });
      });

      row.appendChild(name);
      row.appendChild(swatch);
      row.appendChild(hex);
      rows.appendChild(row);
    });
  }

  function refreshSheet(options) {
    var preset = matchingPreset();
    document.querySelectorAll('.preset').forEach(function (btn) {
      btn.classList.toggle('is-on', btn.dataset.preset === preset);
    });
    SCAN_ORDER.forEach(function (face) {
      var hex = Colour.normaliseHex(app.palette[face]) || '#888888';
      $('swatch-' + face).value = hex;
      // Do not fight someone mid-keystroke.
      if (!options || options.keepTyping !== face) $('hex-' + face).value = hex;
    });

    var check = Colour.checkPalette(app.palette);
    if (!check.ok) {
      notice($('paletteStatus'), 'bad', check.error, check.hint);
    } else if (check.closest < 24) {
      notice($('paletteStatus'), 'warn',
        'These colours sit close together.',
        'Readable, but light them evenly and expect to correct the odd sticker.');
    } else {
      notice($('paletteStatus'), 'good', 'Six clearly different colours.',
        'Photos of this cube should read cleanly.');
    }

    $('btnPaletteFromPhotos').disabled = countShots() === 0;
  }

  function onPaletteChanged(options) {
    applyPalette();
    savePalette();
    refreshSheet(options);
    // Re-read whatever is on screen with the new reference colours.
    if (app.step === 'scan') { refreshShot(); refreshSlots(); }
    if (app.step === 'review') paintReview();
  }

  /** Take the palette from the middle sticker of each photographed face. */
  function paletteFromPhotos() {
    var found = 0;
    SCAN_ORDER.forEach(function (face) {
      var shot = app.shots[face] || (app.captured[face] ? { samples: app.captured[face] } : null);
      if (!shot || !shot.samples) return;
      var centre = shot.samples[4];
      var hex = '#' + [centre.r, centre.g, centre.b].map(function (v) {
        return ('0' + Math.max(0, Math.min(255, v)).toString(16)).slice(-2);
      }).join('');
      app.palette[face] = hex;
      found++;
    });
    onPaletteChanged();
    if (found < 6) {
      notice($('paletteStatus'), 'warn',
        'Only ' + found + ' of 6 faces have a photo.',
        'The rest keep their current colour.');
    }
  }

  function openSheet() { $('paletteSheet').hidden = false; refreshSheet(); }
  function closeSheet() { $('paletteSheet').hidden = true; }

  // ------------------------------------------------------------------ photos

  function countShots() {
    return SCAN_ORDER.filter(function (face) {
      return app.shots[face] || app.captured[face];
    }).length;
  }

  function samplesFor(face) {
    if (app.shots[face]) return app.shots[face].samples;
    return app.captured[face] || null;
  }

  function currentFace() { return SCAN_ORDER[app.faceIndex]; }

  function buildSlots() {
    var host = $('faceSlots');
    host.innerHTML = '';
    SCAN_ORDER.forEach(function (face, index) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'face-chip';
      chip.dataset.face = face;

      var mini = document.createElement('span');
      mini.className = 'face-chip__mini';
      for (var i = 0; i < 9; i++) mini.appendChild(document.createElement('i'));

      var tick = document.createElement('span');
      tick.className = 'face-chip__tick';
      tick.textContent = '✓';
      tick.hidden = true;

      var name = document.createElement('span');
      name.className = 'face-chip__name';
      name.textContent = FACE_LABEL[face];

      chip.appendChild(mini);
      chip.appendChild(tick);
      chip.appendChild(name);
      chip.title = FACE_LABEL[face] + ' face';
      chip.addEventListener('click', function () {
        app.faceIndex = index;
        refreshScan();
      });
      host.appendChild(chip);
    });
  }

  function refreshSlots() {
    var face = currentFace();
    document.querySelectorAll('.face-chip').forEach(function (chip) {
      var f = chip.dataset.face;
      var samples = samplesFor(f);
      chip.classList.toggle('is-current', f === face);
      chip.classList.toggle('is-done', !!samples);
      chip.querySelector('.face-chip__tick').hidden = !samples;
      var cells = chip.querySelectorAll('.face-chip__mini i');
      for (var i = 0; i < 9; i++) {
        cells[i].dataset.face = samples
          ? (Colour.nearestFace(samples[i], app.palette) || '')
          : '';
      }
    });
  }

  /** The guide cube shows what has been read so far and presents the next face. */
  function refreshGuide() {
    var face = currentFace();
    $('guideStep').textContent = 'Face ' + (app.faceIndex + 1) + ' of 6';
    $('guideTitle').textContent = FACE_LABEL[face] + ' face';
    $('guideHint').textContent = app.mode === 'camera'
      ? SHOT_HINT[face].replace('Photograph', 'Show').replace(' straight on', ' to the camera')
      : SHOT_HINT[face];

    var preview = [];
    SCAN_ORDER.forEach(function (f) {
      var samples = samplesFor(f);
      for (var i = 0; i < 9; i++) {
        preview.push(samples ? (Colour.nearestFace(samples[i], app.palette) || '') : '');
      }
    });
    guideCube.setState(preview);
    guideCube.faceTowardsViewer(face);
  }

  // --- the grid over a photo -------------------------------------------------

  function refreshShot() {
    var face = currentFace();
    var shot = app.shots[face];
    var hasPhoto = !!shot;

    $('shot').hidden = !hasPhoto || app.mode !== 'photos';
    $('stageIdle').hidden = hasPhoto || app.mode === 'camera';
    $('btnClearFace').disabled = !hasPhoto;
    $('btnResetGrid').disabled = !hasPhoto;
    if (!hasPhoto) { notice($('scanNotice'), 'warn', null); return; }

    $('shotImage').src = shot.url;
    fitShot(shot);

    shot.samples = shot.sheet.read(shot.corners);
    drawGrid(shot);

    var advice = Photo.gridAdvice(shot.samples);
    if (advice.message) {
      notice($('scanNotice'), 'warn', advice.message,
        'Drag the corners so the grid sits on the nine stickers.');
    } else {
      notice($('scanNotice'), 'warn', null);
    }
  }

  /** Scale the photo to fit the stage, keeping its shape. */
  function fitShot(shot) {
    var stage = $('shot').getBoundingClientRect();
    var available = { w: stage.width - 20, h: stage.height - 20 };
    if (available.w <= 0 || available.h <= 0) return;
    var scale = Math.min(available.w / shot.sheet.width, available.h / shot.sheet.height);
    var frame = $('shotFrame');
    frame.style.width = Math.round(shot.sheet.width * scale) + 'px';
    frame.style.height = Math.round(shot.sheet.height * scale) + 'px';
  }

  function drawGrid(shot) {
    var corners = shot.corners;

    document.querySelectorAll('.handle').forEach(function (handle) {
      var point = corners[Number(handle.dataset.corner)];
      handle.style.left = (point.x * 100) + '%';
      handle.style.top = (point.y * 100) + '%';
    });

    // Outline plus the two dividing lines each way, drawn from the same
    // interpolation the sampler uses, so what is drawn is what is read.
    var parts = [];
    var quad = corners.map(function (p) {
      return (p.x * 100).toFixed(2) + ',' + (p.y * 100).toFixed(2);
    }).join(' ');
    parts.push('<polygon class="quad" points="' + quad + '"/>');
    [1 / 3, 2 / 3].forEach(function (t) {
      var a = Photo.onQuad(corners, t, 0), b = Photo.onQuad(corners, t, 1);
      var c = Photo.onQuad(corners, 0, t), d = Photo.onQuad(corners, 1, t);
      parts.push('<line class="inner" x1="' + (a.x * 100) + '" y1="' + (a.y * 100) +
                 '" x2="' + (b.x * 100) + '" y2="' + (b.y * 100) + '"/>');
      parts.push('<line class="inner" x1="' + (c.x * 100) + '" y1="' + (c.y * 100) +
                 '" x2="' + (d.x * 100) + '" y2="' + (d.y * 100) + '"/>');
    });
    $('shotLines').innerHTML = parts.join('');

    var reads = $('shotReads');
    reads.innerHTML = '';
    for (var cell = 0; cell < 9; cell++) {
      var u = ((cell % 3) + 0.5) / 3, v = (((cell / 3) | 0) + 0.5) / 3;
      var at = Photo.onQuad(corners, u, v);
      var dot = document.createElement('i');
      dot.className = 'shot__read';
      dot.style.left = (at.x * 100) + '%';
      dot.style.top = (at.y * 100) + '%';
      dot.dataset.face = Colour.nearestFace(shot.samples[cell], app.palette) || '';
      reads.appendChild(dot);
    }
  }

  function wireHandles() {
    var frame = $('shotFrame');
    var active = null, pending = false;

    function positionFrom(event) {
      var box = frame.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
        y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))
      };
    }

    document.querySelectorAll('.handle').forEach(function (handle) {
      handle.addEventListener('pointerdown', function (event) {
        active = Number(handle.dataset.corner);
        handle.setPointerCapture(event.pointerId);
        handle.classList.add('is-dragging');
        event.preventDefault();
      });
      handle.addEventListener('pointermove', function (event) {
        if (active === null) return;
        var shot = app.shots[currentFace()];
        if (!shot) return;
        shot.corners[active] = positionFrom(event);
        // Re-read at most once per frame: sampling is cheap but not free.
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          var current = app.shots[currentFace()];
          if (!current) return;
          current.samples = current.sheet.read(current.corners);
          drawGrid(current);
        });
      });
      ['pointerup', 'pointercancel'].forEach(function (name) {
        handle.addEventListener(name, function () {
          if (active === null) return;
          active = null;
          handle.classList.remove('is-dragging');
          refreshShot();
          refreshSlots();
          refreshGuide();
        });
      });
    });
  }

  function acceptFiles(files) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return;

    // Fill the selected face first, then the next empty ones, so picking six
    // photos at once fills the cube in the order they are asked for.
    var targets = [currentFace()];
    SCAN_ORDER.forEach(function (face) {
      if (!app.shots[face] && !app.captured[face] && targets.indexOf(face) < 0) targets.push(face);
    });
    SCAN_ORDER.forEach(function (face) {
      if (targets.indexOf(face) < 0) targets.push(face);
    });

    busy(list.length > 1 ? 'Reading ' + list.length + ' photos…' : 'Reading the photo…');
    var loads = list.slice(0, 6).map(function (file, i) {
      return Photo.load(file).then(function (sheet) {
        return { face: targets[i], sheet: sheet, url: sheet.toDataUrl() };
      }).catch(function () { return null; });
    });

    Promise.all(loads).then(function (results) {
      var loaded = results.filter(Boolean);
      loaded.forEach(function (one) {
        app.shots[one.face] = {
          sheet: one.sheet,
          url: one.url,
          corners: Photo.defaultCorners(),
          samples: null
        };
        app.shots[one.face].samples = one.sheet.read(app.shots[one.face].corners);
      });
      idle();
      if (!loaded.length) {
        notice($('scanNotice'), 'bad', 'That file could not be read as an image.',
          'JPEG, PNG, HEIC and WebP all work.');
        return;
      }
      app.faceIndex = SCAN_ORDER.indexOf(loaded[0].face);
      refreshScan();
      if (results.some(function (r) { return !r; })) {
        notice($('scanNotice'), 'warn', 'Some files could not be read as images.', null);
      }
    });
  }

  function clearFace() {
    var face = currentFace();
    delete app.shots[face];
    delete app.captured[face];
    refreshScan();
  }

  function refreshScan() {
    var photos = app.mode === 'photos';
    $('photoControls').hidden = !photos;
    $('cameraControls').hidden = photos;
    $('video').hidden = photos;
    $('grid').hidden = photos;
    $('shot').hidden = !photos || !app.shots[currentFace()];

    if (photos) {
      $('idleTitle').textContent = 'Photograph the six faces';
      refreshShot();
    } else {
      $('stageIdle').hidden = scanner.isRunning();
    }

    var done = countShots();
    $('btnRead').disabled = done < 6;
    $('btnRead').textContent = done < 6
      ? 'Read the cube (' + done + '/6)'
      : 'Read the cube';
    $('pickLabel').textContent = done ? 'Add or replace photos' : 'Choose photos';

    refreshSlots();
    refreshGuide();
  }

  // ------------------------------------------------------------ reading them

  function readCube() {
    var samples = [];
    var missing = [];
    SCAN_ORDER.forEach(function (face) {
      var got = samplesFor(face);
      if (!got) { missing.push(FACE_LABEL[face]); return; }
      samples = samples.concat(got);
    });
    if (missing.length) {
      notice($('scanNotice'), 'warn', 'Still missing: ' + missing.join(', ') + '.', null);
      return;
    }

    busy('Reading the colours…');
    setTimeout(function () {
      var result = Recognise.read(samples, { palette: app.palette });
      app.facelets = result.faces;
      app.suspect = result.confidence.map(function (c) { return c < 0.34; });
      app.reading = result;
      idle();
      openReview();
      reportReading(result);
    }, 30);
  }

  /**
   * Say something useful about how the read went. The per-photo corrections
   * are the interesting part: one photo needing far more than the others
   * usually means it was taken in different light, which is worth knowing
   * when a sticker looks wrong.
   */
  function reportReading(result) {
    var flagged = app.suspect.filter(Boolean).length;
    var levels = result.gains.map(function (g) { return (g[0] + g[1] + g[2]) / 3; });
    var sorted = levels.slice().sort(function (a, b) { return a - b; });
    var median = sorted[3];
    var oddest = -1, worst = 1;
    levels.forEach(function (level, i) {
      var ratio = level > median ? level / median : median / level;
      if (ratio > worst) { worst = ratio; oddest = i; }
    });

    if (worst > 1.7 && oddest >= 0) {
      notice($('reviewStatus'), 'warn',
        'The ' + FACE_WORD[SCAN_ORDER[oddest]] + ' face was lit quite differently.',
        'It has been corrected for, but check its stickers first if something looks wrong.');
      return;
    }
    if (flagged) {
      notice($('reviewStatus'), 'warn',
        flagged + ' sticker' + (flagged === 1 ? ' was' : 's were') + ' a close call.',
        'They are ringed. Tap any sticker to change it.');
    }
  }

  // ------------------------------------------------------------------ review

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
      cell.title = local === 4
        ? FACE_LABEL[face] + ' centre — tap to swap this face\'s colour'
        : FACE_LABEL[face] + ' face';
      net.appendChild(cell);
    }

    net.addEventListener('click', function (event) {
      var cell = event.target.closest('.net__cell');
      if (!cell) return;
      paintSticker(Number(cell.dataset.index));
    });
  }

  /**
   * Every sticker can be changed, centres included. A centre defines what its
   * face's colour is, so changing one means "this face is actually that
   * colour" — which is exactly what someone with an unusual cube needs, and
   * why it updates the palette rather than the cube.
   */
  function paintSticker(index) {
    var face = Cube.FACES[(index / 9) | 0];
    var isCentre = index % 9 === 4;

    if (isCentre) {
      if (app.paintWith === face) return;
      // A cube cannot have one colour on two faces, so setting a centre to
      // another face's colour trades them. That is the fix when the faces
      // came out assigned to the wrong sides. To change what a colour
      // actually *is*, use the colour editor.
      var other = app.paintWith;
      var mine = app.palette[face];
      app.palette[face] = app.palette[other];
      app.palette[other] = mine;
      onPaletteChanged();
      notice($('reviewStatus'), 'warn',
        'Swapped the ' + FACE_WORD[face] + ' and ' + FACE_WORD[other] + ' colours.',
        'Two faces cannot share a colour. To change a colour itself, use Edit colours.');
      return;
    }

    app.facelets[index] = app.paintWith;
    app.suspect[index] = false;
    paintReview();
  }

  function buildPalette() {
    var host = $('palette');
    host.innerHTML = '';
    SCAN_ORDER.forEach(function (face) {
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
      cell.dataset.face = app.facelets[index];
      cell.classList.toggle('is-centre', index % 9 === 4);
      cell.classList.toggle('is-suspect', !!app.suspect[index]);
    });

    document.querySelectorAll('.palette__swatch').forEach(function (swatch) {
      var face = swatch.dataset.face;
      var n = counts[face] || 0;
      swatch.querySelector('.palette__count').textContent = n + '/9';
      swatch.classList.toggle('is-active', face === app.paintWith);
      swatch.classList.toggle('is-over', n > 9);
      swatch.classList.toggle('is-exact', n === 9);
      swatch.title = Colour.nameOf(app.palette[face]) + ' — the ' +
        FACE_WORD[face] + ' face';
    });

    reviewCube.setState(app.facelets);
    reviewCube.setSuspect(app.suspect);

    var flagged = app.suspect.filter(Boolean).length;
    $('netLegend').hidden = flagged === 0;
    $('netCount').textContent = flagged
      ? flagged + ' to confirm'
      : 'all stickers read clearly';

    var check = Cube.validate(app.facelets);
    if (check.ok) {
      if (!$('reviewStatus').querySelector('.notice--warn')) {
        notice($('reviewStatus'), 'good', 'This is a valid cube.', 'Ready to solve.');
      }
      $('btnSolve').disabled = false;
    } else {
      notice($('reviewStatus'), 'bad', check.error, check.hint);
      $('btnSolve').disabled = true;
    }
  }

  function setView(view) {
    app.view = view;
    $('view3d').hidden = view !== '3d';
    $('viewFlat').hidden = view !== 'flat';
    $('btnView3d').classList.toggle('is-on', view === '3d');
    $('btnViewFlat').classList.toggle('is-on', view === 'flat');
  }

  function openReview() {
    enableStep('review', true);
    setStep('review');
    notice($('reviewStatus'), 'warn', null);
    paintReview();
  }

  function loadState(stateString) {
    app.facelets = Cube.toArray(stateString);
    app.suspect = new Array(54).fill(false);
    app.shots = {};
    app.captured = {};
    app.faceIndex = 0;
    openReview();
  }

  // ------------------------------------------------------------------- solve

  function runSolve() {
    var first = !Solver.tablesReady();
    busy(first ? 'Building solver tables…' : 'Solving…');
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
      if (index < seen + stage.moves.length) return { stage: stage, at: i };
      seen += stage.moves.length;
    }
    var last = app.solution.stages.length - 1;
    return { stage: app.solution.stages[last], at: last };
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
        btn.addEventListener('click', function () { pause(); goTo(index + 1); });
        list.appendChild(btn);
      });
      running += stage.moves.length;

      block.appendChild(title);
      block.appendChild(list);
      host.appendChild(block);
    });

    $('holdText').textContent = 'Keep the ' + Colour.nameOf(app.palette.U) +
      ' centre facing up and the ' + Colour.nameOf(app.palette.F) +
      ' centre towards you for the whole solution. Every turn is named from ' +
      'that position.';
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

  function renderPlayback(options) {
    var total = app.solution.moves.length;
    var at = app.playAt;
    var nextMove = at < total ? app.solution.moves[at] : null;

    // While a turn is playing the cube is showing it; only the text updates.
    if (!options || !options.mid) {
      solveCube.setState(app.states[at]);
      solveCube.highlight(nextMove);
    }

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

  /**
   * Move to a point in the solution.
   *
   * A single step turns the layer for real; anything else (a jump, a click on
   * a distant move) snaps, because animating twenty turns to get somewhere is
   * not what the person asked for.
   */
  function goTo(index, options) {
    var total = app.solution.moves.length;
    var target = Math.max(0, Math.min(total, index));
    var from = app.playAt;
    if (target === from) return Promise.resolve();

    var animate = (!options || options.animate !== false) && Math.abs(target - from) === 1;
    app.playAt = target;

    if (!animate) {
      solveCube.setState(app.states[target]);
      renderPlayback();
      if (target >= total) pause();
      return Promise.resolve();
    }

    // Stepping back undoes the move that got here, so it turns the other way.
    var forward = target > from;
    var move = forward ? app.solution.moves[from] : app.solution.moves[target];
    var turn = forward ? move : Cube.invertMove(move);

    renderPlayback({ mid: true });
    return solveCube.turn(turn, app.states[target], app.turnMs).then(function () {
      renderPlayback();
      if (app.playAt >= total) pause();
    });
  }

  function play() {
    if (app.playing || app.playAt >= app.solution.moves.length) return;
    app.playing = true;
    renderPlayback();
    step();
  }

  /** One turn, then a pause to read it, then the next. */
  function step() {
    if (!app.playing) return;
    if (app.playAt >= app.solution.moves.length) { pause(); return; }
    goTo(app.playAt + 1).then(function () {
      if (!app.playing) return;
      app.playTimer = setTimeout(step, app.restMs);
    });
  }

  function pause() {
    app.playing = false;
    if (app.playTimer) clearTimeout(app.playTimer);
    app.playTimer = null;
    if (app.solution) renderPlayback();
  }

  // ------------------------------------------------------------ live camera

  function buildGrid() {
    var grid = $('grid');
    grid.innerHTML = '';
    gridCells = [];
    for (var i = 0; i < 9; i++) {
      var cell = document.createElement('div');
      cell.className = 'stage__cell';
      cell.dataset.face = '';
      grid.appendChild(cell);
      gridCells.push(cell);
    }
  }

  function startCamera() {
    busy('Starting camera…');
    scanner.start($('video'), app.facing).then(function (ok) {
      idle();
      if (!ok) throw new Error('no-frame');
      $('stageIdle').hidden = true;
      $('steady').hidden = !$('chkAuto').checked;
      scanner.hasMultipleCameras().then(function (many) { $('btnSwitchCam').hidden = !many; });
      refreshScan();
      loop();
    }).catch(function (err) {
      idle();
      var message = 'Could not open the camera.';
      var hint = 'Check the permission prompt, or go back to photos.';
      if (err && err.message === 'no-camera-api') {
        message = 'This browser has no camera access here.';
        hint = 'Camera access needs a secure page (https or localhost). Photos work anywhere.';
      }
      notice($('scanNotice'), 'warn', message, hint);
      setMode('photos');
    });
  }

  function stopCamera() {
    if (!scanner.isRunning()) return;
    scanner.stop();
    $('steady').hidden = true;
    $('btnCapture').disabled = true;
  }

  var lastSampleAt = 0;

  function loop(now) {
    if (!scanner.isRunning() || app.step !== 'scan' || app.mode !== 'camera') return;
    requestAnimationFrame(loop);
    now = now || 0;
    if (now - lastSampleAt < SAMPLE_INTERVAL) return;
    lastSampleAt = now;

    var samples = scanner.readCells($('video'), gridCells, app.mirrored);
    if (!samples) return;

    var guesses = samples.map(function (s) { return Colour.nearestFace(s, app.palette); });
    for (var i = 0; i < 9; i++) gridCells[i].dataset.face = guesses[i] || '';

    var quality = Colour.frameQuality(samples);
    if (quality.message) {
      notice($('scanNotice'), 'warn', quality.message, 'Colours read in poor light are often wrong.');
    } else {
      notice($('scanNotice'), 'warn', null);
    }

    var ready = guesses.every(function (g) { return !!g; }) && !quality.tooDark;
    var key = guesses.join(',');
    if (!ready) { app.steady = 0; app.steadyKey = ''; }
    else if (key === app.steadyKey) app.steady++;
    else { app.steady = 1; app.steadyKey = key; }

    $('btnCapture').disabled = false;
    $('steadyBar').style.setProperty('--progress',
      (Math.min(1, app.steady / STEADY_FRAMES) * 100) + '%');

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
    app.captured[currentFace()] = samples;
    app.lastCapture = Date.now();
    app.steady = 0;
    app.steadyKey = '';

    $('flash').classList.remove('is-firing');
    void $('flash').offsetWidth;
    $('flash').classList.add('is-firing');

    var next = SCAN_ORDER.findIndex(function (f) { return !samplesFor(f); });
    if (next >= 0) app.faceIndex = next;
    refreshScan();
    if (countShots() === 6) readCube();
  }

  function setMode(mode) {
    app.mode = mode;
    if (mode === 'photos') {
      stopCamera();
      $('stage').classList.remove('is-mirrored');
    }
    refreshScan();
    if (mode === 'camera' && !scanner.isRunning()) startCamera();
  }

  // -------------------------------------------------------------------- wire

  function init() {
    loadPalette();
    applyPalette();

    buildGrid();
    buildSlots();
    buildNet();
    buildPalette();
    buildSheet();
    wireHandles();

    guideCube = Cube3D.create($('guideCube'), { size: 74, spin: false, tiltX: -20, tiltY: -30 });
    reviewCube = Cube3D.create($('reviewCube'), {
      size: 180,
      spin: false,
      onPick: function (index) { paintSticker(index); }
    });
    reviewCube.element.classList.add('cube3d--edit');
    solveCube = Cube3D.create($('solveCube'), { size: 200, spin: false });

    app.facelets = Cube.toArray(Cube.SOLVED);
    app.suspect = new Array(54).fill(false);
    reviewCube.setState(app.facelets);
    solveCube.setState(app.facelets);
    setView('3d');
    refreshScan();

    $('tableNote').textContent = 'Everything runs in your browser — your photos never leave ' +
      'this device. Solutions come from searching 190,080 bottom-cross states and all 62,208 ' +
      'last-layer states.';

    // photos
    $('filePick').addEventListener('change', function (e) { acceptFiles(e.target.files); e.target.value = ''; });
    $('filePickMore').addEventListener('change', function (e) { acceptFiles(e.target.files); e.target.value = ''; });
    $('btnClearFace').addEventListener('click', clearFace);
    $('btnResetGrid').addEventListener('click', function () {
      var shot = app.shots[currentFace()];
      if (!shot) return;
      shot.corners = Photo.defaultCorners();
      refreshShot();
      refreshSlots();
      refreshGuide();
    });
    $('btnRead').addEventListener('click', readCube);
    $('btnDemo').addEventListener('click', function () { loadState(Cube.randomState()); });
    $('btnSwitchToCamera').addEventListener('click', function () { setMode('camera'); });
    $('btnUseCamera').addEventListener('click', function () { setMode('camera'); });
    $('btnSwitchToPhotos').addEventListener('click', function () { setMode('photos'); });

    // camera
    $('btnCapture').addEventListener('click', function () { capture(null); });
    $('btnMirror').addEventListener('click', function () {
      app.mirrored = !app.mirrored;
      $('stage').classList.toggle('is-mirrored', app.mirrored);
    });
    $('btnSwitchCam').addEventListener('click', function () {
      app.facing = app.facing === 'environment' ? 'user' : 'environment';
      if (scanner.isRunning()) startCamera();
    });
    $('chkAuto').addEventListener('change', function () {
      $('steady').hidden = !($('chkAuto').checked && scanner.isRunning());
    });

    // colours
    $('btnColours').addEventListener('click', openSheet);
    $('btnEditColours').addEventListener('click', openSheet);
    $('btnSheetClose').addEventListener('click', closeSheet);
    $('btnSheetDone').addEventListener('click', closeSheet);
    $('btnPaletteFromPhotos').addEventListener('click', paletteFromPhotos);
    $('paletteSheet').addEventListener('click', function (event) {
      if (event.target === $('paletteSheet')) closeSheet();
    });

    // review
    $('btnView3d').addEventListener('click', function () { setView('3d'); });
    $('btnViewFlat').addEventListener('click', function () { setView('flat'); });
    $('btnSpinLeft').addEventListener('click', function () { reviewCube.nudge(-90); });
    $('btnSpinRight').addEventListener('click', function () { reviewCube.nudge(90); });
    $('btnSolve').addEventListener('click', runSolve);
    $('btnRescan').addEventListener('click', function () { setStep('scan'); refreshScan(); });

    // playback
    $('btnFirst').addEventListener('click', function () { pause(); goTo(0, { animate: false }); });
    $('btnPrev').addEventListener('click', function () { pause(); goTo(app.playAt - 1); });
    $('btnNext').addEventListener('click', function () { pause(); goTo(app.playAt + 1); });
    $('btnLast').addEventListener('click', function () { pause(); goTo(app.solution.moves.length, { animate: false }); });
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
      app.shots = {};
      app.captured = {};
      app.faceIndex = 0;
      app.solution = null;
      enableStep('solve', false);
      setMode('photos');
      setStep('scan');
    });

    document.querySelectorAll('.steps__item').forEach(function (item) {
      item.addEventListener('click', function () {
        if (!item.disabled) setStep(item.dataset.goto);
      });
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && !$('paletteSheet').hidden) { closeSheet(); return; }
      if (app.step !== 'solve' || !app.solution) return;
      if (event.key === 'ArrowRight') { pause(); goTo(app.playAt + 1); }
      else if (event.key === 'ArrowLeft') { pause(); goTo(app.playAt - 1); }
      else if (event.key === ' ') { event.preventDefault(); app.playing ? pause() : play(); }
    });

    window.addEventListener('resize', function () {
      var shot = app.shots[currentFace()];
      if (shot && app.mode === 'photos') { fitShot(shot); drawGrid(shot); }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { stopCamera(); pause(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
