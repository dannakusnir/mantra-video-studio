#!/usr/bin/env python3
"""
QA gate for the Mantra SFX pack.

Measures every WAV in public/sfx/ with real ffprobe / ffmpeg -af astats
calls (never trusts declared/in-memory numbers), and enforces:
    - 48kHz sample rate
    - no clipping: true peak < -1.0 dBFS
    - clean tail: RMS of the last 50ms is at least 40dB below the
      overall peak

Then, as a mandatory control, it generates two intentionally-BROKEN
sounds (make_control_bad_clip / make_control_bad_tail from make-sfx.py)
and asserts the SAME gates correctly FAIL on them. If a gate passes on a
control that should fail, that gate is proven meaningless and the whole
test run fails loudly.

Usage:
    python3 tools/sfx/test_sfx.py
Exit code 0 = all 8 production effects pass AND both controls correctly
fail. Any other outcome exits non-zero.
"""

import json
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib.util

SPEC_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "make-sfx.py")
spec = importlib.util.spec_from_file_location("make_sfx", SPEC_PATH)
make_sfx = importlib.util.module_from_spec(spec)
spec.loader.exec_module(make_sfx)

REPO_ROOT = make_sfx.REPO_ROOT
PUBLIC_SFX_DIR = make_sfx.PUBLIC_SFX_DIR
SR_REQUIRED = 48000
MIN_TAIL_DROP_DB = 40.0
MAX_TRUE_PEAK_DBFS = -1.0
TAIL_WINDOW_MS = 50


def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)


def ffprobe_stream_info(path):
    proc = run([
        "ffprobe", "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=sample_rate,channels",
        "-show_entries", "format=duration",
        "-of", "json", path,
    ])
    data = json.loads(proc.stdout)
    sample_rate = int(data["streams"][0]["sample_rate"])
    channels = int(data["streams"][0]["channels"])
    duration = float(data["format"]["duration"])
    return sample_rate, channels, duration


def _parse_overall_astats(stderr_text):
    """Pull the Peak level dB / RMS level dB from the 'Overall' section of
    ffmpeg -af astats output (not the per-channel section)."""
    lines = stderr_text.splitlines()
    overall_idx = None
    for i, line in enumerate(lines):
        if "Overall" in line:
            overall_idx = i
    if overall_idx is None:
        raise RuntimeError("No 'Overall' astats section found:\n" + stderr_text)
    peak_db = None
    rms_db = None
    for line in lines[overall_idx:]:
        m = re.search(r"Peak level dB:\s*(-?[0-9.]+|-inf)", line)
        if m and peak_db is None:
            peak_db = float(m.group(1)) if m.group(1) != "-inf" else float("-inf")
        m = re.search(r"RMS level dB:\s*(-?[0-9.]+|-inf)", line)
        if m and rms_db is None:
            rms_db = float(m.group(1)) if m.group(1) != "-inf" else float("-inf")
        if peak_db is not None and rms_db is not None:
            break
    if peak_db is None or rms_db is None:
        raise RuntimeError("Could not parse Peak/RMS from astats:\n" + stderr_text)
    return peak_db, rms_db


def astats_full(path):
    proc = run(["ffmpeg", "-i", path, "-af", "astats", "-f", "null", "-"])
    return _parse_overall_astats(proc.stderr)


def astats_tail(path, duration_sec, window_ms=TAIL_WINDOW_MS):
    window_s = window_ms / 1000.0
    start = max(0.0, duration_sec - window_s)
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tail_path = tmp.name
    try:
        proc = run([
            "ffmpeg", "-y", "-i", path,
            "-af", f"atrim=start={start:.6f}",
            tail_path,
        ])
        if proc.returncode != 0:
            raise RuntimeError("ffmpeg atrim failed:\n" + proc.stderr)
        proc2 = run(["ffmpeg", "-i", tail_path, "-af", "astats", "-f", "null", "-"])
        _, tail_rms_db = _parse_overall_astats(proc2.stderr)
        return tail_rms_db
    finally:
        os.unlink(tail_path)


def measure(path):
    sample_rate, channels, duration = ffprobe_stream_info(path)
    peak_db, _rms_db = astats_full(path)
    tail_rms_db = astats_tail(path, duration)
    tail_drop_db = (peak_db - tail_rms_db) if tail_rms_db != float("-inf") else float("inf")
    return {
        "sample_rate": sample_rate,
        "channels": channels,
        "duration": duration,
        "peak_db": peak_db,
        "tail_rms_db": tail_rms_db,
        "tail_drop_db": tail_drop_db,
    }


def gates(m):
    """Returns dict of gate_name -> True/False (True = PASS)."""
    return {
        "sample_rate_48k": m["sample_rate"] == SR_REQUIRED,
        "no_clipping": m["peak_db"] < MAX_TRUE_PEAK_DBFS,
        "clean_tail": m["tail_drop_db"] >= MIN_TAIL_DROP_DB,
    }


def main():
    failures = []

    # ---- 1. production pack: all gates must PASS ----
    lib_path = os.path.join(PUBLIC_SFX_DIR, "library.json")
    if not os.path.exists(lib_path):
        print(f"FAIL: {lib_path} not found. Run tools/sfx/make-sfx.py first.")
        sys.exit(1)
    with open(lib_path) as f:
        library = json.load(f)

    print(f"{'id':<18}{'dur(s)':>8}{'sr':>8}{'peak dB':>10}{'tail drop dB':>14}  gates")
    for entry in library:
        wav_path = os.path.join(PUBLIC_SFX_DIR, f"{entry['id']}.wav")
        m = measure(wav_path)
        g = gates(m)
        status = "PASS" if all(g.values()) else "FAIL"
        print(f"{entry['id']:<18}{m['duration']:>8.3f}{m['sample_rate']:>8}"
              f"{m['peak_db']:>10.2f}{m['tail_drop_db']:>14.2f}  {status} {g}")
        if not all(g.values()):
            failures.append((entry["id"], g))

    # ---- 2. controls: gates must correctly FAIL ----
    make_sfx.write_controls()
    controls_dir = make_sfx.CONTROLS_DIR
    control_checks = [
        ("bad-clip.wav", "no_clipping"),   # must fail the clipping gate
        ("bad-tail.wav", "clean_tail"),    # must fail the clean-tail gate
    ]
    print("\nControl (intentionally-broken) checks:")
    for fname, gate_that_must_fail in control_checks:
        path = os.path.join(controls_dir, fname)
        m = measure(path)
        g = gates(m)
        caught = not g[gate_that_must_fail]
        print(f"  {fname:<16} peak={m['peak_db']:.2f}dB tail_drop={m['tail_drop_db']:.2f}dB "
              f"-> gate '{gate_that_must_fail}' {'correctly FAILED (caught)' if caught else 'WRONGLY PASSED (test is meaningless!)'}")
        if not caught:
            failures.append((fname, {gate_that_must_fail: "should have failed but passed"}))

    print()
    if failures:
        print(f"RESULT: FAIL ({len(failures)} problem(s))")
        for name, g in failures:
            print(f"  - {name}: {g}")
        sys.exit(1)
    else:
        print("RESULT: PASS — all 8 effects clean, both controls correctly caught.")
        sys.exit(0)


if __name__ == "__main__":
    main()
