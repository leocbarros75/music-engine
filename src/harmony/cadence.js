"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectCadences = detectCadences;
function up(s) {
    return String(s !== null && s !== void 0 ? s : "").toUpperCase().trim();
}
function isVishRoman(roman) {
    var r = up(roman);
    // Includes V, V7, V/V, etc, and vii° as dominant-function
    return r.startsWith("V") || r.includes("V/") || r.startsWith("VII");
}
function isIshRoman(roman) {
    var r = String(roman !== null && roman !== void 0 ? roman : "").trim();
    return r === "I" || r === "i";
}
function isIVishRoman(roman) {
    var r = String(roman !== null && roman !== void 0 ? roman : "").trim();
    // Treat borrowed backdoor chords as plagal-ish:
    // bVII -> I is a common "backdoor" cadence in major.
    return r === "IV" || r === "iv" || r === "bVII";
}
function isVIishRoman(roman) {
    var r = String(roman !== null && roman !== void 0 ? roman : "").trim();
    return r === "VI" || r === "vi";
}
function looksLikeV7(prev) {
    var _a, _b, _c, _d;
    var prevRoman = up((_b = (_a = prev === null || prev === void 0 ? void 0 : prev.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "");
    var q = (_d = (_c = prev === null || prev === void 0 ? void 0 : prev.chord) === null || _c === void 0 ? void 0 : _c.quality) !== null && _d !== void 0 ? _d : "unknown";
    if (q === "dom7")
        return true;
    if (prevRoman.startsWith("V") && prevRoman.includes("7"))
        return true;
    return false;
}
function detectCadences(measures) {
    var _a, _b, _c, _d;
    var out = [];
    for (var i = 1; i < measures.length; i++) {
        var prev = measures[i - 1];
        var last = measures[i];
        var prevR = (_b = (_a = prev === null || prev === void 0 ? void 0 : prev.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "N.C.";
        var lastR = (_d = (_c = last === null || last === void 0 ? void 0 : last.roman) === null || _c === void 0 ? void 0 : _c.roman) !== null && _d !== void 0 ? _d : "N.C.";
        var type = "none";
        var conf = 0;
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
                type: type,
                confidence: conf,
                evidence: { prevRoman: prevR, lastRoman: lastR }
            });
        }
    }
    return out;
}
