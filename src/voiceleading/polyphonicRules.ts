import type {
  PolyphonicProfile,
  PolyphonicProfileName,
  PolyphonicScoreInput,
  PolyphonicScoreResult,
  PolyphonicChordContext,
  VoiceRanges,
  VoiceState,
  ModernMode
} from "./types";

const DEFAULT_PENALTIES = {
  parallelPerfect: 40,
  directPerfect: 18,
  directPerfectOuterLeap: 22,
  perfectMotionSimilar: 6,
  perfectConsonanceHold: 4,
  dissonance: 6,
  dissonanceLeap: 8,
  similarMotionAll: 6,
  spacing: 8,
  crossing: 25,
  overlap: 14,
  leapAboveThird: 4,
  leapAboveFifth: 10,
  leapAboveOctave: 18,
  tendencyUnresolved: 12,
  seventhUnresolved: 10,
  doubleTendency: 8,
  doubleSeventh: 7
};

const PROFILES: Record<string, PolyphonicProfile> = {
  baroque: {
    name: "baroque",
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 55,
      directPerfect: 26,
      directPerfectOuterLeap: 30,
      perfectMotionSimilar: 10,
      perfectConsonanceHold: 8,
      dissonance: 10,
      dissonanceLeap: 14,
      similarMotionAll: 10,
      spacing: 10,
      crossing: 30,
      overlap: 20,
      leapAboveThird: 6,
      leapAboveFifth: 16,
      leapAboveOctave: 26,
      tendencyUnresolved: 16,
      seventhUnresolved: 14,
      doubleTendency: 12,
      doubleSeventh: 10
    },
    allowParallels: false,
    allowDirectPerfects: false,
    enableTendencyRules: true
  },
  classical: {
    name: "classical",
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 45,
      directPerfect: 22,
      directPerfectOuterLeap: 24,
      perfectMotionSimilar: 8,
      perfectConsonanceHold: 6,
      dissonance: 8,
      dissonanceLeap: 12,
      similarMotionAll: 8,
      spacing: 9,
      crossing: 26,
      overlap: 16,
      leapAboveThird: 5,
      leapAboveFifth: 12,
      leapAboveOctave: 20,
      tendencyUnresolved: 14,
      seventhUnresolved: 12,
      doubleTendency: 10,
      doubleSeventh: 9
    },
    allowParallels: false,
    allowDirectPerfects: false,
    enableTendencyRules: true
  },
  romantic: {
    name: "romantic",
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 30,
      directPerfect: 14,
      directPerfectOuterLeap: 16,
      perfectMotionSimilar: 5,
      perfectConsonanceHold: 4,
      dissonance: 5,
      dissonanceLeap: 8,
      similarMotionAll: 4,
      spacing: 6,
      crossing: 18,
      overlap: 10,
      leapAboveThird: 3,
      leapAboveFifth: 8,
      leapAboveOctave: 14,
      tendencyUnresolved: 8,
      seventhUnresolved: 6,
      doubleTendency: 6,
      doubleSeventh: 5
    },
    allowParallels: false,
    allowDirectPerfects: false,
    enableTendencyRules: true
  },
  worship: {
    // Hymn / contemporary choral worship.
    // Goal: accessible, clear SATB texture.
    //   • Soprano melody must be clean — parallel 5ths/8ths firmly blocked
    //   • Inner voices are harmonic support — less strict than baroque on leaps
    //   • Bass sits on root notes — chord tones preferred, leaps tolerated
    //   • Spacing is intentionally open/warm — allow slightly wider SA/AT
    // Strictness sits between classical and baroque.
    name: "worship",
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 50,        // strict — clarity is paramount
      directPerfect: 24,
      directPerfectOuterLeap: 26,
      perfectMotionSimilar: 9,
      perfectConsonanceHold: 7,
      dissonance: 9,
      dissonanceLeap: 13,
      similarMotionAll: 9,
      spacing: 7,                  // slightly relaxed — open voicing sounds warm
      crossing: 28,
      overlap: 18,
      leapAboveThird: 4,
      leapAboveFifth: 11,          // Bass leaps of a 4th/5th are normal in hymns
      leapAboveOctave: 19,
      tendencyUnresolved: 15,
      seventhUnresolved: 13,
      doubleTendency: 11,
      doubleSeventh: 9
    },
    allowParallels: false,
    allowDirectPerfects: false,
    enableTendencyRules: true
  },
  modern: {
    name: "modern",
    modernMode: "modernTonal",
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 18,
      directPerfect: 8,
      directPerfectOuterLeap: 10,
      perfectMotionSimilar: 4,
      perfectConsonanceHold: 3,
      dissonance: 4,
      dissonanceLeap: 6,
      similarMotionAll: 2,
      spacing: 5,
      crossing: 14,
      overlap: 8,
      leapAboveThird: 2,
      leapAboveFifth: 6,
      leapAboveOctave: 10,
      tendencyUnresolved: 6,
      seventhUnresolved: 4,
      doubleTendency: 4,
      doubleSeventh: 3
    },
    allowParallels: false,
    allowDirectPerfects: false,
    enableTendencyRules: true
  }
};

const MODERN_OVERRIDES: Record<ModernMode, Partial<PolyphonicProfile>> = {
  modernTonal: {
    enableTendencyRules: true,
    allowParallels: false,
    allowDirectPerfects: false
  },
  modal: {
    enableTendencyRules: true,
    allowParallels: true,
    allowDirectPerfects: true,
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 8,
      directPerfect: 6,
      directPerfectOuterLeap: 8,
      perfectMotionSimilar: 3,
      perfectConsonanceHold: 2,
      dissonance: 3,
      dissonanceLeap: 4,
      similarMotionAll: 3,
      spacing: 5,
      crossing: 12,
      overlap: 8,
      leapAboveThird: 2,
      leapAboveFifth: 6,
      leapAboveOctave: 10,
      tendencyUnresolved: 6,
      seventhUnresolved: 4,
      doubleTendency: 4,
      doubleSeventh: 3
    }
  },
  atonal: {
    enableTendencyRules: false,
    allowParallels: true,
    allowDirectPerfects: true,
    penalties: {
      ...DEFAULT_PENALTIES,
      parallelPerfect: 4,
      directPerfect: 3,
      directPerfectOuterLeap: 3,
      perfectMotionSimilar: 1,
      perfectConsonanceHold: 1,
      dissonance: 1,
      dissonanceLeap: 2,
      similarMotionAll: 2,
      spacing: 4,
      crossing: 10,
      overlap: 6,
      leapAboveThird: 2,
      leapAboveFifth: 5,
      leapAboveOctave: 8,
      tendencyUnresolved: 0,
      seventhUnresolved: 0,
      doubleTendency: 0,
      doubleSeventh: 0
    }
  }
};

export function resolvePolyphonicProfile(
  styleProfile?: string | null,
  modernMode?: string | null
): PolyphonicProfile {
  const nameRaw = String(styleProfile || "classical").toLowerCase();
  const name = (["baroque", "classical", "romantic", "modern", "worship"] as PolyphonicProfileName[]).includes(
    nameRaw as PolyphonicProfileName
  )
    ? (nameRaw as PolyphonicProfileName)
    : "classical";

  const base = PROFILES[name];
  if (name !== "modern") return { ...base };

  const modeRaw = String(modernMode || "modernTonal") as ModernMode;
  const override = MODERN_OVERRIDES[modeRaw] ?? MODERN_OVERRIDES.modernTonal;

  return {
    ...base,
    modernMode: (override.modernMode ?? modeRaw) as ModernMode,
    penalties: override.penalties ? override.penalties : base.penalties,
    allowParallels: override.allowParallels ?? base.allowParallels,
    allowDirectPerfects: override.allowDirectPerfects ?? base.allowDirectPerfects,
    enableTendencyRules: override.enableTendencyRules ?? base.enableTendencyRules
  };
}

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function motionDir(prev: number, next: number): -1 | 0 | 1 {
  if (next > prev) return 1;
  if (next < prev) return -1;
  return 0;
}

function isPerfectConsonance(intervalPc: number): boolean {
  return intervalPc === 0 || intervalPc === 7;
}

function isImperfectConsonance(intervalPc: number): boolean {
  return intervalPc === 3 || intervalPc === 4 || intervalPc === 8 || intervalPc === 9;
}

function isDissonance(intervalPc: number): boolean {
  return !isPerfectConsonance(intervalPc) && !isImperfectConsonance(intervalPc);
}

function isParallelPerfect(prevUpper: number, prevLower: number, nextUpper: number, nextLower: number): boolean {
  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);
  if (!isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;
  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);
  if (du === 0 || dl === 0) return false;
  return du === dl;
}

function isDirectPerfect(prevUpper: number, prevLower: number, nextUpper: number, nextLower: number): boolean {
  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);
  if (isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;
  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);
  if (du === 0 || dl === 0) return false;
  return du === dl;
}

export function orderingOk(state: VoiceState, allowUnisonD4: boolean): boolean {
  const { B, T, A, S } = state;
  if (B >= T) return false;
  if (A >= S) return false;
  if (T < A) return true;
  if (allowUnisonD4 && T === A && T === 62) return true;
  return false;
}

function checkOverlap(prev: VoiceState | null, next: VoiceState): number {
  if (!prev) return 0;
  let overlaps = 0;
  if (next.A > prev.S) overlaps += 1;
  if (next.S < prev.A) overlaps += 1;
  if (next.T > prev.A) overlaps += 1;
  if (next.A < prev.T) overlaps += 1;
  if (next.B > prev.T) overlaps += 1;
  if (next.T < prev.B) overlaps += 1;
  return overlaps;
}

function chordHasPc(chord: PolyphonicChordContext | null | undefined, pcVal: number | null): boolean {
  if (pcVal === null || pcVal === undefined) return false;
  if (!chord) return false;
  return chord.pcs.includes(pcVal);
}

// BWV 578 analysis: Bach uses 17–36 semitones between tenor and bass in
// 4-voice passages — any fixed upper limit is wrong. Keep only the minimum
// (avoid low-register muddiness) and drop the discrete interval list.
// Alto-Tenor is genuinely close-voiced (upper register), so kept tight.
const ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];

function intervalPenalty(interval: number, allowed: number[], weight: number): number {
  if (allowed.includes(interval)) return 0;
  let minDiff = Number.POSITIVE_INFINITY;
  for (const a of allowed) {
    const diff = Math.abs(interval - a);
    if (diff < minDiff) minDiff = diff;
  }
  if (!Number.isFinite(minDiff)) return weight;
  return weight * (1 + minDiff * 0.6);
}

export function scorePolyphonicVoicing(input: PolyphonicScoreInput): PolyphonicScoreResult {
  const { prev, next, ranges, profile, keyPc, chord, prevChord } = input;
  const penalties = profile.penalties;
  const issues: string[] = [];
  let score = 0;

  const add = (pen: number, label: string) => {
    if (pen <= 0) return;
    score += pen;
    issues.push(label);
  };

  const spacingSA = next.S - next.A;
  const spacingAT = next.A - next.T;
  // Raised multipliers: spacing violations in upper voices are strongly penalised.
  if (spacingSA > 12) add(penalties.spacing * (spacingSA - 12) * 0.85, "spacing-SA");
  if (spacingAT > 12) add(penalties.spacing * (spacingAT - 12) * 0.65, "spacing-AT");
  const minLowSpacing = next.B < 48 ? 10 : 5;
  const spacingTB = next.T - next.B;
  if (spacingTB < minLowSpacing) {
    add(penalties.spacing * (minLowSpacing - spacingTB) * 0.6, "spacing-TB");
  }

  // No upper-limit penalty for T-B: wide bass is idiomatic (BWV 578 shows
  // 17–36st gaps are completely normal). The minimum check above is enough.

  if (spacingAT >= 0) {
    const pen = intervalPenalty(spacingAT, ALTO_TENOR_ALLOWED_INTERVALS, penalties.spacing * 1.1);
    if (pen > 0) add(pen, "interval-AT");
  }

  if (!orderingOk(next, true)) add(penalties.crossing, "crossing");

  const overlaps = checkOverlap(prev, next);
  if (overlaps > 0) add(penalties.overlap * overlaps, "overlap");

  if (prev) {
    const pairs: Array<[keyof VoiceState, keyof VoiceState]> = [
      ["S", "A"],
      ["S", "T"],
      ["S", "B"],
      ["A", "T"],
      ["A", "B"],
      ["T", "B"]
    ];

    for (const [u, l] of pairs) {
      const prevUpper = prev[u];
      const prevLower = prev[l];
      const nextUpper = next[u];
      const nextLower = next[l];
      if (!profile.allowParallels && isParallelPerfect(prevUpper, prevLower, nextUpper, nextLower)) {
        add(penalties.parallelPerfect, "parallel-perfect");
      }
    }

    if (!profile.allowDirectPerfects) {
      const prevUpper = prev.S;
      const prevLower = prev.B;
      const nextUpper = next.S;
      const nextLower = next.B;
      const soprLeap = Math.abs(nextUpper - prevUpper);
      if (isDirectPerfect(prevUpper, prevLower, nextUpper, nextLower)) {
        add(penalties.directPerfect, "direct-perfect");
        if (soprLeap > 2) add(penalties.directPerfectOuterLeap, "direct-perfect-outer-leap");
      }
    }

    const dS = motionDir(prev.S, next.S);
    const dA = motionDir(prev.A, next.A);
    const dT = motionDir(prev.T, next.T);
    const dB = motionDir(prev.B, next.B);

    const outerPrevInt = pc(prev.S - prev.B);
    const outerNextInt = pc(next.S - next.B);
    const outerSimilar = dS !== 0 && dB !== 0 && dS === dB;
    const outerOblique = (dS === 0 && dB !== 0) || (dS !== 0 && dB === 0);

    if (isPerfectConsonance(outerPrevInt) && outerSimilar) {
      add(penalties.perfectMotionSimilar, "perfect-motion-similar");
    }
    if (isPerfectConsonance(outerNextInt)) {
      add(penalties.perfectConsonanceHold, "perfect-consonance");
      if (isPerfectConsonance(outerPrevInt) && (outerSimilar || outerOblique)) {
        add(penalties.perfectConsonanceHold * 0.6, "perfect-consonance-chain");
      }
    }

    if (isDissonance(outerNextInt)) {
      add(penalties.dissonance, "dissonance-outer");
      const soprStep = Math.abs(next.S - prev.S) <= 2;
      const bassStep = Math.abs(next.B - prev.B) <= 2;
      if (!soprStep || !bassStep) {
        add(penalties.dissonanceLeap, "dissonance-outer-leap");
      }
    }
    if (dS !== 0 && dS === dA && dA === dT && dT === dB) {
      add(penalties.similarMotionAll, "similar-motion-all");
    }

    // Similar motion between inner pairs: penalise generically UNLESS the
    // voices are moving in parallel imperfect consonances (3rds, 6ths).
    // Parallel 3rds/6ths between S/A, S/T, and A/B are PRIMARY textures in
    // tonal counterpoint and should be rewarded, not penalised.
    if (dS !== 0 && dA !== 0 && dS === dA) {
      const saPcNext = pc(next.S - next.A);
      if (isImperfectConsonance(saPcNext)) {
        score -= 2.0;   // parallel 3rds / 6ths S↔A — desirable texture
      } else {
        add(penalties.similarMotionAll * 0.5, "similar-motion-SA");
      }
    }
    if (dS !== 0 && dT !== 0 && dS === dT) {
      const stPcNext = pc(next.S - next.T);
      if (isImperfectConsonance(stPcNext)) {
        score -= 1.5;   // parallel 3rds / 6ths S↔T
      } else {
        add(penalties.similarMotionAll * 0.5, "similar-motion-ST");
      }
    }
    if (dA !== 0 && dB !== 0 && dA === dB) {
      const abPcNext = pc(next.A - next.B);
      if (isImperfectConsonance(abPcNext)) {
        score -= 1.2;   // parallel 3rds / 6ths A↔B
      } else {
        add(penalties.similarMotionAll * 0.35, "similar-motion-AB");
      }
    }
    if (dB !== 0 && dT !== 0 && dB === dT) {
      const btPcNext = pc(next.T - next.B);
      if (!isImperfectConsonance(btPcNext)) {
        add(penalties.similarMotionAll * 0.35, "similar-motion-BT");
      }
    }

    // Reward contrary motion — all voice-pair combinations.
    // Outer voices (S/B) contribute most; inner pairs contribute less.
    if (dS !== 0 && dB !== 0 && dS !== dB) score -= 2.5;  // S vs B — outer voices
    if (dA !== 0 && dT !== 0 && dA !== dT) score -= 1.2;  // A vs T — inner voices
    if (dS !== 0 && dA !== 0 && dS !== dA) score -= 0.8;  // S vs A
    if (dB !== 0 && dT !== 0 && dB !== dT) score -= 0.8;  // B vs T

    // ── Lesson from BWV 848 (Bach, Fugue in C# major) ─────────────────────
    // The fugue demonstrates that outer voices moving in parallel COMPOUND
    // THIRDS (10ths = mod-12 interval of 3 or 4) is the primary and preferred
    // motion type in baroque style. Unlike parallel 5ths/8ths, parallel 10ths
    // produce a rich, full-bodied texture and must be rewarded, not penalised
    // as generic "similar motion".
    const outerPcNext = pc(next.S - next.B);
    const outerPcPrev = pc(prev.S - prev.B);
    const outerParallel = dS !== 0 && dB !== 0 && dS === dB;  // same direction
    if (outerParallel && (outerPcNext === 3 || outerPcNext === 4)) {
      score -= 3.5;  // parallel 10ths — strongly preferred
      if (outerPcPrev === 3 || outerPcPrev === 4) {
        score -= 1.5;  // continuing a chain of 10ths — extra reward
      }
    }

    // Reward oblique outer-voice motion: one voice sustains while the other
    // moves. BWV 848 mm. 9–16 hold G#5 in soprano while the bass develops
    // the melodic answer — a structural independence device.
    if ((dS !== 0 && dB === 0) || (dS === 0 && dB !== 0)) score -= 1.8;

    // Prefer stepwise bass motion (≤ whole-tone = 2 semitones): the fugue bass
    // traces a completely stepwise arch (C#→D#→E#→F#→E#→D#→C#). Small reward
    // to nudge the bass toward conjunct motion over large leaps.
    const bassInterval = Math.abs(next.B - prev.B);
    if (bassInterval <= 2 && bassInterval > 0) score -= 1.5;

    const voices: Array<[keyof VoiceState, keyof VoiceRanges]> = [
      ["S", "S"],
      ["A", "A"],
      ["T", "T"],
      ["B", "B"]
    ];
    for (const [v, r] of voices) {
      const interval = Math.abs(next[v] - prev[v]);
      if (interval > 12) add(penalties.leapAboveOctave, `leap-octave-${v}`);
      else if (interval > 7) add(penalties.leapAboveFifth, `leap-fifth-${v}`);
      else if (interval > 4) add(penalties.leapAboveThird, `leap-third-${v}`);
      const range = ranges[r];
      if (next[v] < range.min || next[v] > range.max) {
        add(penalties.crossing, `out-of-range-${v}`);
      }
    }
  }

  if (profile.enableTendencyRules && keyPc !== null && keyPc !== undefined && prev) {
    const leadingPc = (keyPc + 11) % 12;
    const voices: Array<keyof VoiceState> = ["S", "A", "T", "B"];
    for (const v of voices) {
      if (pc(prev[v]) === leadingPc && pc(next[v]) !== keyPc) {
        add(penalties.tendencyUnresolved, `leading-tone-unresolved-${v}`);
      }
    }
  }

  if (profile.enableTendencyRules && prev && chordHasPc(prevChord, prevChord?.seventhPc ?? null)) {
    const seventhPc = prevChord?.seventhPc ?? null;
    if (seventhPc !== null && seventhPc !== undefined) {
      const voices: Array<keyof VoiceState> = ["S", "A", "T", "B"];
      for (const v of voices) {
        if (pc(prev[v]) !== seventhPc) continue;
        const diff = next[v] - prev[v];
        if (!(diff === -1 || diff === -2)) {
          add(penalties.seventhUnresolved, `seventh-unresolved-${v}`);
        }
      }
    }
  }

  if (profile.enableTendencyRules && keyPc !== null && keyPc !== undefined) {
    const leadingPc = (keyPc + 11) % 12;
    const leadCount =
      (pc(next.S) === leadingPc ? 1 : 0) +
      (pc(next.A) === leadingPc ? 1 : 0) +
      (pc(next.T) === leadingPc ? 1 : 0) +
      (pc(next.B) === leadingPc ? 1 : 0);
    if (leadCount > 1) add(penalties.doubleTendency * (leadCount - 1), "double-leading-tone");
  }

  if (profile.enableTendencyRules && chordHasPc(chord, chord.seventhPc ?? null)) {
    const seventhPc = chord.seventhPc ?? null;
    if (seventhPc !== null && seventhPc !== undefined) {
      const seventhCount =
        (pc(next.S) === seventhPc ? 1 : 0) +
        (pc(next.A) === seventhPc ? 1 : 0) +
        (pc(next.T) === seventhPc ? 1 : 0) +
        (pc(next.B) === seventhPc ? 1 : 0);
      if (seventhCount > 1) add(penalties.doubleSeventh * (seventhCount - 1), "double-seventh");
    }
  }

  return { score, issues };
}

function midiCandidatesForPcInRange(pitchClass: number, range: { min: number; max: number }): number[] {
  const out: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (pc(m) === pitchClass) out.push(m);
  }
  return out;
}

function collectChordMidis(chordPcs: number[], range: { min: number; max: number }): number[] {
  const out: number[] = [];
  for (const p of chordPcs) out.push(...midiCandidatesForPcInRange(p, range));
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

export function repairVoicingForCrossingAndOverlap(params: {
  prev: VoiceState | null;
  proposed: VoiceState;
  chordPcs: number[];
  ranges: VoiceRanges;
  profile: PolyphonicProfile;
  keyPc?: number | null;
  keyMode?: "major" | "minor" | null;
  chord: PolyphonicChordContext;
  prevChord?: PolyphonicChordContext | null;
  allowUnisonD4?: boolean;
  bassPreferPc?: number | null;
  lockBassToPrefer?: boolean;
}): { state: VoiceState; warnings: string[] } {
  const {
    prev,
    proposed,
    chordPcs,
    ranges,
    profile,
    keyPc,
    chord,
    prevChord,
    allowUnisonD4,
    bassPreferPc,
    lockBassToPrefer
  } = params;
  const warnings: string[] = [];

  const allowUnison = !!allowUnisonD4;

  const bassPcs = lockBassToPrefer && bassPreferPc !== null ? [bassPreferPc] : chordPcs.slice();
  const bassCands = collectChordMidis(bassPcs, ranges.B);
  const tenorCands = collectChordMidis(chordPcs, ranges.T);
  const altoCands = collectChordMidis(chordPcs, ranges.A);

  const runSearch = (opts: { allowOrdering: boolean; label: string }): VoiceState | null => {
    let best: { state: VoiceState; score: number } | null = null;
    for (const b of bassCands) {
      for (const t of tenorCands) {
        for (const a of altoCands) {
          if (a >= proposed.S) continue;
          const candidate: VoiceState = { S: proposed.S, A: a, T: t, B: b };
          if (opts.allowOrdering && !orderingOk(candidate, allowUnison)) continue;
          const scoreResult = scorePolyphonicVoicing({
            prev,
            next: candidate,
            ranges,
            profile,
            keyPc,
            keyMode: null,
            chord,
            prevChord
          });
          const dist =
            Math.abs(candidate.A - proposed.A) +
            Math.abs(candidate.T - proposed.T) +
            Math.abs(candidate.B - proposed.B);
          const total = scoreResult.score + dist * 0.25;
          if (!best || total < best.score) best = { state: candidate, score: total };
        }
      }
    }
    if (!best) return null;
    warnings.push(`[poly] WARN ${opts.label}: repaired voicing via alternate chord tones.`);
    return best.state;
  };

  let repaired = runSearch({ allowOrdering: true, label: "ordering" });
  if (repaired) return { state: repaired, warnings };

  const octaveShift = (m: number, shift: number): number | null => {
    const shifted = m + shift;
    return shifted;
  };

  const octaveShifted = (cands: number[], range: { min: number; max: number }): number[] => {
    const out = new Set<number>(cands);
    for (const m of cands) {
      const up = octaveShift(m, 12);
      const down = octaveShift(m, -12);
      if (up !== null && up >= range.min && up <= range.max) out.add(up);
      if (down !== null && down >= range.min && down <= range.max) out.add(down);
    }
    return Array.from(out).sort((a, b) => a - b);
  };

  const bassCands2 = octaveShifted(bassCands, ranges.B);
  const tenorCands2 = octaveShifted(tenorCands, ranges.T);
  const altoCands2 = octaveShifted(altoCands, ranges.A);

  const runSearchWithOctaves = (): VoiceState | null => {
    let best: { state: VoiceState; score: number } | null = null;
    for (const b of bassCands2) {
      for (const t of tenorCands2) {
        for (const a of altoCands2) {
          if (a >= proposed.S) continue;
          const candidate: VoiceState = { S: proposed.S, A: a, T: t, B: b };
          if (!orderingOk(candidate, allowUnison)) continue;
          const scoreResult = scorePolyphonicVoicing({
            prev,
            next: candidate,
            ranges,
            profile,
            keyPc,
            keyMode: null,
            chord,
            prevChord
          });
          const dist =
            Math.abs(candidate.A - proposed.A) +
            Math.abs(candidate.T - proposed.T) +
            Math.abs(candidate.B - proposed.B);
          const total = scoreResult.score + dist * 0.25;
          if (!best || total < best.score) best = { state: candidate, score: total };
        }
      }
    }
    if (!best) return null;
    warnings.push("[poly] WARN octave-shift: applied octave shifts to resolve ordering.");
    return best.state;
  };

  repaired = runSearchWithOctaves();
  if (repaired) return { state: repaired, warnings };

  let fallback: VoiceState | null = null;
  let fallbackScore = Number.POSITIVE_INFINITY;
  for (const b of bassCands2) {
    for (const t of tenorCands2) {
      for (const a of altoCands2) {
        if (a >= proposed.S) continue;
        const candidate: VoiceState = { S: proposed.S, A: a, T: t, B: b };
        const scoreResult = scorePolyphonicVoicing({
          prev,
          next: candidate,
          ranges,
          profile,
          keyPc,
          keyMode: null,
          chord,
          prevChord
        });
        const dist =
          Math.abs(candidate.A - proposed.A) + Math.abs(candidate.T - proposed.T) + Math.abs(candidate.B - proposed.B);
        const total = scoreResult.score + dist * 0.25;
        if (total < fallbackScore) {
          fallbackScore = total;
          fallback = candidate;
        }
      }
    }
  }

  if (fallback) {
    warnings.push("[poly] WARN relaxed: chose least-bad voicing (ordering relaxed).");
    return { state: fallback, warnings };
  }

  warnings.push("[poly] WARN fallback: could not repair voicing, using proposed values.");
  return { state: proposed, warnings };
}
