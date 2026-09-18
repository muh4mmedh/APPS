#!/usr/bin/env bash
#
# build.sh — package everything in this repo for a release.
#
#   release/build.sh              # build every artifact into release/dist/
#   VERSION=1.2.0 release/build.sh
#
# Produces, for version X.Y.Z:
#
#   apps-site-X.Y.Z.zip       the whole site: launcher plus every app
#   <app-id>-X.Y.Z.zip        one per app, each runnable on its own
#   apps-X.Y.Z.apk            the Android build, if one has been built
#   SHA256SUMS.txt            checksums for everything above
#   notes.md                  release notes, with the app list filled in
#
# The app list comes from assets/js/registry.js, so adding an app to the
# launcher is all it takes for it to appear in the next release.
#
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

version="${VERSION:-$(tr -d ' \n\r' < release/VERSION)}"
dist="release/dist"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "error: release/VERSION should look like 1.2.3 (got '$version')" >&2
  exit 1
fi

# The service worker names its cache after the version. If the two drift, a
# release ships serving last version's files from cache, which is the kind of
# bug that only shows up for the people who already installed it.
sw_version="$(sed -n "s/^const VERSION = '\(.*\)';$/\1/p" sw.js)"
if [[ "$sw_version" != "$version" ]]; then
  echo "error: sw.js has VERSION '$sw_version' but release/VERSION says '$version'" >&2
  echo "       update the constant at the top of sw.js so the offline cache is refreshed" >&2
  exit 1
fi

if ! command -v node >/dev/null; then
  echo "error: node is needed to read the app registry" >&2
  exit 1
fi
if ! command -v zip >/dev/null; then
  echo "error: zip is needed to package the artifacts" >&2
  exit 1
fi

# Icons are generated, so a stale one would ship silently.
if ! python3 tools/make-icons.py --check >/dev/null 2>&1; then
  echo "error: icons are out of date — run: python3 tools/make-icons.py" >&2
  exit 1
fi

apps_json="$(node -e 'global.window={};require("./assets/js/registry.js");process.stdout.write(JSON.stringify(window.APPS))')"
app_ids="$(node -e 'global.window={};require("./assets/js/registry.js");process.stdout.write(window.APPS.map(a=>a.id).join("\n"))')"

rm -rf "$dist"
mkdir -p "$dist"

staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

# Every registry entry must have a folder, or the launcher shows a card that
# leads nowhere.
while read -r id; do
  [[ -z "$id" ]] && continue
  if [[ ! -d "apps/$id" ]]; then
    echo "error: the registry lists '$id' but apps/$id does not exist" >&2
    exit 1
  fi
done <<< "$app_ids"

# The reverse is only worth a warning: the folder ships either way, it just has
# no card on the launcher until it is registered.
for dir in apps/*/; do
  id="$(basename "$dir")"
  [[ "$id" == "_template" ]] && continue
  if ! grep -qx "$id" <<< "$app_ids"; then
    echo "  note: apps/$id is not in assets/js/registry.js, so it ships without a card"
  fi
done

# Files the site needs, wherever it is hosted. `_template` is a starter for
# writing apps, not something to publish. The same rule is applied by
# android/app/build.gradle when it stages assets into the APK.
copy_site() {
  local target="$1"
  mkdir -p "$target/apps"
  cp index.html manifest.webmanifest sw.js .nojekyll "$target/"
  cp -R assets "$target/"
  local dir id
  for dir in apps/*/; do
    id="$(basename "$dir")"
    [[ "$id" == "_template" ]] && continue
    cp -R "apps/$id" "$target/apps/"
  done
}

echo "packaging version $version"

# --- the whole site -------------------------------------------------------
site="$staging/apps-site-$version"
copy_site "$site"
(cd "$staging" && zip -qrX "apps-site-$version.zip" "apps-site-$version")
mv "$staging/apps-site-$version.zip" "$dist/"
echo "  apps-site-$version.zip"

# --- one zip per app, each able to stand alone ----------------------------
while read -r id; do
  [[ -z "$id" ]] && continue
  name="$(node -e 'global.window={};require("./assets/js/registry.js");const a=window.APPS.find(x=>x.id===process.argv[1]);process.stdout.write(a.name)' "$id")"
  out="$staging/$id-$version"
  mkdir -p "$out/apps"
  cp -R "apps/$id" "$out/apps/"
  cp -R assets "$out/"
  cp sw.js .nojekyll "$out/"

  # Apps link to ../../assets, so the folder layout has to be kept. A
  # redirect at the root means opening the zip still lands on the app.
  cat > "$out/index.html" <<HTML
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>$name</title>
<meta http-equiv="refresh" content="0; url=apps/$id/index.html">
<link rel="canonical" href="apps/$id/index.html">
</head>
<body style="margin:0;background:#0a0c11;color:#e9edf6;font-family:system-ui,sans-serif">
<p style="padding:24px">Opening <a href="apps/$id/index.html" style="color:#9d8dff">$name</a>&hellip;</p>
</body>
</html>
HTML

  (cd "$staging" && zip -qrX "$id-$version.zip" "$id-$version")
  mv "$staging/$id-$version.zip" "$dist/"
  echo "  $id-$version.zip"
done <<< "$app_ids"

# --- the android build, if there is one ----------------------------------
apk=""
for candidate in \
  "android/app/build/outputs/apk/release/app-release.apk" \
  "android/app/build/outputs/apk/release/app-release-unsigned.apk" \
  "android/app/build/outputs/apk/debug/app-debug.apk"; do
  if [[ -f "$candidate" ]]; then apk="$candidate"; break; fi
done
if [[ -n "$apk" ]]; then
  cp "$apk" "$dist/apps-$version.apk"
  echo "  apps-$version.apk  (from $apk)"
else
  echo "  no apk found — build it with: cd android && ./gradlew assembleRelease"
  echo "  (or let the release workflow build it; see release/README.md)"
fi

# --- checksums ------------------------------------------------------------
(cd "$dist" && sha256sum ./* > SHA256SUMS.txt 2>/dev/null || true)
# sha256sum lists itself as it is being written; drop that line.
(cd "$dist" && grep -v 'SHA256SUMS.txt' SHA256SUMS.txt > .sums && mv .sums SHA256SUMS.txt)

# --- release notes --------------------------------------------------------
node - "$version" "$apps_json" > "$dist/notes.md" <<'JS'
const [version, appsJson] = process.argv.slice(2);
const apps = JSON.parse(appsJson);
const out = [];

out.push(`## Apps ${version}`, '');
out.push(apps.length === 1
  ? 'One app in this release:'
  : `${apps.length} apps in this release:`, '');
for (const app of apps) {
  const wip = app.status === 'wip' ? ' _(in progress)_' : '';
  out.push(`- **${app.name}**${wip} — ${app.tagline}`);
}
out.push('', '### Downloads', '');
out.push('| File | What it is |');
out.push('| --- | --- |');
out.push(`| \`apps-${version}.apk\` | Android app holding every app above. Install it on a phone. |`);
out.push(`| \`apps-site-${version}.zip\` | The whole site. Unzip and open \`index.html\`, or host the folder. |`);
for (const app of apps) {
  out.push(`| \`${app.id}-${version}.zip\` | ${app.name} on its own, ready to open or host. |`);
}
out.push(`| \`SHA256SUMS.txt\` | Checksums for the files above. |`);

out.push('', '### Installing the Android app', '');
out.push('1. Download the `.apk` onto your phone.');
out.push('2. Open it. Android will ask permission to install from your browser or files app — allow it for that app.');
out.push('3. The camera permission is asked for the first time a cube is scanned.');
out.push('');
out.push('It is signed with a build key rather than a Play Store key, so Android shows the');
out.push('usual warning about an app from outside the store.');
out.push('');
out.push('If a release was built without a signing key of its own, each build is signed');
out.push('with a throwaway debug key, and Android will not install a new version over an');
out.push('older one — uninstall first. Setting up a key once (see `release/README.md`)');
out.push('makes updates work normally.');

out.push('', '### Running the web version', '');
out.push('Unzip and open `index.html` for anything that does not need a camera. Camera access');
out.push('needs a secure page, so serve the folder instead when you want to scan:');
out.push('');
out.push('```sh');
out.push('python3 -m http.server 8000');
out.push('```');
out.push('');
out.push('On a phone, use *Add to Home Screen* and it installs as an app, working offline.');

console.log(out.join('\n'));
JS

echo
echo "artifacts in $dist:"
ls -1sh "$dist" | tail -n +2 | sed 's/^/  /'
