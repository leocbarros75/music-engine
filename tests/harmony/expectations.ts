// tests/harmony/expectations.ts

export type HarmonyOutput = {
  ok: boolean;
  key?: { tonic?: string; mode?: string };
  beats?: Array<{
    measureNumber: number;
    beatNumber: number;
    roman?: { roman?: string };
    chord?: { pcs?: number[] };
  }>;
  cadences?: Array<{
    atMeasure: number;
    type: string;
    evidence?: { prevRoman?: string; lastRoman?: string };
  }>;
};

export type Expectation = {
  id: string;
  key?: { tonic: string; mode: string };
  beatRomans?: Array<{ measure: number; beat: number; roman: string }>;
  cadenceTypes?: Array<{ atMeasure: number; type: string }>;
  cadenceEvidence?: Array<{ atMeasure: number; prevRoman: string; lastRoman: string }>;
  // Basic sanity checks
  requireNonEmptyChordOnBeat1OfMeasures?: number[];
};

export const EXPECTATIONS_BY_BASENAME: Record<string, Expectation> = {
  "test_am_i64_v7_i.xml": {
    id: "am_i64_v7_i",
    key: { tonic: "A", mode: "minor" },
    beatRomans: [
      { measure: 1, beat: 1, roman: "V64" },
      { measure: 2, beat: 1, roman: "V7" },
      { measure: 3, beat: 1, roman: "i" }
    ],
    cadenceTypes: [{ atMeasure: 3, type: "authentic_perfect" }],
    cadenceEvidence: [{ atMeasure: 3, prevRoman: "V7", lastRoman: "i" }],
    requireNonEmptyChordOnBeat1OfMeasures: [1, 2, 3]
  },

  "test_c_major_plagal_4bars.xml": {
    id: "c_major_plagal",
    key: { tonic: "C", mode: "major" },
    beatRomans: [
      { measure: 1, beat: 1, roman: "I" },
      { measure: 3, beat: 1, roman: "IV" },
      { measure: 4, beat: 1, roman: "I" }
    ],
    cadenceTypes: [{ atMeasure: 4, type: "plagal" }],
    requireNonEmptyChordOnBeat1OfMeasures: [1, 2, 3, 4]
  },

  "test_c_major_applied_dominant_deceptive.xml": {
    id: "c_major_applied_dominant_deceptive",
    key: { tonic: "C", mode: "major" },
    beatRomans: [
      { measure: 1, beat: 1, roman: "V7/V" },
      { measure: 2, beat: 1, roman: "vi" },
      { measure: 3, beat: 1, roman: "V" },
      { measure: 4, beat: 1, roman: "I" }
    ],
    cadenceTypes: [
      { atMeasure: 2, type: "deceptive" },
      { atMeasure: 4, type: "authentic_imperfect" }
    ],
    cadenceEvidence: [{ atMeasure: 2, prevRoman: "V7/V", lastRoman: "vi" }],
    requireNonEmptyChordOnBeat1OfMeasures: [1, 2, 3, 4]
  },

  // NEW: C major V7 -> I, 2 bars
  "test_c_major_v7_i_2bars.xml": {
    id: "c_major_v7_i_2bars",
    key: { tonic: "C", mode: "major" },
    beatRomans: [
      { measure: 1, beat: 1, roman: "V7" },
      { measure: 2, beat: 1, roman: "I" }
    ],
    cadenceTypes: [{ atMeasure: 2, type: "authentic_perfect" }],
    cadenceEvidence: [{ atMeasure: 2, prevRoman: "V7", lastRoman: "I" }],
    requireNonEmptyChordOnBeat1OfMeasures: [1, 2]
  }
};