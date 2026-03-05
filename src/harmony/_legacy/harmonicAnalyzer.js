// src/harmony/harmonicAnalyzer.ts
import { detectCadence } from "./cadenceDetector";
export function analyzeFourBarHarmony() {
    // TEMPORARY: classical test phrase (Phase 3.1)
    // I – IV – V – I in C Major
    const key = "C";
    const mode = "major";
    const measures = [
        { measure: 1, roman: "I" },
        { measure: 2, roman: "IV" },
        { measure: 3, roman: "V" },
        { measure: 4, roman: "I" }
    ];
    const cadence = detectCadence(measures, mode);
    return {
        key,
        mode,
        measures,
        cadence
    };
}
//# sourceMappingURL=harmonicAnalyzer.js.map