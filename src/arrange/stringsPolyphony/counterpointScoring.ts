import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type {
  CounterpointRules,
  Direction,
  IntervalClass,
  MotionType,
  RuleHit,
  TransitionScore,
  VoiceId,
  Voicing
} from "./types";
import { initRhythmState, updateRhythmState } from "./rhythmStratification";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

export function loadCounterpointRules(): CounterpointRules {
  const baseSpecies = readJson(path.join(process.cwd(), "rules", "counterpoint", "counterpoint_species_rules.json"));
  const baseVoiceLeading = readJson(path.join(process.cwd(), "rules", "harmony", "voiceleading_rules.json"));
  const defaults = readJson(path.join(__dirname, "defaultPolyphonyRules.json"));
  const voiceleading = baseVoiceLeading ?? {};
  if (!voiceleading.voice_leading_constraints) voiceleading.voice_leading_constraints = {};
  if (!voiceleading.voice_leading_constraints.voice_crossing) {
    voiceleading.voice_leading_constraints.voice_crossing = {
      allow_voice_crossing: false,
      max_crossing_duration_slices: 0,
      allowed_on_weak_beats_only: true,
      ensemble_hierarchy: ["violin_1", "violin_2", "viola", "cello", "double_bass"],
      collision_handler: {
        resolution_priority: ["attempt_voice_swap", "attempt_octave_displacement_down", "recalculate_nearest_chord_tone"]
      },
      octave_displacement: { max_octaves_down: 2 },
      penalties: { crossingPenalty: 2, unresolvedCrossingHardPenalty: 20 }
    };
  }
  return {
    species: baseSpecies ?? {},
    voiceleading,
    polyphony: (defaults?.polyphony ?? {}) as CounterpointRules["polyphony"]
  };
}

function readJson(filePath: string): any {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function direction(a: number | null, b: number | null): Direction {
  if (a === null || b === null) return "static";
  if (b > a) return "up";
  if (b < a) return "down";
  return "static";
}

function relativeMotion(a0: number | null, a1: number | null, b0: number | null, b1: number | null): MotionType {
  const d1 = direction(a0, a1);
  const d2 = direction(b0, b1);
  if (d1 === "static" || d2 === "static") return "oblique";
  if (d1 === d2) {
    const i1 = Math.abs((a1 ?? 0) - (a0 ?? 0));
    const i2 = Math.abs((b1 ?? 0) - (b0 ?? 0));
    return i1 === i2 ? "parallel" : "similar";
  }
  return "contrary";
}

function intervalClass(semitones: number): IntervalClass {
  const mod = ((semitones % 12) + 12) % 12;
  if (mod === 0 || mod === 7) return "perfect";
  if (mod === 3 || mod === 4 || mod === 8 || mod === 9) return "imperfect";
  return "dissonant";
}

function intervalName(semitones: number): string {
  const mod = ((semitones % 12) + 12) % 12;
  if (mod === 0) return "P8";
  if (mod === 7) return "P5";
  if (mod === 3) return "m3";
  if (mod === 4) return "M3";
  if (mod === 8) return "m6";
  if (mod === 9) return "M6";
  if (mod === 5) return "P4";
  if (mod === 1) return "m2";
  if (mod === 2) return "M2";
  if (mod === 10) return "m7";
  if (mod === 11) return "M7";
  return "int";
}

function verticalInterval(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function isStep(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(a - b) <= 2;
}

export function scoreTransition(
  prev: Voicing,
  next: Voicing,
  rules: CounterpointRules,
  isStrongBeat: boolean,
  rhythmState = initRhythmState(),
  prevPendingRecovery: Record<VoiceId, Direction | null> = {
    vln1: null,
    vln2: null,
    vla: null,
    vc: null,
    cb: null
  },
  prevPendingResolution: string[] = [],
  prevParallelPerfectCounts: Record<string, number> = {}
): TransitionScore {
  const ruleHits: RuleHit[] = [];
  const poly = rules.polyphony;
  const species1 = (rules.species?.species_1 ?? {}) as any;
  const species2 = (rules.species?.species_2 ?? {}) as any;
  const pendingRecovery: Record<VoiceId, Direction | null> = { ...prevPendingRecovery };
  const pendingResolution = new Set(prevPendingResolution);
  const parallelPerfectCounts: Record<string, number> = { ...prevParallelPerfectCounts };

  let cost = 0;

  // Leap recovery enforcement.
  for (const v of VOICES) {
    const a = prev[v];
    const b = next[v];
    if (a === null || b === null) {
      pendingRecovery[v] = null;
      continue;
    }
    const prevDir = prevPendingRecovery[v];
    if (prevDir) {
      const dir = direction(a, b);
      const step = isStep(a, b);
      if (dir === prevDir || !step) {
        cost += 3;
        ruleHits.push({ id: "recovery_missing", cost: 3, detail: v });
      }
      pendingRecovery[v] = null;
    }
    const leap = Math.abs(b - a) >= 5;
    if (leap) {
      pendingRecovery[v] = direction(a, b);
      ruleHits.push({ id: "leap", cost: 1, detail: v });
    }
  }

  // Pairwise motion scoring
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
    const pairKey = `${top}-${bottom}`;
    const rel = relativeMotion(a0, a1, b0, b1);
    const motionWeight = poly.motionPriorityWeights[rel];
    cost += motionWeight;
    ruleHits.push({ id: `motion_${rel}`, cost: motionWeight, detail: `${top}-${bottom}` });

    const intPrev = verticalInterval(a0, b0);
    const intNext = verticalInterval(a1, b1);
    if (intPrev !== null && intNext !== null) {
      const clsPrev = intervalClass(intPrev);
      const clsNext = intervalClass(intNext);
      if (pendingResolution.has(pairKey) && isStrongBeat) {
        const resolved = clsNext !== "dissonant" && (isStep(a0, a1) || isStep(b0, b1));
        if (!resolved) {
          cost += poly.passingToneRules.strongBeatDissonancePenalty;
          ruleHits.push({ id: "resolve_fail", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
        } else {
          ruleHits.push({ id: "resolve_ok", cost: 0, detail: pairKey });
        }
        pendingResolution.delete(pairKey);
      }
      if (clsPrev === "perfect" && clsNext === "perfect" && rel === "parallel") {
        const name = intervalName(intNext);
        const forbidden = Array.isArray(species1.no_parallels) ? species1.no_parallels : ["P5", "P8"];
        if (forbidden.includes(name)) {
          cost += 40;
          ruleHits.push({ id: "parallel_perfect", cost: 40, detail: `${top}-${bottom}` });
        }
        const chainKey = `${top}-${bottom}`;
        const prevCount = parallelPerfectCounts[chainKey] ?? 0;
        const nextCount = prevCount + 1;
        parallelPerfectCounts[chainKey] = nextCount;
        if (nextCount > 2) {
          cost += 6;
          ruleHits.push({ id: "parallel_perfect_chain", cost: 6, detail: chainKey });
        }
      } else {
        const chainKey = `${top}-${bottom}`;
        parallelPerfectCounts[chainKey] = 0;
      }
      if (clsNext === "perfect" && rel === "similar" && outer) {
        const topStep = isStep(a0, a1);
        const hiddenCost = topStep ? 6 : 15;
        cost += hiddenCost;
        ruleHits.push({ id: "hidden_perfect", cost: hiddenCost, detail: `${top}-${bottom}` });
      }
      if (clsNext === "dissonant") {
        const strongBeatConsonantRequired = species2.strong_beat_consonant_required === true;
        if (!isStrongBeat && poly.passingToneRules.allowWeakBeatDissonance) {
          const stepApproach = !poly.passingToneRules.requireStepApproach || (isStep(a0, a1) && isStep(b0, b1));
          if (stepApproach) {
            cost += poly.passingToneRules.weakBeatDissonancePenalty;
            ruleHits.push({ id: "passing_dissonance", cost: poly.passingToneRules.weakBeatDissonancePenalty, detail: pairKey });
            if (poly.passingToneRules.requireStepResolve) pendingResolution.add(pairKey);
          } else {
            cost += poly.passingToneRules.strongBeatDissonancePenalty;
            ruleHits.push({ id: "dissonance", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
          }
        } else {
          const oblique = rel === "oblique";
          const suspensionCandidate = isStrongBeat && clsPrev !== "dissonant" && oblique;
          if (suspensionCandidate) {
            cost += poly.passingToneRules.weakBeatDissonancePenalty;
            ruleHits.push({ id: "suspension", cost: poly.passingToneRules.weakBeatDissonancePenalty, detail: pairKey });
            pendingResolution.add(pairKey);
          } else {
            cost += poly.passingToneRules.strongBeatDissonancePenalty;
            ruleHits.push({ id: "dissonance", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
            if (strongBeatConsonantRequired) {
              cost += 1.5;
              ruleHits.push({ id: "strong_beat_consonant", cost: 1.5, detail: pairKey });
            }
          }
        }
      }
    }
  }

  // Extra strict parallel perfect check across all voice pairs.
  const pairSet = new Set(pairs.map((p) => `${p[0]}-${p[1]}`));
  for (let i = 0; i < VOICES.length; i++) {
    for (let j = i + 1; j < VOICES.length; j++) {
      const top = VOICES[i]!;
      const bottom = VOICES[j]!;
      const key = `${top}-${bottom}`;
      if (pairSet.has(key)) continue;
      const a0 = prev[top];
      const b0 = prev[bottom];
      const a1 = next[top];
      const b1 = next[bottom];
      if (a1 === null || b1 === null) continue;
      const intPrev = verticalInterval(a0, b0);
      const intNext = verticalInterval(a1, b1);
      if (intPrev === null || intNext === null) continue;
      if (intervalClass(intPrev) !== "perfect" || intervalClass(intNext) !== "perfect") continue;
      const rel = relativeMotion(a0, a1, b0, b1);
      if (rel !== "parallel") continue;
      const name = intervalName(intNext);
      const forbidden = Array.isArray(species1.no_parallels) ? species1.no_parallels : ["P5", "P8"];
      if (forbidden.includes(name)) {
        cost += 30;
        ruleHits.push({ id: "parallel_perfect_any", cost: 30, detail: key });
      }
    }
  }

  // Simple crossing penalty (soft)
  if (rules.voiceleading?.no_crossing) {
    const order: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];
    for (let i = 0; i < order.length - 1; i++) {
      const hi = next[order[i]];
      const lo = next[order[i + 1]];
      if (hi !== null && lo !== null && lo > hi) {
        cost += 4;
        ruleHits.push({ id: "crossing", cost: 4, detail: `${order[i + 1]}>${order[i]}` });
      }
    }
  }

  // Spacing and overlap penalties
  const spacingCfg = rules.voiceleading?.max_spacing ?? {};
  const spacingLimit = (label?: string): number | null => {
    if (!label) return null;
    if (label === "octave") return 12;
    if (label === "twelfth") return 19;
    return null;
  };
  const spacingPairs: Array<[VoiceId, VoiceId, string | undefined]> = [
    ["vln1", "vln2", spacingCfg.between_SA ?? spacingCfg.between_upper_voices],
    ["vln2", "vla", spacingCfg.between_AT ?? spacingCfg.between_upper_voices],
    ["vla", "vc", spacingCfg.between_TB],
    ["vc", "cb", spacingCfg.between_TB]
  ];
  for (const [hiVoice, loVoice, label] of spacingPairs) {
    const hi = next[hiVoice];
    const lo = next[loVoice];
    if (hi === null || lo === null) continue;
    const limit = spacingLimit(label);
    if (limit !== null && Math.abs(hi - lo) > limit) {
      cost += 2;
      ruleHits.push({ id: "spacing", cost: 2, detail: `${hiVoice}-${loVoice}` });
    }
    if (rules.voiceleading?.no_overlap) {
      if (hiVoice === "vla" && loVoice === "vc") continue;
      if (hiVoice === "vln2" && loVoice === "vla") continue;
      const prevLo = prev[loVoice];
      if (prevLo !== null && hi < prevLo) {
        cost += 2;
        ruleHits.push({ id: "overlap", cost: 2, detail: `${hiVoice}<${loVoice}` });
      }
    }
  }

  // Prevent Violin I and II unison overlap.
  if (next.vln1 !== null && next.vln2 !== null && next.vln1 === next.vln2) {
    cost += 8;
    ruleHits.push({ id: "vln1_vln2_unison", cost: 8, detail: "vln1==vln2" });
  }

  // Prevent Violin II and Viola unison overlap.
  if (next.vln2 !== null && next.vla !== null && next.vln2 === next.vla) {
    cost += 6;
    ruleHits.push({ id: "vln2_vla_unison", cost: 6, detail: "vln2==vla" });
  }

  // Prevent Cello/Bass unison overlap.
  if (next.vc !== null && next.cb !== null && next.vc === next.cb) {
    cost += 6;
    ruleHits.push({ id: "bass_cello_overlap", cost: 6, detail: "vc==cb" });
  }

  // Rhythm stratification penalty
  const rhythm = updateRhythmState(rhythmState, next, poly.rhythmicStratification);
  if (rhythm.penalty > 0) {
    cost += rhythm.penalty;
    ruleHits.push({ id: "rhythm_balance", cost: rhythm.penalty });
  }

  return {
    cost,
    ruleHits,
    pendingRecovery,
    pendingResolution: Array.from(pendingResolution),
    rhythmState: rhythm.next,
    parallelPerfectCounts
  };
}
