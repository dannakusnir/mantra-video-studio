"""
Shared helpers for the tools/qa/ scripts (temporal.py, crops.py). Not a
standalone tool -- imported by the others. Wraps ffmpeg/ffprobe frame
extraction so each measurement script isn't reinventing subprocess plumbing.

ffmpeg/ffprobe are resolved via $PATH first, falling back to
~/.local/bin/{ffmpeg,ffprobe} (where this machine has ffmpeg 7.0 installed).
"""
import json
import os
import shutil
import subprocess
import numpy as np

_FALLBACK_BIN = os.path.expanduser("~/.local/bin")


def _resolve(name):
    found = shutil.which(name)
    if found:
        return found
    candidate = os.path.join(_FALLBACK_BIN, name)
    if os.path.isfile(candidate):
        return candidate
    raise FileNotFoundError(f"{name} not found on PATH or in {_FALLBACK_BIN}")


FFMPEG = _resolve("ffmpeg")
FFPROBE = _resolve("ffprobe")


def probe(video_path):
    """Return dict with width, height, fps (float), duration (s), nb_frames (int),
    bit_rate (int, bits/sec, from the video stream if present else the container)."""
    cmd = [
        FFPROBE, "-v", "error",
        "-select_streams", "v:0",
        "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,bit_rate",
        "-show_entries", "format=duration,bit_rate,size",
        "-of", "json",
        video_path,
    ]
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    stream = data.get("streams", [{}])[0]
    fmt = data.get("format", {})

    def _rate(s):
        if not s or s == "0/0":
            return None
        n, d = s.split("/")
        d = float(d)
        return float(n) / d if d else None

    fps = _rate(stream.get("avg_frame_rate")) or _rate(stream.get("r_frame_rate")) or 30.0
    duration = float(stream.get("duration") or fmt.get("duration") or 0.0)
    bit_rate = stream.get("bit_rate")
    bit_rate = int(bit_rate) if bit_rate else (int(fmt.get("bit_rate")) if fmt.get("bit_rate") else None)
    nb_frames = stream.get("nb_frames")
    nb_frames = int(nb_frames) if nb_frames else int(round(duration * fps))
    return {
        "width": int(stream.get("width", 0)),
        "height": int(stream.get("height", 0)),
        "fps": fps,
        "duration": duration,
        "nb_frames": nb_frames,
        "bit_rate": bit_rate,
        "file_size": int(fmt.get("size")) if fmt.get("size") else os.path.getsize(video_path),
    }


def extract_frame_png(video_path, t_sec, out_path):
    """Extract one full-resolution frame at t_sec to out_path (PNG)."""
    cmd = [
        FFMPEG, "-y", "-v", "error",
        "-ss", f"{t_sec:.3f}", "-i", video_path,
        "-frames:v", "1", out_path,
    ]
    subprocess.run(cmd, check=True)
    return out_path


def sample_frames_rgb(video_path, n_samples, scale_w=None, scale_h=None, start_pad=0.02, end_pad=0.02, dtype=np.float64):
    """
    Decode n_samples frames, evenly spaced across the video (skipping a tiny
    pad at head/tail so we don't land exactly on frame 0 / the last frame),
    optionally downscaled to scale_w x scale_h. Uses a SINGLE ffmpeg decode
    pass with an `fps=` filter (fast input seek to the pad point, then one
    continuous decode) rather than one ffmpeg process per frame -- the
    per-frame-seek approach was measured at ~8s/frame here; this is ~0.2s/frame.

    Returns (frames, timestamps): frames is float64 ndarray
    (n_samples, H, W, 3) in 0..255. timestamps are the ACTUAL fps-filter grid
    (evenly spaced from the padded start across the padded duration) -- close
    to but not bit-identical to a naive linspace, since ffmpeg's fps filter
    owns the exact frame selection.
    """
    info = probe(video_path)
    dur = info["duration"]
    w = scale_w or info["width"]
    h = scale_h or info["height"]

    lo = dur * start_pad
    span = dur * (1 - start_pad - end_pad)
    # Over-request a couple of extra frames and truncate to exactly
    # n_samples: ffmpeg's fps filter can land one short of the arithmetic
    # count on rounding, especially on very short (sub-2s) clips like the
    # synthetic fixtures in test_qa.py -- padding absorbs that without
    # affecting real footage (the 2 extra decoded frames are just discarded).
    request_n = n_samples + 2
    fps_val = request_n / span

    vf = f"fps={fps_val:.8f}"
    if scale_w or scale_h:
        vf += f",scale={w}:{h}:flags=bilinear"

    cmd = [FFMPEG, "-y", "-v", "error",
           "-ss", f"{lo:.3f}", "-i", video_path,
           "-t", f"{span:.3f}",
           "-vf", vf,
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    buf = proc.stdout
    frame_bytes = w * h * 3
    got = len(buf) // frame_bytes
    if got < n_samples:
        raise RuntimeError(
            f"only decoded {got}/{n_samples} frames from {video_path} "
            f"(stderr: {proc.stderr.decode(errors='replace')[:500]})"
        )
    arr = np.frombuffer(buf[: n_samples * frame_bytes], dtype=np.uint8)
    frames = arr.reshape(n_samples, h, w, 3).astype(dtype)
    timestamps = [lo + i / fps_val for i in range(n_samples)]
    return frames, timestamps


def luma(rgb):
    """rgb: (...,3) array, 0..255. Returns Rec.601 luma, same leading shape."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    return 0.299 * r + 0.587 * g + 0.114 * b


def rgb_to_hsv_arrays(rgb):
    """rgb: (...,3) 0..255 array. Returns (H in [0,360), S in [0,100], V in [0,100]).
    Same convention/formula used by skin_hue_saturation.py -- duplicated there
    on purpose so that script stays a standalone, independently-runnable tool."""
    arr = rgb.astype(np.float64) / 255.0
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


# Fixed inspection regions, in (x0, y0, x1, y1) pixel coords on the native
# 1080x1920 source frame. Picked by eye against a clean reference frame at
# t=8.0s (public/mantra/danna-01-proxy.mp4) -- see tools/qa/README.md for
# the reasoning. All four looks share the same source framing (grade-only
# differences, no reframe/crop), so these boxes are reused as-is across
# L0..L3 and across the whole clip (the shot is a static selfie composition).
FACE_BOX = (260, 0, 820, 700)          # forehead through chin/mouth
HAIR_BOX = (760, 100, 1000, 500)       # loose curly strands against the wall
BG_BOX = (0, 0, 220, 170)              # flat off-white wall, top-left corner (bright, for banding)
# There is no genuinely dark, flat, unobstructed background patch anywhere in
# this shot -- it's an evenly, brightly lit room. This is the darkest
# background-ish region found by an automated scan of block mean/std across
# 12 frames spread through the clip, restricted to non-subject columns: the
# side of a light-gray plastic storage cabinet, which has real near-black
# pixels in its panel-seam shadow lines (measured min luma ~6) even though
# its average is ~110/255. Treat it as "the best available dark/shadow
# region", not a true black backdrop -- documented in tools/qa/README.md.
BG_DARK_BOX = (930, 1350, 1080, 1750)
# REFERENCE_T is keyed to the FINAL out/looks/L*.mp4 renders' own timeline,
# not the raw source proxy's. Those renders run pace-edit/pause trimming on
# top of the raw talking footage (measured: raw proxy is 26.27s/788 frames,
# the four look renders are all 23.9s/717 frames, identical to each other),
# so a timestamp measured on the raw proxy does NOT point at the same visual
# moment in the rendered looks -- checked directly: t=1.5s in the raw proxy
# is a clean shot, but t=1.5s in L0-Source.mp4 has the hand already raised
# over BG_DARK_BOX (the pace edit moved the gesture earlier). t=0.6s in the
# rendered looks is the clean, hands-down equivalent -- verified the same
# way (see tools/qa/README.md).
REFERENCE_T = 0.6                       # seconds, on the out/looks/L*.mp4 timeline


def crop_box(frame, box):
    x0, y0, x1, y1 = box
    return frame[y0:y1, x0:x1]


def gaussian_blur(arr2d, sigma):
    from scipy.ndimage import gaussian_filter
    return gaussian_filter(arr2d, sigma=sigma, mode="nearest")


def sobel_magnitude(arr2d):
    from scipy.ndimage import sobel
    gx = sobel(arr2d, axis=1, mode="nearest")
    gy = sobel(arr2d, axis=0, mode="nearest")
    return np.hypot(gx, gy)


def dilate_bool(mask2d, radius):
    from scipy.ndimage import binary_dilation, generate_binary_structure, iterate_structure
    struct = iterate_structure(generate_binary_structure(2, 1), radius)
    return binary_dilation(mask2d, structure=struct)


def laplacian(arr2d):
    from scipy.ndimage import laplace
    return laplace(arr2d, mode="nearest")


def sample_all_frames_gray(video_path, scale_w, scale_h):
    """Decode EVERY native frame of the video (one ffmpeg pass) as grayscale,
    downscaled to scale_w x scale_h. Used for the highlight-frame and
    motion-frame SELECTION scan, where we want full native-fps coverage
    (no gaps a sparser sample could hide a spike behind) and don't need
    color or full resolution. Returns (frames uint8 (N,H,W), fps)."""
    info = probe(video_path)
    fps = info["fps"]
    cmd = [FFMPEG, "-y", "-v", "error", "-i", video_path,
           "-vf", f"scale={scale_w}:{scale_h}:flags=bilinear",
           "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    buf = proc.stdout
    frame_bytes = scale_w * scale_h
    n = len(buf) // frame_bytes
    arr = np.frombuffer(buf[: n * frame_bytes], dtype=np.uint8).reshape(n, scale_h, scale_w)
    return arr, fps


def sample_consecutive_frames_rgb(video_path, n_frames, t_start, dtype=np.uint8):
    """Decode n_frames CONSECUTIVE native frames starting at/near t_start
    (no fps filter -- native frame rate, full resolution). Used where genuine
    adjacent-frame pairs matter (flicker). -ss before -i is a fast keyframe
    seek, so the actual first frame may land a little before t_start.
    Returns (frames (n_frames,H,W,3), fps)."""
    info = probe(video_path)
    w, h, fps = info["width"], info["height"], info["fps"]
    cmd = [FFMPEG, "-y", "-v", "error", "-ss", f"{t_start:.3f}", "-i", video_path,
           "-frames:v", str(n_frames),
           "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    buf = proc.stdout
    frame_bytes = w * h * 3
    got = len(buf) // frame_bytes
    if got < n_frames:
        raise RuntimeError(
            f"only decoded {got}/{n_frames} consecutive frames from {video_path} "
            f"(stderr: {proc.stderr.decode(errors='replace')[:500]})"
        )
    arr = np.frombuffer(buf[: n_frames * frame_bytes], dtype=np.uint8)
    return arr.reshape(n_frames, h, w, 3).astype(dtype), fps
