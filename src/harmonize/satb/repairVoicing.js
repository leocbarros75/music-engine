"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.repairVoicingForBeat = repairVoicingForBeat;
function pc(midi) {
    return ((midi % 12) + 12) % 12;
}
var TENOR_BASS_ALLOWED_INTERVALS = [7, 8, 9, 10, 11, 12];
var ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];
function intervalPenalty(interval, allowed, weight) {
    if (interval < 0)
        return weight * 2;
    if (allowed.includes(interval))
        return 0;
    var minDiff = Number.POSITIVE_INFINITY;
    for (var _i = 0, allowed_1 = allowed; _i < allowed_1.length; _i++) {
        var a = allowed_1[_i];
        var diff = Math.abs(interval - a);
        if (diff < minDiff)
            minDiff = diff;
    }
    if (!Number.isFinite(minDiff))
        return weight;
    return weight * (1 + minDiff * 0.6);
}
function motionDir(prev, next) {
    if (next > prev)
        return 1;
    if (next < prev)
        return -1;
    return 0;
}
function isPerfectConsonance(intervalPc) {
    return intervalPc === 0 || intervalPc === 7;
}
function isParallelPerfect(params) {
    var prevUpper = params.prevUpper, prevLower = params.prevLower, nextUpper = params.nextUpper, nextLower = params.nextLower;
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (!isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    if (du !== dl)
        return false;
    return true;
}
function isDirectPerfect(params) {
    var prevUpper = params.prevUpper, prevLower = params.prevLower, nextUpper = params.nextUpper, nextLower = params.nextLower;
    var prevInt = pc(prevUpper - prevLower);
    var nextInt = pc(nextUpper - nextLower);
    if (isPerfectConsonance(prevInt))
        return false;
    if (!isPerfectConsonance(nextInt))
        return false;
    var du = motionDir(prevUpper, nextUpper);
    var dl = motionDir(prevLower, nextLower);
    if (du === 0 || dl === 0)
        return false;
    if (du !== dl)
        return false;
    return true;
}
function midiCandidatesForPcInRange(pitchClass, range) {
    var out = [];
    for (var m = range.min; m <= range.max; m++) {
        if (pc(m) === pitchClass)
            out.push(m);
    }
    return out;
}
function makeCandidates(pcs, range, preferPc, restrictToPrefer) {
    var src = pcs.slice();
    if (preferPc !== null && restrictToPrefer)
        src = [preferPc];
    var out = [];
    for (var _i = 0, src_1 = src; _i < src_1.length; _i++) {
        var p = src_1[_i];
        out.push.apply(out, midiCandidatesForPcInRange(p, range));
    }
    return Array.from(new Set(out)).sort(function (a, b) { return a - b; });
}
function orderingOk(params) {
    var bass = params.bass, tenor = params.tenor, alto = params.alto, soprano = params.soprano, allowUnisonD4 = params.allowUnisonD4;
    if (bass >= tenor)
        return false;
    if (alto >= soprano)
        return false;
    if (tenor < alto)
        return true;
    if (allowUnisonD4 && tenor === alto && tenor === 62)
        return true;
    return false;
}
function scoreTriple(params) {
    var bass = params.bass, tenor = params.tenor, alto = params.alto, sopr = params.sopr, prev = params.prev, targets = params.targets;
    var score = 0;
    score += Math.abs(bass - targets.bassTarget) * 0.6;
    score += Math.abs(tenor - targets.tenorTarget) * 0.6;
    score += Math.abs(alto - targets.altoTarget) * 0.6;
    if (prev.prevB !== null)
        score += Math.abs(bass - prev.prevB) * 0.35;
    if (prev.prevT !== null)
        score += Math.abs(tenor - prev.prevT) * 0.35;
    if (prev.prevA !== null)
        score += Math.abs(alto - prev.prevA) * 0.35;
    var tb = tenor - bass;
    var at = alto - tenor;
    var sa = sopr - alto;
    if (tb > 19)
        score += (tb - 19) * 0.5;
    if (at > 12)
        score += (at - 12) * 0.5;
    if (sa > 12)
        score += (sa - 12) * 0.4;
    if (tb > 0)
        score += intervalPenalty(tb, TENOR_BASS_ALLOWED_INTERVALS, 3.5);
    if (at >= 0)
        score += intervalPenalty(at, ALTO_TENOR_ALLOWED_INTERVALS, 3.0);
    if (prev.prevS !== null && prev.prevB !== null) {
        if (isParallelPerfect({
            prevUpper: prev.prevS,
            prevLower: prev.prevB,
            nextUpper: sopr,
            nextLower: bass
        }))
            score += 25;
        if (isDirectPerfect({
            prevUpper: prev.prevS,
            prevLower: prev.prevB,
            nextUpper: sopr,
            nextLower: bass
        }))
            score += 10;
    }
    if (prev.prevS !== null && prev.prevT !== null) {
        if (isParallelPerfect({
            prevUpper: prev.prevS,
            prevLower: prev.prevT,
            nextUpper: sopr,
            nextLower: tenor
        }))
            score += 20;
    }
    return score;
}
function pickBestTriple(params) {
    var bassCands = params.bassCands, tenorCands = params.tenorCands, altoCands = params.altoCands, sopr = params.sopr, prev = params.prev, targets = params.targets, allowUnisonD4 = params.allowUnisonD4, enforceOrdering = params.enforceOrdering;
    var best = null;
    for (var _i = 0, bassCands_1 = bassCands; _i < bassCands_1.length; _i++) {
        var bass = bassCands_1[_i];
        for (var _a = 0, tenorCands_1 = tenorCands; _a < tenorCands_1.length; _a++) {
            var tenor = tenorCands_1[_a];
            for (var _b = 0, altoCands_1 = altoCands; _b < altoCands_1.length; _b++) {
                var alto = altoCands_1[_b];
                if (enforceOrdering) {
                    if (!orderingOk({ bass: bass, tenor: tenor, alto: alto, soprano: sopr, allowUnisonD4: allowUnisonD4 }))
                        continue;
                }
                else {
                    if (alto >= sopr)
                        continue;
                }
                var score = scoreTriple({ bass: bass, tenor: tenor, alto: alto, sopr: sopr, prev: prev, targets: targets });
                if (!best || score < best.score)
                    best = { bass: bass, tenor: tenor, alto: alto, score: score };
            }
        }
    }
    return best;
}
function resolveBassSpelling(params) {
    var bassMidi = params.bassMidi, parsed = params.parsed;
    var bassPc = pc(bassMidi);
    if (parsed.bassSpelling && pcFromSpelling(parsed.bassSpelling) === bassPc)
        return parsed.bassSpelling;
    if (parsed.rootSpelling && pcFromSpelling(parsed.rootSpelling) === bassPc)
        return parsed.rootSpelling;
    return null;
}
function pcFromSpelling(spelling) {
    var _a;
    var STEP_TO_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return (STEP_TO_PC[spelling.step] + ((_a = spelling.alter) !== null && _a !== void 0 ? _a : 0) + 12) % 12;
}
function repairVoicingForBeat(input) {
    var _a;
    var warnings = [];
    var chordPcs = input.chordPcs, parsedChord = input.parsedChord, soprMidi = input.soprMidi, prev = input.prev, ranges = input.ranges, options = input.options, targets = input.targets, context = input.context;
    var allowUnisonD4 = options.allowTenorAltoUnisonD4 === true;
    var hasSlashBass = parsedChord.bassPcPref !== null;
    var lockBassToPref = hasSlashBass || options.forceRootInBass;
    var bassPref = parsedChord.bassPcPref !== null ? parsedChord.bassPcPref : parsedChord.rootPc;
    var baseBassCands = makeCandidates(chordPcs, ranges.Bass, bassPref, lockBassToPref);
    var tenorCands = makeCandidates(chordPcs, ranges.Tenor, null, false);
    var altoCands = makeCandidates(chordPcs, ranges.Alto, null, false);
    var label = (context === null || context === void 0 ? void 0 : context.measure) !== undefined ? "m".concat(context.measure, " t=").concat((_a = context.t) !== null && _a !== void 0 ? _a : 0) : "unknown";
    var best = pickBestTriple({
        bassCands: baseBassCands,
        tenorCands: tenorCands,
        altoCands: altoCands,
        sopr: soprMidi,
        prev: prev,
        targets: targets,
        allowUnisonD4: allowUnisonD4,
        enforceOrdering: true
    });
    if (!best && lockBassToPref && !hasSlashBass) {
        var relaxedBass = makeCandidates(chordPcs, ranges.Bass, null, false);
        best = pickBestTriple({
            bassCands: relaxedBass,
            tenorCands: tenorCands,
            altoCands: altoCands,
            sopr: soprMidi,
            prev: prev,
            targets: targets,
            allowUnisonD4: allowUnisonD4,
            enforceOrdering: true
        });
        if (best) {
            warnings.push("[satb][repair] ".concat(label, ": Ordering conflict, relaxed bass preference."));
        }
    }
    if (!best && options.allowOctaveShift) {
        var relaxedBass = hasSlashBass ? baseBassCands : makeCandidates(chordPcs, ranges.Bass, null, false);
        best = pickBestTriple({
            bassCands: relaxedBass,
            tenorCands: tenorCands,
            altoCands: altoCands,
            sopr: soprMidi,
            prev: prev,
            targets: targets,
            allowUnisonD4: allowUnisonD4,
            enforceOrdering: true
        });
        if (best) {
            warnings.push("[satb][repair] ".concat(label, ": Applied octave/voicing repair to satisfy ordering."));
        }
    }
    if (!best) {
        var relaxedBass = hasSlashBass ? baseBassCands : makeCandidates(chordPcs, ranges.Bass, null, false);
        best = pickBestTriple({
            bassCands: relaxedBass,
            tenorCands: tenorCands,
            altoCands: altoCands,
            sopr: soprMidi,
            prev: prev,
            targets: targets,
            allowUnisonD4: allowUnisonD4,
            enforceOrdering: false
        });
        if (best) {
            warnings.push("[satb][repair] ".concat(label, ": Hard constraint collision, used closest chord tones."));
        }
    }
    if (!best && hasSlashBass) {
        var relaxedBass = makeCandidates(chordPcs, ranges.Bass, null, false);
        best = pickBestTriple({
            bassCands: relaxedBass,
            tenorCands: tenorCands,
            altoCands: altoCands,
            sopr: soprMidi,
            prev: prev,
            targets: targets,
            allowUnisonD4: allowUnisonD4,
            enforceOrdering: false
        });
        if (best) {
            warnings.push("[satb][repair] ".concat(label, ": Slash bass out of range, relaxed to chord tone."));
        }
    }
    if (!best)
        return null;
    return {
        bassMidi: best.bass,
        tenorMidi: best.tenor,
        altoMidi: best.alto,
        bassSpelling: resolveBassSpelling({ bassMidi: best.bass, parsed: parsedChord }),
        warnings: warnings
    };
}
