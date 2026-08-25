/**
 * THREE CAPTION STYLES, all standing on the same phrase engine.
 *
 * The engine in phrase.ts decides WHERE the words break and WHICH word carries
 * the weight. These three decide how that arrives on screen. That split is the
 * point: a style cannot invent a break, so no style can reintroduce "and most".
 *
 * WHAT NONE OF THEM DO, and each is a line from the brief:
 *   no bounce, no elastic, no spring overshoot
 *   no per-word colour cycling
 *   no box, no plate, no "Captions" template look
 *   no karaoke wipe
 *   nothing that would read as a preset someone downloaded
 *
 * SAFE ZONES ARE REAL NUMBERS, not a guessed margin. See SAFE below.
 */

import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Card } from "./phrase";

export type CaptionStyle = "editorial" | "kinetic" | "minimal";
export type CaptionPos = "low" | "mid";

/**
 * The union of the three platforms' overlays on a 1080x1920 frame, in pixels.
 *
 * TikTok is the worst case at the bottom: the account handle, the caption text
 * and the sound row stack up to roughly 400px, and the like/comment/share rail
 * eats the right edge. Instagram Reels is a little shallower, YouTube Shorts
 * shallower still. Taking the union means one layout is safe on all three
 * rather than three layouts that each fail somewhere.
 *
 * Anything inside these margins is at risk of being covered by the platform.
 */
export const SAFE = { top: 200, bottom: 420, side: 120 } as const;

const FAMILY = {
  editorial: "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
  kinetic: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
  minimal: "'Helvetica Neue', Helvetica, Inter, system-ui, sans-serif",
} as const;

/** Line width in characters, per style. Feeds the phrase engine. */
export const WIDTH: Record<CaptionStyle, number> = {
  editorial: 28,
  kinetic: 22,
  minimal: 34,
};

/**
 * Legibility over a moving face WITHOUT a box.
 *
 * A box is a panel carrying no information, which the brief rules out. Her
 * shirt is cream, her hands cross the frame and there is embroidery behind her,
 * so a single soft shadow is not enough. Two tight shadows carry the edge and
 * one wide one separates the type from whatever is behind it.
 */
const SHADOW = "0 1px 2px rgba(0,0,0,0.95), 0 2px 6px rgba(0,0,0,0.9), 0 6px 30px rgba(0,0,0,0.7)";

/**
 * THE SECOND SAFE-ZONE ANCHOR.
 *
 * "low" is the anchor every style already used: paddingBottom of exactly
 * SAFE.bottom, flush against the platform-chrome exclusion band. "mid" is a
 * genuinely different anchor, not a nudge on the same one — it centers the
 * caption block in the vertical band BETWEEN SAFE.top and SAFE.bottom, so it
 * clears both exclusion zones on all three platforms regardless of canvas
 * height, computed from the real frame height rather than a hardcoded 1920.
 */
export function posPaddingBottom(pos: CaptionPos, height: number): number {
  if (pos === "low") return SAFE.bottom;
  return (height - SAFE.top + SAFE.bottom) / 2;
}

export type CaptionProps = {
  cards: Card[];
  style: CaptionStyle;
  ink: string;
  glow: string;
  /** Honours the viewer's reduced-motion preference: everything still reads, nothing moves. */
  reduceMotion?: boolean;
  /**
   * How early a card appears before its first word, and how long it stays after
   * its last. Owned by the PACE, not by the style: this is the felt tempo, and
   * it is the part of the timeline the pace changes that a still frame cannot
   * show. Quiet holds 0.42s, Sharp lets go at 0.10s.
   */
  lead: number;
  hang: number;
  /**
   * Multiplier on this style's own type scale (its authored fontSize), 0.75
   * to 1.4. 1 reproduces today's exact sizes — 60 / 68 / 48 for Editorial,
   * Kinetic and Minimal respectively.
   */
  scale: number;
  /** Which safe-zone anchor the caption block sits on. See posPaddingBottom. */
  pos: CaptionPos;
};

/** The card on screen at time t. Lead and hang come from the pace. */
function activeCard(cards: Card[], t: number, lead: number, hang: number): Card | undefined {
  return cards.find((c) => t >= c.start - lead && t <= c.end + hang);
}

/**
 * EDITORIAL. The card arrives whole, on a short rise, and holds.
 *
 * The stressed word is the only thing on screen in the accent colour, and it is
 * the word she reached for rather than a word a template picked. Set in a serif
 * because the pace it belongs to is Quiet Authority and a serif reads as
 * something written rather than something generated.
 */
const Editorial: React.FC<CaptionProps> = ({ cards, ink, glow, reduceMotion, lead, hang, scale, pos }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const card = activeCard(cards, t, lead, hang);
  if (!card) return null;

  const age = t - (card.start - lead);
  const opacity = reduceMotion ? 1 : interpolate(age, [0, 0.16], [0, 1], { extrapolateRight: "clamp" });
  const rise = reduceMotion ? 0 : interpolate(age, [0, 0.34], [14, 0], { extrapolateRight: "clamp" });

  let idx = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: posPaddingBottom(pos, height) }}>
      <div
        style={{
          opacity,
          transform: `translateY(${rise}px)`,
          maxWidth: 1080 - SAFE.side * 2,
          textAlign: "center",
          fontFamily: FAMILY.editorial,
          fontSize: 60 * scale,
          lineHeight: 1.24,
          letterSpacing: -0.4,
          color: ink,
          textShadow: SHADOW,
        }}
      >
        {card.lines.map((line, li) => (
          <div key={li}>
            {line.split(" ").map((word) => {
              const stressed = idx === card.stress;
              idx++;
              return (
                <span
                  key={idx}
                  style={{
                    // EMPHASIS READS THROUGH BRIGHTNESS, NOT HUE. The accent is
                    // a warm gold and the Warm Editorial grade makes the whole
                    // frame warm, so a gold word on a gold frame disappeared
                    // entirely in the first render. Dimming everything else is
                    // the only emphasis that survives every grade.
                    opacity: card.stress === null ? 1 : stressed ? 1 : 0.7,
                    borderBottom: stressed ? `2px solid ${glow}` : undefined,
                    paddingBottom: stressed ? 2 : undefined,
                  }}
                >
                  {word}{" "}
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ height: height * 0 }} />
    </AbsoluteFill>
  );
};

/**
 * KINETIC. Words land on their own timestamps.
 *
 * The brief asks for kinetic but not shouty, so the movement is a 10px rise and
 * an opacity ramp over 120ms per word and nothing else. No scale pop, because a
 * scale pop is what makes a caption look like a template. Words already spoken
 * stay at full strength rather than dimming: dimming turns the line into a
 * karaoke bar and the eye starts tracking the highlight instead of reading.
 *
 * The stressed word carries weight and the accent, so the emphasis survives even
 * though every word is moving.
 */
const Kinetic: React.FC<CaptionProps> = ({ cards, ink, glow, reduceMotion, lead, hang, scale, pos }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const card = activeCard(cards, t, lead, hang);
  if (!card) return null;

  let idx = 0;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: posPaddingBottom(pos, height) }}>
      <div
        style={{
          maxWidth: 1080 - SAFE.side * 2,
          textAlign: "center",
          fontFamily: FAMILY.kinetic,
          fontSize: 68 * scale,
          fontWeight: 600,
          lineHeight: 1.16,
          letterSpacing: -1.2,
          color: ink,
          textShadow: SHADOW,
        }}
      >
        {card.lines.map((line, li) => (
          <div key={li}>
            {line.split(" ").map((word) => {
              const w = card.words[idx];
              const stressed = idx === card.stress;
              idx++;
              const since = w ? t - w.start : 1;
              const o = reduceMotion ? 1 : interpolate(since, [0, 0.12], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              const y = reduceMotion ? 0 : interpolate(since, [0, 0.18], [10, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
              return (
                <span
                  key={idx}
                  style={{
                    display: "inline-block",
                    transform: `translateY(${y}px)`,
                    // Same reasoning as Editorial: on a warm grade a gold word
                    // vanishes, so the emphasis is carried by weight and by
                    // dimming its neighbours. The accent stays as a second
                    // signal rather than the only one.
                    color: ink,
                    fontWeight: stressed ? 800 : 600,
                    filter: stressed ? `drop-shadow(0 0 14px ${glow})` : undefined,
                    opacity: (card.stress === null || stressed ? 1 : 0.7) * o,
                  }}
                >
                  {word}
                  {" "}
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/**
 * MINIMAL. Small, low, quiet, and no emphasis at all.
 *
 * This is the style for footage that is already carrying the moment. It exists
 * so that "no captions competing with her face" is a choice she can make,
 * rather than something she has to ask for. Wider lines and a smaller size mean
 * fewer cards and less movement in the lower third.
 */
const Minimal: React.FC<CaptionProps> = ({ cards, ink, reduceMotion, lead, hang, scale, pos }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const card = activeCard(cards, t, lead, hang);
  if (!card) return null;
  const age = t - (card.start - lead);
  const opacity = (reduceMotion ? 1 : interpolate(age, [0, 0.2], [0, 1], { extrapolateRight: "clamp" }));

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: posPaddingBottom(pos, height) }}>
      <div
        style={{
          opacity,
          maxWidth: 1080 - SAFE.side * 2,
          textAlign: "center",
          fontFamily: FAMILY.minimal,
          // 40 was too small to read on a phone: quiet is a design intent, but
          // a caption nobody can read is not quiet, it is broken. Checked on the
          // rendered still rather than in the editor.
          fontSize: 48 * scale,
          fontWeight: 500,
          lineHeight: 1.3,
          letterSpacing: -0.2,
          color: ink,
          textShadow: "0 1px 2px rgba(0,0,0,0.9), 0 4px 18px rgba(0,0,0,0.6)",
        }}
      >
        {card.lines.map((line, li) => (
          <div key={li}>{line}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Record, so adding a style without writing it is a build error. */
const RENDERERS: Record<CaptionStyle, React.FC<CaptionProps>> = {
  editorial: Editorial,
  kinetic: Kinetic,
  minimal: Minimal,
};

export const Captions: React.FC<CaptionProps> = (props) => {
  const R = RENDERERS[props.style];
  return <R {...props} />;
};
