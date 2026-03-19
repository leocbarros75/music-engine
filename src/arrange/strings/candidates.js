"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCandidatesForSlice = buildCandidatesForSlice;
exports.buildVoicingStates = buildVoicingStates;
var ranges_1 = require("./ranges");
var chordSymbol_1 = require("../../harmonize/satb/chordSymbol");
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
function clampPc(pc) {
    var v = pc % 12;
    return v < 0 ? v + 12 : v;
}
function parseChordPcs(symbol) {
    var _a, _b, _c;
    if (!symbol)
        return { pcs: [], bassPc: null, rootPc: null };
    var raw = String(symbol);
    var parts = raw.split("/");
    var base = (_a = parts[0]) !== null && _a !== void 0 ? _a : raw;
    var parsed = (0, chordSymbol_1.parseChordSymbol)(base);
    var pcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : [];
    var rootPc = typeof (parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) === "number" ? parsed.rootPc : null;
    var bassPc = null;
    if (parts.length > 1) {
        var bass = (0, chordSymbol_1.parseChordSymbol)(parts[1]);
        bassPc = (_c = bass === null || bass === void 0 ? void 0 : bass.rootPc) !== null && _c !== void 0 ? _c : null;
    }
    return { pcs: pcs, bassPc: bassPc, rootPc: rootPc };
}
function scalePcsFromKey(fifths, mode) {
    var major = [0, 2, 4, 5, 7, 9, 11];
    var minor = [0, 2, 3, 5, 7, 8, 10];
    var root = clampPc(0 + fifths * 7);
    var base = mode === "minor" ? minor : major;
    return base.map(function (pc) { return clampPc(root + pc); });
}
function inferChordPcs(melodyPc, scalePcs) {
    var triads = [
        [0, 2, 4], // I
        [3, 5, 0], // IV
        [4, 6, 1], // V
        [5, 0, 2], // vi
        [1, 3, 5] // ii
    ];
    var scaleIdx = scalePcs.indexOf(melodyPc);
    if (scaleIdx < 0)
        return scalePcs;
    for (var _i = 0, triads_1 = triads; _i < triads_1.length; _i++) {
        var triad = triads_1[_i];
        var pcs = triad.map(function (i) { return scalePcs[i % 7]; });
        if (pcs.includes(melodyPc))
            return pcs;
    }
    return scalePcs;
}
function pickCandidatesForVoice(pcs, range, prev) {
    if (!pcs.length)
        return [];
    var target = typeof prev === "number" ? prev : Math.round((range.absMin + range.absMax) / 2);
    var candidates = [];
    for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
        var pc = pcs_1[_i];
        for (var oct = -2; oct <= 2; oct++) {
            var midi = clampPc(pc) + (Math.floor(target / 12) + oct) * 12;
            if (midi >= range.absMin && midi <= range.absMax)
                candidates.push(midi);
        }
    }
    var unique = Array.from(new Set(candidates));
    unique.sort(function (a, b) { return Math.abs(a - target) - Math.abs(b - target); });
    return unique.slice(0, 4);
}
function buildCandidatesForSlice(params) {
    var slice = params.slice, prevVoicing = params.prevVoicing, keyFifths = params.keyFifths, keyMode = params.keyMode;
    var _a = parseChordPcs(slice.chordSymbol), pcs = _a.pcs, bassPc = _a.bassPc, rootPc = _a.rootPc;
    var scale = scalePcsFromKey(keyFifths, keyMode);
    var melodyPc = typeof slice.melodyMidi === "number" ? slice.melodyMidi % 12 : null;
    var chordPcs = pcs.length ? pcs : melodyPc !== null ? inferChordPcs(melodyPc, scale) : scale;
    var out = {
        vln1: [],
        vln2: [],
        vla: [],
        vc: [],
        cb: []
    };
    if (typeof slice.melodyMidi === "number") {
        var vln1Range = ranges_1.STRING_RANGES.vln1;
        var shifted = slice.melodyMidi + 12;
        out.vln1 = [shifted >= vln1Range.absMin && shifted <= vln1Range.absMax ? shifted : slice.melodyMidi];
    }
    for (var _i = 0, VOICES_1 = VOICES; _i < VOICES_1.length; _i++) {
        var voice = VOICES_1[_i];
        if (voice === "vln1" && out.vln1.length)
            continue;
        var range = ranges_1.STRING_RANGES[voice];
        var prev = prevVoicing ? prevVoicing[voice] : null;
        var pcsForVoice = voice === "cb"
            ? bassPc !== null
                ? [bassPc]
                : rootPc !== null
                    ? [rootPc]
                    : chordPcs
            : chordPcs;
        out[voice] = pickCandidatesForVoice(pcsForVoice, range, prev);
        if (!out[voice].length) {
            out[voice] = pickCandidatesForVoice(chordPcs, range, prev);
        }
    }
    return out;
}
function buildVoicingStates(candidateMap) {
    var v1 = candidateMap.vln1.length ? candidateMap.vln1 : [null];
    var v2 = candidateMap.vln2.length ? candidateMap.vln2 : [null];
    var va = candidateMap.vla.length ? candidateMap.vla : [null];
    var vc = candidateMap.vc.length ? candidateMap.vc : [null];
    var cb = candidateMap.cb.length ? candidateMap.cb : [null];
    var out = [];
    for (var _i = 0, v1_1 = v1; _i < v1_1.length; _i++) {
        var a = v1_1[_i];
        for (var _a = 0, v2_1 = v2; _a < v2_1.length; _a++) {
            var b = v2_1[_a];
            for (var _b = 0, va_1 = va; _b < va_1.length; _b++) {
                var c = va_1[_b];
                for (var _c = 0, vc_1 = vc; _c < vc_1.length; _c++) {
                    var d = vc_1[_c];
                    for (var _d = 0, cb_1 = cb; _d < cb_1.length; _d++) {
                        var e = cb_1[_d];
                        out.push({ vln1: a, vln2: b, vla: c, vc: d, cb: e });
                    }
                }
            }
        }
    }
    return out;
}
