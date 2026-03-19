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
exports.checkChoralRules = checkChoralRules;
var node_fs_1 = require("node:fs");
var node_path_1 = require("node:path");
var node_url_1 = require("node:url");
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
var chordSymbol_1 = require("../../harmonize/satb/chordSymbol");
var __filename = (0, node_url_1.fileURLToPath)(import.meta.url);
var __dirname = node_path_1.default.dirname(__filename);
var RULES_DIR = node_path_1.default.join(__dirname);
var cachedRules = null;
function readJson(name) {
    var filePath = node_path_1.default.join(RULES_DIR, name);
    var raw = node_fs_1.default.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
}
function loadRules() {
    if (cachedRules)
        return cachedRules;
    cachedRules = {
        ranges: readJson("ranges.json"),
        spacing: readJson("spacing.json"),
        forbiddenIntervals: readJson("forbiddenIntervals.json")
    };
    return cachedRules;
}
var VOICE_ORDER = ["soprano", "alto", "tenor", "bass"];
var PART_IDS = {
    soprano: "P_S",
    alto: "P_A",
    tenor: "P_T",
    bass: "P_B"
};
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
function findVoicePart(score, voice) {
    var _a;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    var byId = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.part_id) !== null && _a !== void 0 ? _a : "") === PART_IDS[voice]; });
    if (byId)
        return byId;
    var byName = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes(voice); });
    return byName !== null && byName !== void 0 ? byName : null;
}
function getMeasure(part, measureNumber) {
    var _a, _b;
    var measures = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : [];
    return (_b = measures.find(function (m) { return Number(m === null || m === void 0 ? void 0 : m.number) === Number(measureNumber); })) !== null && _b !== void 0 ? _b : null;
}
function getEventMidi(event) {
    if (!event || event.type !== "note")
        return null;
    if (typeof event.midi === "number" && Number.isFinite(event.midi))
        return Number(event.midi);
    if (event.pitch) {
        var midi = (0, instrumentCatalog_1.pitchToMidi)(event.pitch);
        return Number.isFinite(midi) ? midi : null;
    }
    return null;
}
function activeNoteAt(measure, t) {
    var _a;
    if (!measure)
        return null;
    var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var e = events_1[_i];
        if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
            continue;
        var et = Number(e === null || e === void 0 ? void 0 : e.t);
        var ed = Number(e === null || e === void 0 ? void 0 : e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(ed))
            continue;
        if (et <= t && t < et + ed)
            return e;
    }
    return (_a = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e === null || e === void 0 ? void 0 : e.t) === Number(t); })) !== null && _a !== void 0 ? _a : null;
}
function collectOnsetsForMeasure(voiceParts, measureNumber) {
    var set = new Set();
    for (var _i = 0, VOICE_ORDER_1 = VOICE_ORDER; _i < VOICE_ORDER_1.length; _i++) {
        var voice = VOICE_ORDER_1[_i];
        var part = voiceParts[voice];
        if (!part)
            continue;
        var measure = getMeasure(part, measureNumber);
        if (!measure)
            continue;
        var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
        for (var _a = 0, events_2 = events; _a < events_2.length; _a++) {
            var e = events_2[_a];
            var t = Number(e === null || e === void 0 ? void 0 : e.t);
            if (Number.isFinite(t))
                set.add(t);
        }
    }
    if (!set.has(0))
        set.add(0);
    return Array.from(set).sort(function (a, b) { return a - b; });
}
function isPerfectInterval(semitones, allowed) {
    var ic = Math.abs(semitones) % 12;
    return allowed.includes(ic);
}
function tonicPcFromKey(fifths, mode) {
    var major = ((fifths * 7) % 12 + 12) % 12;
    if (mode === "minor")
        return (major + 9) % 12;
    return major;
}
function detectKeyContext(score) {
    var _a, _b, _c;
    var parts = (_a = score === null || score === void 0 ? void 0 : score.parts) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var part = parts_1[_i];
        var measures = (_b = part === null || part === void 0 ? void 0 : part.measures) !== null && _b !== void 0 ? _b : [];
        for (var _d = 0, measures_1 = measures; _d < measures_1.length; _d++) {
            var measure = measures_1[_d];
            var attrs = (_c = measure === null || measure === void 0 ? void 0 : measure.attributes) !== null && _c !== void 0 ? _c : {};
            if (typeof attrs.key_fifths === "number") {
                var mode = typeof attrs.key_mode === "string" ? attrs.key_mode : null;
                return {
                    keyFifths: attrs.key_fifths,
                    keyMode: mode,
                    tonicPc: tonicPcFromKey(attrs.key_fifths, mode)
                };
            }
        }
    }
    return { keyFifths: null, keyMode: null, tonicPc: null };
}
function collectVoiceNotes(part) {
    var _a, _b;
    var list = [];
    var indexByEvent = new Map();
    var measures = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : [];
    for (var _i = 0, measures_2 = measures; _i < measures_2.length; _i++) {
        var measure = measures_2[_i];
        var measureNumber = Number(measure === null || measure === void 0 ? void 0 : measure.number);
        var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
        for (var _c = 0, events_3 = events; _c < events_3.length; _c++) {
            var e = events_3[_c];
            if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                continue;
            var midi = getEventMidi(e);
            if (midi === null)
                continue;
            list.push({
                measure: Number.isFinite(measureNumber) ? measureNumber : 0,
                t: Number((_b = e === null || e === void 0 ? void 0 : e.t) !== null && _b !== void 0 ? _b : 0),
                midi: midi,
                event: e
            });
        }
    }
    list.sort(function (a, b) { return (a.measure - b.measure) || (a.t - b.t); });
    list.forEach(function (item, idx) { return indexByEvent.set(item.event, idx); });
    return { list: list, indexByEvent: indexByEvent };
}
function parseBassPc(symbol, rootPc) {
    var _a, _b;
    var parts = symbol.split("/");
    if (parts.length < 2)
        return rootPc;
    var bassRaw = String((_a = parts[1]) !== null && _a !== void 0 ? _a : "").trim();
    if (!bassRaw)
        return rootPc;
    var match = bassRaw.match(/^([A-Ga-g])([#b]?)/);
    if (!match)
        return rootPc;
    var name = "".concat(match[1].toUpperCase()).concat((_b = match[2]) !== null && _b !== void 0 ? _b : "");
    return typeof PC_BY_NAME[name] === "number" ? PC_BY_NAME[name] : rootPc;
}
function parseChordDescriptor(symbol) {
    var _a, _b;
    var main = (_a = String(symbol !== null && symbol !== void 0 ? symbol : "").split("/")[0]) !== null && _a !== void 0 ? _a : "";
    var parsed = (0, chordSymbol_1.parseChordSymbol)(String(main));
    if (!parsed)
        return null;
    var rootPc = parsed.rootPc;
    var bassPc = parseBassPc(symbol, rootPc);
    var chordPcs = (_b = parsed.pcs) !== null && _b !== void 0 ? _b : [];
    var intervals = chordPcs.map(function (pc) { return ((pc - rootPc) % 12 + 12) % 12; });
    var thirdInterval = intervals.includes(3) ? 3 : intervals.includes(4) ? 4 : null;
    var fifthInterval = intervals.includes(7) ? 7 : intervals.includes(6) ? 6 : intervals.includes(8) ? 8 : null;
    var seventhInterval = intervals.includes(11)
        ? 11
        : intervals.includes(10)
            ? 10
            : intervals.includes(9)
                ? 9
                : null;
    return {
        symbol: symbol,
        rootPc: rootPc,
        bassPc: bassPc,
        chordPcs: chordPcs,
        thirdPc: thirdInterval != null ? (rootPc + thirdInterval) % 12 : null,
        fifthPc: fifthInterval != null ? (rootPc + fifthInterval) % 12 : null,
        seventhPc: seventhInterval != null ? (rootPc + seventhInterval) % 12 : null,
        isSeventh: seventhInterval != null,
        isRootPosition: bassPc === rootPc,
        isFirstInversion: thirdInterval != null && bassPc === (rootPc + thirdInterval) % 12
    };
}
function notePcFromMidi(midi) {
    return ((midi % 12) + 12) % 12;
}
function normalizeStrictness(strictness, level) {
    if (strictness === "relaxed" || strictness === "standard" || strictness === "strict")
        return strictness;
    if (level === "beginner")
        return "strict";
    if (level === "intermediate")
        return "standard";
    if (level === "advanced")
        return "standard";
    if (level === "professional")
        return "relaxed";
    return "standard";
}
function applyStrictness(violations, strictness) {
    if (strictness !== "strict")
        return violations;
    var escalate = new Set([
        "range.strict",
        "spacing.SA",
        "spacing.AT",
        "spacing.TB",
        "crossing.SA",
        "crossing.AT",
        "crossing.TB",
        "parallel.perfect",
        "doubling.third.root_position",
        "doubling.third.first_inversion",
        "seventh.incomplete_root_position",
        "seventh.incomplete_inversion",
        "resolution.leading_tone",
        "resolution.seventh"
    ]);
    return violations.map(function (v) { return (escalate.has(v.ruleId) ? __assign(__assign({}, v), { severity: "error" }) : v); });
}
function checkChoralRules(scoreModel, chords, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (chords === void 0) { chords = []; }
    if (options === void 0) { options = {}; }
    var warnings = [];
    var violations = [];
    var rules;
    try {
        rules = loadRules();
    }
    catch (err) {
        return {
            rulesVersion: "choral-v1",
            violations: [],
            warnings: ["[rules] Failed to load choral rules: ".concat((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : String(err))]
        };
    }
    var voiceParts = {};
    for (var _i = 0, VOICE_ORDER_2 = VOICE_ORDER; _i < VOICE_ORDER_2.length; _i++) {
        var voice = VOICE_ORDER_2[_i];
        var part = findVoicePart(scoreModel, voice);
        if (!part) {
            warnings.push("[rules] Missing ".concat(voice, " part for rule checks."));
        }
        voiceParts[voice] = part;
    }
    var measureNumbers = new Set();
    for (var _k = 0, VOICE_ORDER_3 = VOICE_ORDER; _k < VOICE_ORDER_3.length; _k++) {
        var voice = VOICE_ORDER_3[_k];
        var part = voiceParts[voice];
        var measures = (_b = part === null || part === void 0 ? void 0 : part.measures) !== null && _b !== void 0 ? _b : [];
        for (var _l = 0, measures_3 = measures; _l < measures_3.length; _l++) {
            var m = measures_3[_l];
            var num = Number(m === null || m === void 0 ? void 0 : m.number);
            if (Number.isFinite(num))
                measureNumbers.add(num);
        }
    }
    var measureList = Array.from(measureNumbers).sort(function (a, b) { return a - b; });
    for (var _m = 0, VOICE_ORDER_4 = VOICE_ORDER; _m < VOICE_ORDER_4.length; _m++) {
        var voice = VOICE_ORDER_4[_m];
        var part = voiceParts[voice];
        if (!part)
            continue;
        var range = rules.ranges.voices[voice];
        var measures = (_c = part === null || part === void 0 ? void 0 : part.measures) !== null && _c !== void 0 ? _c : [];
        for (var _o = 0, measures_4 = measures; _o < measures_4.length; _o++) {
            var measure = measures_4[_o];
            var number = Number(measure === null || measure === void 0 ? void 0 : measure.number);
            var events = Array.isArray(measure === null || measure === void 0 ? void 0 : measure.events) ? measure.events : [];
            for (var _p = 0, events_4 = events; _p < events_4.length; _p++) {
                var e = events_4[_p];
                if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
                    continue;
                var midi = getEventMidi(e);
                if (midi === null)
                    continue;
                if (midi < range.minMidi || midi > range.maxMidi) {
                    violations.push({
                        ruleId: "range.strict",
                        severity: "warn",
                        message: "".concat(voice, " out of range (midi=").concat(midi, ", allowed ").concat(range.minMidi, "-").concat(range.maxMidi, ")."),
                        measure: Number.isFinite(number) ? number : undefined,
                        t: Number.isFinite(Number(e === null || e === void 0 ? void 0 : e.t)) ? Number(e === null || e === void 0 ? void 0 : e.t) : undefined,
                        voices: [voice]
                    });
                }
            }
        }
    }
    for (var _q = 0, measureList_1 = measureList; _q < measureList_1.length; _q++) {
        var measureNumber = measureList_1[_q];
        var onsets = collectOnsetsForMeasure(voiceParts, measureNumber);
        for (var _r = 0, onsets_1 = onsets; _r < onsets_1.length; _r++) {
            var t = onsets_1[_r];
            var sNote = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t);
            var aNote = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t);
            var tNote = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t);
            var bNote = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t);
            var sMidi = sNote ? getEventMidi(sNote) : null;
            var aMidi = aNote ? getEventMidi(aNote) : null;
            var tMidi = tNote ? getEventMidi(tNote) : null;
            var bMidi = bNote ? getEventMidi(bNote) : null;
            if (sMidi !== null && aMidi !== null && Math.abs(sMidi - aMidi) > rules.spacing.adjacentMaxSemitones.SA) {
                violations.push({
                    ruleId: "spacing.SA",
                    severity: "warn",
                    message: "Soprano\u2013Alto spacing exceeds octave (".concat(Math.abs(sMidi - aMidi), " semitones)."),
                    measure: measureNumber,
                    t: t,
                    voices: ["soprano", "alto"]
                });
            }
            if (aMidi !== null && tMidi !== null && Math.abs(aMidi - tMidi) > rules.spacing.adjacentMaxSemitones.AT) {
                violations.push({
                    ruleId: "spacing.AT",
                    severity: "warn",
                    message: "Alto\u2013Tenor spacing exceeds octave (".concat(Math.abs(aMidi - tMidi), " semitones)."),
                    measure: measureNumber,
                    t: t,
                    voices: ["alto", "tenor"]
                });
            }
            if (tMidi !== null && bMidi !== null && Math.abs(tMidi - bMidi) > rules.spacing.adjacentMaxSemitones.TB) {
                violations.push({
                    ruleId: "spacing.TB",
                    severity: "warn",
                    message: "Tenor\u2013Bass spacing exceeds ".concat(rules.spacing.adjacentMaxSemitones.TB, " semitones."),
                    measure: measureNumber,
                    t: t,
                    voices: ["tenor", "bass"]
                });
            }
            if (sMidi !== null && aMidi !== null && sMidi < aMidi) {
                violations.push({
                    ruleId: "crossing.SA",
                    severity: "warn",
                    message: "Soprano is below Alto (voice crossing).",
                    measure: measureNumber,
                    t: t,
                    voices: ["soprano", "alto"]
                });
            }
            if (aMidi !== null && tMidi !== null && aMidi < tMidi) {
                violations.push({
                    ruleId: "crossing.AT",
                    severity: "warn",
                    message: "Alto is below Tenor (voice crossing).",
                    measure: measureNumber,
                    t: t,
                    voices: ["alto", "tenor"]
                });
            }
            if (tMidi !== null && bMidi !== null && tMidi < bMidi) {
                violations.push({
                    ruleId: "crossing.TB",
                    severity: "warn",
                    message: "Tenor is below Bass (voice crossing).",
                    measure: measureNumber,
                    t: t,
                    voices: ["tenor", "bass"]
                });
            }
        }
        for (var i = 0; i < onsets.length - 1; i += 1) {
            var t1 = onsets[i];
            var t2 = onsets[i + 1];
            var s1 = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t1);
            var s2 = activeNoteAt(getMeasure(voiceParts.soprano, measureNumber), t2);
            var a1 = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t1);
            var a2 = activeNoteAt(getMeasure(voiceParts.alto, measureNumber), t2);
            var t1n = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t1);
            var t2n = activeNoteAt(getMeasure(voiceParts.tenor, measureNumber), t2);
            var b1 = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t1);
            var b2 = activeNoteAt(getMeasure(voiceParts.bass, measureNumber), t2);
            var pairs = [
                { label: "SA", v1: [s1, s2], v2: [a1, a2] },
                { label: "AT", v1: [a1, a2], v2: [t1n, t2n] },
                { label: "TB", v1: [t1n, t2n], v2: [b1, b2] }
            ];
            for (var _s = 0, pairs_1 = pairs; _s < pairs_1.length; _s++) {
                var pair = pairs_1[_s];
                var m1 = pair.v1[0] ? getEventMidi(pair.v1[0]) : null;
                var m2 = pair.v1[1] ? getEventMidi(pair.v1[1]) : null;
                var n1 = pair.v2[0] ? getEventMidi(pair.v2[0]) : null;
                var n2 = pair.v2[1] ? getEventMidi(pair.v2[1]) : null;
                if (m1 === null || m2 === null || n1 === null || n2 === null)
                    continue;
                var interval1 = Math.abs(m1 - n1);
                var interval2 = Math.abs(m2 - n2);
                if (isPerfectInterval(interval1, rules.forbiddenIntervals.parallelPerfect.intervalClasses) &&
                    isPerfectInterval(interval2, rules.forbiddenIntervals.parallelPerfect.intervalClasses)) {
                    var dir1 = Math.sign(m2 - m1);
                    var dir2 = Math.sign(n2 - n1);
                    if (dir1 !== 0 && dir2 !== 0 && dir1 === dir2) {
                        violations.push({
                            ruleId: "parallel.perfect",
                            severity: "warn",
                            message: "Parallel perfect interval between ".concat(pair.label, " voices."),
                            measure: measureNumber,
                            t: t2,
                            voices: pair.label === "SA" ? ["soprano", "alto"] : pair.label === "AT" ? ["alto", "tenor"] : ["tenor", "bass"]
                        });
                    }
                }
            }
        }
    }
    var voiceNoteCache = {};
    for (var _t = 0, VOICE_ORDER_5 = VOICE_ORDER; _t < VOICE_ORDER_5.length; _t++) {
        var voice = VOICE_ORDER_5[_t];
        var part = voiceParts[voice];
        if (!part)
            continue;
        voiceNoteCache[voice] = collectVoiceNotes(part);
    }
    var keyContext = detectKeyContext(scoreModel);
    var tonicPc = keyContext.tonicPc;
    if (tonicPc !== null) {
        var leadingTonePc = (tonicPc + 11) % 12;
        for (var _u = 0, VOICE_ORDER_6 = VOICE_ORDER; _u < VOICE_ORDER_6.length; _u++) {
            var voice = VOICE_ORDER_6[_u];
            var notes = (_e = (_d = voiceNoteCache[voice]) === null || _d === void 0 ? void 0 : _d.list) !== null && _e !== void 0 ? _e : [];
            for (var i = 0; i < notes.length - 1; i += 1) {
                var current = notes[i];
                var next = notes[i + 1];
                var pc = notePcFromMidi(current.midi);
                if (pc !== leadingTonePc)
                    continue;
                var nextPc = notePcFromMidi(next.midi);
                if (nextPc !== tonicPc || next.midi <= current.midi) {
                    violations.push({
                        ruleId: "resolution.leading_tone",
                        severity: "warn",
                        message: "".concat(voice, " leading tone did not resolve upward to tonic."),
                        measure: current.measure,
                        t: current.t,
                        voices: [voice]
                    });
                }
            }
        }
    }
    if (Array.isArray(chords) && chords.length) {
        var _loop_1 = function (chord) {
            var measureNumber = Number(chord.measure);
            var t = Number((_f = chord.t) !== null && _f !== void 0 ? _f : 0);
            if (!Number.isFinite(measureNumber) || !Number.isFinite(t))
                return "continue";
            var descriptor = parseChordDescriptor(chord.symbol);
            if (!descriptor)
                return "continue";
            var chordNotes = [];
            for (var _w = 0, VOICE_ORDER_7 = VOICE_ORDER; _w < VOICE_ORDER_7.length; _w++) {
                var voice = VOICE_ORDER_7[_w];
                var part = voiceParts[voice];
                var measure = part ? getMeasure(part, measureNumber) : null;
                var note = measure ? activeNoteAt(measure, t) : null;
                if (!note)
                    continue;
                var midi = getEventMidi(note);
                if (midi === null)
                    continue;
                chordNotes.push({ voice: voice, midi: midi, pc: notePcFromMidi(midi), event: note });
            }
            var countByPc = new Map();
            for (var _x = 0, chordNotes_1 = chordNotes; _x < chordNotes_1.length; _x++) {
                var n = chordNotes_1[_x];
                countByPc.set(n.pc, ((_g = countByPc.get(n.pc)) !== null && _g !== void 0 ? _g : 0) + 1);
            }
            if (!descriptor.isSeventh) {
                if (descriptor.isRootPosition && descriptor.thirdPc !== null) {
                    var thirdCount = (_h = countByPc.get(descriptor.thirdPc)) !== null && _h !== void 0 ? _h : 0;
                    if (thirdCount > 1) {
                        violations.push({
                            ruleId: "doubling.third.root_position",
                            severity: "warn",
                            message: "Avoid doubling the third in root position triads (".concat(chord.symbol, ")."),
                            measure: measureNumber,
                            t: t,
                            voices: chordNotes.filter(function (n) { return n.pc === descriptor.thirdPc; }).map(function (n) { return n.voice; })
                        });
                    }
                }
                if (descriptor.isFirstInversion && descriptor.thirdPc !== null) {
                    var thirdCount = (_j = countByPc.get(descriptor.thirdPc)) !== null && _j !== void 0 ? _j : 0;
                    if (thirdCount > 1) {
                        violations.push({
                            ruleId: "doubling.third.first_inversion",
                            severity: "warn",
                            message: "Avoid doubling the third when it is in the bass (".concat(chord.symbol, ")."),
                            measure: measureNumber,
                            t: t,
                            voices: chordNotes.filter(function (n) { return n.pc === descriptor.thirdPc; }).map(function (n) { return n.voice; })
                        });
                    }
                }
            }
            if (descriptor.isSeventh && descriptor.thirdPc !== null && descriptor.fifthPc !== null && descriptor.seventhPc !== null) {
                var missing = [];
                if (!countByPc.get(descriptor.rootPc))
                    missing.push("root");
                if (!countByPc.get(descriptor.thirdPc))
                    missing.push("third");
                if (!countByPc.get(descriptor.fifthPc))
                    missing.push("fifth");
                if (!countByPc.get(descriptor.seventhPc))
                    missing.push("seventh");
                if (descriptor.isRootPosition) {
                    var missingNonFifth = missing.filter(function (tone) { return tone !== "fifth"; });
                    if (missingNonFifth.length) {
                        violations.push({
                            ruleId: "seventh.incomplete_root_position",
                            severity: "warn",
                            message: "Dominant seventh missing ".concat(missingNonFifth.join(", "), " in root position (").concat(chord.symbol, ")."),
                            measure: measureNumber,
                            t: t
                        });
                    }
                }
                else if (missing.length) {
                    violations.push({
                        ruleId: "seventh.incomplete_inversion",
                        severity: "warn",
                        message: "Dominant seventh missing ".concat(missing.join(", "), " in inversion (").concat(chord.symbol, ")."),
                        measure: measureNumber,
                        t: t
                    });
                }
            }
            if (descriptor.seventhPc !== null) {
                for (var _y = 0, chordNotes_2 = chordNotes; _y < chordNotes_2.length; _y++) {
                    var note = chordNotes_2[_y];
                    if (note.pc !== descriptor.seventhPc)
                        continue;
                    var cache = voiceNoteCache[note.voice];
                    if (!cache)
                        continue;
                    var idx = cache.indexByEvent.get(note.event);
                    if (idx == null)
                        continue;
                    var next = cache.list[idx + 1];
                    if (!next)
                        continue;
                    var delta = next.midi - note.midi;
                    if (delta >= 0 || Math.abs(delta) > 2) {
                        violations.push({
                            ruleId: "resolution.seventh",
                            severity: "warn",
                            message: "Chordal seventh did not resolve downward by step in ".concat(note.voice, "."),
                            measure: measureNumber,
                            t: t,
                            voices: [note.voice]
                        });
                    }
                }
            }
        };
        for (var _v = 0, chords_1 = chords; _v < chords_1.length; _v++) {
            var chord = chords_1[_v];
            _loop_1(chord);
        }
    }
    var strictness = normalizeStrictness(options.strictness, options.level);
    var finalViolations = applyStrictness(violations, strictness);
    return {
        rulesVersion: "choral-v1",
        violations: finalViolations,
        warnings: warnings
    };
}
