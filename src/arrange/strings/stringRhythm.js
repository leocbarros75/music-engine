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
exports.applyStringPolyphonicRhythm = applyStringPolyphonicRhythm;
var instrumentCatalog_1 = require("../../instruments/instrumentCatalog");
var chordSymbol_1 = require("../../harmonize/satb/chordSymbol");
function warn(warnings, msg) {
    warnings.push(msg);
    // eslint-disable-next-line no-console
    console.warn(msg);
}
function activityRatio(level) {
    switch (level) {
        case "high_active":
            return 1;
        case "active":
            return 0.55;
        case "less_active":
            return 0.3;
        case "grounded":
        default:
            return 0;
    }
}
function near(a, b, eps) {
    if (eps === void 0) { eps = 1e-6; }
    return Math.abs(a - b) <= eps;
}
function isStrongBeat(t) {
    return near(t, Math.round(t));
}
function isChordBoundary(chords, measure, t) {
    for (var _i = 0, chords_1 = chords; _i < chords_1.length; _i++) {
        var c = chords_1[_i];
        if (Number(c.measure) !== Number(measure))
            continue;
        if (near(Number(c.t), t))
            return true;
    }
    return false;
}
function shouldSubdivide(measureNumber, t, ratio, salt) {
    if (salt === void 0) { salt = 0; }
    if (ratio <= 0)
        return false;
    if (ratio >= 1)
        return true;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1540483477) ^ 0x27d4eb2f;
    h = (h >>> 0) % 1000;
    return h / 1000 < ratio;
}
function shouldSyncopate(measureNumber, t, ratio, salt) {
    if (salt === void 0) { salt = 0; }
    if (ratio <= 0)
        return false;
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 1103515245) ^ (tKey * 214013) ^ (salt * 69069) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    return h / 1000 < Math.min(0.4, ratio);
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
function unitForActivity(dur, activity) {
    if (activity === "less_active") {
        return dur >= 2 ? 1 : dur;
    }
    if (activity === "active") {
        return dur >= 1 ? 0.5 : dur;
    }
    if (activity === "high_active") {
        if (dur >= 1)
            return 0.5;
        if (dur >= 0.5)
            return 0.25;
        return dur;
    }
    return dur;
}
function maybeSyncopateEvent(ev, measureNumber, ratio, salt, chordEvents, enabled) {
    if (!enabled || ev.type !== "note" || ev.dur < 0.5)
        return [ev];
    if (!isStrongBeat(ev.t))
        return [ev];
    if (isChordBoundary(chordEvents, measureNumber, ev.t))
        return [ev];
    if (!shouldSyncopate(measureNumber, ev.t, ratio, salt))
        return [ev];
    var restDur = 0.5;
    if (ev.dur <= restDur)
        return [ev];
    return [
        __assign(__assign({}, ev), { type: "rest", pitch: undefined, midi: undefined, dur: restDur }),
        __assign(__assign({}, ev), { t: ev.t + restDur, dur: ev.dur - restDur })
    ];
}
function splitEvent(ev, unit) {
    var _a, _b;
    if (!unit || unit <= 0 || unit >= ev.dur)
        return [ev];
    var out = [];
    var cursor = ev.t;
    var idx = 0;
    var end = ev.t + ev.dur;
    while (cursor + unit <= end + 1e-9) {
        out.push(__assign(__assign({}, ev), { t: cursor, dur: unit, id: "".concat((_a = ev.id) !== null && _a !== void 0 ? _a : "ev", "-r").concat(idx) }));
        cursor += unit;
        idx += 1;
    }
    var tail = end - cursor;
    if (tail > 1e-6) {
        out.push(__assign(__assign({}, ev), { t: cursor, dur: tail, id: "".concat((_b = ev.id) !== null && _b !== void 0 ? _b : "ev", "-r").concat(idx) }));
    }
    return out;
}
function normalizeMidi(ev) {
    if (typeof ev.midi === "number")
        return ev;
    if (ev.pitch) {
        var midi = (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
        return __assign(__assign({}, ev), { midi: midi });
    }
    return ev;
}
function applyToPart(part, activity, warnings, salt, options) {
    var _a, _b, _c, _d, _e, _f;
    if (options === void 0) { options = {}; }
    var ratio = activityRatio(activity);
    if (ratio <= 0)
        return;
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var keyFifths = typeof options.keyFifths === "number" ? options.keyFifths : 0;
    var keyMode = (_b = options.keyMode) !== null && _b !== void 0 ? _b : "major";
    var scale = buildScalePcs(keyFifths, keyMode);
    var allowNonChordTones = options.allowNonChordTones !== false;
    var minSubdivision = typeof options.minSubdivision === "number" ? options.minSubdivision : 0;
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : null;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : null;
    var clampRange = function (m) {
        if (m === null || minMidi === null || maxMidi === null)
            return m;
        return (0, instrumentCatalog_1.shiftOctavesIntoRange)(m, minMidi, maxMidi);
    };
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var lastMeasureNumber = measures.length ? Number((_d = (_c = measures[measures.length - 1]) === null || _c === void 0 ? void 0 : _c.number) !== null && _d !== void 0 ? _d : measures.length) : 0;
    for (var _i = 0, measures_1 = measures; _i < measures_1.length; _i++) {
        var m = measures_1[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var events = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
        var next = [];
        if (mNum === lastMeasureNumber) {
            // Leave last measure rhythm unchanged to match melody cadence.
            m.events = events;
            continue;
        }
        for (var _g = 0, events_1 = events; _g < events_1.length; _g++) {
            var ev = events_1[_g];
            if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number") {
                next.push(ev);
                continue;
            }
            if (ev.type !== "note") {
                next.push(ev);
                continue;
            }
            var unit = unitForActivity(ev.dur, activity);
            var enforcedUnit = minSubdivision > 0 && unit < minSubdivision ? minSubdivision : unit;
            var synced = maybeSyncopateEvent(normalizeMidi(ev), mNum, ratio, salt, chordEvents, options.syncopate === true);
            for (var _h = 0, synced_1 = synced; _h < synced_1.length; _h++) {
                var syncEv = synced_1[_h];
                var splitUnit = enforcedUnit;
                if (splitUnit >= syncEv.dur || syncEv.type !== "note") {
                    if (syncEv.type === "note") {
                        var m0 = typeof syncEv.midi === "number" ? syncEv.midi : syncEv.pitch ? (0, instrumentCatalog_1.pitchToMidi)(syncEv.pitch) : null;
                        var m1 = clampRange(m0);
                        if (m1 !== null && m1 !== m0) {
                            next.push(__assign(__assign({}, syncEv), { midi: m1, pitch: (0, instrumentCatalog_1.midiToPitch)(m1) }));
                            continue;
                        }
                    }
                    next.push(syncEv);
                    continue;
                }
                var doSplit = shouldSubdivide(mNum, syncEv.t, ratio, salt);
                if (!doSplit) {
                    next.push(syncEv);
                    continue;
                }
                var split = splitEvent(syncEv, splitUnit);
                var chord = chordAt(chordEvents, mNum, syncEv.t);
                var chordPcs = (_e = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _e !== void 0 ? _e : [];
                for (var _j = 0, split_1 = split; _j < split_1.length; _j++) {
                    var s = split_1[_j];
                    var midi = typeof s.midi === "number" ? s.midi : s.pitch ? (0, instrumentCatalog_1.pitchToMidi)(s.pitch) : null;
                    var onBoundary = isChordBoundary(chordEvents, mNum, s.t) || isStrongBeat(s.t);
                    if (midi !== null && !onBoundary && allowNonChordTones) {
                        var usePassing = shouldUsePassing(mNum, s.t, salt);
                        var useNeighbor = !usePassing && shouldUseNeighbor(mNum, s.t, salt);
                        if (usePassing) {
                            var dir = passDir(mNum, s.t, salt);
                            var pass = passingMidi(midi, dir, scale, chordPcs);
                            if (pass !== null)
                                midi = pass;
                        }
                        else if (useNeighbor) {
                            var dir = passDir(mNum, s.t, salt + 1);
                            var neigh = neighborMidi(midi, dir, scale, chordPcs);
                            if (neigh !== null)
                                midi = neigh;
                        }
                    }
                    midi = clampRange(midi);
                    if (midi !== null) {
                        s.midi = midi;
                        s.pitch = (0, instrumentCatalog_1.midiToPitch)(midi);
                    }
                    next.push(s);
                }
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
    warn(warnings, "[strings] Polyphonic rhythm applied to ".concat((_f = part === null || part === void 0 ? void 0 : part.name) !== null && _f !== void 0 ? _f : "part", " (activity=").concat(activity, ")."));
}
function chordAt(chords, measure, t) {
    var _a, _b, _c;
    var events = chords.filter(function (c) { return Number(c.measure) === Number(measure); });
    if (!events.length)
        return null;
    var best = events[0];
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var c = events_2[_i];
        if (Number(c.t) <= t)
            best = c;
    }
    var parsed = (0, chordSymbol_1.parseChordSymbol)(best.symbol);
    var rootPc = (_a = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _a !== void 0 ? _a : null;
    var bassPc = (_b = parseSlashBassPc(best.symbol)) !== null && _b !== void 0 ? _b : rootPc;
    return parsed
        ? __assign(__assign({}, best), { pcs: (_c = parsed.pcs) !== null && _c !== void 0 ? _c : [], rootPc: rootPc, bassPc: bassPc }) : __assign(__assign({}, best), { pcs: [], rootPc: null, bassPc: null });
}
function parseSlashBassPc(symbolRaw) {
    var _a, _b;
    var s = String(symbolRaw || "").trim();
    if (!s || !s.includes("/"))
        return null;
    var slash = (_a = s.split("/")[1]) === null || _a === void 0 ? void 0 : _a.trim();
    if (!slash)
        return null;
    var parsed = (0, chordSymbol_1.parseChordSymbol)(slash);
    return (_b = parsed === null || parsed === void 0 ? void 0 : parsed.rootPc) !== null && _b !== void 0 ? _b : null;
}
function enforceBassToChordRoot(part, chordEvents, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (options === void 0) { options = {}; }
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var prevMidi = 40;
    var strongOnly = options.strongBeatsOnly !== false;
    for (var _i = 0, measures_2 = measures; _i < measures_2.length; _i++) {
        var m = measures_2[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var divisions = Number((_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.divisions) !== null && _b !== void 0 ? _b : 1);
        var beatType = Number((_e = (_d = (_c = m === null || m === void 0 ? void 0 : m.attributes) === null || _c === void 0 ? void 0 : _c.time) === null || _d === void 0 ? void 0 : _d.beat_type) !== null && _e !== void 0 ? _e : 4);
        var beatUnit = divisions * (4 / beatType);
        var next = [];
        for (var _j = 0, _k = (_f = m === null || m === void 0 ? void 0 : m.events) !== null && _f !== void 0 ? _f : []; _j < _k.length; _j++) {
            var ev = _k[_j];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || typeof ev.t !== "number") {
                next.push(ev);
                continue;
            }
            var isStrong = beatUnit > 0 ? Math.abs(ev.t % beatUnit) < 1e-6 : Math.abs(ev.t - Math.round(ev.t)) < 1e-6;
            if (strongOnly && !isStrong) {
                next.push(ev);
                continue;
            }
            var chord = chordAt(chordEvents, mNum, ev.t);
            var bassPc = typeof (chord === null || chord === void 0 ? void 0 : chord.bassPc) === "number" ? chord.bassPc : (_g = chord === null || chord === void 0 ? void 0 : chord.rootPc) !== null && _g !== void 0 ? _g : (_h = chord === null || chord === void 0 ? void 0 : chord.pcs) === null || _h === void 0 ? void 0 : _h[0];
            if (typeof bassPc !== "number") {
                next.push(ev);
                continue;
            }
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, bassPc), 28, 60);
            prevMidi = midi;
            next.push(__assign(__assign({}, ev), { midi: midi, pitch: (0, instrumentCatalog_1.midiToPitch)(midi) }));
        }
        m.events = next;
    }
}
function enforceNoBassCelloOverlap(cb, vc, chordEvents, level) {
    var _a, _b, _c, _d, _e;
    var cbMeasures = Array.isArray(cb === null || cb === void 0 ? void 0 : cb.measures) ? cb.measures : [];
    var vcMeasures = Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : [];
    if (!cbMeasures.length || !vcMeasures.length)
        return;
    var levelRaw = String(level !== null && level !== void 0 ? level : "").toLowerCase();
    var vcMin = 36;
    var vcMax = levelRaw === "beginner" ? 64 : 76;
    var cbByMeasure = new Map();
    for (var _i = 0, cbMeasures_1 = cbMeasures; _i < cbMeasures_1.length; _i++) {
        var m = cbMeasures_1[_i];
        var map = new Map();
        for (var _f = 0, _g = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _f < _g.length; _f++) {
            var ev = _g[_f];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null)
                continue;
            map.set(Number((_b = ev.t) !== null && _b !== void 0 ? _b : 0), midi);
        }
        cbByMeasure.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, map);
    }
    for (var _h = 0, vcMeasures_1 = vcMeasures; _h < vcMeasures_1.length; _h++) {
        var m = vcMeasures_1[_h];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var cbMap = cbByMeasure.get(mNum);
        if (!cbMap)
            continue;
        var next = [];
        for (var _j = 0, _k = (_c = m === null || m === void 0 ? void 0 : m.events) !== null && _c !== void 0 ? _c : []; _j < _k.length; _j++) {
            var ev = _k[_j];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note") {
                next.push(ev);
                continue;
            }
            var t = Number((_d = ev.t) !== null && _d !== void 0 ? _d : 0);
            var cbMidi = cbMap.get(t);
            if (typeof cbMidi !== "number") {
                next.push(ev);
                continue;
            }
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null || midi !== cbMidi) {
                next.push(ev);
                continue;
            }
            var chord = chordAt(chordEvents, mNum, t);
            var chordPcs = (_e = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _e !== void 0 ? _e : [];
            var nextMidi = midi;
            if (chordPcs.length) {
                nextMidi = pickCandidateNear(midi, chordPcs, vcMin, vcMax, "either", cbMidi, cbMidi % 12);
            }
            else {
                var up = midi + 12;
                var down = midi - 12;
                if (up <= vcMax)
                    nextMidi = up;
                else if (down >= vcMin)
                    nextMidi = down;
            }
            if (nextMidi === cbMidi) {
                var altUp = nextMidi + 12;
                var altDown = nextMidi - 12;
                if (altUp <= vcMax)
                    nextMidi = altUp;
                else if (altDown >= vcMin)
                    nextMidi = altDown;
            }
            if (nextMidi !== midi) {
                next.push(__assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi) }));
            }
            else {
                next.push(ev);
            }
        }
        m.events = next;
    }
}
function enforceNoViolaCelloOverlap(vla, vc, chordEvents, level) {
    var _a, _b, _c, _d;
    var vlaMeasures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var vcMeasures = Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : [];
    if (!vlaMeasures.length || !vcMeasures.length)
        return;
    var levelRaw = String(level !== null && level !== void 0 ? level : "").toLowerCase();
    var vlaMin = 48;
    var vlaMax = levelRaw === "intermediate" ? 81 : 84;
    var vcByMeasure = new Map();
    for (var _i = 0, vcMeasures_2 = vcMeasures; _i < vcMeasures_2.length; _i++) {
        var m = vcMeasures_2[_i];
        var map = new Map();
        for (var _e = 0, _f = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _e < _f.length; _e++) {
            var ev = _f[_e];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null)
                continue;
            map.set(Number((_b = ev.t) !== null && _b !== void 0 ? _b : 0), midi);
        }
        vcByMeasure.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, map);
    }
    for (var _g = 0, vlaMeasures_1 = vlaMeasures; _g < vlaMeasures_1.length; _g++) {
        var m = vlaMeasures_1[_g];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var vcMap = vcByMeasure.get(mNum);
        if (!vcMap)
            continue;
        var next = [];
        for (var _h = 0, _j = (_c = m === null || m === void 0 ? void 0 : m.events) !== null && _c !== void 0 ? _c : []; _h < _j.length; _h++) {
            var ev = _j[_h];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note") {
                next.push(ev);
                continue;
            }
            var t = Number((_d = ev.t) !== null && _d !== void 0 ? _d : 0);
            var vcMidi = vcMap.get(t);
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null || typeof vcMidi !== "number" || midi !== vcMidi) {
                next.push(ev);
                continue;
            }
            var nextMidi = midi;
            var up = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi + 12, vlaMin, vlaMax);
            if (up !== vcMidi)
                nextMidi = up;
            else {
                var down = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi - 12, vlaMin, vlaMax);
                if (down !== vcMidi)
                    nextMidi = down;
            }
            if (nextMidi !== midi) {
                next.push(__assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi) }));
            }
            else {
                next.push(ev);
            }
        }
        m.events = next;
    }
}
function enforceNoVln1Vln2Unison(vln1, vln2, chordEvents, level) {
    var _a, _b, _c, _d, _e;
    var v1Measures = Array.isArray(vln1 === null || vln1 === void 0 ? void 0 : vln1.measures) ? vln1.measures : [];
    var v2Measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    if (!v1Measures.length || !v2Measures.length)
        return;
    var levelRaw = String(level !== null && level !== void 0 ? level : "").toLowerCase();
    var minMidi = 55;
    var maxMidi = levelRaw === "beginner" ? 83 : 96;
    var v1ByMeasure = new Map();
    for (var _i = 0, v1Measures_1 = v1Measures; _i < v1Measures_1.length; _i++) {
        var m = v1Measures_1[_i];
        var map = new Map();
        for (var _f = 0, _g = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _f < _g.length; _f++) {
            var ev = _g[_f];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null)
                continue;
            map.set(Number((_b = ev.t) !== null && _b !== void 0 ? _b : 0), midi);
        }
        v1ByMeasure.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, map);
    }
    for (var _h = 0, v2Measures_1 = v2Measures; _h < v2Measures_1.length; _h++) {
        var m = v2Measures_1[_h];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var v1Map = v1ByMeasure.get(mNum);
        if (!v1Map)
            continue;
        var next = [];
        var prevMidi = null;
        for (var _j = 0, _k = (_c = m === null || m === void 0 ? void 0 : m.events) !== null && _c !== void 0 ? _c : []; _j < _k.length; _j++) {
            var ev = _k[_j];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note") {
                next.push(ev);
                continue;
            }
            var t = Number((_d = ev.t) !== null && _d !== void 0 ? _d : 0);
            var v1Midi = v1Map.get(t);
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null || typeof v1Midi !== "number" || midi !== v1Midi) {
                next.push(ev);
                prevMidi = typeof midi === "number" ? midi : prevMidi;
                continue;
            }
            var chord = chordAt(chordEvents, mNum, t);
            var chordPcs = (_e = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _e !== void 0 ? _e : [];
            var nextMidi = midi;
            var seed = typeof prevMidi === "number" ? prevMidi : midi;
            if (chordPcs.length) {
                nextMidi = pickCandidateNear(seed, chordPcs, minMidi, maxMidi, "either", v1Midi, v1Midi % 12);
            }
            else {
                var up = midi + 12;
                var down = midi - 12;
                if (up <= maxMidi)
                    nextMidi = up;
                else if (down >= minMidi)
                    nextMidi = down;
            }
            if (nextMidi === v1Midi) {
                var altUp = nextMidi + 12;
                var altDown = nextMidi - 12;
                if (altUp <= maxMidi)
                    nextMidi = altUp;
                else if (altDown >= minMidi)
                    nextMidi = altDown;
            }
            next.push(__assign(__assign({}, ev), { midi: nextMidi, pitch: (0, instrumentCatalog_1.midiToPitch)(nextMidi) }));
            prevMidi = nextMidi;
        }
        m.events = next;
    }
}
function eventMidi(ev) {
    if (typeof (ev === null || ev === void 0 ? void 0 : ev.midi) === "number")
        return ev.midi;
    if (ev === null || ev === void 0 ? void 0 : ev.pitch)
        return (0, instrumentCatalog_1.pitchToMidi)(ev.pitch);
    return null;
}
function activeMidiAt(events, t) {
    var _a, _b;
    var bestStart = -Infinity;
    var bestMidi = null;
    for (var _i = 0, _c = events !== null && events !== void 0 ? events : []; _i < _c.length; _i++) {
        var ev = _c[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
            continue;
        var start = Number((_a = ev.t) !== null && _a !== void 0 ? _a : 0);
        var dur = Number((_b = ev.dur) !== null && _b !== void 0 ? _b : 0);
        if (!(dur > 0))
            continue;
        if (start - 1e-6 <= t && t < start + dur - 1e-6) {
            var midi = eventMidi(ev);
            if (midi === null)
                continue;
            if (start >= bestStart) {
                bestStart = start;
                bestMidi = midi;
            }
        }
    }
    return bestMidi;
}
function minUpperDuringWindow(upperEvents, start, end) {
    var _a;
    var sampleTimes = [start];
    for (var _i = 0, _b = upperEvents !== null && upperEvents !== void 0 ? upperEvents : []; _i < _b.length; _i++) {
        var ev = _b[_i];
        if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
            continue;
        var t = Number((_a = ev.t) !== null && _a !== void 0 ? _a : 0);
        if (t > start + 1e-6 && t < end - 1e-6)
            sampleTimes.push(t);
    }
    var minMidi = null;
    for (var _c = 0, sampleTimes_1 = sampleTimes; _c < sampleTimes_1.length; _c++) {
        var t = sampleTimes_1[_c];
        var midi = activeMidiAt(upperEvents, t);
        if (midi === null)
            continue;
        if (minMidi === null || midi < minMidi)
            minMidi = midi;
    }
    return minMidi;
}
function pickBelowLimit(prevMidi, upperLimit, pcs, minMidi, maxMidi) {
    var cappedMax = Math.min(maxMidi, upperLimit);
    if (pcs.length) {
        var lowOct = Math.floor(minMidi / 12) - 1;
        var highOct = Math.floor(cappedMax / 12) + 1;
        var candidates = [];
        for (var _i = 0, pcs_1 = pcs; _i < pcs_1.length; _i++) {
            var pc = pcs_1[_i];
            for (var oct = lowOct; oct <= highOct; oct++) {
                var midi = pc + oct * 12;
                if (midi >= minMidi && midi <= cappedMax)
                    candidates.push(midi);
            }
        }
        if (candidates.length) {
            candidates.sort(function (a, b) { return Math.abs(a - prevMidi) - Math.abs(b - prevMidi); });
            return candidates[0];
        }
    }
    var next = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
    while (next > upperLimit && next - 12 >= minMidi)
        next -= 12;
    if (next > upperLimit)
        next = Math.min(cappedMax, Math.max(minMidi, upperLimit));
    return (0, instrumentCatalog_1.shiftOctavesIntoRange)(next, minMidi, maxMidi);
}
function enforceNoCrossingPair(upper, lower, chordEvents, lowerRange) {
    var _a, _b, _c, _d;
    var upperMeasures = Array.isArray(upper === null || upper === void 0 ? void 0 : upper.measures) ? upper.measures : [];
    var lowerMeasures = Array.isArray(lower === null || lower === void 0 ? void 0 : lower.measures) ? lower.measures : [];
    if (!upperMeasures.length || !lowerMeasures.length)
        return;
    var upperByMeasure = new Map();
    for (var _i = 0, upperMeasures_1 = upperMeasures; _i < upperMeasures_1.length; _i++) {
        var m = upperMeasures_1[_i];
        upperByMeasure.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, m);
    }
    for (var _e = 0, lowerMeasures_1 = lowerMeasures; _e < lowerMeasures_1.length; _e++) {
        var m = lowerMeasures_1[_e];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var upperMeasure = upperByMeasure.get(mNum);
        if (!upperMeasure)
            continue;
        var upperEvents = Array.isArray(upperMeasure === null || upperMeasure === void 0 ? void 0 : upperMeasure.events) ? upperMeasure.events : [];
        var next = [];
        for (var _f = 0, _g = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _f < _g.length; _f++) {
            var ev = _g[_f];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note") {
                next.push(ev);
                continue;
            }
            var start = Number((_b = ev.t) !== null && _b !== void 0 ? _b : 0);
            var dur = Number((_c = ev.dur) !== null && _c !== void 0 ? _c : 0);
            var end = start + Math.max(0, dur);
            var midi = eventMidi(ev);
            if (midi === null || !(dur > 0)) {
                next.push(ev);
                continue;
            }
            var upperMin = minUpperDuringWindow(upperEvents, start, end);
            if (upperMin === null || midi <= upperMin) {
                next.push(ev);
                continue;
            }
            var chord = chordAt(chordEvents, mNum, start);
            var pcs = (_d = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _d !== void 0 ? _d : [];
            var fixed = pickBelowLimit(midi, upperMin, pcs, lowerRange.min, lowerRange.max);
            next.push(__assign(__assign({}, ev), { midi: fixed, pitch: (0, instrumentCatalog_1.midiToPitch)(fixed) }));
        }
        m.events = next;
    }
}
function enforceViolin2ChordToneGapFill(vln2, refs, chordEvents, range) {
    var _a, _b, _c, _d;
    var v2Measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    if (!v2Measures.length)
        return;
    var byMeasure = function (part) {
        var _a;
        var map = new Map();
        for (var _i = 0, _b = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : []; _i < _b.length; _i++) {
            var m = _b[_i];
            map.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, m);
        }
        return map;
    };
    var v1By = byMeasure(refs.vln1);
    var vaBy = byMeasure(refs.vla);
    var vcBy = byMeasure(refs.vc);
    var cbBy = byMeasure(refs.cb);
    for (var _i = 0, v2Measures_2 = v2Measures; _i < v2Measures_2.length; _i++) {
        var m = v2Measures_2[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var v1m = v1By.get(mNum);
        var vam = vaBy.get(mNum);
        var vcm = vcBy.get(mNum);
        var cbm = cbBy.get(mNum);
        var next = [];
        for (var _e = 0, _f = (_a = m === null || m === void 0 ? void 0 : m.events) !== null && _a !== void 0 ? _a : []; _e < _f.length; _e++) {
            var ev = _f[_e];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || typeof ev.t !== "number") {
                next.push(ev);
                continue;
            }
            var currMidi = eventMidi(ev);
            if (currMidi === null) {
                next.push(ev);
                continue;
            }
            var chord = chordAt(chordEvents, mNum, ev.t);
            var thirdPc = chordThirdPc(chord);
            var fifthPc = chordFifthPc(chord);
            var tonePcs = [thirdPc, fifthPc].filter(function (pc) { return typeof pc === "number"; });
            if (!tonePcs.length) {
                next.push(ev);
                continue;
            }
            var presentPcs = new Set();
            for (var _g = 0, _h = [v1m, vam, vcm, cbm]; _g < _h.length; _g++) {
                var meas = _h[_g];
                var midi_1 = activeMidiAt((_b = meas === null || meas === void 0 ? void 0 : meas.events) !== null && _b !== void 0 ? _b : [], ev.t);
                if (typeof midi_1 === "number")
                    presentPcs.add(((midi_1 % 12) + 12) % 12);
            }
            var currPc = ((currMidi % 12) + 12) % 12;
            var targetPc = null;
            if (typeof thirdPc === "number" && !presentPcs.has(thirdPc))
                targetPc = thirdPc;
            else if (typeof fifthPc === "number" && !presentPcs.has(fifthPc))
                targetPc = fifthPc;
            else if (tonePcs.includes(currPc))
                targetPc = currPc;
            var lo = range.min;
            var hi = range.max;
            var belowV1 = activeMidiAt((_c = v1m === null || v1m === void 0 ? void 0 : v1m.events) !== null && _c !== void 0 ? _c : [], ev.t);
            var aboveVla = activeMidiAt((_d = vam === null || vam === void 0 ? void 0 : vam.events) !== null && _d !== void 0 ? _d : [], ev.t);
            if (typeof belowV1 === "number")
                hi = Math.min(hi, belowV1);
            if (typeof aboveVla === "number")
                lo = Math.max(lo, aboveVla);
            if (lo > hi) {
                lo = range.min;
                hi = range.max;
            }
            var pcs = targetPc === null ? tonePcs : [targetPc];
            var midi = pickCandidateNear(currMidi, pcs, lo, hi, "either");
            next.push(__assign(__assign({}, ev), { midi: midi, pitch: (0, instrumentCatalog_1.midiToPitch)(midi) }));
        }
        m.events = next;
    }
}
function alignEndingRhythmToMelody(melodyPart, targets, chordEvents) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    if (!melodyPart)
        return;
    var measures = Array.isArray(melodyPart === null || melodyPart === void 0 ? void 0 : melodyPart.measures) ? melodyPart.measures : [];
    if (!measures.length)
        return;
    var lastMeasure = measures[measures.length - 1];
    if (!lastMeasure)
        return;
    var mNum = Number(lastMeasure.number) || measures.length;
    var melodyEvents = ((_a = lastMeasure.events) !== null && _a !== void 0 ? _a : [])
        .filter(function (ev) { return ev && typeof ev.t === "number" && typeof ev.dur === "number"; })
        .map(function (ev) { return (__assign({}, ev)); });
    if (!melodyEvents.length)
        return;
    for (var _i = 0, targets_1 = targets; _i < targets_1.length; _i++) {
        var target = targets_1[_i];
        var part = target.part;
        if (!part)
            continue;
        var measure = ((_b = part.measures) !== null && _b !== void 0 ? _b : []).find(function (m) { return Number(m === null || m === void 0 ? void 0 : m.number) === mNum; });
        if (!measure)
            continue;
        var next = [];
        var prevMidi = (_e = (_d = ((_c = measure.events) !== null && _c !== void 0 ? _c : []).find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && typeof e.midi === "number"; })) === null || _d === void 0 ? void 0 : _d.midi) !== null && _e !== void 0 ? _e : null;
        if (typeof prevMidi !== "number" && ((_f = measure.events) === null || _f === void 0 ? void 0 : _f.length)) {
            var firstPitch = (_h = ((_g = measure.events) !== null && _g !== void 0 ? _g : []).find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && (e === null || e === void 0 ? void 0 : e.pitch); })) === null || _h === void 0 ? void 0 : _h.pitch;
            if (firstPitch)
                prevMidi = (0, instrumentCatalog_1.pitchToMidi)(firstPitch);
        }
        for (var _k = 0, melodyEvents_1 = melodyEvents; _k < melodyEvents_1.length; _k++) {
            var ev = melodyEvents_1[_k];
            if (ev.type === "rest") {
                next.push(__assign(__assign({}, ev), { voice: 1, staff: 1 }));
                continue;
            }
            var chord = chordAt(chordEvents, mNum, ev.t);
            var chordPcs = (_j = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _j !== void 0 ? _j : [];
            var midi = typeof prevMidi === "number" ? prevMidi : 60;
            if (chordPcs.length) {
                midi = pickCandidateNear(midi, chordPcs, target.range.min, target.range.max, "either");
            }
            else {
                midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi, target.range.min, target.range.max);
            }
            prevMidi = midi;
            next.push({
                id: ev.id ? "".concat(ev.id, "-rhythm") : undefined,
                t: ev.t,
                dur: ev.dur,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
        }
        measure.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function buildScalePcs(fifths, mode) {
    var major = [0, 2, 4, 5, 7, 9, 11];
    var minor = [0, 2, 3, 5, 7, 8, 10];
    var root = ((fifths * 7) % 12 + 12) % 12;
    var base = mode === "minor" ? minor : major;
    return base.map(function (pc) { return (root + pc) % 12; });
}
function shouldUsePassing(measureNumber, t, salt) {
    if (salt === void 0) { salt = 0; }
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 912367) ^ (tKey * 12289) ^ (salt * 131) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    return h / 1000 < 0.35;
}
function shouldUseNeighbor(measureNumber, t, salt) {
    if (salt === void 0) { salt = 0; }
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 812263) ^ (tKey * 9176) ^ (salt * 97) ^ 0x7f4a7c15;
    h = (h >>> 0) % 1000;
    return h / 1000 < 0.25;
}
function passDir(measureNumber, t, salt) {
    if (salt === void 0) { salt = 0; }
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 92821) ^ (tKey * 193) ^ (salt * 73);
    h = (h >>> 0) % 1000;
    return h % 2 === 0 ? 1 : -1;
}
function passingMidi(midi, dir, scalePcs, chordPcs) {
    var target = midi + dir;
    var pc = ((target % 12) + 12) % 12;
    if (scalePcs.includes(pc) && !chordPcs.includes(pc))
        return target;
    return null;
}
function neighborMidi(midi, dir, scalePcs, chordPcs) {
    var target = midi + dir;
    var pc = ((target % 12) + 12) % 12;
    if (scalePcs.includes(pc) && !chordPcs.includes(pc))
        return target;
    return null;
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
function chordThirdPc(chord) {
    var _a, _b;
    var pcs = (_a = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _a !== void 0 ? _a : [];
    if (!pcs.length)
        return null;
    var root = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : pcs[0];
    var majThird = (root + 4) % 12;
    var minThird = (root + 3) % 12;
    if (pcs.includes(majThird))
        return majThird;
    if (pcs.includes(minThird))
        return minThird;
    var fifth = (root + 7) % 12;
    return (_b = pcs.find(function (pc) { return pc !== root && pc !== fifth; })) !== null && _b !== void 0 ? _b : pcs[0];
}
function chordFifthPc(chord) {
    var _a, _b;
    var pcs = (_a = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _a !== void 0 ? _a : [];
    if (!pcs.length)
        return null;
    var root = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : pcs[0];
    var fifth = (root + 7) % 12;
    if (pcs.includes(fifth))
        return fifth;
    return (_b = pcs.find(function (pc) { return pc !== root; })) !== null && _b !== void 0 ? _b : pcs[0];
}
function applyViolin2BeginnerHighActive(part, options) {
    var _a, _b;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    for (var _i = 0, measures_3 = measures; _i < measures_3.length; _i++) {
        var m = measures_3[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var t = 0;
        var prevMidi = 67;
        while (t < mLen - 1e-6) {
            var chord = chordAt(chordEvents, mNum, t);
            var thirdPc = chordThirdPc(chord);
            var pcs = thirdPc !== null ? [thirdPc] : (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
            var midi = prevMidi;
            if (pcs.length) {
                midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
            }
            else {
                midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
            }
            next.push({
                id: "vln2-hi-".concat(mNum, "-").concat(t),
                t: t,
                dur: Math.min(0.5, mLen - t),
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
            t += 0.5;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolin2IntermediateActivePattern(vln2, options) {
    var _a, _b;
    var measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 88;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = minMidi + 7;
    for (var _i = 0, measures_4 = measures; _i < measures_4.length; _i++) {
        var m = measures_4[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 2) {
            // Pattern: 8th rest, 8th, 8th, 8th (over two beats)
            next.push({ id: "vln2-int60-rest-".concat(mNum, "-").concat(t), t: t, dur: 0.5, type: "rest", voice: 1, staff: 1 });
            var slots = [t + 0.5, t + 1.0, t + 1.5];
            for (var _c = 0, slots_1 = slots; _c < slots_1.length; _c++) {
                var s = slots_1[_c];
                if (s >= mLen - 1e-6)
                    continue;
                var chord = chordAt(chordEvents, mNum, s);
                var thirdPc = chordThirdPc(chord);
                var pcs = thirdPc !== null ? [thirdPc] : (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vln2-int60-".concat(mNum, "-").concat(s),
                    t: s,
                    dur: 0.5,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolin2IntermediateHighActivePattern(vln2, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    var measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 88;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = minMidi + 9;
    var baseOrder = ["dot8_16", "four16", "dotq_8"];
    for (var _i = 0, measures_5 = measures; _i < measures_5.length; _i++) {
        var m = measures_5[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var t = 0;
        var preferDir = passDir(mNum, 0, 101) > 0 ? "up" : "down";
        var order = __spreadArray([], baseOrder, true);
        // True random per-measure shuffle for rhythm-cell ordering.
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = order[i];
            order[i] = order[j];
            order[j] = tmp;
        }
        var cellIdx = 0;
        while (t < mLen - 1e-6) {
            var cell = order[cellIdx % order.length];
            if (cell === "dot8_16") {
                // Cell: dotted 8th + 16th (1 beat)
                var chord = chordAt(chordEvents, mNum, t);
                var pcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vln2-int100-dot8-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(0.75, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                var t2 = t + 0.75;
                if (t2 < mLen - 1e-6) {
                    var chord2 = chordAt(chordEvents, mNum, t2);
                    var pcs2 = (_d = (_c = chord2 === null || chord2 === void 0 ? void 0 : chord2.pcs) !== null && _c !== void 0 ? _c : pcs) !== null && _d !== void 0 ? _d : [];
                    var midi2 = prevMidi;
                    if (pcs2.length) {
                        midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi);
                        if (preferDir === "up" && midi2 <= prevMidi && midi2 + 12 <= maxMidi)
                            midi2 += 12;
                        if (preferDir === "down" && midi2 >= prevMidi && midi2 - 12 >= minMidi)
                            midi2 -= 12;
                    }
                    else {
                        midi2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi + 1, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vln2-int100-16-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: Math.min(0.25, mLen - t2),
                        type: "note",
                        midi: midi2,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi2),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi2;
                }
                t += 1;
            }
            else if (cell === "four16") {
                // Cell: four 16ths, preferred directional motion (1 beat)
                var slots = [t, t + 0.25, t + 0.5, t + 0.75];
                for (var _j = 0, slots_2 = slots; _j < slots_2.length; _j++) {
                    var s = slots_2[_j];
                    if (s >= mLen - 1e-6)
                        continue;
                    var chord = chordAt(chordEvents, mNum, s);
                    var pcs = (_e = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _e !== void 0 ? _e : [];
                    var midi = prevMidi;
                    if (pcs.length) {
                        midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, prevMidi);
                        if (preferDir === "up" && midi <= prevMidi && midi + 12 <= maxMidi)
                            midi += 12;
                        if (preferDir === "down" && midi >= prevMidi && midi - 12 >= minMidi)
                            midi -= 12;
                    }
                    else {
                        midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi + 1, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vln2-int100-16a-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.25, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                }
                t += 1;
            }
            else {
                // Cell: dotted quarter + 8th (2 beats)
                var chord = chordAt(chordEvents, mNum, t);
                var pcs = (_f = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _f !== void 0 ? _f : [];
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vln2-int100-dotq-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(1.5, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                var t2 = t + 1.5;
                if (t2 < mLen - 1e-6) {
                    var chord2 = chordAt(chordEvents, mNum, t2);
                    var pcs2 = (_h = (_g = chord2 === null || chord2 === void 0 ? void 0 : chord2.pcs) !== null && _g !== void 0 ? _g : pcs) !== null && _h !== void 0 ? _h : [];
                    var midi2 = prevMidi;
                    if (pcs2.length) {
                        var excludePc = ((prevMidi % 12) + 12) % 12;
                        midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi, excludePc);
                    }
                    else {
                        midi2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vln2-int100-8-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: Math.min(0.5, mLen - t2),
                        type: "note",
                        midi: midi2,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi2),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi2;
                }
                t += 2;
            }
            if (t >= mLen - 1e-6)
                break;
            cellIdx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolaIntermediateActivePattern(vla, options) {
    var _a, _b;
    var measures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 81;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = minMidi + 12;
    for (var _i = 0, measures_6 = measures; _i < measures_6.length; _i++) {
        var m = measures_6[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 2) {
            next.push({ id: "vla-int60-rest-".concat(mNum, "-").concat(t), t: t, dur: 0.5, type: "rest", voice: 1, staff: 1 });
            var slots = [t + 0.5, t + 1.0, t + 1.5];
            for (var _c = 0, slots_3 = slots; _c < slots_3.length; _c++) {
                var s = slots_3[_c];
                if (s >= mLen - 1e-6)
                    continue;
                var chord = chordAt(chordEvents, mNum, s);
                var fifthPc = chordFifthPc(chord);
                var pcs = fifthPc !== null ? [fifthPc] : (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vla-int60-".concat(mNum, "-").concat(s),
                    t: s,
                    dur: 0.5,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyStringPolyphonicRhythm(scoreModel, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0;
    if (options === void 0) { options = {}; }
    var warnings = (_a = options.warnings) !== null && _a !== void 0 ? _a : [];
    var parts = Array.isArray(scoreModel === null || scoreModel === void 0 ? void 0 : scoreModel.parts) ? scoreModel.parts : [];
    var vln1 = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("violin i"); });
    var vln2 = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("violin ii"); });
    var vla = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("viola"); });
    var vc = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("cello"); });
    var cb = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("double bass"); });
    var level = String((_b = options.level) !== null && _b !== void 0 ? _b : "").toLowerCase();
    if (vln1 && !options.preserveVln1Melody) {
        applyToPart(vln1, (_c = options.vln1Activity) !== null && _c !== void 0 ? _c : "grounded", warnings, 7, __assign(__assign({}, options), { syncopate: false, allowNonChordTones: false }));
    }
    if (vln2) {
        var vln2Range = level === "beginner"
            ? { minMidi: 55, maxMidi: 83 }
            : level === "intermediate"
                ? { minMidi: 55, maxMidi: 88 }
                : {};
        if (level === "beginner" && options.vln2Activity === "high_active") {
            // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
            applyViolin2BeginnerHighActive(vln2, __assign(__assign({}, options), vln2Range));
            warn(warnings, "[strings] Beginner Violin II: 8th+16th on chord 3rd (activity=high_active).");
        }
        else if (level === "beginner" && options.vln2Activity === "active") {
            // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
            if (vln1) {
                applyViolin2BeginnerContraryToMelody(vln1, vln2, __assign(__assign({}, options), vln2Range));
                warn(warnings, "[strings] Beginner Violin II: melody rhythm, contrary motion, 3rd/5th.");
            }
            else {
                applyViolin2BeginnerActive(vln2, __assign(__assign({}, options), vln2Range));
                warn(warnings, "[strings] Beginner Violin II: 8th notes on 3rd/5th chord tones.");
            }
        }
        else if (level === "intermediate" && options.vln2Activity === "high_active") {
            applyViolin2IntermediateHighActivePattern(vln2, __assign(__assign({}, options), vln2Range));
            warn(warnings, "[strings] Intermediate Violin II: dotted 8th+16th, four 16ths ascending, dotted quarter+8th.");
        }
        else if (level === "intermediate" && options.vln2Activity === "active") {
            // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
            applyViolin2IntermediateActivePattern(vln2, __assign(__assign({}, options), vln2Range));
            warn(warnings, "[strings] Intermediate Violin II: 8th-rest+8th+8th+8th on chord 3rd.");
        }
        else if (level === "intermediate" && options.vln2Activity === "less_active" && vc) {
            // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
            applyViolin2IntermediateLessActiveContrary(vln2, vc, __assign(__assign({}, options), vln2Range));
            warn(warnings, "[strings] Intermediate Violin II: 40% 8ths, 50% quarters, 10% halves on 3rd/5th, contrary to cello.");
        }
        else if (level === "advanced" && options.vln2Activity === "high_active") {
            // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
            applyViolin2AdvancedHighActive(vln2, cb, __assign(__assign({}, options), { minMidi: 55, maxMidi: 96 }));
            warn(warnings, "[strings] Advanced Violin II (100%): shuffled 4x16/2x8/dotted-quarter+8th, contrary to double bass.");
        }
        else if (level === "advanced" && options.vln2Activity === "active") {
            // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
            applyViolin2AdvancedActive(vln2, vc, __assign(__assign({}, options), { minMidi: 55, maxMidi: 96 }));
            warn(warnings, "[strings] Advanced Violin II (60%): shuffled cells, contrary to cello, harmonic-color tones.");
        }
        else if (level === "advanced" && options.vln2Activity === "less_active") {
            // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
            applyViolin2AdvancedLessActive(vln2, __assign(__assign({}, options), { minMidi: 55, maxMidi: 96 }));
            warn(warnings, "[strings] Advanced Violin II (40%): 8ths on chord 3rd/5th.");
        }
        else {
            applyToPart(vln2, (_d = options.vln2Activity) !== null && _d !== void 0 ? _d : "active", warnings, 11, __assign(__assign({}, options), vln2Range));
        }
    }
    var beginnerContrary = level === "beginner" && options.vlaActivity === "less_active" && options.vcActivity === "less_active";
    if (beginnerContrary && vla && vc) {
        // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
        applyBeginnerContraryMotion(vla, vc, options);
        warn(warnings, "[strings] Beginner contrary motion applied (viola+cello, quarter/half only).");
    }
    else {
        if (vla) {
            var vlaMinSubdivision = options.vlaActivity === "high_active"
                ? level === "beginner"
                    ? 1
                    : level === "intermediate"
                        ? 0.5
                        : undefined
                : undefined;
            var vlaRange = level === "beginner"
                ? { minMidi: 48, maxMidi: 76 }
                : level === "intermediate"
                    ? { minMidi: 48, maxMidi: 81 }
                    : {};
            if (level === "intermediate" && options.vlaActivity === "high_active") {
                applyViolaIntermediateHighActivePattern(vla, __assign(__assign({}, options), vlaRange));
                warn(warnings, "[strings] Intermediate viola (100%): shuffled cells from Violin II + Cello vocabulary.");
            }
            else if (level === "advanced" && options.vlaActivity === "high_active") {
                // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
                applyViolaAdvancedHighActiveTriplets(vla, __assign(__assign({}, options), { minMidi: 48, maxMidi: 84 }));
                warn(warnings, "[strings] Advanced Viola (100%): triplet rhythm on chord 3rd applied.");
            }
            else if (level === "intermediate" && options.vlaActivity === "active") {
                // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
                applyViolaIntermediateActivePattern(vla, __assign(__assign({}, options), vlaRange));
                warn(warnings, "[strings] Intermediate Viola: 8th-rest+8th+8th+8th on chord 5th.");
            }
            else if (level === "intermediate" && options.vlaActivity === "less_active" && vc) {
                // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
                applyViolaIntermediateAgainstCello(vla, vc, __assign(__assign({}, options), vlaRange));
                warn(warnings, "[strings] Intermediate viola: Alberti 8ths vs cello quarters, arpeggio vs cello halves.");
            }
            else if (level === "advanced" && options.vlaActivity === "active") {
                // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
                applyViolaAdvancedActive(vla, { vln1: vln1, vln2: vln2, vc: vc, cb: cb }, __assign(__assign({}, options), { minMidi: 48, maxMidi: 84 }));
                warn(warnings, "[strings] Advanced Viola (60%): 8ths, gap-fill on weak harmony, root when complete.");
            }
            else if (level === "advanced" && options.vlaActivity === "less_active" && vln2) {
                // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
                applyViolaAdvancedLessActive(vla, vln2, __assign(__assign({}, options), { minMidi: 48, maxMidi: 84 }));
                warn(warnings, "[strings] Advanced Viola (40%): 8ths on chord 1st/5th to complete harmony.");
            }
            else {
                applyToPart(vla, (_e = options.vlaActivity) !== null && _e !== void 0 ? _e : "active", warnings, 23, __assign(__assign(__assign({}, options), { minSubdivision: vlaMinSubdivision }), vlaRange));
            }
            if (options.vlaActivity === "high_active") {
                if (level !== "intermediate" && level !== "advanced") {
                    applyViolaArpeggio(vla, __assign(__assign({}, options), vlaRange));
                    warn(warnings, "[strings] Viola arpeggio applied (activity=high_active).");
                }
            }
            if (level === "beginner" && options.vlaActivity === "active") {
                // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
                applyViolaBeginnerActive(vla, options);
                warn(warnings, "[strings] Beginner viola: 60% Alberti (8ths), 40% quarter arpeggio.");
            }
        }
        if (vc) {
            var vcRange = level === "beginner"
                ? { minMidi: 36, maxMidi: 64 }
                : level === "intermediate"
                    ? { minMidi: 36, maxMidi: 69 }
                    : {};
            if (level === "intermediate" && options.vcActivity === "high_active") {
                applyCelloIntermediateHighActivePattern(vc, __assign(__assign({}, options), vcRange));
                warn(warnings, "[strings] Intermediate cello (100%): quarter, two 8ths, Alberti 16ths, dotted 8th+16th.");
            }
            else if (level === "advanced" && options.vcActivity === "high_active") {
                // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
                applyCelloAdvancedHighActiveSyncopes(vc, __assign(__assign({}, options), { minMidi: 36, maxMidi: 76 }));
                warn(warnings, "[strings] Advanced cello (100%): syncopation on chord 1st/3rd/5th.");
            }
            else if (level === "intermediate" && options.vcActivity === "active") {
                // LOCKED: String/Intermediate/Polyphonic (60% active). Do not change without explicit approval.
                applyCelloIntermediateActive(vc, __assign(__assign({}, options), vcRange));
                warn(warnings, "[strings] Intermediate cello: 40% Alberti 8ths, 20% quarters, 30% syncopation, 10% neighbor tones.");
            }
            else if (level === "intermediate" && options.vcActivity === "less_active") {
                // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
                applyCelloIntermediateLessActive(vc, __assign(__assign({}, options), vcRange));
                warn(warnings, "[strings] Intermediate cello: 40% half notes on 3rd, 60% quarter arpeggios.");
            }
            else if (level === "advanced" && options.vcActivity === "active") {
                // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
                applyCelloAdvancedActivePattern(vc, __assign(__assign({}, options), { minMidi: 36, maxMidi: 76 }));
                warn(warnings, "[strings] Advanced cello (60%): dotted 8th+16th arpeggio cell applied.");
            }
            else if (level === "advanced" && options.vcActivity === "less_active") {
                // LOCKED: String/Advanced/Polyphonic (40% active). Do not change without explicit approval.
                applyCelloAlberti(vc, __assign(__assign({}, options), { minMidi: 36, maxMidi: 76 }));
                warn(warnings, "[strings] Advanced cello (40%): Alberti bass applied.");
            }
            else if (level === "beginner" && options.vcActivity === "active" && vln1) {
                // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
                applyCelloMelodyRhythmContrary(vln1, vc, __assign(__assign({}, options), vcRange));
                warn(warnings, "[strings] Beginner cello follows melody rhythm with contrary motion.");
            }
            else {
                applyToPart(vc, (_f = options.vcActivity) !== null && _f !== void 0 ? _f : "less_active", warnings, 37, __assign(__assign({}, options), vcRange));
                if (level === "beginner" && options.vcActivity === "high_active") {
                    // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
                    applyCelloAlberti(vc, __assign(__assign({}, options), vcRange));
                    warn(warnings, "[strings] Cello Alberti applied (beginner, activity=high_active).");
                }
            }
        }
    }
    if (cb) {
        if (level === "intermediate" && options.cbActivity === "high_active") {
            applyDoubleBassIntermediateHighActive(cb, options);
            warn(warnings, "[strings] Intermediate Double Bass (100%): 8th notes on chord bass.");
        }
        else if (level === "advanced" && options.cbActivity === "high_active") {
            // LOCKED: String/Advanced/Polyphonic (100% active). Do not change without explicit approval.
            applyDoubleBassAdvancedHighActive(cb, options);
            warn(warnings, "[strings] Advanced Double Bass (100%): 8th+16th+16th rhythm cell.");
        }
        else if (level === "advanced" && options.cbActivity === "active") {
            // LOCKED: String/Advanced/Polyphonic (60% active). Do not change without explicit approval.
            applyDoubleBassIntermediateHighActive(cb, options);
            warn(warnings, "[strings] Advanced Double Bass (60%): 8th notes on chord bass.");
        }
        else {
            applyToPart(cb, (_g = options.cbActivity) !== null && _g !== void 0 ? _g : "less_active", warnings, 51, options);
        }
    }
    if (String((_h = options.level) !== null && _h !== void 0 ? _h : "").toLowerCase() === "intermediate" && options.cbActivity === "less_active") {
        // LOCKED: String/Intermediate/Polyphonic (40% active). Do not change without explicit approval.
    }
    var beginnerCbSync = level === "beginner" &&
        options.vcActivity === "less_active" &&
        options.cbActivity === "less_active" &&
        cb &&
        vc;
    if (beginnerCbSync) {
        // LOCKED: String/Beginner/Polyphony rules. Do not change without explicit approval.
        var prevCbMidi_1 = 40;
        var cbMin_1 = 28;
        var cbMax_1 = 60;
        var _loop_1 = function (m) {
            var cbMeasure = ((_k = cb.measures) !== null && _k !== void 0 ? _k : []).find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === Number(m === null || m === void 0 ? void 0 : m.number); });
            if (!cbMeasure)
                return "continue";
            cbMeasure.events = ((_l = m.events) !== null && _l !== void 0 ? _l : []).map(function (ev) {
                var _a, _b, _c;
                if (ev.type !== "note")
                    return __assign({}, ev);
                var chord = chordAt((_a = options.chordEvents) !== null && _a !== void 0 ? _a : [], Number(m === null || m === void 0 ? void 0 : m.number) || 1, ev.t);
                var bassPc = typeof (chord === null || chord === void 0 ? void 0 : chord.bassPc) === "number" ? chord.bassPc : (_b = chord === null || chord === void 0 ? void 0 : chord.rootPc) !== null && _b !== void 0 ? _b : (_c = chord === null || chord === void 0 ? void 0 : chord.pcs) === null || _c === void 0 ? void 0 : _c[0];
                if (typeof bassPc !== "number") {
                    var midi_2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevCbMidi_1, cbMin_1, cbMax_1);
                    return __assign(__assign({}, ev), { midi: midi_2, pitch: (0, instrumentCatalog_1.midiToPitch)(midi_2), voice: 1, staff: 1 });
                }
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevCbMidi_1, bassPc), cbMin_1, cbMax_1);
                prevCbMidi_1 = midi;
                return __assign(__assign({}, ev), { midi: midi, pitch: (0, instrumentCatalog_1.midiToPitch)(midi), voice: 1, staff: 1 });
            });
        };
        for (var _i = 0, _1 = (_j = vc.measures) !== null && _j !== void 0 ? _j : []; _i < _1.length; _i++) {
            var m = _1[_i];
            _loop_1(m);
        }
        warn(warnings, "[strings] Beginner: Double Bass rhythm synced to Cello; pitches follow chord bass.");
    }
    if (vln1 && (vln2 || vla || vc || cb)) {
        var levelRaw_1 = String((_m = options.level) !== null && _m !== void 0 ? _m : "").toLowerCase();
        var vcRange = { min: 36, max: levelRaw_1 === "beginner" ? 64 : 76 };
        alignEndingRhythmToMelody(vln1, [
            vln2 ? { part: vln2, range: { min: 55, max: 96 } } : null,
            vla ? { part: vla, range: { min: 48, max: levelRaw_1 === "beginner" ? 76 : 84 } } : null,
            vc ? { part: vc, range: vcRange } : null,
            cb ? { part: cb, range: { min: 28, max: 60 } } : null
        ].filter(Boolean), (_o = options.chordEvents) !== null && _o !== void 0 ? _o : []);
        warn(warnings, "[strings] Final measure rhythm aligned to melody for Vln II/Vla/Vc/Cb.");
    }
    if (cb && options.enforceChordRootBass) {
        enforceBassToChordRoot(cb, (_p = options.chordEvents) !== null && _p !== void 0 ? _p : [], { strongBeatsOnly: false });
        warn(warnings, "[strings] Double Bass locked to chord roots on all beats.");
    }
    if (cb && vc) {
        enforceNoBassCelloOverlap(cb, vc, (_q = options.chordEvents) !== null && _q !== void 0 ? _q : [], options.level);
        warn(warnings, "[strings] Cello adjusted to avoid overlap with Double Bass.");
    }
    if (vla && vc && String((_r = options.level) !== null && _r !== void 0 ? _r : "").toLowerCase() === "intermediate") {
        enforceNoViolaCelloOverlap(vla, vc, (_s = options.chordEvents) !== null && _s !== void 0 ? _s : [], options.level);
        warn(warnings, "[strings] Intermediate: Viola adjusted to avoid overlap with Cello.");
    }
    if (vln1 && vln2 && String((_t = options.level) !== null && _t !== void 0 ? _t : "").toLowerCase() === "beginner") {
        enforceNoVln1Vln2Unison(vln1, vln2, (_u = options.chordEvents) !== null && _u !== void 0 ? _u : [], options.level);
        warn(warnings, "[strings] Beginner: Violin II adjusted to avoid unison with Violin I.");
    }
    var levelRaw = String((_v = options.level) !== null && _v !== void 0 ? _v : "").toLowerCase();
    if (levelRaw === "advanced" &&
        (options.vln2Activity === "less_active" || options.vln2Activity === "active" || options.vln2Activity === "high_active") &&
        vln2) {
        // LOCKED/ENFORCED: String/Advanced/Polyphonic Violin II harmony gap fill (40%, 60%, 100% active).
        enforceViolin2ChordToneGapFill(vln2, { vln1: vln1, vla: vla, vc: vc, cb: cb }, (_w = options.chordEvents) !== null && _w !== void 0 ? _w : [], { min: 55, max: 96 });
        warn(warnings, "[strings] Advanced Violin II: gap-fill on missing chord 3rd/5th.");
    }
    var v2Max = levelRaw === "beginner" ? 83 : levelRaw === "intermediate" ? 88 : 96;
    var vlaMax = levelRaw === "beginner" ? 76 : levelRaw === "intermediate" ? 81 : 84;
    var vcMaxStrict = levelRaw === "beginner" ? 64 : levelRaw === "intermediate" ? 69 : 76;
    if (vln1 && vln2) {
        enforceNoCrossingPair(vln1, vln2, (_x = options.chordEvents) !== null && _x !== void 0 ? _x : [], { min: 55, max: v2Max });
        warn(warnings, "[strings] Enforced no crossing (Violin I above Violin II).");
    }
    if (vln2 && vla) {
        enforceNoCrossingPair(vln2, vla, (_y = options.chordEvents) !== null && _y !== void 0 ? _y : [], { min: 48, max: vlaMax });
        warn(warnings, "[strings] Enforced no crossing (Violin II above Viola).");
    }
    if (vla && vc) {
        enforceNoCrossingPair(vla, vc, (_z = options.chordEvents) !== null && _z !== void 0 ? _z : [], { min: 36, max: vcMaxStrict });
        warn(warnings, "[strings] Enforced no crossing (Viola above Cello).");
    }
    if (vc && cb) {
        enforceNoCrossingPair(vc, cb, (_0 = options.chordEvents) !== null && _0 !== void 0 ? _0 : [], { min: 28, max: 60 });
        warn(warnings, "[strings] Enforced no crossing (Cello above Double Bass).");
    }
    return { scoreModel: scoreModel, warnings: warnings };
}
function applyViolaArpeggio(part, options) {
    var _a, _b, _c, _d, _e, _f;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var level = String((_b = options.level) !== null && _b !== void 0 ? _b : "").toLowerCase();
    var restrictToEighths = level === "intermediate";
    var restrictToQuarters = level === "beginner";
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : null;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : null;
    var clampRange = function (m) {
        if (minMidi === null || maxMidi === null)
            return m;
        return (0, instrumentCatalog_1.shiftOctavesIntoRange)(m, minMidi, maxMidi);
    };
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    for (var _i = 0, measures_7 = measures; _i < measures_7.length; _i++) {
        var m = measures_7[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var events = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
        var next = [];
        var arpIndex = 0;
        var descending = mNum % 2 === 0;
        if (restrictToQuarters) {
            var mLen = measureLen(m);
            var baseMidi = ((_d = (_c = events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && typeof e.midi === "number"; })) === null || _c === void 0 ? void 0 : _c.midi) !== null && _d !== void 0 ? _d : events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && (e === null || e === void 0 ? void 0 : e.pitch); }))
                ? (0, instrumentCatalog_1.pitchToMidi)(events.find(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note" && (e === null || e === void 0 ? void 0 : e.pitch); }).pitch)
                : 60;
            for (var t = 0; t < mLen - 1e-6; t += 1) {
                var chord = chordAt(chordEvents, mNum, t);
                var chordPcs = (_e = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _e !== void 0 ? _e : [];
                if (!chordPcs.length || typeof baseMidi !== "number")
                    continue;
                var idx = arpIndex % chordPcs.length;
                var pc = descending ? chordPcs[chordPcs.length - 1 - idx] : chordPcs[idx];
                var midi = clampRange(snapToPcNear(baseMidi, pc));
                next.push({
                    id: "vla-arp-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 1,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                baseMidi = midi;
                arpIndex += 1;
            }
            m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
            continue;
        }
        for (var _g = 0, events_3 = events; _g < events_3.length; _g++) {
            var ev = events_3[_g];
            if (!ev || ev.type !== "note" || typeof ev.t !== "number" || typeof ev.dur !== "number") {
                next.push(ev);
                continue;
            }
            var chord = chordAt(chordEvents, mNum, ev.t);
            var chordPcs = (_f = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _f !== void 0 ? _f : [];
            if (!chordPcs.length || typeof ev.midi !== "number") {
                next.push(ev);
                continue;
            }
            var unitFloor = restrictToQuarters ? 1 : restrictToEighths ? 0.5 : 0;
            if (unitFloor > 0 && ev.dur < unitFloor) {
                next.push(ev);
                continue;
            }
            var unit = restrictToQuarters ? 1 : restrictToEighths ? 0.5 : ev.dur >= 0.5 ? 0.5 : ev.dur;
            var steps = Math.max(1, Math.round(ev.dur / unit));
            var cursor = ev.t;
            for (var i = 0; i < steps; i++) {
                var idx = (arpIndex + i) % chordPcs.length;
                var pc = descending ? chordPcs[chordPcs.length - 1 - idx] : chordPcs[idx];
                var midi = clampRange(snapToPcNear(ev.midi, pc));
                next.push(__assign(__assign({}, ev), { t: cursor, dur: unit, midi: midi, pitch: (0, instrumentCatalog_1.midiToPitch)(midi) }));
                cursor += unit;
            }
            arpIndex += steps;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolaBeginnerActive(part, options) {
    var _a;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 48;
    var maxMidi = 76;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    for (var _i = 0, measures_8 = measures; _i < measures_8.length; _i++) {
        var m = measures_8[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var useAlberti = shouldChooseMeasure(mNum, 0.6, 77);
        var next = [];
        var mLen = measureLen(m);
        var prevMidi = 60;
        if (useAlberti) {
            for (var t = 0; t < mLen - 1e-6; t += 0.5) {
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    continue;
                var idx = Math.round(t * 2) % seq.length;
                var pc = seq[idx];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vla-beginner-alberti-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 0.5,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        else {
            for (var t = 0; t < mLen - 1e-6; t += 1) {
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    continue;
                var idx = Math.round(t) % seq.length;
                var pc = seq[idx];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vla-beginner-arp-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 1,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
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
    else {
        var alt = pcs.find(function (pc) { return pc !== root; });
        if (typeof alt === "number")
            out.push(alt);
    }
    return out.length ? out : pcs.slice(0, 2);
}
function applyViolin2AdvancedLessActive(vln2, options) {
    var _a;
    var measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 67;
    for (var _i = 0, measures_9 = measures; _i < measures_9.length; _i++) {
        var m = measures_9[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = pickThirdAndFifth(chord);
            if (!pcs.length)
                continue;
            var idx = Math.round(t * 2) % pcs.length;
            var pc = pcs[idx];
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
            next.push({
                id: "vln2-adv40-".concat(mNum, "-").concat(t),
                t: t,
                dur: 0.5,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolin2AdvancedActive(vln2, vc, options) {
    var _a, _b, _c;
    var measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var vcMeasures = Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var baseOrder = ["dot8_16", "e_16_16", "e_e", "q"];
    var prevV2 = 67;
    var prevVc = null;
    var _loop_2 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var vcMeasure = vcMeasures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        var next = [];
        var mLen = measureLen(m);
        var order = __spreadArray([], baseOrder, true);
        // True random per-measure shuffle for rhythm-cell ordering.
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = order[i];
            order[i] = order[j];
            order[j] = tmp;
        }
        var cellIdx = 0;
        for (var beat = 0; beat < mLen - 1e-6; beat += 1) {
            var cell = order[cellIdx % order.length];
            var slots = cell === "dot8_16"
                ? [
                    { t: beat, dur: 0.75 },
                    { t: beat + 0.75, dur: 0.25 }
                ]
                : cell === "e_16_16"
                    ? [
                        { t: beat, dur: 0.5 },
                        { t: beat + 0.5, dur: 0.25 },
                        { t: beat + 0.75, dur: 0.25 }
                    ]
                    : cell === "e_e"
                        ? [
                            { t: beat, dur: 0.5 },
                            { t: beat + 0.5, dur: 0.5 }
                        ]
                        : [{ t: beat, dur: 1 }];
            for (var _d = 0, slots_4 = slots; _d < slots_4.length; _d++) {
                var slot = slots_4[_d];
                if (slot.t >= mLen - 1e-6)
                    continue;
                var chord = chordAt(chordEvents, mNum, slot.t);
                var colorPcs = pickThirdAndFifth(chord);
                var chordPcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                var pcs = colorPcs.length ? colorPcs : chordPcs;
                if (!pcs.length)
                    continue;
                var vcNow = activeMidiAt((_c = vcMeasure === null || vcMeasure === void 0 ? void 0 : vcMeasure.events) !== null && _c !== void 0 ? _c : [], slot.t);
                var preferDir = "either";
                if (typeof vcNow === "number" && typeof prevVc === "number") {
                    if (vcNow > prevVc)
                        preferDir = "down";
                    else if (vcNow < prevVc)
                        preferDir = "up";
                }
                var midi = pickCandidateNear(prevV2, pcs, minMidi, maxMidi, preferDir, vcNow !== null && vcNow !== void 0 ? vcNow : undefined);
                if (typeof vcNow === "number" && midi <= vcNow) {
                    while (midi <= vcNow && midi + 12 <= maxMidi)
                        midi += 12;
                }
                next.push({
                    id: "vln2-adv60-".concat(mNum, "-").concat(slot.t),
                    t: slot.t,
                    dur: Math.min(slot.dur, mLen - slot.t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevV2 = midi;
                if (typeof vcNow === "number")
                    prevVc = vcNow;
            }
            cellIdx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, measures_10 = measures; _i < measures_10.length; _i++) {
        var m = measures_10[_i];
        _loop_2(m);
    }
}
function applyViolin2AdvancedHighActive(vln2, cb, options) {
    var _a, _b, _c;
    var measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var cbMeasures = Array.isArray(cb === null || cb === void 0 ? void 0 : cb.measures) ? cb.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 96;
    var baseOrder = ["four16", "two8", "dotq8"];
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevV2 = 67;
    var prevCb = null;
    var _loop_3 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var cbMeasure = cbMeasures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        var next = [];
        var mLen = measureLen(m);
        var order = __spreadArray([], baseOrder, true);
        // True random per-measure shuffle for rhythm-cell ordering.
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = order[i];
            order[i] = order[j];
            order[j] = tmp;
        }
        var t = 0;
        var cellIdx = 0;
        while (t < mLen - 1e-6) {
            var cell = order[cellIdx % order.length];
            var slots = cell === "four16"
                ? [
                    { t: t, dur: 0.25 },
                    { t: t + 0.25, dur: 0.25 },
                    { t: t + 0.5, dur: 0.25 },
                    { t: t + 0.75, dur: 0.25 }
                ]
                : cell === "two8"
                    ? [
                        { t: t, dur: 0.5 },
                        { t: t + 0.5, dur: 0.5 }
                    ]
                    : [
                        { t: t, dur: 1.5 },
                        { t: t + 1.5, dur: 0.5 }
                    ];
            for (var _d = 0, slots_5 = slots; _d < slots_5.length; _d++) {
                var slot = slots_5[_d];
                if (slot.t >= mLen - 1e-6)
                    continue;
                var chord = chordAt(chordEvents, mNum, slot.t);
                var color = pickThirdAndFifth(chord);
                var pcs = color.length ? color : (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                if (!pcs.length)
                    continue;
                var cbNow = activeMidiAt((_c = cbMeasure === null || cbMeasure === void 0 ? void 0 : cbMeasure.events) !== null && _c !== void 0 ? _c : [], slot.t);
                var preferDir = "either";
                if (typeof cbNow === "number" && typeof prevCb === "number") {
                    if (cbNow > prevCb)
                        preferDir = "down";
                    else if (cbNow < prevCb)
                        preferDir = "up";
                }
                else {
                    preferDir = passDir(mNum, slot.t, 407) > 0 ? "up" : "down";
                }
                var midi = pickCandidateNear(prevV2, pcs, minMidi, maxMidi, preferDir, cbNow !== null && cbNow !== void 0 ? cbNow : undefined);
                if (typeof cbNow === "number" && midi <= cbNow) {
                    while (midi <= cbNow && midi + 12 <= maxMidi)
                        midi += 12;
                }
                next.push({
                    id: "vln2-adv100-".concat(mNum, "-").concat(slot.t),
                    t: slot.t,
                    dur: Math.min(slot.dur, mLen - slot.t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevV2 = midi;
                if (typeof cbNow === "number")
                    prevCb = cbNow;
            }
            t += cell === "dotq8" ? 2 : 1;
            cellIdx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, measures_11 = measures; _i < measures_11.length; _i++) {
        var m = measures_11[_i];
        _loop_3(m);
    }
}
function applyViolaAdvancedLessActive(vla, vln2, options) {
    var _a, _b, _c;
    var vlaMeasures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var v2Measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 60;
    var _loop_4 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var v2Measure = v2Measures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        var v2ByT = new Map();
        for (var _d = 0, _e = (_b = v2Measure === null || v2Measure === void 0 ? void 0 : v2Measure.events) !== null && _b !== void 0 ? _b : []; _d < _e.length; _d++) {
            var ev = _e[_d];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var t = Number((_c = ev.t) !== null && _c !== void 0 ? _c : 0);
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null)
                continue;
            v2ByT.set(Math.round(t * 1000), midi);
        }
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var rf = pickRootAndFifth(chord);
            if (!rf.length)
                continue;
            var rootPc = rf[0];
            var fifthPc = rf.length > 1 ? rf[1] : rootPc;
            var v2Midi = v2ByT.get(Math.round(t * 1000));
            var v2Pc = typeof v2Midi === "number" ? ((v2Midi % 12) + 12) % 12 : null;
            var targetPc = v2Pc === fifthPc ? rootPc : v2Pc === rootPc ? fifthPc : Math.round(t * 2) % 2 === 0 ? rootPc : fifthPc;
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
            if (typeof v2Midi === "number" && midi >= v2Midi) {
                while (midi >= v2Midi && midi - 12 >= minMidi)
                    midi -= 12;
            }
            next.push({
                id: "vla-adv40-".concat(mNum, "-").concat(t),
                t: t,
                dur: 0.5,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, vlaMeasures_2 = vlaMeasures; _i < vlaMeasures_2.length; _i++) {
        var m = vlaMeasures_2[_i];
        _loop_4(m);
    }
}
function applyViolin2BeginnerActive(part, options) {
    var _a;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    for (var _i = 0, measures_12 = measures; _i < measures_12.length; _i++) {
        var m = measures_12[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var prevMidi = 69;
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = pickThirdAndFifth(chord);
            if (!pcs.length)
                continue;
            var idx = Math.round(t * 2) % pcs.length;
            var pc = pcs[idx];
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
            next.push({
                id: "vln2-beginner-".concat(mNum, "-").concat(t),
                t: t,
                dur: 0.5,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolin2BeginnerContraryToMelody(vln1, vln2, options) {
    var _a, _b;
    var v1Measures = Array.isArray(vln1 === null || vln1 === void 0 ? void 0 : vln1.measures) ? vln1.measures : [];
    var v2Measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 55;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 83;
    var prevV2 = null;
    var prevMelody = null;
    var _loop_5 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var v2Measure = v2Measures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        if (!v2Measure)
            return "continue";
        var next = [];
        for (var _c = 0, _d = (_b = m === null || m === void 0 ? void 0 : m.events) !== null && _b !== void 0 ? _b : []; _c < _d.length; _c++) {
            var ev = _d[_c];
            if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number")
                continue;
            if (ev.type !== "note") {
                next.push(__assign(__assign({}, ev), { voice: 1, staff: 1 }));
                continue;
            }
            var melodyMidi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (melodyMidi === null)
                continue;
            var chord = chordAt(chordEvents, mNum, ev.t);
            var pcs = pickThirdAndFifth(chord);
            if (!pcs.length) {
                prevMelody = melodyMidi;
                continue;
            }
            var dir = prevMelody === null
                ? "either"
                : melodyMidi > prevMelody
                    ? "down"
                    : melodyMidi < prevMelody
                        ? "up"
                        : "either";
            var seed = typeof prevV2 === "number" ? prevV2 : (0, instrumentCatalog_1.shiftOctavesIntoRange)(melodyMidi, minMidi, maxMidi);
            var midi = pickCandidateNear(seed, pcs, minMidi, maxMidi, dir);
            if (typeof midi !== "number") {
                midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(seed, minMidi, maxMidi);
            }
            next.push({
                id: "vln2-contrary-".concat(mNum, "-").concat(ev.t),
                t: ev.t,
                dur: ev.dur,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevV2 = midi;
            prevMelody = melodyMidi;
        }
        v2Measure.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, v1Measures_2 = v1Measures; _i < v1Measures_2.length; _i++) {
        var m = v1Measures_2[_i];
        _loop_5(m);
    }
}
function pickWeightedDuration(measureNumber, t) {
    var tKey = Math.round(t * 1000);
    var h = (measureNumber * 2654435761) ^ (tKey * 2246822519);
    h = (h >>> 0) % 1000;
    var r = h / 1000;
    if (r < 0.4)
        return 0.5; // 40% eighth
    if (r < 0.9)
        return 1; // 50% quarter
    return 2; // 10% half
}
function applyViolin2IntermediateLessActiveContrary(vln2, vc, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j;
    var v2Measures = Array.isArray(vln2 === null || vln2 === void 0 ? void 0 : vln2.measures) ? vln2.measures : [];
    var vcMeasures = Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 55;
    var maxMidi = 88; // G3..E6
    var prevV2 = null;
    var prevVc = null;
    var _loop_6 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var vcMeasure = vcMeasures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        if (!vcMeasure)
            return "continue";
        var vcByT = new Map();
        for (var _k = 0, _l = (_b = vcMeasure.events) !== null && _b !== void 0 ? _b : []; _k < _l.length; _k++) {
            var ev = _l[_k];
            if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                continue;
            var midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            if (midi === null)
                continue;
            vcByT.set(Number((_c = ev.t) !== null && _c !== void 0 ? _c : 0), midi);
        }
        var beats = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beats) !== null && _f !== void 0 ? _f : 4);
        var beatType = Number((_j = (_h = (_g = m === null || m === void 0 ? void 0 : m.attributes) === null || _g === void 0 ? void 0 : _g.time) === null || _h === void 0 ? void 0 : _h.beat_type) !== null && _j !== void 0 ? _j : 4);
        var mLen = beats * (4 / beatType);
        var next = [];
        var t = 0;
        while (t < mLen - 1e-6) {
            var dur = Math.min(pickWeightedDuration(mNum, t), mLen - t);
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = pickThirdAndFifth(chord);
            if (pcs.length) {
                var vcMidi = vcByT.get(t);
                var preferDir = "either";
                if (typeof vcMidi === "number" && typeof prevVc === "number") {
                    if (vcMidi > prevVc)
                        preferDir = "down";
                    else if (vcMidi < prevVc)
                        preferDir = "up";
                }
                var seed = typeof prevV2 === "number" ? prevV2 : minMidi + 7;
                var midi = pickCandidateNear(seed, pcs, minMidi, maxMidi, preferDir);
                next.push({
                    id: "vln2-int-contrary-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: dur,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevV2 = midi;
            }
            if (typeof vcByT.get(t) === "number")
                prevVc = vcByT.get(t);
            t += dur;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, v2Measures_3 = v2Measures; _i < v2Measures_3.length; _i++) {
        var m = v2Measures_3[_i];
        _loop_6(m);
    }
}
function applyViolaAdvancedActive(vla, refs, options) {
    var _a, _b, _c, _d;
    var vlaMeasures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
    var byMeasure = function (part) {
        var _a;
        var map = new Map();
        for (var _i = 0, _b = (_a = part === null || part === void 0 ? void 0 : part.measures) !== null && _a !== void 0 ? _a : []; _i < _b.length; _i++) {
            var m = _b[_i];
            map.set(Number(m === null || m === void 0 ? void 0 : m.number) || 1, m);
        }
        return map;
    };
    var v1By = byMeasure(refs.vln1);
    var v2By = byMeasure(refs.vln2);
    var vcBy = byMeasure(refs.vc);
    var cbBy = byMeasure(refs.cb);
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 60;
    for (var _i = 0, vlaMeasures_3 = vlaMeasures; _i < vlaMeasures_3.length; _i++) {
        var m = vlaMeasures_3[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var v1m = v1By.get(mNum);
        var v2m = v2By.get(mNum);
        var vcm = vcBy.get(mNum);
        var cbm = cbBy.get(mNum);
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
            if (!pcs.length)
                continue;
            var rootPc = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : pcs[0];
            var thirdPc = chordThirdPc(chord);
            var fifthPc = chordFifthPc(chord);
            var present = new Set();
            for (var _e = 0, _f = [v1m, v2m, vcm, cbm]; _e < _f.length; _e++) {
                var src = _f[_e];
                var midi_3 = activeMidiAt((_c = src === null || src === void 0 ? void 0 : src.events) !== null && _c !== void 0 ? _c : [], t);
                if (typeof midi_3 === "number")
                    present.add(((midi_3 % 12) + 12) % 12);
            }
            var targetPc = rootPc;
            if (typeof thirdPc === "number" && !present.has(thirdPc))
                targetPc = thirdPc;
            else if (typeof fifthPc === "number" && !present.has(fifthPc))
                targetPc = fifthPc;
            var v2Now = activeMidiAt((_d = v2m === null || v2m === void 0 ? void 0 : v2m.events) !== null && _d !== void 0 ? _d : [], t);
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
            if (typeof v2Now === "number" && midi >= v2Now) {
                while (midi >= v2Now && midi - 12 >= minMidi)
                    midi -= 12;
            }
            next.push({
                id: "vla-adv60-".concat(mNum, "-").concat(t),
                t: t,
                dur: 0.5,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolaAdvancedHighActiveTriplets(vla, options) {
    var _a, _b;
    var measures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 84;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 60;
    for (var _i = 0, measures_13 = measures; _i < measures_13.length; _i++) {
        var m = measures_13[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var beat = 0; beat < mLen - 1e-6; beat += 1) {
            var chord = chordAt(chordEvents, mNum, beat);
            var pcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
            if (!pcs.length)
                continue;
            var third = chordThirdPc(chord);
            var targetPc = typeof third === "number" ? third : pcs[0];
            // Keep advanced-100 triplet engine, but lock pitch class to the chord 3rd.
            for (var i = 0; i < 3; i++) {
                var t = beat + i / 3;
                if (t >= mLen - 1e-6)
                    continue;
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, targetPc), minMidi, maxMidi);
                next.push({
                    id: "vla-adv100-trip-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(1 / 3, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyCelloAlberti(part, options) {
    var _a;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 64;
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    for (var _i = 0, measures_14 = measures; _i < measures_14.length; _i++) {
        var m = measures_14[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var prevMidi = minMidi + 12;
        for (var t = 0; t < mLen - 1e-6; t += 1) {
            var chord = chordAt(chordEvents, mNum, t);
            var seq = pickChordToneSequence(chord, 4);
            if (!seq.length)
                continue;
            var idx = Math.round(t) % seq.length;
            var pc = seq[idx];
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
            next.push({
                id: "vc-alberti-".concat(mNum, "-").concat(t),
                t: t,
                dur: 1,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyCelloIntermediateLessActive(part, options) {
    var _a, _b;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 36;
    var maxMidi = 69; // C2..A4
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 48;
    for (var _i = 0, measures_15 = measures; _i < measures_15.length; _i++) {
        var m = measures_15[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var useQuarter = shouldChooseMeasure(mNum, 0.6, 142); // 60% quarter arpeggios
        if (useQuarter) {
            for (var t = 0; t < mLen - 1e-6; t += 1) {
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    continue;
                var pc = seq[Math.round(t) % seq.length];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vc-int-q-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 1,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        else {
            for (var t = 0; t < mLen - 1e-6; t += 2) {
                var chord = chordAt(chordEvents, mNum, t);
                var thirdPc = chordThirdPc(chord);
                var pcs = thirdPc !== null ? [thirdPc] : (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
                if (!pcs.length)
                    continue;
                var midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
                next.push({
                    id: "vc-int-h-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(2, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function pickCelloIntermediateActiveMode(measureNumber) {
    var h = (measureNumber * 2654435761) ^ 0x9e3779b9;
    h = (h >>> 0) % 1000;
    var r = h / 1000;
    if (r < 0.4)
        return "alberti"; // 40%
    if (r < 0.6)
        return "quarter"; // 20%
    if (r < 0.9)
        return "sync"; // 30%
    return "neighbor"; // 10%
}
function applyCelloIntermediateActive(part, options) {
    var _a, _b, _c;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 36;
    var maxMidi = 69; // C2..A4
    var keyFifths = typeof options.keyFifths === "number" ? options.keyFifths : 0;
    var keyMode = (_b = options.keyMode) !== null && _b !== void 0 ? _b : "major";
    var scale = buildScalePcs(keyFifths, keyMode);
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 48;
    for (var _i = 0, measures_16 = measures; _i < measures_16.length; _i++) {
        var m = measures_16[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var mode = pickCelloIntermediateActiveMode(mNum);
        var next = [];
        var mLen = measureLen(m);
        if (mode === "alberti") {
            for (var t = 0; t < mLen - 1e-6; t += 0.5) {
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    continue;
                var idx = Math.round(t * 2) % seq.length;
                var pc = seq[idx];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vc-int60-ab-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 0.5,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        else if (mode === "quarter") {
            for (var t = 0; t < mLen - 1e-6; t += 1) {
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    continue;
                var pc = seq[Math.round(t) % seq.length];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vc-int60-q-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 1,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        else if (mode === "sync") {
            var t = 0.5;
            var pattern = [1.5, 0.5]; // dotted quarter + eighth (syncopated)
            var idx = 0;
            while (t < mLen - 1e-6) {
                var dur = Math.min(pattern[idx % pattern.length], mLen - t);
                var chord = chordAt(chordEvents, mNum, t);
                var seq = pickChordToneSequence(chord, 4);
                if (!seq.length)
                    break;
                var pc = seq[idx % seq.length];
                var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                next.push({
                    id: "vc-int60-sync-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: dur,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                t += dur;
                idx += 1;
            }
        }
        else {
            for (var t = 0; t < mLen - 1e-6; t += 1) {
                var chord = chordAt(chordEvents, mNum, t);
                var chordPcs = (_c = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _c !== void 0 ? _c : [];
                if (!chordPcs.length)
                    continue;
                var basePc = chordPcs[Math.round(t) % chordPcs.length];
                var baseMidi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, basePc), minMidi, maxMidi);
                var dir = passDir(mNum, t, 31);
                var neighbor = neighborMidi(baseMidi, dir, scale, chordPcs);
                var midi = neighbor !== null ? (0, instrumentCatalog_1.shiftOctavesIntoRange)(neighbor, minMidi, maxMidi) : baseMidi;
                next.push({
                    id: "vc-int60-nei-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: 1,
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyCelloAdvancedActivePattern(part, options) {
    var _a;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 76; // C2..E5
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 48;
    for (var _i = 0, measures_17 = measures; _i < measures_17.length; _i++) {
        var m = measures_17[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 1) {
            var chord = chordAt(chordEvents, mNum, t);
            var seq = pickChordToneSequence(chord, 4);
            if (!seq.length)
                continue;
            var beatIndex = Math.floor(t);
            var pcA = seq[(beatIndex * 2) % seq.length];
            var pcB = seq[(beatIndex * 2 + 1) % seq.length];
            var midiA = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pcA), minMidi, maxMidi);
            next.push({
                id: "vc-adv60-dot8-".concat(mNum, "-").concat(t),
                t: t,
                dur: Math.min(0.75, mLen - t),
                type: "note",
                midi: midiA,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midiA),
                voice: 1,
                staff: 1
            });
            prevMidi = midiA;
            var t2 = t + 0.75;
            if (t2 < mLen - 1e-6) {
                var midiB = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pcB), minMidi, maxMidi);
                next.push({
                    id: "vc-adv60-16-".concat(mNum, "-").concat(t2),
                    t: t2,
                    dur: Math.min(0.25, mLen - t2),
                    type: "note",
                    midi: midiB,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midiB),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midiB;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyCelloAdvancedHighActiveSyncopes(part, options) {
    var _a;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 36;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 76; // C2..E5
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 48;
    for (var _i = 0, measures_18 = measures; _i < measures_18.length; _i++) {
        var m = measures_18[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var idx = 0;
        // Syncopation: attacks on offbeats (8th offset), sustained through strong beats.
        for (var t = 0.5; t < mLen - 1e-6; t += 1) {
            var chord = chordAt(chordEvents, mNum, t);
            var triad = [];
            var rootPc = typeof (chord === null || chord === void 0 ? void 0 : chord.rootPc) === "number" ? chord.rootPc : Array.isArray(chord === null || chord === void 0 ? void 0 : chord.pcs) && chord.pcs.length ? chord.pcs[0] : null;
            var thirdPc = chordThirdPc(chord);
            var fifthPc = chordFifthPc(chord);
            if (typeof rootPc === "number")
                triad.push(rootPc);
            if (typeof thirdPc === "number" && !triad.includes(thirdPc))
                triad.push(thirdPc);
            if (typeof fifthPc === "number" && !triad.includes(fifthPc))
                triad.push(fifthPc);
            if (!triad.length)
                continue;
            var pc = triad[idx % triad.length];
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
            next.push({
                id: "vc-adv100-sync-".concat(mNum, "-").concat(t),
                t: t,
                dur: Math.min(1, mLen - t),
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
            idx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyCelloIntermediateHighActivePattern(part, options) {
    var _a, _b, _c;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 36;
    var maxMidi = 69; // C2..A4
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 48;
    var baseOrder = [
        "quarter",
        "two8",
        "alberti16",
        "dot8_16"
    ];
    for (var _i = 0, measures_19 = measures; _i < measures_19.length; _i++) {
        var m = measures_19[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var t = 0;
        var cellOrder = __spreadArray([], baseOrder, true);
        // True random per-measure shuffle for rhythm-cell ordering.
        for (var i = cellOrder.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = cellOrder[i];
            cellOrder[i] = cellOrder[j];
            cellOrder[j] = tmp;
        }
        var cellIdx = 0;
        while (t < mLen - 1e-6) {
            var cell = cellOrder[cellIdx % cellOrder.length];
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
            if (cell === "quarter") {
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vc-int100-q-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(1, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
            else if (cell === "two8") {
                var times = [t, t + 0.5];
                var lastPc = null;
                for (var _d = 0, times_1 = times; _d < times_1.length; _d++) {
                    var s = times_1[_d];
                    if (s >= mLen - 1e-6)
                        continue;
                    var midi = prevMidi;
                    if (pcs.length) {
                        var excludePc = lastPc;
                        midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either", undefined, excludePc !== null && excludePc !== void 0 ? excludePc : undefined);
                    }
                    else {
                        midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vc-int100-8-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.5, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                    lastPc = ((midi % 12) + 12) % 12;
                }
            }
            else if (cell === "alberti16") {
                var seq = pickChordToneSequence(chord, 4);
                for (var i = 0; i < 4; i++) {
                    var s = t + i * 0.25;
                    if (s >= mLen - 1e-6)
                        continue;
                    if (!seq.length)
                        continue;
                    var pc = seq[i % seq.length];
                    var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                    next.push({
                        id: "vc-int100-ab16-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.25, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                }
            }
            else {
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, "either");
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vc-int100-dot8-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(0.75, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                var t2 = t + 0.75;
                if (t2 < mLen - 1e-6) {
                    var chord2 = chordAt(chordEvents, mNum, t2);
                    var pcs2 = (_c = chord2 === null || chord2 === void 0 ? void 0 : chord2.pcs) !== null && _c !== void 0 ? _c : pcs;
                    var midi2 = prevMidi;
                    if (pcs2.length) {
                        var excludePc = ((prevMidi % 12) + 12) % 12;
                        midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, "either", undefined, excludePc);
                    }
                    else {
                        midi2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vc-int100-16-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: Math.min(0.25, mLen - t2),
                        type: "note",
                        midi: midi2,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi2),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi2;
                }
            }
            t += 1;
            cellIdx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolaIntermediateHighActivePattern(part, options) {
    var _a, _b, _c, _d, _e;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = typeof options.minMidi === "number" ? options.minMidi : 48;
    var maxMidi = typeof options.maxMidi === "number" ? options.maxMidi : 81; // C3..A5
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 60;
    var baseOrder = [
        "dot8_16",
        "four16",
        "dotq_8",
        "quarter",
        "two8",
        "alberti16"
    ];
    for (var _i = 0, measures_20 = measures; _i < measures_20.length; _i++) {
        var m = measures_20[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        var t = 0;
        var preferDir = passDir(mNum, 0, 211) > 0 ? "up" : "down";
        var order = __spreadArray([], baseOrder, true);
        // True random per-measure shuffle for rhythm-cell ordering.
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var tmp = order[i];
            order[i] = order[j];
            order[j] = tmp;
        }
        var cellIdx = 0;
        while (t < mLen - 1e-6) {
            var cell = order[cellIdx % order.length];
            var chord = chordAt(chordEvents, mNum, t);
            var pcs = (_b = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _b !== void 0 ? _b : [];
            if (cell === "quarter") {
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vla-int100-q-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(1, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                t += 1;
            }
            else if (cell === "two8") {
                var times = [t, t + 0.5];
                var lastPc = null;
                for (var _f = 0, times_2 = times; _f < times_2.length; _f++) {
                    var s = times_2[_f];
                    if (s >= mLen - 1e-6)
                        continue;
                    var midi = prevMidi;
                    if (pcs.length) {
                        midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, undefined, lastPc !== null && lastPc !== void 0 ? lastPc : undefined);
                    }
                    else {
                        midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vla-int100-8-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.5, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                    lastPc = ((midi % 12) + 12) % 12;
                }
                t += 1;
            }
            else if (cell === "alberti16") {
                var seq = pickChordToneSequence(chord, 4);
                for (var i = 0; i < 4; i++) {
                    var s = t + i * 0.25;
                    if (s >= mLen - 1e-6 || !seq.length)
                        continue;
                    var pc = seq[i % seq.length];
                    var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
                    next.push({
                        id: "vla-int100-ab16-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.25, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                }
                t += 1;
            }
            else if (cell === "dot8_16") {
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vla-int100-dot8-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(0.75, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                var t2 = t + 0.75;
                if (t2 < mLen - 1e-6) {
                    var chord2 = chordAt(chordEvents, mNum, t2);
                    var pcs2 = (_c = chord2 === null || chord2 === void 0 ? void 0 : chord2.pcs) !== null && _c !== void 0 ? _c : pcs;
                    var midi2 = prevMidi;
                    if (pcs2.length) {
                        midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi);
                    }
                    else {
                        midi2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vla-int100-16-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: Math.min(0.25, mLen - t2),
                        type: "note",
                        midi: midi2,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi2),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi2;
                }
                t += 1;
            }
            else if (cell === "four16") {
                var slots = [t, t + 0.25, t + 0.5, t + 0.75];
                for (var _g = 0, slots_6 = slots; _g < slots_6.length; _g++) {
                    var s = slots_6[_g];
                    if (s >= mLen - 1e-6)
                        continue;
                    var chordS = chordAt(chordEvents, mNum, s);
                    var pcsS = (_d = chordS === null || chordS === void 0 ? void 0 : chordS.pcs) !== null && _d !== void 0 ? _d : [];
                    var midi = prevMidi;
                    if (pcsS.length) {
                        midi = pickCandidateNear(prevMidi, pcsS, minMidi, maxMidi, preferDir, prevMidi);
                        if (preferDir === "up" && midi <= prevMidi && midi + 12 <= maxMidi)
                            midi += 12;
                        if (preferDir === "down" && midi >= prevMidi && midi - 12 >= minMidi)
                            midi -= 12;
                    }
                    else {
                        midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vla-int100-16a-".concat(mNum, "-").concat(s),
                        t: s,
                        dur: Math.min(0.25, mLen - s),
                        type: "note",
                        midi: midi,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi;
                }
                t += 1;
            }
            else {
                var midi = prevMidi;
                if (pcs.length) {
                    midi = pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "vla-int100-dotq-".concat(mNum, "-").concat(t),
                    t: t,
                    dur: Math.min(1.5, mLen - t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
                var t2 = t + 1.5;
                if (t2 < mLen - 1e-6) {
                    var chord2 = chordAt(chordEvents, mNum, t2);
                    var pcs2 = (_e = chord2 === null || chord2 === void 0 ? void 0 : chord2.pcs) !== null && _e !== void 0 ? _e : pcs;
                    var midi2 = prevMidi;
                    if (pcs2.length) {
                        var excludePc = ((prevMidi % 12) + 12) % 12;
                        midi2 = pickCandidateNear(prevMidi, pcs2, minMidi, maxMidi, preferDir, prevMidi, excludePc);
                    }
                    else {
                        midi2 = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                    }
                    next.push({
                        id: "vla-int100-8b-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: Math.min(0.5, mLen - t2),
                        type: "note",
                        midi: midi2,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(midi2),
                        voice: 1,
                        staff: 1
                    });
                    prevMidi = midi2;
                }
                t += 2;
            }
            cellIdx += 1;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyDoubleBassIntermediateHighActive(part, options) {
    var _a, _b, _c;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 28;
    var maxMidi = 60; // E1..C4
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 40;
    for (var _i = 0, measures_21 = measures; _i < measures_21.length; _i++) {
        var m = measures_21[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var bassPc = typeof (chord === null || chord === void 0 ? void 0 : chord.bassPc) === "number" ? chord.bassPc : (_b = chord === null || chord === void 0 ? void 0 : chord.rootPc) !== null && _b !== void 0 ? _b : (_c = chord === null || chord === void 0 ? void 0 : chord.pcs) === null || _c === void 0 ? void 0 : _c[0];
            var midi = prevMidi;
            if (typeof bassPc === "number") {
                midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, bassPc), minMidi, maxMidi);
            }
            else {
                midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
            }
            next.push({
                id: "cb-int100-8-".concat(mNum, "-").concat(t),
                t: t,
                dur: Math.min(0.5, mLen - t),
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyDoubleBassAdvancedHighActive(part, options) {
    var _a, _b, _c;
    var measures = Array.isArray(part === null || part === void 0 ? void 0 : part.measures) ? part.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 28;
    var maxMidi = 60; // E1..C4
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 40;
    for (var _i = 0, measures_22 = measures; _i < measures_22.length; _i++) {
        var m = measures_22[_i];
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var next = [];
        var mLen = measureLen(m);
        for (var beat = 0; beat < mLen - 1e-6; beat += 1) {
            var slots = [
                { t: beat, dur: 0.5 },
                { t: beat + 0.5, dur: 0.25 },
                { t: beat + 0.75, dur: 0.25 }
            ];
            for (var _d = 0, slots_7 = slots; _d < slots_7.length; _d++) {
                var slot = slots_7[_d];
                if (slot.t >= mLen - 1e-6)
                    continue;
                var chord = chordAt(chordEvents, mNum, slot.t);
                var bassPc = typeof (chord === null || chord === void 0 ? void 0 : chord.bassPc) === "number" ? chord.bassPc : (_b = chord === null || chord === void 0 ? void 0 : chord.rootPc) !== null && _b !== void 0 ? _b : (_c = chord === null || chord === void 0 ? void 0 : chord.pcs) === null || _c === void 0 ? void 0 : _c[0];
                var midi = prevMidi;
                if (typeof bassPc === "number") {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, bassPc), minMidi, maxMidi);
                }
                else {
                    midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
                }
                next.push({
                    id: "cb-adv100-cell-".concat(mNum, "-").concat(slot.t),
                    t: slot.t,
                    dur: Math.min(slot.dur, mLen - slot.t),
                    type: "note",
                    midi: midi,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                    voice: 1,
                    staff: 1
                });
                prevMidi = midi;
            }
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    }
}
function applyViolaIntermediateAgainstCello(vla, vc, options) {
    var _a, _b, _c;
    var vlaMeasures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var vcMeasures = Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : [];
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 48;
    var maxMidi = 81; // C3..A5
    var measureLen = function (m) {
        var _a, _b, _c, _d, _e, _f;
        var beats = Number((_c = (_b = (_a = m === null || m === void 0 ? void 0 : m.attributes) === null || _a === void 0 ? void 0 : _a.time) === null || _b === void 0 ? void 0 : _b.beats) !== null && _c !== void 0 ? _c : 4);
        var beatType = Number((_f = (_e = (_d = m === null || m === void 0 ? void 0 : m.attributes) === null || _d === void 0 ? void 0 : _d.time) === null || _e === void 0 ? void 0 : _e.beat_type) !== null && _f !== void 0 ? _f : 4);
        return beats * (4 / beatType);
    };
    var prevMidi = 60;
    var _loop_7 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var vcMeasure = vcMeasures.find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        if (!vcMeasure)
            return "continue";
        var vcEvents = ((_b = vcMeasure.events) !== null && _b !== void 0 ? _b : []).filter(function (e) { return (e === null || e === void 0 ? void 0 : e.type) === "note"; });
        var vcByT = new Map();
        for (var _d = 0, vcEvents_1 = vcEvents; _d < vcEvents_1.length; _d++) {
            var e = vcEvents_1[_d];
            var midi = typeof e.midi === "number" ? e.midi : e.pitch ? (0, instrumentCatalog_1.pitchToMidi)(e.pitch) : null;
            if (midi === null)
                continue;
            vcByT.set(Number((_c = e.t) !== null && _c !== void 0 ? _c : 0), midi);
        }
        var next = [];
        var mLen = measureLen(m);
        for (var t = 0; t < mLen - 1e-6; t += 0.5) {
            var chord = chordAt(chordEvents, mNum, t);
            var seq = pickChordToneSequence(chord, 4);
            if (!seq.length)
                continue;
            var idx = Math.round(t * 2) % seq.length;
            var pc = seq[idx];
            var vcMidi = vcByT.get(t);
            var midi = (0, instrumentCatalog_1.shiftOctavesIntoRange)(snapToPcNear(prevMidi, pc), minMidi, maxMidi);
            if (typeof vcMidi === "number" && midi === vcMidi) {
                var up = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi + 12, minMidi, maxMidi);
                if (up !== vcMidi)
                    midi = up;
                else {
                    var down = (0, instrumentCatalog_1.shiftOctavesIntoRange)(midi - 12, minMidi, maxMidi);
                    if (down !== vcMidi)
                        midi = down;
                }
            }
            next.push({
                id: "vla-int-ab-".concat(mNum, "-").concat(t),
                t: t,
                dur: 0.5,
                type: "note",
                midi: midi,
                pitch: (0, instrumentCatalog_1.midiToPitch)(midi),
                voice: 1,
                staff: 1
            });
            prevMidi = midi;
        }
        m.events = next.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, vlaMeasures_4 = vlaMeasures; _i < vlaMeasures_4.length; _i++) {
        var m = vlaMeasures_4[_i];
        _loop_7(m);
    }
}
function applyCelloMelodyRhythmContrary(vln1, vc, options) {
    var _a, _b, _c, _d;
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var minMidi = 36;
    var maxMidi = 64;
    var prevVc = 48;
    var prevMelody = null;
    var _loop_8 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var vlnEvents = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
        var vcEvents = [];
        for (var _f = 0, vlnEvents_1 = vlnEvents; _f < vlnEvents_1.length; _f++) {
            var ev = vlnEvents_1[_f];
            if (ev.type !== "note" || typeof ev.t !== "number" || typeof ev.dur !== "number") {
                vcEvents.push(__assign({}, ev));
                continue;
            }
            var melodyMidi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? (0, instrumentCatalog_1.pitchToMidi)(ev.pitch) : null;
            var chord = chordAt(chordEvents, mNum, ev.t);
            var chordPcs = (_c = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _c !== void 0 ? _c : [];
            if (!chordPcs.length || melodyMidi === null) {
                vcEvents.push(__assign({}, ev));
                continue;
            }
            var melodyDir = prevMelody === null
                ? "either"
                : melodyMidi > prevMelody
                    ? "up"
                    : melodyMidi < prevMelody
                        ? "down"
                        : "either";
            var preferDir = melodyDir === "up" ? "down" : melodyDir === "down" ? "up" : "either";
            var nextVc = pickCandidateNear(prevVc, chordPcs, minMidi, maxMidi, preferDir, melodyMidi);
            vcEvents.push({
                id: "vc-melody-rhythm-".concat(mNum, "-").concat(ev.t),
                t: ev.t,
                dur: ev.dur,
                type: "note",
                midi: nextVc,
                pitch: (0, instrumentCatalog_1.midiToPitch)(nextVc),
                voice: 1,
                staff: 1
            });
            prevVc = nextVc;
            prevMelody = melodyMidi;
        }
        var vcMeasure = ((_d = vc === null || vc === void 0 ? void 0 : vc.measures) !== null && _d !== void 0 ? _d : []).find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        if (vcMeasure)
            vcMeasure.events = vcEvents.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, _e = (_b = vln1 === null || vln1 === void 0 ? void 0 : vln1.measures) !== null && _b !== void 0 ? _b : []; _i < _e.length; _i++) {
        var m = _e[_i];
        _loop_8(m);
    }
}
function snapToPcNear(baseMidi, pc) {
    var baseOct = Math.floor(baseMidi / 12);
    var candidates = [baseOct - 1, baseOct, baseOct + 1].map(function (oct) { return pc + oct * 12; });
    var best = candidates[0];
    var bestDist = Math.abs(best - baseMidi);
    for (var _i = 0, candidates_1 = candidates; _i < candidates_1.length; _i++) {
        var c = candidates_1[_i];
        var d = Math.abs(c - baseMidi);
        if (d < bestDist) {
            best = c;
            bestDist = d;
        }
    }
    return best;
}
function pickCandidateNear(prevMidi, pcs, minMidi, maxMidi, preferDir, excludeMidi, excludePc) {
    var baseOct = Math.floor(prevMidi / 12);
    var candidates = [];
    for (var _i = 0, pcs_2 = pcs; _i < pcs_2.length; _i++) {
        var pc = pcs_2[_i];
        for (var oct = -2; oct <= 2; oct++) {
            var midi = pc + (baseOct + oct) * 12;
            if (midi >= minMidi && midi <= maxMidi)
                candidates.push(midi);
        }
    }
    if (!candidates.length)
        return (0, instrumentCatalog_1.shiftOctavesIntoRange)(prevMidi, minMidi, maxMidi);
    var filtered = typeof excludeMidi === "number" ? candidates.filter(function (m) { return m !== excludeMidi; }) : candidates;
    if (typeof excludePc === "number") {
        filtered = filtered.filter(function (m) { return ((m % 12) + 12) % 12 !== excludePc; });
    }
    var dirFilter = filtered.filter(function (m) {
        return preferDir === "either" ? true : preferDir === "up" ? m > prevMidi : m < prevMidi;
    });
    var pool = dirFilter.length ? dirFilter : filtered.length ? filtered : candidates;
    pool.sort(function (a, b) { return Math.abs(a - prevMidi) - Math.abs(b - prevMidi); });
    return pool[0];
}
function buildQuarterHalfPattern(measureLen, measureNumber) {
    var out = [];
    var remaining = measureLen;
    var useTwo = measureNumber % 2 === 0;
    while (remaining > 0.01) {
        if (remaining >= 2 && useTwo) {
            out.push(2);
            remaining -= 2;
        }
        else {
            out.push(1);
            remaining -= 1;
        }
    }
    return out;
}
function applyBeginnerContraryMotion(vla, vc, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    var chordEvents = (_a = options.chordEvents) !== null && _a !== void 0 ? _a : [];
    var vlaMin = 48;
    var vlaMax = 76;
    var vcMin = 36;
    var vcMax = 64;
    var prevVla = 60;
    var prevVc = 48;
    var measures = Array.isArray(vla === null || vla === void 0 ? void 0 : vla.measures) ? vla.measures : [];
    var _loop_9 = function (m) {
        var mNum = Number(m === null || m === void 0 ? void 0 : m.number) || 1;
        var beatType = Number((_d = (_c = (_b = m === null || m === void 0 ? void 0 : m.attributes) === null || _b === void 0 ? void 0 : _b.time) === null || _c === void 0 ? void 0 : _c.beat_type) !== null && _d !== void 0 ? _d : 4);
        var beats = Number((_g = (_f = (_e = m === null || m === void 0 ? void 0 : m.attributes) === null || _e === void 0 ? void 0 : _e.time) === null || _f === void 0 ? void 0 : _f.beats) !== null && _g !== void 0 ? _g : 4);
        var measureLen = beats * (4 / beatType);
        var pattern = buildQuarterHalfPattern(measureLen, mNum);
        var vcEvents = [];
        var t = 0;
        for (var _p = 0, pattern_1 = pattern; _p < pattern_1.length; _p++) {
            var dur = pattern_1[_p];
            var chord = chordAt(chordEvents, mNum, t);
            var chordPcs = (_h = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _h !== void 0 ? _h : [];
            if (!chordPcs.length) {
                t += dur;
                continue;
            }
            var nextVc = pickCandidateNear(prevVc, chordPcs, vcMin, vcMax, "either");
            vcEvents.push({
                id: "vc-contrary-".concat(mNum, "-").concat(t),
                t: t,
                dur: dur,
                type: "note",
                midi: nextVc,
                pitch: (0, instrumentCatalog_1.midiToPitch)(nextVc),
                voice: 1,
                staff: 1
            });
            prevVc = nextVc;
            t += dur;
        }
        var vlaEvents = [];
        for (var i = 0; i < vcEvents.length; i++) {
            var ev = vcEvents[i];
            var dur = ev.dur;
            var next = vcEvents[i + 1];
            if (dur === 1 && next && next.dur === 1) {
                var chord_1 = chordAt(chordEvents, mNum, ev.t);
                var chordPcs_1 = (_j = chord_1 === null || chord_1 === void 0 ? void 0 : chord_1.pcs) !== null && _j !== void 0 ? _j : [];
                if (chordPcs_1.length) {
                    var prevVcMidi = i > 0 ? (_k = vcEvents[i - 1]) === null || _k === void 0 ? void 0 : _k.midi : null;
                    var vcDir = typeof prevVcMidi === "number"
                        ? ev.midi > prevVcMidi
                            ? "up"
                            : ev.midi < prevVcMidi
                                ? "down"
                                : "either"
                        : "either";
                    var vlaDir = vcDir === "up" ? "down" : vcDir === "down" ? "up" : "either";
                    var nextVla = pickCandidateNear(prevVla, chordPcs_1, vlaMin, vlaMax, vlaDir, ev.midi, ((ev.midi % 12) + 12) % 12);
                    vlaEvents.push({
                        id: "vla-contrary-".concat(mNum, "-").concat(ev.t),
                        t: ev.t,
                        dur: 2,
                        type: "note",
                        midi: nextVla,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(nextVla),
                        voice: 1,
                        staff: 1
                    });
                    prevVla = nextVla;
                }
                i += 1;
                continue;
            }
            if (dur === 2) {
                for (var k = 0; k < 2; k++) {
                    var t2 = ev.t + k;
                    var chord_2 = chordAt(chordEvents, mNum, t2);
                    var chordPcs_2 = (_l = chord_2 === null || chord_2 === void 0 ? void 0 : chord_2.pcs) !== null && _l !== void 0 ? _l : [];
                    if (!chordPcs_2.length)
                        continue;
                    var prevVcMidi = i > 0 ? (_m = vcEvents[i - 1]) === null || _m === void 0 ? void 0 : _m.midi : null;
                    var vcDir = typeof prevVcMidi === "number"
                        ? ev.midi > prevVcMidi
                            ? "up"
                            : ev.midi < prevVcMidi
                                ? "down"
                                : "either"
                        : "either";
                    var vlaDir = vcDir === "up" ? "down" : vcDir === "down" ? "up" : "either";
                    var nextVla = pickCandidateNear(prevVla, chordPcs_2, vlaMin, vlaMax, vlaDir, ev.midi, ((ev.midi % 12) + 12) % 12);
                    vlaEvents.push({
                        id: "vla-contrary-".concat(mNum, "-").concat(t2),
                        t: t2,
                        dur: 1,
                        type: "note",
                        midi: nextVla,
                        pitch: (0, instrumentCatalog_1.midiToPitch)(nextVla),
                        voice: 1,
                        staff: 1
                    });
                    prevVla = nextVla;
                }
                continue;
            }
            // Fallback for odd durations, keep quarter.
            var chord = chordAt(chordEvents, mNum, ev.t);
            var chordPcs = (_o = chord === null || chord === void 0 ? void 0 : chord.pcs) !== null && _o !== void 0 ? _o : [];
            if (chordPcs.length) {
                var nextVla = pickCandidateNear(prevVla, chordPcs, vlaMin, vlaMax, "either", ev.midi, ((ev.midi % 12) + 12) % 12);
                vlaEvents.push({
                    id: "vla-contrary-".concat(mNum, "-").concat(ev.t),
                    t: ev.t,
                    dur: dur,
                    type: "note",
                    midi: nextVla,
                    pitch: (0, instrumentCatalog_1.midiToPitch)(nextVla),
                    voice: 1,
                    staff: 1
                });
                prevVla = nextVla;
            }
        }
        m.events = vlaEvents.sort(function (a, b) { return Number(a.t) - Number(b.t); });
        var vcMeasure = (Array.isArray(vc === null || vc === void 0 ? void 0 : vc.measures) ? vc.measures : []).find(function (mm) { return Number(mm === null || mm === void 0 ? void 0 : mm.number) === mNum; });
        if (vcMeasure)
            vcMeasure.events = vcEvents.sort(function (a, b) { return Number(a.t) - Number(b.t); });
    };
    for (var _i = 0, measures_23 = measures; _i < measures_23.length; _i++) {
        var m = measures_23[_i];
        _loop_9(m);
    }
}
