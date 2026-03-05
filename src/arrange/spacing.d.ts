import { type InstrumentId } from "../instruments/instrumentCatalog";
export type SpacingMode = "open_classical" | "compact";
export type SpacingVoice = {
    instrumentId: InstrumentId;
    midi: number;
};
export type SpacingOptions = {
    mode: SpacingMode;
    minGapAboveC4?: number;
    minGapMid?: number;
    minGapLow?: number;
};
/**
 * Space a single vertical slice (one chord moment) using octave shifts only.
 * Input is any set of voices with initial midi choices.
 * Output has the same voices with adjusted midi pitches.
 */
export declare function applySpacingToSlice(input: SpacingVoice[], mode: SpacingMode, options?: Partial<SpacingOptions>): SpacingVoice[];
/**
 * Apply spacing to many time-slices.
 * This stays simple: the caller decides how to group notes into slices.
 */
export declare function applySpacingToSlices(slices: SpacingVoice[][], mode: SpacingMode, options?: Partial<SpacingOptions>): SpacingVoice[][];
//# sourceMappingURL=spacing.d.ts.map