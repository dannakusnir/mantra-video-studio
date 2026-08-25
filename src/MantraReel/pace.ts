/**
 * THE SIX CHOICES, AND WHAT EACH ONE OWNS IN THE RENDER.
 *
 * Rewritten 24 Aug. The earlier version bundled everything into three presets,
 * which meant a user could not change the pause without changing the grade, and
 * the pace was silently also deciding where the video started.
 *
 * Danna's requirement is that every one of the six nodes changes the output, so
 * each one now owns a DIFFERENT part of the render and no two overlap:
 *
 *   HOOK      where the cut starts, and which word carries the emphasis
 *   CAPTIONS  typography, phrase grouping, animation, emphasis treatment
 *   LOOK      the colour pipeline on the video itself
 *   PACE      punch-ins, and how long a caption leads and hangs
 *   PAUSE     how much of the real 1.94s silence survives
 *   AUDIO     which processed track is used
 *
 * The overlap that had to be broken: the old Sharp Signal preset set its own
 * in-point. If the pace decides where the video starts AND the hook decides
 * where the video starts, then changing the hook does nothing whenever a pace is
 * also selected, and the hook node would be decorative. The hook owns it now.
 */

import type { Card, Word } from "./phrase";

export type PaceKey = "quiet" | "sharp" | "human";
export type PauseKey = "keep" | "tighten" | "cut";
export type AudioLevel = "original" | "clean" | "studio";

export type PunchIn = {
  /** Output-timeline seconds where the tighter framing cuts in. */
  atSec: number;
  /** 1.10 is a visible cut. Past 1.2 the crop starts eating her hands. */
  scale: number;
  /** Written down so a reviewer can argue with the reason, not the number. */
  because: string;
};

export type Pace = {
  key: PaceKey;
  name: string;
  intent: string;
  /** How early a caption appears before its first word, in seconds. */
  captionLead: number;
  /** How long it stays after its last word. This is the felt tempo. */
  captionHang: number;
  /** Empty means the frame never moves, which is itself a decision. */
  punchIns: (cards: Card[]) => PunchIn[];
  /**
   * A soft accent on the cut. OFF in all three and deliberately: the only
   * percussion in this repo belongs to another client's project, and borrowing
   * one client's sound design for Danna's reel is the same move as generic
   * B-roll. The field exists so the choice is visible when a sound belongs here.
   */
  soundAccent: false;
};

/** The card that opens the second thought, after the longest gap. */
const afterSilence = (cards: Card[]): Card | undefined => {
  let biggest = 0;
  let found: Card | undefined;
  for (let i = 1; i < cards.length; i++) {
    const gap = cards[i].start - cards[i - 1].end;
    if (gap > biggest) {
      biggest = gap;
      found = cards[i];
    }
  }
  return biggest > 0.5 ? found : undefined;
};

/** The card carrying the emphasis the clip turns on. */
const peak = (cards: Card[]): Card | undefined =>
  cards.find((c) => c.stress !== null && /shoulder/i.test(c.words[c.stress].w));

export const PACES: Record<PaceKey, Pace> = {
  quiet: {
    key: "quiet",
    name: "Quiet Authority",
    intent: "Held frame, unhurried, and a caption that stays long enough to be read twice.",
    captionLead: 0.1,
    captionHang: 0.42,
    punchIns: () => [],
    soundAccent: false,
  },
  sharp: {
    key: "sharp",
    name: "Sharp Signal",
    intent: "Captions land late and leave early. The frame restates itself twice, and only twice.",
    captionLead: 0.02,
    captionHang: 0.1,
    punchIns: (cards) => {
      const out: PunchIn[] = [];
      const back = afterSilence(cards);
      if (back) out.push({ atSec: back.start, scale: 1.1, because: "the second thought starts here, so the frame restates" });
      const p = peak(cards);
      if (p) out.push({ atSec: p.start, scale: 1.16, because: "the emphasis of the whole clip lands on this card" });
      return out;
    },
    soundAccent: false,
  },
  human: {
    key: "human",
    name: "Human Story",
    intent: "More breath. The caption arrives before she speaks and lingers after, so her face is never rushed.",
    captionLead: 0.18,
    captionHang: 0.55,
    punchIns: () => [],
    soundAccent: false,
  },
};

/**
 * WHAT SURVIVES OF THE ONE REAL SILENCE, in seconds.
 *
 * null keeps every frame. A number holds that many seconds and cuts the rest,
 * which is a real cut: picture and sound jump together. `cut` is 0, which
 * removes the silence entirely and is audible as a hard join.
 */
export const PAUSE_SEC: Record<PauseKey, number | null> = {
  keep: null,
  tighten: 0.25,
  cut: 0,
};

export const PAUSE_NAME: Record<PauseKey, string> = {
  keep: "Keep",
  tighten: "Tighten",
  cut: "Cut",
};

/**
 * WHERE THE CUT STARTS, decided by the hook.
 *
 * A hook that is her own words starts the video ON those words. That is the
 * whole point of choosing a hook: a viewer deciding in the first second gets the
 * claim rather than the run-up to it. It removes her approach; it does not alter
 * a word she said.
 *
 * A hook worded by an agent has no position in the clip, so the cut starts at
 * the beginning. Returning 0 rather than guessing is deliberate: putting an
 * agent's sentence at an invented timestamp would be exactly the fabrication the
 * provenance rules exist to prevent.
 */
export function inPointFor(words: Word[], hookText: string): number {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
  const q = norm(hookText).split(" ").filter(Boolean);
  if (q.length < 3) return 0;
  const all = words.map((w) => norm(w.w));
  for (let i = 0; i + q.length <= all.length; i++) {
    let hit = true;
    for (let j = 0; j < q.length; j++) {
      if (all[i + j] !== q[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return words[i].start;
  }
  return 0;
}

export const PACE_LIST = Object.values(PACES);
