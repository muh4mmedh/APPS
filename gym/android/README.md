# Gym for Android

A small WebView app that shows the gym web app from files inside the APK.
It needs no internet permission and nothing is downloaded. Your log stays in
the app's own storage on the phone.

## Install

1. Get `gym-<version>.apk`. It's attached to the chat it was built in, or you
   can download it from the **gym-apk** artifact of the latest *build* run in
   the repo's Actions tab.
2. Open it on the phone. Android asks you to allow installs from that app (your
   browser or file manager) the first time.
3. Play Protect may warn that it's an app from an unknown developer. Tap *More
   details → Install anyway*.

To update, install a newer APK over the top. Your data stays, as long as it's
signed with the same key (see below). Export a backup in History first anyway.

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

Before installing a new build over an old one, raise `android:versionCode` in
`AndroidManifest.xml`. Change `versionName` too if you like.

## Signing key

`gym-release.jks` is committed so that every build, here or in CI, is signed
with the same key. Android only accepts an update signed by the key it was
first installed with. Any other update means uninstalling, which wipes the log.
Its password is in `build.sh`, so it's only fit for personal sideloading. For
anything public, make your own key and pass it in with `GYM_KEYSTORE`,
`GYM_KEYSTORE_PASSWORD` and `GYM_KEY_ALIAS`.

## What the Java does

`MainActivity` loads `file:///android_asset/www/index.html` and fills in the
things a WebView doesn't do on its own:

- `<input type="file">` (import a backup) opens the system file picker.
- Export calls `GymAndroid.saveFile(name, text)`, which asks where to save the
  file, because a download link does nothing in a WebView.
- Back steps through the page's history (for example History → training)
  before it closes the app.
- Links that leave the app open in the browser.
