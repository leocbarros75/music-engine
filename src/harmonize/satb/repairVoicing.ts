type Range = { min: number; max: number };

type PitchSpelling = { step: string; alter: number };

type ParsedChordLike = {
  rootPc: number;
  pcs: number[];
  bassPcPref: number | null;
  rootSpelling?: PitchSpelling | null;
  bassSpelling?: PitchSpelling | null;
};

type RepairInput = {
  chordPcs: number[];
  parsedChord: ParsedChordLike;
  soprMidi: number;
  prev: {
    prevA: number | null;
    prevT: number | null;
    prevB: number | null;
    prevS: number | null;
  };
  ranges: {
    Bass: Range;
    Tenor: Range;
    Alto: Range;
  };
  options: {
    forceRootInBass: boolean;
    allowOctaveShift?: boolean;
    allowTenorAltoUnisonD4?: boolean;
  };
  targets: {
    bassTarget: number;
    tenorTarget: number;
    altoTarget: number;
  };
  context?: {
    measure?: number;
    t?: number;
  };
};

type RepairResult = {
  bassMidi: number;
  tenorMidi: number;
  altoMidi: number;
  bassSpelling: PitchSpelling | null;
  warnings: string[];
};

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

const TENOR_BASS_ALLOWED_INTERVALS = [7, 8, 9, 10, 11, 12];
const ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];

function intervalPenalty(interval: number, allowed: number[], weight: number): number {
  if (interval < 0) return weight * 2;
  if (allowed.includes(interval)) return 0;
  let minDiff = Number.POSITIVE_INFINITY;
  for (const a of allowed) {
    const diff = Math.abs(interval - a);
    if (diff < minDiff) minDiff = diff;
  }
  if (!Number.isFinite(minDiff)) return weight;
  return weight * (1 + minDiff * 0.6);
}

function motionDir(prev: number, next: number): -1 | 0 | 1 {
  if (next > prev) return 1;
  if (next < prev) return -1;
  return 0;
}

function isPerfectConsonance(intervalPc: number): boolean {
  return intervalPc === 0 || intervalPc === 7;
}

function isParallelPerfect(params: {
  prevUpper: number;
  prevLower: number;
  nextUpper: number;
  nextLower: number;
}): boolean {
  const { prevUpper, prevLower, nextUpper, nextLower } = params;
  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);
  if (!isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;
  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);
  if (du === 0 || dl === 0) return false;
  if (du !== dl) return false;
  return true;
}

function isDirectPerfect(params: {
  prevUpper: number;
  prevLower: number;
  nextUpper: number;
  nextLower: number;
}): boolean {
  const { prevUpper, prevLower, nextUpper, nextLower } = params;
  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);
  if (isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;
  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);
  if (du === 0 || dl === 0) return false;
  if (du !== dl) return false;
  return true;
}

function midiCandidatesForPcInRange(pitchClass: number, range: Range): number[] {
  const out: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (pc(m) === pitchClass) out.push(m);
  }
  return out;
}

function makeCandidates(
  pcs: number[],
  range: Range,
  preferPc: number | null,
  restrictToPrefer: boolean
): number[] {
  let src = pcs.slice();
  if (preferPc !== null && restrictToPrefer) src = [preferPc];
  const out: number[] = [];
  for (const p of src) out.push(...midiCandidatesForPcInRange(p, range));
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function orderingOk(params: {
  bass: number;
  tenor: number;
  alto: number;
  soprano: number;
  allowUnisonD4: boolean;
}): boolean {
  const { bass, tenor, alto, soprano, allowUnisonD4 } = params;
  if (bass >= tenor) return false;
  if (alto >= soprano) return false;
  if (tenor < alto) return true;
  if (allowUnisonD4 && tenor === alto && tenor === 62) return true;
  return false;
}

function scoreTriple(params: {
  bass: number;
  tenor: number;
  alto: number;
  sopr: number;
  prev: RepairInput["prev"];
  targets: RepairInput["targets"];
  /** Schoenberg Theory of Harmony p. 36: doubling preference (root > fifth > third). */
  rootPc?: number;
}): number {
  const { bass, tenor, alto, sopr, prev, targets, rootPc } = params;
  let score = 0;
  score += Math.abs(bass - targets.bassTarget) * 0.6;
  score += Math.abs(tenor - targets.tenorTarget) * 0.6;
  score += Math.abs(alto - targets.altoTarget) * 0.6;

  if (prev.prevB !== null) score += Math.abs(bass - prev.prevB) * 0.35;
  if (prev.prevT !== null) score += Math.abs(tenor - prev.prevT) * 0.35;
  if (prev.prevA !== null) score += Math.abs(alto - prev.prevA) * 0.35;

  const tb = tenor - bass;
  const at = alto - tenor;
  const sa = sopr - alto;
  if (tb > 19) score += (tb - 19) * 0.5;
  // SA and AT spacing: penalty weight raised so violations are strongly discouraged.
  if (at > 12) score += (at - 12) * 0.65;
  if (sa > 12) score += (sa - 12) * 0.65;

  if (tb > 0) score += intervalPenalty(tb, TENOR_BASS_ALLOWED_INTERVALS, 3.5);
  if (at >= 0) score += intervalPenalty(at, ALTO_TENOR_ALLOWED_INTERVALS, 3.0);

  if (prev.prevS !== null && prev.prevB !== null) {
    if (
      isParallelPerfect({
        prevUpper: prev.prevS,
        prevLower: prev.prevB,
        nextUpper: sopr,
        nextLower: bass
      })
    )
      score += 25;
    if (
      isDirectPerfect({
        prevUpper: prev.prevS,
        prevLower: prev.prevB,
        nextUpper: sopr,
        nextLower: bass
      })
    )
      score += 10;
  }

  if (prev.prevS !== null && prev.prevT !== null) {
    if (
      isParallelPerfect({
        prevUpper: prev.prevS,
        prevLower: prev.prevT,
        nextUpper: sopr,
        nextLower: tenor
      })
    )
      score += 20;
  }

  // ── Schoenberg Theory of Harmony, p. 36: doubling preference ─────────────
  // "The first to be considered [for doubling] is the root; next the fifth;
  //  and only then, lastly, the third."
  // Reward doubling the root; penalise doubling the third.
  if (rootPc !== undefined) {
    const voicePcs = [pc(bass), pc(tenor), pc(alto), pc(sopr)];
    const counts = new Map<number, number>();
    for (const p of voicePcs) counts.set(p, (counts.get(p) ?? 0) + 1);
    for (const [pitchClass, count] of counts) {
      if (count >= 2) {
        if (pitchClass === rootPc) {
          score -= 2.0;   // root doubling preferred
        } else {
          const interval = ((pitchClass - rootPc) + 12) % 12;
          if (interval === 3 || interval === 4) {
            score += 5.0; // third doubling least preferred (Schoenberg p. 36)
          }
          // fifth (interval === 7): neutral
        }
      }
    }
  }

  return score;
}

function pickBestTriple(params: {
  bassCands: number[];
  tenorCands: number[];
  altoCands: number[];
  sopr: number;
  prev: RepairInput["prev"];
  targets: RepairInput["targets"];
  allowUnisonD4: boolean;
  enforceOrdering: boolean;
  rootPc?: number;
}): { bass: number; tenor: number; alto: number; score: number } | null {
  const { bassCands, tenorCands, altoCands, sopr, prev, targets, allowUnisonD4, enforceOrdering, rootPc } = params;
  let best: { bass: number; tenor: number; alto: number; score: number } | null = null;

  for (const bass of bassCands) {
    for (const tenor of tenorCands) {
      for (const alto of altoCands) {
        if (enforceOrdering) {
          if (!orderingOk({ bass, tenor, alto, soprano: sopr, allowUnisonD4 })) continue;
          // Primary pass: enforce 1-octave maximum between adjacent upper voices.
          // The fallback (enforceOrdering: false) relaxes this when no valid triple exists.
          if (sopr - alto > 12 || alto - tenor > 12) continue;
        } else {
          if (alto >= sopr) continue;
        }
        const score = scoreTriple({ bass, tenor, alto, sopr, prev, targets, rootPc });
        if (!best || score < best.score) best = { bass, tenor, alto, score };
      }
    }
  }

  return best;
}

function resolveBassSpelling(params: {
  bassMidi: number;
  parsed: ParsedChordLike;
}): PitchSpelling | null {
  const { bassMidi, parsed } = params;
  const bassPc = pc(bassMidi);
  if (parsed.bassSpelling && pcFromSpelling(parsed.bassSpelling) === bassPc) return parsed.bassSpelling;
  if (parsed.rootSpelling && pcFromSpelling(parsed.rootSpelling) === bassPc) return parsed.rootSpelling;
  return null;
}

function pcFromSpelling(spelling: PitchSpelling): number {
  const STEP_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return (STEP_TO_PC[spelling.step] + (spelling.alter ?? 0) + 12) % 12;
}

export function repairVoicingForBeat(input: RepairInput): RepairResult | null {
  const warnings: string[] = [];
  const {
    chordPcs,
    parsedChord,
    soprMidi,
    prev,
    ranges,
    options,
    targets,
    context
  } = input;

  const allowUnisonD4 = options.allowTenorAltoUnisonD4 === true;
  const hasSlashBass = parsedChord.bassPcPref !== null;
  const lockBassToPref = hasSlashBass || options.forceRootInBass;
  const bassPref = parsedChord.bassPcPref !== null ? parsedChord.bassPcPref : parsedChord.rootPc;
  // Schoenberg doubling preference: pass root pc so scoreTriple can reward/penalise doublings.
  const chordRootPc = parsedChord.rootPc;

  const baseBassCands = makeCandidates(chordPcs, ranges.Bass, bassPref, lockBassToPref);
  const tenorCands = makeCandidates(chordPcs, ranges.Tenor, null, false);
  const altoCands = makeCandidates(chordPcs, ranges.Alto, null, false);

  const label = context?.measure !== undefined ? `m${context.measure} t=${context.t ?? 0}` : "unknown";

  let best = pickBestTriple({
    bassCands: baseBassCands,
    tenorCands,
    altoCands,
    sopr: soprMidi,
    prev,
    targets,
    allowUnisonD4,
    enforceOrdering: true,
    rootPc: chordRootPc
  });

  if (!best && lockBassToPref && !hasSlashBass) {
    const relaxedBass = makeCandidates(chordPcs, ranges.Bass, null, false);
    best = pickBestTriple({
      bassCands: relaxedBass,
      tenorCands,
      altoCands,
      sopr: soprMidi,
      prev,
      targets,
      allowUnisonD4,
      enforceOrdering: true,
      rootPc: chordRootPc
    });
    if (best) {
      warnings.push(`[satb][repair] ${label}: Ordering conflict, relaxed bass preference.`);
    }
  }

  if (!best && options.allowOctaveShift) {
    const relaxedBass = hasSlashBass ? baseBassCands : makeCandidates(chordPcs, ranges.Bass, null, false);
    best = pickBestTriple({
      bassCands: relaxedBass,
      tenorCands,
      altoCands,
      sopr: soprMidi,
      prev,
      targets,
      allowUnisonD4,
      enforceOrdering: true,
      rootPc: chordRootPc
    });
    if (best) {
      warnings.push(`[satb][repair] ${label}: Applied octave/voicing repair to satisfy ordering.`);
    }
  }

  if (!best) {
    const relaxedBass = hasSlashBass ? baseBassCands : makeCandidates(chordPcs, ranges.Bass, null, false);
    best = pickBestTriple({
      bassCands: relaxedBass,
      tenorCands,
      altoCands,
      sopr: soprMidi,
      prev,
      targets,
      allowUnisonD4,
      enforceOrdering: false,
      rootPc: chordRootPc
    });
    if (best) {
      warnings.push(`[satb][repair] ${label}: Hard constraint collision, used closest chord tones.`);
    }
  }

  if (!best && hasSlashBass) {
    const relaxedBass = makeCandidates(chordPcs, ranges.Bass, null, false);
    best = pickBestTriple({
      bassCands: relaxedBass,
      tenorCands,
      altoCands,
      sopr: soprMidi,
      prev,
      targets,
      allowUnisonD4,
      enforceOrdering: false,
      rootPc: chordRootPc
    });
    if (best) {
      warnings.push(`[satb][repair] ${label}: Slash bass out of range, relaxed to chord tone.`);
    }
  }

  if (!best) return null;

  return {
    bassMidi: best.bass,
    tenorMidi: best.tenor,
    altoMidi: best.alto,
    bassSpelling: resolveBassSpelling({ bassMidi: best.bass, parsed: parsedChord }),
    warnings
  };
}
