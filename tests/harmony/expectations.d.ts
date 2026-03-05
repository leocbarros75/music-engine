export type HarmonyOutput = {
    ok: boolean;
    key?: {
        tonic?: string;
        mode?: string;
    };
    beats?: Array<{
        measureNumber: number;
        beatNumber: number;
        roman?: {
            roman?: string;
        };
        chord?: {
            pcs?: number[];
        };
    }>;
    cadences?: Array<{
        atMeasure: number;
        type: string;
        evidence?: {
            prevRoman?: string;
            lastRoman?: string;
        };
    }>;
};
export type Expectation = {
    id: string;
    key?: {
        tonic: string;
        mode: string;
    };
    beatRomans?: Array<{
        measure: number;
        beat: number;
        roman: string;
    }>;
    cadenceTypes?: Array<{
        atMeasure: number;
        type: string;
    }>;
    cadenceEvidence?: Array<{
        atMeasure: number;
        prevRoman: string;
        lastRoman: string;
    }>;
    requireNonEmptyChordOnBeat1OfMeasures?: number[];
};
export declare const EXPECTATIONS_BY_BASENAME: Record<string, Expectation>;
//# sourceMappingURL=expectations.d.ts.map