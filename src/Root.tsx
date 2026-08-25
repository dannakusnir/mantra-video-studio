import { parseMedia } from "@remotion/media-parser";
import React from "react";
import { Composition, staticFile } from "remotion";
import { Audiogram } from "./Audiogram/Main";
import { audiogramSchema } from "./Audiogram/schema";
import { PodcastReel } from "./PodcastReel/Main";
import { AthenaFirstReel } from "./PodcastReel/AthenaFirst";
import { MontageReel } from "./PodcastReel/Montage";
import { KlapMinimal } from "./PodcastReel/KlapMinimal";
import { podcastReelSchema } from "./PodcastReel/schema";
import { z } from "zod";
import { MantraReel, mantraReelSchema, outputSeconds } from "./MantraReel/Reel";
import MANTRA_WORDS from "../public/mantra/danna-01-words.json";

/* The reference clip, measured rather than typed in. `pauseAtSec` is the end of
   "this." and `pauseLengthSec` is the one real gap in the whole recording. */
const MANTRA_OUT = 26.47;
const MANTRA_PAUSE_AT = 10.4;
const MANTRA_PAUSE_LEN = 1.94;
/**
 * THE HOOKS THAT REACH THE RENDER, and both are her own words.
 *
 * A spoken hook decides where the cut starts, so these two produce openings
 * 16.7 seconds apart from the same source file. That is the whole proof that
 * the hook node is wired rather than decorative.
 */
const HOOK_VERBATIM = "I don't need another tool to edit content";
const HOOK_TENSION = "most of us don't have these shoulders to support us";

/**
 * A, B and C DELIBERATELY SHARE ONE HOOK. Danna's instruction: comparing three
 * treatments while also changing the opening line would confound hook quality
 * with visual quality, and there would be no way to tell which one moved.
 */
const REEL_VERSIONS = [
  { id: "A-QuietAuthority", hookId: "verbatim", hookText: HOOK_VERBATIM,
    captions: "editorial", look: "warm",    pace: "quiet", pause: "keep",    audio: "clean" },
  { id: "B-SharpSignal",    hookId: "verbatim", hookText: HOOK_VERBATIM,
    captions: "kinetic",   look: "softCrisp", pace: "sharp", pause: "tighten", audio: "studio" },
  { id: "C-HumanStory",     hookId: "verbatim", hookText: HOOK_VERBATIM,
    captions: "minimal",   look: "natural", pace: "human", pause: "keep",    audio: "clean" },
  // D changes ONE field against A. If the opening moves, the hook is wired.
  { id: "D-StrongestHook",  hookId: "tension",  hookText: HOOK_TENSION,
    captions: "editorial", look: "warm",    pace: "quiet", pause: "keep",    audio: "clean" },
] as const;

/**
 * LOOK ISOLATION, 24 Aug, at Danna's instruction.
 *
 * Same source, same hook, same captions, same pace, same pause, same audio.
 * The ONLY thing that changes across these four is the colour treatment, and
 * one of them has no colour treatment at all.
 *
 * The reason this is a separate set rather than a reading of A/B/C: in A/B/C
 * the grade moves together with the captions, the tempo and the audio, so
 * nothing there can tell you whether a difference you can see is the grade. A
 * comparison where four things change at once measures none of them.
 */
const LOOK_VERSIONS = [
  { id: "L0-Source",  look: "source"  },
  { id: "L1-Natural", look: "natural" },
  { id: "L2-Warm",    look: "warm"    },
  { id: "L3-SoftCrisp", look: "softCrisp" },
] as const;

/**
 * THE SFX PACK'S ONLY WIRING TEST. See the comment where this is mapped, and
 * sfx.ts for what each level actually places.
 */
const SFX_SCENARIOS = [
  { id: "S1-Natural-Minimal-NoSFX",       look: "natural",   captions: "minimal",   sfx: "none" },
  { id: "S2-Warm-Editorial-Subtle",       look: "warm",      captions: "editorial", sfx: "subtle" },
  { id: "S3-SoftCrisp-Kinetic-Expressive", look: "softCrisp", captions: "kinetic",  sfx: "expressive" },
] as const;

const athenaFirstSchema = podcastReelSchema.extend({
  athenaImageUrl: z.string().optional(),
  audioUrl: z.string().optional(),
  orbPulseTimes: z.array(z.number()).default([]),
  particleBurstTimes: z.array(z.number()).default([]),
  yearsCounterAt: z.tuple([z.number(), z.number()]).optional(),
});

const montageSchema = podcastReelSchema.extend({
  segments: z.array(z.object({
    startSec: z.number(),
    endSec: z.number(),
    videoUrl: z.string(),
    scaleFrom: z.number().default(1),
    scaleTo: z.number().default(1.15),
    panX: z.number().default(0),
    panY: z.number().default(0),
  })).default([]),
  audioUrl: z.string().optional(),
  orbPulseTimes: z.array(z.number()).default([]),
  particleBurstTimes: z.array(z.number()).default([]),
  flashTimes: z.array(z.number()).default([]),
  yearsCounterAt: z.tuple([z.number(), z.number()]).optional(),
});
import { getSubtitles } from "./helpers/fetch-captions";
import { FPS } from "./helpers/ms-to-frame";

const REEL_FPS = 30;
const ACCENT = "#007A33"; // Howie green
const BG = "#000000";
const WHOOSH = staticFile("reels/whoosh.mp3");
const TICK = staticFile("reels/tick.mp3");
const LOGO = staticFile("reels/logo-white.png");
const BOOM = staticFile("reels/boom.mp3");
const BG_MUSIC = staticFile("reels/bg-ambient.mp3");

const loadCaptions = async (url: string) => {
  const res = await fetch(url);
  return res.json();
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="Audiogram"
        component={Audiogram}
        width={1080}
        height={1080}
        schema={audiogramSchema}
        defaultProps={{
          audioOffsetInSeconds: 0,
          audioFileUrl: staticFile("dialogue.wav"),
          coverImageUrl: staticFile("podcast-cover.jpeg"),
          titleText: "Ep 550 - Supper Club x Remotion React",
          titleColor: "rgba(186, 186, 186, 0.93)",
          captions: null,
          captionsFileName: staticFile("captions.json"),
          onlyDisplayCurrentSentence: true,
          captionsTextColor: "rgba(255, 255, 255, 0.93)",
          visualizer: {
            type: "oscilloscope",
            color: "#F4B941",
            numberOfSamples: "64" as const,
            windowInSeconds: 0.1,
            posterization: 3,
            amplitude: 4,
            padding: 50,
          },
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await getSubtitles(props.captionsFileName);
          const { slowDurationInSeconds } = await parseMedia({
            src: props.audioFileUrl,
            acknowledgeRemotionLicense: true,
            fields: { slowDurationInSeconds: true },
          });
          return {
            durationInFrames: Math.floor(
              (slowDurationInSeconds - props.audioOffsetInSeconds) * FPS
            ),
            props: { ...props, captions },
            fps: FPS,
          };
        }}
      />

      {/* VIRAL 1: Build + Howie Reaction - 26 sec */}
      <Composition
        id="Viral1-Build"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(26 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/VIRAL1-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/viral1-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "I STOPPED ASKING\nFOR PERMISSION", startSec: 0, endSec: 5, position: "top" as const, fontSize: 42 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* VIRAL 2: Marketing vs PR - 28 sec */}
      <Composition
        id="Viral2-PR"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(28 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/VIRAL2-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/viral2-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "MARKETING BUYS ATTENTION.\nPR EARNS TRUST.", startSec: 0, endSec: 5, position: "top" as const, fontSize: 40 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* VIRAL 3: Certainty + Magic - 27 sec */}
      <Composition
        id="Viral3-Magic"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(27 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/VIRAL3-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/viral3-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "STOP SOFTENING\nYOUR TRUTH", startSec: 0, endSec: 5, position: "top" as const, fontSize: 44 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* WENDY VIRAL 1: They Wait - 26 sec */}
      <Composition
        id="W-Viral1-Wait"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(26 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/W-VIRAL1-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/w-viral1-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "THEY WAIT\nUNTIL IT'S TOO LATE", startSec: 0, endSec: 5, position: "top" as const, fontSize: 44 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* WENDY VIRAL 2: North Star vs Technology - 28 sec */}
      <Composition
        id="W-Viral2-NorthStar"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(28 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/W-VIRAL2-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/w-viral2-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "THE TECHNOLOGY IS\nKILLING ME.\nBUT MY NORTH STAR ISN'T.", startSec: 0, endSec: 5, position: "top" as const, fontSize: 36 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* TINA-R1-ATHENA-SHORT v10: 38s core arc + Athena PIP + cleaned audio */}
      <Composition
        id="Tina-R1-Short"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(38 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/TINA-R1-ATHENA-SHORT-CLEAN.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/tina-r1-short-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: "#00FF88", bgColor: BG,
          athenaPipUrl: staticFile("reels/athena-animated.mp4"),
          athenaPipPosition: "top-right" as const,
          textOverlays: [
            { text: "\"YOU DIDN'T JUST\nLOSE A JOB.\"", startSec: 0.3, endSec: 5, position: "top" as const, fontSize: 48 },
            { text: "IT WAS A\nBETRAYAL.", startSec: 15, endSec: 20, position: "top" as const, fontSize: 62 },
            { text: "COURAGE\nMOST DON'T GET TESTED.", startSec: 30, endSec: 37.5, position: "top" as const, fontSize: 44 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* TINA-R1-V11: Re-encoded max quality + static Athena PNG + top-LEFT + no overlap + end fade */}
      <Composition
        id="Tina-R1-V11"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(38 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/TINA-R1-V11-CLEAN.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/tina-r1-short-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: "#00FF88", bgColor: BG,
          athenaPipUrl: staticFile("reels/athena-static.png"),
          athenaPipPosition: "top-left" as const,
          textOverlays: [
            { text: "\"YOU DIDN'T JUST\nLOSE A JOB.\"", startSec: 0.3, endSec: 5.5, position: "center" as const, fontSize: 52 },
            { text: "IT WAS A\nBETRAYAL.", startSec: 15, endSec: 20, position: "center" as const, fontSize: 68 },
            { text: "COURAGE\nMOST DON'T GET TESTED.", startSec: 30, endSec: 36, position: "center" as const, fontSize: 48 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* TINA-R1-ATHENA: Level 5 Listening → Betrayal of Contract - 56s (original v9) */}
      <Composition
        id="Tina-R1-Athena"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(56 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/TINA-R1-ATHENA-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/tina-r1-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: "#00FF88", bgColor: BG,
          textOverlays: [
            { text: "LEVEL 5\nLISTENING", startSec: 0.5, endSec: 4.5, position: "top" as const, fontSize: 62 },
            { text: "20 YEARS.\nONE 2-WEEK LETTER.", startSec: 10.5, endSec: 15.5, position: "top" as const, fontSize: 46 },
            { text: "THE BETRAYAL\nOF A CONTRACT", startSec: 22, endSec: 28, position: "top" as const, fontSize: 50 },
            { text: "COURAGE\nMOST DON'T GET TESTED", startSec: 40, endSec: 46, position: "top" as const, fontSize: 42 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* TINA-R1-ATHENA-FIRST v12: Athena illustration full-screen + Ken Burns + motion graphics */}
      <Composition
        id="Tina-R1-AthenaFirst"
        component={AthenaFirstReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(38 * REEL_FPS)}
        schema={athenaFirstSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: "", // unused for AthenaFirst
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/tina-r1-short-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: "#00FF88", bgColor: BG,
          athenaImageUrl: staticFile("reels/athena-static.png"),
          audioUrl: staticFile("reels/tina-r1-clean-audio.aac"),
          orbPulseTimes: [3, 17, 30],
          particleBurstTimes: [4.8, 17.8, 32.5],
          yearsCounterAt: [10, 15] as [number, number],
          textOverlays: [
            { text: "\"SHE DIDN'T\nLOSE A JOB.\"", startSec: 0.3, endSec: 5.5, position: "center" as const, fontSize: 62 },
            { text: "IT WAS A\nBETRAYAL.", startSec: 16, endSec: 20.5, position: "center" as const, fontSize: 78 },
            { text: "COURAGE\nMOST DON'T GET TESTED.", startSec: 30, endSec: 36.5, position: "center" as const, fontSize: 52 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />

      {/* v15 KLAP-MINIMAL: Klap plays throughout + 2 clean Athena PNG cutaways + logo. NO extra text/motion */}
      <Composition
        id="Tina-R1-KlapMinimal"
        component={KlapMinimal}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(31 * REEL_FPS)}
        defaultProps={{
          klapVideoUrl: staticFile("reels/KLAP-KIDS-BANKRUPTCY.mp4"),
          athenaImageUrl: staticFile("reels/athena-static.png"),
          logoUrl: LOGO,
          showLogo: true,
          athenaCutaways: [
            { startSec: 7, endSec: 10 },
            { startSec: 20, endSec: 23 },
          ],
        }}
      />

      {/* ROB REEL 1: M5 "I cause yes" HOOK — Rob CU + Athena overlay + KTV yellow captions + music */}
      <Composition
        id="Rob-R1-HOOK"
        component={KlapMinimal}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(55 * REEL_FPS)}
        defaultProps={{
          klapVideoUrl: staticFile("reels/ROB-M5-CAM4-9x16.mp4"),
          athenaImageUrl: staticFile("reels/athena-static.png"),
          logoUrl: LOGO,
          showLogo: true,
          athenaCutaways: [
            { startSec: 15, endSec: 30 },
          ],
          captions: [],
          captionAccent: "#FFEF00",
          tickUrl: TICK,
          bgMusicUrl: BG_MUSIC,
          musicVolume: 0.06,
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(staticFile("reels/reel_rob_m5-sentences.json"));
          return { props: { ...props, captions } };
        }}
      />

      {/* ROB REEL 2: M11 "mastery acceleration" — Rob CU + long Athena + KTV captions + music */}
      <Composition
        id="Rob-R2-MASTERY"
        component={KlapMinimal}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(55 * REEL_FPS)}
        defaultProps={{
          klapVideoUrl: staticFile("reels/ROB-M11-CAM4-9x16.mp4"),
          athenaImageUrl: staticFile("reels/athena-static.png"),
          logoUrl: LOGO,
          showLogo: true,
          athenaCutaways: [
            { startSec: 5, endSec: 42 },
          ],
          captions: [],
          captionAccent: "#FFEF00",
          tickUrl: TICK,
          bgMusicUrl: BG_MUSIC,
          musicVolume: 0.06,
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(staticFile("reels/reel_rob_m11-sentences.json"));
          return { props: { ...props, captions } };
        }}
      />

      {/* ROB REEL 3: M7 "PASSION" — Rob CU throughout + KTV captions + music */}
      <Composition
        id="Rob-R3-PASSION"
        component={KlapMinimal}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(60 * REEL_FPS)}
        defaultProps={{
          klapVideoUrl: staticFile("reels/ROB-M7-PASSION-9x16.mp4"),
          athenaImageUrl: staticFile("reels/athena-static.png"),
          logoUrl: LOGO,
          showLogo: true,
          athenaCutaways: [],
          captions: [],
          captionAccent: "#FFEF00",
          tickUrl: TICK,
          bgMusicUrl: BG_MUSIC,
          musicVolume: 0.06,
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(staticFile("reels/reel_rob_m7-sentences.json"));
          return { props: { ...props, captions } };
        }}
      />

      {/* v13 KLAP-ENHANCED: takes Klap output as base + Athena cutaway + motion graphics on top */}
      <Composition
        id="Tina-R1-KlapEnhanced"
        component={MontageReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(31 * REEL_FPS)}
        schema={montageSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: "",
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/tina-r1-short-captions.json"),
          captions: [], showLogo: true, logoEndDurationSec: 2,
          accentColor: "#00FF88", bgColor: BG,
          audioUrl: staticFile("reels/klap-audio.aac"),
          segments: [
            // 0-6s: Klap Tina (kids intro)
            { startSec: 0, endSec: 6, videoUrl: staticFile("reels/KLAP-KIDS-BANKRUPTCY.mp4"), scaleFrom: 1.0, scaleTo: 1.05 },
            // 6-9.5s: Athena cutaway (Danna's Athena card — "her AI cohost weighs in")
            { startSec: 6, endSec: 9.5, videoUrl: staticFile("reels/athena-anim-38s.mp4"), scaleFrom: 1.1, scaleTo: 1.2 },
            // 9.5-19s: Klap Tina (main story: bankruptcy realization)
            { startSec: 9.5, endSec: 19, videoUrl: staticFile("reels/KLAP-KIDS-BANKRUPTCY.mp4"), scaleFrom: 1.02, scaleTo: 1.08 },
            // 19-22s: Athena cutaway again at climax
            { startSec: 19, endSec: 22, videoUrl: staticFile("reels/athena-anim-38s.mp4"), scaleFrom: 1.15, scaleTo: 1.25 },
            // 22-31s: Klap Tina (resolution + look-forward)
            { startSec: 22, endSec: 31, videoUrl: staticFile("reels/KLAP-KIDS-BANKRUPTCY.mp4"), scaleFrom: 1.0, scaleTo: 1.1 },
          ],
          orbPulseTimes: [6.2, 19.2],
          particleBurstTimes: [10, 22],
          flashTimes: [6, 9.5, 19, 22],
          textOverlays: [
            // Hooks ONLY during Athena cutaways (6-9.5s and 19-22s) so no duplication with Klap's burned-in title
            { text: "LEVEL 5\nLISTENING", startSec: 6.3, endSec: 9.2, position: "center" as const, fontSize: 78 },
            { text: "SHE DIDN'T LOSE\nA JOB.\nSHE LOST HERSELF.", startSec: 19.3, endSec: 21.9, position: "center" as const, fontSize: 52 },
          ],
        }}
      />

      {/* WENDY VIRAL 3: Stop Waiting - 18 sec */}
      <Composition
        id="W-Viral3-StopWaiting"
        component={PodcastReel}
        width={1080}
        height={1920}
        fps={REEL_FPS}
        durationInFrames={Math.round(18 * REEL_FPS)}
        schema={podcastReelSchema}
        defaultProps={{
          athenaPipPosition: "top-right",
          videoFit: "cover",
          showLetterboxBrand: false,
          videoUrl: staticFile("reels/W-VIRAL3-RAW.mp4"),
          logoUrl: LOGO, boomUrl: BOOM, whooshUrl: WHOOSH, tickUrl: TICK, bgMusicUrl: BG_MUSIC,
          captionsUrl: staticFile("reels/w-viral3-captions.json"),
          captions: null, showLogo: true, logoEndDurationSec: 2,
          accentColor: ACCENT, bgColor: BG,
          textOverlays: [
            { text: "THINKING ABOUT IT\nVS. DOING IT", startSec: 0, endSec: 5, position: "top" as const, fontSize: 44 },
          ],
        }}
        calculateMetadata={async ({ props }) => {
          const captions = await loadCaptions(props.captionsUrl);
          return { props: { ...props, captions } };
        }}
      />
      {/* THE FOUR OUTPUTS, 24 Aug, to Danna's exact specification.
          A, B and C share ONE hook on purpose, so that any difference between
          them is the visual and timing treatment and not the strength of the
          opening line. D changes only the hook, which is what makes it the
          proof that the hook node reaches the render at all. */}
      {LOOK_VERSIONS.map((v) => {
        const base = {
          videoUrl: staticFile("mantra/danna-01-proxy.mp4"),
          words: MANTRA_WORDS,
          outSec: MANTRA_OUT,
          pauseAtSec: MANTRA_PAUSE_AT,
          pauseLengthSec: MANTRA_PAUSE_LEN,
          hookText: HOOK_VERBATIM,
          hookId: "verbatim",
          captions: "editorial",
          look: v.look,
          pace: "quiet",
          pause: "keep",
          // staticFile() is correct HERE, unlike in the product path: every
          // preview below renders the AUGUST clip itself, so pairing it with
          // the August clip's own processed tracks is the right pairing, not
          // the defect AUDIO_CONTRACT.md describes.
          audio: { kind: "clean", url: staticFile("mantra/audio/clean.wav") },
          sfx: "none",
          // The four V1 fields, all at the value the schema itself defaults
          // to — required here only because TS's inferred output type (after
          // zod defaults apply) is non-optional; every render below is
          // therefore unchanged from before these fields existed.
          captionScale: 1,
          captionPos: "low",
          lookIntensity: 1,
          sfxToggles: {},
          reduceMotion: false,
        } as const;
        return (
          <Composition
            key={v.id}
            id={v.id}
            component={MantraReel}
            width={1080}
            height={1920}
            fps={30}
            durationInFrames={Math.max(1, Math.round(outputSeconds(base) * 30))}
            schema={mantraReelSchema}
            defaultProps={base}
          />
        );
      })}

      {REEL_VERSIONS.map((v) => {
        const base = {
          videoUrl: staticFile("mantra/danna-01-proxy.mp4"),
          words: MANTRA_WORDS,
          outSec: MANTRA_OUT,
          pauseAtSec: MANTRA_PAUSE_AT,
          pauseLengthSec: MANTRA_PAUSE_LEN,
          hookText: v.hookText,
          hookId: v.hookId,
          captions: v.captions,
          look: v.look,
          pace: v.pace,
          pause: v.pause,
          audio: v.audio === "clean"
            ? { kind: "clean" as const, url: staticFile("mantra/audio/clean.wav") }
            : { kind: "studio" as const, url: staticFile("mantra/audio/studio.wav") },
          sfx: "none",
          captionScale: 1,
          captionPos: "low",
          lookIntensity: 1,
          sfxToggles: {},
          reduceMotion: false,
        } as const;
        return (
          <Composition
            key={v.id}
            id={v.id}
            component={MantraReel}
            width={1080}
            height={1920}
            fps={30}
            durationInFrames={Math.max(1, Math.round(outputSeconds(base) * 30))}
            schema={mantraReelSchema}
            defaultProps={base}
          />
        );
      })}

      {/* THE THREE SFX SCENARIOS, 25 Aug, at Danna's exact specification.
          S1/S2/S3 change ONLY look, captions and sfx. Hook, pace, pause and
          audio are held identical across all three on purpose: a
          side-by-side that also changed the cut points or the tempo would
          confound "does the SFX pack read as a level" with "does the edit
          read differently", and there would be no way to tell which one
          moved. `pace: "sharp"` was picked (not "quiet") because it is the
          only pace that produces a real punch-in — without one, "subtle"
          and "expressive" would have no deliberate cut to hang a sound on,
          only the hook and the close. See sfx.ts for how each level turns
          that one real cut, the hook, and her own stressed words into a
          placement list. */}
      {SFX_SCENARIOS.map((v) => {
        const base = {
          videoUrl: staticFile("mantra/danna-01-proxy.mp4"),
          words: MANTRA_WORDS,
          outSec: MANTRA_OUT,
          pauseAtSec: MANTRA_PAUSE_AT,
          pauseLengthSec: MANTRA_PAUSE_LEN,
          hookText: HOOK_VERBATIM,
          hookId: "verbatim",
          captions: v.captions,
          look: v.look,
          pace: "sharp",
          pause: "keep",
          audio: { kind: "clean", url: staticFile("mantra/audio/clean.wav") },
          sfx: v.sfx,
          captionScale: 1,
          captionPos: "low",
          lookIntensity: 1,
          sfxToggles: {},
          reduceMotion: false,
        } as const;
        return (
          <Composition
            key={v.id}
            id={v.id}
            component={MantraReel}
            width={1080}
            height={1920}
            fps={30}
            durationInFrames={Math.max(1, Math.round(outputSeconds(base) * 30))}
            schema={mantraReelSchema}
            defaultProps={base}
          />
        );
      })}
    </>
  );
};
