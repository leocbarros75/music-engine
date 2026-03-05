import type { ScoreModel } from "../score/types";
/**
 * Existing mapping you already had.
 * Keeps string quartet open spacing heuristics.
 */
export declare function mapPianoToStringQuartetOpen(score: ScoreModel): ScoreModel;
/**
 * NEW: Basic "full_orchestra" mapping.
 * Goal: get a valid multi-part score, preserve rhythm on onsets, keep notes in range.
 * This is intentionally simple and conservative.
 */
export declare function mapPianoToFullOrchestraBasic(score: ScoreModel): ScoreModel;
/**
 * Dispatcher. This is the piece you were missing.
 * Your arrange endpoint should call this.
 */
export declare function mapToEnsemble(score: ScoreModel, ensemble: string): ScoreModel;
//# sourceMappingURL=mapToEnsemble.d.ts.map