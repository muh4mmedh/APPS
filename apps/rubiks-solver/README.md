# Rubik's Solver

Show each of the six faces to your camera, check what it read, then follow the
turns. Everything happens in the browser — the camera frames never leave the
device, and there is no server, build step or dependency.

## Your cube's colours

Not every cube is the usual six colours — the Japanese scheme swaps blue and
yellow, and pastel, neon and re-stickered cubes are common. So the palette is
six hex values you can edit, with presets to start from, and it is used both to
draw the cube and to read your photos. Centres are editable too: setting one to
another face's colour trades the two, which is the fix when the faces came out
assigned to the wrong sides.

## Reading colours off photographs

One photo per face, then drag four corners onto the face. A still photo beats a
live feed here: with a camera you are holding a cube in one hand and a phone in
the other, aiming at a moving image, and whatever it grabs, it grabs. With a
photo you take your time, and the colours being read are shown in each cell
while you drag. (The live camera is still there for anyone who prefers it.)

Six photos means six lighting conditions, which is the real difficulty — the
same white sticker is cream under a lamp and blue-ish in shade, so comparing a
sticker from one photo against a reference from another compares two different
things. Three facts do the work:

- **A centre cannot move.** The centre of the face you called "up" *is* that
  face's colour, by definition, so every photo contains one sticker whose true
  colour is known. That is a free, exact colour correspondence per photo.
- **Lighting is close to a per-channel multiplier**, so one gain per channel per
  photo covers most of it — fitted in linear light, where the multiplication
  actually holds. A plane fitted across each face covers the rest, which is the
  shape a single lamp off to one side really makes.
- **A cube has exactly nine of each colour**, so the final read is one balanced
  assignment over all 54, solved exactly with min-cost flow.

They are circular — the gains need the assignment, the assignment needs the
gains — so it alternates between them until the assignment stops changing.

One more trick doubles the accuracy for free. Two sets of reference colours are
worth trying: the palette you stated (better on an unusual cube) and references
estimated from the photos (better on an ordinary one, because they adapt to the
room). Which wins cannot be known in advance, but it *can* be checked
afterwards, because a misread almost always describes a cube that cannot exist.
So it tries both and keeps the one that describes a real cube.

Measured over 500 identical simulated cubes per case, stickers read wrong:

| | one pass (old) | references stated | references estimated | both, keep the valid one |
| --- | --- | --- | --- | --- |
| even light | 0.02% | 0.00% | 0.01% | **0.00%** |
| photo-to-photo lighting | 0.51% | 0.36% | 0.29% | **0.14%** |
| dim, noisy, glaring | 4.86% | 5.26% | 3.93% | **3.80%** |
| pastel cube, mixed light | 9.07% | 4.59% | 6.51% | **4.36%** |

In mixed lighting that is 98% of cubes read perfectly, against 91% before. Dim
or glaring light stays genuinely hard, and a low-contrast cube stays harder than
a standard one — the pastel preset's closest two colours sit 19 apart where the
standard scheme's sit 42. Neither is papered over: the app warns when a palette
is low-contrast, rings the stickers it was unsure of, says which photo needed an
unusual amount of correction, and lets any sticker be corrected in either view.

## Solving

Before solving, the state is checked against what a real cube can actually be
in. A mis-scan usually produces one of three impossible states — a twisted
corner, a flipped edge, or two swapped pieces — and each gets a message saying
what to look for rather than a bare "invalid".

The method is layer-by-layer, the one a person follows with a cube in their
hands, so each stage of the answer means something:

| Stage | How it is found | Typical |
| --- | --- | --- |
| Bottom cross | Optimal, from a breadth-first table over all 190,080 cross states | 6 |
| Bottom corners | Shortest standard insertion that fits | 15 |
| Middle layer | Shortest standard insertion that fits | 28 |
| Last layer | Shortest combination of known algorithms, from a Dijkstra search over all 62,208 last-layer states | 22 |

That averages about 71 moves, worst case about 112 (measured over 25,000 random cubes). A two-phase optimiser
would get to roughly 20, but it would hand you one undifferentiated block of
turns; the staged answer is what lets the app tell you *what you are doing*
at each point, and the stages are individually as short as the method allows.

Two details do most of the work in keeping it correct:

- Each insertion is accepted only if it solves the target piece **and**
  provably leaves everything already solved alone. No stage can quietly undo an
  earlier one. Each stage guards only the layers below it, since it is free to
  disturb the ones it has not reached yet.
- The last-layer search measures what each algorithm actually does, rather than
  trusting a label. An algorithm that disturbs the first two layers is dropped;
  the rest are used by their measured effect. A mistyped entry in that list can
  only cost moves, never correctness.

Slots are solved cheapest-first, and several equally short crosses are tried,
keeping whichever leads to the shortest solve. That took the average from 93.5
moves to 70.8.

## Files

```
index.html          the three screens
css/app.css         styles for this app
js/cube.js          cube model, moves, validation
js/solver.js        the solver and its search tables
js/colour.js        camera pixels to cube colours
js/scanner.js       camera access and frame sampling
js/cube3d.js        the draggable 3D cube (DOM and CSS transforms, no WebGL)
js/app.js           screens, camera loop, playback
```

`js/cube.js` derives every move permutation from 3D geometry when it loads
instead of using written-out tables, so the facelet layout and the moves cannot
drift apart.

## Notes and limits

- Standard 3×3×3 cubes. Any colour scheme works — the six centres define the
  colours, nothing is assumed.
- Camera access needs a secure page (`https://…` or `localhost`). Without a
  camera, **By hand** lets you set the colours directly and **Demo cube** loads
  a scrambled one.
- Dark rooms are the real limit. The app warns instead of guessing.
- The solution assumes the cube stays in the orientation it was scanned in; the
  solve screen names the two centres to hold up and towards you.

## Tests

From the repository root:

```sh
node tests/solver.test.cjs 25000     # engine: 25,000 random cubes
node tests/browser.test.mjs          # the real pages, with a faked camera
```
