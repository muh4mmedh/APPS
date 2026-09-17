/*
 * registry.js — the list of apps in this repo.
 *
 * The launcher on the home page reads this. Adding an app means dropping a
 * folder in apps/ and adding one entry here — see tools/new-app.sh, which does
 * both for you.
 *
 * Kept as a plain script rather than JSON on purpose: the launcher then works
 * when the page is opened straight off disk, with no server and no fetch.
 *
 * Fields
 *   id       folder name under apps/ (also the anchor used for linking)
 *   name     display name
 *   tagline  one line, what it does for the person using it
 *   icon     one or two characters for the tile
 *   swatches optional nine colour names for a mini-grid tile instead
 *   accent   tile colour
 *   tags     free-form, used by the search box
 *   status   'ready' | 'wip'
 *   added    ISO date, newest first in the listing
 */
window.APPS = [
  {
    id: 'rubiks-solver',
    name: "Rubik's Solver",
    tagline: 'Show each face to the camera and follow the turns that solve it.',
    icon: '◩',
    swatches: ['white', 'red', 'white', 'green', 'yellow', 'blue', 'orange', 'white', 'green'],
    accent: '#6f5cf6',
    tags: ['camera', 'puzzle', 'solver', 'offline', '3d'],
    status: 'ready',
    added: '2026-09-17'
  }
];
