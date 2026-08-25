"""
shadow_crush.py -- measures the gate Danna set for Soft Crisp:

  "Y<=8 must not rise by more than 0.05 percentage points versus the source."

Y<=8 is the count of pixels sitting at or below code value 8 out of 255, as a
percentage of all pixels. It is the direct measure of BLACK CRUSH: a tone curve
that pulls the toe down does not "darken the shadows" evenly, it stacks
formerly-distinct dark values onto the same few codes at the bottom, and
detail that lands at 0-8 is gone -- no downstream stage can recover it.

Reported ALONGSIDE it, because a look can pass this gate and still be wrong:

  clipHigh   pct of pixels at Y>=250 -- the same failure at the other end
  p01/p05    the 1st/5th percentile of luma; these move BEFORE Y<=8 does, so
             a look whose p01 has collapsed but whose Y<=8 has not yet risen
             is on its way to crushing and the single gate would miss it
  toeSlope   d(output luma)/d(source luma) fitted over source luma 4..40,
             measured on CO-LOCATED PIXELS -- the look renders and the source
             render come off the same timeline, so pixel (t,x,y) in one is
             the same pixel in the other. 1.0 = the toe is untouched; below
             1.0 = the shadows are being compressed; near 0 = crushed flat.
  lostDark   pct of pixels that were ABOVE 8 in the source and land at or
             below 8 in the look. This is destroyed detail, counted directly.

  WHY NOT a simpler "spread of dark codes": I tried it and it failed its own
  control -- crushing pulls new pixels DOWN into the 0..31 band, so the
  spread of whatever is in that band afterwards goes UP, not down. The
  population being measured changed underneath the metric. The matched-pair
  form above has no such confound: it follows the same pixels.

CONTROL: run with --control to measure a deliberately crushed copy of the
source (ffmpeg curves, hard toe). Every metric here MUST move in the flagged
direction on that copy. If the control passes the gate, the gate measures
nothing and the number is not evidence.

Usage:
  python3 tools/qa/shadow_crush.py SOURCE.mp4 CANDIDATE.mp4 [more.mp4 ...]
  python3 tools/qa/shadow_crush.py --control SOURCE.mp4
"""
import sys
import os
import subprocess
import tempfile

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _common import FFMPEG, sample_frames_rgb, luma  # noqa: E402

N_SAMPLES = 24
CRUSH_GATE_PP = 0.05


def _toe(src_y, cand_y):
    """Matched-pair toe measurement. Returns (slope, lostDarkPct)."""
    m = (src_y >= 4) & (src_y <= 40)
    if np.count_nonzero(m) < 1000:
        return float("nan"), float("nan")
    x, y = src_y[m], cand_y[m]
    slope = float(np.polyfit(x, y, 1)[0])
    above = src_y > 8
    lost = 100.0 * np.count_nonzero(above & (cand_y <= 8)) / src_y.size
    return slope, lost


def measure(path, n_samples=N_SAMPLES, src_y=None):
    frames, _ = sample_frames_rgb(path, n_samples)
    y = luma(frames)
    total = y.size
    yq = np.clip(np.rint(y), 0, 255).astype(np.uint8)
    out = {
        "path": os.path.basename(path),
        "crush": 100.0 * np.count_nonzero(yq <= 8) / total,
        "clipHigh": 100.0 * np.count_nonzero(yq >= 250) / total,
        "p01": float(np.percentile(y, 1)),
        "p05": float(np.percentile(y, 5)),
        "p50": float(np.percentile(y, 50)),
        "p95": float(np.percentile(y, 95)),
        "_y": y,
        "toeSlope": float("nan"),
        "lostDark": float("nan"),
    }
    if src_y is not None and src_y.shape == y.shape:
        out["toeSlope"], out["lostDark"] = _toe(src_y, y)
    return out


def make_crushed_control(src):
    """A deliberately crushed copy: hard toe lifted off zero via curves."""
    out = os.path.join(tempfile.gettempdir(), "shadow_crush_control.mp4")
    cmd = [FFMPEG, "-y", "-v", "error", "-i", src,
           "-vf", "curves=all='0/0 0.12/0 0.5/0.5 1/1'",
           "-c:v", "libx264", "-crf", "16", "-an", out]
    subprocess.run(cmd, check=True)
    return out


def row(m):
    return (f"  {m['path']:<22} crush {m['crush']:7.4f}%   clipHigh {m['clipHigh']:7.4f}%   "
            f"p01 {m['p01']:6.2f}  p05 {m['p05']:6.2f}  p50 {m['p50']:6.2f}  p95 {m['p95']:6.2f}  "
            f"toe {m['toeSlope']:5.2f}  lostDark {m['lostDark']:7.4f}%")


def main(argv):
    if len(argv) >= 2 and argv[0] == "--control":
        src = argv[1]
        base = measure(src)
        ctrl_path = make_crushed_control(src)
        ctrl = measure(ctrl_path, src_y=base["_y"])
        print("CONTROL CHECK -- a deliberately crushed copy must FAIL the gate")
        print(row(base))
        print(row(ctrl))
        delta = ctrl["crush"] - base["crush"]
        moved_crush = delta > CRUSH_GATE_PP
        toe_flattened = ctrl["toeSlope"] < 0.5
        print(f"\n  crush delta {delta:+.4f}pp (gate {CRUSH_GATE_PP}pp)  -> "
              f"{'FAILED as required' if moved_crush else 'WRONGLY PASSED'}")
        print(f"  toeSlope {ctrl['toeSlope']:.3f} (crushed copy must be < 0.5)  -> "
              f"{'flattened as required' if toe_flattened else 'WRONGLY UNCHANGED'}")
        ok = moved_crush and toe_flattened
        print("\nRESULT:", "PASS -- the gate detects crushing" if ok
              else "BROKEN -- this gate does not measure what it claims")
        return 0 if ok else 1

    if len(argv) < 2:
        print(__doc__)
        return 2

    src, cands = argv[0], argv[1:]
    base = measure(src)
    print(f"SOURCE  {row(base)[2:]}\n")
    worst = 0
    for c in cands:
        m = measure(c, src_y=base["_y"])
        d = m["crush"] - base["crush"]
        verdict = "PASS" if d <= CRUSH_GATE_PP else "FAIL"
        if verdict == "FAIL":
            worst = 1
        print(row(m))
        print(f"  {'':<22} crush delta {d:+.4f}pp vs source   [{verdict}]   "
              f"toeSlope {m['toeSlope']:.3f}\n")
    return worst


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
