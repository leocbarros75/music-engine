"use strict";
// src/arrange/mapToWoodwindEnsemble.ts
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
exports.mapPianoToWoodwindEnsembleOpen = mapPianoToWoodwindEnsembleOpen;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
var chordExtractor_1 = require("../analyze/chordExtractor");
var chordSymbol_1 = require("../harmonize/satb/chordSymbol");
function makePart(part_id, name, instrument, staves) {
    if (staves === void 0) { staves = 1; }
    return { part_id: part_id, name: name, instrument: instrument, staves: staves, measures: [] };
}
function cloneMeasureShell(m) {
    return { number: m.number, attributes: __assign({}, m.attributes), events: [] };
}
function addNote(measure, t, dur, pitch, voice, idPrefix, seq) {
    measure.events.push({
        id: "".concat(idPrefix, "_").concat(measure.number, "_").concat(seq),
        t: t,
        dur: dur,
        type: "note",
        pitch: pitch,
        voice: voice,
        staff: 1
    });
}
function warn(warnings, msg) {
    if (!warnings)
        return;
    warnings.push(msg);
}
function parsePcToken(tok) {
    var _a;
    var m = String(tok !== null && tok !== void 0 ? tok : "").trim().match(/^([A-Ga-g])([#b]?)/);
    if (!m)
        return null;
    var step = m[1].toUpperCase();
    var acc = (_a = m[2]) !== null && _a !== void 0 ? _a : "";
    var byStep = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var base = byStep[step];
    if (typeof base !== "number")
        return null;
    var alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
    return (base + alter + 12) % 12;
}
function parseBassPc(symbol) {
    var _a;
    var s = String(symbol !== null && symbol !== void 0 ? symbol : "").trim();
    if (!s)
        return null;
    var slash = s.split("/");
    if (slash.length > 1) {
        var bass = parsePcToken((_a = slash[1]) !== null && _a !== void 0 ? _a : "");
        if (bass !== null)
            return bass;
    }
    var parsed = (0, chordSymbol_1.parseChordSymbol)(s);
    if (parsed)
        return parsed.rootPc;
    return parsePcToken(s);
}
function measureBeats(attrs) {
    var _a, _b, _c, _d, _e, _f;
    var beats = Number((_b = (_a = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _a === void 0 ? void 0 : _a.beats) !== null && _b !== void 0 ? _b : 4);
    var beatType = Number((_f = (_d = (_c = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _c === void 0 ? void 0 : _c.beat_type) !== null && _d !== void 0 ? _d : (_e = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _e === void 0 ? void 0 : _e.beatType) !== null && _f !== void 0 ? _f : 4);
    if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0)
        return 4;
    return beats * (4 / beatType);
}
function uniquePcs(pcs) {
    return Array.from(new Set(pcs.map(function (pc) { return ((pc % 12) + 12) % 12; })));
}
function chooseMidiForPc(pc, range, params) {
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        var mpc = ((m % 12) + 12) % 12;
        if (mpc !== ((pc % 12) + 12) % 12)
            continue;
        if (typeof params.upper === "number" && m > params.upper)
            continue;
        if (typeof params.lower === "number" && m < params.lower)
            continue;
        candidates.push(m);
    }
    if (!candidates.length)
        return null;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var c = candidates_1[_i];
        var move = typeof params.prev === "number" ? Math.abs(c - params.prev) : 0;
        var center = Math.abs(c - params.center);
        var score = move * 3 + center;
        if (score < bestScore) {
            best = c;
            bestScore = score;
        }
    }
    return best;
}
function shiftOctavesToward(midi, lo, hi, center) {
    var m = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi, lo, hi);
    var candidates = [];
    for (var k = -4; k <= 4; k++) {
        var c = m + 12 * k;
        if (c >= lo && c <= hi)
            candidates.push(c);
    }
    if (candidates.length === 0)
        return m;
    var best = candidates[0];
    var bestDist = Math.abs(best - center);
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var c = candidates_2[_i];
        var d = Math.abs(c - center);
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    return best;
}
function homophonicLevel(options) {
    var _a, _b, _c;
    var level = String((_a = options.level) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var accompaniment = String((_b = options.accompaniment) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var textureMode = String((_c = options.textureMode) !== null && _c !== void 0 ? _c : "").toLowerCase();
    var isHomophonic = accompaniment === "homophonic" ||
        accompaniment === "chordal" ||
        textureMode === "homophony_homorhythmic" ||
        textureMode === "homophony_melody_accompaniment";
    if (!isHomophonic)
        return null;
    if (level === "beginner")
        return "beginner";
    if (level === "intermediate")
        return "intermediate";
    if (level === "advanced")
        return "advanced";
    return null;
}
function polyphonicProfile(options) {
    var _a, _b, _c, _d, _e, _f, _g;
    var level = String((_a = options.level) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var accompaniment = String((_b = options.accompaniment) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var textureMode = String((_c = options.textureMode) !== null && _c !== void 0 ? _c : "").toLowerCase();
    var isPolyphonic = accompaniment === "polyphonic" || textureMode === "polyphony";
    if (!isPolyphonic || level !== "beginner")
        return null;
    var fluteActivity = (_d = options.fluteActivity) !== null && _d !== void 0 ? _d : "less_active";
    var oboeActivity = (_e = options.oboeActivity) !== null && _e !== void 0 ? _e : "less_active";
    var clarinetActivity = (_f = options.clarinetActivity) !== null && _f !== void 0 ? _f : "less_active";
    var bassoonActivity = (_g = options.bassoonActivity) !== null && _g !== void 0 ? _g : "less_active";
    if (fluteActivity === "less_active" &&
        oboeActivity === "less_active" &&
        clarinetActivity === "less_active" &&
        bassoonActivity === "less_active") {
        return "beginner_less_active";
    }
    if (fluteActivity === "active" &&
        oboeActivity === "active" &&
        clarinetActivity === "active" &&
        bassoonActivity === "active") {
        return "beginner_active";
    }
    return null;
}
function pcOfMidi(midi) {
    if (typeof midi !== "number" || !Number.isFinite(midi))
        return null;
    return ((midi % 12) + 12) % 12;
}
function activeMidiAt(events, t) {
    var _a;
    var active = null;
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var ev = events_1[_i];
        if (ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9) {
            if (!active || ev.t > active.t)
                active = { t: ev.t, midi: ev.midi };
        }
    }
    return (_a = active === null || active === void 0 ? void 0 : active.midi) !== null && _a !== void 0 ? _a : null;
}
function minMidiDuring(events, t, dur) {
    var overlapping = events
        .filter(function (ev) { return ev.t < t + dur - 1e-9 && t < ev.t + ev.dur - 1e-9; })
        .map(function (ev) { return ev.midi; });
    return overlapping.length ? Math.min.apply(Math, overlapping) : null;
}
function maxMidiDuring(events, t, dur) {
    var overlapping = events
        .filter(function (ev) { return ev.t < t + dur - 1e-9 && t < ev.t + ev.dur - 1e-9; })
        .map(function (ev) { return ev.midi; });
    return overlapping.length ? Math.max.apply(Math, overlapping) : null;
}
function buildQuarterHalfPattern(measureLen, measureNumber, beatUnit) {
    if (beatUnit === void 0) { beatUnit = 1; }
    var out = [];
    var remaining = measureLen;
    var useTwo = measureNumber % 2 === 0;
    while (remaining > 0.01) {
        if (remaining >= beatUnit * 2 && useTwo) {
            out.push(beatUnit * 2);
            remaining -= beatUnit * 2;
        }
        else {
            out.push(Math.min(beatUnit, remaining));
            remaining -= beatUnit;
        }
    }
    return out;
}
function shouldChooseMeasure(measureNumber, ratio, salt) {
    if (salt === void 0) { salt = 0; }
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var h = (measureNumber * 2654435761) ^ (salt * 1597334677);
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
function pickChordToneSequence(chord, length) {
    var _a, _b;
    if (length === void 0) { length = 4; }
    var pcs = (_a = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _a !== void 0 ? _a : [];
    if (!pcs.length)
        return [];
    var root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0];
    var fifth = (root + 7) % 12;
    var majorThird = (root + 4) % 12;
    var minorThird = (root + 3) % 12;
    var third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
    if (third === null) {
        third = (_b = pcs.find(function (pc) { return pc !== root && pc !== fifth; })) !== null && _b !== void 0 ? _b : root;
    }
    var base = [root, fifth, third, fifth];
    var out = [];
    for (var i = 0; i < length; i++)
        out.push(base[i % base.length]);
    return out;
}
function pickThirdAndFifth(chord) {
    var _a;
    var pcs = (_a = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _a !== void 0 ? _a : [];
    if (!pcs.length)
        return [];
    var root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0];
    var fifth = (root + 7) % 12;
    var majorThird = (root + 4) % 12;
    var minorThird = (root + 3) % 12;
    var third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
    var out = [];
    if (third !== null)
        out.push(third);
    if (pcs.includes(fifth))
        out.push(fifth);
    return out.length ? out : pcs.slice(0, 2);
}
function pickRootAndFifth(chord) {
    var _a;
    var pcs = (_a = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _a !== void 0 ? _a : [];
    if (!pcs.length)
        return [];
    var root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0];
    var fifth = (root + 7) % 12;
    var out = [root];
    if (pcs.includes(fifth))
        out.push(fifth);
    return uniquePcs(out.length ? out : pcs.slice(0, 2));
}
function oppositeDirection(dir) {
    if (dir === "up")
        return "down";
    if (dir === "down")
        return "up";
    return "either";
}
function candidateMidisForPcs(pcs, minMidi, maxMidi, params) {
    if (params === void 0) { params = {}; }
    var out = new Set();
    for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
        var rawPc = pcs_1[_i];
        var pc = ((rawPc % 12) + 12) % 12;
        for (var midi = minMidi; midi <= maxMidi; midi++) {
            if (((midi % 12) + 12) % 12 !== pc)
                continue;
            if (typeof params.lower === "number" && midi < params.lower)
                continue;
            if (typeof params.upper === "number" && midi > params.upper)
                continue;
            if (typeof params.excludeMidi === "number" && midi === params.excludeMidi)
                continue;
            if (typeof params.excludePc === "number" && pc === ((params.excludePc % 12) + 12) % 12)
                continue;
            out.add(midi);
        }
    }
    return Array.from(out).sort(function (a, b) { return a - b; });
}
function pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, params) {
    var _a;
    if (params === void 0) { params = {}; }
    var candidates = candidateMidisForPcs(pcs, minMidi, maxMidi, params);
    if (!candidates.length)
        return (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
    var center = typeof params.center === "number" ? params.center : prevMidi;
    var avoidSet = new Set(((_a = params.avoidPc) !== null && _a !== void 0 ? _a : []).map(function (pc) { return ((pc % 12) + 12) % 12; }));
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_3 = candidates; _i < candidates_3.length; _i++) {
        var cand = candidates_3[_i];
        var move = Math.abs(cand - prevMidi);
        var dirPenalty = preferDir === "either"
            ? 0
            : preferDir === "up"
                ? cand > prevMidi
                    ? 0
                    : 8
                : cand < prevMidi
                    ? 0
                    : 8;
        var centerPenalty = Math.abs(cand - center);
        var avoidPenalty = avoidSet.has(((cand % 12) + 12) % 12) ? 15 : 0;
        var score = move * 3 + dirPenalty + centerPenalty + avoidPenalty;
        if (score < bestScore) {
            best = cand;
            bestScore = score;
        }
    }
    return best;
}
function findSourcePart(score) {
    var _a, _b;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var pianoByInstrument = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.instrument) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("piano"); });
    if (pianoByInstrument)
        return pianoByInstrument;
    var pianoByStaves = parts.find(function (p) { var _a; return Number((_a = p === null || p === void 0 ? void 0 : p.staves) !== null && _a !== void 0 ? _a : 1) >= 2; });
    if (pianoByStaves)
        return pianoByStaves;
    return (_b = parts[0]) !== null && _b !== void 0 ? _b : null;
}
function normalizeChords(score, options) {
    var _a;
    var fromOptions = Array.isArray(options.chords) ? options.chords : [];
    var fromMeta = Array.isArray((_a = score === null || score === void 0 ? void 0 : score.meta) === null || _a === void 0 ? void 0 : _a.inputChords) ? score.meta.inputChords : [];
    var src = fromOptions.length ? fromOptions : fromMeta;
    return src
        .map(function (c) {
        var _a;
        return ({
            measure: Number(c.measure),
            t: Number(c.t),
            symbol: String((_a = c.symbol) !== null && _a !== void 0 ? _a : "")
        });
    })
        .filter(function (c) { return Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol; })
        .sort(function (a, b) { return (a.measure - b.measure) || (a.t - b.t); });
}
function collectRhTopNotes(m) {
    var _a, _b, _c, _d, _e;
    var notes = ((_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : [])
        .filter(function (ev) { return (ev === null || ev === void 0 ? void 0 : ev.type) === "note" && (ev === null || ev === void 0 ? void 0 : ev.pitch); })
        .map(function (ev) { return ({ ev: ev, midi: (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) }); })
        .filter(function (x) { return Number.isFinite(x.midi); });
    var hasStaff = notes.some(function (n) { var _a; return Number.isFinite(Number((_a = n.ev) === null || _a === void 0 ? void 0 : _a.staff)); });
    var rh = notes.filter(function (n) {
        var _a, _b;
        if (hasStaff)
            return Number((_b = (_a = n.ev) === null || _a === void 0 ? void 0 : _a.staff) !== null && _b !== void 0 ? _b : 1) === 1;
        return n.midi >= 60;
    });
    var src = rh.length ? rh : notes;
    var byT = new Map();
    for (var _i = 0, src_1 = src; _i < src_1.length; _i++) {
        var n = src_1[_i];
        var t = Number((_c = (_b = n.ev) === null || _b === void 0 ? void 0 : _b.t) !== null && _c !== void 0 ? _c : 0);
        var dur = Number((_e = (_d = n.ev) === null || _d === void 0 ? void 0 : _d.dur) !== null && _e !== void 0 ? _e : 0);
        if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0)
            continue;
        var prev = byT.get(t);
        if (!prev || n.midi > prev.midi) {
            byT.set(t, { t: t, dur: dur, midi: n.midi });
        }
    }
    return Array.from(byT.values()).sort(function (a, b) { return a.t - b.t; });
}
function collectOnsetPcs(m) {
    var _a, _b, _c;
    var out = new Map();
    for (var _i = 0, _d = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _i < _d.length; _i++) {
        var ev = _d[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || !(ev === null || ev === void 0 ? void 0 : ev.pitch))
            continue;
        var t = Number((_b = ev.t) !== null && _b !== void 0 ? _b : 0);
        if (!Number.isFinite(t))
            continue;
        var pc = (((0, instrumentCatalog_1.pitchToMidi)(ev.pitch) % 12) + 12) % 12;
        var list = (_c = out.get(t)) !== null && _c !== void 0 ? _c : [];
        list.push(pc);
        out.set(t, list);
    }
    for (var _e = 0, _f = out.entries(); _e < _f.length; _e++) {
        var _g = _f[_e], k = _g[0], v = _g[1];
        out.set(k, uniquePcs(v));
    }
    return out;
}
function mapBeginnerPolyphonicLessActive(score, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    var srcPart = findSourcePart(score);
    if (!srcPart)
        return score;
    var fl = makePart("FL", "Flute", "flute", 1);
    var ob = makePart("OB", "Oboe", "oboe", 1);
    var cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
    var bn = makePart("BN", "Bassoon", "bassoon", 1);
    var outParts = [fl, ob, cl, bn];
    var measureMap = {};
    var _loop_1 = function (m) {
        var shells = outParts.map(function () { return cloneMeasureShell(m); });
        measureMap[String(m.number)] = shells;
        fl.measures.push(shells[0]);
        ob.measures.push(shells[1]);
        cl.measures.push(shells[2]);
        bn.measures.push(shells[3]);
    };
    for (var _i = 0, _p = (_a = srcPart.measures) !== null && _a !== void 0 ? _a : []; _i < _p.length; _i++) {
        var m = _p[_i];
        _loop_1(m);
    }
    var chords = normalizeChords(score, options);
    var chordsByMeasure = new Map();
    for (var _q = 0, chords_1 = chords; _q < chords_1.length; _q++) {
        var ch = chords_1[_q];
        var list = (_b = chordsByMeasure.get(ch.measure)) !== null && _b !== void 0 ? _b : [];
        list.push(ch);
        chordsByMeasure.set(ch.measure, list);
    }
    for (var _r = 0, _s = chordsByMeasure.values(); _r < _s.length; _r++) {
        var list = _s[_r];
        list.sort(function (a, b) { return a.t - b.t; });
    }
    // Beginner polyphonic ranges mirror the locked beginner wind ranges.
    var rFL = { midi_low: 60, midi_high: 79 };
    var rOB = { midi_low: 62, midi_high: 87 };
    var rCL = { midi_low: 52, midi_high: 84 };
    var rBN = { midi_low: 29, midi_high: 55 };
    var seq = 0;
    var prevOb = 69;
    var prevCl = 60;
    var prevBn = 41;
    var totalMeasures = ((_c = srcPart.measures) !== null && _c !== void 0 ? _c : []).length;
    var _loop_2 = function (mi) {
        var srcMeasure = srcPart.measures[mi];
        var mNum = Number((_d = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.number) !== null && _d !== void 0 ? _d : mi + 1);
        var shells = measureMap[String(mNum)];
        if (!shells)
            return "continue";
        var melody = collectRhTopNotes(srcMeasure).map(function (ev) { return (__assign(__assign({}, ev), { midi: (0, instrumentCatalog_1.shiftOctavesIntoRange)(ev.midi + 12, rFL.midi_low, rFL.midi_high) })); });
        for (var _t = 0, melody_1 = melody; _t < melody_1.length; _t++) {
            var ev = melody_1[_t];
            addNote(shells[0], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "FL", ++seq);
        }
        var chordsHere = (_e = chordsByMeasure.get(mNum)) !== null && _e !== void 0 ? _e : [];
        // ScoreModel event timing uses beats, while the MusicXML exporter converts beats to
        // divisions later. Keep all planning in beat units here so rhythm and harmony stay aligned.
        var beatUnit = 1;
        var measureLen = measureBeats(srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.attributes);
        var sourceNoteEvents = ((_f = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.events) !== null && _f !== void 0 ? _f : [])
            .filter(function (ev) { return (ev === null || ev === void 0 ? void 0 : ev.type) === "note" && (ev === null || ev === void 0 ? void 0 : ev.pitch); })
            .map(function (ev) { var _a, _b; return ({ t: Number((_a = ev.t) !== null && _a !== void 0 ? _a : 0), dur: Number((_b = ev.dur) !== null && _b !== void 0 ? _b : 0), midi: (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) }); })
            .filter(function (ev) { return Number.isFinite(ev.t) && Number.isFinite(ev.dur) && ev.dur > 0 && Number.isFinite(ev.midi); });
        var harmonyAt = function (t) {
            var _a, _b, _c, _d, _e;
            var activeChord = null;
            for (var _i = 0, chordsHere_1 = chordsHere; _i < chordsHere_1.length; _i++) {
                var ch = chordsHere_1[_i];
                if (ch.t <= t + 1e-9)
                    activeChord = ch;
            }
            var activeSourcePcs = uniquePcs(sourceNoteEvents.filter(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; }).map(function (ev) { var _a; return (_a = pcOfMidi(ev.midi)) !== null && _a !== void 0 ? _a : 0; }));
            var sourceBassPc = (function () {
                var active = sourceNoteEvents
                    .filter(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; })
                    .sort(function (a, b) { return a.midi - b.midi; });
                return active.length ? pcOfMidi(active[0].midi) : null;
            })();
            var parsed = activeChord ? (0, chordSymbol_1.parseChordSymbol)(activeChord.symbol) : null;
            var pcs = uniquePcs(((_a = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) === null || _a === void 0 ? void 0 : _a.length) ? parsed.pcs : activeSourcePcs);
            var rootPc = (_d = (_c = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _b !== void 0 ? _b : pcs[0]) !== null && _c !== void 0 ? _c : sourceBassPc) !== null && _d !== void 0 ? _d : 0;
            var bassPc = activeChord ? ((_e = parseBassPc(activeChord.symbol)) !== null && _e !== void 0 ? _e : rootPc) : sourceBassPc !== null && sourceBassPc !== void 0 ? sourceBassPc : rootPc;
            var majThird = (rootPc + 4) % 12;
            var minThird = (rootPc + 3) % 12;
            var thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
            var fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;
            var chordCore = uniquePcs([rootPc, thirdPc !== null && thirdPc !== void 0 ? thirdPc : undefined, fifthPc !== null && fifthPc !== void 0 ? fifthPc : undefined].filter(function (x) { return typeof x === "number"; }));
            return {
                pcs: pcs.length ? pcs : chordCore,
                rootPc: rootPc,
                bassPc: bassPc,
                thirdPc: thirdPc,
                fifthPc: fifthPc,
                chordCore: chordCore.length ? chordCore : pcs
            };
        };
        var melodyDirAt = function (t) {
            var currentIdx = melody.findIndex(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; });
            if (currentIdx <= 0)
                return "either";
            var current = melody[currentIdx];
            var prev = melody[currentIdx - 1];
            if (!current || !prev)
                return "either";
            if (current.midi > prev.midi)
                return "up";
            if (current.midi < prev.midi)
                return "down";
            return "either";
        };
        var isClosingMeasure = mi >= totalMeasures - 2;
        if (isClosingMeasure && melody.length) {
            var tailBnEvents = [];
            var tailClEvents = [];
            var tailObEvents = [];
            var _loop_3 = function (slot) {
                var h = harmonyAt(slot.t);
                var bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(slot.t)), { center: 41 });
                tailBnEvents.push({ t: slot.t, dur: slot.dur, midi: bnMidi });
                prevBn = bnMidi;
                var coveredForClarinet = new Set();
                for (var _3 = 0, _4 = [pcOfMidi(slot.midi), pcOfMidi(bnMidi)]; _3 < _4.length; _3++) {
                    var pc = _4[_3];
                    if (typeof pc === "number" && h.chordCore.includes(pc))
                        coveredForClarinet.add(pc);
                }
                var missingForClarinet = h.chordCore.filter(function (pc) { return !coveredForClarinet.has(pc); });
                var clarinetPriority = uniquePcs(__spreadArray(__spreadArray([], missingForClarinet, true), h.pcs.filter(function (pc) { return pc !== pcOfMidi(bnMidi); }), true));
                var clarinetLower = bnMidi + 1;
                var clarinetStrictUpper = slot.midi - 8;
                var clarinetRelaxedUpper = slot.midi - 1;
                var clarinetUpper = clarinetStrictUpper;
                var clarinetPool = candidateMidisForPcs(clarinetPriority.length ? clarinetPriority : h.pcs, rCL.midi_low, rCL.midi_high, { lower: clarinetLower, upper: clarinetUpper });
                if (!clarinetPool.length) {
                    clarinetUpper = clarinetRelaxedUpper;
                    clarinetPool = candidateMidisForPcs(clarinetPriority.length ? clarinetPriority : h.pcs, rCL.midi_low, rCL.midi_high, { lower: clarinetLower, upper: clarinetUpper });
                }
                var clMidi = clarinetPool.length
                    ? pickCandidateNear(prevCl, clarinetPriority.length ? clarinetPriority : h.pcs, rCL.midi_low, rCL.midi_high, oppositeDirection(melodyDirAt(slot.t)), {
                        lower: clarinetLower,
                        upper: clarinetUpper,
                        center: bnMidi + 4,
                        avoidPc: missingForClarinet.length ? [] : [(_g = pcOfMidi(bnMidi)) !== null && _g !== void 0 ? _g : -1]
                    })
                    : (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevCl, rCL.midi_low, rCL.midi_high);
                tailClEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
                prevCl = clMidi;
                var coveredForOboe = new Set();
                for (var _5 = 0, _6 = [pcOfMidi(slot.midi), pcOfMidi(clMidi), pcOfMidi(bnMidi)]; _5 < _6.length; _5++) {
                    var pc = _6[_5];
                    if (typeof pc === "number" && h.chordCore.includes(pc))
                        coveredForOboe.add(pc);
                }
                var missingForOboe = h.chordCore.filter(function (pc) { return !coveredForOboe.has(pc); });
                var oboePriority = uniquePcs(__spreadArray(__spreadArray([], missingForOboe, true), h.pcs.filter(function (pc) { return pc !== pcOfMidi(clMidi); }), true));
                var oboeLower = clMidi + 1;
                var oboeUpper = slot.midi - 1;
                var oboePool = candidateMidisForPcs(oboePriority.length ? oboePriority : h.pcs, rOB.midi_low, rOB.midi_high, {
                    lower: oboeLower,
                    upper: oboeUpper
                });
                if (!oboePool.length) {
                    oboePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
                        lower: oboeLower,
                        upper: oboeUpper
                    });
                }
                var obMidi = oboePool.length
                    ? pickCandidateNear(prevOb, oboePriority.length ? oboePriority : h.pcs, rOB.midi_low, rOB.midi_high, oppositeDirection(melodyDirAt(slot.t)), {
                        lower: oboeLower,
                        upper: oboeUpper,
                        center: (slot.midi + clMidi) / 2,
                        avoidPc: missingForOboe.length ? [] : [(_h = pcOfMidi(clMidi)) !== null && _h !== void 0 ? _h : -1]
                    })
                    : (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevOb, rOB.midi_low, rOB.midi_high);
                tailObEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
                prevOb = obMidi;
            };
            for (var _u = 0, melody_2 = melody; _u < melody_2.length; _u++) {
                var slot = melody_2[_u];
                _loop_3(slot);
            }
            for (var _v = 0, tailBnEvents_1 = tailBnEvents; _v < tailBnEvents_1.length; _v++) {
                var ev = tailBnEvents_1[_v];
                addNote(shells[3], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "BN", ++seq);
            }
            for (var _w = 0, tailClEvents_1 = tailClEvents; _w < tailClEvents_1.length; _w++) {
                var ev = tailClEvents_1[_w];
                addNote(shells[2], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "CL", ++seq);
            }
            for (var _x = 0, tailObEvents_1 = tailObEvents; _x < tailObEvents_1.length; _x++) {
                var ev = tailObEvents_1[_x];
                addNote(shells[1], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "OB", ++seq);
            }
            return "continue";
        }
        var bnEvents = [];
        var t = 0;
        for (var _y = 0, _z = buildQuarterHalfPattern(measureLen, mNum, beatUnit); _y < _z.length; _y++) {
            var dur = _z[_y];
            var h = harmonyAt(t);
            var preferDir = oppositeDirection(melodyDirAt(t));
            var bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, preferDir, {
                center: 41
            });
            bnEvents.push({ t: t, dur: dur, midi: bnMidi });
            addNote(shells[3], t, dur, (0, instrumentCatalog_1.midiToPitch)(bnMidi), 1, "BN", ++seq);
            prevBn = bnMidi;
            t += dur;
        }
        var clEvents = [];
        for (var i = 0; i < bnEvents.length; i++) {
            var bnEv = bnEvents[i];
            var nextBn = bnEvents[i + 1];
            var slots = Math.abs(bnEv.dur - beatUnit * 2) < 1e-6
                ? [
                    { t: bnEv.t, dur: beatUnit },
                    { t: bnEv.t + beatUnit, dur: beatUnit }
                ]
                : Math.abs(bnEv.dur - beatUnit) < 1e-6 && nextBn && Math.abs(nextBn.dur - beatUnit) < 1e-6
                    ? [{ t: bnEv.t, dur: beatUnit * 2 }]
                    : [{ t: bnEv.t, dur: bnEv.dur }];
            var prevBnMidi = i > 0 ? (_k = (_j = bnEvents[i - 1]) === null || _j === void 0 ? void 0 : _j.midi) !== null && _k !== void 0 ? _k : null : null;
            var bnDir = typeof prevBnMidi === "number"
                ? bnEv.midi > prevBnMidi
                    ? "up"
                    : bnEv.midi < prevBnMidi
                        ? "down"
                        : "either"
                : "either";
            var preferDir = oppositeDirection(bnDir);
            var _loop_4 = function (slot) {
                var h = harmonyAt(slot.t);
                var fluteNow = activeMidiAt(melody, slot.t);
                var bassNow = activeMidiAt(bnEvents, slot.t);
                var fluteCeiling = minMidiDuring(melody, slot.t, slot.dur);
                var bassFloor = maxMidiDuring(bnEvents, slot.t, slot.dur);
                var covered = new Set();
                for (var _7 = 0, _8 = [pcOfMidi(fluteNow), pcOfMidi(bassNow)]; _7 < _8.length; _7++) {
                    var pc = _8[_7];
                    if (typeof pc === "number" && h.chordCore.includes(pc))
                        covered.add(pc);
                }
                var missing = h.chordCore.filter(function (pc) { return !covered.has(pc); });
                var priority = uniquePcs(__spreadArray(__spreadArray([], missing, true), h.pcs.filter(function (pc) { return pc !== pcOfMidi(bassNow); }), true));
                var lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
                var strictUpper = typeof fluteCeiling === "number" ? fluteCeiling - 8 : typeof fluteNow === "number" ? fluteNow - 8 : undefined;
                var relaxedUpper = typeof fluteCeiling === "number" ? fluteCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 1 : undefined;
                var activeUpper = strictUpper;
                var candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
                    lower: lower,
                    upper: activeUpper
                });
                if (!candidatePool.length) {
                    activeUpper = relaxedUpper;
                    candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
                        lower: lower,
                        upper: activeUpper
                    });
                }
                if (!candidatePool.length)
                    return "continue";
                var clMidi = pickCandidateNear(prevCl, priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, preferDir, {
                    lower: lower,
                    upper: activeUpper,
                    center: typeof bassFloor === "number"
                        ? bassFloor + 4
                        : typeof bassNow === "number"
                            ? bassNow + 4
                            : 55,
                    avoidPc: missing.length ? [] : typeof bassNow === "number" ? [(_l = pcOfMidi(bassNow)) !== null && _l !== void 0 ? _l : -1] : []
                });
                clEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
                prevCl = clMidi;
            };
            for (var _0 = 0, slots_1 = slots; _0 < slots_1.length; _0++) {
                var slot = slots_1[_0];
                _loop_4(slot);
            }
            if (Math.abs(bnEv.dur - beatUnit) < 1e-6 && nextBn && Math.abs(nextBn.dur - beatUnit) < 1e-6)
                i += 1;
        }
        for (var _1 = 0, clEvents_1 = clEvents; _1 < clEvents_1.length; _1++) {
            var ev = clEvents_1[_1];
            addNote(shells[2], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "CL", ++seq);
        }
        var obEvents = [];
        var _loop_5 = function (beat) {
            var slot = { t: beat, dur: Math.min(beatUnit, measureLen - beat) };
            var h = harmonyAt(slot.t);
            var fluteNow = activeMidiAt(melody, slot.t);
            var clarinetNow = activeMidiAt(clEvents, slot.t);
            var bassNow = activeMidiAt(bnEvents, slot.t);
            var fluteCeiling = minMidiDuring(melody, slot.t, slot.dur);
            var clarinetFloor = maxMidiDuring(clEvents, slot.t, slot.dur);
            var covered = new Set();
            for (var _9 = 0, _10 = [pcOfMidi(fluteNow), pcOfMidi(clarinetNow), pcOfMidi(bassNow)]; _9 < _10.length; _9++) {
                var pc = _10[_9];
                if (typeof pc === "number" && h.chordCore.includes(pc))
                    covered.add(pc);
            }
            var missing = h.chordCore.filter(function (pc) { return !covered.has(pc); });
            var priority = uniquePcs(__spreadArray(__spreadArray([], missing, true), h.pcs.filter(function (pc) { return pc !== pcOfMidi(clarinetNow); }), true));
            var lower = typeof clarinetFloor === "number"
                ? clarinetFloor + 1
                : typeof clarinetNow === "number"
                    ? clarinetNow + 1
                    : typeof bassNow === "number"
                        ? bassNow + 1
                        : undefined;
            var upper = typeof fluteCeiling === "number" ? fluteCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 1 : undefined;
            var candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
                lower: lower,
                upper: upper
            });
            if (!candidatePool.length) {
                candidatePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
                    lower: lower,
                    upper: upper
                });
            }
            if (!candidatePool.length)
                return "continue";
            var obMidi = pickCandidateNear(prevOb, priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, oppositeDirection(melodyDirAt(slot.t)), {
                lower: lower,
                upper: upper,
                center: typeof fluteCeiling === "number" && typeof clarinetFloor === "number"
                    ? (fluteCeiling + clarinetFloor) / 2
                    : typeof fluteNow === "number" && typeof clarinetNow === "number"
                        ? (fluteNow + clarinetNow) / 2
                        : typeof fluteNow === "number"
                            ? fluteNow - 5
                            : 69,
                avoidPc: missing.length ? [] : typeof clarinetNow === "number" ? [(_m = pcOfMidi(clarinetNow)) !== null && _m !== void 0 ? _m : -1] : []
            });
            obEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
            prevOb = obMidi;
        };
        for (var beat = 0; beat < measureLen - 1e-6; beat += beatUnit) {
            _loop_5(beat);
        }
        for (var _2 = 0, obEvents_1 = obEvents; _2 < obEvents_1.length; _2++) {
            var ev = obEvents_1[_2];
            addNote(shells[1], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "OB", ++seq);
        }
    };
    for (var mi = 0; mi < totalMeasures; mi++) {
        _loop_2(mi);
    }
    warn(options.warnings, "[woodwinds] Beginner polyphonic (40%): Flute melody, Bassoon quarter/half bass, Clarinet contrary to Bassoon, Oboe contrary to Flute, strict no crossing.");
    if (!chords.length) {
        warn(options.warnings, "[woodwinds] Beginner polyphonic used source harmony fallback because no chord symbols were found.");
    }
    return {
        score_id: "ARR_".concat(Math.random().toString(16).slice(2, 10)),
        meta: __assign(__assign({}, ((_o = score.meta) !== null && _o !== void 0 ? _o : {})), { ensemble: "woodwind_ensemble" }),
        global: __assign({}, score.global),
        parts: outParts
    };
}
function mapBeginnerPolyphonicActive(score, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var srcPart = findSourcePart(score);
    if (!srcPart)
        return score;
    var fl = makePart("FL", "Flute", "flute", 1);
    var ob = makePart("OB", "Oboe", "oboe", 1);
    var cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
    var bn = makePart("BN", "Bassoon", "bassoon", 1);
    var outParts = [fl, ob, cl, bn];
    var measureMap = {};
    var _loop_6 = function (m) {
        var shells = outParts.map(function () { return cloneMeasureShell(m); });
        measureMap[String(m.number)] = shells;
        fl.measures.push(shells[0]);
        ob.measures.push(shells[1]);
        cl.measures.push(shells[2]);
        bn.measures.push(shells[3]);
    };
    for (var _i = 0, _k = (_a = srcPart.measures) !== null && _a !== void 0 ? _a : []; _i < _k.length; _i++) {
        var m = _k[_i];
        _loop_6(m);
    }
    var chords = normalizeChords(score, options);
    var chordsByMeasure = new Map();
    for (var _l = 0, chords_2 = chords; _l < chords_2.length; _l++) {
        var ch = chords_2[_l];
        var list = (_b = chordsByMeasure.get(ch.measure)) !== null && _b !== void 0 ? _b : [];
        list.push(ch);
        chordsByMeasure.set(ch.measure, list);
    }
    for (var _m = 0, _o = chordsByMeasure.values(); _m < _o.length; _m++) {
        var list = _o[_m];
        list.sort(function (a, b) { return a.t - b.t; });
    }
    var rFL = { midi_low: 60, midi_high: 79 };
    var rOB = { midi_low: 62, midi_high: 87 };
    var rCL = { midi_low: 52, midi_high: 84 };
    var rBN = { midi_low: 29, midi_high: 55 };
    var seq = 0;
    var prevOb = 69;
    var prevCl = 60;
    var prevBn = 41;
    var _loop_7 = function (mi) {
        var srcMeasure = srcPart.measures[mi];
        var mNum = Number((_d = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.number) !== null && _d !== void 0 ? _d : mi + 1);
        var shells = measureMap[String(mNum)];
        if (!shells)
            return "continue";
        var melody = collectRhTopNotes(srcMeasure).map(function (ev) { return (__assign(__assign({}, ev), { midi: (0, instrumentCatalog_1.shiftOctavesIntoRange)(ev.midi + 12, rFL.midi_low, rFL.midi_high) })); });
        for (var _p = 0, melody_3 = melody; _p < melody_3.length; _p++) {
            var ev = melody_3[_p];
            addNote(shells[0], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(ev.midi), 1, "FL", ++seq);
        }
        var chordsHere = (_e = chordsByMeasure.get(mNum)) !== null && _e !== void 0 ? _e : [];
        var measureLen = measureBeats(srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.attributes);
        var sourceNoteEvents = ((_f = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.events) !== null && _f !== void 0 ? _f : [])
            .filter(function (ev) { return (ev === null || ev === void 0 ? void 0 : ev.type) === "note" && (ev === null || ev === void 0 ? void 0 : ev.pitch); })
            .map(function (ev) { var _a, _b; return ({ t: Number((_a = ev.t) !== null && _a !== void 0 ? _a : 0), dur: Number((_b = ev.dur) !== null && _b !== void 0 ? _b : 0), midi: (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) }); })
            .filter(function (ev) { return Number.isFinite(ev.t) && Number.isFinite(ev.dur) && ev.dur > 0 && Number.isFinite(ev.midi); });
        var harmonyAt = function (t) {
            var _a, _b, _c, _d, _e;
            var activeChord = null;
            for (var _i = 0, chordsHere_2 = chordsHere; _i < chordsHere_2.length; _i++) {
                var ch = chordsHere_2[_i];
                if (ch.t <= t + 1e-9)
                    activeChord = ch;
            }
            var activeSourcePcs = uniquePcs(sourceNoteEvents.filter(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; }).map(function (ev) { var _a; return (_a = pcOfMidi(ev.midi)) !== null && _a !== void 0 ? _a : 0; }));
            var sourceBassPc = (function () {
                var active = sourceNoteEvents
                    .filter(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; })
                    .sort(function (a, b) { return a.midi - b.midi; });
                return active.length ? pcOfMidi(active[0].midi) : null;
            })();
            var parsed = activeChord ? (0, chordSymbol_1.parseChordSymbol)(activeChord.symbol) : null;
            var pcs = uniquePcs(((_a = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) === null || _a === void 0 ? void 0 : _a.length) ? parsed.pcs : activeSourcePcs);
            var rootPc = (_d = (_c = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _b !== void 0 ? _b : pcs[0]) !== null && _c !== void 0 ? _c : sourceBassPc) !== null && _d !== void 0 ? _d : 0;
            var bassPc = activeChord ? ((_e = parseBassPc(activeChord.symbol)) !== null && _e !== void 0 ? _e : rootPc) : sourceBassPc !== null && sourceBassPc !== void 0 ? sourceBassPc : rootPc;
            var majThird = (rootPc + 4) % 12;
            var minThird = (rootPc + 3) % 12;
            var thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
            var fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;
            var chordCore = uniquePcs([rootPc, thirdPc !== null && thirdPc !== void 0 ? thirdPc : undefined, fifthPc !== null && fifthPc !== void 0 ? fifthPc : undefined].filter(function (x) { return typeof x === "number"; }));
            return {
                pcs: pcs.length ? pcs : chordCore,
                rootPc: rootPc,
                bassPc: bassPc,
                thirdPc: thirdPc,
                fifthPc: fifthPc,
                chordCore: chordCore.length ? chordCore : pcs
            };
        };
        var melodyDirAt = function (t) {
            var currentIdx = melody.findIndex(function (ev) { return ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9; });
            if (currentIdx <= 0)
                return "either";
            var current = melody[currentIdx];
            var prev = melody[currentIdx - 1];
            if (!current || !prev)
                return "either";
            if (current.midi > prev.midi)
                return "up";
            if (current.midi < prev.midi)
                return "down";
            return "either";
        };
        var bnEvents = [];
        for (var _q = 0, melody_4 = melody; _q < melody_4.length; _q++) {
            var ev = melody_4[_q];
            var h = harmonyAt(ev.t);
            var bassChoices = uniquePcs(__spreadArray([h.bassPc], pickRootAndFifth(h), true));
            var bnMidi = pickCandidateNear(prevBn, bassChoices, rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(ev.t)), {
                center: 41
            });
            bnEvents.push({ t: ev.t, dur: ev.dur, midi: bnMidi });
            addNote(shells[3], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(bnMidi), 1, "BN", ++seq);
            prevBn = bnMidi;
        }
        var obEvents = [];
        var _loop_8 = function (ev) {
            var h = harmonyAt(ev.t);
            var bassFloor = maxMidiDuring(bnEvents, ev.t, ev.dur);
            var lower = typeof bassFloor === "number" ? bassFloor + 1 : undefined;
            var upper = ev.midi - 1;
            var colors = pickThirdAndFifth(h);
            var covered = new Set();
            for (var _s = 0, _t = [pcOfMidi(ev.midi), pcOfMidi(activeMidiAt(bnEvents, ev.t))]; _s < _t.length; _s++) {
                var pc = _t[_s];
                if (typeof pc === "number" && h.chordCore.includes(pc))
                    covered.add(pc);
            }
            var missing = h.chordCore.filter(function (pc) { return !covered.has(pc); });
            var priority = uniquePcs(__spreadArray(__spreadArray(__spreadArray([], missing, true), colors, true), h.pcs, true));
            var pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
                lower: lower,
                upper: upper
            });
            if (!pool.length) {
                pool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, { lower: lower, upper: upper });
            }
            if (!pool.length)
                return "continue";
            var obMidi = pickCandidateNear(prevOb, priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, oppositeDirection(melodyDirAt(ev.t)), {
                lower: lower,
                upper: upper,
                center: ev.midi - 5,
                avoidPc: missing.length ? [] : typeof activeMidiAt(bnEvents, ev.t) === "number" ? [(_g = pcOfMidi(activeMidiAt(bnEvents, ev.t))) !== null && _g !== void 0 ? _g : -1] : []
            });
            obEvents.push({ t: ev.t, dur: ev.dur, midi: obMidi });
            addNote(shells[1], ev.t, ev.dur, (0, instrumentCatalog_1.midiToPitch)(obMidi), 1, "OB", ++seq);
            prevOb = obMidi;
        };
        for (var _r = 0, melody_5 = melody; _r < melody_5.length; _r++) {
            var ev = melody_5[_r];
            _loop_8(ev);
        }
        var useAlberti = shouldChooseMeasure(mNum, 0.6, 77);
        var stepDur = useAlberti ? 0.5 : 1;
        var clEvents = [];
        for (var t = 0; t < measureLen - 1e-6; t += stepDur) {
            var dur = Math.min(stepDur, measureLen - t);
            var h = harmonyAt(t);
            var seqPcs = pickChordToneSequence(h, 4);
            var idx = useAlberti ? Math.round(t * 2) % Math.max(1, seqPcs.length) : Math.round(t) % Math.max(1, seqPcs.length);
            var targetPc = seqPcs.length ? seqPcs[idx] : ((_h = h.rootPc) !== null && _h !== void 0 ? _h : 0);
            var bassFloor = maxMidiDuring(bnEvents, t, dur);
            var oboeCeiling = minMidiDuring(obEvents, t, dur);
            var fluteNow = activeMidiAt(melody, t);
            var lower = typeof bassFloor === "number" ? bassFloor + 1 : undefined;
            var upper = typeof oboeCeiling === "number" ? oboeCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 9 : undefined;
            var pool = candidateMidisForPcs([targetPc], rCL.midi_low, rCL.midi_high, { lower: lower, upper: upper });
            if (!pool.length) {
                pool = candidateMidisForPcs(seqPcs.length ? seqPcs : h.pcs, rCL.midi_low, rCL.midi_high, { lower: lower, upper: upper });
            }
            if (!pool.length)
                continue;
            var clMidi = pickCandidateNear(prevCl, __spreadArray([targetPc], (seqPcs.length ? seqPcs : h.pcs), true), rCL.midi_low, rCL.midi_high, oppositeDirection(melodyDirAt(t)), {
                lower: lower,
                upper: upper,
                center: typeof oboeCeiling === "number" && typeof bassFloor === "number" ? (oboeCeiling + bassFloor) / 2 : 60
            });
            clEvents.push({ t: t, dur: dur, midi: clMidi });
            addNote(shells[2], t, dur, (0, instrumentCatalog_1.midiToPitch)(clMidi), 1, "CL", ++seq);
            prevCl = clMidi;
        }
    };
    for (var mi = 0; mi < ((_c = srcPart.measures) !== null && _c !== void 0 ? _c : []).length; mi++) {
        _loop_7(mi);
    }
    warn(options.warnings, "[woodwinds] Beginner polyphonic (60%): Flute melody up an octave, Oboe melody-rhythm contrary harmony, Clarinet 60% Alberti 8ths / 40% quarter arpeggio, Bassoon melody-rhythm bass, strict no crossing.");
    if (!chords.length) {
        warn(options.warnings, "[woodwinds] Beginner polyphonic used source harmony fallback because no chord symbols were found.");
    }
    return {
        score_id: "ARR_".concat(Math.random().toString(16).slice(2, 10)),
        meta: __assign(__assign({}, ((_j = score.meta) !== null && _j !== void 0 ? _j : {})), { ensemble: "woodwind_ensemble" }),
        global: __assign({}, score.global),
        parts: outParts
    };
}
function mapBeginnerHomophonic(score, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    var srcPart = findSourcePart(score);
    if (!srcPart)
        return score;
    var level = String((_a = options.level) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var isIntermediate = level === "intermediate";
    var isAdvanced = level === "advanced";
    var isUpperHomophonic = isIntermediate || isAdvanced;
    var fl = makePart("FL", "Flute", "flute", 1);
    var ob = makePart("OB", "Oboe", "oboe", 1);
    var cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
    var bn = makePart("BN", "Bassoon", "bassoon", 1);
    var outParts = [fl, ob, cl, bn];
    var measureMap = {};
    var _loop_9 = function (m) {
        var shells = outParts.map(function () { return cloneMeasureShell(m); });
        measureMap[String(m.number)] = shells;
        fl.measures.push(shells[0]);
        ob.measures.push(shells[1]);
        cl.measures.push(shells[2]);
        bn.measures.push(shells[3]);
    };
    for (var _i = 0, _z = (_b = srcPart.measures) !== null && _b !== void 0 ? _b : []; _i < _z.length; _i++) {
        var m = _z[_i];
        _loop_9(m);
    }
    var chords = normalizeChords(score, options);
    var chordsByMeasure = new Map();
    for (var _0 = 0, chords_3 = chords; _0 < chords_3.length; _0++) {
        var ch = chords_3[_0];
        var list = (_c = chordsByMeasure.get(ch.measure)) !== null && _c !== void 0 ? _c : [];
        list.push(ch);
        chordsByMeasure.set(ch.measure, list);
    }
    for (var _1 = 0, _2 = chordsByMeasure.values(); _1 < _2.length; _1++) {
        var list = _2[_1];
        list.sort(function (a, b) { return a.t - b.t; });
    }
    // Homophonic ranges by level (strict no-crossing order):
    // Beginner:
    //   Flute C4-G5, Oboe D4-Eb6, Clarinet E3-C6, Bassoon F1-G3.
    // Intermediate:
    //   Flute C4-G6, Oboe C4-Eb6, Clarinet E3-G6, Bassoon Bb1-G4.
    // Advanced:
    //   Flute B3-D7, Oboe Bb3-A6, Clarinet E3-C7, Bassoon B1-E5.
    var rFL = isAdvanced
        ? { midi_low: 59, midi_high: 98, preferred_low: 67, preferred_high: 89 }
        : isIntermediate
            ? { midi_low: 60, midi_high: 91, preferred_low: 67, preferred_high: 84 }
            : { midi_low: 60, midi_high: 79, preferred_low: 67, preferred_high: 77 };
    var rOB = isAdvanced
        ? { midi_low: 58, midi_high: 93, preferred_low: 64, preferred_high: 86 }
        : isIntermediate
            ? { midi_low: 60, midi_high: 87, preferred_low: 65, preferred_high: 82 }
            : { midi_low: 62, midi_high: 87, preferred_low: 67, preferred_high: 82 };
    var rCL = isAdvanced
        ? { midi_low: 52, midi_high: 96, preferred_low: 60, preferred_high: 88 }
        : isIntermediate
            ? { midi_low: 52, midi_high: 91, preferred_low: 60, preferred_high: 84 }
            : { midi_low: 52, midi_high: 84, preferred_low: 60, preferred_high: 79 };
    var rBN = isAdvanced
        ? { midi_low: 35, midi_high: 76, preferred_low: 40, preferred_high: 60 }
        : isIntermediate
            ? { midi_low: 34, midi_high: 67, preferred_low: 38, preferred_high: 55 }
            : { midi_low: 29, midi_high: 55, preferred_low: 34, preferred_high: 50 };
    var seq = 0;
    var prevOb = null;
    var prevCl = null;
    var prevBn = null;
    var activeChord = null;
    var _loop_10 = function (mi) {
        var srcMeasure = srcPart.measures[mi];
        var mNum = Number((_e = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.number) !== null && _e !== void 0 ? _e : mi + 1);
        var shells = measureMap[String(mNum)];
        if (!shells)
            return "continue";
        var melody = collectRhTopNotes(srcMeasure);
        var onsetPcs = collectOnsetPcs(srcMeasure);
        var chordsHere = (_f = chordsByMeasure.get(mNum)) !== null && _f !== void 0 ? _f : [];
        var mBeats = measureBeats(srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.attributes);
        var bassPlan = [];
        if (chordsHere.length) {
            for (var ci = 0; ci < chordsHere.length; ci++) {
                var ch = chordsHere[ci];
                var nextT = ci + 1 < chordsHere.length ? chordsHere[ci + 1].t : mBeats;
                var dur = Math.max(0.25, nextT - ch.t);
                var bassPc = parseBassPc(ch.symbol);
                if (bassPc === null)
                    continue;
                var bnMidi = (_g = chooseMidiForPc(bassPc, { min: rBN.midi_low, max: rBN.midi_high }, {
                    center: 41,
                    prev: prevBn
                })) !== null && _g !== void 0 ? _g : shiftOctavesToward(41, rBN.midi_low, rBN.midi_high, 41);
                bassPlan.push({ t: ch.t, dur: dur, midi: bnMidi });
                addNote(shells[3], ch.t, dur, (0, instrumentCatalog_1.midiToPitch)(bnMidi), 1, "BN", ++seq);
                prevBn = bnMidi;
            }
        }
        else {
            var lh = ((_h = srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.events) !== null && _h !== void 0 ? _h : [])
                .filter(function (ev) { return (ev === null || ev === void 0 ? void 0 : ev.type) === "note" && (ev === null || ev === void 0 ? void 0 : ev.pitch); })
                .map(function (ev) { return ({ ev: ev, midi: (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) }); })
                .filter(function (x) { var _a, _b; return Number.isFinite(x.midi) && Number((_b = (_a = x.ev) === null || _a === void 0 ? void 0 : _a.staff) !== null && _b !== void 0 ? _b : 2) === 2; });
            var byT = new Map();
            for (var _3 = 0, lh_1 = lh; _3 < lh_1.length; _3++) {
                var n = lh_1[_3];
                var t = Number((_k = (_j = n.ev) === null || _j === void 0 ? void 0 : _j.t) !== null && _k !== void 0 ? _k : 0);
                var list = (_l = byT.get(t)) !== null && _l !== void 0 ? _l : [];
                list.push(n.midi);
                byT.set(t, list);
            }
            var times = Array.from(byT.keys()).sort(function (a, b) { return a - b; });
            for (var ti = 0; ti < times.length; ti++) {
                var t = times[ti];
                var nextT = ti + 1 < times.length ? times[ti + 1] : mBeats;
                var dur = Math.max(0.25, nextT - t);
                var low = Math.min.apply(Math, ((_m = byT.get(t)) !== null && _m !== void 0 ? _m : [41]));
                var bnMidi = shiftOctavesToward(low, rBN.midi_low, rBN.midi_high, 41);
                bassPlan.push({ t: t, dur: dur, midi: bnMidi });
                addNote(shells[3], t, dur, (0, instrumentCatalog_1.midiToPitch)(bnMidi), 1, "BN", ++seq);
                prevBn = bnMidi;
            }
        }
        var bassAt = function (t) {
            var _a;
            var active = null;
            for (var _i = 0, bassPlan_1 = bassPlan; _i < bassPlan_1.length; _i++) {
                var b = bassPlan_1[_i];
                if (b.t - 1e-9 <= t && t < b.t + b.dur - 1e-9) {
                    if (!active || b.t > active.t)
                        active = { t: b.t, midi: b.midi };
                }
            }
            return (_a = active === null || active === void 0 ? void 0 : active.midi) !== null && _a !== void 0 ? _a : null;
        };
        var chordIdx = 0;
        var _loop_11 = function (mEv) {
            while (chordIdx < chordsHere.length && chordsHere[chordIdx].t <= mEv.t + 1e-9) {
                activeChord = chordsHere[chordIdx];
                chordIdx += 1;
            }
            var fluteSourceMidi = isUpperHomophonic ? mEv.midi + 12 : mEv.midi;
            var flMidi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(fluteSourceMidi, rFL.midi_low, rFL.midi_high);
            addNote(shells[0], mEv.t, mEv.dur, (0, instrumentCatalog_1.midiToPitch)(flMidi), 1, "FL", ++seq);
            var melodyPc = ((flMidi % 12) + 12) % 12;
            var parsed = activeChord ? (0, chordSymbol_1.parseChordSymbol)(activeChord.symbol) : null;
            var bassPc = activeChord ? ((_p = (_o = parseBassPc(activeChord.symbol)) !== null && _o !== void 0 ? _o : parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _p !== void 0 ? _p : melodyPc) : melodyPc;
            var fallbackPcs = (_q = onsetPcs.get(mEv.t)) !== null && _q !== void 0 ? _q : [melodyPc];
            var pcs = uniquePcs(((_r = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) === null || _r === void 0 ? void 0 : _r.length) ? parsed.pcs : fallbackPcs);
            var rootPc = (_t = (_s = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _s !== void 0 ? _s : pcs[0]) !== null && _t !== void 0 ? _t : melodyPc;
            var majThird = (rootPc + 4) % 12;
            var minThird = (rootPc + 3) % 12;
            var thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
            var fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;
            var preferred = uniquePcs(__spreadArray([
                thirdPc !== null && thirdPc !== void 0 ? thirdPc : undefined,
                fifthPc !== null && fifthPc !== void 0 ? fifthPc : undefined,
                rootPc
            ], pcs.filter(function (pc) { return pc !== melodyPc && pc !== bassPc; }), true).filter(function (x) { return typeof x === "number"; }));
            var harmonyPcs = preferred.length ? preferred : uniquePcs([rootPc, bassPc]);
            var bassMidi = bassAt(mEv.t);
            var obMidi = null;
            var clMidi = null;
            if (isUpperHomophonic) {
                var requiredPcs = uniquePcs([rootPc, thirdPc !== null && thirdPc !== void 0 ? thirdPc : undefined, fifthPc !== null && fifthPc !== void 0 ? fifthPc : undefined].filter(function (x) { return typeof x === "number"; }));
                var chordCore = requiredPcs.length ? requiredPcs : harmonyPcs;
                var coveredBefore_1 = new Set();
                for (var _5 = 0, _6 = [melodyPc, bassPc]; _5 < _6.length; _5++) {
                    var pc = _6[_5];
                    if (chordCore.includes(pc))
                        coveredBefore_1.add(pc);
                }
                var missingBefore = chordCore.filter(function (pc) { return !coveredBefore_1.has(pc); });
                var obPriority = uniquePcs(__spreadArray(__spreadArray([], missingBefore, true), harmonyPcs, true));
                var obChosenPc_1 = null;
                for (var _7 = 0, obPriority_1 = obPriority; _7 < obPriority_1.length; _7++) {
                    var pc = obPriority_1[_7];
                    var pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
                        center: Math.min(flMidi - 4, (_u = rOB.preferred_high) !== null && _u !== void 0 ? _u : rOB.midi_high),
                        prev: prevOb,
                        upper: flMidi - 1,
                        lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
                    });
                    if (pick !== null) {
                        obMidi = pick;
                        obChosenPc_1 = pc;
                        break;
                    }
                }
                if (obMidi === null) {
                    obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);
                    obChosenPc_1 = ((obMidi % 12) + 12) % 12;
                }
                var coveredAfterOb_1 = new Set(coveredBefore_1);
                if (obChosenPc_1 !== null && chordCore.includes(obChosenPc_1))
                    coveredAfterOb_1.add(obChosenPc_1);
                var missingAfterOb = chordCore.filter(function (pc) { return !coveredAfterOb_1.has(pc); });
                var chordComplete = missingAfterOb.length === 0;
                var clPriority = chordComplete
                    ? uniquePcs(__spreadArray([obChosenPc_1 !== null && obChosenPc_1 !== void 0 ? obChosenPc_1 : undefined], harmonyPcs, true).filter(function (x) { return typeof x === "number"; }))
                    : uniquePcs(__spreadArray(__spreadArray(__spreadArray([], missingAfterOb, true), harmonyPcs.filter(function (pc) { return pc !== obChosenPc_1; }), true), harmonyPcs.filter(function (pc) { return pc === obChosenPc_1; }), true));
                for (var _8 = 0, clPriority_1 = clPriority; _8 < clPriority_1.length; _8++) {
                    var pc = clPriority_1[_8];
                    var pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
                        center: Math.min((obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 5, (_v = rCL.preferred_high) !== null && _v !== void 0 ? _v : rCL.midi_high),
                        prev: prevCl,
                        upper: (obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 1,
                        lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
                    });
                    if (pick !== null) {
                        clMidi = pick;
                        break;
                    }
                }
                if (clMidi === null)
                    clMidi = shiftOctavesToward((obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
            }
            else {
                for (var _9 = 0, harmonyPcs_1 = harmonyPcs; _9 < harmonyPcs_1.length; _9++) {
                    var pc = harmonyPcs_1[_9];
                    var pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
                        center: Math.min(flMidi - 4, (_w = rOB.preferred_high) !== null && _w !== void 0 ? _w : rOB.midi_high),
                        prev: prevOb,
                        upper: flMidi - 1,
                        lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
                    });
                    if (pick !== null) {
                        obMidi = pick;
                        break;
                    }
                }
                if (obMidi === null)
                    obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);
                for (var _10 = 0, harmonyPcs_2 = harmonyPcs; _10 < harmonyPcs_2.length; _10++) {
                    var pc = harmonyPcs_2[_10];
                    var pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
                        center: Math.min((obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 5, (_x = rCL.preferred_high) !== null && _x !== void 0 ? _x : rCL.midi_high),
                        prev: prevCl,
                        upper: (obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 1,
                        lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
                    });
                    if (pick !== null) {
                        clMidi = pick;
                        break;
                    }
                }
                if (clMidi === null)
                    clMidi = shiftOctavesToward((obMidi !== null && obMidi !== void 0 ? obMidi : flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
            }
            if (obMidi >= flMidi)
                obMidi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(flMidi - 1, rOB.midi_low, rOB.midi_high);
            if (clMidi >= obMidi)
                clMidi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(obMidi - 1, rCL.midi_low, rCL.midi_high);
            if (typeof bassMidi === "number" && clMidi <= bassMidi) {
                var lifted = (0, instrumentCatalog_1.shiftOctavesIntoRange)(bassMidi + 1, rCL.midi_low, rCL.midi_high);
                clMidi = lifted < obMidi ? lifted : clMidi;
            }
            if (clMidi >= obMidi) {
                var raisedOb = (0, instrumentCatalog_1.shiftOctavesIntoRange)(clMidi + 1, rOB.midi_low, rOB.midi_high);
                if (raisedOb < flMidi)
                    obMidi = raisedOb;
            }
            if (clMidi >= obMidi)
                clMidi = Math.max(rCL.midi_low, Math.min(rCL.midi_high, obMidi - 1));
            addNote(shells[1], mEv.t, mEv.dur, (0, instrumentCatalog_1.midiToPitch)(obMidi), 1, "OB", ++seq);
            addNote(shells[2], mEv.t, mEv.dur, (0, instrumentCatalog_1.midiToPitch)(clMidi), 1, "CL", ++seq);
            prevOb = obMidi;
            prevCl = clMidi;
        };
        for (var _4 = 0, melody_6 = melody; _4 < melody_6.length; _4++) {
            var mEv = melody_6[_4];
            _loop_11(mEv);
        }
    };
    for (var mi = 0; mi < ((_d = srcPart.measures) !== null && _d !== void 0 ? _d : []).length; mi++) {
        _loop_10(mi);
    }
    if (!chords.length) {
        warn(options.warnings, "[woodwinds] ".concat(isAdvanced ? "Advanced" : isIntermediate ? "Intermediate" : "Beginner", " homophonic: no chord hints found, bassoon used source bass notes."));
    }
    else {
        warn(options.warnings, isAdvanced
            ? "[woodwinds] Advanced homophonic applied (Flute melody +8ve, strict advanced ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
            : isIntermediate
                ? "[woodwinds] Intermediate homophonic applied (Flute melody +8ve, strict intermediate ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
                : "[woodwinds] Beginner homophonic applied (Flute original melody pitch, strict beginner ranges, no crossing, Bassoon chord bass, Oboe/Clarinet harmony).");
    }
    return {
        score_id: "ARR_".concat(Math.random().toString(16).slice(2, 10)),
        meta: __assign(__assign({}, ((_y = score.meta) !== null && _y !== void 0 ? _y : {})), { ensemble: "woodwind_ensemble" }),
        global: __assign({}, score.global),
        parts: outParts
    };
}
function mapLegacyOpen(score) {
    var fl = makePart("FL", "Flute", "flute", 1);
    var ob = makePart("OB", "Oboe", "oboe", 1);
    var cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
    var bn = makePart("BN", "Bassoon", "bassoon", 1);
    var partsOut = [fl, ob, cl, bn];
    var srcPart = score.parts[0];
    if (!srcPart)
        return score;
    var measureMap = {};
    var _loop_12 = function (m) {
        var shells = partsOut.map(function () { return cloneMeasureShell(m); });
        measureMap[String(m.number)] = shells;
        fl.measures.push(shells[0]);
        ob.measures.push(shells[1]);
        cl.measures.push(shells[2]);
        bn.measures.push(shells[3]);
    };
    for (var _i = 0, _a = srcPart.measures; _i < _a.length; _i++) {
        var m = _a[_i];
        _loop_12(m);
    }
    var chords = (0, chordExtractor_1.extractOnsetChords)(score);
    var rFL = instrumentCatalog_1.InstrumentCatalog.flute;
    var rOB = instrumentCatalog_1.InstrumentCatalog.oboe;
    var rCL = instrumentCatalog_1.InstrumentCatalog.clarinet_bb;
    var rBN = instrumentCatalog_1.InstrumentCatalog.bassoon;
    var CENTER_FL = 79;
    var CENTER_OB = 74;
    var CENTER_CL = 69;
    var CENTER_BN = 46;
    var seq = 0;
    var _loop_13 = function (ch) {
        var shells = measureMap[String(ch.measure)];
        if (!shells)
            return "continue";
        var notes = ch.notes.slice().sort(function (a, b) { return a.midi - b.midi; });
        if (notes.length === 0)
            return "continue";
        var t = ch.t;
        var dur = Math.max.apply(Math, __spreadArray(__spreadArray([], notes.map(function (n) { var _a; return (_a = n.dur) !== null && _a !== void 0 ? _a : 1; }), false), [1], false));
        var pick = function (idx) { return notes[Math.min(Math.max(idx, 0), notes.length - 1)].midi; };
        var low = pick(0);
        var mid1 = pick(Math.floor((notes.length - 1) * 0.33));
        var mid2 = pick(Math.floor((notes.length - 1) * 0.66));
        var high = pick(notes.length - 1);
        var mBN = low;
        var mCL = mid1;
        var mOB = mid2;
        var mFL = high;
        mBN = shiftOctavesToward(mBN, rBN.midi_low, rBN.midi_high, CENTER_BN);
        mCL = shiftOctavesToward(mCL, rCL.midi_low, rCL.midi_high, CENTER_CL);
        mOB = shiftOctavesToward(mOB, rOB.midi_low, rOB.midi_high, CENTER_OB);
        mFL = shiftOctavesToward(mFL, rFL.midi_low, rFL.midi_high, CENTER_FL);
        if (mCL < mBN)
            mCL = shiftOctavesToward(mCL + 12, rCL.midi_low, rCL.midi_high, CENTER_CL);
        if (mOB < mCL)
            mOB = shiftOctavesToward(mOB + 12, rOB.midi_low, rOB.midi_high, CENTER_OB);
        if (mFL < mOB)
            mFL = shiftOctavesToward(mFL + 12, rFL.midi_low, rFL.midi_high, CENTER_FL);
        addNote(shells[0], t, dur, (0, instrumentCatalog_1.midiToPitch)(mFL), 1, "FL", ++seq);
        addNote(shells[1], t, dur, (0, instrumentCatalog_1.midiToPitch)(mOB), 1, "OB", ++seq);
        addNote(shells[2], t, dur, (0, instrumentCatalog_1.midiToPitch)(mCL), 1, "CL", ++seq);
        addNote(shells[3], t, dur, (0, instrumentCatalog_1.midiToPitch)(mBN), 1, "BN", ++seq);
    };
    for (var _b = 0, chords_4 = chords; _b < chords_4.length; _b++) {
        var ch = chords_4[_b];
        _loop_13(ch);
    }
    return {
        score_id: "ARR_".concat(Math.random().toString(16).slice(2, 10)),
        meta: { ensemble: "woodwind_ensemble" },
        global: __assign({}, score.global),
        parts: partsOut
    };
}
/**
 * Woodwind ensemble mapping (concert pitch view):
 * Flute (C), Oboe (C), Clarinet in Bb (shows concert pitch), Bassoon (C)
 */
function mapPianoToWoodwindEnsembleOpen(score, options) {
    if (options === void 0) { options = {}; }
    if (polyphonicProfile(options) === "beginner_less_active") {
        return mapBeginnerPolyphonicLessActive(score, options);
    }
    if (polyphonicProfile(options) === "beginner_active") {
        return mapBeginnerPolyphonicActive(score, options);
    }
    if (homophonicLevel(options)) {
        return mapBeginnerHomophonic(score, options);
    }
    return mapLegacyOpen(score);
}
