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
exports.loadCounterpointRules = loadCounterpointRules;
exports.scoreTransition = scoreTransition;
var fs_1 = require("fs");
var path_1 = require("path");
var url_1 = require("url");
var rhythmStratification_1 = require("./rhythmStratification");
var __filename = (0, url_1.fileURLToPath)(import.meta.url);
var __dirname = path_1.default.dirname(__filename);
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
function loadCounterpointRules() {
    var _a;
    var baseSpecies = readJson(path_1.default.join(process.cwd(), "rules", "counterpoint", "counterpoint_species_rules.json"));
    var baseVoiceLeading = readJson(path_1.default.join(process.cwd(), "rules", "harmony", "voiceleading_rules.json"));
    var defaults = readJson(path_1.default.join(__dirname, "defaultPolyphonyRules.json"));
    var voiceleading = baseVoiceLeading !== null && baseVoiceLeading !== void 0 ? baseVoiceLeading : {};
    if (!voiceleading.voice_leading_constraints)
        voiceleading.voice_leading_constraints = {};
    if (!voiceleading.voice_leading_constraints.voice_crossing) {
        voiceleading.voice_leading_constraints.voice_crossing = {
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
    }
    return {
        species: baseSpecies !== null && baseSpecies !== void 0 ? baseSpecies : {},
        voiceleading: voiceleading,
        polyphony: ((_a = defaults === null || defaults === void 0 ? void 0 : defaults.polyphony) !== null && _a !== void 0 ? _a : {})
    };
}
function readJson(filePath) {
    try {
        var raw = fs_1.default.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch (_a) {
        return null;
    }
}
function direction(a, b) {
    if (a === null || b === null)
        return "static";
    if (b > a)
        return "up";
    if (b < a)
        return "down";
    return "static";
}
function relativeMotion(a0, a1, b0, b1) {
    var d1 = direction(a0, a1);
    var d2 = direction(b0, b1);
    if (d1 === "static" || d2 === "static")
        return "oblique";
    if (d1 === d2) {
        var i1 = Math.abs((a1 !== null && a1 !== void 0 ? a1 : 0) - (a0 !== null && a0 !== void 0 ? a0 : 0));
        var i2 = Math.abs((b1 !== null && b1 !== void 0 ? b1 : 0) - (b0 !== null && b0 !== void 0 ? b0 : 0));
        return i1 === i2 ? "parallel" : "similar";
    }
    return "contrary";
}
function intervalClass(semitones) {
    var mod = ((semitones % 12) + 12) % 12;
    if (mod === 0 || mod === 7)
        return "perfect";
    if (mod === 3 || mod === 4 || mod === 8 || mod === 9)
        return "imperfect";
    return "dissonant";
}
function intervalName(semitones) {
    var mod = ((semitones % 12) + 12) % 12;
    if (mod === 0)
        return "P8";
    if (mod === 7)
        return "P5";
    if (mod === 3)
        return "m3";
    if (mod === 4)
        return "M3";
    if (mod === 8)
        return "m6";
    if (mod === 9)
        return "M6";
    if (mod === 5)
        return "P4";
    if (mod === 1)
        return "m2";
    if (mod === 2)
        return "M2";
    if (mod === 10)
        return "m7";
    if (mod === 11)
        return "M7";
    return "int";
}
function verticalInterval(a, b) {
    if (a === null || b === null)
        return null;
    return Math.abs(a - b);
}
function isStep(a, b) {
    if (a === null || b === null)
        return false;
    return Math.abs(a - b) <= 2;
}
function scoreTransition(prev, next, rules, isStrongBeat, rhythmState, prevPendingRecovery, prevPendingResolution, prevParallelPerfectCounts) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (rhythmState === void 0) { rhythmState = (0, rhythmStratification_1.initRhythmState)(); }
    if (prevPendingRecovery === void 0) { prevPendingRecovery = {
        vln1: null,
        vln2: null,
        vla: null,
        vc: null,
        cb: null
    }; }
    if (prevPendingResolution === void 0) { prevPendingResolution = []; }
    if (prevParallelPerfectCounts === void 0) { prevParallelPerfectCounts = {}; }
    var ruleHits = [];
    var poly = rules.polyphony;
    var species1 = ((_b = (_a = rules.species) === null || _a === void 0 ? void 0 : _a.species_1) !== null && _b !== void 0 ? _b : {});
    var species2 = ((_d = (_c = rules.species) === null || _c === void 0 ? void 0 : _c.species_2) !== null && _d !== void 0 ? _d : {});
    var pendingRecovery = __assign({}, prevPendingRecovery);
    var pendingResolution = new Set(prevPendingResolution);
    var parallelPerfectCounts = __assign({}, prevParallelPerfectCounts);
    var cost = 0;
    // Leap recovery enforcement.
    for (var _i = 0, VOICES_1 = VOICES; _i < VOICES_1.length; _i++) {
        var v = VOICES_1[_i];
        var a = prev[v];
        var b = next[v];
        if (a === null || b === null) {
            pendingRecovery[v] = null;
            continue;
        }
        var prevDir = prevPendingRecovery[v];
        if (prevDir) {
            var dir = direction(a, b);
            var step = isStep(a, b);
            if (dir === prevDir || !step) {
                cost += 3;
                ruleHits.push({ id: "recovery_missing", cost: 3, detail: v });
            }
            pendingRecovery[v] = null;
        }
        var leap = Math.abs(b - a) >= 5;
        if (leap) {
            pendingRecovery[v] = direction(a, b);
            ruleHits.push({ id: "leap", cost: 1, detail: v });
        }
    }
    // Pairwise motion scoring
    var pairs = [
        ["vln1", "cb", true],
        ["vln1", "vln2", false],
        ["vln2", "vla", false],
        ["vla", "vc", false],
        ["vc", "cb", false]
    ];
    for (var _m = 0, pairs_1 = pairs; _m < pairs_1.length; _m++) {
        var _o = pairs_1[_m], top_1 = _o[0], bottom = _o[1], outer = _o[2];
        var a0 = prev[top_1];
        var b0 = prev[bottom];
        var a1 = next[top_1];
        var b1 = next[bottom];
        if (a1 === null || b1 === null)
            continue;
        var pairKey = "".concat(top_1, "-").concat(bottom);
        var rel = relativeMotion(a0, a1, b0, b1);
        var motionWeight = poly.motionPriorityWeights[rel];
        cost += motionWeight;
        ruleHits.push({ id: "motion_".concat(rel), cost: motionWeight, detail: "".concat(top_1, "-").concat(bottom) });
        var intPrev = verticalInterval(a0, b0);
        var intNext = verticalInterval(a1, b1);
        if (intPrev !== null && intNext !== null) {
            var clsPrev = intervalClass(intPrev);
            var clsNext = intervalClass(intNext);
            if (pendingResolution.has(pairKey) && isStrongBeat) {
                var resolved = clsNext !== "dissonant" && (isStep(a0, a1) || isStep(b0, b1));
                if (!resolved) {
                    cost += poly.passingToneRules.strongBeatDissonancePenalty;
                    ruleHits.push({ id: "resolve_fail", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
                }
                else {
                    ruleHits.push({ id: "resolve_ok", cost: 0, detail: pairKey });
                }
                pendingResolution.delete(pairKey);
            }
            if (clsPrev === "perfect" && clsNext === "perfect" && rel === "parallel") {
                var name_1 = intervalName(intNext);
                var forbidden = Array.isArray(species1.no_parallels) ? species1.no_parallels : ["P5", "P8"];
                if (forbidden.includes(name_1)) {
                    cost += 40;
                    ruleHits.push({ id: "parallel_perfect", cost: 40, detail: "".concat(top_1, "-").concat(bottom) });
                }
                var chainKey = "".concat(top_1, "-").concat(bottom);
                var prevCount = (_e = parallelPerfectCounts[chainKey]) !== null && _e !== void 0 ? _e : 0;
                var nextCount = prevCount + 1;
                parallelPerfectCounts[chainKey] = nextCount;
                if (nextCount > 2) {
                    cost += 6;
                    ruleHits.push({ id: "parallel_perfect_chain", cost: 6, detail: chainKey });
                }
            }
            else {
                var chainKey = "".concat(top_1, "-").concat(bottom);
                parallelPerfectCounts[chainKey] = 0;
            }
            if (clsNext === "perfect" && rel === "similar" && outer) {
                var topStep = isStep(a0, a1);
                var hiddenCost = topStep ? 6 : 15;
                cost += hiddenCost;
                ruleHits.push({ id: "hidden_perfect", cost: hiddenCost, detail: "".concat(top_1, "-").concat(bottom) });
            }
            if (clsNext === "dissonant") {
                var strongBeatConsonantRequired = species2.strong_beat_consonant_required === true;
                if (!isStrongBeat && poly.passingToneRules.allowWeakBeatDissonance) {
                    var stepApproach = !poly.passingToneRules.requireStepApproach || (isStep(a0, a1) && isStep(b0, b1));
                    if (stepApproach) {
                        cost += poly.passingToneRules.weakBeatDissonancePenalty;
                        ruleHits.push({ id: "passing_dissonance", cost: poly.passingToneRules.weakBeatDissonancePenalty, detail: pairKey });
                        if (poly.passingToneRules.requireStepResolve)
                            pendingResolution.add(pairKey);
                    }
                    else {
                        cost += poly.passingToneRules.strongBeatDissonancePenalty;
                        ruleHits.push({ id: "dissonance", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
                    }
                }
                else {
                    var oblique = rel === "oblique";
                    var suspensionCandidate = isStrongBeat && clsPrev !== "dissonant" && oblique;
                    if (suspensionCandidate) {
                        cost += poly.passingToneRules.weakBeatDissonancePenalty;
                        ruleHits.push({ id: "suspension", cost: poly.passingToneRules.weakBeatDissonancePenalty, detail: pairKey });
                        pendingResolution.add(pairKey);
                    }
                    else {
                        cost += poly.passingToneRules.strongBeatDissonancePenalty;
                        ruleHits.push({ id: "dissonance", cost: poly.passingToneRules.strongBeatDissonancePenalty, detail: pairKey });
                        if (strongBeatConsonantRequired) {
                            cost += 1.5;
                            ruleHits.push({ id: "strong_beat_consonant", cost: 1.5, detail: pairKey });
                        }
                    }
                }
            }
        }
    }
    // Extra strict parallel perfect check across all voice pairs.
    var pairSet = new Set(pairs.map(function (p) { return "".concat(p[0], "-").concat(p[1]); }));
    for (var i = 0; i < VOICES.length; i++) {
        for (var j = i + 1; j < VOICES.length; j++) {
            var top_2 = VOICES[i];
            var bottom = VOICES[j];
            var key = "".concat(top_2, "-").concat(bottom);
            if (pairSet.has(key))
                continue;
            var a0 = prev[top_2];
            var b0 = prev[bottom];
            var a1 = next[top_2];
            var b1 = next[bottom];
            if (a1 === null || b1 === null)
                continue;
            var intPrev = verticalInterval(a0, b0);
            var intNext = verticalInterval(a1, b1);
            if (intPrev === null || intNext === null)
                continue;
            if (intervalClass(intPrev) !== "perfect" || intervalClass(intNext) !== "perfect")
                continue;
            var rel = relativeMotion(a0, a1, b0, b1);
            if (rel !== "parallel")
                continue;
            var name_2 = intervalName(intNext);
            var forbidden = Array.isArray(species1.no_parallels) ? species1.no_parallels : ["P5", "P8"];
            if (forbidden.includes(name_2)) {
                cost += 30;
                ruleHits.push({ id: "parallel_perfect_any", cost: 30, detail: key });
            }
        }
    }
    // Simple crossing penalty (soft)
    if ((_f = rules.voiceleading) === null || _f === void 0 ? void 0 : _f.no_crossing) {
        var order = ["vln1", "vln2", "vla", "vc", "cb"];
        for (var i = 0; i < order.length - 1; i++) {
            var hi = next[order[i]];
            var lo = next[order[i + 1]];
            if (hi !== null && lo !== null && lo > hi) {
                cost += 4;
                ruleHits.push({ id: "crossing", cost: 4, detail: "".concat(order[i + 1], ">").concat(order[i]) });
            }
        }
    }
    // Spacing and overlap penalties
    var spacingCfg = (_h = (_g = rules.voiceleading) === null || _g === void 0 ? void 0 : _g.max_spacing) !== null && _h !== void 0 ? _h : {};
    var spacingLimit = function (label) {
        if (!label)
            return null;
        if (label === "octave")
            return 12;
        if (label === "twelfth")
            return 19;
        return null;
    };
    var spacingPairs = [
        ["vln1", "vln2", (_j = spacingCfg.between_SA) !== null && _j !== void 0 ? _j : spacingCfg.between_upper_voices],
        ["vln2", "vla", (_k = spacingCfg.between_AT) !== null && _k !== void 0 ? _k : spacingCfg.between_upper_voices],
        ["vla", "vc", spacingCfg.between_TB],
        ["vc", "cb", spacingCfg.between_TB]
    ];
    for (var _p = 0, spacingPairs_1 = spacingPairs; _p < spacingPairs_1.length; _p++) {
        var _q = spacingPairs_1[_p], hiVoice = _q[0], loVoice = _q[1], label = _q[2];
        var hi = next[hiVoice];
        var lo = next[loVoice];
        if (hi === null || lo === null)
            continue;
        var limit = spacingLimit(label);
        if (limit !== null && Math.abs(hi - lo) > limit) {
            cost += 2;
            ruleHits.push({ id: "spacing", cost: 2, detail: "".concat(hiVoice, "-").concat(loVoice) });
        }
        if ((_l = rules.voiceleading) === null || _l === void 0 ? void 0 : _l.no_overlap) {
            if (hiVoice === "vla" && loVoice === "vc")
                continue;
            if (hiVoice === "vln2" && loVoice === "vla")
                continue;
            var prevLo = prev[loVoice];
            if (prevLo !== null && hi < prevLo) {
                cost += 2;
                ruleHits.push({ id: "overlap", cost: 2, detail: "".concat(hiVoice, "<").concat(loVoice) });
            }
        }
    }
    // Prevent Violin I and II unison overlap.
    if (next.vln1 !== null && next.vln2 !== null && next.vln1 === next.vln2) {
        cost += 8;
        ruleHits.push({ id: "vln1_vln2_unison", cost: 8, detail: "vln1==vln2" });
    }
    // Prevent Violin II and Viola unison overlap.
    if (next.vln2 !== null && next.vla !== null && next.vln2 === next.vla) {
        cost += 6;
        ruleHits.push({ id: "vln2_vla_unison", cost: 6, detail: "vln2==vla" });
    }
    // Prevent Cello/Bass unison overlap.
    if (next.vc !== null && next.cb !== null && next.vc === next.cb) {
        cost += 6;
        ruleHits.push({ id: "bass_cello_overlap", cost: 6, detail: "vc==cb" });
    }
    // Rhythm stratification penalty
    var rhythm = (0, rhythmStratification_1.updateRhythmState)(rhythmState, next, poly.rhythmicStratification);
    if (rhythm.penalty > 0) {
        cost += rhythm.penalty;
        ruleHits.push({ id: "rhythm_balance", cost: rhythm.penalty });
    }
    return {
        cost: cost,
        ruleHits: ruleHits,
        pendingRecovery: pendingRecovery,
        pendingResolution: Array.from(pendingResolution),
        rhythmState: rhythm.next,
        parallelPerfectCounts: parallelPerfectCounts
    };
}
