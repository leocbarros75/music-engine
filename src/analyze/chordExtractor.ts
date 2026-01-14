// src/analyze/chordExtractor.ts
import type { ScoreModel } from "../score/types";
import { pitchToMidi, type Pitch } from "../instruments/instrumentCatalog";

type NoteEvent = any;

export type OnsetChord = {
  measure: number;
  t: number;
  notes: Array<{ id: string; midi: number; pitch: Pitch; staff: number; voice: number }>;
};

export function extractOnsetChords(score: ScoreModel): OnsetChord[] {
  const out: OnsetChord[] = [];

  for (const part of score.parts) {
    for (const m of part.measures) {
      const byT: Record<number, OnsetChord> = {};

      for (const ev of m.events as NoteEvent[]) {
        if (ev.type !== "note") continue;
        const t = ev.t ?? 0;
        if (!byT[t]) byT[t] = { measure: m.number, t, notes: [] };

        const p: Pitch = { step: ev.pitch.step, alter: ev.pitch.alter, octave: ev.pitch.octave };
        const midi = pitchToMidi(p);

        byT[t].notes.push({
          id: ev.id,
          midi,
          pitch: p,
          staff: ev.staff ?? 1,
          voice: ev.voice ?? 1
        });
      }

      const times = Object.keys(byT).map(Number).sort((a, b) => a - b);
      for (const t of times) out.push(byT[t]);
    }
  }

  return out;
}