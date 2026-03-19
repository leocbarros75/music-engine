"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pitchToMidi = pitchToMidi;
exports.midiToPc = midiToPc;
exports.pcToName = pcToName;
exports.normalizeTonicName = normalizeTonicName;
exports.tonicNameToPc = tonicNameToPc;
var BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function pitchToMidi(p) {
    var _a, _b, _c;
    var step = ((_a = p.step) !== null && _a !== void 0 ? _a : "C").toUpperCase();
    var semis = ((_b = BASE[step]) !== null && _b !== void 0 ? _b : 0) + ((_c = p.alter) !== null && _c !== void 0 ? _c : 0);
    return (p.octave + 1) * 12 + semis;
}
function midiToPc(m) {
    var pc = ((m % 12) + 12) % 12;
    return pc;
}
function pcToName(pc, preferSharps) {
    if (preferSharps === void 0) { preferSharps = true; }
    var sharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    var flat = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
    var i = ((pc % 12) + 12) % 12;
    return preferSharps ? sharp[i] : flat[i];
}
function normalizeTonicName(s) {
    var t = (s !== null && s !== void 0 ? s : "").trim();
    if (!t)
        return "C";
    var u = t[0].toUpperCase() + t.slice(1);
    return u.replace("♯", "#").replace("♭", "b");
}
function tonicNameToPc(tonic) {
    var _a;
    var t = normalizeTonicName(tonic);
    var map = {
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
    return (_a = map[t]) !== null && _a !== void 0 ? _a : 0;
}
