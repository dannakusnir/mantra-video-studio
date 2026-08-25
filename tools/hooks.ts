/**
 * FIVE HOOKS FOR THE REFERENCE CLIP, AND THE PROOF FOR EACH ONE.
 *
 * Run: node --experimental-strip-types tools/hooks.ts
 *
 * The brief asks for five kinds before the edit is chosen, each carrying its
 * wording, its source in the transcript, whether it is spoken or worded by the
 * agent, why it might work, and four scores.
 *
 * THE ONE RULE THAT MATTERS MOST. A hook marked `spoken` must be findable in
 * what she actually said. This file does not take that on trust: `locate()`
 * searches the real transcript and a claim that cannot be found FAILS THE RUN.
 * An agent's tidy paraphrase presented as her own words is the single most
 * damaging thing this product could do, because the whole promise is that
 * nothing is invented.
 *
 * AND VIRALITY IS NEVER PROMISED. `retention` is a read on structure, not a
 * prediction, and `assertNoPromise` fails the run on any wording that claims
 * one. Nobody can promise a view count and saying so would be a lie told to a
 * paying user.
 */

import { readFileSync } from "node:fs";
import type { Word } from "../src/MantraReel/phrase.ts";

const words: Word[] = JSON.parse(readFileSync(new URL("../public/mantra/danna-01-words.json", import.meta.url), "utf8"));
const TRANSCRIPT = words.map((w) => w.w).join(" ");

export type Origin = "spoken" | "agent";
export type HookKind = "verbatim" | "curiosity" | "contrarian" | "tension" | "promise";

export type Hook = {
  kind: HookKind;
  text: string;
  origin: Origin;
  /** Filled in by locate() for spoken hooks. Never hand-written. */
  foundAt: { atSec: number; exact: string } | null;
  why: string;
  /** 0-5. Read on structure. NOT a prediction, and never presented as one. */
  retention: number;
  clarity: number;
  specificity: number;
  tension: number;
  /**
   * 0-5, and HIGH IS BAD. How far this wording travels from what she meant.
   * A verbatim quote is 0. A confident claim she never made is 5.
   */
  truthRisk: number;
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();

/**
 * Find a claimed quote inside what she actually said.
 *
 * Matches on normalised words so punctuation and casing do not defeat it, then
 * returns the ORIGINAL text at that position along with its timestamp, so the
 * app can show her exact wording rather than the normalised form.
 */
export function locate(quote: string): { atSec: number; exact: string } | null {
  const q = norm(quote).split(" ").filter(Boolean);
  if (q.length < 3) return null;
  const all = words.map((w) => norm(w.w));
  for (let i = 0; i + q.length <= all.length; i++) {
    let hit = true;
    for (let j = 0; j < q.length; j++) {
      if (all[i + j] !== q[j]) {
        hit = false;
        break;
      }
    }
    if (hit) {
      return {
        atSec: words[i].start,
        exact: words
          .slice(i, i + q.length)
          .map((w) => w.w)
          .join(" "),
      };
    }
  }
  return null;
}

/** Wording that claims a result nobody can promise. */
const PROMISES = [/\bgo(es)? viral\b/i, /\bwill blow up\b/i, /\bguarantee/i, /\bmillions of views\b/i, /\bviral\b/i];
export function assertNoPromise(text: string, where: string): void {
  for (const re of PROMISES) {
    if (re.test(text)) throw new Error(`${where} promises a result: "${text}"`);
  }
}

const HOOKS: Hook[] = [
  {
    kind: "verbatim",
    text: "I don't need another tool to edit content",
    origin: "spoken",
    foundAt: null,
    why: "Her own sentence, and it names the objection the viewer is already holding. Nothing has to be believed on the agent's word.",
    retention: 4,
    clarity: 5,
    specificity: 4,
    tension: 3,
    truthRisk: 0,
  },
  {
    kind: "tension",
    text: "most of us don't have these shoulders to support us",
    origin: "spoken",
    foundAt: null,
    why: "The emotional centre of the take, and the phrase engine independently marks 'shoulders' as the word she reached for. Spoken, so it costs nothing in trust.",
    retention: 4,
    clarity: 3,
    specificity: 3,
    tension: 5,
    truthRisk: 0,
  },
  {
    kind: "contrarian",
    text: "Another editing app was never the thing you were missing.",
    origin: "agent",
    foundAt: null,
    why: "Turns her claim outward at the viewer. Sharper than the verbatim, and the cost is that she never phrased it this way — so it is labelled.",
    retention: 4,
    clarity: 5,
    specificity: 3,
    tension: 4,
    truthRisk: 2,
  },
  {
    kind: "curiosity",
    text: "The reason your content stays in drafts has nothing to do with your editing.",
    origin: "agent",
    foundAt: null,
    why: "Opens a gap the rest of the clip closes. The risk is real: she never mentioned drafts, so this puts a specific situation in her mouth.",
    retention: 5,
    clarity: 4,
    specificity: 2,
    tension: 4,
    truthRisk: 3,
  },
  {
    kind: "promise",
    text: "Say it once. Leave with something worth posting.",
    origin: "agent",
    foundAt: null,
    why: "States what the product does rather than what she said, so it suits a first-time viewer who does not know her. Furthest from the take, and it is the product making a claim, not her.",
    retention: 3,
    clarity: 5,
    specificity: 4,
    tension: 2,
    truthRisk: 2,
  },
];

/* ── verification, not decoration ────────────────────────────────────────── */

let failed = 0;
for (const h of HOOKS) {
  assertNoPromise(h.text, `hook "${h.kind}"`);
  assertNoPromise(h.why, `rationale for "${h.kind}"`);
  if (h.origin === "spoken") {
    h.foundAt = locate(h.text);
    if (!h.foundAt) {
      console.log(`  FAIL  "${h.text}" is marked spoken but is NOT in the transcript`);
      failed++;
    }
  } else if (locate(h.text)) {
    // Not an error, but worth knowing: it would deserve the stronger label.
    console.log(`  NOTE  "${h.text}" is marked agent but IS findable verbatim`);
  }
}

// CONTROL. A sentence she never said, marked spoken, must be rejected — a
// checker that only ever passes proves nothing about the checker.
const control = locate("I have always wanted to build a video editor");
if (control !== null) {
  console.log("  FAIL  CONTROL: the locator matched a sentence she never said");
  failed++;
}
// CONTROL. And a real quote must still be found, so the locator is not simply
// returning null for everything.
if (locate("I just need something that will help me create content") === null) {
  console.log("  FAIL  CONTROL: the locator missed a quote that IS in the transcript");
  failed++;
}
// CONTROL. The promise gate must actually fire.
let fired = false;
try {
  assertNoPromise("this will go viral", "control");
} catch {
  fired = true;
}
if (!fired) {
  console.log("  FAIL  CONTROL: the virality gate did not fire on 'this will go viral'");
  failed++;
}

console.log(`\nTRANSCRIPT (${words.length} words, ${words[words.length - 1].end.toFixed(2)}s)\n  ${TRANSCRIPT}\n`);
console.log("FIVE HOOKS\n");
for (const h of HOOKS) {
  console.log(`  ${h.kind.toUpperCase()}  [${h.origin}]${h.foundAt ? ` @ ${h.foundAt.atSec.toFixed(2)}s` : ""}`);
  console.log(`    "${h.text}"`);
  if (h.foundAt) console.log(`    she said: "${h.foundAt.exact}"`);
  console.log(`    why: ${h.why}`);
  console.log(
    `    retention ${h.retention}/5  clarity ${h.clarity}/5  specificity ${h.specificity}/5  tension ${h.tension}/5  truth risk ${h.truthRisk}/5`,
  );
  console.log();
}
console.log(failed ? `${failed} FAILED` : "all hooks verified");
export { HOOKS };
process.exit(failed ? 1 : 0);
