# Rubik's Solver

Show each of the six faces to your camera, check what it read, then follow the
turns. Everything happens in the browser — the camera frames never leave the
device, and there is no server, build step or dependency.

## Reading colours off a camera

Sticker colours are mostly a lighting problem. Red and orange sit close
together in hue, white under warm light looks cream, and one side of the cube
is usually brighter than the other. Fixed hue thresholds get this wrong often
enough to be irritating.

Two things make it reliable instead:

**Brightness is divided out.** Lighting is largely a multiplier, so each sample
is rescaled to a fixed total brightness before being compared. In simulated
scans this alone took sticker errors from about 1% down to near zero. A little
of the absolute colour is kept in the comparison, which is what separates a
white sticker from a washed-out coloured one.

**The final read is one decision, not 54.** A cube has exactly nine stickers of
each colour, and the six centres show what those colours look like *in this
room, in this light*. So matching is an assignment problem: put 54 samples into
6 groups of exactly 9 at the lowest total colour distance, solved exactly with
min-cost flow. A red sticker that looks slightly orange gets pushed back into
the red group when the orange group is already full of better candidates.

Against simulated scans — uneven lighting, a warm cast, camera noise, and each
face lit differently — this reads 0.00–0.17% of stickers wrong, where deciding
each sticker on its own by nearest centre gets 2.8–7.5% wrong under the same
conditions. On the hardest of those scenarios that is 479 cubes in 500 read
perfectly, against 66 in 500.

The one case it cannot rescue is a genuinely dark frame, where sensor noise is
large next to the colour itself; the app detects that and says so rather than
guessing.

Stickers whose group was a close call are ringed on the review screen, and every
sticker stays editable, because a camera will occasionally misread one and
arguing with it is worse than tapping it.

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
