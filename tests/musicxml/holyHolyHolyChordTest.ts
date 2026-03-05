import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parseMusicXMLToScoreModel } from "../../src/parsers/musicxmlParser";
import { harmonizeSatbFromChords } from "../../src/harmonize/satb/harmonizeSatbFromChords";
import { parseChordSymbol } from "../../src/harmonize/satb/chordSymbol";
import { pitchToMidi } from "../../src/instruments/instrumentCatalog";

type ChordEvent = { measure: number; t: number; symbol: string };

const defaultPath = path.join(
  os.homedir(),
  "Downloads",
  "Flows from Holy Holy Holy Test",
  "Holy Holy Holy Test - 01_Voice - 01 Flow 1.musicxml"
);

const filePath = process.env.HOLY_TEST_PATH ?? defaultPath;

if (!fs.existsSync(filePath)) {
  throw new Error(
    `Test file not found. Set HOLY_TEST_PATH or place the file at:\n${defaultPath}`
  );
}

const xml = fs.readFileSync(filePath, "utf8");
const score: any = parseMusicXMLToScoreModel(xml);
const chords: ChordEvent[] = Array.isArray(score?.meta?.inputChords) ? score.meta.inputChords : [];

if (!chords.length) {
  throw new Error("Expected extracted chords from MusicXML <harmony>, but got none.");
}

const outScore: any = harmonizeSatbFromChords(score, chords, { keepMelodyInSoprano: true });

function chordPcsFromSymbol(symbol: string): number[] | null {
  const raw = String(symbol || "").trim();
  if (!raw) return null;
  const main = raw.split("/")[0] ?? raw;
  const parsed = parseChordSymbol(String(main));
  return parsed?.pcs ?? null;
}

function extractSonorityPcs(scoreModel: any, measureNumber: number, t: number): number[] {
  const out: number[] = [];
  for (const part of scoreModel?.parts ?? []) {
    const measure = (part?.measures ?? []).find((m: any) => Number(m?.number) === Number(measureNumber));
    if (!measure) continue;
    const events = Array.isArray(measure?.events) ? measure.events : [];
    let note: any | null = null;
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
      note = events.find((e: any) => e?.type === "note" && Number(e?.t) === t) ?? null;
    }
    if (!note) continue;
    const midi =
      typeof note?.midi === "number"
        ? Number(note.midi)
        : note?.pitch
          ? pitchToMidi(note.pitch)
          : null;
    if (typeof midi === "number" && Number.isFinite(midi)) {
      out.push(((midi % 12) + 12) % 12);
    }
  }
  return Array.from(new Set(out));
}

const byMeasure = new Map<number, ChordEvent[]>();
for (const c of chords) {
  const measure = Number(c?.measure);
  const t = typeof c?.t === "number" ? c.t : 0;
  if (!Number.isFinite(measure)) continue;
  const list = byMeasure.get(measure) ?? [];
  list.push({ measure, t, symbol: String(c?.symbol ?? "") });
  byMeasure.set(measure, list);
}
for (const list of byMeasure.values()) {
  list.sort((a, b) => Number(a.t) - Number(b.t));
}

const mismatches: Array<{ measure: number; chord: string; chordPcs: number[]; outputPcs: number[] }> = [];

for (const [measure, list] of byMeasure.entries()) {
  if (!list.length) continue;
  const chord = list[0]!;
  const chordPcs = chordPcsFromSymbol(chord.symbol);
  if (!chordPcs) continue;
  const outputPcs = extractSonorityPcs(outScore, measure, 0);
  if (!outputPcs.length) continue;
  const bad = outputPcs.filter((pc) => !chordPcs.includes(pc));
  if (bad.length) {
    mismatches.push({ measure, chord: chord.symbol, chordPcs, outputPcs });
  }
}

if (mismatches.length) {
  const lines = mismatches.map(
    (m) => `m${m.measure} chord=${m.chord} out=[${m.outputPcs.join(", ")}] expected=[${m.chordPcs.join(", ")}]`
  );
  throw new Error(`Chord mismatch at measure start:\n${lines.join("\n")}`);
}

console.log("Chord extraction + measure-start harmony check passed.");
