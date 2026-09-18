/*
 * launcher.js — renders the app grid on the home page from assets/js/registry.js.
 */
(function () {
  'use strict';

  var COLOURS = {
    white: '#f3f5f8', yellow: '#ffd21f', red: '#e02f3c',
    orange: '#ff8114', green: '#18b55c', blue: '#1f6df0'
  };

  var apps = (window.APPS || []).slice().sort(function (a, b) {
    return String(b.added || '').localeCompare(String(a.added || ''));
  });

  var grid = document.getElementById('grid');
  var search = document.getElementById('search');
  var count = document.getElementById('count');
  var empty = document.getElementById('empty');

  function tile(app) {
    var box = document.createElement('div');
    box.className = 'tile';
    box.style.setProperty('--accent-app', app.accent || '#6f5cf6');

    if (app.swatches && app.swatches.length === 9) {
      var mini = document.createElement('div');
      mini.className = 'tile__mini';
      app.swatches.forEach(function (name) {
        var cell = document.createElement('i');
        cell.style.background = COLOURS[name] || name;
        mini.appendChild(cell);
      });
      box.appendChild(mini);
    } else {
      box.textContent = app.icon || '◻';
    }
    return box;
  }

  function card(app) {
    var link = document.createElement('a');
    link.className = 'app-card';
    // Point at the file, not the folder: neither the Android asset
    // loader nor file:// resolves a directory to its index.html.
    link.href = 'apps/' + app.id + '/index.html';
    link.setAttribute('aria-label', app.name + ' — ' + app.tagline);

    link.appendChild(tile(app));

    var body = document.createElement('div');
    body.className = 'app-card__body';

    var head = document.createElement('div');
    head.className = 'app-card__head';
    var title = document.createElement('h2');
    title.textContent = app.name;
    head.appendChild(title);
    if (app.status === 'wip') {
      var tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'in progress';
      head.appendChild(tag);
    }
    body.appendChild(head);

    var line = document.createElement('p');
    line.className = 'muted';
    line.textContent = app.tagline;
    body.appendChild(line);

    if (app.tags && app.tags.length) {
      var tags = document.createElement('div');
      tags.className = 'app-card__tags';
      app.tags.forEach(function (name) {
        var chip = document.createElement('span');
        chip.className = 'chip';
        chip.textContent = name;
        tags.appendChild(chip);
      });
      body.appendChild(tags);
    }

    link.appendChild(body);

    var arrow = document.createElement('span');
    arrow.className = 'app-card__go';
    arrow.textContent = '→';
    arrow.setAttribute('aria-hidden', 'true');
    link.appendChild(arrow);

    return link;
  }

  function render(query) {
    var needle = (query || '').trim().toLowerCase();
    var shown = apps.filter(function (app) {
      if (!needle) return true;
      var haystack = [app.name, app.tagline, app.id].concat(app.tags || []).join(' ').toLowerCase();
      return haystack.indexOf(needle) >= 0;
    });

    grid.innerHTML = '';
    shown.forEach(function (app) { grid.appendChild(card(app)); });

    count.textContent = apps.length + (apps.length === 1 ? ' app' : ' apps');
    empty.hidden = shown.length > 0;
    if (!shown.length) {
      empty.textContent = needle
        ? 'Nothing matches “' + query + '”.'
        : 'No apps here yet.';
    }
  }

  if (search) {
    search.addEventListener('input', function () { render(search.value); });
    search.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { search.value = ''; render(''); }
    });
  }

  render('');
})();
