"use strict";
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
exports.buildCandidateMap = buildCandidateMap;
var ranges_1 = require("./ranges");
var motifs_1 = require("./motifs");
var chordSymbol_1 = require("../../harmonize/satb/chordSymbol");
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
function clampPc(pc) {
    var v = pc % 12;
    return v < 0 ? v + 12 : v;
}
function scalePcs(fifths, mode) {
    var major = [0, 2, 4, 5, 7, 9, 11];
    var minor = [0, 2, 3, 5, 7, 8, 10];
    var root = clampPc(fifths * 7);
    var base = mode === "minor" ? minor : major;
    return base.map(function (pc) { return clampPc(root + pc); });
}
function pickCandidates(pcs, range, prev) {
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
    return unique.slice(0, 6);
}
function chordPcs(symbol) {
    var _a;
    if (!symbol)
        return [];
    var parsed = (0, chordSymbol_1.parseChordSymbol)(symbol);
    return (_a = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _a !== void 0 ? _a : [];
}
function bassPc(symbol) {
    var _a;
    if (!symbol)
        return null;
    var parts = symbol.split("/");
    if (parts.length > 1) {
        var bass = (0, chordSymbol_1.parseChordSymbol)(parts[1]);
        if ((bass === null || bass === void 0 ? void 0 : bass.rootPc) !== undefined)
            return bass.rootPc;
    }
    var parsed = (0, chordSymbol_1.parseChordSymbol)(parts[0]);
    return (_a = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _a !== void 0 ? _a : null;
}
function buildCandidateMap(params) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var slice = params.slice, prevVoicing = params.prevVoicing, keyFifths = params.keyFifths, keyMode = params.keyMode, motif = params.motif, motifEntries = params.motifEntries, rules = params.rules, rhythmState = params.rhythmState;
    var rangeMap = (_a = params.ranges) !== null && _a !== void 0 ? _a : ranges_1.STRING_RANGES;
    var scale = scalePcs(keyFifths, keyMode);
    var chord = chordPcs(slice.chordSymbol);
    var chordBass = bassPc(slice.chordSymbol);
    var useChord = chord.length ? chord : scale;
    var isStrongBeat = slice.isStrongBeat;
    var allowedPcs = new Set(isStrongBeat ? useChord : __spreadArray(__spreadArray([], useChord, true), scale, true));
    var out = {
        vln1: [],
        vln2: [],
        vla: [],
        vc: [],
        cb: []
    };
    var bassRatio = rhythmState.totalAttacks > 0 ? ((_b = rhythmState.perVoice.cb) !== null && _b !== void 0 ? _b : 0) / rhythmState.totalAttacks : 1;
    var bassAnchored = chordBass !== null &&
        (prevVoicing === null || prevVoicing === void 0 ? void 0 : prevVoicing.cb) !== null &&
        ((prevVoicing.cb % 12) + 12) % 12 === chordBass &&
        bassRatio >= ((_d = (_c = rules.polyphony.celloSinger) === null || _c === void 0 ? void 0 : _c.bassAnchoringThreshold) !== null && _d !== void 0 ? _d : 0);
    var celloAgile = ((_e = rhythmState.perVoice.vc) !== null && _e !== void 0 ? _e : 0) >= ((_g = (_f = rules.polyphony.celloSinger) === null || _f === void 0 ? void 0 : _f.agilityNoteDensity) !== null && _g !== void 0 ? _g : 3);
    // Violin I melody anchor.
    if (typeof slice.melodyMidi === "number") {
        out.vln1 = [slice.melodyMidi];
    }
    for (var _i = 0, VOICES_1 = VOICES; _i < VOICES_1.length; _i++) {
        var voice = VOICES_1[_i];
        if (voice === "vln1" && out.vln1.length)
            continue;
        var prev = prevVoicing ? prevVoicing[voice] : null;
        var range = rangeMap[voice];
        if (voice === "vc" && ((_h = rules.polyphony.celloSinger) === null || _h === void 0 ? void 0 : _h.celloFreeRange) && bassAnchored) {
            var _k = rules.polyphony.celloSinger.celloFreeRange, low = _k[0], high = _k[1];
            range = __assign(__assign({}, range), { prefMin: low, prefMax: high });
        }
        var pcs = isStrongBeat ? useChord : __spreadArray([], new Set(__spreadArray(__spreadArray([], useChord, true), scale, true)), true);
        if (voice === "cb") {
            var cbChordPcs = chord.length ? chord : useChord;
            if (chordBass !== null) {
                if (celloAgile && !isStrongBeat) {
                    out[voice] = [];
                }
                else {
                    out[voice] = pickCandidates([chordBass], range, prev);
                }
            }
            else {
                // No slash bass, but still keep CB on chord tones only.
                out[voice] = pickCandidates(cbChordPcs, range, prev);
            }
        }
        else {
            out[voice] = pickCandidates(pcs, range, prev);
        }
        if (!out[voice].length && voice !== "vln1") {
            out[voice] = pickCandidates(scale, range, prev);
        }
    }
    // Motif insertion.
    if (motif) {
        var _loop_1 = function (entry) {
            if (!entry.voice)
                return "continue";
            var target = (0, motifs_1.motifMidiAtSlice)(motif, entry, slice.index);
            if (target === null)
                return "continue";
            var range = ranges_1.STRING_RANGES[entry.voice];
            var candidates = [target, target + 12, target - 12].filter(function (m) {
                if (m < range.absMin || m > range.absMax)
                    return false;
                var pc = ((m % 12) + 12) % 12;
                return allowedPcs.has(pc);
            });
            if (candidates.length) {
                var current = (_j = out[entry.voice]) !== null && _j !== void 0 ? _j : [];
                var merged = __spreadArray([], new Set(__spreadArray(__spreadArray([], candidates, true), current, true)), true);
                out[entry.voice] = merged;
            }
        };
        for (var _l = 0, motifEntries_1 = motifEntries; _l < motifEntries_1.length; _l++) {
            var entry = motifEntries_1[_l];
            _loop_1(entry);
        }
    }
    return out;
}
