"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRING_RANGES = void 0;
function noteToMidi(note) {
    var _a;
    var match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
    if (!match)
        return 60;
    var step = match[1].toUpperCase();
    var alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
    var octave = Number(match[3]);
    var pcMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var pc = (_a = pcMap[step]) !== null && _a !== void 0 ? _a : 0;
    return (octave + 1) * 12 + pc + alter;
}
var R = function (low, high, prefLow, prefHigh) { return ({
    absMin: noteToMidi(low),
    absMax: noteToMidi(high),
    prefMin: noteToMidi(prefLow),
    prefMax: noteToMidi(prefHigh)
}); };
exports.STRING_RANGES = {
    vln1: R("G3", "C7", "C4", "B6"),
    vln2: R("G3", "C7", "C4", "A6"),
    vla: R("C3", "E6", "G3", "D6"),
    vc: R("C2", "C6", "C2", "B4"),
    cb: R("E1", "C4", "E1", "B2")
};
