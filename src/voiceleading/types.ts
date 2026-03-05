export type VoiceName = "Soprano" | "Alto" | "Tenor" | "Bass";

export type Range = { min: number; max: number };

export type VoiceState = { S: number; A: number; T: number; B: number };

export type VoiceRanges = { S: Range; A: Range; T: Range; B: Range };

export type PolyphonicProfileName = "baroque" | "classical" | "romantic" | "modern";

export type ModernMode = "modernTonal" | "modal" | "atonal";

export type PolyphonicPenaltyConfig = {
  parallelPerfect: number;
  directPerfect: number;
  directPerfectOuterLeap: number;
  perfectMotionSimilar: number;
  perfectConsonanceHold: number;
  dissonance: number;
  dissonanceLeap: number;
  similarMotionAll: number;
  spacing: number;
  crossing: number;
  overlap: number;
  leapAboveThird: number;
  leapAboveFifth: number;
  leapAboveOctave: number;
  tendencyUnresolved: number;
  seventhUnresolved: number;
  doubleTendency: number;
  doubleSeventh: number;
};

export type PolyphonicProfile = {
  name: PolyphonicProfileName;
  modernMode?: ModernMode;
  penalties: PolyphonicPenaltyConfig;
  allowParallels?: boolean;
  allowDirectPerfects?: boolean;
  enableTendencyRules?: boolean;
};

export type PolyphonicChordContext = {
  pcs: number[];
  rootPc: number;
  seventhPc?: number | null;
};

export type PolyphonicScoreInput = {
  prev: VoiceState | null;
  next: VoiceState;
  ranges: VoiceRanges;
  profile: PolyphonicProfile;
  keyPc?: number | null;
  keyMode?: "major" | "minor" | null;
  chord: PolyphonicChordContext;
  prevChord?: PolyphonicChordContext | null;
};

export type PolyphonicScoreResult = { score: number; issues: string[] };
