#!/usr/bin/env bash
#
# build.sh — build the Gym APK with no Android Studio and no Gradle.
#
# Uses the Android build tools packaged by Debian/Ubuntu, so it works on any
# Linux box (and in CI) without downloading the Android SDK from Google:
#
#   sudo apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23
#   gym/android/build.sh
#
# The APK lands in gym/android/build/gym-<version>.apk.
#
# The web files copied in are exactly the ones sw.js precaches, so the APK
# and the offline web app can never disagree about what the app is made of.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
GYM="$(dirname "$HERE")"
PLATFORM="${ANDROID_JAR:-/usr/lib/android-sdk/platforms/android-23/android.jar}"

for tool in aapt dalvik-exchange zipalign apksigner javac; do
  if ! command -v "$tool" >/dev/null; then
    echo "missing $tool — install with:"
    echo "  sudo apt-get install aapt dalvik-exchange zipalign apksigner android-sdk-platform-23"
    exit 1
  fi
done
[ -f "$PLATFORM" ] || { echo "missing $PLATFORM (apt-get install android-sdk-platform-23)"; exit 1; }

# Signing. The committed key keeps every build able to update the last one
# (Android refuses an update signed by a different key, and uninstalling
# first would wipe your logged data). Override with your own via env.
KEYSTORE="${GYM_KEYSTORE:-$HERE/gym-release.jks}"
KS_PASS="${GYM_KEYSTORE_PASSWORD:-gym-release}"
KEY_ALIAS="${GYM_KEY_ALIAS:-gym}"

VERSION="$(sed -n 's/.*android:versionName="\([^"]*\)".*/\1/p' "$HERE/AndroidManifest.xml")"
OUT="$HERE/build"
rm -rf "$OUT"
mkdir -p "$OUT/gen" "$OUT/classes" "$OUT/assets/www"

echo "staging web files"
grep -o "'\./[^']*'" "$GYM/sw.js" | tr -d "'" | sed 's#^\./##' | while read -r f; do
  mkdir -p "$OUT/assets/www/$(dirname "$f")"
  cp "$GYM/$f" "$OUT/assets/www/$f"
done

echo "compiling resources"
aapt package -f -m -J "$OUT/gen" -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -I "$PLATFORM"

echo "compiling java"
javac -nowarn -Xlint:-options -source 8 -target 8 -encoding UTF-8 \
  -bootclasspath "$PLATFORM" -d "$OUT/classes" \
  $(find "$HERE/src" "$OUT/gen" -name '*.java')

echo "dexing"
dalvik-exchange --dex --min-sdk-version=24 --output="$OUT/classes.dex" "$OUT/classes"

echo "packaging"
aapt package -f -M "$HERE/AndroidManifest.xml" -S "$HERE/res" -A "$OUT/assets" \
  -I "$PLATFORM" -F "$OUT/unsigned.apk"
(cd "$OUT" && aapt add unsigned.apk classes.dex >/dev/null)
zipalign -f -p 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"

echo "signing"
APK="$OUT/gym-$VERSION.apk"
apksigner sign --ks "$KEYSTORE" --ks-pass "pass:$KS_PASS" --ks-key-alias "$KEY_ALIAS" \
  --min-sdk-version 24 --out "$APK" "$OUT/aligned.apk"
apksigner verify --min-sdk-version 24 "$APK"
rm -f "$OUT/unsigned.apk" "$OUT/aligned.apk" "$APK.idsig"

ls -lh "$APK"
