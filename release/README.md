# Releases

Everything published from this repo is built from here.

## Cutting a release

1. Set the version in two places and keep them equal:
   - `release/VERSION`
   - the `VERSION` constant at the top of `sw.js`

   `build.sh` refuses to run if they disagree, because a mismatch means people
   who already installed the site keep being served the old files from cache.
   The Android version name and code are derived from `release/VERSION`
   automatically.

2. Commit, then publish either way:

   **From the Actions tab.** Open the *build* workflow, *Run workflow*, tick
   **Publish a release from release/VERSION**, run it. The tag is created by
   the release itself, so nothing needs pushing.

   ```sh
   # or, if you would rather tag
   git tag v1.0.0
   git push origin v1.0.0
   ```

Either route runs the tests, builds the APK, packages the zips and publishes a
GitHub Release with everything attached, using `release/dist/notes.md` as the
release text. Publishing is re-runnable: if the release already exists it is
updated and its files replaced rather than failing.

## Building the artifacts by hand

```sh
release/build.sh
```

Writes into `release/dist/` (ignored by git):

| File | What it is |
| --- | --- |
| `apps-site-X.Y.Z.zip` | The whole site: launcher plus every app. |
| `<app-id>-X.Y.Z.zip` | One per app, each runnable on its own. |
| `apps-X.Y.Z.apk` | The Android build, if one has been built. |
| `SHA256SUMS.txt` | Checksums for the above. |
| `notes.md` | Release notes, with the app list filled in. |

The app list comes from `assets/js/registry.js`, so adding an app to the
launcher is all it takes for it to appear in the next release. `build.sh` stops
if the registry names an app with no folder, and warns if a folder is not
registered.

To include the APK, build it first:

```sh
cd android && ./gradlew assembleRelease && cd ..
release/build.sh
```

## Signing the Android build

Unsigned APKs cannot be installed, so a release build with no key supplied
falls back to the debug key. That installs fine and is what the CI build
produces by default; Android just shows the usual warning about an app from
outside the Play Store.

There is one catch worth knowing before you hand the APK around: a CI runner
generates a fresh debug key each build, so Android will refuse to install a new
version *over* an older one — it looks like a different app signed by someone
else. Until you set up a key of your own, updating means uninstalling first.
Setting one up takes a minute and fixes it permanently.

To sign with your own key, make one once:

```sh
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias apps
```

Keep `release.jks` out of the repo. For local builds:

```sh
export APPS_KEYSTORE=/path/to/release.jks
export APPS_KEYSTORE_PASSWORD=... APPS_KEY_ALIAS=apps APPS_KEY_PASSWORD=...
cd android && ./gradlew assembleRelease
```

For CI, add four repository secrets — `APPS_KEYSTORE_BASE64` (the keystore run
through `base64 -w0`), `APPS_KEYSTORE_PASSWORD`, `APPS_KEY_ALIAS` and
`APPS_KEY_PASSWORD`. The workflow picks them up on its own.

Once an app is signed with a given key, every later version must use the same
key or Android will refuse to update it in place.

## Hosting the site instead

`apps-site-X.Y.Z.zip` is a plain static folder. Unzip it anywhere that serves
files, or turn on GitHub Pages for the repo (Settings → Pages → this branch,
root folder) and the launcher is live with no build step.
