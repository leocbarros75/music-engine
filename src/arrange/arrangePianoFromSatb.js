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
exports.arrangePianoFromSatb = arrangePianoFromSatb;
var fs_1 = require("fs");
var path_1 = require("path");
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
var chordSymbol_1 = require("../harmonize/satb/chordSymbol");
var STEP_TO_PC = {
    C: 0,
    D: 2,
    E: 4,
    F: 5,
    G: 7,
    A: 9,
    B: 11
};
var REPEAT_RATIO = 0.2;
function warn(warnings, msg) {
    warnings.push(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
}
function isNoteOrRest(e) {
    return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}
function near(a, b, eps) {
    if (eps === void 0) { eps = 1e-6; }
    return Math.abs(a - b) <= eps;
}
function isStrongBeat(t) {
    return near(t, Math.round(t));
}
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
function parseBassTargetFromChordSymbol(symbolRaw) {
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
function chordQualityFlags(symbolRaw) {
    var _a;
    var s = String(symbolRaw || "").trim();
    if (!s)
        return { isMajor: false, isMinor: false, isDominant: false };
    var m = s.match(/^([A-Ga-g][#b]?)(.*)$/);
    if (!m)
        return { isMajor: false, isMinor: false, isDominant: false };
    var qual = ((_a = m[2]) !== null && _a !== void 0 ? _a : "").trim().toLowerCase();
    var isMaj = qual.startsWith("maj") || qual.includes("maj");
    var isMin = !isMaj && (qual.startsWith("m") || qual.startsWith("min"));
    var isDim = qual.includes("dim") || qual.includes("°");
    var isAug = qual.includes("aug");
    var isDom = qual.includes("7") && !isMaj && !isMin && !isDim && !isAug;
    var isMajor = !isMin && !isDim && !isAug;
    return { isMajor: isMajor, isMinor: isMin, isDominant: isDom };
}
function resolvePresetPath(presetNameOrPath, warnings) {
    if (!presetNameOrPath)
        return null;
    var cwd = process.cwd();
    var candidate = path_1.default.isAbsolute(presetNameOrPath)
        ? presetNameOrPath
        : path_1.default.join(cwd, "rules", "piano", "".concat(presetNameOrPath, ".json"));
    var resolved = path_1.default.resolve(candidate);
    var root = path_1.default.resolve(cwd);
    if (!resolved.startsWith(root)) {
        warn(warnings, "[piano] Preset path \"".concat(presetNameOrPath, "\" is outside the repo root."));
        return null;
    }
    if (!fs_1.default.existsSync(resolved)) {
        warn(warnings, "[piano] Preset file not found: ".concat(resolved));
        return null;
    }
    return resolved;
}
function loadPianoStylePreset(presetNameOrPath, warnings) {
    var _a;
    if (!presetNameOrPath)
        return null;
    var resolved = resolvePresetPath(presetNameOrPath, warnings);
    if (!resolved)
        return null;
    try {
        var raw = fs_1.default.readFileSync(resolved, "utf-8");
        var json = JSON.parse(raw);
        if (!json || typeof json !== "object")
            return null;
        return json;
    }
    catch (err) {
        warn(warnings, "[piano] Failed to read preset \"".concat(presetNameOrPath, "\": ").concat(String((_a = err === null || err === void 0 ? void 0 : err.message) !== null && _a !== void 0 ? _a : err)));
        return null;
    }
}
function patternOnsetsFromArray(pattern, measureBeats) {
    if (!Array.isArray(pattern) || pattern.length === 0)
        return [];
    if (!Number.isFinite(measureBeats) || measureBeats <= 0)
        return [];
    var step = measureBeats / pattern.length;
    var onsets = [];
    for (var i = 0; i < pattern.length; i++) {
        if (pattern[i]) {
            onsets.push(Math.round(i * step * 1000) / 1000);
        }
    }
    if (!onsets.length)
        return [];
    return Array.from(new Set(onsets)).sort(function (a, b) { return a - b; });
}
function slicePatternOnsets(onsets, start, end) {
    var within = onsets.filter(function (t) { return t >= start - 1e-6 && t < end - 1e-6; });
    if (!within.length)
        return [start];
    if (Math.abs(within[0] - start) > 1e-6)
        within.unshift(start);
    return within;
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
function pickMidiForPcNear(pc, nearMidi, range) {
    var targetPc = ((pc % 12) + 12) % 12;
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (((m % 12) + 12) % 12 === targetPc)
            candidates.push(m);
    }
    if (!candidates.length)
        return null;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var c = candidates_1[_i];
        var score = Math.abs(c - nearMidi);
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
}
function shouldAllowRepeat(measureNumber, t, ratio, salt) {
    if (ratio === void 0) { ratio = REPEAT_RATIO; }
    if (salt === void 0) { salt = 0; }
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
function resolveChordsForArrange(chords, score) {
    var _a, _b;
    if (Array.isArray(chords) && chords.length)
        return chords;
    var meta = (_a = score === null || score === void 0 ? void 0 : score.meta) !== null && _a !== void 0 ? _a : {};
    var inputChords = Array.isArray(meta === null || meta === void 0 ? void 0 : meta.inputChords) ? meta.inputChords : [];
    if (inputChords.length)
        return inputChords;
    var inferred = Array.isArray((_b = meta === null || meta === void 0 ? void 0 : meta.harmonize) === null || _b === void 0 ? void 0 : _b.chords) ? meta.harmonize.chords : [];
    return inferred;
}
function findPart(score, predicate) {
    var _a;
    for (var _i = 0, _b = (_a = score.parts) !== null && _a !== void 0 ? _a : []; _i < _b.length; _i++) {
        var p = _b[_i];
        if (predicate(p))
            return p;
    }
    return null;
}
function findSoprano(score) {
    var _a, _b, _c, _d, _e;
    return ((_c = (_b = (_a = findPart(score, function (p) { return String(p.part_id).toLowerCase() === "p_s"; })) !== null && _a !== void 0 ? _a : findPart(score, function (p) { var _a; return String((_a = p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("soprano"); })) !== null && _b !== void 0 ? _b : findPart(score, function (p) { var _a; return String((_a = p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("melody"); })) !== null && _c !== void 0 ? _c : ((_e = (_d = score.parts) === null || _d === void 0 ? void 0 : _d[0]) !== null && _e !== void 0 ? _e : null));
}
function findAlto(score) {
    var _a, _b;
    return ((_b = (_a = findPart(score, function (p) { return String(p.part_id).toLowerCase() === "p_a"; })) !== null && _a !== void 0 ? _a : findPart(score, function (p) { var _a; return String((_a = p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("alto"); })) !== null && _b !== void 0 ? _b : null);
}
function findTenor(score) {
    var _a, _b;
    return ((_b = (_a = findPart(score, function (p) { return String(p.part_id).toLowerCase() === "p_t"; })) !== null && _a !== void 0 ? _a : findPart(score, function (p) { var _a; return String((_a = p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("tenor"); })) !== null && _b !== void 0 ? _b : null);
}
function findBass(score) {
    var _a, _b, _c, _d;
    return ((_b = (_a = findPart(score, function (p) { return String(p.part_id).toLowerCase() === "p_b"; })) !== null && _a !== void 0 ? _a : findPart(score, function (p) { var _a; return String((_a = p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("bass"); })) !== null && _b !== void 0 ? _b : ((_d = (_c = score.parts) === null || _c === void 0 ? void 0 : _c[score.parts.length - 1]) !== null && _d !== void 0 ? _d : null));
}
function cloneMeasuresTemplate(src) {
    var _a;
    return ((_a = src.measures) !== null && _a !== void 0 ? _a : []).map(function (m) { return ({
        number: m.number,
        attributes: m.attributes ? __assign({}, m.attributes) : undefined,
        events: []
    }); });
}
function cloneMeasuresWithEvents(src) {
    var _a;
    return ((_a = src.measures) !== null && _a !== void 0 ? _a : []).map(function (m) {
        var _a;
        return ({
            number: m.number,
            attributes: m.attributes ? __assign({}, m.attributes) : undefined,
            events: ((_a = m.events) !== null && _a !== void 0 ? _a : []).map(function (e) { return (__assign({}, e)); })
        });
    });
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
function findNoteMidiAtTime(events, t) {
    var _a;
    var active = null;
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var e = events_1[_i];
        if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
            continue;
        var et = Number(e.t);
        var ed = Number(e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(ed))
            continue;
        if (et <= t && t < et + ed) {
            active = e;
            break;
        }
    }
    if (!active) {
        active = (_a = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e.t) === t; })) !== null && _a !== void 0 ? _a : null;
    }
    return active ? eventMidi(active) : null;
}
function findNoteMidiAtOrBeforeTime(events, t) {
    var last = null;
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var e = events_2[_i];
        if ((e === null || e === void 0 ? void 0 : e.type) !== "note")
            continue;
        var et = Number(e.t);
        if (!Number.isFinite(et))
            continue;
        if (et <= t) {
            if (!last || et > Number(last.t))
                last = e;
        }
    }
    return last ? eventMidi(last) : null;
}
function setEventMidi(ev, midi) {
    ev.midi = midi;
    ev.pitch = (0, instrumentCatalog_1.midiToPitch)(midi);
}
function adjustMidiToRangeByOctave(midi, min, max) {
    var m = midi;
    while (m < min)
        m += 12;
    while (m > max)
        m -= 12;
    if (m < min || m > max)
        return null;
    return m;
}
function clampMidiToRange(midi, min, max) {
    if (midi < min)
        return min;
    if (midi > max)
        return max;
    return midi;
}
function findActiveEvent(events, staff, voice, t) {
    for (var _i = 0, events_3 = events; _i < events_3.length; _i++) {
        var e = events_3[_i];
        if (!e || e.type !== "note")
            continue;
        if (e.staff !== staff || e.voice !== voice)
            continue;
        var et = Number(e.t);
        var dur = Number(e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(dur))
            continue;
        if (et <= t && t < et + dur)
            return e;
    }
    return null;
}
function enforceVoiceSpacingForMeasure(events, measureNumber, measureBeats, warnings, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    var times = new Set();
    for (var _i = 0, events_4 = events; _i < events_4.length; _i++) {
        var e = events_4[_i];
        if (e && e.type === "note" && Number.isFinite(e.t)) {
            var start = Number(e.t);
            times.add(start);
            var dur = Number(e.dur);
            if (Number.isFinite(dur) && dur > 0) {
                var end = Math.round((start + dur) * 1000) / 1000;
                times.add(end);
            }
        }
    }
    var beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (var b = 0; b < beatCount; b += 1) {
        times.add(b);
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    var hasVoice4 = events.some(function (e) { return e && e.staff === 2 && e.voice === 4; });
    var bassVoice = hasVoice4 ? 4 : 3;
    var tenorVoice = hasVoice4 ? 3 : null;
    var harmonyMin = Math.min(41, (_b = (_a = options === null || options === void 0 ? void 0 : options.bassRange) === null || _a === void 0 ? void 0 : _a.min) !== null && _b !== void 0 ? _b : 128, (_d = (_c = options === null || options === void 0 ? void 0 : options.tenorRange) === null || _c === void 0 ? void 0 : _c.min) !== null && _d !== void 0 ? _d : 128, (_f = (_e = options === null || options === void 0 ? void 0 : options.altoRange) === null || _e === void 0 ? void 0 : _e.min) !== null && _f !== void 0 ? _f : 128, (_h = (_g = options === null || options === void 0 ? void 0 : options.sopranoRange) === null || _g === void 0 ? void 0 : _g.min) !== null && _h !== void 0 ? _h : 128);
    var harmonyMax = Math.max(72, (_k = (_j = options === null || options === void 0 ? void 0 : options.bassRange) === null || _j === void 0 ? void 0 : _j.max) !== null && _k !== void 0 ? _k : 0, (_m = (_l = options === null || options === void 0 ? void 0 : options.tenorRange) === null || _l === void 0 ? void 0 : _l.max) !== null && _m !== void 0 ? _m : 0, (_p = (_o = options === null || options === void 0 ? void 0 : options.altoRange) === null || _o === void 0 ? void 0 : _o.max) !== null && _p !== void 0 ? _p : 0, (_r = (_q = options === null || options === void 0 ? void 0 : options.sopranoRange) === null || _q === void 0 ? void 0 : _q.max) !== null && _r !== void 0 ? _r : 0);
    var sopranoRange = (_s = options === null || options === void 0 ? void 0 : options.sopranoRange) !== null && _s !== void 0 ? _s : { min: harmonyMin, max: harmonyMax };
    var altoRange = (_t = options === null || options === void 0 ? void 0 : options.altoRange) !== null && _t !== void 0 ? _t : { min: harmonyMin, max: harmonyMax };
    var tenorRange = (_u = options === null || options === void 0 ? void 0 : options.tenorRange) !== null && _u !== void 0 ? _u : { min: harmonyMin, max: harmonyMax };
    var bassRange = (_v = options === null || options === void 0 ? void 0 : options.bassRange) !== null && _v !== void 0 ? _v : { min: harmonyMin, max: harmonyMax };
    for (var _w = 0, orderedTimes_1 = orderedTimes; _w < orderedTimes_1.length; _w++) {
        var t = orderedTimes_1[_w];
        var sEv = findActiveEvent(events, 1, 1, t);
        var aEv = findActiveEvent(events, 1, 2, t);
        var tEv = tenorVoice ? findActiveEvent(events, 2, tenorVoice, t) : null;
        var bEv = findActiveEvent(events, 2, bassVoice, t);
        var sMidi = sEv ? eventMidi(sEv) : null;
        var aMidi = aEv ? eventMidi(aEv) : null;
        var tMidi = tEv ? eventMidi(tEv) : null;
        var bMidi = bEv ? eventMidi(bEv) : null;
        if (tEv && typeof tMidi === "number") {
            var min = tenorRange.min, max = tenorRange.max;
            if (tMidi < min || tMidi > max) {
                var adj = adjustMidiToRangeByOctave(tMidi, min, max);
                if (adj !== null) {
                    setEventMidi(tEv, adj);
                    tMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(tMidi, min, max);
                    setEventMidi(tEv, clamped);
                    tMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor clamped to range."));
                }
            }
        }
        if (bEv && typeof bMidi === "number") {
            var min = bassRange.min, max = bassRange.max;
            if (bMidi < min || bMidi > max) {
                var adj = adjustMidiToRangeByOctave(bMidi, min, max);
                if (adj !== null) {
                    setEventMidi(bEv, adj);
                    bMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(bMidi, min, max);
                    setEventMidi(bEv, clamped);
                    bMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Bass clamped to range."));
                }
            }
        }
        var sLocked = sEv && (sEv.__lockPitch === true || sEv.__melody === true);
        if (sEv && typeof sMidi === "number" && !sLocked) {
            var min = sopranoRange.min, max = sopranoRange.max;
            if (sMidi < min || sMidi > max) {
                var adj = adjustMidiToRangeByOctave(sMidi, min, max);
                if (adj !== null) {
                    setEventMidi(sEv, adj);
                    sMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(sMidi, min, max);
                    setEventMidi(sEv, clamped);
                    sMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Soprano clamped to range."));
                }
            }
        }
        if (aEv && typeof aMidi === "number") {
            var min = altoRange.min, max = altoRange.max;
            if (aMidi < min || aMidi > max) {
                var adj = adjustMidiToRangeByOctave(aMidi, min, max);
                if (adj !== null) {
                    setEventMidi(aEv, adj);
                    aMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(aMidi, min, max);
                    setEventMidi(aEv, clamped);
                    aMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Alto clamped to range."));
                }
            }
        }
        if (options === null || options === void 0 ? void 0 : options.allowOverlap)
            continue;
        // Soprano/Alto: max octave (do not move locked melody)
        if (aEv && typeof aMidi === "number" && typeof sMidi === "number") {
            var minA = Math.max(sMidi - 12, altoRange.min);
            var maxA = Math.min(sMidi - 1, altoRange.max);
            if (minA <= maxA && (aMidi < minA || aMidi > maxA)) {
                var adj = adjustMidiToRangeByOctave(aMidi, minA, maxA);
                if (adj !== null) {
                    setEventMidi(aEv, adj);
                    aMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(aMidi, minA, maxA);
                    setEventMidi(aEv, clamped);
                    aMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Alto/Soprano spacing clamped to octave."));
                }
            }
            if (!sLocked && aMidi !== null && sMidi !== null && sMidi - aMidi > 12) {
                var minS = Math.max(aMidi + 1, sopranoRange.min);
                var maxS = Math.min(aMidi + 12, sopranoRange.max);
                if (minS <= maxS) {
                    var adj = adjustMidiToRangeByOctave(sMidi, minS, maxS);
                    if (adj !== null) {
                        setEventMidi(sEv, adj);
                        sMidi = adj;
                    }
                    else {
                        var clamped = clampMidiToRange(sMidi, minS, maxS);
                        setEventMidi(sEv, clamped);
                        sMidi = clamped;
                    }
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Soprano adjusted to octave with Alto."));
                }
            }
        }
        // Alto/Tenor: max octave (allow unison between Alto and Tenor)
        if (tEv && typeof tMidi === "number" && typeof aMidi === "number") {
            var minT = Math.max(aMidi - 12, tenorRange.min);
            var maxT = Math.min(aMidi, tenorRange.max);
            if (minT <= maxT && (tMidi < minT || tMidi > maxT)) {
                var adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
                if (adj !== null) {
                    setEventMidi(tEv, adj);
                    tMidi = adj;
                }
                else {
                    var clamped = clampMidiToRange(tMidi, minT, maxT);
                    setEventMidi(tEv, clamped);
                    tMidi = clamped;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor/Alto spacing clamped to octave."));
                }
            }
            if (tMidi !== null && aMidi !== null && aMidi - tMidi > 12) {
                var minA = Math.max(tMidi, altoRange.min);
                var maxA = Math.min(tMidi + 12, altoRange.max);
                if (minA <= maxA) {
                    var adj = adjustMidiToRangeByOctave(aMidi, minA, maxA);
                    if (adj !== null) {
                        setEventMidi(aEv, adj);
                        aMidi = adj;
                    }
                    else {
                        var clamped = clampMidiToRange(aMidi, minA, maxA);
                        setEventMidi(aEv, clamped);
                        aMidi = clamped;
                    }
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Alto adjusted to octave with Tenor."));
                }
            }
        }
        // Tenor/Bass: max octave
        if (bEv && typeof bMidi === "number" && typeof tMidi === "number") {
            var bassLocked = bEv.__lockPitch === true;
            var minB = Math.max(tMidi - 12, bassRange.min);
            var maxB = Math.min(tMidi - 1, bassRange.max);
            if (minB <= maxB && (bMidi < minB || bMidi > maxB)) {
                if (!bassLocked) {
                    var adj = adjustMidiToRangeByOctave(bMidi, minB, maxB);
                    if (adj !== null) {
                        setEventMidi(bEv, adj);
                        bMidi = adj;
                    }
                    else {
                        var clamped = clampMidiToRange(bMidi, minB, maxB);
                        setEventMidi(bEv, clamped);
                        bMidi = clamped;
                        warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Bass/Tenor spacing clamped to octave."));
                    }
                }
                else {
                    var minT = Math.max(tenorRange.min, bMidi + 1);
                    var maxT = Math.min(tenorRange.max, bMidi + 12);
                    if (minT <= maxT) {
                        var adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
                        if (adj !== null) {
                            setEventMidi(tEv, adj);
                            tMidi = adj;
                        }
                        else {
                            var clamped = clampMidiToRange(tMidi, minT, maxT);
                            setEventMidi(tEv, clamped);
                            tMidi = clamped;
                        }
                        warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor adjusted to maintain bass interval."));
                    }
                }
            }
            if (bMidi !== null && tMidi !== null && tMidi - bMidi > 12) {
                var minT = Math.max(bMidi + 1, tenorRange.min);
                var maxT = Math.min(bMidi + 12, tenorRange.max);
                if (minT <= maxT) {
                    var adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
                    if (adj !== null) {
                        setEventMidi(tEv, adj);
                        tMidi = adj;
                    }
                    else {
                        var clamped = clampMidiToRange(tMidi, minT, maxT);
                        setEventMidi(tEv, clamped);
                        tMidi = clamped;
                    }
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor adjusted to octave with Bass."));
                }
            }
        }
        var minTb = options === null || options === void 0 ? void 0 : options.tenorBassMin;
        var minInterval = typeof minTb === "number" && Number.isFinite(minTb) ? minTb : null;
        if (typeof bMidi === "number" && bMidi < 48) {
            minInterval = Math.max(minInterval !== null && minInterval !== void 0 ? minInterval : 0, 7);
        }
        if (typeof minInterval === "number" &&
            Number.isFinite(minInterval) &&
            bEv &&
            tEv &&
            typeof bMidi === "number" &&
            typeof tMidi === "number") {
            var currentInterval = tMidi - bMidi;
            if (currentInterval < minInterval) {
                var tenorMin = tenorRange.min;
                var tenorMax = tenorRange.max;
                var bassMin = bassRange.min;
                var bassMax = bassRange.max;
                var desiredTenorMin = Math.max(tenorMin, bMidi + minInterval);
                var adjustedTenor = adjustMidiToRangeByOctave(tMidi, desiredTenorMin, tenorMax);
                if (adjustedTenor !== null) {
                    setEventMidi(tEv, adjustedTenor);
                    tMidi = adjustedTenor;
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor raised to maintain bass interval."));
                }
                else {
                    var bassLocked = bEv.__lockPitch === true;
                    var desiredBassMax = Math.min(bassMax, tMidi - minInterval);
                    if (!bassLocked) {
                        var adjustedBass = adjustMidiToRangeByOctave(bMidi, bassMin, desiredBassMax);
                        if (adjustedBass !== null) {
                            setEventMidi(bEv, adjustedBass);
                            bMidi = adjustedBass;
                            warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Bass lowered to maintain tenor interval."));
                        }
                        else {
                            var clampedTenor = clampMidiToRange(tMidi, desiredTenorMin, tenorMax);
                            var clampedBass = clampMidiToRange(bMidi, bassMin, desiredBassMax);
                            setEventMidi(tEv, clampedTenor);
                            setEventMidi(bEv, clampedBass);
                            warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Bass/Tenor interval clamped to minimum."));
                        }
                    }
                    else {
                        var clampedTenor = clampMidiToRange(tMidi, desiredTenorMin, tenorMax);
                        setEventMidi(tEv, clampedTenor);
                        tMidi = clampedTenor;
                        warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": Tenor clamped to maintain bass interval."));
                    }
                }
            }
        }
    }
}
function clampVoiceLeapsForMeasure(events, staff, voice, maxLeap, measureNumber, warnings) {
    var seq = events
        .filter(function (e) { return e && e.type === "note" && e.staff === staff && e.voice === voice && Number.isFinite(e.t); })
        .sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var prevMidi = null;
    for (var _i = 0, seq_1 = seq; _i < seq_1.length; _i++) {
        var ev = seq_1[_i];
        var midi = eventMidi(ev);
        if (midi === null)
            continue;
        if (prevMidi === null) {
            prevMidi = midi;
            continue;
        }
        if (Math.abs(midi - prevMidi) <= maxLeap) {
            prevMidi = midi;
            continue;
        }
        var min = prevMidi - maxLeap;
        var max = prevMidi + maxLeap;
        var adj = adjustMidiToRangeByOctave(midi, min, max);
        if (adj !== null) {
            setEventMidi(ev, adj);
            prevMidi = adj;
            continue;
        }
        var clamped = clampMidiToRange(midi, min, max);
        setEventMidi(ev, clamped);
        warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(ev.t, ": leap clamped for staff ").concat(staff, " voice ").concat(voice, "."));
        prevMidi = clamped;
    }
}
function getTempoBpm(score, fallback) {
    var _a;
    if (fallback === void 0) { fallback = 120; }
    var tempo = Number((_a = score.meta) === null || _a === void 0 ? void 0 : _a.tempo_bpm);
    if (Number.isFinite(tempo) && tempo > 0)
        return tempo;
    return fallback;
}
function findActiveNotesAtTime(events, staff, t) {
    var out = [];
    for (var _i = 0, events_5 = events; _i < events_5.length; _i++) {
        var e = events_5[_i];
        if (!e || e.type !== "note")
            continue;
        if (e.staff !== staff)
            continue;
        if (e.__drop)
            continue;
        var et = Number(e.t);
        var dur = Number(e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(dur))
            continue;
        if (et <= t && t < et + dur) {
            var midi = eventMidi(e);
            if (typeof midi === "number")
                out.push({ ev: e, midi: midi });
        }
    }
    return out;
}
function markEventDrop(ev) {
    ev.__drop = true;
}
function trimEventsToMeasure(events, measureBeats, measureNumber, warnings) {
    if (!Number.isFinite(measureBeats) || measureBeats <= 0)
        return;
    var trimmed = false;
    for (var _i = 0, events_6 = events; _i < events_6.length; _i++) {
        var ev = events_6[_i];
        if (!ev || (ev.type !== "note" && ev.type !== "rest"))
            continue;
        var t = Number(ev.t);
        var dur = Number(ev.dur);
        if (!Number.isFinite(t) || !Number.isFinite(dur))
            continue;
        if (t < 0) {
            t = 0;
            ev.t = 0;
            trimmed = true;
        }
        if (t >= measureBeats - 1e-6) {
            markEventDrop(ev);
            trimmed = true;
            continue;
        }
        var end = t + dur;
        if (end > measureBeats + 1e-6) {
            dur = Math.max(0, measureBeats - t);
            ev.dur = dur;
            trimmed = true;
        }
        if (dur <= 1e-6) {
            markEventDrop(ev);
            trimmed = true;
        }
    }
    if (trimmed) {
        warn(warnings, "[piano] m".concat(measureNumber, ": trimmed events to measure length."));
    }
}
function limitHandNoteCountAtTime(events, staff, t, maxNotes, measureNumber, warnings) {
    var active = findActiveNotesAtTime(events, staff, t);
    if (active.length <= maxNotes)
        return;
    var sorted = active.slice().sort(function (a, b) { return a.midi - b.midi; });
    var forceKeep = sorted.filter(function (a) { return a.ev.__forceKeep || a.ev.__lockPitch; });
    var keep = new Set();
    for (var _i = 0, forceKeep_1 = forceKeep; _i < forceKeep_1.length; _i++) {
        var fk = forceKeep_1[_i];
        var idx = sorted.indexOf(fk);
        if (idx >= 0)
            keep.add(idx);
    }
    if (sorted.length > 0) {
        keep.add(0);
        keep.add(sorted.length - 1);
    }
    var lo = 0;
    var hi = sorted.length - 1;
    var toggle = true;
    while (keep.size < Math.min(maxNotes, sorted.length)) {
        if (toggle) {
            if (!keep.has(hi))
                keep.add(hi);
            hi -= 1;
        }
        else {
            if (!keep.has(lo))
                keep.add(lo);
            lo += 1;
        }
        toggle = !toggle;
        if (lo > hi)
            break;
    }
    var dropped = false;
    for (var i = 0; i < sorted.length; i++) {
        if (keep.has(i))
            continue;
        markEventDrop(sorted[i].ev);
        dropped = true;
    }
    if (dropped) {
        warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": trimmed hand to ").concat(maxNotes, " notes."));
    }
}
function enforceHandLimitsForMeasure(params) {
    var _a, _b, _c, _d;
    var events = params.events, measureNumber = params.measureNumber, measureBeats = params.measureBeats, warnings = params.warnings;
    var maxSpan = (_a = params.maxSpan) !== null && _a !== void 0 ? _a : 12; // octave
    var maxNotes = (_b = params.maxNotes) !== null && _b !== void 0 ? _b : 4;
    var rhRange = (_c = params.rhRange) !== null && _c !== void 0 ? _c : { min: 52, max: 88 };
    var lhRange = (_d = params.lhRange) !== null && _d !== void 0 ? _d : { min: 36, max: 72 };
    var suppressSpanWarnings = params.suppressSpanWarnings === true;
    var times = new Set();
    for (var _i = 0, events_7 = events; _i < events_7.length; _i++) {
        var e = events_7[_i];
        if (e && e.type === "note" && Number.isFinite(e.t)) {
            var start = Number(e.t);
            times.add(start);
            var dur = Number(e.dur);
            if (Number.isFinite(dur) && dur > 0) {
                var end = Math.round((start + dur) * 1000) / 1000;
                times.add(end);
            }
        }
    }
    var beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (var b = 0; b < beatCount; b += 1) {
        times.add(b);
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    for (var _e = 0, orderedTimes_2 = orderedTimes; _e < orderedTimes_2.length; _e++) {
        var t = orderedTimes_2[_e];
        for (var _f = 0, _g = [1, 2]; _f < _g.length; _f++) {
            var staff = _g[_f];
            limitHandNoteCountAtTime(events, staff, t, maxNotes, measureNumber, warnings);
            var active = findActiveNotesAtTime(events, staff, t).filter(function (a) { return !a.ev.__drop; });
            if (active.length < 2)
                continue;
            var sorted = active.slice().sort(function (a, b) { return a.midi - b.midi; });
            var range = staff === 1 ? rhRange : lhRange;
            var span = sorted[sorted.length - 1].midi - sorted[0].midi;
            var adjusted = false;
            while (span > maxSpan) {
                var moved = false;
                if (staff === 1) {
                    for (var i = 0; i < sorted.length - 1; i++) {
                        var note = sorted[i];
                        if (note.ev.__forceKeep || note.ev.__lockPitch)
                            continue;
                        var candidate = note.midi + 12;
                        if (candidate <= range.max && candidate < sorted[sorted.length - 1].midi) {
                            setEventMidi(note.ev, candidate);
                            moved = true;
                            adjusted = true;
                            break;
                        }
                    }
                }
                else {
                    for (var i = sorted.length - 1; i > 0; i--) {
                        var note = sorted[i];
                        if (note.ev.__forceKeep || note.ev.__lockPitch)
                            continue;
                        var candidate = note.midi - 12;
                        if (candidate >= range.min && candidate > sorted[0].midi) {
                            setEventMidi(note.ev, candidate);
                            moved = true;
                            adjusted = true;
                            break;
                        }
                    }
                }
                if (!moved)
                    break;
                sorted = findActiveNotesAtTime(events, staff, t).filter(function (a) { return !a.ev.__drop; }).sort(function (a, b) { return a.midi - b.midi; });
                if (sorted.length < 2)
                    break;
                span = sorted[sorted.length - 1].midi - sorted[0].midi;
            }
            if (span > maxSpan) {
                limitHandNoteCountAtTime(events, staff, t, Math.max(2, maxNotes - 1), measureNumber, warnings);
            }
            if (adjusted && !suppressSpanWarnings) {
                warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": hand span clamped to octave."));
            }
        }
    }
}
function thinChordsAtMelodyOnsets(params) {
    var _a, _b;
    var events = params.events, melodyEvents = params.melodyEvents, measureNumber = params.measureNumber, warnings = params.warnings;
    var staff = (_a = params.staff) !== null && _a !== void 0 ? _a : 1;
    var maxNotes = (_b = params.maxNotes) !== null && _b !== void 0 ? _b : 2;
    var onsets = new Set();
    for (var _i = 0, _c = melodyEvents !== null && melodyEvents !== void 0 ? melodyEvents : []; _i < _c.length; _i++) {
        var e = _c[_i];
        if (!e || e.type !== "note")
            continue;
        if (!Number.isFinite(e.t))
            continue;
        onsets.add(Number(e.t));
    }
    var _loop_1 = function (t) {
        var active = (events !== null && events !== void 0 ? events : []).filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && e.staff === staff && Number(e.t) === t && !e.__drop; });
        if (active.length <= maxNotes)
            return "continue";
        var sorted = active
            .map(function (ev) { var _a; return ({ ev: ev, midi: (_a = eventMidi(ev)) !== null && _a !== void 0 ? _a : 0 }); })
            .sort(function (a, b) { return a.midi - b.midi; });
        var keep = new Set();
        if (sorted.length > 0) {
            keep.add(0);
            keep.add(sorted.length - 1);
        }
        while (keep.size < Math.min(maxNotes, sorted.length)) {
            var idx = keep.size;
            if (!keep.has(idx))
                keep.add(idx);
            else
                break;
        }
        var dropped = false;
        for (var i = 0; i < sorted.length; i++) {
            if (keep.has(i))
                continue;
            if (sorted[i].ev.__forceKeep)
                continue;
            markEventDrop(sorted[i].ev);
            dropped = true;
        }
        if (dropped) {
            warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": thinned RH chord for vocal entry."));
        }
    };
    for (var _d = 0, onsets_1 = onsets; _d < onsets_1.length; _d++) {
        var t = onsets_1[_d];
        _loop_1(t);
    }
}
function ensureMelodyStartDoubling(params) {
    var events = params.events, melodyEvents = params.melodyEvents, measureNumber = params.measureNumber, warnings = params.warnings;
    if (measureNumber !== 1)
        return;
    var mel = (melodyEvents !== null && melodyEvents !== void 0 ? melodyEvents : []).find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e.t) === 0; });
    if (!mel)
        return;
    var melMidi = eventMidi(mel);
    if (melMidi === null)
        return;
    var existing = (events !== null && events !== void 0 ? events : []).some(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && e.staff === 1 && Number(e.t) === 0 && eventMidi(e) === melMidi; });
    if (existing)
        return;
    var dur = Number(mel.dur);
    if (!Number.isFinite(dur) || dur <= 0)
        return;
    var ev = {
        type: "note",
        t: 0,
        dur: dur,
        voice: 1,
        staff: 1,
        pitch: (0, instrumentCatalog_1.midiToPitch)(melMidi),
        id: "1-1-n-".concat(measureNumber, "-0-mel-dbl")
    };
    ev.__forceKeep = true;
    events.push(ev);
    warn(warnings, "[piano] m".concat(measureNumber, " t=0: doubled vocal entry pitch."));
}
function dropDuplicateNotesAtTime(params) {
    var events = params.events, measureNumber = params.measureNumber, warnings = params.warnings;
    var seen = new Map();
    var dropped = 0;
    var preferScore = function (ev) { return (ev.__melody ? 4 : 0) + (ev.__forceKeep ? 2 : 0); };
    for (var _i = 0, _a = events !== null && events !== void 0 ? events : []; _i < _a.length; _i++) {
        var ev = _a[_i];
        if (!ev || ev.type !== "note")
            continue;
        var midi = eventMidi(ev);
        if (typeof midi !== "number")
            continue;
        var tKey = Math.round(Number(ev.t) * 1000);
        var key = "".concat(ev.staff, ":").concat(ev.voice, ":").concat(tKey, ":").concat(midi);
        var existing = seen.get(key);
        if (!existing) {
            seen.set(key, ev);
            continue;
        }
        if (preferScore(ev) > preferScore(existing)) {
            markEventDrop(existing);
            seen.set(key, ev);
            dropped += 1;
        }
        else {
            markEventDrop(ev);
            dropped += 1;
        }
    }
    if (dropped) {
        warn(warnings, "[piano] m".concat(measureNumber, ": dropped ").concat(dropped, " duplicate note(s) at same time."));
    }
}
function enforceHarmonyBelowMelody(params) {
    var _a;
    var events = params.events, measureNumber = params.measureNumber, warnings = params.warnings;
    var rhRange = (_a = params.rhRange) !== null && _a !== void 0 ? _a : { min: 52, max: 88 };
    var melodyEvents = (events !== null && events !== void 0 ? events : []).filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && e.staff === 1 && e.voice === 1 && e.__melody === true; });
    if (!melodyEvents.length)
        return;
    var times = new Set();
    for (var _i = 0, melodyEvents_1 = melodyEvents; _i < melodyEvents_1.length; _i++) {
        var e = melodyEvents_1[_i];
        var t = Number(e.t);
        var dur = Number(e.dur);
        if (!Number.isFinite(t) || !Number.isFinite(dur))
            continue;
        times.add(t);
        var end = Math.round((t + dur) * 1000) / 1000;
        times.add(end);
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    var warned = false;
    var _loop_2 = function (t) {
        var mel = findActiveEvent(events, 1, 1, t);
        if (!mel)
            return "continue";
        var melMidi = eventMidi(mel);
        if (typeof melMidi !== "number")
            return "continue";
        var active = findActiveNotesAtTime(events, 1, t).filter(function (a) { return a.ev !== mel && !a.ev.__drop; });
        for (var _c = 0, active_1 = active; _c < active_1.length; _c++) {
            var entry = active_1[_c];
            var ev = entry.ev;
            if (ev.__melody)
                continue;
            var midi = entry.midi;
            if (midi < melMidi)
                continue;
            var adjusted = midi;
            while (adjusted !== null && adjusted >= melMidi) {
                var candidate = adjusted - 12;
                adjusted = candidate >= rhRange.min ? candidate : null;
            }
            if (adjusted !== null && adjusted < melMidi) {
                setEventMidi(ev, adjusted);
            }
            else {
                markEventDrop(ev);
                if (!warned) {
                    warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": dropped RH harmony above melody."));
                    warned = true;
                }
            }
        }
    };
    for (var _b = 0, orderedTimes_3 = orderedTimes; _b < orderedTimes_3.length; _b++) {
        var t = orderedTimes_3[_b];
        _loop_2(t);
    }
}
function fitToWindow(midi, min, max) {
    var m = midi;
    while (m < min)
        m += 12;
    while (m > max)
        m -= 12;
    if (m < min || m > max)
        return null;
    return m;
}
function mapVoiceEvents(params) {
    var srcEvents = params.srcEvents, voice = params.voice, staff = params.staff, anchorEvents = params.anchorEvents, relation = params.relation, allowedIntervalsAbove = params.allowedIntervalsAbove, measureNumber = params.measureNumber, warnings = params.warnings, markMelody = params.markMelody;
    var out = [];
    var sorted = (srcEvents !== null && srcEvents !== void 0 ? srcEvents : []).filter(isNoteOrRest).slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var warned = false;
    var _loop_3 = function (ev) {
        var t = Number(ev.t);
        var dur = Number(ev.dur);
        if (ev.type === "rest") {
            out.push({ type: "rest", t: t, dur: dur, voice: voice, staff: staff, isRest: true, id: "".concat(voice, "-").concat(staff, "-r-").concat(t) });
            return "continue";
        }
        var midi = eventMidi(ev);
        if (midi === null)
            return "continue";
        var useMidi = midi;
        if (relation && (anchorEvents === null || anchorEvents === void 0 ? void 0 : anchorEvents.length)) {
            var anchor_1 = findNoteMidiAtTime(anchorEvents, t);
            if (typeof anchor_1 === "number") {
                if (relation === "below") {
                    var min = anchor_1 - 12;
                    var max = anchor_1 - 1;
                    if (min <= max) {
                        var fit = fitToWindow(midi, min, max);
                        if (fit === null) {
                            var clamped = clampMidiToRange(midi, min, max);
                            useMidi = clamped;
                            if (!warned) {
                                warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": RH inner voice clamped into octave window."));
                                warned = true;
                            }
                        }
                        else {
                            useMidi = fit;
                        }
                    }
                }
                else if (relation === "above") {
                    var min_1 = anchor_1 + 1;
                    var max_1 = anchor_1 + 12;
                    if (min_1 <= max_1) {
                        var fit = null;
                        if (Array.isArray(allowedIntervalsAbove) && allowedIntervalsAbove.length) {
                            var candidates = allowedIntervalsAbove
                                .map(function (intv) { return anchor_1 + intv; })
                                .filter(function (cand) { return cand >= min_1 && cand <= max_1; });
                            if (candidates.length) {
                                var best = candidates[0];
                                var bestDist = Math.abs(best - midi);
                                for (var i = 1; i < candidates.length; i++) {
                                    var cand = candidates[i];
                                    var dist = Math.abs(cand - midi);
                                    if (dist < bestDist) {
                                        best = cand;
                                        bestDist = dist;
                                    }
                                }
                                fit = best;
                            }
                        }
                        else {
                            fit = fitToWindow(midi, min_1, max_1);
                        }
                        if (fit === null) {
                            var clamped = clampMidiToRange(midi, min_1, max_1);
                            useMidi = clamped;
                            if (!warned) {
                                warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": LH inner voice clamped into octave window."));
                                warned = true;
                            }
                        }
                        else {
                            useMidi = fit;
                        }
                    }
                }
            }
        }
        out.push({
            type: "note",
            t: t,
            dur: dur,
            voice: voice,
            staff: staff,
            pitch: (0, instrumentCatalog_1.midiToPitch)(useMidi),
            id: "".concat(voice, "-").concat(staff, "-n-").concat(t),
            chord: ev.chord === true,
            isRest: false
        });
        if (markMelody) {
            out[out.length - 1].__melody = true;
            out[out.length - 1].__lockPitch = true;
        }
    };
    for (var _i = 0, sorted_1 = sorted; _i < sorted_1.length; _i++) {
        var ev = sorted_1[_i];
        _loop_3(ev);
    }
    return out;
}
function measureBeatsFromAttributes(attrs) {
    var _a, _b, _c, _d;
    var beats = Number((_b = (_a = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _a === void 0 ? void 0 : _a.beats) !== null && _b !== void 0 ? _b : 4);
    var beatType = Number((_d = (_c = attrs === null || attrs === void 0 ? void 0 : attrs.time) === null || _c === void 0 ? void 0 : _c.beat_type) !== null && _d !== void 0 ? _d : 4);
    if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0)
        return 4;
    return beats * (4 / beatType);
}
function pickChordForTime(chords, measure, t) {
    var _a;
    var inMeasure = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!inMeasure.length)
        return null;
    var sorted = inMeasure.slice().sort(function (a, b) { return Number(a.t) - Number(b.t); });
    var best = null;
    for (var _i = 0, sorted_2 = sorted; _i < sorted_2.length; _i++) {
        var c = sorted_2[_i];
        if (Number(c.t) <= t + 1e-6)
            best = c;
        else
            break;
    }
    return (_a = best !== null && best !== void 0 ? best : sorted[0]) !== null && _a !== void 0 ? _a : null;
}
function isChordBoundary(chords, measureNumber, t) {
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        if (Number(c.measure) !== Number(measureNumber))
            continue;
        if (near(Number(c.t), t))
            return true;
    }
    return false;
}
function resolveChordToneMap(parsed) {
    var _a, _b;
    var rootPc = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _a !== void 0 ? _a : 0;
    var pcs = Array.isArray(parsed === null || parsed === void 0 ? void 0 : parsed.pcs) && parsed.pcs.length ? parsed.pcs : [rootPc];
    var majThird = (rootPc + 4) % 12;
    var minThird = (rootPc + 3) % 12;
    var thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : rootPc;
    var fifthPc = pcs.includes((rootPc + 7) % 12)
        ? (rootPc + 7) % 12
        : (_b = pcs.find(function (pc) { return pc !== rootPc && pc !== thirdPc; })) !== null && _b !== void 0 ? _b : rootPc;
    return { rootPc: rootPc, thirdPc: thirdPc, fifthPc: fifthPc };
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
function scalePcsFromKey(fifths, mode) {
    var tonic = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
    var intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return intervals.map(function (i) { return (tonic + i) % 12; });
}
function pickMidiForPcBelow(pc, min, max) {
    var targetPc = ((pc % 12) + 12) % 12;
    for (var m = max; m >= min; m--) {
        if (((m % 12) + 12) % 12 === targetPc)
            return m;
    }
    return null;
}
function pickMidiForPcAtOrAbove(pc, min, max) {
    var targetPc = ((pc % 12) + 12) % 12;
    for (var m = min; m <= max; m++) {
        if (((m % 12) + 12) % 12 === targetPc)
            return m;
    }
    return null;
}
function chooseChordToneNearestFromPcs(chordPcs, prevMidi, range, excludeMidis) {
    if (excludeMidis === void 0) { excludeMidis = []; }
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        if (!chordPcs.includes(((m % 12) + 12) % 12))
            continue;
        if (excludeMidis.includes(m))
            continue;
        candidates.push(m);
    }
    if (!candidates.length)
        return prevMidi;
    var best = candidates[0];
    var bestScore = Number.POSITIVE_INFINITY;
    for (var _i = 0, candidates_2 = candidates; _i < candidates_2.length; _i++) {
        var c = candidates_2[_i];
        var score = Math.abs(c - prevMidi);
        if (score < bestScore) {
            bestScore = score;
            best = c;
        }
    }
    return best;
}
function chooseChordToneByInterval(chordPcs, prevMidi, range, minInterval, maxInterval, fallback) {
    var best = null;
    var bestScore = Number.POSITIVE_INFINITY;
    for (var m = range.min; m <= range.max; m++) {
        if (!chordPcs.includes(((m % 12) + 12) % 12))
            continue;
        var dist = Math.abs(m - prevMidi);
        if (dist < minInterval || dist > maxInterval)
            continue;
        if (dist < bestScore) {
            bestScore = dist;
            best = m;
        }
    }
    return best !== null && best !== void 0 ? best : fallback;
}
function chooseNeighborMidi(prevMidi, scalePcs, range, dir) {
    var candidate = prevMidi + dir;
    while (candidate >= range.min && candidate <= range.max) {
        if (scalePcs.includes(((candidate % 12) + 12) % 12))
            return candidate;
        candidate += dir;
    }
    return prevMidi;
}
function findScaleNeighborMidi(baseMidi, scalePcs, dir, min, max) {
    var targetSet = new Set(scalePcs);
    for (var i = 1; i <= 12; i++) {
        var m = baseMidi + dir * i;
        if (m < min || m > max)
            break;
        var pc = ((m % 12) + 12) % 12;
        if (targetSet.has(pc))
            return m;
    }
    return null;
}
function findNoteEventAtExactTime(events, t) {
    var _a;
    var target = Number(t);
    return ((_a = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number.isFinite(e.t) && Math.abs(Number(e.t) - target) < 1e-6; })) !== null && _a !== void 0 ? _a : null);
}
function isRepeatedQuarterAtTime(events, t) {
    var ev1 = findNoteEventAtExactTime(events, t);
    if (!ev1)
        return false;
    var d1 = Number(ev1.dur);
    if (!Number.isFinite(d1) || Math.abs(d1 - 1) > 1e-6)
        return false;
    var ev2 = findNoteEventAtExactTime(events, t + 1);
    if (!ev2)
        return false;
    var d2 = Number(ev2.dur);
    if (!Number.isFinite(d2) || Math.abs(d2 - 1) > 1e-6)
        return false;
    var m1 = eventMidi(ev1);
    var m2 = eventMidi(ev2);
    if (m1 === null || m2 === null)
        return false;
    return m1 === m2;
}
function findChromaticNeighborMidi(baseMidi, dir, min, max) {
    var m = baseMidi + dir;
    if (m < min || m > max)
        return null;
    return m;
}
function pickPassingMidi(params) {
    var baseMidi = params.baseMidi, scalePcs = params.scalePcs, dir = params.dir, min = params.min, max = params.max, allowChromatic = params.allowChromatic, preferChromatic = params.preferChromatic;
    if (allowChromatic && preferChromatic) {
        var chrom = findChromaticNeighborMidi(baseMidi, dir, min, max);
        if (chrom !== null)
            return chrom;
    }
    var diatonic = findScaleNeighborMidi(baseMidi, scalePcs, dir, min, max);
    if (diatonic !== null)
        return diatonic;
    if (allowChromatic)
        return findChromaticNeighborMidi(baseMidi, dir, min, max);
    return null;
}
function buildRhFillSteps(segmentBeats, activity) {
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var stepDur = activity === "less_active" ? 1 : 0.5;
    var pattern = activity === "less_active"
        ? ["root", "third", "fifth", "root"]
        : activity === "high_active"
            ? ["root", "passing", "third", "passing", "fifth", "passing", "root", "passing"]
            : ["root", "fifth", "third", "fifth", "root", "third", "fifth", "root"];
    var out = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    while (remaining > 1e-6) {
        var dur = remaining < stepDur - 1e-6 ? remaining : stepDur;
        out.push({ dur: dur, token: pattern[idx % pattern.length] });
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
    }
    return out;
}
function buildActiveDurations(segmentBeats, activity, seedBase) {
    var _a;
    if (!Number.isFinite(segmentBeats) || segmentBeats <= 0)
        return [];
    var weights = activity === "active"
        ? [
            { value: 0.5, weight: 25 },
            { value: 1, weight: 45 },
            { value: 2, weight: 20 },
            { value: 4, weight: 10 }
        ]
        : activity === "high_active"
            ? [
                { value: 0.5, weight: 50 },
                { value: 1, weight: 35 },
                { value: 2, weight: 12 },
                { value: 4, weight: 3 }
            ]
            : [
                { value: 1, weight: 55 },
                { value: 2, weight: 30 },
                { value: 4, weight: 15 }
            ];
    var durations = [];
    var remaining = Math.round(segmentBeats * 1000) / 1000;
    var idx = 0;
    while (remaining > 1e-6) {
        var seed = seedBase + idx * 101;
        var dur = pickWeighted(weights, seed);
        if (dur > remaining + 1e-6) {
            var allowed = weights
                .map(function (w) { return w.value; })
                .filter(function (v) { return v <= remaining + 1e-6; })
                .sort(function (a, b) { return b - a; });
            dur = (_a = allowed[0]) !== null && _a !== void 0 ? _a : remaining;
        }
        durations.push(dur);
        remaining = Math.round((remaining - dur) * 1000) / 1000;
        idx += 1;
    }
    return durations;
}
function pickTopMode(measureNumber, t, activity, melodyShare) {
    var share = Math.max(0, Math.min(100, Number.isFinite(melodyShare) ? melodyShare : 30));
    var base = activity === "high_active"
        ? { harmony: 35, counter: 35 }
        : activity === "less_active"
            ? { harmony: 55, counter: 15 }
            : { harmony: 45, counter: 25 };
    var remaining = Math.max(0, 100 - share);
    var baseSum = base.harmony + base.counter || 1;
    var harmonyWeight = (remaining * base.harmony) / baseSum;
    var counterWeight = remaining - harmonyWeight;
    var weights = [
        { value: "melody", weight: share },
        { value: "harmony", weight: harmonyWeight },
        { value: "counter", weight: counterWeight }
    ];
    var seed = (measureNumber * 73856093) ^ (Math.round(t * 1000) * 19349663);
    return pickWeighted(weights, seed);
}
function pickCounterRole(measureNumber, t, activity) {
    var weights = [
        { value: "passing", weight: 35 },
        { value: "neighbor", weight: 25 },
        { value: "skip", weight: 10 },
        { value: "leap", weight: 10 },
        { value: "chord", weight: 20 }
    ];
    var seed = (measureNumber * 83492791) ^ (Math.round(t * 1000) * 29791);
    return pickWeighted(weights, seed);
}
function enforceChordPriorityForMeasure(params) {
    var _a;
    var events = params.events, chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, warnings = params.warnings, allowWorshipClusters = params.allowWorshipClusters;
    var strictAllTimes = params.strictAllTimes === true;
    if (!Array.isArray(chords) || !chords.length)
        return;
    var times = new Set();
    for (var _i = 0, events_8 = events; _i < events_8.length; _i++) {
        var e = events_8[_i];
        if (e && e.type === "note" && Number.isFinite(e.t)) {
            times.add(Number(e.t));
        }
    }
    var beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (var b = 0; b < beatCount; b += 1)
        times.add(b);
    for (var _b = 0, chords_2 = chords; _b < chords_2.length; _b++) {
        var c = chords_2[_b];
        if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t)) {
            times.add(Number(c.t));
        }
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    var _loop_4 = function (t) {
        if (!strictAllTimes && !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t))
            return "continue";
        var chord = pickChordForTime(chords, measureNumber, t);
        var parsed = chord ? (0, chordSymbol_1.parseChordSymbol)(chord.symbol) : null;
        var baseChordPcs = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _a !== void 0 ? _a : [];
        if (!baseChordPcs.length)
            return "continue";
        var rhChordPcs = baseChordPcs.slice();
        if (allowWorshipClusters && parsed && chord) {
            var quality = chordQualityFlags(chord.symbol);
            var rootPc = parsed.rootPc;
            var majThirdPc_1 = (rootPc + 4) % 12;
            var minThirdPc_1 = (rootPc + 3) % 12;
            var sus4Pc = (rootPc + 5) % 12;
            if (quality.isDominant) {
                rhChordPcs = rhChordPcs.filter(function (pc) { return pc !== majThirdPc_1 && pc !== minThirdPc_1; });
                rhChordPcs.push(sus4Pc);
            }
            else if (quality.isMajor) {
                rhChordPcs.push((rootPc + 2) % 12);
            }
            rhChordPcs = Array.from(new Set(rhChordPcs));
        }
        var active = findActiveNotesAtTime(events, 1, t)
            .concat(findActiveNotesAtTime(events, 2, t))
            .map(function (entry) { return entry.ev; });
        for (var _d = 0, active_2 = active; _d < active_2.length; _d++) {
            var ev = active_2[_d];
            if (!ev || ev.type !== "note")
                continue;
            if (ev.__melody)
                continue;
            var midi = eventMidi(ev);
            if (typeof midi !== "number")
                continue;
            var staff = Number(ev.staff) === 2 ? 2 : 1;
            var pc = ((midi % 12) + 12) % 12;
            var allowedPcs = staff === 1 && allowWorshipClusters ? rhChordPcs : baseChordPcs;
            if (allowedPcs.includes(pc))
                continue;
            var range = staff === 1 ? { min: 52, max: 88 } : { min: 41, max: 72 };
            var adjusted = chooseChordToneNearestFromPcs(allowedPcs, midi, range, []);
            if (adjusted !== midi) {
                setEventMidi(ev, adjusted);
                warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": adjusted note to chord tone on strong beat."));
            }
        }
    };
    for (var _c = 0, orderedTimes_4 = orderedTimes; _c < orderedTimes_4.length; _c++) {
        var t = orderedTimes_4[_c];
        _loop_4(t);
    }
}
function ensureChordVoicesAtBeats(params) {
    var _a, _b;
    var events = params.events, chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, warnings = params.warnings, voices = params.voices, allowWorshipClusters = params.allowWorshipClusters;
    if (!Array.isArray(chords) || !chords.length)
        return;
    if (!Array.isArray(voices) || !voices.length)
        return;
    var melodyLocked = new Set();
    for (var _i = 0, events_9 = events; _i < events_9.length; _i++) {
        var ev = events_9[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
            continue;
        if (ev.__melody) {
            melodyLocked.add("".concat(ev.staff, ":").concat(ev.voice));
        }
    }
    var times = new Set();
    var beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (var b = 0; b < beatCount; b += 1)
        times.add(b);
    for (var _c = 0, chords_3 = chords; _c < chords_3.length; _c++) {
        var c = chords_3[_c];
        if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t))
            times.add(Number(c.t));
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    var _loop_5 = function (i) {
        var t = orderedTimes[i];
        var nextTime = (_a = orderedTimes[i + 1]) !== null && _a !== void 0 ? _a : measureBeats;
        var chord = pickChordForTime(chords, measureNumber, t);
        var parsed = chord ? (0, chordSymbol_1.parseChordSymbol)(chord.symbol) : null;
        var baseChordPcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : [];
        if (!baseChordPcs.length)
            return "continue";
        var chordPcs = baseChordPcs.slice();
        if (allowWorshipClusters && parsed && chord) {
            var quality = chordQualityFlags(chord.symbol);
            var rootPc = parsed.rootPc;
            var majThirdPc_2 = (rootPc + 4) % 12;
            var minThirdPc_2 = (rootPc + 3) % 12;
            var sus4Pc = (rootPc + 5) % 12;
            if (quality.isDominant) {
                chordPcs = chordPcs.filter(function (pc) { return pc !== majThirdPc_2 && pc !== minThirdPc_2; });
                chordPcs.push(sus4Pc);
            }
            else if (quality.isMajor) {
                chordPcs.push((rootPc + 2) % 12);
            }
            chordPcs = Array.from(new Set(chordPcs));
        }
        var dur = Math.max(0.25, Math.min(measureBeats - t, nextTime - t));
        var _loop_6 = function (voice) {
            var key = "".concat(voice.staff, ":").concat(voice.voice);
            var active = findActiveEvent(events, voice.staff, voice.voice, t);
            if (active && (active.__melody || active.__forceKeep))
                return "continue";
            if (active) {
                var midi_1 = eventMidi(active);
                if (typeof midi_1 === "number") {
                    var pc = ((midi_1 % 12) + 12) % 12;
                    if (!chordPcs.includes(pc)) {
                        var adjusted = chooseChordToneNearestFromPcs(chordPcs, midi_1, voice.range, []);
                        if (adjusted !== midi_1) {
                            setEventMidi(active, adjusted);
                            warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": adjusted ").concat(voice.label, " to chord tone."));
                        }
                    }
                }
                return "continue";
            }
            if (melodyLocked.has(key))
                return "continue";
            var prevMidi = findNoteMidiAtOrBeforeTime(events.filter(function (e) { return (e === null || e === void 0 ? void 0 : e.staff) === voice.staff && (e === null || e === void 0 ? void 0 : e.voice) === voice.voice; }), t);
            var seedMidi = typeof prevMidi === "number" ? prevMidi : Math.round((voice.range.min + voice.range.max) / 2);
            var midi = chooseChordToneNearestFromPcs(chordPcs, seedMidi, voice.range, []);
            var ev = {
                type: "note",
                t: t,
                dur: dur,
                voice: voice.voice,
                staff: voice.staff,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                id: "".concat(voice.staff, "-").concat(voice.voice, "-n-").concat(measureNumber, "-").concat(t, "-forced")
            };
            ev.midi = midi;
            ev.__forceKeep = true;
            events.push(ev);
        };
        for (var _d = 0, voices_1 = voices; _d < voices_1.length; _d++) {
            var voice = voices_1[_d];
            _loop_6(voice);
        }
    };
    for (var i = 0; i < orderedTimes.length; i++) {
        _loop_5(i);
    }
}
function enforceBassToChordAtTimes(params) {
    var _a, _b;
    var events = params.events, chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, warnings = params.warnings, range = params.range, maxLeap = params.maxLeap, extraTimes = params.extraTimes;
    if (!Array.isArray(chords) || !chords.length)
        return;
    var times = new Set();
    var beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (var b = 0; b < beatCount; b += 1)
        times.add(b);
    for (var _i = 0, chords_4 = chords; _i < chords_4.length; _i++) {
        var c = chords_4[_i];
        if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t)) {
            times.add(Number(c.t));
        }
    }
    if (Array.isArray(extraTimes)) {
        for (var _c = 0, extraTimes_1 = extraTimes; _c < extraTimes_1.length; _c++) {
            var t = extraTimes_1[_c];
            if (Number.isFinite(t))
                times.add(Number(t));
        }
    }
    var orderedTimes = Array.from(times).sort(function (a, b) { return a - b; });
    var _loop_7 = function (t) {
        var chord = pickChordForTime(chords, measureNumber, t);
        if (!chord)
            return "continue";
        var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
        var bassTarget = parseBassTargetFromChordSymbol(chord.symbol);
        var targetPc = (_a = bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.pc) !== null && _a !== void 0 ? _a : parsed === null || parsed === void 0 ? void 0 : parsed.rootPc;
        if (typeof targetPc !== "number")
            return "continue";
        var hasSlashBass = (bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.pc) !== undefined && (bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.pc) !== null;
        var thirdPcs = parsed && typeof parsed.rootPc === "number"
            ? [((parsed.rootPc + 3) % 12 + 12) % 12, ((parsed.rootPc + 4) % 12 + 12) % 12]
            : [];
        var fifthPc = parsed && typeof parsed.rootPc === "number" ? ((parsed.rootPc + 7) % 12 + 12) % 12 : null;
        var active = findActiveNotesAtTime(events, 2, t).filter(function (a) { return !a.ev.__drop; });
        if (!active.length) {
            var staff2Notes = (events !== null && events !== void 0 ? events : []).filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && Number(e === null || e === void 0 ? void 0 : e.staff) === 2 && !e.__drop; });
            var voice = staff2Notes.some(function (e) { return Number(e.voice) === 4; }) ? 4 : 3;
            var nextTimes = staff2Notes
                .map(function (e) { return Number(e === null || e === void 0 ? void 0 : e.t); })
                .filter(function (et) { return Number.isFinite(et) && et > t; });
            var nextTime = nextTimes.length ? Math.min.apply(Math, nextTimes) : measureBeats;
            var rawDur = Number.isFinite(nextTime) ? Math.max(0, nextTime - t) : 0;
            var dur = Math.max(0.25, Math.min(measureBeats - t, rawDur || (measureBeats - t)));
            var target_1 = pickMidiForPcNear(targetPc, range.min, range);
            if (target_1 === null)
                return "continue";
            var ev = {
                type: "note",
                t: t,
                dur: dur,
                voice: voice,
                staff: 2,
                pitch: pitchWithSpelling(target_1, bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.spelling),
                id: "2-".concat(voice, "-n-").concat(measureNumber, "-").concat(t, "-forced")
            };
            ev.midi = target_1;
            ev.__lockPitch = true;
            events.push(ev);
            return "continue";
        }
        active.sort(function (a, b) { return a.midi - b.midi; });
        var bass = active[0];
        var currentMidi = bass.midi;
        var currentPc = ((currentMidi % 12) + 12) % 12;
        if (!hasSlashBass && currentMidi < 48 && thirdPcs.includes(currentPc)) {
            var rootPc = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _b !== void 0 ? _b : targetPc;
            var rootMidi = pickMidiForPcNear(rootPc, currentMidi, range);
            var fifthMidi = fifthPc !== null ? pickMidiForPcNear(fifthPc, currentMidi, range) : null;
            var preferred = rootMidi;
            if (rootMidi !== null && fifthMidi !== null) {
                preferred = Math.abs(fifthMidi - currentMidi) < Math.abs(rootMidi - currentMidi) ? fifthMidi : rootMidi;
            }
            else if (rootMidi === null && fifthMidi !== null) {
                preferred = fifthMidi;
            }
            if (preferred !== null) {
                bass.ev.midi = preferred;
                bass.ev.pitch = pitchWithSpelling(preferred, bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.spelling);
            }
        }
        var target = pickMidiForPcNear(targetPc, currentMidi, range);
        if (target === null)
            return "continue";
        var adjusted = target;
        if (typeof maxLeap === "number" && Number.isFinite(maxLeap) && Math.abs(adjusted - currentMidi) > maxLeap) {
            var clamped = adjustMidiToRangeByOctave(adjusted, currentMidi - maxLeap, currentMidi + maxLeap);
            if (clamped !== null)
                adjusted = clamped;
        }
        bass.ev.midi = adjusted;
        bass.ev.pitch = pitchWithSpelling(adjusted, bassTarget === null || bassTarget === void 0 ? void 0 : bassTarget.spelling);
        bass.ev.__lockPitch = true;
        if (((adjusted % 12) + 12) % 12 !== targetPc) {
            warn(warnings, "[piano] m".concat(measureNumber, " t=").concat(t, ": bass adjusted to chord tone."));
        }
    };
    for (var _d = 0, orderedTimes_5 = orderedTimes; _d < orderedTimes_5.length; _d++) {
        var t = orderedTimes_5[_d];
        _loop_7(t);
    }
}
function fitMidiToRangeByOctave(midi, min, max) {
    var m = midi;
    while (m < min)
        m += 12;
    while (m > max)
        m -= 12;
    if (m < min || m > max)
        return null;
    return m;
}
function clampTopLeap(params) {
    var _a;
    var midi = params.midi, prevMidi = params.prevMidi, chordPcs = params.chordPcs, range = params.range;
    var maxLeap = (_a = params.maxLeap) !== null && _a !== void 0 ? _a : 7; // perfect 5th
    if (Math.abs(midi - prevMidi) <= maxLeap)
        return midi;
    var pcs = chordPcs.length ? chordPcs : [((midi % 12) + 12) % 12];
    var candidates = [];
    for (var m = range.min; m <= range.max; m++) {
        var pc = ((m % 12) + 12) % 12;
        if (!pcs.includes(pc))
            continue;
        if (Math.abs(m - prevMidi) <= maxLeap)
            candidates.push(m);
    }
    if (candidates.length) {
        candidates.sort(function (a, b) { return Math.abs(a - prevMidi) - Math.abs(b - prevMidi); });
        return candidates[0];
    }
    return prevMidi;
}
function chooseTopChordTone(params) {
    var chordPcs = params.chordPcs, prevMidi = params.prevMidi, range = params.range, bottomMidi = params.bottomMidi;
    if (!chordPcs.length)
        return prevMidi;
    var min = typeof bottomMidi === "number" ? Math.max(range.min, bottomMidi + 1) : range.min;
    var max = typeof bottomMidi === "number" ? Math.min(range.max, bottomMidi + 12) : range.max;
    var localRange = min <= max ? { min: min, max: max } : range;
    return chooseChordToneNearestFromPcs(chordPcs, prevMidi, localRange, typeof bottomMidi === "number" ? [bottomMidi] : []);
}
function buildRhTopVoiceEvents(params) {
    var _a, _b, _c;
    var chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, melodyEvents = params.melodyEvents, bottomEvents = params.bottomEvents, activity = params.activity, scalePcs = params.scalePcs, melodyShare = params.melodyShare;
    var range = (_a = params.range) !== null && _a !== void 0 ? _a : { min: 60, max: 88 }; // C4..E6
    var allowOverlap = params.allowOverlap === true;
    var evs = [];
    var prevMidi = null;
    var chordEvents = chords
        .filter(function (c) { return Number(c.measure) === Number(measureNumber); })
        .map(function (c) { return (__assign(__assign({}, c), { t: Number(c.t) })); })
        .filter(function (c) { return Number.isFinite(c.t); })
        .sort(function (a, b) { return Number(a.t) - Number(b.t); });
    if (!chordEvents.length) {
        chordEvents = [{ measure: measureNumber, t: 0, symbol: "C" }];
    }
    else if (chordEvents[0].t > 0) {
        chordEvents = __spreadArray([__assign(__assign({}, chordEvents[0]), { t: 0 })], chordEvents, true);
    }
    for (var ci = 0; ci < chordEvents.length; ci++) {
        var chord = chordEvents[ci];
        var start = Math.max(0, Number(chord.t) || 0);
        var end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1].t) : measureBeats;
        var segDur = Math.max(0, Math.min(end, measureBeats) - start);
        if (segDur <= 0)
            continue;
        var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
        var chordPcs = (_b = parsed === null || parsed === void 0 ? void 0 : parsed.pcs) !== null && _b !== void 0 ? _b : [];
        var group = Math.floor((measureNumber - 1) / 8);
        var seedBase = group * 10000 + Math.round(start * 1000);
        var durations = activity === "grounded" ? [segDur] : buildActiveDurations(segDur, activity, seedBase);
        var cursor = start;
        for (var iEv = 0; iEv < durations.length; iEv++) {
            var dur = durations[iEv];
            var t = cursor;
            if (t + dur > measureBeats + 1e-6)
                break;
            var bottomMidi = findNoteMidiAtTime(bottomEvents, t);
            if (bottomMidi === null) {
                bottomMidi = findNoteMidiAtOrBeforeTime(bottomEvents, t);
            }
            var melodyMidi = findNoteMidiAtTime(melodyEvents, t);
            var mode = pickTopMode(measureNumber, t, activity, melodyShare);
            var midi = null;
            var allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);
            if (mode === "melody" && typeof melodyMidi === "number") {
                midi = melodyMidi;
            }
            if (midi === null) {
                if (mode === "harmony" || mode === "melody") {
                    var base = prevMidi !== null && prevMidi !== void 0 ? prevMidi : (typeof melodyMidi === "number" ? melodyMidi : range.min);
                    midi = chooseTopChordTone({
                        chordPcs: chordPcs,
                        prevMidi: base,
                        range: range,
                        bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                    });
                }
                else {
                    var role = pickCounterRole(measureNumber, t, activity);
                    var base = prevMidi !== null && prevMidi !== void 0 ? prevMidi : (typeof melodyMidi === "number" ? melodyMidi : range.min);
                    if (role === "suspension" && prevMidi !== null) {
                        midi = prevMidi;
                    }
                    else if (role === "anticipation") {
                        var nextChord = pickChordForTime(chords, t + dur < measureBeats ? measureNumber : measureNumber + 1, t + dur < measureBeats ? t + dur : 0);
                        var nextParsed = nextChord ? (0, chordSymbol_1.parseChordSymbol)(nextChord.symbol) : null;
                        var nextPcs = (_c = nextParsed === null || nextParsed === void 0 ? void 0 : nextParsed.pcs) !== null && _c !== void 0 ? _c : chordPcs;
                        midi = chooseTopChordTone({
                            chordPcs: nextPcs,
                            prevMidi: base,
                            range: range,
                            bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                        });
                    }
                    else if (role === "syncopation") {
                        midi = prevMidi !== null && prevMidi !== void 0 ? prevMidi : base;
                    }
                    else if (role === "chromatic" && allowChromatic) {
                        var dir = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
                        midi = chooseNeighborMidi(base, scalePcs, range, dir);
                    }
                    else if (role === "passing" || role === "neighbor" || role === "appoggiatura") {
                        var dir = (measureNumber + Math.round(t * 2) + (role === "neighbor" ? 1 : 0)) % 2 === 0 ? 1 : -1;
                        midi = chooseNeighborMidi(base, scalePcs, range, dir);
                    }
                    else if (role === "skip") {
                        var fallback = chooseTopChordTone({
                            chordPcs: chordPcs,
                            prevMidi: base,
                            range: range,
                            bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                        });
                        midi = chooseChordToneByInterval(chordPcs, base, range, 3, 5, fallback);
                    }
                    else if (role === "leap") {
                        var fallback = chooseTopChordTone({
                            chordPcs: chordPcs,
                            prevMidi: base,
                            range: range,
                            bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                        });
                        midi = chooseChordToneByInterval(chordPcs, base, range, 6, 9, fallback);
                    }
                    else {
                        midi = chooseTopChordTone({
                            chordPcs: chordPcs,
                            prevMidi: base,
                            range: range,
                            bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                        });
                    }
                }
            }
            if (midi === null) {
                cursor = Math.round((cursor + dur) * 1000) / 1000;
                continue;
            }
            if (mode !== "melody") {
                var bottom = typeof bottomMidi === "number" ? bottomMidi : null;
                if (bottom !== null) {
                    var adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, bottom + 1), Math.min(range.max, bottom + 12));
                    if (adjusted !== null)
                        midi = adjusted;
                }
                else {
                    var adjusted = fitMidiToRangeByOctave(midi, range.min, range.max);
                    if (adjusted !== null)
                        midi = adjusted;
                }
            }
            if ((isStrongBeat(t) || isChordBoundary(chords, measureNumber, t)) && chordPcs.length && !chordPcs.includes(((midi % 12) + 12) % 12)) {
                var base = prevMidi !== null && prevMidi !== void 0 ? prevMidi : midi;
                midi = chooseTopChordTone({
                    chordPcs: chordPcs,
                    prevMidi: base,
                    range: range,
                    bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
                });
            }
            if (prevMidi !== null && midi === prevMidi && !shouldAllowRepeat(measureNumber, t, REPEAT_RATIO, 17)) {
                if (!isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t)) {
                    var dir = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
                    var neighbor = chooseNeighborMidi(prevMidi, scalePcs, range, dir);
                    if (neighbor !== prevMidi)
                        midi = neighbor;
                }
                if (midi === prevMidi && chordPcs.length) {
                    var alt = chooseChordToneNearestFromPcs(chordPcs, prevMidi, range, [prevMidi]);
                    if (alt !== prevMidi)
                        midi = alt;
                }
            }
            if (!allowOverlap && typeof bottomMidi === "number") {
                var minAbove = bottomMidi + 1;
                if (midi <= bottomMidi) {
                    var adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, minAbove), range.max);
                    if (adjusted === null || adjusted <= bottomMidi) {
                        var localRange = { min: Math.max(range.min, minAbove), max: range.max };
                        var base = Math.max(prevMidi !== null && prevMidi !== void 0 ? prevMidi : midi, localRange.min);
                        adjusted = chordPcs.length
                            ? chooseChordToneNearestFromPcs(chordPcs, base, localRange, [])
                            : Math.min(localRange.max, Math.max(localRange.min, base));
                    }
                    midi = adjusted;
                }
            }
            if (allowOverlap && typeof bottomMidi === "number") {
                var minAbove = bottomMidi;
                var maxAbove = bottomMidi + 12;
                var adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, minAbove), Math.min(range.max, maxAbove));
                if (adjusted !== null)
                    midi = adjusted;
            }
            if (prevMidi !== null) {
                midi = clampTopLeap({
                    midi: midi,
                    prevMidi: prevMidi,
                    chordPcs: chordPcs,
                    range: range,
                    maxLeap: 9
                });
            }
            evs.push({
                type: "note",
                t: t,
                dur: dur,
                voice: 1,
                staff: 1,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                chord: false,
                id: "1-1-n-".concat(measureNumber, "-").concat(t)
            });
            if (mode === "melody" && typeof melodyMidi === "number") {
                evs[evs.length - 1].__melody = true;
            }
            prevMidi = midi;
            cursor = Math.round((cursor + dur) * 1000) / 1000;
        }
    }
    return evs;
}
function buildRhFillEvents(params) {
    var _a;
    var chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, melodyEvents = params.melodyEvents, activity = params.activity, scalePcs = params.scalePcs;
    var range = { min: 55, max: 84 }; // G3..C6
    var evs = [];
    var lastChord = params.lastChord;
    var chordEvents = chords
        .filter(function (c) { return Number(c.measure) === Number(measureNumber); })
        .map(function (c) { return (__assign(__assign({}, c), { t: Number(c.t) })); })
        .filter(function (c) { return Number.isFinite(c.t); })
        .sort(function (a, b) { return Number(a.t) - Number(b.t); });
    if (!chordEvents.length && lastChord) {
        chordEvents = [__assign(__assign({}, lastChord), { t: 0 })];
    }
    else if (chordEvents.length && chordEvents[0].t > 0) {
        var base = lastChord !== null && lastChord !== void 0 ? lastChord : chordEvents[0];
        chordEvents = __spreadArray([__assign(__assign({}, base), { t: 0 })], chordEvents, true);
    }
    if (!chordEvents.length)
        return { events: evs, lastChord: lastChord };
    for (var ci = 0; ci < chordEvents.length; ci++) {
        var chord = chordEvents[ci];
        var start = Math.max(0, Number(chord.t) || 0);
        var end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1].t) : measureBeats;
        var segDur = Math.max(0, Math.min(end, measureBeats) - start);
        if (segDur <= 0)
            continue;
        var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
        var map = resolveChordToneMap(parsed);
        var steps = buildRhFillSteps(segDur, activity);
        var cursor = start;
        var lastToneMidi = null;
        for (var _i = 0, steps_1 = steps; _i < steps_1.length; _i++) {
            var step = steps_1[_i];
            var melMidi = findNoteMidiAtTime(melodyEvents, cursor);
            var maxMidi = typeof melMidi === "number" ? Math.min(range.max, melMidi - 1) : range.max;
            if (maxMidi < range.min) {
                cursor += step.dur;
                continue;
            }
            var midi = null;
            if (step.token === "passing" && activity === "high_active") {
                var base = lastToneMidi !== null && lastToneMidi !== void 0 ? lastToneMidi : pickMidiForPcBelow(map.rootPc, range.min, maxMidi);
                if (typeof base === "number") {
                    var dir = (measureNumber + Math.round(cursor * 2)) % 2 === 0 ? 1 : -1;
                    midi = pickPassingMidi({
                        baseMidi: base,
                        scalePcs: scalePcs,
                        dir: dir,
                        min: range.min,
                        max: maxMidi,
                        allowChromatic: !isStrongBeat(cursor) && !isChordBoundary(chords, measureNumber, cursor),
                        preferChromatic: !isStrongBeat(cursor) && !isChordBoundary(chords, measureNumber, cursor)
                    });
                }
            }
            if (midi === null) {
                var pc = step.token === "third" ? map.thirdPc : step.token === "fifth" ? map.fifthPc : map.rootPc;
                midi = pickMidiForPcBelow(pc, range.min, maxMidi);
            }
            if (midi === null) {
                cursor += step.dur;
                continue;
            }
            evs.push({
                type: "note",
                t: cursor,
                dur: step.dur,
                voice: 5,
                staff: 1,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                id: "1-5-n-".concat(measureNumber, "-").concat(cursor)
            });
            lastToneMidi = midi;
            cursor += step.dur;
        }
    }
    lastChord = (_a = chordEvents[chordEvents.length - 1]) !== null && _a !== void 0 ? _a : lastChord;
    return { events: evs, lastChord: lastChord };
}
function buildRhChordPadEvents(params) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    var chords = params.chords, measureNumber = params.measureNumber, measureBeats = params.measureBeats, level = params.level, rhActivity = params.rhActivity, scalePcs = params.scalePcs;
    var range = (_a = params.range) !== null && _a !== void 0 ? _a : { min: 60, max: 84 }; // C4..C6
    var pulseOnsets = Array.isArray(params.pulseOnsets) ? params.pulseOnsets : null;
    var bottomRangeMin = (_b = params.bottomRangeMin) !== null && _b !== void 0 ? _b : 55; // G3
    var evs = [];
    var lastChord = params.lastChord;
    var activity = (rhActivity !== null && rhActivity !== void 0 ? rhActivity : "less_active");
    var activeBottom = activity === "active" || activity === "high_active";
    var prevBottomMidi = null;
    var pickBottomRole = function (t) {
        if (isStrongBeat(t) || isChordBoundary(chords, measureNumber, t))
            return "chord";
        var weights = [
            { value: "passing", weight: 35 },
            { value: "neighbor", weight: 25 },
            { value: "skip", weight: 10 },
            { value: "leap", weight: 10 },
            { value: "chord", weight: 20 }
        ];
        var seed = (measureNumber * 1299709) ^ (Math.round(t * 1000) * 1511);
        return pickWeighted(weights, seed);
    };
    var chordEvents = chords
        .filter(function (c) { return Number(c.measure) === Number(measureNumber); })
        .map(function (c) { return (__assign(__assign({}, c), { t: Number(c.t) })); })
        .filter(function (c) { return Number.isFinite(c.t); })
        .sort(function (a, b) { return Number(a.t) - Number(b.t); });
    if (!chordEvents.length && lastChord) {
        chordEvents = [__assign(__assign({}, lastChord), { t: 0 })];
    }
    else if (chordEvents.length && chordEvents[0].t > 0) {
        var base = lastChord !== null && lastChord !== void 0 ? lastChord : chordEvents[0];
        chordEvents = __spreadArray([__assign(__assign({}, base), { t: 0 })], chordEvents, true);
    }
    if (!chordEvents.length)
        return { events: evs, lastChord: lastChord };
    var _loop_8 = function (ci) {
        var chord = chordEvents[ci];
        var start = Math.max(0, Number(chord.t) || 0);
        var end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1].t) : measureBeats;
        var segDur = Math.max(0, Math.min(end, measureBeats) - start);
        if (segDur <= 0)
            return "continue";
        var parsed = (0, chordSymbol_1.parseChordSymbol)(chord.symbol);
        if (!parsed)
            return "continue";
        var rootPc = parsed.rootPc;
        var chordPcs = new Set((_c = parsed.pcs) !== null && _c !== void 0 ? _c : []);
        var quality = chordQualityFlags(chord.symbol);
        var rhChordPcs = new Set(chordPcs);
        var majThirdPc = (rootPc + 4) % 12;
        var minThirdPc = (rootPc + 3) % 12;
        var sus4Pc = (rootPc + 5) % 12;
        if (quality.isDominant) {
            rhChordPcs.delete(majThirdPc);
            rhChordPcs.delete(minThirdPc);
            rhChordPcs.add(sus4Pc);
        }
        else if (quality.isMajor) {
            rhChordPcs.add((rootPc + 2) % 12);
        }
        var chordMap = resolveChordToneMap(parsed);
        var worshipPatterns = {
            beginner: [
                [0, 7],
                [0, 5],
                [0, 4],
                [0, 3],
                [0, 12],
                [0, 7, 12]
            ],
            intermediate: [
                [0, 2, 7],
                [0, 5, 9],
                [0, 7, 12],
                [0, 4, 7],
                [0, 3, 7],
                [0, 5, 7],
                [0, 3, 8],
                [0, 4, 9]
            ],
            advanced: [
                [0, 2, 7],
                [0, 5, 9],
                [0, 7, 12],
                [0, 2, 4, 7],
                [0, 3, 7, 10],
                [0, 4, 7, 10],
                [0, 4, 7, 11],
                [0, 3, 7],
                [0, 4, 7]
            ],
            professional: [
                [0, 2, 7],
                [0, 5, 9],
                [0, 7, 12],
                [0, 2, 4, 7],
                [0, 3, 7, 10],
                [0, 4, 7, 10],
                [0, 4, 7, 11],
                [0, 2, 4, 7, 10],
                [0, 2, 4, 7, 11]
            ]
        };
        var patterns = (_d = worshipPatterns[level]) !== null && _d !== void 0 ? _d : worshipPatterns.intermediate;
        var hasPc = function (interval) {
            var pc = ((rootPc + interval) % 12 + 12) % 12;
            if (interval % 12 === 0)
                return true;
            return rhChordPcs.has(pc);
        };
        var filtered = patterns.filter(function (pat) { return pat.every(function (iv) { return hasPc(iv); }); });
        var group = Math.floor((measureNumber - 1) / 8);
        var chosen = filtered.length
            ? filtered[(group + Math.round(start * 2)) % filtered.length]
            : (_e = patterns.find(function (pat) { return pat.every(function (iv) { return hasPc(iv % 12); }); })) !== null && _e !== void 0 ? _e : [0, 7];
        var baseRoot = (_f = pickMidiForPcBelow(rootPc, 60, 72)) !== null && _f !== void 0 ? _f : pickMidiForPcBelow(rootPc, range.min, range.max);
        if (baseRoot === null)
            return "continue";
        var tones = [];
        var cursorMidi = baseRoot;
        for (var _i = 0, chosen_1 = chosen; _i < chosen_1.length; _i++) {
            var iv = chosen_1[_i];
            var pc = ((rootPc + iv) % 12 + 12) % 12;
            var next = pickMidiForPcAtOrAbove(pc, cursorMidi, range.max);
            if (next === null) {
                tones.length = 0;
                break;
            }
            tones.push(next);
            cursorMidi = next + 1;
        }
        if (!tones.length)
            return "continue";
        var span = Math.max.apply(Math, tones) - Math.min.apply(Math, tones);
        var maxSpan = 12;
        if (span > maxSpan) {
            tones.length = 0;
        }
        if (!tones.length)
            return "continue";
        var bottomMidi = tones[0];
        var upperTones = tones.slice(1);
        var maxUpper = activeBottom ? 3 : 4;
        if (upperTones.length > maxUpper) {
            upperTones = upperTones.slice(upperTones.length - maxUpper);
        }
        var topMidi = upperTones.length ? Math.max.apply(Math, upperTones) : bottomMidi;
        var bottomForVoice2 = bottomMidi;
        if (!upperTones.length) {
            var maxBelow = Math.min(range.max, bottomMidi - 1);
            var worshipThirdPc = quality.isDominant ? sus4Pc : chordMap.thirdPc;
            var candidates = [worshipThirdPc, chordMap.fifthPc, chordMap.rootPc];
            for (var _l = 0, candidates_3 = candidates; _l < candidates_3.length; _l++) {
                var pc = candidates_3[_l];
                var cand = pickMidiForPcBelow(pc, range.min, maxBelow);
                if (cand !== null && cand !== bottomMidi) {
                    bottomForVoice2 = cand;
                    break;
                }
            }
        }
        var pulseTimes = pulseOnsets ? slicePatternOnsets(pulseOnsets, start, end) : [start];
        for (var pi = 0; pi < pulseTimes.length; pi++) {
            var tPulse = pulseTimes[pi];
            var nextPulse = pi + 1 < pulseTimes.length ? pulseTimes[pi + 1] : end;
            var durPulse = Math.max(0, Math.min(end, nextPulse) - tPulse);
            if (durPulse <= 0)
                continue;
            if (upperTones.length) {
                for (var ui = 0; ui < upperTones.length; ui++) {
                    var midi = upperTones[ui];
                    evs.push({
                        type: "note",
                        t: tPulse,
                        dur: durPulse,
                        voice: 1,
                        staff: 1,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        chord: ui > 0,
                        id: "1-1-n-".concat(measureNumber, "-").concat(tPulse, "-").concat(ui)
                    });
                }
            }
            else {
                evs.push({
                    type: "note",
                    t: tPulse,
                    dur: durPulse,
                    voice: 1,
                    staff: 1,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(bottomMidi),
                    chord: false,
                    id: "1-1-n-".concat(measureNumber, "-").concat(tPulse, "-0")
                });
            }
        }
        var canAddBottomVoice = upperTones.length > 0 || bottomForVoice2 !== bottomMidi;
        if (canAddBottomVoice && activeBottom) {
            var seedBase = group * 10000 + Math.round(start * 1000);
            var durations = buildActiveDurations(segDur, activity, seedBase);
            var maxMidi = Math.min(range.max, topMidi - 1);
            var minMidi = Math.max(bottomRangeMin, topMidi - 12);
            if (maxMidi < minMidi) {
                minMidi = topMidi - 12;
            }
            var localRange = { min: minMidi, max: Math.max(minMidi, maxMidi) };
            if (prevBottomMidi === null)
                prevBottomMidi = bottomForVoice2;
            var cursor = start;
            for (var iEv = 0; iEv < durations.length; iEv++) {
                var dur = durations[iEv];
                var t = cursor;
                if (t + dur > measureBeats + 1e-6)
                    break;
                var role = pickBottomRole(t);
                var chordPcsArr = Array.from(rhChordPcs);
                var exclude = upperTones.slice();
                var midi = prevBottomMidi !== null && prevBottomMidi !== void 0 ? prevBottomMidi : bottomForVoice2;
                if (role === "passing") {
                    var dir = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
                    var allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);
                    midi =
                        (_g = pickPassingMidi({
                            baseMidi: midi,
                            scalePcs: scalePcs,
                            dir: dir,
                            min: localRange.min,
                            max: localRange.max,
                            allowChromatic: allowChromatic,
                            preferChromatic: allowChromatic && activity === "high_active"
                        })) !== null && _g !== void 0 ? _g : chooseNeighborMidi(midi, scalePcs, localRange, dir);
                }
                else if (role === "neighbor" || role === "appoggiatura") {
                    var dir = (measureNumber + Math.round(t * 2) + 1) % 2 === 0 ? 1 : -1;
                    var allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);
                    midi =
                        (_h = pickPassingMidi({
                            baseMidi: midi,
                            scalePcs: scalePcs,
                            dir: dir,
                            min: localRange.min,
                            max: localRange.max,
                            allowChromatic: allowChromatic,
                            preferChromatic: allowChromatic && activity === "high_active"
                        })) !== null && _h !== void 0 ? _h : chooseNeighborMidi(midi, scalePcs, localRange, dir);
                }
                else if (role === "skip") {
                    midi = chooseChordToneByInterval(chordPcsArr, midi, localRange, 3, 5, midi);
                }
                else if (role === "leap") {
                    midi = chooseChordToneByInterval(chordPcsArr, midi, localRange, 7, 9, midi);
                }
                else if (role === "anticipation") {
                    var nextChord = pickChordForTime(chords, t + dur < measureBeats ? measureNumber : measureNumber + 1, t + dur < measureBeats ? t + dur : 0);
                    var nextParsed = nextChord ? (0, chordSymbol_1.parseChordSymbol)(nextChord.symbol) : null;
                    var nextPcs = (_j = nextParsed === null || nextParsed === void 0 ? void 0 : nextParsed.pcs) !== null && _j !== void 0 ? _j : chordPcsArr;
                    midi = chooseChordToneNearestFromPcs(nextPcs, midi, localRange, exclude);
                }
                else if (role === "syncopation") {
                    if (!isStrongBeat(t)) {
                        midi = prevBottomMidi !== null && prevBottomMidi !== void 0 ? prevBottomMidi : midi;
                    }
                }
                else {
                    midi = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, exclude);
                }
                if (prevBottomMidi !== null && midi === prevBottomMidi && !shouldAllowRepeat(measureNumber, t, REPEAT_RATIO, 23)) {
                    if (!isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t)) {
                        var dir = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
                        var neighbor = chooseNeighborMidi(midi, scalePcs, localRange, dir);
                        if (neighbor !== midi)
                            midi = neighbor;
                    }
                    if (midi === prevBottomMidi && chordPcsArr.length) {
                        var alt = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, __spreadArray([midi], exclude, true));
                        if (alt !== midi)
                            midi = alt;
                    }
                }
                if (exclude.includes(midi)) {
                    midi = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, exclude);
                }
                evs.push({
                    type: "note",
                    t: t,
                    dur: dur,
                    voice: 2,
                    staff: 1,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    chord: false,
                    id: "1-2-n-".concat(measureNumber, "-").concat(t)
                });
                prevBottomMidi = midi;
                cursor = Math.round((cursor + dur) * 1000) / 1000;
            }
        }
        else if (canAddBottomVoice) {
            var bottom = bottomForVoice2;
            var maxMidi = Math.min(range.max, topMidi - 1);
            var minMidi = Math.max(bottomRangeMin, topMidi - 12);
            if (maxMidi < minMidi) {
                minMidi = topMidi - 12;
            }
            if (bottom > maxMidi)
                bottom = maxMidi;
            if (bottom < minMidi)
                bottom = minMidi;
            evs.push({
                type: "note",
                t: start,
                dur: segDur,
                voice: 2,
                staff: 1,
                pitch: (0, instrumentCatalog_1.midiToPitch)(bottom),
                chord: false,
                id: "1-2-n-".concat(measureNumber, "-").concat(start, "-0")
            });
        }
    };
    for (var ci = 0; ci < chordEvents.length; ci++) {
        _loop_8(ci);
    }
    lastChord = (_k = chordEvents[chordEvents.length - 1]) !== null && _k !== void 0 ? _k : lastChord;
    return { events: evs, lastChord: lastChord };
}
function arrangePianoFromSatb(score, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3;
    var warnings = (_a = options === null || options === void 0 ? void 0 : options.warnings) !== null && _a !== void 0 ? _a : [];
    var level = ((_b = options === null || options === void 0 ? void 0 : options.level) !== null && _b !== void 0 ? _b : "beginner");
    var polyphonic = (options === null || options === void 0 ? void 0 : options.polyphonic) === true;
    var chordsForArrange = resolveChordsForArrange(options === null || options === void 0 ? void 0 : options.chords, score);
    var rhActivity = ((_c = options === null || options === void 0 ? void 0 : options.rhActivity) !== null && _c !== void 0 ? _c : "less_active");
    var sopranoActivity = ((_d = options === null || options === void 0 ? void 0 : options.sopranoActivity) !== null && _d !== void 0 ? _d : "grounded");
    var wantsPianoWithMelody = (options === null || options === void 0 ? void 0 : options.ensembleTag) === "piano_with_melody";
    var melodyHand = (options === null || options === void 0 ? void 0 : options.melodyHand) === "left" ? "left" : "right";
    var melodyOnLeft = melodyHand === "left";
    var sopranoMelodyShare = typeof (options === null || options === void 0 ? void 0 : options.sopranoMelodyShare) === "number" && Number.isFinite(options.sopranoMelodyShare)
        ? Math.max(0, Math.min(100, options.sopranoMelodyShare))
        : 30;
    var useSopranoTexture = !wantsPianoWithMelody && !melodyOnLeft && sopranoActivity !== "grounded";
    var omitMelodyInPiano = (options === null || options === void 0 ? void 0 : options.omitMelodyInPiano) === true || melodyOnLeft;
    var separateMelodyPart = (options === null || options === void 0 ? void 0 : options.separateMelodyPart) === true;
    var worshipChordPad = (options === null || options === void 0 ? void 0 : options.worshipChordPad) === true;
    var worshipMode = worshipChordPad === true;
    var tempoBpm = typeof (options === null || options === void 0 ? void 0 : options.tempoBpm) === "number" && Number.isFinite(options.tempoBpm)
        ? options.tempoBpm
        : getTempoBpm(score);
    var maxLeap = 9;
    var pianoAdvanced = level === "advanced";
    var preset = loadPianoStylePreset((_e = options === null || options === void 0 ? void 0 : options.pianoStylePresetPath) !== null && _e !== void 0 ? _e : options === null || options === void 0 ? void 0 : options.pianoStylePreset, warnings);
    var lhPatternArray = (_h = (_g = (_f = preset === null || preset === void 0 ? void 0 : preset.instrument_logic) === null || _f === void 0 ? void 0 : _f.left_hand_lower) === null || _g === void 0 ? void 0 : _g.rhythm_pattern) === null || _h === void 0 ? void 0 : _h.pattern_array;
    var rhPatternArray = (_l = (_k = (_j = preset === null || preset === void 0 ? void 0 : preset.instrument_logic) === null || _j === void 0 ? void 0 : _j.right_hand_upper) === null || _k === void 0 ? void 0 : _k.rhythm_pattern) === null || _l === void 0 ? void 0 : _l.pattern_array;
    var worshipRanges = {
        bass: { min: 36, max: 52 }, // C2..E3
        tenor: { min: 53, max: 64 }, // F3..E4
        alto: { min: 55, max: 72 }, // G3..C5
        soprano: { min: 60, max: 84 } // C4..C6
    };
    var tenorRange = worshipMode ? worshipRanges.tenor : pianoAdvanced ? { min: 52, max: 64 } : null; // E3..E4
    var bassRange = worshipMode ? worshipRanges.bass : pianoAdvanced ? { min: 40, max: 52 } : null; // E2..E3
    var tenorIntervalsAbove = pianoAdvanced ? [5, 6, 7, 8, 9, 10, 11, 12] : [7, 8, 9, 10, 11, 12];
    var spacingOptions = worshipMode
        ? {
            tenorRange: tenorRange !== null && tenorRange !== void 0 ? tenorRange : undefined,
            bassRange: bassRange !== null && bassRange !== void 0 ? bassRange : undefined,
            altoRange: worshipRanges.alto,
            sopranoRange: worshipRanges.soprano,
            allowOverlap: false
        }
        : pianoAdvanced
            ? {
                tenorBassMin: 5,
                tenorRange: tenorRange !== null && tenorRange !== void 0 ? tenorRange : undefined,
                bassRange: bassRange !== null && bassRange !== void 0 ? bassRange : undefined
            }
            : undefined;
    var lhRange = worshipMode ? { min: 24, max: 64 } : pianoAdvanced ? { min: 40, max: 64 } : { min: 41, max: 72 };
    var bassChordRange = worshipMode ? { min: 24, max: 52 } : pianoAdvanced ? { min: 40, max: 52 } : { min: 41, max: 72 };
    var worshipRhRange = worshipMode ? { min: worshipRanges.alto.min, max: worshipRanges.soprano.max } : undefined;
    var worshipTopRange = worshipMode ? worshipRanges.soprano : undefined;
    var voiceSopranoRange = worshipMode ? worshipRanges.soprano : { min: 52, max: 88 };
    var voiceAltoRange = worshipMode ? worshipRanges.alto : { min: 52, max: 84 };
    var voiceTenorRange = worshipMode ? worshipRanges.tenor : tenorRange !== null && tenorRange !== void 0 ? tenorRange : { min: 48, max: 64 };
    var includeA = level === "intermediate" || level === "advanced";
    var includeT = level === "advanced";
    if (level === "professional") {
        warn(warnings, "[piano] Professional level not defined yet; using 2-voice texture (melody + bass).");
    }
    var soprano = findSoprano(score);
    var alto = includeA ? findAlto(score) : null;
    var tenor = includeT ? findTenor(score) : null;
    var bass = findBass(score);
    if (!soprano || !bass) {
        warn(warnings, "[piano] Missing Soprano or Bass part; returning original score.");
        return score;
    }
    var measures = cloneMeasuresTemplate(soprano);
    var pianoPart = {
        part_id: "P_PNO",
        name: "Piano",
        instrument: "piano",
        staves: 2,
        measures: measures
    };
    var lastChord = null;
    var firstMeasure = measures[0];
    var keyFifths = Number((_o = (_m = firstMeasure === null || firstMeasure === void 0 ? void 0 : firstMeasure.attributes) === null || _m === void 0 ? void 0 : _m.key_fifths) !== null && _o !== void 0 ? _o : 0);
    var keyModeRaw = String((_q = (_p = firstMeasure === null || firstMeasure === void 0 ? void 0 : firstMeasure.attributes) === null || _p === void 0 ? void 0 : _p.key_mode) !== null && _q !== void 0 ? _q : "major").toLowerCase();
    var keyMode = keyModeRaw === "minor" ? "minor" : "major";
    var scalePcs = scalePcsFromKey(keyFifths, keyMode);
    for (var i = 0; i < measures.length; i++) {
        var mNum = Number((_s = (_r = measures[i]) === null || _r === void 0 ? void 0 : _r.number) !== null && _s !== void 0 ? _s : i + 1);
        var sM = (_t = soprano.measures) === null || _t === void 0 ? void 0 : _t[i];
        var aM = (_u = alto === null || alto === void 0 ? void 0 : alto.measures) === null || _u === void 0 ? void 0 : _u[i];
        var tM = (_v = tenor === null || tenor === void 0 ? void 0 : tenor.measures) === null || _v === void 0 ? void 0 : _v[i];
        var bM = (_w = bass === null || bass === void 0 ? void 0 : bass.measures) === null || _w === void 0 ? void 0 : _w[i];
        var sEvents = (_x = sM === null || sM === void 0 ? void 0 : sM.events) !== null && _x !== void 0 ? _x : [];
        var aEvents = (_y = aM === null || aM === void 0 ? void 0 : aM.events) !== null && _y !== void 0 ? _y : [];
        var tEvents = (_z = tM === null || tM === void 0 ? void 0 : tM.events) !== null && _z !== void 0 ? _z : [];
        var bEvents = (_0 = bM === null || bM === void 0 ? void 0 : bM.events) !== null && _0 !== void 0 ? _0 : [];
        var evs = [];
        var measureBeats = measureBeatsFromAttributes((_1 = measures[i]) === null || _1 === void 0 ? void 0 : _1.attributes);
        var rhPulseOnsets = rhPatternArray ? patternOnsetsFromArray(rhPatternArray, measureBeats) : undefined;
        var lhPatternOnsets = lhPatternArray ? patternOnsetsFromArray(lhPatternArray, measureBeats) : undefined;
        var rhBottomEvents = [];
        var rhAltoVoice = melodyOnLeft ? 1 : 2;
        var rhTenorVoice = melodyOnLeft ? 2 : 3;
        // RH chord pad for worship accompaniment
        if (worshipChordPad && chordsForArrange.length) {
            var pad = buildRhChordPadEvents({
                chords: chordsForArrange,
                lastChord: lastChord,
                measureNumber: mNum,
                measureBeats: measureBeats,
                level: level,
                rhActivity: rhActivity,
                scalePcs: scalePcs,
                range: worshipRhRange,
                bottomRangeMin: worshipMode ? worshipRanges.alto.min : undefined,
                pulseOnsets: rhPulseOnsets
            });
            lastChord = pad.lastChord;
            if (useSopranoTexture) {
                rhBottomEvents = pad.events.filter(function (e) { return (e === null || e === void 0 ? void 0 : e.staff) === 1 && (e === null || e === void 0 ? void 0 : e.voice) === 2; });
                evs.push.apply(evs, rhBottomEvents);
            }
            else {
                evs.push.apply(evs, pad.events);
            }
        }
        else if (includeA && aEvents.length) {
            // RH inner voice (alto)
            rhBottomEvents = mapVoiceEvents({
                srcEvents: aEvents,
                voice: rhAltoVoice,
                staff: 1,
                anchorEvents: melodyOnLeft ? undefined : sEvents,
                relation: worshipMode || melodyOnLeft ? undefined : "below",
                measureNumber: mNum,
                warnings: warnings
            });
            evs.push.apply(evs, rhBottomEvents);
        }
        var rhTenorEvents = [];
        if (melodyOnLeft && !worshipChordPad && includeT && tEvents.length) {
            rhTenorEvents = mapVoiceEvents({
                srcEvents: tEvents,
                voice: rhTenorVoice,
                staff: 1,
                anchorEvents: rhBottomEvents,
                relation: rhBottomEvents.length ? "below" : undefined,
                measureNumber: mNum,
                warnings: warnings
            });
            evs.push.apply(evs, rhTenorEvents);
        }
        // RH top voice
        if (useSopranoTexture) {
            var topEvents = buildRhTopVoiceEvents({
                chords: chordsForArrange,
                measureNumber: mNum,
                measureBeats: measureBeats,
                melodyEvents: sEvents,
                bottomEvents: rhBottomEvents,
                activity: sopranoActivity === "grounded" ? "less_active" : sopranoActivity,
                scalePcs: scalePcs,
                melodyShare: sopranoMelodyShare,
                range: worshipTopRange,
                allowOverlap: worshipMode
            });
            evs.push.apply(evs, topEvents);
        }
        else if (!omitMelodyInPiano) {
            // RH: melody (unless omitted for worship-style piano accompaniment)
            evs.push.apply(evs, mapVoiceEvents({
                srcEvents: sEvents,
                voice: 1,
                staff: 1,
                measureNumber: mNum,
                warnings: warnings,
                markMelody: true
            }));
        }
        if (polyphonic && chordsForArrange.length && rhActivity !== "grounded") {
            // RH arpeggio fill disabled; polyphonic arpeggios are handled in LH only.
            lastChord = (_2 = pickChordForTime(chordsForArrange, mNum, 0)) !== null && _2 !== void 0 ? _2 : lastChord;
        }
        if (melodyOnLeft) {
            evs.push.apply(evs, mapVoiceEvents({
                srcEvents: sEvents,
                voice: 3,
                staff: 2,
                measureNumber: mNum,
                warnings: warnings,
                markMelody: true
            }));
        }
        // LH inner voice (tenor)
        if (!melodyOnLeft && includeT && tEvents.length) {
            evs.push.apply(evs, mapVoiceEvents({
                srcEvents: tEvents,
                voice: 3,
                staff: 2,
                anchorEvents: bEvents,
                relation: worshipMode ? undefined : "above",
                allowedIntervalsAbove: worshipMode ? undefined : tenorIntervalsAbove,
                measureNumber: mNum,
                warnings: warnings
            }));
        }
        // LH bass
        var bassVoice = melodyOnLeft ? 4 : includeT ? 4 : 3;
        evs.push.apply(evs, mapVoiceEvents({
            srcEvents: bEvents,
            voice: bassVoice,
            staff: 2,
            measureNumber: mNum,
            warnings: warnings
        }));
        if (!melodyOnLeft && (omitMelodyInPiano || separateMelodyPart)) {
            ensureMelodyStartDoubling({ events: evs, melodyEvents: sEvents, measureNumber: mNum, warnings: warnings });
        }
        var sorted = evs.sort(function (a, b) { return Number(a.t) - Number(b.t) || Number(a.voice) - Number(b.voice); });
        trimEventsToMeasure(sorted, measureBeats, mNum, warnings);
        dropDuplicateNotesAtTime({ events: sorted, measureNumber: mNum, warnings: warnings });
        if (!melodyOnLeft && !omitMelodyInPiano) {
            enforceHarmonyBelowMelody({
                events: sorted,
                measureNumber: mNum,
                warnings: warnings,
                rhRange: { min: 52, max: 88 }
            });
        }
        if (!melodyOnLeft) {
            thinChordsAtMelodyOnsets({
                events: sorted,
                melodyEvents: sEvents,
                measureNumber: mNum,
                warnings: warnings,
                staff: 1,
                maxNotes: 2
            });
        }
        var beatVoices = [];
        if (melodyOnLeft) {
            if (includeA)
                beatVoices.push({ staff: 1, voice: 1, range: voiceAltoRange, label: "alto" });
            if (includeT)
                beatVoices.push({ staff: 1, voice: 2, range: voiceTenorRange, label: "tenor" });
        }
        else {
            beatVoices.push({ staff: 1, voice: 1, range: voiceSopranoRange, label: "soprano" });
            if (includeA)
                beatVoices.push({ staff: 1, voice: 2, range: voiceAltoRange, label: "alto" });
            if (includeT)
                beatVoices.push({ staff: 2, voice: 3, range: voiceTenorRange, label: "tenor" });
        }
        ensureChordVoicesAtBeats({
            events: sorted,
            chords: chordsForArrange,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            voices: beatVoices,
            allowWorshipClusters: worshipMode
        });
        sorted.sort(function (a, b) { return Number(a.t) - Number(b.t) || Number(a.voice) - Number(b.voice); });
        if (melodyOnLeft) {
            if (includeA)
                clampVoiceLeapsForMeasure(sorted, 1, 1, maxLeap, mNum, warnings);
            if (includeT)
                clampVoiceLeapsForMeasure(sorted, 1, 2, maxLeap, mNum, warnings);
            clampVoiceLeapsForMeasure(sorted, 1, 5, maxLeap, mNum, warnings);
            clampVoiceLeapsForMeasure(sorted, 2, 4, maxLeap, mNum, warnings);
        }
        else {
            clampVoiceLeapsForMeasure(sorted, 1, 1, maxLeap, mNum, warnings);
            clampVoiceLeapsForMeasure(sorted, 1, 2, maxLeap, mNum, warnings);
            clampVoiceLeapsForMeasure(sorted, 1, 5, maxLeap, mNum, warnings);
            if (includeT)
                clampVoiceLeapsForMeasure(sorted, 2, 3, maxLeap, mNum, warnings);
            var bassVoice_1 = includeT ? 4 : 3;
            clampVoiceLeapsForMeasure(sorted, 2, bassVoice_1, maxLeap, mNum, warnings);
            enforceVoiceSpacingForMeasure(sorted, mNum, measureBeats, warnings, spacingOptions);
        }
        enforceHandLimitsForMeasure({
            events: sorted,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            maxSpan: 12,
            maxNotes: 4,
            rhRange: { min: 52, max: 88 },
            lhRange: lhRange,
            suppressSpanWarnings: worshipMode
        });
        enforceChordPriorityForMeasure({
            events: sorted,
            chords: chordsForArrange,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            allowWorshipClusters: worshipMode,
            strictAllTimes: worshipMode
        });
        enforceBassToChordAtTimes({
            events: sorted,
            chords: chordsForArrange,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            range: bassChordRange,
            maxLeap: maxLeap,
            extraTimes: lhPatternOnsets
        });
        enforceHandLimitsForMeasure({
            events: sorted,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            maxSpan: 12,
            maxNotes: 4,
            rhRange: { min: 52, max: 88 },
            lhRange: lhRange,
            suppressSpanWarnings: worshipMode
        });
        if (!melodyOnLeft) {
            enforceVoiceSpacingForMeasure(sorted, mNum, measureBeats, warnings, spacingOptions);
        }
        enforceChordPriorityForMeasure({
            events: sorted,
            chords: chordsForArrange,
            measureNumber: mNum,
            measureBeats: measureBeats,
            warnings: warnings,
            allowWorshipClusters: worshipMode,
            strictAllTimes: worshipMode
        });
        measures[i].events = sorted.filter(function (e) { return !e.__drop; });
    }
    var melodyPart = null;
    if (separateMelodyPart) {
        melodyPart = {
            part_id: "P_MEL",
            name: "Melody",
            instrument: "voice",
            staves: 1,
            measures: cloneMeasuresWithEvents(soprano)
        };
    }
    return __assign(__assign({}, score), { parts: melodyPart ? [melodyPart, pianoPart] : [pianoPart], meta: __assign(__assign({}, score.meta), { ensemble: (_3 = options === null || options === void 0 ? void 0 : options.ensembleTag) !== null && _3 !== void 0 ? _3 : (melodyOnLeft ? "piano_with_melody" : "piano") }) });
}
