// src/rhythm/applyRhythmToBassFinalCadence.ts
import type { ScoreModel } from "../score/types";
import type { GrooveTemplate, MeterSpec, RhythmApplyOptions, RhythmApplyResult, RhythmCell } from "./rhythmTypes";
import { loadRhythmCellsAndTemplates, pickCellForTemplate, pickGrooveTemplate } from "./rhythmLibrary";

type ChordEvent = { measure: number; t: number; symbol: string };

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function isBusyCell(cell: RhythmCell): boolean {
  const tags = cell.tags ?? [];
  return tags.includes("busy") || tags.includes("syncopated");
}

function pickCellByTags(params: {
  template: GrooveTemplate;
  cells: RhythmCell[];
  includeTags: string[];
}): RhythmCell | null {
  const { template, cells, includeTags } = params;
  const cellById = new Map<string, RhythmCell>();
  for (const c of cells) cellById.set(c.id, c);

  for (const cw of template.cells ?? []) {
    const cell = cellById.get(cw.cellId);
    if (!cell) continue;
    const tags = cell.tags ?? [];
    if (includeTags.some((tag) => tags.includes(tag))) return cell;
  }
  return null;
}

function getMeter(score: ScoreModel): MeterSpec {
  const m0 = score.parts?.[0]?.measures?.[0];
  const beats = m0?.attributes?.time?.beats;
  const beatType = m0?.attributes?.time?.beat_type;
  if (typeof beats === "number" && typeof beatType === "number" && beats > 0 && beatType > 0) {
    return { beats, beatType };
  }
  return { beats: 4, beatType: 4 };
}

function getPartByName(score: ScoreModel, needle: string): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes(needle)) return p;
  }
  return null;
}

function getBassPart(score: ScoreModel): any | null {
  return getPartByName(score, "bass");
}

function getMeasureNumber(m: any, fallback: number): number {
  const n = Number(m?.number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pc(x: number): number {
  return ((x % 12) + 12) % 12;
}

const STEP_TO_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

function parseRootToken(tok: string): number | null {
  const m = tok.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return null;
  if (acc === "#") return (base + 1) % 12;
  if (acc === "b") return (base + 11) % 12;
  return base;
}

function chordMain(symbol: string): string {
  const s = String(symbol ?? "").trim();
  if (!s) return "";
  if (!s.includes("/")) return s;
  return s.split("/")[0]!.trim();
}

function chordRootPc(symbol: string): number | null {
  const main = chordMain(symbol);
  const m = main.match(/^([A-Ga-g][#b]?)/);
  if (!m) return null;
  return parseRootToken(m[1]!);
}

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = (m0 as any)?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

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

function getChordEventsFromMeta(score: ScoreModel): ChordEvent[] {
  const meta: any = (score as any)?.meta;
  const sample = meta?.harmonize?.debug?.chordEventSample;
  if (Array.isArray(sample) && sample.length) {
    return sample
      .map((c: any) => ({
        measure: Number(c?.measure),
        t: Number(c?.t ?? 0),
        symbol: String(c?.symbol ?? "")
      }))
      .filter((c: any) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol);
  }

  const full = meta?.harmonize?.chords;
  if (Array.isArray(full) && full.length) {
    return full
      .map((c: any) => ({
        measure: Number(c?.measure),
        t: Number(c?.t ?? 0),
        symbol: String(c?.symbol ?? "")
      }))
      .filter((c: any) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol);
  }

  return [];
}

function chordMapByMeasureT0(chords: ChordEvent[]): Map<number, ChordEvent> {
  const map = new Map<number, ChordEvent>();
  for (const c of chords) {
    if (!Number.isFinite(c.measure)) continue;
    if (!Number.isFinite(c.t)) continue;
    if (c.t !== 0) continue; // per your instruction: t=0 only
    if (!c.symbol) continue;
    map.set(c.measure, c);
  }
  return map;
}

function isDominantToTonicVtoI(params: { fromChord: string; toChord: string; tonicPc: number }): boolean {
  const { fromChord, toChord, tonicPc } = params;

  const dominantPc = pc(tonicPc + 7);

  const fromRoot = chordRootPc(fromChord);
  const toRoot = chordRootPc(toChord);

  if (fromRoot === null || toRoot === null) return false;
  return pc(fromRoot) === dominantPc && pc(toRoot) === pc(tonicPc);
}

function detectCadencePairsVI(score: ScoreModel, warnings: string[]): Array<{ fromMeasure: number; toMeasure: number }> {
  const chords = getChordEventsFromMeta(score);
  if (!chords.length) {
    warn(warnings, "[rhythm] No chord events found in meta.harmonize.debug. Cadence detection skipped.");
    return [];
  }

  const tonic = tonicPcFromFifthsMajor(getKeyFifths(score));
  const m0 = chordMapByMeasureT0(chords);

  const p0 = score.parts?.[0];
  const measures = p0?.measures ?? [];
  if (!Array.isArray(measures) || measures.length < 2) return [];

  const nums = measures.map((m: any, idx: number) => getMeasureNumber(m, idx + 1));

  const pairs: Array<{ fromMeasure: number; toMeasure: number }> = [];
  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i]!;
    const b = nums[i + 1]!;
    const ca = m0.get(a);
    const cb = m0.get(b);
    if (!ca || !cb) continue;

    if (isDominantToTonicVtoI({ fromChord: ca.symbol, toChord: cb.symbol, tonicPc: tonic })) {
      pairs.push({ fromMeasure: a, toMeasure: b });
    }
  }

  return pairs;
}

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function compressMeasureToCell(params: {
  measure: any;
  cell: RhythmCell;
  warnings: string[];
  measureNumber: number;
}): void {
  const { measure, cell, warnings, measureNumber } = params;

  const events = Array.isArray(measure?.events) ? measure.events : [];
  if (!events.length) {
    warn(warnings, `[rhythm] m${measureNumber}: Bass measure has no events; skipping.`);
    return;
  }

  // Keep non-note/rest events.
  const other = events.filter((e: any) => !isNoteOrRest(e));
  const nr = events.filter((e: any) => isNoteOrRest(e));

  // We anchor from the earliest note/rest (usually t=0).
  const sorted = nr.slice().sort((a: any, b: any) => Number(a.t) - Number(b.t));
  const anchor = sorted.find((e: any) => e.type === "note") ?? sorted[0];

  if (!anchor) {
    warn(warnings, `[rhythm] m${measureNumber}: No note/rest anchor found; skipping.`);
    return;
  }

  // Build new note/rest events with same pitch, but new durations.
  let t = 0;
  const outNR: any[] = [];

  for (const d of cell.durs) {
    if (anchor.type === "note") {
      outNR.push({ ...anchor, t, dur: d });
    } else {
      outNR.push({ type: "rest", t, dur: d });
    }
    t += d;
  }

  measure.events = [...other, ...outNR].sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
}

export function applyRhythmToBassFinalCadence(score: ScoreModel, options: RhythmApplyOptions): RhythmApplyResult {
  const warnings: string[] = [];
  const meter = getMeter(score);

  const { cells, templates } = loadRhythmCellsAndTemplates({ warnings });

  const cadencePairs = detectCadencePairsVI(score, warnings);
  if (cadencePairs.length) {
    // eslint-disable-next-line no-console
    console.log(
      `[cadence] detected V->I cadence pairs: ${cadencePairs.map((c) => `${c.fromMeasure}->${c.toMeasure}`).join(", ")}`
    );
  }

  const bass = getBassPart(score);
  if (!bass) {
    warn(warnings, "[rhythm] No Bass part found. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no bass",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  if (!cadencePairs.length) {
    warn(warnings, "[rhythm] No V->I cadences detected. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no cadences",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const finalPair = cadencePairs[cadencePairs.length - 1]!;
  const applyPair = options.applyOnlyFinalCadence ? finalPair : null;

  if (!applyPair) {
    warn(warnings, "[rhythm] No cadence selected for application.");
    return {
      applied: false,
      reason: "no cadence selected",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const template = pickGrooveTemplate({
    templates,
    style: options.style,
    meter,
    role: options.role,
    warnings
  });

  if (!template) {
    return {
      applied: false,
      reason: "no groove template",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: applyPair,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  let cell = pickCellForTemplate({ template, cells, warnings });
  if (!cell) {
    return {
      applied: false,
      reason: "no rhythm cell",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: applyPair,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const styleAllowsBusy = options.style === "funk" || options.style === "samba";
  if (!styleAllowsBusy && isBusyCell(cell)) {
    const grounded = pickCellByTags({ template, cells, includeTags: ["grounded", "cadence"] });
    if (grounded) {
      warn(
        warnings,
        `[rhythm] Style="${options.style}" keeps bass grounded; swapping busy rhythm cell "${cell.id}" for grounded "${grounded.id}".`
      );
      cell = grounded;
    }
  }

  if (options.level === "beginner" && isBusyCell(cell)) {
    const grounded = pickCellByTags({ template, cells, includeTags: ["grounded", "cadence"] });
    if (grounded) {
      warn(
        warnings,
        `[rhythm] Level="beginner" selected; swapping busy rhythm cell "${cell.id}" for grounded "${grounded.id}".`
      );
      cell = grounded;
    }
  }

  const bassMeasures = Array.isArray(bass.measures) ? bass.measures : [];
  const chosenPlans: Record<string, { cellId: string; durs: number[]; label?: string }> = {};
  const appliedMeasureNumbers: number[] = [];

  // Apply to BOTH measures of the final cadence pair (V measure and I measure).
  const targets = new Set<number>([applyPair.fromMeasure, applyPair.toMeasure]);
  // eslint-disable-next-line no-console
  console.log(`[cadence] applying rhythm to measures ${applyPair.fromMeasure} -> ${applyPair.toMeasure}`);

  for (let i = 0; i < bassMeasures.length; i++) {
    const m = bassMeasures[i];
    const mNum = getMeasureNumber(m, i + 1);
    if (!targets.has(mNum)) continue;

    compressMeasureToCell({ measure: m, cell, warnings, measureNumber: mNum });
    chosenPlans[String(mNum)] = { cellId: cell.id, durs: cell.durs.slice(), label: cell.label };
    appliedMeasureNumbers.push(mNum);
  }

  if (!appliedMeasureNumbers.length) {
    warn(warnings, `[rhythm] Final cadence found (${applyPair.fromMeasure}->${applyPair.toMeasure}) but no measures matched.`);
    return {
      applied: false,
      reason: "no measures matched",
      style: options.style,
      detectedCadencePairs: cadencePairs,
      appliedCadencePair: applyPair,
      appliedMeasureNumbers: [],
      chosenPlans,
      warnings
    };
  }

  warn(
    warnings,
    `[rhythm] Applied Bass rhythm cell "${cell.id}" (${cell.label ?? ""}) on final cadence measures: ${appliedMeasureNumbers.join(
      ", "
    )}. style="${options.style}" meter=${meter.beats}/${meter.beatType}.`
  );

  return {
    applied: true,
    reason: "applied final-cadence bass rhythm",
    style: options.style,
    detectedCadencePairs: cadencePairs,
    appliedCadencePair: applyPair,
    appliedMeasureNumbers,
    chosenPlans,
    warnings
  };
}
