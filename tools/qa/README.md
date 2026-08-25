# tools/qa/ -- motion-QA measurement kit for the Mantra Reel looks

Moved into the repo (from a session's private `/private/tmp/...` scratchpad,
where they couldn't be re-run or reviewed) per the product owner's request:
*"if these tools stay part of QA, move them into the repo with run
instructions and a basic test. Otherwise the findings can't be reproduced."*

## What's here

| file | what it does |
|---|---|
| `skin_hue_saturation.py` | QA-only. Measures HSV saturation restricted to a skin-hue pixel band, on still images. |
| `split_tone.py` | Measures R-B color bias separately in shadows / mids / highlights, on still images. |
| `temporal.py` | The main deliverable: motion-QA across a set of graded videos (temporal consistency, flicker, compression, halos, skin texture, black crush, highlight clipping, noise, color shift, banding). |
| `crops.py` | Produces the visual "look at it" material: a side-by-side compare row, 100%-pixel face/hair/dark-background crops, and the measured highlight-frame and motion-frame comparisons. |
| `test_qa.py` | Basic self-test. Generates synthetic images/videos, runs every tool above, asserts each metric moves in the right direction. |
| `_common.py` | Shared ffmpeg/ffprobe/numpy plumbing. Not a standalone tool -- imported by `temporal.py` and `crops.py`. |

**`skin_hue_saturation.py`'s HSV mask is a QA-only diagnostic.** It is not
safe or accurate enough to use as a production selection mask (wrong for
many skin tones and lighting conditions) -- see `Look.tsx`'s own comment on
this. If you see it referenced anywhere outside `tools/qa/`, that's wrong;
flag it, don't wire it in.

## Setup

```bash
# ffmpeg/ffprobe 7.0, already installed on this machine at:
export PATH="$HOME/.local/bin:$PATH"

# Python deps (numpy + PIL were already available; temporal.py/crops.py also
# use scipy for gaussian blur / sobel / dilation -- already installed here,
# but if you're on a fresh machine:
pip3 install numpy pillow scipy
```

## Run everything (the exact commands, in order)

```bash
cd /Users/dannakushnir/dev/mantra-video-studio
export PATH="$HOME/.local/bin:$PATH"

# 1. self-test first -- confirms the tools themselves aren't broken
python3 tools/qa/test_qa.py

# 2. temporal QA across all four looks (first arg = baseline / control)
python3 tools/qa/temporal.py \
  out/looks/L0-Source.mp4 out/looks/L1-Natural.mp4 \
  out/looks/L2-Warm.mp4 out/looks/L3-Crisp.mp4 \
  --out-json out/qa/temporal_results.json

# 3. visual QA material (compare row, 100% crops, highlight/motion frames)
#    NOTE: the "source" argument here is out/looks/L0-Source.mp4, NOT the
#    raw public/mantra/danna-01-proxy.mp4 -- see the timeline-mismatch note
#    below. It must be a video on the SAME timeline as the videos being
#    compared (same duration/frame count), since its only job is to measure
#    the two timestamps that then get extracted from every video in the list.
python3 tools/qa/crops.py \
  out/looks/L0-Source.mp4 \
  out/looks/L0-Source.mp4 out/looks/L1-Natural.mp4 \
  out/looks/L2-Warm.mp4 out/looks/L3-Crisp.mp4 \
  --out-dir out/qa

# 4. (optional) the two still-image tools, if you want the skin-hue /
#    split-tone table on a specific frame instead of temporal.py's
#    whole-clip version -- extract one frame per look first, e.g.:
for L in L0-Source L1-Natural L2-Warm L3-Crisp; do
  ffmpeg -y -v error -ss 0.6 -i out/looks/$L.mp4 -frames:v 1 /tmp/$L-ref.png
done
python3 tools/qa/skin_hue_saturation.py /tmp/L0-Source-ref.png /tmp/L1-Natural-ref.png /tmp/L2-Warm-ref.png /tmp/L3-Crisp-ref.png
python3 tools/qa/split_tone.py /tmp/L0-Source-ref.png /tmp/L1-Natural-ref.png /tmp/L2-Warm-ref.png /tmp/L3-Crisp-ref.png
```

`temporal.py` and `crops.py` both take **the baseline first**. `crops.py`
additionally takes a "source" video as its very first argument, used *only*
to measure the highlight/motion timestamps (see below) -- the actual crops
shown are pulled from the look files that follow.

**That "source" argument must be on the same timeline as the videos you're
comparing.** Measured directly: `public/mantra/danna-01-proxy.mp4` (the raw
talking-head recording) is 26.27s / 788 frames, while the four
`out/looks/L*.mp4` renders are all 23.9s / 717 frames -- the render pipeline
trims pauses/dead air on top of the raw footage, so a timestamp measured on
the raw proxy does not point at the same visual moment in the rendered
looks. Confirmed the hard way: t=1.5s in the raw proxy is a clean
hands-down frame, but t=1.5s in `L0-Source.mp4` already has the hand raised
over the dark-background crop region. **Use `out/looks/L0-Source.mp4` as the
`crops.py` source argument when measuring the actual four looks** (the raw
proxy is only useful for developing/testing the tools before renders exist,
which is what it was used for here first).

Everything writes under `out/qa/` and `out/looks/`, both git-ignored (see
`.gitignore`). Nothing here ever commits video or images.

## Reading `temporal.py`'s output

Each row is one metric, one column per input video (baseline first). A row
prints `-> SUSPECT-BROKEN` under it if every non-baseline video produced the
*exact same* value as the baseline -- across four different color grades
that should not happen for a metric that's actually measuring the image; a
flat row like that means treat the measurement as broken instrumentation,
not as "no difference."

| metric | what "normal" looks like |
|---|---|
| `yavg_mean` / `yavg_std` | Overall brightness and how much it wanders across the whole clip. Grades can shift `yavg_mean` (that's the point); `yavg_std` should stay in the same ballpark as L0 -- a much bigger swing means the grade is introducing instability, not just applying a look. |
| `frame_diff_std` (dense) | Stdev of adjacent-native-frame brightness jumps, from a genuine 90-consecutive-frame window. Should track L0 closely; if a look inflates this, something in the pipeline is adding per-frame jitter the source didn't have. |
| `flicker_count` / `flicker_rate_pct` / `flicker_mean_mag` | Count and size of adjacent-frame jumps over 1.0 luma (0-255 scale), from the same dense window. Compare each look to L0's count -- a much higher count on a look is real flicker, not present in the ungraded source. |
| `bitrate_bps` | Actual encoded bitrate, from ffprobe, no proxy involved. |
| `blockiness_ratio` | Ratio of gradient energy right at 8px block boundaries vs elsewhere. Near 1.0 = no visible block structure; higher = compression blocking. Compare across looks -- if a look's encode is much higher than L0's, that look is compressing worse for the same visual complexity. |
| `halo_energy` | Unsharp-residual magnitude in a ring just outside L0's own strong edges (so all 4 looks are scored against the *same* edge locations). L0 vs itself is the floor; a look scoring much higher has visible sharpening halos the source doesn't. |
| `skin_texture_var` | Laplacian variance inside the skin-hue mask, restricted to the face box. **Must not drop below L0** -- a drop means skin got smoothed (forbidden per the brief), not "more polished." |
| `black_crush_pct` | % of pixels at Y<=16, whole frame. Compare to L0 -- a much higher number means shadow detail is crushing to black. |
| `highlight_clip_pct` -- **HARD GATE** | % of pixels at Y>=250, whole frame. The script prints an explicit PASS/FAIL per look under its own "HIGHLIGHT CLIPPING HARD GATE" section: FAIL if a look's clipping increases by more than 0.5 percentage points over L0, or goes from ~0% to any real amount. This is the one row that isn't diagnostic -- it's supposed to block. |
| `noise_std` | High-pass residual stdev inside the bright-wall crop (`BG_BOX`). Compare to L0 -- higher means the grade is amplifying sensor noise in flat areas. |
| `banding_gaps` | Count of empty histogram bins between the used luma range, same bright-wall crop. Higher means the smooth gradient on the wall is stair-stepping (posterization) more than it should. |
| `color_motion_corr` / `color_motion_quartile_delta` | Whether the frame's R-B bias tracks how much motion is happening (correlation, and the R-B difference between the highest- and lowest-motion quarters of the clip). A look where this swings much more than L0's is shifting color specifically during motion, which usually reads as a grading/encoding artifact, not style. |

**Per the product owner's updated rules** (read literally, not paraphrased):
`SATAVG` (skin-hue saturation, from `skin_hue_saturation.py`) is now a
**diagnostic, not a hard gate**. `Crisp` is explicitly allowed to be less
saturated than the source. Skin saturation should not exceed the source
without a deliberate decision, and skin hue should not visibly shift toward
orange/red/magenta -- but the final look choice is made on how it looks, not
on hitting one number. `highlight_clip_pct` remains the one hard gate.

## Reading `crops.py`'s output

- **`compare-row.png`** -- all input videos at `t=0.6s` (a clean reference
  frame, hands not in shot), downscaled to fit side by side, labeled.
- **`crop-face-100pct.png`** -- 1:1 pixel crop of the face, same frame, all
  videos. No resizing -- what you see is native-resolution pixels.
- **`crop-hair-100pct.png`** -- 1:1 pixel crop of loose curly hair strands
  against the wall. This is the single best region in this footage for
  spotting sharpening halos (a bright/dark fringe right where a hair strand
  meets the wall) and noise amplification, because it's fine, high-frequency
  detail against a flat background.
- **`crop-bg-dark-100pct.png`** -- 1:1 pixel crop of the darkest available
  background region. **Read this note before judging it**: this footage has
  no genuinely black or even dark, flat background patch anywhere -- it's an
  evenly, brightly lit room. An automated scan of block mean/stdev across 12
  frames spread through the clip (restricted to non-subject columns) found
  the darkest usable spot to be the side of a light-gray plastic storage
  cabinet (mean luma ~110/255), which does have real near-black pixels in
  its panel-seam shadow lines (measured min ~6/255). That's what's in this
  crop. It is a reasonable proxy for eyeballing shadow banding/crush
  behavior, but if the product owner wants a true "crushes to solid black"
  visual check, this shot doesn't offer a region for it -- `temporal.py`'s
  whole-frame `black_crush_pct` metric is the more reliable source for that
  specific question, since it isn't limited to one crop.
- **`frame-highlight.png`** -- all videos at the timestamp *measured* (not
  guessed) to have the highest percentage of near-white (Y>=250) pixels,
  scanned across every native frame of the source. `selection.json` records
  the picked timestamp and the measurement that justified it.
- **`frame-motion.png`** -- all videos at the timestamp *measured* to have
  the largest mean adjacent-native-frame luma difference (i.e. the most
  motion), scanned the same way.
- **`selection.json`** -- the raw numbers behind both picks: the winning
  timestamp, its measured value, and the clip's mean/stdev for context (so
  you can see how much of an outlier the pick actually is).

## Fixed crop regions and why (`_common.py`)

Picked by eye against clean reference frames (same pixel positions hold on
both the raw proxy and the rendered looks -- it's a static selfie shot,
camera doesn't move, framing doesn't change, only the grade and the pace-
edit's trimming do), then reused unchanged across all four looks and the
whole clip:

```
FACE_BOX     = (260,   0, 820,  700)   # forehead through chin/mouth
HAIR_BOX     = (760, 100, 1000, 500)   # loose curly strands against the wall
BG_BOX       = (0,     0, 220,  170)   # flat, bright off-white wall (top-left) -- used for noise/banding metrics
BG_DARK_BOX  = (930, 1350, 1080, 1750) # darkest available background (see crop-bg-dark note above)
REFERENCE_T  = 0.6   # seconds, on the out/looks/L*.mp4 (post pace-edit) timeline
```

If a future source clip has different framing, these four constants are the
only thing that needs to change -- re-derive them the same way (extract a
clean frame, eyeball candidate boxes, confirm with a quick annotated crop).

## What counts as a broken measurement, and why the tools check for it themselves

Every metric that compares looks to L0 needs a control: **if L0 compared
against itself (or any metric shows the exact same number for all four
looks) doesn't come out at/near zero difference, or a metric refuses to
move at all across four genuinely different grades, the measurement is
suspect, not the finding.** `temporal.py` checks this automatically (the
`SUSPECT-BROKEN` flag under each metric row). `test_qa.py` checks it a
different way, at the unit level: it feeds each tool a case built so the
measured quantity is known to be higher in one synthetic input than the
other, and fails loudly if the tool doesn't reflect that.

## Design choices worth knowing about (temporal.py sampling)

`temporal.py` does not decode all ~788 native frames of every video --that
would work, but at four videos it's slower than it needs to be for no
accuracy gain on most of these metrics. Instead it does two passes per
video:

- **WIDE** (default 64 frames, evenly spaced across the *entire* clip, one
  single-pass ffmpeg decode): used for anything where whole-video coverage
  matters more than true native-adjacent frames -- brightness trend, black
  crush, highlight clipping (the hard gate specifically must not miss a
  clipped region that happens outside a short window), skin texture,
  background noise, banding, and the color-shift-vs-motion read (motion here
  is "how much changed in the ~0.4s between WIDE samples", a coarser signal
  than true frame-to-frame motion, but consistent across all four looks
  since they share the same sampling grid).
- **DENSE** (default 90 *consecutive* native frames, one ~3s window in the
  middle of the clip): used for the one thing that specifically needs real
  adjacent-frame pairs -- flicker and the frame-to-frame YAVG jitter stdev.

Both passes independently clear the brief's "sample at least 60 frames, not
3" floor. You can raise either with `--wide-n` / `--dense-n` if you want
finer coverage at the cost of runtime (roughly linear: 64 WIDE frames costs
about a minute per video end-to-end on this machine, including scoring).

This is a deliberate trade-off, not an oversight -- flagged per the brief's
"you may improve the measurement, but explain it" instruction.
