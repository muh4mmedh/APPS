/*!
 * cube.js — Rubik's cube model.
 *
 * A state is 54 facelet colours in the order U R F D L B, each face read
 * row-major as seen by someone looking straight at it (U with B at the top of
 * the view, D with F at the top). This is the standard "facelet" layout:
 *
 *              U0 U1 U2
 *              U3 U4 U5
 *              U6 U7 U8
 *   L0 L1 L2   F0 F1 F2   R0 R1 R2   B0 B1 B2
 *   L3 L4 L5   F3 F4 F5   R3 R4 R5   B3 B4 B5
 *   L6 L7 L8   F6 F7 F8   R6 R7 R8   B6 B7 B8
 *              D0 D1 D2
 *              D3 D4 D5
 *              D6 D7 D8
 *
 * Every permutation table in here is derived from 3D geometry at load time
 * rather than typed out, so the move tables cannot drift out of sync with the
 * facelet layout.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.RS = root.RS || {}; root.RS.Cube = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var FACES = ['U', 'R', 'F', 'D', 'L', 'B'];
  var OFFSET = { U: 0, R: 9, F: 18, D: 27, L: 36, B: 45 };
  var SOLVED = 'UUUUUUUUURRRRRRRRRFFFFFFFFFDDDDDDDDDLLLLLLLLLBBBBBBBBB';

  // Outward normal, plus the "up" and "right" directions of each face as it is
  // drawn in the net above.
  var NORMAL = { U: [0, 1, 0], R: [1, 0, 0], F: [0, 0, 1], D: [0, -1, 0], L: [-1, 0, 0], B: [0, 0, -1] };
  var UPV = { U: [0, 0, -1], R: [0, 1, 0], F: [0, 1, 0], D: [0, 0, 1], L: [0, 1, 0], B: [0, 1, 0] };
  var RIGHTV = { U: [1, 0, 0], R: [0, 0, -1], F: [1, 0, 0], D: [1, 0, 0], L: [0, 0, 1], B: [-1, 0, 0] };

  function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
  function scale(a, k) { return [a[0] * k, a[1] * k, a[2] * k]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vkey(p, n) { return p.join(',') + '|' + n.join(','); }

  // Rotate v by -90 degrees about n, i.e. clockwise when viewed from +n.
  function rotCW(v, n) {
    var s = dot(n, v), c = cross(n, v);
    return [n[0] * s - c[0], n[1] * s - c[1], n[2] * s - c[2]];
  }

  // ---------------------------------------------------------------- geometry

  var GEO = [];
  for (var fi = 0; fi < 6; fi++) {
    var f = FACES[fi];
    for (var r = 0; r < 3; r++) {
      for (var c = 0; c < 3; c++) {
        GEO.push({
          pos: add(NORMAL[f], add(scale(UPV[f], 1 - r), scale(RIGHTV[f], c - 1))),
          nrm: NORMAL[f],
          face: f, row: r, col: c
        });
      }
    }
  }
  var LOOKUP = {};
  GEO.forEach(function (g, i) { LOOKUP[vkey(g.pos, g.nrm)] = i; });

  // ------------------------------------------------------------------- moves

  // A move is stored as `src`, where newState[i] = oldState[src[i]].
  function buildTurn(axisNormal, inLayer) {
    var src = new Array(54);
    for (var i = 0; i < 54; i++) src[i] = i;
    for (var j = 0; j < 54; j++) {
      var g = GEO[j];
      if (!inLayer(g)) continue;
      var target = LOOKUP[vkey(rotCW(g.pos, axisNormal), rotCW(g.nrm, axisNormal))];
      src[target] = j;
    }
    return src;
  }

  function compose(a, b) { // apply a, then b
    var out = new Array(54);
    for (var i = 0; i < 54; i++) out[i] = a[b[i]];
    return out;
  }

  var MOVES = {};
  FACES.forEach(function (face) {
    var n = NORMAL[face];
    var one = buildTurn(n, function (g) { return dot(g.pos, n) === 1; });
    MOVES[face] = one;
    MOVES[face + '2'] = compose(one, one);
    MOVES[face + "'"] = compose(compose(one, one), one);
  });

  // Whole-cube rotation about the U axis, in the same direction as a U turn.
  var YROT = buildTurn(NORMAL.U, function () { return true; });
  // A move typed in a frame rotated by y^k acts on the face listed here.
  var YFACE = { U: 'U', D: 'D', F: 'R', R: 'B', B: 'L', L: 'F' };

  function toArray(state) { return typeof state === 'string' ? state.split('') : state.slice(); }
  function toString(state) { return typeof state === 'string' ? state : state.join(''); }

  function permute(state, src) {
    var out = new Array(54);
    for (var i = 0; i < 54; i++) out[i] = state[src[i]];
    return out;
  }

  function parse(seq) {
    if (Array.isArray(seq)) return seq.slice();
    return seq.split(/\s+/).filter(function (t) { return t.length > 0; });
  }

  function applyMove(state, move) {
    var src = MOVES[move];
    if (!src) throw new Error('unknown move: ' + move);
    return permute(state, src);
  }

  function applySeq(state, seq) {
    var s = state;
    parse(seq).forEach(function (m) { s = applyMove(s, m); });
    return s;
  }

  function invertMove(m) {
    if (m.length === 1) return m + "'";
    return m[1] === '2' ? m : m[0];
  }

  function invertSeq(seq) { return parse(seq).map(invertMove).reverse(); }

  function translateMove(move, frame) {
    var face = move[0];
    for (var i = 0; i < ((frame % 4) + 4) % 4; i++) face = YFACE[face];
    return face + move.slice(1);
  }

  // ------------------------------------------------------------------ pieces

  var CORNER_POS = [[1, 1, 1], [-1, 1, 1], [-1, 1, -1], [1, 1, -1],
                    [1, -1, 1], [-1, -1, 1], [-1, -1, -1], [1, -1, -1]];
  var CORNER_NAMES = ['URF', 'UFL', 'ULB', 'UBR', 'DFR', 'DLF', 'DBL', 'DRB'];
  var EDGE_POS = [[1, 1, 0], [0, 1, 1], [-1, 1, 0], [0, 1, -1],
                  [1, -1, 0], [0, -1, 1], [-1, -1, 0], [0, -1, -1],
                  [1, 0, 1], [-1, 0, 1], [-1, 0, -1], [1, 0, -1]];
  var EDGE_NAMES = ['UR', 'UF', 'UL', 'UB', 'DR', 'DF', 'DL', 'DB', 'FR', 'FL', 'BL', 'BR'];

  function faceletsAt(pos) {
    var out = [];
    for (var i = 0; i < 54; i++) {
      var p = GEO[i].pos;
      if (p[0] === pos[0] && p[1] === pos[1] && p[2] === pos[2]) out.push(i);
    }
    return out;
  }

  // Corner facelets, ordered clockwise as seen from outside the corner and
  // starting with the sticker on U or D. That makes "orientation" the index of
  // the U/D-coloured sticker, which is the usual convention.
  var CORNER_FACELETS = CORNER_POS.map(function (pos) {
    var ids = faceletsAt(pos);
    var first = ids.filter(function (i) { return GEO[i].nrm[1] !== 0; })[0];
    var rest = ids.filter(function (i) { return i !== first; });
    var clockwise = dot(cross(GEO[first].nrm, GEO[rest[0]].nrm), pos) < 0;
    return clockwise ? [first, rest[0], rest[1]] : [first, rest[1], rest[0]];
  });

  // Edge facelets, the U/D sticker first where there is one, otherwise the
  // F/B sticker. Orientation is 0 when the piece's own primary colour sits on
  // the slot's primary facelet.
  var EDGE_FACELETS = EDGE_POS.map(function (pos) {
    var ids = faceletsAt(pos);
    var first = ids.filter(function (i) { return GEO[i].nrm[1] !== 0; })[0];
    if (first === undefined) first = ids.filter(function (i) { return GEO[i].nrm[2] !== 0; })[0];
    var other = ids.filter(function (i) { return i !== first; })[0];
    return [first, other];
  });

  var CORNER_COLOURS = CORNER_FACELETS.map(function (fl) {
    return fl.map(function (i) { return SOLVED[i]; });
  });
  var EDGE_COLOURS = EDGE_FACELETS.map(function (fl) {
    return fl.map(function (i) { return SOLVED[i]; });
  });

  function isPrimaryUD(ch) { return ch === 'U' || ch === 'D'; }
  function isPrimaryFB(ch) { return ch === 'F' || ch === 'B'; }

  /** Facelets -> cubie level description, or null if some piece is impossible. */
  function cubies(state) {
    var s = toArray(state);
    var cp = [], co = [], ep = [], eo = [], i, j, k;

    for (i = 0; i < 8; i++) {
      var cc = CORNER_FACELETS[i].map(function (x) { return s[x]; });
      var ori = -1;
      for (k = 0; k < 3; k++) if (isPrimaryUD(cc[k])) { ori = k; break; }
      if (ori < 0) return null;
      var a = cc[ori], b = cc[(ori + 1) % 3], c = cc[(ori + 2) % 3];
      var found = -1;
      for (j = 0; j < 8; j++) {
        var t = CORNER_COLOURS[j];
        if (t[0] === a && t[1] === b && t[2] === c) { found = j; break; }
      }
      if (found < 0) return null;
      cp[i] = found; co[i] = ori;
    }

    for (i = 0; i < 12; i++) {
      var ec = EDGE_FACELETS[i].map(function (x) { return s[x]; });
      var eori;
      if (isPrimaryUD(ec[0])) eori = 0;
      else if (isPrimaryUD(ec[1])) eori = 1;
      else if (isPrimaryFB(ec[0])) eori = 0;
      else if (isPrimaryFB(ec[1])) eori = 1;
      else return null;
      var ea = ec[eori], eb = ec[1 - eori];
      var efound = -1;
      for (j = 0; j < 12; j++) {
        if (EDGE_COLOURS[j][0] === ea && EDGE_COLOURS[j][1] === eb) { efound = j; break; }
      }
      if (efound < 0) return null;
      ep[i] = efound; eo[i] = eori;
    }
    return { cp: cp, co: co, ep: ep, eo: eo };
  }

  /** Per-move cubie tables: a piece at slot i lands on slot perm[i], twisted. */
  function cubieTable(src) {
    var fwd = new Array(54), i, k;
    for (i = 0; i < 54; i++) fwd[src[i]] = i;

    function slotOf(list, facelets) {
      for (var j = 0; j < list.length; j++) {
        var ok = facelets.every(function (x) { return list[j].indexOf(x) >= 0; });
        if (ok) return j;
      }
      return -1;
    }

    var cperm = [], ctw = [], eperm = [], efl = [];
    for (i = 0; i < 8; i++) {
      var moved = CORNER_FACELETS[i].map(function (x) { return fwd[x]; });
      var j = slotOf(CORNER_FACELETS, moved);
      cperm[i] = j;
      ctw[i] = CORNER_FACELETS[j].indexOf(moved[0]);
    }
    for (i = 0; i < 12; i++) {
      var emoved = EDGE_FACELETS[i].map(function (x) { return fwd[x]; });
      var ej = slotOf(EDGE_FACELETS, emoved);
      eperm[i] = ej;
      efl[i] = EDGE_FACELETS[ej].indexOf(emoved[0]);
    }
    return { cperm: cperm, ctw: ctw, eperm: eperm, efl: efl };
  }

  var CUBIE_MOVES = {};
  Object.keys(MOVES).forEach(function (m) { CUBIE_MOVES[m] = cubieTable(MOVES[m]); });

  // -------------------------------------------------------------- validation

  function parity(perm) {
    var seen = new Array(perm.length).fill(false), swaps = 0;
    for (var i = 0; i < perm.length; i++) {
      if (seen[i]) continue;
      var len = 0, j = i;
      while (!seen[j]) { seen[j] = true; j = perm[j]; len++; }
      swaps += len - 1;
    }
    return swaps % 2;
  }

  /**
   * Is this a state a real cube can actually be in? Returns
   * { ok, error, hint } with a message aimed at someone who just scanned it.
   */
  function validate(state) {
    var s = toArray(state);
    if (s.length !== 54) return { ok: false, error: 'A cube needs 54 stickers, got ' + s.length + '.' };

    var counts = {};
    for (var i = 0; i < 54; i++) counts[s[i]] = (counts[s[i]] || 0) + 1;
    for (var fi2 = 0; fi2 < 6; fi2++) {
      var face = FACES[fi2];
      var n = counts[face] || 0;
      if (n !== 9) {
        return {
          ok: false,
          error: 'The ' + face + ' colour appears ' + n + ' times — every colour must appear exactly 9 times.',
          hint: 'Fix the stickers on the review grid, then try again.'
        };
      }
      if (s[OFFSET[face] + 4] !== face) return { ok: false, error: 'Centre stickers are inconsistent.' };
    }

    var cu = cubies(s);
    if (!cu) {
      return {
        ok: false,
        error: 'Some corner or edge has an impossible colour pair.',
        hint: 'Two stickers of the same piece cannot share a colour, and opposite colours cannot meet on one piece.'
      };
    }

    var seenC = new Array(8).fill(0);
    cu.cp.forEach(function (p) { seenC[p]++; });
    if (seenC.some(function (n2) { return n2 !== 1; })) {
      return { ok: false, error: 'Two corners are the same piece.', hint: 'Recheck the corner stickers on the review grid.' };
    }
    var seenE = new Array(12).fill(0);
    cu.ep.forEach(function (p) { seenE[p]++; });
    if (seenE.some(function (n3) { return n3 !== 1; })) {
      return { ok: false, error: 'Two edges are the same piece.', hint: 'Recheck the edge stickers on the review grid.' };
    }

    var twist = cu.co.reduce(function (a, b) { return a + b; }, 0) % 3;
    if (twist !== 0) {
      return {
        ok: false, error: 'A corner is twisted the wrong way.',
        hint: 'Usually one corner was read with its colours rotated — check the corners of the faces you scanned last.'
      };
    }
    var flip = cu.eo.reduce(function (a, b) { return a + b; }, 0) % 2;
    if (flip !== 0) {
      return {
        ok: false, error: 'An edge is flipped the wrong way.',
        hint: 'One edge has its two colours swapped — check the edge stickers on the review grid.'
      };
    }
    if (parity(cu.cp) !== parity(cu.ep)) {
      return {
        ok: false, error: 'Two pieces are swapped.',
        hint: 'This state cannot be reached by turning a cube — two stickers are probably mixed up.'
      };
    }
    return { ok: true };
  }

  function isSolvedFacelet(state, i) { return state[i] === state[((i / 9) | 0) * 9 + 4]; }

  function isSolved(state) {
    for (var i = 0; i < 54; i++) if (!isSolvedFacelet(state, i)) return false;
    return true;
  }

  function findCorner(state, colours) {
    for (var i = 0; i < 8; i++) {
      var got = CORNER_FACELETS[i].map(function (x) { return state[x]; });
      if (colours.every(function (c) { return got.indexOf(c) >= 0; })) return i;
    }
    return -1;
  }

  function findEdge(state, colours) {
    for (var i = 0; i < 12; i++) {
      var got = EDGE_FACELETS[i].map(function (x) { return state[x]; });
      if (colours.every(function (c) { return got.indexOf(c) >= 0; })) return i;
    }
    return -1;
  }

  var OPPOSITE = { U: 'D', D: 'U', R: 'L', L: 'R', F: 'B', B: 'F' };

  /** Collapse same-face turns, looking through turns of the opposite face. */
  function optimise(seq) {
    var moves = parse(seq);
    for (;;) {
      var out = [];
      for (var i = 0; i < moves.length; i++) {
        var m = moves[i];
        var face = m[0];
        var amt = m.length === 1 ? 1 : (m[1] === '2' ? 2 : 3);
        var j = out.length - 1;
        while (j >= 0 && out[j].face !== face && OPPOSITE[out[j].face] === face) j--;
        if (j >= 0 && out[j].face === face) {
          out[j].amt = (out[j].amt + amt) % 4;
          if (out[j].amt === 0) out.splice(j, 1);
          continue;
        }
        out.push({ face: face, amt: amt });
      }
      var next = out.map(function (x) {
        return x.face + (x.amt === 1 ? '' : x.amt === 2 ? '2' : "'");
      });
      if (next.length === moves.length) return next;
      moves = next;
    }
  }

  var ALL_MOVES = [];
  FACES.forEach(function (f2) { ALL_MOVES.push(f2, f2 + '2', f2 + "'"); });

  function scramble(n) {
    var seq = [], last = '';
    n = n || 25;
    while (seq.length < n) {
      var m = ALL_MOVES[(Math.random() * ALL_MOVES.length) | 0];
      if (m[0] === last) continue;
      last = m[0];
      seq.push(m);
    }
    return seq;
  }

  function randomState() { return toString(applySeq(toArray(SOLVED), scramble(30))); }

  return {
    FACES: FACES, OFFSET: OFFSET, SOLVED: SOLVED, GEO: GEO, MOVES: MOVES,
    ALL_MOVES: ALL_MOVES, CUBIE_MOVES: CUBIE_MOVES, YROT: YROT, YFACE: YFACE,
    CORNER_FACELETS: CORNER_FACELETS, EDGE_FACELETS: EDGE_FACELETS,
    CORNER_NAMES: CORNER_NAMES, EDGE_NAMES: EDGE_NAMES,
    CORNER_COLOURS: CORNER_COLOURS, EDGE_COLOURS: EDGE_COLOURS,
    toArray: toArray, toString: toString, parse: parse, permute: permute,
    applyMove: applyMove, applySeq: applySeq, invertMove: invertMove, invertSeq: invertSeq,
    translateMove: translateMove, cubies: cubies, validate: validate, parity: parity,
    isSolved: isSolved, isSolvedFacelet: isSolvedFacelet,
    findCorner: findCorner, findEdge: findEdge,
    optimise: optimise, scramble: scramble, randomState: randomState
  };
});
