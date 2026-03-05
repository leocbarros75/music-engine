import type { ScoreModel } from "../score/types";
import type { HarmonyAnalysis } from "./harmonyTypes";
/**
 * Phase 1 harmony analyzer:
 * - per measure
 * - on each onset time inside the measure, compute a chord label from pitch classes
 * - concert pitch only
 */
export declare function analyzeHarmonyPerMeasure(score: ScoreModel): HarmonyAnalysis;
/**
 * Helper to attach analysis into score.meta.harmony (internal only).
 */
export declare function attachHarmonyToScore(score: ScoreModel): ScoreModel;
//# sourceMappingURL=harmonyAnalyzer.d.ts.map