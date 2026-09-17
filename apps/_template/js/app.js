/* app.js — this app's code. Plain script, no build step. */
(function () {
  'use strict';

  var button = document.getElementById('demo');
  var out = document.getElementById('out');

  button.addEventListener('click', function () {
    out.hidden = false;
    out.textContent = 'It works. Delete this and build the real thing.';
  });
})();
