import type { ScoreModel } from "../score/types";
/**
 * Keep the brass score in WRITTEN pitch (so MuseScore can toggle “Concert Pitch” correctly
 * using the MusicXML <transpose> tags you added in the exporter).
 *
 * Key tweak here:
 * - Trumpets were drifting up an octave because the target centers were too high.
 * - Horn was landing too low in CONCERT terms (written too low) — raise its written center.
 */
export declare function mapPianoToBrassEnsembleOpen(score: ScoreModel): ScoreModel;
//# sourceMappingURL=mapToBrassEnsemble.d.ts.map