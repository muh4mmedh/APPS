/*
 * Test suite for the Rubik's solver engine. Run with: node tests/solver.test.cjs
 * Pass a sample count to run a longer sweep: node tests/solver.test.cjs 20000
 */
'use strict';

const Cube = require('../apps/rubiks-solver/js/cube.js');
const Solver = require('../apps/rubiks-solver/js/solver.js');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

console.log('\ncube model');

check('54 facelets with unique geometry', Cube.GEO.length === 54);

check('every face turn has order 4', Cube.FACES.every((f) => {
  let s = Cube.toArray(Cube.SOLVED);
  for (let i = 0; i < 4; i++) s = Cube.applyMove(s, f);
  return Cube.toString(s) === Cube.SOLVED;
}));

check('a turn and its inverse cancel', Cube.ALL_MOVES.every((m) => {
  const s = Cube.applySeq(Cube.toArray(Cube.SOLVED), [m, Cube.invertMove(m)]);
  return Cube.toString(s) === Cube.SOLVED;
}));

check('U cycles the side top rows F->L->B->R', (() => {
  const s = Cube.applyMove(Cube.toArray(Cube.SOLVED), 'U');
  return s[36] === 'F' && s[45] === 'L' && s[9] === 'B' && s[18] === 'R';
})());

check('R cycles F->U->B->D', (() => {
  const s = Cube.applyMove(Cube.toArray(Cube.SOLVED), 'R');
  return s[2] === 'F' && s[45] === 'U' && s[29] === 'B' && s[20] === 'D';
})());

check('a solved cube is valid', Cube.validate(Cube.SOLVED).ok);

// The three classic unreachable states.
check('rejects a single twisted corner', (() => {
  const s = Cube.toArray(Cube.SOLVED);
  const c = Cube.CORNER_FACELETS[0];
  const t = [s[c[0]], s[c[1]], s[c[2]]];
  s[c[0]] = t[2]; s[c[1]] = t[0]; s[c[2]] = t[1];
  return !Cube.validate(s).ok;
})());

check('rejects a single flipped edge', (() => {
  const s = Cube.toArray(Cube.SOLVED);
  const e = Cube.EDGE_FACELETS[0];
  const t = s[e[0]]; s[e[0]] = s[e[1]]; s[e[1]] = t;
  return !Cube.validate(s).ok;
})());

check('rejects two swapped corners', (() => {
  const s = Cube.toArray(Cube.SOLVED);
  const a = Cube.CORNER_FACELETS[0], b = Cube.CORNER_FACELETS[3];
  for (let i = 0; i < 3; i++) { const t = s[a[i]]; s[a[i]] = s[b[i]]; s[b[i]] = t; }
  return !Cube.validate(s).ok;
})());

check('rejects a wrong sticker count', !Cube.validate('U'.repeat(54)).ok);

check('optimise collapses turns', (() => {
  const a = Cube.optimise(['R', 'R']).join(' ') === 'R2';
  const b = Cube.optimise(['R', "R'"]).length === 0;
  const c = Cube.optimise(['R', 'L', "R'"]).join(' ') === 'L';
  const d = Cube.optimise(['R', 'U', "U'", "R'"]).length === 0;
  return a && b && c && d;
})());

console.log('\nsolver tables');

check('cross table covers every cross state (190080)',
  Solver._internals.crossStateCount() === 190080,
  String(Solver._internals.crossStateCount()));

check('cross is always solvable in 8 moves or fewer',
  Solver._internals.crossMaxDepth() === 8, String(Solver._internals.crossMaxDepth()));

check('last-layer search reaches all 62208 states',
  Solver._internals.llStateCount() === 62208,
  String(Solver._internals.llStateCount()));

console.log('\nsolving random cubes');

const samples = Number(process.argv[2] || 3000);
let solved = 0, sum = 0, max = 0, invariantBreaks = 0;
const errors = {};
const started = Date.now();

for (let i = 0; i < samples; i++) {
  const state = Cube.randomState();

  const cu = Cube.cubies(state);
  const twist = cu.co.reduce((a, b) => a + b, 0) % 3;
  const flip = cu.eo.reduce((a, b) => a + b, 0) % 2;
  if (twist !== 0 || flip !== 0 || Cube.parity(cu.cp) !== Cube.parity(cu.ep)) invariantBreaks++;

  let result;
  try {
    result = Solver.solve(state);
  } catch (err) {
    errors[err.message] = (errors[err.message] || 0) + 1;
    continue;
  }

  const finished = Cube.applySeq(Cube.toArray(state), result.moves);
  if (!Cube.isSolved(finished)) {
    errors['solution did not solve the cube'] = (errors['solution did not solve the cube'] || 0) + 1;
    continue;
  }
  const stageMoves = result.stages.reduce((acc, s) => acc.concat(s.moves), []);
  if (stageMoves.join(' ') !== result.moves.join(' ')) {
    errors['stage moves do not add up to the solution'] = 1;
    continue;
  }
  solved++;
  sum += result.count;
  if (result.count > max) max = result.count;
}

check('scrambles always satisfy the cube invariants', invariantBreaks === 0);
check(samples + ' random cubes all solved', solved === samples,
  solved + '/' + samples + ' ' + JSON.stringify(errors));

const avg = sum / Math.max(solved, 1);
check('average solution stays under 85 moves', avg < 85, avg.toFixed(1));
check('worst solution stays under 130 moves', max < 130, String(max));

console.log('\n  average ' + avg.toFixed(1) + ' moves, longest ' + max +
            ', ' + ((Date.now() - started) / samples).toFixed(2) + ' ms per solve');

console.log('\nsolving awkward cubes');

check('an already-solved cube needs no moves', Solver.solve(Cube.SOLVED).count === 0);

check('a superflip is solved', (() => {
  const seq = "U R2 F B R B2 R U2 L B2 R U' D' R2 F R' L B2 U2 F2";
  const st = Cube.applySeq(Cube.toArray(Cube.SOLVED), seq);
  const r = Solver.solve(st);
  return Cube.isSolved(Cube.applySeq(Cube.toArray(st), r.moves));
})());

check('one turn away from solved is solved in one move',
  Cube.ALL_MOVES.every((m) => {
    const st = Cube.applyMove(Cube.toArray(Cube.SOLVED), m);
    const r = Solver.solve(st);
    return Cube.isSolved(Cube.applySeq(Cube.toArray(st), r.moves)) && r.count === 1;
  }));

check('an invalid cube is refused', (() => {
  try { Solver.solve('U'.repeat(54)); return false; } catch (e) { return true; }
})());

console.log('\n' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
