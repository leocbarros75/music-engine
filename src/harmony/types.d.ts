export type Pitch = {
    step: string;
    alter?: number;
    octave: number;
};
export type KeyMode = "major" | "minor" | "unknown";
export type KeyEstimate = {
    tonic: string;
    mode: KeyMode;
    confidence: number;
};
export type ChordQuality = "maj" | "min" | "dim" | "aug" | "sus2" | "sus4" | "dom7" | "maj7" | "min7" | "hdim7" | "dim7" | "unknown";
export type ChordInfo = {
    pcs: number[];
    rootPc: number | null;
    bassPc: number | null;
    quality: ChordQuality;
    name: string;
};
export type RomanAnalysis = {
    roman: string;
    degree: number | null;
    functionTag: "tonic" | "predominant" | "dominant" | "other";
    secondaryOf?: string;
    notes: string[];
};
export type MeasureHarmony = {
    measureNumber: number;
    chord: ChordInfo;
    roman: RomanAnalysis;
};
export type BeatHarmony = {
    measureNumber: number;
    beatNumber: number;
    chord: ChordInfo;
    roman: RomanAnalysis;
};
export type CadenceType = "authentic_perfect" | "authentic_imperfect" | "half" | "plagal" | "deceptive" | "phrygian" | "none";
export type CadenceDetection = {
    atMeasure: number;
    type: CadenceType;
    confidence: number;
    evidence: {
        prevRoman?: string;
        lastRoman?: string;
    };
};
export type HarmonyAnalysisResult = {
    ok: true;
    engine: {
        phase: string;
        granularity: "measure";
        romanNumerals: true;
        tonicizations: "brief";
        sustainPolicy: "overlap";
    };
    key: KeyEstimate;
    measures: MeasureHarmony[];
    cadences: CadenceDetection[];
} | {
    ok: true;
    engine: {
        phase: string;
        granularity: "beat";
        romanNumerals: true;
        tonicizations: "brief";
        sustainPolicy: "overlap";
    };
    key: KeyEstimate;
    beats: BeatHarmony[];
    cadences: CadenceDetection[];
};
export type HarmonyAnalysisError = {
    ok: false;
    error: string;
};
export type HarmonyAnalyzeRequest = {
    scoreModel?: any;
    musicxml?: string;
    options?: {
        granularity?: "measure" | "beat";
        preferKeyFromMeta?: boolean;
        forceKey?: {
            tonic: string;
            mode: "major" | "minor";
        };
        maxMeasures?: number;
        ignorePercussion?: boolean;
    };
};
//# sourceMappingURL=types.d.ts.map