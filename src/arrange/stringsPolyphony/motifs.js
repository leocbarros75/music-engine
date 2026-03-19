"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.captureMotif = captureMotif;
exports.scheduleImitation = scheduleImitation;
exports.motifMidiAtSlice = motifMidiAtSlice;
function captureMotif(slices) {
    var entries = slices.filter(function (s) { return typeof s.melodyMidi === "number"; });
    if (entries.length < 3)
        return null;
    var start = entries[0];
    var motifSlices = entries.slice(0, 4);
    var base = start.melodyMidi;
    var intervals = motifSlices.map(function (s) { return s.melodyMidi - base; });
    var durations = motifSlices.map(function (s) { return s.dur; });
    return {
        intervals: intervals,
        durations: durations,
        startSlice: slices.indexOf(motifSlices[0]),
        length: intervals.length,
        baseMidi: base
    };
}
function scheduleImitation(motif, config, slices) {
    var _a, _b, _c;
    if (!motif || !config.enabled)
        return [];
    var entries = [];
    var delays = ((_a = config.delayBeats) === null || _a === void 0 ? void 0 : _a.length) ? config.delayBeats : [4];
    var transposes = ((_b = config.transposeSemitones) === null || _b === void 0 ? void 0 : _b.length) ? config.transposeSemitones : [7];
    var voices = ((_c = config.voices) === null || _c === void 0 ? void 0 : _c.length) ? config.voices : ["vln2"];
    for (var _i = 0, voices_1 = voices; _i < voices_1.length; _i++) {
        var voice = voices_1[_i];
        for (var _d = 0, delays_1 = delays; _d < delays_1.length; _d++) {
            var delay = delays_1[_d];
            for (var _e = 0, transposes_1 = transposes; _e < transposes_1.length; _e++) {
                var transpose = transposes_1[_e];
                var startSlice = findSliceByOffset(slices, motif.startSlice, delay);
                if (startSlice === null)
                    continue;
                entries.push({ voice: voice, startSlice: startSlice, transpose: transpose });
                if (entries.length >= (config.maxOverlaps || 1))
                    return entries;
            }
        }
    }
    return entries;
}
function motifMidiAtSlice(motif, entry, sliceIndex) {
    var idx = sliceIndex - entry.startSlice;
    if (idx < 0 || idx >= motif.length)
        return null;
    return motif.baseMidi + motif.intervals[idx] + entry.transpose;
}
function findSliceByOffset(slices, startSlice, delayBeats) {
    var _a, _b, _c, _d;
    var targetTime = (_b = (_a = slices[startSlice]) === null || _a === void 0 ? void 0 : _a.t) !== null && _b !== void 0 ? _b : 0;
    var targetMeasure = (_d = (_c = slices[startSlice]) === null || _c === void 0 ? void 0 : _c.measure) !== null && _d !== void 0 ? _d : 1;
    var targetBeat = targetTime + delayBeats;
    for (var i = startSlice + 1; i < slices.length; i++) {
        var s = slices[i];
        if (s.measure === targetMeasure && s.t >= targetBeat)
            return i;
        if (s.measure > targetMeasure) {
            if (s.t >= (targetBeat % 4))
                return i;
            return i;
        }
    }
    return null;
}
