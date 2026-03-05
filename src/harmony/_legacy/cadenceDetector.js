// src/harmony/cadenceDetector.ts
export function detectCadence(phrase, mode) {
    if (phrase.length < 2)
        return "NONE";
    const last = phrase[phrase.length - 1].roman;
    const prev = phrase[phrase.length - 2].roman;
    // Perfect Authentic Cadence
    if (prev === "V" && last === "I" && mode === "major")
        return "PAC";
    if (prev === "V" && last === "i" && mode === "minor")
        return "PAC";
    // Imperfect Authentic Cadence
    if (prev === "V" && (last === "I" || last === "i"))
        return "IAC";
    // Half Cadence
    if (last === "V")
        return "HC";
    // Plagal Cadence
    if (prev === "IV" && last === "I")
        return "PC";
    // Deceptive Cadence
    if (prev === "V" && (last === "vi" || last === "VI"))
        return "DC";
    return "NONE";
}
//# sourceMappingURL=cadenceDetector.js.map