// src/harmonize/satb/inferChordsFromMelody.ts
import type { ScoreModel } from "../../score/types";

type ChordEvent = {
  measure: number;
  t: number;
  symbol: string;
};

// Pitch class helpers
function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

// Convert MusicXML key signature (fifths) to tonic pitch class for MAJOR keys.
function tonicPcFromFifthsMajor(fifths: number): number {
  const map: Record<number, number> = {
    "-7": 11,
    "-6": 6,
    "-5": 1,
    "-4": 8,
    "-3": 3,
    "-2": 10,
    "-1": 5,
    "0": 0,
    "1": 7,
    "2": 2,
    "3": 9,
    "4": 4,
    "5": 11,
    "6": 6,
    "7": 1
  };
  const k = String(fifths);
  return map[k] ?? 0;
}

function majorScalePcs(tonicPc: number): number[] {
  const rel = [0, 2, 4, 5, 7, 9, 11];
  return rel.map((x) => (tonicPc + x) % 12);
}

type DiatonicTriad = {
  degree: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  rootPc: number;
  pcs: number[];
  symbol: string;
};

function pcName(p: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return names[((p % 12) + 12) % 12]!;
}

// Build diatonic triads in major
function buildDiatonicTriadsMajor(tonicPc: number): DiatonicTriad[] {
  const scale = majorScalePcs(tonicPc);

  const root = (deg: number) => scale[deg - 1]!;
  const third = (deg: number) => scale[(deg - 1 + 2) % 7]!;
  const fifth = (deg: number) => scale[(deg - 1 + 4) % 7]!;
  const triadPcs = (deg: number) => [root(deg), third(deg), fifth(deg)];

  const sym = (deg: number): string => {
    if (deg === 1) return pcName(tonicPc);
    if (deg === 2) return pcName(root(deg)) + "m";
    if (deg === 3) return pcName(root(deg)) + "m";
    if (deg === 4) return pcName(root(deg));
    if (deg === 5) return pcName(root(deg));
    if (deg === 6) return pcName(root(deg)) + "m";
    return pcName(root(deg)) + "dim";
  };

  const out: DiatonicTriad[] = [];
  for (let d = 1 as 1 | 2 | 3 | 4 | 5 | 6 | 7; d <= 7; d = (d + 1) as any) {
    out.push({
      degree: d,
      rootPc: root(d),
      pcs: triadPcs(d).map((x) => x % 12),
      symbol: sym(d)
    });
  }
  return out;
}

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = m0?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

function averageMidiForPart(part: any): number | null {
  const vals: number[] = [];
  for (const m of part?.measures ?? []) {
    for (const e of m?.events ?? []) {
      if (e?.type !== "note") continue;
      if (typeof e?.midi === "number") vals.push(e.midi);
    }
  }
  if (!vals.length) return null;
  const sum = vals.reduce((a, b) => a + b, 0);
  return sum / vals.length;
}

function detectMelodyVoice(part: any): number | null {
  const counts = new Map<number, number>();
  for (const m of part?.measures ?? []) {
    for (const e of m?.events ?? []) {
      if (!e || (e.type !== "note" && e.type !== "rest")) continue;
      const v = Number(e.voice);
      if (!Number.isFinite(v)) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
  }
  const voices = Array.from(counts.keys());
  if (voices.length <= 1) return null;
  if (counts.has(1)) return 1;
  let best = voices[0]!;
  let bestCount = counts.get(best) ?? 0;
  for (const v of voices) {
    const c = counts.get(v) ?? 0;
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function getMelodyPart(score: ScoreModel): { part: any; voice: number | null } | null {
  const parts = score.parts ?? [];
  if (!parts.length) return null;
  if (parts.length === 1) return { part: parts[0], voice: detectMelodyVoice(parts[0]) };

  const preferByName = ["melody", "soprano", "voice"];
  for (const needle of preferByName) {
    for (const p of parts) {
      const name = String(p?.name ?? "").toLowerCase();
      if (name.includes(needle)) return { part: p, voice: detectMelodyVoice(p) };
    }
  }

  let best = parts[0] ?? null;
  let bestAvg = -Infinity;
  for (const p of parts) {
    const avg = averageMidiForPart(p);
    if (avg !== null && avg > bestAvg) {
      best = p;
      bestAvg = avg;
    }
  }
  if (!best) return null;
  return { part: best, voice: detectMelodyVoice(best) };
}

function firstMelodyMidiInMeasure(measure: any, melodyVoice: number | null): number | null {
  const notes = (measure?.events ?? [])
    .filter((e: any) => e?.type === "note" && typeof e?.midi === "number")
    .filter((e: any) => (melodyVoice === null || melodyVoice === undefined ? true : e?.voice === melodyVoice));
  if (!notes.length) return null;
  notes.sort((a: any, b: any) => Number(a.t) - Number(b.t));
  return Number(notes[0]!.midi);
}

function progressionPenalty(prevDeg: number | null, nextDeg: number): number {
  if (prevDeg === null) return 0;

  const goodPairs = new Set<string>([
    "1->4",
    "1->5",
    "1->6",
    "6->2",
    "2->5",
    "4->5",
    "5->1",
    "5->6",
    "4->1"
  ]);

  if (prevDeg === nextDeg) return 2;
  if (goodPairs.has(`${prevDeg}->${nextDeg}`)) return 0;

  return 4;
}

export function inferChordsFromMelody(inScore: ScoreModel): ChordEvent[] {
  const melodyInfo = getMelodyPart(inScore);
  const melodyPart = melodyInfo?.part;
  const melodyVoice = melodyInfo?.voice ?? null;
  const measures = melodyPart?.measures ?? [];
  if (!measures.length) return [];

  const fifths = getKeyFifths(inScore);
  const tonic = tonicPcFromFifthsMajor(fifths);
  const triads = buildDiatonicTriadsMajor(tonic);

  const lastMeasureNumber = Number(measures[measures.length - 1]?.number ?? measures.length);

  const out: ChordEvent[] = [];
  let prevDeg: number | null = null;

  for (let i = 0; i < measures.length; i++) {
    const m = measures[i];
    const measureNumber = Number(m?.number ?? (i + 1));

    const isLast = measureNumber === lastMeasureNumber;
    const isPenult = measureNumber === lastMeasureNumber - 1;

    if (isLast) {
      out.push({ measure: measureNumber, t: 0, symbol: triads[0]!.symbol }); // I
      prevDeg = 1;
      continue;
    }

    if (isPenult) {
      const V = triads.find((t) => t.degree === 5)!;
      out.push({ measure: measureNumber, t: 0, symbol: V.symbol + "7" });
      prevDeg = 5;
      continue;
    }

    const midi = firstMelodyMidiInMeasure(m, melodyVoice);
    const melPc = midi === null ? null : pc(midi);

    const candidates = triads
      .filter((t) => (melPc === null ? true : t.pcs.includes(melPc)))
      .sort((a, b) => {
        const pref = (deg: number) => {
          if (deg === 1) return 0;
          if (deg === 5) return 1;
          if (deg === 4) return 2;
          if (deg === 6) return 3;
          if (deg === 2) return 4;
          if (deg === 3) return 6;
          return 9;
        };
        return pref(a.degree) - pref(b.degree);
      });

    let best = candidates[0] ?? triads[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const c of candidates.length ? candidates : triads) {
      const score = progressionPenalty(prevDeg, c.degree) + (c.degree === 7 ? 3 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = c;
      }
    }

    out.push({ measure: measureNumber, t: 0, symbol: best.symbol });
    prevDeg = best.degree;
  }

  return out;
}
