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
exports.initRhythmState = initRhythmState;
exports.updateRhythmState = updateRhythmState;
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
function initRhythmState() {
    return {
        totalAttacks: 0,
        perVoice: { vln1: 0, vln2: 0, vla: 0, vc: 0, cb: 0 }
    };
}
function updateRhythmState(prev, voicing, config) {
    var _a, _b;
    var next = {
        totalAttacks: prev.totalAttacks,
        perVoice: __assign({}, prev.perVoice)
    };
    var activeCount = 0;
    for (var _i = 0, VOICES_1 = VOICES; _i < VOICES_1.length; _i++) {
        var v = VOICES_1[_i];
        var note = voicing[v];
        if (note !== null) {
            next.perVoice[v] = ((_a = next.perVoice[v]) !== null && _a !== void 0 ? _a : 0) + 1;
            next.totalAttacks += 1;
            activeCount += 1;
        }
    }
    var penalty = 0;
    if (activeCount === VOICES.length) {
        penalty += config.allAttackPenalty;
    }
    var total = Math.max(1, next.totalAttacks);
    for (var _c = 0, VOICES_2 = VOICES; _c < VOICES_2.length; _c++) {
        var v = VOICES_2[_c];
        var ratio = ((_b = next.perVoice[v]) !== null && _b !== void 0 ? _b : 0) / total;
        if (ratio > config.maxVoiceDominance) {
            penalty += config.dominancePenalty * (ratio - config.maxVoiceDominance) * 10;
        }
    }
    return { next: next, penalty: penalty };
}
