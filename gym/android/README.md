# Gym for Android

A small WebView app that shows the gym web app from files inside the APK.
It needs no internet permission and nothing is downloaded. Your log is kept in
a SQLite database (`gym.db`) in the app's private storage on the phone.

## Install

1. Get `gym-<version>.apk`. It's attached to the chat it was built in, or you
   can download it from the **gym-apk** artifact of the latest *build* run in
   the repo's Actions tab.
2. Open it on the phone. Android asks you to allow installs from that app (your
   browser or file manager) the first time.
3. Play Protect may warn that it's an app from an unknown developer. Tap *More
   details → Install anyway*.

## Updating keeps your data

Install a newer APK over the old one; don't uninstall first. `gym.db` lives
outside the APK, so Android keeps it through an update. Only uninstalling (or
*Clear storage*) deletes it. An update installs over the top when:

- it's signed with the same key. `build.sh` uses the committed one, see below.
- its `android:versionCode` in `AndroidManifest.xml` is higher than the
  installed one. Raise it by one for every release.

The first time 1.1.0 or later opens on a phone that had 1.0.0, it moves the
log 1.0.0 kept in the WebView's localStorage into the database, then deletes
the old copy.

Exporting a backup from History now and then is still worthwhile. It's the
only copy that survives losing or resetting the phone.

## The database

`src/dev/apps/gym/GymDatabase.java` has three tables:

| table | one row per | columns |
| --- | --- | --- |
| `settings` | setting | `key`, `value` (just the weight unit for now) |
| `sessions` | gym day per week | `week`, `day_id`, `date`, `knee`, `body_weight_kg` |
| `sets` | logged set | `week`, `day_id`, `exercise_id`, `set_index`, `weight_kg`, `reps`, `duration` |

Weights are always stored in kg. Sets belong to their session (foreign key,
deleted with it), and CHECK constraints refuse a bad knee value or a negative
number.

The page works with the whole log as one JSON document. `dbLoad()` builds it
from the tables, and `dbSave(json)` writes it back in a single transaction,
so a save either writes every row or changes nothing. If a save fails, the
page says so on screen and keeps the change in temporary storage, so it isn't
lost silently.

**Changing the schema later:**
1. Raise `VERSION` in `GymDatabase`.
2. Add a step to `onUpgrade` that alters the existing tables (`ALTER TABLE …`).

Never drop and recreate a table there, because that would wipe the log on
update.

## Tests

```sh
gym/android/test/run.sh
```

Runs `GymDatabase.java` unchanged against real SQLite on the JVM. Small
stand-ins in `test/shim/` take the place of Android's database classes; they
follow Android's open, upgrade and transaction rules. The tests cover:
- save and load round trips
- the log surviving a restart
- a bad save being refused with the stored log untouched
- sessions removed with their sets
- `store.js` accepting what the database hands back

CI runs this before every APK build.

## Build

```sh
sudo apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
gym/android/build.sh                # → gym/android/build/gym-<version>.apk
```

There's no Gradle or Android Studio. `build.sh` runs the five steps by hand:
1. `aapt` builds the resources
2. `javac` compiles the code
3. `dalvik-exchange` turns it into dex
4. `aapt` packages everything into the APK
5. `zipalign` and `apksigner` align and sign it

It compiles against API 23 and targets API 34. The web files it bundles are
exactly the list in `gym/sw.js`.

## Signing key

`gym-release.jks` is committed so that every build, here or in CI, is signed
with the same key. Android only accepts an update signed by the key it was
first installed with. Any other update means uninstalling, which wipes the log.
Its password is in `build.sh`, so it's only fit for personal sideloading. For
anything public, make your own key and pass it in with `GYM_KEYSTORE`,
`GYM_KEYSTORE_PASSWORD` and `GYM_KEY_ALIAS`.

## What the Java does

`MainActivity` loads `file:///android_asset/www/index.html`, gives the page
the database bridge (`GymAndroid.dbLoad` / `dbSave`), and fills in the things
a WebView doesn't do on its own:

- `<input type="file">` (import a backup) opens the system file picker.
- Export calls `GymAndroid.saveFile(name, text)`, which asks where to save the
  file, because a download link does nothing in a WebView.
- Back steps through the page's history (for example History → training)
  before it closes the app.
- Links that leave the app open in the browser.
