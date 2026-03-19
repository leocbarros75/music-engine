"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectChordFromPcs = detectChordFromPcs;
var pitch_1 = require("./pitch");
function uniqSorted(a) {
    var s = new Set();
    for (var _i = 0, a_1 = a; _i < a_1.length; _i++) {
        var x = a_1[_i];
        s.add(((x % 12) + 12) % 12);
    }
    return Array.from(s).sort(function (x, y) { return x - y; });
}
function hasPc(pcs, pc) {
    var t = ((pc % 12) + 12) % 12;
    return pcs.includes(t);
}
function qualityForTriad(pcs, root) {
    var r = ((root % 12) + 12) % 12;
    var m3 = (r + 3) % 12;
    var M3 = (r + 4) % 12;
    var p5 = (r + 7) % 12;
    var d5 = (r + 6) % 12;
    var a5 = (r + 8) % 12;
    var hasM3 = hasPc(pcs, M3);
    var hasm3 = hasPc(pcs, m3);
    if (hasM3 && hasPc(pcs, p5))
        return "maj";
    if (hasm3 && hasPc(pcs, p5))
        return "min";
    if (hasm3 && hasPc(pcs, d5))
        return "dim";
    if (hasM3 && hasPc(pcs, a5))
        return "aug";
    if (hasPc(pcs, (r + 2) % 12) && hasPc(pcs, p5))
        return "sus2";
    if (hasPc(pcs, (r + 5) % 12) && hasPc(pcs, p5))
        return "sus4";
    return "unknown";
}
function qualityForSeventh(pcs, root, triadQ) {
    var r = ((root % 12) + 12) % 12;
    var m7 = (r + 10) % 12;
    var M7 = (r + 11) % 12;
    var d7 = (r + 9) % 12;
    var hasm7 = hasPc(pcs, m7);
    var hasM7 = hasPc(pcs, M7);
    var hasd7 = hasPc(pcs, d7);
    // Dominant seventh: major triad + m7
    if (triadQ === "maj" && hasm7)
        return "dom7";
    if (triadQ === "maj" && hasM7)
        return "maj7";
    if (triadQ === "min" && hasm7)
        return "min7";
    if (triadQ === "dim" && hasm7)
        return "hdim7";
    if (triadQ === "dim" && hasd7)
        return "dim7";
    return triadQ;
}
function suffixForQuality(q) {
    return q === "maj"
        ? ""
        : q === "min"
            ? "m"
            : q === "dim"
                ? "dim"
                : q === "aug"
                    ? "aug"
                    : q === "dom7"
                        ? "7"
                        : q === "maj7"
                            ? "maj7"
                            : q === "min7"
                                ? "m7"
                                : q === "hdim7"
                                    ? "ø7"
                                    : q === "dim7"
                                        ? "dim7"
                                        : q === "sus2"
                                            ? "sus2"
                                            : q === "sus4"
                                                ? "sus4"
                                                : "";
}
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    if (x < 0)
        return 0;
    if (x > 1)
        return 1;
    return x;
}
/**
 * Normalize the detector score to 0..1.
 *
 * Score is intentionally heuristic, but roughly:
 * - triad recognized: +3
 * - root present: +2
 * - seventh recognized: +1
 * - bass==root boost: +0.35
 * - smaller set bonus: up to +0.5 (pcs length 1..6)
 *
 * So typical "strong" chord snapshots land around 5..6+.
 */
function scoreToConfidence(score) {
    var MAX = 6.85;
    return clamp01(score / MAX);
}
// IMPORTANT: bassPc is optional, but when present it helps resolve ambiguities,
// especially for fully diminished seventh chords (symmetrical).
function detectChordFromPcs(pcsIn, preferSharps, bassPc) {
    var _a, _b;
    if (preferSharps === void 0) { preferSharps = true; }
    var pcs = uniqSorted(pcsIn);
    var bpc = bassPc === null || bassPc === undefined ? null : (((bassPc % 12) + 12) % 12);
    if (pcs.length === 0) {
        return {
            pcs: pcs,
            rootPc: null,
            bassPc: bpc,
            quality: "unknown",
            name: "N.C.",
            score: 0,
            confidence: 0
        };
    }
    // Try each pc as potential root, score by how many chord tones it explains.
    var best = null;
    for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
        var r = pcs_1[_i];
        var triadQ = qualityForTriad(pcs, r);
        var score_1 = 0;
        // Reward matching third/fifth patterns
        if (triadQ !== "unknown")
            score_1 += 3;
        // Reward root presence
        if (hasPc(pcs, r))
            score_1 += 2;
        // Reward seventh recognition
        var sevQ = qualityForSeventh(pcs, r, triadQ);
        if (sevQ !== triadQ)
            score_1 += 1;
        // Prefer bass as root a little (helps inversion-driven snapshots)
        if (bpc !== null && r === bpc)
            score_1 += 0.35;
        // Small reward for smaller sets (clean chord)
        score_1 += Math.max(0, 6 - pcs.length) * 0.1;
        var qFinal = qualityForSeventh(pcs, r, triadQ);
        if (!best || score_1 > best.score)
            best = { root: r, score: score_1, quality: qFinal };
    }
    var rootPc = (_a = best === null || best === void 0 ? void 0 : best.root) !== null && _a !== void 0 ? _a : pcs[0];
    var quality = (_b = best === null || best === void 0 ? void 0 : best.quality) !== null && _b !== void 0 ? _b : "unknown";
    // Special case: fully diminished 7th chords are symmetrical and root is ambiguous.
    // If we know the bass, we treat the bass as the functional root for analysis tests.
    if (quality === "dim7" && bpc !== null && hasPc(pcs, bpc)) {
        rootPc = bpc;
    }
    var rootName = (0, pitch_1.pcToName)(rootPc, preferSharps);
    var suffix = suffixForQuality(quality);
    var score = typeof (best === null || best === void 0 ? void 0 : best.score) === "number" ? best.score : 0;
    var confidence = scoreToConfidence(score);
    return {
        pcs: pcs,
        rootPc: rootPc,
        bassPc: bpc,
        quality: quality,
        name: "".concat(rootName).concat(suffix),
        score: score,
        confidence: confidence
    };
}
