import type { VoiceRangeMap } from "./types";

// Preferred ranges cross-calibrated from two independent orchestral datasets:
//
//   Beethoven Op.18 No.3 (966 measures, 12,138 notes):
//     Vln I  p10=66 p25=72 p75=82 p90=86   Vln II p10=61 p25=64 p75=73 p90=77
//     Viola  p10=53 p25=57 p75=64 p90=67   Cello  p10=41 p25=45 p75=54 p90=58
//
//   Handel Messiah (1174 measures, full oratorio — baroque orchestral texture):
//     Vln I  p10=66 p25=70 p75=78 p90=81   Vln II p10=62 p25=65 p75=74 p90=78
//     Viola  p10=59 p25=62 p75=69 p90=72   KB     p10=45 p25=48 p75=57 p90=59
//
// prefMax for Viola raised to 72 (Handel Viola p90=72, vs Beethoven p90=67).
// prefMax for cb raised to 58 (Handel Kontrabas p75=57; old 52 penalised 25% of notes).
export const STRING_RANGES: VoiceRangeMap = {
  vln1: { absMin: 55, absMax: 100, prefMin: 62, prefMax: 88 }, // G3..E7; pref D4..E6
  vln2: { absMin: 55, absMax:  96, prefMin: 57, prefMax: 79 }, // G3..C7; pref A3..G5
  vla:  { absMin: 48, absMax:  93, prefMin: 50, prefMax: 72 }, // C3..A6; pref D3..C5 (Handel p90=72)
  vc:   { absMin: 36, absMax:  76, prefMin: 38, prefMax: 60 }, // C2..E5; pref D2..C4
  // Forsyth Orchestration p.439: "keep the Basses up" — bottom E-string (E1–G#1)
  // sounds like "hippos stirring up the mud"; prefer A1 (open 3rd string) and above.
  // prefMax raised to 58 (A3): Handel Messiah Kontrabas p75=57 — old ceiling of 52 (E3)
  // penalised a quarter of all Handel bass notes as out-of-preference range.
  cb: { absMin: 28, absMax: 60, prefMin: 33, prefMax: 58 } // E1..C4; prefer A1..Bb3
};
