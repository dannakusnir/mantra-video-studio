#!/usr/bin/env python3
"""
crops.py -- produces the "look at it" QA material in out/qa/:

  compare-row.png       all input videos, same reference frame, side by side, labeled
  crop-face-100pct.png  1:1 pixel face crop, all videos, side by side
  crop-hair-100pct.png  1:1 pixel hair-detail crop, all videos, side by side
  crop-bg-dark-100pct.png 1:1 pixel dark-background crop, all videos, side by side
  frame-highlight.png   full frame at the timestamp measured to have the most
                         blown-out/bright pixels, all videos, side by side
  frame-motion.png      full frame at the timestamp measured to have the most
                         inter-frame motion, all videos, side by side
  selection.json        the measured timestamps + why, so the picks are
                         reproducible and auditable (not eyeballed)

Usage:
    python3 crops.py SOURCE.mp4 L0.mp4 [L1.mp4 L2.mp4 L3.mp4 ...] --out-dir out/qa

SOURCE.mp4 is used ONLY to MEASURE the highlight and motion timestamps (per
the brief: those two picks must come from measurement on the source, not a
guess). The frames actually extracted and shown for every deliverable are
pulled from the video list that follows (normally L0..L3) at those measured
timestamps, plus the fixed REFERENCE_T for the face/hair/bg-dark crops and
compare-row.

Crop boxes (FACE_BOX/HAIR_BOX/BG_BOX/BG_DARK_BOX) and REFERENCE_T are defined
once in _common.py -- see the comments there for how they were picked and,
for the dark-background box, an explicit note that this footage has no truly
black background region (the darkest available spot is a light-gray cabinet
panel with near-black seam-shadow pixels).
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c

SELECT_SCAN_W, SELECT_SCAN_H = 270, 480
HIGHLIGHT_Y_THRESH = 250
LABEL_H = 44


def select_highlight_and_motion(source_path):
    """Scan EVERY native frame of source_path (downscaled, grayscale, one
    ffmpeg pass) and measure:
      - highlight_t: timestamp with the highest % of near-white (Y>=250) pixels
      - motion_t:    timestamp with the largest mean |luma diff| vs the
                      previous native frame (true adjacent-frame motion,
                      native fps, whole video -- not a sparse sample)
    Returns a dict with both timestamps and the measurements that justify them.
    """
    frames, fps = c.sample_all_frames_gray(source_path, SELECT_SCAN_W, SELECT_SCAN_H)
    n = frames.shape[0]
    f = frames.astype(np.float64)

    bright_pct = 100.0 * np.mean(f >= HIGHLIGHT_Y_THRESH, axis=(1, 2))
    hi_idx = int(np.argmax(bright_pct))
    hi_t = hi_idx / fps

    diffs = np.mean(np.abs(np.diff(f, axis=0)), axis=(1, 2))
    mo_idx = int(np.argmax(diffs)) + 1  # the later frame of the peak-diff pair
    mo_t = mo_idx / fps

    return {
        "source": source_path,
        "fps": fps,
        "n_native_frames_scanned": n,
        "highlight": {
            "t_sec": hi_t,
            "frame_index": hi_idx,
            "bright_pct_at_pick": float(bright_pct[hi_idx]),
            "bright_pct_mean": float(bright_pct.mean()),
            "bright_pct_std": float(bright_pct.std()),
            "why": f"argmax over all {n} native frames of %% pixels with Y>={HIGHLIGHT_Y_THRESH} "
                   f"(scan at {SELECT_SCAN_W}x{SELECT_SCAN_H}, grayscale)",
        },
        "motion": {
            "t_sec": mo_t,
            "frame_index": mo_idx,
            "diff_at_pick": float(diffs[mo_idx - 1]),
            "diff_mean": float(diffs.mean()),
            "diff_std": float(diffs.std()),
            "why": f"argmax over all {n-1} native adjacent-frame pairs of mean |Y[t]-Y[t-1]| "
                   f"(scan at {SELECT_SCAN_W}x{SELECT_SCAN_H}, grayscale)",
        },
    }


def label_strip(width, text):
    img = Image.new("RGB", (width, LABEL_H), (20, 20, 20))
    d = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 24)
    except Exception:
        font = ImageFont.load_default()
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    d.text(((width - tw) // 2, 8), text, fill=(255, 255, 255), font=font)
    return img


def montage(images, labels, out_path, gap=6, bg=(10, 10, 10)):
    """Horizontal strip of same-size images, each with a label above it."""
    assert len(images) == len(labels)
    w, h = images[0].size
    for im in images:
        assert im.size == (w, h), f"size mismatch: {im.size} vs {(w, h)}"
    total_w = w * len(images) + gap * (len(images) - 1)
    total_h = h + LABEL_H
    canvas = Image.new("RGB", (total_w, total_h), bg)
    x = 0
    for im, label in zip(images, labels):
        canvas.paste(label_strip(w, label), (x, 0))
        canvas.paste(im, (x, LABEL_H))
        x += w + gap
    canvas.save(out_path)
    return out_path


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="source video, used only to MEASURE highlight/motion timestamps")
    ap.add_argument("videos", nargs="+", help="videos to render crops from (e.g. L0 L1 L2 L3)")
    ap.add_argument("--out-dir", default="out/qa")
    args = ap.parse_args()

    for p in [args.source] + args.videos:
        if not os.path.isfile(p):
            print(f"ERROR: not a file: {p}", file=sys.stderr)
            sys.exit(2)

    os.makedirs(args.out_dir, exist_ok=True)

    print(f"Measuring highlight/motion timestamps on source: {args.source}", file=sys.stderr)
    sel = select_highlight_and_motion(args.source)
    with open(os.path.join(args.out_dir, "selection.json"), "w") as f:
        json.dump(sel, f, indent=2)
    print(f"  highlight_t = {sel['highlight']['t_sec']:.3f}s "
          f"({sel['highlight']['bright_pct_at_pick']:.3f}% bright pixels, "
          f"clip mean {sel['highlight']['bright_pct_mean']:.3f}% / std {sel['highlight']['bright_pct_std']:.3f}%)")
    print(f"  motion_t    = {sel['motion']['t_sec']:.3f}s "
          f"(frame-diff {sel['motion']['diff_at_pick']:.3f}, "
          f"clip mean {sel['motion']['diff_mean']:.3f} / std {sel['motion']['diff_std']:.3f})")

    names = [os.path.splitext(os.path.basename(p))[0] for p in args.videos]
    tmp_dir = os.path.join(args.out_dir, "_frames_tmp")
    os.makedirs(tmp_dir, exist_ok=True)

    def grab(video_path, t, tag):
        out_png = os.path.join(tmp_dir, f"{tag}.png")
        c.extract_frame_png(video_path, t, out_png)
        return Image.open(out_png).convert("RGB")

    ref_frames = [grab(p, c.REFERENCE_T, f"ref_{n}") for p, n in zip(args.videos, names)]
    hi_frames = [grab(p, sel["highlight"]["t_sec"], f"hi_{n}") for p, n in zip(args.videos, names)]
    mo_frames = [grab(p, sel["motion"]["t_sec"], f"mo_{n}") for p, n in zip(args.videos, names)]

    # 1. compare-row: full reference frame, downscaled for a manageable montage width
    scale_w = 360
    ratio = scale_w / ref_frames[0].width
    scale_h = int(ref_frames[0].height * ratio)
    small = [im.resize((scale_w, scale_h), Image.LANCZOS) for im in ref_frames]
    montage(small, names, os.path.join(args.out_dir, "compare-row.png"))

    # 2-4. 100% pixel crops
    def crop_all(frames, box):
        return [im.crop(box) for im in frames]

    montage(crop_all(ref_frames, c.FACE_BOX), names, os.path.join(args.out_dir, "crop-face-100pct.png"))
    montage(crop_all(ref_frames, c.HAIR_BOX), names, os.path.join(args.out_dir, "crop-hair-100pct.png"))
    montage(crop_all(ref_frames, c.BG_DARK_BOX), names, os.path.join(args.out_dir, "crop-bg-dark-100pct.png"))

    # 5. highlight frame, full size (downscaled to keep montage width sane)
    hi_small = [im.resize((scale_w, scale_h), Image.LANCZOS) for im in hi_frames]
    montage(hi_small, [f"{n} @ {sel['highlight']['t_sec']:.2f}s" for n in names],
            os.path.join(args.out_dir, "frame-highlight.png"))

    # 6. motion frame, full size (downscaled)
    mo_small = [im.resize((scale_w, scale_h), Image.LANCZOS) for im in mo_frames]
    montage(mo_small, [f"{n} @ {sel['motion']['t_sec']:.2f}s" for n in names],
            os.path.join(args.out_dir, "frame-motion.png"))

    # cleanup tmp frames (montages already saved)
    import shutil
    shutil.rmtree(tmp_dir, ignore_errors=True)

    print(f"\nWrote to {args.out_dir}:")
    for fn in ["compare-row.png", "crop-face-100pct.png", "crop-hair-100pct.png",
               "crop-bg-dark-100pct.png", "frame-highlight.png", "frame-motion.png", "selection.json"]:
        print(f"  {os.path.join(args.out_dir, fn)}")


if __name__ == "__main__":
    main()
