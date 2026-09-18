/*
 * install.js — registers the service worker and offers the install button.
 *
 * Both are optional extras: the page works without either, so every call is
 * guarded. Service workers need a secure context, which rules out pages opened
 * straight off disk (file://) — that is expected, not an error worth logging.
 */
(function () {
  'use strict';

  var secure = location.protocol === 'https:' ||
               location.hostname === 'localhost' ||
               location.hostname === '127.0.0.1';

  // Inside the Android app the files are already on the device, so a service
  // worker buys nothing and only adds a way for things to go wrong. Stand down
  // there, and clear out any worker an earlier version of the app registered.
  var inAndroidShell = navigator.userAgent.indexOf('AppsAndroidShell') >= 0;
  if (inAndroidShell) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations()
        .then(function (registrations) {
          registrations.forEach(function (registration) { registration.unregister(); });
        })
        .catch(function () { /* nothing to clean up */ });
    }
    return;
  }

  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', function () {
      // The worker lives at the site root, whichever page registers it.
      var root = document.documentElement.getAttribute('data-root') || './';
      navigator.serviceWorker.register(root + 'sw.js', { scope: root })
        .catch(function () { /* offline support is a bonus, never a blocker */ });
    });
  }

  // Chromium fires this when the page is installable; Safari and Firefox never
  // do, so the button simply stays hidden there.
  var button = document.getElementById('install');
  if (!button) return;

  var prompt = null;
  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    prompt = event;
    button.hidden = false;
  });

  button.addEventListener('click', function () {
    if (!prompt) return;
    prompt.prompt();
    prompt.userChoice.then(function () {
      prompt = null;
      button.hidden = true;
    }).catch(function () { button.hidden = true; });
  });

  window.addEventListener('appinstalled', function () {
    prompt = null;
    button.hidden = true;
  });
})();
