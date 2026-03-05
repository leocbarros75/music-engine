function up(s) {
    return String(s ?? "").toUpperCase().trim();
}
function isVishRoman(roman) {
    const r = up(roman);
    // Includes V, V7, V/V, etc, and vii° as dominant-function
    return r.startsWith("V") || r.includes("V/") || r.startsWith("VII");
}
function isIshRoman(roman) {
    const r = String(roman ?? "").trim();
    return r === "I" || r === "i";
}
function isIVishRoman(roman) {
    const r = String(roman ?? "").trim();
    // Treat borrowed backdoor chords as plagal-ish:
    // bVII -> I is a common "backdoor" cadence in major.
    return r === "IV" || r === "iv" || r === "bVII";
}
function isVIishRoman(roman) {
    const r = String(roman ?? "").trim();
    return r === "VI" || r === "vi";
}
function looksLikeV7(prev) {
    const prevRoman = up(prev?.roman?.roman ?? "");
    const q = prev?.chord?.quality ?? "unknown";
    if (q === "dom7")
        return true;
    if (prevRoman.startsWith("V") && prevRoman.includes("7"))
        return true;
    return false;
}
export function detectCadences(measures) {
    const out = [];
    for (let i = 1; i < measures.length; i++) {
        const prev = measures[i - 1];
        const last = measures[i];
        const prevR = prev?.roman?.roman ?? "N.C.";
        const lastR = last?.roman?.roman ?? "N.C.";
        let type = "none";
        let conf = 0;
        // Authentic cadence: V(7) -> I
        if (isVishRoman(prevR) && isIshRoman(lastR)) {
            if (looksLikeV7(prev)) {
                type = "authentic_perfect";
                conf = 0.9;
            }
            else {
                type = "authentic_imperfect";
                conf = 0.75;
            }
        }
        // Deceptive: V -> vi
        else if (isVishRoman(prevR) && isVIishRoman(lastR)) {
            type = "deceptive";
            conf = looksLikeV7(prev) ? 0.75 : 0.65;
        }
        // Half cadence: ends on V-ish
        else if (!isVishRoman(prevR) && isVishRoman(lastR)) {
            type = "half";
            conf = 0.6;
        }
        // Plagal / backdoor: IV (or bVII) -> I
        else if (isIVishRoman(prevR) && isIshRoman(lastR)) {
            type = "plagal";
            conf = prevR === "bVII" ? 0.55 : 0.6;
        }
        if (type !== "none") {
            out.push({
                atMeasure: last.measureNumber,
                type,
                confidence: conf,
                evidence: { prevRoman: prevR, lastRoman: lastR }
            });
        }
    }
    return out;
}
//# sourceMappingURL=cadence.js.map