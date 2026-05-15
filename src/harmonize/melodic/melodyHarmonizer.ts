/**
 * melodyHarmonizer.ts
 *
 * Melody-only harmonization pipeline. Accepts a bare melody (as MelodyNote[],
 * a ScoreModel-shaped object, or a MusicXML string) and produces chord events,
 * key information, and phrase/cadence analysis that feed directly into the
 * existing arrangement pipeline.
 *
 * Key detection: Krumhansl-Schmuckler simplified (dot-product against 24 key profiles).
 * Phrase detection: rest-based and metric-weight heuristics.
 * Harmonization: scale-degree functional rules with chord smoothing.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single melody note with metric position and MIDI pitch. */
export type MelodyNote = {
  measure: number;
  /** Beat offset within the measure (0-based, quarter = 1.0). */
  t: number;
  /** Duration in beats. */
  dur: number;
  /** MIDI pitch (60 = middle C). */
  midi: number;
  pitch: { step: string; alter?: number; octave: number };
};

/** Detected key information. */
export type KeyInfo = {
  /** Circle-of-fifths position: 0=C, 1=G, 2=D, -1=F, -2=Bb … */
  fifths: number;
  mode: "major" | "minor";
  /** Tonic note name, e.g. "C", "G", "Bb". */
  root: string;
};

/** A detected musical phrase and its terminal cadence. */
export type PhraseInfo = {
  startMeasure: number;
  endMeasure: number;
  /** Beat of the phrase's final note within endMeasure. */
  endBeat: number;
  /** Detected cadence type at the phrase end. */
  cadenceType?: "PAC" | "IAC" | "HC" | "DC" | "PC";
};

/** Full harmonization result, ready for the arrangement pipeline. */
export type HarmonizationResult = {
  key: KeyInfo;
  chordEvents: { measure: number; t: number; symbol: string }[];
  phrases: PhraseInfo[];
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/** Krumhansl (1990) major key profile, index 0 = tonic. */
const MAJOR_PROFILE: readonly number[] = [
  6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

/** Krumhansl (1990) minor key profile, index 0 = tonic. */
const MINOR_PROFILE: readonly number[] = [
  6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

/**
 * Preferred flat/sharp spelling for each pitch class when used as a chord root.
 * Uses flats for flat keys, sharps for sharp keys — here we use a single
 * canonical list and resolve spelling from the detected key later.
 */
const PC_NAMES_SHARP: readonly string[] = [
  "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

const PC_NAMES_FLAT: readonly string[] = [
  "C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B",
];

/** Circle-of-fifths tonic pitch class for each fifths value (-7..+7), major. */
const MAJOR_TONIC_PC: Record<number, number> = {
  "-7": 11, "-6": 6, "-5": 1, "-4": 8, "-3": 3, "-2": 10, "-1": 5,
  "0": 0, "1": 7, "2": 2, "3": 9, "4": 4, "5": 11, "6": 6, "7": 1,
};

/** Circle-of-fifths tonic pitch class for each fifths value (-7..+7), minor. */
const MINOR_TONIC_PC: Record<number, number> = {
  "-7": 8, "-6": 3, "-5": 10, "-4": 5, "-3": 0, "-2": 7, "-1": 2,
  "0": 9, "1": 4, "2": 11, "3": 6, "4": 1, "5": 8, "6": 3, "7": 10,
};

/** fifths value for each major key tonic pitch class. */
const MAJOR_PC_TO_FIFTHS: Record<number, number> = {
  0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6,
  5: -1, 10: -2, 3: -3, 8: -4, 1: -5,
};

/** fifths value for each minor key tonic pitch class. */
const MINOR_PC_TO_FIFTHS: Record<number, number> = {
  9: 0, 4: 1, 11: 2, 6: 3, 1: 4, 8: 5, 3: 6,
  2: -1, 7: -2, 0: -3, 5: -4, 10: -5,
};

// ---------------------------------------------------------------------------
// Pitch-class utilities
// ---------------------------------------------------------------------------

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

/**
 * Return the preferred note name for a pitch class given a key's fifths value.
 * Positive fifths → prefer sharps; negative → prefer flats.
 */
function pcNameInKey(pitchClass: number, fifths: number): string {
  const p = ((pitchClass % 12) + 12) % 12;
  return fifths >= 0 ? PC_NAMES_SHARP[p]! : PC_NAMES_FLAT[p]!;
}

/** Major scale intervals from tonic. */
const MAJOR_SCALE_INTERVALS = [0, 2, 4, 5, 7, 9, 11] as const;
/** Natural minor scale intervals from tonic. */
const MINOR_SCALE_INTERVALS = [0, 2, 3, 5, 7, 8, 10] as const;

function majorScalePcs(tonicPc: number): number[] {
  return MAJOR_SCALE_INTERVALS.map((i) => (tonicPc + i) % 12);
}

function minorScalePcs(tonicPc: number): number[] {
  return MINOR_SCALE_INTERVALS.map((i) => (tonicPc + i) % 12);
}

/**
 * Scale degree (1-based) of a pitch class in the given scale, or 0 if
 * the pitch class is not diatonic.
 */
function scaleDegree(pitchClass: number, scalePcs: number[]): number {
  const idx = scalePcs.indexOf(((pitchClass % 12) + 12) % 12);
  return idx === -1 ? 0 : idx + 1;
}

// ---------------------------------------------------------------------------
// Key detection — Krumhansl-Schmuckler simplified
// ---------------------------------------------------------------------------

/**
 * Estimate the key from a set of melody notes using the Krumhansl-Schmuckler
 * algorithm: accumulate note durations by pitch class, then compute the
 * dot-product correlation against all 24 major/minor profiles.
 *
 * Returns the best-matching KeyInfo.
 */
function detectKey(notes: MelodyNote[]): { key: KeyInfo; warnings: string[] } {
  const warnings: string[] = [];

  // Accumulate duration per pitch class
  const durationByPc = new Float64Array(12);
  for (const n of notes) {
    durationByPc[pc(n.midi)] += n.dur;
  }

  const totalDuration = durationByPc.reduce((s, v) => s + v, 0);
  if (totalDuration === 0) {
    warnings.push("No note durations found; defaulting to C major.");
    return {
      key: { fifths: 0, mode: "major", root: "C" },
      warnings,
    };
  }

  // Dot-product correlation helper — computes Pearson-like dot product
  // (profile is shifted by `shift` semitones to test each of the 12 transpositions)
  function correlate(profile: readonly number[], shift: number): number {
    let dot = 0;
    for (let i = 0; i < 12; i++) {
      dot += durationByPc[(i + shift) % 12]! * profile[i]!;
    }
    return dot;
  }

  let bestScore = -Infinity;
  let bestMode: "major" | "minor" = "major";
  let bestTonicPc = 0;

  for (let shift = 0; shift < 12; shift++) {
    const majScore = correlate(MAJOR_PROFILE, shift);
    if (majScore > bestScore) {
      bestScore = majScore;
      bestMode = "major";
      bestTonicPc = shift;
    }
    const minScore = correlate(MINOR_PROFILE, shift);
    if (minScore > bestScore) {
      bestScore = minScore;
      bestMode = "minor";
      bestTonicPc = shift;
    }
  }

  const fifthsMap = bestMode === "major" ? MAJOR_PC_TO_FIFTHS : MINOR_PC_TO_FIFTHS;
  // Some enharmonic tonic PCs share a slot (e.g. pc 6 = F# or Gb).
  // Use the mapping; fall back to 0 for unmapped values.
  const fifths = fifthsMap[bestTonicPc] ?? 0;
  const root = pcNameInKey(bestTonicPc, fifths);

  return { key: { fifths, mode: bestMode, root }, warnings };
}

// ---------------------------------------------------------------------------
// Phrase detection
// ---------------------------------------------------------------------------

/**
 * Group notes into phrases.
 *
 * A phrase boundary occurs at any note:
 *   (a) preceded by a rest of ≥ 0.5 beats, OR
 *   (b) following a note of duration ≥ 1.5 beats that ends on beat 1 or beat 3.
 *
 * Minimum phrase length is 2 measures.  Phrases shorter than that are merged
 * forward into the next phrase (or backward into the previous one).
 */
function detectPhrases(
  notes: MelodyNote[],
  rests: Array<{ measure: number; t: number; dur: number }>
): { phrases: Array<{ startIdx: number; endIdx: number }> } {
  if (!notes.length) return { phrases: [] };

  // Build a sorted array of rest end-times (measure + t + dur) for gap lookup.
  // We represent time as a comparable float: measure * 1000 + beat
  type TimePoint = { measure: number; t: number };

  function timeVal(m: number, t: number): number {
    return m * 1000 + t;
  }

  // For each note, check whether there is a rest of ≥ 0.5 beats ending at or
  // just before this note's onset.
  const restEndsByMeasureBeat = new Map<number, number>(); // key=timeVal, value=duration
  for (const r of rests) {
    const endKey = timeVal(r.measure, r.t + r.dur);
    const existing = restEndsByMeasureBeat.get(endKey) ?? 0;
    if (r.dur > existing) restEndsByMeasureBeat.set(endKey, r.dur);
  }

  function restDurationBefore(note: MelodyNote): number {
    // Check if a rest ends right at this note's onset
    const key = timeVal(note.measure, note.t);
    return restEndsByMeasureBeat.get(key) ?? 0;
  }

  const boundaries = new Set<number>(); // indices into notes[] where a new phrase starts
  boundaries.add(0);

  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1]!;
    const curr = notes[i]!;

    // Criterion (a): preceded by a rest ≥ 0.5 beats
    if (restDurationBefore(curr) >= 0.5) {
      boundaries.add(i);
      continue;
    }

    // Criterion (b): previous note ≥ 1.5 beats, ends on beat 1 or 3
    const prevEnd = prev.t + prev.dur;
    const isOnStrong = prevEnd === 1.0 || prevEnd === 3.0 || prevEnd === 0.0;
    if (prev.dur >= 1.5 && isOnStrong) {
      boundaries.add(i);
    }
  }

  // Build phrase spans as [startIdx, endIdx] (inclusive)
  const boundaryList = Array.from(boundaries).sort((a, b) => a - b);
  const rawPhrases: Array<{ startIdx: number; endIdx: number }> = [];
  for (let b = 0; b < boundaryList.length; b++) {
    const startIdx = boundaryList[b]!;
    const endIdx = b + 1 < boundaryList.length ? boundaryList[b + 1]! - 1 : notes.length - 1;
    rawPhrases.push({ startIdx, endIdx });
  }

  // Enforce minimum phrase length of 2 measures by merging short phrases forward
  const merged: Array<{ startIdx: number; endIdx: number }> = [];
  let pendingStart: number | null = null;

  for (let p = 0; p < rawPhrases.length; p++) {
    const phrase = rawPhrases[p]!;
    const startNote = notes[phrase.startIdx]!;
    const endNote = notes[phrase.endIdx]!;
    const measureSpan = endNote.measure - startNote.measure + 1;

    const effectiveStart = pendingStart !== null ? pendingStart : phrase.startIdx;

    if (measureSpan < 2 && p < rawPhrases.length - 1) {
      // Too short — absorb into the next phrase by carrying the start
      if (pendingStart === null) pendingStart = phrase.startIdx;
    } else {
      merged.push({ startIdx: effectiveStart, endIdx: phrase.endIdx });
      pendingStart = null;
    }
  }

  // If there's a leftover pending start (last phrase was too short), merge with previous
  if (pendingStart !== null && merged.length > 0) {
    const last = merged[merged.length - 1]!;
    merged[merged.length - 1] = { startIdx: last.startIdx, endIdx: notes.length - 1 };
  } else if (pendingStart !== null) {
    // Only one phrase total
    merged.push({ startIdx: pendingStart, endIdx: notes.length - 1 });
  }

  if (!merged.length && notes.length > 0) {
    merged.push({ startIdx: 0, endIdx: notes.length - 1 });
  }

  return { phrases: merged };
}

// ---------------------------------------------------------------------------
// Harmonization — scale degree → chord function
// ---------------------------------------------------------------------------

/**
 * A diatonic chord definition used during harmonization.
 */
type DiatonicChord = {
  /** 1-based scale degree. */
  degree: number;
  rootPc: number;
  pcs: number[];
  symbol: string;
  /** Lower = more functionally stable / preferred at phrase openings. */
  priority: number;
};

function buildDiatonicChordsMajor(tonicPc: number, fifths: number): DiatonicChord[] {
  const scale = majorScalePcs(tonicPc);

  const triadDefs: Array<{ thirds: number; fifths: number; suffix: string; priority: number }> = [
    { thirds: 4, fifths: 7, suffix: "",    priority: 0 }, // I
    { thirds: 3, fifths: 7, suffix: "m",   priority: 4 }, // ii
    { thirds: 3, fifths: 7, suffix: "m",   priority: 5 }, // iii
    { thirds: 4, fifths: 7, suffix: "",    priority: 2 }, // IV
    { thirds: 4, fifths: 7, suffix: "",    priority: 1 }, // V
    { thirds: 3, fifths: 7, suffix: "m",   priority: 3 }, // vi
    { thirds: 3, fifths: 6, suffix: "dim", priority: 6 }, // vii°
  ];

  return triadDefs.map((def, idx) => {
    const r = scale[idx]!;
    const t = (r + def.thirds) % 12;
    const f = (r + def.fifths) % 12;
    return {
      degree: idx + 1,
      rootPc: r,
      pcs: [r, t, f],
      symbol: pcNameInKey(r, fifths) + def.suffix,
      priority: def.priority,
    };
  });
}

function buildDiatonicChordsMinor(tonicPc: number, fifths: number): DiatonicChord[] {
  const scale = minorScalePcs(tonicPc);

  // Use harmonic minor for degree V (raised 7th → major dominant)
  // Qualities: i, ii°, III, iv, V(harmonic), VI, VII
  const triadDefs: Array<{
    rootOffset: number; thirds: number; fifthsInterval: number; suffix: string; priority: number;
  }> = [
    { rootOffset: 0, thirds: 3, fifthsInterval: 7, suffix: "m",   priority: 0 }, // i
    { rootOffset: 2, thirds: 3, fifthsInterval: 6, suffix: "dim", priority: 4 }, // ii°
    { rootOffset: 3, thirds: 4, fifthsInterval: 7, suffix: "",    priority: 5 }, // III
    { rootOffset: 5, thirds: 3, fifthsInterval: 7, suffix: "m",   priority: 2 }, // iv
    { rootOffset: 7, thirds: 4, fifthsInterval: 7, suffix: "",    priority: 1 }, // V (harmonic)
    { rootOffset: 8, thirds: 4, fifthsInterval: 7, suffix: "",    priority: 3 }, // VI
    { rootOffset: 10, thirds: 4, fifthsInterval: 7, suffix: "",   priority: 6 }, // VII
  ];

  return triadDefs.map((def, idx) => {
    const r = (tonicPc + def.rootOffset) % 12;
    const t = (r + def.thirds) % 12;
    const f = (r + def.fifthsInterval) % 12;
    return {
      degree: idx + 1,
      rootPc: r,
      pcs: [r, t, f],
      symbol: pcNameInKey(r, fifths) + def.suffix,
      priority: def.priority,
    };
  });
}

// ---------------------------------------------------------------------------
// Cadence detection
// ---------------------------------------------------------------------------

/**
 * Detect cadence type from scale degrees of the last two melody notes in a
 * phrase.
 *
 * Rules:
 *  - ^1 after ^7 or ^2 → PAC
 *  - ^1 after ^4        → PC (plagal) or IAC
 *  - ^5                 → HC
 *  - ^1 after ^6        → DC (deceptive)
 *  - ^1 from anything else → IAC
 */
function detectCadence(
  penultimateDeg: number,
  finalDeg: number
): "PAC" | "IAC" | "HC" | "DC" | "PC" | undefined {
  if (finalDeg === 5) return "HC";
  if (finalDeg === 1) {
    if (penultimateDeg === 7 || penultimateDeg === 2) return "PAC";
    if (penultimateDeg === 4) return "PC";
    if (penultimateDeg === 6) return "DC";
    return "IAC";
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Chord assignment — per beat
// ---------------------------------------------------------------------------

/**
 * Given a melody note's scale degree, return the preferred chord function
 * (as a degree 1-7) for harmonization in major.
 */
function preferredDegreesMajor(deg: number): number[] {
  switch (deg) {
    case 1: return [1, 6, 4];      // ^1 → I, vi, IV
    case 2: return [2, 5, 4];      // ^2 → ii, V, IV
    case 3: return [1, 6, 3];      // ^3 → I, vi, iii
    case 4: return [4, 2, 6];      // ^4 → IV, ii, vi
    case 5: return [1, 5, 3];      // ^5 → I, V, iii
    case 6: return [6, 4, 2];      // ^6 → vi, IV, ii
    case 7: return [5, 7];         // ^7 → V, vii°
    default: return [1, 4, 5];     // chromatic → tonic group
  }
}

/**
 * Given a melody note's scale degree, return the preferred chord function
 * (as a degree 1-7) for harmonization in minor.
 */
function preferredDegreesMinor(deg: number): number[] {
  switch (deg) {
    case 1: return [1, 6, 4];      // ^1 → i, VI, iv
    case 2: return [2, 5, 4];      // ^2 → ii°, V, iv
    case 3: return [3, 1];         // ^3 → III, i
    case 4: return [4, 2, 6];      // ^4 → iv, ii°, VI
    case 5: return [1, 5, 3];      // ^5 → i, V, III
    case 6: return [6, 4];         // ^6 → VI, iv
    case 7: return [5, 7];         // ^7 → V (harmonic), VII
    default: return [1, 4, 5];
  }
}

// ---------------------------------------------------------------------------
// Progression smoothing
// ---------------------------------------------------------------------------

/**
 * Penalty score for a chord progression from one scale degree to another.
 * Lower scores are preferred.
 */
function progressionPenalty(
  prevDeg: number | null,
  nextDeg: number,
  mode: "major" | "minor"
): number {
  if (prevDeg === null) return 0;
  if (prevDeg === nextDeg) return 1; // small repetition cost

  if (mode === "major") {
    const good = new Set(["1->4","1->5","1->6","2->5","4->1","4->5","5->1","5->6","6->2","6->4"]);
    return good.has(`${prevDeg}->${nextDeg}`) ? 0 : 3;
  } else {
    const good = new Set(["1->4","1->5","1->6","2->5","4->5","4->1","5->1","5->6","6->2","6->5"]);
    return good.has(`${prevDeg}->${nextDeg}`) ? 0 : 3;
  }
}

// ---------------------------------------------------------------------------
// Main harmonization logic
// ---------------------------------------------------------------------------

/**
 * Assign chord events to a single phrase of melody notes.
 * Returns { measure, t, symbol } events and the detected cadence.
 */
function harmonizePhrase(
  phraseNotes: MelodyNote[],
  chords: DiatonicChord[],
  mode: "major" | "minor",
  scalePcs: number[],
  minChordDuration: number,
  isLastPhrase: boolean,
  fifths: number
): {
  events: { measure: number; t: number; symbol: string }[];
  cadenceType?: "PAC" | "IAC" | "HC" | "DC" | "PC";
} {
  if (!phraseNotes.length) return { events: [] };

  const preferDegrees = mode === "major" ? preferredDegreesMajor : preferredDegreesMinor;
  const tonicPc = chords[0]!.rootPc;
  const domChord = chords[4]!; // degree 5

  // Force final cadence: penultimate → V (or V7), final → I
  // V7 symbol: dominant root + "7"
  const tonicSymbol = chords[0]!.symbol;
  const dom7Symbol = pcNameInKey(domChord.rootPc, fifths) + "7";

  // Assign a chord for each note position, respecting minChordDuration
  type Beat = {
    measure: number;
    t: number;
    deg: number; // chosen chord degree
    symbol: string;
  };

  const beats: Beat[] = [];
  let lastChordEndTime = -Infinity; // track when the previous chord block ends
  let prevDeg: number | null = null;

  // If this is the last phrase, force the last two notes to V7 → I
  const forcedCadenceStart = isLastPhrase ? Math.max(0, phraseNotes.length - 2) : -1;

  for (let i = 0; i < phraseNotes.length; i++) {
    const note = phraseNotes[i]!;
    const noteTime = note.measure * 1000 + note.t;
    const isWeakBeat = note.t === 0.5 || note.t === 1.5 || note.t === 2.5 || note.t === 3.5;

    // Forced cadence: second-to-last → V7, last → I
    if (i === forcedCadenceStart && isLastPhrase) {
      beats.push({ measure: note.measure, t: note.t, deg: 5, symbol: dom7Symbol });
      prevDeg = 5;
      lastChordEndTime = noteTime + note.dur;
      continue;
    }
    if (i === forcedCadenceStart + 1 && isLastPhrase) {
      beats.push({ measure: note.measure, t: note.t, deg: 1, symbol: tonicSymbol });
      prevDeg = 1;
      lastChordEndTime = noteTime + note.dur;
      continue;
    }

    // Skip changing harmony on weak beats unless sufficient duration has passed
    const durationSinceLastChord = noteTime - lastChordEndTime + note.dur;
    if (isWeakBeat && durationSinceLastChord < minChordDuration) {
      // Reuse current chord — no new event needed
      continue;
    }

    // Look up scale degree of this note
    const notePc = pc(note.midi);
    const deg = scaleDegree(notePc, scalePcs);

    // Get preferred chord degrees for this scale degree
    const preferred = preferDegrees(deg); // 1-indexed degree list

    let bestChord: DiatonicChord = chords[0]!;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const prefDeg of preferred) {
      const chord = chords.find((c) => c.degree === prefDeg);
      if (!chord) continue;
      // Score = preference rank + progression penalty
      const rank = preferred.indexOf(prefDeg);
      const penalty = progressionPenalty(prevDeg, chord.degree, mode);
      const total = rank + penalty;
      if (total < bestScore) {
        bestScore = total;
        bestChord = chord;
      }
    }

    // If melody note is chromatic (deg === 0), try to find the best matching chord
    if (deg === 0) {
      for (const chord of chords) {
        if (chord.pcs.includes(notePc)) {
          const penalty = progressionPenalty(prevDeg, chord.degree, mode);
          const total = chord.priority + penalty;
          if (total < bestScore) {
            bestScore = total;
            bestChord = chord;
          }
        }
      }
    }

    // Avoid pushing a duplicate adjacent chord
    const lastBeat = beats[beats.length - 1];
    if (lastBeat && lastBeat.deg === bestChord.degree && lastBeat.measure === note.measure) {
      // same chord in same measure — skip
      continue;
    }

    beats.push({ measure: note.measure, t: note.t, deg: bestChord.degree, symbol: bestChord.symbol });
    prevDeg = bestChord.degree;
    lastChordEndTime = noteTime + note.dur;
  }

  // Deduplicate: remove consecutive identical chord symbols
  const deduped: { measure: number; t: number; symbol: string }[] = [];
  let lastSym = "";
  for (const b of beats) {
    if (b.symbol !== lastSym) {
      deduped.push({ measure: b.measure, t: b.t, symbol: b.symbol });
      lastSym = b.symbol;
    }
  }

  // Cadence detection from final two melody notes of phrase
  const last = phraseNotes[phraseNotes.length - 1];
  const penult = phraseNotes.length >= 2 ? phraseNotes[phraseNotes.length - 2] : null;

  let cadenceType: "PAC" | "IAC" | "HC" | "DC" | "PC" | undefined;
  if (last) {
    const finalDeg = scaleDegree(pc(last.midi), scalePcs);
    const penultDeg = penult ? scaleDegree(pc(penult.midi), scalePcs) : 0;
    cadenceType = detectCadence(penultDeg, finalDeg);
  }

  return { events: deduped, cadenceType };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Harmonize a melody represented as an array of MelodyNote objects.
 *
 * Performs key detection (Krumhansl-Schmuckler), phrase detection, and
 * assigns diatonic chord events with cadence analysis.
 *
 * @param notes      Melody notes sorted by (measure, t).
 * @param options    Optional overrides:
 *   - `style`             — reserved for future style profiles (ignored for now).
 *   - `minChordDuration`  — minimum beats before a new chord can appear on a
 *                           weak beat (default: 1.0).
 * @returns HarmonizationResult ready for the arrangement pipeline.
 */
export function harmonizeMelody(
  notes: MelodyNote[],
  options?: { style?: string; minChordDuration?: number }
): HarmonizationResult {
  const minChordDuration = options?.minChordDuration ?? 1.0;
  const warnings: string[] = [];

  if (!notes.length) {
    warnings.push("No notes provided; returning empty harmonization.");
    return {
      key: { fifths: 0, mode: "major", root: "C" },
      chordEvents: [],
      phrases: [],
      warnings,
    };
  }

  // Sort notes by measure then beat
  const sorted = [...notes].sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.t - b.t
  );

  // --- Key detection ---
  const { key, warnings: keyWarnings } = detectKey(sorted);
  warnings.push(...keyWarnings);

  const tonicPc =
    key.mode === "major"
      ? (MAJOR_TONIC_PC[key.fifths] ?? 0)
      : (MINOR_TONIC_PC[key.fifths] ?? 9);

  const scalePcs =
    key.mode === "major" ? majorScalePcs(tonicPc) : minorScalePcs(tonicPc);

  const chords =
    key.mode === "major"
      ? buildDiatonicChordsMajor(tonicPc, key.fifths)
      : buildDiatonicChordsMinor(tonicPc, key.fifths);

  // --- Collect rests for phrase detection ---
  // We don't have explicit rest objects from MelodyNote[]; approximate gaps
  // between consecutive notes as rests.
  const inferredRests: Array<{ measure: number; t: number; dur: number }> = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const prevEndMeasure = prev.measure;
    const prevEndBeat = prev.t + prev.dur;
    // Only infer rests within the same measure for simplicity
    if (prev.measure === curr.measure && prevEndBeat < curr.t) {
      inferredRests.push({
        measure: prev.measure,
        t: prevEndBeat,
        dur: curr.t - prevEndBeat,
      });
    }
  }

  // --- Phrase detection ---
  const { phrases: phraseSpans } = detectPhrases(sorted, inferredRests);

  const phraseInfos: PhraseInfo[] = [];
  const allChordEvents: { measure: number; t: number; symbol: string }[] = [];

  for (let p = 0; p < phraseSpans.length; p++) {
    const span = phraseSpans[p]!;
    const phraseNotes = sorted.slice(span.startIdx, span.endIdx + 1);
    const isLast = p === phraseSpans.length - 1;

    if (!phraseNotes.length) continue;

    const { events, cadenceType } = harmonizePhrase(
      phraseNotes,
      chords,
      key.mode,
      scalePcs,
      minChordDuration,
      isLast,
      key.fifths
    );

    allChordEvents.push(...events);

    const firstNote = phraseNotes[0]!;
    const lastNote = phraseNotes[phraseNotes.length - 1]!;

    phraseInfos.push({
      startMeasure: firstNote.measure,
      endMeasure: lastNote.measure,
      endBeat: lastNote.t,
      cadenceType,
    });
  }

  // Final deduplication: remove consecutive identical chord symbols across phrases
  const deduped: { measure: number; t: number; symbol: string }[] = [];
  let lastSym = "";
  for (const ev of allChordEvents) {
    if (ev.symbol !== lastSym) {
      deduped.push(ev);
      lastSym = ev.symbol;
    }
  }

  return {
    key,
    chordEvents: deduped,
    phrases: phraseInfos,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// ScoreModel extractor
// ---------------------------------------------------------------------------

/**
 * Extract melody notes from the engine's internal ScoreModel format.
 *
 * Reads `scoreModel.parts[0].measures`, filtering for events with
 * `type === "note"`, and converts `t` and `dur` from divisions to beats
 * using the measure's `attributes.divisions` value.
 *
 * @param scoreModel  The engine's ScoreModel (typed as `unknown` to avoid
 *                    hard coupling to the ScoreModel import).
 * @returns Sorted array of MelodyNote objects.
 */
export function extractMelodyFromScore(scoreModel: unknown): MelodyNote[] {
  const score = scoreModel as {
    parts?: Array<{
      measures?: Array<{
        number?: number;
        attributes?: { divisions?: number };
        events?: Array<{
          type?: string;
          t?: number;
          dur?: number;
          midi?: number;
          pitch?: { step?: string; alter?: number; octave?: number };
          isRest?: boolean;
          voice?: number;
        }>;
      }>;
    }>;
    global?: { divisions?: number };
  };

  const parts = score?.parts;
  if (!parts || !parts.length) return [];

  const part = parts[0]!;
  const measures = part.measures ?? [];
  const globalDivisions: number = (score.global?.divisions as number) ?? 1;

  const notes: MelodyNote[] = [];

  for (let mi = 0; mi < measures.length; mi++) {
    const measure = measures[mi]!;
    const measureNumber = typeof measure.number === "number" ? measure.number : mi + 1;
    const divisions: number = measure.attributes?.divisions ?? globalDivisions;
    const divisionsPerBeat = divisions > 0 ? divisions : 1;

    for (const event of measure.events ?? []) {
      if (event.type !== "note") continue;
      if (event.isRest) continue;
      if (typeof event.midi !== "number") continue;

      const tBeats = (event.t ?? 0) / divisionsPerBeat;
      const durBeats = (event.dur ?? 0) / divisionsPerBeat;
      const pitch = event.pitch ?? {};

      notes.push({
        measure: measureNumber,
        t: tBeats,
        dur: durBeats,
        midi: event.midi,
        pitch: {
          step: pitch.step ?? "C",
          alter: pitch.alter,
          octave: pitch.octave ?? 4,
        },
      });
    }
  }

  return notes.sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.t - b.t
  );
}

// ---------------------------------------------------------------------------
// MusicXML parser
// ---------------------------------------------------------------------------

/**
 * Parse melody notes from a MusicXML string without external dependencies.
 *
 * Uses a minimal regex-based XML parser compatible with both Node.js and
 * browser environments. Reads the first `<part>` element, iterating over
 * `<measure>` → `<note>` elements to extract pitch, duration, and position.
 *
 * Division-to-beat conversion uses the `<divisions>` value from `<attributes>`.
 *
 * @param xml  Raw MusicXML string.
 * @returns Sorted array of MelodyNote objects.
 */
export function parseMelodyFromMusicXML(xml: string): MelodyNote[] {
  // -------------------------------------------------------------------------
  // Minimal XML helpers — no DOM dependency
  // -------------------------------------------------------------------------

  /**
   * Extract the text content of the first occurrence of `<tag>` within `src`.
   * Handles self-closing tags gracefully (returns "").
   */
  function tagText(src: string, tag: string): string {
    const openRe = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
    const m = openRe.exec(src);
    return m ? m[1]!.trim() : "";
  }

  /**
   * Extract the value of an attribute from an opening tag string.
   */
  function attrValue(tagStr: string, attr: string): string {
    const re = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`);
    const m = re.exec(tagStr);
    return m ? m[1]! : "";
  }

  /**
   * Split a string into an array of `<tag ...>...</tag>` substrings.
   * Handles nested tags of the same name (up to a reasonable depth).
   */
  function splitElements(src: string, tag: string): string[] {
    const result: string[] = [];
    const openTag = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
    const closeTag = new RegExp(`<\\/${tag}>`, "gi");

    let pos = 0;
    while (pos < src.length) {
      openTag.lastIndex = pos;
      const openMatch = openTag.exec(src);
      if (!openMatch) break;

      const start = openMatch.index;
      let depth = 1;
      let searchFrom = start + openMatch[0].length;

      while (depth > 0 && searchFrom < src.length) {
        openTag.lastIndex = searchFrom;
        closeTag.lastIndex = searchFrom;

        const nextOpen = openTag.exec(src);
        const nextClose = closeTag.exec(src);

        if (!nextClose) break; // malformed XML

        if (nextOpen && nextOpen.index < nextClose.index) {
          depth++;
          searchFrom = nextOpen.index + nextOpen[0].length;
        } else {
          depth--;
          if (depth === 0) {
            const end = nextClose.index + nextClose[0].length;
            result.push(src.slice(start, end));
            pos = end;
          } else {
            searchFrom = nextClose.index + nextClose[0].length;
          }
        }
      }

      if (depth !== 0) break; // safety exit
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // MIDI pitch from MusicXML pitch element
  // -------------------------------------------------------------------------

  const STEP_TO_PC: Record<string, number> = {
    C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  };

  function midiFromPitch(step: string, alter: number, octave: number): number {
    const basePc = STEP_TO_PC[step.toUpperCase()] ?? 0;
    return (octave + 1) * 12 + basePc + Math.round(alter);
  }

  // -------------------------------------------------------------------------
  // Parse
  // -------------------------------------------------------------------------

  // Find the first <part> element (may have id attribute)
  const partElements = splitElements(xml, "part");
  if (!partElements.length) return [];
  const partXml = partElements[0]!;

  const measureElements = splitElements(partXml, "measure");
  const notes: MelodyNote[] = [];

  let currentDivisions = 1;
  let currentMeasureNumber = 1;
  let currentT = 0; // running beat offset within measure (in divisions)

  for (const measureXml of measureElements) {
    // Extract measure number from opening tag
    const measureOpenTag = measureXml.match(/^<measure[^>]*>/i)?.[0] ?? "";
    const numStr = attrValue(measureOpenTag, "number");
    currentMeasureNumber = numStr ? parseInt(numStr, 10) : currentMeasureNumber + 1;
    currentT = 0;

    // Check for attributes update (divisions, etc.)
    const attrBlock = tagText(measureXml, "attributes");
    if (attrBlock) {
      const divText = tagText(attrBlock, "divisions");
      if (divText) {
        const d = parseInt(divText, 10);
        if (d > 0) currentDivisions = d;
      }
    }

    // Process each <note> in order
    const noteElements = splitElements(measureXml, "note");

    for (const noteXml of noteElements) {
      // Duration in divisions
      const durText = tagText(noteXml, "duration");
      const durDivisions = durText ? parseInt(durText, 10) : 0;

      // Chord tag: this note starts at the same time as the previous note
      const isChord = /<chord\s*\/?>/.test(noteXml) || noteXml.includes("<chord>");

      if (isChord) {
        // Reset t to what it was before the previous note advanced it
        // We'll handle this by tracking the last non-chord note's position
        // and not advancing t for chord notes.
      } else {
        // will advance t after processing
      }

      // Rest check
      const isRest = /<rest\s*\/?>/.test(noteXml) || noteXml.includes("<rest>");
      if (isRest) {
        if (!isChord) currentT += durDivisions;
        continue;
      }

      // Pitch extraction
      const pitchBlock = tagText(noteXml, "pitch");
      if (!pitchBlock) {
        if (!isChord) currentT += durDivisions;
        continue;
      }

      const stepText = tagText(pitchBlock, "step").toUpperCase();
      const alterText = tagText(pitchBlock, "alter");
      const octaveText = tagText(pitchBlock, "octave");

      const step = stepText || "C";
      const alter = alterText ? parseFloat(alterText) : 0;
      const octave = octaveText ? parseInt(octaveText, 10) : 4;

      const midiVal = midiFromPitch(step, alter, octave);
      const tBeats = currentT / (currentDivisions > 0 ? currentDivisions : 1);
      const durBeats = durDivisions / (currentDivisions > 0 ? currentDivisions : 1);

      notes.push({
        measure: currentMeasureNumber,
        t: tBeats,
        dur: durBeats,
        midi: midiVal,
        pitch: { step, alter: alter !== 0 ? alter : undefined, octave },
      });

      if (!isChord) currentT += durDivisions;
    }
  }

  return notes.sort((a, b) =>
    a.measure !== b.measure ? a.measure - b.measure : a.t - b.t
  );
}
