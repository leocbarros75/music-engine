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
exports.applyRhythmToBassFinalCadence = applyRhythmToBassFinalCadence;
var rhythmLibrary_1 = require("./rhythmLibrary");
function warn(warnings, msg) {
    warnings.push(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
}
function isBusyCell(cell) {
    var _a;
    var tags = (_a = cell.tags) !== null && _a !== void 0 ? _a : [];
    return tags.includes("busy") || tags.includes("syncopated");
}
function pickCellByTags(params) {
    var _a, _b;
    var template = params.template, cells = params.cells, includeTags = params.includeTags;
    var cellById = new Map();
    for (var _i = 0, cells_1 = cells; _i < cells_1.length; _i++) {
        var c = cells_1[_i];
        cellById.set(c.id, c);
    }
    var _loop_1 = function (cw) {
        var cell = cellById.get(cw.cellId);
        if (!cell)
            return "continue";
        var tags = (_b = cell.tags) !== null && _b !== void 0 ? _b : [];
        if (includeTags.some(function (tag) { return tags.includes(tag); }))
            return { value: cell };
    };
    for (var _c = 0, _d = (_a = template.cells) !== null && _a !== void 0 ? _a : []; _c < _d.length; _c++) {
        var cw = _d[_c];
        var state_1 = _loop_1(cw);
        if (typeof state_1 === "object")
            return state_1.value;
    }
    return null;
}
function getMeter(score) {
    var _a, _b, _c, _d, _e, _f, _g;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var beats = (_e = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beats;
    var beatType = (_g = (_f = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _f === void 0 ? void 0 : _f.time) === null || _g === void 0 ? void 0 : _g.beat_type;
    if (typeof beats === "number" && typeof beatType === "number" && beats > 0 && beatType > 0) {
        return { beats: beats, beatType: beatType };
    }
    return { beats: 4, beatType: 4 };
}
function getPartByName(score, needle) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes(needle))
            return p;
    }
    return null;
}
function getBassPart(score) {
    return getPartByName(score, "bass");
}
function getMeasureNumber(m, fallback) {
    var n = Number(m === null || m === void 0 ? void 0 : m.number);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function pc(x) {
    return ((x % 12) + 12) % 12;
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
function parseRootToken(tok) {
    var _a;
    var m = tok.match(/^([A-Ga-g])([#b]?)/);
    if (!m)
        return null;
    var step = m[1].toUpperCase();
    var acc = (_a = m[2]) !== null && _a !== void 0 ? _a : "";
    var base = STEP_TO_PC[step];
    if (typeof base !== "number")
        return null;
    if (acc === "#")
        return (base + 1) % 12;
    if (acc === "b")
        return (base + 11) % 12;
    return base;
}
function chordMain(symbol) {
    var s = String(symbol !== null && symbol !== void 0 ? symbol : "").trim();
    if (!s)
        return "";
    if (!s.includes("/"))
        return s;
    return s.split("/")[0].trim();
}
function chordRootPc(symbol) {
    var main = chordMain(symbol);
    var m = main.match(/^([A-Ga-g][#b]?)/);
    if (!m)
        return null;
    return parseRootToken(m[1]);
}
function getKeyFifths(score) {
    var _a, _b, _c, _d;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var fifths = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.key_fifths;
    if (typeof fifths === "number" && Number.isFinite(fifths))
        return fifths;
    return 0;
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
    var k = String(fifths);
    return (_a = map[k]) !== null && _a !== void 0 ? _a : 0;
}
function getChordEventsFromMeta(score) {
    var _a, _b, _c;
    var meta = score === null || score === void 0 ? void 0 : score.meta;
    var sample = (_b = (_a = meta === null || meta === void 0 ? void 0 : meta.harmonize) === null || _a === void 0 ? void 0 : _a.debug) === null || _b === void 0 ? void 0 : _b.chordEventSample;
    if (Array.isArray(sample) && sample.length) {
        return sample
            .map(function (c) {
            var _a, _b;
            return ({
                measure: Number(c === null || c === void 0 ? void 0 : c.measure),
                t: Number((_a = c === null || c === void 0 ? void 0 : c.t) !== null && _a !== void 0 ? _a : 0),
                symbol: String((_b = c === null || c === void 0 ? void 0 : c.symbol) !== null && _b !== void 0 ? _b : "")
            });
        })
            .filter(function (c) { return Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol; });
    }
    var full = (_c = meta === null || meta === void 0 ? void 0 : meta.harmonize) === null || _c === void 0 ? void 0 : _c.chords;
    if (Array.isArray(full) && full.length) {
        return full
            .map(function (c) {
            var _a, _b;
            return ({
                measure: Number(c === null || c === void 0 ? void 0 : c.measure),
                t: Number((_a = c === null || c === void 0 ? void 0 : c.t) !== null && _a !== void 0 ? _a : 0),
                symbol: String((_b = c === null || c === void 0 ? void 0 : c.symbol) !== null && _b !== void 0 ? _b : "")
            });
        })
            .filter(function (c) { return Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol; });
    }
    return [];
}
function chordMapByMeasureT0(chords) {
    var map = new Map();
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        if (!Number.isFinite(c.measure))
            continue;
        if (!Number.isFinite(c.t))
            continue;
        if (c.t !== 0)
            continue; // per your instruction: t=0 only
        if (!c.symbol)
            continue;
        map.set(c.measure, c);
    }
    return map;
}
function isDominantToTonicVtoI(params) {
    var fromChord = params.fromChord, toChord = params.toChord, tonicPc = params.tonicPc;
    var dominantPc = pc(tonicPc + 7);
    var fromRoot = chordRootPc(fromChord);
    var toRoot = chordRootPc(toChord);
    if (fromRoot === null || toRoot === null)
        return false;
    return pc(fromRoot) === dominantPc && pc(toRoot) === pc(tonicPc);
}
function detectCadencePairsVI(score, warnings) {
    var _a, _b;
    var chords = getChordEventsFromMeta(score);
    if (!chords.length) {
        warn(warnings, "[rhythm] No chord events found in meta.harmonize.debug. Cadence detection skipped.");
        return [];
    }
    var tonic = tonicPcFromFifthsMajor(getKeyFifths(score));
    var m0 = chordMapByMeasureT0(chords);
    var p0 = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0];
    var measures = (_b = p0 === null || p0 === void 0 ? void 0 : p0.measures) !== null && _b !== void 0 ? _b : [];
    if (!Array.isArray(measures) || measures.length < 2)
        return [];
    var nums = measures.map(function (m, idx) { return getMeasureNumber(m, idx + 1); });
    var pairs = [];
    for (var i = 0; i < nums.length - 1; i++) {
        var a = nums[i];
        var b = nums[i + 1];
        var ca = m0.get(a);
        var cb = m0.get(b);
        if (!ca || !cb)
            continue;
        if (isDominantToTonicVtoI({ fromChord: ca.symbol, toChord: cb.symbol, tonicPc: tonic })) {
            pairs.push({ fromMeasure: a, toMeasure: b });
        }
    }
    return pairs;
}
function isNoteOrRest(e) {
    return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}
function compressMeasureToCell(params) {
    var _a;
    var measure = params.measure, cell = params.cell, warnings = params.warnings, measureNumber = params.measureNumber;
    var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
    if (!events.length) {
        warn(warnings, "[rhythm] m".concat(measureNumber, ": Bass measure has no events; skipping."));
        return;
    }
    // Keep non-note/rest events.
    var other = events.filter(function (e) { return !isNoteOrRest(e); });
    var nr = events.filter(function (e) { return isNoteOrRest(e); });
    // We anchor from the earliest note/rest (usually t=0).
    var sorted = nr.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var anchor = (_a = sorted.find(function (e) { return e.type === "note"; })) !== null && _a !== void 0 ? _a : sorted[0];
    if (!anchor) {
        warn(warnings, "[rhythm] m".concat(measureNumber, ": No note/rest anchor found; skipping."));
        return;
    }
    // Build new note/rest events with same pitch, but new durations.
    var t = 0;
    var outNR = [];
    for (var _i = 0, _b = cell.durs; _i < _b.length; _i++) {
        var d = _b[_i];
        if (anchor.type === "note") {
            outNR.push(__assign(__assign({}, anchor), { t: t, dur: d }));
        }
        else {
            outNR.push({ type: "rest", t: t, dur: d });
        }
        t += d;
    }
    measure.events = __spreadArray(__spreadArray([], other, true), outNR, true).sort(function (a, b) { var _a, _b; return Number((_a = a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = b.t) !== null && _b !== void 0 ? _b : 0); });
}
function applyRhythmToBassFinalCadence(score, options) {
    var _a;
    var warnings = [];
    var meter = getMeter(score);
    var _b = (0, rhythmLibrary_1.loadRhythmCellsAndTemplates)({ warnings: warnings }), cells = _b.cells, templates = _b.templates;
    var cadencePairs = detectCadencePairsVI(score, warnings);
    if (cadencePairs.length) {
        // eslint-disable-next-line no-console
        console.log("[cadence] detected V->I cadence pairs: ".concat(cadencePairs.map(function (c) { return "".concat(c.fromMeasure, "->").concat(c.toMeasure); }).join(", ")));
    }
    var bass = getBassPart(score);
    if (!bass) {
        warn(warnings, "[rhythm] No Bass part found. No rhythm changes applied.");
        return {
            applied: false,
            reason: "no bass",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    if (!cadencePairs.length) {
        warn(warnings, "[rhythm] No V->I cadences detected. No rhythm changes applied.");
        return {
            applied: false,
            reason: "no cadences",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var finalPair = cadencePairs[cadencePairs.length - 1];
    var applyPair = options.applyOnlyFinalCadence ? finalPair : null;
    if (!applyPair) {
        warn(warnings, "[rhythm] No cadence selected for application.");
        return {
            applied: false,
            reason: "no cadence selected",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: null,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var template = (0, rhythmLibrary_1.pickGrooveTemplate)({
        templates: templates,
        style: options.style,
        meter: meter,
        role: options.role,
        warnings: warnings
    });
    if (!template) {
        return {
            applied: false,
            reason: "no groove template",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: applyPair,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var cell = (0, rhythmLibrary_1.pickCellForTemplate)({ template: template, cells: cells, warnings: warnings });
    if (!cell) {
        return {
            applied: false,
            reason: "no rhythm cell",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: applyPair,
            appliedMeasureNumbers: [],
            chosenPlans: {},
            warnings: warnings
        };
    }
    var styleAllowsBusy = options.style === "funk" || options.style === "samba";
    if (!styleAllowsBusy && isBusyCell(cell)) {
        var grounded = pickCellByTags({ template: template, cells: cells, includeTags: ["grounded", "cadence"] });
        if (grounded) {
            warn(warnings, "[rhythm] Style=\"".concat(options.style, "\" keeps bass grounded; swapping busy rhythm cell \"").concat(cell.id, "\" for grounded \"").concat(grounded.id, "\"."));
            cell = grounded;
        }
    }
    if (options.level === "beginner" && isBusyCell(cell)) {
        var grounded = pickCellByTags({ template: template, cells: cells, includeTags: ["grounded", "cadence"] });
        if (grounded) {
            warn(warnings, "[rhythm] Level=\"beginner\" selected; swapping busy rhythm cell \"".concat(cell.id, "\" for grounded \"").concat(grounded.id, "\"."));
            cell = grounded;
        }
    }
    var bassMeasures = Array.isArray(bass.measures) ? bass.measures : [];
    var chosenPlans = {};
    var appliedMeasureNumbers = [];
    // Apply to BOTH measures of the final cadence pair (V measure and I measure).
    var targets = new Set([applyPair.fromMeasure, applyPair.toMeasure]);
    // eslint-disable-next-line no-console
    console.log("[cadence] applying rhythm to measures ".concat(applyPair.fromMeasure, " -> ").concat(applyPair.toMeasure));
    for (var i = 0; i < bassMeasures.length; i++) {
        var m = bassMeasures[i];
        var mNum = getMeasureNumber(m, i + 1);
        if (!targets.has(mNum))
            continue;
        compressMeasureToCell({ measure: m, cell: cell, warnings: warnings, measureNumber: mNum });
        chosenPlans[String(mNum)] = { cellId: cell.id, durs: cell.durs.slice(), label: cell.label };
        appliedMeasureNumbers.push(mNum);
    }
    if (!appliedMeasureNumbers.length) {
        warn(warnings, "[rhythm] Final cadence found (".concat(applyPair.fromMeasure, "->").concat(applyPair.toMeasure, ") but no measures matched."));
        return {
            applied: false,
            reason: "no measures matched",
            style: options.style,
            detectedCadencePairs: cadencePairs,
            appliedCadencePair: applyPair,
            appliedMeasureNumbers: [],
            chosenPlans: chosenPlans,
            warnings: warnings
        };
    }
    warn(warnings, "[rhythm] Applied Bass rhythm cell \"".concat(cell.id, "\" (").concat((_a = cell.label) !== null && _a !== void 0 ? _a : "", ") on final cadence measures: ").concat(appliedMeasureNumbers.join(", "), ". style=\"").concat(options.style, "\" meter=").concat(meter.beats, "/").concat(meter.beatType, "."));
    return {
        applied: true,
        reason: "applied final-cadence bass rhythm",
        style: options.style,
        detectedCadencePairs: cadencePairs,
        appliedCadencePair: applyPair,
        appliedMeasureNumbers: appliedMeasureNumbers,
        chosenPlans: chosenPlans,
        warnings: warnings
    };
}
