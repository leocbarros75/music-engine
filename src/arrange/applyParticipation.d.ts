import type { ScoreModel } from "../score/types";
export type ParticipationWeights = {
    strings?: number;
    woodwinds?: number;
    brass?: number;
    percussion?: number;
};
export type ParticipationRules = {
    weights: ParticipationWeights;
    phraseLen?: 1 | 2 | 4 | 8;
    maxActive?: Partial<Record<"strings" | "woodwinds" | "brass" | "percussion", number>>;
    rotation?: {
        repeatPenalty?: number;
    };
};
/**
 * Phase 2: phrase-based participation (now supports per-measure when phraseLen = 1)
 * - Choose active instruments per block (1/2/4/8 measures).
 * - Apply caps per family and rotation penalty across blocks.
 * - If a part is inactive for a measure, replace it with a full-measure rest (keeps exporter simple).
 */
export declare function applyParticipationByPhrase(score: ScoreModel, rules: ParticipationRules, seed?: number): ScoreModel;
//# sourceMappingURL=applyParticipation.d.ts.map