/**
 * THE PHRASE ENGINE. Turns word timestamps into caption cards.
 *
 * This is the third attempt and the first one that works, so the two failures
 * are written down here rather than deleted, because both were caused by
 * believing a signal instead of measuring it.
 *
 * ATTEMPT 1 broke every four words and produced "about it and most", a
 * fragment spanning two clauses.
 *
 * ATTEMPT 2 broke on `gap_before`, Whisper's inter-word silence, on the
 * reasoning that a line should end where she breathed. It produced "and most"
 * and I called it a character-limit bug. It was not.
 *
 * WHAT IS ACTUALLY IN THE DATA. 62 of the 64 words in the reference clip have
 * `gap_before` of exactly 0.0. Of the two that do not, one is 0.04s, which is
 * nothing. There is exactly ONE usable gap in the entire recording.
 * The silence is not between the words, it is ABSORBED INTO THE END TIME of
 * the word before it: "that" runs 1.72 to 2.56, which is 0.84 seconds for four
 * letters. So attempt 2 had one usable break in the whole clip and the
 * character limit was silently doing all the rest of the work. The bug was that
 * the pause detector was measuring nothing and nobody noticed, because a break
 * still appeared.
 *
 * So the pause is recovered by subtraction: a word's duration minus the time
 * that many letters should take at her own measured speaking rate. What is left
 * over is the hold. See `holdAfter`.
 *
 * AND THEN THE SECOND FINDING, which is why "and most" happened at all. Nearly
 * every recovered hold in this recording sits on a FUNCTION WORD: "I", "that",
 * "of", "and", "these", "to". These are not clause endings. They are hesitation
 * pauses BEFORE a word she is reaching for. Breaking after them is the single
 * worst thing you can do, and it is exactly what a naive pause detector does.
 *
 * So a hold on a function word is re-attributed to the boundary BEFORE that
 * word. "and [0.30s] most of us" becomes a line that STARTS with "and", never
 * one that ends with it. See `edges`.
 *
 * Everything below is a hard constraint or a cost. The hard constraints return
 * null and the search cannot choose them at any price. That distinction matters:
 * the previous draft used a very large penalty instead, the search ran out of
 * legal options, picked the "impossible" one anyway, and printed "I do this."
 * as a violation. A large number is not a prohibition.
 */

export type Word = {
  w: string;
  start: number;
  end: number;
  gap_before: number;
};

export type Card = {
  /** The words of this card, in order. */
  words: Word[];
  /** Already wrapped. One or two entries, never three. */
  lines: string[];
  text: string;
  start: number;
  end: number;
  /**
   * Index within `words` of the word to emphasise, or null.
   *
   * NOT arbitrary, which was an explicit instruction. It is the word she
   * reached for: the one preceded by the longest recovered hold in the card.
   * A hesitation before a word is her own signal that the word matters. A word
   * named in the chosen hook wins over that.
   */
  stress: number | null;
};

/**
 * Words that may not END a line, because they oblige a continuation and
 * leaving one hanging is what makes a caption read as broken.
 *
 * Danna named and, but, because and the. The rest are the same grammatical
 * classes: determiners, prepositions, coordinators, auxiliaries, negated
 * auxiliaries, and subject pronouns. "and that's why I" is as bad as "and most".
 */
const HARD = new Set(
  `and but or nor because so that the a an of to in on for with at by from as
   if when while my your our their his her its this these those is are was were
   am be been being do does did will would can could should have has had about
   into than very just another i we you they he she
   don't doesn't didn't won't can't isn't aren't wasn't not no`
    .split(/\s+/)
    .filter(Boolean),
);

/**
 * Object pronouns. Legal to end on, but weak, so they carry a cost rather than
 * a ban. "feeling comfortable about it" is a real phrase and banning it would
 * push the break somewhere worse.
 */
const SOFT = new Set("it us them me him her".split(" "));

const bare = (s: string) => s.replace(/[^A-Za-z']/g, "").toLowerCase();
const endsSentence = (s: string) => /[.!?]$/.test(s);
const endsClause = (s: string) => /[,;:]$/.test(s);

/**
 * Her own speaking rate, in seconds per character, measured from this
 * recording rather than assumed.
 *
 * The median is taken over words of six letters or more. Long words are almost
 * never held — you cannot pause in the middle of "comfortable" — so they give a
 * clean read of the rate, while short words are exactly where the holds hide
 * and would poison the estimate.
 */
export function speechRate(words: Word[]): number {
  const rates = words
    .filter((x) => bare(x.w).length >= 6)
    .map((x) => (x.end - x.start) / bare(x.w).length)
    .sort((a, b) => a - b);
  if (!rates.length) return 0.055;
  const m = rates.length >> 1;
  return rates.length % 2 ? rates[m] : (rates[m - 1] + rates[m]) / 2;
}

/** The pause hiding inside a word's end time. Never negative. */
export function holdAfter(word: Word, rate: number): number {
  const chars = Math.max(1, bare(word.w).length);
  return Math.max(0, word.end - word.start - (0.04 + rate * chars));
}

/**
 * Boundary strength BEFORE each word. `edges[i]` is the break between i-1 and i,
 * so the array has one more entry than there are words.
 */
export function edges(words: Word[], rate: number): number[] {
  const n = words.length;
  const hold = words.map((x) => holdAfter(x, rate));
  const e = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) e[i] = words[i].gap_before + hold[i - 1];

  // A hold ON a function word is hesitation BEFORE it. Move the evidence back
  // one boundary, and take it away from the boundary it was wrongly crediting.
  for (let i = n - 1; i > 0; i--) {
    if (HARD.has(bare(words[i].w)) && hold[i] > 0.15) {
      e[i] += hold[i];
      e[i + 1] -= hold[i];
    }
  }
  return e.map((x) => Math.max(0, x));
}

export function wrapTo(text: string, width: number): string[] {
  const lines: string[][] = [[]];
  for (const word of text.split(" ")) {
    const cur = lines[lines.length - 1];
    if (cur.length && [...cur, word].join(" ").length > width) lines.push([]);
    lines[lines.length - 1].push(word);
  }
  return lines.map((l) => l.join(" "));
}

export type PhraseOpts = {
  /** Characters per line at the display size. Style-dependent. */
  width: number;
  /** Longest a single card may stay on screen. */
  maxSec: number;
  /** Words from the chosen hook. These win the emphasis. */
  hookWords?: string[];
};

const DEFAULTS = { width: 28, maxSec: 5.0 };

/**
 * The search. Every segmentation of the words into legal cards is considered
 * and the cheapest total is taken, so a good break late does not get blocked by
 * a greedy one early — which is how "and that's // why" survived a left-to-right
 * pass that could not see one word further ahead.
 */
export function toCards(words: Word[], opts: Partial<PhraseOpts> = {}): Card[] {
  const { width, maxSec } = { ...DEFAULTS, ...opts };
  const hook = new Set((opts.hookWords ?? []).map(bare).filter((x) => x.length > 3));
  const n = words.length;
  if (!n) return [];
  const rate = speechRate(words);
  const e = edges(words, rate);

  /** null means illegal at any price, which is different from expensive. */
  const cost = (a: number, b: number): number | null => {
    for (let k = a; k < b; k++) if (endsSentence(words[k].w)) return null;
    const text = words
      .slice(a, b + 1)
      .map((x) => x.w)
      .join(" ");
    const lines = wrapTo(text, width);
    if (lines.length > 2) return null;
    // A second line holding a single word is a widow. It is the first thing the
    // eye catches and it made "// tool" and "// why" out of good phrases.
    if (lines.length === 2 && lines[1].split(" ").length < 2) return null;
    const dur = words[b].end - words[a].start;
    if (dur > maxSec) return null;

    const last = b === n - 1;
    const w = bare(words[b].w);
    const sent = endsSentence(words[b].w);
    const clause = endsClause(words[b].w);
    // Punctuation outranks the function-word rule. "I do this." ends on "this"
    // and is a perfectly good card; the rule is about words left hanging.
    if (!last && !sent && !clause && HARD.has(w)) return null;

    let c = 0;
    if (lines.length === 2) c += Math.abs(lines[0].length - lines[1].length) * 0.08;
    if (!last && !sent && SOFT.has(w)) c += 2.0;
    const punct = sent ? 2.5 : clause ? 1.0 : 0;
    c -= punct * 3.0 + e[b + 1] * 4.5;
    // She neither paused nor punctuated here, so nothing in the recording says
    // this is a boundary. That is the definition of an arbitrary break.
    if (punct === 0 && e[b + 1] < 0.1 && !last) c += 3.2;
    if (text.length < 16) c += (16 - text.length) * 0.35;
    if (dur > 3.8) c += (dur - 3.8) * 2.0;
    if (dur < 1.0) c += (1.0 - dur) * 1.8;
    return c;
  };

  const INF = Infinity;
  const best = new Array<number>(n + 1).fill(INF);
  const back = new Array<number>(n + 1).fill(-1);
  best[0] = 0;
  for (let b = 0; b < n; b++) {
    for (let a = Math.max(0, b - 18); a <= b; a++) {
      if (best[a] === INF) continue;
      const c = cost(a, b);
      if (c === null) continue;
      if (best[a] + c < best[b + 1]) {
        best[b + 1] = best[a] + c;
        back[b + 1] = a;
      }
    }
  }
  if (best[n] === INF) {
    // Loudly, rather than falling back to a chunker that would look like it
    // worked. If this ever fires the constraints are wrong and we need to see it.
    throw new Error("phrase: no legal segmentation for these words");
  }

  const spans: [number, number][] = [];
  for (let i = n; i > 0; ) {
    const a = back[i];
    spans.push([a, i - 1]);
    i = a;
  }
  spans.reverse();

  return spans.map(([a, b]) => {
    const ws = words.slice(a, b + 1);
    const text = ws.map((x) => x.w).join(" ");
    let stress: number | null = null;
    const fromHook = ws.findIndex((x) => hook.has(bare(x.w)));
    if (fromHook >= 0) stress = fromHook;
    else {
      // THE WORD SHE REACHED FOR. Find the strongest boundary inside the card,
      // then take the first word carrying meaning at or after it.
      //
      // The hesitation sits BEFORE the word, not on it, so the emphasis is not
      // the word beside the pause but the word the pause was waiting for.
      // Looking only at words that themselves carry a hold finds almost nothing,
      // because nearly every hold here lands on "and", "of", "that", "these".
      //
      // TIES ARE BROKEN LATE, ON PURPOSE. In "and most of us don't have these
      // shoulders" the boundaries before "and" and before "these" both measure
      // 0.61 exactly. Strict `>` took the first and stressed "most"; `>=` takes
      // the last and stresses "shoulders". A tie broken by array order is a
      // coin flip, and emphasis landing by coin flip is the arbitrary highlight
      // this rule exists to prevent. The editorial rule is that a phrase builds
      // toward its point, so the later of two equal boundaries is the one she
      // was building to.
      let bestEdge = 0.2;
      let at = -1;
      for (let i = 0; i < ws.length; i++) {
        // The epsilon is not cosmetic. The two boundaries in the "shoulders"
        // card differ by about 1e-16 after the re-attribution arithmetic, so a
        // bare `>=` still resolved the tie by float noise rather than by rule.
        if (e[a + i] >= bestEdge - 1e-6) {
          bestEdge = e[a + i];
          at = i;
        }
      }
      if (at >= 0) {
        for (let i = at; i < ws.length; i++) {
          const key = bare(ws[i].w);
          if (HARD.has(key) || SOFT.has(key) || key.length < 4) continue;
          stress = i;
          break;
        }
      }
    }
    return { words: ws, lines: wrapTo(text, width), text, start: ws[0].start, end: ws[ws.length - 1].end, stress };
  });
}

/** Exported so the tests and the compositions agree on what is illegal. */
export const RULES = { HARD, SOFT, bare, endsSentence, endsClause };
