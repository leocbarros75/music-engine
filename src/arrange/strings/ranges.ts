import type { VoiceRangeMap } from "./types";

// Preferred ranges calibrated from Beethoven Op. 18 No. 3 (966 measures, 12,138 notes):
//   Violin I    p10=66  p25=72  p75=82  p90=86   (outside current pref: 1.4%)
//   Violin II   p10=61  p25=64  p75=73  p90=77   (outside current pref: 1.2%)
//   Viola       p10=53  p25=57  p75=64  p90=67   (outside current pref: 3.9%)
//   Cello       p10=41  p25=45  p75=54  p90=58   (outside current pref: 0%)
//
// Previous prefMax for vln2 (90) and vla (84) were too high — Beethoven's
// Violin II never exceeds Bb5 (86) and Viola rarely exceeds G4 (67).
// Tightening these prefMax values stops the DP from placing inner voices in
// an unrealistically high register.
export const STRING_RANGES: VoiceRangeMap = {
  vln1: { absMin: 55, absMax: 100, prefMin: 62, prefMax: 88 }, // G3..E7; pref D4..E6 (Beethoven p10=66, p90=86)
  vln2: { absMin: 55, absMax:  96, prefMin: 57, prefMax: 79 }, // G3..C7; pref A3..G5 (Beethoven p10=61, p90=77)
  vla:  { absMin: 48, absMax:  93, prefMin: 50, prefMax: 70 }, // C3..A6; pref D3..Bb4 (Beethoven p10=53, p90=67)
  vc:   { absMin: 36, absMax:  76, prefMin: 38, prefMax: 60 }, // C2..E5; pref D2..C4 (Beethoven p10=41, p90=58)
  // Forsyth Orchestration p.439: "keep the Basses up" — bottom E-string (E1–G#1)
  // sounds like "hippos stirring up the mud"; prefer A1 (open 3rd string) and above.
  cb: { absMin: 28, absMax: 60, prefMin: 33, prefMax: 52 } // E1..C4; prefer A1+ (Forsyth)
};
