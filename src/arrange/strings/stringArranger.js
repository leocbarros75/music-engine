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
exports.arrangeStringEnsemble = arrangeStringEnsemble;
var candidates_1 = require("./candidates");
var dp_1 = require("./dp");
var ranges_1 = require("./ranges");
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
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
function clampMidiToRangeByOctave(midi, range) {
    var out = midi;
    while (out < range.absMin)
        out += 12;
    while (out > range.absMax)
        out -= 12;
    return out;
}
function getKeyInfo(score) {
    var _a, _b, _c, _d, _e;
    var first = (_d = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.attributes;
    var fifths = typeof (first === null || first === void 0 ? void 0 : first.key_fifths) === "number" ? first.key_fifths : 0;
    var mode = String((_e = first === null || first === void 0 ? void 0 : first.key_mode) !== null && _e !== void 0 ? _e : "major").toLowerCase() === "minor" ? "minor" : "major";
    return { fifths: fifths, mode: mode };
}
function measureLengthBeats(measure) {
    var _a, _b, _c, _d, _e, _f;
    var beats = Number((_c = (_b = (_a = measure === null || measure === void 0 ? void 0 : measure.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
    var beatType = Number((_f = (_e = (_d = measure === null || measure === void 0 ? void 0 : measure.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
    return beats * (4 / beatType);
}
function findMelodyPart(score) {
    var _a, _b, _c;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes("soprano") || n.includes("melody") || n.includes("voice"))
            return p;
    }
    return (_c = parts[0]) !== null && _c !== void 0 ? _c : null;
}
function pickChordForTime(chords, measure, t) {
    var _a, _b, _c;
    var events = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!events.length)
        return null;
    var best = null;
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var c = events_1[_i];
        if (Number(c.t) <= t)
            best = c;
    }
    return (_c = (_a = best === null || best === void 0 ? void 0 : best.symbol) !== null && _a !== void 0 ? _a : (_b = events[0]) === null || _b === void 0 ? void 0 : _b.symbol) !== null && _c !== void 0 ? _c : null;
}
function buildSlices(melodyPart, chords) {
    var _a, _b, _c;
    var slices = [];
    var measures = (_a = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _a !== void 0 ? _a : [];
    for (var i = 0; i < measures.length; i++) {
        var m = measures[i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || i + 1;
        var measureLen = measureLengthBeats(m);
        var melEvents = ((_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []).filter(isNoteOrRest).sort(function (a, b) { return Number(a.t) - Number(b.t); });
        var times = new Set();
        for (var _i = 0, melEvents_1 = melEvents; _i < melEvents_1.length; _i++) {
            var ev = melEvents_1[_i];
            times.add(Number((_c = ev.t) !== null && _c !== void 0 ? _c : 0));
        }
        for (var _d = 0, chords_1 = chords; _d < chords_1.length; _d++) {
            var c = chords_1[_d];
            if (Number(c.measure) === mNum)
                times.add(Number(c.t));
        }
        times.add(0);
        times.add(measureLen);
        var ordered = Array.from(times).sort(function (a, b) { return a - b; });
        var _loop_1 = function (tIdx) {
            var t = ordered[tIdx];
            var next = ordered[tIdx + 1];
            var dur = Math.max(0.25, next - t);
            var active = melEvents.find(function (e) { return e.type === "note" && Number(e.t) <= t && t < Number(e.t) + Number(e.dur); });
            var melodyMidi = active ? eventMidi(active) : null;
            slices.push({
                measure: mNum,
                t: t,
                dur: dur,
                melodyMidi: melodyMidi === null ? null : melodyMidi,
                chordSymbol: pickChordForTime(chords, mNum, t)
            });
        };
        for (var tIdx = 0; tIdx < ordered.length - 1; tIdx++) {
            _loop_1(tIdx);
        }
    }
    return slices;
}
function makeEventsFromVoicing(slices, voicings, voice) {
    var _a, _b;
    var out = [];
    for (var i = 0; i < slices.length; i++) {
        var slice = slices[i];
        var midi = (_b = (_a = voicings[i]) === null || _a === void 0 ? void 0 : _a[voice]) !== null && _b !== void 0 ? _b : null;
        if (midi === null) {
            out.push({
                id: "".concat(voice, "-").concat(slice.measure, "-").concat(slice.t),
                t: slice.t,
                dur: slice.dur,
                type: "rest",
                voice: 1,
                staff: 1,
                isRest: true
            });
            continue;
        }
        var range = ranges_1.STRING_RANGES[voice];
        midi = clampMidiToRangeByOctave(midi, range);
        out.push({
            id: "".concat(voice, "-").concat(slice.measure, "-").concat(slice.t),
            t: slice.t,
            dur: slice.dur,
            type: "note",
            pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
            voice: 1,
            staff: 1
        });
    }
    return out;
}
function groupEventsByMeasure(events, template) {
    var byMeasure = {};
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var ev = events_2[_i];
        var m = Number(ev.id.split("-")[1]) || 1;
        if (!byMeasure[m])
            byMeasure[m] = [];
        byMeasure[m].push(ev);
    }
    return template.map(function (m) {
        var _a;
        return ({
            number: m.number,
            attributes: m.attributes ? clone(m.attributes) : undefined,
            events: ((_a = byMeasure[m.number]) !== null && _a !== void 0 ? _a : []).sort(function (a, b) { return a.t - b.t; })
        });
    });
}
function buildPart(template, voiceEvents, part_id, name, instrument) {
    return {
        part_id: part_id,
        name: name,
        instrument: instrument,
        staves: 1,
        measures: groupEventsByMeasure(voiceEvents, template)
    };
}
function arrangeStringEnsemble(score, chords, options) {
    var _a, _b, _c;
    if (options === void 0) { options = {}; }
    var warnings = [];
    var melodyPart = findMelodyPart(score);
    if (!melodyPart) {
        warnings.push("[strings] Missing melody part; returning original score.");
        return { scoreModel: score, arrangement: { parts: { vln1: [], vln2: [], vla: [], vc: [], cb: [] } }, warnings: warnings };
    }
    var slices = buildSlices(melodyPart, chords);
    var key = getKeyInfo(score);
    var candidatesBySlice = [];
    var prevVoicing = null;
    for (var _i = 0, slices_1 = slices; _i < slices_1.length; _i++) {
        var slice = slices_1[_i];
        var candidateMap = (0, candidates_1.buildCandidatesForSlice)({ slice: slice, prevVoicing: prevVoicing, keyFifths: key.fifths, keyMode: key.mode });
        var voicings = (0, candidates_1.buildVoicingStates)(candidateMap);
        candidatesBySlice.push(voicings);
        prevVoicing = (_a = voicings[0]) !== null && _a !== void 0 ? _a : null;
    }
    var profile = (_b = options.profile) !== null && _b !== void 0 ? _b : "hymn_support";
    var dpResult = (0, dp_1.runDp)({ slices: slices, candidatesBySlice: candidatesBySlice, profileId: profile });
    var bestStates = dpResult.best;
    var bestVoicings = bestStates.map(function (s) { return s.voicing; });
    var vln1 = makeEventsFromVoicing(slices, bestVoicings, "vln1");
    var vln2 = makeEventsFromVoicing(slices, bestVoicings, "vln2");
    var vla = makeEventsFromVoicing(slices, bestVoicings, "vla");
    var vc = makeEventsFromVoicing(slices, bestVoicings, "vc");
    var cb = makeEventsFromVoicing(slices, bestVoicings, "cb");
    var measuresTemplate = ((_c = melodyPart.measures) !== null && _c !== void 0 ? _c : []).map(function (m) { return ({
        number: m.number,
        attributes: m.attributes ? clone(m.attributes) : undefined
    }); });
    var parts = [
        buildPart(measuresTemplate, vln1, "P_V1", "Violin I", "violin_1"),
        buildPart(measuresTemplate, vln2, "P_V2", "Violin II", "violin_2"),
        buildPart(measuresTemplate, vla, "P_VA", "Viola", "viola"),
        buildPart(measuresTemplate, vc, "P_VC", "Cello", "cello"),
        buildPart(measuresTemplate, cb, "P_DB", "Double Bass", "double_bass")
    ];
    var arrangement = {
        parts: { vln1: vln1, vln2: vln2, vla: vla, vc: vc, cb: cb },
        dynamics: [{ measure: 1, value: "mf" }],
        articulations: [{ measure: 1, t: 0, type: "legato" }],
        phrasing: [{ startMeasure: 1, endMeasure: measuresTemplate.length }],
        debug: { transitionPenalties: dpResult.penalties }
    };
    var scoreModel = __assign(__assign({}, score), { meta: __assign(__assign({}, score.meta), { ensemble: "string_ensemble" }), parts: parts });
    return { scoreModel: scoreModel, arrangement: arrangement, warnings: warnings };
}
