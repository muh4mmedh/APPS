/*!
 * cube3d.js — a cube of 26 small cubes, so a turn can actually turn.
 *
 * The obvious way to draw a cube is six flat faces of nine stickers. That
 * renders fine and cannot animate: a turn moves stickers belonging to five
 * different faces, so there is no element that represents "the layer that
 * rotates". Hence 26 cubies, each carrying its own stickers. A turn is then
 * exactly what it is on a real cube — nine cubies rotating together about an
 * axis — and the inner faces are dark, so you see black plastic as the layer
 * swings open, the way you would looking at the real thing.
 *
 * When the turn finishes, the cubies snap back to their slots and the colours
 * are repainted from the new state. The cubies are fixed positions; it is the
 * colours that travel. Ending the animation exactly where the new state begins
 * makes the two indistinguishable.
 *
 * No WebGL: plain elements and CSS transforms, which keeps the app a handful
 * of static files and makes a sticker a real element you can tap.
 */
(function (root, factory) {
  var Cube = (typeof module === 'object' && module.exports)
    ? require('./cube.js') : root.RS.Cube;
  var api = factory(Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Cube3D = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1],
                 D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };

  /*
   * Which way each face turns on screen.
   *
   * Model space has y up and z towards you; CSS has y *down*. So a turn that
   * is clockwise looking at a face does not simply map to a positive CSS
   * rotation — each of these was worked out from what the move does to the
   * cube (an R turn carries the top face to the back) and then written in CSS
   * terms. Getting a sign wrong here makes the cube animate one way and land
   * on the state for the other.
   */
  var TURN = {
    U: { axis: 'Y', angle: -90 },
    D: { axis: 'Y', angle: 90 },
    R: { axis: 'X', angle: 90 },
    L: { axis: 'X', angle: -90 },
    F: { axis: 'Z', angle: 90 },
    B: { axis: 'Z', angle: -90 }
  };

  // Where each sticker of the cube lives: cubie position and outward normal.
  var STICKER_AT = {};
  Cube.GEO.forEach(function (g, index) {
    STICKER_AT[g.pos.join(',') + '|' + g.nrm.join(',')] = index;
  });

  function create(container, options) {
    options = options || {};
    var size = options.size || 168;
    var unit = size / 3;

    container.classList.add('cube3d');
    container.innerHTML = '';

    var scene = document.createElement('div');
    scene.className = 'cube3d__scene';
    scene.style.width = size + 'px';
    scene.style.height = size + 'px';

    var body = document.createElement('div');
    body.className = 'cube3d__body';

    var cubies = [];
    var stickers = new Array(54);

    for (var x = -1; x <= 1; x++) {
      for (var y = -1; y <= 1; y++) {
        for (var z = -1; z <= 1; z++) {
          if (!x && !y && !z) continue;   // the core is never seen
          var cubie = document.createElement('div');
          cubie.className = 'cubie';
          // Model y is up, CSS y is down.
          var base = 'translate3d(' + (x * unit) + 'px,' + (-y * unit) + 'px,' + (z * unit) + 'px)';
          cubie.style.transform = base;
          cubie.style.width = unit + 'px';
          cubie.style.height = unit + 'px';

          FACES.forEach(function (face) {
            var n = NORMAL[face];
            var tile = document.createElement('i');
            var outward = (x * n[0] + y * n[1] + z * n[2]) === 1;
            tile.className = outward ? 'cube3d__sticker' : 'cubie__inner';
            tile.style.transform = faceTransform(face, unit);
            if (outward) {
              var index = STICKER_AT[[x, y, z].join(',') + '|' + n.join(',')];
              tile.dataset.index = String(index);
              tile.dataset.face = '';
              stickers[index] = tile;
            }
            cubie.appendChild(tile);
          });

          cubies.push({ el: cubie, pos: [x, y, z], base: base });
          body.appendChild(cubie);
        }
      }
    }

    scene.appendChild(body);
    container.appendChild(scene);

    var view = { x: options.tiltX === undefined ? -24 : options.tiltX,
                 y: options.tiltY === undefined ? -34 : options.tiltY };
    var spinning = options.spin !== false;
    var dragging = false, lastPoint = null, rafId = null, lastFrame = 0;
    var pressAt = null, moved = 0;
    var TAP_SLOP = 6;

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
      var tile = target && target.closest ? target.closest('.cube3d__sticker') : null;
      if (!tile) return;
      options.onPick(Number(tile.dataset.index));
    }

    container.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    container.addEventListener('touchstart', onDown, { passive: true });
    container.addEventListener('touchmove', onMove, { passive: false });
    container.addEventListener('touchend', onUp);

    var current = null;
    var running = null;

    function apply(state) {
      current = state;
      for (var i = 0; i < 54; i++) {
        if (stickers[i]) stickers[i].dataset.face = state[i] || '';
      }
    }

    function layerOf(face) {
      var n = NORMAL[face];
      return cubies.filter(function (c) {
        return c.pos[0] * n[0] + c.pos[1] * n[1] + c.pos[2] * n[2] === 1;
      });
    }

    function clearTurnMarks() {
      cubies.forEach(function (c) {
        c.el.style.transform = c.base;
        c.el.classList.remove('is-turning');
      });
    }

    return {
      element: container,

      /** state: 54 face letters, or '' where a sticker is not known yet. */
      setState: function (state) {
        if (running) { running.cancel(); running = null; clearTurnMarks(); }
        apply(state);
      },

      /**
       * Turn a layer, then land on `nextState`.
       *
       * Resolves when the turn has finished. Calling it again mid-turn
       * abandons the one in flight and snaps to its result first, so stepping
       * quickly through a solution never leaves the cube half-turned.
       */
      turn: function (move, nextState, duration) {
        var self = this;
        if (running) { running.finishNow(); }
        var spec = TURN[move[0]];
        if (!spec) { apply(nextState); return Promise.resolve(); }

        var quarter = move.length === 1 ? 1 : move[1] === '2' ? 2 : -1;
        var angle = spec.angle * quarter;
        var layer = layerOf(move[0]);
        var ms = duration === undefined ? 320 : duration;

        spinning = false;
        layer.forEach(function (c) { c.el.classList.add('is-turning'); });

        if (ms <= 0 || !layer[0].el.animate) {
          clearTurnMarks();
          apply(nextState);
          return Promise.resolve();
        }

        var animations = layer.map(function (c) {
          return c.el.animate(
            [{ transform: c.base },
             { transform: 'rotate' + spec.axis + '(' + angle + 'deg) ' + c.base }],
            { duration: ms * (Math.abs(quarter) === 2 ? 1.5 : 1),
              easing: 'cubic-bezier(0.33, 0.9, 0.3, 1)',
              fill: 'both' }
          );
        });

        var settled = false;
        function land() {
          if (settled) return;
          settled = true;
          animations.forEach(function (a) { a.cancel(); });
          clearTurnMarks();
          apply(nextState);
          running = null;
        }

        running = {
          cancel: land,
          finishNow: land
        };

        return Promise.all(animations.map(function (a) { return a.finished; }))
          .then(land, land)
          .then(function () { return self; });
      },

      /** Is a turn playing right now? */
      get turning() { return !!running; },

      /** Mark the layer a move will turn, without turning it. */
      highlight: function (move) {
        cubies.forEach(function (c) { c.el.classList.remove('is-next'); });
        if (!move || running) return;
        layerOf(move[0]).forEach(function (c) { c.el.classList.add('is-next'); });
      },

      setSuspect: function (flags) {
        for (var i = 0; i < 54; i++) {
          if (stickers[i]) stickers[i].classList.toggle('is-suspect', !!(flags && flags[i]));
        }
      },

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

      nudge: function (dx, dy) {
        spinning = false;
        view.y += dx;
        view.x = Math.max(-88, Math.min(88, view.x + (dy || 0)));
        paint();
      },

      setSpin: function (on) { spinning = on; },

      destroy: function () {
        if (rafId) cancelAnimationFrame(rafId);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      },

      get state() { return current; }
    };
  }

  function faceTransform(face, unit) {
    var half = unit / 2;
    switch (face) {
      case 'U': return 'rotateX(90deg) translateZ(' + half + 'px)';
      case 'D': return 'rotateX(-90deg) translateZ(' + half + 'px)';
      case 'R': return 'rotateY(90deg) translateZ(' + half + 'px)';
      case 'L': return 'rotateY(-90deg) translateZ(' + half + 'px)';
      case 'F': return 'translateZ(' + half + 'px)';
      default: return 'rotateY(180deg) translateZ(' + half + 'px)';
    }
  }

  return { create: create, FACES: FACES, TURN: TURN };
});
