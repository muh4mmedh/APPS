#!/usr/bin/env python3
"""
verify-apk.py — check a built APK before anyone installs it.

  python3 tools/verify-apk.py path/to/app-release.apk

An APK cannot be run from a build machine, but a lot about it can still be
checked, and these are the things that have actually gone wrong:

  - the web app missing or half-copied, giving a blank shell
  - the starter template shipped by accident
  - bundled files not matching the repo, so the tested code is not the
    shipped code
  - resources.arsc compressed, which Android 11+ refuses to install
  - no v2 signature, which Android 7+ requires
  - the launcher activity or camera permission missing from the manifest

Two things worth knowing about a release APK, both of which made earlier
versions of this script report false problems:

  - Resource paths are shortened (res/mipmap-hdpi/ic_launcher.png becomes
    something like res/yn.png), so resources cannot be found by name. They
    are identified here by PNG dimensions instead.
  - v1 (jar) signing is only needed below API 24. With minSdk 24 the build
    signs with v2/v3 only, so META-INF/*.RSA is correctly absent.
"""

import hashlib
import pathlib
import struct
import sys
import zipfile

REPO = pathlib.Path(__file__).resolve().parent.parent

# Files that must be inside the APK for the app to work at all.
REQUIRED_SITE = [
    'index.html',
    'manifest.webmanifest',
    'sw.js',
    'assets/css/base.css',
    'assets/js/registry.js',
    'assets/js/launcher.js',
    'assets/js/install.js',
    'apps/rubiks-solver/index.html',
    'apps/rubiks-solver/css/app.css',
    'apps/rubiks-solver/manifest.webmanifest',
    'apps/rubiks-solver/js/cube.js',
    'apps/rubiks-solver/js/solver.js',
    'apps/rubiks-solver/js/colour.js',
    'apps/rubiks-solver/js/scanner.js',
    'apps/rubiks-solver/js/cube3d.js',
    'apps/rubiks-solver/js/app.js',
]

# Legacy launcher icon densities and adaptive-icon foreground sizes, in pixels.
LAUNCHER_SIZES = {48, 72, 96, 144, 192}
FOREGROUND_SIZES = {108, 162, 216, 324, 432}

failures = []


def check(name, ok, detail=''):
    print(f"  {'ok  ' if ok else 'FAIL'} {name}" + (f'  -> {detail}' if detail else ''))
    if not ok:
        failures.append(name)


def png_size(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        return None
    width, height = struct.unpack('>II', data[16:24])
    return width, height


def main(path):
    target = pathlib.Path(path)
    if not target.is_file():
        print(f'no such file: {path}')
        return 2
    print(f'\nverifying {path}')
    try:
        raw = target.read_bytes()
        zipfile.ZipFile(path).testzip()
    except zipfile.BadZipFile:
        print(f'{path} is not a zip archive, so it is not an APK')
        return 2
    except OSError as err:
        print(f'could not read {path}: {err}')
        return 2
    print(f'  {len(raw) / 1024 / 1024:.2f} MB, sha256 {hashlib.sha256(raw).hexdigest()[:16]}…\n')

    zf = zipfile.ZipFile(path)
    names = set(zf.namelist())
    info = {i.filename: i for i in zf.infolist()}

    # --- structure ---------------------------------------------------------
    for needed in ('AndroidManifest.xml', 'classes.dex', 'resources.arsc'):
        check(f'contains {needed}', needed in names)

    arsc = info.get('resources.arsc')
    check('resources.arsc is stored uncompressed (Android 11+ requires it)',
          arsc is not None and arsc.compress_type == zipfile.ZIP_STORED)

    # --- signing -----------------------------------------------------------
    # The APK Signing Block sits just before the central directory and ends
    # with this magic. Android 7+ needs v2 or better.
    check('signed with a v2+ scheme', b'APK Sig Block 42' in raw)

    # --- the web app -------------------------------------------------------
    site = sorted(n for n in names if n.startswith('assets/www/'))
    check('the site is bundled', len(site) >= len(REQUIRED_SITE),
          f'{len(site)} files under assets/www/')

    missing = [f for f in REQUIRED_SITE if 'assets/www/' + f not in names]
    check('every file the app needs is present',
          not missing, 'missing: ' + ', '.join(missing) if missing else '')

    check('the starter template was not shipped',
          not any('_template' in n for n in names))

    # The shipped code must be the code that was tested.
    differing = []
    for entry in site:
        rel = entry[len('assets/www/'):]
        on_disk = REPO / rel
        if not on_disk.is_file():
            differing.append(rel + ' (not in repo)')
        elif zf.read(entry) != on_disk.read_bytes():
            differing.append(rel)
    check('bundled files are byte-identical to the repo',
          not differing, ', '.join(differing[:4]) if differing else '')

    # --- our code ----------------------------------------------------------
    dex = zf.read('classes.dex')
    for needle in (b'dev/apps/collection/MainActivity',
                   b'https://appassets.androidplatform.net/assets/www/index.html',
                   b'AppsAndroidShell',
                   b'WebViewAssetLoader',
                   b'ServiceWorkerClientCompat'):
        check(f'code references {needle.decode()[:52]}', needle in dex)

    # --- the manifest ------------------------------------------------------
    manifest = zf.read('AndroidManifest.xml')

    def declared(text):
        # Binary XML keeps strings in UTF-16LE, with a UTF-8 pool in some builds.
        return text.encode('utf-16-le') in manifest or text.encode() in manifest

    check('the camera permission is declared', declared('android.permission.CAMERA'))
    check('the camera is optional, so the app installs without one',
          declared('android.hardware.camera'))
    check('the launcher activity is declared',
          declared('dev.apps.collection.MainActivity') or declared('.MainActivity'))

    # --- icons -------------------------------------------------------------
    # Release builds shorten resource paths, so match on dimensions instead.
    sizes = []
    for name in names:
        if not name.startswith('res/') or not name.endswith('.png'):
            continue
        dims = png_size(zf.read(name))
        if dims and dims[0] == dims[1]:
            sizes.append(dims[0])
    found_launcher = LAUNCHER_SIZES & set(sizes)
    found_foreground = FOREGROUND_SIZES & set(sizes)
    check('launcher icons for every density', len(found_launcher) == len(LAUNCHER_SIZES),
          f'{sorted(found_launcher)} of {sorted(LAUNCHER_SIZES)}')
    check('adaptive icon foregrounds for every density',
          len(found_foreground) == len(FOREGROUND_SIZES),
          f'{sorted(found_foreground)} of {sorted(FOREGROUND_SIZES)}')

    print()
    if failures:
        print(f'{len(failures)} problem(s): ' + '; '.join(failures))
        return 1
    print('apk verified')
    return 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        print(__doc__)
        sys.exit(64)
    sys.exit(main(sys.argv[1]))
