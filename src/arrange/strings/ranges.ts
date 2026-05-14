import type { VoiceRangeMap } from "./types";

export const STRING_RANGES: VoiceRangeMap = {
  vln1: { absMin: 55, absMax: 100, prefMin: 60, prefMax: 93 }, // G3..E7
  vln2: { absMin: 55, absMax: 96, prefMin: 57, prefMax: 90 }, // G3..C7
  vla: { absMin: 48, absMax: 93, prefMin: 50, prefMax: 84 }, // C3..A6
  vc: { absMin: 36, absMax: 76, prefMin: 36, prefMax: 69 }, // C2..E5
  // Forsyth Orchestration p.439: "keep the Basses up" — bottom E-string (E1–G#1)
  // sounds like "hippos stirring up the mud"; prefer A1 (open 3rd string) and above.
  cb: { absMin: 28, absMax: 60, prefMin: 33, prefMax: 52 } // E1..C4; prefer A1+ (Forsyth)
};
