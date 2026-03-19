"use strict";
// src/harmonize/satb/chordSymbol.ts
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseChordSymbol = parseChordSymbol;
var PC_BY_NAME = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11
};
function clampPc(x) {
    var v = x % 12;
    return v < 0 ? v + 12 : v;
}
/**
 * Supports: C, Am, Cmin, Cmaj7, C7, Cm7, Cdim, Caug, C°7, Cø7 (basic)
 * This is only for the SATB baseline.
 */
function parseChordSymbol(symbolRaw) {
    var _a, _b;
    var s = (symbolRaw !== null && symbolRaw !== void 0 ? symbolRaw : "").trim();
    if (!s)
        return null;
    // Root: letter + optional accidental
    var m = s.match(/^([A-Ga-g])([#b]?)(.*)$/);
    if (!m)
        return null;
    var letter = m[1].toUpperCase();
    var accidental = (_a = m[2]) !== null && _a !== void 0 ? _a : "";
    var rest = ((_b = m[3]) !== null && _b !== void 0 ? _b : "").trim();
    var rootName = "".concat(letter).concat(accidental);
    var rootPc = PC_BY_NAME[rootName];
    if (typeof rootPc !== "number")
        return null;
    // Quality detection (minimal)
    var lower = rest.toLowerCase();
    var isDim = lower.includes("dim") || rest.includes("°");
    var isHalfDim = rest.includes("ø");
    var isAug = lower.includes("aug");
    var isMin = lower.startsWith("m") || lower.includes("min");
    var isMaj7 = lower.includes("maj7");
    var isMaj9 = lower.includes("maj9") || lower.includes("ma9");
    var is7 = lower === "7" || lower.endsWith("7") || lower.includes("dom7");
    var isSus2 = lower.includes("sus2");
    var isSus4 = lower.includes("sus") && !isSus2;
    var hasAdd2 = lower.includes("add2") || lower === "2" || (lower.includes(" 2") && !lower.includes("sus2"));
    var hasAdd4 = lower.includes("add4") || lower.includes("(4)");
    var hasAdd6 = lower.includes("6") && !lower.includes("16") && !lower.includes("m6");
    var hasAdd9 = lower.includes("add9") || lower.includes(" 9") || lower === "9" || isMaj9;
    // Base triad
    var third = 4;
    var fifth = 7;
    if (isMin)
        third = 3;
    if (isDim) {
        third = 3;
        fifth = 6;
    }
    if (isAug) {
        third = 4;
        fifth = 8;
    }
    var triad = [rootPc, clampPc(rootPc + third), clampPc(rootPc + fifth)];
    if (isSus2)
        triad = [rootPc, clampPc(rootPc + 2), clampPc(rootPc + fifth)];
    if (isSus4)
        triad = [rootPc, clampPc(rootPc + 5), clampPc(rootPc + fifth)];
    // Add 7th if requested
    var pcs = new Set(triad);
    if (isMaj7 || isMaj9)
        pcs.add(clampPc(rootPc + 11));
    if (isHalfDim) {
        // half-diminished: dim triad + m7
        return { rootPc: rootPc, pcs: __spreadArray([], new Set([rootPc, clampPc(rootPc + 3), clampPc(rootPc + 6), clampPc(rootPc + 10)]), true), name: s };
    }
    if (is7) {
        // dominant/min7 by default
        pcs.add(clampPc(rootPc + 10));
    }
    if (hasAdd2 || hasAdd9 || isMaj9)
        pcs.add(clampPc(rootPc + 2));
    if (hasAdd4)
        pcs.add(clampPc(rootPc + 5));
    if (hasAdd6)
        pcs.add(clampPc(rootPc + 9));
    return { rootPc: rootPc, pcs: __spreadArray([], pcs, true), name: s };
}
