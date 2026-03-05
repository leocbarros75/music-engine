import type { ScoreModel } from "../score/types";
/**
 * Simple “open” brass voicing from piano chord onsets:
 * - Tuba gets root (lowest note)
 * - Trombone gets 3rd/5th region (next low)
 * - Bass trombone supports low harmony (optional: 5th/root)
 * - Horn sits mid
 * - Trumpets take top two notes
 *
 * This is a FIRST PASS arrangement for testing pipeline integrity.
 * Later we’ll add idiomatic brass ranges/articulations, transposition, and voice-leading.
 */
export declare function mapPianoToBrassEnsembleOpen(score: ScoreModel): ScoreModel;
//# sourceMappingURL=mapPianoToBrassEnsemble.d.ts.map