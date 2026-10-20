#!/usr/bin/env python3
"""Generate native app icons and launch images from the repository favicon."""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public" / "favicon.ico"
BACKGROUND = (8, 12, 22, 255)
RESAMPLE = Image.Resampling.LANCZOS

if not SOURCE.exists():
    raise SystemExit(f"Brand source image not found: {SOURCE}")

mark = Image.open(SOURCE).convert("RGBA")


def make_canvas(width, height, mark_side, transparent=False):
    bg = (0, 0, 0, 0) if transparent else BACKGROUND
    canvas = Image.new("RGBA", (width, height), bg)
    resized = mark.resize((mark_side, mark_side), RESAMPLE)
    canvas.alpha_composite(resized, ((width - mark_side) // 2, (height - mark_side) // 2))
    return canvas


# iOS requires an opaque square app icon; the existing repository mark is centered on dark navy.
ios_icon = ROOT / "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
make_canvas(1024, 1024, 1024).convert("RGB").save(ios_icon, optimize=True)

# Android legacy launcher icons use opaque backgrounds. Adaptive foregrounds preserve alpha.
for folder in (ROOT / "android/app/src/main/res").glob("mipmap-*"):
    for name in ("ic_launcher.png", "ic_launcher_round.png"):
        path = folder / name
        if path.exists():
            size = Image.open(path).size[0]
            make_canvas(size, size, size).convert("RGB").save(path, optimize=True)
    foreground = folder / "ic_launcher_foreground.png"
    if foreground.exists():
        size = Image.open(foreground).size[0]
        make_canvas(size, size, size, transparent=True).save(foreground, optimize=True)

# Keep the existing native splash layouts and dimensions, replacing only their placeholder mark.
for path in (ROOT / "android/app/src/main/res").glob("drawable*/splash.png"):
    with Image.open(path) as original:
        width, height = original.size
    mark_side = max(1, round(min(width, height) * 0.46))
    make_canvas(width, height, mark_side).convert("RGB").save(path, optimize=True)

for path in (ROOT / "ios/App/App/Assets.xcassets/Splash.imageset").glob("splash*.png"):
    with Image.open(path) as original:
        width, height = original.size
    mark_side = max(1, round(min(width, height) * 0.38))
    make_canvas(width, height, mark_side).convert("RGB").save(path, optimize=True)

print("Generated native icon and launch assets from public/favicon.ico")
