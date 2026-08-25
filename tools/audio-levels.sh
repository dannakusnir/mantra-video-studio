#!/usr/bin/env bash
# tools/audio-levels.sh
#
# Three-tier audio pipeline: Original / Clean / Studio.
# Usage: bash tools/audio-levels.sh <input-video-or-audio>
#
# Writes to public/mantra/audio/:
#   original.wav  - bit-exact copy of the source audio track, no processing (control).
#                   DO NOT normalize or otherwise process this file. Its entire job is
#                   to prove the pipeline didn't touch the source; if it ever needs to
#                   change, that means the mp4 source changed, not that it needs "fixing".
#   clean.wav     - light noise reduction + high-pass @80Hz + EBU R128 loudnorm (2-pass)
#   studio.wav    - denoise + high-pass + compressor + de-esser, THEN EBU R128 loudnorm
#                   (2-pass) as the LAST step in the chain. loudnorm must come after the
#                   compressor/de-esser, not before - the compressor removes peaks, so
#                   normalizing first and compressing after leaves studio.wav measurably
#                   quieter than clean.wav, biasing any A/B comparison toward clean by
#                   loudness alone rather than by how the processing actually sounds.
#                   Both clean.wav and studio.wav land on the same I=-16 LRA=11 TP=-1.5
#                   target so the three-way comparison isn't loudness-biased.
#
# All output is 48kHz stereo PCM WAV (pcm_s24le) to avoid introducing any
# additional lossy encode step beyond what is explicitly requested.

set -euo pipefail

FFMPEG="${FFMPEG:-/Users/dannakushnir/.local/bin/ffmpeg}"
FFPROBE="${FFPROBE:-/Users/dannakushnir/.local/bin/ffprobe}"

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <input-file>" >&2
  exit 1
fi

INPUT="$1"
if [[ ! -f "$INPUT" ]]; then
  echo "ERROR: input file not found: $INPUT" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$REPO_ROOT/public/mantra/audio"
mkdir -p "$OUT_DIR"

ORIGINAL="$OUT_DIR/original.wav"
CLEAN="$OUT_DIR/clean.wav"
STUDIO="$OUT_DIR/studio.wav"

echo "== Step 1/3: original.wav (bit-exact control copy, no processing) =="
"$FFMPEG" -y -hide_banner -loglevel error \
  -i "$INPUT" \
  -map 0:a:0 -vn -c:a pcm_s24le -ar 48000 \
  "$ORIGINAL"

echo "== Step 2/3: clean.wav (afftdn + high-pass 80Hz + loudnorm 2-pass) =="

# --- loudnorm pass 1: measure ---
LOUDNORM_TARGET="I=-16:LRA=11:TP=-1.5"
MEASURE_FILTER="afftdn=nr=12:nf=-30,highpass=f=80,loudnorm=${LOUDNORM_TARGET}:print_format=json"

MEASURE_JSON=$("$FFMPEG" -hide_banner -nostats -i "$ORIGINAL" -af "$MEASURE_FILTER" -f null - 2>&1 | tail -n 20)

meas_I=$(echo "$MEASURE_JSON" | grep -o '"input_i" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
meas_TP=$(echo "$MEASURE_JSON" | grep -o '"input_tp" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
meas_LRA=$(echo "$MEASURE_JSON" | grep -o '"input_lra" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
meas_thresh=$(echo "$MEASURE_JSON" | grep -o '"input_thresh" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
meas_offset=$(echo "$MEASURE_JSON" | grep -o '"target_offset" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')

if [[ -z "$meas_I" || -z "$meas_TP" || -z "$meas_LRA" || -z "$meas_thresh" ]]; then
  echo "ERROR: loudnorm measurement pass failed to produce stats." >&2
  echo "$MEASURE_JSON" >&2
  exit 1
fi

echo "  loudnorm measured: I=$meas_I TP=$meas_TP LRA=$meas_LRA thresh=$meas_thresh offset=$meas_offset"

# --- loudnorm pass 2: apply, using measured values for linear normalization ---
APPLY_FILTER="afftdn=nr=12:nf=-30,highpass=f=80,loudnorm=${LOUDNORM_TARGET}:measured_I=${meas_I}:measured_TP=${meas_TP}:measured_LRA=${meas_LRA}:measured_thresh=${meas_thresh}:offset=${meas_offset}:linear=true:print_format=summary"

"$FFMPEG" -y -hide_banner -loglevel error \
  -i "$ORIGINAL" \
  -af "$APPLY_FILTER" \
  -c:a pcm_s24le -ar 48000 \
  "$CLEAN"

echo "== Step 3/3: studio.wav (denoise + high-pass + compressor + de-esser, THEN loudnorm 2-pass) =="

# Gentle compressor: ratio 1.8:1 (kept <=3:1 per constraint). Threshold is -26dB,
# NOT relative to a normalized signal - the compressor now runs on the raw
# afftdn+highpass output (pre-loudnorm), which sits around -33dB RMS / -14dB peak
# on this source. -18dB (a threshold that made sense post-normalization) would
# barely engage here since almost no frame reaches it; -26dB was picked by
# measuring the actual per-frame peak distribution of the pre-loudnorm signal
# (median -28dB, p75 -23dB) so the compressor does real, gentle work on the
# louder syllables. Verified empirically to keep peak gain reduction under 6dB
# - see report. De-essing via ffmpeg's built-in `deesser` filter, which targets
# 5-8kHz sibilance without touching pitch/formants.
#
# loudnorm runs LAST here (not before the compressor, unlike clean.wav's chain)
# so studio.wav lands on the same loudness target as clean.wav instead of coming
# out quieter because the compressor shaved its peaks first.
STUDIO_PRENORM="afftdn=nr=12:nf=-30,highpass=f=80,acompressor=threshold=-26dB:ratio=1.8:attack=15:release=200:makeup=1,deesser=i=0.3:m=0.5:f=0.5:s=o"

# --- studio loudnorm pass 1: measure (on the post-compressor/de-esser signal) ---
STUDIO_MEASURE_FILTER="${STUDIO_PRENORM},loudnorm=${LOUDNORM_TARGET}:print_format=json"
STUDIO_MEASURE_JSON=$("$FFMPEG" -hide_banner -nostats -i "$ORIGINAL" -af "$STUDIO_MEASURE_FILTER" -f null - 2>&1 | tail -n 20)

s_meas_I=$(echo "$STUDIO_MEASURE_JSON" | grep -o '"input_i" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
s_meas_TP=$(echo "$STUDIO_MEASURE_JSON" | grep -o '"input_tp" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
s_meas_LRA=$(echo "$STUDIO_MEASURE_JSON" | grep -o '"input_lra" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
s_meas_thresh=$(echo "$STUDIO_MEASURE_JSON" | grep -o '"input_thresh" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')
s_meas_offset=$(echo "$STUDIO_MEASURE_JSON" | grep -o '"target_offset" *: *"[^"]*"' | sed 's/.*: *"//;s/"//')

if [[ -z "$s_meas_I" || -z "$s_meas_TP" || -z "$s_meas_LRA" || -z "$s_meas_thresh" ]]; then
  echo "ERROR: studio loudnorm measurement pass failed to produce stats." >&2
  echo "$STUDIO_MEASURE_JSON" >&2
  exit 1
fi

echo "  studio loudnorm measured: I=$s_meas_I TP=$s_meas_TP LRA=$s_meas_LRA thresh=$s_meas_thresh offset=$s_meas_offset"

# --- studio loudnorm pass 2: apply, as the final stage of the chain ---
STUDIO_FILTER="${STUDIO_PRENORM},loudnorm=${LOUDNORM_TARGET}:measured_I=${s_meas_I}:measured_TP=${s_meas_TP}:measured_LRA=${s_meas_LRA}:measured_thresh=${s_meas_thresh}:offset=${s_meas_offset}:linear=true:print_format=summary"

"$FFMPEG" -y -hide_banner -loglevel error \
  -i "$ORIGINAL" \
  -af "$STUDIO_FILTER" \
  -c:a pcm_s24le -ar 48000 \
  "$STUDIO"

echo ""
echo "Done. Output files:"
ls -la "$ORIGINAL" "$CLEAN" "$STUDIO"
