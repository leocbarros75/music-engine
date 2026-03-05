export type Pitch = {
    step: string;
    alter?: number;
    octave: number;
};
export type InstrumentId = "violin_1" | "violin_2" | "viola" | "cello" | "piano" | "flute" | "oboe" | "clarinet_bb" | "bassoon" | "trumpet_bb_1" | "trumpet_bb_2" | "horn_f" | "trombone" | "tuba_c" | "timpani" | "glockenspiel" | "tubular_bells" | "vibraphone" | "marimba" | "xylophone";
export type InstrumentSpec = {
    id: InstrumentId;
    name: string;
    clef: "treble" | "alto" | "bass";
    midi_low: number;
    midi_high: number;
    preferred_low?: number;
    preferred_high?: number;
};
export declare function pitchToMidi(p: Pitch): number;
export declare function midiToPitch(m: number): Pitch;
export declare function shiftOctavesIntoRange(midi: number, lo: number, hi: number): number;
export declare const InstrumentCatalog: Record<InstrumentId, InstrumentSpec>;
export declare function getInstrumentSpec(instrument: string | undefined): InstrumentSpec | null;
export declare function clampMidiToInstrumentRange(midi: number, spec: InstrumentSpec): number;
export declare function clampPitchToInstrumentRange(p: Pitch, instrument: string | undefined): Pitch;
/**
 * Enforce ranges for every pitched note in a ScoreModel.
 * - leaves rests + unpitched alone
 * - clamps by shifting octaves into preferred, then absolute
 */
export declare function enforceInstrumentRangesOnScore(score: any): any;
//# sourceMappingURL=instrumentCatalog.d.ts.map