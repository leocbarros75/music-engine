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
exports.arrangeStringPolyphonic = arrangeStringPolyphonic;
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
var counterpointScoring_1 = require("./counterpointScoring");
var voiceCrossing_1 = require("./voiceCrossing");
var ranges_1 = require("./ranges");
var motifs_1 = require("./motifs");
var pathfinding_1 = require("./pathfinding");
var rhythmStratification_1 = require("./rhythmStratification");
var VOICES = ["vln1", "vln2", "vla", "vc", "cb"];
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
function clampPc(pc) {
    var v = pc % 12;
    return v < 0 ? v + 12 : v;
}
function majorScalePcs(fifths) {
    var base = [0, 2, 4, 5, 7, 9, 11];
    var root = clampPc(fifths * 7);
    return base.map(function (pc) { return clampPc(root + pc); });
}
function inferMajorKeyFromMelody(melodyPart) {
    var _a;
    if (!melodyPart)
        return null;
    var pcs = [];
    var measures = (_a = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, measures_1 = measures; _i < measures_1.length; _i++) {
        var measure = measures_1[_i];
        var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
        for (var _b = 0, events_1 = events; _b < events_1.length; _b++) {
            var ev = events_1[_b];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = eventMidi(ev);
            if (midi === null)
                continue;
            pcs.push(clampPc(midi));
        }
    }
    if (pcs.length < 4)
        return null;
    var bestFifths = null;
    var bestScore = -1;
    for (var fifths = -7; fifths <= 7; fifths++) {
        var scale = majorScalePcs(fifths);
        var score = 0;
        for (var _c = 0, pcs_1 = pcs; _c < pcs_1.length; _c++) {
            var pc = pcs_1[_c];
            if (scale.includes(pc))
                score += 1;
        }
        if (score > bestScore) {
            bestScore = score;
            bestFifths = fifths;
        }
    }
    return bestFifths;
}
function getKeyInfo(score, preferPart) {
    var _a, _b, _c, _d;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var ordered = preferPart ? __spreadArray([preferPart], parts.filter(function (p) { return p !== preferPart; }), true) : parts;
    for (var _i = 0, ordered_1 = ordered; _i < ordered_1.length; _i++) {
        var part = ordered_1[_i];
        var attrs = (_c = (_b = part === null || part === void 0 ? void 0 : part.measures) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.attributes;
        var fifths = attrs === null || attrs === void 0 ? void 0 : attrs.key_fifths;
        if (typeof fifths === "number" && Number.isFinite(fifths)) {
            var mode = String((_d = attrs === null || attrs === void 0 ? void 0 : attrs.key_mode) !== null && _d !== void 0 ? _d : "major").toLowerCase() === "minor" ? "minor" : "major";
            return { fifths: fifths, mode: mode };
        }
    }
    var inferred = inferMajorKeyFromMelody(preferPart !== null && preferPart !== void 0 ? preferPart : parts[0]);
    if (typeof inferred === "number" && Number.isFinite(inferred)) {
        return { fifths: inferred, mode: "major" };
    }
    return { fifths: 0, mode: "major" };
}
function measureLengthTicks(measure) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    var beats = Number((_c = (_b = (_a = measure === null || measure === void 0 ? void 0 : measure.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
    var beatType = Number((_f = (_e = (_d = measure === null || measure === void 0 ? void 0 : measure.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
    var divisions = Number((_h = (_g = measure === null || measure === void 0 ? void 0 : measure.attributes) === null || _g === void 0 ? void 0 : _g.divisions) !== null && _h !== void 0 ? _h : 1);
    return beats * divisions * (4 / beatType);
}
function findMelodyPart(score) {
    var _a, _b, _c, _d, _e;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        var n = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
        if (n.includes("soprano") || n.includes("melody") || n.includes("voice"))
            return p;
    }
    var best = null;
    var bestAvg = -Infinity;
    for (var _f = 0, parts_2 = parts; _f < parts_2.length; _f++) {
        var p = parts_2[_f];
        var vals = [];
        for (var _g = 0, _h = (_c = p === null || p === void 0 ? void 0 : p.measures) !== null && _c !== void 0 ? _c : []; _g < _h.length; _g++) {
            var m = _h[_g];
            for (var _j = 0, _k = (_d = m === null || m === void 0 ? void 0 : m.events) !== null && _d !== void 0 ? _d : []; _j < _k.length; _j++) {
                var e = _k[_j];
                if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                    continue;
                var midi = eventMidi(e);
                if (midi !== null)
                    vals.push(midi);
            }
        }
        if (!vals.length)
            continue;
        var avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
        if (avg > bestAvg) {
            bestAvg = avg;
            best = p;
        }
    }
    return (_e = best !== null && best !== void 0 ? best : parts[0]) !== null && _e !== void 0 ? _e : null;
}
function pickChordForTime(chords, measure, t) {
    var _a, _b, _c;
    var events = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!events.length)
        return null;
    var best = null;
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var c = events_2[_i];
        if (Number(c.t) <= t)
            best = c;
    }
    return (_c = (_a = best === null || best === void 0 ? void 0 : best.symbol) !== null && _a !== void 0 ? _a : (_b = events[0]) === null || _b === void 0 ? void 0 : _b.symbol) !== null && _c !== void 0 ? _c : null;
}
function buildSlices(melodyPart, chords, melodyShift) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (melodyShift === void 0) { melodyShift = 0; }
    var slices = [];
    var measures = (_a = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _a !== void 0 ? _a : [];
    for (var i = 0; i < measures.length; i++) {
        var m = measures[i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || i + 1;
        var divisions = Number((_c = (_b = m === null || m === void 0 ? void 0 : m.attributes) === null || _b === void 0 ? void 0 : _b.divisions) !== null && _c !== void 0 ? _c : 1);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        var beatUnit = divisions * (4 / beatType);
        var measureLen = measureLengthTicks(m);
        var melEvents = ((_g = m === null || m === void 0 ? void 0 : m.events) !== null && _g !== void 0 ? _g : []).filter(isNoteOrRest).sort(function (a, b) { return Number(a.t) - Number(b.t); });
        var times = new Set();
        for (var _i = 0, melEvents_1 = melEvents; _i < melEvents_1.length; _i++) {
            var ev = melEvents_1[_i];
            times.add(Number((_h = ev.t) !== null && _h !== void 0 ? _h : 0));
        }
        for (var _j = 0, chords_1 = chords; _j < chords_1.length; _j++) {
            var c = chords_1[_j];
            if (Number(c.measure) === mNum)
                times.add(Number(c.t));
        }
        times.add(0);
        times.add(measureLen);
        var ordered = Array.from(times).sort(function (a, b) { return a - b; });
        var _loop_1 = function (tIdx) {
            var t = ordered[tIdx];
            var next = ordered[tIdx + 1];
            var dur = Math.max(1, next - t);
            var active = melEvents.find(function (e) { return e.type === "note" && Number(e.t) <= t && t < Number(e.t) + Number(e.dur); });
            var melodyMidi = active ? eventMidi(active) : null;
            slices.push({
                index: slices.length,
                measure: mNum,
                t: t,
                dur: dur,
                melodyMidi: melodyMidi === null ? null : melodyMidi + melodyShift,
                chordSymbol: pickChordForTime(chords, mNum, t),
                isStrongBeat: beatUnit > 0 ? Math.abs(t % beatUnit) < 1e-6 : Math.abs(t - Math.round(t)) < 1e-6
            });
        };
        for (var tIdx = 0; tIdx < ordered.length - 1; tIdx++) {
            _loop_1(tIdx);
        }
    }
    return slices;
}
function addRestsOnWeakBeats(candidateMap, slice) {
    if (slice.isStrongBeat)
        return;
    for (var _i = 0, VOICES_1 = VOICES; _i < VOICES_1.length; _i++) {
        var v = VOICES_1[_i];
        if (v === "vln1" || v === "vln2")
            continue;
        if (!candidateMap[v].includes(null)) {
            candidateMap[v] = __spreadArray([null], candidateMap[v], true);
        }
    }
}
function buildVoicingCombos(candidateMap, cap) {
    if (cap === void 0) { cap = 120; }
    var v1 = candidateMap.vln1.length ? candidateMap.vln1 : [null];
    var v2 = candidateMap.vln2.length ? candidateMap.vln2 : [null];
    var va = candidateMap.vla.length ? candidateMap.vla : [null];
    var vc = candidateMap.vc.length ? candidateMap.vc : [null];
    var cb = candidateMap.cb.length ? candidateMap.cb : [null];
    var out = [];
    for (var _i = 0, v1_1 = v1; _i < v1_1.length; _i++) {
        var a = v1_1[_i];
        for (var _a = 0, v2_1 = v2; _a < v2_1.length; _a++) {
            var b = v2_1[_a];
            for (var _b = 0, va_1 = va; _b < va_1.length; _b++) {
                var c = va_1[_b];
                for (var _c = 0, vc_1 = vc; _c < vc_1.length; _c++) {
                    var d = vc_1[_c];
                    for (var _d = 0, cb_1 = cb; _d < cb_1.length; _d++) {
                        var e = cb_1[_d];
                        out.push({ vln1: a, vln2: b, vla: c, vc: d, cb: e });
                        if (out.length >= cap)
                            return out;
                    }
                }
            }
        }
    }
    return out;
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
function buildPart(template, events, part_id, name, instrument) {
    var _a;
    var byMeasure = {};
    for (var _i = 0, events_3 = events; _i < events_3.length; _i++) {
        var ev = events_3[_i];
        var m = Number((_a = ev.id) === null || _a === void 0 ? void 0 : _a.split("-")[1]) || 1;
        if (!byMeasure[m])
            byMeasure[m] = [];
        byMeasure[m].push(ev);
    }
    return {
        part_id: part_id,
        name: name,
        instrument: instrument,
        staves: 1,
        measures: template.map(function (m) {
            var _a;
            return ({
                number: m.number,
                attributes: m.attributes ? JSON.parse(JSON.stringify(m.attributes)) : undefined,
                events: ((_a = byMeasure[m.number]) !== null && _a !== void 0 ? _a : []).sort(function (a, b) { return a.t - b.t; })
            });
        })
    };
}
function buildMelodyEvents(melodyPart, octaveShift) {
    var _a, _b, _c, _d;
    if (octaveShift === void 0) { octaveShift = 0; }
    var out = {};
    var measures = (_a = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, measures_2 = measures; _i < measures_2.length; _i++) {
        var m = measures_2[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var events = [];
        for (var _e = 0, _f = (_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []; _e < _f.length; _e++) {
            var ev = _f[_e];
            if (!ev || (ev.type !== "note" && ev.type !== "rest"))
                continue;
            var baseMidi = ev.type === "note" ? eventMidi(ev) : null;
            if (ev.type === "note" && baseMidi === null)
                continue;
            var midi = baseMidi !== null ? baseMidi + octaveShift : null;
            events.push({
                id: "vln1-mel-".concat(mNum, "-").concat(ev.t),
                t: Number((_c = ev.t) !== null && _c !== void 0 ? _c : 0),
                dur: Number((_d = ev.dur) !== null && _d !== void 0 ? _d : 0),
                type: ev.type,
                pitch: midi !== null ? (0, instrumentCatalog_1.midiToPitch)(midi) : undefined,
                voice: 1,
                staff: 1
            });
        }
        out[mNum] = events;
    }
    return out;
}
function arrangeStringPolyphonic(score, chords, options) {
    var _a, _b, _c, _d, _e;
    if (chords === void 0) { chords = []; }
    if (options === void 0) { options = {}; }
    var warnings = [];
    var melodyPart = findMelodyPart(score);
    if (!melodyPart) {
        warnings.push("[strings-poly] Missing melody part; returning original score.");
        return { scoreModel: score, warnings: warnings, debug: { ruleHits: [], motifEvents: [], rhythmDecisions: [] } };
    }
    var level = String((_a = options.level) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var melodyShift = level === "intermediate" || level === "advanced" ? 12 : 0;
    var slices = buildSlices(melodyPart, chords, melodyShift);
    var key = getKeyInfo(score, melodyPart);
    var rules = (0, counterpointScoring_1.loadCounterpointRules)();
    var motif = (0, motifs_1.captureMotif)(slices);
    var motifEntries = (0, motifs_1.scheduleImitation)(motif, rules.polyphony.imitation, slices);
    var ranges = level === "beginner"
        ? __assign(__assign({}, ranges_1.STRING_RANGES), { vla: __assign(__assign({}, ranges_1.STRING_RANGES.vla), { absMin: 48, absMax: 76, prefMin: 48, prefMax: 76 }) }) : level === "intermediate"
        ? __assign(__assign({}, ranges_1.STRING_RANGES), { vln2: __assign(__assign({}, ranges_1.STRING_RANGES.vln2), { absMin: 55, absMax: 88, prefMin: 55, prefMax: 88 }), vla: __assign(__assign({}, ranges_1.STRING_RANGES.vla), { absMin: 48, absMax: 81, prefMin: 48, prefMax: 81 }), vc: __assign(__assign({}, ranges_1.STRING_RANGES.vc), { absMin: 36, absMax: 69, prefMin: 36, prefMax: 69 }) }) : ranges_1.STRING_RANGES;
    var beamWidth = 30;
    var beam = [];
    var debugHits = [];
    var rhythmDecisions = [];
    var initialState = {
        voicing: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
        history: [],
        pendingRecovery: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
        pendingResolution: [],
        rhythmState: (0, rhythmStratification_1.initRhythmState)(),
        parallelPerfectCounts: {},
        crossingCounts: {},
        cost: 0,
        debug: []
    };
    beam = [initialState];
    for (var i = 0; i < slices.length; i++) {
        var slice = slices[i];
        var nextBeam = [];
        for (var _i = 0, beam_1 = beam; _i < beam_1.length; _i++) {
            var state = beam_1[_i];
            var candidates = (0, pathfinding_1.buildCandidateMap)({
                slice: slice,
                prevVoicing: state.voicing,
                keyFifths: key.fifths,
                keyMode: key.mode,
                motif: motif,
                motifEntries: motifEntries,
                rules: rules,
                rhythmState: state.rhythmState,
                ranges: ranges
            });
            addRestsOnWeakBeats(candidates, slice);
            var voicings = buildVoicingCombos(candidates);
            for (var _f = 0, voicings_1 = voicings; _f < voicings_1.length; _f++) {
                var v = voicings_1[_f];
                var locks = {
                    vln1: slice.melodyMidi !== null,
                    vln2: false,
                    vla: false,
                    vc: false,
                    cb: false
                };
                var crossingRes = (0, voiceCrossing_1.resolveVoiceCrossing)({
                    slice: slice,
                    voicing: v,
                    prevVoicing: state.voicing,
                    rules: rules,
                    ranges: ranges,
                    locked: locks,
                    crossingCounts: state.crossingCounts
                });
                var fixed = crossingRes.voicing;
                var scoreResult = (0, counterpointScoring_1.scoreTransition)(state.voicing, fixed, rules, slice.isStrongBeat, state.rhythmState, state.pendingRecovery, state.pendingResolution, state.parallelPerfectCounts);
                var total = state.cost + scoreResult.cost + crossingRes.cost;
                nextBeam.push({
                    voicing: fixed,
                    history: __spreadArray(__spreadArray([], state.history, true), [fixed], false),
                    pendingRecovery: scoreResult.pendingRecovery,
                    pendingResolution: scoreResult.pendingResolution,
                    rhythmState: scoreResult.rhythmState,
                    parallelPerfectCounts: scoreResult.parallelPerfectCounts,
                    crossingCounts: crossingRes.crossingCounts,
                    cost: total,
                    debug: __spreadArray(__spreadArray(__spreadArray([], state.debug, true), crossingRes.ruleHits, true), scoreResult.ruleHits, true)
                });
            }
        }
        nextBeam.sort(function (a, b) { return a.cost - b.cost; });
        beam = nextBeam.slice(0, beamWidth);
        if ((_b = beam[0]) === null || _b === void 0 ? void 0 : _b.debug)
            debugHits.push.apply(debugHits, beam[0].debug);
        if ((_c = beam[0]) === null || _c === void 0 ? void 0 : _c.rhythmState) {
            rhythmDecisions.push(__assign({ slice: i }, beam[0].rhythmState));
        }
    }
    var best = (_d = beam[0]) !== null && _d !== void 0 ? _d : initialState;
    var bestVoicings = best.history.length ? best.history : slices.map(function () { return best.voicing; });
    var hierarchyPass = (0, voiceCrossing_1.enforceHierarchyAcrossScore)({ slices: slices, voicings: bestVoicings, rules: rules, ranges: ranges });
    var finalVoicings = hierarchyPass.voicings;
    var vln1 = makeEventsFromVoicing(slices, finalVoicings, "vln1");
    var vln2 = makeEventsFromVoicing(slices, finalVoicings, "vln2");
    var vla = makeEventsFromVoicing(slices, finalVoicings, "vla");
    var vc = makeEventsFromVoicing(slices, finalVoicings, "vc");
    var cb = makeEventsFromVoicing(slices, finalVoicings, "cb");
    var measuresTemplate = ((_e = melodyPart.measures) !== null && _e !== void 0 ? _e : []).map(function (m) { return ({
        number: m.number,
        attributes: m.attributes ? JSON.parse(JSON.stringify(m.attributes)) : undefined
    }); });
    var parts = [
        buildPart(measuresTemplate, vln1, "P_V1", "Violin I", "violin_1"),
        buildPart(measuresTemplate, vln2, "P_V2", "Violin II", "violin_2"),
        buildPart(measuresTemplate, vla, "P_VA", "Viola", "viola"),
        buildPart(measuresTemplate, vc, "P_VC", "Cello", "cello"),
        buildPart(measuresTemplate, cb, "P_DB", "Double Bass", "double_bass")
    ];
    var melodyEvents = buildMelodyEvents(melodyPart, melodyShift);
    var vln1Part = parts.find(function (p) { return p.part_id === "P_V1"; });
    if (vln1Part) {
        vln1Part.measures = vln1Part.measures.map(function (m) {
            var _a, _b;
            return (__assign(__assign({}, m), { events: ((_b = (_a = melodyEvents[m.number]) !== null && _a !== void 0 ? _a : m.events) !== null && _b !== void 0 ? _b : []).sort(function (a, b) { return Number(a.t) - Number(b.t); }) }));
        });
    }
    var scoreModel = __assign(__assign({}, score), { meta: __assign(__assign({}, score.meta), { ensemble: "string_ensemble" }), parts: parts });
    return {
        scoreModel: scoreModel,
        warnings: warnings,
        debug: { ruleHits: __spreadArray(__spreadArray([], debugHits, true), hierarchyPass.ruleHits, true), motifEvents: motifEntries, rhythmDecisions: rhythmDecisions }
    };
}
