/*
 * figures.js — the stick figure drawings, start and finish for each exercise.
 *
 * Each frame is a set of joint positions (hd head, nk neck, hp hip, kn knee,
 * an ankle, ft foot, el elbow, wr wrist; a "2" suffix is the far limb) plus
 * props drawn in the accent colour. drawFrame turns one frame into an SVG.
 */
(function () {
  'use strict';

  var STAND = { hd: [62, 14], nk: [62, 24], hp: [62, 46], kn: [64, 68], an: [62, 90], ft: [70, 90], el: [65, 36], wr: [67, 48] };
  var FRONT = { hd: [62, 14], nk: [62, 24], sa: [52, 27], sb: [72, 27], hp: [62, 46], kn: [57, 68], an: [55, 90], kn2: [67, 68], an2: [69, 90] };
  var SEAT = { hd: [50, 26], nk: [50, 36], hp: [50, 62], kn: [74, 62], an: [74, 88], ft: [82, 88] };

  function merge(base, over) { var o = {}, k; for (k in base) o[k] = base[k]; for (k in over) o[k] = over[k]; return o; }
  function S(over, props, wt) { return { j: merge(STAND, over), p: props || [], wt: wt || [] }; }
  function Fr(over, props, wt) { return { j: merge(FRONT, over), p: props || [], wt: wt || [] }; }
  function Se(over, props, wt) { return { j: merge(SEAT, over), p: props || [], wt: wt || [] }; }
  function F(j, props, wt) { return { j: j, p: props || [], wt: wt || [] }; }
  function shiftY(f, dy) {
    var j = {}; for (var k in f.j) j[k] = [f.j[k][0], f.j[k][1] + dy];
    return { j: j, p: f.p, wt: f.wt };
  }

  var seatProps = [['l', 42, 66, 80, 66, 'prop'], ['l', 44, 28, 44, 66, 'prop'], ['l', 46, 66, 46, 90, 'prop thin']];
  var benchProps = [['l', 20, 66, 84, 66, 'prop'], ['l', 28, 66, 28, 90, 'prop thin'], ['l', 76, 66, 76, 90, 'prop thin']];
  var stepProps = [['r', 60, 76, 36, 14, 'prop']];

  var flatJ = { hd: [26, 60], nk: [34, 60], hp: [66, 60], kn: [92, 56], an: [98, 88], ft: [106, 88] };
  var inclineJ = { hd: [40, 36], nk: [47, 43], hp: [70, 66], kn: [90, 64], an: [92, 90], ft: [100, 90] };
  var inclineProps = [['l', 65, 71, 40, 46, 'prop'], ['l', 64, 72, 86, 72, 'prop'], ['l', 72, 72, 72, 90, 'prop thin']];

  var ART = {
    incline: { f: [F(merge(inclineJ, { el: [49, 58], wr: [57, 45] }), inclineProps, ['wr']), F(merge(inclineJ, { el: [58, 32], wr: [68, 22] }), inclineProps, ['wr'])], l: ['Start', 'Finish'] },
    flat: { f: [F(merge(flatJ, { el: [40, 72], wr: [40, 58] }), benchProps, ['wr']), F(merge(flatJ, { el: [34, 46], wr: [34, 32] }), benchProps, ['wr'])], l: ['Start', 'Finish'] },
    lateral: { f: [Fr({ el: [50, 38], wr: [49, 49], el2: [74, 38], wr2: [75, 49] }, [], ['wr', 'wr2']), Fr({ el: [40, 27], wr: [28, 26], el2: [84, 27], wr2: [96, 26] }, [], ['wr', 'wr2'])], l: ['Start', 'Finish'] },
    ohp: { f: [Se({ el: [58, 46], wr: [60, 34] }, seatProps, ['wr']), Se({ el: [56, 24], wr: [56, 12] }, seatProps, ['wr'])], l: ['Start', 'Finish'] },
    fly: { f: [Fr({ el: [42, 31], wr: [32, 36], el2: [82, 31], wr2: [92, 36] }, [['l', 32, 36, 6, 2, 'prop thin'], ['l', 92, 36, 118, 2, 'prop thin']], ['wr', 'wr2']),
                Fr({ el: [50, 34], wr: [59, 39], el2: [74, 34], wr2: [65, 39] }, [['l', 59, 39, 6, 2, 'prop thin'], ['l', 65, 39, 118, 2, 'prop thin']], ['wr', 'wr2'])], l: ['Start', 'Finish'] },
    pulldown: (function () {
      var J = { hd: [52, 26], nk: [54, 36], hp: [58, 62], kn: [82, 58], an: [84, 86], ft: [92, 86] };
      var P = [['l', 50, 66, 68, 66, 'prop'], ['l', 58, 66, 58, 90, 'prop thin'], ['l', 72, 50, 94, 50, 'prop']];
      return { f: [F(merge(J, { el: [60, 25], wr: [66, 14] }), P.concat([['l', 66, 14, 66, -8, 'prop thin']]), ['wr']),
                   F(merge(J, { el: [54, 50], wr: [68, 42] }), P.concat([['l', 68, 42, 68, -8, 'prop thin']]), ['wr'])], l: ['Start', 'Finish'] };
    })(),
    row: (function () {
      var J = { hd: [48, 32], nk: [48, 42], hp: [48, 68], kn: [74, 64], an: [96, 76] };
      var P = [['l', 38, 72, 60, 72, 'prop'], ['l', 48, 72, 48, 90, 'prop thin'], ['l', 100, 62, 100, 88, 'prop']];
      return { f: [F(merge(J, { el: [62, 46], wr: [80, 50] }), P.concat([['l', 80, 50, 154, 50, 'prop thin']]), ['wr']),
                   F(merge(J, { el: [42, 54], wr: [58, 54] }), P.concat([['l', 58, 54, 154, 50, 'prop thin']]), ['wr'])], l: ['Start', 'Finish'] };
    })(),
    facepull: { f: [S({ el: [74, 25], wr: [86, 25] }, [['l', 86, 25, 154, 25, 'prop thin']], ['wr']), S({ el: [56, 24], wr: [68, 16] }, [['l', 68, 16, 154, 25, 'prop thin']], ['wr'])], l: ['Start', 'Finish'] },
    curl: { f: [S({}, [], ['wr']), S({ el: [65, 37], wr: [74, 28] }, [], ['wr'])], l: ['Start', 'Finish'] },
    legpress: { f: [
      F({ hd: [30, 43], nk: [34, 50], hp: [44, 72], kn: [66, 48], an: [92, 66] }, [['l', 40, 76, 26, 44, 'prop'], ['l', 36, 78, 52, 78, 'prop'], ['l', 80, 88, 122, 34, 'prop thin'], ['l', 98, 58, 86, 74, 'prop']]),
      F({ hd: [30, 43], nk: [34, 50], hp: [44, 72], kn: [76, 56], an: [106, 40] }, [['l', 40, 76, 26, 44, 'prop'], ['l', 36, 78, 52, 78, 'prop'], ['l', 80, 88, 122, 34, 'prop thin'], ['l', 111, 49, 101, 31, 'prop']])
    ], l: ['Start (about 90 degrees)', 'Finish (not locked)'] },
    hamcurl: { f: [
      F({ hd: [24, 60], nk: [32, 62], hp: [70, 62], kn: [98, 62], an: [126, 62] }, [['l', 20, 68, 110, 68, 'prop'], ['l', 26, 68, 26, 90, 'prop thin'], ['l', 104, 68, 104, 90, 'prop thin']], ['an']),
      F({ hd: [24, 60], nk: [32, 62], hp: [70, 62], kn: [98, 62], an: [90, 36] }, [['l', 20, 68, 110, 68, 'prop'], ['l', 26, 68, 26, 90, 'prop thin'], ['l', 104, 68, 104, 90, 'prop thin']], ['an'])
    ], l: ['Start', 'Finish'] },
    bridge: (function () {
      var J = { hd: [22, 84], nk: [30, 84], el: [44, 86], wr: [58, 88] };
      return { f: [F(merge(J, { hp: [62, 86], kn: [86, 66], an: [100, 88], ft: [108, 88] })), F(merge(J, { hp: [62, 72], kn: [94, 60], an: [102, 88], ft: [110, 88] }))], l: ['Start', 'Top'] };
    })(),
    calf: { f: [
      S({ hd: [62, 12], nk: [62, 22], hp: [62, 44], kn: [62, 66], an: [62, 84], ft: [72, 84], el: [62, 34], wr: [62, 46] }, [['r', 50, 84, 34, 6, 'prop']]),
      S({ hd: [62, 4], nk: [62, 14], hp: [62, 36], kn: [62, 59], an: [63, 76], ft: [72, 84], el: [62, 26], wr: [62, 38] }, [['r', 50, 84, 34, 6, 'prop']])
    ], l: ['Down', 'Up on toes'] },
    plank: (function () {
      var J = { hd: [22, 62], nk: [32, 66], an: [120, 86], ft: [126, 88], el: [32, 86], wr: [48, 86] };
      return { f: [F(merge(J, { hp: [76, 76], kn: [98, 81] })), F(merge(J, { hp: [76, 87], kn: [98, 87] }))], l: ['Good: straight line', 'Avoid: hips sagging'] };
    })(),
    bike: (function () {
      var P = [['l', 44, 52, 60, 52, 'prop'], ['l', 50, 52, 48, 78, 'prop'], ['l', 48, 78, 70, 76, 'prop'], ['l', 70, 76, 88, 80, 'prop'], ['c', 70, 76, 14, 'prop thin'], ['l', 90, 40, 86, 80, 'prop']];
      var J = { hd: [68, 21], nk: [64, 29], hp: [52, 51], el: [78, 38], wr: [90, 42] };
      return { f: [F(merge(J, { kn: [76, 64], an: [70, 90], ft: [78, 90] }), P), F(merge(J, { kn: [74, 42], an: [70, 62], ft: [78, 62] }), P)], l: ['Pedal down', 'Pedal up'] };
    })(),
    pushdown: { f: [S({ wr: [77, 33] }, [['l', 77, 33, 92, -8, 'prop thin']], ['wr']), S({}, [['l', 67, 48, 92, -8, 'prop thin']], ['wr'])], l: ['Start', 'Finish'] },
    hanging: { f: [
      F({ hd: [55, 22], nk: [60, 30], hp: [60, 56], kn: [60, 72], an: [60, 88], ft: [66, 88], el: [65, 18], wr: [68, 5] }, [['l', 46, 3, 90, 3, 'prop']]),
      F({ hd: [55, 22], nk: [60, 30], hp: [60, 56], kn: [78, 48], an: [70, 64], ft: [76, 64], el: [65, 18], wr: [68, 5] }, [['l', 46, 3, 90, 3, 'prop']])
    ], l: ['Start', 'Knees up'] },
    slr: (function () {
      var J = { hd: [20, 84], nk: [28, 84], hp: [58, 86], kn2: [80, 66], an2: [90, 88], el: [40, 87], wr: [52, 88] };
      return { f: [F(merge(J, { kn: [88, 86], an: [118, 86], ft: [124, 84] })), F(merge(J, { kn: [86, 74], an: [114, 62], ft: [120, 60] }))], l: ['Start', 'Lifted (about 30 cm)'] };
    })(),
    tke: (function () {
      var J = { hd: [60, 14], nk: [60, 24], hp: [60, 46], an: [60, 90], ft: [68, 90], el: [60, 36], wr: [60, 48] };
      var post = ['r', 138, 56, 8, 20, 'prop'];
      return { f: [F(merge(J, { kn: [66, 66] }), [post, ['l', 140, 66, 64, 66, 'prop thin']]), F(merge(J, { kn: [60, 68] }), [post, ['l', 140, 66, 57, 68, 'prop thin']])], l: ['Slight bend', 'Straighten and squeeze'] };
    })(),
    balance: (function () {
      var A = S({ kn2: [76, 60], an2: [70, 80], el: [72, 34], wr: [83, 37] });
      var B = shiftY(A, -4); B.p = [['r', 44, 86, 36, 4, 'prop']];
      return { f: [A, B], l: ['On the floor', 'On a cushion (harder)'] };
    })(),
    stepup: { f: [
      F({ hd: [65, 14], nk: [65, 24], hp: [66, 46], kn: [80, 58], an: [78, 76], ft: [86, 76], kn2: [62, 68], an2: [56, 90], el: [65, 36], wr: [65, 48] }, stepProps),
      F({ hd: [78, 6], nk: [78, 16], hp: [78, 38], kn: [78, 57], an: [78, 76], ft: [86, 76], kn2: [72, 52], an2: [66, 66], el: [78, 28], wr: [78, 40] }, stepProps)
    ], l: ['Foot on the step', 'Stand up tall'] },
    legext: { f: [Se({}, seatProps, ['an']), Se({ an: [100, 62], ft: [106, 58] }, seatProps, ['an'])], l: ['Start', 'Almost straight'] }
  };

  var NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs) { var n = document.createElementNS(NS, tag); for (var k in attrs) n.setAttribute(k, attrs[k]); return n; }
  function drawFrame(f, label) {
    var j = f.j, front = !!j.sa;
    var svg = sv('svg', { viewBox: '0 -8 160 108', role: 'img', 'aria-label': label });
    svg.appendChild(sv('line', { x1: 6, y1: 90, x2: 154, y2: 90, 'class': 'gl' }));
    f.p.forEach(function (p) {
      var t = p[0], el;
      if (t === 'l') el = sv('line', { x1: p[1], y1: p[2], x2: p[3], y2: p[4], 'class': p[5] || 'prop' });
      else if (t === 'c') el = sv('circle', { cx: p[1], cy: p[2], r: p[3], 'class': p[4] || 'prop' });
      else el = sv('rect', { x: p[1], y: p[2], width: p[3], height: p[4], rx: 2, 'class': p[5] || 'prop' });
      svg.appendChild(el);
    });
    var segs = [];
    if (front) {
      segs = [['hp', 'kn2'], ['kn2', 'an2'], ['nk', 'hp'], ['hp', 'kn'], ['kn', 'an'], ['sa', 'sb'], ['sa', 'el'], ['el', 'wr'], ['sb', 'el2'], ['el2', 'wr2']];
    } else {
      segs = [['hp', 'kn2', 'far'], ['kn2', 'an2', 'far'], ['an2', 'ft2', 'far'], ['nk', 'hp'], ['hp', 'kn'], ['kn', 'an'], ['an', 'ft'], ['nk', 'el'], ['el', 'wr']];
    }
    segs.forEach(function (s) {
      var a = j[s[0]], b = j[s[1]];
      if (!a || !b) return;
      svg.appendChild(sv('line', { x1: a[0], y1: a[1], x2: b[0], y2: b[1], 'class': 'bone' + (s[2] ? ' ' + s[2] : '') }));
    });
    svg.appendChild(sv('circle', { cx: j.hd[0], cy: j.hd[1], r: 6, 'class': 'headc' }));
    f.wt.forEach(function (k) { if (j[k]) svg.appendChild(sv('circle', { cx: j[k][0], cy: j[k][1], r: 4, 'class': 'wt' })); });
    return svg;
  }

  window.GymFigures = { ART: ART, drawFrame: drawFrame };
})();
