// src/arrange/enforceRanges.ts
import type { ScoreModel } from "../score/types";
import { enforceInstrumentRangesOnScore } from "../instruments/instrumentCatalog";

/**
 * Phase 3: Instrument range enforcement (concert pitch)
 * Single source of truth: InstrumentCatalog.
 *
 * We export BOTH names to avoid runtime mismatches:
 * - enforceRanges(score)
 * - enforceRangesOnScore(score)
 */
export function enforceRanges(score: ScoreModel): ScoreModel {
  return enforceInstrumentRangesOnScore(score) as ScoreModel;
}

// Back-compat alias (some codepaths call this name)
export const enforceRangesOnScore = enforceRanges;