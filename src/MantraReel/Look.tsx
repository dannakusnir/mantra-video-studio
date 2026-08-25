// MANTRA REEL — a real color-finishing pipeline, not a CSS filter() preset.
//
// Remotion renders through Chrome, so an SVG <filter> applied to the actual
// <video> element runs on the decoded frame with the real filter primitives:
//
//   feComponentTransfer(type="linear")  -> exposure + white balance (a
//     per-channel gain, which is what both of those physically are)
//   feComponentTransfer(type="table")   -> the tone curve: contrast,
//     highlight recovery (a soft knee that caps the curve's own ceiling
//     below 1.0, so nothing upstream can be pushed to a literal 255 by this
//     stage) and shadow control (lift/crush + a per-channel split-tone
//     concentrated in the blacks), built by buildChannelTable() below
//   feColorMatrix(type="matrix")        -> skin-tone protection. Blends the
//     red channel toward luma BEFORE saturation is applied, so an
//     R-dominant (skin) pixel starts saturation with less chroma than a
//     neutral pixel and ends up with proportionally less saturation gain.
//     Read the note on `skinToneProtection` below — this is a structural
//     brake on "skin goes orange," not true hue-selective masking.
//   feColorMatrix(type="saturate")      -> global saturation
//   feGaussianBlur + feComposite(arithmetic) -> local clarity and
//     controlled sharpening, both unsharp masks (blur a copy, then ADD BACK
//     the difference between it and the original, weighted by `strength`).
//     The blurred copy is never itself the output — only the difference is
//     used — so the net effect of both stages is always more contrast, not
//     less. `mildDenoise` uses the same primitive (feGaussianBlur) but is
//     wired to 0 (identity, per the SVG spec) in every look: any nonzero
//     blur here would be exactly the skin-smoothing the brief forbids, so
//     the field exists but does no work until someone deliberately changes
//     that one number for a genuinely noisy source.
//
// color-interpolation-filters is forced to sRGB on the <filter> itself.
// Its browser default is linearRGB, which would silently convert every
// value here into scene-linear light before the math above ran — breaking
// the assumption (throughout this file) that a table/matrix input of 0..1
// is the encoded pixel value.
//
// HONEST LIMITATION, measured, not assumed: the R-luma-blend matrix above
// is NOT enough on its own to hold skin-hue saturation at or below the
// source. I measured this directly — isolate pixels in the skin-ish hue
// band (H 5-40° in HSV, S>8%, V>15%, the same band a colorist would call
// "skin") and average their HSV saturation. Turning up `rLumaBlend` alone
// barely moved that number; the only lever that reliably brought it back
// to/under the source's own skin-hue saturation was pulling the *global*
// `saturation.value` down, in `warm` and `crisp`, below 1.0 — i.e. a blunt,
// whole-image instrument, not a hue-selective one. `feColorMatrix` and
// `feComponentTransfer` genuinely cannot do true per-hue selectivity
// without an external mask; there is no primitive here that only touches
// "orange-ish" pixels. So: skin-tone protection in this file is real (the
// R-luma blend does measurably reduce how much a red-dominant pixel gains
// from a saturation push) but it is not sufficient by itself, and the
// safety margin actually comes from keeping global saturation restrained.

import React from "react";

export type LookKey = "natural" | "warm" | "softCrisp";

export interface ChannelGain {
  r: number;
  g: number;
  b: number;
}

export interface ShadowTint {
  r: number;
  g: number;
  b: number;
}

export interface LookDef {
  key: LookKey;
  label: string;
  description: string;
  /** Multiplicative gain in stops, applied before white balance's own gain. */
  exposure: { stops: number };
  /** Per-channel gain. 1 = no correction. */
  whiteBalance: ChannelGain;
  /** S-curve steepness for the tone curve. 0 = literally linear (identity). */
  contrastCurve: { strength: number };
  /**
   * Soft-knee compression above `kneeStart` (0..1 of input range) toward a
   * ceiling of `1 - headroom`. This is what stops highlights from burning:
   * the curve's own maximum output is capped below 1.0 regardless of how
   * hot the input got from exposure.
   */
  highlightRecovery: { headroom: number; kneeStart: number };
  /**
   * `lift` opens (positive) or crushes (negative) the blacks, tapering to
   * zero by the time the curve reaches white. `tint` is a per-channel
   * offset concentrated in the shadows only (falls off with distance from
   * black squared) — a split-tone, independent of the global white balance.
   */
  shadowControl: { lift: number; tint: ShadowTint };
  /**
   * `saturationCeiling` documents the saturate() value this look actually
   * uses (see `saturation` below — kept as its own field so the ceiling is
   * legible without cross-referencing). `rLumaBlend` is the 0..1 weight of
   * the R-toward-luma protection matrix: how much of a pixel's red channel
   * is replaced with its luma value before saturation runs.
   */
  skinToneProtection: { saturationCeiling: number; rLumaBlend: number };
  /** feGaussianBlur stdDeviation. 0 in every look today — see file header. */
  mildDenoise: { blurStdDeviation: number };
  /** Small-radius unsharp mask: edge sharpening. */
  controlledSharpening: { radius: number; strength: number };
  /** Larger-radius unsharp mask: local/midtone contrast ("clarity"). */
  localClarity: { radius: number; strength: number };
  /** feColorMatrix type="saturate" value. 1 = no change. */
  saturation: { value: number };
}

export const LOOKS: Record<LookKey, LookDef> = {
  natural: {
    key: "natural",
    label: "Natural Clean",
    description:
      "Exposure and white balance correction only. Reality on a good day — the most restrained of the three.",
    exposure: { stops: 0.15 },
    whiteBalance: { r: 0.99, g: 1.0, b: 1.02 },
    contrastCurve: { strength: 0 },
    highlightRecovery: { headroom: 0.035, kneeStart: 0.85 },
    shadowControl: { lift: 0, tint: { r: 0, g: 0, b: 0 } },
    skinToneProtection: { saturationCeiling: 1.0, rLumaBlend: 0 },
    mildDenoise: { blurStdDeviation: 0 },
    controlledSharpening: { radius: 0.6, strength: 0 },
    localClarity: { radius: 3, strength: 0 },
    saturation: { value: 1.0 },
  },
  warm: {
    key: "warm",
    label: "Warm Editorial",
    description:
      "Warmth lives in the shadows only, as a split-tone on the tone curve. Highlights stay neutral (no global white-balance push, no global saturation push) so the white in frame stays white. Soft tone curve, restrained global saturation.",
    exposure: { stops: 0.06 },
    whiteBalance: { r: 1.0, g: 1.0, b: 1.0 },
    contrastCurve: { strength: 0.22 },
    highlightRecovery: { headroom: 0.05, kneeStart: 0.8 },
    // The warmth: an R-up/B-down split-tone weighted toward the shadows by
    // buildChannelTable's (1-x)^2 falloff, so it is essentially gone by the
    // upper-midtones and zero at the whites. This is the ONLY source of
    // warmth in this look — whiteBalance above is neutral on purpose.
    shadowControl: { lift: 0.08, tint: { r: 0.07, g: 0.012, b: -0.06 } },
    skinToneProtection: { saturationCeiling: 0.74, rLumaBlend: 0.16 },
    mildDenoise: { blurStdDeviation: 0 },
    controlledSharpening: { radius: 0.8, strength: 0.08 },
    localClarity: { radius: 5, strength: 0.07 },
    // Below neutral, not above it. Measured against a real skin-hue-band
    // saturation probe (H 5-40°, see the QA note in the file header): at
    // 1.0+ saturate() the warmth in the shadow split-tone alone was enough
    // to push that band's saturation past the source's own. The shadow
    // warmth here is deliberately carried by shadowControl.tint, not by
    // this stage — see the honest limitation note below.
    saturation: { value: 0.74 },
  },
  softCrisp: {
    key: "softCrisp",
    label: "Soft Crisp",
    description:
      "Definition without crushed blacks. Crispness here is edge micro-contrast (clarity + a small-radius unsharp mask), not black depth: the tone curve is steeper than Warm Editorial but its toe is LIFTED, not pulled down, so shadow detail survives the grade.",
    exposure: { stops: 0.05 },
    whiteBalance: { r: 1.0, g: 1.0, b: 1.0 },
    // 0.34 sits between Warm (0.22) and the withdrawn Crisp Contrast (0.46).
    // The reason it can carry more contrast than Warm without crushing is the
    // POSITIVE lift below, not a gentler curve.
    contrastCurve: { strength: 0.34 },
    // More headroom than the withdrawn look had (0.045), because clarity and
    // sharpening run AFTER the tone curve and both push highlights up: the
    // curve's own ceiling has to leave them somewhere to go.
    highlightRecovery: { headroom: 0.055, kneeStart: 0.78 },
    // THE WHOLE POINT OF THIS LOOK. The withdrawn Crisp Contrast used
    // lift: -0.1, and that single number is what failed: at strength 0.46 the
    // S-curve already mapped source code 16 to 0, and the negative lift put
    // everything below code 24 at literal black. Measured on the finished
    // MP4: 1.13 percentage points MORE pixels at Y<=8 than the source, against
    // a 0.05pp limit, with 1.10% of pixels that had detail in the source
    // arriving at 0-8. Lift is positive here and never goes negative.
    // Cool split-tone, so this reads as the opposite of Warm's shadows.
    shadowControl: { lift: 0.08, tint: { r: -0.012, g: 0, b: 0.012 } },
    // Both numbers are less aggressive than the withdrawn look's (0.72 / 0.4).
    // They can be, because a gentler curve produces less per-channel
    // separation to compensate for in the first place.
    skinToneProtection: { saturationCeiling: 0.86, rLumaBlend: 0.22 },
    mildDenoise: { blurStdDeviation: 0 },
    // Down from 0.22 / 0.16. A small-radius unsharp mask does not distinguish
    // an edge from skin grain, so past a point it amplifies pores rather than
    // resolving detail. These are set below that point deliberately.
    controlledSharpening: { radius: 0.5, strength: 0.15 },
    localClarity: { radius: 3.5, strength: 0.12 },
    saturation: { value: 0.86 },
  },
};

/**
 * IDENTITY, in the same units as LookDef's own magnitude fields — the values
 * at which every SVG primitive below is a mathematical no-op:
 *   feComponentTransfer(linear, slope 1)      -> exposure/white-balance gain
 *   the tone curve with contrastCurve 0, headroom 0, kneeStart 1, lift 0,
 *     tint 0                                  -> buildChannelTable() returns
 *                                                 the bare identity ramp y=x
 *   feColorMatrix skin-protection at weight 0 -> rr=1, rg=0, rb=0 (identity)
 *   feColorMatrix saturate(1)                 -> identity
 *   feComposite arithmetic with gain 1, diff 0 -> k2=1,k3=0, output = input
 * `intensityOf` below lerps every look toward exactly this at t=0, so
 * `lookIntensity: 0` renders through the SAME filter graph as a full look —
 * not a separate "skip the filter" branch — and still comes out identical to
 * an ungraded frame because the math is provably an identity, not because
 * the two code paths happen to agree.
 */
const IDENTITY_MAGNITUDE = {
  exposureStops: 0,
  whiteBalance: 1,
  contrastCurveStrength: 0,
  highlightHeadroom: 0,
  highlightKneeStart: 1,
  shadowLift: 0,
  shadowTint: 0,
  rLumaBlend: 0,
  sharpenStrength: 0,
  clarityStrength: 0,
  saturation: 1,
} as const;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Interpolates a look's MAGNITUDE fields between "no grade at all" (t=0) and
 * the look's own authored values (t=1). Spatial extents (blur radii) are
 * left at the look's own value at every t: a radius paired with strength 0
 * is already a no-op regardless of its number (see feComposite above), so
 * interpolating it would change nothing about the rendered pixels and would
 * only make the identity case harder to read.
 */
export function intensityOf(def: LookDef, t: number): LookDef {
  const c = Math.min(1, Math.max(0, t));
  return {
    ...def,
    exposure: { stops: lerp(IDENTITY_MAGNITUDE.exposureStops, def.exposure.stops, c) },
    whiteBalance: {
      r: lerp(IDENTITY_MAGNITUDE.whiteBalance, def.whiteBalance.r, c),
      g: lerp(IDENTITY_MAGNITUDE.whiteBalance, def.whiteBalance.g, c),
      b: lerp(IDENTITY_MAGNITUDE.whiteBalance, def.whiteBalance.b, c),
    },
    contrastCurve: { strength: lerp(IDENTITY_MAGNITUDE.contrastCurveStrength, def.contrastCurve.strength, c) },
    highlightRecovery: {
      headroom: lerp(IDENTITY_MAGNITUDE.highlightHeadroom, def.highlightRecovery.headroom, c),
      kneeStart: lerp(IDENTITY_MAGNITUDE.highlightKneeStart, def.highlightRecovery.kneeStart, c),
    },
    shadowControl: {
      lift: lerp(IDENTITY_MAGNITUDE.shadowLift, def.shadowControl.lift, c),
      tint: {
        r: lerp(IDENTITY_MAGNITUDE.shadowTint, def.shadowControl.tint.r, c),
        g: lerp(IDENTITY_MAGNITUDE.shadowTint, def.shadowControl.tint.g, c),
        b: lerp(IDENTITY_MAGNITUDE.shadowTint, def.shadowControl.tint.b, c),
      },
    },
    skinToneProtection: {
      // saturationCeiling is documentation only (see the field's own comment
      // above) — it is never read by the filter build below, so it is passed
      // through unscaled rather than interpolated toward a meaningless target.
      saturationCeiling: def.skinToneProtection.saturationCeiling,
      rLumaBlend: lerp(IDENTITY_MAGNITUDE.rLumaBlend, def.skinToneProtection.rLumaBlend, c),
    },
    controlledSharpening: {
      radius: def.controlledSharpening.radius,
      strength: lerp(IDENTITY_MAGNITUDE.sharpenStrength, def.controlledSharpening.strength, c),
    },
    localClarity: {
      radius: def.localClarity.radius,
      strength: lerp(IDENTITY_MAGNITUDE.clarityStrength, def.localClarity.strength, c),
    },
    saturation: { value: lerp(IDENTITY_MAGNITUDE.saturation, def.saturation.value, c) },
  };
}

const CURVE_POINTS = 17;

/**
 * Builds one channel's feComponentTransfer table: a linear ramp reshaped by
 * an S-curve (contrast), a shadow lift/crush, a per-channel shadow tint,
 * and a highlight-recovery knee, in that order. Clamped to [0, 1].
 */
function buildChannelTable(
  contrastStrength: number,
  headroom: number,
  kneeStart: number,
  shadowLift: number,
  shadowTint: number,
): number[] {
  const table: number[] = [];
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = i / (CURVE_POINTS - 1);
    let y = x;
    if (contrastStrength > 0) {
      const k = 1 + contrastStrength * 3;
      const norm = Math.tanh(0.5 * k);
      y = 0.5 + (Math.tanh((x - 0.5) * k) / norm) * 0.5;
    }
    y += shadowLift * (1 - x) * 0.35;
    y += shadowTint * (1 - x) * (1 - x);
    if (x > kneeStart) {
      const t = (x - kneeStart) / (1 - kneeStart);
      const smooth = t * t * (3 - 2 * t);
      const ceiling = 1 - headroom;
      y = y + (ceiling - y) * smooth;
    }
    table.push(Math.min(1, Math.max(0, y)));
  }
  return table;
}

/** Exposure (stops) and white balance are both a channel gain, combined here
 *  into the single feComponentTransfer(type="linear") that applies them. */
function combinedGain(def: LookDef): ChannelGain {
  const stopGain = Math.pow(2, def.exposure.stops);
  return {
    r: stopGain * def.whiteBalance.r,
    g: stopGain * def.whiteBalance.g,
    b: stopGain * def.whiteBalance.b,
  };
}

/**
 * A 4x5 feColorMatrix that blends the red channel toward luma by `weight`.
 * Row sums to 1, so a neutral (R=G=B) pixel is unaffected — only a pixel
 * whose red channel departs from its own luma (which skin, being
 * R-dominant, does) has its red pulled back toward neutral before
 * saturation runs.
 */
function skinProtectionMatrix(weight: number): string {
  const rr = 1 - weight + weight * 0.299;
  const rg = weight * 0.587;
  const rb = weight * 0.114;
  return [rr, rg, rb, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0].join(
    " ",
  );
}

export const Look: React.FC<{ look: LookKey; children: React.ReactNode; intensity?: number }> = ({
  look,
  children,
  intensity = 1,
}) => {
  // At intensity 1 this is the look's own authored def, unchanged — lerp(a,b,1)
  // is exactly b in floating point (a + (b-a)*1 === b), but skipping the call
  // entirely removes any doubt for the case every existing render still uses.
  const def = intensity >= 1 ? LOOKS[look] : intensityOf(LOOKS[look], intensity);
  const reactId = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `mantra-look-${look}-${reactId}`;

  const gain = combinedGain(def);
  const rTable = buildChannelTable(
    def.contrastCurve.strength,
    def.highlightRecovery.headroom,
    def.highlightRecovery.kneeStart,
    def.shadowControl.lift,
    def.shadowControl.tint.r,
  );
  const gTable = buildChannelTable(
    def.contrastCurve.strength,
    def.highlightRecovery.headroom,
    def.highlightRecovery.kneeStart,
    def.shadowControl.lift,
    def.shadowControl.tint.g,
  );
  const bTable = buildChannelTable(
    def.contrastCurve.strength,
    def.highlightRecovery.headroom,
    def.highlightRecovery.kneeStart,
    def.shadowControl.lift,
    def.shadowControl.tint.b,
  );

  const clarityGain = 1 + def.localClarity.strength;
  const clarityDiff = -def.localClarity.strength;
  const sharpGain = 1 + def.controlledSharpening.strength;
  const sharpDiff = -def.controlledSharpening.strength;

  return (
    <>
      <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden>
        <defs>
          <filter
            id={filterId}
            x="-10%"
            y="-10%"
            width="120%"
            height="120%"
            colorInterpolationFilters="sRGB"
          >
            <feComponentTransfer result="exposureWb">
              <feFuncR type="linear" slope={gain.r} intercept={0} />
              <feFuncG type="linear" slope={gain.g} intercept={0} />
              <feFuncB type="linear" slope={gain.b} intercept={0} />
            </feComponentTransfer>

            <feGaussianBlur
              in="exposureWb"
              stdDeviation={def.mildDenoise.blurStdDeviation}
              result="denoised"
            />

            <feComponentTransfer in="denoised" result="toneCurve">
              <feFuncR type="table" tableValues={rTable.join(" ")} />
              <feFuncG type="table" tableValues={gTable.join(" ")} />
              <feFuncB type="table" tableValues={bTable.join(" ")} />
            </feComponentTransfer>

            <feColorMatrix
              in="toneCurve"
              type="matrix"
              values={skinProtectionMatrix(def.skinToneProtection.rLumaBlend)}
              result="skinProtected"
            />

            <feColorMatrix
              in="skinProtected"
              type="saturate"
              values={String(def.saturation.value)}
              result="graded"
            />

            <feGaussianBlur
              in="graded"
              stdDeviation={def.localClarity.radius}
              result="clarityBlur"
            />
            <feComposite
              in="graded"
              in2="clarityBlur"
              operator="arithmetic"
              k1={0}
              k2={clarityGain}
              k3={clarityDiff}
              k4={0}
              result="clarity"
            />

            <feGaussianBlur
              in="clarity"
              stdDeviation={def.controlledSharpening.radius}
              result="sharpBlur"
            />
            <feComposite
              in="clarity"
              in2="sharpBlur"
              operator="arithmetic"
              k1={0}
              k2={sharpGain}
              k3={sharpDiff}
              k4={0}
            />
          </filter>
        </defs>
      </svg>
      <div style={{ width: "100%", height: "100%", filter: `url(#${filterId})` }}>
        {children}
      </div>
    </>
  );
};
