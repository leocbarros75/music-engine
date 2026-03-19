import type { ScoreModel } from "../score/types";
export type WoodwindMapOptions = {
    level?: "beginner" | "intermediate" | "advanced" | "professional";
    accompaniment?: string;
    textureMode?: string;
    chords?: Array<{
        measure: number;
        t: number;
        symbol: string;
    }>;
    warnings?: string[];
    fluteActivity?: "grounded" | "less_active" | "active" | "high_active";
    oboeActivity?: "grounded" | "less_active" | "active" | "high_active";
    clarinetActivity?: "grounded" | "less_active" | "active" | "high_active";
    bassoonActivity?: "grounded" | "less_active" | "active" | "high_active";
};
/**
 * Woodwind ensemble mapping (Option 1, Concert Pitch View):
 * Flute (C), Oboe (C), Clarinet in Bb (shows concert pitch), Bassoon (C)
 *
 * IMPORTANT:
 * - Because you chose concert pitch view, we store + export concert pitches.
 * - The exporter should NOT emit <transpose> tags for this view.
 */
export declare function mapPianoToWoodwindEnsembleOpen(score: ScoreModel, options?: WoodwindMapOptions): ScoreModel;
//# sourceMappingURL=mapToWoodwindEnsemble.d.ts.map
