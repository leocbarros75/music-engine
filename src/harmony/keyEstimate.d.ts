import type { KeyEstimate } from "./types";
export declare function estimateKeyFromPcHistogram(hist: number[], preferSharps?: boolean): KeyEstimate;
export declare function keyFromMetaOrBestGuess(metaKey: any | null, hist: number[], preferSharps?: boolean): KeyEstimate;
export declare function tonicPcFromKey(key: KeyEstimate): number;
//# sourceMappingURL=keyEstimate.d.ts.map