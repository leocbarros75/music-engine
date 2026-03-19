"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDensity = computeDensity;
function computeDensity(score) {
    var _a, _b, _c, _d, _e, _f;
    var parts = (_a = score.parts) !== null && _a !== void 0 ? _a : [];
    var measures = (_d = (_c = (_b = parts[0]) === null || _b === void 0 ? void 0 : _b.measures) === null || _c === void 0 ? void 0 : _c.length) !== null && _d !== void 0 ? _d : 0;
    var perMeasure = new Array(Math.max(0, measures)).fill(0);
    var totalNotes = 0;
    var shortNotes = 0;
    for (var _i = 0, parts_1 = parts; _i < parts_1.length; _i++) {
        var part = parts_1[_i];
        var ms = (_e = part.measures) !== null && _e !== void 0 ? _e : [];
        for (var mi = 0; mi < ms.length; mi++) {
            var m = ms[mi];
            var events = Array.isArray(m === null || m === void 0 ? void 0 : m.events) ? m.events : [];
            for (var _g = 0, events_1 = events; _g < events_1.length; _g++) {
                var ev = events_1[_g];
                if ((ev === null || ev === void 0 ? void 0 : ev.type) !== "note")
                    continue;
                totalNotes += 1;
                perMeasure[mi] = ((_f = perMeasure[mi]) !== null && _f !== void 0 ? _f : 0) + 1;
                var dur = Number(ev === null || ev === void 0 ? void 0 : ev.dur);
                if (Number.isFinite(dur) && dur > 0 && dur < 1)
                    shortNotes += 1;
            }
        }
    }
    var avgNotesPerMeasure = measures > 0 ? totalNotes / measures : totalNotes;
    var rhythmicComplexity = totalNotes > 0 ? shortNotes / totalNotes : 0;
    var densityScore = avgNotesPerMeasure + rhythmicComplexity * 2 + Math.max(0, parts.length - 1) * 0.5;
    var densityLevel = "medium";
    if (densityScore < 4)
        densityLevel = "sparse";
    else if (densityScore >= 8)
        densityLevel = "dense";
    return {
        measures: measures,
        parts: parts.length,
        totalNotes: totalNotes,
        avgNotesPerMeasure: avgNotesPerMeasure,
        densityScore: Number(densityScore.toFixed(2)),
        densityLevel: densityLevel,
        perMeasure: perMeasure
    };
}
