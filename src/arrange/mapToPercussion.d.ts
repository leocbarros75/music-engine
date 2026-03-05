import type { ScoreModel } from "../score/types";
type PercStyle = "swing" | "bossa" | "ballad";
export type PercussionOptions = {
    style?: PercStyle;
    enableSwingSkip?: boolean;
    includeSnareBackbeat?: boolean;
    includeHiHatBackbeat?: boolean;
    kickOnChordOnsets?: boolean;
    hitDurFraction?: number;
    enableTimpani?: boolean;
    enableSuspendedCymbal?: boolean;
    enableMallets?: boolean;
    enableBells?: boolean;
    enableChimes?: boolean;
    susCymbalMode?: "hit" | "roll";
    susCymbalRollWholeBar?: boolean;
};
/**
 * Map any input ScoreModel to a percussion ScoreModel.
 *
 * Output parts:
 * - DRUMS: unpitched drumset + colors (suspended cymbal, mallets, bells, chimes)
 * - TIMP: pitched timpani (simple pattern for now)
 */
export declare function mapToPercussion(score: ScoreModel, options?: PercussionOptions): ScoreModel;
export declare function mapPianoToPercussionOpen(score: ScoreModel, options?: PercussionOptions): ScoreModel;
export {};
//# sourceMappingURL=mapToPercussion.d.ts.map