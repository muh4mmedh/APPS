#!/usr/bin/env python3
"""
make-icons.py — generate the app icons.

Writes the PNGs the web manifests need and the ones the Android launcher
needs, from the same two designs, so the phone icon and the browser icon
cannot drift apart.

No image library required: this encodes PNG directly (zlib is in the standard
library) and draws by supersampling 4x and averaging down, which is enough for
clean rounded corners at every size.

  python3 tools/make-icons.py            # write every icon
  python3 tools/make-icons.py --check    # report what would change, write nothing
"""

import argparse
import struct
import sys
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCALE = 4  # supersampling factor

# The two designs. 'apps' is the launcher's identity, used for the collection
# and the Android app. 'cube' belongs to the Rubik's Solver.
DESIGNS = {
    "apps": {
        "tile": (0x11, 0x14, 0x1C),
        "glow": (0x27, 0x20, 0x5E),
        "cells": [
            (0x6F, 0x5C, 0xF6), (0x24, 0xD3, 0xA5),
            (0xFF, 0xBF, 0x3C), (0xFB, 0x5C, 0x6C),
        ],
        "grid": 2,
    },
    "cube": {
        "tile": (0x11, 0x14, 0x1C),
        "glow": (0x27, 0x20, 0x5E),
        "cells": [
            (0xF3, 0xF5, 0xF8), (0xE0, 0x2F, 0x3C), (0xF3, 0xF5, 0xF8),
            (0x18, 0xB5, 0x5C), (0xFF, 0xD2, 0x1F), (0x1F, 0x6D, 0xF0),
            (0xFF, 0x81, 0x14), (0xF3, 0xF5, 0xF8), (0x18, 0xB5, 0x5C),
        ],
        "grid": 3,
    },
}


def write_png(path: Path, width: int, height: int, pixels: bytearray) -> bytes:
    """Encode 8-bit RGBA pixels as a PNG and return the bytes."""
    rows = bytearray()
    stride = width * 4
    for y in range(height):
        rows.append(0)  # filter type 0 (none)
        rows += pixels[y * stride:(y + 1) * stride]

    def chunk(tag: bytes, data: bytes) -> bytes:
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(rows), 9))
    png += chunk(b"IEND", b"")
    return png


def rounded(x: float, y: float, size: float, radius: float) -> bool:
    """Is this point inside a rounded square of the given size?"""
    if radius <= 0:
        return 0 <= x < size and 0 <= y < size
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def draw(design: dict, size: int, *, full_bleed: bool, content: float,
         tile: bool = True) -> bytearray:
    """
    Render one icon.

    full_bleed - fill the whole canvas rather than a rounded tile. Maskable web
                 icons and Android adaptive layers are cropped by the platform,
                 so they must not rely on their own corners.
    content    - how much of the canvas the colour grid spans, 0..1. Platforms
                 crop maskable icons to a circle, so those need a smaller grid.
    tile       - draw the background. False gives a transparent foreground
                 layer, which is what an Android adaptive icon wants.
    """
    big = size * SCALE
    buf = bytearray(big * big * 4)
    radius = 0 if full_bleed else big * 0.2237  # matches the iOS/Android squircle
    cells = design["cells"]
    n = design["grid"]

    span = big * content
    origin = (big - span) / 2
    gap = span * (0.055 if n == 2 else 0.05)
    cell = (span - gap * (n - 1)) / n
    cell_radius = cell * (0.22 if n == 2 else 0.19)

    for py in range(big):
        row = py * big * 4
        for px in range(big):
            i = row + px * 4
            inside = rounded(px, py, big, radius)

            if tile and inside:
                # A soft diagonal glow keeps the dark tile from looking flat.
                t = (px + py) / (2 * big)
                mix = (1 - t) ** 2 * 0.85
                base = design["tile"]
                glow = design["glow"]
                buf[i] = int(base[0] + (glow[0] - base[0]) * mix)
                buf[i + 1] = int(base[1] + (glow[1] - base[1]) * mix)
                buf[i + 2] = int(base[2] + (glow[2] - base[2]) * mix)
                buf[i + 3] = 255

            if not inside:
                continue

            # Which grid cell, if any, covers this point?
            gx = px - origin
            gy = py - origin
            if gx < 0 or gy < 0 or gx >= span or gy >= span:
                continue
            col = int(gx // (cell + gap))
            rowi = int(gy // (cell + gap))
            if col >= n or rowi >= n:
                continue
            lx = gx - col * (cell + gap)
            ly = gy - rowi * (cell + gap)
            if lx >= cell or ly >= cell:
                continue
            if not rounded(lx, ly, cell, cell_radius):
                continue
            colour = cells[rowi * n + col]
            buf[i] = colour[0]
            buf[i + 1] = colour[1]
            buf[i + 2] = colour[2]
            buf[i + 3] = 255

    # Average each SCALE x SCALE block down to one pixel.
    out = bytearray(size * size * 4)
    for y in range(size):
        for x in range(size):
            r = g = b = a = 0
            for sy in range(SCALE):
                base = ((y * SCALE + sy) * big + x * SCALE) * 4
                for sx in range(SCALE):
                    i = base + sx * 4
                    alpha = buf[i + 3]
                    r += buf[i] * alpha
                    g += buf[i + 1] * alpha
                    b += buf[i + 2] * alpha
                    a += alpha
            o = (y * size + x) * 4
            if a:
                out[o] = min(255, r // a)
                out[o + 1] = min(255, g // a)
                out[o + 2] = min(255, b // a)
            out[o + 3] = a // (SCALE * SCALE)
    return out


# path, design, pixel size, full bleed, content fraction, draw background
TARGETS = [
    # web: the launcher
    ("assets/icons/apps-192.png", "apps", 192, False, 0.56, True),
    ("assets/icons/apps-512.png", "apps", 512, False, 0.56, True),
    ("assets/icons/apps-maskable-512.png", "apps", 512, True, 0.44, True),
    # web: Rubik's Solver
    ("apps/rubiks-solver/icons/icon-192.png", "cube", 192, False, 0.62, True),
    ("apps/rubiks-solver/icons/icon-512.png", "cube", 512, False, 0.62, True),
    ("apps/rubiks-solver/icons/icon-maskable-512.png", "cube", 512, True, 0.48, True),
    # android: legacy launcher icon, one per density
    ("android/app/src/main/res/mipmap-mdpi/ic_launcher.png", "apps", 48, False, 0.56, True),
    ("android/app/src/main/res/mipmap-hdpi/ic_launcher.png", "apps", 72, False, 0.56, True),
    ("android/app/src/main/res/mipmap-xhdpi/ic_launcher.png", "apps", 96, False, 0.56, True),
    ("android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png", "apps", 144, False, 0.56, True),
    ("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png", "apps", 192, False, 0.56, True),
    # android: adaptive icon foreground, 108dp per density, transparent behind
    ("android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png", "apps", 108, True, 0.40, False),
    ("android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png", "apps", 162, True, 0.40, False),
    ("android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png", "apps", 216, True, 0.40, False),
    ("android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png", "apps", 324, True, 0.40, False),
    ("android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png", "apps", 432, True, 0.40, False),
    # android: the play-store style icon, handy for listings
    ("android/app/src/main/ic_launcher-playstore.png", "apps", 512, True, 0.44, True),
]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true",
                        help="report what would change without writing")
    args = parser.parse_args()

    changed = []
    for rel, design, size, full_bleed, content, tile in TARGETS:
        pixels = draw(DESIGNS[design], size, full_bleed=full_bleed,
                      content=content, tile=tile)
        data = write_png(ROOT / rel, size, size, pixels)
        path = ROOT / rel
        if path.exists() and path.read_bytes() == data:
            continue
        changed.append(rel)
        if not args.check:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

    if args.check:
        if changed:
            print("icons out of date:")
            for rel in changed:
                print("  " + rel)
            return 1
        print("all %d icons up to date" % len(TARGETS))
        return 0

    print("wrote %d icon%s" % (len(changed), "" if len(changed) == 1 else "s")
          if changed else "all %d icons already up to date" % len(TARGETS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
