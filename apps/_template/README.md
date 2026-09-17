# App starter

Copied by `tools/new-app.sh`. `APP_NAME` and `APP_TAGLINE` in `index.html` are
placeholders the script fills in.

Layout each app follows:

```
apps/<id>/
  index.html     entry point, links ../../assets/css/base.css first
  css/app.css    styles for this app only
  js/*.js        app code, plain scripts in dependency order
```

Guidelines that keep the collection consistent:

- Use the tokens and primitives in `assets/css/base.css`; don't redefine them.
- Plain scripts, not modules, so an app also runs when opened straight off disk.
- Anything worth testing goes in `tests/` and runs under plain `node`.
