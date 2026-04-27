// src/arrange/spacing.ts

import { InstrumentCatalog, shiftOctavesIntoRange, type InstrumentId } from "../instruments/instrumentCatalog";

export type SpacingMode = "open_classical" | "compact";

export type SpacingVoice = {
  instrumentId: InstrumentId;
  midi: number; // one pitch at a given time-slice
};

export type SpacingOptions = {
  mode: SpacingMode;
  // Optional override: if you want a different gap policy later
  minGapAboveC4?: number; // semitones
  minGapMid?: number;     // semitones
  minGapLow?: number;     // semitones
};

function getDefaultGaps(mode: SpacingMode) {
  // These are semitone minimums between adjacent voices (top to bottom).
  // The gaps get wider as we go lower.
  if (mode === "compact") {
    return {
      aboveC4: 3, // m3
      mid: 5,     // P4-ish
      low: 9      // M6-ish (still tighter than open)
    };
  }

  // open_classical
  return {
    aboveC4: 4,  // M3
    mid: 7,      // P5
    low: 12      // octave
  };
}

function pickMinGap(prevMidi: number, nextMidi: number, gaps: { aboveC4: number; mid: number; low: number }) {
  // We base the spacing requirement on the LOWER of the two pitches
  const lowMidi = Math.min(prevMidi, nextMidi);

  // Thresholds
  const C4 = 60;
  const C3 = 48;

  if (lowMidi >= C4) return gaps.aboveC4;
  if (lowMidi >= C3) return gaps.mid;
  return gaps.low;
}

function clampIntoInstrumentRange(instrumentId: InstrumentId, midi: number): number {
  const spec = InstrumentCatalog[instrumentId];
  const lo = spec?.midi_low ?? 0;
  const hi = spec?.midi_high ?? 127;
  return shiftOctavesIntoRange(midi, lo, hi);
}

function isBassAnchor(instrumentId: InstrumentId): boolean {
  // Add more later if you introduce contrabass.
  return instrumentId === "tuba_c" || instrumentId === "cello" || instrumentId === "timpani";
}

function sortTopToBottom(voices: SpacingVoice[]): SpacingVoice[] {
  // This is the standard orchestral vertical order you requested:
  // woodwinds, brass, percussion, strings
  const rank: Record<string, number> = {
    // Woodwinds
    flute: 10,
    oboe: 20,
    clarinet_bb: 30,
    bassoon: 40,

    // Brass
    trumpet_bb_1: 50,
    trumpet_bb_2: 60,
    horn_f: 70,
    trombone: 80,
    bass_trombone: 85,
    tuba_c: 90,

    // Percussion
    timpani: 100,
    glockenspiel: 110,
    vibraphone: 120,
    marimba: 130,
    xylophone: 140,
    tubular_bells: 150,

    // Strings
    violin_1: 200,
    violin_2: 210,
    viola: 220,
    cello: 230
  };

  return voices
    .slice()
    .sort((a, b) => (rank[a.instrumentId] ?? 9999) - (rank[b.instrumentId] ?? 9999));
}

/**
 * Space a single vertical slice (one chord moment) using octave shifts only.
 * Input is any set of voices with initial midi choices.
 * Output has the same voices with adjusted midi pitches.
 */
export function applySpacingToSlice(
  input: SpacingVoice[],
  mode: SpacingMode,
  options: Partial<SpacingOptions> = {}
): SpacingVoice[] {
  const gaps = getDefaultGaps(mode);
  const finalGaps = {
    aboveC4: options.minGapAboveC4 ?? gaps.aboveC4,
    mid: options.minGapMid ?? gaps.mid,
    low: options.minGapLow ?? gaps.low
  };

  const ordered = sortTopToBottom(input).map(v => ({
    instrumentId: v.instrumentId,
    midi: clampIntoInstrumentRange(v.instrumentId, v.midi)
  }));

  if (ordered.length <= 1) return ordered;

  // Step 1: anchor the lowest bass-like voice (if present) by pushing it down first.
  // We keep it in-range, but prefer it to be the lowest.
  // Then we space upwards from bottom to top.
  const bottomIndex = ordered.length - 1;

  // If the actual bottom instrument is not a bass anchor but a bass anchor exists, swap their roles.
  let anchorIndex = bottomIndex;
  for (let i = bottomIndex; i >= 0; i--) {
    if (isBassAnchor(ordered[i].instrumentId)) {
      anchorIndex = i;
      break;
    }
  }

  // We will space from bottom up, so create a working array
  const out = ordered.slice();

  // Ensure anchor is not above any voice beneath it (rare but safe)
  out[anchorIndex].midi = clampIntoInstrumentRange(out[anchorIndex].instrumentId, out[anchorIndex].midi);

  // Step 2: enforce bottom-up spacing
  // Guarantee each voice above is at least minGap above the voice below.
  for (let i = out.length - 2; i >= 0; i--) {
    const below = out[i + 1];
    let cur = out[i];

    // Keep cur above below by the required gap
    const minGap = pickMinGap(cur.midi, below.midi, finalGaps);

    while (cur.midi - below.midi < minGap) {
      cur = { ...cur, midi: cur.midi + 12 };
    }

    // Clamp to its instrument range. If clamping breaks spacing, try stepping down then back up.
    cur.midi = clampIntoInstrumentRange(cur.instrumentId, cur.midi);

    // If clamping caused a collision, try moving both voices within ranges using octave nudges.
    // First try raising cur again if possible.
    while (cur.midi - below.midi < minGap) {
      const raised = clampIntoInstrumentRange(cur.instrumentId, cur.midi + 12);
      if (raised === cur.midi) break;
      cur.midi = raised;
    }

    out[i] = cur;
  }

  // Step 3: final pass to avoid accidental crossings (top should be highest)
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].midi <= out[i + 1].midi) {
      const fixed = clampIntoInstrumentRange(out[i].instrumentId, out[i + 1].midi + 12);
      out[i].midi = fixed;
    }
  }

  return out;
}

/**
 * Apply spacing to many time-slices.
 * This stays simple: the caller decides how to group notes into slices.
 */
export function applySpacingToSlices(
  slices: SpacingVoice[][],
  mode: SpacingMode,
  options: Partial<SpacingOptions> = {}
): SpacingVoice[][] {
  return slices.map(s => applySpacingToSlice(s, mode, options));
}
