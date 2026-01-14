// src/harmony/pitch.ts
import type { Pitch } from "./types";

const BASE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function pitchToMidi(p: Pitch): number {
  const step = (p.step ?? "C").toUpperCase();
  const semis = (BASE[step] ?? 0) + (p.alter ?? 0);
  return (p.octave + 1) * 12 + semis;
}

export function midiToPc(m: number): number {
  const pc = ((m % 12) + 12) % 12;
  return pc;
}

export function pcToName(pc: number, preferSharps = true): string {
  const sharp = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const flat = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
  const i = ((pc % 12) + 12) % 12;
  return preferSharps ? sharp[i] : flat[i];
}

export function normalizeTonicName(s: string): string {
  const t = (s ?? "").trim();
  if (!t) return "C";
  const u = t[0].toUpperCase() + t.slice(1);
  return u.replace("♯", "#").replace("♭", "b");
}

export function tonicNameToPc(tonic: string): number {
  const t = normalizeTonicName(tonic);
  const map: Record<string, number> = {
    C: 0,
    "C#": 1,
    Db: 1,
    D: 2,
    "D#": 3,
    Eb: 3,
    E: 4,
    F: 5,
    "F#": 6,
    Gb: 6,
    G: 7,
    "G#": 8,
    Ab: 8,
    A: 9,
    "A#": 10,
    Bb: 10,
    B: 11
  };
  return map[t] ?? 0;
}