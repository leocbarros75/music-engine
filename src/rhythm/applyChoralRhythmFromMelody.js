"use strict";
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
exports.applyChoralRhythmFromMelody = applyChoralRhythmFromMelody;
function isNoteOrRest(e) {
    return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}
function warn(warnings, msg) {
    warnings.push(msg);
    // warnings only
    // eslint-disable-next-line no-console
    console.warn(msg);
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
    var _a;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    if (!parts.length)
        return null;
    var findByName = function (needle) {
        return parts.findIndex(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes(needle); });
    };
    var preferByName = ["melody", "soprano", "voice"];
    for (var _i = 0, preferByName_1 = preferByName; _i < preferByName_1.length; _i++) {
        var needle = preferByName_1[_i];
        var idx = findByName(needle);
        if (idx >= 0) {
            var part_1 = parts[idx];
            if (!part_1)
                continue;
            return { part: part_1, index: idx, voice: detectMelodyVoice(part_1) };
        }
    }
    var bestIdx = 0;
    var bestAvg = -Infinity;
    for (var i = 0; i < parts.length; i++) {
        var avg = averageMidiForPart(parts[i]);
        if (avg !== null && avg > bestAvg) {
            bestAvg = avg;
            bestIdx = i;
        }
    }
    var part = parts[bestIdx];
    if (!part)
        return null;
    return { part: part, index: bestIdx, voice: detectMelodyVoice(part) };
}
function getOtherParts(score, melodyIndex) {
    var _a;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    return parts.filter(function (_, i) { return i !== melodyIndex; });
}
function getMeasureNumber(m, fallback) {
    var n = Number(m === null || m === void 0 ? void 0 : m.number);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
function findEventAtTime(events, t) {
    var _a;
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var e = events_1[_i];
        var et = Number(e.t);
        var ed = Number(e.dur);
        if (!Number.isFinite(et) || !Number.isFinite(ed))
            continue;
        if (et <= t && t < et + ed)
            return e;
    }
    return (_a = events.find(function (e) { return Number(e.t) === t; })) !== null && _a !== void 0 ? _a : null;
}
function findLastNoteBefore(events, t) {
    var best = null;
    var bestT = -Infinity;
    for (var _i = 0, events_2 = events; _i < events_2.length; _i++) {
        var e = events_2[_i];
        if (!e || e.type !== "note" || e.isRest)
            continue;
        var et = Number(e.t);
        if (!Number.isFinite(et))
            continue;
        if (et <= t && et >= bestT) {
            best = e;
            bestT = et;
        }
    }
    return best;
}
function cloneWithRhythm(params) {
    var source = params.source, template = params.template, idPrefix = params.idPrefix, _a = params.voiceFallback, voiceFallback = _a === void 0 ? 1 : _a, _b = params.staffFallback, staffFallback = _b === void 0 ? 1 : _b;
    var t = Number(template === null || template === void 0 ? void 0 : template.t);
    var dur = Number(template === null || template === void 0 ? void 0 : template.dur);
    var baseVoice = Number(source === null || source === void 0 ? void 0 : source.voice);
    var baseStaff = Number(source === null || source === void 0 ? void 0 : source.staff);
    var voice = Number.isFinite(baseVoice) ? baseVoice : voiceFallback;
    var staff = Number.isFinite(baseStaff) ? baseStaff : staffFallback;
    var id = "".concat(idPrefix, "_").concat(t, "_").concat(dur);
    if (!source || source.type === "rest" || source.isRest) {
        return { id: id, t: t, dur: dur, type: "rest", voice: voice, staff: staff, isRest: true };
    }
    var pitch = source === null || source === void 0 ? void 0 : source.pitch;
    var midi = source === null || source === void 0 ? void 0 : source.midi;
    return {
        id: id,
        t: t,
        dur: dur,
        type: "note",
        voice: voice,
        staff: staff,
        pitch: pitch,
        midi: midi
    };
}
function applyChoralRhythmFromMelody(score) {
    var _a, _b, _c, _d, _e, _f, _g;
    var warnings = [];
    var melodyInfo = getMelodyPart(score);
    if (!melodyInfo) {
        warn(warnings, "[rhythm] No melody part found. Choral accompaniment not applied.");
        return { applied: false, warnings: warnings };
    }
    var melodyPart = melodyInfo.part;
    var melodyVoice = melodyInfo.voice;
    var otherParts = getOtherParts(score, melodyInfo.index);
    if (!otherParts.length) {
        warn(warnings, "[rhythm] No inner/Bass parts found. Choral accompaniment not applied.");
        return { applied: false, warnings: warnings };
    }
    var melodyMeasures = (_a = melodyPart.measures) !== null && _a !== void 0 ? _a : [];
    var measureCount = melodyMeasures.length;
    if (!measureCount) {
        warn(warnings, "[rhythm] Melody part has no measures. Choral accompaniment not applied.");
        return { applied: false, warnings: warnings };
    }
    for (var i = 0; i < measureCount; i++) {
        var melM = melodyMeasures[i];
        if (!melM)
            continue;
        var melEvents = ((_b = melM.events) !== null && _b !== void 0 ? _b : [])
            .filter(function (e) { return isNoteOrRest(e); })
            .filter(function (e) { return (melodyVoice === null || melodyVoice === undefined ? true : (e === null || e === void 0 ? void 0 : e.voice) === melodyVoice); })
            .sort(function (a, b) { return Number(a.t) - Number(b.t); });
        if (!melEvents.length)
            continue;
        for (var _i = 0, otherParts_1 = otherParts; _i < otherParts_1.length; _i++) {
            var part = otherParts_1[_i];
            var m = (_c = part === null || part === void 0 ? void 0 : part.measures) === null || _c === void 0 ? void 0 : _c[i];
            if (!m)
                continue;
            var measureNumber = getMeasureNumber(m, i + 1);
            var events = ((_d = m.events) !== null && _d !== void 0 ? _d : []).filter(function (e) { return isNoteOrRest(e); });
            var other = ((_e = m.events) !== null && _e !== void 0 ? _e : []).filter(function (e) { return !isNoteOrRest(e); });
            var nextEvents = [];
            for (var j = 0; j < melEvents.length; j++) {
                var template = melEvents[j];
                if (!template || !Number.isFinite(Number(template.t)) || !Number.isFinite(Number(template.dur)))
                    continue;
                var t = Number(template.t);
                var source = findEventAtTime(events, t);
                if (!source || source.type === "rest" || source.isRest) {
                    var fallback = findLastNoteBefore(events, t);
                    if (fallback)
                        source = fallback;
                }
                var idPrefix = "".concat((_g = (_f = part.part_id) !== null && _f !== void 0 ? _f : part.name) !== null && _g !== void 0 ? _g : "part", "_m").concat(measureNumber, "_i").concat(j);
                nextEvents.push(cloneWithRhythm({ source: source, template: template, idPrefix: idPrefix }));
            }
            m.events = __spreadArray(__spreadArray([], other, true), nextEvents, true).sort(function (a, b) { var _a, _b; return Number((_a = a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = b.t) !== null && _b !== void 0 ? _b : 0); });
        }
    }
    // eslint-disable-next-line no-console
    console.log("[rhythm] Choral accompaniment: copied melody rhythm to inner voices and Bass.");
    return { applied: true, warnings: warnings };
}
