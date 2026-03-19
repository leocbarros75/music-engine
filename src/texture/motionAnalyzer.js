"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeMotion = analyzeMotion;
function motionDir(prev, next) {
    if (next > prev)
        return 1;
    if (next < prev)
        return -1;
    return 0;
}
function pc(midi) {
    return ((midi % 12) + 12) % 12;
}
function isPerfect(intervalPc) {
    return intervalPc === 0 || intervalPc === 7;
}
function analyzeMotion(voiceA, voiceB) {
    var n = Math.min(voiceA.length, voiceB.length);
    if (n < 2) {
        return {
            total: 0,
            parallel: 0,
            similar: 0,
            contrary: 0,
            oblique: 0,
            parallelPerfect: 0
        };
    }
    var parallel = 0;
    var similar = 0;
    var contrary = 0;
    var oblique = 0;
    var parallelPerfect = 0;
    for (var i = 0; i < n - 1; i++) {
        var a1 = voiceA[i];
        var a2 = voiceA[i + 1];
        var b1 = voiceB[i];
        var b2 = voiceB[i + 1];
        var dirA = motionDir(a1.midi, a2.midi);
        var dirB = motionDir(b1.midi, b2.midi);
        if (dirA === 0 && dirB === 0)
            continue;
        if (dirA === 0 || dirB === 0) {
            oblique++;
            continue;
        }
        if (dirA === dirB) {
            var int1 = pc(a1.midi - b1.midi);
            var int2 = pc(a2.midi - b2.midi);
            if (int1 === int2) {
                parallel++;
                if (isPerfect(int1) && isPerfect(int2))
                    parallelPerfect++;
            }
            else {
                similar++;
            }
        }
        else {
            contrary++;
        }
    }
    var total = parallel + similar + contrary + oblique;
    return { total: total, parallel: parallel, similar: similar, contrary: contrary, oblique: oblique, parallelPerfect: parallelPerfect };
}
