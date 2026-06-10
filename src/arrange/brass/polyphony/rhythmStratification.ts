import type { RhythmState, VoiceId, Voicing } from "./types";

export type StratificationConfig = {
  targetSubdivision: number;
  maxVoiceDominance: number;
  allAttackPenalty: number;
  dominancePenalty: number;
};

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

export function initRhythmState(): RhythmState {
  return {
    totalAttacks: 0,
    perVoice: { vln1: 0, vln2: 0, vla: 0, vc: 0, cb: 0 }
  };
}

export function updateRhythmState(
  prev: RhythmState,
  voicing: Voicing,
  config: StratificationConfig
): { next: RhythmState; penalty: number; reason?: string } {
  const next: RhythmState = {
    totalAttacks: prev.totalAttacks,
    perVoice: { ...prev.perVoice }
  };

  let activeCount = 0;
  for (const v of VOICES) {
    const note = voicing[v];
    if (note !== null) {
      next.perVoice[v] = (next.perVoice[v] ?? 0) + 1;
      next.totalAttacks += 1;
      activeCount += 1;
    }
  }

  let penalty = 0;
  if (activeCount === VOICES.length) {
    penalty += config.allAttackPenalty;
  }

  const total = Math.max(1, next.totalAttacks);
  for (const v of VOICES) {
    const ratio = (next.perVoice[v] ?? 0) / total;
    if (ratio > config.maxVoiceDominance) {
      penalty += config.dominancePenalty * (ratio - config.maxVoiceDominance) * 10;
    }
  }

  return { next, penalty };
}
