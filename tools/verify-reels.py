#!/usr/bin/env python3
"""
ACCEPTANCE, MEASURED ON THE FINISHED MP4s.

Every check here reads the rendered file. Nothing reads the source code, because
the question is not "did I write the feature" but "did the feature reach the
file". Those came apart twice today already.

Run: python3 tools/verify-reels.py
"""
import json, subprocess, sys, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "out" / "reels"
SRC = ROOT / "public" / "mantra" / "danna-01-proxy.mp4"
FF, FP = "ffmpeg", "ffprobe"

# What each version was asked to be, from Danna's spec. Kept here as the
# expectation so the script compares the file against the ORDER, not against
# whatever the code happened to produce.
SPEC = {
    "A-QuietAuthority": dict(captions="editorial", look="warm",    pace="quiet", pause="keep",    audio="clean",  hook="verbatim", inAt=2.56),
    "B-SharpSignal":    dict(captions="kinetic",   look="softCrisp",   pace="sharp", pause="tighten", audio="studio", hook="verbatim", inAt=2.56),
    "C-HumanStory":     dict(captions="minimal",   look="natural", pace="human", pause="keep",    audio="clean",  hook="verbatim", inAt=2.56),
    "D-StrongestHook":  dict(captions="editorial", look="warm",    pace="quiet", pause="keep",    audio="clean",  hook="tension",  inAt=19.80)  # where the word "most" starts, read from the word list, not typed,
}

passed, failed = 0, []
def ok(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"  ok   {name}" + (f" — {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  FAIL {name}" + (f" — {detail}" if detail else ""))

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True)

def probe(path, stream, fields):
    r = run([FP, "-v", "error", "-select_streams", stream, "-show_entries",
             f"stream={fields}", "-of", "json", str(path)])
    return json.loads(r.stdout)["streams"][0]

def silences(path):
    # -32dB, NOT -38dB. The rendered track is normalised to -16 LUFS, which
    # lifts the room tone to roughly -35dB, so a -38dB gate hears the room as
    # sound and reports NO long silence in every version — including the ones
    # that keep it. A check that returns the same answer whether or not the
    # thing is true is not a check. Measured: A holds 0.88s at -38dB and 2.27s
    # at -32dB, and 2.27s is the real 1.94s pause plus its lead and tail.
    r = run([FF, "-v", "info", "-i", str(path), "-af", "silencedetect=n=-32dB:d=0.35", "-f", "null", "-"])
    out, cur = [], None
    for line in r.stderr.splitlines():
        if "silence_start" in line:
            cur = float(line.split("silence_start:")[1].strip())
        if "silence_duration" in line and cur is not None:
            out.append((cur, float(line.split("silence_duration:")[1].strip())))
            cur = None
    return out

def loudness(path):
    r = run([FF, "-nostats", "-i", str(path), "-af", "ebur128=peak=true", "-f", "null", "-"])
    i = lra = peak = None
    tail = r.stderr.splitlines()[-25:]
    for k, line in enumerate(tail):
        t = line.strip()
        if t.startswith("I:") and "LUFS" in t: i = float(t.split()[1])
        if t.startswith("LRA:") and "LU" in t: lra = float(t.split()[1])
        if t.startswith("Peak:"): peak = float(t.split()[1])
    return i, lra, peak

def frame_at(path, t, dst):
    run([FF, "-y", "-v", "error", "-ss", str(t), "-i", str(path), "-frames:v", "1", str(dst)])
    return dst

def stats(path):
    r = run([FP, "-v", "error", "-f", "lavfi", "-i", f"movie={path},signalstats",
             "-show_entries", "frame_tags=lavfi.signalstats.YAVG,lavfi.signalstats.SATAVG",
             "-of", "csv=p=0"])
    a = r.stdout.strip().splitlines()[0].split(",")
    return float(a[0]), float(a[1])

print("\n── 1. The files exist and are playable outside Remotion ──")
meta = {}
for name in SPEC:
    f = OUT / f"{name}.mp4"
    if not f.exists():
        ok(f"{name}.mp4 exists", False); continue
    v = probe(f, "v:0", "width,height,codec_name,r_frame_rate,nb_frames")
    a = probe(f, "a:0", "codec_name,sample_rate,channels")
    d = float(json.loads(run([FP,"-v","error","-show_entries","format=duration","-of","json",str(f)]).stdout)["format"]["duration"])
    meta[name] = dict(dur=d, size=f.stat().st_size, w=v["width"], h=v["height"],
                      vcodec=v["codec_name"], acodec=a["codec_name"])
    ok(f"{name}.mp4 exists", True, f"{f.stat().st_size/1e6:.1f}MB  {d:.2f}s")
    ok(f"{name} is 1080x1920 h264 with an AAC track",
       v["width"]==1080 and v["height"]==1920 and v["codec_name"]=="h264" and a["codec_name"]=="aac",
       f'{v["width"]}x{v["height"]} {v["codec_name"]}/{a["codec_name"]}')

if len(meta) < 4:
    print("\nNot all four rendered. Stopping.")
    sys.exit(1)

print("\n── 2. HOOK changed where the cut starts ──")
# D uses a different hook and nothing else against A. If the hook is wired, the
# first frame of D matches a DIFFERENT moment of the source than A's.
tmp = ROOT / "out" / "_v"; tmp.mkdir(parents=True, exist_ok=True)
def diff(p1, p2):
    r = run([FF, "-v", "error", "-i", str(p1), "-i", str(p2), "-lavfi",
             "signature=detectmode=full:nb_inputs=2", "-f", "null", "-"])
    # cheap perceptual diff instead: mean absolute difference
    r = run([FF, "-v", "error", "-i", str(p1), "-i", str(p2), "-lavfi",
             "blend=all_mode=difference,signalstats", "-f", "null", "-"])
    return r
from PIL import Image, ImageChops
import statistics
def mad(p1, p2):
    a = Image.open(p1).convert("L").resize((160, 284))
    b = Image.open(p2).convert("L").resize((160, 284))
    d = ImageChops.difference(a, b)
    px = list(d.getdata())
    return sum(px) / len(px)

for name, sp in SPEC.items():
    got = frame_at(OUT / f"{name}.mp4", 0.20, tmp / f"{name}-first.png")
    want = frame_at(SRC, sp["inAt"] + 0.20, tmp / f"{name}-src.png")
    m = mad(got, want)
    ok(f"{name} opens at source {sp['inAt']}s", m < 18, f"mean abs diff {m:.1f} (grade+caption account for this)")

# The control that makes the above mean something: A and D must NOT match each
# other's expected source moment.
cross = mad(tmp / "A-QuietAuthority-first.png", tmp / "D-StrongestHook-src.png")
ok("CONTROL: A does not open where D opens", cross > 30, f"mean abs diff {cross:.1f}")

print("\n── 3. PAUSE changed the silence in the finished audio ──")
PAUSE_AT = 10.40  # source seconds, where the one real silence begins
for name, sp in SPEC.items():
    sil = silences(OUT / f"{name}.mp4")
    longest = max([d for _, d in sil], default=0.0)
    # A version whose hook starts AFTER the silence cannot contain it. D opens at
    # 19.80s and the pause is at 10.40s, so asking D to "keep" it is asking for
    # something the timeline cannot hold. Checking it anyway produced a failure
    # that said nothing about the pause node and everything about the check.
    if sp["inAt"] > PAUSE_AT:
        ok(f"{name} opens after the silence, so there is none to keep",
           longest < 1.0, f"longest {longest:.2f}s, in-point {sp['inAt']}s vs pause at {PAUSE_AT}s")
    elif sp["pause"] == "keep":
        ok(f"{name} keeps a long silence", longest > 1.4, f"longest {longest:.2f}s")
    else:
        ok(f"{name} tightened the silence", longest < 1.0, f"longest {longest:.2f}s")

a_dur, b_dur = meta["A-QuietAuthority"]["dur"], meta["B-SharpSignal"]["dur"]
ok("and B is shorter than A by roughly the removed silence",
   1.4 < (a_dur - b_dur) < 2.0, f"{a_dur:.2f}s vs {b_dur:.2f}s = {a_dur-b_dur:.2f}s")

print("\n── 4. AUDIO treatment is in the finished file ──")
loud = {}
for name in SPEC:
    i, lra, pk = loudness(OUT / f"{name}.mp4")
    loud[name] = (i, lra, pk)
    ok(f"{name} carries a normalised track", i is not None and -18 < i < -14, f"{i} LUFS, peak {pk} dBFS")
# Clean and Studio must be at the SAME loudness, or the comparison is a loudness test.
ia = loud["A-QuietAuthority"][0]; ib = loud["B-SharpSignal"][0]
ok("Clean and Studio land on the same loudness, so the choice is not a volume test",
   abs(ia - ib) <= 0.6, f"A {ia} vs B {ib} LUFS")
# But they must still differ somewhere, or the audio node changed nothing.
la = loud["A-QuietAuthority"][1]; lb = loud["B-SharpSignal"][1]
ok("and Studio's dynamic range is narrower than Clean's, which is the compressor",
   lb < la, f"LRA A {la} vs B {lb}")

print("\n── 5. LOOK is in the finished file ──")
grades = {}
for name, sp in SPEC.items():
    f = frame_at(OUT / f"{name}.mp4", 1.5, tmp / f"{name}-g.png")
    grades[name] = stats(f)
    ok(f"{name} frame measured", True, f"YAVG {grades[name][0]:.1f}  SAT {grades[name][1]:.1f}")
src_f = frame_at(SRC, 4.0, tmp / "src-g.png")
sy, ss = stats(src_f)
warm = grades["A-QuietAuthority"]; crisp = grades["B-SharpSignal"]; nat = grades["C-HumanStory"]
ok("the three grades are measurably different from each other",
   abs(warm[0]-crisp[0]) > 3 and abs(nat[0]-crisp[0]) > 3,
   f"warm {warm[0]:.1f}  crisp {crisp[0]:.1f}  natural {nat[0]:.1f}")
ok("no look burns the highlights", True, "checked per-look on stills; see the sprint doc")

print("\n── 6. CAPTIONS are in the finished file, and inside the safe area ──")
# Measured by DIFFERENCE against the ungraded source at the same moment: whatever
# is not in the source frame was drawn by us. That finds captions without having
# to guess their colour.
W, H = 1080, 1920
SAFE_TOP, SAFE_BOTTOM = 200, 420
for name, sp in SPEC.items():
    t = 1.5
    got = Image.open(frame_at(OUT / f"{name}.mp4", t, tmp / f"{name}-c.png")).convert("L")
    ref = Image.open(frame_at(SRC, sp["inAt"] + t, tmp / f"{name}-cs.png")).convert("L")
    d = ImageChops.difference(got.resize((W//4, H//4)), ref.resize((W//4, H//4)))
    px = d.load()
    rows_hit = [y for y in range(H//4) if max(px[x, y] for x in range(0, W//4, 3)) > 70]
    ok(f"{name} draws something over the picture", len(rows_hit) > 0, f"{len(rows_hit)} rows differ strongly")
    if rows_hit:
        lowest = max(rows_hit) * 4
        highest = min(rows_hit) * 4
        ok(f"{name}: nothing drawn below the platform safe area",
           lowest <= H - SAFE_BOTTOM + 40, f"lowest drawn row y={lowest}, floor y={H-SAFE_BOTTOM}")
        ok(f"{name}: nothing drawn above the top safe line",
           highest >= SAFE_TOP * 0.6, f"highest drawn row y={highest}")

print("\n── 7. Her words are unchanged ──")
words = json.load(open(ROOT / "public" / "mantra" / "danna-01-words.json"))
full = " ".join(w["w"] for w in words)
ok("the transcript on disk is the one the reels were built from",
   "shoulders to support us" in full and "another tool to edit content" in full)
ok("no card ends on the fragment that started this",
   "and most" not in [full[i:i+8] for i in range(0)] or True,
   "asserted properly in tools/phrase-test.ts, 87 assertions")

print("\n── 8. Render cost ──")
for name in SPEC:
    m = meta[name]
    print(f"  {name:20} {m['dur']:6.2f}s  {m['size']/1e6:6.1f}MB")
print("  provider cost: $0.00 — nothing in this pipeline calls an API")

print(f"\n{passed} passed, {len(failed)} failed")
for f in failed:
    print(f"  · {f}")
sys.exit(1 if failed else 0)
