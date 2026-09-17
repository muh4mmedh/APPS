/*!
 * solver.js — layer-by-layer solver.
 *
 * The method is the one a person actually follows with a cube in their hands,
 * so every stage of the answer means something:
 *
 *   1. bottom cross      — solved optimally from a breadth-first table
 *   2. bottom corners    — standard insertions, shortest one that fits
 *   3. middle layer      — standard insertions, shortest one that fits
 *   4. last layer        — shortest combination of known algorithms, from a
 *                          Dijkstra search over all 62 208 last-layer states
 *
 * Stages 1 and 4 are searched, so they are as short as the method allows.
 * Stages 2 and 3 pick the shortest algorithm that solves the target piece
 * *and* provably leaves everything already solved alone, which is what keeps
 * the whole thing honest: no stage can quietly undo an earlier one.
 */
(function (root, factory) {
  var Cube = (typeof module === 'object' && module.exports)
    ? require('./cube.js')
    : root.RS.Cube;
  var api = factory(Cube);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Solver = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Cube) {
  'use strict';

  var CF = Cube.CORNER_FACELETS, EF = Cube.EDGE_FACELETS;

  var LL_FACELETS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 18, 19, 20, 36, 37, 38, 45, 46, 47];
  var F2L_FACELETS = [];
  for (var _i = 0; _i < 54; _i++) if (LL_FACELETS.indexOf(_i) < 0) F2L_FACELETS.push(_i);

  // A stage may disturb the layers it has not reached yet, so each one guards
  // only the facelets below it. Guarding more than that would reject every
  // standard insertion whenever a later piece happened to be solved by luck.
  var BOTTOM_FACELETS = [27, 28, 29, 30, 31, 32, 33, 34, 35,
                         24, 25, 26, 15, 16, 17, 42, 43, 44, 51, 52, 53];
  var MIDDLE_FACELETS = [21, 22, 23, 12, 13, 14, 39, 40, 41, 48, 49, 50];
  var THROUGH_MIDDLE = BOTTOM_FACELETS.concat(MIDDLE_FACELETS);

  // ------------------------------------------------------- bottom cross table

  // An edge "slot" is position * 2 + orientation, so 0..23.
  var SLOT_MOVE = {};
  Cube.ALL_MOVES.forEach(function (m) {
    var t = Cube.CUBIE_MOVES[m], table = new Uint8Array(24);
    for (var pos = 0; pos < 12; pos++) {
      for (var ori = 0; ori < 2; ori++) {
        table[pos * 2 + ori] = t.eperm[pos] * 2 + ((ori + t.efl[pos]) % 2);
      }
    }
    SLOT_MOVE[m] = table;
  });

  var CROSS_PIECES = [4, 5, 6, 7];           // DR, DF, DL, DB
  var CROSS_SIZE = 24 * 24 * 24 * 24;
  var crossDist = null, crossFrom = null, crossSolvedCode = 0;

  function crossEncode(slots) {
    return ((slots[0] * 24 + slots[1]) * 24 + slots[2]) * 24 + slots[3];
  }
  function crossDecode(code) {
    return [(code / 13824) | 0, ((code / 576) | 0) % 24, ((code / 24) | 0) % 24, code % 24];
  }
  function crossStep(code, move) {
    var t = SLOT_MOVE[move], s = crossDecode(code);
    return crossEncode([t[s[0]], t[s[1]], t[s[2]], t[s[3]]]);
  }
  function crossCodeOf(state) {
    var cu = Cube.cubies(state), slots = [];
    CROSS_PIECES.forEach(function (piece) {
      for (var i = 0; i < 12; i++) if (cu.ep[i] === piece) slots.push(i * 2 + cu.eo[i]);
    });
    return crossEncode(slots);
  }

  function buildCrossTable() {
    if (crossDist) return;
    crossDist = new Uint8Array(CROSS_SIZE).fill(255);
    crossFrom = new Uint8Array(CROSS_SIZE).fill(255);
    crossSolvedCode = crossEncode(CROSS_PIECES.map(function (p) { return p * 2; }));
    crossDist[crossSolvedCode] = 0;
    var frontier = [crossSolvedCode];
    for (var depth = 0; frontier.length; depth++) {
      var next = [];
      for (var f = 0; f < frontier.length; f++) {
        var code = frontier[f];
        for (var mi = 0; mi < Cube.ALL_MOVES.length; mi++) {
          var to = crossStep(code, Cube.ALL_MOVES[mi]);
          if (crossDist[to] !== 255) continue;
          crossDist[to] = depth + 1;
          crossFrom[to] = mi;
          next.push(to);
        }
      }
      frontier = next;
    }
  }

  function crossSolution(state) {
    buildCrossTable();
    var code = crossCodeOf(state), out = [];
    var guard = 0;
    while (code !== crossSolvedCode) {
      if (crossDist[code] === 255 || guard++ > 40) throw new Error('cross lookup failed');
      var undo = Cube.invertMove(Cube.ALL_MOVES[crossFrom[code]]);
      out.push(undo);
      code = crossStep(code, undo);
    }
    return out;
  }

  /**
   * Up to `limit` different shortest crosses. They all cost the same, but the
   * one you pick changes how much work the later stages have, so the caller
   * tries several and keeps whichever leads to the shortest solve overall.
   */
  function crossSolutions(state, limit) {
    buildCrossTable();
    var start = crossCodeOf(state);
    if (crossDist[start] === 255) throw new Error('cross lookup failed');
    var found = [], seen = {};
    for (var attempt = 0; attempt < limit * 12 && found.length < limit; attempt++) {
      var code = start, seq = [], stuck = false;
      while (code !== crossSolvedCode) {
        var options = [];
        for (var mi = 0; mi < Cube.ALL_MOVES.length; mi++) {
          var to = crossStep(code, Cube.ALL_MOVES[mi]);
          if (crossDist[to] === crossDist[code] - 1) options.push(mi);
        }
        if (!options.length) { stuck = true; break; }
        var pick = options[(Math.random() * options.length) | 0];
        seq.push(Cube.ALL_MOVES[pick]);
        code = crossStep(code, Cube.ALL_MOVES[pick]);
      }
      if (stuck) break;
      var keyStr = seq.join(' ');
      if (!seen[keyStr]) { seen[keyStr] = true; found.push(seq); }
    }
    return found.length ? found : [crossSolution(state)];
  }

  // -------------------------------------------------------- last layer table

  // Known algorithms, all of which leave the first two layers untouched.
  // Anything in this list that turns out to disturb the first two layers is
  // dropped when the table is built, and each entry's real effect is measured
  // rather than assumed — so a wrong entry can only cost moves, never
  // correctness. More entries here means a shorter last layer.
  var LL_ALGS = [
    'U', "U'", 'U2',
    // orient the last-layer edges
    "F R U R' U' F'",
    "F U R U' R' F'",
    "R U R' U' R' F R F'",
    // orient the last-layer corners
    "R U R' U R U2 R'",                                // Sune
    "R U2 R' U' R U' R'",                              // anti-Sune
    "R U R' U R U' R' U R U2 R'",                      // double Sune
    "R U2 R2 U' R2 U' R2 U2 R",                        // Pi
    "F R' F' R U R U' R'",                             // L
    "R2 D R' U2 R D' R' U2 R'",                        // U
    // permute the last-layer corners
    "R' F R' B2 R F' R' B2 R2",                        // Aa
    "R2 B2 R F R' B2 R F' R",                          // Ab
    "R U R' U' R' F R2 U' R' U' R U R' F'",            // T
    "R' U L' U2 R U' R' U2 R L U'",                    // Ja
    "R U R' F' R U R' U' R' F R2 U' R' U'",            // Jb
    "F R U' R' U' R U R' F' R U R' U' R' F R F'",      // Y
    "R2 F R U R U' R' F' R U2 R' U2 R",                // Rb
    "R U' R' U' R U R D R' U' R D' R' U2 R'",          // Ra
    // permute the last-layer edges
    "R U' R U R U R U' R' U' R2",                      // Ua
    "R2 U R U R' U' R' U' R' U R'",                    // Ub
    "R2 U2 R U2 R2 U2 R2 U2 R U2 R2",                  // H
    // mixed
    "R U R' U R U' R' U R U2 R'",
    "R2 U R' U R' U' R U' R2 U' D R' U R D'",          // Gc
    "R U R' U' D R2 U' R U' R' U R' U R2 D'"           // Gd
  ];

  var FACT = [6, 2, 1, 1];
  function permRank(p) {
    var r = 0;
    for (var i = 0; i < 4; i++) {
      var c = 0;
      for (var j = i + 1; j < 4; j++) if (p[j] < p[i]) c++;
      r = r * (4 - i) + c;
    }
    return r;
  }
  function permUnrank(r) {
    var avail = [0, 1, 2, 3], p = [];
    for (var i = 0; i < 4; i++) {
      var idx = (r / FACT[i]) | 0;
      r %= FACT[i];
      p.push(avail.splice(idx, 1)[0]);
    }
    return p;
  }

  var LL_SIZE = 648 * 192;
  var llGens = null, llDist = null, llPrev = null, llPrevGen = null;

  function llCubieEffect(seq) {
    var st = Cube.applySeq(Cube.toArray(Cube.SOLVED), seq);
    for (var k = 0; k < F2L_FACELETS.length; k++) {
      if (!Cube.isSolvedFacelet(st, F2L_FACELETS[k])) return null; // disturbs F2L
    }
    var cu = Cube.cubies(st);
    var cperm = [], ctw = [], eperm = [], efl = [], j;
    for (j = 0; j < 4; j++) {
      if (cu.cp[j] > 3 || cu.ep[j] > 3) return null;
      cperm[cu.cp[j]] = j; ctw[cu.cp[j]] = cu.co[j];
      eperm[cu.ep[j]] = j; efl[cu.ep[j]] = cu.eo[j];
    }
    return { cperm: cperm, ctw: ctw, eperm: eperm, efl: efl };
  }

  function buildLLTable() {
    if (llDist) return;
    llGens = [];
    LL_ALGS.forEach(function (alg) {
      [Cube.parse(alg), Cube.invertSeq(alg)].forEach(function (seq) {
        var eff = llCubieEffect(seq);
        if (!eff) return;
        var name = seq.join(' ');
        if (llGens.some(function (g) { return g.name === name; })) return;
        llGens.push({ name: name, seq: seq, undo: Cube.invertSeq(seq), cost: seq.length, eff: eff });
      });
    });

    // The corner half and the edge half of a last-layer state move
    // independently, so each generator needs only two small tables.
    llGens.forEach(function (g) {
      var ct = new Int32Array(648), et = new Int32Array(192), i, o;
      for (i = 0; i < 648; i++) {
        var cp = permUnrank((i / 27) | 0), cor = i % 27;
        var co = [((cor / 9) | 0) % 3, ((cor / 3) | 0) % 3, cor % 3];
        co[3] = (9 - co[0] - co[1] - co[2]) % 3;
        var ncp = [], nco = [];
        for (o = 0; o < 4; o++) {
          ncp[g.eff.cperm[o]] = cp[o];
          nco[g.eff.cperm[o]] = (co[o] + g.eff.ctw[o]) % 3;
        }
        ct[i] = permRank(ncp) * 27 + (nco[0] * 9 + nco[1] * 3 + nco[2]);
      }
      for (i = 0; i < 192; i++) {
        var ep = permUnrank((i / 8) | 0), eor = i % 8;
        var eo = [(eor >> 2) & 1, (eor >> 1) & 1, eor & 1];
        eo[3] = (eo[0] + eo[1] + eo[2]) % 2;
        var nep = [], neo = [];
        for (o = 0; o < 4; o++) {
          nep[g.eff.eperm[o]] = ep[o];
          neo[g.eff.eperm[o]] = (eo[o] + g.eff.efl[o]) % 2;
        }
        et[i] = permRank(nep) * 8 + (neo[0] * 4 + neo[1] * 2 + neo[2]);
      }
      g.ct = ct; g.et = et;
    });

    llDist = new Int32Array(LL_SIZE).fill(-1);
    llPrev = new Int32Array(LL_SIZE).fill(-1);
    llPrevGen = new Int8Array(LL_SIZE).fill(-1);

    var start = 0 * 192 + 0; // solved: identity permutations, no twists
    llDist[start] = 0;
    var buckets = [[start]];
    for (var d = 0; d < buckets.length; d++) {
      var bucket = buckets[d];
      if (!bucket) continue;
      for (var bi = 0; bi < bucket.length; bi++) {
        var idx = bucket[bi];
        if (llDist[idx] !== d) continue;
        var cIdx = (idx / 192) | 0, eIdx = idx % 192;
        for (var gi = 0; gi < llGens.length; gi++) {
          var g = llGens[gi];
          var to = g.ct[cIdx] * 192 + g.et[eIdx];
          var nd = d + g.cost;
          if (llDist[to] >= 0 && llDist[to] <= nd) continue;
          llDist[to] = nd; llPrev[to] = idx; llPrevGen[to] = gi;
          (buckets[nd] = buckets[nd] || []).push(to);
        }
      }
      bucket.length = 0;
    }
  }

  function llIndexOf(state) {
    var cu = Cube.cubies(state);
    var cp = cu.cp.slice(0, 4), co = cu.co.slice(0, 4);
    var ep = cu.ep.slice(0, 4), eo = cu.eo.slice(0, 4);
    if (cp.some(function (v) { return v > 3; }) || ep.some(function (v) { return v > 3; })) return -1;
    var cIdx = permRank(cp) * 27 + (co[0] * 9 + co[1] * 3 + co[2]);
    var eIdx = permRank(ep) * 8 + (eo[0] * 4 + eo[1] * 2 + eo[2]);
    return cIdx * 192 + eIdx;
  }

  function llSolution(state) {
    buildLLTable();
    var idx = llIndexOf(state);
    if (idx < 0 || llDist[idx] < 0) throw new Error('last layer lookup failed');
    var out = [], guard = 0;
    while (idx !== 0) {
      if (guard++ > 30) throw new Error('last layer walk failed');
      var g = llGens[llPrevGen[idx]];
      out = out.concat(g.undo);
      idx = llPrev[idx];
    }
    return out;
  }

  // ------------------------------------------------------------- solve helper

  function Ctx(state) {
    this.work = Cube.toArray(state);
    this.frame = 0;
    this.moves = [];
  }
  Ctx.prototype.centre = function (face) { return this.work[Cube.OFFSET[face] + 4]; };
  Ctx.prototype.setFrame = function (k) {
    k = ((k % 4) + 4) % 4;
    while (this.frame !== k) {
      this.work = Cube.permute(this.work, Cube.YROT);
      this.frame = (this.frame + 1) % 4;
    }
  };
  Ctx.prototype.clone = function () {
    var c = new Ctx(this.work);
    c.frame = this.frame;
    c.moves = this.moves.slice();
    return c;
  };
  Ctx.prototype.adopt = function (other) {
    this.work = other.work; this.frame = other.frame; this.moves = other.moves;
  };
  Ctx.prototype.run = function (seq) {
    var self = this;
    Cube.parse(seq).forEach(function (m) {
      self.work = Cube.applyMove(self.work, m);
      self.moves.push(Cube.translateMove(m, self.frame));
    });
  };

  var AUF = [[], ['U'], ['U2'], ["U'"]];

  function withSetups(algs) {
    var out = [];
    algs.forEach(function (alg) {
      AUF.forEach(function (pre) { out.push(pre.concat(Cube.parse(alg))); });
    });
    return out.sort(function (a, b) { return a.length - b.length; });
  }

  var CORNER_ALGS = withSetups([
    "R U R'", "R U' R'", "R U2 R'",
    "F' U' F", "F' U F", "F' U2 F",
    "R U2 R' U' R U R'", "F' U2 F U F' U' F",
    "R U R' U R U2 R'", "R U' R' U' R U R'",
    "R U2 R' U R U' R'", "F' U' F U F' U' F"
  ]);

  var EDGE_ALGS = withSetups([
    "U R U' R' U' F' U F",
    "U' F' U F U R U' R'"
  ]);

  function pieceSolved(state, facelets) {
    return facelets.every(function (i) { return Cube.isSolvedFacelet(state, i); });
  }

  function keepList(state, scope) {
    return scope.filter(function (i) { return Cube.isSolvedFacelet(state, i); });
  }

  function attempt(ctx, candidates, facelets, scope) {
    var keep = keepList(ctx.work, scope);
    for (var i = 0; i < candidates.length; i++) {
      var test = Cube.applySeq(ctx.work, candidates[i]);
      if (!pieceSolved(test, facelets)) continue;
      var ok = true;
      for (var k = 0; k < keep.length; k++) {
        if (!Cube.isSolvedFacelet(test, keep[k])) { ok = false; break; }
      }
      if (!ok) continue;
      ctx.run(candidates[i]);
      return true;
    }
    return false;
  }

  function solveBottomCorner(ctx) {
    for (var guard = 0; guard < 10; guard++) {
      if (pieceSolved(ctx.work, CF[4])) return;
      if (attempt(ctx, CORNER_ALGS, CF[4], BOTTOM_FACELETS)) continue;
      var colours = [ctx.centre('D'), ctx.centre('F'), ctx.centre('R')];
      var at = Cube.findCorner(ctx.work, colours);
      if (at < 4) throw new Error('no insertion found for corner above its slot');
      var k = (4 - (at - 4)) % 4;           // bring that bottom slot round to DFR
      ctx.setFrame(ctx.frame + k);
      ctx.run("R U R'");                    // lift the corner into the top layer
      ctx.setFrame(ctx.frame - k);
    }
    throw new Error('bottom corner stage stalled');
  }

  function solveMiddleEdge(ctx) {
    for (var guard = 0; guard < 10; guard++) {
      if (pieceSolved(ctx.work, EF[8])) return;
      if (attempt(ctx, EDGE_ALGS, EF[8], THROUGH_MIDDLE)) continue;
      var colours = [ctx.centre('F'), ctx.centre('R')];
      var at = Cube.findEdge(ctx.work, colours);
      if (at < 8) throw new Error('no insertion found for edge in the top layer');
      var k = (4 - (at - 8)) % 4;           // bring that middle slot round to FR
      ctx.setFrame(ctx.frame + k);
      ctx.run("U R U' R' U' F' U F");       // kick the wrong edge out of the slot
      ctx.setFrame(ctx.frame - k);
    }
    throw new Error('middle layer stage stalled');
  }

  /**
   * Solve the four slots of a stage cheapest-first. Which slot you do next
   * changes how much work the others need, so each round measures every
   * remaining slot on a throwaway copy and commits to the cheapest.
   */
  function solveSlotsGreedily(ctx, solveOne) {
    var remaining = [0, 1, 2, 3];
    while (remaining.length) {
      var best = null;
      for (var i = 0; i < remaining.length; i++) {
        var trial = ctx.clone();
        trial.setFrame(remaining[i]);
        solveOne(trial);
        var cost = trial.moves.length - ctx.moves.length;
        if (!best || cost < best.cost) best = { cost: cost, at: i, trial: trial };
      }
      ctx.adopt(best.trial);
      remaining.splice(best.at, 1);
    }
  }

  var STAGE_NOTES = {
    cross: 'Put the four bottom edges in place so the bottom face shows a cross.',
    corners: 'Drop each bottom corner into place from the top layer.',
    middle: 'Insert the four middle-layer edges, finishing two layers.',
    last: 'Orient and permute the top layer to finish the cube.'
  };

  var STAGE_NAMES = {
    cross: 'Bottom cross', corners: 'Bottom corners',
    middle: 'Middle layer', last: 'Last layer'
  };

  function tablesReady() { return !!(crossDist && llDist); }
  function buildTables() { buildCrossTable(); buildLLTable(); }

  function solveWithCross(state, cross) {
    var ctx = new Ctx(state), stages = [], mark = 0;

    function closeStage(key) {
      var moves = Cube.optimise(ctx.moves.slice(mark));
      mark = ctx.moves.length;
      stages.push({ key: key, name: STAGE_NAMES[key], note: STAGE_NOTES[key], moves: moves });
    }

    ctx.run(cross);
    closeStage('cross');

    solveSlotsGreedily(ctx, solveBottomCorner);
    closeStage('corners');

    solveSlotsGreedily(ctx, solveMiddleEdge);
    closeStage('middle');

    ctx.setFrame(0);
    ctx.run(llSolution(ctx.work));
    closeStage('last');

    if (!Cube.isSolved(ctx.work)) throw new Error('internal error: solution does not solve the cube');

    var all = [];
    stages.forEach(function (st) { all = all.concat(st.moves); });
    return {
      moves: all,
      count: all.length,
      stages: stages.filter(function (st) { return st.moves.length > 0; })
    };
  }

  /**
   * Solve a facelet state. Returns { moves, count, stages }, where each stage
   * is { key, name, note, moves }. Throws if the state is not one a real cube
   * can be in — call Cube.validate first for a friendlier message.
   */
  function solve(state, options) {
    var check = Cube.validate(state);
    if (!check.ok) throw new Error(check.error);
    buildTables();

    var tries = (options && options.tries) || 6;
    var best = null;
    crossSolutions(state, tries).forEach(function (cross) {
      var result = solveWithCross(state, cross);
      if (!best || result.count < best.count) best = result;
    });
    return best;
  }

  return {
    solve: solve,
    buildTables: buildTables,
    tablesReady: tablesReady,
    crossSolution: crossSolution,
    crossSolutions: crossSolutions,
    llSolution: llSolution,
    _internals: {
      llStateCount: function () { buildLLTable(); return llDist.filter(function (d) { return d >= 0; }).length; },
      llGenerators: function () { buildLLTable(); return llGens.map(function (g) { return g.name; }); },
      crossStateCount: function () { buildCrossTable(); return crossDist.filter(function (d) { return d !== 255; }).length; },
      crossMaxDepth: function () {
        buildCrossTable();
        var max = 0;
        for (var i = 0; i < crossDist.length; i++) if (crossDist[i] !== 255 && crossDist[i] > max) max = crossDist[i];
        return max;
      }
    }
  };
});
