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
exports.PROFILE_WEIGHTS = exports.DEFAULT_PROFILE = void 0;
exports.evaluateTransition = evaluateTransition;
exports.isSeverePenalty = isSeverePenalty;
var primitives_1 = require("./primitives");
var ranges_1 = require("./ranges");
var PERFECT_IDS = new Set(["parallel_perfect", "hidden_perfect"]);
exports.DEFAULT_PROFILE = {
    stepPreference: 1.2,
    leapPenalty: 4.5,
    recoveryPenalty: 3.5,
    parallelPerfectPenalty: 12,
    hiddenPerfectPenalty: 6,
    dissonancePenalty: 3,
    crossingPenalty: 4,
    rangePenalty: 6,
    tessituraPenalty: 1.5,
    perfectChainPenalty: 1.5
};
exports.PROFILE_WEIGHTS = {
    hymn_support: __assign(__assign({}, exports.DEFAULT_PROFILE), { stepPreference: 1.4, leapPenalty: 5.5, dissonancePenalty: 4 }),
    countermelody: __assign(__assign({}, exports.DEFAULT_PROFILE), { stepPreference: 1.2, leapPenalty: 4.5, dissonancePenalty: 3 }),
    cinematic_pads: __assign(__assign({}, exports.DEFAULT_PROFILE), { stepPreference: 1.0, leapPenalty: 3.5, dissonancePenalty: 2.5 }),
    dance_baroque: __assign(__assign({}, exports.DEFAULT_PROFILE), { stepPreference: 1.3, leapPenalty: 4.8, dissonancePenalty: 3.2 })
};
function evaluateTransition(prev, next, context) {
    var penalties = [];
    var pending = __assign({}, context.pendingRecovery);
    var profile = context.profile;
    var voices = ["vln1", "vln2", "vla", "vc", "cb"];
    for (var _i = 0, voices_1 = voices; _i < voices_1.length; _i++) {
        var v = voices_1[_i];
        var a = prev[v];
        var b = next[v];
        if (b === null)
            continue;
        var dir = (0, primitives_1.direction)(a, b);
        var prim = (0, primitives_1.melodicPrimitive)(a, b);
        var pendingDir = context.pendingRecovery[v];
        if (pendingDir) {
            var isStep = prim === "half_step" || prim === "whole_step" || prim === "step";
            var isSkip = prim === "skip";
            var opposite = dir !== "static" && dir !== pendingDir;
            if (opposite && isStep) {
                pending[v] = null;
            }
            else if (opposite && isSkip) {
                penalties.push({ id: "recovery_skip", cost: profile.recoveryPenalty * 0.5, detail: v });
                pending[v] = null;
            }
            else {
                penalties.push({ id: "recovery_missed", cost: profile.recoveryPenalty, detail: v });
            }
        }
        if (prim === "leap") {
            var scale = v === "cb" ? 1.4 : v === "vc" ? 1.2 : 1;
            penalties.push({ id: "leap", cost: profile.leapPenalty * scale, detail: v });
            if (dir !== "static")
                pending[v] = dir;
        }
        else if (prim === "skip") {
            penalties.push({ id: "skip", cost: profile.leapPenalty * 0.5, detail: v });
        }
        else if (prim === "half_step" || prim === "whole_step" || prim === "step") {
            penalties.push({ id: "step_preference", cost: -profile.stepPreference, detail: v });
        }
        var range = ranges_1.STRING_RANGES[v];
        if (b < range.absMin || b > range.absMax) {
            penalties.push({ id: "range_violation", cost: profile.rangePenalty * 2, detail: v });
        }
        else if (b < range.prefMin || b > range.prefMax) {
            penalties.push({ id: "tessitura", cost: profile.tessituraPenalty, detail: v });
        }
    }
    // Crossing and spacing
    var order = ["vln1", "vln2", "vla", "vc", "cb"];
    for (var i = 0; i < order.length - 1; i++) {
        var hi = next[order[i]];
        var lo = next[order[i + 1]];
        if (hi === null || lo === null)
            continue;
        if (lo > hi) {
            penalties.push({ id: "crossing", cost: profile.crossingPenalty, detail: "".concat(order[i + 1], ">").concat(order[i]) });
        }
    }
    // Violin I and II spacing: prefer within octave, hard cap ~19 semitones.
    if (next.vln1 !== null && next.vln2 !== null) {
        var dist = next.vln1 - next.vln2;
        if (dist > 19) {
            penalties.push({ id: "vln2_spacing_hard", cost: profile.crossingPenalty * 1.5, detail: String(dist) });
        }
        else if (dist > 12) {
            penalties.push({ id: "vln2_spacing_soft", cost: profile.crossingPenalty * 0.5, detail: String(dist) });
        }
    }
    // Gap fill: if Vln2 to Cello gap exceeds octave, prefer Viola to fill.
    if (next.vln2 !== null && next.vc !== null) {
        var gap = next.vln2 - next.vc;
        if (gap > 12) {
            var vla = next.vla;
            var fills = vla !== null && vla < next.vln2 && vla > next.vc;
            if (!fills) {
                penalties.push({ id: "gap_fill", cost: profile.tessituraPenalty * 1.2, detail: String(gap) });
            }
        }
    }
    // Vertical constraints
    var pairs = [
        ["vln1", "cb", true],
        ["vln1", "vln2", false],
        ["vln2", "vla", false],
        ["vla", "vc", false],
        ["vc", "cb", false]
    ];
    for (var _a = 0, pairs_1 = pairs; _a < pairs_1.length; _a++) {
        var _b = pairs_1[_a], top_1 = _b[0], bottom = _b[1], outer = _b[2];
        var a0 = prev[top_1];
        var b0 = prev[bottom];
        var a1 = next[top_1];
        var b1 = next[bottom];
        if (a1 === null || b1 === null)
            continue;
        var intPrev = (0, primitives_1.verticalInterval)(a0, b0);
        var intNext = (0, primitives_1.verticalInterval)(a1, b1);
        if (intPrev !== null && intNext !== null) {
            var clsPrev = (0, primitives_1.intervalClass)(intPrev);
            var clsNext = (0, primitives_1.intervalClass)(intNext);
            var rel = (0, primitives_1.relativeMotion)(a0, a1, b0, b1);
            if (clsPrev === "perfect" && clsNext === "perfect" && rel === "parallel") {
                penalties.push({
                    id: "parallel_perfect",
                    cost: profile.parallelPerfectPenalty,
                    detail: "".concat(top_1, "-").concat(bottom)
                });
            }
            if (clsNext === "perfect" && rel === "similar" && outer) {
                var topPrim = (0, primitives_1.melodicPrimitive)(a0, a1);
                var isStep = topPrim === "half_step" || topPrim === "whole_step" || topPrim === "step";
                if (!isStep) {
                    penalties.push({
                        id: "hidden_perfect",
                        cost: profile.hiddenPerfectPenalty,
                        detail: "".concat(top_1, "-").concat(bottom)
                    });
                }
            }
            if (clsNext === "perfect" && clsPrev === "perfect") {
                penalties.push({ id: "perfect_chain", cost: profile.perfectChainPenalty, detail: "".concat(top_1, "-").concat(bottom) });
            }
            if ((0, primitives_1.intervalClass)(intNext) === "dissonant") {
                penalties.push({ id: "dissonance", cost: profile.dissonancePenalty, detail: "".concat(top_1, "-").concat(bottom) });
            }
        }
    }
    var cost = penalties.reduce(function (sum, p) { return sum + p.cost; }, 0);
    return { cost: cost, penalties: penalties, pendingRecovery: pending };
}
function isSeverePenalty(p) {
    return PERFECT_IDS.has(p.id) && p.cost >= exports.DEFAULT_PROFILE.parallelPerfectPenalty;
}
