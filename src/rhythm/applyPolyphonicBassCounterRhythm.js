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
exports.applyPolyphonicBassCounterRhythm = applyPolyphonicBassCounterRhythm;
exports.applyPolyphonicTenorCounterRhythm = applyPolyphonicTenorCounterRhythm;
exports.applyPolyphonicAltoCounterRhythm = applyPolyphonicAltoCounterRhythm;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
var chordSymbol_1 = require("../harmonize/satb/chordSymbol");
function warn(warnings, msg) {
    warnings.push(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
}
function getMelodyPart(score) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var preferred = (_b = parts.find(function (p) {
        var _a;
        var name = String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase();
        return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    })) !== null && _b !== void 0 ? _b : parts[0];
    return preferred !== null && preferred !== void 0 ? preferred : null;
}
function getBassPart(score) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes("bass"))
            return p;
    }
    return parts.length ? parts[parts.length - 1] : null;
}
function getTenorPart(score) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_2 = parts; _i < parts_2.length; _i++) {
        var p = parts_2[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes("tenor"))
            return p;
    }
    return parts.length ? parts[1] : null;
}
function getAltoPart(score) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_3 = parts; _i < parts_3.length; _i++) {
        var p = parts_3[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes("alto"))
            return p;
    }
    return parts.length ? parts[2] : null;
}
function isNoteOrRest(e) {
    return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}
function near(a, b, eps) {
    if (eps === void 0) { eps = 1e-6; }
    return Math.abs(a - b) <= eps;
}
function isStrongBeat(t) {
    return near(t, Math.round(t));
}
function isChordBoundary(chords, measureNumber, t) {
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        if (Number(c.measure) !== Number(measureNumber))
            continue;
        if (near(Number(c.t), t))
            return true;
    }
    return false;
}
function shouldForceChordTone(chords, measureNumber, t) {
    if (isChordBoundary(chords, measureNumber, t))
        return true;
    if (isStrongBeat(t))
        return true;
    return false;
}
function ensureChordBoundaryEvents(events, chords, measureNumber, beatsPerMeasure) {
    var times = Array.from(new Set(chords
        .filter(function (c) { return Number(c.measure) === Number(measureNumber); })
        .map(function (c) { return Number(c.t); })
        .filter(function (t) { return Number.isFinite(t) && t >= 0 && t < beatsPerMeasure; }))).sort(function (a, b) { return a - b; });
    if (!times.length)
        return events.slice();
    var out = events.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var _loop_1 = function (t) {
        if (out.some(function (ev) { return isNoteOrRest(ev) && near(Number(ev.t), t); }))
            return "continue";
        var idx = out.findIndex(function (ev) {
            if (!isNoteOrRest(ev))
                return false;
            var start = Number(ev.t);
            var end = start + Number(ev.dur);
            return start < t && t < end - 1e-6;
        });
        if (idx < 0)
            return "continue";
        var ev = out[idx];
        var start = Number(ev.t);
        var end = start + Number(ev.dur);
        var beforeDur = t - start;
        var afterDur = end - t;
        if (beforeDur <= 1e-6 || afterDur <= 1e-6)
            return "continue";
        var before = __assign(__assign({}, ev), { dur: beforeDur });
        var after = __assign(__assign({}, ev), { t: t, dur: afterDur });
        out.splice(idx, 1, before, after);
    };
    for (var _i = 0, times_1 = times; _i < times_1.length; _i++) {
        var t = times_1[_i];
        _loop_1(t);
    }
    return out;
}
function shouldUseSixteenth(measureNumber, t, ratio, salt) {
    if (ratio === void 0) { ratio = 0.15; }
    if (salt === void 0) { salt = 0; }
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 73856093) ^ (tKey * 19349663) ^ (salt * 83492791) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
function activityRatio(level) {
    switch (level) {
        case "high_active":
            return 1;
        case "active":
            return 0.55;
        case "less_active":
            return 0.3;
        case "grounded":
        default:
            return 0;
    }
}
function shouldUseActive(measureNumber, t, ratio) {
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ 0x27d4eb2f;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
var SIXTEENTH_PATTERNS = [
    [
        { dur: 0.25, role: "chord" },
        { dur: 0.25, role: "passing" },
        { dur: 0.5, role: "chord" }
    ],
    [
        { dur: 0.5, role: "chord" },
        { dur: 0.25, role: "passing" },
        { dur: 0.25, role: "chord" }
    ],
    [
        { dur: 0.25, role: "chord" },
        { dur: 0.5, role: "passing" },
        { dur: 0.25, role: "chord" }
    ],
    [
        { dur: 0.75, role: "chord" },
        { dur: 0.25, role: "passing" }
    ]
];
function pickSixteenthPattern(measureNumber, t, salt) {
    var _a;
    if (salt === void 0) { salt = 0; }
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 1274126177) ^ (tKey * 1103515245) ^ (salt * 1540483477) ^ 0x85ebca6b;
    h = Math.abs(h >>> 0);
    var idx = h % SIXTEENTH_PATTERNS.length;
    return (_a = SIXTEENTH_PATTERNS[idx]) !== null && _a !== void 0 ? _a : SIXTEENTH_PATTERNS[0];
}
function pushPattern(out, t, pattern, dir) {
    var cursor = t;
    for (var _i = 0, pattern_1 = pattern; _i < pattern_1.length; _i++) {
        var step = pattern_1[_i];
        var ev = { type: "note", t: cursor, dur: step.dur, role: step.role };
        if (step.role === "passing")
            ev.dir = dir;
        out.push(ev);
        cursor += step.dur;
    }
}
function voiceSalt(tag) {
    if (!tag)
        return 0;
    var h = 0;
    for (var i = 0; i < tag.length; i++) {
        h = (h * 31 + tag.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}
function shouldUseActiveWithSalt(measureNumber, t, ratio, salt) {
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x27d4eb2f;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
var REPEAT_RATIO = 0.2;
function shouldAllowRepeatWithSalt(measureNumber, t, ratio, salt) {
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
function pickAltoActiveRole(measureNumber, t, chords) {
    if (isStrongBeat(t) || isChordBoundary(chords, measureNumber, t))
        return "chord";
    var weights = [
        { value: "passing", weight: 35 },
        { value: "neighbor", weight: 25 },
        { value: "skip", weight: 10 },
        { value: "leap", weight: 10 },
        { value: "chord", weight: 20 }
    ];
    var seed = (measureNumber * 1299709) ^ (Math.round(t * 1000) * 1511);
    return pickWeighted(weights, seed);
}
function activitySixteenthRatio(level) {
    switch (level) {
        case "high_active":
            return 0.35;
        case "active":
            return 0.12;
        case "less_active":
            return 0.04;
        default:
            return 0;
    }
}
function buildActiveWeightedBaseEvents(params) {
    var measureNumber = params.measureNumber, beatsPerMeasure = params.beatsPerMeasure, chords = params.chords, allowRests = params.allowRests, randomizeOffsets = params.randomizeOffsets, voiceTag = params.voiceTag, durationWhitelist = params.durationWhitelist;
    var out = [];
    var inMeasure = chords.filter(function (c) { return Number(c.measure) === Number(measureNumber); });
    var changePoints = Array.from(new Set(__spreadArray(__spreadArray([0], inMeasure.map(function (c) { return Number(c.t); }).filter(function (t) { return t >= 0 && t < beatsPerMeasure; }), true), [beatsPerMeasure], false))).sort(function (a, b) { return a - b; });
    var baseWeights = voiceTag === "tenor"
        ? [
            { value: 1, weight: 4 }, // quarter (40%)
            { value: 2, weight: 3 }, // half (30%)
            { value: 0.5, weight: 2 }, // eighth (20%)
            { value: 1.5, weight: 1 } // dotted-quarter
        ]
        : [
            { value: 0.5, weight: 25 },
            { value: 1, weight: 45 },
            { value: 2, weight: 20 },
            { value: 4, weight: 10 }
        ];
    var weights = Array.isArray(durationWhitelist) && durationWhitelist.length
        ? baseWeights.filter(function (w) { return durationWhitelist.includes(w.value); })
        : baseWeights;
    for (var idx = 0; idx < changePoints.length - 1; idx++) {
        var cursor = changePoints[idx];
        var end = changePoints[idx + 1];
        var offsetChance = 0.05;
        var offsetDur = end - cursor >= 0.5 ? 0.5 : 0;
        if (allowRests && randomizeOffsets !== false && offsetDur > 0) {
            var seed = (measureNumber * 7919) ^ (Math.round(cursor * 1000) * 197);
            var roll = ((seed >>> 0) % 1000) / 1000;
            if (roll < offsetChance) {
                out.push({ type: "rest", t: cursor, dur: offsetDur });
                cursor += offsetDur;
            }
        }
        var _loop_2 = function () {
            var remaining = end - cursor;
            var choices = weights.filter(function (c) { return c.value <= remaining + 1e-6; });
            if (!choices.length) {
                out.push({ type: "note", t: cursor, dur: remaining });
                return "break";
            }
            var seed = (measureNumber * 991) ^ (Math.round(cursor * 1000) * 313);
            var dur = pickWeighted(choices, seed);
            var restRoll = allowRests ? ((seed >>> 0) % 1000) / 1000 : 1;
            var restChance = 0.03;
            var type = allowRests && restRoll < restChance ? "rest" : "note";
            out.push({ type: type, t: cursor, dur: dur });
            cursor += dur;
        };
        while (cursor < end - 1e-6) {
            var state_1 = _loop_2();
            if (state_1 === "break")
                break;
        }
    }
    return out;
}
function pickWeighted(choices, seed) {
    var total = choices.reduce(function (sum, c) { return sum + c.weight; }, 0);
    if (total <= 0)
        return choices[0].value;
    var r = (seed % 1000) / 1000;
    var acc = 0;
    for (var _i = 0, choices_1 = choices; _i < choices_1.length; _i++) {
        var c = choices_1[_i];
        acc += c.weight / total;
        if (r <= acc)
            return c.value;
    }
    return choices[choices.length - 1].value;
}
function buildIndependentBaseEvents(params) {
    var measureNumber = params.measureNumber, beatsPerMeasure = params.beatsPerMeasure, chords = params.chords, activity = params.activity, allowRests = params.allowRests, randomizeOffsets = params.randomizeOffsets, voiceTag = params.voiceTag, durationWhitelist = params.durationWhitelist;
    var out = [];
    var salt = voiceSalt(voiceTag);
    var inMeasure = chords.filter(function (c) { return Number(c.measure) === Number(measureNumber); });
    var changePoints = Array.from(new Set(__spreadArray(__spreadArray([0], inMeasure.map(function (c) { return Number(c.t); }).filter(function (t) { return t >= 0 && t < beatsPerMeasure; }), true), [beatsPerMeasure], false))).sort(function (a, b) { return a - b; });
    var activityLevel = activity !== null && activity !== void 0 ? activity : "less_active";
    var durationChoices = function (remaining, t) {
        var base = voiceTag === "tenor"
            ? activityLevel === "high_active"
                ? [
                    { value: 1, weight: 3 }, // quarter (30%)
                    { value: 0.5, weight: 5 }, // eighth (50%)
                    { value: 2, weight: 1 }, // other (half)
                    { value: 0.25, weight: 1 } // other (sixteenth)
                ]
                : activityLevel === "active"
                    ? [
                        { value: 1, weight: 4 }, // quarter (40%)
                        { value: 2, weight: 3 }, // half (30%)
                        { value: 0.5, weight: 2 }, // eighth (20%)
                        { value: 1.5, weight: 1 } // dotted-quarter (10%)
                    ]
                    : [
                        { value: 2, weight: 6 }, // half
                        { value: 1, weight: 4 } // quarter
                    ]
            : activityLevel === "high_active"
                ? [
                    { value: 0.5, weight: 5 },
                    { value: 0.25, weight: 4 },
                    { value: 1, weight: 2 },
                    { value: 2, weight: 1 }
                ]
                : activityLevel === "active"
                    ? [
                        { value: 1, weight: 4 },
                        { value: 0.5, weight: 3 },
                        { value: 2, weight: 1 }
                    ]
                    : [
                        { value: 2, weight: 5 },
                        { value: 1, weight: 3 },
                        { value: 0.5, weight: 1 }
                    ];
        var filtered = base.filter(function (c) { return c.value <= remaining + 1e-6; });
        if (Array.isArray(durationWhitelist) && durationWhitelist.length) {
            var limited = filtered.filter(function (c) { return durationWhitelist.includes(c.value); });
            return limited.length ? limited : filtered;
        }
        return filtered;
    };
    for (var idx = 0; idx < changePoints.length - 1; idx++) {
        var cursor = changePoints[idx];
        var end = changePoints[idx + 1];
        var offsetChance = activityLevel === "high_active" ? 0.35 : activityLevel === "active" ? 0.2 : activityLevel === "less_active" ? 0.1 : 0;
        var offsetDur = activityLevel === "high_active" && end - cursor >= 0.25
            ? 0.25
            : end - cursor >= 0.5
                ? 0.5
                : 0;
        if (allowRests && randomizeOffsets !== false && offsetDur > 0) {
            var seed = (measureNumber * 7919) ^ (Math.round(cursor * 1000) * 197) ^ (salt * 509);
            var roll = ((seed >>> 0) % 1000) / 1000;
            if (roll < offsetChance) {
                out.push({ type: "rest", t: cursor, dur: offsetDur });
                cursor += offsetDur;
            }
        }
        while (cursor < end - 1e-6) {
            var remaining = end - cursor;
            var choices = durationChoices(remaining, cursor);
            if (!choices.length)
                break;
            var seed = (measureNumber * 991) ^ (Math.round(cursor * 1000) * 313) ^ (salt * 271);
            var dur = pickWeighted(choices, seed);
            var restRoll = allowRests ? ((seed >>> 0) % 1000) / 1000 : 1;
            var restChance = activityLevel === "high_active" ? 0.08 : activityLevel === "active" ? 0.05 : 0.03;
            var type = allowRests && restRoll < restChance ? "rest" : "note";
            out.push({ type: type, t: cursor, dur: dur });
            cursor += dur;
        }
    }
    return out;
}
function passingDirFromRoots(rootNow, rootNext, measureNumber, t) {
    if (rootNow !== null && rootNext !== null && rootNow !== rootNext) {
        var diff = (rootNext - rootNow + 12) % 12;
        return diff <= 6 ? 1 : -1;
    }
    var key = measureNumber + Math.round(t * 2);
    return key % 2 === 0 ? 1 : -1;
}
var STEP_TO_PC = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
};
function getKeyFifths(score) {
    var _a, _b, _c, _d;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var fifths = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.key_fifths;
    if (typeof fifths === "number" && Number.isFinite(fifths))
        return fifths;
    return 0;
}
function getKeyMode(score) {
    var _a, _b, _c, _d, _e;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var raw = String((_e = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.key_mode) !== null && _e !== void 0 ? _e : "").toLowerCase();
    return raw === "minor" ? "minor" : "major";
}
function tonicPcFromFifthsMajor(fifths) {
    var _a;
    var map = {
        "-7": 11,
        "-6": 6,
        "-5": 1,
        "-4": 8,
        "-3": 3,
        "-2": 10,
        "-1": 5,
        "0": 0,
        "1": 7,
        "2": 2,
        "3": 9,
        "4": 4,
        "5": 11,
        "6": 6,
        "7": 1
    };
    return (_a = map[String(fifths)]) !== null && _a !== void 0 ? _a : 0;
}
function tonicPcFromFifthsMinor(fifths) {
    var _a;
    var map = {
        "-7": 8,
        "-6": 3,
        "-5": 10,
        "-4": 5,
        "-3": 0,
        "-2": 7,
        "-1": 2,
        "0": 9,
        "1": 4,
        "2": 11,
        "3": 6,
        "4": 1,
        "5": 8,
        "6": 3,
        "7": 10
    };
    return (_a = map[String(fifths)]) !== null && _a !== void 0 ? _a : 9;
}
function scalePcsForKey(tonicPc, mode) {
    var steps = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return steps.map(function (s) { return (tonicPc + s) % 12; });
}
function parseRootPc(symbolRaw) {
    var _a, _b;
    var s = String(symbolRaw !== null && symbolRaw !== void 0 ? symbolRaw : "").trim();
    if (!s)
        return null;
    var main = (_a = s.split("/")[0]) !== null && _a !== void 0 ? _a : s;
    var m = main.match(/^([A-Ga-g])([#b]?)/);
    if (!m)
        return null;
    var step = m[1].toUpperCase();
    var acc = (_b = m[2]) !== null && _b !== void 0 ? _b : "";
    var base = STEP_TO_PC[step];
    if (typeof base !== "number")
        return null;
    if (acc === "#")
        return (base + 1) % 12;
    if (acc === "b")
        return (base + 11) % 12;
    return base;
}
function parseBassPc(symbolRaw) {
    var _a, _b;
    var s = String(symbolRaw !== null && symbolRaw !== void 0 ? symbolRaw : "").trim();
    if (!s)
        return null;
    if (!s.includes("/"))
        return parseRootPc(s);
    var slash = (_a = s.split("/")[1]) !== null && _a !== void 0 ? _a : "";
    var m = slash.match(/^([A-Ga-g])([#b]?)/);
    if (!m)
        return parseRootPc(s);
    var step = m[1].toUpperCase();
    var acc = (_b = m[2]) !== null && _b !== void 0 ? _b : "";
    var base = STEP_TO_PC[step];
    if (typeof base !== "number")
        return parseRootPc(s);
    if (acc === "#")
        return (base + 1) % 12;
    if (acc === "b")
        return (base + 11) % 12;
    return base;
}
function pickChordForTime(chords, measure, t) {
    var _a;
    var inMeasure = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!inMeasure.length)
        return null;
    var sorted = inMeasure.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var best = null;
    for (var _i = 0, sorted_1 = sorted; _i < sorted_1.length; _i++) {
        var c = sorted_1[_i];
        if (Number(c.t) <= t + 1e-6)
            best = c;
        else
            break;
    }
    return (_a = best !== null && best !== void 0 ? best : sorted[0]) !== null && _a !== void 0 ? _a : null;
}
function chordFunction(rootPc, tonicPc) {
    if (rootPc === tonicPc)
        return "I";
    if (rootPc === (tonicPc + 5) % 12)
        return "IV";
    if (rootPc === (tonicPc + 7) % 12)
        return "V";
    return null;
}
function chooseBassMidi(pcTarget, prevMidi, range, anchorMidi, options) {
    if (anchorMidi === void 0) { anchorMidi = 43; }
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (((m % 12) + 12) % 12 === pcTarget)
            candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var maxLeap = options === null || options === void 0 ? void 0 : options.maxLeap;
    var leapCandidates = typeof maxLeap === "number" && Number.isFinite(maxLeap)
        ? candidates.filter(function (c) { return Math.abs(c - prevMidi) <= maxLeap; })
        : candidates;
    if (!leapCandidates.length && (options === null || options === void 0 ? void 0 : options.warnings) && (options === null || options === void 0 ? void 0 : options.context)) {
        warn(options.warnings, options.context);
    }
    var pool = leapCandidates.length ? leapCandidates : candidates;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, pool_1 = pool; _i < pool_1.length; _i++) {
        var c = pool_1[_i];
        var anchorPenalty = Math.abs(c - anchorMidi);
        var smoothPenalty = Math.abs(c - prevMidi) * 0.35;
        var score = anchorPenalty + smoothPenalty;
        if (score < bestScore) {
            best = c;
            bestScore = score;
        }
    }
    return best;
}
function chooseChordToneInDirection(chordPcs, prevMidi, range, dir, options) {
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (chordPcs.includes(((m % 12) + 12) % 12))
            candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var maxLeap = options === null || options === void 0 ? void 0 : options.maxLeap;
    var leapCandidates = typeof maxLeap === "number" && Number.isFinite(maxLeap)
        ? candidates.filter(function (c) { return Math.abs(c - prevMidi) <= maxLeap; })
        : candidates;
    if (!leapCandidates.length && (options === null || options === void 0 ? void 0 : options.warnings) && (options === null || options === void 0 ? void 0 : options.context)) {
        warn(options.warnings, options.context);
    }
    var pool = leapCandidates.length ? leapCandidates : candidates;
    var sorted = pool.sort(function (a, b) { return a - b; });
    if (dir > 0) {
        var up = sorted.find(function (m) { return m > prevMidi; });
        return up !== null && up !== void 0 ? up : sorted[0];
    }
    var down = __spreadArray([], sorted, true).reverse().find(function (m) { return m < prevMidi; });
    return down !== null && down !== void 0 ? down : sorted[sorted.length - 1];
}
function chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, options) {
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (chordPcs.includes(((m % 12) + 12) % 12))
            candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var maxLeap = options === null || options === void 0 ? void 0 : options.maxLeap;
    var leapCandidates = typeof maxLeap === "number" && Number.isFinite(maxLeap)
        ? candidates.filter(function (c) { return Math.abs(c - prevMidi) <= maxLeap; })
        : candidates;
    if (!leapCandidates.length && (options === null || options === void 0 ? void 0 : options.warnings) && (options === null || options === void 0 ? void 0 : options.context)) {
        warn(options.warnings, options.context);
    }
    var pool = leapCandidates.length ? leapCandidates : candidates;
    var best = pool[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, pool_2 = pool; _i < pool_2.length; _i++) {
        var c = pool_2[_i];
        var dist = Math.abs(c - prevMidi) * 0.8;
        var anchor = Math.abs(c - anchorMidi) * 0.2;
        var score = dist + anchor;
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    if ((options === null || options === void 0 ? void 0 : options.avoidRepeat) && best === prevMidi) {
        var nextBest = best;
        var nextScore = Number.POSITIVE_INFINITY;
        for (var _a = 0, pool_3 = pool; _a < pool_3.length; _a++) {
            var c = pool_3[_a];
            if (c === prevMidi)
                continue;
            var dist = Math.abs(c - prevMidi) * 0.8;
            var anchor = Math.abs(c - anchorMidi) * 0.2;
            var score = dist + anchor;
            if (score < nextScore) {
                nextScore = score;
                nextBest = c;
            }
        }
        if (nextBest !== best)
            return nextBest;
    }
    return best;
}
function chooseChordToneByInterval(chordPcs, prevMidi, range, minInterval, maxInterval, fallback) {
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;
    for (var midi = range.min; midi <= range.max; midi++) {
        if (!chordPcs.includes(((midi % 12) + 12) % 12))
            continue;
        var dist = Math.abs(midi - prevMidi);
        if (dist < minInterval || dist > maxInterval)
            continue;
        if (dist < bestScore) {
            bestScore = dist;
            best = midi;
        }
    }
    return best !== null && best !== void 0 ? best : fallback;
}
function chooseNeighborMidi(prevMidi, scalePcs, range, dir) {
    var candidate = prevMidi + dir;
    while (candidate >= range.min && candidate <= range.max) {
        if (scalePcs.includes(((candidate % 12) + 12) % 12))
            return candidate;
        candidate += dir;
    }
    return prevMidi;
}
function choosePassingMidi(prevMidi, scalePcs, range, dir) {
    var steps = [1, 2];
    for (var _i = 0, steps_1 = steps; _i < steps_1.length; _i++) {
        var step = steps_1[_i];
        var cand = prevMidi + dir * step;
        if (cand < range.min || cand > range.max)
            continue;
        if (scalePcs.includes(((cand % 12) + 12) % 12))
            return cand;
    }
    var fallback = prevMidi - dir;
    if (fallback >= range.min && fallback <= range.max && scalePcs.includes(((fallback % 12) + 12) % 12)) {
        return fallback;
    }
    return prevMidi;
}
function eventMidi(ev) {
    if (typeof (ev === null || ev === void 0 ? void 0 : ev.midi) === "number" && Number.isFinite(ev.midi))
        return ev.midi;
    if (ev === null || ev === void 0 ? void 0 : ev.pitch) {
        try {
            return (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
        }
        catch (_a) {
            return null;
        }
    }
    return null;
}
function findNoteMidiAtTime(events, t) {
    var _a;
    var active = null;
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var e = events_1[_i];
        if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
            continue;
        var et = Number(e.t);
        var ed = Number(e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(ed))
            continue;
        if (et <= t && t < et + ed) {
            active = e;
            break;
        }
    }
    if (!active) {
        active = (_a = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e.t) === t; })) !== null && _a !== void 0 ? _a : null;
    }
    return active ? eventMidi(active) : null;
}
function buildCounterRhythmEvents(params) {
    var melodyEvents = params.melodyEvents, followStrict = params.followStrict, allowRests = params.allowRests, measureNumber = params.measureNumber, chords = params.chords, beatsPerMeasure = params.beatsPerMeasure, tonicPc = params.tonicPc, activity = params.activity, independent = params.independent, randomizeOffsets = params.randomizeOffsets, voiceTag = params.voiceTag, durationWhitelist = params.durationWhitelist;
    var out = [];
    var forceDurationWhitelist = Array.isArray(durationWhitelist) && durationWhitelist.length > 0;
    var wantsWeightedActiveDurations = (voiceTag === "alto" || voiceTag === "tenor") && activity === "active" && independent && !followStrict;
    var wantsRoleWeighting = activity === "active" && independent && !followStrict;
    var base = followStrict && !forceDurationWhitelist
        ? melodyEvents.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); })
        : wantsWeightedActiveDurations
            ? buildActiveWeightedBaseEvents({
                measureNumber: measureNumber,
                beatsPerMeasure: beatsPerMeasure,
                chords: chords,
                allowRests: allowRests,
                randomizeOffsets: randomizeOffsets,
                voiceTag: voiceTag,
                durationWhitelist: durationWhitelist
            })
            : independent
                ? buildIndependentBaseEvents({
                    measureNumber: measureNumber,
                    beatsPerMeasure: beatsPerMeasure,
                    chords: chords,
                    activity: activity !== null && activity !== void 0 ? activity : "less_active",
                    allowRests: allowRests,
                    randomizeOffsets: randomizeOffsets,
                    voiceTag: voiceTag,
                    durationWhitelist: durationWhitelist
                })
                : melodyEvents.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var evs = followStrict && !forceDurationWhitelist || !independent
        ? base
        : ensureChordBoundaryEvents(base, chords, measureNumber, beatsPerMeasure);
    var activityLevel = activityRatio(activity);
    var salt = voiceSalt(voiceTag);
    var sixteenthRatio = activitySixteenthRatio(activity);
    for (var i = 0; i < evs.length; i++) {
        var ev = evs[i];
        if (!isNoteOrRest(ev))
            continue;
        var t = Number(ev.t);
        var dur = Number(ev.dur);
        var next = evs[i + 1];
        var useActive = shouldUseActiveWithSalt(measureNumber, t, activityLevel, salt);
        if (ev.type === "rest" && allowRests) {
            out.push({ type: "rest", t: t, dur: dur });
            continue;
        }
        if (wantsRoleWeighting) {
            out.push({ type: "note", t: t, dur: dur, role: pickAltoActiveRole(measureNumber, t, chords) });
            continue;
        }
        if (followStrict) {
            out.push({ type: "note", t: t, dur: dur, role: "chord" });
            continue;
        }
        var chordNow = pickChordForTime(chords, measureNumber, t);
        var chordNext = pickChordForTime(chords, t + dur < beatsPerMeasure ? measureNumber : measureNumber + 1, t + dur < beatsPerMeasure ? t + dur : 0);
        var rootNow = chordNow ? parseRootPc(chordNow.symbol) : null;
        var rootNext = chordNext ? parseRootPc(chordNext.symbol) : null;
        var fnNow = rootNow !== null ? chordFunction(rootNow, tonicPc) : null;
        var fnNext = rootNext !== null ? chordFunction(rootNext, tonicPc) : null;
        if (useActive && near(dur, 1) && fnNow === "IV" && fnNext === "I") {
            out.push({ type: "note", t: t, dur: 0.5, role: "arpUp", step: 0 });
            out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "arpUp", step: 1 });
            continue;
        }
        if (useActive && near(dur, 1) && fnNow === "V" && fnNext === "I") {
            out.push({ type: "note", t: t, dur: 0.5, role: "arpDown", step: 0 });
            out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "arpDown", step: 1 });
            continue;
        }
        if (near(dur, 2)) {
            var dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
            out.push({ type: "note", t: t, dur: 1, role: "chord" });
            if (useActive) {
                out.push({ type: "note", t: t + 1, dur: 0.5, role: "chord" });
                out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "passing", dir: dir });
            }
            else {
                out.push({ type: "note", t: t + 1, dur: 1, role: "chord" });
            }
            continue;
        }
        if (useActive &&
            near(dur, 1.5) &&
            next &&
            isNoteOrRest(next) &&
            near(Number(next.dur), 0.5) &&
            near(Number(next.t), t + 1.5)) {
            var dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
            out.push({ type: "note", t: t, dur: 0.5, role: "chord" });
            out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir: dir });
            out.push({ type: "note", t: t + 1.0, dur: 0.5, role: "chord" });
            out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "chord" });
            i += 1;
            continue;
        }
        if (useActive && near(dur, 1.5)) {
            var dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
            out.push({ type: "note", t: t, dur: 0.5, role: "chord" });
            out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir: dir });
            out.push({ type: "note", t: t + 1.0, dur: 0.5, role: "chord" });
            continue;
        }
        if (near(dur, 1) &&
            next &&
            isNoteOrRest(next) &&
            next.type === "note" &&
            near(Number(next.dur), 1) &&
            near(Number(next.t), t + 1)) {
            var midiNow = eventMidi(ev);
            var midiNext = eventMidi(next);
            if (useActive && midiNow !== null && midiNext !== null && midiNow === midiNext) {
                var dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
                var allow16th = shouldUseSixteenth(measureNumber, t + 1, sixteenthRatio, salt);
                out.push({ type: "note", t: t, dur: 0.5, role: "chord" });
                out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir: dir });
                if (allow16th) {
                    var pattern = pickSixteenthPattern(measureNumber, t + 1, salt);
                    pushPattern(out, t + 1, pattern, dir);
                }
                else {
                    out.push({ type: "note", t: t + 1, dur: 0.5, role: "chord" });
                    out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "passing", dir: dir });
                }
                i += 1;
                continue;
            }
            out.push({ type: "note", t: t, dur: 2, role: "chord" });
            i += 1;
            continue;
        }
        if (useActive && near(dur, 1)) {
            var dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
            var allow16th = shouldUseSixteenth(measureNumber, t, sixteenthRatio, salt);
            if (allow16th) {
                var pattern = pickSixteenthPattern(measureNumber, t, salt);
                pushPattern(out, t, pattern, dir);
            }
            else {
                out.push({ type: "note", t: t, dur: 0.5, role: "chord" });
                out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir: dir });
            }
            continue;
        }
        out.push({ type: "note", t: t, dur: dur, role: "chord" });
    }
    return out;
}
function applyPolyphonicBassCounterRhythm(score, chords, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var warnings = [];
    var bass = getBassPart(score);
    var melody = getMelodyPart(score);
    var chordEvents = Array.isArray(chords) && chords.length
        ? chords
        : Array.isArray((_b = (_a = score === null || score === void 0 ? void 0 : score.meta) === null || _a === void 0 ? void 0 : _a.harmonize) === null || _b === void 0 ? void 0 : _b.chords)
            ? score.meta.harmonize.chords
            : [];
    if (!bass || !melody) {
        warn(warnings, "[rhythm] Missing Bass or Melody part for polyphonic bass counter-rhythm.");
        return {
            applied: false,
            reason: "missing parts",
            style: "classical",
            detectedCadencePairs: [],
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var bassMeasures = Array.isArray(bass.measures) ? bass.measures : [];
    var melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
    var total = Math.min(bassMeasures.length, melMeasures.length);
    var applied = [];
    var range = { min: 40, max: 64 };
    if (typeof (options === null || options === void 0 ? void 0 : options.minMidiOverride) === "number" && Number.isFinite(options.minMidiOverride)) {
        range.min = Math.max(range.min, Math.round(options.minMidiOverride));
    }
    if (typeof (options === null || options === void 0 ? void 0 : options.maxMidiOverride) === "number" && Number.isFinite(options.maxMidiOverride)) {
        range.max = Math.min(range.max, Math.round(options.maxMidiOverride));
    }
    if (range.min > range.max)
        range.min = range.max;
    var maxLeap = 12;
    var prevMidi = 43;
    var keyMode = getKeyMode(score);
    var tonicPc = keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
    var scalePcs = scalePcsForKey(tonicPc, keyMode);
    var beatsPerMeasure = (_j = (_h = (_g = (_f = (_e = (_d = (_c = score.parts) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.measures) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.attributes) === null || _g === void 0 ? void 0 : _g.time) === null || _h === void 0 ? void 0 : _h.beats) !== null && _j !== void 0 ? _j : 4;
    var _loop_3 = function (i) {
        var b = bassMeasures[i];
        var m = melMeasures[i];
        if (!b || !m)
            return "continue";
        var mNum = Number(b === null || b === void 0 ? void 0 : b.number) || i + 1;
        var followStrict = i < 2 || i >= total - 2;
        var melEvents = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events.filter(isNoteOrRest) : [];
        var other = Array.isArray(b === null || b === void 0 ? void 0 : b.events) ? b.events.filter(function (e) { return !isNoteOrRest(e); }) : [];
        var counter = buildCounterRhythmEvents({
            melodyEvents: melEvents,
            followStrict: followStrict,
            allowRests: (options === null || options === void 0 ? void 0 : options.allowRests) === true,
            measureNumber: mNum,
            chords: chordEvents,
            beatsPerMeasure: beatsPerMeasure,
            tonicPc: tonicPc,
            activity: (_k = options === null || options === void 0 ? void 0 : options.activity) !== null && _k !== void 0 ? _k : "less_active",
            independent: true,
            randomizeOffsets: options === null || options === void 0 ? void 0 : options.randomizeOffsets,
            voiceTag: "bass"
        });
        if (!counter.length) {
            warn(warnings, "[rhythm] m".concat(mNum, ": no counter-rhythm events created for bass."));
            return "continue";
        }
        var enriched = counter.map(function (ev) {
            var _a, _b, _c, _d;
            if (ev.type === "rest")
                return ev;
            var forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
            var allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("bass"));
            var role = forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
                ? "chord"
                : ev.role;
            var chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
            var parsed = chord ? (0, chordSymbol_1.parseChordSymbol)((_a = chord.symbol.split("/")[0]) !== null && _a !== void 0 ? _a : chord.symbol) : null;
            var bassPc = chord ? parseBassPc(chord.symbol) : null;
            var chordPcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : (bassPc !== null ? [bassPc] : []);
            var rootPc = (_d = (_c = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _c !== void 0 ? _c : bassPc) !== null && _d !== void 0 ? _d : null;
            if (!chord || rootPc === null) {
                return __assign(__assign({}, ev), { type: "note", midi: prevMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(prevMidi), lockPitch: true });
            }
            var finalize = function (midi) {
                var nextMidi = midi;
                if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
                    var alt = chooseChordToneNearest(chordPcs, prevMidi, range, 43, {
                        maxLeap: maxLeap,
                        avoidRepeat: true,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": repeat avoided; using alternate chord tone.")
                    });
                    if (typeof alt === "number")
                        nextMidi = alt;
                }
                prevMidi = nextMidi;
                return __assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi), lockPitch: true });
            };
            if (role === "arpUp" || role === "arpDown") {
                if (ev.step === 0) {
                    var basePc_1 = bassPc !== null && bassPc !== void 0 ? bassPc : rootPc;
                    var midi_1 = chooseBassMidi(basePc_1, prevMidi, range, 43, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": bass leap exceeded ").concat(maxLeap, " semitones; using closest chord tone.")
                    });
                    return finalize(midi_1);
                }
                var dir = role === "arpUp" ? 1 : -1;
                var midi_2 = chooseChordToneInDirection(chordPcs, prevMidi, range, dir, {
                    maxLeap: maxLeap,
                    warnings: warnings,
                    context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": bass leap exceeded ").concat(maxLeap, " semitones; using closest chord tone.")
                });
                return finalize(midi_2);
            }
            if (role === "passing") {
                var dir = ev.dir === -1 ? -1 : 1;
                var midi_3 = choosePassingMidi(prevMidi, scalePcs, range, dir);
                return finalize(midi_3);
            }
            if (role === "neighbor" || role === "appoggiatura") {
                var dir = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
                var midi_4 = chooseNeighborMidi(prevMidi, scalePcs, range, dir);
                return finalize(midi_4);
            }
            if (role === "skip") {
                var midi_5 = chooseChordToneByInterval(chordPcs, prevMidi, range, 3, 5, prevMidi);
                return finalize(midi_5);
            }
            if (role === "leap") {
                var midi_6 = chooseChordToneByInterval(chordPcs, prevMidi, range, 7, 9, prevMidi);
                return finalize(midi_6);
            }
            var basePc = bassPc !== null && bassPc !== void 0 ? bassPc : rootPc;
            var midi = chooseBassMidi(basePc, prevMidi, range, 43, {
                maxLeap: maxLeap,
                warnings: warnings,
                context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": bass leap exceeded ").concat(maxLeap, " semitones; using closest chord tone.")
            });
            return finalize(midi);
        });
        b.events = __spreadArray(__spreadArray([], other, true), enriched, true).sort(function (a, bEv) { var _a, _b; return Number((_a = a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = bEv.t) !== null && _b !== void 0 ? _b : 0); });
        applied.push(mNum);
    };
    for (var i = 0; i < total; i++) {
        _loop_3(i);
    }
    if (applied.length) {
        warn(warnings, "[rhythm] Polyphonic bass counter-rhythm applied to ".concat(applied.length, " measure(s). First and last two measures follow melody rhythm."));
    }
    return {
        applied: applied.length > 0,
        reason: applied.length ? "applied" : "no measures",
        style: "classical",
        detectedCadencePairs: [],
        appliedCadencePair: null,
        appliedMeasureNumbers: applied,
        chosenPlans: {},
        warnings: warnings
    };
}
function applyPolyphonicTenorCounterRhythm(score, chords, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    var warnings = [];
    var tenor = getTenorPart(score);
    var melody = getMelodyPart(score);
    var chordEvents = Array.isArray(chords) && chords.length
        ? chords
        : Array.isArray((_b = (_a = score === null || score === void 0 ? void 0 : score.meta) === null || _a === void 0 ? void 0 : _a.harmonize) === null || _b === void 0 ? void 0 : _b.chords)
            ? score.meta.harmonize.chords
            : [];
    if (!tenor || !melody) {
        warn(warnings, "[rhythm] Missing Tenor or Melody part for polyphonic tenor counter-rhythm.");
        return {
            applied: false,
            reason: "missing parts",
            style: "classical",
            detectedCadencePairs: [],
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var tenorMeasures = Array.isArray(tenor.measures) ? tenor.measures : [];
    var melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
    var total = Math.min(tenorMeasures.length, melMeasures.length);
    var applied = [];
    var defaultRange = { min: 48, max: 69 };
    var anchorMidi = 57;
    var maxLeap = 12;
    var prevMidi = anchorMidi;
    var keyMode = getKeyMode(score);
    var tonicPc = keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
    var scalePcs = scalePcsForKey(tonicPc, keyMode);
    var beatsPerMeasure = (_j = (_h = (_g = (_f = (_e = (_d = (_c = score.parts) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.measures) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.attributes) === null || _g === void 0 ? void 0 : _g.time) === null || _h === void 0 ? void 0 : _h.beats) !== null && _j !== void 0 ? _j : 4;
    var minSeen = Number.POSITIVE_INFINITY;
    var maxSeen = Number.NEGATIVE_INFINITY;
    for (var _i = 0, tenorMeasures_1 = tenorMeasures; _i < tenorMeasures_1.length; _i++) {
        var m = tenorMeasures_1[_i];
        for (var _m = 0, _o = (_k = m === null || m === void 0 ? void 0 : m.events) !== null && _k !== void 0 ? _k : []; _m < _o.length; _m++) {
            var ev = _o[_m];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || typeof (ev === null || ev === void 0 ? void 0 : ev.midi) !== "number")
                continue;
            minSeen = Math.min(minSeen, ev.midi);
            maxSeen = Math.max(maxSeen, ev.midi);
        }
    }
    var range = {
        min: Number.isFinite(minSeen) ? Math.max(defaultRange.min, minSeen - 2) : defaultRange.min,
        max: Number.isFinite(maxSeen) ? Math.min(defaultRange.max, maxSeen + 2) : defaultRange.max
    };
    if (typeof (options === null || options === void 0 ? void 0 : options.minMidiOverride) === "number" && Number.isFinite(options.minMidiOverride)) {
        range.min = Math.max(range.min, Math.round(options.minMidiOverride));
    }
    if (typeof (options === null || options === void 0 ? void 0 : options.maxMidiOverride) === "number" && Number.isFinite(options.maxMidiOverride)) {
        range.max = Math.min(range.max, Math.round(options.maxMidiOverride));
    }
    if (range.min > range.max)
        range.min = range.max;
    var _loop_4 = function (i) {
        var tPart = tenorMeasures[i];
        var m = melMeasures[i];
        if (!tPart || !m)
            return "continue";
        var mNum = Number(tPart === null || tPart === void 0 ? void 0 : tPart.number) || i + 1;
        var followStrict = i < 2 || i >= total - 2;
        var melEvents = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events.filter(isNoteOrRest) : [];
        var other = Array.isArray(tPart === null || tPart === void 0 ? void 0 : tPart.events) ? tPart.events.filter(function (e) { return !isNoteOrRest(e); }) : [];
        var counter = buildCounterRhythmEvents({
            melodyEvents: melEvents,
            followStrict: followStrict,
            allowRests: (options === null || options === void 0 ? void 0 : options.allowRests) === true,
            measureNumber: mNum,
            chords: chordEvents,
            beatsPerMeasure: beatsPerMeasure,
            tonicPc: tonicPc,
            activity: (_l = options === null || options === void 0 ? void 0 : options.activity) !== null && _l !== void 0 ? _l : "less_active",
            independent: true,
            randomizeOffsets: options === null || options === void 0 ? void 0 : options.randomizeOffsets,
            voiceTag: "tenor",
            durationWhitelist: options === null || options === void 0 ? void 0 : options.durationWhitelist
        });
        if (!counter.length) {
            warn(warnings, "[rhythm] m".concat(mNum, ": no counter-rhythm events created for tenor."));
            return "continue";
        }
        var enriched = counter.map(function (ev) {
            var _a, _b;
            if (ev.type === "rest")
                return ev;
            var forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
            var allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("tenor"));
            var role = forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
                ? "chord"
                : ev.role;
            var chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
            var parsed = chord ? (0, chordSymbol_1.parseChordSymbol)((_a = chord.symbol.split("/")[0]) !== null && _a !== void 0 ? _a : chord.symbol) : null;
            var chordPcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : [];
            if (!chord || !chordPcs.length) {
                return __assign(__assign({}, ev), { type: "note", midi: prevMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(prevMidi), lockPitch: true });
            }
            var dir = passingDirFromRoots(parseRootPc(chord.symbol), parseRootPc(chord.symbol), mNum, Number(ev.t));
            var finalize = function (midi) {
                var nextMidi = midi;
                if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
                    var alt = chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": tenor repeat avoided; using alternate chord tone."),
                        avoidRepeat: true
                    });
                    if (typeof alt === "number")
                        nextMidi = alt;
                }
                prevMidi = nextMidi;
                return __assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi), lockPitch: true });
            };
            if (role === "arpUp" || role === "arpDown") {
                var stepDir = role === "arpUp" ? 1 : -1;
                var midi_7 = ev.step === 0
                    ? chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": tenor leap exceeded ").concat(maxLeap, " semitones; using closest chord tone."),
                        avoidRepeat: !allowRepeat
                    })
                    : chooseChordToneInDirection(chordPcs, prevMidi, range, stepDir, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": tenor leap exceeded ").concat(maxLeap, " semitones; using closest chord tone.")
                    });
                return finalize(midi_7);
            }
            if (role === "passing") {
                var passDir = ev.dir === -1 ? -1 : 1;
                var midi_8 = choosePassingMidi(prevMidi, scalePcs, range, passDir);
                return finalize(midi_8);
            }
            if (role === "neighbor" || role === "appoggiatura") {
                var dir_1 = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
                var midi_9 = chooseNeighborMidi(prevMidi, scalePcs, range, dir_1);
                return finalize(midi_9);
            }
            if (role === "skip") {
                var midi_10 = chooseChordToneByInterval(chordPcs, prevMidi, range, 3, 5, prevMidi);
                return finalize(midi_10);
            }
            if (role === "leap") {
                var midi_11 = chooseChordToneByInterval(chordPcs, prevMidi, range, 7, 9, prevMidi);
                return finalize(midi_11);
            }
            var midi = chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
                maxLeap: maxLeap,
                warnings: warnings,
                context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": tenor leap exceeded ").concat(maxLeap, " semitones; using closest chord tone."),
                avoidRepeat: !allowRepeat
            });
            return finalize(midi);
        });
        tPart.events = __spreadArray(__spreadArray([], other, true), enriched, true).sort(function (a, bEv) { var _a, _b; return Number((_a = a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = bEv.t) !== null && _b !== void 0 ? _b : 0); });
        applied.push(mNum);
    };
    for (var i = 0; i < total; i++) {
        _loop_4(i);
    }
    if (applied.length) {
        warn(warnings, "[rhythm] Polyphonic tenor counter-rhythm applied to ".concat(applied.length, " measure(s). First and last two measures follow melody rhythm."));
    }
    return {
        applied: applied.length > 0,
        reason: applied.length ? "applied" : "no measures",
        style: "classical",
        detectedCadencePairs: [],
        appliedCadencePair: null,
        appliedMeasureNumbers: applied,
        chosenPlans: {},
        warnings: warnings
    };
}
function applyPolyphonicAltoCounterRhythm(score, chords, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    var warnings = [];
    var alto = getAltoPart(score);
    var melody = getMelodyPart(score);
    var chordEvents = Array.isArray(chords) && chords.length
        ? chords
        : Array.isArray((_b = (_a = score === null || score === void 0 ? void 0 : score.meta) === null || _a === void 0 ? void 0 : _a.harmonize) === null || _b === void 0 ? void 0 : _b.chords)
            ? score.meta.harmonize.chords
            : [];
    if (!alto || !melody) {
        warn(warnings, "[rhythm] Missing Alto or Melody part for polyphonic alto counter-rhythm.");
        return {
            applied: false,
            reason: "missing parts",
            style: "classical",
            detectedCadencePairs: [],
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var altoMeasures = Array.isArray(alto.measures) ? alto.measures : [];
    var melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
    var total = Math.min(altoMeasures.length, melMeasures.length);
    var applied = [];
    var defaultRange = { min: 55, max: 74 };
    var anchorMidi = 62;
    var maxLeap = 12;
    var prevMidi = anchorMidi;
    var keyMode = getKeyMode(score);
    var tonicPc = keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
    var scalePcs = scalePcsForKey(tonicPc, keyMode);
    var beatsPerMeasure = (_j = (_h = (_g = (_f = (_e = (_d = (_c = score.parts) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.measures) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.attributes) === null || _g === void 0 ? void 0 : _g.time) === null || _h === void 0 ? void 0 : _h.beats) !== null && _j !== void 0 ? _j : 4;
    var minSeen = Number.POSITIVE_INFINITY;
    var maxSeen = Number.NEGATIVE_INFINITY;
    for (var _i = 0, altoMeasures_1 = altoMeasures; _i < altoMeasures_1.length; _i++) {
        var m = altoMeasures_1[_i];
        for (var _m = 0, _o = (_k = m === null || m === void 0 ? void 0 : m.events) !== null && _k !== void 0 ? _k : []; _m < _o.length; _m++) {
            var ev = _o[_m];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || typeof (ev === null || ev === void 0 ? void 0 : ev.midi) !== "number")
                continue;
            minSeen = Math.min(minSeen, ev.midi);
            maxSeen = Math.max(maxSeen, ev.midi);
        }
    }
    var baseRange = {
        min: Number.isFinite(minSeen) ? Math.max(defaultRange.min, minSeen - 2) : defaultRange.min,
        max: Number.isFinite(maxSeen) ? Math.min(defaultRange.max, maxSeen + 2) : defaultRange.max
    };
    var _loop_5 = function (i) {
        var aPart = altoMeasures[i];
        var m = melMeasures[i];
        if (!aPart || !m)
            return "continue";
        var mNum = Number(aPart === null || aPart === void 0 ? void 0 : aPart.number) || i + 1;
        var followStrict = i < 2 || i >= total - 2;
        var melEvents = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events.filter(isNoteOrRest) : [];
        var other = Array.isArray(aPart === null || aPart === void 0 ? void 0 : aPart.events) ? aPart.events.filter(function (e) { return !isNoteOrRest(e); }) : [];
        var counter = buildCounterRhythmEvents({
            melodyEvents: melEvents,
            followStrict: followStrict,
            allowRests: (options === null || options === void 0 ? void 0 : options.allowRests) === true,
            measureNumber: mNum,
            chords: chordEvents,
            beatsPerMeasure: beatsPerMeasure,
            tonicPc: tonicPc,
            activity: (_l = options === null || options === void 0 ? void 0 : options.activity) !== null && _l !== void 0 ? _l : "less_active",
            independent: true,
            randomizeOffsets: options === null || options === void 0 ? void 0 : options.randomizeOffsets,
            voiceTag: "alto"
        });
        if (!counter.length) {
            warn(warnings, "[rhythm] m".concat(mNum, ": no counter-rhythm events created for alto."));
            return "continue";
        }
        var enriched = counter.map(function (ev) {
            var _a, _b, _c, _d;
            if (ev.type === "rest")
                return ev;
            var forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
            var allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("alto"));
            var role = forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
                ? "chord"
                : ev.role;
            var chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
            var parsed = chord ? (0, chordSymbol_1.parseChordSymbol)((_a = chord.symbol.split("/")[0]) !== null && _a !== void 0 ? _a : chord.symbol) : null;
            var chordPcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : [];
            if (!chord || !chordPcs.length) {
                return __assign(__assign({}, ev), { type: "note", midi: prevMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(prevMidi), lockPitch: true });
            }
            var soprMidi = findNoteMidiAtTime(melEvents, Number(ev.t));
            var localRange = {
                min: baseRange.min,
                max: soprMidi !== null ? Math.min(baseRange.max, soprMidi - 1) : baseRange.max
            };
            if (localRange.max < localRange.min) {
                localRange.max = localRange.min;
            }
            var finalize = function (midi) {
                var nextMidi = midi;
                if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
                    var alt = chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": alto repeat avoided; using alternate chord tone."),
                        avoidRepeat: true
                    });
                    if (typeof alt === "number")
                        nextMidi = alt;
                }
                prevMidi = nextMidi;
                return __assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi), lockPitch: true });
            };
            if (role === "arpUp" || role === "arpDown") {
                var stepDir = role === "arpUp" ? 1 : -1;
                var midi_12 = ev.step === 0
                    ? chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": alto leap exceeded ").concat(maxLeap, " semitones; using closest chord tone."),
                        avoidRepeat: !allowRepeat
                    })
                    : chooseChordToneInDirection(chordPcs, prevMidi, localRange, stepDir, {
                        maxLeap: maxLeap,
                        warnings: warnings,
                        context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": alto leap exceeded ").concat(maxLeap, " semitones; using closest chord tone.")
                    });
                return finalize(midi_12);
            }
            if (role === "passing") {
                var passDir = ev.dir === -1 ? -1 : 1;
                var midi_13 = choosePassingMidi(prevMidi, scalePcs, localRange, passDir);
                return finalize(midi_13);
            }
            if (role === "neighbor" || role === "appoggiatura") {
                var dir = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
                var midi_14 = chooseNeighborMidi(prevMidi, scalePcs, localRange, dir);
                return finalize(midi_14);
            }
            if (role === "skip") {
                var midi_15 = chooseChordToneByInterval(chordPcs, prevMidi, localRange, 3, 5, prevMidi);
                return finalize(midi_15);
            }
            if (role === "leap") {
                var midi_16 = chooseChordToneByInterval(chordPcs, prevMidi, localRange, 7, 9, prevMidi);
                return finalize(midi_16);
            }
            if (role === "anticipation") {
                var nextChord = pickChordForTime(chordEvents, Number(ev.t) + Number(ev.dur) < beatsPerMeasure ? mNum : mNum + 1, Number(ev.t) + Number(ev.dur) < beatsPerMeasure ? Number(ev.t) + Number(ev.dur) : 0);
                var nextParsed = nextChord ? (0, chordSymbol_1.parseChordSymbol)((_c = nextChord.symbol.split("/")[0]) !== null && _c !== void 0 ? _c : nextChord.symbol) : null;
                var nextPcs = (_d = nextParsed === null || nextParsed === void 0 ? void 0 : nextParsed.pcs) !== null && _d !== void 0 ? _d : chordPcs;
                var midi_17 = chooseChordToneNearest(nextPcs, prevMidi, localRange, anchorMidi, {
                    maxLeap: maxLeap,
                    warnings: warnings,
                    context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": alto leap exceeded ").concat(maxLeap, " semitones; using closest chord tone."),
                    avoidRepeat: !allowRepeat
                });
                return finalize(midi_17);
            }
            if (role === "syncopation") {
                var offbeat = !isStrongBeat(Number(ev.t));
                var prevPc = ((prevMidi % 12) + 12) % 12;
                if (offbeat && chordPcs.includes(prevPc)) {
                    return __assign(__assign({}, ev), { midi: prevMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(prevMidi), lockPitch: true });
                }
            }
            var midi = chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
                maxLeap: maxLeap,
                warnings: warnings,
                context: "[rhythm] m".concat(mNum, " t=").concat(ev.t, ": alto leap exceeded ").concat(maxLeap, " semitones; using closest chord tone."),
                avoidRepeat: !allowRepeat
            });
            return finalize(midi);
        });
        aPart.events = __spreadArray(__spreadArray([], other, true), enriched, true).sort(function (a, bEv) { var _a, _b; return Number((_a = a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = bEv.t) !== null && _b !== void 0 ? _b : 0); });
        applied.push(mNum);
    };
    for (var i = 0; i < total; i++) {
        _loop_5(i);
    }
    if (applied.length) {
        warn(warnings, "[rhythm] Polyphonic alto counter-rhythm applied to ".concat(applied.length, " measure(s). First and last two measures follow melody rhythm."));
    }
    return {
        applied: applied.length > 0,
        reason: applied.length ? "applied" : "no measures",
        style: "classical",
        detectedCadencePairs: [],
        appliedCadencePair: null,
        appliedMeasureNumbers: applied,
        chosenPlans: {},
        warnings: warnings
    };
}
