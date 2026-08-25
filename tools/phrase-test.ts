/**
 * The phrase engine, checked against the real recording.
 *
 * Run: node --experimental-strip-types tools/phrase-test.ts
 *
 * THE CONTROLS MATTER MORE THAN THE ASSERTIONS. Every rule here is paired with
 * a case that must FAIL, because a rule that accepts everything passes its own
 * test happily. The `width` control is the sharpest one: squeeze the line width
 * far enough and no legal segmentation exists, so the engine must throw. If it
 * quietly returned cards at width 6, the constraints would be decorative.
 */

import { readFileSync } from "node:fs";
import { toCards, wrapTo, RULES, speechRate, holdAfter, edges, type Word } from "../src/MantraReel/phrase.ts";

const words: Word[] = JSON.parse(readFileSync(new URL("../public/mantra/danna-01-words.json", import.meta.url), "utf8"));

let pass = 0;
const fails: string[] = [];
const ok = (name: string, cond: boolean, extra = "") => {
  if (cond) pass++;
  else fails.push(`${name}${extra ? ` — ${extra}` : ""}`);
};

/* ── what the data actually is ───────────────────────────────────────────── */

// Stated exactly, because the first draft of this line said "one" and the test
// caught it: two words carry any gap at all, and one of those is 0.04s.
const anyGap = words.filter((w) => w.gap_before > 0).length;
const realGap = words.filter((w) => w.gap_before > 0.1).length;
ok("only two words carry any gap_before at all", anyGap === 2, `found ${anyGap}`);
ok("and only ONE of those is a usable pause", realGap === 1, `found ${realGap}`);
ok(
  "so gap_before alone cannot break 64 words into cards",
  realGap < 5,
  "if this ever fails, the recovered-hold machinery may no longer be needed",
);

const rate = speechRate(words);
ok("measured speaking rate is plausible for speech", rate > 0.03 && rate < 0.09, `${rate.toFixed(4)} s/char`);

// The hold really is hiding in the end times: "that" at index 4 runs 0.84s.
const held = holdAfter(words[4], rate);
ok("a short word carrying a long duration yields a recovered hold", held > 0.4, `${held.toFixed(2)}s on "${words[4].w}"`);
// CONTROL: a normal-length word should yield almost nothing.
const notHeld = Math.max(...words.filter((w) => RULES.bare(w.w).length >= 8).map((w) => holdAfter(w, rate)));
ok("CONTROL: long unhurried words do not produce phantom holds", notHeld < 0.35, `max ${notHeld.toFixed(2)}s`);

/* ── the re-attribution ──────────────────────────────────────────────────── */

const e = edges(words, rate);
const andIdx = words.findIndex((w, i) => RULES.bare(w.w) === "and" && i > 40);
ok("found the 'and' that produced the original bug", andIdx > 0);
ok(
  "its hold is credited to the boundary BEFORE it, not after",
  e[andIdx] > e[andIdx + 1],
  `before=${e[andIdx].toFixed(2)} after=${e[andIdx + 1].toFixed(2)}`,
);
ok("the one real silence is the strongest boundary in the clip", Math.max(...e) === e[words.findIndex((w) => w.gap_before > 1)]);

/* ── the cards ───────────────────────────────────────────────────────────── */

const cards = toCards(words);
ok("produces cards", cards.length > 4 && cards.length < 20, `${cards.length}`);

const rejoined = cards.flatMap((c) => c.words.map((w) => w.w)).join(" ");
const original = words.map((w) => w.w).join(" ");
ok("HER WORDS ARE UNCHANGED — nothing added, dropped or rewritten", rejoined === original);

for (const c of cards) {
  const last = c.words[c.words.length - 1].w;
  const isLast = c === cards[cards.length - 1];
  const bareLast = RULES.bare(last);
  ok(
    `"${c.text.slice(0, 34)}" does not end on a bare function word`,
    isLast || RULES.endsSentence(last) || RULES.endsClause(last) || !RULES.HARD.has(bareLast),
    `ends on "${last}"`,
  );
  ok(`"${c.text.slice(0, 34)}" is at most two lines`, c.lines.length <= 2, `${c.lines.length} lines`);
  ok(
    `"${c.text.slice(0, 34)}" has no widow`,
    c.lines.length < 2 || c.lines[1].split(" ").length >= 2,
    `second line: "${c.lines[1]}"`,
  );
}

for (const c of cards) {
  const inner = c.words.slice(0, -1).some((w) => RULES.endsSentence(w.w));
  ok(`"${c.text.slice(0, 34)}" does not straddle a sentence end`, !inner);
}

// The named regression, by name.
ok("the 'and most' fragment is gone", !cards.some((c) => /\band most$/.test(c.text)));
ok("the 'about it and most' fragment is gone", !cards.some((c) => c.text.includes("about it and most")));
// And its cousins, which the earlier drafts also produced.
for (const bad of ["and that's why I", "do this. I think", "another", "why"]) {
  ok(`no card ends on "${bad}"`, !cards.slice(0, -1).some((c) => c.text === bad || c.text.endsWith(` ${bad}`)) || RULES.endsSentence(bad));
}

// The card carrying the line the reel is built on must land ON the silence.
const silenceAt = words.find((w) => w.gap_before > 1)!.start;
const before = cards.find((c) => Math.abs(c.end - (silenceAt - words.find((w) => w.gap_before > 1)!.gap_before)) < 0.3);
ok("a card ends exactly where the 1.94s silence begins", !!before, before ? `"${before.text}"` : "none");

/* ── emphasis is earned, not random ──────────────────────────────────────── */

for (const c of cards) {
  if (c.stress === null) continue;
  const word = RULES.bare(c.words[c.stress].w);
  ok(`emphasis "${word}" is not a function word`, !RULES.HARD.has(word) && !RULES.SOFT.has(word));
}
// The tie-break, pinned. These two boundaries measure equal to 1e-16 and the
// rule is "the later one wins", not "whichever the loop saw first".
const shoulderCard = cards.find((c) => c.text.includes("shoulders"))!;
ok(
  "a tied boundary stresses the LATER word, not the earlier one",
  shoulderCard.stress !== null && RULES.bare(shoulderCard.words[shoulderCard.stress].w) === "shoulders",
  shoulderCard.stress === null ? "no stress" : `got "${shoulderCard.words[shoulderCard.stress].w}"`,
);

const hooked = toCards(words, { hookWords: ["shoulders", "support"] });
const stressedWords = hooked.flatMap((c) => (c.stress === null ? [] : [RULES.bare(c.words[c.stress].w)]));
ok("a word named in the hook wins the emphasis", stressedWords.includes("shoulders"), stressedWords.join(","));
// CONTROL: a hook word that is not in the transcript must change nothing.
const ghost = toCards(words, { hookWords: ["kubernetes"] });
ok(
  "CONTROL: a hook word she never said changes no emphasis",
  JSON.stringify(ghost.map((c) => c.stress)) === JSON.stringify(cards.map((c) => c.stress)),
);

/* ── controls on the constraints themselves ──────────────────────────────── */

let threw = false;
try {
  toCards(words, { width: 6 });
} catch {
  threw = true;
}
ok("CONTROL: impossible constraints throw instead of silently degrading", threw);

ok("CONTROL: wrapTo really does wrap", wrapTo("one two three four five six", 10).length > 1);
ok("CONTROL: wrapTo leaves a short line alone", wrapTo("one two", 40).length === 1);

// EVERY style width, not just the default. The three caption styles use
// different widths, so a rule that only holds at 28 would let "and most" back in
// through Kinetic. This checks the actual constraint at each width, not just
// that cards came out.
for (const width of [22, 26, 28, 34]) {
  const c = toCards(words, { width });
  ok(`width ${width} yields cards`, c.length > 3, `${c.length} cards`);
  ok(`width ${width}: never more than two lines`, c.every((x) => x.lines.length <= 2));
  ok(`width ${width}: no widow line`, c.every((x) => x.lines.length < 2 || x.lines[1].split(" ").length >= 2));
  ok(
    `width ${width}: no card ends on a bare function word`,
    c.slice(0, -1).every((x) => {
      const last = x.words[x.words.length - 1].w;
      return RULES.endsSentence(last) || RULES.endsClause(last) || !RULES.HARD.has(RULES.bare(last));
    }),
    c.slice(0, -1).filter((x) => RULES.HARD.has(RULES.bare(x.words[x.words.length - 1].w))).map((x) => x.text).join(" | "),
  );
  ok(`width ${width}: no card straddles a sentence end`, c.every((x) => !x.words.slice(0, -1).some((y) => RULES.endsSentence(y.w))));
}

/* ── report ──────────────────────────────────────────────────────────────── */

console.log("\nCARDS AT WIDTH 28\n");
for (const c of cards) {
  console.log(
    `  ${c.start.toFixed(2).padStart(5)}-${c.end.toFixed(2).padStart(5)}  ` +
      c.lines.join("  //  ") +
      (c.stress !== null ? `   [${c.words[c.stress].w}]` : ""),
  );
}
console.log();
for (const f of fails) console.log(`  FAIL  ${f}`);
console.log(`\n${pass} passed, ${fails.length} failed`);
process.exit(fails.length ? 1 : 0);
