import type { ScoreModel } from "../score/types";
type JazzStyle = "swing" | "bossa" | "ballad";
type JazzBandOptions = {
    style?: JazzStyle;
    pianoAddBeat4?: boolean;
    pianoAddAnticipation?: boolean;
    drumEnableSwingOffbeats?: boolean;
    drumAddSnareComping?: boolean;
    drumCrashOnSectionStarts?: boolean;
};
/**
 * Jazz Band mapping:
 * Alto Sax (Eb), Tenor Sax (Bb), Trumpet (Bb), Trombone (C), Piano (C), Bass (C), Drums (style preset)
 *
 * Notes:
 * - We store pitches in concert in the ScoreModel.
 * - The exporter handles written pitch/key for transposing parts via <transpose>.
 * - Bass stays as-is per your request.
 */
export declare function mapPianoToJazzBandOpen(score: ScoreModel, options?: JazzBandOptions): ScoreModel;
export {};
//# sourceMappingURL=mapToJazzBand.d.ts.map