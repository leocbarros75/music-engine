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

export type ProfileId =
  | "hymn_support"
  | "countermelody"
  | "cinematic_pads"
  | "dance_baroque"
  // ── Adler-based texture modes (from "The Study of Orchestration", 3rd ed.) ──
  | "melody_harmony"    // Vln I = foreground melody; Vln II + Vla = inner harmony; Vc = bass; Cb = Vc -8va
  | "melody_pizzicato"  // Vln I arco melody; Vln II + Vla + Vc + Cb pizzicato chord support
  | "cello_melody"      // Vc = foreground melody in tenor/bass register; violins = soft background harmony
  | "homophonic_block"; // All 5 voices in block chords with Adler overtone spacing (wide bass, close treble)

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
  /**
   * Piston Ch. 28: below C3 (MIDI 48), intervals smaller than a P4th (5 st)
   * between adjacent voices muddy the bass register with clashing overtones.
   * Penalty fires on each adjacent pair that is both below MIDI 48 and
   * separated by fewer than 5 semitones.
   */
  lowRegisterSpacingPenalty: number;
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
