#!/usr/bin/env python3
"""
skin_hue_saturation.py -- QA-ONLY tool. Do not use for production masking.

Measures HSV saturation (S) restricted to pixels that fall in a skin-ish hue
band: H in [5, 40] degrees, S > 8%, V > 15%. This mirrors the band the Look.tsx
comment describes a colorist using -- it is a coarse, single-hue-range proxy,
NOT a real skin segmenter. It will include non-skin orange/tan pixels (wood,
certain fabrics) and will miss skin outside this hue/light range. Good enough
for A/B "did this look push skin saturation up" comparisons across renders of
the SAME source; not safe as a production selection mask (see repo rules).

Usage:
    python3 skin_hue_saturation.py image1.png [image2.png ...]

Each argument is one still frame (any PIL-readable format: png/jpg/etc).
Prints one row per image: mean HSV saturation (%) over pixels in the skin-hue
band, and how many pixels qualified. If the first argument's filename
contains "source" or starts with "L0", it is treated as the baseline and a
delta-vs-baseline column is printed too; otherwise deltas are printed against
the first image given.
"""
import sys
import os
import numpy as np
from PIL import Image


def rgb_to_hsv_arrays(img):
    """Vectorized RGB(0-255 uint8, HxWx3) -> HSV, matching colorsys convention.
    Returns H in [0,360), S in [0,100], V in [0,100]."""
    arr = img.astype(np.float64) / 255.0
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    maxc = np.max(arr, axis=-1)
    minc = np.min(arr, axis=-1)
    v = maxc
    delta = maxc - minc
    s = np.where(maxc == 0, 0, delta / np.where(maxc == 0, 1, maxc))
    rc = np.where(delta == 0, 0, (maxc - r) / np.where(delta == 0, 1, delta))
    gc = np.where(delta == 0, 0, (maxc - g) / np.where(delta == 0, 1, delta))
    bc = np.where(delta == 0, 0, (maxc - b) / np.where(delta == 0, 1, delta))
    h = np.zeros_like(maxc)
    is_r = (maxc == r) & (delta != 0)
    is_g = (maxc == g) & (delta != 0)
    is_b = (maxc == b) & (delta != 0)
    h[is_r] = (bc - gc)[is_r]
    h[is_g] = 2.0 + (rc - bc)[is_g]
    h[is_b] = 4.0 + (gc - rc)[is_b]
    h = (h / 6.0) % 1.0
    return h * 360.0, s * 100.0, v * 100.0


def skin_hue_stats(img_path):
    img = np.array(Image.open(img_path).convert("RGB"))
    h, s, v = rgb_to_hsv_arrays(img)
    mask = (h >= 5) & (h <= 40) & (s > 8) & (v > 15)
    n = int(mask.sum())
    if n == 0:
        return {"sat_mean": float("nan"), "hue_mean": float("nan"), "px": 0}
    return {
        "sat_mean": float(s[mask].mean()),
        "hue_mean": float(h[mask].mean()),
        "px": n,
    }


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 1
    paths = argv[1:]
    rows = []
    for p in paths:
        if not os.path.isfile(p):
            print(f"ERROR: not a file: {p}", file=sys.stderr)
            return 2
        rows.append((os.path.basename(p), skin_hue_stats(p)))

    baseline = rows[0][1]["sat_mean"]

    print(f"{'image':30s} {'skin-hue SATavg (HSV S,%)':>26s} {'skin-hue HUEavg (deg)':>22s} {'px in band':>12s} {'delta vs baseline':>18s}")
    for name, st in rows:
        delta = st["sat_mean"] - baseline
        print(f"{name:30s} {st['sat_mean']:26.3f} {st['hue_mean']:22.3f} {st['px']:12d} {delta:+18.3f}")

    print()
    print(f"baseline = {rows[0][0]}")
    print("Reading this table:")
    print("  - skin saturation should NOT exceed the baseline (source) without a deliberate decision.")
    print("  - skin hue should not visibly shift toward orange/red/magenta (watch hue_mean drift).")
    print("  - SATavg alone is a DIAGNOSTIC, not a hard gate (per product-owner ruling).")
    print("  - if delta is exactly 0.000 for every non-baseline image, this metric did not move --")
    print("    treat it as a suspected-broken measurement, not a pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
