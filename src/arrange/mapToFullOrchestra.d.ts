import type { ScoreModel } from "../score/types";
type Section = "strings" | "woodwinds" | "brass" | "percussion";
export type FullOrchestraOptions = {
    profile?: "classical";
    blockMeasures?: number;
    targets?: Partial<Record<Section, number>>;
};
/**
 * Map a piano (or any single source part) ScoreModel into a full orchestra scaffold,
 * then apply classical participation + range enforcement.
 *
 * - Concert pitch (no transposition handling yet)
 * - Participation only when profile === "classical"
 * - Phrase length uses blockMeasures (2/4/8), default 2
 */
export declare function mapPianoToFullOrchestraOpen(score: ScoreModel, opts?: FullOrchestraOptions): ScoreModel;
export {};
//# sourceMappingURL=mapToFullOrchestra.d.ts.map