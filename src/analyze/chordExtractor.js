"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractOnsetChords = extractOnsetChords;
var instrumentCatalog_1 = require("../instruments/instrumentCatalog");
function extractOnsetChords(score) {
    var _a, _b, _c;
    var out = [];
    for (var _i = 0, _d = score.parts; _i < _d.length; _i++) {
        var part = _d[_i];
        for (var _e = 0, _f = part.measures; _e < _f.length; _e++) {
            var m = _f[_e];
            var byT = {};
            for (var _g = 0, _h = m.events; _g < _h.length; _g++) {
                var ev = _h[_g];
                if (ev.type !== "note")
                    continue;
                var t = (_a = ev.t) !== null && _a !== void 0 ? _a : 0;
                if (!byT[t])
                    byT[t] = { measure: m.number, t: t, notes: [] };
                var p = { step: ev.pitch.step, alter: ev.pitch.alter, octave: ev.pitch.octave };
                var midi = (0, instrumentCatalog_1.pitchToMidi)(p);
                byT[t].notes.push({
                    id: ev.id,
                    midi: midi,
                    pitch: p,
                    staff: (_b = ev.staff) !== null && _b !== void 0 ? _b : 1,
                    voice: (_c = ev.voice) !== null && _c !== void 0 ? _c : 1
                });
            }
            var times = Object.keys(byT).map(Number).sort(function (a, b) { return a - b; });
            for (var _j = 0, times_1 = times; _j < times_1.length; _j++) {
                var t = times_1[_j];
                out.push(byT[t]);
            }
        }
    }
    return out;
}
