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
exports.arrangeStringEnsembleFromSatb = arrangeStringEnsembleFromSatb;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
function warn(warnings, msg) {
    if (!warnings)
        return;
    warnings.push(msg);
}
function clone(x) {
    return JSON.parse(JSON.stringify(x));
}
function isNoteOrRest(ev) {
    return ev && (ev.type === "note" || ev.type === "rest");
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
function findPartByName(score, name, fallbackIndex) {
    var _a, _b, _c;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes(name))
            return p;
    }
    return (_c = parts[fallbackIndex]) !== null && _c !== void 0 ? _c : null;
}
function ensureMeasureAttributesOnlyOnFirst(part) {
    var _a, _b;
    var ms = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : [];
    for (var i = 0; i < ms.length; i++) {
        if (i === 0)
            continue;
        if ((_b = ms[i]) === null || _b === void 0 ? void 0 : _b.attributes)
            delete ms[i].attributes;
    }
}
function mapPartFromSource(src, instrumentId, partId, partName, octaveShift) {
    var _a;
    var spec = (0, instrumentCatalog_1.getInstrumentSpec)(instrumentId);
    var measures = ((_a = src === null || src === void 0 ? void 0 : src.measures) !== null && _a !== void 0 ? _a : []).map(function (m) {
        var _a;
        var events = ((_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []).map(function (ev) {
            if (!isNoteOrRest(ev))
                return clone(ev);
            if (ev.type === "rest")
                return clone(ev);
            var midi = eventMidi(ev);
            if (midi === null || !spec)
                return clone(ev);
            var shifted = midi + octaveShift * 12;
            var clamped = (0, instrumentCatalog_1.clampMidiToInstrumentRange)(shifted, spec);
            return __assign(__assign({}, clone(ev)), { midi: clamped, pitch: (0, instrumentCatalog_1.midiToPitch)(clamped) });
        });
        return __assign(__assign({}, clone(m)), { events: events });
    });
    var part = {
        part_id: partId,
        name: partName,
        instrument: instrumentId,
        staves: 1,
        measures: measures
    };
    ensureMeasureAttributesOnlyOnFirst(part);
    return part;
}
function arrangeStringEnsembleFromSatb(score, options) {
    var _a, _b;
    if (options === void 0) { options = {}; }
    var warnings = (_a = options.warnings) !== null && _a !== void 0 ? _a : [];
    var soprano = findPartByName(score, "soprano", 0);
    var alto = findPartByName(score, "alto", 1);
    var tenor = findPartByName(score, "tenor", 2);
    var bass = findPartByName(score, "bass", 3);
    if (!soprano || !bass) {
        warn(warnings, "[strings] Missing Soprano or Bass part; returning original score.");
        return score;
    }
    var violin1 = mapPartFromSource(soprano, "violin_1", "P_V1", "Violin I", 0);
    var violin2 = mapPartFromSource(alto !== null && alto !== void 0 ? alto : soprano, "violin_2", "P_V2", "Violin II", 0);
    var viola = mapPartFromSource((_b = tenor !== null && tenor !== void 0 ? tenor : alto) !== null && _b !== void 0 ? _b : soprano, "viola", "P_VA", "Viola", 0);
    var cello = mapPartFromSource(bass, "cello", "P_VC", "Cello", 0);
    var doubleBass = mapPartFromSource(bass, "double_bass", "P_DB", "Double Bass", -1);
    var parts = [violin1, violin2, viola, cello, doubleBass];
    return __assign(__assign({}, score), { meta: __assign(__assign({}, score.meta), { ensemble: "string_ensemble" }), parts: parts });
}
