# Apps

A collection of small, self-contained web apps. Each one is a folder of plain
HTML, CSS and JavaScript — open it and it runs. No bundler, no framework, no
install step.

The home page (`index.html`) is the launcher: it lists every app, with search.

| App | What it does |
| --- | --- |
| [Rubik's Solver](apps/rubiks-solver/) | Show each face of a cube to your camera and follow the turns that solve it. |

## Running it

Everything is static, so any web server works:

```sh
python3 -m http.server 8000     # then open http://localhost:8000/
```

A server is needed rather than opening the files directly, because browsers
only grant camera access on a secure page (`https://…` or `localhost`). Apps
that don't use the camera work fine straight off disk.

## Installing it

- **On a phone or desktop:** open the site and use *Add to Home Screen* (or the
  Install button on the launcher). It installs as an app, holding all of them,
  and keeps working offline once opened.
- **As an Android app:** grab the `.apk` from the
  [releases page](../../releases). One APK contains the launcher and every app.
  Build details are in [`android/README.md`](android/README.md).

## Layout

```
index.html              the launcher
manifest.webmanifest    makes the collection installable
sw.js                   offline support for every app
assets/
  css/base.css          design tokens and shared primitives
  js/registry.js        the list of apps the launcher reads
  js/launcher.js        renders the app grid
  js/install.js         service worker registration, install button
  icons/                generated launcher icons
apps/
  _template/            starter copied by tools/new-app.sh
  rubiks-solver/        one folder per app, self-contained
android/                wraps the whole site as an installable APK
release/                VERSION, packaging script, how to cut a release
tools/new-app.sh        scaffold a new app and register it
tools/make-icons.py     generate the web and Android icons
tests/                  node tests, no build step
```

## Adding an app

```sh
tools/new-app.sh unit-converter "Unit Converter" "Convert anything to anything."
```

That copies `apps/_template/` to `apps/unit-converter/`, fills in the name and
tagline, and adds an entry to `assets/js/registry.js`. Refresh the home page
and the card is there. Editing the registry by hand works just as well.

Three conventions keep the collection coherent as it grows:

- **Use the shared tokens.** `assets/css/base.css` defines the colours, radii,
  shadows and the `.card` / `.btn` / `.chip` / `.notice` primitives. Apps add
  their own stylesheet on top rather than redefining these.
- **Plain scripts, not modules.** Load them in dependency order with `<script>`
  tags. Modules would need a server for every app, including ones that would
  otherwise run straight off disk.
- **Link to files, never folders.** Write `../../index.html`, not `../../`. A
  web server turns a folder into its `index.html`; the Android WebView reads
  files straight out of the APK and does not, and nor does `file://`.
  `tests/site.test.cjs` enforces this.

## Tests

```sh
npm install          # once, only needed for the browser tests
npm test             # engine tests, then browser tests
```

- `tests/site.test.cjs` runs under plain `node`. It resolves every internal
  link, checks the registry against the folders on disk, and checks the
  offline cache version against `release/VERSION`.
- `tests/solver.test.cjs` runs under plain `node` with no dependencies. It
  checks the cube model, then solves thousands of random cubes and verifies
  each solution actually solves the cube it was given. Pass a count for a
  longer sweep: `node tests/solver.test.cjs 25000`.
- `tests/browser.test.mjs` drives the real pages in Chromium. It starts its own
  static server and fakes the camera with a canvas, so the actual scanning code
  runs — crop, mirror and all — and the colours the app reads are compared
  against the cube that was drawn. Screenshots land in `tests/screenshots/`.

## Releasing

```sh
release/build.sh        # zips for the site and each app, checksums, notes
```

To publish, either run the *build* workflow from the Actions tab with
**Publish** ticked, or push a `v*` tag. Either way CI runs the tests, builds
the APK, and attaches everything to a GitHub Release. Full process in
[`release/README.md`](release/README.md).

## Hosting

These are static files, so GitHub Pages serves them as-is: in the repository's
**Settings → Pages**, set the source to this branch with the root folder. The
`.nojekyll` file is there so folders beginning with an underscore (like
`apps/_template/`) are not skipped.
