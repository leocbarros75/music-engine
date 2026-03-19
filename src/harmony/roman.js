"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeRomanNumeral = analyzeRomanNumeral;
exports.chordNotesToNames = chordNotesToNames;
var pitch_1 = require("./pitch");
var keyEstimate_1 = require("./keyEstimate");
var MAJOR_DEGREE_PCS = [0, 2, 4, 5, 7, 9, 11];
var MINOR_HARMONIC_DEGREE_PCS = [0, 2, 3, 5, 7, 8, 11];
function mod12(n) {
    return ((n % 12) + 12) % 12;
}
function degreeFromPcInKey(pc, key) {
    var tonicPc = (0, keyEstimate_1.tonicPcFromKey)(key);
    var rel = mod12(pc - tonicPc);
    var scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;
    var idx = scale.indexOf(rel);
    if (idx < 0)
        return null;
    return idx + 1;
}
function romanBaseFromDegree(deg) {
    return (deg === 1 ? "I" :
        deg === 2 ? "II" :
            deg === 3 ? "III" :
                deg === 4 ? "IV" :
                    deg === 5 ? "V" :
                        deg === 6 ? "VI" :
                            deg === 7 ? "VII" : "I");
}
function romanFromDegree(deg, quality) {
    var base = romanBaseFromDegree(deg);
    if (quality === "min")
        return base.toLowerCase();
    if (quality === "dim")
        return base.toLowerCase() + "°";
    if (quality === "hdim7")
        return base.toLowerCase() + "ø7";
    if (quality === "dim7")
        return base.toLowerCase() + "°7";
    if (quality === "dom7")
        return base + "7";
    if (quality === "min7")
        return base.toLowerCase() + "7";
    if (quality === "maj7")
        return base + "maj7";
    return base;
}
function functionTagFromDegree(deg) {
    if (deg === 1 || deg === 3 || deg === 6)
        return "tonic";
    if (deg === 2 || deg === 4)
        return "predominant";
    if (deg === 5 || deg === 7)
        return "dominant";
    return "other";
}
function isSeventhChordQuality(q) {
    return q === "dom7" || q === "maj7" || q === "min7" || q === "hdim7" || q === "dim7";
}
function inversionFigure(chord) {
    var _a;
    var root = chord.rootPc;
    var bass = chord.bassPc;
    if (root === null)
        return "";
    if (bass === null)
        return "";
    var pcs = (_a = chord.pcs) !== null && _a !== void 0 ? _a : [];
    var r = mod12(root);
    var third = pcs.includes(mod12(r + 4)) ? mod12(r + 4) :
        pcs.includes(mod12(r + 3)) ? mod12(r + 3) :
            null;
    var fifth = pcs.includes(mod12(r + 7)) ? mod12(r + 7) :
        pcs.includes(mod12(r + 6)) ? mod12(r + 6) :
            pcs.includes(mod12(r + 8)) ? mod12(r + 8) :
                null;
    var seventh = pcs.includes(mod12(r + 10)) ? mod12(r + 10) :
        pcs.includes(mod12(r + 11)) ? mod12(r + 11) :
            pcs.includes(mod12(r + 9)) ? mod12(r + 9) :
                null;
    var is7 = isSeventhChordQuality(chord.quality);
    if (!is7) {
        if (bass === r)
            return "";
        if (third !== null && bass === third)
            return "6";
        if (fifth !== null && bass === fifth)
            return "64";
        return "";
    }
    if (bass === r)
        return "7";
    if (third !== null && bass === third)
        return "65";
    if (fifth !== null && bass === fifth)
        return "43";
    if (seventh !== null && bass === seventh)
        return "42";
    return "7";
}
function applyInversionToRoman(roman, figure) {
    if (!figure)
        return roman;
    var slash = roman.indexOf("/");
    if (slash >= 0) {
        var left = roman.slice(0, slash);
        var right = roman.slice(slash);
        if (/\d$/.test(left))
            return roman;
        return "".concat(left).concat(figure).concat(right);
    }
    if (/\d$/.test(roman))
        return roman;
    return "".concat(roman).concat(figure);
}
function borrowedMixtureRomanIfAny(chord, key) {
    var _a, _b;
    var mode = String((_a = key === null || key === void 0 ? void 0 : key.mode) !== null && _a !== void 0 ? _a : "").toLowerCase();
    if (mode !== "major")
        return null;
    var root = chord === null || chord === void 0 ? void 0 : chord.rootPc;
    if (typeof root !== "number")
        return null;
    var tonicPc = (0, pitch_1.tonicNameToPc)(key.tonic);
    var rel = mod12(root - tonicPc);
    var q = String((_b = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _b !== void 0 ? _b : "").toLowerCase();
    // Common borrowed chords in major:
    if (q === "maj" && rel === 3)
        return { roman: "bIII", degree: 3, functionTag: "tonic" };
    if (q === "maj" && rel === 8)
        return { roman: "bVI", degree: 6, functionTag: "predominant" };
    if (q === "maj" && rel === 10)
        return { roman: "bVII", degree: 7, functionTag: "predominant" };
    return null;
}
function targetRomanFromDegree(targetDeg) {
    return (targetDeg === 2 ? "ii" :
        targetDeg === 3 ? "iii" :
            targetDeg === 4 ? "IV" :
                targetDeg === 5 ? "V" :
                    targetDeg === 6 ? "vi" :
                        "vii°");
}
function diatonicPcSetForKey(key) {
    var tonicPc = (0, pitch_1.tonicNameToPc)(key.tonic);
    var scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;
    var s = new Set();
    for (var _i = 0, scale_1 = scale; _i < scale_1.length; _i++) {
        var rel = scale_1[_i];
        s.add(mod12(tonicPc + rel));
    }
    return s;
}
function chordHasChromaticTone(chord, key) {
    var pcs = Array.isArray(chord === null || chord === void 0 ? void 0 : chord.pcs) ? chord.pcs : [];
    var diatonic = diatonicPcSetForKey(key);
    for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
        var pc = pcs_1[_i];
        var p = mod12(pc);
        if (!diatonic.has(p))
            return true;
    }
    return false;
}
/**
 * Secondary function detection (Phase 4.3, conservative)
 *
 * Detect:
 * - V/target as dom7 always (strong evidence)
 * - V/target as MAJOR TRIAD only when the chord contains chromatic tones outside the key scale
 * - vii°/target as dim / ø7 / °7 (these are typically chromatic anyway)
 *
 * Returns the roman string and "secondaryOf" = the target roman (expected resolution).
 */
function detectSecondaryFunction(chord, key) {
    var _a;
    var rootPc = chord === null || chord === void 0 ? void 0 : chord.rootPc;
    if (typeof rootPc !== "number")
        return null;
    var q = String((_a = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var tonicPc = (0, pitch_1.tonicNameToPc)(key.tonic);
    var scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;
    var hasChromatic = chordHasChromaticTone(chord, key);
    for (var i = 0; i < 7; i++) {
        var targetDeg = i + 1;
        if (targetDeg === 1)
            continue;
        var targetPc = mod12(tonicPc + scale[i]);
        var vOfTarget = mod12(targetPc + 7);
        var ltOfTarget = mod12(targetPc - 1);
        var targetRoman = targetRomanFromDegree(targetDeg);
        // V/target as dom7 (allow even if chord tones happen to be diatonic)
        if (q === "dom7" && mod12(rootPc) === vOfTarget) {
            return { roman: "V/".concat(targetRoman), secondaryOf: targetRoman };
        }
        // V/target as major triad ONLY with chromatic evidence
        if (q === "maj" && hasChromatic && mod12(rootPc) === vOfTarget) {
            return { roman: "V/".concat(targetRoman), secondaryOf: targetRoman };
        }
        // vii°/target as dim / ø7 / °7
        if ((q === "dim" || q === "hdim7" || q === "dim7") && mod12(rootPc) === ltOfTarget) {
            var base = q === "hdim7" ? "viiø7" :
                q === "dim7" ? "vii°7" :
                    "vii°";
            return { roman: "".concat(base, "/").concat(targetRoman), secondaryOf: targetRoman };
        }
    }
    return null;
}
function analyzeRomanNumeral(chord, key, notes) {
    if (!chord || chord.rootPc === null) {
        return { roman: "N.C.", degree: null, functionTag: "other", notes: notes };
    }
    var deg = degreeFromPcInKey(chord.rootPc, key);
    var functionTag = functionTagFromDegree(deg);
    // 1) Secondary function chords (Phase 4.3, conservative)
    {
        var sec = detectSecondaryFunction(chord, key);
        if (sec) {
            var fig_1 = inversionFigure(chord);
            var roman_1 = applyInversionToRoman(sec.roman, fig_1);
            return {
                roman: roman_1,
                degree: deg,
                functionTag: "dominant",
                secondaryOf: sec.secondaryOf,
                notes: notes
            };
        }
    }
    // 2) Borrowed mixture in major when degree is non-diatonic (deg=null)
    if (deg === null) {
        var mix = borrowedMixtureRomanIfAny(chord, key);
        if (mix) {
            var fig_2 = inversionFigure(chord);
            var roman_2 = applyInversionToRoman(mix.roman, fig_2);
            return { roman: roman_2, degree: mix.degree, functionTag: mix.functionTag, notes: notes };
        }
    }
    // 3) Diatonic roman + inversion figure, else chord name
    var roman = deg ? romanFromDegree(deg, chord.quality) : chord.name;
    var fig = inversionFigure(chord);
    var is7 = isSeventhChordQuality(chord.quality);
    if (is7) {
        if (fig === "65" || fig === "43" || fig === "42") {
            roman = roman.replace(/7$/, "");
            roman = applyInversionToRoman(roman, fig);
        }
    }
    else {
        if (fig === "6" || fig === "64")
            roman = applyInversionToRoman(roman, fig);
    }
    return { roman: roman, degree: deg, functionTag: functionTag, notes: notes };
}
function chordNotesToNames(pcs, preferSharps) {
    if (preferSharps === void 0) { preferSharps = true; }
    return (pcs !== null && pcs !== void 0 ? pcs : []).map(function (pc) { return (0, pitch_1.pcToName)(pc, preferSharps); });
}
