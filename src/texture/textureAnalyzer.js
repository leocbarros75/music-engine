"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeTexture = analyzeTexture;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
var motionAnalyzer_1 = require("./motionAnalyzer");
var densityCalculator_1 = require("./densityCalculator");
function getBeatsPerMeasure(score) {
    var _a, _b, _c, _d, _e;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var beats = (_e = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beats;
    if (typeof beats === "number" && beats > 0)
        return beats;
    return 4;
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
function collectPartNotes(part, beatsPerMeasure) {
    var _a;
    var notes = [];
    var measures = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : [];
    for (var mi = 0; mi < measures.length; mi++) {
        var m = measures[mi];
        var events = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
        for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
            var ev = events_1[_i];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = eventMidi(ev);
            if (midi === null)
                continue;
            var t = Number(ev === null || ev === void 0 ? void 0 : ev.t);
            var dur = Number(ev === null || ev === void 0 ? void 0 : ev.dur);
            var time = (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure + (Number.isFinite(t) ? t : 0);
            notes.push({ time: time, midi: midi, dur: Number.isFinite(dur) ? dur : 0 });
        }
    }
    notes.sort(function (a, b) { return a.time - b.time; });
    return notes;
}
function rhythmSignature(notes) {
    return notes.map(function (n) { return "".concat(n.time.toFixed(2), ":").concat(n.dur.toFixed(2)); });
}
function pitchSignature(notes) {
    return notes.map(function (n) { return n.midi; });
}
function similarityRatio(a, b) {
    var n = Math.min(a.length, b.length);
    if (n === 0)
        return 0;
    var matches = 0;
    for (var i = 0; i < n; i++) {
        if (a[i] === b[i])
            matches++;
    }
    return matches / n;
}
function isDrone(notes) {
    var _a;
    if (!notes.length)
        return false;
    var totalDur = notes.reduce(function (sum, n) { return sum + (n.dur || 0); }, 0);
    if (totalDur <= 0)
        return false;
    var byPitch = new Map();
    for (var _i = 0, notes_1 = notes; _i < notes_1.length; _i++) {
        var n = notes_1[_i];
        byPitch.set(n.midi, ((_a = byPitch.get(n.midi)) !== null && _a !== void 0 ? _a : 0) + (n.dur || 0));
    }
    var maxDur = Math.max.apply(Math, Array.from(byPitch.values()));
    var ratio = maxDur / totalDur;
    return ratio >= 0.7 && byPitch.size <= 2;
}
function spacingQuality(score) {
    var _a, _b, _c, _d, _e;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    if (parts.length < 2)
        return "balanced";
    var beats = getBeatsPerMeasure(score);
    var measures = (_d = (_c = (_b = parts[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
    var gaps = [];
    for (var mi = 0; mi < measures; mi++) {
        var _loop_1 = function (t) {
            var midis = [];
            for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
                var part = parts_1[_i];
                var m = (_e = part.measures) === null || _e === void 0 ? void 0 : _e[mi];
                if (!m)
                    continue;
                var evs = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
                var hit = evs.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e === null || e === void 0 ? void 0 : e.t) === t; });
                var midi = hit ? eventMidi(hit) : null;
                if (typeof midi === "number")
                    midis.push(midi);
            }
            if (midis.length < 2)
                return "continue";
            midis.sort(function (a, b) { return a - b; });
            for (var i = 1; i < midis.length; i++) {
                gaps.push(midis[i] - midis[i - 1]);
            }
        };
        for (var t = 0; t < beats; t++) {
            _loop_1(t);
        }
    }
    if (!gaps.length)
        return "balanced";
    var avg = gaps.reduce(function (a, b) { return a + b; }, 0) / gaps.length;
    if (avg < 5)
        return "tight";
    if (avg > 9)
        return "open";
    return "balanced";
}
function analyzeTexture(score) {
    var _a, _b, _c;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var beats = getBeatsPerMeasure(score);
    var density = (0, densityCalculator_1.computeDensity)(score);
    var partNotes = parts.map(function (part) { return ({
        part: part,
        notes: collectPartNotes(part, beats)
    }); });
    var active = partNotes.filter(function (p) { return p.notes.length > 0; });
    var activeParts = active.length;
    var notesPerPart = partNotes.map(function (p) {
        var _a, _b, _c, _d;
        return ({
            partId: String((_b = (_a = p.part) === null || _a === void 0 ? void 0 : _a.part_id) !== null && _b !== void 0 ? _b : ""),
            name: String((_d = (_c = p.part) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : "Part"),
            noteCount: p.notes.length
        });
    });
    if (activeParts <= 1) {
        return {
            type: "monophony",
            density: density,
            motionSummary: null,
            partCount: parts.length,
            activeParts: activeParts,
            rhythmSimilarity: 1,
            pitchSimilarity: 1,
            spacingQuality: spacingQuality(score),
            notesPerPart: notesPerPart
        };
    }
    if (activeParts === 2 && (isDrone(active[0].notes) || isDrone(active[1].notes))) {
        return {
            type: "biphony",
            density: density,
            motionSummary: null,
            partCount: parts.length,
            activeParts: activeParts,
            rhythmSimilarity: 0.5,
            pitchSimilarity: 0.5,
            spacingQuality: spacingQuality(score),
            notesPerPart: notesPerPart
        };
    }
    var ref = active[0].notes;
    var refRhythm = rhythmSignature(ref);
    var refPitch = pitchSignature(ref);
    var rhythmSimilarity = 0;
    var pitchSimilarity = 0;
    var rhythmMatches = 0;
    for (var _i = 0, _d = active.slice(1); _i < _d.length; _i++) {
        var p = _d[_i];
        var r = rhythmSignature(p.notes);
        var pr = similarityRatio(refRhythm, r);
        rhythmSimilarity += pr;
        if (pr > 0.85)
            rhythmMatches++;
        var pp = similarityRatio(refPitch, pitchSignature(p.notes));
        pitchSimilarity += pp;
    }
    if (active.length > 1) {
        rhythmSimilarity /= active.length - 1;
        pitchSimilarity /= active.length - 1;
    }
    var allHomorhythmic = rhythmMatches === active.length - 1;
    if (allHomorhythmic) {
        return {
            type: "homophony_homorhythmic",
            density: density,
            motionSummary: null,
            partCount: parts.length,
            activeParts: activeParts,
            rhythmSimilarity: rhythmSimilarity,
            pitchSimilarity: pitchSimilarity,
            spacingQuality: spacingQuality(score),
            notesPerPart: notesPerPart
        };
    }
    var noteCounts = active.map(function (p) { return p.notes.length; }).sort(function (a, b) { return b - a; });
    var top = (_b = noteCounts[0]) !== null && _b !== void 0 ? _b : 0;
    var second = (_c = noteCounts[1]) !== null && _c !== void 0 ? _c : 0;
    if (top > second * 1.6 && rhythmSimilarity > 0.55) {
        return {
            type: "homophony_melody_accompaniment",
            density: density,
            motionSummary: null,
            partCount: parts.length,
            activeParts: activeParts,
            rhythmSimilarity: rhythmSimilarity,
            pitchSimilarity: pitchSimilarity,
            spacingQuality: spacingQuality(score),
            notesPerPart: notesPerPart
        };
    }
    if (pitchSimilarity > 0.7 && rhythmSimilarity < 0.6) {
        return {
            type: "heterophony",
            density: density,
            motionSummary: null,
            partCount: parts.length,
            activeParts: activeParts,
            rhythmSimilarity: rhythmSimilarity,
            pitchSimilarity: pitchSimilarity,
            spacingQuality: spacingQuality(score),
            notesPerPart: notesPerPart
        };
    }
    var highest = active.reduce(function (a, b) { return (a.notes.length >= b.notes.length ? a : b); });
    var lowest = active.reduce(function (a, b) { return (a.notes.length <= b.notes.length ? a : b); });
    var motionA = highest.notes.map(function (n) { return ({ time: n.time, midi: n.midi }); });
    var motionB = lowest.notes.map(function (n) { return ({ time: n.time, midi: n.midi }); });
    var motionSummary = (0, motionAnalyzer_1.analyzeMotion)(motionA, motionB);
    return {
        type: "polyphony",
        density: density,
        motionSummary: motionSummary,
        partCount: parts.length,
        activeParts: activeParts,
        rhythmSimilarity: rhythmSimilarity,
        pitchSimilarity: pitchSimilarity,
        spacingQuality: spacingQuality(score),
        notesPerPart: notesPerPart
    };
}
