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
exports.harmonizeSatbFromChords = harmonizeSatbFromChords;
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
var inferChordsFromMelody_1 = require("./inferChordsFromMelody");
var repairVoicing_1 = require("./repairVoicing");
var polyphonicRules_1 = require("../../voiceleading/polyphonicRules");
// Sounding ranges (MIDI)
var RANGES = {
    Soprano: { min: 60, max: 81 }, // C4..A5
    Alto: { min: 55, max: 74 }, // G3..D5
    Tenor: { min: 48, max: 69 }, // C3..A4 (dynamic max applied by soprano range)
    Bass: { min: 40, max: 64 } // E2..E4
};
function pc(midi) {
    return ((midi % 12) + 12) % 12;
}
function clampInt(x, lo, hi) {
    if (x < lo)
        return lo;
    if (x > hi)
        return hi;
    return x;
}
function motionDir(prev, next) {
    if (next > prev)
        return 1;
    if (next < prev)
        return -1;
    return 0;
}
var LEAP_COMPENSATE_SEMITONES = new Set([5, 7, 8, 9]); // P4, P5, m6, M6
function shouldCompensateLeap(prev, next) {
    return LEAP_COMPENSATE_SEMITONES.has(Math.abs(next - prev));
}
function isPerfectConsonance(intervalPc) {
    // P8 (0), P5 (7).
    return intervalPc === 0 || intervalPc === 7;
}
function isParallelPerfect(params) {
    var prevUpper = params.prevUpper, prevLower = params.prevLower, nextUpper = params.nextUpper, nextLower = params.nextLower;
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (!isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    if (du !== dl)
        return false;
    return true;
}
function isDirectPerfect(params) {
    var prevUpper = params.prevUpper, prevLower = params.prevLower, nextUpper = params.nextUpper, nextLower = params.nextLower;
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    if (du !== dl)
        return false;
    return true;
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
    var k = String(fifths);
    return (_a = map[k]) !== null && _a !== void 0 ? _a : 9;
}
function scalePcsFromKey(fifths, mode) {
    var tonicPc = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
    var intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return intervals.map(function (i) { return (tonicPc + i) % 12; });
}
function findContraryStepMidi(prev, curr, scalePcs, range) {
    var dir = motionDir(prev, curr);
    if (dir === 0)
        return null;
    var stepDir = dir === 1 ? -1 : 1;
    for (var delta = 1; delta <= 2; delta++) {
        var cand = curr + stepDir * delta;
        if (cand < range.min || cand > range.max)
            continue;
        if (scalePcs.includes(pc(cand)))
            return cand;
    }
    return null;
}
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
    if (raw === "minor")
        return "minor";
    return "major";
}
function parseRootTokenWithSpelling(tok) {
    var _a;
    var m = tok.match(/^([A-Ga-g])([#b]?)/);
    if (!m)
        return null;
    var step = m[1].toUpperCase();
    var acc = (_a = m[2]) !== null && _a !== void 0 ? _a : "";
    var base = STEP_TO_PC[step];
    if (typeof base !== "number")
        return null;
    var alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
    var pcVal = (base + alter + 12) % 12;
    return { pc: pcVal, spelling: { step: step, alter: alter } };
}
function chordPcsFromSymbol(symbol) {
    var _a, _b, _c;
    var s = symbol.trim();
    // Slash bass: "C/E"
    var main = s;
    var slashBass = null;
    if (s.includes("/")) {
        var parts = s.split("/");
        main = ((_a = parts[0]) !== null && _a !== void 0 ? _a : "").trim();
        slashBass = ((_b = parts[1]) !== null && _b !== void 0 ? _b : "").trim();
    }
    var m = main.match(/^([A-Ga-g][#b]?)(.*)$/);
    if (!m)
        return null;
    var rootTok = m[1];
    var qualTok = ((_c = m[2]) !== null && _c !== void 0 ? _c : "").trim().toLowerCase();
    var rootInfo = parseRootTokenWithSpelling(rootTok);
    if (!rootInfo)
        return null;
    var rootPc = rootInfo.pc;
    var rootSpelling = rootInfo.spelling;
    var isMinorTriad = qualTok === "m" ||
        qualTok === "min" ||
        qualTok.startsWith("m7") ||
        qualTok.startsWith("min7");
    var isMaj7 = qualTok === "maj7" || qualTok === "ma7";
    var isMin7 = qualTok === "m7" || qualTok === "min7";
    var isDom7 = qualTok === "7" || (qualTok.endsWith("7") && !isMaj7 && !isMin7);
    var third = isMinorTriad ? 3 : 4;
    var fifth = 7;
    var pcs = [rootPc, (rootPc + third) % 12, (rootPc + fifth) % 12];
    var hasSeventh = false;
    var seventhPc = null;
    if (isMaj7) {
        hasSeventh = true;
        seventhPc = (rootPc + 11) % 12;
        pcs.push(seventhPc);
    }
    else if (isDom7 || isMin7) {
        hasSeventh = true;
        seventhPc = (rootPc + 10) % 12;
        pcs.push(seventhPc);
    }
    var bassInfo = slashBass ? parseRootTokenWithSpelling(slashBass) : null;
    var bassPcPref = bassInfo ? bassInfo.pc : null;
    var bassSpelling = bassInfo ? bassInfo.spelling : null;
    return {
        rootPc: rootPc,
        pcs: Array.from(new Set(pcs)),
        bassPcPref: bassPcPref,
        rootSpelling: rootSpelling,
        bassSpelling: bassSpelling,
        hasSeventh: hasSeventh,
        seventhPc: seventhPc
    };
}
function midiCandidatesForPcInRange(pitchClass, range) {
    var out = [];
    for (var m = range.min; m <= range.max; m++) {
        if (pc(m) === pitchClass)
            out.push(m);
    }
    return out;
}
function bestByPenalty(cands, penalty) {
    if (!cands.length)
        return null;
    var best = cands[0];
    var bestP = penalty(best);
    for (var i = 1; i < cands.length; i++) {
        var m = cands[i];
        var p = penalty(m);
        if (p < bestP) {
            bestP = p;
            best = m;
        }
    }
    return best;
}
function rankVoiceCandidates(params) {
    var chordPcs = params.chordPcs, targetMidi = params.targetMidi, range = params.range, belowMidi = params.belowMidi, aboveMidi = params.aboveMidi, preferPc = params.preferPc, restrictToPreferPc = params.restrictToPreferPc, avoidPcs = params.avoidPcs, extraPenalty = params.extraPenalty;
    var pcs = chordPcs.slice();
    if (preferPc !== null && preferPc !== undefined) {
        if (restrictToPreferPc) {
            pcs = [preferPc];
        }
        else {
            pcs = __spreadArray([preferPc], pcs.filter(function (x) { return x !== preferPc; }), true);
        }
    }
    var avoidSet = new Set(avoidPcs !== null && avoidPcs !== void 0 ? avoidPcs : []);
    var allCands = [];
    for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
        var p = pcs_1[_i];
        if (avoidSet.has(p))
            continue;
        allCands.push.apply(allCands, midiCandidatesForPcInRange(p, range));
    }
    var filtered = allCands.filter(function (m) {
        if (belowMidi !== undefined && m >= belowMidi)
            return false;
        if (aboveMidi !== undefined && m <= aboveMidi)
            return false;
        return true;
    });
    if (!filtered.length)
        return [];
    var mid = (range.min + range.max) / 2;
    var scored = filtered.map(function (m) {
        var dist = Math.abs(m - targetMidi);
        var center = Math.abs(m - mid) * 0.15;
        var prefer = preferPc !== null && preferPc !== undefined && pc(m) === preferPc ? -1.2 : 0;
        var extra = extraPenalty ? extraPenalty(m) : 0;
        return { midi: m, score: dist + center + prefer + extra };
    });
    scored.sort(function (a, b) { return a.score - b.score; });
    return scored;
}
function chooseVoiceNote(params) {
    var chordPcs = params.chordPcs, targetMidi = params.targetMidi, range = params.range, belowMidi = params.belowMidi, aboveMidi = params.aboveMidi, preferPc = params.preferPc, restrictToPreferPc = params.restrictToPreferPc, avoidPcs = params.avoidPcs, extraPenalty = params.extraPenalty;
    var pcs = chordPcs.slice();
    if (preferPc !== null && preferPc !== undefined) {
        if (restrictToPreferPc) {
            pcs = [preferPc];
        }
        else {
            pcs = __spreadArray([preferPc], pcs.filter(function (x) { return x !== preferPc; }), true);
        }
    }
    var avoidSet = new Set(avoidPcs !== null && avoidPcs !== void 0 ? avoidPcs : []);
    var allCands = [];
    for (var _i = 0, pcs_2 = pcs; _i < pcs_2.length; _i++) {
        var p = pcs_2[_i];
        if (avoidSet.has(p))
            continue;
        allCands.push.apply(allCands, midiCandidatesForPcInRange(p, range));
    }
    var filtered = allCands.filter(function (m) {
        if (belowMidi !== undefined && m >= belowMidi)
            return false;
        if (aboveMidi !== undefined && m <= aboveMidi)
            return false;
        return true;
    });
    if (!filtered.length)
        return null;
    var mid = (range.min + range.max) / 2;
    return bestByPenalty(filtered, function (m) {
        var dist = Math.abs(m - targetMidi);
        var center = Math.abs(m - mid) * 0.15;
        var prefer = preferPc !== null && preferPc !== undefined && pc(m) === preferPc ? -1.2 : 0;
        var extra = extraPenalty ? extraPenalty(m) : 0;
        return dist + center + prefer + extra;
    });
}
function getScoreBeatsPerMeasure(score) {
    var _a, _b, _c, _d, _e;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var beats = (_e = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beats;
    if (typeof beats === "number" && beats > 0)
        return beats;
    return 4;
}
function getSopranoMidiRange(score, soprPart) {
    var _a, _b;
    var min = Number.POSITIVE_INFINITY;
    var max = Number.NEGATIVE_INFINITY;
    for (var _i = 0, _c = (_a = soprPart === null || soprPart === void 0 ? void 0 : soprPart.measures) !== null && _a !== void 0 ? _a : []; _i < _c.length; _i++) {
        var m = _c[_i];
        for (var _d = 0, _e = (_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []; _d < _e.length; _d++) {
            var ev = _e[_d];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = typeof ev.midi === "number" ? ev.midi : null;
            if (midi === null)
                continue;
            if (midi < min)
                min = midi;
            if (midi > max)
                max = midi;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return { min: 60, max: 81 };
    }
    return { min: min, max: max };
}
function tenorRangeForSoprano(sopranoRange) {
    // If soprano is high (B4..G5), keep tenor top lower (E4).
    if (sopranoRange.max >= 71) {
        return { min: RANGES.Tenor.min, max: 64 }; // E4
    }
    // If soprano is low (C4..A4), keep tenor top at A3.
    if (sopranoRange.max <= 69) {
        return { min: RANGES.Tenor.min, max: 57 }; // A3
    }
    return __assign({}, RANGES.Tenor);
}
function buildChordMap(chords) {
    var map = new Map();
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        map.set("".concat(c.measure, ":").concat(c.t), c);
    }
    return map;
}
function getSopranoSource(score) {
    var _a, _b, _c, _d, _e;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    if (!parts.length)
        return null;
    for (var i = 0; i < parts.length; i++) {
        var name_1 = String((_c = (_b = parts[i]) === null || _b === void 0 ? void 0 : _b.name) !== null && _c !== void 0 ? _c : "").toLowerCase();
        if (name_1.includes("soprano") || name_1.includes("melody") || name_1.includes("voice")) {
            return { partIndex: i, part: parts[i] };
        }
    }
    var bestIndex = -1;
    var bestAvg = -Infinity;
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        var midis = [];
        for (var _i = 0, _f = (_d = part === null || part === void 0 ? void 0 : part.measures) !== null && _d !== void 0 ? _d : []; _i < _f.length; _i++) {
            var m = _f[_i];
            for (var _g = 0, _h = (_e = m === null || m === void 0 ? void 0 : m.events) !== null && _e !== void 0 ? _e : []; _g < _h.length; _g++) {
                var e = _h[_g];
                if (!e || e.type !== "note")
                    continue;
                var midi = eventMidi(e);
                if (typeof midi === "number")
                    midis.push(midi);
            }
        }
        if (!midis.length)
            continue;
        var avg = midis.reduce(function (a, b) { return a + b; }, 0) / midis.length;
        if (avg > bestAvg) {
            bestAvg = avg;
            bestIndex = i;
        }
    }
    if (bestIndex >= 0)
        return { partIndex: bestIndex, part: parts[bestIndex] };
    return parts[0] ? { partIndex: 0, part: parts[0] } : null;
}
function makeEmptyPart(part_id, name, measuresTemplate) {
    return {
        part_id: part_id,
        name: name,
        measures: measuresTemplate.map(function (m) { return ({
            number: m.number,
            attributes: m.attributes ? __assign({}, m.attributes) : undefined,
            events: []
        }); })
    };
}
function ensureMeasureAttributesOnlyOnFirst(part) {
    var _a, _b;
    var ms = (_a = part.measures) !== null && _a !== void 0 ? _a : [];
    for (var i = 0; i < ms.length; i++) {
        if (i === 0)
            continue;
        if ((_b = ms[i]) === null || _b === void 0 ? void 0 : _b.attributes)
            delete ms[i].attributes;
    }
}
function addNoteEvent(measure, t, dur, midi, pitchOverride) {
    var base = pitchWithSpelling(midi, pitchOverride);
    measure.events.push({
        type: "note",
        t: t,
        dur: dur,
        pitch: base,
        midi: midi
    });
}
function pitchWithSpelling(midi, spelling) {
    var _a;
    var base = (0, instrumentCatalog_1.midiToPitch)(midi);
    if (!spelling)
        return base;
    var basePc = pc(midi);
    var targetPc = (STEP_TO_PC[spelling.step] + ((_a = spelling.alter) !== null && _a !== void 0 ? _a : 0) + 12) % 12;
    if (basePc !== targetPc)
        return base;
    return { step: spelling.step, alter: spelling.alter, octave: base.octave };
}
function pcFromSpelling(spelling) {
    var _a;
    return (STEP_TO_PC[spelling.step] + ((_a = spelling.alter) !== null && _a !== void 0 ? _a : 0) + 12) % 12;
}
function addRestEvent(measure, t, dur) {
    measure.events.push({
        type: "rest",
        t: t,
        dur: dur
    });
}
function pickChordForBeat(chordMap, measureNumber, t) {
    var _a, _b;
    // Prefer exact match at this beat, else fall back to beat 0 for the measure.
    return (_b = (_a = chordMap.get("".concat(measureNumber, ":").concat(t))) !== null && _a !== void 0 ? _a : chordMap.get("".concat(measureNumber, ":0"))) !== null && _b !== void 0 ? _b : null;
}
function nextBeatPosition(params) {
    var measureNumber = params.measureNumber, t = params.t, lastBeat = params.lastBeat, nextMeasureNumber = params.nextMeasureNumber, lastMeasureNumber = params.lastMeasureNumber;
    if (t < lastBeat)
        return { measure: measureNumber, t: t + 1 };
    if (measureNumber < lastMeasureNumber)
        return { measure: nextMeasureNumber, t: 0 };
    return null;
}
function consumePendingLeap(pending, voice, measureNumber, t) {
    var _a;
    var idx = pending.findIndex(function (p) { return p.voice === voice && p.atMeasure === measureNumber && p.atT === t; });
    if (idx < 0)
        return null;
    var item = pending[idx];
    pending.splice(idx, 1);
    return (_a = item === null || item === void 0 ? void 0 : item.targetMidi) !== null && _a !== void 0 ? _a : null;
}
function scheduleLeapCompensation(params) {
    var pending = params.pending, voice = params.voice, prevMidi = params.prevMidi, currMidi = params.currMidi, scalePcs = params.scalePcs, range = params.range, nextPos = params.nextPos, measureNumber = params.measureNumber, t = params.t, warnings = params.warnings;
    if (!nextPos)
        return;
    if (prevMidi === null || currMidi === null)
        return;
    if (!shouldCompensateLeap(prevMidi, currMidi))
        return;
    var target = findContraryStepMidi(prevMidi, currMidi, scalePcs, range);
    if (target === null) {
        warnings.push("[leap] WARN m".concat(measureNumber, " t").concat(t, ": ").concat(voice, " leap ").concat(prevMidi, "->").concat(currMidi, " could not find diatonic contrary step within range."));
        return;
    }
    pending.push({ voice: voice, targetMidi: target, atMeasure: nextPos.measure, atT: nextPos.t });
}
function applyPendingLeapTarget(params) {
    var voice = params.voice, targetMidi = params.targetMidi, soprMidi = params.soprMidi, altoMidi = params.altoMidi, tenorMidi = params.tenorMidi, bassMidi = params.bassMidi, warnings = params.warnings, measureNumber = params.measureNumber, t = params.t;
    if (targetMidi === null)
        return { soprMidi: soprMidi, altoMidi: altoMidi, tenorMidi: tenorMidi, bassMidi: bassMidi };
    var state = { S: soprMidi, A: altoMidi, T: tenorMidi, B: bassMidi };
    if (voice === "Soprano")
        state.S = targetMidi;
    if (voice === "Alto")
        state.A = targetMidi;
    if (voice === "Tenor")
        state.T = targetMidi;
    if (voice === "Bass")
        state.B = targetMidi;
    if (!(0, polyphonicRules_1.orderingOk)(state, true)) {
        warnings.push("[leap] WARN m".concat(measureNumber, " t").concat(t, ": ").concat(voice, " contrary step ").concat(targetMidi, " rejected due to ordering."));
        return { soprMidi: soprMidi, altoMidi: altoMidi, tenorMidi: tenorMidi, bassMidi: bassMidi };
    }
    return { soprMidi: state.S, altoMidi: state.A, tenorMidi: state.T, bassMidi: state.B };
}
function collectChordMidis(pcs, range) {
    var out = [];
    for (var _i = 0, pcs_3 = pcs; _i < pcs_3.length; _i++) {
        var p = pcs_3[_i];
        out.push.apply(out, midiCandidatesForPcInRange(p, range));
    }
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
}
var TENOR_BASS_ALLOWED_INTERVALS = [7, 8, 9, 10, 11, 12];
var ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];
function intervalPenalty(interval, allowed, weight) {
    if (interval < 0)
        return weight * 2;
    if (allowed.includes(interval))
        return 0;
    var minDiff = Number.POSITIVE_INFINITY;
    for (var _i = 0, allowed_1 = allowed; _i < allowed_1.length; _i++) {
        var a = allowed_1[_i];
        var diff = Math.abs(interval - a);
        if (diff < minDiff)
            minDiff = diff;
    }
    if (!Number.isFinite(minDiff))
        return weight;
    return weight * (1 + minDiff * 0.6);
}
function refineInnerVoices(params) {
    var chordPcs = params.chordPcs, soprMidi = params.soprMidi, bassMidi = params.bassMidi, tenorTarget = params.tenorTarget, altoTarget = params.altoTarget, tenorRange = params.tenorRange, altoRange = params.altoRange, allowUnisonD4 = params.allowUnisonD4;
    var tenorCands = collectChordMidis(chordPcs, tenorRange);
    var altoCands = collectChordMidis(chordPcs, altoRange);
    if (!tenorCands.length || !altoCands.length)
        return null;
    var soprPc = pc(soprMidi);
    var bassPc = pc(bassMidi);
    var best = null;
    for (var _i = 0, tenorCands_1 = tenorCands; _i < tenorCands_1.length; _i++) {
        var t = tenorCands_1[_i];
        for (var _a = 0, altoCands_1 = altoCands; _a < altoCands_1.length; _a++) {
            var a = altoCands_1[_a];
            if (a >= soprMidi)
                continue;
            var score = 0;
            score += Math.abs(t - tenorTarget) * 0.6;
            score += Math.abs(a - altoTarget) * 0.6;
            if (pc(t) === soprPc)
                score += 5;
            if (pc(a) === soprPc)
                score += 5;
            if (pc(t) === bassPc)
                score += 3;
            if (pc(a) === bassPc)
                score += 3;
            var tb = t - bassMidi;
            var at = a - t;
            if (tb > 0)
                score += intervalPenalty(tb, TENOR_BASS_ALLOWED_INTERVALS, 4);
            if (at >= 0)
                score += intervalPenalty(at, ALTO_TENOR_ALLOWED_INTERVALS, 3.5);
            if (t >= a) {
                if (allowUnisonD4 && t === a && t === 62) {
                    score += 0.5;
                }
                else {
                    score += 4;
                }
            }
            if (pc(t) === pc(a) && !(allowUnisonD4 && t === a && t === 62)) {
                score += 4;
            }
            if (!best || score < best.score)
                best = { tenor: t, alto: a, score: score };
        }
    }
    if (!best)
        return null;
    return { tenor: best.tenor, alto: best.alto };
}
function buildCandidateMap(ranked, limit) {
    var trimmed = ranked.slice(0, limit);
    var list = trimmed.map(function (c) { return c.midi; });
    var scoreByMidi = new Map();
    for (var _i = 0, trimmed_1 = trimmed; _i < trimmed_1.length; _i++) {
        var c = trimmed_1[_i];
        scoreByMidi.set(c.midi, c.score);
    }
    return { list: list, scoreByMidi: scoreByMidi };
}
function selectPolyphonicVoicing(params) {
    var _a, _b, _c, _d, _e, _f;
    var chordPcs = params.chordPcs, chordRootPc = params.chordRootPc, chordSeventhPc = params.chordSeventhPc, soprMidi = params.soprMidi, bassPcPref = params.bassPcPref, lockBassToPref = params.lockBassToPref, ranges = params.ranges, targets = params.targets, prev = params.prev, profile = params.profile, keyPc = params.keyPc, keyMode = params.keyMode, prevChordCtx = params.prevChordCtx, allowUnisonD4 = params.allowUnisonD4, measureNumber = params.measureNumber, t = params.t;
    var warnings = [];
    var bassRanked = rankVoiceCandidates({
        chordPcs: chordPcs,
        targetMidi: targets.bassTarget,
        range: ranges.B,
        preferPc: bassPcPref,
        restrictToPreferPc: lockBassToPref
    });
    var tenorRanked = rankVoiceCandidates({
        chordPcs: chordPcs,
        targetMidi: targets.tenorTarget,
        range: ranges.T
    });
    var altoRanked = rankVoiceCandidates({
        chordPcs: chordPcs,
        targetMidi: targets.altoTarget,
        range: ranges.A,
        belowMidi: soprMidi
    });
    var N = 6;
    var bassMap = buildCandidateMap(bassRanked, N);
    var tenorMap = buildCandidateMap(tenorRanked, N);
    var altoMap = buildCandidateMap(altoRanked, N);
    var bassList = bassMap.list;
    var tenorList = tenorMap.list;
    var altoList = altoMap.list;
    if (!bassList.length) {
        if (lockBassToPref && bassPcPref !== null) {
            bassList = midiCandidatesForPcInRange(bassPcPref, ranges.B);
            if (!bassList.length) {
                bassList = collectChordMidis(chordPcs, ranges.B);
                warnings.push("[poly] WARN m".concat(measureNumber, " t=").concat(t, ": slash bass out of range, relaxed to chord tones."));
            }
        }
        else {
            bassList = collectChordMidis(chordPcs, ranges.B);
        }
    }
    if (!tenorList.length)
        tenorList = collectChordMidis(chordPcs, ranges.T);
    if (!altoList.length)
        altoList = collectChordMidis(chordPcs, ranges.A);
    var chordCtx = {
        pcs: chordPcs,
        rootPc: chordRootPc,
        seventhPc: chordSeventhPc
    };
    var best = null;
    for (var _i = 0, bassList_1 = bassList; _i < bassList_1.length; _i++) {
        var b = bassList_1[_i];
        for (var _g = 0, tenorList_1 = tenorList; _g < tenorList_1.length; _g++) {
            var tMidi = tenorList_1[_g];
            for (var _h = 0, altoList_1 = altoList; _h < altoList_1.length; _h++) {
                var a = altoList_1[_h];
                if (a >= soprMidi)
                    continue;
                var candidate = { S: soprMidi, A: a, T: tMidi, B: b };
                if (!(0, polyphonicRules_1.orderingOk)(candidate, allowUnisonD4))
                    continue;
                var scoreResult = (0, polyphonicRules_1.scorePolyphonicVoicing)({
                    prev: prev,
                    next: candidate,
                    ranges: ranges,
                    profile: profile,
                    keyPc: keyPc,
                    keyMode: keyMode,
                    chord: chordCtx,
                    prevChord: prevChordCtx
                });
                var baseScore = ((_a = bassMap.scoreByMidi.get(b)) !== null && _a !== void 0 ? _a : 0) +
                    ((_b = tenorMap.scoreByMidi.get(tMidi)) !== null && _b !== void 0 ? _b : 0) +
                    ((_c = altoMap.scoreByMidi.get(a)) !== null && _c !== void 0 ? _c : 0);
                var total = scoreResult.score + baseScore;
                if (!best || total < best.score)
                    best = { bass: b, tenor: tMidi, alto: a, score: total };
            }
        }
    }
    if (best) {
        var candidate = { S: soprMidi, A: best.alto, T: best.tenor, B: best.bass };
        var spacingViolation = candidate.S - candidate.A > 12 || candidate.A - candidate.T > 12;
        var overlapViolation = prev &&
            (candidate.A > prev.S ||
                candidate.S < prev.A ||
                candidate.T > prev.A ||
                candidate.A < prev.T ||
                candidate.B > prev.T ||
                candidate.T < prev.B);
        if (spacingViolation || overlapViolation) {
            var repaired_1 = (0, polyphonicRules_1.repairVoicingForCrossingAndOverlap)({
                prev: prev,
                proposed: candidate,
                chordPcs: chordPcs,
                ranges: ranges,
                profile: profile,
                keyPc: keyPc,
                keyMode: keyMode,
                chord: chordCtx,
                prevChord: prevChordCtx,
                allowUnisonD4: allowUnisonD4,
                bassPreferPc: bassPcPref,
                lockBassToPrefer: lockBassToPref
            });
            warnings.push.apply(warnings, repaired_1.warnings.map(function (w) { return "[poly] WARN m".concat(measureNumber, " t").concat(t, ": ").concat(w.replace(/^\[poly\]\s*WARN\s*/i, "")); }));
            return {
                bassMidi: repaired_1.state.B,
                tenorMidi: repaired_1.state.T,
                altoMidi: repaired_1.state.A,
                warnings: warnings
            };
        }
        return { bassMidi: best.bass, tenorMidi: best.tenor, altoMidi: best.alto, warnings: warnings };
    }
    var proposed = {
        S: soprMidi,
        A: (_d = altoList[0]) !== null && _d !== void 0 ? _d : clampInt(soprMidi - 5, ranges.A.min, ranges.A.max),
        T: (_e = tenorList[0]) !== null && _e !== void 0 ? _e : clampInt(soprMidi - 12, ranges.T.min, ranges.T.max),
        B: (_f = bassList[0]) !== null && _f !== void 0 ? _f : clampInt(soprMidi - 24, ranges.B.min, ranges.B.max)
    };
    var repaired = (0, polyphonicRules_1.repairVoicingForCrossingAndOverlap)({
        prev: prev,
        proposed: proposed,
        chordPcs: chordPcs,
        ranges: ranges,
        profile: profile,
        keyPc: keyPc,
        keyMode: keyMode,
        chord: chordCtx,
        prevChord: prevChordCtx,
        allowUnisonD4: allowUnisonD4,
        bassPreferPc: bassPcPref,
        lockBassToPrefer: lockBassToPref
    });
    warnings.push.apply(warnings, repaired.warnings.map(function (w) { return "[poly] WARN m".concat(measureNumber, " t").concat(t, ": ").concat(w.replace(/^\[poly\]\s*WARN\s*/i, "")); }));
    return {
        bassMidi: repaired.state.B,
        tenorMidi: repaired.state.T,
        altoMidi: repaired.state.A,
        warnings: warnings
    };
}
function harmonizeSatbFromChords(inScore, chords, optionsIn) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12;
    var options = optionsIn !== null && optionsIn !== void 0 ? optionsIn : {};
    var keepMelody = options.keepMelodyInSoprano !== false;
    var forceRootInBass = options.forceRootInBass !== false;
    var accompanimentType = String((_b = (_a = options.accompanimentType) !== null && _a !== void 0 ? _a : options.accompaniment) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var usePolyphonic = accompanimentType === "polyphonic";
    var polyProfile = (0, polyphonicRules_1.resolvePolyphonicProfile)(options.styleProfile, options.modernMode);
    var beatsPerMeasure = getScoreBeatsPerMeasure(inScore);
    var lastBeat = Math.max(0, beatsPerMeasure - 1);
    var soprSrc = getSopranoSource(inScore);
    if (!soprSrc) {
        return __assign(__assign({}, inScore), { meta: __assign(__assign({}, inScore.meta), { ensemble: "satb" }), parts: [] });
    }
    var soprPart = soprSrc.part;
    var soprRange = getSopranoMidiRange(inScore, soprPart);
    var tenorRange = (_c = options.tenorRangeOverride) !== null && _c !== void 0 ? _c : tenorRangeForSoprano(soprRange);
    if (typeof options.tenorMinOverride === "number" && Number.isFinite(options.tenorMinOverride)) {
        tenorRange.min = Math.max(tenorRange.min, Math.round(options.tenorMinOverride));
        if (tenorRange.min > tenorRange.max)
            tenorRange.min = tenorRange.max;
    }
    var measuresTemplate = ((_d = soprPart.measures) !== null && _d !== void 0 ? _d : []).map(function (m) { return ({
        number: m.number,
        attributes: m.attributes ? __assign({}, m.attributes) : undefined
    }); });
    var polyRanges = {
        S: { min: soprRange.min, max: soprRange.max },
        A: RANGES.Alto,
        T: tenorRange,
        B: RANGES.Bass
    };
    var lastMeasureNumber = Number((_f = (_e = measuresTemplate[measuresTemplate.length - 1]) === null || _e === void 0 ? void 0 : _e.number) !== null && _f !== void 0 ? _f : measuresTemplate.length);
    var outS = makeEmptyPart("P_S", "Soprano", measuresTemplate);
    var outA = makeEmptyPart("P_A", "Alto", measuresTemplate);
    var outT = makeEmptyPart("P_T", "Tenor", measuresTemplate);
    var outB = makeEmptyPart("P_B", "Bass", measuresTemplate);
    var inputChordCount = (chords !== null && chords !== void 0 ? chords : []).length;
    var usedInference = inputChordCount === 0;
    // If chords are empty, infer them from melody.
    var safeChords = inputChordCount ? (chords !== null && chords !== void 0 ? chords : []) : (0, inferChordsFromMelody_1.inferChordsFromMelody)(inScore);
    var chordMap = buildChordMap(safeChords);
    // For final-cadence Bass enforcement: determine tonic PC (major, key_fifths)
    var keyFifths = getKeyFifths(inScore);
    var keyMode = getKeyMode(inScore);
    var tonicPc = keyMode === "minor" ? tonicPcFromFifthsMinor(keyFifths) : tonicPcFromFifthsMajor(keyFifths);
    var scalePcs = scalePcsFromKey(keyFifths, keyMode);
    if (keepMelody) {
        for (var mi = 0; mi < measuresTemplate.length; mi++) {
            var srcM = (_g = soprPart.measures) === null || _g === void 0 ? void 0 : _g[mi];
            var dstM = (_h = outS.measures) === null || _h === void 0 ? void 0 : _h[mi];
            if (!dstM)
                continue;
            var srcEvents = ((_j = srcM === null || srcM === void 0 ? void 0 : srcM.events) !== null && _j !== void 0 ? _j : []).filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" || (e === null || e === void 0 ? void 0 : e.type) === "rest"; });
            for (var _i = 0, srcEvents_1 = srcEvents; _i < srcEvents_1.length; _i++) {
                var e = srcEvents_1[_i];
                dstM.events.push(__assign({}, e));
            }
        }
    }
    var prevS = null;
    var prevA = null;
    var prevT = null;
    var prevB = null;
    var prevChordCtx = null;
    var repairWarnings = [];
    var pending = null;
    var pendingLeaps = [];
    for (var mi = 0; mi < measuresTemplate.length; mi++) {
        var measureNumber = Number((_l = (_k = measuresTemplate[mi]) === null || _k === void 0 ? void 0 : _k.number) !== null && _l !== void 0 ? _l : mi + 1);
        var mS = (_m = outS.measures) === null || _m === void 0 ? void 0 : _m[mi];
        var mA = (_o = outA.measures) === null || _o === void 0 ? void 0 : _o[mi];
        var mT = (_p = outT.measures) === null || _p === void 0 ? void 0 : _p[mi];
        var mB = (_q = outB.measures) === null || _q === void 0 ? void 0 : _q[mi];
        if (!mS || !mA || !mT || !mB)
            continue;
        var nextMeasureNumber = Number((_s = (_r = measuresTemplate[mi + 1]) === null || _r === void 0 ? void 0 : _r.number) !== null && _s !== void 0 ? _s : (measureNumber + 1));
        var _loop_1 = function (t) {
            var _13, _14, _15, _16;
            var chordEv = pickChordForBeat(chordMap, measureNumber, t);
            var parsed = chordEv ? chordPcsFromSymbol(chordEv.symbol) : null;
            var nextChordEv = chordMap.get("".concat(nextMeasureNumber, ":0"));
            var parsedNext = nextChordEv ? chordPcsFromSymbol(nextChordEv.symbol) : null;
            if (!parsed) {
                addRestEvent(mA, t, 1);
                addRestEvent(mT, t, 1);
                addRestEvent(mB, t, 1);
                return "continue";
            }
            var chordPcs = parsed.pcs;
            var rootPc = parsed.rootPc;
            var isFinalMeasure = measureNumber === lastMeasureNumber;
            var isFinalTonicI = isFinalMeasure && pc(rootPc) === pc(tonicPc);
            var hasSlashBass = parsed.bassPcPref !== null;
            // Prefer bass from slash if given; else (by default) prefer root
            var bassPcPref = parsed.bassPcPref !== null ? parsed.bassPcPref : forceRootInBass ? rootPc : null;
            // Hard rule: on the final I (cadence resolution), force Bass to root at t=0
            // unless a slash bass is explicitly provided.
            if (isFinalTonicI && t === 0 && !hasSlashBass) {
                bassPcPref = rootPc;
            }
            var lockBassToPref = hasSlashBass || forceRootInBass;
            var bassPitchSpelling = lockBassToPref ? (_t = parsed.bassSpelling) !== null && _t !== void 0 ? _t : parsed.rootSpelling : null;
            var soprMidi = null;
            var sEv = ((_u = mS.events) !== null && _u !== void 0 ? _u : []).find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e.t) === t; });
            if ((sEv === null || sEv === void 0 ? void 0 : sEv.midi) !== undefined)
                soprMidi = Number(sEv.midi);
            if (soprMidi === null) {
                addRestEvent(mA, t, 1);
                addRestEvent(mT, t, 1);
                addRestEvent(mB, t, 1);
                return "continue";
            }
            var bassMidi = null;
            var tenorMidi = null;
            var altoMidi = null;
            if (usePolyphonic) {
                var bassTarget = prevB !== null && prevB !== void 0 ? prevB : 48;
                var tenorTarget = prevT !== null && prevT !== void 0 ? prevT : clampInt(bassTarget + 12, tenorRange.min, tenorRange.max);
                var altoTarget = prevA !== null && prevA !== void 0 ? prevA : clampInt(soprMidi - 5, RANGES.Alto.min, RANGES.Alto.max);
                var polyResult = selectPolyphonicVoicing({
                    chordPcs: chordPcs,
                    chordRootPc: rootPc,
                    chordSeventhPc: (_v = parsed.seventhPc) !== null && _v !== void 0 ? _v : null,
                    soprMidi: soprMidi,
                    bassPcPref: bassPcPref,
                    lockBassToPref: lockBassToPref,
                    ranges: polyRanges,
                    targets: { bassTarget: bassTarget, tenorTarget: tenorTarget, altoTarget: altoTarget },
                    prev: prevS !== null && prevA !== null && prevT !== null && prevB !== null ? { S: prevS, A: prevA, T: prevT, B: prevB } : null,
                    profile: polyProfile,
                    keyPc: tonicPc,
                    keyMode: keyMode,
                    prevChordCtx: prevChordCtx,
                    allowUnisonD4: true,
                    measureNumber: measureNumber,
                    t: t
                });
                bassMidi = polyResult.bassMidi;
                tenorMidi = polyResult.tenorMidi;
                altoMidi = polyResult.altoMidi;
                if (polyResult.warnings.length) {
                    for (var _17 = 0, _18 = polyResult.warnings; _17 < _18.length; _17++) {
                        var w = _18[_17];
                        // eslint-disable-next-line no-console
                        console.warn(w);
                        repairWarnings.push(w);
                    }
                }
            }
            else {
                var forceTenorPc = pending && pending.voice === "Tenor" && pending.atMeasure === measureNumber && pending.atT === t
                    ? pending.toPc
                    : null;
                var forceAltoPc = pending && pending.voice === "Alto" && pending.atMeasure === measureNumber && pending.atT === t
                    ? pending.toPc
                    : null;
                if (pending && pending.atMeasure === measureNumber && pending.atT === t) {
                    pending = null;
                }
                var bassTarget = prevB !== null && prevB !== void 0 ? prevB : 48;
                var bassExtraPenalty = function (candB) {
                    var pen = 0;
                    // Avoid parallels/direct perfects with Soprano
                    if (prevS !== null && prevB !== null) {
                        var pPenalty = isParallelPerfect({
                            prevUpper: prevS,
                            prevLower: prevB,
                            nextUpper: soprMidi,
                            nextLower: candB
                        })
                            ? 50
                            : 0;
                        var dPenalty = isDirectPerfect({
                            prevUpper: prevS,
                            prevLower: prevB,
                            nextUpper: soprMidi,
                            nextLower: candB
                        })
                            ? 20
                            : 0;
                        pen += pPenalty + dPenalty;
                    }
                    // Hard cadence rule: final I at t=0 must be Bass root
                    if (isFinalTonicI && t === 0) {
                        if (pc(candB) !== pc(rootPc))
                            pen += 10000;
                    }
                    return pen;
                };
                bassMidi =
                    (_w = chooseVoiceNote({
                        voice: "Bass",
                        chordPcs: chordPcs,
                        targetMidi: bassTarget,
                        range: RANGES.Bass,
                        belowMidi: soprMidi,
                        preferPc: bassPcPref,
                        restrictToPreferPc: lockBassToPref,
                        extraPenalty: bassExtraPenalty
                    })) !== null && _w !== void 0 ? _w : (hasSlashBass
                        ? null
                        : chooseVoiceNote({
                            voice: "Bass",
                            chordPcs: chordPcs,
                            targetMidi: bassTarget,
                            range: RANGES.Bass,
                            preferPc: bassPcPref,
                            restrictToPreferPc: false,
                            extraPenalty: bassExtraPenalty
                        }));
                if (bassMidi === null && hasSlashBass) {
                    var relaxed = chooseVoiceNote({
                        voice: "Bass",
                        chordPcs: chordPcs,
                        targetMidi: bassTarget,
                        range: RANGES.Bass,
                        preferPc: bassPcPref,
                        restrictToPreferPc: false,
                        extraPenalty: bassExtraPenalty
                    });
                    if (relaxed !== null) {
                        bassMidi = relaxed;
                        bassPitchSpelling = null;
                        // eslint-disable-next-line no-console
                        console.warn("[warn] [chord] Slash bass \"".concat((_x = chordEv === null || chordEv === void 0 ? void 0 : chordEv.symbol) !== null && _x !== void 0 ? _x : "", "\" out of range at m").concat(measureNumber, " t=").concat(t, "; relaxed to chord tone."));
                    }
                }
                var chordHas7 = parsed.hasSeventh && parsed.seventhPc !== null;
                var seventhPc = parsed.seventhPc;
                var soprIs7 = chordHas7 && seventhPc !== null ? pc(soprMidi) === seventhPc : false;
                var resolutionPc = chordHas7 && seventhPc !== null ? (seventhPc + 11) % 12 : null;
                var canForceResolution = chordHas7 &&
                    seventhPc !== null &&
                    resolutionPc !== null &&
                    parsedNext &&
                    parsedNext.pcs.includes(resolutionPc);
                var shouldPlace7Now = chordHas7 && seventhPc !== null && t === lastBeat;
                var avoid7Early = chordHas7 && seventhPc !== null && t !== lastBeat ? [seventhPc] : [];
                var tenorTarget = prevT !== null && prevT !== void 0 ? prevT : clampInt((bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget) + 12, RANGES.Tenor.min, RANGES.Tenor.max);
                var tenorPreferPc = forceTenorPc !== null ? forceTenorPc : shouldPlace7Now && !soprIs7 ? seventhPc : null;
                var tenorAvoid = [];
                tenorAvoid.push.apply(tenorAvoid, avoid7Early);
                var tenorExtraPenalty = function (candT) {
                    var pen = 0;
                    if (bassMidi !== null && prevT !== null && prevB !== null) {
                        if (isParallelPerfect({
                            prevUpper: prevT,
                            prevLower: prevB,
                            nextUpper: candT,
                            nextLower: bassMidi
                        }))
                            pen += 40;
                        if (isDirectPerfect({
                            prevUpper: prevT,
                            prevLower: prevB,
                            nextUpper: candT,
                            nextLower: bassMidi
                        }))
                            pen += 15;
                    }
                    if (prevT !== null && prevS !== null) {
                        if (isParallelPerfect({
                            prevUpper: prevS,
                            prevLower: prevT,
                            nextUpper: soprMidi,
                            nextLower: candT
                        }))
                            pen += 40;
                        if (isDirectPerfect({
                            prevUpper: prevS,
                            prevLower: prevT,
                            nextUpper: soprMidi,
                            nextLower: candT
                        }))
                            pen += 15;
                    }
                    return pen;
                };
                tenorMidi =
                    (_y = chooseVoiceNote({
                        voice: "Tenor",
                        chordPcs: chordPcs,
                        targetMidi: tenorTarget,
                        range: tenorRange,
                        aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                        preferPc: tenorPreferPc,
                        avoidPcs: tenorAvoid,
                        extraPenalty: tenorExtraPenalty
                    })) !== null && _y !== void 0 ? _y : chooseVoiceNote({
                        voice: "Tenor",
                        chordPcs: chordPcs,
                        targetMidi: tenorTarget,
                        range: tenorRange,
                        aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                        avoidPcs: tenorAvoid,
                        extraPenalty: tenorExtraPenalty
                    });
                var altoTarget = prevA !== null && prevA !== void 0 ? prevA : clampInt(soprMidi - 5, RANGES.Alto.min, RANGES.Alto.max);
                var altoCeil = soprMidi - 1;
                var tenorTook7 = chordHas7 && seventhPc !== null && tenorMidi !== null ? pc(tenorMidi) === seventhPc : false;
                var altoPreferPc = forceAltoPc !== null ? forceAltoPc : shouldPlace7Now && !soprIs7 && !tenorTook7 ? seventhPc : null;
                var altoAvoid = [];
                altoAvoid.push.apply(altoAvoid, avoid7Early);
                if (chordHas7 && seventhPc !== null && tenorTook7)
                    altoAvoid.push(seventhPc);
                var altoExtraPenalty = function (candA) {
                    var pen = 0;
                    if (tenorMidi !== null && prevA !== null && prevT !== null) {
                        if (isParallelPerfect({
                            prevUpper: prevA,
                            prevLower: prevT,
                            nextUpper: candA,
                            nextLower: tenorMidi
                        }))
                            pen += 35;
                        if (isDirectPerfect({
                            prevUpper: prevA,
                            prevLower: prevT,
                            nextUpper: candA,
                            nextLower: tenorMidi
                        }))
                            pen += 12;
                    }
                    if (bassMidi !== null && prevA !== null && prevB !== null) {
                        if (isParallelPerfect({
                            prevUpper: prevA,
                            prevLower: prevB,
                            nextUpper: candA,
                            nextLower: bassMidi
                        }))
                            pen += 35;
                        if (isDirectPerfect({
                            prevUpper: prevA,
                            prevLower: prevB,
                            nextUpper: candA,
                            nextLower: bassMidi
                        }))
                            pen += 12;
                    }
                    if (prevA !== null && prevS !== null) {
                        if (isParallelPerfect({
                            prevUpper: prevS,
                            prevLower: prevA,
                            nextUpper: soprMidi,
                            nextLower: candA
                        }))
                            pen += 35;
                        if (isDirectPerfect({
                            prevUpper: prevS,
                            prevLower: prevA,
                            nextUpper: soprMidi,
                            nextLower: candA
                        }))
                            pen += 12;
                    }
                    return pen;
                };
                altoMidi =
                    (_z = chooseVoiceNote({
                        voice: "Alto",
                        chordPcs: chordPcs,
                        targetMidi: altoTarget,
                        range: RANGES.Alto,
                        belowMidi: altoCeil,
                        preferPc: altoPreferPc,
                        avoidPcs: altoAvoid,
                        extraPenalty: altoExtraPenalty
                    })) !== null && _z !== void 0 ? _z : null;
                if (altoMidi === null) {
                    var tenorBelow = soprMidi - 4;
                    var tenorLowerTarget = clampInt((tenorMidi !== null && tenorMidi !== void 0 ? tenorMidi : tenorTarget) - 7, RANGES.Tenor.min, RANGES.Tenor.max);
                    var altTenor = (_0 = chooseVoiceNote({
                        voice: "Tenor",
                        chordPcs: chordPcs,
                        targetMidi: tenorLowerTarget,
                        range: tenorRange,
                        aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                        belowMidi: tenorBelow,
                        preferPc: tenorPreferPc,
                        avoidPcs: tenorAvoid,
                        extraPenalty: tenorExtraPenalty
                    })) !== null && _0 !== void 0 ? _0 : chooseVoiceNote({
                        voice: "Tenor",
                        chordPcs: chordPcs,
                        targetMidi: tenorLowerTarget,
                        range: tenorRange,
                        aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                        belowMidi: tenorBelow,
                        avoidPcs: tenorAvoid,
                        extraPenalty: tenorExtraPenalty
                    });
                    if (altTenor !== null) {
                        tenorMidi = altTenor;
                        altoMidi =
                            (_1 = chooseVoiceNote({
                                voice: "Alto",
                                chordPcs: chordPcs,
                                targetMidi: altoTarget,
                                range: RANGES.Alto,
                                belowMidi: altoCeil,
                                preferPc: altoPreferPc,
                                avoidPcs: altoAvoid,
                                extraPenalty: altoExtraPenalty
                            })) !== null && _1 !== void 0 ? _1 : null;
                    }
                }
                if (altoMidi !== null && soprMidi - altoMidi > 12) {
                    var forcedTarget = soprMidi - 7;
                    var alt2 = (_2 = chooseVoiceNote({
                        voice: "Alto",
                        chordPcs: chordPcs,
                        targetMidi: forcedTarget,
                        range: RANGES.Alto,
                        belowMidi: altoCeil,
                        preferPc: altoPreferPc,
                        avoidPcs: altoAvoid,
                        extraPenalty: altoExtraPenalty
                    })) !== null && _2 !== void 0 ? _2 : null;
                    if (alt2 !== null)
                        altoMidi = alt2;
                }
                if (altoMidi === null) {
                    var tenorCandidates = rankVoiceCandidates({
                        chordPcs: chordPcs,
                        targetMidi: tenorTarget,
                        range: tenorRange,
                        aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                        preferPc: tenorPreferPc,
                        avoidPcs: tenorAvoid,
                        extraPenalty: tenorExtraPenalty
                    });
                    var bestPair = null;
                    for (var _19 = 0, _20 = tenorCandidates.slice(0, 24); _19 < _20.length; _19++) {
                        var cand = _20[_19];
                        var candTenor = cand.midi;
                        var candAlto = (_3 = chooseVoiceNote({
                            voice: "Alto",
                            chordPcs: chordPcs,
                            targetMidi: altoTarget,
                            range: RANGES.Alto,
                            belowMidi: altoCeil,
                            preferPc: altoPreferPc,
                            avoidPcs: altoAvoid,
                            extraPenalty: altoExtraPenalty
                        })) !== null && _3 !== void 0 ? _3 : null;
                        if (candAlto === null)
                            continue;
                        var spacingPenalty = candAlto - candTenor > 12 ? 3 : 0;
                        var pairScore = cand.score + spacingPenalty;
                        if (!bestPair || pairScore < bestPair.score) {
                            bestPair = { tenor: candTenor, alto: candAlto, score: pairScore };
                        }
                    }
                    if (bestPair) {
                        tenorMidi = bestPair.tenor;
                        altoMidi = bestPair.alto;
                    }
                }
                if (tenorMidi === null) {
                    var tenorFallbackTarget = clampInt((bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget) + 7, RANGES.Tenor.min, RANGES.Tenor.max);
                    tenorMidi =
                        (_4 = chooseVoiceNote({
                            voice: "Tenor",
                            chordPcs: chordPcs,
                            targetMidi: tenorFallbackTarget,
                            range: tenorRange,
                            aboveMidi: bassMidi !== null && bassMidi !== void 0 ? bassMidi : bassTarget,
                            avoidPcs: tenorAvoid,
                            extraPenalty: tenorExtraPenalty
                        })) !== null && _4 !== void 0 ? _4 : null;
                }
                if (altoMidi === null) {
                    var altoFallbackTarget = clampInt(soprMidi - 4, RANGES.Alto.min, RANGES.Alto.max);
                    altoMidi =
                        (_5 = chooseVoiceNote({
                            voice: "Alto",
                            chordPcs: chordPcs,
                            targetMidi: altoFallbackTarget,
                            range: RANGES.Alto,
                            belowMidi: soprMidi,
                            avoidPcs: altoAvoid,
                            extraPenalty: altoExtraPenalty
                        })) !== null && _5 !== void 0 ? _5 : null;
                }
                if (bassMidi === null || tenorMidi === null || altoMidi === null) {
                    var repaired = (0, repairVoicing_1.repairVoicingForBeat)({
                        chordPcs: chordPcs,
                        parsedChord: parsed,
                        soprMidi: soprMidi,
                        prev: { prevA: prevA, prevT: prevT, prevB: prevB, prevS: prevS },
                        ranges: { Bass: RANGES.Bass, Tenor: tenorRange, Alto: RANGES.Alto },
                        options: { forceRootInBass: forceRootInBass, allowOctaveShift: true, allowTenorAltoUnisonD4: true },
                        targets: { bassTarget: bassTarget, tenorTarget: tenorTarget, altoTarget: altoTarget },
                        context: { measure: measureNumber, t: t }
                    });
                    if (repaired) {
                        bassMidi = repaired.bassMidi;
                        tenorMidi = repaired.tenorMidi;
                        altoMidi = repaired.altoMidi;
                        bassPitchSpelling = (_6 = repaired.bassSpelling) !== null && _6 !== void 0 ? _6 : bassPitchSpelling;
                        if (bassPitchSpelling && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
                            bassPitchSpelling = null;
                        }
                        if (repaired.warnings.length) {
                            for (var _21 = 0, _22 = repaired.warnings; _21 < _22.length; _21++) {
                                var w = _22[_21];
                                // eslint-disable-next-line no-console
                                console.warn(w);
                                repairWarnings.push(w);
                            }
                        }
                    }
                }
                if (tenorMidi === null) {
                    tenorMidi =
                        (_7 = chooseVoiceNote({
                            voice: "Tenor",
                            chordPcs: chordPcs,
                            targetMidi: tenorTarget,
                            range: tenorRange
                        })) !== null && _7 !== void 0 ? _7 : tenorTarget;
                }
                if (altoMidi === null) {
                    altoMidi =
                        (_8 = chooseVoiceNote({
                            voice: "Alto",
                            chordPcs: chordPcs,
                            targetMidi: altoTarget,
                            range: RANGES.Alto
                        })) !== null && _8 !== void 0 ? _8 : altoTarget;
                }
                if (bassMidi === null) {
                    bassMidi =
                        (_9 = chooseVoiceNote({
                            voice: "Bass",
                            chordPcs: chordPcs,
                            targetMidi: bassTarget,
                            range: RANGES.Bass
                        })) !== null && _9 !== void 0 ? _9 : bassTarget;
                    if (bassPitchSpelling && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
                        bassPitchSpelling = null;
                    }
                }
                if (tenorMidi !== null && altoMidi !== null && bassMidi !== null) {
                    var refined = refineInnerVoices({
                        chordPcs: chordPcs,
                        soprMidi: soprMidi,
                        bassMidi: bassMidi,
                        tenorTarget: tenorTarget,
                        altoTarget: altoTarget,
                        tenorRange: tenorRange,
                        altoRange: RANGES.Alto,
                        allowUnisonD4: true
                    });
                    if (refined) {
                        tenorMidi = refined.tenor;
                        altoMidi = refined.alto;
                    }
                }
                if (shouldPlace7Now && canForceResolution && resolutionPc !== null) {
                    var tenorHas7Now = tenorMidi !== null && seventhPc !== null ? pc(tenorMidi) === seventhPc : false;
                    var altoHas7Now = altoMidi !== null && seventhPc !== null ? pc(altoMidi) === seventhPc : false;
                    if (tenorHas7Now) {
                        pending = { voice: "Tenor", toPc: resolutionPc, atMeasure: nextMeasureNumber, atT: 0 };
                    }
                    else if (altoHas7Now) {
                        pending = { voice: "Alto", toPc: resolutionPc, atMeasure: nextMeasureNumber, atT: 0 };
                    }
                }
            }
            if (bassPitchSpelling && bassMidi !== null && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
                bassPitchSpelling = null;
            }
            if (soprMidi !== null && altoMidi !== null && tenorMidi !== null && bassMidi !== null) {
                var leapTargetB = consumePendingLeap(pendingLeaps, "Bass", measureNumber, t);
                var leapTargetT = consumePendingLeap(pendingLeaps, "Tenor", measureNumber, t);
                var leapTargetA = consumePendingLeap(pendingLeaps, "Alto", measureNumber, t);
                var leapTargetS = keepMelody ? null : consumePendingLeap(pendingLeaps, "Soprano", measureNumber, t);
                var curS = soprMidi;
                var curA = altoMidi;
                var curT = tenorMidi;
                var curB = bassMidi;
                (_13 = applyPendingLeapTarget({
                    voice: "Bass",
                    targetMidi: leapTargetB,
                    soprMidi: curS,
                    altoMidi: curA,
                    tenorMidi: curT,
                    bassMidi: curB,
                    warnings: repairWarnings,
                    measureNumber: measureNumber,
                    t: t
                }), curS = _13.soprMidi, curA = _13.altoMidi, curT = _13.tenorMidi, curB = _13.bassMidi);
                (_14 = applyPendingLeapTarget({
                    voice: "Tenor",
                    targetMidi: leapTargetT,
                    soprMidi: curS,
                    altoMidi: curA,
                    tenorMidi: curT,
                    bassMidi: curB,
                    warnings: repairWarnings,
                    measureNumber: measureNumber,
                    t: t
                }), curS = _14.soprMidi, curA = _14.altoMidi, curT = _14.tenorMidi, curB = _14.bassMidi);
                (_15 = applyPendingLeapTarget({
                    voice: "Alto",
                    targetMidi: leapTargetA,
                    soprMidi: curS,
                    altoMidi: curA,
                    tenorMidi: curT,
                    bassMidi: curB,
                    warnings: repairWarnings,
                    measureNumber: measureNumber,
                    t: t
                }), curS = _15.soprMidi, curA = _15.altoMidi, curT = _15.tenorMidi, curB = _15.bassMidi);
                if (!keepMelody) {
                    (_16 = applyPendingLeapTarget({
                        voice: "Soprano",
                        targetMidi: leapTargetS,
                        soprMidi: curS,
                        altoMidi: curA,
                        tenorMidi: curT,
                        bassMidi: curB,
                        warnings: repairWarnings,
                        measureNumber: measureNumber,
                        t: t
                    }), curS = _16.soprMidi, curA = _16.altoMidi, curT = _16.tenorMidi, curB = _16.bassMidi);
                }
                soprMidi = curS;
                altoMidi = curA;
                tenorMidi = curT;
                bassMidi = curB;
            }
            var nextPos = nextBeatPosition({
                measureNumber: measureNumber,
                t: t,
                lastBeat: lastBeat,
                nextMeasureNumber: nextMeasureNumber,
                lastMeasureNumber: lastMeasureNumber
            });
            scheduleLeapCompensation({
                pending: pendingLeaps,
                voice: "Bass",
                prevMidi: prevB,
                currMidi: bassMidi,
                scalePcs: scalePcs,
                range: RANGES.Bass,
                nextPos: nextPos,
                measureNumber: measureNumber,
                t: t,
                warnings: repairWarnings
            });
            scheduleLeapCompensation({
                pending: pendingLeaps,
                voice: "Tenor",
                prevMidi: prevT,
                currMidi: tenorMidi,
                scalePcs: scalePcs,
                range: tenorRange,
                nextPos: nextPos,
                measureNumber: measureNumber,
                t: t,
                warnings: repairWarnings
            });
            scheduleLeapCompensation({
                pending: pendingLeaps,
                voice: "Alto",
                prevMidi: prevA,
                currMidi: altoMidi,
                scalePcs: scalePcs,
                range: RANGES.Alto,
                nextPos: nextPos,
                measureNumber: measureNumber,
                t: t,
                warnings: repairWarnings
            });
            if (!keepMelody) {
                scheduleLeapCompensation({
                    pending: pendingLeaps,
                    voice: "Soprano",
                    prevMidi: prevS,
                    currMidi: soprMidi,
                    scalePcs: scalePcs,
                    range: soprRange,
                    nextPos: nextPos,
                    measureNumber: measureNumber,
                    t: t,
                    warnings: repairWarnings
                });
            }
            addNoteEvent(mT, t, 1, tenorMidi);
            addNoteEvent(mA, t, 1, altoMidi);
            addNoteEvent(mB, t, 1, bassMidi, bassPitchSpelling);
            prevS = soprMidi;
            prevA = altoMidi !== null && altoMidi !== void 0 ? altoMidi : prevA;
            prevT = tenorMidi !== null && tenorMidi !== void 0 ? tenorMidi : prevT;
            prevB = bassMidi;
            prevChordCtx = { pcs: chordPcs, rootPc: rootPc, seventhPc: (_10 = parsed.seventhPc) !== null && _10 !== void 0 ? _10 : null };
        };
        for (var t = 0; t < beatsPerMeasure; t++) {
            _loop_1(t);
        }
    }
    ensureMeasureAttributesOnlyOnFirst(outS);
    ensureMeasureAttributesOnlyOnFirst(outA);
    ensureMeasureAttributesOnlyOnFirst(outT);
    ensureMeasureAttributesOnlyOnFirst(outB);
    var chordEventSample = safeChords.slice(0, 32).map(function (c) { return ({
        measure: Number(c.measure),
        t: Number(c.t),
        symbol: String(c.symbol)
    }); });
    var chordEvents = safeChords.map(function (c) { return ({
        measure: Number(c.measure),
        t: Number(c.t),
        symbol: String(c.symbol)
    }); });
    var out = __assign(__assign({}, inScore), { meta: __assign(__assign({}, ((_11 = inScore.meta) !== null && _11 !== void 0 ? _11 : {})), { ensemble: "satb", harmonize: {
                mode: "satb_from_chords_or_melody",
                version: "0.7.3",
                note: "If chords are empty, infer diatonic triads on strong beats from melody using key signature; final cadence enforces Bass root on final I at t=0.",
                chords: chordEvents,
                debug: {
                    usedInference: usedInference,
                    beatsPerMeasure: beatsPerMeasure,
                    chordEventCount: safeChords.length,
                    chordEventSample: chordEventSample,
                    repairWarnings: repairWarnings.length ? repairWarnings : undefined,
                    accompanimentType: accompanimentType || undefined,
                    polyphonicProfile: usePolyphonic
                        ? { profile: polyProfile.name, modernMode: (_12 = polyProfile.modernMode) !== null && _12 !== void 0 ? _12 : undefined }
                        : undefined
                }
            } }), parts: [outS, outA, outT, outB] });
    return out;
}
