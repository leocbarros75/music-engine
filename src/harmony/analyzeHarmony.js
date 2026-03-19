"use strict";
// src/harmony/analyzeHarmony.ts
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
exports.analyzeHarmony = analyzeHarmony;
var pitch_1 = require("./pitch");
var chordDetect_1 = require("./chordDetect");
var keyEstimate_1 = require("./keyEstimate");
var roman_1 = require("./roman");
var cadence_1 = require("./cadence");
function sendSustainPolicy(x) {
    var s = String(x !== null && x !== void 0 ? x : "").toLowerCase().trim();
    if (s === "carry")
        return "carry";
    if (s === "overlap")
        return "overlap";
    if (s === "none")
        return "none";
    return "overlap";
}
function getMeasureCount(score) {
    var _a, _b;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    var max = 0;
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var p = parts_1[_i];
        max = Math.max(max, ((_b = p === null || p === void 0 ? void 0 : p.measures) !== null && _b !== void 0 ? _b : []).length);
    }
    return max;
}
function isPercussionPart(p) {
    var _a, _b;
    var name = String((_b = (_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : p === null || p === void 0 ? void 0 : p.part_id) !== null && _b !== void 0 ? _b : "").toLowerCase();
    return name.includes("perc") || name.includes("drum") || name.includes("kit");
}
function collectMeasureEvents(score, measureIndex, ignorePercussion) {
    var _a, _b, _c;
    var out = [];
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_2 = parts; _i < parts_2.length; _i++) {
        var p = parts_2[_i];
        if (ignorePercussion && isPercussionPart(p))
            continue;
        var m = (_b = p === null || p === void 0 ? void 0 : p.measures) === null || _b === void 0 ? void 0 : _b[measureIndex];
        var evs = (_c = m === null || m === void 0 ? void 0 : m.events) !== null && _c !== void 0 ? _c : [];
        for (var _d = 0, evs_1 = evs; _d < evs_1.length; _d++) {
            var ev = evs_1[_d];
            out.push(ev);
        }
    }
    return out;
}
function collectMeasurePcsAndBassPc(score, measureIndex, ignorePercussion) {
    var _a;
    var pcs = [];
    var bassMidi = null;
    var evs = collectMeasureEvents(score, measureIndex, ignorePercussion);
    for (var _i = 0, evs_2 = evs; _i < evs_2.length; _i++) {
        var ev = evs_2[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
            continue;
        if (!((_a = ev === null || ev === void 0 ? void 0 : ev.pitch) === null || _a === void 0 ? void 0 : _a.step))
            continue;
        var midi = typeof (ev === null || ev === void 0 ? void 0 : ev.midi) === "number" ? ev.midi : (0, pitch_1.pitchToMidi)(ev.pitch);
        var pc = (0, pitch_1.midiToPc)(midi);
        pcs.push(pc);
        bassMidi = bassMidi === null ? midi : Math.min(bassMidi, midi);
    }
    var bassPc = bassMidi === null ? null : (0, pitch_1.midiToPc)(bassMidi);
    return { pcs: pcs, bassPc: bassPc };
}
function collectHistogram(score, maxMeasures, ignorePercussion) {
    var _a;
    var hist = new Array(12).fill(0);
    var mc = Math.min(getMeasureCount(score), maxMeasures);
    for (var i = 0; i < mc; i++) {
        var pcs = collectMeasurePcsAndBassPc(score, i, ignorePercussion).pcs;
        for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
            var pc = pcs_1[_i];
            hist[pc] = ((_a = hist[pc]) !== null && _a !== void 0 ? _a : 0) + 1;
        }
    }
    return hist;
}
function getDivisionsForMeasure(score, measureIndex) {
    var _a, _b, _c;
    var p0 = (_a = score === null || score === void 0 ? void 0 : score.parts) === null || _a === void 0 ? void 0 : _a[0];
    var m0 = (_b = p0 === null || p0 === void 0 ? void 0 : p0.measures) === null || _b === void 0 ? void 0 : _b[measureIndex];
    var div = (_c = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _c === void 0 ? void 0 : _c.divisions;
    return typeof div === "number" && div > 0 ? div : 480;
}
function getBeatsPerMeasure(score, measureIndex) {
    var _a, _b, _c, _d;
    var p0 = (_a = score === null || score === void 0 ? void 0 : score.parts) === null || _a === void 0 ? void 0 : _a[0];
    var m0 = (_b = p0 === null || p0 === void 0 ? void 0 : p0.measures) === null || _b === void 0 ? void 0 : _b[measureIndex];
    var beats = (_d = (_c = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _c === void 0 ? void 0 : _c.time) === null || _d === void 0 ? void 0 : _d.beats;
    return typeof beats === "number" && beats > 0 ? beats : 4;
}
function noteOverlapsBeatWindow(t, dur, beatStart, beatEnd) {
    var a0 = t !== null && t !== void 0 ? t : 0;
    var a1 = (t !== null && t !== void 0 ? t : 0) + (dur !== null && dur !== void 0 ? dur : 0);
    return a0 < beatEnd && a1 > beatStart;
}
function collectBeatPcsAndBassPc(score, measureIndex, beatNumber, ignorePercussion) {
    var _a;
    var pcs = [];
    var bassMidi = null;
    var divisions = getDivisionsForMeasure(score, measureIndex);
    var beatStart = (beatNumber - 1) * divisions;
    var beatEnd = beatStart + divisions;
    var evs = collectMeasureEvents(score, measureIndex, ignorePercussion);
    for (var _i = 0, evs_3 = evs; _i < evs_3.length; _i++) {
        var ev = evs_3[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
            continue;
        if (!((_a = ev === null || ev === void 0 ? void 0 : ev.pitch) === null || _a === void 0 ? void 0 : _a.step))
            continue;
        var t = typeof (ev === null || ev === void 0 ? void 0 : ev.t) === "number" ? ev.t : 0;
        var dur = typeof (ev === null || ev === void 0 ? void 0 : ev.dur) === "number" ? ev.dur : divisions;
        if (!noteOverlapsBeatWindow(t, dur, beatStart, beatEnd))
            continue;
        var midi = typeof (ev === null || ev === void 0 ? void 0 : ev.midi) === "number" ? ev.midi : (0, pitch_1.pitchToMidi)(ev.pitch);
        var pc = (0, pitch_1.midiToPc)(midi);
        pcs.push(pc);
        bassMidi = bassMidi === null ? midi : Math.min(bassMidi, midi);
    }
    var bassPc = bassMidi === null ? null : (0, pitch_1.midiToPc)(bassMidi);
    return { pcs: pcs, bassPc: bassPc };
}
/**
 * Small helpers
 */
function normPc(pc) {
    var x = pc % 12;
    return x < 0 ? x + 12 : x;
}
function noteNameToPc(name) {
    var _a;
    var s = String(name !== null && name !== void 0 ? name : "").trim().toUpperCase();
    if (!s)
        return null;
    // normalize unicode accidental chars
    var clean = s.replace("♯", "#").replace("♭", "B");
    var m = clean.match(/^([A-G])([#B]{0,2})$/);
    if (!m)
        return null;
    var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var pc = base[m[1]];
    var acc = (_a = m[2]) !== null && _a !== void 0 ? _a : "";
    for (var _i = 0, _b = acc.split(""); _i < _b.length; _i++) {
        var ch = _b[_i];
        if (ch === "#")
            pc += 1;
        if (ch === "B")
            pc -= 1;
    }
    return normPc(pc);
}
function dominantPcFromKey(key) {
    var tonicPc = noteNameToPc(key === null || key === void 0 ? void 0 : key.tonic);
    if (tonicPc === null)
        return null;
    return normPc(tonicPc + 7);
}
function looksLikeI64(r) {
    return r === "I64" || r === "i64";
}
function looksLikeNC(r) {
    return (r !== null && r !== void 0 ? r : "") === "N.C.";
}
function looksLikeVish(r) {
    var u = (r !== null && r !== void 0 ? r : "").toUpperCase();
    return u.startsWith("V") || u.includes("V/") || u.startsWith("VII");
}
function relabelAsV64(x) {
    var _a;
    x.roman = __assign(__assign({}, ((_a = x.roman) !== null && _a !== void 0 ? _a : {})), { roman: "V64", degree: 5, functionTag: "dominant" });
}
function getBassPcFromItem(x) {
    var _a;
    var b = (_a = x === null || x === void 0 ? void 0 : x.chord) === null || _a === void 0 ? void 0 : _a.bassPc;
    return typeof b === "number" ? b : null;
}
function getByPath(obj, path) {
    var cur = obj;
    for (var _i = 0, path_1 = path; _i < path_1.length; _i++) {
        var k = path_1[_i];
        if (cur === null || cur === undefined)
            return undefined;
        cur = cur[k];
    }
    return cur;
}
function asFiniteNumber(x) {
    return typeof x === "number" && Number.isFinite(x) ? x : null;
}
function asMode(x) {
    var s = String(x !== null && x !== void 0 ? x : "").toLowerCase();
    if (s === "major")
        return "major";
    if (s === "minor")
        return "minor";
    return null;
}
function preferSharpsFromTonicName(tonic) {
    var t = String(tonic !== null && tonic !== void 0 ? tonic : "").trim();
    return t === "G" || t === "D" || t === "A" || t === "E" || t === "B" || t === "F#" || t === "C#";
}
function preferSharpsFromKeySigOrTonic(keySig, tonic) {
    var fifths = keySig === null || keySig === void 0 ? void 0 : keySig.fifths;
    if (typeof fifths === "number" && Number.isFinite(fifths)) {
        if (fifths > 0)
            return true;
        if (fifths < 0)
            return false;
        return preferSharpsFromTonicName(tonic);
    }
    return preferSharpsFromTonicName(tonic);
}
/**
 * Robust key signature extraction (because parsers store it differently).
 * Scans first few measures across parts and tries multiple common paths.
 */
function findFirstKeySig(score) {
    var _a, _b;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    var maxMeasureScan = 8;
    var PATHS = [
        ["attributes", "key", "fifths"],
        ["attributes", "keySig", "fifths"],
        ["attributes", "keySignature", "fifths"],
        ["attributes", "key_signature", "fifths"],
        // IMPORTANT: our MusicXML parser stores <fifths> here
        ["attributes", "key_fifths"],
        ["attributes", "fifths"],
        ["attributes", "fifthsNumber"],
        ["attributes", "key", "fifthsNumber"],
        ["attributes", "key", "fifths_value"],
        ["key", "fifths"],
        ["keySig", "fifths"],
        ["keySignature", "fifths"],
        ["key_signature", "fifths"]
    ];
    var MODE_PATHS = [
        ["attributes", "key", "mode"],
        ["attributes", "keySig", "mode"],
        ["attributes", "keySignature", "mode"],
        ["attributes", "key_signature", "mode"],
        // sometimes normalized into attributes
        ["attributes", "key_mode"],
        ["attributes", "mode"],
        ["key", "mode"],
        ["keySig", "mode"],
        ["keySignature", "mode"],
        ["key_signature", "mode"]
    ];
    for (var _i = 0, parts_3 = parts; _i < parts_3.length; _i++) {
        var p = parts_3[_i];
        var measures = (_b = p === null || p === void 0 ? void 0 : p.measures) !== null && _b !== void 0 ? _b : [];
        for (var mi = 0; mi < Math.min(measures.length, maxMeasureScan); mi++) {
            var m = measures[mi];
            var fifths = null;
            for (var _c = 0, PATHS_1 = PATHS; _c < PATHS_1.length; _c++) {
                var path = PATHS_1[_c];
                fifths = asFiniteNumber(getByPath(m, path));
                if (fifths !== null)
                    break;
            }
            if (fifths === null)
                continue;
            var mode = null;
            for (var _d = 0, MODE_PATHS_1 = MODE_PATHS; _d < MODE_PATHS_1.length; _d++) {
                var path = MODE_PATHS_1[_d];
                mode = asMode(getByPath(m, path));
                if (mode)
                    break;
            }
            return { fifths: fifths, mode: mode };
        }
    }
    return null;
}
function keyFromFifths(fifths, mode) {
    var _a, _b;
    var MAJOR_BY_FIFTHS = (_a = {},
        _a[-7] = "Cb",
        _a[-6] = "Gb",
        _a[-5] = "Db",
        _a[-4] = "Ab",
        _a[-3] = "Eb",
        _a[-2] = "Bb",
        _a[-1] = "F",
        _a[0] = "C",
        _a[1] = "G",
        _a[2] = "D",
        _a[3] = "A",
        _a[4] = "E",
        _a[5] = "B",
        _a[6] = "F#",
        _a[7] = "C#",
        _a);
    var MINOR_BY_FIFTHS = (_b = {},
        _b[-7] = "Ab",
        _b[-6] = "Eb",
        _b[-5] = "Bb",
        _b[-4] = "F",
        _b[-3] = "C",
        _b[-2] = "G",
        _b[-1] = "D",
        _b[0] = "A",
        _b[1] = "E",
        _b[2] = "B",
        _b[3] = "F#",
        _b[4] = "C#",
        _b[5] = "G#",
        _b[6] = "D#",
        _b[7] = "A#",
        _b);
    var tonic = mode === "major" ? MAJOR_BY_FIFTHS[fifths] : MINOR_BY_FIFTHS[fifths];
    if (!tonic)
        return null;
    return { tonic: tonic, mode: mode, confidence: 1 };
}
/**
 * Use key signature if present. If key signature has no mode, choose major vs minor using histogram fit.
 */
function keyFromScoreModelKeySignature(score, hist) {
    var ks = findFirstKeySig(score);
    if (!ks)
        return null;
    var fifths = ks.fifths;
    var mode = ks.mode;
    if (mode) {
        var k = keyFromFifths(fifths, mode);
        return k ? __assign({}, k) : null;
    }
    var maj = keyFromFifths(fifths, "major");
    var min = keyFromFifths(fifths, "minor");
    if (!maj || !min)
        return maj ? __assign({}, maj) : min ? __assign({}, min) : null;
    var MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
    var HARM_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];
    var majPc = noteNameToPc(maj.tonic);
    var minPc = noteNameToPc(min.tonic);
    if (majPc === null || minPc === null)
        return __assign({}, maj);
    function fit(tonicPc, rel) {
        var _a;
        var allowed = new Set(rel.map(function (d) { return normPc(tonicPc + d); }));
        var inside = 0;
        var outside = 0;
        for (var pc = 0; pc < 12; pc++) {
            var c = (_a = hist[pc]) !== null && _a !== void 0 ? _a : 0;
            if (allowed.has(pc))
                inside += c;
            else
                outside += c;
        }
        return inside - outside * 0.75;
    }
    var sMaj = fit(majPc, MAJOR_SCALE);
    var sMin = fit(minPc, HARM_MINOR_SCALE);
    return sMin > sMaj ? __assign({}, min) : __assign({}, maj);
}
function applyCadential64LabelingBeatwise(beats, key, warnings) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r;
    var domPc = dominantPcFromKey(key);
    var byMeasure = new Map();
    for (var _i = 0, beats_1 = beats; _i < beats_1.length; _i++) {
        var b = beats_1[_i];
        var arr = (_a = byMeasure.get(b.measureNumber)) !== null && _a !== void 0 ? _a : [];
        arr.push(b);
        byMeasure.set(b.measureNumber, arr);
    }
    var measureNums = Array.from(byMeasure.keys()).sort(function (a, b) { return a - b; });
    for (var i = 0; i < measureNums.length - 1; i++) {
        var m = measureNums[i];
        var mNext = measureNums[i + 1];
        var cur = ((_b = byMeasure.get(m)) !== null && _b !== void 0 ? _b : []).slice().sort(function (a, b) { return a.beatNumber - b.beatNumber; });
        var next = ((_c = byMeasure.get(mNext)) !== null && _c !== void 0 ? _c : []).slice().sort(function (a, b) { return a.beatNumber - b.beatNumber; });
        if (cur.length === 0 || next.length === 0)
            continue;
        var lastNonNC = null;
        for (var k = cur.length - 1; k >= 0; k--) {
            var r = String((_f = (_e = (_d = cur[k]) === null || _d === void 0 ? void 0 : _d.roman) === null || _e === void 0 ? void 0 : _e.roman) !== null && _f !== void 0 ? _f : "");
            if (!looksLikeNC(r)) {
                lastNonNC = cur[k];
                break;
            }
        }
        if (!lastNonNC)
            continue;
        var lastRoman = String((_h = (_g = lastNonNC.roman) === null || _g === void 0 ? void 0 : _g.roman) !== null && _h !== void 0 ? _h : "");
        if (!looksLikeI64(lastRoman))
            continue;
        var firstNonNCNext = null;
        for (var k = 0; k < next.length; k++) {
            var r = String((_l = (_k = (_j = next[k]) === null || _j === void 0 ? void 0 : _j.roman) === null || _k === void 0 ? void 0 : _k.roman) !== null && _l !== void 0 ? _l : "");
            if (!looksLikeNC(r)) {
                firstNonNCNext = next[k];
                break;
            }
        }
        if (!firstNonNCNext)
            continue;
        var nextRoman = String((_o = (_m = firstNonNCNext.roman) === null || _m === void 0 ? void 0 : _m.roman) !== null && _o !== void 0 ? _o : "");
        if (!looksLikeVish(nextRoman))
            continue;
        if (domPc !== null) {
            var bpc = getBassPcFromItem(lastNonNC);
            if (bpc === null || normPc(bpc) !== domPc) {
                warnings.push({
                    atMeasure: m,
                    type: "cadential64_skipped",
                    message: "Skipped cadential 6/4 relabel at measure ".concat(m, ": bassPc is not dominant for key ").concat(String((_p = key === null || key === void 0 ? void 0 : key.tonic) !== null && _p !== void 0 ? _p : "?"), "."),
                    expected: "bassPc=".concat(domPc),
                    found: bpc === null ? "bassPc=null" : "bassPc=".concat(normPc(bpc))
                });
                continue;
            }
        }
        for (var _s = 0, cur_1 = cur; _s < cur_1.length; _s++) {
            var b = cur_1[_s];
            var r = String((_r = (_q = b === null || b === void 0 ? void 0 : b.roman) === null || _q === void 0 ? void 0 : _q.roman) !== null && _r !== void 0 ? _r : "");
            if (looksLikeI64(r))
                relabelAsV64(b);
        }
    }
}
function applyCadential64LabelingMeasurewise(measures, key, warnings) {
    var _a, _b, _c, _d, _e, _f, _g;
    var domPc = dominantPcFromKey(key);
    for (var i = 0; i < measures.length - 1; i++) {
        var cur = measures[i];
        var next = measures[i + 1];
        var curRoman = String((_b = (_a = cur === null || cur === void 0 ? void 0 : cur.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "");
        var nextRoman = String((_d = (_c = next === null || next === void 0 ? void 0 : next.roman) === null || _c === void 0 ? void 0 : _c.roman) !== null && _d !== void 0 ? _d : "");
        if (!looksLikeI64(curRoman))
            continue;
        if (!looksLikeVish(nextRoman))
            continue;
        if (domPc !== null) {
            var bpc = getBassPcFromItem(cur);
            if (bpc === null || normPc(bpc) !== domPc) {
                warnings.push({
                    atMeasure: Number((_e = cur === null || cur === void 0 ? void 0 : cur.measureNumber) !== null && _e !== void 0 ? _e : i + 1),
                    type: "cadential64_skipped",
                    message: "Skipped cadential 6/4 relabel at measure ".concat(Number((_f = cur === null || cur === void 0 ? void 0 : cur.measureNumber) !== null && _f !== void 0 ? _f : i + 1), ": bassPc is not dominant for key ").concat(String((_g = key === null || key === void 0 ? void 0 : key.tonic) !== null && _g !== void 0 ? _g : "?"), "."),
                    expected: "bassPc=".concat(domPc),
                    found: bpc === null ? "bassPc=null" : "bassPc=".concat(normPc(bpc))
                });
                continue;
            }
        }
        relabelAsV64(cur);
    }
}
function buildMeasureSnapshotsFromBeats(beats, measureCount) {
    var _a, _b, _c, _d, _e;
    var byMeasure = new Map();
    for (var _i = 0, beats_2 = beats; _i < beats_2.length; _i++) {
        var b = beats_2[_i];
        var arr = (_a = byMeasure.get(b.measureNumber)) !== null && _a !== void 0 ? _a : [];
        arr.push(b);
        byMeasure.set(b.measureNumber, arr);
    }
    var out = [];
    for (var m = 1; m <= measureCount; m++) {
        var arr = ((_b = byMeasure.get(m)) !== null && _b !== void 0 ? _b : []).slice().sort(function (a, b) { return a.beatNumber - b.beatNumber; });
        if (arr.length === 0)
            continue;
        var pick = null;
        for (var k = arr.length - 1; k >= 0; k--) {
            var r = String((_e = (_d = (_c = arr[k]) === null || _c === void 0 ? void 0 : _c.roman) === null || _d === void 0 ? void 0 : _d.roman) !== null && _e !== void 0 ? _e : "");
            if (!looksLikeNC(r)) {
                pick = arr[k];
                break;
            }
        }
        if (!pick)
            pick = arr[arr.length - 1];
        out.push({ measureNumber: m, chord: pick.chord, roman: pick.roman, __romanSuppressed: pick.__romanSuppressed });
    }
    return out;
}
function promoteBorrowedMixture(roman, chord, key) {
    var _a, _b, _c, _d, _e, _f;
    var mode = String((_a = key === null || key === void 0 ? void 0 : key.mode) !== null && _a !== void 0 ? _a : "").toLowerCase();
    if (mode !== "major")
        return roman;
    var degree = typeof (roman === null || roman === void 0 ? void 0 : roman.degree) === "number" ? roman.degree : null;
    var quality = String((_b = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _b !== void 0 ? _b : "").toLowerCase();
    if (!degree)
        return roman;
    if (degree === 3 && quality === "maj")
        return __assign(__assign({}, roman), { roman: "bIII", functionTag: (_c = roman.functionTag) !== null && _c !== void 0 ? _c : "tonic" });
    if (degree === 4 && quality === "min")
        return __assign(__assign({}, roman), { roman: "iv", functionTag: (_d = roman.functionTag) !== null && _d !== void 0 ? _d : "predominant" });
    if (degree === 6 && quality === "maj")
        return __assign(__assign({}, roman), { roman: "bVI", functionTag: (_e = roman.functionTag) !== null && _e !== void 0 ? _e : "predominant" });
    if (degree === 7 && quality === "maj")
        return __assign(__assign({}, roman), { roman: "bVII", functionTag: (_f = roman.functionTag) !== null && _f !== void 0 ? _f : "predominant" });
    return roman;
}
function expectedTargetFromSecondary(roman) {
    var _a;
    var sec = String((_a = roman === null || roman === void 0 ? void 0 : roman.secondaryOf) !== null && _a !== void 0 ? _a : "").trim();
    return sec ? sec : null;
}
function romanMatchesTarget(r, target) {
    var a = String(r !== null && r !== void 0 ? r : "").replace(/\s+/g, "");
    var t = String(target !== null && target !== void 0 ? target : "").replace(/\s+/g, "");
    if (!a || !t)
        return false;
    if (a === t)
        return true;
    if (a.startsWith(t))
        return true;
    if (a.includes("/") && a.split("/").pop() === t)
        return true;
    return false;
}
function isAllowedSecondaryRedirect(curRoman, target, nextRoman, key) {
    var _a;
    var mode = String((_a = key === null || key === void 0 ? void 0 : key.mode) !== null && _a !== void 0 ? _a : "").toLowerCase();
    if (mode !== "major")
        return false;
    var cur = String(curRoman !== null && curRoman !== void 0 ? curRoman : "").replace(/\s+/g, "");
    var tgt = String(target !== null && target !== void 0 ? target : "").replace(/\s+/g, "");
    var nxt = String(nextRoman !== null && nextRoman !== void 0 ? nextRoman : "").replace(/\s+/g, "");
    if (tgt === "V" && cur.startsWith("V") && nxt.startsWith("vi"))
        return true;
    return false;
}
function trackSecondaryResolutionsBeatwise(beats, key, warnings) {
    var _a, _b, _c, _d, _e;
    var isNC = function (x) { var _a, _b; return looksLikeNC(String((_b = (_a = x === null || x === void 0 ? void 0 : x.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "")); };
    for (var i = 0; i < beats.length; i++) {
        var cur = beats[i];
        var target = expectedTargetFromSecondary(cur === null || cur === void 0 ? void 0 : cur.roman);
        if (!target)
            continue;
        var j = i + 1;
        while (j < beats.length && isNC(beats[j]))
            j++;
        if (j >= beats.length) {
            warnings.push({
                atMeasure: cur.measureNumber,
                atBeat: cur.beatNumber,
                type: "secondary_resolution",
                message: "Secondary function did not resolve: expected ".concat(target, ", but no next harmonic event found."),
                expected: target,
                found: "end_of_sequence"
            });
            continue;
        }
        var nextRoman = String((_c = (_b = (_a = beats[j]) === null || _a === void 0 ? void 0 : _a.roman) === null || _b === void 0 ? void 0 : _b.roman) !== null && _c !== void 0 ? _c : "");
        if (!romanMatchesTarget(nextRoman, target)) {
            var curRoman = String((_e = (_d = cur === null || cur === void 0 ? void 0 : cur.roman) === null || _d === void 0 ? void 0 : _d.roman) !== null && _e !== void 0 ? _e : "");
            if (isAllowedSecondaryRedirect(curRoman, target, nextRoman, key))
                continue;
            warnings.push({
                atMeasure: cur.measureNumber,
                atBeat: cur.beatNumber,
                type: "secondary_resolution",
                message: "Secondary function did not resolve as expected: expected ".concat(target, ", found ").concat(nextRoman, "."),
                expected: target,
                found: nextRoman
            });
        }
    }
}
function trackSecondaryResolutionsMeasurewise(measures, key, warnings) {
    var _a, _b, _c, _d, _e;
    var isNC = function (x) { var _a, _b; return looksLikeNC(String((_b = (_a = x === null || x === void 0 ? void 0 : x.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "")); };
    for (var i = 0; i < measures.length; i++) {
        var cur = measures[i];
        var target = expectedTargetFromSecondary(cur === null || cur === void 0 ? void 0 : cur.roman);
        if (!target)
            continue;
        var j = i + 1;
        while (j < measures.length && isNC(measures[j]))
            j++;
        if (j >= measures.length) {
            warnings.push({
                atMeasure: cur.measureNumber,
                type: "secondary_resolution",
                message: "Secondary function did not resolve: expected ".concat(target, ", but no next harmonic event found."),
                expected: target,
                found: "end_of_sequence"
            });
            continue;
        }
        var nextRoman = String((_c = (_b = (_a = measures[j]) === null || _a === void 0 ? void 0 : _a.roman) === null || _b === void 0 ? void 0 : _b.roman) !== null && _c !== void 0 ? _c : "");
        if (!romanMatchesTarget(nextRoman, target)) {
            var curRoman = String((_e = (_d = cur === null || cur === void 0 ? void 0 : cur.roman) === null || _d === void 0 ? void 0 : _d.roman) !== null && _e !== void 0 ? _e : "");
            if (isAllowedSecondaryRedirect(curRoman, target, nextRoman, key))
                continue;
            warnings.push({
                atMeasure: cur.measureNumber,
                type: "secondary_resolution",
                message: "Secondary function did not resolve as expected: expected ".concat(target, ", found ").concat(nextRoman, "."),
                expected: target,
                found: nextRoman
            });
        }
    }
}
function applySustainCarryToBeats(beats, sustainPolicy) {
    var _a, _b;
    if (sustainPolicy === "none")
        return;
    var lastNonNC = null;
    for (var i = 0; i < beats.length; i++) {
        var b = beats[i];
        var r = String((_b = (_a = b === null || b === void 0 ? void 0 : b.roman) === null || _a === void 0 ? void 0 : _a.roman) !== null && _b !== void 0 ? _b : "");
        if (!looksLikeNC(r)) {
            lastNonNC = b;
            continue;
        }
        // Do not overwrite a roman that we intentionally suppressed.
        if (b.__romanSuppressed)
            continue;
        if (!lastNonNC)
            continue;
        b.chord = lastNonNC.chord;
        b.roman = lastNonNC.roman;
    }
}
function isTriadQuality(q) {
    var x = String(q !== null && q !== void 0 ? q : "").toLowerCase();
    return x === "maj" || x === "min";
}
function isDominantOf(domRootPc, tonicRootPc) {
    return normPc(domRootPc) === normPc(tonicRootPc + 7);
}
/**
 * Confidence helpers (Roman suppression)
 *
 * We use chord.detect confidence if present.
 * Fallback rules are conservative: only mark low confidence when the chord is obviously ambiguous.
 */
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    if (x < 0)
        return 0;
    if (x > 1)
        return 1;
    return x;
}
function chordConfidence(chord) {
    var _a;
    var c1 = typeof (chord === null || chord === void 0 ? void 0 : chord.confidence) === "number" ? chord.confidence : null;
    var c2 = typeof (chord === null || chord === void 0 ? void 0 : chord.score) === "number" ? chord.score : null;
    var c3 = typeof (chord === null || chord === void 0 ? void 0 : chord.matchScore) === "number" ? chord.matchScore : null;
    if (c1 !== null)
        return clamp01(c1);
    if (c2 !== null)
        return clamp01(c2);
    if (c3 !== null)
        return clamp01(c3);
    var qSeen = String((_a = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var rootOk = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" && Number.isFinite(chord.rootPc);
    var pcs = Array.isArray(chord === null || chord === void 0 ? void 0 : chord.pcs) ? chord.pcs : [];
    // If detectChord couldn't really decide, treat as low confidence
    if (!rootOk)
        return 0.2;
    if (qSeen === "unknown")
        return 0.25;
    if (pcs.length <= 1)
        return 0.25;
    // If we have a named, rooted chord, assume reasonable confidence
    return 0.9;
}
function makeNCRoman(notes) {
    return {
        roman: "N.C.",
        degree: null,
        functionTag: "other",
        notes: Array.isArray(notes) ? notes : []
    };
}
function maybeSuppressRoman(params) {
    var _a, _b, _c;
    var chord = params.chord, roman = params.roman, notes = params.notes, minConfidence = params.minConfidence, enable = params.enable, warnings = params.warnings, atMeasure = params.atMeasure, atBeat = params.atBeat;
    if (!enable)
        return { roman: roman, suppressed: false };
    var r = String((_a = roman === null || roman === void 0 ? void 0 : roman.roman) !== null && _a !== void 0 ? _a : "");
    if (!r || looksLikeNC(r))
        return { roman: roman, suppressed: false };
    var conf = chordConfidence(chord);
    if (conf >= minConfidence)
        return { roman: roman, suppressed: false };
    var chordName = String((_b = chord === null || chord === void 0 ? void 0 : chord.name) !== null && _b !== void 0 ? _b : "");
    var quality = String((_c = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _c !== void 0 ? _c : "");
    var pcs = Array.isArray(chord === null || chord === void 0 ? void 0 : chord.pcs) ? chord.pcs : [];
    warnings.push({
        atMeasure: atMeasure,
        atBeat: atBeat,
        type: "low_confidence_roman_suppressed",
        message: "Suppressed roman numeral due to low chord confidence (".concat(conf.toFixed(3), " < ").concat(minConfidence.toFixed(3), ")."),
        expected: "confidence>=".concat(minConfidence.toFixed(3)),
        found: "confidence=".concat(conf.toFixed(3), " roman=").concat(r, " chord=").concat(chordName || "?", " quality=").concat(quality || "?", " pcs=").concat(JSON.stringify(pcs))
    });
    return { roman: makeNCRoman(notes), suppressed: true };
}
/**
 * Phase 4 key stabilizer:
 * If the ending shows a dominant -> tonic cadence (by chord roots), anchor the key to that tonic.
 * This uses chord roots + quality only, so it does not depend on roman output.
 */
function anchorKeyFromCadenceIfNeeded(params) {
    var _a, _b, _c;
    var score = params.score, measureCount = params.measureCount, ignorePercussion = params.ignorePercussion, key = params.key, keySig = params.keySig, hadKeySig = params.hadKeySig, hadMetaKey = params.hadMetaKey, hadForceKey = params.hadForceKey;
    if (hadForceKey)
        return key;
    if (hadMetaKey)
        return key;
    if (hadKeySig)
        return key;
    var curConf = typeof (key === null || key === void 0 ? void 0 : key.confidence) === "number" ? key.confidence : 0;
    if (curConf >= 0.995)
        return key;
    var lastChords = [];
    for (var mi = measureCount - 1; mi >= 0 && lastChords.length < 6; mi--) {
        var _d = collectMeasurePcsAndBassPc(score, mi, ignorePercussion), pcs = _d.pcs, bassPc = _d.bassPc;
        if (!pcs || pcs.length === 0)
            continue;
        var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, true, bassPc);
        if (!chord)
            continue;
        if (typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) !== "number")
            continue;
        lastChords.push(chord);
    }
    if (lastChords.length < 2)
        return key;
    var last = lastChords[0];
    var prev = lastChords[1];
    var lastQ = String((_a = last === null || last === void 0 ? void 0 : last.quality) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var prevQ = String((_b = prev === null || prev === void 0 ? void 0 : prev.quality) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var lastRoot = typeof (last === null || last === void 0 ? void 0 : last.rootPc) === "number" ? last.rootPc : null;
    var prevRoot = typeof (prev === null || prev === void 0 ? void 0 : prev.rootPc) === "number" ? prev.rootPc : null;
    if (lastRoot === null || prevRoot === null)
        return key;
    if (!isTriadQuality(lastQ))
        return key;
    var prevIsDom7 = prevQ === "dom7";
    var prevIsTriad = isTriadQuality(prevQ);
    if (!(prevIsDom7 || prevIsTriad))
        return key;
    if (!isDominantOf(prevRoot, lastRoot))
        return key;
    var preferSharps = preferSharpsFromKeySigOrTonic(keySig, (_c = key === null || key === void 0 ? void 0 : key.tonic) !== null && _c !== void 0 ? _c : null);
    var tonicName = (0, pitch_1.pcToName)(lastRoot, preferSharps);
    var mode = lastQ === "maj" ? "major" : "minor";
    return {
        tonic: tonicName,
        mode: mode,
        confidence: Math.max(curConf, 0.995)
    };
}
/**
 * Phase 0 key stabilizer for short excerpts with no key signature/meta.
 * (Only runs when hadKeySig/hadMetaKey/hadForceKey are false.)
 */
function anchorKeyToFinalTriadIfNeeded(params) {
    var _a, _b, _c, _d, _e, _f;
    var score = params.score, measureCount = params.measureCount, ignorePercussion = params.ignorePercussion, key = params.key, keySig = params.keySig, hadKeySig = params.hadKeySig, hadMetaKey = params.hadMetaKey, hadForceKey = params.hadForceKey;
    if (hadForceKey)
        return key;
    if (hadMetaKey)
        return key;
    if (hadKeySig)
        return key;
    var curConf = typeof (key === null || key === void 0 ? void 0 : key.confidence) === "number" ? key.confidence : 0;
    if (curConf >= 0.98)
        return key;
    var lastTriadRoot = null;
    var lastTriadQuality = null;
    for (var mi = measureCount - 1; mi >= 0; mi--) {
        var _g = collectMeasurePcsAndBassPc(score, mi, ignorePercussion), pcs = _g.pcs, bassPc = _g.bassPc;
        if (!pcs || pcs.length === 0)
            continue;
        var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, true, bassPc);
        var q = String((_a = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _a !== void 0 ? _a : "").toLowerCase();
        var rootPc = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : null;
        if (rootPc === null)
            continue;
        if (q !== "maj" && q !== "min")
            continue;
        lastTriadRoot = rootPc;
        lastTriadQuality = q;
        break;
    }
    if (lastTriadRoot === null || lastTriadQuality === null)
        return key;
    // Also find the triad immediately before the last triad (for short-excerpt cadence heuristics).
    var prevTriadRoot = null;
    var prevTriadQuality = null;
    var seenLast = false;
    for (var mi = measureCount - 1; mi >= 0; mi--) {
        var _h = collectMeasurePcsAndBassPc(score, mi, ignorePercussion), pcs = _h.pcs, bassPc = _h.bassPc;
        if (!pcs || pcs.length === 0)
            continue;
        var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, true, bassPc);
        var q = String((_b = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _b !== void 0 ? _b : "").toLowerCase();
        var rootPc = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : null;
        if (rootPc === null)
            continue;
        if (q !== "maj" && q !== "min")
            continue;
        if (!seenLast) {
            seenLast = true;
            continue;
        }
        prevTriadRoot = rootPc;
        prevTriadQuality = q;
        break;
    }
    var firstTriadRoot = null;
    var firstTriadQuality = null;
    for (var mi = 0; mi < measureCount; mi++) {
        var _j = collectMeasurePcsAndBassPc(score, mi, ignorePercussion), pcs = _j.pcs, bassPc = _j.bassPc;
        if (!pcs || pcs.length === 0)
            continue;
        var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, true, bassPc);
        var q = String((_c = chord === null || chord === void 0 ? void 0 : chord.quality) !== null && _c !== void 0 ? _c : "").toLowerCase();
        var rootPc = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : null;
        if (rootPc === null)
            continue;
        if (q !== "maj" && q !== "min")
            continue;
        firstTriadRoot = rootPc;
        firstTriadQuality = q;
        break;
    }
    // Applied dominant to dominant (V/V -> V) at the end of a short excerpt.
    // If prev triad is dominant of last triad, treat last triad as V and infer tonic a fifth below.
    if (measureCount <= 4 &&
        prevTriadRoot !== null &&
        prevTriadQuality !== null &&
        lastTriadQuality === "maj" &&
        isDominantOf(prevTriadRoot, lastTriadRoot)) {
        var preferSharps_1 = preferSharpsFromKeySigOrTonic(keySig, (_d = key === null || key === void 0 ? void 0 : key.tonic) !== null && _d !== void 0 ? _d : null);
        var inferredTonicPc = normPc(lastTriadRoot - 7); // a fifth below last
        var tonicName_1 = (0, pitch_1.pcToName)(inferredTonicPc, preferSharps_1);
        return {
            tonic: tonicName_1,
            mode: "major",
            confidence: Math.max(curConf, 0.99)
        };
    }
    // Short excerpt that ends on V of the opening triad -> anchor to opening triad (half cadence).
    if (firstTriadRoot !== null &&
        firstTriadQuality !== null &&
        measureCount <= 4 &&
        isDominantOf(lastTriadRoot, firstTriadRoot)) {
        var preferSharps_2 = preferSharpsFromKeySigOrTonic(keySig, (_e = key === null || key === void 0 ? void 0 : key.tonic) !== null && _e !== void 0 ? _e : null);
        var tonicName_2 = (0, pitch_1.pcToName)(firstTriadRoot, preferSharps_2);
        return {
            tonic: tonicName_2,
            mode: firstTriadQuality === "maj" ? "major" : "minor",
            confidence: Math.max(curConf, 0.99)
        };
    }
    var preferSharps = preferSharpsFromKeySigOrTonic(keySig, (_f = key === null || key === void 0 ? void 0 : key.tonic) !== null && _f !== void 0 ? _f : null);
    var tonicName = (0, pitch_1.pcToName)(lastTriadRoot, preferSharps);
    return {
        tonic: tonicName,
        mode: lastTriadQuality === "maj" ? "major" : "minor",
        confidence: Math.max(curConf, 0.99)
    };
}
function analyzeHarmony(req) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    try {
        var score = req === null || req === void 0 ? void 0 : req.scoreModel;
        if (!score)
            return { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." };
        var options = ((_a = req === null || req === void 0 ? void 0 : req.options) !== null && _a !== void 0 ? _a : {});
        var granularity = options.granularity === "beat" ? "beat" : "measure";
        var maxMeasures = typeof options.maxMeasures === "number" ? options.maxMeasures : 128;
        var ignorePercussion = options.ignorePercussion === true;
        var sustainPolicy = sendSustainPolicy(options.sustainPolicy);
        var romanMinConfidence = typeof options.romanMinConfidence === "number" && Number.isFinite(options.romanMinConfidence)
            ? clamp01(options.romanMinConfidence)
            : 0.55;
        var suppressLowConfidenceRoman = options.suppressLowConfidenceRoman !== false;
        var measureCount = Math.min(getMeasureCount(score), maxMeasures);
        if (measureCount <= 0) {
            return { ok: false, error: "scoreModel has no measures in parts[0]. Harmony analysis requires measures." };
        }
        var warnings = [];
        var hist = collectHistogram(score, measureCount, ignorePercussion);
        var metaKey = (_f = (_d = (_c = (_b = score === null || score === void 0 ? void 0 : score.meta) === null || _b === void 0 ? void 0 : _b.harmony) === null || _c === void 0 ? void 0 : _c.key) !== null && _d !== void 0 ? _d : (_e = score === null || score === void 0 ? void 0 : score.meta) === null || _e === void 0 ? void 0 : _e.key) !== null && _f !== void 0 ? _f : null;
        var preferKeyFromMeta = options.preferKeyFromMeta !== false;
        var hadForceKey = !!(((_g = options.forceKey) === null || _g === void 0 ? void 0 : _g.tonic) && (options.forceKey.mode === "major" || options.forceKey.mode === "minor"));
        var hadMetaKey = !!(preferKeyFromMeta && metaKey);
        // IMPORTANT: compute keySig first and use it for hadKeySig.
        var keySig = findFirstKeySig(score);
        var hadKeySig = !!keySig;
        var key = null;
        // If there is an explicit key signature with mode, lock to it.
        if (!hadForceKey && !hadMetaKey && hadKeySig && (keySig === null || keySig === void 0 ? void 0 : keySig.mode)) {
            var k = keyFromFifths(keySig.fifths, keySig.mode);
            key = k ? __assign({}, k) : null;
        }
        if (hadForceKey) {
            key = { tonic: options.forceKey.tonic, mode: options.forceKey.mode, confidence: 1 };
        }
        else if (hadMetaKey) {
            key = (0, keyEstimate_1.keyFromMetaOrBestGuess)(metaKey, hist, true);
        }
        else if (!key) {
            // If signature exists but mode unknown, fall back to histogram fit between relative major/minor for that signature.
            key = (_h = keyFromScoreModelKeySignature(score, hist)) !== null && _h !== void 0 ? _h : (0, keyEstimate_1.keyFromMetaOrBestGuess)(null, hist, true);
        }
        // Only run stabilizers if we do NOT have a real key signature/meta/force.
        key = anchorKeyFromCadenceIfNeeded({
            score: score,
            measureCount: measureCount,
            ignorePercussion: ignorePercussion,
            key: key,
            keySig: keySig,
            hadKeySig: hadKeySig,
            hadMetaKey: hadMetaKey,
            hadForceKey: hadForceKey
        });
        key = anchorKeyToFinalTriadIfNeeded({
            score: score,
            measureCount: measureCount,
            ignorePercussion: ignorePercussion,
            key: key,
            keySig: keySig,
            hadKeySig: hadKeySig,
            hadMetaKey: hadMetaKey,
            hadForceKey: hadForceKey
        });
        var preferSharps = preferSharpsFromKeySigOrTonic(keySig, (_j = key === null || key === void 0 ? void 0 : key.tonic) !== null && _j !== void 0 ? _j : null);
        if (granularity === "measure") {
            var measures = [];
            for (var mi = 0; mi < measureCount; mi++) {
                var _l = collectMeasurePcsAndBassPc(score, mi, ignorePercussion), pcs = _l.pcs, bassPc = _l.bassPc;
                var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, preferSharps, bassPc);
                var notes = (0, roman_1.chordNotesToNames)(chord.pcs, preferSharps);
                var roman = (0, roman_1.analyzeRomanNumeral)(chord, key, notes);
                roman = promoteBorrowedMixture(roman, chord, key);
                var maybe = maybeSuppressRoman({
                    chord: chord,
                    roman: roman,
                    notes: notes,
                    minConfidence: romanMinConfidence,
                    enable: suppressLowConfidenceRoman,
                    warnings: warnings,
                    atMeasure: mi + 1
                });
                measures.push({
                    measureNumber: mi + 1,
                    chord: chord,
                    roman: maybe.roman,
                    __romanSuppressed: maybe.suppressed
                });
            }
            applyCadential64LabelingMeasurewise(measures, key, warnings);
            trackSecondaryResolutionsMeasurewise(measures, key, warnings);
            var cadences_1 = (0, cadence_1.detectCadences)(measures);
            return {
                ok: true,
                engine: {
                    phase: "4.2",
                    granularity: "measure",
                    romanNumerals: true,
                    tonicizations: "brief",
                    sustainPolicy: sustainPolicy,
                    romanMinConfidence: romanMinConfidence,
                    suppressLowConfidenceRoman: suppressLowConfidenceRoman
                },
                key: key,
                measures: measures,
                cadences: cadences_1,
                warnings: warnings
            };
        }
        var beats = [];
        for (var mi = 0; mi < measureCount; mi++) {
            var beatsPerMeasure = getBeatsPerMeasure(score, mi);
            for (var b = 1; b <= beatsPerMeasure; b++) {
                var _m = collectBeatPcsAndBassPc(score, mi, b, ignorePercussion), pcs = _m.pcs, bassPc = _m.bassPc;
                var chord = (0, chordDetect_1.detectChordFromPcs)(pcs, preferSharps, bassPc);
                var notes = (0, roman_1.chordNotesToNames)(chord.pcs, preferSharps);
                var roman = (0, roman_1.analyzeRomanNumeral)(chord, key, notes);
                roman = promoteBorrowedMixture(roman, chord, key);
                var maybe = maybeSuppressRoman({
                    chord: chord,
                    roman: roman,
                    notes: notes,
                    minConfidence: romanMinConfidence,
                    enable: suppressLowConfidenceRoman,
                    warnings: warnings,
                    atMeasure: mi + 1,
                    atBeat: b
                });
                beats.push({
                    measureNumber: mi + 1,
                    beatNumber: b,
                    chord: chord,
                    roman: maybe.roman,
                    __romanSuppressed: maybe.suppressed
                });
            }
        }
        applySustainCarryToBeats(beats, sustainPolicy);
        applyCadential64LabelingBeatwise(beats, key, warnings);
        trackSecondaryResolutionsBeatwise(beats, key, warnings);
        var measureSnapshots = buildMeasureSnapshotsFromBeats(beats, measureCount);
        var cadences = (0, cadence_1.detectCadences)(measureSnapshots);
        return {
            ok: true,
            engine: {
                phase: "4.2",
                granularity: "beat",
                romanNumerals: true,
                tonicizations: "brief",
                sustainPolicy: sustainPolicy,
                romanMinConfidence: romanMinConfidence,
                suppressLowConfidenceRoman: suppressLowConfidenceRoman
            },
            key: key,
            beats: beats,
            cadences: cadences,
            warnings: warnings
        };
    }
    catch (e) {
        return { ok: false, error: (_k = e === null || e === void 0 ? void 0 : e.message) !== null && _k !== void 0 ? _k : String(e) };
    }
}
