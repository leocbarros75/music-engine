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
exports.arrangeStringQuartetFromPianoInstrumentation = arrangeStringQuartetFromPianoInstrumentation;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
function warn(warnings, msg) {
    if (!warnings)
        return;
    warnings.push(msg);
}
function clone(value) {
    return JSON.parse(JSON.stringify(value));
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
function resolveStaff(ev) {
    var staff = Number(ev === null || ev === void 0 ? void 0 : ev.staff);
    if (staff === 2)
        return 2;
    if (staff === 1)
        return 1;
    var midi = eventMidi(ev);
    if (typeof midi === "number" && midi < 60)
        return 2;
    return 1;
}
function measureEventSort(a, b) {
    var _a, _b, _c, _d;
    var dt = Number((_a = a === null || a === void 0 ? void 0 : a.t) !== null && _a !== void 0 ? _a : 0) - Number((_b = b === null || b === void 0 ? void 0 : b.t) !== null && _b !== void 0 ? _b : 0);
    if (Math.abs(dt) > 1e-9)
        return dt;
    var da = Number((_c = a === null || a === void 0 ? void 0 : a.dur) !== null && _c !== void 0 ? _c : 0);
    var db = Number((_d = b === null || b === void 0 ? void 0 : b.dur) !== null && _d !== void 0 ? _d : 0);
    if (Math.abs(da - db) > 1e-9)
        return db - da;
    return 0;
}
function quantizeOnset(t) {
    // Group near-simultaneous notes into one onset while preserving 16th-note events.
    var grid = 64; // 1/64 beat
    return Math.round(t * grid) / grid;
}
function onsetKey(t) {
    return quantizeOnset(t).toFixed(6);
}
function clampMidiToAbsoluteRange(midi, instrumentId) {
    var spec = (0, instrumentCatalog_1.getInstrumentSpec)(instrumentId);
    if (!spec)
        return midi;
    var lo = Number(spec.midi_low);
    var hi = Number(spec.midi_high);
    if (Number.isFinite(lo) && Number.isFinite(hi) && midi >= lo && midi <= hi) {
        return midi;
    }
    var m = midi;
    while (Number.isFinite(lo) && m < lo)
        m += 12;
    while (Number.isFinite(hi) && m > hi)
        m -= 12;
    if (Number.isFinite(lo) && m < lo)
        m = lo;
    if (Number.isFinite(hi) && m > hi)
        m = hi;
    return m;
}
function findPianoPart(score) {
    var _a;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var byInstrument = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.instrument) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("piano"); });
    if (byInstrument)
        return byInstrument;
    var byName = parts.find(function (p) { var _a; return String((_a = p === null || p === void 0 ? void 0 : p.name) !== null && _a !== void 0 ? _a : "").toLowerCase().includes("piano"); });
    if (byName)
        return byName;
    var byStaves = parts.find(function (p) { var _a; return Number((_a = p === null || p === void 0 ? void 0 : p.staves) !== null && _a !== void 0 ? _a : 1) >= 2; });
    if (byStaves)
        return byStaves;
    return null;
}
function makePart(partId, name, instrument, measures) {
    var clonedMeasures = measures.map(function (m, i) {
        var _a;
        return (__assign(__assign({ number: Number((_a = m === null || m === void 0 ? void 0 : m.number) !== null && _a !== void 0 ? _a : i + 1) }, (i === 0 && (m === null || m === void 0 ? void 0 : m.attributes) ? { attributes: clone(m.attributes) } : {})), { events: [] }));
    });
    return {
        part_id: partId,
        name: name,
        instrument: instrument,
        staves: 1,
        measures: clonedMeasures
    };
}
function pushMappedNote(targetMeasure, source, instrumentId, idPrefix, seq, options) {
    var _a, _b, _c, _d;
    var t = Number.isFinite(options === null || options === void 0 ? void 0 : options.t) ? Number(options === null || options === void 0 ? void 0 : options.t) : Number((_a = source.ev) === null || _a === void 0 ? void 0 : _a.t);
    var dur = Number.isFinite(options === null || options === void 0 ? void 0 : options.dur) ? Number(options === null || options === void 0 ? void 0 : options.dur) : Number((_b = source.ev) === null || _b === void 0 ? void 0 : _b.dur);
    if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0)
        return;
    var clampedMidi = clampMidiToAbsoluteRange(source.midi, instrumentId);
    var tieStart = ((_c = source.ev) === null || _c === void 0 ? void 0 : _c.tieStart) === true;
    var tieStop = ((_d = source.ev) === null || _d === void 0 ? void 0 : _d.tieStop) === true;
    targetMeasure.events.push(__assign(__assign(__assign({ id: "".concat(idPrefix, "-").concat(targetMeasure.number, "-").concat(seq), t: t, dur: dur, type: "note", pitch: (0, instrumentCatalog_1.midiToPitch)(clampedMidi), voice: 1, staff: 1 }, (tieStart ? { tieStart: true } : {})), (tieStop ? { tieStop: true } : {})), ((options === null || options === void 0 ? void 0 : options.chord) === true ? { chord: true } : {})));
}
function selectNotesForOnset(events) {
    return events
        .map(function (ev) {
        var midi = eventMidi(ev);
        if (typeof midi !== "number")
            return null;
        return { ev: ev, midi: midi };
    })
        .filter(function (x) { return !!x; })
        .sort(function (a, b) {
        var _a, _b, _c, _d;
        if (a.midi !== b.midi)
            return a.midi - b.midi;
        var ad = Number((_b = (_a = a.ev) === null || _a === void 0 ? void 0 : _a.dur) !== null && _b !== void 0 ? _b : 0);
        var bd = Number((_d = (_c = b.ev) === null || _c === void 0 ? void 0 : _c.dur) !== null && _d !== void 0 ? _d : 0);
        return ad - bd;
    });
}
function arrangeStringQuartetFromPianoInstrumentation(score, options) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (options === void 0) { options = {}; }
    var warnings = options.warnings;
    var pianoPart = findPianoPart(score);
    if (!pianoPart) {
        warn(warnings, "[strings] Instrumentation copy: piano part not found; returning original score.");
        return score;
    }
    var sourceMeasures = Array.isArray(pianoPart === null || pianoPart === void 0 ? void 0 : pianoPart.measures) ? pianoPart.measures : [];
    var violin1 = makePart("P_V1", "Violin I", "violin_1", sourceMeasures);
    var violin2 = makePart("P_V2", "Violin II", "violin_2", sourceMeasures);
    var viola = makePart("P_VA", "Viola", "viola", sourceMeasures);
    var cello = makePart("P_VC", "Cello", "cello", sourceMeasures);
    var seq = 0;
    for (var mi = 0; mi < sourceMeasures.length; mi++) {
        var srcMeasure = (_a = sourceMeasures[mi]) !== null && _a !== void 0 ? _a : {};
        var srcEvents = Array.isArray(srcMeasure === null || srcMeasure === void 0 ? void 0 : srcMeasure.events) ? srcMeasure.events : [];
        var noteEvents = srcEvents
            .filter(function (ev) { return (ev === null || ev === void 0 ? void 0 : ev.type) === "note"; })
            .sort(measureEventSort);
        var rhByOnset = new Map();
        var lhByOnset = new Map();
        for (var _i = 0, noteEvents_1 = noteEvents; _i < noteEvents_1.length; _i++) {
            var ev = noteEvents_1[_i];
            var t = Number(ev === null || ev === void 0 ? void 0 : ev.t);
            if (!Number.isFinite(t))
                continue;
            var key = onsetKey(t);
            var staff = resolveStaff(ev);
            var map = staff === 2 ? lhByOnset : rhByOnset;
            var bucket = (_b = map.get(key)) !== null && _b !== void 0 ? _b : [];
            bucket.push(ev);
            map.set(key, bucket);
        }
        var v1m = violin1.measures[mi];
        var v2m = violin2.measures[mi];
        var vam = viola.measures[mi];
        var vcm = cello.measures[mi];
        var violaOverrideByOnset = new Map();
        // RH mapping:
        // - top RH note -> Violin I
        // - inner RH note (highest note below top) -> Violin II
        // - RH unison/single-note case: Violin II may double Violin I
        // - fallback: if RH has 3 notes and LH is absent at this onset,
        //   Viola takes the bottom RH note.
        // - if RH has 3 notes and LH top doubles LH bass, Viola takes bottom RH note.
        // - if RH has 3 notes and LH top is different from LH bass, Violin II plays divisi
        //   (inner RH + bottom RH).
        for (var _j = 0, _k = Array.from(rhByOnset.keys()).sort(); _j < _k.length; _j++) {
            var key = _k[_j];
            var onset = Number(key);
            var selected = selectNotesForOnset((_c = rhByOnset.get(key)) !== null && _c !== void 0 ? _c : []);
            if (!selected.length)
                continue;
            var lhSelectedAtOnset = selectNotesForOnset((_d = lhByOnset.get(key)) !== null && _d !== void 0 ? _d : []);
            var hasLhOnset = lhSelectedAtOnset.length > 0;
            var top_1 = selected[selected.length - 1];
            var bottom = selected[0];
            pushMappedNote(v1m, top_1, "violin_1", "v1", ++seq, { t: onset });
            if (selected.length === 1) {
                // RH unison/melody-only onset: allow Violin II to double Violin I.
                pushMappedNote(v2m, top_1, "violin_2", "v2-unison", ++seq, { t: onset });
            }
            if (selected.length > 1 && selected.length !== 4) {
                var inner = selected[selected.length - 2];
                pushMappedNote(v2m, inner, "violin_2", "v2", ++seq, { t: onset });
            }
            if (selected.length !== 3 && !hasLhOnset) {
                // Requested instrumentation rule:
                // when RH is not a triad and LH has no onset note, Viola takes RH bottom note
                // even if Violin II is already on the same pitch.
                violaOverrideByOnset.set(key, bottom);
            }
            if (selected.length === 3) {
                var lhSelected = lhSelectedAtOnset;
                var hasLhTopVoice = lhSelected.length >= 2;
                if (!hasLhTopVoice) {
                    // Strict rule: with RH triad and no LH top voice, Viola takes bottom RH note.
                    violaOverrideByOnset.set(key, bottom);
                }
                else {
                    // Violin II divisi: add bottom RH note alongside the inner RH note.
                    var inner = selected[selected.length - 2];
                    if (bottom.midi !== inner.midi) {
                        var innerDur = Number((_e = inner.ev) === null || _e === void 0 ? void 0 : _e.dur);
                        pushMappedNote(v2m, bottom, "violin_2", "v2-divisi", ++seq, __assign(__assign({ t: onset }, (Number.isFinite(innerDur) && innerDur > 0 ? { dur: innerDur } : {})), { chord: true }));
                    }
                }
            }
            if (selected.length === 4) {
                // Violin II takes both middle RH notes (divisi).
                var middleHighSrc = selected[selected.length - 2];
                var middleLowSrc = selected[selected.length - 3];
                var highDur = Number((_f = middleHighSrc.ev) === null || _f === void 0 ? void 0 : _f.dur);
                var lowDur = Number((_g = middleLowSrc.ev) === null || _g === void 0 ? void 0 : _g.dur);
                var sharedDur = Number.isFinite(highDur) && highDur > 0 && Number.isFinite(lowDur) && lowDur > 0
                    ? Math.min(highDur, lowDur)
                    : undefined;
                pushMappedNote(v2m, { ev: middleHighSrc.ev, midi: middleHighSrc.midi }, "violin_2", "v2-mid-high", ++seq, __assign({ t: onset }, (typeof sharedDur === "number" ? { dur: sharedDur } : {})));
                if (middleLowSrc.midi !== middleHighSrc.midi) {
                    pushMappedNote(v2m, { ev: middleLowSrc.ev, midi: middleLowSrc.midi }, "violin_2", "v2-mid-low", ++seq, __assign(__assign({ t: onset }, (typeof sharedDur === "number" ? { dur: sharedDur } : {})), { chord: true }));
                }
                // Viola takes RH bottom only when LH top is missing OR LH top doubles LH bass.
                var lhSelected = lhSelectedAtOnset;
                var hasLhTopVoice = lhSelected.length >= 2;
                var lhBottom = lhSelected.length > 0 ? lhSelected[0] : null;
                var lhTop = hasLhTopVoice ? lhSelected[lhSelected.length - 1] : null;
                var lhTopDoublesBass = !!lhBottom && !!lhTop && ((lhTop.midi % 12 + 12) % 12) === ((lhBottom.midi % 12 + 12) % 12);
                if (!hasLhTopVoice || lhTopDoublesBass) {
                    violaOverrideByOnset.set(key, bottom);
                }
            }
        }
        // LH mapping:
        // - top LH note -> Viola
        // - bottom LH note -> Cello
        for (var _l = 0, _m = Array.from(lhByOnset.keys()).sort(); _l < _m.length; _l++) {
            var key = _m[_l];
            var selected = selectNotesForOnset((_h = lhByOnset.get(key)) !== null && _h !== void 0 ? _h : []);
            if (!selected.length)
                continue;
            var bottom = selected[0];
            var top_2 = selected[selected.length - 1];
            var violaOverride = violaOverrideByOnset.get(key);
            if (violaOverride) {
                pushMappedNote(vam, violaOverride, "viola", "va-rh-override", ++seq);
            }
            else {
                pushMappedNote(vam, top_2, "viola", "va", ++seq);
            }
            pushMappedNote(vcm, bottom, "cello", "vc", ++seq);
        }
        // Apply Viola overrides for RH onsets where LH is missing.
        for (var _o = 0, violaOverrideByOnset_1 = violaOverrideByOnset; _o < violaOverrideByOnset_1.length; _o++) {
            var _p = violaOverrideByOnset_1[_o], key = _p[0], violaSource = _p[1];
            if (lhByOnset.has(key))
                continue;
            pushMappedNote(vam, violaSource, "viola", "va-rh-fallback", ++seq);
        }
        v1m.events.sort(measureEventSort);
        v2m.events.sort(measureEventSort);
        vam.events.sort(measureEventSort);
        vcm.events.sort(measureEventSort);
    }
    warn(warnings, "[strings] Instrumentation copy applied: RH top->Violin I, RH inner->Violin II, LH top->Viola, LH bottom->Cello.");
    return __assign(__assign({}, score), { meta: __assign(__assign({}, score.meta), { ensemble: "string_ensemble" }), parts: [violin1, violin2, viola, cello] });
}
