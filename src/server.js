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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
// src/server.ts
var node_http_1 = require("node:http");
var node_process_1 = require("node:process");
var node_fs_1 = require("node:fs");
var musicxmlParser_1 = require("./parsers/musicxmlParser");
// v2 harmony
var harmony_1 = require("./harmony");
// v1 legacy harmony
var harmonyAnalyzer_1 = require("./_legacy/analyze/harmonyAnalyzer");
// SATB harmonizer (new)
var harmonizeSatbFromChords_1 = require("./harmonize/satb/harmonizeSatbFromChords");
var inferChordsFromMelody_1 = require("./harmonize/satb/inferChordsFromMelody");
var chordSymbol_1 = require("./harmonize/satb/chordSymbol");
var instrumentCatalog_1 = require("./instruments/instrumentCatalog");
var applyAppSettings_1 = require("./app/applyAppSettings");
var checkChoralRules_1 = require("./rules/choral/checkChoralRules");
function chordPcsFromSymbolLoose(symbol) {
    var _a, _b;
    var raw = String(symbol || "").trim();
    if (!raw)
        return null;
    var main = (_a = raw.split("/")[0]) !== null && _a !== void 0 ? _a : raw;
    var parsed = (0, chordSymbol_1.parseChordSymbol)(String(main));
    if (!parsed)
        return null;
    return (_b = parsed.pcs) !== null && _b !== void 0 ? _b : null;
}
function extractSonorityPcs(score, measureNumber, t) {
    var _a, _b, _c;
    var out = [];
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var part = parts_1[_i];
        var measures = (_b = part === null || part === void 0 ? void 0 : part.measures) !== null && _b !== void 0 ? _b : [];
        var measure = measures.find(function (m) { return Number(m === null || m === void 0 ? void 0 : m.number) === Number(measureNumber); });
        if (!measure)
            continue;
        var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
        var note = null;
        for (var _d = 0, events_1 = events; _d < events_1.length; _d++) {
            var e = events_1[_d];
            if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                continue;
            var et = Number(e === null || e === void 0 ? void 0 : e.t);
            var ed = Number(e === null || e === void 0 ? void 0 : e.dur);
            if (!Number.isFinite(et) || !Number.isFinite(ed))
                continue;
            if (et <= t && t < et + ed) {
                note = e;
                break;
            }
        }
        if (!note) {
            note = (_c = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e === null || e === void 0 ? void 0 : e.t) === t; })) !== null && _c !== void 0 ? _c : null;
        }
        if (!note)
            continue;
        var midi = typeof (note === null || note === void 0 ? void 0 : note.midi) === "number"
            ? Number(note.midi)
            : (note === null || note === void 0 ? void 0 : note.pitch)
                ? (0, instrumentCatalog_1.pitchToMidi)(note.pitch)
                : null;
        if (typeof midi === "number" && Number.isFinite(midi)) {
            out.push(((midi % 12) + 12) % 12);
        }
    }
    return Array.from(new Set(out));
}
function pitchNameFromPitch(pitch) {
    if (!(pitch === null || pitch === void 0 ? void 0 : pitch.step))
        return null;
    var step = String(pitch.step).toUpperCase();
    var alter = Number.isFinite(pitch.alter) ? Number(pitch.alter) : 0;
    if (alter === 1)
        return "".concat(step, "#");
    if (alter === -1)
        return "".concat(step, "b");
    if (alter === 2)
        return "".concat(step, "##");
    if (alter === -2)
        return "".concat(step, "bb");
    return step;
}
function findBassPitchAt(score, measureNumber, t) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    var pianoPart = (_c = (_b = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.part_id) !== null && _a !== void 0 ? _a : "").toLowerCase() === "p_pno"; })) !== null && _b !== void 0 ? _b : parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("piano"); })) !== null && _c !== void 0 ? _c : null;
    var pickLowestPitchAtTime = function (events) {
        var _a;
        var best = null;
        var bestMidi = null;
        for (var _i = 0, events_3 = events; _i < events_3.length; _i++) {
            var e = events_3[_i];
            if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                continue;
            var et = Number(e === null || e === void 0 ? void 0 : e.t);
            var ed = Number(e === null || e === void 0 ? void 0 : e.dur);
            if (!Number.isFinite(et) || !Number.isFinite(ed))
                continue;
            if (!(et <= t && t < et + ed))
                continue;
            var midi = typeof (e === null || e === void 0 ? void 0 : e.midi) === "number"
                ? Number(e.midi)
                : (e === null || e === void 0 ? void 0 : e.pitch)
                    ? (0, instrumentCatalog_1.pitchToMidi)(e.pitch)
                    : null;
            if (typeof midi !== "number" || !Number.isFinite(midi))
                continue;
            if (bestMidi === null || midi < bestMidi) {
                bestMidi = midi;
                best = e;
            }
        }
        return (_a = best === null || best === void 0 ? void 0 : best.pitch) !== null && _a !== void 0 ? _a : null;
    };
    if (pianoPart) {
        var measures_1 = (_d = pianoPart === null || pianoPart === void 0 ? void 0 : pianoPart.measures) !== null && _d !== void 0 ? _d : [];
        var measure_1 = measures_1.find(function (m) { return Number(m === null || m === void 0 ? void 0 : m.number) === Number(measureNumber); });
        if (!measure_1)
            return null;
        var events_4 = Array.isArray(measure_1 === null || measure_1 === void 0 ? void 0 : measure_1.events) ? measure_1.events : [];
        var staff2 = events_4.filter(function (e) { return Number(e === null || e === void 0 ? void 0 : e.staff) === 2; });
        var pitch = pickLowestPitchAtTime(staff2);
        if (pitch)
            return pitch;
    }
    var bassPart = (_f = (_e = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.part_id) !== null && _a !== void 0 ? _a : "").toLowerCase() === "p_b"; })) !== null && _e !== void 0 ? _e : parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("bass"); })) !== null && _f !== void 0 ? _f : parts[parts.length - 1];
    if (!bassPart)
        return null;
    var measures = (_g = bassPart === null || bassPart === void 0 ? void 0 : bassPart.measures) !== null && _g !== void 0 ? _g : [];
    var measure = measures.find(function (m) { return Number(m === null || m === void 0 ? void 0 : m.number) === Number(measureNumber); });
    if (!measure)
        return null;
    var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
    var note = null;
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var e = events_2[_i];
        if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
            continue;
        var et = Number(e === null || e === void 0 ? void 0 : e.t);
        var ed = Number(e === null || e === void 0 ? void 0 : e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(ed))
            continue;
        if (et <= t && t < et + ed) {
            note = e;
            break;
        }
    }
    if (!note) {
        note = (_h = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e === null || e === void 0 ? void 0 : e.t) === t; })) !== null && _h !== void 0 ? _h : null;
    }
    return (_j = note === null || note === void 0 ? void 0 : note.pitch) !== null && _j !== void 0 ? _j : null;
}
function parseChordRootAndBass(symbolRaw) {
    var _a, _b, _c, _d;
    var s = String(symbolRaw !== null && symbolRaw !== void 0 ? symbolRaw : "").trim();
    if (!s)
        return null;
    var parts = s.split("/");
    var rootPart = String((_a = parts[0]) !== null && _a !== void 0 ? _a : "").trim();
    var bassPart = String((_b = parts[1]) !== null && _b !== void 0 ? _b : "").trim();
    var rootMatch = rootPart.match(/^([A-Ga-g])([#b]?)/);
    if (!rootMatch)
        return null;
    var root = "".concat(rootMatch[1].toUpperCase()).concat((_c = rootMatch[2]) !== null && _c !== void 0 ? _c : "");
    if (!bassPart)
        return { root: root, bass: root };
    var bassMatch = bassPart.match(/^([A-Ga-g])([#b]?)/);
    if (!bassMatch)
        return { root: root, bass: root };
    var bass = "".concat(bassMatch[1].toUpperCase()).concat((_d = bassMatch[2]) !== null && _d !== void 0 ? _d : "");
    return { root: root, bass: bass };
}
function voiceKeyFromPart(part, index) {
    var _a, _b;
    var name = String((_b = (_a = part === null || part === void 0 ? void 0 : part.name) !== null && _a !== void 0 ? _a : part === null || part === void 0 ? void 0 : part.part_name) !== null && _b !== void 0 ? _b : "").toLowerCase();
    if (name.includes("soprano"))
        return "soprano";
    if (name.includes("alto"))
        return "alto";
    if (name.includes("tenor"))
        return "tenor";
    if (name.includes("bass"))
        return "bass";
    return "part".concat(index + 1);
}
function computeRhythmDensity(score) {
    var voices = {};
    var parts = Array.isArray(score === null || score === void 0 ? void 0 : score.parts) ? score.parts : [];
    parts.forEach(function (part, index) {
        var key = voiceKeyFromPart(part, index);
        var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
        var measureData = measures.map(function (m, i) {
            var evs = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
            var notes = evs.filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note"; }).length;
            var measureNum = Number(m === null || m === void 0 ? void 0 : m.number) || i + 1;
            return { measure: measureNum, notes: notes };
        });
        var totalNotes = measureData.reduce(function (sum, m) { return sum + m.notes; }, 0);
        var avgNotesPerMeasure = measureData.length ? totalNotes / measureData.length : 0;
        voices[key] = { avgNotesPerMeasure: avgNotesPerMeasure, totalNotes: totalNotes, measures: measureData };
    });
    return { voices: voices };
}
var PC_BY_NAME = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11
};
function buildChordDebug(score, chords, inputChordWarnings, options) {
    var _a, _b;
    var pianoMode = (options === null || options === void 0 ? void 0 : options.pianoMode) === true;
    var warnings = [];
    var byMeasure = new Map();
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        var measure = Number(c.measure);
        var t = typeof c.t === "number" ? c.t : 0;
        if (!Number.isFinite(measure))
            continue;
        var list = (_a = byMeasure.get(measure)) !== null && _a !== void 0 ? _a : [];
        list.push({ measure: measure, t: t, symbol: String((_b = c.symbol) !== null && _b !== void 0 ? _b : "") });
        byMeasure.set(measure, list);
    }
    for (var _c = 0, _d = byMeasure.values(); _c < _d.length; _c++) {
        var list = _d[_c];
        list.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
    var mismatches = [];
    var eventMismatches = [];
    var spellingSample = [];
    var spellingMismatches = [];
    var eventBassMismatches = [];
    if (!pianoMode) {
        var _loop_1 = function (measure, list) {
            if (!list.length)
                return "continue";
            var chord = list[0];
            var chordPcs = chordPcsFromSymbolLoose(chord.symbol);
            if (!chordPcs) {
                warnings.push("[chord-check] Could not parse chord symbol \"".concat(chord.symbol, "\" at measure ").concat(measure, "."));
                return "continue";
            }
            var outputPcs = extractSonorityPcs(score, measure, 0);
            if (!outputPcs.length)
                return "continue";
            var bad = outputPcs.filter(function (pc) { return !chordPcs.includes(pc); });
            if (bad.length) {
                mismatches.push({ measure: measure, chord: chord.symbol, chordPcs: chordPcs, outputPcs: outputPcs });
            }
        };
        for (var _e = 0, _f = byMeasure.entries(); _e < _f.length; _e++) {
            var _g = _f[_e], measure = _g[0], list = _g[1];
            _loop_1(measure, list);
        }
    }
    var chordEventsSorted = chords
        .map(function (c) { var _a, _b; return ({ measure: Number(c.measure), t: Number((_a = c.t) !== null && _a !== void 0 ? _a : 0), symbol: String((_b = c.symbol) !== null && _b !== void 0 ? _b : "") }); })
        .filter(function (c) { return Number.isFinite(c.measure) && Number.isFinite(c.t); })
        .sort(function (a, b) { return (a.measure - b.measure) || (a.t - b.t); });
    var _loop_2 = function (c) {
        var parsed = parseChordRootAndBass(c.symbol);
        var chordPcs = chordPcsFromSymbolLoose(c.symbol);
        if (chordPcs) {
            if (!pianoMode) {
                var outputPcs = extractSonorityPcs(score, c.measure, c.t);
                if (outputPcs.length) {
                    var extraPcs = outputPcs.filter(function (pc) { return !chordPcs.includes(pc); });
                    if (extraPcs.length) {
                        eventMismatches.push({
                            measure: c.measure,
                            t: c.t,
                            chord: c.symbol,
                            chordPcs: chordPcs,
                            outputPcs: outputPcs,
                            extraPcs: extraPcs
                        });
                    }
                }
            }
        }
        else {
            warnings.push("[chord-check] Could not parse chord symbol \"".concat(c.symbol, "\" at m").concat(c.measure, " t=").concat(c.t, "."));
        }
        if (!parsed)
            return "continue";
        var expectedBass = parsed.bass;
        var expectedPc = PC_BY_NAME[expectedBass];
        var pitch = findBassPitchAt(score, c.measure, c.t);
        var actualBass = pitchNameFromPitch(pitch);
        if (spellingSample.length < 20) {
            spellingSample.push({
                measure: c.measure,
                t: c.t,
                chord: c.symbol,
                expectedBass: expectedBass,
                actualBass: actualBass !== null && actualBass !== void 0 ? actualBass : null
            });
        }
        if (typeof expectedPc !== "number")
            return "continue";
        if (!actualBass) {
            eventBassMismatches.push({
                measure: c.measure,
                t: c.t,
                chord: c.symbol,
                expectedBass: expectedBass,
                actualBass: null
            });
            return "continue";
        }
        var actualPc = pitch ? (((0, instrumentCatalog_1.pitchToMidi)(pitch) % 12) + 12) % 12 : null;
        if (actualPc === null || actualPc !== expectedPc) {
            eventBassMismatches.push({
                measure: c.measure,
                t: c.t,
                chord: c.symbol,
                expectedBass: expectedBass,
                actualBass: actualBass
            });
            return "continue";
        }
        if (expectedBass !== actualBass && (expectedBass.includes("b") || expectedBass.includes("#"))) {
            spellingMismatches.push({
                measure: c.measure,
                t: c.t,
                chord: c.symbol,
                expectedBass: expectedBass,
                actualBass: actualBass
            });
        }
    };
    for (var _h = 0, chordEventsSorted_1 = chordEventsSorted; _h < chordEventsSorted_1.length; _h++) {
        var c = chordEventsSorted_1[_h];
        _loop_2(c);
    }
    if (inputChordWarnings === null || inputChordWarnings === void 0 ? void 0 : inputChordWarnings.length)
        warnings.push.apply(warnings, inputChordWarnings);
    if (mismatches.length) {
        warnings.push("[chord-check] ".concat(mismatches.length, " measure(s) do not match chord tones at t=0."));
    }
    if (eventBassMismatches.length) {
        warnings.push("[chord-check] ".concat(eventBassMismatches.length, " chord event(s) have bass pitch mismatches."));
    }
    if (spellingMismatches.length) {
        warnings.push("[chord-check] ".concat(spellingMismatches.length, " chord event(s) have bass spelling mismatches."));
    }
    if (eventMismatches.length) {
        warnings.push("[chord-check] ".concat(eventMismatches.length, " chord event(s) include non-chord tones at their onset."));
    }
    return {
        chordEventCount: chords.length,
        chordEventSample: chords.slice(0, 20),
        chordWarnings: inputChordWarnings.length ? inputChordWarnings : undefined,
        chordCheck: {
            measuresChecked: byMeasure.size,
            mismatches: mismatches,
            eventMismatches: eventMismatches.slice(0, 50),
            eventBassMismatches: eventBassMismatches,
            spellingMismatches: spellingMismatches,
            spellingSample: spellingSample
        },
        warnings: warnings
    };
}
function sendJson(res, status, obj) {
    var body = JSON.stringify(obj);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
        "Access-Control-Allow-Headers": "Content-Type"
    });
    res.end(body);
}
function readBody(req) {
    return new Promise(function (resolve, reject) {
        var data = "";
        req.on("data", function (chunk) { return (data += String(chunk)); });
        req.on("end", function () { return resolve(data); });
        req.on("error", reject);
    });
}
function isObject(x) {
    return typeof x === "object" && x !== null && !Array.isArray(x);
}
function asArray(x) {
    if (!Array.isArray(x))
        return null;
    return x;
}
function normalizeHarmonizeReturn(x) {
    // Accept both:
    // - { ok: true, scoreModel }
    // - scoreModel directly
    if (x && typeof x === "object" && "scoreModel" in x)
        return x.scoreModel;
    return x;
}
function normalizeAppSettings(raw) {
    if (!isObject(raw))
        return {};
    var anyRaw = raw;
    var keyFifths = typeof anyRaw.keyFifths === "number" ? anyRaw.keyFifths : undefined;
    var accompanimentType = typeof anyRaw.accompanimentType === "string"
        ? anyRaw.accompanimentType
        : typeof anyRaw.accompaniment === "string"
            ? anyRaw.accompaniment
            : undefined;
    var keySignatureMode = anyRaw.keySignatureMode === "original" || anyRaw.keySignatureMode === "manual"
        ? anyRaw.keySignatureMode
        : undefined;
    var timeSignatureMode = anyRaw.timeSignatureMode === "original" || anyRaw.timeSignatureMode === "manual"
        ? anyRaw.timeSignatureMode
        : undefined;
    return {
        title: typeof anyRaw.title === "string" ? anyRaw.title : undefined,
        ensemble: typeof anyRaw.ensemble === "string" ? anyRaw.ensemble : undefined,
        keySignature: typeof anyRaw.keySignature === "string" ? anyRaw.keySignature : undefined,
        keyFifths: keyFifths,
        keySignatureMode: keySignatureMode,
        targetKey: typeof anyRaw.targetKey === "string" ? anyRaw.targetKey : undefined,
        timeSignature: typeof anyRaw.timeSignature === "string" ? anyRaw.timeSignature : undefined,
        timeSignatureMode: timeSignatureMode,
        tempo: typeof anyRaw.tempo === "number" ? anyRaw.tempo : undefined,
        style: typeof anyRaw.style === "string" ? anyRaw.style : undefined,
        level: typeof anyRaw.level === "string" ? anyRaw.level : undefined,
        accompanimentType: accompanimentType,
        accompaniment: typeof anyRaw.accompaniment === "string" ? anyRaw.accompaniment : undefined,
        ruleStrictness: anyRaw.ruleStrictness === "relaxed" || anyRaw.ruleStrictness === "standard" || anyRaw.ruleStrictness === "strict"
            ? anyRaw.ruleStrictness
            : undefined,
        textureMode: typeof anyRaw.textureMode === "string" ? anyRaw.textureMode : undefined,
        styleProfile: typeof anyRaw.styleProfile === "string" ? anyRaw.styleProfile : undefined,
        modernMode: typeof anyRaw.modernMode === "string" ? anyRaw.modernMode : undefined,
        bassActivity: anyRaw.bassActivity === "grounded" ||
            anyRaw.bassActivity === "less_active" ||
            anyRaw.bassActivity === "active" ||
            anyRaw.bassActivity === "high_active"
            ? anyRaw.bassActivity
            : undefined,
        tenorActivity: anyRaw.tenorActivity === "grounded" ||
            anyRaw.tenorActivity === "less_active" ||
            anyRaw.tenorActivity === "active" ||
            anyRaw.tenorActivity === "high_active"
            ? anyRaw.tenorActivity
            : undefined,
        altoActivity: anyRaw.altoActivity === "grounded" ||
            anyRaw.altoActivity === "less_active" ||
            anyRaw.altoActivity === "active" ||
            anyRaw.altoActivity === "high_active"
            ? anyRaw.altoActivity
            : undefined,
        sopranoActivity: anyRaw.sopranoActivity === "grounded" ||
            anyRaw.sopranoActivity === "less_active" ||
            anyRaw.sopranoActivity === "active" ||
            anyRaw.sopranoActivity === "high_active"
            ? anyRaw.sopranoActivity
            : undefined,
        vln1Activity: anyRaw.vln1Activity === "grounded" ||
            anyRaw.vln1Activity === "less_active" ||
            anyRaw.vln1Activity === "active" ||
            anyRaw.vln1Activity === "high_active"
            ? anyRaw.vln1Activity
            : undefined,
        vln2Activity: anyRaw.vln2Activity === "grounded" ||
            anyRaw.vln2Activity === "less_active" ||
            anyRaw.vln2Activity === "active" ||
            anyRaw.vln2Activity === "high_active"
            ? anyRaw.vln2Activity
            : undefined,
        vlaActivity: anyRaw.vlaActivity === "grounded" ||
            anyRaw.vlaActivity === "less_active" ||
            anyRaw.vlaActivity === "active" ||
            anyRaw.vlaActivity === "high_active"
            ? anyRaw.vlaActivity
            : undefined,
        vcActivity: anyRaw.vcActivity === "grounded" ||
            anyRaw.vcActivity === "less_active" ||
            anyRaw.vcActivity === "active" ||
            anyRaw.vcActivity === "high_active"
            ? anyRaw.vcActivity
            : undefined,
        cbActivity: anyRaw.cbActivity === "grounded" ||
            anyRaw.cbActivity === "less_active" ||
            anyRaw.cbActivity === "active" ||
            anyRaw.cbActivity === "high_active"
            ? anyRaw.cbActivity
            : undefined,
        instrumentation: anyRaw.instrumentation === "auto" ||
            anyRaw.instrumentation === "piano_copy_to_string_quartet" ||
            anyRaw.instrumentation === "satb_to_string_quartet"
            ? anyRaw.instrumentation
            : undefined,
        sopranoMelodyShare: typeof anyRaw.sopranoMelodyShare === "number" && Number.isFinite(anyRaw.sopranoMelodyShare)
            ? anyRaw.sopranoMelodyShare
            : undefined,
        randomizeOffsets: typeof anyRaw.randomizeOffsets === "boolean" ? anyRaw.randomizeOffsets : undefined,
        pianoStylePreset: typeof anyRaw.pianoStylePreset === "string" ? anyRaw.pianoStylePreset : undefined,
        pianoStylePresetPath: typeof anyRaw.pianoStylePresetPath === "string" ? anyRaw.pianoStylePresetPath : undefined,
        useStringEnsembleArranger: typeof anyRaw.useStringEnsembleArranger === "boolean" ? anyRaw.useStringEnsembleArranger : undefined
    };
}
var server = node_http_1.default.createServer(function (req, res) { return __awaiter(void 0, void 0, void 0, function () {
    var url, raw, body, musicxml, scoreModel, score, out, musicxml, scoreModel, score, out, musicxml, scoreModel, score, options, out, musicxml, scoreModel, score, options, out, meta, reqBody, musicxml, scoreModel, settings, filePath, chords, options, accompaniment, accompanimentLower, wantsStrings, wantsWoodwinds, wantsDirectSourceArrangement, textureMode, score, style, parsedChords, chordsToUse, inferredIfEmpty, chordSource, normalized, outScore, inferredChords, chordsForApp, appResult, scoreModelOut, prevMeta, inputChordWarnings, ensembleRaw, isPiano, isStrings, isWoodwinds, chordDebug, ruleCheck, combinedWarnings, harmonizeDebug, timeSig, keySig, meta, e_1;
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10, _11, _12, _13, _14, _15, _16, _17, _18, _19, _20;
    return __generator(this, function (_21) {
        switch (_21.label) {
            case 0:
                _21.trys.push([0, 2, , 3]);
                if (req.method === "OPTIONS") {
                    res.writeHead(204, {
                        "Access-Control-Allow-Origin": "*",
                        "Access-Control-Allow-Methods": "POST,OPTIONS,GET",
                        "Access-Control-Allow-Headers": "Content-Type"
                    });
                    res.end();
                    return [2 /*return*/];
                }
                url = (_a = req.url) !== null && _a !== void 0 ? _a : "/";
                // Health can be GET or POST
                if (url === "/health" && (req.method === "GET" || req.method === "POST")) {
                    sendJson(res, 200, { ok: true, name: "music-engine", status: "up" });
                    return [2 /*return*/];
                }
                if (req.method !== "POST") {
                    sendJson(res, 405, { ok: false, error: "Method not allowed" });
                    return [2 /*return*/];
                }
                return [4 /*yield*/, readBody(req)];
            case 1:
                raw = _21.sent();
                body = raw ? JSON.parse(raw) : {};
                if (!isObject(body)) {
                    sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
                    return [2 /*return*/];
                }
                // ----------------------------
                // v1 analyze harmony (legacy)
                // ----------------------------
                if (url === "/analyze_harmony_v1") {
                    musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
                    scoreModel = (_b = body.scoreModel) !== null && _b !== void 0 ? _b : null;
                    score = null;
                    if (scoreModel)
                        score = scoreModel;
                    if (!score && musicxml)
                        score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    if (!score) {
                        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                        return [2 /*return*/];
                    }
                    out = (0, harmonyAnalyzer_1.analyzeHarmonyPerMeasure)(score);
                    sendJson(res, 200, out);
                    return [2 /*return*/];
                }
                if (url === "/attach_harmony_v1") {
                    musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
                    scoreModel = (_c = body.scoreModel) !== null && _c !== void 0 ? _c : null;
                    score = null;
                    if (scoreModel)
                        score = scoreModel;
                    if (!score && musicxml)
                        score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    if (!score) {
                        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                        return [2 /*return*/];
                    }
                    out = (0, harmonyAnalyzer_1.attachHarmonyToScore)(score);
                    sendJson(res, 200, { ok: true, scoreModel: out });
                    return [2 /*return*/];
                }
                // ----------------------------
                // v2 analyze harmony
                // ----------------------------
                if (url === "/analyze_harmony") {
                    musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
                    scoreModel = (_d = body.scoreModel) !== null && _d !== void 0 ? _d : null;
                    score = null;
                    if (scoreModel)
                        score = scoreModel;
                    if (!score && musicxml)
                        score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    if (!score) {
                        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                        return [2 /*return*/];
                    }
                    options = isObject(body.options) ? body.options : {};
                    out = (0, harmony_1.analyzeHarmony)({ scoreModel: score, options: options });
                    sendJson(res, 200, out);
                    return [2 /*return*/];
                }
                if (url === "/attach_harmony") {
                    musicxml = typeof body.musicxml === "string" ? body.musicxml : null;
                    scoreModel = (_e = body.scoreModel) !== null && _e !== void 0 ? _e : null;
                    score = null;
                    if (scoreModel)
                        score = scoreModel;
                    if (!score && musicxml)
                        score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    if (!score) {
                        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                        return [2 /*return*/];
                    }
                    options = isObject(body.options) ? body.options : {};
                    out = (0, harmony_1.analyzeHarmony)({ scoreModel: score, options: options });
                    meta = __assign(__assign({}, ((_f = score.meta) !== null && _f !== void 0 ? _f : {})), { ensemble: (_h = (_g = score.meta) === null || _g === void 0 ? void 0 : _g.ensemble) !== null && _h !== void 0 ? _h : "unknown", harmony: out });
                    sendJson(res, 200, { ok: true, scoreModel: __assign(__assign({}, score), { meta: meta }) });
                    return [2 /*return*/];
                }
                // ----------------------------
                // SATB harmonize from chords (new)
                // ----------------------------
                if (url === "/harmonize_satb_from_chords") {
                    reqBody = body;
                    musicxml = typeof reqBody.musicxml === "string" ? reqBody.musicxml : null;
                    scoreModel = (_j = reqBody.scoreModel) !== null && _j !== void 0 ? _j : null;
                    settings = normalizeAppSettings(reqBody.settings);
                    filePath = typeof reqBody.filePath === "string" ? reqBody.filePath : null;
                    chords = asArray(reqBody.chords);
                    if (!chords) {
                        sendJson(res, 400, { ok: false, error: "Provide 'chords' as an array (can be empty)." });
                        return [2 /*return*/];
                    }
                    options = isObject(reqBody.options) ? reqBody.options : {};
                    accompaniment = (_m = (_l = (_k = settings.accompanimentType) !== null && _k !== void 0 ? _k : settings.accompaniment) !== null && _l !== void 0 ? _l : reqBody.accompaniment) !== null && _m !== void 0 ? _m : "";
                    accompanimentLower = String(accompaniment).toLowerCase();
                    wantsStrings = String((_o = settings.ensemble) !== null && _o !== void 0 ? _o : "").toLowerCase() === "string_ensemble" ||
                        String((_p = settings.ensemble) !== null && _p !== void 0 ? _p : "").toLowerCase() === "strings";
                    wantsWoodwinds = String((_q = settings.ensemble) !== null && _q !== void 0 ? _q : "").toLowerCase() === "woodwind_ensemble" ||
                        String((_r = settings.ensemble) !== null && _r !== void 0 ? _r : "").toLowerCase() === "woodwinds";
                    wantsDirectSourceArrangement = wantsStrings || wantsWoodwinds;
                    if (wantsDirectSourceArrangement && !musicxml && filePath) {
                        try {
                            musicxml = node_fs_1.default.readFileSync(filePath, "utf8");
                        }
                        catch (_22) {
                            // ignore, fallback to scoreModel if provided
                        }
                    }
                    textureMode = String((_s = settings.textureMode) !== null && _s !== void 0 ? _s : "").toLowerCase();
                    if (textureMode === "polyphony") {
                        options.accompanimentType = "polyphonic";
                    }
                    else if (textureMode === "homophony_homorhythmic" || textureMode === "homophony_melody_accompaniment") {
                        options.accompanimentType = "homophonic";
                    }
                    if (!options.accompanimentType && accompanimentLower) {
                        options.accompanimentType = accompanimentLower;
                    }
                    if (!options.styleProfile && typeof settings.styleProfile === "string") {
                        options.styleProfile = settings.styleProfile;
                    }
                    if (!options.modernMode && typeof settings.modernMode === "string") {
                        options.modernMode = settings.modernMode;
                    }
                    if (String((_t = settings.level) !== null && _t !== void 0 ? _t : "").toLowerCase() === "advanced") {
                        options.tenorMinOverride = 50; // D3
                    }
                    score = null;
                    if (wantsDirectSourceArrangement && musicxml) {
                        score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    }
                    else {
                        if (scoreModel)
                            score = scoreModel;
                        if (!score && musicxml)
                            score = (0, musicxmlParser_1.parseMusicXMLToScoreModel)(musicxml);
                    }
                    if (!score) {
                        sendJson(res, 400, { ok: false, error: "Provide either 'scoreModel' or 'musicxml' in the request body." });
                        return [2 /*return*/];
                    }
                    if (accompanimentLower === "homophonic") {
                        options.tenorRangeOverride = { min: 57, max: 62 }; // A3..D4
                    }
                    if (accompanimentLower === "polyphonic") {
                        if (typeof options.styleProfile !== "string" || !options.styleProfile) {
                            style = String((_u = settings.style) !== null && _u !== void 0 ? _u : "").toLowerCase();
                            if (style === "baroque")
                                options.styleProfile = "baroque";
                            else if (style === "romantic")
                                options.styleProfile = "romantic";
                            else if (style === "classical" || style === "worship")
                                options.styleProfile = "classical";
                            else
                                options.styleProfile = "modern";
                        }
                        if (String(options.styleProfile).toLowerCase() === "modern" && !options.modernMode) {
                            options.modernMode = "modernTonal";
                        }
                    }
                    parsedChords = Array.isArray((_v = score === null || score === void 0 ? void 0 : score.meta) === null || _v === void 0 ? void 0 : _v.inputChords) ? score.meta.inputChords : [];
                    chordsToUse = chords.length ? chords : parsedChords;
                    inferredIfEmpty = !chordsToUse.length ? (0, inferChordsFromMelody_1.inferChordsFromMelody)(score) : [];
                    chordSource = chords.length
                        ? "request"
                        : parsedChords.length
                            ? "musicxml_harmony"
                            : inferredIfEmpty.length
                                ? "inferred"
                                : "none";
                    normalized = void 0;
                    if (wantsDirectSourceArrangement) {
                        normalized = score;
                    }
                    else {
                        outScore = void 0;
                        try {
                            // Try style (1) first
                            outScore = harmonizeSatbFromChords_1.harmonizeSatbFromChords(score, chordsToUse, options);
                        }
                        catch (_23) {
                            // Fallback to style (2)
                            outScore = harmonizeSatbFromChords_1.harmonizeSatbFromChords({
                                scoreModel: score,
                                chords: chordsToUse,
                                options: options
                            });
                        }
                        normalized = normalizeHarmonizeReturn(outScore);
                    }
                    if (!normalized || typeof normalized !== "object") {
                        sendJson(res, 500, { ok: false, error: "Harmonizer returned an invalid scoreModel." });
                        return [2 /*return*/];
                    }
                    inferredChords = Array.isArray((_x = (_w = normalized === null || normalized === void 0 ? void 0 : normalized.meta) === null || _w === void 0 ? void 0 : _w.harmonize) === null || _x === void 0 ? void 0 : _x.chords)
                        ? normalized.meta.harmonize.chords
                        : inferredIfEmpty;
                    chordsForApp = chordsToUse.length ? chordsToUse : inferredChords;
                    appResult = (0, applyAppSettings_1.applyAppSettings)(normalized, settings, chordsForApp);
                    scoreModelOut = appResult.scoreModel;
                    prevMeta = (_y = scoreModelOut.meta) !== null && _y !== void 0 ? _y : {};
                    inputChordWarnings = Array.isArray((_z = score === null || score === void 0 ? void 0 : score.meta) === null || _z === void 0 ? void 0 : _z.inputChordWarnings)
                        ? score.meta.inputChordWarnings
                        : [];
                    ensembleRaw = String((_1 = (_0 = settings.ensemble) !== null && _0 !== void 0 ? _0 : prevMeta.ensemble) !== null && _1 !== void 0 ? _1 : "").toLowerCase();
                    isPiano = ensembleRaw === "piano" ||
                        ensembleRaw === "piano_with_melody" ||
                        ensembleRaw === "grand_piano" ||
                        ensembleRaw === "acoustic_piano";
                    isStrings = ensembleRaw === "string_ensemble" || ensembleRaw === "strings";
                    isWoodwinds = ensembleRaw === "woodwind_ensemble" || ensembleRaw === "woodwinds";
                    chordDebug = buildChordDebug(scoreModelOut, chordsForApp, inputChordWarnings, { pianoMode: isPiano });
                    ruleCheck = { rulesVersion: "choral-v1", violations: [], warnings: [] };
                    if (!isPiano && !isStrings && !isWoodwinds) {
                        try {
                            ruleCheck = (0, checkChoralRules_1.checkChoralRules)(scoreModelOut, chordsForApp, {
                                strictness: settings.ruleStrictness,
                                level: settings.level
                            });
                        }
                        catch (err) {
                            ruleCheck.warnings.push("[rules] Rule check failed: ".concat((_2 = err === null || err === void 0 ? void 0 : err.message) !== null && _2 !== void 0 ? _2 : String(err)));
                        }
                    }
                    combinedWarnings = __spreadArray(__spreadArray(__spreadArray([], ((_3 = appResult.warnings) !== null && _3 !== void 0 ? _3 : []), true), ((_4 = chordDebug.warnings) !== null && _4 !== void 0 ? _4 : []), true), ((_5 = ruleCheck.warnings) !== null && _5 !== void 0 ? _5 : []), true);
                    harmonizeDebug = (_8 = (_7 = (_6 = scoreModelOut === null || scoreModelOut === void 0 ? void 0 : scoreModelOut.meta) === null || _6 === void 0 ? void 0 : _6.harmonize) === null || _7 === void 0 ? void 0 : _7.debug) !== null && _8 !== void 0 ? _8 : {};
                    timeSig = settings.timeSignatureMode === "manual" ? settings.timeSignature : prevMeta.time_signature;
                    keySig = settings.keySignatureMode === "manual" ? settings.keySignature : prevMeta.key;
                    meta = __assign(__assign({}, prevMeta), { title: (_9 = settings.title) !== null && _9 !== void 0 ? _9 : prevMeta.title, ensemble: (_11 = (_10 = settings.ensemble) !== null && _10 !== void 0 ? _10 : prevMeta.ensemble) !== null && _11 !== void 0 ? _11 : "satb", key: keySig !== null && keySig !== void 0 ? keySig : prevMeta.key, time_signature: timeSig !== null && timeSig !== void 0 ? timeSig : prevMeta.time_signature, tempo_bpm: typeof settings.tempo === "number" ? settings.tempo : prevMeta.tempo_bpm, app: {
                            settingsUsed: settings,
                            detectedInputKeyFifths: appResult.detectedInputKeyFifths,
                            detectedInputKeyMode: (_12 = score === null || score === void 0 ? void 0 : score.meta) === null || _12 === void 0 ? void 0 : _12.inputKeyMode,
                            appliedTransposeSemitones: appResult.appliedTransposeSemitones,
                            exporterDivisions: 4,
                            warnings: combinedWarnings,
                            styleUsed: appResult.styleUsed,
                            cadenceMeasures: appResult.cadenceMeasures,
                            chordSource: chordSource,
                            debug: {
                                melodyPartName: (_13 = harmonizeDebug === null || harmonizeDebug === void 0 ? void 0 : harmonizeDebug.melodySource) === null || _13 === void 0 ? void 0 : _13.partName,
                                melodyPartId: (_14 = harmonizeDebug === null || harmonizeDebug === void 0 ? void 0 : harmonizeDebug.melodySource) === null || _14 === void 0 ? void 0 : _14.partId,
                                melodyVoice: (_16 = (_15 = harmonizeDebug === null || harmonizeDebug === void 0 ? void 0 : harmonizeDebug.melodySource) === null || _15 === void 0 ? void 0 : _15.voice) !== null && _16 !== void 0 ? _16 : null,
                                melodyNoteCount: (_17 = harmonizeDebug === null || harmonizeDebug === void 0 ? void 0 : harmonizeDebug.melodyNoteCount) !== null && _17 !== void 0 ? _17 : null,
                                chordEventCount: chordDebug.chordEventCount,
                                chordEventSample: chordDebug.chordEventSample,
                                chordWarnings: chordDebug.chordWarnings,
                                chordCheck: chordDebug.chordCheck,
                                ruleViolations: ruleCheck.violations,
                                ruleWarnings: ruleCheck.warnings,
                                rulesVersion: ruleCheck.rulesVersion,
                                textureAnalysis: (_19 = (_18 = scoreModelOut === null || scoreModelOut === void 0 ? void 0 : scoreModelOut.meta) === null || _18 === void 0 ? void 0 : _18.textureAnalysis) !== null && _19 !== void 0 ? _19 : null,
                                rhythmDensity: computeRhythmDensity(scoreModelOut)
                            }
                        } });
                    scoreModelOut.meta = meta;
                    sendJson(res, 200, { ok: true, scoreModel: scoreModelOut });
                    return [2 /*return*/];
                }
                // --- arrange pipeline (temporarily disabled) ---
                if (url === "/arrange_musicxml") {
                    sendJson(res, 501, {
                        ok: false,
                        error: "Route /arrange_musicxml is temporarily disabled because pipelineMusicxmlToArrangedMusicxml is not wired to a valid file path."
                    });
                    return [2 /*return*/];
                }
                sendJson(res, 404, { ok: false, error: "Unknown route: ".concat(url) });
                return [3 /*break*/, 3];
            case 2:
                e_1 = _21.sent();
                sendJson(res, 500, { ok: false, error: (_20 = e_1 === null || e_1 === void 0 ? void 0 : e_1.message) !== null && _20 !== void 0 ? _20 : String(e_1) });
                return [3 /*break*/, 3];
            case 3: return [2 /*return*/];
        }
    });
}); });
/**
 * Graceful shutdown for dev watcher:
 * - close HTTP server
 * - destroy keep-alive sockets
 * - then exit immediately so tsx watch doesn't force-kill
 */
var sockets = new Set();
server.on("connection", function (socket) {
    sockets.add(socket);
    socket.on("close", function () { return sockets.delete(socket); });
});
var shuttingDown = false;
function shutdown(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    // eslint-disable-next-line no-console
    console.log("[server] received ".concat(signal, ", shutting down..."));
    // Stop accepting new connections
    server.close(function (err) {
        if (err) {
            // eslint-disable-next-line no-console
            console.error("[server] error during server.close:", err);
            node_process_1.default.exit(1);
            return;
        }
        // eslint-disable-next-line no-console
        console.log("[server] http server closed");
        node_process_1.default.exit(0);
    });
    for (var _i = 0, sockets_1 = sockets; _i < sockets_1.length; _i++) {
        var s = sockets_1[_i];
        try {
            s.end();
            s.destroy();
        }
        catch (_a) {
            // ignore
        }
    }
    setTimeout(function () {
        node_process_1.default.exit(0);
    }, 250).unref();
}
node_process_1.default.on("SIGINT", function () { return shutdown("SIGINT"); });
node_process_1.default.on("SIGTERM", function () { return shutdown("SIGTERM"); });
var PORT = Number((_a = node_process_1.default.env.PORT) !== null && _a !== void 0 ? _a : 3001);
server.listen(PORT, function () {
    // eslint-disable-next-line no-console
    console.log("music-engine server listening on http://localhost:".concat(PORT));
});
