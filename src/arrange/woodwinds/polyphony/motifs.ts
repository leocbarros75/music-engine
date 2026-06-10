import type { Motif, MotifEntry, Slice, VoiceId } from "./types";

type MotifConfig = {
  enabled: boolean;
  voices: VoiceId[];
  delayBeats: number[];
  transposeSemitones: number[];
  maxOverlaps: number;
};

export function captureMotif(slices: Slice[]): Motif | null {
  const entries = slices.filter((s) => typeof s.melodyMidi === "number");
  if (entries.length < 3) return null;
  const start = entries[0]!;
  const motifSlices = entries.slice(0, 4);
  const base = start.melodyMidi as number;
  const intervals = motifSlices.map((s) => (s.melodyMidi as number) - base);
  const durations = motifSlices.map((s) => s.dur);
  return {
    intervals,
    durations,
    startSlice: slices.indexOf(motifSlices[0]!),
    length: intervals.length,
    baseMidi: base
  };
}

export function scheduleImitation(
  motif: Motif | null,
  config: MotifConfig,
  slices: Slice[]
): MotifEntry[] {
  if (!motif || !config.enabled) return [];
  const entries: MotifEntry[] = [];
  const delays = config.delayBeats?.length ? config.delayBeats : [4];
  const transposes = config.transposeSemitones?.length ? config.transposeSemitones : [7];
  const voices = config.voices?.length ? config.voices : (["vln2"] as VoiceId[]);
  for (const voice of voices) {
    for (const delay of delays) {
      for (const transpose of transposes) {
        const startSlice = findSliceByOffset(slices, motif.startSlice, delay);
        if (startSlice === null) continue;
        entries.push({ voice, startSlice, transpose });
        if (entries.length >= (config.maxOverlaps || 1)) return entries;
      }
    }
  }
  return entries;
}

export function motifMidiAtSlice(
  motif: Motif,
  entry: MotifEntry,
  sliceIndex: number
): number | null {
  const idx = sliceIndex - entry.startSlice;
  if (idx < 0 || idx >= motif.length) return null;
  return motif.baseMidi + motif.intervals[idx] + entry.transpose;
}

function findSliceByOffset(slices: Slice[], startSlice: number, delayBeats: number): number | null {
  const targetTime = slices[startSlice]?.t ?? 0;
  const targetMeasure = slices[startSlice]?.measure ?? 1;
  const targetBeat = targetTime + delayBeats;
  for (let i = startSlice + 1; i < slices.length; i++) {
    const s = slices[i]!;
    if (s.measure === targetMeasure && s.t >= targetBeat) return i;
    if (s.measure > targetMeasure) {
      if (s.t >= (targetBeat % 4)) return i;
      return i;
    }
  }
  return null;
}
