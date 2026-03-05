type KeyLike = {
    tonic: string;
    mode: "major" | "minor";
    confidence: number;
};
export type KeyChange = {
    atMeasure: number;
    from: KeyLike;
    to: KeyLike;
    confidence: number;
    reason: string;
};
/**
 * Simple key-change detector:
 * - Uses a sliding window histogram
 * - Picks a best-guess key per window
 * - Emits a change when the guess differs from the previous stable key
 *
 * Conservative on purpose.
 */
export declare function detectKeyChanges(params: {
    measureCount: number;
    getMeasurePcs: (measureIndex0: number) => number[];
    baseKey: KeyLike;
    windowSize?: number;
    minConfidence?: number;
}): KeyChange[];
export {};
//# sourceMappingURL=modulation.d.ts.map