"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.estimateKeyFromPcHistogram = estimateKeyFromPcHistogram;
exports.keyFromMetaOrBestGuess = keyFromMetaOrBestGuess;
exports.tonicPcFromKey = tonicPcFromKey;
var pitch_1 = require("./pitch");
// Small key estimator using pitch class histogram and major/minor templates.
var MAJOR_TEMPLATE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
var MINOR_TEMPLATE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
function dot(a, b) {
    var _a, _b;
    var s = 0;
    for (var i = 0; i < 12; i++)
        s += ((_a = a[i]) !== null && _a !== void 0 ? _a : 0) * ((_b = b[i]) !== null && _b !== void 0 ? _b : 0);
    return s;
}
function norm(a) {
    var _a, _b;
    var s = 0;
    for (var i = 0; i < 12; i++)
        s += ((_a = a[i]) !== null && _a !== void 0 ? _a : 0) * ((_b = a[i]) !== null && _b !== void 0 ? _b : 0);
    return Math.sqrt(s);
}
function rotate(arr, shift) {
    var _a;
    var out = new Array(12).fill(0);
    for (var i = 0; i < 12; i++)
        out[(i + shift + 12) % 12] = (_a = arr[i]) !== null && _a !== void 0 ? _a : 0;
    return out;
}
function cosineSim(a, b) {
    var na = norm(a);
    var nb = norm(b);
    if (na <= 0 || nb <= 0)
        return 0;
    return dot(a, b) / (na * nb);
}
function estimateKeyFromPcHistogram(hist, preferSharps) {
    if (preferSharps === void 0) { preferSharps = true; }
    var h = (hist !== null && hist !== void 0 ? hist : []).slice(0, 12);
    while (h.length < 12)
        h.push(0);
    var best = { pc: 0, mode: "major", sim: -1 };
    for (var tonicPc = 0; tonicPc < 12; tonicPc++) {
        var maj = cosineSim(h, rotate(MAJOR_TEMPLATE, tonicPc));
        if (maj > best.sim)
            best = { pc: tonicPc, mode: "major", sim: maj };
        var min = cosineSim(h, rotate(MINOR_TEMPLATE, tonicPc));
        if (min > best.sim)
            best = { pc: tonicPc, mode: "minor", sim: min };
    }
    var confidence = Math.max(0, Math.min(1, (best.sim + 1) / 2));
    return { tonic: (0, pitch_1.pcToName)(best.pc, preferSharps), mode: best.mode, confidence: confidence };
}
function keyFromMetaOrBestGuess(metaKey, hist, preferSharps) {
    var _a;
    if (preferSharps === void 0) { preferSharps = true; }
    if (metaKey) {
        if (typeof metaKey === "string") {
            var s = metaKey.toLowerCase();
            var tonic = (_a = metaKey.trim().split(/\s+/)[0]) !== null && _a !== void 0 ? _a : "C";
            var mode = s.includes("minor") ? "minor" : s.includes("major") ? "major" : "unknown";
            if (mode === "major" || mode === "minor")
                return { tonic: tonic, mode: mode, confidence: 0.95 };
        }
        if (typeof metaKey === "object" && typeof metaKey.tonic === "string") {
            var mode = metaKey.mode === "minor" ? "minor" : metaKey.mode === "major" ? "major" : "unknown";
            if (mode === "major" || mode === "minor")
                return { tonic: metaKey.tonic, mode: mode, confidence: 0.95 };
        }
    }
    return estimateKeyFromPcHistogram(hist, preferSharps);
}
function tonicPcFromKey(key) {
    return (0, pitch_1.tonicNameToPc)(key.tonic);
}
