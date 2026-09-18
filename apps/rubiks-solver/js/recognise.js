/*!
 * recognise.js — sampled sticker colours in, cube state out.
 *
 * Six photos means six lighting conditions. The same white sticker is cream
 * under a lamp and blue-ish in shade, so comparing a sticker from one photo
 * against a reference from another is comparing two different things. Reading
 * each photo on its own terms is what makes six separate photos workable.
 *
 * Three facts do the work:
 *
 *   1. A centre sticker cannot move. The centre of the face you called "up"
 *      IS that face's colour, by definition — so every photo contains one
 *      sticker whose true colour is known. That is a free, exact colour
 *      correspondence per photo.
 *   2. Lighting is close to a per-channel multiplier (the von Kries model), so
 *      one gain per channel per photo covers most of it. Fitted in linear
 *      light, where the multiplication actually holds.
 *   3. A cube has exactly nine stickers of each colour, so the final read is
 *      one balanced assignment over all 54, not 54 independent guesses.
 *
 * They are circular — the gains need the assignment, the assignment needs the
 * gains — so this alternates between them until the assignment stops changing,
 * which it does in a handful of rounds.
 *
 * When the user has told us their cube's actual colours, those are the
 * references and the fit is anchored to truth. When they have not, the
 * references are estimated alongside the gains (the centres still pin which
 * class is which), and the gains are renormalised each round so the whole
 * system cannot drift brighter or darker.
 */
(function (root, factory) {
  var isNode = typeof module === 'object' && module.exports;
  var Colour = isNode ? require('./colour.js') : root.RS.Colour;
  var Cube = isNode ? require('./cube.js') : root.RS.Cube;
  var api = factory(Colour, Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Recognise = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Colour, Cube) {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var CENTRES = [4, 13, 22, 31, 40, 49];

  var DEFAULTS = {
    iterations: 12,
    // Lightness counts for a little less than the two colour channels: even
    // after the gain fit, a face is rarely lit evenly corner to corner.
    lightWeight: 0.7,
    // How much of the cost comes from brightness-free colour, which survives
    // shadow across a face. Low on purpose — measured, not assumed. Once each
    // photo's gain is corrected, absolute brightness is real information
    // (white against yellow, say), and leaning on chromaticity instead made
    // the read four times worse.
    shadeWeight: 0.25,
    // Pulls each gain towards 1 so a channel with almost no signal on a face
    // (no red stickers, say) cannot produce a wild correction.
    gainRegulariser: 0.06,
    gainLimit: [0.2, 5],
    // Also fit how the light falls across each face. One lamp off to one side
    // makes a face brighter on that side, which a single gain per photo cannot
    // describe. A plane over the nine cells can, and it is the same shape a
    // real light actually makes.
    shading: true,
    shadingLimit: 0.55
  };

  // ------------------------------------------------------------- min cost flow

  /** Exact balanced matching: 54 samples into 6 groups of exactly 9. */
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
      var dist = new Array(n).fill(INF), queued = new Array(n).fill(false);
      var from = new Array(n).fill(-1);
      dist[source] = 0;
      var queue = [source];
      queued[source] = true;
      while (queue.length) {
        var u = queue.shift();
        queued[u] = false;
        for (var e = this.head[u]; e !== -1; e = this.next[e]) {
          if (this.cap[e] <= 0) continue;
          var v = this.to[e], nd = dist[u] + this.cost[e];
          if (nd < dist[v] - 1e-9) {
            dist[v] = nd; from[v] = e;
            if (!queued[v]) { queued[v] = true; queue.push(v); }
          }
        }
      }
      if (dist[sink] === INF) return;
      var push = INF, node = sink;
      while (node !== source) {
        push = Math.min(push, this.cap[from[node]]);
        node = this.to[from[node] ^ 1];
      }
      node = sink;
      while (node !== source) {
        var e2 = from[node];
        this.cap[e2] -= push;
        this.cap[e2 ^ 1] += push;
        node = this.to[e2 ^ 1];
      }
    }
  };

  function balancedAssign(cost) {
    var SOURCE = 0, SINK = 61;
    var flow = new MinCostFlow(62);
    for (var i = 0; i < 54; i++) {
      flow.edge(SOURCE, 1 + i, 1, 0);
      for (var c = 0; c < 6; c++) {
        // Infinities cannot go in a flow network; a large finite cost keeps
        // the pinned centres pinned without breaking the search.
        var value = cost[i][c];
        flow.edge(1 + i, 55 + c, 1, value > 1e8 ? 1e8 : Math.round(value));
      }
    }
    for (var c2 = 0; c2 < 6; c2++) flow.edge(55 + c2, SINK, 9, 0);
    flow.run(SOURCE, SINK);

    var group = new Array(54).fill(-1);
    for (var s = 0; s < 54; s++) {
      for (var e = flow.head[1 + s]; e !== -1; e = flow.next[e]) {
        var v = flow.to[e];
        if (v >= 55 && v < 61 && flow.cap[e] === 0 && flow.cost[e] >= 0) group[s] = v - 55;
      }
    }
    return group;
  }

  // ------------------------------------------------------------------- solving

  function clamp(value, lo, hi) { return value < lo ? lo : value > hi ? hi : value; }

  /** Brightness-free version of a linear colour, for shadow-proof comparison. */
  function chroma(lin) {
    var sum = lin[0] + lin[1] + lin[2];
    if (sum < 1e-6) return [1 / 3, 1 / 3, 1 / 3];
    return [lin[0] / sum, lin[1] / sum, lin[2] / sum];
  }

  function corrected(lin, gain, shade) {
    var k = shade || 1;
    return [clamp(lin[0] * gain[0] / k, 0, 1.4),
            clamp(lin[1] * gain[1] / k, 0, 1.4),
            clamp(lin[2] * gain[2] / k, 0, 1.4)];
  }

  function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

  /**
   * How much brighter or darker each of the nine cells is than the face's
   * average, as a plane across the face. Returned as nine multipliers with a
   * mean of one, so the photo's gain still owns the overall level.
   */
  function fitShading(indices, lin, gains, refs, group, faceIndex, limit) {
    var wanted = [];
    for (var n = 0; n < indices.length; n++) {
      var i = indices[n];
      var g = [lin[i][0] * gains[faceIndex][0],
               lin[i][1] * gains[faceIndex][1],
               lin[i][2] * gains[faceIndex][2]];
      var r = refs[group[i]];
      var rr = dot3(r, r);
      // The single multiplier that would best take this sticker onto its
      // reference colour; if it is consistently >1 on one side of the face,
      // that side is lit more brightly.
      wanted.push(rr > 1e-6 ? dot3(g, r) / rr : 1);
    }

    // Least squares for m = c + a*(col-1) + b*(row-1) over the nine cells.
    var sc = 0, sa = 0, sb = 0, saa = 0, sbb = 0, count = 0;
    for (var k = 0; k < indices.length; k++) {
      var cell = indices[k] % 9;
      var col = (cell % 3) - 1, row = ((cell / 3) | 0) - 1;
      sc += wanted[k];
      sa += wanted[k] * col; saa += col * col;
      sb += wanted[k] * row; sbb += row * row;
      count++;
    }
    var c0 = count ? sc / count : 1;
    var a0 = saa ? sa / saa : 0;
    var b0 = sbb ? sb / sbb : 0;

    var field = [];
    for (var cell2 = 0; cell2 < 9; cell2++) {
      var col2 = (cell2 % 3) - 1, row2 = ((cell2 / 3) | 0) - 1;
      var m = c0 + a0 * col2 + b0 * row2;
      field.push(m);
    }
    // Normalise to mean one, then clamp so a bad round cannot run away.
    var mean = field.reduce(function (x, y) { return x + y; }, 0) / 9;
    if (!(mean > 1e-6)) return [1, 1, 1, 1, 1, 1, 1, 1, 1];
    return field.map(function (m2) {
      return clamp(m2 / mean, 1 - limit, 1 + limit);
    });
  }

  /**
   * samples  - 54 {r,g,b} in facelet order (U R F D L B, nine each)
   * options.references - six {r,g,b}, the cube's real colours, or null to
   *                      estimate them
   * options.faceOf     - which photo a sample came from; defaults to its face
   */
  function solve(samples, options) {
    var settings = {};
    Object.keys(DEFAULTS).forEach(function (k) { settings[k] = DEFAULTS[k]; });
    Object.keys(options || {}).forEach(function (k) { settings[k] = options[k]; });

    var faceOf = settings.faceOf || function (i) { return (i / 9) | 0; };
    var lin = samples.map(function (s) { return Colour.srgbToLinear(s); });

    var fixed = !!settings.references;
    var refs, stated = null;
    if (fixed) {
      stated = settings.references.map(function (s) { return Colour.srgbToLinear(s); });
      refs = stated.map(function (c) { return c.slice(); });
    } else {
      refs = CENTRES.map(function (i) { return lin[i].slice(); });
    }

    // One exact correspondence per photo: its centre. That alone is a decent
    // white balance, and the fit below refines it using all nine stickers.
    var gains = [], priors = [];
    for (var f = 0; f < 6; f++) {
      var centre = lin[CENTRES[f]];
      var gain = [1, 1, 1];
      if (fixed) {
        for (var ch = 0; ch < 3; ch++) {
          gain[ch] = centre[ch] > 0.004
            ? clamp(refs[f][ch] / centre[ch], settings.gainLimit[0], settings.gainLimit[1])
            : 1;
        }
      }
      gains.push(gain);
      priors.push(gain.slice());
    }

    // One multiplier per cell per photo; all ones until the first fit.
    var shading = [];
    for (var sf = 0; sf < 6; sf++) shading.push([1, 1, 1, 1, 1, 1, 1, 1, 1]);

    function shadeOf(i) { return shading[faceOf(i)][i % 9]; }

    var group = null, cost = null, rounds = 0;

    for (var round = 0; round < settings.iterations; round++) {
      rounds = round + 1;

      // --- cost of putting each sticker in each colour group ---------------
      var labs = [], chromas = [];
      for (var i = 0; i < 54; i++) {
        var fixedLin = corrected(lin[i], gains[faceOf(i)], shadeOf(i));
        labs.push(Colour.linearToLab(fixedLin));
        chromas.push(chroma(fixedLin));
      }
      var refLabs = refs.map(Colour.linearToLab);
      var refChromas = refs.map(chroma);

      cost = [];
      for (var s = 0; s < 54; s++) {
        cost[s] = [];
        var centreSlot = CENTRES.indexOf(s);
        for (var c = 0; c < 6; c++) {
          if (centreSlot >= 0) {
            // A centre defines its face's colour, so it is not up for grabs.
            cost[s][c] = centreSlot === c ? 0 : 1e9;
            continue;
          }
          var dL = (labs[s][0] - refLabs[c][0]) * settings.lightWeight;
          var da = labs[s][1] - refLabs[c][1];
          var db = labs[s][2] - refLabs[c][2];
          var full = Math.sqrt(dL * dL + da * da + db * db);

          var cr = chromas[s][0] - refChromas[c][0];
          var cg = chromas[s][1] - refChromas[c][1];
          var cb = chromas[s][2] - refChromas[c][2];
          var shade = Math.sqrt(cr * cr + cg * cg + cb * cb) * 260;

          cost[s][c] = 100 * ((1 - settings.shadeWeight) * full + settings.shadeWeight * shade);
        }
      }

      var next = balancedAssign(cost);
      var settled = group && next.every(function (g, k) { return g === group[k]; });
      group = next;
      if (settled) break;

      // --- what each colour actually looks like in these photos ------------
      var sums = refs.map(function () { return [0, 0, 0, 0]; });
      for (var j = 0; j < 54; j++) {
        var fixedJ = corrected(lin[j], gains[faceOf(j)], shadeOf(j));
        var bucket = sums[group[j]];
        bucket[0] += fixedJ[0]; bucket[1] += fixedJ[1]; bucket[2] += fixedJ[2];
        bucket[3]++;
      }
      /*
       * With a stated palette the references stay put. That is measured, not
       * assumed: letting them drift towards the photos was tried across 500
       * identical cubes per setting, and firmer was better or tied everywhere
       * — the stated colours are simply better information than nine noisy
       * stickers. Without one, they are re-estimated from the groups each
       * round, with the centres holding which group is which.
       */
      if (!fixed) {
        refs = sums.map(function (bucket, c3) {
          if (!bucket[3]) return refs[c3];
          return [bucket[0] / bucket[3], bucket[1] / bucket[3], bucket[2] / bucket[3]];
        });
      }

      // --- one gain per channel per photo, least squares --------------------
      for (var ph = 0; ph < 6; ph++) {
        var num = [0, 0, 0], den = [0, 0, 0];
        for (var k2 = 0; k2 < 54; k2++) {
          if (faceOf(k2) !== ph) continue;
          var want = refs[group[k2]];
          var k = shadeOf(k2);
          for (var ch2 = 0; ch2 < 3; ch2++) {
            var value = lin[k2][ch2] / k;
            num[ch2] += value * want[ch2];
            den[ch2] += value * value;
          }
        }
        // Regularised towards the prior rather than towards 1. With a known
        // palette the prior is the centre-derived gain, which is an exact
        // correspondence and the most trustworthy thing we have — the
        // least-squares refit over nine stickers should refine it, not
        // override it when the evidence is thin.
        var reg = settings.gainRegulariser;
        var prior = priors[ph];
        gains[ph] = [0, 1, 2].map(function (ch3) {
          return clamp((num[ch3] + reg * prior[ch3]) / (den[ch3] + reg),
                       settings.gainLimit[0], settings.gainLimit[1]);
        });
      }

      if (settings.shading) {
        for (var ph2 = 0; ph2 < 6; ph2++) {
          var members = [];
          for (var q = 0; q < 54; q++) if (faceOf(q) === ph2) members.push(q);
          shading[ph2] = fitShading(members, lin, gains, refs, group, ph2,
                                    settings.shadingLimit);
        }
      }

      // Without a stated palette nothing fixes the overall scale, so hold the
      // gains at a geometric mean of 1 and let the references absorb the rest.
      if (!fixed) {
        var logSum = 0;
        gains.forEach(function (g) {
          logSum += Math.log(g[0]) + Math.log(g[1]) + Math.log(g[2]);
        });
        var scale = Math.exp(-logSum / 18);
        gains = gains.map(function (g) {
          return [clamp(g[0] * scale, settings.gainLimit[0], settings.gainLimit[1]),
                  clamp(g[1] * scale, settings.gainLimit[0], settings.gainLimit[1]),
                  clamp(g[2] * scale, settings.gainLimit[0], settings.gainLimit[1])];
        });
      }
    }

    // How clear-cut each sticker was: the gap to the runner-up group.
    var confidence = [];
    for (var m = 0; m < 54; m++) {
      var mine = cost[m][group[m]], best = Infinity;
      for (var c4 = 0; c4 < 6; c4++) if (c4 !== group[m]) best = Math.min(best, cost[m][c4]);
      confidence[m] = clamp((best - mine) / 100 / 22, 0, 1);
    }

    return {
      faces: group.map(function (g) { return FACES[g]; }),
      groups: group,
      confidence: confidence,
      // Per-photo correction that was applied, so the app can point at a
      // photo that needed an unusual amount of it.
      gains: gains,
      shading: shading,
      references: refs.map(Colour.linearToSrgb),
      rounds: rounds
    };
  }

  /**
   * Read a cube from its photos. This is the entry point; `solve` is one
   * attempt at it.
   *
   * Two sets of reference colours are worth trying. The palette the user
   * stated is better information on an unusual cube, where estimated
   * references can settle into the wrong grouping. Estimating them from the
   * photos is better on an ordinary cube, because it adapts to the light in
   * the room rather than to what the colours ought to be.
   *
   * Which one won cannot be known in advance — but it can be checked
   * afterwards, because a misread almost always describes a cube that cannot
   * exist (a colour appearing ten times, two identical corners). So: try
   * both, keep the one that describes a real cube. Across 500 identical cubes
   * per case, that beat either attempt on its own everywhere — stickers wrong
   * in mixed lighting fell from 0.36% and 0.29% to 0.14%, and cubes read
   * perfectly rose from 93% to 98%.
   */
  function read(samples, options) {
    options = options || {};
    var attempts = [];

    if (options.palette) {
      var refs = FACES.map(function (face) {
        var hex = Colour.normaliseHex(options.palette[face]);
        return hex ? Colour.hexToRgb(hex) : { r: 128, g: 128, b: 128 };
      });
      attempts.push({ source: 'palette', result: solve(samples, { references: refs }) });
    }
    attempts.push({ source: 'photos', result: solve(samples, {}) });

    attempts.forEach(function (attempt) {
      attempt.valid = Cube.validate(attempt.result.faces).ok;
    });

    // A readable cube wins; otherwise keep the first attempt, which is the
    // stated palette when there is one.
    var chosen = attempts.filter(function (a) { return a.valid; })[0] || attempts[0];

    var out = chosen.result;
    out.source = chosen.source;
    out.attempts = attempts.map(function (a) {
      return { source: a.source, valid: a.valid };
    });
    return out;
  }

  return {
    read: read, solve: solve,
    FACES: FACES, CENTRES: CENTRES, DEFAULTS: DEFAULTS
  };
});
