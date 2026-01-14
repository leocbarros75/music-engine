// src/harmony/harmonicAnalyzer.ts

import type {
  HarmonicPhraseAnalysis,
  HarmonicMeasure,
  RomanNumeral
} from "./harmonyTypes";
import { detectCadence } from "./cadenceDetector";

export function analyzeFourBarHarmony(): HarmonicPhraseAnalysis {
  // TEMPORARY: classical test phrase (Phase 3.1)
  // I – IV – V – I in C Major

  const key = "C";
  const mode: "major" = "major";

  const measures: HarmonicMeasure[] = [
    { measure: 1, roman: "I" },
    { measure: 2, roman: "IV" },
    { measure: 3, roman: "V" },
    { measure: 4, roman: "I" }
  ];

  const cadence = detectCadence(measures, mode);

  return {
    key,
    mode,
    measures,
    cadence
  };
}