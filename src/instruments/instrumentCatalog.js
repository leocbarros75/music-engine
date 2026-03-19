"use strict";
// src/instruments/instrumentCatalog.ts
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
exports.InstrumentCatalog = void 0;
exports.pitchToMidi = pitchToMidi;
exports.midiToPitch = midiToPitch;
exports.shiftOctavesIntoRange = shiftOctavesIntoRange;
exports.getInstrumentSpec = getInstrumentSpec;
exports.clampMidiToInstrumentRange = clampMidiToInstrumentRange;
exports.clampPitchToInstrumentRange = clampPitchToInstrumentRange;
exports.enforceInstrumentRangesOnScore = enforceInstrumentRangesOnScore;
var base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchToMidi(p) {
    var _a, _b;
    var step = p.step.toUpperCase();
    var semis = ((_a = base[step]) !== null && _a !== void 0 ? _a : 0) + ((_b = p.alter) !== null && _b !== void 0 ? _b : 0);
    return (p.octave + 1) * 12 + semis;
}
function midiToPitch(m) {
    var _a;
    var pc = ((m % 12) + 12) % 12;
    var octave = Math.floor(m / 12) - 1;
    var map = [
        { step: "C" },
        { step: "C", alter: 1 },
        { step: "D" },
        { step: "D", alter: 1 },
        { step: "E" },
        { step: "F" },
        { step: "F", alter: 1 },
        { step: "G" },
        { step: "G", alter: 1 },
        { step: "A" },
        { step: "A", alter: 1 },
        { step: "B" }
    ];
    var sp = (_a = map[pc]) !== null && _a !== void 0 ? _a : { step: "C" };
    return { step: sp.step, alter: sp.alter, octave: octave };
}
function shiftOctavesIntoRange(midi, lo, hi) {
    var m = midi;
    while (m < lo)
        m += 12;
    while (m > hi)
        m -= 12;
    if (m < lo)
        m = lo;
    if (m > hi)
        m = hi;
    return m;
}
exports.InstrumentCatalog = {
    piano: {
        id: "piano",
        name: "Piano",
        clef: "treble",
        midi_low: 21,
        midi_high: 108,
        preferred_low: 36,
        preferred_high: 96
    },
    violin_1: {
        id: "violin_1",
        name: "Violin I",
        clef: "treble",
        midi_low: 55, // G3
        midi_high: 103, // E7
        preferred_low: 57, // A3
        preferred_high: 95 // B6
    },
    violin_2: {
        id: "violin_2",
        name: "Violin II",
        clef: "treble",
        midi_low: 55, // G3
        midi_high: 103, // E7
        preferred_low: 57, // A3
        preferred_high: 93 // A6
    },
    viola: {
        id: "viola",
        name: "Viola",
        clef: "alto",
        midi_low: 48, // C3
        midi_high: 93, // A6
        preferred_low: 55, // G3
        preferred_high: 74 // D5
    },
    cello: {
        id: "cello",
        name: "Cello",
        clef: "bass",
        midi_low: 36, // C2
        midi_high: 84, // C6
        preferred_low: 43, // G2
        preferred_high: 64 // E4
    },
    double_bass: {
        id: "double_bass",
        name: "Double Bass",
        clef: "bass",
        midi_low: 28, // E1
        midi_high: 67, // G4
        preferred_low: 31, // G1
        preferred_high: 55 // G3
    },
    // ---- Woodwinds (concert pitch) ----
    flute: {
        id: "flute",
        name: "Flute",
        clef: "treble",
        midi_low: 60, // C4
        midi_high: 98, // D7
        preferred_low: 67, // G4
        preferred_high: 93 // A6
    },
    oboe: {
        id: "oboe",
        name: "Oboe",
        clef: "treble",
        midi_low: 58, // Bb3
        midi_high: 93, // A6
        preferred_low: 62, // D4
        preferred_high: 88 // E6
    },
    clarinet_bb: {
        id: "clarinet_bb",
        name: "Clarinet in Bb (concert view)",
        clef: "treble",
        midi_low: 50, // D3
        midi_high: 94, // Bb6
        preferred_low: 55, // G3
        preferred_high: 88 // E6
    },
    bassoon: {
        id: "bassoon",
        name: "Bassoon",
        clef: "bass",
        midi_low: 34, // Bb1
        midi_high: 76, // E5
        preferred_low: 41, // F2
        preferred_high: 60 // C4
    },
    // ---- Brass (concert pitch) ----
    trumpet_bb_1: {
        id: "trumpet_bb_1",
        name: "Trumpet 1 (Bb, concert view)",
        clef: "treble",
        midi_low: 54, // F#3 (absolute edge)
        midi_high: 86, // D6
        preferred_low: 58, // Bb3
        preferred_high: 82 // Bb5
    },
    trumpet_bb_2: {
        id: "trumpet_bb_2",
        name: "Trumpet 2 (Bb, concert view)",
        clef: "treble",
        midi_low: 54,
        midi_high: 84, // C6
        preferred_low: 58,
        preferred_high: 79 // G5
    },
    horn_f: {
        id: "horn_f",
        name: "Horn (F, concert view)",
        clef: "treble",
        midi_low: 35, // B1
        midi_high: 77, // F5
        preferred_low: 43, // G2
        preferred_high: 72 // C5
    },
    trombone: {
        id: "trombone",
        name: "Trombone",
        clef: "bass",
        midi_low: 40, // E2
        midi_high: 70, // Bb4
        preferred_low: 46, // Bb2
        preferred_high: 65 // F4
    },
    tuba_c: {
        id: "tuba_c",
        name: "Tuba (C)",
        clef: "bass",
        midi_low: 26, // D1
        midi_high: 65, // F4
        preferred_low: 34, // Bb1
        preferred_high: 58 // Bb3
    },
    // ---- Pitched percussion (concert pitch) ----
    timpani: {
        id: "timpani",
        name: "Timpani",
        clef: "bass",
        midi_low: 38, // D2
        midi_high: 57, // A3
        preferred_low: 46, // Bb2
        preferred_high: 50 // D3
    },
    glockenspiel: {
        id: "glockenspiel",
        name: "Glockenspiel (Bells, sounding)",
        clef: "treble",
        midi_low: 91, // G6
        midi_high: 120, // C9
        preferred_low: 96, // C7
        preferred_high: 115 // G8
    },
    tubular_bells: {
        id: "tubular_bells",
        name: "Tubular Bells (Chimes)",
        clef: "treble",
        midi_low: 60, // C4
        midi_high: 84, // C6
        preferred_low: 62, // D4
        preferred_high: 81 // A5
    },
    vibraphone: {
        id: "vibraphone",
        name: "Vibraphone",
        clef: "treble",
        midi_low: 53, // F3
        midi_high: 89, // F6
        preferred_low: 57, // A3
        preferred_high: 86 // D6
    },
    marimba: {
        id: "marimba",
        name: "Marimba",
        clef: "treble",
        midi_low: 36, // C2
        midi_high: 96, // C7
        preferred_low: 41, // F2
        preferred_high: 84 // C6
    },
    xylophone: {
        id: "xylophone",
        name: "Xylophone (sounding)",
        clef: "treble",
        midi_low: 77, // F5
        midi_high: 108, // C8 (safe ceiling here)
        preferred_low: 79, // G5
        preferred_high: 103 // E7
    }
};
function normalizeInstrumentId(raw) {
    var s = (raw !== null && raw !== void 0 ? raw : "").trim().toLowerCase();
    // common part ids from your exporters/mappers
    if (s === "v1" || s === "violin1" || s === "violin_i" || s === "violin i")
        return "violin_1";
    if (s === "v2" || s === "violin2" || s === "violin_ii" || s === "violin ii")
        return "violin_2";
    if (s === "va" || s === "vla")
        return "viola";
    if (s === "vc" || s === "vlc")
        return "cello";
    if (s === "db" || s === "doublebass" || s === "double_bass" || s === "contrabass")
        return "double_bass";
    // winds/brass aliases (just in case)
    if (s === "tpt1")
        return "trumpet_bb_1";
    if (s === "tpt2")
        return "trumpet_bb_2";
    if (s === "hn")
        return "horn_f";
    if (s === "tbn")
        return "trombone";
    if (s === "tuba")
        return "tuba_c";
    return s;
}
function getInstrumentSpec(instrument) {
    var id = normalizeInstrumentId(instrument !== null && instrument !== void 0 ? instrument : "");
    var spec = exports.InstrumentCatalog[id];
    return spec !== null && spec !== void 0 ? spec : null;
}
function clampMidiToInstrumentRange(midi, spec) {
    var absLo = spec.midi_low;
    var absHi = spec.midi_high;
    var prefLo = typeof spec.preferred_low === "number" ? spec.preferred_low : null;
    var prefHi = typeof spec.preferred_high === "number" ? spec.preferred_high : null;
    // try preferred first
    if (prefLo !== null && prefHi !== null) {
        var mPref = shiftOctavesIntoRange(midi, prefLo, prefHi);
        if (mPref >= absLo && mPref <= absHi)
            return mPref;
    }
    // fallback to absolute
    return shiftOctavesIntoRange(midi, absLo, absHi);
}
function clampPitchToInstrumentRange(p, instrument) {
    var spec = getInstrumentSpec(instrument);
    if (!spec)
        return p;
    var m = pitchToMidi(p);
    var m2 = clampMidiToInstrumentRange(m, spec);
    return midiToPitch(m2);
}
/**
 * Enforce ranges for every pitched note in a ScoreModel.
 * - leaves rests + unpitched alone
 * - clamps by shifting octaves into preferred, then absolute
 */
function enforceInstrumentRangesOnScore(score) {
    if (!score || !Array.isArray(score.parts))
        return score;
    var parts = score.parts.map(function (part) {
        var _a;
        var instrument = part === null || part === void 0 ? void 0 : part.instrument;
        var spec = getInstrumentSpec(instrument);
        if (!spec)
            return part;
        var measures = ((_a = part.measures) !== null && _a !== void 0 ? _a : []).map(function (m) {
            var _a;
            var events = ((_a = m.events) !== null && _a !== void 0 ? _a : []).map(function (ev) {
                var _a;
                if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note" || !((_a = ev === null || ev === void 0 ? void 0 : ev.pitch) === null || _a === void 0 ? void 0 : _a.step))
                    return ev;
                var p = ev.pitch;
                var m0 = pitchToMidi(p);
                var m1 = clampMidiToInstrumentRange(m0, spec);
                if (m1 === m0)
                    return ev;
                return __assign(__assign({}, ev), { pitch: midiToPitch(m1) });
            });
            return __assign(__assign({}, m), { events: events });
        });
        return __assign(__assign({}, part), { measures: measures });
    });
    return __assign(__assign({}, score), { parts: parts });
}
