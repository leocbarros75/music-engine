import type { ScoreModel } from "../score/types";
/**
 * Phase 3: Instrument range enforcement (concert pitch)
 * Single source of truth: InstrumentCatalog.
 *
 * We export BOTH names to avoid runtime mismatches:
 * - enforceRanges(score)
 * - enforceRangesOnScore(score)
 */
export declare function enforceRanges(score: ScoreModel): ScoreModel;
export declare const enforceRangesOnScore: typeof enforceRanges;
//# sourceMappingURL=enforceRanges.d.ts.map