import type { VoiceId } from "./types";

export type Range = { absMin: number; absMax: number; prefMin: number; prefMax: number };

function noteToMidi(note: string): number {
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(note.trim());
  if (!match) return 60;
  const step = match[1]!.toUpperCase();
  const alter = match[2] === "#" ? 1 : match[2] === "b" ? -1 : 0;
  const octave = Number(match[3]);
  const pcMap: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const pc = pcMap[step] ?? 0;
  return (octave + 1) * 12 + pc + alter;
}

const R = (low: string, high: string, prefLow: string, prefHigh: string): Range => ({
  absMin: noteToMidi(low),
  absMax: noteToMidi(high),
  prefMin: noteToMidi(prefLow),
  prefMax: noteToMidi(prefHigh)
});

export const STRING_RANGES: Record<VoiceId, Range> = {
  vln1: R("G3", "C7", "C4", "B6"),
  vln2: R("G3", "C7", "C4", "A6"),
  vla: R("C3", "E6", "G3", "D6"),
  vc: R("C2", "C6", "C2", "B4"),
  cb: R("E1", "C4", "E1", "B2")
};
