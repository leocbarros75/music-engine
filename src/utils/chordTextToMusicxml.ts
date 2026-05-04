// src/utils/chordTextToMusicxml.ts
// Converts a plain-text chord progression into a minimal MusicXML file
// that the arrangement pipeline can process.
//
// Input format (flexible):
//   "C Am F G"                  — one chord per token, 4/4, one chord per measure
//   "C | Am | F | G"            — bar lines as separators
//   "C Am / F G | Em Am / D G"  — slash = beat grouping, pipe = bar line
//
// Each chord gets one whole-note "melody" event on the chord root.
// The pipeline will harmonize around it.

import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

// ── Key Detection ─────────────────────────────────────────────────────────────

/**
 * Infer the most likely key from a chord progression.
 *
 * Algorithm:
 *  - Last chord gets weight 3 (cadence = tonic), first chord weight 2, rest weight 1.
 *  - Dominant-7th chords (e.g. G7) imply a tonic a P4 above; add 2× weight to that root.
 *  - Diminished / half-diminished chords imply a tonic a semitone above their root.
 *  - The pitch class with the highest cumulative score becomes the tonic.
 *  - Mode: if the final chord's root matches the tonic and is minor → minor key.
 */
function inferKeyFromChords(chords: ParsedChord[]): { fifths: number; mode: "major" | "minor" } {
  if (!chords.length) return { fifths: 0, mode: "major" };

  // Pitch-class → circle-of-fifths index for major key signatures
  const PC_TO_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]; // C C# D Eb E F F# G Ab A Bb B

  const scores = new Float32Array(12);
  const n = chords.length;

  for (let i = 0; i < n; i++) {
    const sym  = chords[i]!.symbol;
    const parsed = parseChordSymbol(sym);
    if (!parsed) continue;

    const root = parsed.rootPc;
    const w    = i === n - 1 ? 3 : i === 0 ? 2 : 1; // cadence emphasis

    scores[root] += w;

    // G7-style dominant → tonic a perfect 4th above (root+5)
    if (/^[A-G][#b]?7$/.test(sym)) {
      scores[(root + 5) % 12] += w * 2;
    }

    // Diminished / half-diminished → tonic a semitone above root (leading-tone chord)
    if (/^[A-G][#b]?(m7b5|dim7?|ø)/i.test(sym)) {
      scores[(root + 1) % 12] += w * 1.2;
    }
  }

  // Pick best tonic pitch class
  let bestPc = 0;
  let bestScore = -1;
  for (let p = 0; p < 12; p++) {
    if (scores[p] > bestScore) { bestScore = scores[p]; bestPc = p; }
  }

  // Mode: final chord on that root being minor → natural minor key
  const lastSym    = chords[n - 1]!.symbol;
  const lastParsed = parseChordSymbol(lastSym);
  const lastRoot   = lastParsed?.rootPc ?? -1;
  const lastMinor  = /^[A-G][#b]?m(?!aj)/i.test(lastSym);
  const isMinor    = lastRoot === bestPc && lastMinor;

  // Minor uses the relative-major key signature (tonic + minor-third = 3 semitones)
  const sigPc  = isMinor ? (bestPc + 3) % 12 : bestPc;
  const fifths = PC_TO_FIFTHS[sigPc] ?? 0;

  return { fifths, mode: isMinor ? "minor" : "major" };
}

// ── Soprano melody contour ────────────────────────────────────────────────────

/**
 * Choose the best MIDI note for the soprano melody at a given chord.
 *
 * Prefers smooth voice-leading (small leap from the previous note) and applies
 * a gentle arch-shape contour: the melody trends upward in the first half of the
 * progression and downward in the second half.
 *
 * @param chordPcs  All pitch classes of this chord (root, 3rd, 5th, extensions…)
 * @param prevMidi  Previous soprano MIDI note, or null for the first chord
 * @param rangeMin  Lowest allowed MIDI (60 = C4)
 * @param rangeMax  Highest allowed MIDI (81 = A5)
 * @param phase     Position in the progression: 0.0 = first chord, 1.0 = last chord
 */
function chooseSopranoMidi(
  chordPcs: number[],
  prevMidi: number | null,
  rangeMin: number,
  rangeMax: number,
  phase: number
): number {
  // Collect all MIDI candidates within the soprano range
  const candidates: number[] = [];
  for (const pc of chordPcs) {
    for (let m = rangeMin; m <= rangeMax; m++) {
      if (((m % 12) + 12) % 12 === pc) candidates.push(m);
    }
  }
  if (!candidates.length) return 72; // C5 fallback

  if (prevMidi === null) {
    // First chord: land in the upper-middle of the register (around E5 = 76)
    const target = 76;
    return candidates.reduce((best, c) =>
      Math.abs(c - target) < Math.abs(best - target) ? c : best
    );
  }

  let best      = candidates[0]!;
  let bestScore = Infinity;

  for (const c of candidates) {
    const leap = Math.abs(c - prevMidi);
    let score  = leap;                           // minimise leap

    if (leap === 0)  score += 3;                 // slight penalty for exact repetition
    if (leap > 5)    score += (leap - 5) * 2;   // steep penalty for large leaps

    // Arch contour: first half favours ascent, second half favours descent
    if (phase < 0.45 && c < prevMidi && leap > 0) score += 2;
    if (phase > 0.55 && c > prevMidi && leap > 0) score += 2;

    // Mild preference against always landing on the root (more interest on 3rd/5th)
    if (chordPcs.length > 1 && ((c % 12 + 12) % 12) === chordPcs[0]) score += 0.8;

    if (score < bestScore) { bestScore = score; best = c; }
  }

  return best;
}

/** Convert a MIDI note number to { step, alter, octave } for MusicXML output. */
function midiToNote(midi: number): { step: string; alter: number; octave: number } {
  const pc    = ((midi % 12) + 12) % 12;
  const octave = Math.floor(midi / 12) - 1;
  const { step, alter } = pcToStep(pc);
  return { step, alter, octave };
}

// Map pitch-class → step + alter for concert pitch representation
const PC_TO_PITCH: Array<{ step: string; alter: number }> = [
  { step: "C", alter: 0 },
  { step: "C", alter: 1 },
  { step: "D", alter: 0 },
  { step: "E", alter: -1 },
  { step: "E", alter: 0 },
  { step: "F", alter: 0 },
  { step: "F", alter: 1 },
  { step: "G", alter: 0 },
  { step: "A", alter: -1 },
  { step: "A", alter: 0 },
  { step: "B", alter: -1 },
  { step: "B", alter: 0 }
];

function pcToStep(pc: number): { step: string; alter: number } {
  return PC_TO_PITCH[((pc % 12) + 12) % 12] ?? { step: "C", alter: 0 };
}

function noteXml(
  step: string,
  alter: number,
  octave: number,
  duration: number,
  type: string,
  isFirst: boolean,
  harmonyXml = ""
): string {
  const alterXml = alter !== 0 ? `<alter>${alter}</alter>` : "";
  return `${harmonyXml}
      <note>
        <pitch><step>${step}</step>${alterXml}<octave>${octave}</octave></pitch>
        <duration>${duration}</duration>
        <type>${type}</type>
      </note>`;
}

function harmonyXml(symbol: string): string {
  const parsed = parseChordSymbol(symbol);
  if (!parsed) return "";
  const rootPc = typeof parsed.rootPc === "number" ? parsed.rootPc : 0;
  const { step, alter } = pcToStep(rootPc);
  const alterXml = alter !== 0 ? `<root-alter>${alter}</root-alter>` : "";
  // Determine kind text from parsed chord
  const kind = determineKind(symbol);
  return `
      <harmony>
        <root><root-step>${step}</root-step>${alterXml}</root>
        <kind>${kind}</kind>
      </harmony>`;
}

function determineKind(symbol: string): string {
  const s = symbol.replace(/^[A-Ga-g][#b]?/, "").toLowerCase();
  if (s.startsWith("m7b5") || s.startsWith("ø")) return "half-diminished";
  if (s.startsWith("dim7") || s.startsWith("°7")) return "diminished-seventh";
  if (s.startsWith("dim") || s.startsWith("°")) return "diminished";
  if (s.startsWith("maj7") || s.startsWith("Δ7")) return "major-seventh";
  if (s.startsWith("maj") || s.startsWith("Δ")) return "major";
  if (s.startsWith("m7") || s.startsWith("-7")) return "minor-seventh";
  if (s.startsWith("m") || s.startsWith("-")) return "minor";
  if (s.startsWith("7")) return "dominant";
  if (s.startsWith("6")) return "major-sixth";
  if (s.startsWith("9")) return "dominant-ninth";
  if (s === "") return "major";
  return "major";
}

type ParsedChord = { symbol: string; measure: number; beat: number };

/**
 * Parse a free-text chord progression string into structured chord events.
 * Bars are separated by `|`; chords within a bar are separated by spaces or `/`.
 * Returns array of { symbol, measure (1-based), beat (0-based divisions) }.
 */
export function parseChordText(text: string): ParsedChord[] {
  const result: ParsedChord[] = [];
  // Split into bars
  const bars = text.split(/\s*\|\s*/);
  let measureNum = 1;

  for (const bar of bars) {
    const tokens = bar.trim().split(/[\s/]+/).filter(Boolean);
    if (!tokens.length) { measureNum++; continue; }

    // Each token in a bar occupies equal subdivisions of 4 beats
    const beatsPerChord = 4 / tokens.length;
    tokens.forEach((sym, idx) => {
      const beat = idx * beatsPerChord;
      // Validate token looks like a chord symbol
      if (/^[A-Ga-g]/.test(sym)) {
        result.push({ symbol: sym, measure: measureNum, beat });
      }
    });
    measureNum++;
  }

  return result;
}

/**
 * Build a minimal MusicXML score from a chord progression text.
 * Returns the XML string and any warnings.
 */
export function chordTextToMusicxml(
  chordText: string,
  options: {
    title?: string;
    beatsPerMeasure?: number;
    keyFifths?: number;
  } = {}
): { musicxml: string; warnings: string[]; chords: ParsedChord[] } {
  const warnings: string[] = [];
  const beats     = options.beatsPerMeasure ?? 4;
  const title     = options.title ?? "Chord Progression";
  const DIVISIONS = 4; // quarter note = 4 divisions

  const chords = parseChordText(chordText);
  if (!chords.length) {
    warnings.push("No valid chord symbols found. Use letter names like C, Am, F7, Dm/A.");
    return { musicxml: "", warnings, chords: [] };
  }

  // Auto-detect key unless the caller already supplied one
  const { fifths: inferredFifths, mode: inferredMode } = inferKeyFromChords(chords);
  const keyFifths = options.keyFifths ?? inferredFifths;
  const keyMode   = inferredMode;

  // Soprano range limits (C4–A5)
  const SOPR_MIN = 60;
  const SOPR_MAX = 81;
  const totalChords = chords.length;
  let prevSopranoMidi: number | null = null; // tracks contour across measures

  const measureCount = Math.max(...chords.map((c) => c.measure));
  const measureXmls: string[] = [];

  for (let m = 1; m <= measureCount; m++) {
    const chordsInMeasure = chords.filter((c) => c.measure === m);
    let measureContent = "";

    // Add attributes to first measure
    if (m === 1) {
      measureContent += `
      <attributes>
        <divisions>${DIVISIONS}</divisions>
        <key><fifths>${keyFifths}</fifths><mode>${keyMode}</mode></key>
        <time><beats>${beats}</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>`;
    }

    if (!chordsInMeasure.length) {
      // Rest measure
      measureContent += `
      <note><rest/><duration>${beats * DIVISIONS}</duration><type>whole</type></note>`;
    } else if (chordsInMeasure.length === 1) {
      // One chord per measure — whole note with melodic contour
      const chord    = chordsInMeasure[0]!;
      const parsed   = parseChordSymbol(chord.symbol);
      const chordPcs = parsed?.pcs ?? [parsed?.rootPc ?? 0];
      // global chord index for phase calculation
      const globalIdx = chords.indexOf(chord);
      const phase     = totalChords > 1 ? globalIdx / (totalChords - 1) : 0;
      const midi      = chooseSopranoMidi(chordPcs, prevSopranoMidi, SOPR_MIN, SOPR_MAX, phase);
      const { step, alter, octave } = midiToNote(midi);
      prevSopranoMidi = midi;
      const hXml = harmonyXml(chord.symbol);
      measureContent += noteXml(step, alter, octave, beats * DIVISIONS, beats === 4 ? "whole" : "half", true, hXml);
    } else {
      // Multiple chords in one measure — distribute evenly with smooth voice-leading
      const sortedChords   = [...chordsInMeasure].sort((a, b) => a.beat - b.beat);
      const totalDivisions = beats * DIVISIONS;
      sortedChords.forEach((chord, idx) => {
        const nextBeat = idx + 1 < sortedChords.length ? sortedChords[idx + 1]!.beat : beats;
        const dur      = Math.round((nextBeat - chord.beat) * DIVISIONS);
        if (dur <= 0) return;
        const parsed   = parseChordSymbol(chord.symbol);
        const chordPcs = parsed?.pcs ?? [parsed?.rootPc ?? 0];
        const globalIdx = chords.indexOf(chord);
        const phase     = totalChords > 1 ? globalIdx / (totalChords - 1) : 0;
        const midi      = chooseSopranoMidi(chordPcs, prevSopranoMidi, SOPR_MIN, SOPR_MAX, phase);
        const { step, alter, octave } = midiToNote(midi);
        prevSopranoMidi = midi;
        const noteType = dur >= totalDivisions ? "whole" : dur >= totalDivisions / 2 ? "half" : "quarter";
        const hXml = harmonyXml(chord.symbol);
        measureContent += noteXml(step, alter, octave, dur, noteType, idx === 0, hXml);
      });
    }

    measureXmls.push(`    <measure number="${m}">${measureContent}
    </measure>`);
  }

  const musicxml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN"
  "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <work><work-title>${title}</work-title></work>
  <part-list>
    <score-part id="P1">
      <part-name>Melody</part-name>
      <score-instrument id="P1-I1"><instrument-name>Piano</instrument-name></score-instrument>
    </score-part>
  </part-list>
  <part id="P1">
${measureXmls.join("\n")}
  </part>
</score-partwise>`;

  return { musicxml, warnings, chords };
}
