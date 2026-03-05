import type { ScoreModel } from "../score/types";
import { type Pitch } from "../instruments/instrumentCatalog";
export type OnsetChord = {
    measure: number;
    t: number;
    notes: Array<{
        id: string;
        midi: number;
        pitch: Pitch;
        staff: number;
        voice: number;
    }>;
};
export declare function extractOnsetChords(score: ScoreModel): OnsetChord[];
//# sourceMappingURL=chordExtractor.d.ts.map