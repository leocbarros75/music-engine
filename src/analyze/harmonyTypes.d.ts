import type { Pitch } from "../instruments/instrumentCatalog";
export type HarmonyMode = "major" | "minor" | "unknown";
export type KeySignature = {
    fifths: number;
    mode: HarmonyMode;
};
export type ChordQuality = "maj" | "min" | "dim" | "aug" | "7" | "maj7" | "min7" | "hdim7" | "dim7";
export type HarmonyChord = {
    t: number;
    pitches?: Pitch[];
    pcs?: number[];
    rootPc?: number;
    quality?: ChordQuality;
    inversion?: 0 | 1 | 2 | 3;
    symbol?: string;
    confidence?: number;
};
export type HarmonyMeasure = {
    measureNumber: number;
    key?: KeySignature;
    chords: HarmonyChord[];
};
export type HarmonyAnalysis = {
    version: "harmony_v1";
    concertPitch: true;
    per: "measure";
    measures: HarmonyMeasure[];
};
//# sourceMappingURL=harmonyTypes.d.ts.map