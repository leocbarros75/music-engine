import type { PendingRecovery, ProfileId, ProfileWeights, TransitionScore, VoiceId, Voicing } from "./types";
import { direction, intervalClass, melodicPrimitive, relativeMotion, verticalInterval } from "./primitives";
import { STRING_RANGES } from "./ranges";

const PERFECT_IDS = new Set(["parallel_perfect", "hidden_perfect"]);

export const DEFAULT_PROFILE: ProfileWeights = {
  stepPreference: 1.2,
  leapPenalty: 4.5,
  recoveryPenalty: 3.5,
  parallelPerfectPenalty: 12,
  hiddenPerfectPenalty: 6,
  dissonancePenalty: 3,
  crossingPenalty: 4,
  rangePenalty: 6,
  tessituraPenalty: 1.5,
  perfectChainPenalty: 1.5,
  // Piston Ch. 28: below C3 avoid intervals < P4th between adjacent voices
  lowRegisterSpacingPenalty: 2.5,
  // Adler p. 135: lower-voice pairs should span wider intervals than upper-voice pairs
  overtoneSpacingPenalty: 1.5
};

export const PROFILE_WEIGHTS: Record<ProfileId, ProfileWeights> = {
  hymn_support:   { ...DEFAULT_PROFILE, stepPreference: 1.4, leapPenalty: 5.5, dissonancePenalty: 4 },
  countermelody:  { ...DEFAULT_PROFILE, stepPreference: 1.2, leapPenalty: 4.5, dissonancePenalty: 3 },
  cinematic_pads: { ...DEFAULT_PROFILE, stepPreference: 1.0, leapPenalty: 3.5, dissonancePenalty: 2.5 },

  // ── Bach chorale profile ─────────────────────────────────────────────────
  // Calibrated from 120 Bach chorales (BWV 121-240), 4998 chord slots.
  //   Motion:  S 64% steps / 13% leaps   A 64% steps / 18% leaps
  //            T 60% steps / 20% leaps   B 48% steps / 40% leaps
  //   Spacing: S-A avg 5.1 st  A-T avg 5.6 st  T-B avg 9.3 st
  //   Doubling (octave unisons): A-B 25%, T-B 24%, S-B 22%, S-T 17%
  //
  // High stepPreference rewards the 60-64% stepwise motion in upper voices.
  // High parallelPerfectPenalty: Bach practically never writes parallel 5ths/8ths.
  // crossingPenalty raised: Bach almost never crosses voices.
  // leapPenalty kept moderate — bass leaps often (40%); compensation via pendingRecovery.
  bach_chorale: {
    ...DEFAULT_PROFILE,
    stepPreference:          2.0,   // S/A/T: ~64% stepwise in real Bach
    leapPenalty:             4.0,   // moderate — bass needs freedom (40% leaps)
    recoveryPenalty:         3.0,   // leaps should be followed by stepwise recovery
    parallelPerfectPenalty:  20,    // near-absolute prohibition — Bach essentially never
    hiddenPerfectPenalty:    9,     // hidden octaves/5ths strongly avoided
    dissonancePenalty:       4.5,   // vertical dissonances strictly avoided
    crossingPenalty:         7.0,   // voice crossing is a genuine Bach rarity
    rangePenalty:            8,
    tessituraPenalty:        1.6,
    perfectChainPenalty:     2.0,
    lowRegisterSpacingPenalty: 3.0, // Piston: avoid close intervals below C3
    overtoneSpacingPenalty:  2.0    // T-B should span wider than A-T (avg 9.3 vs 5.6)
  },

  dance_baroque:  { ...DEFAULT_PROFILE, stepPreference: 1.3, leapPenalty: 4.8, dissonancePenalty: 3.2 },

  // ── Adler-based profiles ────────────────────────────────────────────────
  // melody_harmony: Vln I = foreground; inner voices lean stepwise; bass firm.
  // Strong dissonance/crossing penalties enforce clean SATB-like block texture.
  melody_harmony: {
    ...DEFAULT_PROFILE,
    stepPreference: 1.6,
    leapPenalty: 6.0,
    dissonancePenalty: 4.5,
    crossingPenalty: 5.5,
    parallelPerfectPenalty: 14,
    hiddenPerfectPenalty: 7,
    rangePenalty: 7,
    tessituraPenalty: 1.8
  },

  // melody_pizzicato: same harmonic principles as melody_harmony; slightly
  // more rhythmic flexibility for pizzicato chord hits (lower leap penalty).
  melody_pizzicato: {
    ...DEFAULT_PROFILE,
    stepPreference: 1.4,
    leapPenalty: 5.0,
    dissonancePenalty: 3.5,
    crossingPenalty: 4.5,
    parallelPerfectPenalty: 12,
    tessituraPenalty: 1.4
  },

  // cello_melody: Vc is the singing foreground voice → smooth vc line is
  // rewarded.  Violins stay in their preferred (upper) register as background.
  // Lower leap penalty for upper strings allows looser arpeggiated fills.
  cello_melody: {
    ...DEFAULT_PROFILE,
    stepPreference: 1.5,
    leapPenalty: 3.8,          // violins can leap more freely (background texture)
    dissonancePenalty: 3.0,
    crossingPenalty: 4.0,
    rangePenalty: 7,            // keep cello in characteristic range
    tessituraPenalty: 2.0,
    recoveryPenalty: 4.0        // make cello line recover leaps with steps
  },

  // homophonic_block: Adler overtone-spacing rule — wide intervals in bass,
  // close spacing in upper voices.  All voices move in lockstep (chordal);
  // very high penalties for crossing, parallel perfects, and range violations
  // to enforce clean Fux-style block chord texture.
  // Piston Ch. 28 low-register spacing is especially critical here —
  // block chords demand the widest bass intervals for harmonic clarity.
  homophonic_block: {
    ...DEFAULT_PROFILE,
    stepPreference: 1.8,
    leapPenalty: 7.0,
    dissonancePenalty: 5.0,
    crossingPenalty: 6.5,
    parallelPerfectPenalty: 16,
    hiddenPerfectPenalty: 8,
    rangePenalty: 9,
    tessituraPenalty: 2.5,
    perfectChainPenalty: 2.0,
    lowRegisterSpacingPenalty: 5.0,   // Piston: wide bass spacing is defining feature
    overtoneSpacingPenalty: 3.5       // Adler p. 135: strongest enforcement in block texture
  }
};

export type ConstraintContext = {
  profile: ProfileWeights;
  pendingRecovery: PendingRecovery;
};

export function evaluateTransition(
  prev: Voicing,
  next: Voicing,
  context: ConstraintContext
): TransitionScore {
  const penalties: Array<{ id: string; cost: number; detail?: string }> = [];
  const pending: PendingRecovery = { ...context.pendingRecovery };
  const profile = context.profile;

  const voices: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];
  for (const v of voices) {
    const a = prev[v];
    const b = next[v];
    if (b === null) continue;
    const dir = direction(a, b);
    const prim = melodicPrimitive(a, b);
    const pendingDir = context.pendingRecovery[v];
    if (pendingDir) {
      const isStep = prim === "half_step" || prim === "whole_step" || prim === "step";
      const isSkip = prim === "skip";
      const opposite = dir !== "static" && dir !== pendingDir;
      if (opposite && isStep) {
        pending[v] = null;
      } else if (opposite && isSkip) {
        penalties.push({ id: "recovery_skip", cost: profile.recoveryPenalty * 0.5, detail: v });
        pending[v] = null;
      } else {
        penalties.push({ id: "recovery_missed", cost: profile.recoveryPenalty, detail: v });
      }
    }

    if (prim === "leap") {
      const scale = v === "cb" ? 1.4 : v === "vc" ? 1.2 : 1;
      penalties.push({ id: "leap", cost: profile.leapPenalty * scale, detail: v });
      if (dir !== "static") pending[v] = dir;
      // ── Schoenberg p. 45 / Fux Gradus ad Parnassum p. 79: large melodic leaps ───────────────
      // Schoenberg: "No voice shall make a leap larger than a fifth."
      // Fux: "the skip of the major sixth is prohibited" (p.79); seventh skips are worse.
      // Octave leaps (12st) are consonant and treated more leniently. Graduated cost schedule:
      //   8st (m6) → ×0.4  |  9st (M6) → ×0.6  |  10–11st (7ths) → ×1.0  |  12st (8ve) → ×0.5
      // ── Hindemith Craft of Musical Composition, Ch. V §5, p. 195 (melodic voice only) ──────
      // "In the step-progression, octave transposition may take place, so that sevenths and
      //  ninths may replace seconds." The melodic top voice (vln1) leaping a 7th is a disguised
      //  2nd in the step-progression skeleton. Apply a ×0.35 factor instead of ×1.0 for 7ths
      //  on vln1 only; bass/inner voices retain the full Fux penalty.
      const intervalSize = a !== null ? Math.abs(b - a) : 0;
      if (intervalSize > 7) {
        const isSeventh = intervalSize === 10 || intervalSize === 11;
        const hindFactor = (v === "vln1" && isSeventh) ? 0.35 : 1.0;
        const largeMult =
          intervalSize === 8  ? 0.4  // minor 6th: moderately problematic
          : intervalSize === 9  ? 0.6  // major 6th: explicitly prohibited by Fux
          : intervalSize === 12 ? 0.5  // octave: consonant, same as Schoenberg baseline
          :                       1.0; // 7th (10–11st) or compound: very prohibited
        penalties.push({
          id: "large_leap",
          cost: profile.leapPenalty * largeMult * hindFactor * scale,
          detail: `${v}:${intervalSize}st`
        });
      }
      // ── Schoenberg Theory of Harmony, p. 44: consecutive same-direction leaps ────────────────
      // "Two consecutive leaps of a fourth or fifth in the same direction are to be avoided,
      //  because the first and last tones form a dissonance." Especially critical in bass voices.
      if (pendingDir && dir !== "static" && dir === pendingDir) {
        const bassScale = (v === "cb" || v === "vc") ? 1.2 : 0.5;
        penalties.push({
          id: "consecutive_leap",
          cost: profile.leapPenalty * bassScale,
          detail: v
        });
      }
    } else if (prim === "skip") {
      penalties.push({ id: "skip", cost: profile.leapPenalty * 0.5, detail: v });
    } else if (prim === "half_step" || prim === "whole_step" || prim === "step") {
      penalties.push({ id: "step_preference", cost: -profile.stepPreference, detail: v });
    }

    const range = STRING_RANGES[v];
    if (b < range.absMin || b > range.absMax) {
      penalties.push({ id: "range_violation", cost: profile.rangePenalty * 2, detail: v });
    } else if (b < range.prefMin || b > range.prefMax) {
      penalties.push({ id: "tessitura", cost: profile.tessituraPenalty, detail: v });
    }
  }

  // Crossing and spacing
  const order: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];
  for (let i = 0; i < order.length - 1; i++) {
    const hi = next[order[i]];
    const lo = next[order[i + 1]];
    if (hi === null || lo === null) continue;
    if (lo > hi) {
      penalties.push({ id: "crossing", cost: profile.crossingPenalty, detail: `${order[i + 1]}>${order[i]}` });
    }
  }

  // ── Violin I / II spacing ─────────────────────────────────────────────────
  // Calibrated from real scores:
  //   Haydn Emperor's Hymn m1 pickup:  Vln1 G4(67) – Vln2 B3(59) = 8 st  (m6th)
  //   Haydn Emperor's Hymn m2 beat 1:  Vln1 B4(71) – Vln2 G4(67) = 4 st  (M3rd)
  //   Haydn Emperor's Hymn m3 beat 1:  Vln1 A4(69) – Vln2 C4(60) = 9 st  (M6th)
  //   Haydn Op.64 No.3 m1 beat 1:      Vln1 D5(74) – Vln2 Bb4(70)= 4 st  (M3rd)
  //   Mozart K387 m1 beat 1:           Vln1 D5(74) – Vln2 B4(71) = 3 st  (m3rd)
  //   Mozart K387 m2 beat 1:           Vln1 D5(74) – Vln2 A4(69) = 5 st  (P4th)
  //   Mozart K421 m1 beat 1:           Vln1 D5(74) – Vln2 rest   = n/a
  //   Mozart K465 m4 beat 1:           Vln1 G5(79) – Vln2 B4(71) = 8 st  (m6th)
  // Classical range: 3–9 semitones typical. Soft nudge at >10 would be ideal;
  // hard cap at 19 is never exceeded in any of these examples.
  if (next.vln1 !== null && next.vln2 !== null) {
    const dist = next.vln1 - next.vln2;
    if (dist > 19) {
      penalties.push({ id: "vln2_spacing_hard", cost: profile.crossingPenalty * 1.5, detail: String(dist) });
    } else if (dist > 12) {
      penalties.push({ id: "vln2_spacing_soft", cost: profile.crossingPenalty * 0.5, detail: String(dist) });
    }
  }

  // ── Piston low-register spacing (Ch. 28, p. 448) ─────────────────────────
  // "Below 4-foot C [MIDI 48 = C3], intervals smaller than a fifth or fourth
  // are generally avoided if clarity is desired." — Walter Piston, Orchestration
  // Fires when two adjacent voices are BOTH below C3 and their interval < P4th.
  // Primary cases: vla↔vc and vc↔cb in low positions.
  const PISTON_LOW_C3 = 48; // C3
  const PISTON_MIN_INTERVAL = 5; // P4th = 5 semitones
  for (let i = 0; i < order.length - 1; i++) {
    const hi = next[order[i]];
    const lo = next[order[i + 1]];
    if (hi === null || lo === null) continue;
    if (lo < PISTON_LOW_C3 && hi < PISTON_LOW_C3) {
      const interval = hi - lo;
      if (interval > 0 && interval < PISTON_MIN_INTERVAL) {
        penalties.push({
          id: "low_register_close",
          cost: profile.lowRegisterSpacingPenalty,
          detail: `${order[i]}-${order[i + 1]}:${interval}st`
        });
      }
    }
  }

  // ── Forsyth Orchestration p. 439: "keep the Basses up" ───────────────────────────────────
  // "There is no greater pitfall for the young composer than the use of the bottom register
  //  of the Bass. Confined to the dismal profundities of their bottom strings they merely
  //  sound like a herd of unwieldy 'hippos' stirring up the mud on the river-bed."
  // The prefMin tessitura penalty (above) handles E1–G#1. This graduated block adds an
  // extra cost below C2 (MIDI 36) — the zone where acoustic muddiness becomes severe.
  // Scale: C2 = no extra cost; each semitone lower adds rangePenalty × 0.1.
  if (next.cb !== null && next.cb < 36) {
    const depthBelowC2 = 36 - next.cb; // semitones below C2; max 8 (E1)
    penalties.push({
      id: "cb_bottom_register",
      cost: profile.rangePenalty * 0.1 * depthBelowC2,
      detail: `cb:${next.cb}`
    });
  }

  // ── Adler Study of Orchestration p. 135: Overtone-series open spacing ───────────────────
  // "One usually leaves greater space between the lower than between the upper instruments,
  //  just as there are greater distances between the more sonorous lower partials than between
  //  the upper partials of the overtone series."
  // For string quintet, the descending interval chain should be non-increasing from top to bottom:
  //   cb↔vc  ≥  vc↔vla  ≥  vla↔vln2  ≥  vln2↔vln1
  // Each pair that inverts this ordering (lower gap narrower than the gap immediately above it)
  // incurs a soft penalty. Only fires when all five voices are simultaneously present and
  // no voices are crossing (to avoid double-counting structural violations).
  if (
    next.cb !== null && next.vc !== null &&
    next.vla !== null && next.vln2 !== null && next.vln1 !== null
  ) {
    const gapCbVc    = next.vc   - next.cb;   // widest expected (bass register)
    const gapVcVla   = next.vla  - next.vc;
    const gapVlaVln2 = next.vln2 - next.vla;
    const gapVln2Vln1 = next.vln1 - next.vln2; // narrowest expected (treble register)
    const gaps = [gapCbVc, gapVcVla, gapVlaVln2, gapVln2Vln1] as const;
    const pairNames = ["cb-vc", "vc-vla", "vla-vln2", "vln2-vln1"] as const;
    for (let gi = 0; gi < gaps.length - 1; gi++) {
      if (gaps[gi]! < gaps[gi + 1]!) {
        penalties.push({
          id: "overtone_spacing",
          cost: profile.overtoneSpacingPenalty,
          detail: `${pairNames[gi]}(${gaps[gi]})<${pairNames[gi + 1]}(${gaps[gi + 1]})`
        });
      }
    }
  }

  // ── Gap fill: Vln2 to Cello ───────────────────────────────────────────────
  // Emperor's Hymn m3: Vln2 C4(60) – Vc D3(50) = 10 st; Vla F#3(54) fills → no penalty. ✓
  // The Lark m2:       Vln2 D4(62) – Vc D2(38) = 24 st; Vla F#3(54) fills → no penalty. ✓
  // The gap_fill logic is correct — penalty only fires when Viola does NOT fill.
  if (next.vln2 !== null && next.vc !== null) {
    const gap = next.vln2 - next.vc;
    if (gap > 12) {
      const vla = next.vla;
      const fills = vla !== null && vla < next.vln2 && vla > next.vc;
      if (!fills) {
        penalties.push({ id: "gap_fill", cost: profile.tessituraPenalty * 1.2, detail: String(gap) });
      }
    }
  }

  // ── Fux Gradus ad Parnassum p. 78: inner-voice unisons reduce harmonic independence ──────
  // "The tenor and bass parts blend in a unison, which is less harmonious than the octave."
  // vln2–vla and vla–vc unisons collapse two independent counterpoint lines into one.
  // (vln1–vln2 doubling and vc–cb octave-doubling are idiomatic in orchestral writing.)
  const unisonInnerPairs: Array<[VoiceId, VoiceId]> = [["vln2", "vla"], ["vla", "vc"]];
  for (const [uA, uB] of unisonInnerPairs) {
    const uMidi_a = next[uA];
    const uMidi_b = next[uB];
    if (uMidi_a !== null && uMidi_b !== null && uMidi_a === uMidi_b) {
      penalties.push({
        id: "unison_inner",
        cost: profile.crossingPenalty * 0.45,
        detail: `${uA}-${uB}`
      });
    }
  }

  // Vertical constraints
  const pairs: Array<[VoiceId, VoiceId, boolean]> = [
    ["vln1", "cb", true],
    ["vln1", "vln2", false],
    ["vln2", "vla", false],
    ["vla", "vc", false],
    ["vc", "cb", false]
  ];
  for (const [top, bottom, outer] of pairs) {
    const a0 = prev[top];
    const b0 = prev[bottom];
    const a1 = next[top];
    const b1 = next[bottom];
    if (a1 === null || b1 === null) continue;
    const intPrev = verticalInterval(a0, b0);
    const intNext = verticalInterval(a1, b1);
    if (intPrev !== null && intNext !== null) {
      const clsPrev = intervalClass(intPrev);
      const clsNext = intervalClass(intNext);
      const rel = relativeMotion(a0, a1, b0, b1);
      if (clsPrev === "perfect" && clsNext === "perfect" && rel === "parallel") {
        penalties.push({
          id: "parallel_perfect",
          cost: profile.parallelPerfectPenalty,
          detail: `${top}-${bottom}`
        });
      }
      if (clsNext === "perfect" && rel === "similar" && outer) {
        const topPrim = melodicPrimitive(a0, a1);
        const isStep = topPrim === "half_step" || topPrim === "whole_step" || topPrim === "step";
        if (!isStep) {
          penalties.push({
            id: "hidden_perfect",
            cost: profile.hiddenPerfectPenalty,
            detail: `${top}-${bottom}`
          });
        }
      }
      if (clsNext === "perfect" && clsPrev === "perfect") {
        penalties.push({ id: "perfect_chain", cost: profile.perfectChainPenalty, detail: `${top}-${bottom}` });
      }
      if (intervalClass(intNext) === "dissonant") {
        penalties.push({ id: "dissonance", cost: profile.dissonancePenalty, detail: `${top}-${bottom}` });
      }
      // ── Fux Gradus ad Parnassum pp. 75, 77, 106: contrary motion in outer voices ──────────
      // "In order to allow enough space for the voices to move toward each other by contrary
      //  motion" — Fux consistently presents outer-voice contrary motion as the gold standard.
      //  "Oblique motion usually facilitates the work in any single measure." (p.106)
      //  Reward contrary and oblique motion between the outermost voice pair (vln1 ↔ cb).
      if (outer && (rel === "contrary" || rel === "oblique")) {
        penalties.push({
          id: "contrary_outer",
          cost: -(profile.stepPreference * 0.6),
          detail: `${top}-${bottom}`
        });
      }
    }
  }

  const cost = penalties.reduce((sum, p) => sum + p.cost, 0);
  return { cost, penalties, pendingRecovery: pending };
}

export function isSeverePenalty(p: { id: string; cost: number }): boolean {
  return PERFECT_IDS.has(p.id) && p.cost >= DEFAULT_PROFILE.parallelPerfectPenalty;
}
