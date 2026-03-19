"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.direction = direction;
exports.melodicPrimitive = melodicPrimitive;
exports.relativeMotion = relativeMotion;
exports.intervalClass = intervalClass;
exports.verticalInterval = verticalInterval;
function direction(a, b) {
    if (a === null || b === null)
        return "static";
    if (b > a)
        return "up";
    if (b < a)
        return "down";
    return "static";
}
function melodicPrimitive(a, b) {
    if (a === null || b === null)
        return "step";
    var d = Math.abs(b - a);
    if (d === 0)
        return "step";
    if (d === 1)
        return "half_step";
    if (d === 2)
        return "whole_step";
    if (d === 3 || d === 4)
        return "skip";
    return "leap";
}
function relativeMotion(a0, a1, b0, b1) {
    var da = direction(a0, a1);
    var db = direction(b0, b1);
    if (da === "static" || db === "static")
        return "oblique";
    if (da === db) {
        var ia = a0 === null || a1 === null ? 0 : Math.abs(a1 - a0);
        var ib = b0 === null || b1 === null ? 0 : Math.abs(b1 - b0);
        return ia === ib ? "parallel" : "similar";
    }
    return "contrary";
}
function intervalClass(semitones) {
    var pc = ((semitones % 12) + 12) % 12;
    if (pc === 0 || pc === 7)
        return "perfect";
    if (pc === 3 || pc === 4 || pc === 8 || pc === 9)
        return "imperfect";
    return "dissonant";
}
function verticalInterval(a, b) {
    if (a === null || b === null)
        return null;
    return Math.abs(a - b);
}
