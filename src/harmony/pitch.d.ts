import type { Pitch } from "./types";
export declare function pitchToMidi(p: Pitch): number;
export declare function midiToPc(m: number): number;
export declare function pcToName(pc: number, preferSharps?: boolean): string;
export declare function normalizeTonicName(s: string): string;
export declare function tonicNameToPc(tonic: string): number;
//# sourceMappingURL=pitch.d.ts.map