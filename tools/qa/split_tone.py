#!/usr/bin/env python3
"""
split_tone.py -- QA tool. Measures color bias in shadows vs highlights.

For each image, computes mean R-B (red minus blue, 0-255 scale) separately
for shadow pixels (luma Y < 85), midtone pixels (85 <= Y <= 170), and
highlight pixels (Y > 170). A positive R-B means the region leans warm/red;
negative leans cool/blue. Comparing this across looks shows whether a grade's
split-tone (different color bias in shadows vs highlights) is doing what it
claims -- e.g. "warm" should show shadows and/or highlights pulled warmer
than the source, not just a flat gain applied everywhere.

Usage:
    python3 split_tone.py image1.png [image2.png ...]

The first argument is treated as the baseline for delta columns.
"""
import sys
import os
import numpy as np
from PIL import Image


def luma(arr):
    r, g, b = arr[..., 0].astype(np.float64), arr[..., 1].astype(np.float64), arr[..., 2].astype(np.float64)
    return 0.299 * r + 0.587 * g + 0.114 * b


def split_tone_stats(img_path):
    img = np.array(Image.open(img_path).convert("RGB"))
    y = luma(img)
    r = img[..., 0].astype(np.float64)
    b = img[..., 2].astype(np.float64)
    rb = r - b
    shadow_mask = y < 85
    mid_mask = (y >= 85) & (y <= 170)
    high_mask = y > 170
    out = {}
    for name, mask in (("shadow", shadow_mask), ("mid", mid_mask), ("highlight", high_mask)):
        if mask.sum() == 0:
            out[name] = float("nan")
        else:
            out[name] = float(rb[mask].mean())
    return out


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
        rows.append((os.path.basename(p), split_tone_stats(p)))

    base = rows[0][1]

    print(f"{'image':30s} {'shadow R-B':>12s} {'mid R-B':>10s} {'highlight R-B':>14s} {'d_shadow':>10s} {'d_highlight':>12s}")
    for name, st in rows:
        print(f"{name:30s} {st['shadow']:12.3f} {st['mid']:10.3f} {st['highlight']:14.3f} "
              f"{st['shadow']-base['shadow']:+10.3f} {st['highlight']-base['highlight']:+12.3f}")

    print()
    print(f"baseline = {rows[0][0]}")
    print("Reading this table:")
    print("  positive R-B = warm/red bias in that luma region; negative = cool/blue bias.")
    print("  a real split-tone shows shadow and highlight deltas MOVING DIFFERENTLY from each")
    print("  other (not a flat shift across both) -- that's the signature of shadow/highlight")
    print("  color separation rather than a single global white-balance gain.")
    print("  if every image's delta vs baseline is exactly 0.000, this metric did not move --")
    print("  treat it as a suspected-broken measurement, not a pass.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
