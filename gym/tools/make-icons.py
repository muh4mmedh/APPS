#!/usr/bin/env python3
"""
make-icons.py — draw the app icons: a dumbbell on the collection's dark tile.

Needs Pillow (pip install pillow). Run from anywhere:

  python3 gym/tools/make-icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "icons"
TILE = (0x11, 0x14, 0x1C)
GLOW = (0x3A, 0x2C, 0x9E)
BAR = (0xE9, 0xED, 0xF6)
PLATE = (0x9D, 0x8F, 0xFF)
SS = 4  # supersample, then shrink for smooth edges


def draw(size, maskable, tile=True, k=None):
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    radius = 0 if maskable else int(s * 0.22)
    if tile:
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=TILE)

    if tile:
        add_glow(img, s, radius)
    # Maskable icons get cropped to a circle, so keep the art in the middle 60%.
    k = k or (0.62 if maskable else 0.8)
    dumbbell(d, s, k)
    return img.resize((size, size), Image.LANCZOS)


def add_glow(img, s, radius):
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([s * -0.1, s * -0.3, s * 0.9, s * 0.6], fill=GLOW + (150,))
    glow = glow.filter(ImageFilter.GaussianBlur(s * 0.12))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=radius, fill=255)
    img.paste(glow, (0, 0), Image.composite(glow, Image.new("RGBA", (s, s)), mask).split()[3])


def dumbbell(d, s, k):
    def r(x0, y0, x1, y1, fill, rad):
        c = s / 2
        box = [c + (x0 - 0.5) * s * k, c + (y0 - 0.5) * s * k, c + (x1 - 0.5) * s * k, c + (y1 - 0.5) * s * k]
        d.rounded_rectangle(box, radius=rad * s * k, fill=fill)

    r(0.18, 0.46, 0.82, 0.54, BAR, 0.03)              # bar
    r(0.22, 0.28, 0.32, 0.72, PLATE, 0.04)            # inner plates
    r(0.68, 0.28, 0.78, 0.72, PLATE, 0.04)
    r(0.10, 0.36, 0.20, 0.64, PLATE, 0.04)            # outer plates
    r(0.80, 0.36, 0.90, 0.64, PLATE, 0.04)


OUT.mkdir(exist_ok=True)
draw(192, False).save(OUT / "icon-192.png")
draw(512, False).save(OUT / "icon-512.png")
draw(512, True).save(OUT / "icon-maskable-512.png")
# Android launcher icons: a legacy tile per density, and the foreground layer
# of the adaptive icon (108dp canvas, art inside the middle 66dp).
RES = OUT.parent / "android" / "res"
for name, dp in [("mdpi", 1), ("hdpi", 1.5), ("xhdpi", 2), ("xxhdpi", 3), ("xxxhdpi", 4)]:
    folder = RES / ("mipmap-" + name)
    folder.mkdir(parents=True, exist_ok=True)
    draw(int(48 * dp), False).save(folder / "ic_launcher.png")
    draw(int(108 * dp), True, tile=False, k=0.5).save(folder / "ic_launcher_foreground.png")

print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.png"))))
