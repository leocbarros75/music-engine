import type { ScoreModel } from "../score/types";
import { pitchToMidi } from "../instruments/instrumentCatalog";
import { analyzeMotion, type MotionEvent, type MotionSummary } from "./motionAnalyzer";
import { computeDensity, type DensityReport } from "./densityCalculator";

export type TextureType =
  | "monophony"
  | "biphony"
  | "heterophony"
  | "polyphony"
  | "homophony_homorhythmic"
  | "homophony_melody_accompaniment";

export type TextureReport = {
  type: TextureType;
  density: DensityReport;
  motionSummary: MotionSummary | null;
  partCount: number;
  activeParts: number;
  rhythmSimilarity: number;
  pitchSimilarity: number;
  spacingQuality: "tight" | "balanced" | "open";
  notesPerPart: Array<{ partId: string; name: string; noteCount: number }>;
};

type NotePoint = { time: number; midi: number; dur: number };

function getBeatsPerMeasure(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const beats = m0?.attributes?.time?.beats;
  if (typeof beats === "number" && beats > 0) return beats;
  return 4;
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try {
      return pitchToMidi(ev.pitch);
    } catch {
      return null;
    }
  }
  return null;
}

function collectPartNotes(part: any, beatsPerMeasure: number): NotePoint[] {
  const notes: NotePoint[] = [];
  const measures = part?.measures ?? [];
  for (let mi = 0; mi < measures.length; mi++) {
    const m = measures[mi];
    const events = Array.isArray(m?.events) ? m.events : [];
    for (const ev of events) {
      if (ev?.type !== "note") continue;
      const midi = eventMidi(ev);
      if (midi === null) continue;
      const t = Number(ev?.t);
      const dur = Number(ev?.dur);
      const time = (Number.isFinite(mi) ? mi : 0) * beatsPerMeasure + (Number.isFinite(t) ? t : 0);
      notes.push({ time, midi, dur: Number.isFinite(dur) ? dur : 0 });
    }
  }
  notes.sort((a, b) => a.time - b.time);
  return notes;
}

function rhythmSignature(notes: NotePoint[]): string[] {
  return notes.map((n) => `${n.time.toFixed(2)}:${n.dur.toFixed(2)}`);
}

function pitchSignature(notes: NotePoint[]): number[] {
  return notes.map((n) => n.midi);
}

function similarityRatio<T>(a: T[], b: T[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let matches = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) matches++;
  }
  return matches / n;
}

function isDrone(notes: NotePoint[]): boolean {
  if (!notes.length) return false;
  const totalDur = notes.reduce((sum, n) => sum + (n.dur || 0), 0);
  if (totalDur <= 0) return false;
  const byPitch = new Map<number, number>();
  for (const n of notes) {
    byPitch.set(n.midi, (byPitch.get(n.midi) ?? 0) + (n.dur || 0));
  }
  const maxDur = Math.max(...Array.from(byPitch.values()));
  const ratio = maxDur / totalDur;
  return ratio >= 0.7 && byPitch.size <= 2;
}

function spacingQuality(score: ScoreModel): "tight" | "balanced" | "open" {
  const parts = score.parts ?? [];
  if (parts.length < 2) return "balanced";
  const beats = getBeatsPerMeasure(score);
  const measures = parts[0]?.measures?.length ?? 0;
  const gaps: number[] = [];

  for (let mi = 0; mi < measures; mi++) {
    for (let t = 0; t < beats; t++) {
      const midis: number[] = [];
      for (const part of parts) {
        const m = part.measures?.[mi];
        if (!m) continue;
        const evs = Array.isArray(m?.events) ? m.events : [];
        const hit = evs.find((e: any) => e?.type === "note" && Number(e?.t) === t);
        const midi = hit ? eventMidi(hit) : null;
        if (typeof midi === "number") midis.push(midi);
      }
      if (midis.length < 2) continue;
      midis.sort((a, b) => a - b);
      for (let i = 1; i < midis.length; i++) {
        gaps.push(midis[i]! - midis[i - 1]!);
      }
    }
  }

  if (!gaps.length) return "balanced";
  const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  if (avg < 5) return "tight";
  if (avg > 9) return "open";
  return "balanced";
}

export function analyzeTexture(score: ScoreModel): TextureReport {
  const parts = score.parts ?? [];
  const beats = getBeatsPerMeasure(score);
  const density = computeDensity(score);

  const partNotes = parts.map((part) => ({
    part,
    notes: collectPartNotes(part, beats)
  }));

  const active = partNotes.filter((p) => p.notes.length > 0);
  const activeParts = active.length;

  const notesPerPart = partNotes.map((p) => ({
    partId: String(p.part?.part_id ?? ""),
    name: String(p.part?.name ?? "Part"),
    noteCount: p.notes.length
  }));

  if (activeParts <= 1) {
    return {
      type: "monophony",
      density,
      motionSummary: null,
      partCount: parts.length,
      activeParts,
      rhythmSimilarity: 1,
      pitchSimilarity: 1,
      spacingQuality: spacingQuality(score),
      notesPerPart
    };
  }

  if (activeParts === 2 && (isDrone(active[0]!.notes) || isDrone(active[1]!.notes))) {
    return {
      type: "biphony",
      density,
      motionSummary: null,
      partCount: parts.length,
      activeParts,
      rhythmSimilarity: 0.5,
      pitchSimilarity: 0.5,
      spacingQuality: spacingQuality(score),
      notesPerPart
    };
  }

  const ref = active[0]!.notes;
  const refRhythm = rhythmSignature(ref);
  const refPitch = pitchSignature(ref);
  let rhythmSimilarity = 0;
  let pitchSimilarity = 0;
  let rhythmMatches = 0;

  for (const p of active.slice(1)) {
    const r = rhythmSignature(p.notes);
    const pr = similarityRatio(refRhythm, r);
    rhythmSimilarity += pr;
    if (pr > 0.85) rhythmMatches++;

    const pp = similarityRatio(refPitch, pitchSignature(p.notes));
    pitchSimilarity += pp;
  }

  if (active.length > 1) {
    rhythmSimilarity /= active.length - 1;
    pitchSimilarity /= active.length - 1;
  }

  const allHomorhythmic = rhythmMatches === active.length - 1;
  if (allHomorhythmic) {
    return {
      type: "homophony_homorhythmic",
      density,
      motionSummary: null,
      partCount: parts.length,
      activeParts,
      rhythmSimilarity,
      pitchSimilarity,
      spacingQuality: spacingQuality(score),
      notesPerPart
    };
  }

  const noteCounts = active.map((p) => p.notes.length).sort((a, b) => b - a);
  const top = noteCounts[0] ?? 0;
  const second = noteCounts[1] ?? 0;
  if (top > second * 1.6 && rhythmSimilarity > 0.55) {
    return {
      type: "homophony_melody_accompaniment",
      density,
      motionSummary: null,
      partCount: parts.length,
      activeParts,
      rhythmSimilarity,
      pitchSimilarity,
      spacingQuality: spacingQuality(score),
      notesPerPart
    };
  }

  if (pitchSimilarity > 0.7 && rhythmSimilarity < 0.6) {
    return {
      type: "heterophony",
      density,
      motionSummary: null,
      partCount: parts.length,
      activeParts,
      rhythmSimilarity,
      pitchSimilarity,
      spacingQuality: spacingQuality(score),
      notesPerPart
    };
  }

  const highest = active.reduce((a, b) => (a.notes.length >= b.notes.length ? a : b));
  const lowest = active.reduce((a, b) => (a.notes.length <= b.notes.length ? a : b));
  const motionA: MotionEvent[] = highest.notes.map((n) => ({ time: n.time, midi: n.midi }));
  const motionB: MotionEvent[] = lowest.notes.map((n) => ({ time: n.time, midi: n.midi }));
  const motionSummary = analyzeMotion(motionA, motionB);

  return {
    type: "polyphony",
    density,
    motionSummary,
    partCount: parts.length,
    activeParts,
    rhythmSimilarity,
    pitchSimilarity,
    spacingQuality: spacingQuality(score),
    notesPerPart
  };
}

