// src/harmony/types.ts

export type Pitch = { step: string; alter?: number; octave: number };

export type KeyMode = "major" | "minor" | "unknown";

export type KeyEstimate = {
  tonic: string; // "C", "G", "F#", "Bb"
  mode: KeyMode;
  confidence: number; // 0..1
};

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "sus2"
  | "sus4"
  | "dom7"
  | "maj7"
  | "min7"
  | "hdim7"
  | "dim7"
  | "unknown";

export type ChordInfo = {
  pcs: number[]; // pitch classes present (0..11)
  rootPc: number | null; // 0..11
  bassPc: number | null; // 0..11 (lowest pitch class detected in the window)
  quality: ChordQuality;
  name: string; // "C", "G7", "F#m", etc
};

export type RomanAnalysis = {
  roman: string; // "I", "V6", "V/V", "iiø7", etc
  degree: number | null; // 1..7 in the current key if known
  functionTag: "tonic" | "predominant" | "dominant" | "other";
  secondaryOf?: string; // "V", "ii", etc
  notes: string[]; // note names used for this snapshot
};

export type MeasureHarmony = {
  measureNumber: number;
  chord: ChordInfo;
  roman: RomanAnalysis;
};

export type BeatHarmony = {
  measureNumber: number;
  beatNumber: number;
  chord: ChordInfo;
  roman: RomanAnalysis;
};

export type CadenceType =
  | "authentic_perfect"
  | "authentic_imperfect"
  | "half"
  | "plagal"
  | "deceptive"
  | "phrygian"
  | "none";

export type CadenceDetection = {
  atMeasure: number;
  type: CadenceType;
  confidence: number; // 0..1
  evidence: {
    prevRoman?: string;
    lastRoman?: string;
  };
};

export type HarmonyAnalysisResult =
  | {
      ok: true;
      engine: {
        phase: string; // "3.2"
        granularity: "measure";
        romanNumerals: true;
        tonicizations: "brief";
        sustainPolicy: "overlap";
      };
      key: KeyEstimate;
      measures: MeasureHarmony[];
      cadences: CadenceDetection[];
    }
  | {
      ok: true;
      engine: {
        phase: string; // "3.2"
        granularity: "beat";
        romanNumerals: true;
        tonicizations: "brief";
        sustainPolicy: "overlap";
      };
      key: KeyEstimate;
      beats: BeatHarmony[];
      cadences: CadenceDetection[];
    };

export type HarmonyAnalysisError = {
  ok: false;
  error: string;
};

export type HarmonyAnalyzeRequest = {
  scoreModel?: any;
  musicxml?: string;
  options?: {
    granularity?: "measure" | "beat";
    preferKeyFromMeta?: boolean;
    forceKey?: { tonic: string; mode: "major" | "minor" };
    maxMeasures?: number;
    ignorePercussion?: boolean;
  };
};