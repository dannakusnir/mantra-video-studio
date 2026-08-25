/**
 * SFX PLACEMENT MAP.
 *
 * This file makes no sound. It decides WHERE one of the eight originals in
 * public/sfx/library.json belongs, using the timing the rest of the pipeline
 * already computed: the cards phrase.ts built (with the word she reached for
 * marked on each one, `Card.stress`), the cut points pace.ts already decided
 * are deliberate (`PunchIn[]`), and the second the cut opens on (the hook).
 *
 * It reads `recommendedPlacement` off the library to choose which effect fits
 * which moment. It does not invent a second mapping alongside it.
 *
 * THE THREE LEVELS:
 *   none       — a literal empty array. Zero effects reach the render.
 *   subtle     — 2 to 4 hits on a ~25s video, tied to real cut points. Never
 *                one per caption.
 *   expressive — 5 to 8, adding more of her own stressed words, spread across
 *                the clip rather than stacked. Still never every card.
 */

import type { Card } from "./phrase";
import type { PunchIn } from "./pace";
import LIBRARY_JSON from "../../public/sfx/library.json";

export type SfxLevel = "none" | "subtle" | "expressive";

export type SfxCue = {
  id: string;
  atSec: number;
  volume: number;
};

export type SfxLibraryEntry = {
  id: string;
  displayName: string;
  category: string;
  durationSec: number;
  defaultVolume: number;
  recommendedPlacement: string;
};

const LIBRARY = LIBRARY_JSON as SfxLibraryEntry[];

/** Looked up by Reel.tsx to size and label the <Audio> for a cue. */
export function sfxLibraryEntry(id: string): SfxLibraryEntry {
  const e = LIBRARY.find((x) => x.id === id);
  if (!e) throw new Error(`sfx.ts: unknown SFX id "${id}" — not in public/sfx/library.json`);
  return e;
}

/** Every library entry recommended for a given moment, in file order. */
function forPlacement(placement: string): SfxLibraryEntry[] {
  const matches = LIBRARY.filter((e) => e.recommendedPlacement === placement);
  if (matches.length === 0) {
    throw new Error(`sfx.ts: no entry in public/sfx/library.json has recommendedPlacement "${placement}"`);
  }
  return matches;
}

/** Round-robins a placement's entries so repeats don't reuse the same sound. */
function pick(placement: string, index: number): SfxLibraryEntry {
  const matches = forPlacement(placement);
  return matches[index % matches.length];
}

function cue(entry: SfxLibraryEntry, atSec: number, gain: number): SfxCue {
  return { id: entry.id, atSec: Math.max(0, atSec), volume: entry.defaultVolume * gain };
}

/** The because-text pace.ts writes for a punch that opens a new thought,
 * versus one that lands on emphasis. Read off the reason, not position, so
 * this keeps working if a pace ever produces punches in a different order. */
const REVEAL_PUNCH = /second thought|reveal/i;

/**
 * THE MAP ITSELF.
 *
 * `cards` and `punches` are the exact objects Reel.tsx already computed for
 * this render (`plan.cards`, `pace.punchIns(cards)`) — this file adds no
 * timing of its own, it only reads theirs. `hookAtSec` is where the hook's
 * own words start on the output timeline (in practice `cards[0]?.start`,
 * since the hook is what the cut opens on).
 */
export function planSfx(
  level: SfxLevel,
  cards: Card[],
  punches: PunchIn[],
  hookAtSec: number,
  outputSec: number
): SfxCue[] {
  if (level === "none" || cards.length === 0) return [];

  const used = new Set<number>(); // card indices already spent on a cue
  const cardIndexAt = (atSec: number) => cards.findIndex((c) => Math.abs(c.start - atSec) < 0.01);

  const cues: SfxCue[] = [];
  let revealIdx = 0;
  let emphasisIdx = 0;

  // THE HOOK — the claim she opens on. First cue, if there's a hook at all.
  cues.push(cue(pick("hook", 0), hookAtSec, 0.8));
  const hookCard = cardIndexAt(hookAtSec);
  if (hookCard >= 0) used.add(hookCard);

  // THE DELIBERATE CUTS — pace.ts decided these, this file only reads them.
  // A cut that opens a new thought reads as a reveal; one that lands on the
  // clip's emphasis reads as keywordEmphasis.
  for (const p of punches) {
    const idx = cardIndexAt(p.atSec);
    if (idx >= 0 && used.has(idx)) continue;
    if (REVEAL_PUNCH.test(p.because)) {
      cues.push(cue(pick("reveal", revealIdx++), p.atSec, 0.75));
    } else {
      cues.push(cue(pick("keywordEmphasis", emphasisIdx++), p.atSec, 0.65));
    }
    if (idx >= 0) used.add(idx);
  }

  if (level === "subtle") {
    // A closing accent, so even a light pass has a beginning and an end
    // instead of trailing off. By construction this is hook + up to
    // len(punches) + ending — real cut points, never a beat per caption.
    if (outputSec > 3) cues.push(cue(pick("ending", 0), outputSec - 0.5, 0.55));
    if (cues.length < 2) {
      const spare = cards.find((c, i) => !used.has(i) && c.stress !== null);
      if (spare) cues.push(cue(pick("keywordEmphasis", emphasisIdx++), spare.start, 0.55));
    }
    return finish(cues, 4);
  }

  // EXPRESSIVE — a CTA accent near the close, then more of the words she
  // actually reached for (Card.stress), spread across what's left rather
  // than taken in a row.
  const nearEnd = cards.filter((c, i) => !used.has(i) && c.start >= outputSec * 0.66);
  const ctaCard = nearEnd[nearEnd.length - 1];
  if (ctaCard) {
    cues.push(cue(pick("cta", 0), ctaCard.start, 0.7));
    used.add(cards.indexOf(ctaCard));
  }
  if (outputSec > 3) cues.push(cue(pick("ending", 0), outputSec - 0.5, 0.55));

  const remaining = cards
    .map((c, i) => ({ c, i }))
    .filter(({ c, i }) => !used.has(i) && c.stress !== null);
  const capacity = Math.max(0, 8 - cues.length); // room left before the upper bound
  const need = Math.max(0, 5 - cues.length); // extras required to clear the lower bound
  const wantExtra = Math.min(remaining.length, capacity, Math.max(need, 3));
  const step = wantExtra > 1 ? (remaining.length - 1) / (wantExtra - 1) : 0;
  for (let k = 0; k < wantExtra; k++) {
    const at = wantExtra === 1 ? 0 : Math.round(k * step);
    const { c } = remaining[Math.min(at, remaining.length - 1)];
    cues.push(cue(pick("keywordEmphasis", emphasisIdx++), c.start, 0.55));
  }

  return finish(cues, 8);
}

/** Sorted by time, with anything landing inside 0.15s of the previous cue
 * dropped rather than left to phase against it, then trimmed to `max` by
 * removing from the middle first — the opening and the close are the two
 * beats most worth keeping. */
function finish(cues: SfxCue[], max: number): SfxCue[] {
  const sorted = [...cues].sort((a, b) => a.atSec - b.atSec);
  const deduped: SfxCue[] = [];
  for (const c of sorted) {
    if (deduped.length && c.atSec - deduped[deduped.length - 1].atSec < 0.15) continue;
    deduped.push(c);
  }
  while (deduped.length > max) {
    deduped.splice(Math.floor(deduped.length / 2), 1);
  }
  return deduped;
}
