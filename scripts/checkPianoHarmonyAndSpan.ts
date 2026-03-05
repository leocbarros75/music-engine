import fs from "fs";
import path from "path";
import { pitchToMidi } from "../src/instruments/instrumentCatalog";
import { parseChordSymbol } from "../src/harmonize/satb/chordSymbol";

type Pitch = { step: string; alter?: number; octave: number };
type NoteEvent =
  | {
      id: string;
      t: number;
      dur: number;
      type: "note";
      pitch: Pitch;
      voice: number;
      staff: number;
      midi?: number;
    }
  | {
      id: string;
      t: number;
      dur: number;
      type: "rest";
      voice: number;
      staff: number;
    };

type Measure = {
  number: number;
  attributes?: {
    divisions?: number;
    key_fifths?: number;
    key_mode?: string;
    time?: { beats: number; beat_type: number };
  };
  events: NoteEvent[];
};

type Part = {
  part_id: string;
  name?: string;
  instrument?: string;
  staves?: number;
  measures: Measure[];
};

type ScoreModel = {
  meta?: any;
  parts?: Part[];
};

type ChordEvent = { measure: number; t: number; symbol: string };

function loadScore(inputPath: string): ScoreModel {
  const raw = fs.readFileSync(inputPath, "utf8");
  const data = JSON.parse(raw);
  if (data && data.scoreModel) return data.scoreModel as ScoreModel;
  return data as ScoreModel;
}

function measureBeatsFromAttributes(attrs: any | undefined): number {
  const beats = Number(attrs?.time?.beats ?? 4);
  const beatType = Number(attrs?.time?.beat_type ?? 4);
  if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) return 4;
  return beats * (4 / beatType);
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

function findActiveNotesAtTime(events: NoteEvent[], staff: number, t: number): Array<{ ev: NoteEvent; midi: number }> {
  const out: Array<{ ev: NoteEvent; midi: number }> = [];
  for (const e of events) {
    if (!e || e.type !== "note") continue;
    if (e.staff !== staff) continue;
    const et = Number(e.t);
    const dur = Number(e.dur);
    if (!Number.isFinite(et) || !Number.isFinite(dur)) continue;
    if (et <= t && t < et + dur) {
      const midi = eventMidi(e);
      if (typeof midi === "number") out.push({ ev: e, midi });
    }
  }
  return out;
}

function isStrongBeat(t: number): boolean {
  return Math.abs(t - Math.round(t)) < 1e-6;
}

function isChordBoundary(chords: ChordEvent[], measureNumber: number, t: number): boolean {
  for (const c of chords) {
    if (Number(c.measure) !== Number(measureNumber)) continue;
    if (Math.abs(Number(c.t) - t) < 1e-6) return true;
  }
  return false;
}

function pickChordForTime(chords: ChordEvent[], measure: number, t: number): ChordEvent | null {
  const inMeasure = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!inMeasure.length) return null;
  const sorted = inMeasure.slice().sort((a, b) => Number(a.t) - Number(b.t));
  let best: ChordEvent | null = null;
  for (const c of sorted) {
    if (Number(c.t) <= t + 1e-6) best = c;
    else break;
  }
  return best ?? sorted[0] ?? null;
}

function getPianoPart(score: ScoreModel): Part | null {
  const parts = score.parts ?? [];
  const byId = parts.find((p) => String(p.part_id).toUpperCase() === "P_PNO");
  if (byId) return byId;
  const byName = parts.find((p) => String(p.name ?? "").toLowerCase().includes("piano"));
  if (byName) return byName;
  return parts[0] ?? null;
}

function main(): void {
  const inputPath = process.argv[2] ?? path.resolve("tmp/app_piano_response.json");
  if (!fs.existsSync(inputPath)) {
    console.error(`[check] Input not found: ${inputPath}`);
    process.exit(1);
  }

  const score = loadScore(inputPath);
  const part = getPianoPart(score);
  if (!part) {
    console.error("[check] No piano part found.");
    process.exit(1);
  }

  const chords: ChordEvent[] = Array.isArray(score.meta?.inputChords) ? score.meta.inputChords : [];
  const spanIssues: Array<{ measure: number; t: number; staff: number; span: number }> = [];
  const harmonyIssues: Array<{ measure: number; t: number; midi: number; staff: number; symbol: string }> = [];

  for (const measure of part.measures ?? []) {
    const measureBeats = measureBeatsFromAttributes(measure.attributes);
    const times = new Set<number>();
    for (const e of measure.events ?? []) {
      if (e && e.type === "note" && Number.isFinite(e.t)) times.add(Number(e.t));
    }
    const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
    for (let b = 0; b < beatCount; b += 1) times.add(b);
    for (const c of chords) {
      if (Number(c.measure) === Number(measure.number) && Number.isFinite(c.t)) {
        times.add(Number(c.t));
      }
    }
    const ordered = Array.from(times).sort((a, b) => a - b);

    for (const t of ordered) {
      for (const staff of [1, 2]) {
        const active = findActiveNotesAtTime(measure.events ?? [], staff, t);
        if (active.length >= 2) {
          const midis = active.map((a) => a.midi);
          const span = Math.max(...midis) - Math.min(...midis);
          if (span > 12) {
            spanIssues.push({ measure: measure.number, t, staff, span });
          }
        }
      }

      if (chords.length && (isStrongBeat(t) || isChordBoundary(chords, measure.number, t))) {
        const chord = pickChordForTime(chords, measure.number, t);
        const parsed = chord ? parseChordSymbol(chord.symbol) : null;
        const chordPcs = parsed?.pcs ?? [];
        if (!chordPcs.length) continue;
        const activeAll = findActiveNotesAtTime(measure.events ?? [], 1, t).concat(
          findActiveNotesAtTime(measure.events ?? [], 2, t)
        );
        for (const { midi, ev } of activeAll) {
          const pc = ((midi % 12) + 12) % 12;
          if (!chordPcs.includes(pc)) {
            harmonyIssues.push({
              measure: measure.number,
              t,
              midi,
              staff: ev.staff,
              symbol: chord?.symbol ?? "?"
            });
          }
        }
      }
    }
  }

  console.log(`[check] File: ${inputPath}`);
  console.log(`[check] Hand span > octave: ${spanIssues.length}`);
  for (const issue of spanIssues.slice(0, 20)) {
    console.log(`[span] m${issue.measure} t=${issue.t} staff=${issue.staff} span=${issue.span}`);
  }
  if (spanIssues.length > 20) console.log(`[span] ... ${spanIssues.length - 20} more`);

  console.log(`[check] Non-chord tones on strong beats/chord changes: ${harmonyIssues.length}`);
  for (const issue of harmonyIssues.slice(0, 20)) {
    console.log(`[harm] m${issue.measure} t=${issue.t} staff=${issue.staff} midi=${issue.midi} chord=${issue.symbol}`);
  }
  if (harmonyIssues.length > 20) console.log(`[harm] ... ${harmonyIssues.length - 20} more`);
}

main();
