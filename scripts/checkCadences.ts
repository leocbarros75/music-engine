// scripts/checkCadences.ts
// Usage: npx tsx scripts/checkCadences.ts ./tmp/satb_response.json
import fs from "node:fs";

type AnyObj = Record<string, any>;

function warn(msg: string): void {
  // warnings only
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function tonicPcFromFifthsMajor(fifths: number): number {
  const map: Record<string, number> = {
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
  return map[String(fifths)] ?? 0;
}

function pcName(p: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return names[((p % 12) + 12) % 12] ?? "C";
}

function getKeyFifths(score: AnyObj): number {
  const m0 = score?.parts?.[0]?.measures?.[0];
  const fifths = m0?.attributes?.key?.fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

function getMeasureCount(score: AnyObj): number {
  const p0 = score?.parts?.[0];
  const ms = p0?.measures ?? [];
  return Array.isArray(ms) ? ms.length : 0;
}

function getChordSymbolFromDebug(score: AnyObj, measure: number): string | null {
  const sample = score?.meta?.harmonize?.debug?.chordEventSample;
  if (!Array.isArray(sample)) return null;

  // prefer beat 0 chord for the measure
  const hit0 = sample.find((c: any) => Number(c?.measure) === measure && Number(c?.t) === 0);
  if (hit0 && typeof hit0.symbol === "string") return hit0.symbol;

  const hitAny = sample.find((c: any) => Number(c?.measure) === measure);
  if (hitAny && typeof hitAny.symbol === "string") return hitAny.symbol;

  return null;
}

function getPart(score: AnyObj, name: string): AnyObj | null {
  const parts = score?.parts ?? [];
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes(name)) return p;
  }
  return null;
}

function lastNotePcInMeasure(measure: AnyObj): number | null {
  const evs = Array.isArray(measure?.events) ? measure.events : [];
  const notes = evs.filter((e: any) => e?.type === "note" && typeof e?.midi === "number");
  if (!notes.length) return null;
  notes.sort((a: any, b: any) => (Number(a.t) - Number(b.t)) || (Number(a.dur) - Number(b.dur)));
  const last = notes[notes.length - 1];
  return pc(Number(last.midi));
}

function checkFinalCadence(score: AnyObj): void {
  const mCount = getMeasureCount(score);
  if (mCount < 2) {
    warn("[cadence] Not enough measures to check final cadence.");
    return;
  }

  const fifths = getKeyFifths(score);
  const tonicPc = tonicPcFromFifthsMajor(fifths);
  const domPc = (tonicPc + 7) % 12;

  const lastM = mCount;
  const penultM = mCount - 1;

  const penultSym = getChordSymbolFromDebug(score, penultM);
  const lastSym = getChordSymbolFromDebug(score, lastM);

  warn(
    `[cadence] Final cadence check in ${pcName(tonicPc)} major: penult=${penultSym ?? "(unknown)"} -> last=${
      lastSym ?? "(unknown)"
    }`
  );

  // VOICE evidence: bass last note in penult should be dominant pc, bass last note in last should be tonic pc
  const bass = getPart(score, "bass");
  const bassPen = bass?.measures?.[penultM - 1];
  const bassLast = bass?.measures?.[lastM - 1];

  const penBassPc = bassPen ? lastNotePcInMeasure(bassPen) : null;
  const lastBassPc = bassLast ? lastNotePcInMeasure(bassLast) : null;

  if (penBassPc === null || lastBassPc === null) {
    warn("[cadence] WARNING: Could not read bass last-note PCs for cadence evidence (continuing).");
    return;
  }

  if (penBassPc !== domPc || lastBassPc !== tonicPc) {
    warn(
      `[cadence] WARNING: Bass cadence PCs unexpected. Expected ${pcName(domPc)} -> ${pcName(tonicPc)}, got ${pcName(
        penBassPc
      )} -> ${pcName(lastBassPc)}`
    );
    return;
  }

  warn("[cadence] OK: Authentic cadence detected (bass V -> I).");
}

const inPath = process.argv[2] ?? "./tmp/satb_response.json";
const raw = fs.readFileSync(inPath, "utf8");
const json = JSON.parse(raw);
const score = json?.scoreModel ?? null;

if (!score) {
  warn("[cadence] WARNING: Missing scoreModel in response JSON.");
  process.exit(0);
}

checkFinalCadence(score);