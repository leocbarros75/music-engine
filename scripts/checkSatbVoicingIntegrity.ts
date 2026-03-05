import fs from "node:fs";
import path from "node:path";
import { pitchToMidi } from "../src/instruments/instrumentCatalog";

type Pitch = { step: string; alter?: number; octave: number };
type Event = { type: string; t: number; dur: number; midi?: number; pitch?: Pitch };

const RANGES = {
  S: { min: 60, max: 81 }, // C4..A5
  A: { min: 55, max: 74 }, // G3..D5
  T: { min: 48, max: 69 }, // C3..A4
  B: { min: 40, max: 64 } // E2..E4
};

function getMidiFromEvent(ev: Event): number | null {
  if (typeof ev.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev.pitch) {
    try {
      return pitchToMidi(ev.pitch as any);
    } catch {
      return null;
    }
  }
  return null;
}

function findPart(score: any, token: string): any | null {
  const parts = score?.parts ?? [];
  const lower = token.toLowerCase();
  return (
    parts.find((p: any) => String(p?.part_id ?? "").toLowerCase() === lower) ??
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes(lower)) ??
    null
  );
}

function findNoteAt(part: any, measureNumber: number, t: number): Event | null {
  const measures = part?.measures ?? [];
  const measure = measures.find((m: any) => Number(m?.number) === Number(measureNumber));
  if (!measure) return null;
  const events: Event[] = Array.isArray(measure?.events) ? measure.events : [];
  let note: Event | null = null;
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e?.t);
    const ed = Number(e?.dur);
    if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
    if (et <= t && t < et + ed) {
      note = e;
      break;
    }
  }
  if (!note) {
    note = events.find((e) => e?.type === "note" && Number(e?.t) === t) ?? null;
  }
  return note ?? null;
}

function loadScore(filePath: string): any {
  const raw = fs.readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function inRange(midi: number, min: number, max: number): boolean {
  return midi >= min && midi <= max;
}

function orderingOk(params: { bass: number; tenor: number; alto: number; sopr: number }): boolean {
  const { bass, tenor, alto, sopr } = params;
  if (bass >= tenor) return false;
  if (alto >= sopr) return false;
  if (tenor < alto) return true;
  return tenor === alto && tenor === 62;
}

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: npx tsx scripts/checkSatbVoicingIntegrity.ts <score.json>");
  process.exit(1);
}

const absPath = path.resolve(process.cwd(), filePath);
const score = loadScore(absPath);

const sopr = findPart(score, "soprano") ?? findPart(score, "P_S");
const alto = findPart(score, "alto") ?? findPart(score, "P_A");
const tenor = findPart(score, "tenor") ?? findPart(score, "P_T");
const bass = findPart(score, "bass") ?? findPart(score, "P_B");

if (!sopr || !alto || !tenor || !bass) {
  console.error("Missing one or more SATB parts. Ensure Soprano/Alto/Tenor/Bass exist.");
  process.exit(1);
}

let warnings = 0;

const soprMeasures = sopr.measures ?? [];
for (const m of soprMeasures) {
  const measureNumber = Number(m?.number);
  const events: Event[] = Array.isArray(m?.events) ? m.events : [];
  for (const ev of events) {
    if (ev?.type !== "note") continue;
    const t = Number(ev?.t);
    if (!Number.isFinite(t)) continue;
    const sNote = ev;
    const aNote = findNoteAt(alto, measureNumber, t);
    const tNote = findNoteAt(tenor, measureNumber, t);
    const bNote = findNoteAt(bass, measureNumber, t);

    if (!aNote || !tNote || !bNote) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: missing inner voice note.`);
      continue;
    }

    const sMidi = getMidiFromEvent(sNote);
    const aMidi = getMidiFromEvent(aNote);
    const tMidi = getMidiFromEvent(tNote);
    const bMidi = getMidiFromEvent(bNote);
    if ([sMidi, aMidi, tMidi, bMidi].some((x) => typeof x !== "number")) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: missing midi info for SATB.`);
      continue;
    }

    const s = sMidi as number;
    const a = aMidi as number;
    const te = tMidi as number;
    const b = bMidi as number;

    if (!inRange(s, RANGES.S.min, RANGES.S.max)) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: Soprano out of range (${s}).`);
    }
    if (!inRange(a, RANGES.A.min, RANGES.A.max)) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: Alto out of range (${a}).`);
    }
    if (!inRange(te, RANGES.T.min, RANGES.T.max)) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: Tenor out of range (${te}).`);
    }
    if (!inRange(b, RANGES.B.min, RANGES.B.max)) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: Bass out of range (${b}).`);
    }
    if (!orderingOk({ bass: b, tenor: te, alto: a, sopr: s })) {
      warnings++;
      console.warn(`[warn] m${measureNumber} t=${t}: voice ordering violated (B=${b} T=${te} A=${a} S=${s}).`);
    }
  }
}

if (!warnings) {
  console.log("SATB voicing integrity: OK");
} else {
  console.log(`SATB voicing integrity: ${warnings} warning(s) found.`);
}
