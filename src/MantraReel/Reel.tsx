// MANTRA REEL — the first composition built to Danna's editing DNA rather than
// to a template.
//
// WHAT IT REFUSES TO DO, and every one of these is a line from the brief:
//
//   no cut every second on a talking head
//   no transitions without a reason
//   no automatic zoom
//   no generic B-roll
//   no changing her words
//   hold the frame while the performance is good
//   the captions make the rhythm
//   keep a real silence when it serves the story
//
// So there is no wipe, no push, no Ken Burns, no sting, no logo animation and
// no music bed. The only thing moving in this composition is her, and the words
// arriving as she says them.
//
// THE ONE EDITORIAL DECISION lives in `pauseCut`. Her recording has a genuine
// 1.94 second silence in the middle, after "and that's why I do this." and
// before "I think that we all need this push". Version A keeps it whole.
// Version B tightens it. Nothing else differs between the two, so if the two
// files feel different, that difference is the pause and not a variable I
// changed by accident.

import React from "react";
import {
  AbsoluteFill,
  Audio,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { z } from "zod";

export const wordSchema = z.object({
  w: z.string(),
  start: z.number(),
  end: z.number(),
  gap_before: z.number().default(0),
});

export const mantraReelSchema = z.object({
  videoUrl: z.string(),
  /** Whisper's own words, rebased to this clip. Never rewritten. */
  words: z.array(wordSchema),
  /** Where the recording should end, in source seconds. */
  outSec: z.number(),
  /**
   * The pause, and what to do with it.
   *
   * `keepSec` null means keep every frame of it. A number means hold that many
   * seconds and drop the rest, which is a real cut: the video jumps and the
   * audio jumps with it.
   */
  pauseAtSec: z.number(),
  pauseLengthSec: z.number(),
  pauseKeepSec: z.number().nullable(),
  /** The line the reel is built on. Must appear verbatim in `words`. */
  hook: z.string(),
});

export type MantraReelProps = z.infer<typeof mantraReelSchema>;

/* ── The look ──────────────────────────────────────────────────────────────
 * Read off motion/theme.ts in the app, so the video and the product are the
 * same object. Nothing here is a colour I liked.
 */
const INK = "#F0E6DA";
const GLOW = "#E0A75F";
const GROUND = "#17100D";

/**
 * LINES BROKEN BY HER OWN PAUSES, not by a word count.
 *
 * The first version chopped every four words and produced "about it and most",
 * which is a fragment spanning two clauses and reads as broken text. The brief
 * says the captions make the rhythm; a fixed chunk size destroys rhythm, it
 * does not create it.
 *
 * A line ends where SHE ended one: on her punctuation, or before a real gap in
 * the audio. `gap_before` comes from Whisper and is the actual measured silence
 * between two words, so the caption breaks where the speaker breathed.
 *
 * The character limit is a last resort for a long unbroken run, not the rule.
 */
const BREATH_S = 0.18;
// Long enough to hold a whole clause, which then WRAPS onto a second line
// rather than being cut in half. 30 was breaking "comfortable about it and most
// of" away from "us", which is the same fragment problem one level up.
const MAX_CHARS = 46;

function toLines(words: MantraReelProps["words"]) {
  const lines: { text: string; start: number; end: number }[] = [];
  let cur: typeof words = [];
  const flush = () => {
    if (!cur.length) return;
    lines.push({
      text: cur.map((w) => w.w).join(" "),
      start: cur[0].start,
      end: cur[cur.length - 1].end,
    });
    cur = [];
  };
  for (let i = 0; i < words.length; i++) {
    cur.push(words[i]);
    const w = words[i];
    const next = words[i + 1];
    const endsClause = /[.,!?;:]$/.test(w.w);
    const breathAfter = next ? next.gap_before >= BREATH_S : true;
    const wide = cur.map((x) => x.w).join(" ").length >= MAX_CHARS;
    if (endsClause || breathAfter || wide) flush();
  }
  flush();
  return lines;
}

function Captions({ words }: { words: MantraReelProps["words"] }) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const lines = React.useMemo(() => toLines(words), [words]);
  const line = lines.find((l) => t >= l.start - 0.08 && t <= l.end + 0.36);
  if (!line) return null;

  // A short fade rather than a pop. The word is already arriving in the audio;
  // the caption's job is to be legible, not to announce itself.
  const age = t - (line.start - 0.08);
  const opacity = interpolate(age, [0, 0.09], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: height * 0.085 }}>
      <div
        style={{
          opacity,
          maxWidth: "84%",
          textAlign: "center",
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 58,
          lineHeight: 1.22,
          color: INK,
          // Legibility over a moving face, without a box. A box would be a
          // panel that carries no information, which the brief rules out.
          // Her shirt is cream and her hands cross the frame, so a soft shadow is
          // not enough on its own. Two tight shadows plus one wide one keep the
          // type readable over skin, fabric and the embroidered eye without
          // putting a box behind it.
          textShadow:
            "0 1px 2px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9), 0 6px 30px rgba(0,0,0,0.75)",
          letterSpacing: -0.4,
        }}
      >
        {line.text}
      </div>
    </AbsoluteFill>
  );
}

/**
 * The one hairline the boards put on every screen, and the only graphic here.
 *
 * It rides the real progress of the clip. It is the only element on screen that
 * is not her or her words, and it earns that by carrying information: how far
 * through you are.
 */
function ProgressRule() {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const p = frame / Math.max(1, durationInFrames - 1);
  const y = height * 0.075;
  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 0, top: y, width, height: 1, background: "rgba(240,230,218,0.18)" }} />
      <div style={{ position: "absolute", left: 0, top: y, width: width * p, height: 1, background: GLOW }} />
      <div
        style={{
          position: "absolute",
          left: Math.max(0, width * p - 3),
          top: y - 2.5,
          width: 6,
          height: 6,
          borderRadius: 3,
          background: GLOW,
          boxShadow: `0 0 10px ${GLOW}`,
        }}
      />
    </AbsoluteFill>
  );
}

export const MantraReel: React.FC<MantraReelProps> = ({
  videoUrl,
  words,
  outSec,
  pauseAtSec,
  pauseLengthSec,
  pauseKeepSec,
}) => {
  const { fps } = useVideoConfig();
  const tighten = pauseKeepSec !== null;
  const removed = tighten ? Math.max(0, pauseLengthSec - (pauseKeepSec as number)) : 0;

  // THE CUT, done honestly. Rather than speed-ramping or crossfading over the
  // pause, the clip is played in two pieces and the second one starts later in
  // the source. That is what a cut is. The audio moves with it because both
  // pieces come from the same file.
  const firstEnd = tighten ? pauseAtSec + (pauseKeepSec as number) : outSec;
  const firstFrames = Math.round(firstEnd * fps);
  const secondSourceStart = pauseAtSec + pauseLengthSec;
  const secondFrames = tighten ? Math.round((outSec - secondSourceStart) * fps) : 0;

  // Captions are on the timeline of the OUTPUT, so anything after the cut moves
  // earlier by exactly what was removed. Nothing is retimed by hand.
  const shifted = words.map((w) =>
    w.start >= secondSourceStart ? { ...w, start: w.start - removed, end: w.end - removed } : w,
  );

  return (
    <AbsoluteFill style={{ backgroundColor: GROUND }}>
      <Sequence durationInFrames={firstFrames}>
        <OffthreadVideo src={videoUrl} muted={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </Sequence>

      {tighten ? (
        <Sequence from={firstFrames} durationInFrames={secondFrames}>
          <OffthreadVideo
            src={videoUrl}
            startFrom={Math.round(secondSourceStart * fps)}
            muted={false}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        </Sequence>
      ) : null}

      <ProgressRule />
      <Captions words={shifted} />
    </AbsoluteFill>
  );
};

/** Exported so the render script and the tests agree on the arithmetic. */
export function outputSeconds(p: MantraReelProps): number {
  if (p.pauseKeepSec === null) return p.outSec;
  return p.outSec - (p.pauseLengthSec - p.pauseKeepSec);
}

void Audio;
void staticFile;
