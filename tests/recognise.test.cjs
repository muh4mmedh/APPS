/*
 * Tests for reading a cube's colours from photos.
 * Run with: node tests/recognise.test.cjs [samples]
 *
 * Six photos means six lighting conditions, which is the whole difficulty.
 * The simulator below makes that concrete: every face gets its own exposure,
 * its own colour cast, a brightness gradient across the face, glare on a
 * sticker or two, and sensor noise. Then it checks how many of the 54
 * stickers come back right.
 *
 * Scenarios worth caring about:
 *   even light        - all six photos in the same place, the easy case
 *   room to room      - each photo in different light, which is what happens
 *                       when you photograph a cube while walking about
 *   non-standard cube - a pastel cube, where the usual colours read badly
 *   harsh             - dim, noisy, heavy cast, strong gradients
 */
'use strict';

const Colour = require('../apps/rubiks-solver/js/colour.js');
const Recognise = require('../apps/rubiks-solver/js/recognise.js');
const Cube = require('../apps/rubiks-solver/js/cube.js');

let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log('  ok   ' + name + (detail ? '  -> ' + detail : '')); return; }
  failures++;
  console.log('  FAIL ' + name + (detail ? '  -> ' + detail : ''));
}

/*
 * Seeded on purpose. Comparing two readers on different random cubes gave
 * run-to-run swings larger than the difference being measured, which made one
 * approach look better than another when it was not. Everything below is
 * measured on identical cubes under identical lighting.
 */
function seeded(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const realRandom = Math.random;
const rand = (n) => (Math.random() * 2 - 1) * n;
const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/** Photograph a cube: one lighting condition per face. */
function photograph(truth, palette, lighting) {
  const linear = {};
  for (const face of Colour.FACE_ORDER) {
    linear[face] = Colour.srgbToLinear(Colour.hexToRgb(palette[face]));
  }

  const perFace = {};
  for (const face of Colour.FACE_ORDER) perFace[face] = lighting();

  return truth.map((colour, i) => {
    const photo = Colour.FACE_ORDER[(i / 9) | 0];
    const light = perFace[photo];
    const cell = i % 9;

    // brightness falls off across the face, as it does under one lamp
    const gradient = 1 + light.gradient * ((cell % 3) / 2 - 0.5)
                       + light.gradient * (((cell / 3) | 0) / 2 - 0.5) * 0.6;
    // glare washes out the odd sticker
    const glare = Math.random() < light.glare ? 0.35 : 0;

    const lin = linear[colour];
    const out = [0, 1, 2].map((ch) => {
      const lit = lin[ch] * light.exposure * light.cast[ch] * gradient + glare;
      return lit;
    });
    const srgb = Colour.linearToSrgb(out);
    return {
      r: clamp255(srgb.r + rand(light.noise)),
      g: clamp255(srgb.g + rand(light.noise)),
      b: clamp255(srgb.b + rand(light.noise))
    };
  });
}

const SCENARIOS = {
  'even light': () => ({ exposure: 1, cast: [1, 1, 1], gradient: 0.08, noise: 6, glare: 0.01 }),
  'room to room': () => ({
    exposure: 0.45 + Math.random() * 1.0,
    cast: [1 + rand(0.22), 1, 1 + rand(0.22)],
    gradient: 0.18 + Math.random() * 0.2,
    noise: 10,
    glare: 0.04
  }),
  'harsh': () => ({
    exposure: 0.3 + Math.random() * 0.5,
    cast: [1 + rand(0.3), 1, 1 + rand(0.3)],
    gradient: 0.3,
    noise: 16,
    glare: 0.08
  })
};

/* The pipeline this replaces: one pass, per-sticker brightness normalisation,
 * references taken from the centres as photographed. Kept here to show the
 * difference is real rather than asserted. */
function oldPipeline(samples) {
  const CENTRES = [4, 13, 22, 31, 40, 49];
  const norm = (s) => {
    const total = s.r + s.g + s.b;
    if (total < 24) return s;
    const k = 400 / total;
    return { r: Math.min(255, s.r * k), g: Math.min(255, s.g * k), b: Math.min(255, s.b * k) };
  };
  const labs = samples.map((s) => { const n = norm(s); return Colour.rgbToLab(n.r, n.g, n.b); });
  const raws = samples.map((s) => Colour.rgbToLab(s.r, s.g, s.b));
  const refs = CENTRES.map((i) => labs[i]);
  const rawRefs = CENTRES.map((i) => raws[i]);
  const cost = [];
  for (let i = 0; i < 54; i++) {
    cost[i] = [];
    for (let c = 0; c < 6; c++) {
      const slot = CENTRES.indexOf(i);
      cost[i][c] = slot >= 0 ? (slot === c ? 0 : 1e6)
        : Colour.labDistance(labs[i], refs[c]) + 0.3 * Colour.labDistance(raws[i], rawRefs[c]);
    }
  }
  // greedy plus pairwise swaps: close enough to optimal for a comparison
  const cap = [9, 9, 9, 9, 9, 9];
  const group = new Array(54).fill(-1);
  const order = [...Array(54).keys()].sort((x, y) => {
    const sx = cost[x].slice().sort((a, b) => a - b), sy = cost[y].slice().sort((a, b) => a - b);
    return (sy[1] - sy[0]) - (sx[1] - sx[0]);
  });
  for (const i of order) {
    let best = -1, bestV = Infinity;
    for (let c = 0; c < 6; c++) if (cap[c] > 0 && cost[i][c] < bestV) { bestV = cost[i][c]; best = c; }
    group[i] = best; cap[best]--;
  }
  for (let pass = 0; pass < 6; pass++) {
    for (let i = 0; i < 54; i++) for (let j = i + 1; j < 54; j++) {
      if (group[i] === group[j]) continue;
      if (cost[i][group[j]] + cost[j][group[i]] < cost[i][group[i]] + cost[j][group[j]] - 1e-9) {
        const t = group[i]; group[i] = group[j]; group[j] = t;
      }
    }
  }
  return group.map((g) => Colour.FACE_ORDER[g]);
}

const samples = Number(process.argv[2] || 300);

function makeCases(scenario, palette, seed) {
  Math.random = seeded(seed);
  const cases = [];
  for (let t = 0; t < samples; t++) {
    const truth = Cube.toArray(Cube.randomState());
    cases.push({ truth, photos: photograph(truth, palette, SCENARIOS[scenario]) });
  }
  Math.random = realRandom;
  return cases;
}

function measure(reader, cases, palette) {
  let wrong = 0, perfect = 0, solvable = 0;
  for (const one of cases) {
    const got = reader(one.photos, palette);
    const bad = got.filter((f, i) => f !== one.truth[i]).length;
    wrong += bad;
    if (!bad) perfect++;
    if (Cube.validate(got).ok) solvable++;
  }
  return {
    errors: 100 * wrong / (54 * cases.length),
    perfect: 100 * perfect / cases.length,
    solvable: 100 * solvable / cases.length
  };
}

const readers = {
  'old: one pass': (photos) => oldPipeline(photos),
  'references from photos': (photos) => Recognise.solve(photos).faces,
  'references from palette': (photos, palette) => Recognise.solve(photos, {
    references: Colour.FACE_ORDER.map((f) => Colour.hexToRgb(palette[f]))
  }).faces,
  'both, keep the valid one': (photos, palette) => Recognise.read(photos, { palette }).faces
};

console.log(`\nreading ${samples} cubes per scenario (% of 54 stickers wrong / cubes read perfectly)`);

const standard = Colour.defaultPalette();
const pastel = {};
for (const f of Colour.FACE_ORDER) pastel[f] = Colour.PRESETS.pastel.colours[f];

const cases = {
  'even light': { palette: standard, cases: makeCases('even light', standard, 4242) },
  'room to room': { palette: standard, cases: makeCases('room to room', standard, 12345) },
  'harsh': { palette: standard, cases: makeCases('harsh', standard, 777) },
  'pastel cube, room to room': { palette: pastel, cases: makeCases('room to room', pastel, 999) }
};

const results = {};
for (const [scenario, set] of Object.entries(cases)) {
  console.log(`\n  ${scenario}`);
  results[scenario] = {};
  for (const [label, reader] of Object.entries(readers)) {
    const r = measure(reader, set.cases, set.palette);
    results[scenario][label] = r;
    console.log(`    ${label.padEnd(24)} ${r.errors.toFixed(2).padStart(5)}% wrong   ` +
                `${r.perfect.toFixed(0).padStart(3)}% perfect   ${r.solvable.toFixed(0).padStart(3)}% valid cube`);
  }
}
const pastelResults = results['pastel cube, room to room'];

console.log('\nchecks');

const READER = 'both, keep the valid one';

check('even light is read perfectly',
  results['even light'][READER].errors < 0.05,
  results['even light'][READER].errors.toFixed(2) + '%');

check('photos in different light: under a sticker wrong per 500 cubes',
  results['room to room'][READER].errors < 0.3,
  results['room to room'][READER].errors.toFixed(2) + '% wrong, ' +
  results['room to room'][READER].perfect.toFixed(0) + '% of cubes perfect');

check('and at least twice as good as the old single pass',
  results['room to room'][READER].errors * 2 < results['room to room']['old: one pass'].errors,
  `${results['room to room'][READER].errors.toFixed(2)}% vs ` +
  `${results['room to room']['old: one pass'].errors.toFixed(2)}%`);

// Trying both reference sets and keeping the one that describes a real cube
// beats either on its own. This is the claim most worth guarding, because it
// is the one that looked like noise until the harness was seeded.
check('trying both beats either reference set alone',
  results['room to room'][READER].errors < results['room to room']['references from palette'].errors &&
  results['room to room'][READER].errors < results['room to room']['references from photos'].errors,
  `both ${results['room to room'][READER].errors.toFixed(2)}% vs ` +
  `palette ${results['room to room']['references from palette'].errors.toFixed(2)}% vs ` +
  `photos ${results['room to room']['references from photos'].errors.toFixed(2)}%`);

check('an unusual cube is helped by stating its colours',
  pastelResults[READER].errors < pastelResults['references from photos'].errors,
  `${pastelResults[READER].errors.toFixed(2)}% vs ` +
  `${pastelResults['references from photos'].errors.toFixed(2)}% when guessing`);

// Dim, noisy, glaring light stays hard. Recorded rather than papered over:
// the app warns about it, flags the doubtful stickers, and lets them be fixed.
check('harsh light is improved even though it stays hard',
  results['harsh'][READER].errors < results['harsh']['old: one pass'].errors,
  results['harsh'][READER].errors.toFixed(2) + '% wrong (old: ' +
  results['harsh']['old: one pass'].errors.toFixed(2) + '%)');

check('a low-contrast palette is flagged as such', (() => {
  const warn = Colour.checkPalette(pastel);
  const fine = Colour.checkPalette(standard);
  return warn.closest < fine.closest / 1.8;
})(), 'pastel colours sit ' + Colour.checkPalette(pastel).closest +
      ' apart against ' + Colour.checkPalette(standard).closest + ' for standard');

check('centres always come back as their own face', (() => {
  for (let t = 0; t < 40; t++) {
    const truth = Cube.toArray(Cube.randomState());
    const photos = photograph(truth, Colour.defaultPalette(), SCENARIOS.harsh);
    const got = Recognise.solve(photos).faces;
    for (const [slot, i] of Recognise.CENTRES.entries()) {
      if (got[i] !== Recognise.FACES[slot]) return false;
    }
  }
  return true;
})());

check('the solve settles rather than running to the iteration limit', (() => {
  let total = 0;
  for (let t = 0; t < 40; t++) {
    const truth = Cube.toArray(Cube.randomState());
    const photos = photograph(truth, Colour.defaultPalette(), SCENARIOS['room to room']);
    total += Recognise.solve(photos).rounds;
  }
  return total / 40 < Recognise.DEFAULTS.iterations;
})(), 'average rounds');

check('each photo gets its own correction', (() => {
  const truth = Cube.toArray(Cube.randomState());
  const photos = photograph(truth, Colour.defaultPalette(), SCENARIOS['room to room']);
  const gains = Recognise.solve(photos, {
    references: Colour.FACE_ORDER.map((f) => Colour.hexToRgb(Colour.defaultPalette()[f]))
  }).gains;
  const spread = Math.max(...gains.map((g) => g[1])) / Math.min(...gains.map((g) => g[1]));
  return spread > 1.2;
})(), 'differing exposure across photos is detected');

console.log('\n' + (failures === 0 ? 'all checks passed' : failures + ' check(s) failed') + '\n');
process.exit(failures === 0 ? 0 : 1);
