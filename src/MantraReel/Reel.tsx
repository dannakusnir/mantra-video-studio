/**
 * MANTRA REEL — one composition, three edits.
 *
 * The earlier version of this file produced two cuts that differed only in the
 * length of one silence. Danna's verdict was that they were "כמעט זהות בחוויה",
 * almost identical in experience, and she was right: a silence length is a
 * setting, not a creative decision.
 *
 * So the composition now takes a PACE, and a pace changes the in-point, the
 * caption style, the grade, the audio treatment and whether the frame ever
 * moves — all at once. See pace.ts.
 *
 * WHAT IT STILL REFUSES TO DO, and every one is a line from the brief:
 *
 *   no cut every second on a talking head
 *   no transitions without a reason
 *   no automatic zoom (Sharp Signal CUTS to a tighter frame; it never glides)
 *   no generic B-roll
 *   no music bed, no logo sting
 *   no changing her words
 *   hold the frame while the performance is good
 *
 * The only graphic is one hairline carrying real progress, and it earns its
 * place by being information rather than decoration.
 */

import React from "react";
import { AbsoluteFill, Audio, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { z } from "zod";
import { toCards, type Word } from "./phrase";
import { Captions, WIDTH, SAFE, type CaptionStyle } from "./Captions";
import { Look, type LookKey } from "./Look";
import { PACES, PAUSE_SEC, inPointFor, type PauseKey } from "./pace";
import { planSfx, sfxLibraryEntry, type SfxCue } from "./sfx";

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
  /** The one real silence, located in source seconds. */
  pauseAtSec: z.number(),
  pauseLengthSec: z.number(),

  /* ── THE SEVEN CHOICES. Each owns a different part of the render. ─────── */

  /**
   * THE HOOK, and it decides WHERE THE CUT STARTS.
   *
   * If this text is her own words, the video opens on them and her run-up is
   * dropped. If it was worded by an agent it has no position in the clip and
   * the cut starts at the beginning — see `inPointFor`, which returns 0 rather
   * than guessing, because placing an agent's sentence at an invented timestamp
   * is the fabrication the provenance rules exist to prevent.
   *
   * It also decides which word carries the caption emphasis.
   *
   * It is never drawn on screen as a title card: a hook the viewer reads before
   * she says it is a spoiler, and one she never says at all is a lie.
   */
  hookText: z.string().default(""),
  /** Carried through so the render props can be audited against the screen. */
  hookId: z.string().default(""),

  captions: z.enum(["editorial", "kinetic", "minimal"]).default("editorial"),
  /**
   * "source" means NO GRADE AT ALL — the video element is not wrapped in the
   * filter chain. It exists so a Look can be judged against the ungraded
   * original under identical captions, pace, pause and audio, which is the only
   * way to see what the grade is actually doing. It is a QA value; it is not
   * offered on the choice screen.
   *
   * Implemented here rather than as a fourth entry in LOOKS, so that adding an
   * ungraded reference does not require changing the colour pipeline itself.
   */
  look: z.enum(["source", "natural", "warm", "softCrisp"]).default("natural"),
  pace: z.enum(["quiet", "sharp", "human"]).default("quiet"),
  pause: z.enum(["keep", "tighten", "cut"]).default("keep"),
  audio: z.enum(["original", "clean", "studio"]).default("clean"),
  /**
   * WHERE ANY OF THE EIGHT ORIGINALS IN public/sfx/ REACH THE RENDER.
   * See sfx.ts for the placement map. "none" is a literal empty list, not a
   * quiet default that still ships an effect.
   */
  sfx: z.enum(["none", "subtle", "expressive"]).default("none"),

  /** Honours the viewer's reduced-motion preference. */
  reduceMotion: z.boolean().default(false),
});

export type MantraReelProps = z.infer<typeof mantraReelSchema>;

/* ── The look of the type, read off motion/theme.ts in the app, so the video
 *    and the product are the same object. Nothing here is a colour I liked. */
const INK = "#F0E6DA";
const GLOW = "#E0A75F";
const GROUND = "#17100D";

/** Where the three audio treatments live once tools/audio-levels.sh has run. */
const AUDIO_FILE = {
  original: null, // the video's own track, unmuted
  clean: "mantra/audio/clean.wav",
  studio: "mantra/audio/studio.wav",
} as const;

/**
 * The one hairline the boards put on every screen, and the only graphic here.
 * It rides the real progress of the clip, which is what earns it the place.
 * Kept inside the platform safe zone so no platform's chrome sits on it.
 */
const ProgressRule: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const p = frame / Math.max(1, durationInFrames - 1);
  const y = SAFE.top * 0.72;
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
};

/**
 * THE PLAN. Pure arithmetic, exported so the render script, the tests and the
 * composition all agree instead of each doing their own version of it.
 */
export function planOf(p: MantraReelProps) {
  const pace = PACES[p.pace];
  const captions: CaptionStyle = p.captions;
  const look = p.look;
  const audio = p.audio;

  // HOOK owns the in-point. PAUSE owns the silence. Neither touches the other.
  const inAt = inPointFor(p.words, p.hookText);
  const keep = PAUSE_SEC[p.pause as PauseKey];

  const tighten = keep !== null;
  const removed = tighten ? Math.max(0, p.pauseLengthSec - keep) : 0;
  const firstSourceEnd = tighten ? p.pauseAtSec + keep : p.outSec;
  const secondSourceStart = p.pauseAtSec + p.pauseLengthSec;

  /** Source seconds mapped onto the output timeline. */
  const remap = (s: number) => (s >= secondSourceStart ? s - inAt - removed : s - inAt);

  const words: Word[] = p.words
    .filter((w) => w.start >= inAt - 0.001)
    .map((w) => ({ ...w, start: remap(w.start), end: remap(w.end) }));

  const cards = toCards(words, { width: WIDTH[captions], hookWords: p.hookText.split(/\s+/) });
  const outputSec = p.outSec - inAt - removed;

  return {
    pace, captions, look, audio, keep, inAt, tighten, removed,
    firstSourceEnd, secondSourceStart, words, cards, outputSec,
  };
}

/**
 * One shot of the take.
 *
 * `scale` is a CUT to a tighter framing, not a glide. The brief bans automatic
 * zoom, so the value is constant for the whole shot and changes only where a
 * punch-in says it does.
 */
const Shot: React.FC<{ src: string; startFrom?: number; muted: boolean; scale: number }> = ({ src, startFrom, muted, scale }) => (
  <OffthreadVideo
    src={src}
    startFrom={startFrom}
    muted={muted}
    style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale})`, transformOrigin: "center 38%" }}
  />
);

/**
 * The colour pipeline, or deliberately none of it.
 *
 * `source` returns the children untouched. That is the control: if a graded
 * version and this one look the same, the grade is doing nothing, and there is
 * no way to discover that without an ungraded render made the same way.
 */
const Graded: React.FC<{ look: MantraReelProps["look"]; children: React.ReactNode }> = ({ look, children }) =>
  look === "source" ? <>{children}</> : <Look look={look as LookKey}>{children}</Look>;

/**
 * VOICE ALWAYS WINS.
 *
 * A cue whose onset falls while she is actively speaking — inside some
 * card's own [start, end], the same window the captions render from — is
 * ducked to half its planned volume. A cue that lands in an actual gap (the
 * one real silence, or before the first word / after the last) plays at its
 * full planned volume. "Is she speaking right now" is read off the real
 * transcript, not guessed.
 */
function duckFor(atSec: number, cards: { start: number; end: number }[]): number {
  const speaking = cards.some((c) => atSec >= c.start - 0.02 && atSec <= c.end + 0.02);
  return speaking ? 0.5 : 1;
}

/**
 * One SFX hit: staticFile() into Remotion's <Audio>, sized to the effect's
 * own declared duration, with a short linear fade at each end so a cue that
 * lands mid-cut never clicks.
 */
const SfxHit: React.FC<{ cue: SfxCue; duck: number; fps: number }> = ({ cue: c, duck, fps }) => {
  const entry = sfxLibraryEntry(c.id);
  const frames = Math.max(1, Math.round(entry.durationSec * fps));
  const from = Math.round(c.atSec * fps);
  const peak = c.volume * duck;
  const fadeIn = Math.min(3, frames);
  const fadeOut = Math.min(4, frames);
  return (
    <Sequence from={from} durationInFrames={frames}>
      <Audio
        src={staticFile(`sfx/${entry.id}.wav`)}
        volume={(f) => {
          const inRamp = fadeIn > 0 ? Math.min(1, f / fadeIn) : 1;
          const outRamp = fadeOut > 0 ? Math.min(1, (frames - 1 - f) / fadeOut) : 1;
          return peak * Math.max(0, Math.min(inRamp, outRamp));
        }}
      />
    </Sequence>
  );
};

export const MantraReel: React.FC<MantraReelProps> = (props) => {
  const { fps } = useVideoConfig();
  const plan = planOf(props);
  const { pace, tighten, inAt, firstSourceEnd, secondSourceStart, cards, captions, look, audio } = plan;

  const punches = pace.punchIns(cards);
  const audioFile = AUDIO_FILE[audio];

  /** See sfx.ts: this file decides no timing of its own, it only reads the
   * cards and punches already computed above. */
  const sfxCues = planSfx(props.sfx, cards, punches, cards[0]?.start ?? 0, plan.outputSec);

  /**
   * The punch-in is applied by SPLITTING the shot at the punch point, so the
   * framing changes on a cut rather than on an animated transform. That is the
   * difference between a punch-in and the automatic zoom the brief rules out.
   */
  const cuts: { fromSec: number; toSec: number; scale: number }[] = [];
  {
    const marks = [0, ...punches.map((x) => x.atSec)].filter((x, i, a) => a.indexOf(x) === i).sort((a, b) => a - b);
    for (let i = 0; i < marks.length; i++) {
      const from = marks[i];
      const to = i + 1 < marks.length ? marks[i + 1] : plan.outputSec;
      const p = punches.filter((x) => x.atSec <= from).sort((a, b) => b.atSec - a.atSec)[0];
      cuts.push({ fromSec: from, toSec: to, scale: p ? p.scale : 1 });
    }
  }

  /** Output second -> source second, the inverse of the remap in planOf. */
  const toSource = (out: number) => {
    const boundary = firstSourceEnd - inAt;
    return out < boundary ? out + inAt : out - boundary + secondSourceStart;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: GROUND }}>
      <Graded look={look}>
        {cuts.map((c, i) => {
          const fromF = Math.round(c.fromSec * fps);
          const frames = Math.max(1, Math.round((c.toSec - c.fromSec) * fps));
          // A cut that straddles the removed silence is split so each piece
          // reads from the right place in the source.
          const boundary = firstSourceEnd - inAt;
          const straddles = c.fromSec < boundary && c.toSec > boundary && tighten;
          if (!straddles) {
            return (
              <Sequence key={i} from={fromF} durationInFrames={frames}>
                <Shot src={props.videoUrl} startFrom={Math.round(toSource(c.fromSec) * fps)} muted={audioFile !== null} scale={c.scale} />
              </Sequence>
            );
          }
          const firstFrames = Math.max(1, Math.round((boundary - c.fromSec) * fps));
          return (
            <React.Fragment key={i}>
              <Sequence from={fromF} durationInFrames={firstFrames}>
                <Shot src={props.videoUrl} startFrom={Math.round(toSource(c.fromSec) * fps)} muted={audioFile !== null} scale={c.scale} />
              </Sequence>
              <Sequence from={fromF + firstFrames} durationInFrames={Math.max(1, frames - firstFrames)}>
                <Shot src={props.videoUrl} startFrom={Math.round(secondSourceStart * fps)} muted={audioFile !== null} scale={c.scale} />
              </Sequence>
            </React.Fragment>
          );
        })}
      </Graded>

      {/* The processed track, cut the same way the picture is, so a tightened
          pause removes the same span from both. */}
      {audioFile ? (
        <>
          <Sequence durationInFrames={Math.max(1, Math.round((firstSourceEnd - inAt) * fps))}>
            <Audio src={staticFile(audioFile)} startFrom={Math.round(inAt * fps)} />
          </Sequence>
          {tighten ? (
            <Sequence
              from={Math.round((firstSourceEnd - inAt) * fps)}
              durationInFrames={Math.max(1, Math.round((props.outSec - secondSourceStart) * fps))}
            >
              <Audio src={staticFile(audioFile)} startFrom={Math.round(secondSourceStart * fps)} />
            </Sequence>
          ) : null}
        </>
      ) : null}

      {sfxCues.map((c, i) => (
        <SfxHit key={i} cue={c} duck={duckFor(c.atSec, cards)} fps={fps} />
      ))}

      <ProgressRule />
      <Captions
        cards={cards}
        style={captions}
        ink={INK}
        glow={GLOW}
        reduceMotion={props.reduceMotion}
        lead={pace.captionLead}
        hang={pace.captionHang}
      />
    </AbsoluteFill>
  );
};

/** Exported so the render script and the tests agree on the arithmetic. */
export function outputSeconds(p: MantraReelProps): number {
  return planOf(p).outputSec;
}

void interpolate;
