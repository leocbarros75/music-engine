"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.inferChordsFromMelody = inferChordsFromMelody;
// Pitch class helpers
function pc(midi) {
    return ((midi % 12) + 12) % 12;
}
// Convert MusicXML key signature (fifths) to tonic pitch class for MAJOR keys.
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
function majorScalePcs(tonicPc) {
    var rel = [0, 2, 4, 5, 7, 9, 11];
    return rel.map(function (x) { return (tonicPc + x) % 12; });
}
function pcName(p) {
    var names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
    return names[((p % 12) + 12) % 12];
}
// Build diatonic triads in major
function buildDiatonicTriadsMajor(tonicPc) {
    var scale = majorScalePcs(tonicPc);
    var root = function (deg) { return scale[deg - 1]; };
    var third = function (deg) { return scale[(deg - 1 + 2) % 7]; };
    var fifth = function (deg) { return scale[(deg - 1 + 4) % 7]; };
    var triadPcs = function (deg) { return [root(deg), third(deg), fifth(deg)]; };
    var sym = function (deg) {
        if (deg === 1)
            return pcName(tonicPc);
        if (deg === 2)
            return pcName(root(deg)) + "m";
        if (deg === 3)
            return pcName(root(deg)) + "m";
        if (deg === 4)
            return pcName(root(deg));
        if (deg === 5)
            return pcName(root(deg));
        if (deg === 6)
            return pcName(root(deg)) + "m";
        return pcName(root(deg)) + "dim";
    };
    var out = [];
    for (var d = 1; d <= 7; d = (d + 1)) {
        out.push({
            degree: d,
            rootPc: root(d),
            pcs: triadPcs(d).map(function (x) { return x % 12; }),
            symbol: sym(d)
        });
    }
    return out;
}
function getKeyFifths(score) {
    var _a, _b, _c, _d;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var fifths = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.key_fifths;
    if (typeof fifths === "number" && Number.isFinite(fifths))
        return fifths;
    return 0;
}
function averageMidiForPart(part) {
    var _a, _b;
    var vals = [];
    for (var _i = 0, _c = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : []; _i < _c.length; _i++) {
        var m = _c[_i];
        for (var _d = 0, _e = (_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []; _d < _e.length; _d++) {
            var e = _e[_d];
            if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                continue;
            if (typeof (e === null || e === void 0 ? void 0 : e.midi) === "number")
                vals.push(e.midi);
        }
    }
    if (!vals.length)
        return null;
    var sum = vals.reduce(function (a, b) { return a + b; }, 0);
    return sum / vals.length;
}
function detectMelodyVoice(part) {
    var _a, _b, _c, _d, _e;
    var counts = new Map();
    for (var _i = 0, _f = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : []; _i < _f.length; _i++) {
        var m = _f[_i];
        for (var _g = 0, _h = (_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []; _g < _h.length; _g++) {
            var e = _h[_g];
            if (!e || (e.type !== "note" && e.type !== "rest"))
                continue;
            var v = Number(e.voice);
            if (!Number.isFinite(v))
                continue;
            counts.set(v, ((_c = counts.get(v)) !== null && _c !== void 0 ? _c : 0) + 1);
        }
    }
    var voices = Array.from(counts.keys());
    if (voices.length <= 1)
        return null;
    if (counts.has(1))
        return 1;
    var best = voices[0];
    var bestCount = (_d = counts.get(best)) !== null && _d !== void 0 ? _d : 0;
    for (var _j = 0, voices_1 = voices; _j < voices_1.length; _j++) {
        var v = voices_1[_j];
        var c = (_e = counts.get(v)) !== null && _e !== void 0 ? _e : 0;
        if (c > bestCount) {
            best = v;
            bestCount = c;
        }
    }
    return best;
}
function getMelodyPart(score) {
    var _a, _b, _c;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    if (!parts.length)
        return null;
    if (parts.length === 1)
        return { part: parts[0], voice: detectMelodyVoice(parts[0]) };
    var preferByName = ["melody", "soprano", "voice"];
    for (var _i = 0, preferByName_1 = preferByName; _i < preferByName_1.length; _i++) {
        var needle = preferByName_1[_i];
        for (var _d = 0, parts_1 = parts; _d < parts_1.length; _d++) {
            var p = parts_1[_d];
            var name_1 = String((_b = p === null || p === void 0 ? void 0 : p.name) !== null && _b !== void 0 ? _b : "").toLowerCase();
            if (name_1.includes(needle))
                return { part: p, voice: detectMelodyVoice(p) };
        }
    }
    var best = (_c = parts[0]) !== null && _c !== void 0 ? _c : null;
    var bestAvg = -Infinity;
    for (var _e = 0, parts_2 = parts; _e < parts_2.length; _e++) {
        var p = parts_2[_e];
        var avg = averageMidiForPart(p);
        if (avg !== null && avg > bestAvg) {
            best = p;
            bestAvg = avg;
        }
    }
    if (!best)
        return null;
    return { part: best, voice: detectMelodyVoice(best) };
}
function firstMelodyMidiInMeasure(measure, melodyVoice) {
    var _a;
    var notes = ((_a = measure === null || measure === void 0 ? void 0 : measure.events) !== null && _a !== void 0 ? _a : [])
        .filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && typeof (e === null || e === void 0 ? void 0 : e.midi) === "number"; })
        .filter(function (e) { return (melodyVoice === null || melodyVoice === undefined ? true : (e === null || e === void 0 ? void 0 : e.voice) === melodyVoice); });
    if (!notes.length)
        return null;
    notes.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    return Number(notes[0].midi);
}
function progressionPenalty(prevDeg, nextDeg) {
    if (prevDeg === null)
        return 0;
    var goodPairs = new Set([
        "1->4",
        "1->5",
        "1->6",
        "6->2",
        "2->5",
        "4->5",
        "5->1",
        "5->6",
        "4->1"
    ]);
    if (prevDeg === nextDeg)
        return 2;
    if (goodPairs.has("".concat(prevDeg, "->").concat(nextDeg)))
        return 0;
    return 4;
}
function inferChordsFromMelody(inScore) {
    var _a, _b, _c, _d, _e, _f;
    var melodyInfo = getMelodyPart(inScore);
    var melodyPart = melodyInfo === null || melodyInfo === void 0 ? void 0 : melodyInfo.part;
    var melodyVoice = (_a = melodyInfo === null || melodyInfo === void 0 ? void 0 : melodyInfo.voice) !== null && _a !== void 0 ? _a : null;
    var measures = (_b = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _b !== void 0 ? _b : [];
    if (!measures.length)
        return [];
    var fifths = getKeyFifths(inScore);
    var tonic = tonicPcFromFifthsMajor(fifths);
    var triads = buildDiatonicTriadsMajor(tonic);
    var lastMeasureNumber = Number((_d = (_c = measures[measures.length - 1]) === null || _c === void 0 ? void 0 : _c.number) !== null && _d !== void 0 ? _d : measures.length);
    var out = [];
    var prevDeg = null;
    var _loop_1 = function (i) {
        var m = measures[i];
        var measureNumber = Number((_e = m === null || m === void 0 ? void 0 : m.number) !== null && _e !== void 0 ? _e : (i + 1));
        var isLast = measureNumber === lastMeasureNumber;
        var isPenult = measureNumber === lastMeasureNumber - 1;
        if (isLast) {
            out.push({ measure: measureNumber, t: 0, symbol: triads[0].symbol }); // I
            prevDeg = 1;
            return "continue";
        }
        if (isPenult) {
            var V = triads.find(function (t) { return t.degree === 5; });
            out.push({ measure: measureNumber, t: 0, symbol: V.symbol + "7" });
            prevDeg = 5;
            return "continue";
        }
        var midi = firstMelodyMidiInMeasure(m, melodyVoice);
        var melPc = midi === null ? null : pc(midi);
        var candidates = triads
            .filter(function (t) { return (melPc === null ? true : t.pcs.includes(melPc)); })
            .sort(function (a, b) {
            var pref = function (deg) {
                if (deg === 1)
                    return 0;
                if (deg === 5)
                    return 1;
                if (deg === 4)
                    return 2;
                if (deg === 6)
                    return 3;
                if (deg === 2)
                    return 4;
                if (deg === 3)
                    return 6;
                return 9;
            };
            return pref(a.degree) - pref(b.degree);
        });
        var best = (_f = candidates[0]) !== null && _f !== void 0 ? _f : triads[0];
        var bestScore = Number.POSITIVE_INFINITY;
        for (var _i = 0, _g = candidates.length ? candidates : triads; _i < _g.length; _i++) {
            var c = _g[_i];
            var score = progressionPenalty(prevDeg, c.degree) + (c.degree === 7 ? 3 : 0);
            if (score < bestScore) {
                bestScore = score;
                best = c;
            }
        }
        out.push({ measure: measureNumber, t: 0, symbol: best.symbol });
        prevDeg = best.degree;
    };
    for (var i = 0; i < measures.length; i++) {
        _loop_1(i);
    }
    return out;
}
