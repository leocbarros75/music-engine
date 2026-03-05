type Mode = "major" | "minor";
export type KeySigResult = {
    tonic: string;
    mode: Mode;
    confidence: number;
    source: "key_signature";
};
export declare function keyFromScoreSignature(scoreModel: unknown): KeySigResult | null;
export {};
//# sourceMappingURL=KeyFromSignature.d.ts.map