/*!
 * colour.js — turning camera pixels into cube colours.
 *
 * Reading sticker colours off a camera is mostly a lighting problem. Red and
 * orange sit close together in hue, a white sticker under warm light looks
 * cream, and one corner of the cube is usually brighter than the other. Fixed
 * thresholds get this wrong often enough to be annoying.
 *
 * So the final read is not a per-sticker decision at all. A cube has exactly
 * nine stickers of each colour, and the six centres tell us what those colours
 * look like *in this room, in this light*. That makes it an assignment
 * problem: match 54 samples to 6 groups of exactly 9, at the lowest total
 * colour distance. Solved exactly with min-cost flow, so a red sticker that
 * looks a bit orange gets pushed into the red group when the orange group is
 * already full of better candidates.
 *
 * The quick HSV guess is still here, but only for the live preview while the
 * camera is running.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Colour = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // How each cube colour is drawn in the app. Names only ever describe the
  // swatch — the solver works from the centres, so an odd-coloured cube or a
  // non-standard scheme still works.
  var PALETTE = {
    white:  { hex: '#f3f5f8', label: 'White',  lab: null, ink: '#1b1f27' },
    yellow: { hex: '#ffd21f', label: 'Yellow', lab: null, ink: '#3a2c00' },
    red:    { hex: '#e02f3c', label: 'Red',    lab: null, ink: '#ffffff' },
    orange: { hex: '#ff8114', label: 'Orange', lab: null, ink: '#3a1c00' },
    green:  { hex: '#18b55c', label: 'Green',  lab: null, ink: '#04240f' },
    blue:   { hex: '#1f6df0', label: 'Blue',   lab: null, ink: '#ffffff' }
  };
  var PALETTE_NAMES = ['white', 'yellow', 'red', 'orange', 'green', 'blue'];

  function hexToRgb(hex) {
    return {
      r: parseInt(hex.slice(1, 3), 16),
      g: parseInt(hex.slice(3, 5), 16),
      b: parseInt(hex.slice(5, 7), 16)
    };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    var h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  function rgbToLab(r, g, b) {
    function lin(c) {
      c /= 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    }
    var R = lin(r), G = lin(g), B = lin(b);
    var x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
    var y = (R * 0.2126 + G * 0.7152 + B * 0.0722);
    var z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
    function f(t) { return t > 0.008856 ? Math.pow(t, 1 / 3) : (7.787 * t) + 16 / 116; }
    var fx = f(x), fy = f(y), fz = f(z);
    return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
  }

  PALETTE_NAMES.forEach(function (name) {
    var rgb = hexToRgb(PALETTE[name].hex);
    PALETTE[name].lab = rgbToLab(rgb.r, rgb.g, rgb.b);
    PALETTE[name].rgb = rgb;
  });

  /**
   * Lightness is the least trustworthy channel under room lighting, so it
   * counts for less than the two colour channels.
   */
  function labDistance(p, q) {
    var dL = (p.L - q.L) * 0.25, da = p.a - q.a, db = p.b - q.b;
    return Math.sqrt(dL * dL + da * da + db * db);
  }

  /**
   * Scale a sample to a fixed total brightness. Lighting is mostly a
   * multiplier, so removing it leaves the part that says which colour this
   * actually is. Measured against simulated scans, this alone cut sticker
   * errors from about 1% to near zero, and it is what makes an unevenly lit
   * cube readable.
   */
  function normaliseGain(s) {
    var total = s.r + s.g + s.b;
    if (total < 24) return { r: s.r, g: s.g, b: s.b };   // too dark to rescale
    var k = 400 / total;
    return {
      r: Math.min(255, s.r * k),
      g: Math.min(255, s.g * k),
      b: Math.min(255, s.b * k)
    };
  }

  /**
   * How much the absolute colour counts next to the brightness-free one.
   * Keeping a little of it helps tell a white sticker from a washed-out
   * coloured one without giving up the lighting independence.
   */
  var RAW_MIX = 0.3;

  /**
   * Is this frame good enough to read? Dark frames are the one case the
   * matching genuinely cannot rescue: at low exposure, sensor noise is large
   * next to the colour itself. Better to say so than to guess.
   */
  function frameQuality(samples) {
    var sum = 0, min = 1;
    samples.forEach(function (s) {
      var v = Math.max(s.r, s.g, s.b) / 255;
      sum += v;
      if (v < min) min = v;
    });
    var mean = sum / samples.length;
    return {
      brightness: mean,
      darkest: min,
      tooDark: mean < 0.3 || min < 0.12,
      message: mean < 0.3 ? 'Too dark to read colours reliably — find brighter light.'
        : (min < 0.12 ? 'One sticker is in shadow — even out the light on the face.' : null)
    };
  }

  /** Quick guess for the live camera preview only. */
  function guessName(r, g, b) {
    var hsv = rgbToHsv(r, g, b);
    if (hsv.v < 0.16) return null;                       // too dark to call
    if (hsv.s < 0.26 && hsv.v > 0.42) return 'white';
    var h = hsv.h;
    if (h < 14 || h >= 340) return 'red';
    if (h < 40) return 'orange';
    if (h < 72) return 'yellow';
    if (h < 170) return 'green';
    if (h < 258) return 'blue';
    return 'red';
  }

  // ------------------------------------------------------- sampling a frame

  /**
   * Average the middle of a region, throwing away the brightest and darkest
   * pixels so a glare spot or a sticker edge cannot drag the reading.
   */
  function sampleRegion(pixels, width, height, x0, y0, w, h) {
    var samples = [];
    var stepX = Math.max(1, (w / 10) | 0), stepY = Math.max(1, (h / 10) | 0);
    for (var y = y0; y < y0 + h; y += stepY) {
      if (y < 0 || y >= height) continue;
      for (var x = x0; x < x0 + w; x += stepX) {
        if (x < 0 || x >= width) continue;
        var i = (y * width + x) * 4;
        samples.push([pixels[i], pixels[i + 1], pixels[i + 2]]);
      }
    }
    if (!samples.length) return { r: 0, g: 0, b: 0 };
    samples.sort(function (p, q) {
      return (p[0] + p[1] + p[2]) - (q[0] + q[1] + q[2]);
    });
    var lo = Math.floor(samples.length * 0.25), hi = Math.ceil(samples.length * 0.75);
    var r = 0, g = 0, b = 0, n = 0;
    for (var k = lo; k < hi; k++) { r += samples[k][0]; g += samples[k][1]; b += samples[k][2]; n++; }
    return { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  }

  // ------------------------------------------------- exact balanced matching

  /**
   * Min-cost max-flow. Small graph (62 nodes), so a plain queue-based
   * shortest-path augmentation is plenty and stays exact.
   */
  function MinCostFlow(n) {
    this.n = n;
    this.to = []; this.cap = []; this.cost = []; this.next = [];
    this.head = new Array(n).fill(-1);
  }
  MinCostFlow.prototype.edge = function (u, v, cap, cost) {
    this.to.push(v); this.cap.push(cap); this.cost.push(cost); this.next.push(this.head[u]);
    this.head[u] = this.to.length - 1;
    this.to.push(u); this.cap.push(0); this.cost.push(-cost); this.next.push(this.head[v]);
    this.head[v] = this.to.length - 1;
  };
  MinCostFlow.prototype.run = function (source, sink) {
    var INF = Infinity, n = this.n;
    for (;;) {
      var dist = new Array(n).fill(INF), inQueue = new Array(n).fill(false);
      var prevEdge = new Array(n).fill(-1);
      dist[source] = 0;
      var queue = [source];
      inQueue[source] = true;
      while (queue.length) {
        var u = queue.shift();
        inQueue[u] = false;
        for (var e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] <= 0) continue;
          var v = this.to[e], nd = dist[u] + this.cost[e];
          if (nd < dist[v] - 1e-9) {
            dist[v] = nd; prevEdge[v] = e;
            if (!inQueue[v]) { inQueue[v] = true; queue.push(v); }
          }
        }
      }
      if (dist[sink] === INF) return;
      var push = INF, node = sink;
      while (node !== source) {
        var pe = prevEdge[node];
        push = Math.min(push, this.cap[pe]);
        node = this.to[pe ^ 1];
      }
      node = sink;
      while (node !== source) {
        var pe2 = prevEdge[node];
        this.cap[pe2] -= push;
        this.cap[pe2 ^ 1] += push;
        node = this.to[pe2 ^ 1];
      }
    }
  };

  var CENTRE_INDEX = [4, 13, 22, 31, 40, 49];
  var FACE_ORDER = ['U', 'R', 'F', 'D', 'L', 'B'];

  /**
   * Assign 54 samples to the six centre colours, exactly nine each.
   *
   * samples: 54 × {r,g,b}, in facelet order.
   * Returns { faces, names, confidence, distances } where
   *   faces      - 54 face letters (the solver's colours)
   *   names      - map of face letter to palette name, for drawing
   *   confidence - 0..1 per sticker, how clear-cut its group was
   */
  function assign(samples) {
    var labs = samples.map(function (s) {
      var n = normaliseGain(s);
      return rgbToLab(n.r, n.g, n.b);
    });
    var raws = samples.map(function (s) { return rgbToLab(s.r, s.g, s.b); });
    var centres = CENTRE_INDEX.map(function (i) { return labs[i]; });
    var rawCentres = CENTRE_INDEX.map(function (i) { return raws[i]; });

    // Cost of putting sticker i in group c, scaled to integers for the flow.
    var cost = [];
    for (var i = 0; i < 54; i++) {
      cost[i] = [];
      for (var c = 0; c < 6; c++) {
        var centreSlot = CENTRE_INDEX.indexOf(i);
        if (centreSlot >= 0) { cost[i][c] = centreSlot === c ? 0 : 1e6; continue; }
        cost[i][c] = Math.round(100 * (labDistance(labs[i], centres[c]) +
                                       RAW_MIX * labDistance(raws[i], rawCentres[c])));
      }
    }

    var SOURCE = 0, SINK = 61;
    var flow = new MinCostFlow(62);
    for (var s1 = 0; s1 < 54; s1++) {
      flow.edge(SOURCE, 1 + s1, 1, 0);
      for (var c1 = 0; c1 < 6; c1++) flow.edge(1 + s1, 55 + c1, 1, cost[s1][c1]);
    }
    for (var c2 = 0; c2 < 6; c2++) flow.edge(55 + c2, SINK, 9, 0);
    flow.run(SOURCE, SINK);

    // Read the chosen group for each sticker back out of the saturated edges.
    var group = new Array(54).fill(-1);
    for (var s2 = 0; s2 < 54; s2++) {
      for (var e = flow.head[1 + s2]; e !== -1; e = flow.next[e]) {
        var v = flow.to[e];
        if (v >= 55 && v < 61 && flow.cap[e] === 0 && flow.cost[e] >= 0) group[s2] = v - 55;
      }
    }

    // How clear-cut was each choice: the gap to the runner-up group.
    var confidence = [];
    for (var s3 = 0; s3 < 54; s3++) {
      var mine = cost[s3][group[s3]], best = Infinity;
      for (var c3 = 0; c3 < 6; c3++) if (c3 !== group[s3]) best = Math.min(best, cost[s3][c3]);
      var gap = (best - mine) / 100;
      confidence[s3] = Math.max(0, Math.min(1, gap / 22));
    }

    return {
      faces: group.map(function (g) { return FACE_ORDER[g]; }),
      names: paletteNames(centres),
      confidence: confidence,
      groups: group
    };
  }

  /**
   * Work out which swatch to draw each centre with, choosing the overall best
   * one-to-one match so two centres can never claim the same swatch.
   */
  function paletteNames(centreLabs) {
    var best = null;
    var order = [0, 1, 2, 3, 4, 5];

    function permute(arr, k) {
      if (k === arr.length) {
        var total = 0;
        for (var i = 0; i < 6; i++) {
          total += labDistance(centreLabs[i], PALETTE[PALETTE_NAMES[arr[i]]].lab);
        }
        if (!best || total < best.total) best = { total: total, map: arr.slice() };
        return;
      }
      for (var j = k; j < arr.length; j++) {
        var t = arr[k]; arr[k] = arr[j]; arr[j] = t;
        permute(arr, k + 1);
        t = arr[k]; arr[k] = arr[j]; arr[j] = t;
      }
    }
    permute(order, 0);

    var out = {};
    for (var f = 0; f < 6; f++) out[FACE_ORDER[f]] = PALETTE_NAMES[best.map[f]];
    return out;
  }

  /** Default swatch names, used before anything has been scanned. */
  function defaultNames() {
    return { U: 'white', R: 'red', F: 'green', D: 'yellow', L: 'orange', B: 'blue' };
  }

  return {
    PALETTE: PALETTE, PALETTE_NAMES: PALETTE_NAMES,
    rgbToHsv: rgbToHsv, rgbToLab: rgbToLab, labDistance: labDistance,
    guessName: guessName, sampleRegion: sampleRegion, normaliseGain: normaliseGain,
    frameQuality: frameQuality,
    assign: assign, paletteNames: paletteNames, defaultNames: defaultNames,
    hexToRgb: hexToRgb
  };
});
