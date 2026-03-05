import { enforceInstrumentRangesOnScore } from "../instruments/instrumentCatalog";
/**
 * Phase 3: Instrument range enforcement (concert pitch)
 * Single source of truth: InstrumentCatalog.
 *
 * We export BOTH names to avoid runtime mismatches:
 * - enforceRanges(score)
 * - enforceRangesOnScore(score)
 */
export function enforceRanges(score) {
    return enforceInstrumentRangesOnScore(score);
}
// Back-compat alias (some codepaths call this name)
export const enforceRangesOnScore = enforceRanges;
//# sourceMappingURL=enforceRanges.js.map