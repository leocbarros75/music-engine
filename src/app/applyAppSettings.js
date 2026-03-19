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
exports.applyAppSettings = applyAppSettings;
var fs_1 = require("fs");
var path_1 = require("path");
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
var applyChoralRhythmFromMelody_1 = require("../rhythm/applyChoralRhythmFromMelody");
var applyPolyphonicBassCounterRhythm_1 = require("../rhythm/applyPolyphonicBassCounterRhythm");
var applyRhythmToBassFinalCadence_1 = require("../rhythm/applyRhythmToBassFinalCadence");
var textureAnalyzer_1 = require("../texture/textureAnalyzer");
var arrangePianoFromSatb_1 = require("../arrange/arrangePianoFromSatb");
var arrangeStringEnsembleFromSatb_1 = require("../arrange/arrangeStringEnsembleFromSatb");
var arrangeStringQuartetFromPianoInstrumentation_1 = require("../arrange/arrangeStringQuartetFromPianoInstrumentation");
var stringArranger_1 = require("../arrange/strings/stringArranger");
var stringRhythm_1 = require("../arrange/strings/stringRhythm");
var stringsPolyphonicArranger_1 = require("../arrange/stringsPolyphony/stringsPolyphonicArranger");
var mapToWoodwindEnsemble_1 = require("../arrange/mapToWoodwindEnsemble");
var chordSymbol_1 = require("../harmonize/satb/chordSymbol");
function pickWeighted(choices, seed) {
    var total = choices.reduce(function (sum, c) { return sum + c.weight; }, 0);
    if (total <= 0)
        return choices[0].value;
    var r = (seed % 1000) / 1000;
    var acc = 0;
    for (var _i = 0, choices_1 = choices; _i < choices_1.length; _i++) {
        var c = choices_1[_i];
        acc += c.weight / total;
        if (r <= acc)
            return c.value;
    }
    return choices[choices.length - 1].value;
}
function getTempoBpmFromSettings(score, settings) {
    var _a, _b;
    var tempo = Number((_a = settings === null || settings === void 0 ? void 0 : settings.tempo) !== null && _a !== void 0 ? _a : (_b = score.meta) === null || _b === void 0 ? void 0 : _b.tempo_bpm);
    if (Number.isFinite(tempo) && tempo > 0)
        return tempo;
    return 120;
}
function isSimpleSixteenthCell(cell) {
    var sixteenthCount = cell.filter(function (d) { return Math.abs(d - 0.25) < 1e-6; }).length;
    if (sixteenthCount === 0)
        return true;
    return sixteenthCount <= 2 && cell.length <= 4;
}
function filterCellsForTempo(cells, tempoBpm) {
    if (!Number.isFinite(tempoBpm) || tempoBpm <= 0)
        return cells;
    if (tempoBpm > 132) {
        return cells.filter(function (cell) { return cell.every(function (d) { return d >= 0.5 - 1e-6; }); });
    }
    return cells.filter(function (cell) { return isSimpleSixteenthCell(cell); });
}
function getKeyInfo(score) {
    var _a, _b, _c, _d, _e, _f;
    var m0 = (_c = (_b = (_a = score.parts) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c[0];
    var fifths = (_d = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _d === void 0 ? void 0 : _d.key_fifths;
    var rawMode = String((_f = (_e = m0 === null || m0 === void 0 ? void 0 : m0.attributes) === null || _e === void 0 ? void 0 : _e.key_mode) !== null && _f !== void 0 ? _f : "").toLowerCase();
    var mode = rawMode === "minor" || rawMode === "major" ? rawMode : null;
    if (typeof fifths === "number" && Number.isFinite(fifths))
        return { value: fifths, found: true, mode: mode };
    return { value: 0, found: false, mode: mode };
}
function extractMelodyEventsForStrings(score, octaveShift) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (octaveShift === void 0) { octaveShift = 0; }
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var melodyPart = (_b = parts.find(function (p) {
        var _a;
        var name = String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase();
        return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    })) !== null && _b !== void 0 ? _b : parts[0];
    var out = {};
    for (var _i = 0, _j = (_c = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _c !== void 0 ? _c : []; _i < _j.length; _i++) {
        var m = _j[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var events = [];
        for (var _k = 0, _l = (_d = m === null || m === void 0 ? void 0 : m.events) !== null && _d !== void 0 ? _d : []; _k < _l.length; _k++) {
            var ev = _l[_k];
            if (!ev || (ev.type !== "note" && ev.type !== "rest"))
                continue;
            if (ev.type === "note") {
                var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
                if (midi === null)
                    continue;
                events.push({
                    id: "vln1-src-".concat(mNum, "-").concat(ev.t),
                    t: Number((_e = ev.t) !== null && _e !== void 0 ? _e : 0),
                    dur: Number((_f = ev.dur) !== null && _f !== void 0 ? _f : 0),
                    type: "note",
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi + octaveShift),
                    voice: 1,
                    staff: 1
                });
            }
            else {
                events.push({
                    id: "vln1-src-".concat(mNum, "-").concat(ev.t),
                    t: Number((_g = ev.t) !== null && _g !== void 0 ? _g : 0),
                    dur: Number((_h = ev.dur) !== null && _h !== void 0 ? _h : 0),
                    type: "rest",
                    voice: 1,
                    staff: 1,
                    isRest: true
                });
            }
        }
        out[mNum] = events;
    }
    return out;
}
function setKeyFifths(score, fifths, mode) {
    var _a, _b;
    for (var _i = 0, _c = (_a = score.parts) !== null && _a !== void 0 ? _a : []; _i < _c.length; _i++) {
        var part = _c[_i];
        var m0 = (_b = part.measures) === null || _b === void 0 ? void 0 : _b[0];
        if (!m0)
            continue;
        if (!m0.attributes)
            m0.attributes = {};
        m0.attributes.key_fifths = fifths;
        if (mode)
            m0.attributes.key_mode = mode;
    }
}
function parseKeySignature(input) {
    var _a;
    var raw = String(input || "").trim();
    if (!raw)
        return null;
    var lower = raw.toLowerCase();
    var isMinor = lower.includes("minor") || /m$/.test(lower);
    var match = lower.match(/^\s*([a-g])\s*([#b]?)/i);
    if (!match)
        return null;
    var step = match[1].toUpperCase();
    var acc = (_a = match[2]) !== null && _a !== void 0 ? _a : "";
    var keyName = "".concat(step).concat(acc);
    var MAJOR = {
        C: 0,
        G: 1,
        D: 2,
        A: 3,
        E: 4,
        B: 5,
        "F#": 6,
        "C#": 7,
        F: -1,
        Bb: -2,
        Eb: -3,
        Ab: -4,
        Db: -5,
        Gb: -6,
        Cb: -7
    };
    var MINOR = {
        A: 0,
        E: 1,
        B: 2,
        "F#": 3,
        "C#": 4,
        "G#": 5,
        "D#": 6,
        "A#": 7,
        D: -1,
        G: -2,
        C: -3,
        F: -4,
        Bb: -5,
        Eb: -6,
        Ab: -7
    };
    var map = isMinor ? MINOR : MAJOR;
    if (keyName in map) {
        return { fifths: map[keyName], mode: isMinor ? "minor" : "major" };
    }
    return null;
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
    return (_a = map[String(fifths)]) !== null && _a !== void 0 ? _a : 0;
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
    return (_a = map[String(fifths)]) !== null && _a !== void 0 ? _a : 9;
}
function attachTextureAnalysis(scoreModel, warnings) {
    var _a, _b;
    try {
        var report = (0, textureAnalyzer_1.analyzeTexture)(scoreModel);
        scoreModel.meta = __assign(__assign({}, ((_a = scoreModel.meta) !== null && _a !== void 0 ? _a : {})), { textureAnalysis: report });
    }
    catch (err) {
        warnings.push("[texture] Texture analysis failed: ".concat((_b = err === null || err === void 0 ? void 0 : err.message) !== null && _b !== void 0 ? _b : String(err)));
    }
}
function computeTransposeSemitones(params) {
    var detectedFifths = params.detectedFifths, detectedMode = params.detectedMode, targetFifths = params.targetFifths, targetMode = params.targetMode;
    var fromPc = detectedMode === "minor" ? tonicPcFromFifthsMinor(detectedFifths) : tonicPcFromFifthsMajor(detectedFifths);
    var toPc = targetMode === "minor" ? tonicPcFromFifthsMinor(targetFifths) : tonicPcFromFifthsMajor(targetFifths);
    var diff = (toPc - fromPc + 12) % 12;
    if (diff > 6)
        diff -= 12;
    return diff;
}
function transposeScoreModel(score, semitones) {
    var _a, _b, _c;
    if (!semitones)
        return;
    for (var _i = 0, _d = (_a = score.parts) !== null && _a !== void 0 ? _a : []; _i < _d.length; _i++) {
        var part = _d[_i];
        for (var _e = 0, _f = (_b = part.measures) !== null && _b !== void 0 ? _b : []; _e < _f.length; _e++) {
            var measure = _f[_e];
            for (var _g = 0, _h = (_c = measure.events) !== null && _c !== void 0 ? _c : []; _g < _h.length; _g++) {
                var ev = _h[_g];
                if (ev.type !== "note" || !ev.pitch)
                    continue;
                var midi = (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
                var shifted = midi + semitones;
                ev.midi = shifted;
                ev.pitch = (0, instrumentCatalog_1.midiToPitch)(shifted);
            }
        }
    }
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
function parseBassFromChordSymbol(symbolRaw) {
    var _a, _b;
    var s = String(symbolRaw || "").trim();
    if (!s)
        return null;
    var main = s;
    var slashBass = null;
    if (s.includes("/")) {
        var parts = s.split("/");
        main = ((_a = parts[0]) !== null && _a !== void 0 ? _a : "").trim();
        slashBass = ((_b = parts[1]) !== null && _b !== void 0 ? _b : "").trim();
    }
    var rootMatch = main.match(/^([A-Ga-g][#b]?)/);
    if (!rootMatch)
        return null;
    var rootTok = rootMatch[1];
    var rootInfo = parseRootTokenWithSpelling(rootTok);
    if (!rootInfo)
        return null;
    var bassInfo = slashBass ? parseRootTokenWithSpelling(slashBass) : null;
    return bassInfo !== null && bassInfo !== void 0 ? bassInfo : rootInfo;
}
function pitchWithSpelling(midi, spelling) {
    var _a;
    var base = (0, instrumentCatalog_1.midiToPitch)(midi);
    if (!spelling)
        return base;
    var basePc = ((midi % 12) + 12) % 12;
    var targetPc = (STEP_TO_PC[spelling.step] + ((_a = spelling.alter) !== null && _a !== void 0 ? _a : 0) + 12) % 12;
    if (basePc !== targetPc)
        return base;
    return { step: spelling.step, alter: spelling.alter, octave: base.octave };
}
function measureBeatsFromAttributes(attrs) {
    var _a, _b, _c, _d;
    var beats = Number((_b = (_a = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _a === void 0 ? void 0 : _a.beats) !== null && _b !== void 0 ? _b : 4);
    var beatType = Number((_d = (_c = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _c === void 0 ? void 0 : _c.beat_type) !== null && _d !== void 0 ? _d : 4);
    if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0)
        return 4;
    return beats * (4 / beatType);
}
function chooseBassMidiWithLeapLimit(pcTarget, prevMidi, range, anchorMidi, maxLeap) {
    if (anchorMidi === void 0) { anchorMidi = 43; }
    if (maxLeap === void 0) { maxLeap = 12; }
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (((m % 12) + 12) % 12 === pcTarget)
            candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var c = candidates_1[_i];
        var anchorPenalty = Math.abs(c - anchorMidi);
        var smoothPenalty = Math.abs(c - prevMidi) * 0.35;
        var score = anchorPenalty + smoothPenalty;
        if (score < bestScore) {
            best = c;
            bestScore = score;
        }
    }
    if (Math.abs(best - prevMidi) <= maxLeap)
        return best;
    var alt = candidates.filter(function (c) { return Math.abs(c - prevMidi) <= maxLeap; });
    if (!alt.length)
        return best;
    var bestAlt = alt[0];
    var bestAltScore = Number.POSITIVE_INFINITY;
    for (var _a = 0, alt_1 = alt; _a < alt_1.length; _a++) {
        var c = alt_1[_a];
        var anchorPenalty = Math.abs(c - anchorMidi);
        var smoothPenalty = Math.abs(c - prevMidi) * 0.35;
        var score = anchorPenalty + smoothPenalty;
        if (score < bestAltScore) {
            bestAlt = c;
            bestAltScore = score;
        }
    }
    return bestAlt;
}
function pickAlternatePc(primaryPc, parsed) {
    if (!parsed || !Array.isArray(parsed.pcs) || parsed.pcs.length === 0)
        return primaryPc;
    var rootPc = parsed.rootPc;
    if (primaryPc !== rootPc)
        return rootPc;
    var fifth = (rootPc + 7) % 12;
    if (parsed.pcs.includes(fifth))
        return fifth;
    var thirdMaj = (rootPc + 4) % 12;
    var thirdMin = (rootPc + 3) % 12;
    if (parsed.pcs.includes(thirdMaj))
        return thirdMaj;
    if (parsed.pcs.includes(thirdMin))
        return thirdMin;
    var alt = parsed.pcs.find(function (pc) { return pc !== primaryPc; });
    return typeof alt === "number" ? alt : primaryPc;
}
function buildBeginnerPattern(segmentBeats, melodyDensity, polyphonic) {
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var beats = Math.round(segmentBeats * 1000) / 1000;
    if (polyphonic) {
        if (beats >= 2 && Number.isInteger(beats)) {
            return Array.from({ length: beats }, function () { return 1; });
        }
        return [beats];
    }
    if (beats >= 4) {
        if (melodyDensity >= 6)
            return [beats];
        return [beats / 2, beats / 2];
    }
    if (beats >= 2) {
        if (melodyDensity >= 6)
            return [beats];
        if (Math.abs(beats - 2) < 1e-6)
            return [1, 1];
        return [beats];
    }
    return [beats];
}
function buildBeginnerChordVoicing(params) {
    var _a;
    var anchorMidi = params.anchorMidi, parsed = params.parsed, range = params.range;
    var maxNotes = Math.max(1, (_a = params.maxNotes) !== null && _a !== void 0 ? _a : 3);
    var anchorPc = ((anchorMidi % 12) + 12) % 12;
    var pcs = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.pcs) && parsed.pcs.length ? parsed.pcs : [anchorPc];
    var ordered = pcs
        .slice()
        .sort(function (a, b) {
        var da = (a - anchorPc + 12) % 12;
        var db = (b - anchorPc + 12) % 12;
        return da - db;
    });
    var midis = [];
    for (var _i = 0, ordered_1 = ordered; _i < ordered_1.length; _i++) {
        var pc = ordered_1[_i];
        var m = anchorMidi + ((pc - anchorPc + 12) % 12);
        while (m < range.min && m + 12 <= anchorMidi + 12)
            m += 12;
        if (m < anchorMidi)
            m = anchorMidi;
        if (m > range.max || m > anchorMidi + 12)
            continue;
        if (!midis.includes(m))
            midis.push(m);
        if (midis.length >= maxNotes)
            break;
    }
    if (!midis.length)
        return [anchorMidi];
    return midis;
}
function pickMidiForPcWithinRange(pc, range, preferredAbove) {
    var targetPc = ((pc % 12) + 12) % 12;
    if (typeof preferredAbove === "number") {
        for (var m = Math.max(range.min, preferredAbove + 1); m <= range.max; m++) {
            if (((m % 12) + 12) % 12 === targetPc)
                return m;
        }
    }
    for (var m = range.max; m >= range.min; m--) {
        if (((m % 12) + 12) % 12 === targetPc)
            return m;
    }
    return null;
}
function buildDyadVoicing(params) {
    var _a, _b;
    var bassPc = ((params.bassMidi % 12) + 12) % 12;
    var rootPc = (_b = (_a = params.parsed) === null || _a === void 0 ? void 0 : _a.rootPc) !== null && _b !== void 0 ? _b : bassPc;
    var fifthPc = (rootPc + 7) % 12;
    var preferred = bassPc === rootPc ? fifthPc : rootPc;
    var upper = pickMidiForPcWithinRange(preferred, params.range, params.bassMidi);
    if (upper === null || upper === params.bassMidi) {
        var fallbackPc = preferred === rootPc ? fifthPc : rootPc;
        upper = pickMidiForPcWithinRange(fallbackPc, params.range, params.bassMidi);
    }
    if (upper === null || upper === params.bassMidi)
        return [params.bassMidi];
    return [params.bassMidi, upper];
}
function normalizeChordalActivity(activity) {
    switch (activity) {
        case "high_active":
            return "high_active";
        case "active":
            return "active";
        case "less_active":
        case "grounded":
        default:
            return "less_active";
    }
}
var CHORDAL_RHYTHM_CELLS = [
    [1],
    [0.5, 0.5],
    [0.25, 0.25, 0.5],
    [0.5, 0.25, 0.25],
    [0.75, 0.25]
];
function pickChordalCell(measureNumber, beatIndex, tempoBpm) {
    var _a;
    var filtered = filterCellsForTempo(CHORDAL_RHYTHM_CELLS, tempoBpm);
    var pool = filtered.length ? filtered : CHORDAL_RHYTHM_CELLS;
    var group = Math.floor((measureNumber - 1) / 8);
    var seed = (group * 1315423911 + Math.round(beatIndex * 1000) * 2654435761) >>> 0;
    var idx = seed % pool.length;
    return (_a = pool[idx]) !== null && _a !== void 0 ? _a : [1];
}
function buildChordalPattern(segmentBeats, measureNumber, startBeat, tempoBpm) {
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var beatOffset = 0;
    while (remaining > 1e-6) {
        if (remaining < 1 - 1e-6) {
            out.push(remaining);
            break;
        }
        var cell = pickChordalCell(measureNumber, startBeat + beatOffset, tempoBpm);
        out.push.apply(out, cell);
        remaining -= 1;
        beatOffset += 1;
    }
    return out;
}
var ARP_PATTERNS_EIGHTH = [
    ["bass", "fifth", "root", "fifth", "third", "fifth", "root", "fifth"],
    ["bass", "fifth", "root", "third", "fifth", "root", "third", "fifth"]
];
var ARP_PATTERNS_QUARTER = [
    ["bass", "fifth", "root", "third"],
    ["bass", "root", "third", "fifth"]
];
var WORSHIP_LH_CELLS_LESS = [
    [4],
    [2, 2],
    [3, 1],
    [1.5, 0.5, 1, 1],
    [1, 1, 2]
];
var WORSHIP_LH_CELLS_ACTIVE = [
    [1, 1, 1, 1],
    [1.5, 0.5, 1, 1],
    [0.5, 0.5, 1, 1, 1],
    [0.5, 0.5, 0.5, 0.5, 1, 1],
    [1, 0.75, 0.25, 0.5, 0.5, 1],
    [0.75, 0.25, 1, 0.5, 0.5, 1],
    [0.75, 0.25, 0.5, 0.5, 0.25, 0.25, 0.5, 1],
    [2, 1, 1]
];
var WORSHIP_LH_CELLS_HIGH = [
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    [0.5, 0.5, 1, 1, 1],
    [0.5, 0.5, 0.5, 0.5, 1, 1],
    [0.75, 0.25, 0.5, 0.5, 0.5, 0.5, 1],
    [0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    [1, 0.5, 0.5, 0.5, 0.5, 1],
    [1.5, 0.5, 0.5, 0.5, 1],
    [1, 1, 0.5, 0.5, 1]
];
var WORSHIP_TOKEN_SEQ_LESS = ["bass", "fifth", "root", "third"];
var WORSHIP_TOKEN_SEQ_ACTIVE = ["bass", "fifth", "third", "root", "fifth", "third", "root"];
var WORSHIP_TOKEN_SEQ_HIGH = [
    "bass",
    "fifth",
    "third",
    "root",
    "fifth",
    "third",
    "root",
    "fifth",
    "third",
    "root"
];
function pickLowestMidiForPcWithinRange(pc, range) {
    var targetPc = ((pc % 12) + 12) % 12;
    for (var m = range.min; m <= range.max; m++) {
        if (((m % 12) + 12) % 12 === targetPc)
            return m;
    }
    return null;
}
var cachedAlbertiPattern = null;
function loadAlbertiPatternTokens() {
    var _a;
    if (cachedAlbertiPattern)
        return cachedAlbertiPattern;
    var fallback = ["bass", "fifth", "third", "fifth"];
    try {
        var filePath = path_1.default.join(process.cwd(), "rules", "rhythm", "rhythm_patterns.json");
        var raw = fs_1.default.readFileSync(filePath, "utf8");
        var data = JSON.parse(raw);
        var pattern = Array.isArray((_a = data === null || data === void 0 ? void 0 : data.alberti) === null || _a === void 0 ? void 0 : _a.pattern) ? data.alberti.pattern : null;
        if (!pattern || !pattern.length) {
            cachedAlbertiPattern = fallback;
            return cachedAlbertiPattern;
        }
        var mapped = pattern
            .map(function (token) { return String(token || "").toLowerCase(); })
            .map(function (token) {
            if (token === "low" || token === "bass")
                return "bass";
            if (token === "high")
                return "fifth";
            if (token === "mid")
                return "third";
            if (token === "root")
                return "root";
            if (token === "third")
                return "third";
            if (token === "fifth")
                return "fifth";
            return null;
        })
            .filter(function (t) { return t !== null; });
        cachedAlbertiPattern = mapped.length ? mapped : fallback;
        return cachedAlbertiPattern;
    }
    catch (_b) {
        cachedAlbertiPattern = fallback;
        return cachedAlbertiPattern;
    }
}
function resolveChordToneMap(params) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    var rootPc = (_d = (_b = (_a = params.parsed) === null || _a === void 0 ? void 0 : _a.rootPc) !== null && _b !== void 0 ? _b : (_c = params.bassInfo) === null || _c === void 0 ? void 0 : _c.pc) !== null && _d !== void 0 ? _d : 0;
    var bassPc = (_f = (_e = params.bassInfo) === null || _e === void 0 ? void 0 : _e.pc) !== null && _f !== void 0 ? _f : rootPc;
    var pcs = Array.isArray((_g = params.parsed) === null || _g === void 0 ? void 0 : _g.pcs) && params.parsed.pcs.length ? params.parsed.pcs : [rootPc];
    var majThird = (rootPc + 4) % 12;
    var minThird = (rootPc + 3) % 12;
    var thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : rootPc;
    var fifthPc = pcs.includes((rootPc + 7) % 12)
        ? (rootPc + 7) % 12
        : (_h = pcs.find(function (pc) { return pc !== rootPc && pc !== thirdPc; })) !== null && _h !== void 0 ? _h : rootPc;
    return { bassPc: bassPc, rootPc: rootPc, thirdPc: thirdPc, fifthPc: fifthPc, pcs: pcs };
}
function scalePcsFromKey(fifths, mode) {
    var tonic = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
    var intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return intervals.map(function (i) { return (tonic + i) % 12; });
}
function findScaleNeighborMidi(baseMidi, scalePcs, dir, min, max) {
    var set = new Set(scalePcs);
    for (var i = 1; i <= 12; i++) {
        var m = baseMidi + dir * i;
        if (m < min || m > max)
            break;
        var p = ((m % 12) + 12) % 12;
        if (set.has(p))
            return m;
    }
    return null;
}
function buildArpeggioSteps(params) {
    var _a;
    var segmentBeats = params.segmentBeats, activity = params.activity, measureNumber = params.measureNumber;
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var stepDur = activity === "less_active" ? 1 : 0.5;
    var patterns = activity === "less_active" ? ARP_PATTERNS_QUARTER : ARP_PATTERNS_EIGHTH;
    var pattern = (_a = patterns[measureNumber % patterns.length]) !== null && _a !== void 0 ? _a : patterns[0];
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    while (remaining > 1e-6) {
        var dur = remaining < stepDur - 1e-6 ? remaining : stepDur;
        var token = pattern[idx % pattern.length];
        out.push({ dur: dur, token: token });
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
    }
    return out;
}
function buildWorshipArpeggioSteps(params) {
    var _a, _b, _c, _d, _e, _f;
    var segmentBeats = params.segmentBeats, activity = params.activity, measureNumber = params.measureNumber, startBeat = params.startBeat, level = params.level, tempoBpm = params.tempoBpm;
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    if (activity === "active" && level === "advanced") {
        var weights = [
            { value: 1, weight: 40 },
            { value: 0.5, weight: 40 },
            { value: 2, weight: 20 }
        ];
        var out_1 = [];
        var remaining_1 = Math.round(segmentBeats * 1000) / 1000;
        var idx_1 = 0;
        var tokIdx_1 = 0;
        while (remaining_1 > 1e-6) {
            var seed_1 = (measureNumber * 1315423911 + Math.round((startBeat + idx_1) * 1000) * 2654435761) >>> 0;
            var dur = pickWeighted(weights, seed_1);
            if (dur > remaining_1 + 1e-6) {
                var allowed = weights
                    .map(function (w) { return w.value; })
                    .filter(function (v) { return v <= remaining_1 + 1e-6; })
                    .sort(function (a, b) { return b - a; });
                dur = (_a = allowed[0]) !== null && _a !== void 0 ? _a : remaining_1;
            }
            var token = (_b = WORSHIP_TOKEN_SEQ_ACTIVE[tokIdx_1 % WORSHIP_TOKEN_SEQ_ACTIVE.length]) !== null && _b !== void 0 ? _b : "bass";
            out_1.push({ dur: dur, token: token });
            remaining_1 = Math.round((remaining_1 - dur) * 1000) / 1000;
            idx_1 += 1;
            tokIdx_1 += 1;
        }
        return out_1;
    }
    var cells = activity === "high_active"
        ? WORSHIP_LH_CELLS_HIGH
        : activity === "active"
            ? WORSHIP_LH_CELLS_ACTIVE
            : WORSHIP_LH_CELLS_LESS;
    var tokenSeq = activity === "high_active"
        ? WORSHIP_TOKEN_SEQ_HIGH
        : activity === "active"
            ? WORSHIP_TOKEN_SEQ_ACTIVE
            : WORSHIP_TOKEN_SEQ_LESS;
    var tempo = Number.isFinite(tempoBpm) && Number(tempoBpm) > 0 ? Number(tempoBpm) : 120;
    var filtered = filterCellsForTempo(cells, tempo);
    var pool = filtered.length ? filtered : cells;
    var group = Math.floor((measureNumber - 1) / 8);
    var seed = (group * 1315423911 + Math.round(startBeat * 1000) * 2654435761) >>> 0;
    var cell = (_d = (_c = pool[seed % pool.length]) !== null && _c !== void 0 ? _c : pool[0]) !== null && _d !== void 0 ? _d : [segmentBeats];
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    var tokIdx = 0;
    while (remaining > 1e-6) {
        var dur = (_e = cell[idx % cell.length]) !== null && _e !== void 0 ? _e : remaining;
        if (dur > remaining)
            dur = remaining;
        var token = (_f = tokenSeq[tokIdx % tokenSeq.length]) !== null && _f !== void 0 ? _f : "bass";
        out.push({ dur: dur, token: token });
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
        tokIdx += 1;
    }
    return out;
}
function buildAlbertiSteps(params) {
    var _a, _b, _c;
    var segmentBeats = params.segmentBeats, measureNumber = params.measureNumber, startBeat = params.startBeat, activity = params.activity;
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var pattern = loadAlbertiPatternTokens();
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    var allowEighths = activity === "less_active";
    var eighthRatio = 0.3;
    while (remaining > 1e-6) {
        if (allowEighths) {
            var beatDur = remaining >= 1 ? 1 : remaining;
            var seed = (measureNumber * 73856093) ^ (Math.round((startBeat + idx) * 1000) * 19349663);
            var roll = ((seed >>> 0) % 1000) / 1000;
            var split = beatDur >= 1 && roll < eighthRatio;
            if (split) {
                for (var k = 0; k < 2; k++) {
                    var token_1 = (_a = pattern[idx % pattern.length]) !== null && _a !== void 0 ? _a : "bass";
                    out.push({ dur: 0.5, token: token_1 });
                    idx += 1;
                }
                remaining = Math.round((remaining - 1) * 1000) / 1000;
                continue;
            }
            var token_2 = (_b = pattern[idx % pattern.length]) !== null && _b !== void 0 ? _b : "bass";
            out.push({ dur: beatDur, token: token_2 });
            remaining = Math.round((remaining - beatDur) * 1000) / 1000;
            idx += 1;
            continue;
        }
        var dur = remaining < 0.5 - 1e-6 ? remaining : 0.5;
        var token = (_c = pattern[idx % pattern.length]) !== null && _c !== void 0 ? _c : "bass";
        if ((activity === "active" || activity === "high_active") && token === "third") {
            var swap = (measureNumber * 7 + Math.round(startBeat * 2) + idx) % 4 === 0;
            if (swap)
                token = "passing";
        }
        out.push({ dur: dur, token: token });
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
    }
    return out;
}
function buildBeginnerWorshipBassSteps(params) {
    var _a, _b;
    var segmentBeats = params.segmentBeats, measureNumber = params.measureNumber, startBeat = params.startBeat, activity = params.activity;
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var weights = activity === "high_active"
        ? [
            { value: 4, weight: 15 },
            { value: 2, weight: 20 },
            { value: 1, weight: 40 },
            { value: 0.5, weight: 25 }
        ]
        : activity === "active"
            ? [
                { value: 4, weight: 30 },
                { value: 2, weight: 25 },
                { value: 1, weight: 45 }
            ]
            : [
                { value: 4, weight: 60 },
                { value: 2, weight: 40 }
            ];
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    var pattern = ["bass", "third", "fifth", "third"];
    while (remaining > 1e-6) {
        var seed = (measureNumber * 73856093) ^ (Math.round((startBeat + idx) * 1000) * 19349663);
        var dur = pickWeighted(weights, seed);
        if (dur > remaining + 1e-6) {
            var allowed = weights
                .map(function (w) { return w.value; })
                .filter(function (v) { return v <= remaining + 1e-6; })
                .sort(function (a, b) { return b - a; });
            dur = (_a = allowed[0]) !== null && _a !== void 0 ? _a : remaining;
        }
        var token = dur >= 2 ? "bass" : (_b = pattern[idx % pattern.length]) !== null && _b !== void 0 ? _b : "bass";
        out.push({ dur: dur, token: token });
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
    }
    return out;
}
function applyPianoPolyphonicArpeggioBass(scoreModel, chords, warnings, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
    if (!Array.isArray(chords) || chords.length === 0) {
        warnings.push("[piano] Polyphonic arpeggio skipped: no chord events available.");
        return false;
    }
    var parts = (_a = scoreModel.parts) !== null && _a !== void 0 ? _a : [];
    var melodyPart = (_b = parts.find(function (p) {
        var _a;
        var name = String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase();
        return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    })) !== null && _b !== void 0 ? _b : parts[0];
    var bassPart = (_c = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("bass"); })) !== null && _c !== void 0 ? _c : (parts.length ? parts[parts.length - 1] : null);
    if (!melodyPart || !bassPart) {
        warnings.push("[piano] Polyphonic arpeggio skipped: missing melody or bass part.");
        return false;
    }
    var activity = normalizeChordalActivity(options === null || options === void 0 ? void 0 : options.activity);
    var isWorship = (options === null || options === void 0 ? void 0 : options.worship) === true;
    var level = ((_d = options === null || options === void 0 ? void 0 : options.level) !== null && _d !== void 0 ? _d : "beginner");
    var isBeginner = level === "beginner";
    var range = level === "advanced" ? { min: 40, max: 52 } : { min: 40, max: 64 }; // E2..E3 or E2..E4
    var allowArp = activity !== "grounded";
    if (!allowArp) {
        warnings.push("[piano] Polyphonic arpeggio skipped: activity grounded.");
        return false;
    }
    var tempoBpm = typeof (options === null || options === void 0 ? void 0 : options.tempoBpm) === "number" && Number.isFinite(options.tempoBpm)
        ? options.tempoBpm
        : getTempoBpmFromSettings(scoreModel);
    var keyInfo = getKeyInfo(scoreModel);
    var keyMode = (_e = keyInfo.mode) !== null && _e !== void 0 ? _e : "major";
    var scalePcs = scalePcsFromKey(keyInfo.value, keyMode);
    var measures = (_f = bassPart.measures) !== null && _f !== void 0 ? _f : [];
    var measureNumbers = measures.map(function (m, idx) { var _a; return Number((_a = m === null || m === void 0 ? void 0 : m.number) !== null && _a !== void 0 ? _a : idx + 1); });
    var lastTwo = measureNumbers.slice(-2);
    var newMeasures = [];
    var prevMidi = 43;
    var lastChord = null;
    var _loop_1 = function (i) {
        var bMeasure = measures[i];
        var mMeasure = (_g = melodyPart.measures) === null || _g === void 0 ? void 0 : _g[i];
        if (!bMeasure || !mMeasure)
            return "continue";
        var measureNumber = Number((_j = (_h = bMeasure.number) !== null && _h !== void 0 ? _h : mMeasure.number) !== null && _j !== void 0 ? _j : i + 1);
        var attrs = (_l = (_k = bMeasure.attributes) !== null && _k !== void 0 ? _k : mMeasure.attributes) !== null && _l !== void 0 ? _l : {};
        var measureBeats = measureBeatsFromAttributes(attrs);
        var inMeasure = chords
            .filter(function (c) { return Number(c.measure) === measureNumber; })
            .map(function (c) { return (__assign(__assign({}, c), { t: Number(c.t) })); })
            .filter(function (c) { return Number.isFinite(c.t); })
            .sort(function (a, b) { return Number(a.t) - Number(b.t); });
        var events = [];
        var chordEvents = inMeasure.slice();
        if (!chordEvents.length && lastChord) {
            chordEvents = [__assign(__assign({}, lastChord), { t: 0 })];
        }
        else if (chordEvents.length && chordEvents[0].t > 0) {
            var base = lastChord !== null && lastChord !== void 0 ? lastChord : chordEvents[0];
            chordEvents = __spreadArray([__assign(__assign({}, base), { t: 0 })], chordEvents, true);
        }
        if (!chordEvents.length) {
            events.push({ type: "rest", t: 0, dur: measureBeats });
            newMeasures.push({ number: measureNumber, attributes: attrs, events: events });
            return "continue";
        }
        if (lastTwo.includes(measureNumber)) {
            var melEvents = ((_m = mMeasure === null || mMeasure === void 0 ? void 0 : mMeasure.events) !== null && _m !== void 0 ? _m : []).filter(function (e) { return e && (e.type === "note" || e.type === "rest"); });
            for (var _i = 0, melEvents_1 = melEvents; _i < melEvents_1.length; _i++) {
                var ev = melEvents_1[_i];
                if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number")
                    continue;
                var chord = pickChordForTime(chords, measureNumber, Number(ev.t));
                if (!chord) {
                    events.push({ type: "rest", t: ev.t, dur: ev.dur });
                    continue;
                }
                var bassInfo = parseBassFromChordSymbol(chord.symbol);
                if (!bassInfo) {
                    events.push({ type: "rest", t: ev.t, dur: ev.dur });
                    continue;
                }
                var midi = chooseBassMidiWithLeapLimit(bassInfo.pc, prevMidi, range, 43, 12);
                events.push({
                    type: "note",
                    t: ev.t,
                    dur: ev.dur,
                    midi: midi,
                    pitch: pitchWithSpelling(midi, bassInfo.spelling)
                });
                prevMidi = midi;
            }
            newMeasures.push({ number: measureNumber, attributes: attrs ? __assign({}, attrs) : undefined, events: events });
            lastChord = (_o = chordEvents[chordEvents.length - 1]) !== null && _o !== void 0 ? _o : lastChord;
            return "continue";
        }
        var _loop_2 = function (ci) {
            var chord = chordEvents[ci];
            var start = Math.max(0, Number(chord.t) || 0);
            var end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1].t) : measureBeats;
            var segDur = Math.max(0, Math.min(end, measureBeats) - start);
            if (segDur <= 0)
                return "continue";
            var bassInfo = parseBassFromChordSymbol(chord.symbol);
            var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
            var map = resolveChordToneMap({ parsed: parsed, bassInfo: bassInfo });
            var steps = isBeginner && isWorship
                ? buildBeginnerWorshipBassSteps({ segmentBeats: segDur, activity: activity, measureNumber: measureNumber, startBeat: start })
                : isBeginner
                    ? buildAlbertiSteps({ segmentBeats: segDur, activity: activity, measureNumber: measureNumber, startBeat: start })
                    : isWorship
                        ? buildWorshipArpeggioSteps({ segmentBeats: segDur, activity: activity, measureNumber: measureNumber, startBeat: start, level: level, tempoBpm: tempoBpm })
                        : buildArpeggioSteps({ segmentBeats: segDur, activity: activity, measureNumber: measureNumber });
            var cursor = start;
            var bassAnchor = (_p = pickLowestMidiForPcWithinRange(map.bassPc, range)) !== null && _p !== void 0 ? _p : chooseBassMidiWithLeapLimit(map.bassPc, prevMidi, range, 43, 12);
            for (var _v = 0, steps_1 = steps; _v < steps_1.length; _v++) {
                var step = steps_1[_v];
                var strongBeat = Math.abs(cursor - Math.round(cursor)) < 1e-6;
                var chordBoundary = chordEvents.some(function (c) { return Math.abs(Number(c.t) - cursor) < 1e-6; });
                var blockPassing = strongBeat || chordBoundary;
                var pc = map.rootPc;
                if (step.token === "bass")
                    pc = map.bassPc;
                if (step.token === "third")
                    pc = map.thirdPc;
                if (step.token === "fifth")
                    pc = map.fifthPc;
                var midi = step.token === "bass"
                    ? bassAnchor
                    : (_q = pickMidiForPcWithinRange(pc, range, bassAnchor)) !== null && _q !== void 0 ? _q : bassAnchor;
                if (step.token === "passing") {
                    if (!blockPassing) {
                        var dir = (measureNumber + Math.round(cursor * 2)) % 2 === 0 ? 1 : -1;
                        var neighbor = (_r = findScaleNeighborMidi(prevMidi !== null && prevMidi !== void 0 ? prevMidi : bassAnchor, scalePcs, dir, range.min, range.max)) !== null && _r !== void 0 ? _r : null;
                        if (neighbor !== null) {
                            midi = neighbor;
                        }
                    }
                    else {
                        var chordPc = (_s = map.bassPc) !== null && _s !== void 0 ? _s : map.rootPc;
                        midi = (_t = pickMidiForPcWithinRange(chordPc, range, bassAnchor)) !== null && _t !== void 0 ? _t : bassAnchor;
                    }
                }
                if (step.token === "bass" && (bassInfo === null || bassInfo === void 0 ? void 0 : bassInfo.spelling)) {
                    events.push({
                        type: "note",
                        t: cursor,
                        dur: step.dur,
                        midi: midi,
                        pitch: pitchWithSpelling(midi, bassInfo.spelling)
                    });
                }
                else {
                    events.push({ type: "note", t: cursor, dur: step.dur, midi: midi, pitch: (0, instrumentCatalog_1.midiToPitch)(midi) });
                }
                prevMidi = midi;
                cursor += step.dur;
            }
        };
        for (var ci = 0; ci < chordEvents.length; ci++) {
            _loop_2(ci);
        }
        newMeasures.push({ number: measureNumber, attributes: attrs ? __assign({}, attrs) : undefined, events: events });
        lastChord = (_u = chordEvents[chordEvents.length - 1]) !== null && _u !== void 0 ? _u : lastChord;
    };
    for (var i = 0; i < measures.length; i++) {
        _loop_1(i);
    }
    bassPart.measures = newMeasures;
    warnings.push("[piano] Polyphonic arpeggio applied (activity=".concat(activity, ", left-hand arpeggio)."));
    return true;
}
function applyBeginnerPianoAccompaniment(scoreModel, chords, warnings, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
    if (!Array.isArray(chords) || chords.length === 0) {
        warnings.push("[piano] Beginner accompaniment skipped: no chord events available.");
        return false;
    }
    var parts = (_a = scoreModel.parts) !== null && _a !== void 0 ? _a : [];
    var melodyPart = (_b = parts.find(function (p) {
        var _a;
        var name = String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase();
        return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    })) !== null && _b !== void 0 ? _b : parts[0];
    var bassPart = (_c = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("bass"); })) !== null && _c !== void 0 ? _c : (parts.length ? parts[parts.length - 1] : null);
    if (!melodyPart || !bassPart) {
        warnings.push("[piano] Beginner accompaniment skipped: missing melody or bass part.");
        return false;
    }
    var range = { min: 40, max: 64 }; // E2..E4
    var prevMidi = 43;
    var lastChord = null;
    var activity = normalizeChordalActivity(options === null || options === void 0 ? void 0 : options.activity);
    var useRhythmCells = activity === "high_active";
    var tempoBpm = typeof (options === null || options === void 0 ? void 0 : options.tempoBpm) === "number" && Number.isFinite(options.tempoBpm)
        ? options.tempoBpm
        : getTempoBpmFromSettings(scoreModel);
    var newMeasures = [];
    var _loop_3 = function (i) {
        var bMeasure = (_e = bassPart.measures) === null || _e === void 0 ? void 0 : _e[i];
        var mMeasure = (_f = melodyPart.measures) === null || _f === void 0 ? void 0 : _f[i];
        if (!bMeasure || !mMeasure)
            return "continue";
        var measureNumber = Number((_h = (_g = bMeasure.number) !== null && _g !== void 0 ? _g : mMeasure.number) !== null && _h !== void 0 ? _h : i + 1);
        var attrs = (_k = (_j = bMeasure.attributes) !== null && _j !== void 0 ? _j : mMeasure.attributes) !== null && _k !== void 0 ? _k : {};
        var measureBeats = measureBeatsFromAttributes(attrs);
        var melodyEvents = ((_l = mMeasure.events) !== null && _l !== void 0 ? _l : []).filter(function (e) { return e && e.type === "note"; });
        var melodyDensity = melodyEvents.length;
        var inMeasure = chords
            .filter(function (c) { return Number(c.measure) === measureNumber; })
            .map(function (c) { return (__assign(__assign({}, c), { t: Number(c.t) })); })
            .filter(function (c) { return Number.isFinite(c.t); })
            .sort(function (a, b) { return Number(a.t) - Number(b.t); });
        var events = [];
        var chordEvents = inMeasure.slice();
        if (!chordEvents.length && lastChord) {
            chordEvents = [__assign(__assign({}, lastChord), { t: 0 })];
        }
        else if (chordEvents.length && chordEvents[0].t > 0) {
            var base = lastChord !== null && lastChord !== void 0 ? lastChord : chordEvents[0];
            chordEvents = __spreadArray([__assign(__assign({}, base), { t: 0 })], chordEvents, true);
        }
        if (!chordEvents.length) {
            events.push({ type: "rest", t: 0, dur: measureBeats });
            newMeasures.push({ number: measureNumber, attributes: attrs, events: events });
            return "continue";
        }
        var _loop_4 = function (ci) {
            var chord = chordEvents[ci];
            var start = Math.max(0, Number(chord.t) || 0);
            var end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1].t) : measureBeats;
            var segDur = Math.max(0, Math.min(end, measureBeats) - start);
            if (segDur <= 0)
                return "continue";
            var bassInfo = parseBassFromChordSymbol(chord.symbol);
            var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
            var primaryPc = (_o = (_m = bassInfo === null || bassInfo === void 0 ? void 0 : bassInfo.pc) !== null && _m !== void 0 ? _m : parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _o !== void 0 ? _o : 0;
            var primarySpelling = (_p = bassInfo === null || bassInfo === void 0 ? void 0 : bassInfo.spelling) !== null && _p !== void 0 ? _p : null;
            var pattern = useRhythmCells ? buildChordalPattern(segDur, measureNumber, start, tempoBpm) : [segDur];
            var cursor = start;
            var _loop_5 = function (dur) {
                var midi = chooseBassMidiWithLeapLimit(primaryPc, prevMidi, range, 43, 12);
                var maxNotes = activity === "less_active" ? 2 : Math.min(4, (_r = (_q = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) === null || _q === void 0 ? void 0 : _q.length) !== null && _r !== void 0 ? _r : 3);
                var voicing = activity === "less_active"
                    ? buildDyadVoicing({ bassMidi: midi, parsed: parsed, range: range })
                    : buildBeginnerChordVoicing({
                        anchorMidi: midi,
                        parsed: parsed,
                        range: range,
                        maxNotes: maxNotes
                    });
                var ordered = voicing.slice().sort(function (a, b) { return a - b; });
                ordered.forEach(function (m, idx) {
                    var pitch = idx === 0 ? pitchWithSpelling(m, primarySpelling) : (0, instrumentCatalog_1.midiToPitch)(m);
                    events.push({ type: "note", t: cursor, dur: dur, midi: m, pitch: pitch, chord: idx > 0 });
                });
                prevMidi = midi;
                cursor += dur;
            };
            for (var _i = 0, pattern_1 = pattern; _i < pattern_1.length; _i++) {
                var dur = pattern_1[_i];
                _loop_5(dur);
            }
        };
        for (var ci = 0; ci < chordEvents.length; ci++) {
            _loop_4(ci);
        }
        newMeasures.push({
            number: measureNumber,
            attributes: attrs ? __assign({}, attrs) : undefined,
            events: events
        });
        lastChord = (_s = chordEvents[chordEvents.length - 1]) !== null && _s !== void 0 ? _s : lastChord;
    };
    for (var i = 0; i < ((_d = bassPart.measures) !== null && _d !== void 0 ? _d : []).length; i++) {
        _loop_3(i);
    }
    bassPart.measures = newMeasures;
    warnings.push("[piano] Chordal accompaniment applied (activity=".concat(activity, ", left-hand chords)."));
    return true;
}
function pickChordForTime(chords, measure, t) {
    var _a;
    var inMeasure = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!inMeasure.length)
        return null;
    var sorted = inMeasure.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var best = null;
    for (var _i = 0, sorted_1 = sorted; _i < sorted_1.length; _i++) {
        var c = sorted_1[_i];
        if (Number(c.t) <= t + 1e-6)
            best = c;
        else
            break;
    }
    return (_a = best !== null && best !== void 0 ? best : sorted[0]) !== null && _a !== void 0 ? _a : null;
}
function chooseBassMidi(pcTarget, prevMidi, range, anchorMidi) {
    if (anchorMidi === void 0) { anchorMidi = 43; }
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (((m % 12) + 12) % 12 === pcTarget)
            candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var c = candidates_2[_i];
        var anchorPenalty = Math.abs(c - anchorMidi);
        var smoothPenalty = Math.abs(c - prevMidi) * 0.35;
        var score = anchorPenalty + smoothPenalty;
        if (score < bestScore) {
            best = c;
            bestScore = score;
        }
    }
    return best;
}
function enforceBassToChords(scoreModel, chords, warnings, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!Array.isArray(chords) || !chords.length)
        return;
    var useMelodyRhythm = (options === null || options === void 0 ? void 0 : options.useMelodyRhythm) !== false;
    var parts = (_a = scoreModel.parts) !== null && _a !== void 0 ? _a : [];
    var melodyPart = (_b = parts.find(function (p) {
        var _a;
        var name = String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase();
        return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    })) !== null && _b !== void 0 ? _b : parts[0];
    var bassPart = (_c = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("bass"); })) !== null && _c !== void 0 ? _c : (parts.length ? parts[parts.length - 1] : null);
    if (!bassPart) {
        warnings.push("[chord-lock] Could not find Bass part to enforce chord roots.");
        return;
    }
    var range = { min: 40, max: 64 }; // E2..E4
    var prevMidi = 43;
    var melodyMeasures = (_d = melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) !== null && _d !== void 0 ? _d : [];
    var canUseMelody = useMelodyRhythm && melodyMeasures.length > 0;
    if (canUseMelody) {
        var newMeasures = [];
        for (var i = 0; i < melodyMeasures.length; i++) {
            var melM = melodyMeasures[i];
            var measureNumber = Number(melM === null || melM === void 0 ? void 0 : melM.number) || (i + 1);
            var melEvents = ((_e = melM === null || melM === void 0 ? void 0 : melM.events) !== null && _e !== void 0 ? _e : []).filter(function (e) { return e && (e.type === "note" || e.type === "rest"); });
            var nextEvents = [];
            for (var _i = 0, melEvents_2 = melEvents; _i < melEvents_2.length; _i++) {
                var ev = melEvents_2[_i];
                if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number")
                    continue;
                var chord = pickChordForTime(chords, measureNumber, Number(ev.t));
                if (!chord) {
                    nextEvents.push({ type: "rest", t: ev.t, dur: ev.dur });
                    continue;
                }
                var bassInfo = parseBassFromChordSymbol(chord.symbol);
                if (!bassInfo) {
                    nextEvents.push({ type: "rest", t: ev.t, dur: ev.dur });
                    continue;
                }
                var midi = chooseBassMidi(bassInfo.pc, prevMidi, range, 43);
                nextEvents.push({
                    type: "note",
                    t: ev.t,
                    dur: ev.dur,
                    midi: midi,
                    pitch: pitchWithSpelling(midi, bassInfo.spelling)
                });
                prevMidi = midi;
            }
            var attrs = (_g = (_f = bassPart === null || bassPart === void 0 ? void 0 : bassPart.measures) === null || _f === void 0 ? void 0 : _f[i]) === null || _g === void 0 ? void 0 : _g.attributes;
            newMeasures.push({
                number: measureNumber,
                attributes: attrs ? __assign({}, attrs) : undefined,
                events: nextEvents
            });
        }
        bassPart.measures = newMeasures;
        return;
    }
    for (var _k = 0, _l = (_h = bassPart.measures) !== null && _h !== void 0 ? _h : []; _k < _l.length; _k++) {
        var m = _l[_k];
        var measureNumber = Number(m === null || m === void 0 ? void 0 : m.number) || 0;
        var events = (_j = m === null || m === void 0 ? void 0 : m.events) !== null && _j !== void 0 ? _j : [];
        for (var _m = 0, events_1 = events; _m < events_1.length; _m++) {
            var ev = events_1[_m];
            if (!ev || (ev.type !== "note" && ev.type !== "rest") || typeof (ev === null || ev === void 0 ? void 0 : ev.t) !== "number")
                continue;
            if (ev.type === "rest")
                continue;
            if (ev.lockPitch === true && (typeof ev.midi === "number" || ev.pitch)) {
                var midi_1 = typeof ev.midi === "number" ? ev.midi : (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
                if (typeof midi_1 === "number" && Number.isFinite(midi_1))
                    prevMidi = midi_1;
                continue;
            }
            var chord = pickChordForTime(chords, measureNumber, Number(ev.t));
            if (!chord) {
                ev.type = "rest";
                delete ev.midi;
                delete ev.pitch;
                continue;
            }
            var bassInfo = parseBassFromChordSymbol(chord.symbol);
            if (!bassInfo) {
                ev.type = "rest";
                delete ev.midi;
                delete ev.pitch;
                continue;
            }
            var midi = chooseBassMidi(bassInfo.pc, prevMidi, range, 43);
            ev.type = "note";
            ev.midi = midi;
            ev.pitch = pitchWithSpelling(midi, bassInfo.spelling);
            prevMidi = midi;
        }
    }
}
function resolveRhythmStyle(styleRaw, warnings) {
    var normalized = String(styleRaw || "classical").toLowerCase();
    var supported = new Set(["classical", "pop", "rock", "funk", "samba", "worship"]);
    if (!supported.has(normalized)) {
        warnings.push("Style \"".concat(styleRaw, "\" not supported by rhythm stage. Defaulting to \"classical\"."));
        return "classical";
    }
    return normalized;
}
function applyAppSettings(scoreModel, settings, chords) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9;
    if (chords === void 0) { chords = []; }
    var warnings = [];
    var ensemble = String((_a = settings.ensemble) !== null && _a !== void 0 ? _a : "").toLowerCase();
    var wantsPianoWithMelody = ensemble === "piano_with_melody";
    var wantsPiano = wantsPianoWithMelody || ensemble === "piano" || ensemble === "grand_piano" || ensemble === "acoustic_piano";
    var wantsStrings = ensemble === "string_ensemble" || ensemble === "strings";
    var wantsWoodwinds = ensemble === "woodwind_ensemble" || ensemble === "woodwinds";
    var useStringEnsembleArranger = settings.useStringEnsembleArranger !== false;
    var instrumentation = (_b = settings.instrumentation) !== null && _b !== void 0 ? _b : "auto";
    var usePianoCopyStringQuartetInstrumentation = wantsStrings && (instrumentation === "piano_copy_to_string_quartet" || instrumentation === "satb_to_string_quartet");
    var detectedKey = getKeyInfo(scoreModel);
    var detectedInputKeyFifths = detectedKey.value;
    var detectedMode = (_c = detectedKey.mode) !== null && _c !== void 0 ? _c : "major";
    var keyMode = (_d = settings.keySignatureMode) !== null && _d !== void 0 ? _d : (settings.targetKey === "original" || settings.keySignature === "original" ? "original" : "manual");
    var targetKey = (_f = (_e = settings.targetKey) !== null && _e !== void 0 ? _e : settings.keySignature) !== null && _f !== void 0 ? _f : "original";
    var target = null;
    if (keyMode !== "original") {
        if (typeof settings.keyFifths === "number" && Number.isFinite(settings.keyFifths)) {
            target = { fifths: settings.keyFifths, mode: "major" };
        }
        else if (targetKey) {
            target = parseKeySignature(targetKey);
            if (!target)
                warnings.push("Could not parse key signature \"".concat(targetKey, "\". Using detected key."));
        }
    }
    var appliedTransposeSemitones = 0;
    if (target && keyMode !== "original") {
        appliedTransposeSemitones = computeTransposeSemitones({
            detectedFifths: detectedInputKeyFifths,
            detectedMode: detectedMode,
            targetFifths: target.fifths,
            targetMode: target.mode
        });
        if (appliedTransposeSemitones !== 0) {
            transposeScoreModel(scoreModel, appliedTransposeSemitones);
        }
        setKeyFifths(scoreModel, target.fifths, target.mode);
    }
    else if (keyMode === "original" && detectedKey.found) {
        setKeyFifths(scoreModel, detectedInputKeyFifths, detectedMode);
    }
    var styleRaw = String((_g = settings.style) !== null && _g !== void 0 ? _g : "").toLowerCase();
    var styleUsed = resolveRhythmStyle(settings.style, warnings);
    var accompanimentRaw = (_j = (_h = settings.accompanimentType) !== null && _h !== void 0 ? _h : settings.accompaniment) !== null && _j !== void 0 ? _j : "";
    var accompaniment = String(accompanimentRaw || "").toLowerCase();
    var isChordal = accompaniment === "chordal";
    var textureMode = String((_k = settings.textureMode) !== null && _k !== void 0 ? _k : "").toLowerCase();
    var useHomorhythmic = textureMode === "homophony_homorhythmic";
    var useMelodyAccomp = textureMode === "homophony_melody_accompaniment";
    var usePolyphonic = textureMode === "polyphony" || accompaniment === "polyphonic";
    var useHomophonic = accompaniment === "homophonic" || isChordal || useHomorhythmic;
    var wantsPianoBeginner = wantsPiano && settings.level === "beginner";
    var wantsPianoChordal = wantsPiano && isChordal;
    var chordalAllowed = wantsPianoChordal && settings.level === "beginner";
    var worshipPiano = wantsPiano && styleRaw === "worship";
    var pianoAdvanced = wantsPiano && settings.level === "advanced";
    var sopranoActivity = (_l = settings.sopranoActivity) !== null && _l !== void 0 ? _l : "grounded";
    var sopranoMelodyShare = typeof settings.sopranoMelodyShare === "number" ? settings.sopranoMelodyShare : 30;
    var useSopranoTexture = wantsPiano && !wantsPianoWithMelody && sopranoActivity !== "grounded";
    var tempoBpm = getTempoBpmFromSettings(scoreModel, settings);
    var omitMelodyInPiano = wantsPianoWithMelody ? false : worshipPiano || useSopranoTexture;
    var pianoEnsembleTag = wantsPianoWithMelody ? "piano_with_melody" : "piano";
    if (usePianoCopyStringQuartetInstrumentation) {
        var finalScore_1 = (0, arrangeStringQuartetFromPianoInstrumentation_1.arrangeStringQuartetFromPianoInstrumentation)(scoreModel, { warnings: warnings });
        attachTextureAnalysis(finalScore_1, warnings);
        return {
            scoreModel: finalScore_1,
            warnings: warnings,
            detectedInputKeyFifths: detectedInputKeyFifths,
            appliedTransposeSemitones: appliedTransposeSemitones,
            styleUsed: styleUsed,
            cadenceMeasures: []
        };
    }
    if (wantsWoodwinds) {
        var finalScore_2 = (0, mapToWoodwindEnsemble_1.mapPianoToWoodwindEnsembleOpen)(scoreModel, {
            level: settings.level,
            accompaniment: accompaniment,
            textureMode: textureMode,
            chords: chords,
            warnings: warnings,
            fluteActivity: (_m = settings.sopranoActivity) !== null && _m !== void 0 ? _m : "less_active",
            oboeActivity: (_o = settings.altoActivity) !== null && _o !== void 0 ? _o : "less_active",
            clarinetActivity: (_p = settings.tenorActivity) !== null && _p !== void 0 ? _p : "less_active",
            bassoonActivity: (_q = settings.bassActivity) !== null && _q !== void 0 ? _q : "less_active"
        });
        attachTextureAnalysis(finalScore_2, warnings);
        return {
            scoreModel: finalScore_2,
            warnings: warnings,
            detectedInputKeyFifths: detectedInputKeyFifths,
            appliedTransposeSemitones: appliedTransposeSemitones,
            styleUsed: styleUsed,
            cadenceMeasures: []
        };
    }
    if (usePolyphonic && accompaniment !== "polyphonic") {
        warnings.push("[texture] Polyphony requested; consider setting accompaniment to polyphonic.");
    }
    if (useHomophonic && !wantsPianoBeginner && !chordalAllowed) {
        var choralResult = (0, applyChoralRhythmFromMelody_1.applyChoralRhythmFromMelody)(scoreModel);
        warnings.push.apply(warnings, ((_r = choralResult.warnings) !== null && _r !== void 0 ? _r : []));
        if (choralResult.applied) {
            warnings.push("[rhythm] Homophonic accompaniment: copied melody rhythm to inner voices and Bass.");
        }
        enforceBassToChords(scoreModel, chords, warnings, { useMelodyRhythm: true });
        var finalScore_3 = wantsPiano
            ? (0, arrangePianoFromSatb_1.arrangePianoFromSatb)(scoreModel, {
                level: settings.level,
                warnings: warnings,
                chords: chords,
                polyphonic: usePolyphonic,
                rhActivity: (_u = (_t = (_s = settings.altoActivity) !== null && _s !== void 0 ? _s : settings.tenorActivity) !== null && _t !== void 0 ? _t : settings.bassActivity) !== null && _u !== void 0 ? _u : "less_active",
                sopranoActivity: sopranoActivity,
                sopranoMelodyShare: sopranoMelodyShare,
                tempoBpm: tempoBpm,
                melodyHand: "right",
                omitMelodyInPiano: omitMelodyInPiano,
                separateMelodyPart: (worshipPiano || useSopranoTexture) && !wantsPianoWithMelody,
                worshipChordPad: wantsPianoWithMelody ? false : worshipPiano,
                pianoStylePreset: settings.pianoStylePreset,
                pianoStylePresetPath: settings.pianoStylePresetPath,
                ensembleTag: pianoEnsembleTag
            })
            : wantsStrings
                ? useStringEnsembleArranger
                    ? (function () {
                        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
                        var profile = usePolyphonic ? "countermelody" : "hymn_support";
                        var stringResult = (0, stringArranger_1.arrangeStringEnsemble)(scoreModel, chords, { profile: profile });
                        warnings.push.apply(warnings, ((_a = stringResult.warnings) !== null && _a !== void 0 ? _a : []));
                        var stringScore = stringResult.scoreModel;
                        if (usePolyphonic) {
                            (0, stringRhythm_1.applyStringPolyphonicRhythm)(stringScore, {
                                vln1Activity: (_b = settings.vln1Activity) !== null && _b !== void 0 ? _b : "grounded",
                                vln2Activity: (_d = (_c = settings.vln2Activity) !== null && _c !== void 0 ? _c : settings.altoActivity) !== null && _d !== void 0 ? _d : "active",
                                vlaActivity: (_f = (_e = settings.vlaActivity) !== null && _e !== void 0 ? _e : settings.tenorActivity) !== null && _f !== void 0 ? _f : "active",
                                vcActivity: (_h = (_g = settings.vcActivity) !== null && _g !== void 0 ? _g : settings.bassActivity) !== null && _h !== void 0 ? _h : "less_active",
                                cbActivity: (_k = (_j = settings.cbActivity) !== null && _j !== void 0 ? _j : settings.bassActivity) !== null && _k !== void 0 ? _k : "less_active",
                                chordEvents: chords,
                                keyFifths: detectedInputKeyFifths,
                                keyMode: detectedMode,
                                syncopate: true,
                                warnings: warnings
                            });
                        }
                        return stringScore;
                    })()
                    : (0, arrangeStringEnsembleFromSatb_1.arrangeStringEnsembleFromSatb)(scoreModel, { level: settings.level, warnings: warnings })
                : scoreModel;
        attachTextureAnalysis(finalScore_3, warnings);
        return {
            scoreModel: finalScore_3,
            warnings: warnings,
            detectedInputKeyFifths: detectedInputKeyFifths,
            appliedTransposeSemitones: appliedTransposeSemitones,
            styleUsed: styleUsed,
            cadenceMeasures: []
        };
    }
    if (useMelodyAccomp) {
        warnings.push("[texture] Melody+accompaniment: keeping inner voices on simpler cadence rhythm.");
    }
    var cadenceMeasures = [];
    var pianoBeginnerApplied = false;
    var pianoPolyphonicApplied = false;
    if (wantsPianoChordal && !chordalAllowed) {
        warnings.push("[piano] Chordal accompaniment is beginner-only. Falling back to homophonic.");
    }
    if (chordalAllowed) {
        pianoBeginnerApplied = applyBeginnerPianoAccompaniment(scoreModel, chords, warnings, {
            activity: (_v = settings.bassActivity) !== null && _v !== void 0 ? _v : "less_active",
            tempoBpm: tempoBpm
        });
    }
    if (usePolyphonic) {
        if (!pianoBeginnerApplied && !wantsStrings) {
            var pianoArpApplied = false;
            if (wantsPiano) {
                pianoArpApplied = applyPianoPolyphonicArpeggioBass(scoreModel, chords, warnings, {
                    activity: (_w = settings.bassActivity) !== null && _w !== void 0 ? _w : "less_active",
                    worship: worshipPiano,
                    level: settings.level,
                    tempoBpm: tempoBpm
                });
            }
            if (pianoArpApplied)
                pianoPolyphonicApplied = true;
            if (!pianoArpApplied) {
                var bassRhythm = (0, applyPolyphonicBassCounterRhythm_1.applyPolyphonicBassCounterRhythm)(scoreModel, chords, {
                    allowRests: true,
                    activity: (_x = settings.bassActivity) !== null && _x !== void 0 ? _x : "less_active",
                    randomizeOffsets: settings.randomizeOffsets !== false,
                    minMidiOverride: pianoAdvanced ? 40 : undefined,
                    maxMidiOverride: pianoAdvanced ? 52 : undefined
                });
                warnings.push.apply(warnings, ((_y = bassRhythm.warnings) !== null && _y !== void 0 ? _y : []));
            }
            var tenorActivity = (_0 = (_z = settings.tenorActivity) !== null && _z !== void 0 ? _z : settings.bassActivity) !== null && _0 !== void 0 ? _0 : "less_active";
            var tenorRhythm = (0, applyPolyphonicBassCounterRhythm_1.applyPolyphonicTenorCounterRhythm)(scoreModel, chords, {
                allowRests: true,
                activity: tenorActivity,
                randomizeOffsets: settings.randomizeOffsets !== false,
                minMidiOverride: pianoAdvanced ? 52 : undefined,
                maxMidiOverride: pianoAdvanced ? 64 : undefined,
                durationWhitelist: wantsPiano && worshipPiano && settings.level === "advanced" && tenorActivity === "less_active" ? [1, 2] : undefined
            });
            warnings.push.apply(warnings, ((_1 = tenorRhythm.warnings) !== null && _1 !== void 0 ? _1 : []));
            var altoRhythm = (0, applyPolyphonicBassCounterRhythm_1.applyPolyphonicAltoCounterRhythm)(scoreModel, chords, {
                allowRests: true,
                activity: (_3 = (_2 = settings.altoActivity) !== null && _2 !== void 0 ? _2 : settings.bassActivity) !== null && _3 !== void 0 ? _3 : "less_active",
                randomizeOffsets: settings.randomizeOffsets !== false
            });
            warnings.push.apply(warnings, ((_4 = altoRhythm.warnings) !== null && _4 !== void 0 ? _4 : []));
        }
    }
    else {
        if (!pianoBeginnerApplied) {
            if (styleUsed === "funk" || styleUsed === "samba") {
                // eslint-disable-next-line no-console
                console.log("[rhythm] Bass leap policy: allow larger leaps for funk/samba.");
            }
            else {
                // eslint-disable-next-line no-console
                console.log("[rhythm] Bass leap policy: keep bass grounded for style=\"".concat(styleUsed, "\"."));
            }
            var rhythmResult = (0, applyRhythmToBassFinalCadence_1.applyRhythmToBassFinalCadence)(scoreModel, {
                style: styleUsed,
                role: "bass",
                applyOnlyFinalCadence: true,
                warnOnly: true,
                level: settings.level
            });
            warnings.push.apply(warnings, ((_5 = rhythmResult.warnings) !== null && _5 !== void 0 ? _5 : []));
            cadenceMeasures = (_6 = rhythmResult.appliedMeasureNumbers) !== null && _6 !== void 0 ? _6 : [];
        }
    }
    var useMelodyRhythmForChordLock = useHomophonic && !pianoBeginnerApplied;
    var useMelodyRhythmForBass = useMelodyRhythmForChordLock && !(wantsPiano && usePolyphonic);
    if (!pianoBeginnerApplied && !wantsStrings) {
        enforceBassToChords(scoreModel, chords, warnings, { useMelodyRhythm: useMelodyRhythmForBass });
    }
    var finalScore = wantsPiano
        ? (0, arrangePianoFromSatb_1.arrangePianoFromSatb)(scoreModel, {
            level: settings.level,
            warnings: warnings,
            chords: chords,
            polyphonic: usePolyphonic,
            rhActivity: (_9 = (_8 = (_7 = settings.altoActivity) !== null && _7 !== void 0 ? _7 : settings.tenorActivity) !== null && _8 !== void 0 ? _8 : settings.bassActivity) !== null && _9 !== void 0 ? _9 : "less_active",
            sopranoActivity: sopranoActivity,
            sopranoMelodyShare: sopranoMelodyShare,
            tempoBpm: tempoBpm,
            melodyHand: "right",
            omitMelodyInPiano: omitMelodyInPiano,
            separateMelodyPart: (worshipPiano || useSopranoTexture) && !wantsPianoWithMelody,
            worshipChordPad: wantsPianoWithMelody ? false : worshipPiano,
            pianoStylePreset: settings.pianoStylePreset,
            pianoStylePresetPath: settings.pianoStylePresetPath,
            ensembleTag: pianoEnsembleTag
        })
        : wantsStrings
            ? useStringEnsembleArranger
                ? (function () {
                    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
                    var profile = usePolyphonic ? "countermelody" : "hymn_support";
                    var stringResult = usePolyphonic
                        ? (0, stringsPolyphonicArranger_1.arrangeStringPolyphonic)(scoreModel, chords, { level: settings.level })
                        : (0, stringArranger_1.arrangeStringEnsemble)(scoreModel, chords, { profile: profile });
                    warnings.push.apply(warnings, ((_a = stringResult.warnings) !== null && _a !== void 0 ? _a : []));
                    var stringScore = stringResult.scoreModel;
                    if (usePolyphonic) {
                        var levelRaw = String((_b = settings.level) !== null && _b !== void 0 ? _b : "").toLowerCase();
                        var melodyShift = levelRaw === "intermediate" || levelRaw === "advanced" ? 12 : 0;
                        var melodyEvents_1 = extractMelodyEventsForStrings(scoreModel, melodyShift);
                        (0, stringRhythm_1.applyStringPolyphonicRhythm)(stringScore, {
                            vln1Activity: (_c = settings.vln1Activity) !== null && _c !== void 0 ? _c : "grounded",
                            vln2Activity: (_e = (_d = settings.vln2Activity) !== null && _d !== void 0 ? _d : settings.altoActivity) !== null && _e !== void 0 ? _e : "active",
                            vlaActivity: (_g = (_f = settings.vlaActivity) !== null && _f !== void 0 ? _f : settings.tenorActivity) !== null && _g !== void 0 ? _g : "active",
                            vcActivity: (_j = (_h = settings.vcActivity) !== null && _h !== void 0 ? _h : settings.bassActivity) !== null && _j !== void 0 ? _j : "less_active",
                            cbActivity: (_l = (_k = settings.cbActivity) !== null && _k !== void 0 ? _k : settings.bassActivity) !== null && _l !== void 0 ? _l : "less_active",
                            chordEvents: chords,
                            keyFifths: detectedInputKeyFifths,
                            keyMode: detectedMode,
                            syncopate: true,
                            allowNonChordTones: true,
                            preserveVln1Melody: true,
                            enforceChordRootBass: true,
                            level: settings.level,
                            warnings: warnings
                        });
                        var vln1Part = ((_m = stringScore.parts) !== null && _m !== void 0 ? _m : []).find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("violin i"); });
                        if (vln1Part) {
                            vln1Part.measures = vln1Part.measures.map(function (m) {
                                var _a, _b;
                                return (__assign(__assign({}, m), { events: ((_b = (_a = melodyEvents_1[m.number]) !== null && _a !== void 0 ? _a : m.events) !== null && _b !== void 0 ? _b : []).sort(function (a, b) { return Number(a.t) - Number(b.t); }) }));
                            });
                        }
                    }
                    return stringScore;
                })()
                : (0, arrangeStringEnsembleFromSatb_1.arrangeStringEnsembleFromSatb)(scoreModel, { level: settings.level, warnings: warnings })
            : scoreModel;
    attachTextureAnalysis(finalScore, warnings);
    return {
        scoreModel: finalScore,
        warnings: warnings,
        detectedInputKeyFifths: detectedInputKeyFifths,
        appliedTransposeSemitones: appliedTransposeSemitones,
        styleUsed: styleUsed,
        cadenceMeasures: cadenceMeasures
    };
}
