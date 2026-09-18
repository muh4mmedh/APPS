/*!
 * cube3d.js — draggable 3D cube built from plain DOM and CSS transforms.
 *
 * No WebGL and no dependencies: 54 stickers in six rotated planes. That keeps
 * the whole app a handful of static files, and it means the stickers are real
 * elements, so a colour change is just a style change.
 *
 * Each face's stickers are laid out in the same row-major order as the facelet
 * model, which works out exactly because of how the faces are rotated into
 * place: the top face's rows run from back to front, and the bottom face's
 * from front to back, matching the model's convention.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Cube3D = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var FACE_TRANSFORM = {
    U: 'rotateX(90deg)',
    D: 'rotateX(-90deg)',
    F: '',
    B: 'rotateY(180deg)',
    R: 'rotateY(90deg)',
    L: 'rotateY(-90deg)'
  };

  function create(container, options) {
    options = options || {};
    var size = options.size || 168;
    var half = size / 2;

    container.classList.add('cube3d');
    container.innerHTML = '';

    var scene = document.createElement('div');
    scene.className = 'cube3d__scene';
    scene.style.width = size + 'px';
    scene.style.height = size + 'px';

    var body = document.createElement('div');
    body.className = 'cube3d__body';

    var stickers = {};
    FACES.forEach(function (face) {
      var plane = document.createElement('div');
      plane.className = 'cube3d__face';
      plane.dataset.face = face;
      plane.style.width = size + 'px';
      plane.style.height = size + 'px';
      plane.style.transform = FACE_TRANSFORM[face] + ' translateZ(' + half + 'px)';
      stickers[face] = [];
      for (var i = 0; i < 9; i++) {
        var cell = document.createElement('i');
        cell.className = 'cube3d__sticker';
        plane.appendChild(cell);
        stickers[face].push(cell);
      }
      body.appendChild(plane);
    });

    scene.appendChild(body);
    container.appendChild(scene);

    var view = { x: options.tiltX === undefined ? -24 : options.tiltX,
                 y: options.tiltY === undefined ? -34 : options.tiltY };
    var spinning = options.spin !== false;
    var dragging = false, lastPoint = null, rafId = null, lastFrame = 0;

    function paint() {
      body.style.transform = 'rotateX(' + view.x + 'deg) rotateY(' + view.y + 'deg)';
    }
    paint();

    function tick(now) {
      rafId = requestAnimationFrame(tick);
      if (!spinning || dragging) { lastFrame = now; return; }
      var dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
      lastFrame = now;
      view.y += dt * 0.006;
      paint();
    }
    rafId = requestAnimationFrame(tick);

    function pointOf(event) {
      var t = event.touches ? event.touches[0] : event;
      return { x: t.clientX, y: t.clientY };
    }

    // Spinning and tapping share the same surface, so a press only counts as
    // a tap if the pointer barely moved.
    var pressAt = null, moved = 0;
    var TAP_SLOP = 6;

    function onDown(event) {
      dragging = true;
      spinning = false;
      lastPoint = pointOf(event);
      pressAt = lastPoint;
      moved = 0;
      container.classList.add('is-dragging');
    }
    function onMove(event) {
      if (!dragging) return;
      var p = pointOf(event);
      moved += Math.abs(p.x - lastPoint.x) + Math.abs(p.y - lastPoint.y);
      view.y += (p.x - lastPoint.x) * 0.55;
      view.x = Math.max(-88, Math.min(88, view.x - (p.y - lastPoint.y) * 0.55));
      lastPoint = p;
      paint();
      if (event.cancelable) event.preventDefault();
    }

    function onUp(event) {
      var wasTap = dragging && moved < TAP_SLOP;
      dragging = false;
      lastPoint = null;
      container.classList.remove('is-dragging');
      if (!wasTap || !options.onPick) return;

      var target = (event && event.target) ||
        (pressAt && document.elementFromPoint(pressAt.x, pressAt.y));
      var cell = target && target.closest ? target.closest('.cube3d__sticker') : null;
      if (!cell) return;
      var plane = cell.parentElement;
      var index = Array.prototype.indexOf.call(plane.children, cell);
      var faceIndex = FACES.indexOf(plane.dataset.face);
      if (faceIndex < 0 || index < 0) return;
      options.onPick(faceIndex * 9 + index, plane.dataset.face, index);
    }

    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    container.addEventListener('touchstart', onDown, { passive: true });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onUp);

    var current = null;

    return {
      element: container,

      /**
       * state: 54 face letters, or '' for a sticker not known yet.
       *
       * The letter goes on the element and the colour comes from a CSS
       * variable for that face, so editing the cube's palette recolours the
       * whole cube without touching this code.
       */
      setState: function (state) {
        current = state;
        FACES.forEach(function (face, fi) {
          for (var i = 0; i < 9; i++) {
            var letter = state[fi * 9 + i] || '';
            stickers[face][i].dataset.face = letter;
          }
        });
      },

      /** Pulse the face a move turns, and show which way it goes. */
      highlight: function (move) {
        FACES.forEach(function (face) {
          stickers[face].forEach(function (cell) { cell.classList.remove('is-turning'); });
          var plane = body.querySelector('[data-face="' + face + '"]');
          plane.classList.remove('is-turning', 'turn-cw', 'turn-ccw', 'turn-half');
        });
        if (!move) return;
        var face = move[0];
        var plane = body.querySelector('[data-face="' + face + '"]');
        if (!plane) return;
        plane.classList.add('is-turning');
        plane.classList.add(move.length === 1 ? 'turn-cw' : move[1] === '2' ? 'turn-half' : 'turn-ccw');
        stickers[face].forEach(function (cell) { cell.classList.add('is-turning'); });
      },

      /** Turn the cube so a given face is towards the viewer. */
      faceTowardsViewer: function (face) {
        spinning = false;
        var angles = {
          F: { x: -18, y: -28 }, U: { x: -62, y: -30 }, R: { x: -18, y: -62 },
          D: { x: 52, y: -30 }, L: { x: -18, y: 34 }, B: { x: -18, y: 152 }
        };
        var a = angles[face] || angles.F;
        view.x = a.x; view.y = a.y;
        paint();
      },

      setSpin: function (on) { spinning = on; },

      /** Ring the stickers the reader was unsure about. */
      setSuspect: function (flags) {
        FACES.forEach(function (face, fi) {
          for (var i = 0; i < 9; i++) {
            stickers[face][i].classList.toggle('is-suspect', !!(flags && flags[fi * 9 + i]));
          }
        });
      },

      /** Turn a quarter of the way round, for reaching the hidden faces. */
      nudge: function (dx, dy) {
        spinning = false;
        view.y += dx;
        view.x = Math.max(-88, Math.min(88, view.x + (dy || 0)));
        paint();
      },


      destroy: function () {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      },

      get state() { return current; }
    };
  }

  return { create: create, FACES: FACES };
});
