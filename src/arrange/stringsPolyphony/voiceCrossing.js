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
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectVoiceCrossing = detectVoiceCrossing;
exports.resolveVoiceCrossing = resolveVoiceCrossing;
exports.enforceHierarchyAcrossScore = enforceHierarchyAcrossScore;
var chordSymbol_1 = require("../../harmonize/satb/chordSymbol");
var DEFAULT_CONFIG = {
    allow_voice_crossing: false,
    max_crossing_duration_slices: 0,
    allowed_on_weak_beats_only: true,
    ensemble_hierarchy: ["violin_1", "violin_2", "viola", "cello", "double_bass"],
    collision_handler: {
        resolution_priority: ["attempt_voice_swap", "attempt_octave_displacement_down", "recalculate_nearest_chord_tone"]
    },
    octave_displacement: { max_octaves_down: 2 },
    penalties: { crossingPenalty: 2, unresolvedCrossingHardPenalty: 20 }
};
var HIERARCHY_MAP = {
    violin_1: "vln1",
    violin_2: "vln2",
    viola: "vla",
    cello: "vc",
    double_bass: "cb",
    vln1: "vln1",
    vln2: "vln2",
    vla: "vla",
    vc: "vc",
    cb: "cb"
};
function getConfig(rules) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    var voiceleading = (_a = rules.voiceleading) !== null && _a !== void 0 ? _a : {};
    var nested = (_c = (_b = voiceleading.voice_leading_constraints) === null || _b === void 0 ? void 0 : _b.voice_crossing) !== null && _c !== void 0 ? _c : null;
    var flat = (_d = voiceleading.voice_crossing) !== null && _d !== void 0 ? _d : null;
    var raw = ((_e = nested !== null && nested !== void 0 ? nested : flat) !== null && _e !== void 0 ? _e : {});
    return __assign(__assign(__assign({}, DEFAULT_CONFIG), raw), { collision_handler: __assign(__assign({}, DEFAULT_CONFIG.collision_handler), ((_f = raw.collision_handler) !== null && _f !== void 0 ? _f : {})), octave_displacement: __assign(__assign({}, DEFAULT_CONFIG.octave_displacement), ((_g = raw.octave_displacement) !== null && _g !== void 0 ? _g : {})), penalties: __assign(__assign({}, DEFAULT_CONFIG.penalties), ((_h = raw.penalties) !== null && _h !== void 0 ? _h : {})) });
}
function normalizeHierarchy(hierarchy) {
    var out = [];
    for (var _i = 0, hierarchy_1 = hierarchy; _i < hierarchy_1.length; _i++) {
        var h = hierarchy_1[_i];
        var key = String(h || "").toLowerCase().replace(/\s+/g, "_");
        var mapped = HIERARCHY_MAP[key];
        if (mapped)
            out.push(mapped);
    }
    return out.length ? out : ["vln1", "vln2", "vla", "vc", "cb"];
}
function detectVoiceCrossing(hierarchy, slicePitches) {
    var violations = [];
    for (var i = 0; i < hierarchy.length - 1; i++) {
        var upper = hierarchy[i];
        var lower = hierarchy[i + 1];
        var upperMidi = slicePitches[upper];
        var lowerMidi = slicePitches[lower];
        if (upperMidi === null || lowerMidi === null)
            continue;
        if (lowerMidi > upperMidi) {
            violations.push({
                upper: upper,
                lower: lower,
                upperMidi: upperMidi,
                lowerMidi: lowerMidi,
                amount: lowerMidi - upperMidi
            });
        }
    }
    return { isCrossing: violations.length > 0, violations: violations };
}
function inRange(midi, range) {
    return midi >= range.absMin && midi <= range.absMax;
}
function chordPcs(symbol) {
    var _a;
    if (!symbol)
        return [];
    var parsed = (0, chordSymbol_1.parseChordSymbol)(symbol);
    return (_a = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _a !== void 0 ? _a : [];
}
function chooseNearestChordToneBelow(upperMidi, preferMidi, pcs, range) {
    if (!pcs.length)
        return null;
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;
    for (var m = range.absMin; m <= range.absMax; m++) {
        if (((m % 12) + 12) % 12 !== pcs[0] && !pcs.includes(((m % 12) + 12) % 12))
            continue;
        if (m > upperMidi)
            continue;
        var score = Math.abs(m - preferMidi);
        if (score < bestScore) {
            best = m;
            bestScore = score;
        }
    }
    return best;
}
function resolveViolationWithSwap(upper, lower, voicing, ranges, locked) {
    if (locked[upper] || locked[lower])
        return false;
    var upperMidi = voicing[upper];
    var lowerMidi = voicing[lower];
    if (upperMidi === null || lowerMidi === null)
        return false;
    if (!inRange(lowerMidi, ranges[upper]) || !inRange(upperMidi, ranges[lower]))
        return false;
    voicing[upper] = lowerMidi;
    voicing[lower] = upperMidi;
    return true;
}
function resolveViolationWithOctaveDown(upperMidi, lower, voicing, ranges, maxDown) {
    var lowerMidi = voicing[lower];
    if (lowerMidi === null)
        return false;
    for (var i = 1; i <= maxDown; i++) {
        var shifted = lowerMidi - 12 * i;
        if (!inRange(shifted, ranges[lower]))
            continue;
        if (shifted <= upperMidi) {
            voicing[lower] = shifted;
            return true;
        }
    }
    return false;
}
function resolveViolationWithChordTone(upperMidi, lower, voicing, prevVoicing, ranges, pcs) {
    var _a, _b;
    var prefer = (_b = (_a = prevVoicing[lower]) !== null && _a !== void 0 ? _a : voicing[lower]) !== null && _b !== void 0 ? _b : upperMidi - 3;
    var candidate = chooseNearestChordToneBelow(upperMidi, prefer, pcs, ranges[lower]);
    if (candidate === null)
        return false;
    voicing[lower] = candidate;
    return true;
}
function resolveVoiceCrossing(params) {
    var _a, _b, _c;
    var config = getConfig(params.rules);
    var hierarchy = normalizeHierarchy(config.ensemble_hierarchy);
    var locked = (_a = params.locked) !== null && _a !== void 0 ? _a : { vln1: false, vln2: false, vla: false, vc: false, cb: false };
    var crossingCounts = __assign({}, ((_b = params.crossingCounts) !== null && _b !== void 0 ? _b : {}));
    var voicing = __assign({}, params.voicing);
    var ruleHits = [];
    var cost = 0;
    var _d = detectVoiceCrossing(hierarchy, voicing), isCrossing = _d.isCrossing, violations = _d.violations;
    var pcs = chordPcs(params.slice.chordSymbol);
    for (var _i = 0, violations_1 = violations; _i < violations_1.length; _i++) {
        var v = violations_1[_i];
        var key = "".concat(v.upper, "-").concat(v.lower);
        var prevCount = (_c = crossingCounts[key]) !== null && _c !== void 0 ? _c : 0;
        var allow = config.allow_voice_crossing &&
            (!config.allowed_on_weak_beats_only || !params.slice.isStrongBeat) &&
            prevCount + 1 <= config.max_crossing_duration_slices;
        if (allow) {
            crossingCounts[key] = prevCount + 1;
            cost += config.penalties.crossingPenalty;
            ruleHits.push({ id: "crossing_allowed", cost: config.penalties.crossingPenalty, detail: key });
            continue;
        }
        crossingCounts[key] = 0;
        var resolved = false;
        for (var _e = 0, _f = config.collision_handler.resolution_priority; _e < _f.length; _e++) {
            var strat = _f[_e];
            if (strat === "attempt_voice_swap") {
                resolved = resolveViolationWithSwap(v.upper, v.lower, voicing, params.ranges, locked);
            }
            else if (strat === "attempt_octave_displacement_down") {
                resolved = resolveViolationWithOctaveDown(v.upperMidi, v.lower, voicing, params.ranges, config.octave_displacement.max_octaves_down);
            }
            else if (strat === "recalculate_nearest_chord_tone") {
                resolved = resolveViolationWithChordTone(v.upperMidi, v.lower, voicing, params.prevVoicing, params.ranges, pcs);
            }
            if (resolved) {
                ruleHits.push({ id: "crossing_resolved", cost: 0, detail: "".concat(v.upper, "-").concat(v.lower, "-").concat(strat) });
                break;
            }
        }
        if (!resolved) {
            cost += config.penalties.unresolvedCrossingHardPenalty;
            ruleHits.push({
                id: "crossing_unresolved",
                cost: config.penalties.unresolvedCrossingHardPenalty,
                detail: "".concat(v.upper, "-").concat(v.lower)
            });
        }
    }
    return { voicing: voicing, crossingCounts: crossingCounts, ruleHits: ruleHits, cost: cost };
}
function enforceHierarchyAcrossScore(params) {
    var out = [];
    var ruleHits = [];
    var prev = { vln1: null, vln2: null, vla: null, vc: null, cb: null };
    var crossingCounts = {};
    for (var i = 0; i < params.slices.length; i++) {
        var slice = params.slices[i];
        var current = __assign({}, params.voicings[i]);
        var locked = {
            vln1: slice.melodyMidi !== null,
            vln2: false,
            vla: false,
            vc: false,
            cb: false
        };
        var res = resolveVoiceCrossing({
            slice: slice,
            voicing: current,
            prevVoicing: prev,
            rules: params.rules,
            ranges: params.ranges,
            locked: locked,
            crossingCounts: crossingCounts
        });
        crossingCounts = res.crossingCounts;
        ruleHits.push.apply(ruleHits, res.ruleHits);
        out.push(res.voicing);
        prev = res.voicing;
    }
    return { voicings: out, ruleHits: ruleHits };
}
