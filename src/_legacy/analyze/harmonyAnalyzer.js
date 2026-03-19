"use strict";
/**
 * Legacy harmony analyzer (v1) — FROZEN
 *
 * Legacy routes:
 * - /analyze_harmony_v1
 * - /attach_harmony_v1
 *
 * Policy:
 * - Treat this module as frozen. Prefer creating a v2 module instead of extending v1.
 * - Only apply minimal bug fixes that preserve output shape and semantics.
 * - Do not add new features here (new features belong in v2).
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
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
exports.analyzeHarmonyPerMeasure = analyzeHarmonyPerMeasure;
exports.attachHarmonyToScore = attachHarmonyToScore;
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
// Pitch class helpers
function pc(midi) {
    var x = ((midi % 12) + 12) % 12;
    return x;
}
function clamp01(x) {
    if (Number.isNaN(x))
        return 0;
    if (x < 0)
        return 0;
    if (x > 1)
        return 1;
    return x;
}
var PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
function chordSymbol(rootPc, q) {
    var _a;
    var r = (_a = PC_NAMES[rootPc]) !== null && _a !== void 0 ? _a : "C";
    switch (q) {
        case "maj":
            return r;
        case "min":
            return "".concat(r, "m");
        case "dim":
            return "".concat(r, "dim");
        case "aug":
            return "".concat(r, "aug");
        case "7":
            return "".concat(r, "7");
        case "maj7":
            return "".concat(r, "maj7");
        case "min7":
            return "".concat(r, "m7");
        case "hdim7":
            return "".concat(r, "\u00F87");
        case "dim7":
            return "".concat(r, "\u00B07");
        default:
            return r;
    }
}
// Common-practice core set (v1)
var PATTERNS = [
    { quality: "maj", intervals: [0, 4, 7] },
    { quality: "min", intervals: [0, 3, 7] },
    { quality: "dim", intervals: [0, 3, 6] },
    { quality: "aug", intervals: [0, 4, 8] },
    { quality: "7", intervals: [0, 4, 7, 10] },
    { quality: "maj7", intervals: [0, 4, 7, 11] },
    { quality: "min7", intervals: [0, 3, 7, 10] },
    { quality: "hdim7", intervals: [0, 3, 6, 10] },
    { quality: "dim7", intervals: [0, 3, 6, 9] }
];
function bestChordMatch(pcs, bassPc) {
    if (pcs.length < 2)
        return null;
    var set = new Set(pcs);
    var best = null;
    var _loop_1 = function (root) {
        var _loop_2 = function (pat) {
            var expected = pat.intervals.map(function (i) { return (root + i) % 12; });
            var expectedSet = new Set(expected);
            var present = 0;
            for (var _a = 0, expectedSet_1 = expectedSet; _a < expectedSet_1.length; _a++) {
                var e = expectedSet_1[_a];
                if (set.has(e))
                    present++;
            }
            var coverage = present / expectedSet.size;
            var extras = pcs.filter(function (x) { return !expectedSet.has(x); }).length;
            var extraPenalty = extras > 0 ? Math.min(0.35, extras * 0.12) : 0;
            var bassBoost = 0;
            if (bassPc !== null && expectedSet.has(bassPc))
                bassBoost = 0.08;
            var score = clamp01(coverage - extraPenalty + bassBoost);
            if (!best || score > best.score) {
                var inv = computeInversion(root, pat.quality, bassPc, expected);
                best = {
                    rootPc: root,
                    quality: pat.quality,
                    inversion: inv,
                    symbol: chordSymbol(root, pat.quality),
                    score: score
                };
            }
        };
        for (var _i = 0, PATTERNS_1 = PATTERNS; _i < PATTERNS_1.length; _i++) {
            var pat = PATTERNS_1[_i];
            _loop_2(pat);
        }
    };
    for (var root = 0; root < 12; root++) {
        _loop_1(root);
    }
    if (best && best.score < 0.45)
        return null;
    return best;
}
function computeInversion(rootPc, quality, bassPc, chordPcs) {
    if (bassPc === null)
        return 0;
    var uniq = Array.from(new Set(chordPcs));
    var idx = uniq.findIndex(function (x) { return x === bassPc; });
    if (idx < 0)
        return 0;
    if (quality === "maj" || quality === "min" || quality === "dim" || quality === "aug") {
        if (idx === 0)
            return 0;
        if (idx === 1)
            return 1;
        return 2;
    }
    if (idx === 0)
        return 0;
    if (idx === 1)
        return 1;
    if (idx === 2)
        return 2;
    return 3;
}
function getMeasureKeySignature(m) {
    var _a;
    var fifths = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.key_fifths;
    if (typeof fifths !== "number")
        return undefined;
    var mode = "unknown";
    return { fifths: fifths, mode: mode };
}
function collectOnsetNotesInMeasure(score, measureIndex) {
    var _a, _b, _c, _d, _e;
    var map = new Map();
    for (var _i = 0, _f = (_a = score.parts) !== null && _a !== void 0 ? _a : []; _i < _f.length; _i++) {
        var part = _f[_i];
        var measure = ((_b = part.measures) !== null && _b !== void 0 ? _b : [])[measureIndex];
        if (!measure)
            continue;
        for (var _g = 0, _h = (_c = measure.events) !== null && _c !== void 0 ? _c : []; _g < _h.length; _g++) {
            var ev = _h[_g];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || !((_d = ev === null || ev === void 0 ? void 0 : ev.pitch) === null || _d === void 0 ? void 0 : _d.step))
                continue;
            var t = typeof ev.t === "number" ? ev.t : 0;
            var midi = (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
            var arr = (_e = map.get(t)) !== null && _e !== void 0 ? _e : [];
            arr.push(midi);
            map.set(t, arr);
        }
    }
    return map;
}
function pickBassPc(midiNotes) {
    if (!midiNotes.length)
        return null;
    var min = midiNotes[0];
    for (var _i = 0, midiNotes_1 = midiNotes; _i < midiNotes_1.length; _i++) {
        var m = midiNotes_1[_i];
        if (m < min)
            min = m;
    }
    return pc(min);
}
/**
 * Phase 1 harmony analyzer (v1):
 * - per measure
 * - on each onset time inside the measure, compute a chord label from pitch classes
 * - concert pitch only
 *
 * @deprecated v1 is frozen. Prefer using v2 analysis routes/modules for new work.
 */
function analyzeHarmonyPerMeasure(score) {
    var _a, _b, _c, _d, _e, _f;
    var measureCount = Math.max.apply(Math, __spreadArray([0], ((_a = score.parts) !== null && _a !== void 0 ? _a : []).map(function (p) { var _a; return ((_a = p.measures) !== null && _a !== void 0 ? _a : []).length; }), false));
    var measures = [];
    for (var mi = 0; mi < measureCount; mi++) {
        var firstMeasure = ((_d = (_c = (_b = score.parts) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.measures) !== null && _d !== void 0 ? _d : [])[mi];
        var key = getMeasureKeySignature(firstMeasure);
        var onsetMap = collectOnsetNotesInMeasure(score, mi);
        var times = Array.from(onsetMap.keys()).sort(function (a, b) { return a - b; });
        var chords = [];
        for (var _i = 0, times_1 = times; _i < times_1.length; _i++) {
            var t = times_1[_i];
            var midiNotes = (_e = onsetMap.get(t)) !== null && _e !== void 0 ? _e : [];
            var pcs = Array.from(new Set(midiNotes.map(pc))).sort(function (a, b) { return a - b; });
            if (pcs.length === 0)
                continue;
            var bass = pickBassPc(midiNotes);
            var match = bestChordMatch(pcs, bass);
            if (!match) {
                chords.push({ t: t, pcs: pcs, confidence: pcs.length ? 0.25 : 0 });
                continue;
            }
            chords.push({
                t: t,
                pcs: pcs,
                rootPc: match.rootPc,
                quality: match.quality,
                inversion: match.inversion,
                symbol: match.symbol,
                confidence: match.score
            });
        }
        measures.push({
            measureNumber: ((_f = firstMeasure === null || firstMeasure === void 0 ? void 0 : firstMeasure.number) !== null && _f !== void 0 ? _f : mi + 1),
            key: key,
            chords: chords
        });
    }
    return {
        version: "harmony_v1",
        concertPitch: true,
        per: "measure",
        measures: measures
    };
}
/**
 * Helper to attach analysis into score.meta.harmony (internal only).
 *
 * @deprecated v1 is frozen. Prefer attaching v2 analysis in a dedicated v2 pipeline.
 */
function attachHarmonyToScore(score) {
    var _a, _b, _c;
    var harmony = analyzeHarmonyPerMeasure(score);
    var meta = __assign(__assign({}, ((_a = score.meta) !== null && _a !== void 0 ? _a : {})), { ensemble: (_c = (_b = score.meta) === null || _b === void 0 ? void 0 : _b.ensemble) !== null && _c !== void 0 ? _c : "unknown", harmony: harmony });
    return __assign(__assign({}, score), { meta: meta });
}
