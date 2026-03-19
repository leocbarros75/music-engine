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
exports.resolvePolyphonicProfile = resolvePolyphonicProfile;
exports.orderingOk = orderingOk;
exports.scorePolyphonicVoicing = scorePolyphonicVoicing;
exports.repairVoicingForCrossingAndOverlap = repairVoicingForCrossingAndOverlap;
var DEFAULT_PENALTIES = {
    parallelPerfect: 40,
    directPerfect: 18,
    directPerfectOuterLeap: 22,
    perfectMotionSimilar: 6,
    perfectConsonanceHold: 4,
    dissonance: 6,
    dissonanceLeap: 8,
    similarMotionAll: 6,
    spacing: 8,
    crossing: 25,
    overlap: 14,
    leapAboveThird: 4,
    leapAboveFifth: 10,
    leapAboveOctave: 18,
    tendencyUnresolved: 12,
    seventhUnresolved: 10,
    doubleTendency: 8,
    doubleSeventh: 7
};
var PROFILES = {
    baroque: {
        name: "baroque",
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 55, directPerfect: 26, directPerfectOuterLeap: 30, perfectMotionSimilar: 10, perfectConsonanceHold: 8, dissonance: 10, dissonanceLeap: 14, similarMotionAll: 10, spacing: 10, crossing: 30, overlap: 20, leapAboveThird: 6, leapAboveFifth: 16, leapAboveOctave: 26, tendencyUnresolved: 16, seventhUnresolved: 14, doubleTendency: 12, doubleSeventh: 10 }),
        allowParallels: false,
        allowDirectPerfects: false,
        enableTendencyRules: true
    },
    classical: {
        name: "classical",
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 45, directPerfect: 22, directPerfectOuterLeap: 24, perfectMotionSimilar: 8, perfectConsonanceHold: 6, dissonance: 8, dissonanceLeap: 12, similarMotionAll: 8, spacing: 9, crossing: 26, overlap: 16, leapAboveThird: 5, leapAboveFifth: 12, leapAboveOctave: 20, tendencyUnresolved: 14, seventhUnresolved: 12, doubleTendency: 10, doubleSeventh: 9 }),
        allowParallels: false,
        allowDirectPerfects: false,
        enableTendencyRules: true
    },
    romantic: {
        name: "romantic",
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 30, directPerfect: 14, directPerfectOuterLeap: 16, perfectMotionSimilar: 5, perfectConsonanceHold: 4, dissonance: 5, dissonanceLeap: 8, similarMotionAll: 4, spacing: 6, crossing: 18, overlap: 10, leapAboveThird: 3, leapAboveFifth: 8, leapAboveOctave: 14, tendencyUnresolved: 8, seventhUnresolved: 6, doubleTendency: 6, doubleSeventh: 5 }),
        allowParallels: false,
        allowDirectPerfects: false,
        enableTendencyRules: true
    },
    modern: {
        name: "modern",
        modernMode: "modernTonal",
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 18, directPerfect: 8, directPerfectOuterLeap: 10, perfectMotionSimilar: 4, perfectConsonanceHold: 3, dissonance: 4, dissonanceLeap: 6, similarMotionAll: 2, spacing: 5, crossing: 14, overlap: 8, leapAboveThird: 2, leapAboveFifth: 6, leapAboveOctave: 10, tendencyUnresolved: 6, seventhUnresolved: 4, doubleTendency: 4, doubleSeventh: 3 }),
        allowParallels: false,
        allowDirectPerfects: false,
        enableTendencyRules: true
    }
};
var MODERN_OVERRIDES = {
    modernTonal: {
        enableTendencyRules: true,
        allowParallels: false,
        allowDirectPerfects: false
    },
    modal: {
        enableTendencyRules: true,
        allowParallels: true,
        allowDirectPerfects: true,
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 8, directPerfect: 6, directPerfectOuterLeap: 8, perfectMotionSimilar: 3, perfectConsonanceHold: 2, dissonance: 3, dissonanceLeap: 4, similarMotionAll: 3, spacing: 5, crossing: 12, overlap: 8, leapAboveThird: 2, leapAboveFifth: 6, leapAboveOctave: 10, tendencyUnresolved: 6, seventhUnresolved: 4, doubleTendency: 4, doubleSeventh: 3 })
    },
    atonal: {
        enableTendencyRules: false,
        allowParallels: true,
        allowDirectPerfects: true,
        penalties: __assign(__assign({}, DEFAULT_PENALTIES), { parallelPerfect: 4, directPerfect: 3, directPerfectOuterLeap: 3, perfectMotionSimilar: 1, perfectConsonanceHold: 1, dissonance: 1, dissonanceLeap: 2, similarMotionAll: 2, spacing: 4, crossing: 10, overlap: 6, leapAboveThird: 2, leapAboveFifth: 5, leapAboveOctave: 8, tendencyUnresolved: 0, seventhUnresolved: 0, doubleTendency: 0, doubleSeventh: 0 })
    }
};
function resolvePolyphonicProfile(styleProfile, modernMode) {
    var _a, _b, _c, _d, _e;
    var nameRaw = String(styleProfile || "classical").toLowerCase();
    var name = ["baroque", "classical", "romantic", "modern"].includes(nameRaw)
        ? nameRaw
        : "classical";
    var base = PROFILES[name];
    if (name !== "modern")
        return __assign({}, base);
    var modeRaw = String(modernMode || "modernTonal");
    var override = (_a = MODERN_OVERRIDES[modeRaw]) !== null && _a !== void 0 ? _a : MODERN_OVERRIDES.modernTonal;
    return __assign(__assign({}, base), { modernMode: ((_b = override.modernMode) !== null && _b !== void 0 ? _b : modeRaw), penalties: override.penalties ? override.penalties : base.penalties, allowParallels: (_c = override.allowParallels) !== null && _c !== void 0 ? _c : base.allowParallels, allowDirectPerfects: (_d = override.allowDirectPerfects) !== null && _d !== void 0 ? _d : base.allowDirectPerfects, enableTendencyRules: (_e = override.enableTendencyRules) !== null && _e !== void 0 ? _e : base.enableTendencyRules });
}
function pc(midi) {
    return ((midi % 12) + 12) % 12;
}
function motionDir(prev, next) {
    if (next > prev)
        return 1;
    if (next < prev)
        return -1;
    return 0;
}
function isPerfectConsonance(intervalPc) {
    return intervalPc === 0 || intervalPc === 7;
}
function isImperfectConsonance(intervalPc) {
    return intervalPc === 3 || intervalPc === 4 || intervalPc === 8 || intervalPc === 9;
}
function isDissonance(intervalPc) {
    return !isPerfectConsonance(intervalPc) && !isImperfectConsonance(intervalPc);
}
function isParallelPerfect(prevUpper, prevLower, nextUpper, nextLower) {
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (!isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    return du === dl;
}
function isDirectPerfect(prevUpper, prevLower, nextUpper, nextLower) {
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    return du === dl;
}
function orderingOk(state, allowUnisonD4) {
    var B = state.B, T = state.T, A = state.A, S = state.S;
    if (B >= T)
        return false;
    if (A >= S)
        return false;
    if (T < A)
        return true;
    if (allowUnisonD4 && T === A && T === 62)
        return true;
    return false;
}
function checkOverlap(prev, next) {
    if (!prev)
        return 0;
    var overlaps = 0;
    if (next.A > prev.S)
        overlaps += 1;
    if (next.S < prev.A)
        overlaps += 1;
    if (next.T > prev.A)
        overlaps += 1;
    if (next.A < prev.T)
        overlaps += 1;
    if (next.B > prev.T)
        overlaps += 1;
    if (next.T < prev.B)
        overlaps += 1;
    return overlaps;
}
function chordHasPc(chord, pcVal) {
    if (pcVal === null || pcVal === undefined)
        return false;
    if (!chord)
        return false;
    return chord.pcs.includes(pcVal);
}
var TENOR_BASS_ALLOWED_INTERVALS = [7, 8, 9, 10, 11, 12];
var ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];
function intervalPenalty(interval, allowed, weight) {
    if (allowed.includes(interval))
        return 0;
    var minDiff = Number.POSITIVE_INFINITY;
    for (var _i = 0, allowed_1 = allowed; _i < allowed_1.length; _i++) {
        var a = allowed_1[_i];
        var diff = Math.abs(interval - a);
        if (diff < minDiff)
            minDiff = diff;
    }
    if (!Number.isFinite(minDiff))
        return weight;
    return weight * (1 + minDiff * 0.6);
}
function scorePolyphonicVoicing(input) {
    var _a, _b, _c, _d;
    var prev = input.prev, next = input.next, ranges = input.ranges, profile = input.profile, keyPc = input.keyPc, chord = input.chord, prevChord = input.prevChord;
    var penalties = profile.penalties;
    var issues = [];
    var score = 0;
    var add = function (pen, label) {
        if (pen <= 0)
            return;
        score += pen;
        issues.push(label);
    };
    var spacingSA = next.S - next.A;
    var spacingAT = next.A - next.T;
    if (spacingSA > 12)
        add(penalties.spacing * (spacingSA - 12) * 0.5, "spacing-SA");
    if (spacingAT > 12)
        add(penalties.spacing * (spacingAT - 12) * 0.5, "spacing-AT");
    var minLowSpacing = next.B < 48 ? 10 : 5;
    var spacingTB = next.T - next.B;
    if (spacingTB < minLowSpacing) {
        add(penalties.spacing * (minLowSpacing - spacingTB) * 0.6, "spacing-TB");
    }
    if (spacingTB > 0) {
        var pen = intervalPenalty(spacingTB, TENOR_BASS_ALLOWED_INTERVALS, penalties.spacing * 1.25);
        if (pen > 0)
            add(pen, "interval-TB");
    }
    if (spacingAT >= 0) {
        var pen = intervalPenalty(spacingAT, ALTO_TENOR_ALLOWED_INTERVALS, penalties.spacing * 1.1);
        if (pen > 0)
            add(pen, "interval-AT");
    }
    if (!orderingOk(next, true))
        add(penalties.crossing, "crossing");
    var overlaps = checkOverlap(prev, next);
    if (overlaps > 0)
        add(penalties.overlap * overlaps, "overlap");
    if (prev) {
        var pairs = [
            ["S", "A"],
            ["S", "T"],
            ["S", "B"],
            ["A", "T"],
            ["A", "B"],
            ["T", "B"]
        ];
        for (var _i = 0, pairs_1 = pairs; _i < pairs_1.length; _i++) {
            var _e = pairs_1[_i], u = _e[0], l = _e[1];
            var prevUpper = prev[u];
            var prevLower = prev[l];
            var nextUpper = next[u];
            var nextLower = next[l];
            if (!profile.allowParallels && isParallelPerfect(prevUpper, prevLower, nextUpper, nextLower)) {
                add(penalties.parallelPerfect, "parallel-perfect");
            }
        }
        if (!profile.allowDirectPerfects) {
            var prevUpper = prev.S;
            var prevLower = prev.B;
            var nextUpper = next.S;
            var nextLower = next.B;
            var soprLeap = Math.abs(nextUpper - prevUpper);
            if (isDirectPerfect(prevUpper, prevLower, nextUpper, nextLower)) {
                add(penalties.directPerfect, "direct-perfect");
                if (soprLeap > 2)
                    add(penalties.directPerfectOuterLeap, "direct-perfect-outer-leap");
            }
        }
        var dS = motionDir(prev.S, next.S);
        var dA = motionDir(prev.A, next.A);
        var dT = motionDir(prev.T, next.T);
        var dB = motionDir(prev.B, next.B);
        var outerPrevInt = pc(prev.S - prev.B);
        var outerNextInt = pc(next.S - next.B);
        var outerSimilar = dS !== 0 && dB !== 0 && dS === dB;
        var outerOblique = (dS === 0 && dB !== 0) || (dS !== 0 && dB === 0);
        if (isPerfectConsonance(outerPrevInt) && outerSimilar) {
            add(penalties.perfectMotionSimilar, "perfect-motion-similar");
        }
        if (isPerfectConsonance(outerNextInt)) {
            add(penalties.perfectConsonanceHold, "perfect-consonance");
            if (isPerfectConsonance(outerPrevInt) && (outerSimilar || outerOblique)) {
                add(penalties.perfectConsonanceHold * 0.6, "perfect-consonance-chain");
            }
        }
        if (isDissonance(outerNextInt)) {
            add(penalties.dissonance, "dissonance-outer");
            var soprStep = Math.abs(next.S - prev.S) <= 2;
            var bassStep = Math.abs(next.B - prev.B) <= 2;
            if (!soprStep || !bassStep) {
                add(penalties.dissonanceLeap, "dissonance-outer-leap");
            }
        }
        if (dS !== 0 && dS === dA && dA === dT && dT === dB) {
            add(penalties.similarMotionAll, "similar-motion-all");
        }
        if (dS !== 0 && dA !== 0 && dS === dA) {
            add(penalties.similarMotionAll * 0.5, "similar-motion-SA");
        }
        if (dS !== 0 && dT !== 0 && dS === dT) {
            add(penalties.similarMotionAll * 0.5, "similar-motion-ST");
        }
        if (dB !== 0 && dT !== 0 && dB === dT) {
            add(penalties.similarMotionAll * 0.35, "similar-motion-BT");
        }
        if (dS !== 0 && dB !== 0 && dS !== dB) {
            score -= 1.5;
        }
        var voices = [
            ["S", "S"],
            ["A", "A"],
            ["T", "T"],
            ["B", "B"]
        ];
        for (var _f = 0, voices_1 = voices; _f < voices_1.length; _f++) {
            var _g = voices_1[_f], v = _g[0], r = _g[1];
            var interval = Math.abs(next[v] - prev[v]);
            if (interval > 12)
                add(penalties.leapAboveOctave, "leap-octave-".concat(v));
            else if (interval > 7)
                add(penalties.leapAboveFifth, "leap-fifth-".concat(v));
            else if (interval > 4)
                add(penalties.leapAboveThird, "leap-third-".concat(v));
            var range = ranges[r];
            if (next[v] < range.min || next[v] > range.max) {
                add(penalties.crossing, "out-of-range-".concat(v));
            }
        }
    }
    if (profile.enableTendencyRules && keyPc !== null && keyPc !== undefined && prev) {
        var leadingPc = (keyPc + 11) % 12;
        var voices = ["S", "A", "T", "B"];
        for (var _h = 0, voices_2 = voices; _h < voices_2.length; _h++) {
            var v = voices_2[_h];
            if (pc(prev[v]) === leadingPc && pc(next[v]) !== keyPc) {
                add(penalties.tendencyUnresolved, "leading-tone-unresolved-".concat(v));
            }
        }
    }
    if (profile.enableTendencyRules && prev && chordHasPc(prevChord, (_a = prevChord === null || prevChord === void 0 ? void 0 : prevChord.seventhPc) !== null && _a !== void 0 ? _a : null)) {
        var seventhPc = (_b = prevChord === null || prevChord === void 0 ? void 0 : prevChord.seventhPc) !== null && _b !== void 0 ? _b : null;
        if (seventhPc !== null && seventhPc !== undefined) {
            var voices = ["S", "A", "T", "B"];
            for (var _j = 0, voices_3 = voices; _j < voices_3.length; _j++) {
                var v = voices_3[_j];
                if (pc(prev[v]) !== seventhPc)
                    continue;
                var diff = next[v] - prev[v];
                if (!(diff === -1 || diff === -2)) {
                    add(penalties.seventhUnresolved, "seventh-unresolved-".concat(v));
                }
            }
        }
    }
    if (profile.enableTendencyRules && keyPc !== null && keyPc !== undefined) {
        var leadingPc = (keyPc + 11) % 12;
        var leadCount = (pc(next.S) === leadingPc ? 1 : 0) +
            (pc(next.A) === leadingPc ? 1 : 0) +
            (pc(next.T) === leadingPc ? 1 : 0) +
            (pc(next.B) === leadingPc ? 1 : 0);
        if (leadCount > 1)
            add(penalties.doubleTendency * (leadCount - 1), "double-leading-tone");
    }
    if (profile.enableTendencyRules && chordHasPc(chord, (_c = chord.seventhPc) !== null && _c !== void 0 ? _c : null)) {
        var seventhPc = (_d = chord.seventhPc) !== null && _d !== void 0 ? _d : null;
        if (seventhPc !== null && seventhPc !== undefined) {
            var seventhCount = (pc(next.S) === seventhPc ? 1 : 0) +
                (pc(next.A) === seventhPc ? 1 : 0) +
                (pc(next.T) === seventhPc ? 1 : 0) +
                (pc(next.B) === seventhPc ? 1 : 0);
            if (seventhCount > 1)
                add(penalties.doubleSeventh * (seventhCount - 1), "double-seventh");
        }
    }
    return { score: score, issues: issues };
}
function midiCandidatesForPcInRange(pitchClass, range) {
    var out = [];
    for (var m = range.min; m <= range.max; m++) {
        if (pc(m) === pitchClass)
            out.push(m);
    }
    return out;
}
function collectChordMidis(chordPcs, range) {
    var out = [];
    for (var _i = 0, chordPcs_1 = chordPcs; _i < chordPcs_1.length; _i++) {
        var p = chordPcs_1[_i];
        out.push.apply(out, midiCandidatesForPcInRange(p, range));
    }
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
}
function repairVoicingForCrossingAndOverlap(params) {
    var prev = params.prev, proposed = params.proposed, chordPcs = params.chordPcs, ranges = params.ranges, profile = params.profile, keyPc = params.keyPc, chord = params.chord, prevChord = params.prevChord, allowUnisonD4 = params.allowUnisonD4, bassPreferPc = params.bassPreferPc, lockBassToPrefer = params.lockBassToPrefer;
    var warnings = [];
    var allowUnison = !!allowUnisonD4;
    var bassPcs = lockBassToPrefer && bassPreferPc !== null ? [bassPreferPc] : chordPcs.slice();
    var bassCands = collectChordMidis(bassPcs, ranges.B);
    var tenorCands = collectChordMidis(chordPcs, ranges.T);
    var altoCands = collectChordMidis(chordPcs, ranges.A);
    var runSearch = function (opts) {
        var best = null;
        for (var _i = 0, bassCands_1 = bassCands; _i < bassCands_1.length; _i++) {
            var b = bassCands_1[_i];
            for (var _a = 0, tenorCands_1 = tenorCands; _a < tenorCands_1.length; _a++) {
                var t = tenorCands_1[_a];
                for (var _b = 0, altoCands_1 = altoCands; _b < altoCands_1.length; _b++) {
                    var a = altoCands_1[_b];
                    if (a >= proposed.S)
                        continue;
                    var candidate = { S: proposed.S, A: a, T: t, B: b };
                    if (opts.allowOrdering && !orderingOk(candidate, allowUnison))
                        continue;
                    var scoreResult = scorePolyphonicVoicing({
                        prev: prev,
                        next: candidate,
                        ranges: ranges,
                        profile: profile,
                        keyPc: keyPc,
                        keyMode: null,
                        chord: chord,
                        prevChord: prevChord
                    });
                    var dist = Math.abs(candidate.A - proposed.A) +
                        Math.abs(candidate.T - proposed.T) +
                        Math.abs(candidate.B - proposed.B);
                    var total = scoreResult.score + dist * 0.25;
                    if (!best || total < best.score)
                        best = { state: candidate, score: total };
                }
            }
        }
        if (!best)
            return null;
        warnings.push("[poly] WARN ".concat(opts.label, ": repaired voicing via alternate chord tones."));
        return best.state;
    };
    var repaired = runSearch({ allowOrdering: true, label: "ordering" });
    if (repaired)
        return { state: repaired, warnings: warnings };
    var octaveShift = function (m, shift) {
        var shifted = m + shift;
        return shifted;
    };
    var octaveShifted = function (cands, range) {
        var out = new Set(cands);
        for (var _i = 0, cands_1 = cands; _i < cands_1.length; _i++) {
            var m = cands_1[_i];
            var up = octaveShift(m, 12);
            var down = octaveShift(m, -12);
            if (up !== null && up >= range.min && up <= range.max)
                out.add(up);
            if (down !== null && down >= range.min && down <= range.max)
                out.add(down);
        }
        return Array.from(out).sort(function (a, b) { return a - b; });
    };
    var bassCands2 = octaveShifted(bassCands, ranges.B);
    var tenorCands2 = octaveShifted(tenorCands, ranges.T);
    var altoCands2 = octaveShifted(altoCands, ranges.A);
    var runSearchWithOctaves = function () {
        var best = null;
        for (var _i = 0, bassCands2_2 = bassCands2; _i < bassCands2_2.length; _i++) {
            var b = bassCands2_2[_i];
            for (var _a = 0, tenorCands2_2 = tenorCands2; _a < tenorCands2_2.length; _a++) {
                var t = tenorCands2_2[_a];
                for (var _b = 0, altoCands2_2 = altoCands2; _b < altoCands2_2.length; _b++) {
                    var a = altoCands2_2[_b];
                    if (a >= proposed.S)
                        continue;
                    var candidate = { S: proposed.S, A: a, T: t, B: b };
                    if (!orderingOk(candidate, allowUnison))
                        continue;
                    var scoreResult = scorePolyphonicVoicing({
                        prev: prev,
                        next: candidate,
                        ranges: ranges,
                        profile: profile,
                        keyPc: keyPc,
                        keyMode: null,
                        chord: chord,
                        prevChord: prevChord
                    });
                    var dist = Math.abs(candidate.A - proposed.A) +
                        Math.abs(candidate.T - proposed.T) +
                        Math.abs(candidate.B - proposed.B);
                    var total = scoreResult.score + dist * 0.25;
                    if (!best || total < best.score)
                        best = { state: candidate, score: total };
                }
            }
        }
        if (!best)
            return null;
        warnings.push("[poly] WARN octave-shift: applied octave shifts to resolve ordering.");
        return best.state;
    };
    repaired = runSearchWithOctaves();
    if (repaired)
        return { state: repaired, warnings: warnings };
    var fallback = null;
    var fallbackScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, bassCands2_1 = bassCands2; _i < bassCands2_1.length; _i++) {
        var b = bassCands2_1[_i];
        for (var _a = 0, tenorCands2_1 = tenorCands2; _a < tenorCands2_1.length; _a++) {
            var t = tenorCands2_1[_a];
            for (var _b = 0, altoCands2_1 = altoCands2; _b < altoCands2_1.length; _b++) {
                var a = altoCands2_1[_b];
                if (a >= proposed.S)
                    continue;
                var candidate = { S: proposed.S, A: a, T: t, B: b };
                var scoreResult = scorePolyphonicVoicing({
                    prev: prev,
                    next: candidate,
                    ranges: ranges,
                    profile: profile,
                    keyPc: keyPc,
                    keyMode: null,
                    chord: chord,
                    prevChord: prevChord
                });
                var dist = Math.abs(candidate.A - proposed.A) + Math.abs(candidate.T - proposed.T) + Math.abs(candidate.B - proposed.B);
                var total = scoreResult.score + dist * 0.25;
                if (total < fallbackScore) {
                    fallbackScore = total;
                    fallback = candidate;
                }
            }
        }
    }
    if (fallback) {
        warnings.push("[poly] WARN relaxed: chose least-bad voicing (ordering relaxed).");
        return { state: fallback, warnings: warnings };
    }
    warnings.push("[poly] WARN fallback: could not repair voicing, using proposed values.");
    return { state: proposed, warnings: warnings };
}
