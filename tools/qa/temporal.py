#!/usr/bin/env python3
"""
temporal.py -- motion-QA measurement across a set of graded video renders.

Usage:
    python3 temporal.py L0-Source.mp4 L1-Natural.mp4 L2-Warm.mp4 L3-Crisp.mp4 [--out-json PATH]

The FIRST video given is the baseline (per the QA brief: L0 is the ungraded
control). Every other video is reported as a delta/ratio against it. If the
first argument's basename doesn't start with "L0" or contain "source" or
"control", a warning is printed (wrong argument order is a real way to get a
meaningless report here) but the run still proceeds treating argv[1] as
baseline.

WHY TWO SAMPLING PASSES, not one:
  WIDE  (default 64 frames, evenly spaced across the FULL clip): used for
        every metric where whole-video coverage matters more than adjacent
        native frames -- brightness/temporal-consistency trend, black crush,
        highlight clipping (the hard gate -- must not miss a clipped region
        that happens outside a short window), skin texture, background
        noise, banding, and the color-shift-vs-motion analysis (motion here
        is the WIDE-grid frame-to-frame luma delta, i.e. "how much changed
        in the ~0.4s between samples", not true per-frame motion).
  DENSE (default 90 CONSECUTIVE native frames, one ~3s window mid-clip):
        used for the ONE metric that specifically needs true adjacent-frame
        pairs -- flicker and the frame-to-frame YAVG jitter stdev. Native fps
        here is 30, so 90 frames = ~3s, comfortably over the ">=60 frames"
        floor in the brief on its own.
Both passes satisfy "sample at least 60 frames, not 3" independently; between
them every metric in the brief is backed by >=60 real decoded frames.

Metrics computed per video (see README.md for the full explanation of each
and what "normal" looks like):
  yavg_mean, yavg_std           -- WIDE brightness + its stability
  frame_diff_std (dense)        -- adjacent-frame YAVG jitter
  flicker_count / flicker_mean_mag (dense) -- jumps over a fixed threshold
  bitrate_bps                   -- ffprobe, actual encoded bitrate
  blockiness_ratio              -- 8px-boundary gradient energy vs elsewhere
  halo_energy                   -- unsharp-residual magnitude in a ring
                                    around L0's strong edges (0 for L0 itself)
  skin_texture_var              -- Laplacian variance in the skin-hue mask
                                    inside the face box (must not drop vs L0)
  black_crush_pct               -- % pixels with Y<=16, whole frame
  highlight_clip_pct            -- % pixels with Y>=250, whole frame (HARD GATE)
  noise_std                     -- high-pass residual stdev, bright wall crop
  banding_gaps                  -- histogram gap-run count, bright wall crop
  color_motion_corr             -- corr(R-B, WIDE motion) across the clip
  color_motion_quartile_delta   -- mean R-B in high-motion vs low-motion quartile

A metric whose value is bit-identical across every video in the set (delta
0.000 for every non-baseline video) is flagged SUSPECT-BROKEN in the output
instead of being presented as a passing result -- an unchanging measurement
of four different renders almost always means the measurement isn't actually
looking at what changed, not that nothing changed.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c

WIDE_N = 64
DENSE_N = 90
FLICKER_THRESHOLD = 1.0  # YAVG jump (0..255 scale) between adjacent native frames


def blockiness_score(y):
    dx = np.abs(np.diff(y, axis=1))
    idx = np.arange(dx.shape[1])
    bmask = (idx + 1) % 8 == 0
    b_e = dx[:, bmask].mean()
    nb_e = dx[:, ~bmask].mean()

    dy = np.abs(np.diff(y, axis=0))
    idy = np.arange(dy.shape[0])
    bmasky = (idy + 1) % 8 == 0
    b_ey = dy[bmasky, :].mean()
    nb_ey = dy[~bmasky, :].mean()

    b = (b_e + b_ey) / 2.0
    nb = (nb_e + nb_ey) / 2.0
    # A tiny epsilon (not a hard nan-below-threshold guard) so a perfectly
    # flat interior between block boundaries -- e.g. heavy quantization --
    # produces a large finite ratio instead of nan/undefined. On real video
    # frames nb is essentially never that close to zero, so this doesn't
    # change normal-footage behavior.
    return float(b / (nb + 0.05))


def halo_score(y_look, y_ref_edges_mask, ring_mask):
    if ring_mask.sum() == 0:
        return float("nan")
    residual = y_look - c.gaussian_blur(y_look, sigma=1.5)
    return float(np.abs(residual[ring_mask]).mean())


def build_ring_mask(y_l0):
    edges = c.sobel_magnitude(y_l0)
    thresh = np.percentile(edges, 95)
    strong = edges >= thresh
    ring = c.dilate_bool(strong, radius=4) & ~c.dilate_bool(strong, radius=1)
    return ring


def skin_texture_score(rgb_frame):
    face = c.crop_box(rgb_frame, c.FACE_BOX)
    h_, s_, v_ = c.rgb_to_hsv_arrays(face)
    mask = (h_ >= 5) & (h_ <= 40) & (s_ > 8) & (v_ > 15)
    if mask.sum() < 200:
        return float("nan"), int(mask.sum())
    y = c.luma(face)
    lap = c.laplacian(y)
    return float(np.var(lap[mask])), int(mask.sum())


def noise_score(y_region):
    hp = y_region - c.gaussian_blur(y_region, sigma=2.0)
    return float(hp.std())


def banding_score(y_region):
    hist, _ = np.histogram(y_region, bins=256, range=(0, 255))
    total = y_region.size
    used = hist > max(1, total * 0.0005)
    idx = np.where(used)[0]
    if len(idx) < 2:
        return 0.0
    lo, hi = idx.min(), idx.max()
    span = used[lo : hi + 1]
    return float(np.sum(~span))


def compute_wide_metrics(frames_rgb, l0_y_wide, is_baseline):
    """frames_rgb: (N,H,W,3) uint8 for THIS look. l0_y_wide: (N,H,W) float64
    luma of the baseline at the SAME wide sample indices (== frames' own luma
    if is_baseline)."""
    n = frames_rgb.shape[0]
    yavg = np.empty(n)
    black_pct = np.empty(n)
    hi_pct = np.empty(n)
    block = np.empty(n)
    halo = np.empty(n)
    skin_tex = np.empty(n)
    skin_px = np.empty(n)
    noise = np.empty(n)
    band = np.empty(n)
    rb_mean = np.empty(n)
    y_small = []

    for i in range(n):
        f = frames_rgb[i].astype(np.float64)
        y = c.luma(f)
        yavg[i] = y.mean()
        black_pct[i] = 100.0 * np.mean(y <= 16)
        hi_pct[i] = 100.0 * np.mean(y >= 250)
        block[i] = blockiness_score(y)
        rb_mean[i] = float((f[..., 0] - f[..., 2]).mean())

        ring = build_ring_mask(l0_y_wide[i])
        halo[i] = halo_score(y, None, ring)

        st, spx = skin_texture_score(f)
        skin_tex[i] = st
        skin_px[i] = spx

        bg = c.crop_box(y, c.BG_BOX)
        noise[i] = noise_score(bg)
        band[i] = banding_score(bg)

        y_small.append(y[::8, ::8])

    y_small = np.stack(y_small)
    motion = np.zeros(n)
    motion[1:] = np.mean(np.abs(np.diff(y_small, axis=0)), axis=(1, 2))

    if n > 4 and np.std(motion[1:]) > 1e-9:
        corr = float(np.corrcoef(rb_mean[1:], motion[1:])[0, 1])
        order = np.argsort(motion[1:])
        q = max(1, len(order) // 4)
        low_idx = order[:q]
        high_idx = order[-q:]
        rb_vals = rb_mean[1:]
        quartile_delta = float(rb_vals[high_idx].mean() - rb_vals[low_idx].mean())
    else:
        corr = float("nan")
        quartile_delta = float("nan")

    return {
        "yavg_mean": float(yavg.mean()),
        "yavg_std": float(yavg.std()),
        "black_crush_pct": float(black_pct.mean()),
        "highlight_clip_pct": float(hi_pct.mean()),
        "blockiness_ratio": float(np.nanmean(block)),
        "halo_energy": float(np.nanmean(halo)),
        "skin_texture_var": float(np.nanmean(skin_tex)),
        "skin_texture_px_mean": float(np.nanmean(skin_px)),
        "noise_std": float(np.nanmean(noise)),
        "banding_gaps": float(np.nanmean(band)),
        "color_motion_corr": corr,
        "color_motion_quartile_delta": quartile_delta,
        "_yavg_series": yavg.tolist(),
    }


def compute_dense_metrics(frames_rgb):
    n = frames_rgb.shape[0]
    yavg = np.empty(n)
    for i in range(n):
        yavg[i] = c.luma(frames_rgb[i].astype(np.float64)).mean()
    diffs = np.diff(yavg)
    flicker_mask = np.abs(diffs) > FLICKER_THRESHOLD
    return {
        "frame_diff_std": float(diffs.std()),
        "flicker_count": int(flicker_mask.sum()),
        "flicker_rate_pct": float(100.0 * flicker_mask.mean()),
        "flicker_mean_mag": float(np.abs(diffs[flicker_mask]).mean()) if flicker_mask.any() else 0.0,
        "dense_n_frames": n,
    }


def fmt(v, width=12, prec=3):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return f"{'n/a':>{width}}"
    return f"{v:{width}.{prec}f}"


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("videos", nargs="+", help="video files; first = baseline (L0)")
    ap.add_argument("--out-json", default=None, help="optional path to write full results as JSON")
    ap.add_argument("--wide-n", type=int, default=WIDE_N)
    ap.add_argument("--dense-n", type=int, default=DENSE_N)
    args = ap.parse_args()

    for p in args.videos:
        if not os.path.isfile(p):
            print(f"ERROR: not a file: {p}", file=sys.stderr)
            sys.exit(2)

    base_name = os.path.basename(args.videos[0]).lower()
    if not any(tag in base_name for tag in ("l0", "source", "control")):
        print(f"WARNING: first argument '{args.videos[0]}' doesn't look like a baseline "
              f"(expected something with 'L0'/'source'/'control' in the name). "
              f"Proceeding, treating it as baseline anyway.", file=sys.stderr)

    probes = {p: c.probe(p) for p in args.videos}
    durations = [probes[p]["duration"] for p in args.videos]
    if max(durations) - min(durations) > 0.25:
        print(f"WARNING: durations differ by more than 0.25s across inputs ({durations}); "
              f"WIDE-grid timestamp alignment between looks (used for the halo metric) "
              f"may be off by a frame or more.", file=sys.stderr)

    results = {}
    l0_path = args.videos[0]

    print(f"Sampling WIDE={args.wide_n} frames (full video) + DENSE={args.dense_n} "
          f"consecutive native frames (mid-clip) per video...\n", file=sys.stderr)

    # Baseline first: keep its WIDE luma stack around for every other look's halo metric.
    l0_frames, l0_ts = c.sample_frames_rgb(l0_path, args.wide_n, dtype=np.uint8)
    l0_y_wide = c.luma(l0_frames.astype(np.float64))
    dur0 = probes[l0_path]["duration"]
    dense_start0 = max(0.0, dur0 / 2 - (args.dense_n / probes[l0_path]["fps"]) / 2)
    l0_dense, _ = c.sample_consecutive_frames_rgb(l0_path, args.dense_n, dense_start0)

    wide0 = compute_wide_metrics(l0_frames, l0_y_wide, is_baseline=True)
    dense0 = compute_dense_metrics(l0_dense)
    results[l0_path] = {**wide0, **dense0, "probe": probes[l0_path]}
    del l0_frames, l0_dense

    for p in args.videos[1:]:
        frames, ts = c.sample_frames_rgb(p, args.wide_n, dtype=np.uint8)
        dur = probes[p]["duration"]
        dense_start = max(0.0, dur / 2 - (args.dense_n / probes[p]["fps"]) / 2)
        dense_frames, _ = c.sample_consecutive_frames_rgb(p, args.dense_n, dense_start)
        wide = compute_wide_metrics(frames, l0_y_wide, is_baseline=False)
        dense = compute_dense_metrics(dense_frames)
        results[p] = {**wide, **dense, "probe": probes[p]}
        del frames, dense_frames

    names = [os.path.basename(p) for p in args.videos]
    base = results[l0_path]

    def row(label, key, prec=3, hard_gate=False, higher_is_worse=None):
        vals = [results[p][key] for p in args.videos]
        cells = "  ".join(fmt(v, 14, prec) for v in vals)
        print(f"{label:28s} {cells}")
        if len(vals) > 1:
            nonbase = vals[1:]
            if all(abs(v - vals[0]) < 1e-9 for v in nonbase if not (isinstance(v, float) and np.isnan(v))):
                print(f"{'  -> SUSPECT-BROKEN':28s} (identical to baseline for every look; metric did not move)")

    print("=" * 110)
    print("TEMPORAL QA -- " + "  ".join(f"{n:>14s}" for n in names))
    print("=" * 110)
    print(f"{'':28s} " + "  ".join(f"{n:>14.14s}" for n in names))
    print("-" * 110)
    # bitrate needs its own formatting (int, from nested probe dict)
    br_vals = [results[p]["probe"]["bit_rate"] for p in args.videos]
    print(f"{'bitrate_bps':28s} " + "  ".join(f"{(v or 0):14d}" for v in br_vals))
    print()
    row("yavg_mean", "yavg_mean")
    row("yavg_std (temporal consist.)", "yavg_std")
    row("frame_diff_std (dense,adj)", "frame_diff_std")
    row("flicker_count (dense)", "flicker_count", prec=0)
    row("flicker_rate_pct (dense)", "flicker_rate_pct")
    row("flicker_mean_mag (dense)", "flicker_mean_mag")
    print()
    row("blockiness_ratio", "blockiness_ratio")
    row("halo_energy", "halo_energy")
    row("skin_texture_var", "skin_texture_var")
    row("skin_texture_px_mean", "skin_texture_px_mean", prec=0)
    print()
    row("black_crush_pct", "black_crush_pct")
    row("highlight_clip_pct [HARD GATE]", "highlight_clip_pct")
    row("noise_std (bright wall)", "noise_std")
    row("banding_gaps (bright wall)", "banding_gaps", prec=1)
    print()
    row("color_motion_corr", "color_motion_corr")
    row("color_motion_quartile_delta", "color_motion_quartile_delta")

    print()
    print("HIGHLIGHT CLIPPING HARD GATE (per product owner: must not regress vs L0):")
    base_hi = base["highlight_clip_pct"]
    for p in args.videos:
        v = results[p]["highlight_clip_pct"]
        if p == l0_path:
            print(f"  {os.path.basename(p):24s} {v:8.3f}%  (baseline)")
            continue
        delta = v - base_hi
        rel = (delta / base_hi * 100) if base_hi > 1e-6 else float("inf") if delta > 0 else 0.0
        gate = "FAIL" if (delta > 0.5 or (base_hi <= 0.01 and v > 0.05)) else "PASS"
        print(f"  {os.path.basename(p):24s} {v:8.3f}%  delta={delta:+.3f}pp  gate={gate}")

    if args.out_json:
        # de-bulk: drop the raw per-frame series before writing (still >60-frame
        # backed; the series was only kept in-memory for the corr/quartile calc)
        slim = {}
        for p, r in results.items():
            r2 = dict(r)
            r2.pop("_yavg_series", None)
            slim[p] = r2
        with open(args.out_json, "w") as f:
            json.dump({"baseline": l0_path, "videos": args.videos, "results": slim}, f, indent=2)
        print(f"\nFull results written to {args.out_json}")


if __name__ == "__main__":
    main()
