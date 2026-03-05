// src/rhythm/rhythmTypes.ts

export type RhythmUnit = "quarter";

export type MeterSpec = {
  beats: number; // e.g. 4 for 4/4, 3 for 3/4
  beatType: number; // 4 for /4, 8 for /8
};

export type RhythmCell = {
  id: string;
  meter: MeterSpec;

  // We store durations in QUARTER units.
  // Examples:
  // - 4/4 whole note => [4]
  // - 4/4 two half => [2,2]
  // - 3/4 dotted half => [3]
  // - 6/8 dotted quarter => [1.5] (since dotted quarter = 3/8 = 1.5 quarters)
  unit: RhythmUnit;

  durs: number[]; // sum must equal measure length in quarter-units
  label?: string;
  tags?: string[]; // e.g. ["grounded","syncopated","fill"]
};

export type GrooveRole = "bass" | "drums";

export type BassMotion = "grounded" | "walking" | "syncopated";

export type GrooveTemplate = {
  id: string;
  style:
    | "classical"
    | "baroque"
    | "romantic"
    | "modern_classical"
    | "pop"
    | "rock"
    | "funk"
    | "indie"
    | "samba"
    | "baiao"
    | "xote";

  meter: MeterSpec;
  unit: RhythmUnit;

  role: GrooveRole;

  // Candidate rhythm cell ids, with weights.
  // We choose ONE cell per measure (v1).
  cells: Array<{ cellId: string; weight: number }>;

  bassMotion?: BassMotion;

  // Simple guidance to bias choices:
  preferTags?: string[];
  avoidTags?: string[];
};

export type RhythmApplyOptions = {
  style: GrooveTemplate["style"];
  role: GrooveRole; // bass for now
  applyOnlyFinalCadence: boolean; // per your instruction
  warnOnly: boolean; // always true for now
  level?: "beginner" | "intermediate" | "advanced" | "professional";
};

export type RhythmApplyResult = {
  applied: boolean;
  reason: string;

  style: RhythmApplyOptions["style"];

  detectedCadencePairs: Array<{ fromMeasure: number; toMeasure: number }>;
  appliedCadencePair: { fromMeasure: number; toMeasure: number } | null;

  appliedMeasureNumbers: number[];

  chosenPlans: Record<string, { cellId: string; durs: number[]; label?: string }>;

  warnings: string[];
};
