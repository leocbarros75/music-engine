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
  perfectChainPenalty: 1.5
};

export const PROFILE_WEIGHTS: Record<ProfileId, ProfileWeights> = {
  hymn_support:   { ...DEFAULT_PROFILE, stepPreference: 1.4, leapPenalty: 5.5, dissonancePenalty: 4 },
  countermelody:  { ...DEFAULT_PROFILE, stepPreference: 1.2, leapPenalty: 4.5, dissonancePenalty: 3 },
  cinematic_pads: { ...DEFAULT_PROFILE, stepPreference: 1.0, leapPenalty: 3.5, dissonancePenalty: 2.5 },
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
    perfectChainPenalty: 2.0
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

  // Violin I and II spacing: prefer within octave, hard cap ~19 semitones.
  if (next.vln1 !== null && next.vln2 !== null) {
    const dist = next.vln1 - next.vln2;
    if (dist > 19) {
      penalties.push({ id: "vln2_spacing_hard", cost: profile.crossingPenalty * 1.5, detail: String(dist) });
    } else if (dist > 12) {
      penalties.push({ id: "vln2_spacing_soft", cost: profile.crossingPenalty * 0.5, detail: String(dist) });
    }
  }

  // Gap fill: if Vln2 to Cello gap exceeds octave, prefer Viola to fill.
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
    }
  }

  const cost = penalties.reduce((sum, p) => sum + p.cost, 0);
  return { cost, penalties, pendingRecovery: pending };
}

export function isSeverePenalty(p: { id: string; cost: number }): boolean {
  return PERFECT_IDS.has(p.id) && p.cost >= DEFAULT_PROFILE.parallelPerfectPenalty;
}
