import type { NoteEvent, Pitch, ScoreModel } from "../../score/types";

export type VoiceId = "vln1" | "vln2" | "vla" | "vc" | "cb";
export type RecoveryDir = "up" | "down" | null;
export type PendingRecovery = Record<VoiceId, RecoveryDir>;

export type RangeSpec = {
  absMin: number;
  absMax: number;
  prefMin: number;
  prefMax: number;
};

export type VoiceRangeMap = Record<VoiceId, RangeSpec>;

export type Slice = {
  measure: number;
  t: number; // divisions
  dur: number; // divisions
  melodyMidi: number | null;
  chordSymbol?: string | null;
};

export type Voicing = Record<VoiceId, number | null>;

export type Penalty = {
  id: string;
  cost: number;
  detail?: string;
};

export type TransitionScore = {
  cost: number;
  penalties: Penalty[];
  pendingRecovery: PendingRecovery;
};

export type ProfileId = "hymn_support" | "countermelody" | "cinematic_pads" | "dance_baroque";

export type ProfileWeights = {
  stepPreference: number;
  leapPenalty: number;
  recoveryPenalty: number;
  parallelPerfectPenalty: number;
  hiddenPerfectPenalty: number;
  dissonancePenalty: number;
  crossingPenalty: number;
  rangePenalty: number;
  tessituraPenalty: number;
  perfectChainPenalty: number;
};

export type CandidateState = {
  voicing: Voicing;
  pendingRecovery: PendingRecovery;
};

export type StringEnsembleArrangement = {
  parts: Record<VoiceId, NoteEvent[]>;
  articulations?: Array<{ t: number; measure: number; type: "legato" | "staccato" | "tenuto" }>;
  dynamics?: Array<{ measure: number; value: "p" | "mp" | "mf" | "f" }>;
  phrasing?: Array<{ startMeasure: number; endMeasure: number }>;
  debug?: {
    transitionPenalties: Array<{
      measure: number;
      t: number;
      penalties: Penalty[];
    }>;
  };
};

export type StringArrangerOptions = {
  profile?: ProfileId;
  seed?: number;
  allowDivisi?: boolean;
};

export type StringArrangerResult = {
  scoreModel: ScoreModel;
  arrangement: StringEnsembleArrangement;
  warnings: string[];
};

export type PitchEvent = {
  pitch: Pitch;
  midi: number;
};
