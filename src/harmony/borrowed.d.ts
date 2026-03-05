type KeyLike = {
    tonic: string;
    mode: "major" | "minor";
    confidence?: number;
};
type BorrowedHint = {
    measureNumber: number;
    beatNumber?: number;
    chordName: string;
    chordQuality: string;
    rootPc: number | null;
    suggestedRoman: string;
    reason: string;
};
/**
 * Very conservative mixture hints.
 * We do NOT change your roman output here.
 * We only add "borrowedHints" as an optional annotation for debugging and later upgrades.
 */
export declare function borrowedChordHint(params: {
    key: KeyLike;
    chord: any;
    measureNumber: number;
    beatNumber?: number;
}): BorrowedHint | null;
export {};
//# sourceMappingURL=borrowed.d.ts.map