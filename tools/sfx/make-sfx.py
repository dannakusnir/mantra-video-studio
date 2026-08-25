#!/usr/bin/env python3
"""
Mantra SFX pack — pure synthesis, zero third-party samples.

Every waveform below is built from oscillators, filtered noise, and
amplitude/frequency envelopes generated with numpy. Nothing here reads,
decodes, resamples, or otherwise touches any existing audio file in this
repo. Re-running this script regenerates byte-identical WAVs (all noise
uses fixed seeds).

Usage:
    python3 tools/sfx/make-sfx.py
        Writes the 8 production effects + library.json + license.json
        into public/sfx/.

    python3 tools/sfx/make-sfx.py --controls-only
        Writes two intentionally-BROKEN control sounds (one clipped, one
        with an abrupt/dirty tail) into out/sfx/controls/. Used only by
        tools/sfx/test_sfx.py to prove the QA gates actually catch bad
        audio. These controls are never written into public/sfx/.
"""

import argparse
import json
import os
import wave
import numpy as np

SR = 48000
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PUBLIC_SFX_DIR = os.path.join(REPO_ROOT, "public", "sfx")
CONTROLS_DIR = os.path.join(REPO_ROOT, "out", "sfx", "controls")

CREATOR = "Mantra Digital House (synthesized by Claude Code / tools/sfx/make-sfx.py)"
CREATION_DATE = "2026-08-24"
LICENCE_TEXT = (
    "Mantra Original. Synthesized from scratch (oscillators, filtered noise, "
    "envelopes) with no third-party samples, loops, or libraries. "
    "All rights reserved to Mantra Digital House."
)
VERSION = "1.0.0"


# --------------------------------------------------------------------------
# DSP primitives
# --------------------------------------------------------------------------

def t_axis(duration_sec, sr=SR):
    n = int(round(duration_sec * sr))
    return np.arange(n) / sr, n


def one_pole_lowpass(x, cutoff_hz, sr=SR):
    """Simple causal one-pole lowpass. cutoff_hz may be a scalar or an
    array the same length as x (time-varying cutoff)."""
    x = np.asarray(x, dtype=np.float64)
    n = len(x)
    y = np.zeros(n, dtype=np.float64)
    dt = 1.0 / sr
    cutoff_arr = np.broadcast_to(np.asarray(cutoff_hz, dtype=np.float64), (n,))
    prev = 0.0
    for i in range(n):
        rc = 1.0 / (2.0 * np.pi * max(cutoff_arr[i], 1.0))
        alpha = dt / (rc + dt)
        prev = prev + alpha * (x[i] - prev)
        y[i] = prev
    return y


def time_varying_bandpass(x, lo_hz, hi_hz, sr=SR):
    """Difference-of-lowpass bandpass: lowpass(hi) - lowpass(lo).
    lo_hz / hi_hz may be arrays (time-varying)."""
    hp_ref = one_pole_lowpass(x, hi_hz, sr)
    lp_ref = one_pole_lowpass(x, lo_hz, sr)
    return hp_ref - lp_ref


def exp_decay_env(t, attack_ms, tau_ms):
    attack_s = attack_ms / 1000.0
    tau_s = tau_ms / 1000.0
    attack = np.clip(t / attack_s, 0.0, 1.0) if attack_s > 0 else np.ones_like(t)
    decay = np.exp(-t / tau_s)
    return attack * decay


def hann_window_env(t, duration_sec, power=1.0):
    T = duration_sec
    w = 0.5 - 0.5 * np.cos(2 * np.pi * np.clip(t / T, 0, 1))
    return w ** power


def apply_tail_fade(x, fade_ms, sr=SR):
    """Force a smooth linear ramp to exact zero over the last fade_ms of
    the buffer. Guarantees no abrupt cut regardless of the envelope used
    upstream."""
    n = len(x)
    fade_n = min(int(round(fade_ms / 1000.0 * sr)), n)
    if fade_n <= 0:
        return x
    ramp = np.ones(n)
    ramp[n - fade_n:] = np.linspace(1.0, 0.0, fade_n)
    return x * ramp


def normalize_peak(x, target_dbfs=-3.0):
    peak = np.max(np.abs(x))
    if peak < 1e-9:
        return x
    target_lin = 10 ** (target_dbfs / 20.0)
    return x * (target_lin / peak)


def phase_from_freq(freq_arr, sr=SR):
    """Integrate an instantaneous-frequency array into a continuous phase,
    for click-free frequency sweeps."""
    return 2 * np.pi * np.cumsum(freq_arr) / sr


def write_wav_mono_16(path, x, sr=SR):
    x = np.clip(x, -1.0, 1.0)
    ints = (x * 32767.0).astype(np.int16)
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sr)
        wf.writeframes(ints.tobytes())


# --------------------------------------------------------------------------
# The 8 effects
# --------------------------------------------------------------------------

def make_soft_tick():
    """Soft Tick — 70% soft sine burst at 1800Hz + 30% lowpass-filtered
    noise, both under a fast attack/exponential-decay envelope, no hard
    edges anywhere."""
    t, n = t_axis(0.100)
    rng = np.random.default_rng(1001)
    tone = np.sin(2 * np.pi * 1800 * t)
    noise = one_pole_lowpass(rng.standard_normal(n), cutoff_hz=3200)
    env = exp_decay_env(t, attack_ms=0.4, tau_ms=7.5)
    sig = (0.70 * tone + 0.30 * (noise / (np.max(np.abs(noise)) + 1e-9))) * env
    sig = one_pole_lowpass(sig, cutoff_hz=7500)  # shave any residual edge
    sig = apply_tail_fade(sig, fade_ms=35)
    return normalize_peak(sig, -6.0)


def make_clean_click():
    """Clean Click — 88% soft sine burst at 2400Hz + 12% lowpass-filtered
    noise, tighter/brighter than Soft Tick but still a pure sine, no
    square/digital content."""
    t, n = t_axis(0.090)
    rng = np.random.default_rng(1002)
    tone = np.sin(2 * np.pi * 2400 * t)
    noise = one_pole_lowpass(rng.standard_normal(n), cutoff_hz=4000)
    env = exp_decay_env(t, attack_ms=0.3, tau_ms=6.5)
    sig = (0.88 * tone + 0.12 * (noise / (np.max(np.abs(noise)) + 1e-9))) * env
    sig = one_pole_lowpass(sig, cutoff_hz=8500)
    sig = apply_tail_fade(sig, fade_ms=32)
    return normalize_peak(sig, -6.0)


def make_subtle_pop():
    """Subtle Pop — sine with a fast downward pitch chirp (520Hz -> 160Hz)
    for the 'pop' body, layered with a soft lowpass-noise transient at the
    onset for texture."""
    t, n = t_axis(0.180)
    rng = np.random.default_rng(1003)
    freq = 160 + (520 - 160) * np.exp(-t / 0.02)
    phase = phase_from_freq(freq)
    tone = np.sin(phase)
    noise = one_pole_lowpass(rng.standard_normal(n), cutoff_hz=1800)
    noise_env = exp_decay_env(t, attack_ms=0.5, tau_ms=8)
    tone_env = exp_decay_env(t, attack_ms=1.5, tau_ms=18)
    sig = tone * tone_env + 0.25 * (noise / (np.max(np.abs(noise)) + 1e-9)) * noise_env
    sig = one_pole_lowpass(sig, cutoff_hz=6000)
    sig = apply_tail_fade(sig, fade_ms=55)
    return normalize_peak(sig, -6.0)


def make_airy_whoosh():
    """Airy Whoosh — white noise pushed through a time-varying bandpass
    whose center sweeps up then back down (400Hz -> 3000Hz -> 800Hz),
    under a smooth Hann-shaped amplitude envelope. No tonal content."""
    duration = 0.95
    t, n = t_axis(duration)
    rng = np.random.default_rng(1004)
    noise = rng.standard_normal(n)
    # center frequency sweep: up over first 45%, back down over the rest
    peak_pos = 0.45
    up = np.clip(t / (duration * peak_pos), 0, 1)
    down = np.clip((t - duration * peak_pos) / (duration * (1 - peak_pos)), 0, 1)
    shape = np.where(t < duration * peak_pos, up, 1 - down)
    center = 400 + shape * (3000 - 400)
    center = np.maximum(center, 800 - shape * 0)  # keep floor sane
    lo = np.maximum(center * 0.55, 150)
    hi = np.minimum(center * 1.35, 6500)
    band = time_varying_bandpass(noise, lo, hi)
    band = band / (np.max(np.abs(band)) + 1e-9)
    amp_env = hann_window_env(t, duration, power=1.3)
    sig = band * amp_env
    sig = one_pole_lowpass(sig, cutoff_hz=6500)  # keep it airy, not harsh
    sig = apply_tail_fade(sig, fade_ms=60)
    return normalize_peak(sig, -6.0)


def make_quick_rise():
    """Quick Rise — exponential pitch-rising sine (220Hz -> 1100Hz) layered
    with a rising-bandpass noise 'air' texture, under an envelope that
    builds to a plateau then decays well before the end (not a hard cut
    at the peak)."""
    duration = 0.50
    t, n = t_axis(duration)
    rng = np.random.default_rng(1005)
    freq = 220 * (1100.0 / 220.0) ** (t / duration)
    tone = np.sin(phase_from_freq(freq))
    noise = rng.standard_normal(n)
    lo = 300 + (2200 - 300) * (t / duration)
    hi = lo * 1.6
    air = time_varying_bandpass(noise, lo, hi)
    air = air / (np.max(np.abs(air)) + 1e-9)
    decay_start = duration * 0.45
    attack = np.clip(t / (duration * 0.10), 0, 1)
    build = np.clip(t / decay_start, 0, 1)
    decay = np.where(t > decay_start, np.exp(-(t - decay_start) / 0.030), 1.0)
    amp_env = attack * build * decay
    sig = 0.75 * tone * amp_env + 0.35 * air * amp_env
    sig = one_pole_lowpass(sig, cutoff_hz=7000)
    sig = apply_tail_fade(sig, fade_ms=50)
    return normalize_peak(sig, -6.0)


def make_low_soft_impact():
    """Low Soft Impact — warm low sine (95Hz -> 55Hz pitch drop) with a
    quiet second harmonic and a soft lowpass-noise thud at the onset;
    slow exponential decay for a rounded, non-clicky thump."""
    duration = 0.40
    t, n = t_axis(duration)
    rng = np.random.default_rng(1006)
    freq = 55 + (95 - 55) * np.exp(-t / 0.06)
    fundamental = np.sin(phase_from_freq(freq))
    harmonic = 0.25 * np.sin(2 * phase_from_freq(freq))
    noise = one_pole_lowpass(rng.standard_normal(n), cutoff_hz=450)
    noise_env = exp_decay_env(t, attack_ms=1.0, tau_ms=18)
    body_env = exp_decay_env(t, attack_ms=6.0, tau_ms=95)
    sig = (fundamental + harmonic) * body_env + 0.30 * (noise / (np.max(np.abs(noise)) + 1e-9)) * noise_env
    sig = one_pole_lowpass(sig, cutoff_hz=2200)
    sig = apply_tail_fade(sig, fade_ms=60)
    return normalize_peak(sig, -6.0)


def make_light_shimmer():
    """Light Shimmer — additive stack of soft high sine partials
    (1200/1800/2400/3600Hz, each lightly detuned x2 for a chorus shimmer),
    amplitude weighted down with frequency, under a slow decay and a
    gentle 6Hz tremolo."""
    duration = 0.70
    t, n = t_axis(duration)
    partials = [1200, 1800, 2400, 3600]
    sig = np.zeros(n)
    for i, f in enumerate(partials):
        weight = 1.0 / (i + 1.4)
        for detune in (-2.5, 2.5):
            sig += weight * 0.5 * np.sin(2 * np.pi * (f + detune) * t)
    tremolo = 1.0 + 0.15 * np.sin(2 * np.pi * 6.0 * t)
    env = exp_decay_env(t, attack_ms=4.0, tau_ms=200)
    sig = sig * env * tremolo
    sig = one_pole_lowpass(sig, cutoff_hz=6000)  # keep the top end soft
    sig = apply_tail_fade(sig, fade_ms=90)
    return normalize_peak(sig, -6.0)


def make_warm_chime():
    """Warm Chime — bell-style additive synthesis: fundamental 523Hz plus
    slightly inharmonic partials (2.0x/2.4x/3.0x) weighted toward the
    fundamental for warmth, each with its own decay so the higher
    partials fade first, leaving a warm low tail."""
    duration = 0.75
    t, n = t_axis(duration)
    fundamental_hz = 523.0
    partials = [
        (1.0, 1.00, 260),
        (0.55, 2.00, 170),
        (0.30, 2.42, 120),
        (0.16, 3.01, 90),
    ]
    sig = np.zeros(n)
    for weight, ratio, tau_ms in partials:
        env = exp_decay_env(t, attack_ms=3.0, tau_ms=tau_ms)
        sig += weight * np.sin(2 * np.pi * fundamental_hz * ratio * t) * env
    sig = one_pole_lowpass(sig, cutoff_hz=5500)
    sig = apply_tail_fade(sig, fade_ms=100)
    return normalize_peak(sig, -6.0)


EFFECTS = [
    {
        "id": "soft-tick",
        "displayName": "Soft Tick",
        "category": "subtle",
        "defaultVolume": 0.35,
        "recommendedPlacement": "purposefulCut",
        "synthesisMethod": "Sine burst at 1800Hz blended with lowpass-filtered white noise under a fast attack / exponential-decay envelope.",
        "make": make_soft_tick,
    },
    {
        "id": "clean-click",
        "displayName": "Clean Click",
        "category": "subtle",
        "defaultVolume": 0.40,
        "recommendedPlacement": "keywordEmphasis",
        "synthesisMethod": "Sine burst at 2400Hz with a small amount of lowpass-filtered noise, tighter attack/decay than Soft Tick.",
        "make": make_clean_click,
    },
    {
        "id": "subtle-pop",
        "displayName": "Subtle Pop",
        "category": "impact",
        "defaultVolume": 0.50,
        "recommendedPlacement": "keywordEmphasis",
        "synthesisMethod": "Sine with a fast exponential downward pitch chirp (520Hz to 160Hz) layered with a soft lowpass-noise onset transient.",
        "make": make_subtle_pop,
    },
    {
        "id": "airy-whoosh",
        "displayName": "Airy Whoosh",
        "category": "motion",
        "defaultVolume": 0.45,
        "recommendedPlacement": "hook",
        "synthesisMethod": "White noise through a time-varying bandpass filter sweeping 400Hz to 3000Hz and back to 800Hz, under a Hann amplitude envelope.",
        "make": make_airy_whoosh,
    },
    {
        "id": "quick-rise",
        "displayName": "Quick Rise",
        "category": "motion",
        "defaultVolume": 0.50,
        "recommendedPlacement": "reveal",
        "synthesisMethod": "Exponentially pitch-rising sine (220Hz to 1100Hz) layered with a rising-bandpass noise texture under a building amplitude envelope.",
        "make": make_quick_rise,
    },
    {
        "id": "low-soft-impact",
        "displayName": "Low Soft Impact",
        "category": "impact",
        "defaultVolume": 0.55,
        "recommendedPlacement": "cta",
        "synthesisMethod": "Low sine (95Hz falling to 55Hz) plus a quiet second harmonic and a soft lowpass-noise thud, under a slow exponential decay.",
        "make": make_low_soft_impact,
    },
    {
        "id": "light-shimmer",
        "displayName": "Light Shimmer",
        "category": "magic",
        "defaultVolume": 0.40,
        "recommendedPlacement": "reveal",
        "synthesisMethod": "Additive stack of four detuned high sine partials (1200-3600Hz) with a slow decay and gentle 6Hz tremolo.",
        "make": make_light_shimmer,
    },
    {
        "id": "warm-chime",
        "displayName": "Warm Chime",
        "category": "magic",
        "defaultVolume": 0.45,
        "recommendedPlacement": "ending",
        "synthesisMethod": "Bell-style additive synthesis: fundamental 523Hz plus three slightly inharmonic partials, each with its own independent decay, weighted toward warmth.",
        "make": make_warm_chime,
    },
]


# --------------------------------------------------------------------------
# Control (intentionally-broken) sounds — for test_sfx.py only
# --------------------------------------------------------------------------

def make_control_bad_clip():
    """Deliberately clips: a full-scale sine pushed past 1.0 and hard-clipped,
    with no normalization headroom. Must FAIL the peak/clipping gate."""
    t, n = t_axis(0.20)
    sig = 1.8 * np.sin(2 * np.pi * 440 * t)  # amplitude > 1.0 before clipping
    return np.clip(sig, -1.0, 1.0)  # clip is baked in on purpose


def make_control_bad_tail():
    """Deliberately dirty tail: a sustained full-amplitude tone that just
    stops with no decay or fade. Must FAIL the clean-tail gate."""
    t, n = t_axis(0.25)
    sig = 0.85 * np.sin(2 * np.pi * 300 * t)  # constant amplitude, no envelope
    return sig  # no apply_tail_fade, no decay — abrupt cut by construction


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def write_production_pack():
    os.makedirs(PUBLIC_SFX_DIR, exist_ok=True)
    library = []
    for effect in EFFECTS:
        sig = effect["make"]()
        out_path = os.path.join(PUBLIC_SFX_DIR, f"{effect['id']}.wav")
        write_wav_mono_16(out_path, sig, SR)
        duration_sec = len(sig) / SR  # actual rendered duration; library.json
        # entry below still gets its real value cross-checked against
        # ffprobe in test_sfx.py rather than trusting this in-process number.
        library.append({
            "id": effect["id"],
            "displayName": effect["displayName"],
            "category": effect["category"],
            "durationSec": round(duration_sec, 3),
            "defaultVolume": effect["defaultVolume"],
            "recommendedPlacement": effect["recommendedPlacement"],
            "creator": CREATOR,
            "source": f"public/sfx/{effect['id']}.wav — original synthesis, tools/sfx/make-sfx.py",
            "creationDate": CREATION_DATE,
            "licence": "Mantra Original",
            "version": VERSION,
            "synthesisMethod": effect["synthesisMethod"],
        })

    library_path = os.path.join(PUBLIC_SFX_DIR, "library.json")
    with open(library_path, "w") as f:
        json.dump(library, f, indent=2)
        f.write("\n")

    license_obj = {
        "package": "Mantra SFX Pack",
        "version": VERSION,
        "creationDate": CREATION_DATE,
        "creator": CREATOR,
        "statement": (
            "All eight sound effects in this package are Mantra original works, "
            "synthesized from scratch using oscillators, filtered noise, and "
            "amplitude/frequency envelopes (see tools/sfx/make-sfx.py). "
            "No third-party samples, loops, sample libraries, or stock SFX "
            "were used, sampled, or referenced in their creation."
        ),
        "licence": LICENCE_TEXT,
        "effects": [e["id"] for e in EFFECTS],
    }
    license_path = os.path.join(PUBLIC_SFX_DIR, "license.json")
    with open(license_path, "w") as f:
        json.dump(license_obj, f, indent=2)
        f.write("\n")

    print(f"Wrote {len(EFFECTS)} effects + library.json + license.json to {PUBLIC_SFX_DIR}")


def write_controls():
    os.makedirs(CONTROLS_DIR, exist_ok=True)
    write_wav_mono_16(os.path.join(CONTROLS_DIR, "bad-clip.wav"), make_control_bad_clip(), SR)
    write_wav_mono_16(os.path.join(CONTROLS_DIR, "bad-tail.wav"), make_control_bad_tail(), SR)
    print(f"Wrote 2 control (intentionally broken) wavs to {CONTROLS_DIR}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--controls-only", action="store_true",
                         help="Only write the bad-clip/bad-tail control wavs (out/sfx/controls/), skip the production pack.")
    args = parser.parse_args()

    if args.controls_only:
        write_controls()
    else:
        write_production_pack()
