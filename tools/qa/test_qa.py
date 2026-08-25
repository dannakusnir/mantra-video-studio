#!/usr/bin/env python3
"""
test_qa.py -- basic self-test for every tool in tools/qa/.

Generates synthetic fixtures (never Danna's footage) -- one FLAT case (no
edges, no noise, no chroma) and one EDGE+NOISE case per tool family -- and
asserts each measurement moves in the direction it's supposed to. This is
NOT a claim that the tools are correct on real footage; it's the minimum bar
of "the number goes up when the thing it's measuring goes up, and down when
it doesn't apply" -- catching a tool that always returns the same value
regardless of input (the exact failure mode the QA brief calls out).

Run:
    python3 tools/qa/test_qa.py

Exits 0 and prints "ALL TESTS PASSED" if every check passes; exits 1 and
prints which check(s) failed otherwise. All fixtures are written to a
tempfile.mkdtemp() directory that is removed at the end, regardless of
outcome -- nothing synthetic is left in the repo.
"""
import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import _common as c
import temporal as T

HERE = os.path.dirname(os.path.abspath(__file__))

failures = []


def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"  [{status}] {name}" + (f"  -- {detail}" if detail else ""))
    if not cond:
        failures.append(name)


def make_flat_rgb(w=240, h=240, value=(128, 128, 128)):
    arr = np.zeros((h, w, 3), dtype=np.uint8)
    arr[:, :] = value
    return arr


def make_edge_noise_rgb(w=240, h=240, rng=None):
    rng = rng or np.random.default_rng(7)
    arr = np.zeros((h, w, 3), dtype=np.float64)
    arr[:, : w // 2] = 40   # dark half
    arr[:, w // 2 :] = 210  # bright half -- one hard vertical edge
    noise = rng.normal(0, 18, size=(h, w))
    for ch in range(3):
        arr[:, :, ch] = np.clip(arr[:, :, ch] + noise, 0, 255)
    return arr.astype(np.uint8)


def make_blocky_rgb(w=256, h=256, rng=None):
    """8x8-quantized image -- a stand-in for compression blocking artifacts."""
    rng = rng or np.random.default_rng(3)
    small = rng.integers(40, 220, size=(h // 8, w // 8), endpoint=True)
    big = np.repeat(np.repeat(small, 8, axis=0), 8, axis=1).astype(np.uint8)
    return np.stack([big, big, big], axis=-1)


def make_skin_patch(saturation_boost):
    """A small image whose whole area is a skin-hue-band color (H~20deg),
    with saturation controlled directly so we know which of two images
    SHOULD score higher on skin_hue_saturation.py."""
    import colorsys
    h, s, v = 20 / 360.0, saturation_boost, 0.7
    r, g, b = colorsys.hsv_to_rgb(h, s, v)
    arr = np.zeros((120, 120, 3), dtype=np.uint8)
    arr[:, :] = (int(r * 255), int(g * 255), int(b * 255))
    return arr


def make_split_tone_img(shadow_rb, highlight_rb):
    """Top half = shadow (Y~40), bottom half = highlight (Y~200). shadow_rb /
    highlight_rb set the R-B bias directly in each half (0 = neutral)."""
    arr = np.zeros((200, 120, 3), dtype=np.float64)
    base_shadow, base_highlight = 40.0, 200.0
    arr[:100, :, :] = base_shadow
    arr[100:, :, :] = base_highlight
    arr[:100, :, 0] += shadow_rb / 2
    arr[:100, :, 2] -= shadow_rb / 2
    arr[100:, :, 0] += highlight_rb / 2
    arr[100:, :, 2] -= highlight_rb / 2
    return np.clip(arr, 0, 255).astype(np.uint8)


def make_lavfi_video(out_path, lavfi_source, duration=2.0, fps=10, w=160, h=284):
    """lavfi_source: full lavfi source expression, e.g. 'color=c=gray' or
    'testsrc2'. ffmpeg's filter syntax needs "=" between the filter name and
    its first option, then ":" between subsequent options -- so if
    lavfi_source already has options (contains "="), join with ":"; if it's
    a bare filter name (e.g. 'testsrc2'), join with "=" instead."""
    sep = ":" if "=" in lavfi_source else "="
    cmd = [c.FFMPEG, "-y", "-v", "error", "-f", "lavfi",
           "-i", f"{lavfi_source}{sep}size={w}x{h}:duration={duration}:rate={fps}",
           "-pix_fmt", "yuv420p", out_path]
    subprocess.run(cmd, check=True)


def main():
    tmp = tempfile.mkdtemp(prefix="qa_test_")
    print(f"fixtures dir: {tmp}\n")
    try:
        run_all(tmp)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print()
    if failures:
        print(f"FAILED: {len(failures)} check(s) did not pass:")
        for f in failures:
            print(f"  - {f}")
        sys.exit(1)
    else:
        print("ALL TESTS PASSED")
        sys.exit(0)


def run_all(tmp):
    # ---- skin_hue_saturation.py -------------------------------------------------
    print("skin_hue_saturation.py")
    low_path = os.path.join(tmp, "skin_low_sat.png")
    high_path = os.path.join(tmp, "skin_high_sat.png")
    Image.fromarray(make_skin_patch(0.15)).save(low_path)
    Image.fromarray(make_skin_patch(0.55)).save(high_path)
    out = subprocess.run([sys.executable, os.path.join(HERE, "skin_hue_saturation.py"),
                           low_path, high_path], capture_output=True, text=True)
    check("skin_hue_saturation.py runs without error", out.returncode == 0, out.stderr[-300:])
    sys.path_stub = None
    import importlib
    sh = importlib.import_module("skin_hue_saturation")
    low_stats = sh.skin_hue_stats(low_path)
    high_stats = sh.skin_hue_stats(high_path)
    check("higher input saturation -> higher measured SATavg",
          high_stats["sat_mean"] > low_stats["sat_mean"] + 5,
          f"low={low_stats['sat_mean']:.2f} high={high_stats['sat_mean']:.2f}")

    # flat non-skin (pure gray, no hue) image should match ~0 pixels in the skin-hue band
    flat_path = os.path.join(tmp, "flat_gray.png")
    Image.fromarray(make_flat_rgb()).save(flat_path)
    flat_stats = sh.skin_hue_stats(flat_path)
    check("flat gray image has ~no pixels in the skin-hue band", flat_stats["px"] == 0,
          f"px={flat_stats['px']}")

    # ---- split_tone.py ------------------------------------------------------------
    print("\nsplit_tone.py")
    neutral_path = os.path.join(tmp, "split_neutral.png")
    shifted_path = os.path.join(tmp, "split_shifted.png")
    Image.fromarray(make_split_tone_img(0, 0)).save(neutral_path)
    Image.fromarray(make_split_tone_img(-30, 30)).save(shifted_path)  # cool shadow, warm highlight
    out = subprocess.run([sys.executable, os.path.join(HERE, "split_tone.py"),
                           neutral_path, shifted_path], capture_output=True, text=True)
    check("split_tone.py runs without error", out.returncode == 0, out.stderr[-300:])
    st = importlib.import_module("split_tone")
    neutral_stats = st.split_tone_stats(neutral_path)
    shifted_stats = st.split_tone_stats(shifted_path)
    check("shifted image's shadow R-B is lower (cooler) than neutral's",
          shifted_stats["shadow"] < neutral_stats["shadow"] - 10,
          f"neutral={neutral_stats['shadow']:.2f} shifted={shifted_stats['shadow']:.2f}")
    check("shifted image's highlight R-B is higher (warmer) than neutral's",
          shifted_stats["highlight"] > neutral_stats["highlight"] + 10,
          f"neutral={neutral_stats['highlight']:.2f} shifted={shifted_stats['highlight']:.2f}")

    # ---- temporal.py internal scoring functions -----------------------------------
    print("\ntemporal.py (scoring functions)")
    flat = make_flat_rgb(256, 256)
    edgy = make_edge_noise_rgb(256, 256)
    blocky = make_blocky_rgb(256, 256)
    smooth_gradient = np.linspace(0, 255, 256).astype(np.uint8)
    smooth_rgb = np.stack([np.tile(smooth_gradient, (256, 1))] * 3, axis=-1)

    flat_y = c.luma(flat.astype(np.float64))
    edgy_y = c.luma(edgy.astype(np.float64))
    blocky_y = c.luma(blocky.astype(np.float64))
    smooth_y = c.luma(smooth_rgb.astype(np.float64))

    check("noise_score: noisy image scores higher than flat image",
          T.noise_score(edgy_y) > T.noise_score(flat_y) * 3,
          f"flat={T.noise_score(flat_y):.3f} edgy={T.noise_score(edgy_y):.3f}")

    check("blockiness_score: 8px-quantized image scores higher than flat image",
          T.blockiness_score(blocky_y) > T.blockiness_score(flat_y),
          f"flat={T.blockiness_score(flat_y):.3f} blocky={T.blockiness_score(blocky_y):.3f}")

    check("banding_score: smooth gradient has fewer histogram gaps than 8px-quantized image",
          T.banding_score(blocky_y) > T.banding_score(smooth_y),
          f"smooth={T.banding_score(smooth_y):.1f} blocky={T.banding_score(blocky_y):.1f}")

    ring_flat = T.build_ring_mask(flat_y)
    ring_edgy = T.build_ring_mask(edgy_y)
    halo_on_flat_baseline = T.halo_score(edgy_y, None, ring_edgy)
    halo_self = T.halo_score(flat_y, None, ring_flat) if ring_flat.sum() else float("nan")
    check("halo_score returns a finite, non-negative number on a real edge",
          np.isfinite(halo_on_flat_baseline) and halo_on_flat_baseline >= 0,
          f"halo_on_edgy={halo_on_flat_baseline}")

    # skin_texture_score needs a FACE_BOX-shaped input; build a fake frame with
    # a skin-hue patch of flat vs noisy texture in that region.
    fake_frame_flat = np.zeros((c.FACE_BOX[3], c.FACE_BOX[2] + 50, 3), dtype=np.float64)
    fake_frame_flat[:, :] = make_skin_patch(0.3)[0, 0]  # solid skin color, no texture
    tex_flat, px_flat = T.skin_texture_score(fake_frame_flat)

    rng = np.random.default_rng(1)
    fake_frame_noisy = fake_frame_flat.copy()
    noise = rng.normal(0, 12, size=fake_frame_flat.shape[:2])
    for ch in range(3):
        fake_frame_noisy[:, :, ch] = np.clip(fake_frame_flat[:, :, ch] + noise, 0, 255)
    tex_noisy, px_noisy = T.skin_texture_score(fake_frame_noisy)

    check("skin_texture_score: textured skin patch scores higher than flat skin patch",
          (px_flat > 0 and px_noisy > 0 and tex_noisy > tex_flat),
          f"flat_var={tex_flat} noisy_var={tex_noisy} px_flat={px_flat} px_noisy={px_noisy}")

    # ---- temporal.py CLI end-to-end (tiny synthetic videos) -----------------------
    print("\ntemporal.py (CLI, synthetic videos)")
    flat_video = os.path.join(tmp, "L0-flat.mp4")
    edgy_video = os.path.join(tmp, "L1-edgy-noisy.mp4")
    try:
        make_lavfi_video(flat_video, "color=c=gray", fps=10)
        make_lavfi_video(edgy_video, "testsrc2", fps=10)
        # bake noise into the edgy video with a second pass
        edgy_noisy_video = os.path.join(tmp, "L1-edgy-noisy2.mp4")
        subprocess.run([c.FFMPEG, "-y", "-v", "error", "-i", edgy_video,
                         "-vf", "noise=alls=25:allf=t+u", "-pix_fmt", "yuv420p",
                         edgy_noisy_video], check=True)
        out_json = os.path.join(tmp, "temporal_test.json")
        proc = subprocess.run([sys.executable, os.path.join(HERE, "temporal.py"),
                                flat_video, edgy_noisy_video,
                                "--wide-n", "8", "--dense-n", "8", "--out-json", out_json],
                               capture_output=True, text=True)
        check("temporal.py CLI runs end-to-end on synthetic L0/L1 videos without error",
              proc.returncode == 0, proc.stderr[-500:])
        check("temporal.py wrote its JSON results file", os.path.isfile(out_json))
        if os.path.isfile(out_json):
            import json
            data = json.load(open(out_json))
            r0 = data["results"][flat_video]
            r1 = data["results"][edgy_noisy_video]
            check("CLI run: noisy/edgy video's noise_std > flat video's noise_std",
                  r1["noise_std"] > r0["noise_std"],
                  f"flat={r0['noise_std']:.3f} edgy={r1['noise_std']:.3f}")
    except Exception as e:
        check("temporal.py CLI synthetic-video test completed", False, repr(e))

    # ---- crops.py CLI end-to-end (tiny synthetic videos) ---------------------------
    print("\ncrops.py (CLI, synthetic videos)")
    try:
        out_dir = os.path.join(tmp, "qa_out")
        proc = subprocess.run([sys.executable, os.path.join(HERE, "crops.py"),
                                edgy_video, flat_video, edgy_video, "--out-dir", out_dir],
                               capture_output=True, text=True)
        check("crops.py CLI runs end-to-end on synthetic videos without error",
              proc.returncode == 0, proc.stderr[-500:])
        expected = ["compare-row.png", "crop-face-100pct.png", "crop-hair-100pct.png",
                    "crop-bg-dark-100pct.png", "frame-highlight.png", "frame-motion.png",
                    "selection.json"]
        for fn in expected:
            check(f"crops.py produced {fn}", os.path.isfile(os.path.join(out_dir, fn)))
    except Exception as e:
        check("crops.py CLI synthetic-video test completed", False, repr(e))


if __name__ == "__main__":
    main()
