export type VoiceId = "vln1" | "vln2" | "vla" | "vc" | "cb";

export type MotionType = "parallel" | "similar" | "contrary" | "oblique";
export type IntervalClass = "perfect" | "imperfect" | "dissonant";
export type Direction = "up" | "down" | "static";

export type NoteEvent = {
  id?: string;
  t: number;
  dur: number;
  type: "note" | "rest";
  pitch?: { step: string; alter?: number; octave: number };
  midi?: number;
  voice?: number;
  staff?: number;
};

export type Slice = {
  index: number;
  measure: number;
  t: number;
  dur: number;
  melodyMidi: number | null;
  chordSymbol: string | null;
  isStrongBeat: boolean;
};

export type Motif = {
  intervals: number[];
  durations: number[];
  startSlice: number;
  length: number;
  baseMidi: number;
};

export type MotifEntry = {
  voice: VoiceId;
  startSlice: number;
  transpose: number;
};

export type PolyphonyRules = {
  motionPriorityWeights: {
    contrary: number;
    oblique: number;
    similar: number;
    parallel: number;
  };
  passingToneRules: {
    allowWeakBeatDissonance: boolean;
    requireStepApproach: boolean;
    requireStepResolve: boolean;
    strongBeatDissonancePenalty: number;
    weakBeatDissonancePenalty: number;
    suspensionPairs: string[];
  };
  imitation: {
    enabled: boolean;
    voices: VoiceId[];
    delayBeats: number[];
    transposeSemitones: number[];
    maxOverlaps: number;
  };
  rhythmicStratification: {
    targetSubdivision: number;
    maxVoiceDominance: number;
    allAttackPenalty: number;
    dominancePenalty: number;
  };
  celloSinger: {
    bassAnchoringThreshold: number;
    celloFreeRange: [number, number];
    agilityNoteDensity: number;
  };
};

export type CounterpointRules = {
  species: Record<string, any>;
  voiceleading: Record<string, any>;
  polyphony: PolyphonyRules;
};

export type RuleHit = {
  id: string;
  cost: number;
  detail?: string;
};

export type TransitionScore = {
  cost: number;
  ruleHits: RuleHit[];
  pendingRecovery: Record<VoiceId, Direction | null>;
  pendingResolution: string[];
  rhythmState: RhythmState;
  parallelPerfectCounts: Record<string, number>;
};

export type RhythmState = {
  totalAttacks: number;
  perVoice: Record<VoiceId, number>;
};

export type Voicing = Record<VoiceId, number | null>;

export type BeamState = {
  voicing: Voicing;
  history: Voicing[];
  pendingRecovery: Record<VoiceId, Direction | null>;
  pendingResolution: string[];
  rhythmState: RhythmState;
  parallelPerfectCounts: Record<string, number>;
  crossingCounts: Record<string, number>;
  cost: number;
  debug: RuleHit[];
};

export type StringPolyphonicResult = {
  scoreModel: any;
  warnings: string[];
  debug: {
    ruleHits: RuleHit[];
    motifEvents: MotifEntry[];
    rhythmDecisions: Array<{ slice: number; totalAttacks: number; perVoice: Record<VoiceId, number> }>;
  };
};
