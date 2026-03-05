// src/rhythm/applyRhythmToBassAllMeasures.ts
import type { ScoreModel } from "../score/types";
import { midiToPitch } from "../instruments/instrumentCatalog";
import type { GrooveTemplate, MeterSpec, RhythmApplyResult, RhythmApplyOptions, RhythmCell } from "./rhythmTypes";
import { loadRhythmCellsAndTemplates, pickCellForTemplate, pickGrooveTemplate } from "./rhythmLibrary";

type ApplyAllOptions = RhythmApplyOptions & {
  allowRests?: boolean;
};

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
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

function getBassPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("bass")) return p;
  }
  return parts.length ? parts[parts.length - 1] : null;
}

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function shouldRest(params: { measureNumber: number; index: number; cell: RhythmCell }): boolean {
  const { measureNumber, index, cell } = params;
  if (index === 0) return false;
  const tags = cell.tags ?? [];
  const seed = (measureNumber * 37 + index * 11 + cell.id.length) % 10;
  if (tags.includes("syncopated") && seed % 3 === 0) return true;
  return seed === 0;
}

function applyCellToMeasure(params: {
  measure: any;
  cell: RhythmCell;
  measureNumber: number;
  allowRests: boolean;
  warnings: string[];
}): void {
  const { measure, cell, measureNumber, allowRests, warnings } = params;
  const events = Array.isArray(measure?.events) ? measure.events : [];
  const other = events.filter((e: any) => !isNoteOrRest(e));
  const existingNotes = events.filter((e: any) => e?.type === "note");
  const anchorMidi =
    existingNotes.length && typeof existingNotes[0]?.midi === "number" ? Number(existingNotes[0].midi) : 43;

  let t = 0;
  const out: any[] = [];
  for (let i = 0; i < cell.durs.length; i++) {
    const d = cell.durs[i]!;
    const rest = allowRests && shouldRest({ measureNumber, index: i, cell });
    if (rest) {
      out.push({ type: "rest", t, dur: d });
    } else {
      out.push({ type: "note", t, dur: d, midi: anchorMidi, pitch: midiToPitch(anchorMidi) });
    }
    t += d;
  }

  if (!out.length) {
    warn(warnings, `[rhythm] m${measureNumber}: no rhythm events created for bass.`);
  }

  measure.events = [...other, ...out].sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
}

export function applyRhythmToBassAllMeasures(score: ScoreModel, options: ApplyAllOptions): RhythmApplyResult {
  const warnings: string[] = [];
  const meter = getMeter(score);

  const { cells, templates } = loadRhythmCellsAndTemplates({ warnings });
  const bass = getBassPart(score);
  if (!bass) {
    warn(warnings, "[rhythm] No Bass part found. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no bass",
      style: options.style,
      detectedCadencePairs: [],
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
      detectedCadencePairs: [],
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const cell = pickCellForTemplate({ template, cells, warnings });
  if (!cell) {
    return {
      applied: false,
      reason: "no rhythm cell",
      style: options.style,
      detectedCadencePairs: [],
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const bassMeasures = Array.isArray(bass.measures) ? bass.measures : [];
  const chosenPlans: Record<string, { cellId: string; durs: number[]; label?: string }> = {};
  const appliedMeasureNumbers: number[] = [];

  for (let i = 0; i < bassMeasures.length; i++) {
    const m = bassMeasures[i];
    const mNum = Number(m?.number) || i + 1;
    applyCellToMeasure({
      measure: m,
      cell,
      measureNumber: mNum,
      allowRests: options.allowRests === true,
      warnings
    });
    chosenPlans[String(mNum)] = { cellId: cell.id, durs: cell.durs.slice(), label: cell.label };
    appliedMeasureNumbers.push(mNum);
  }

  if (appliedMeasureNumbers.length) {
    warn(
      warnings,
      `[rhythm] Polyphonic bass rhythm applied with cell "${cell.id}" (${cell.label ?? "unnamed"}) across ${
        appliedMeasureNumbers.length
      } measure(s).`
    );
  }

  return {
    applied: appliedMeasureNumbers.length > 0,
    reason: appliedMeasureNumbers.length ? "applied" : "no measures",
    style: options.style,
    detectedCadencePairs: [],
    appliedCadencePair: null,
    appliedMeasureNumbers,
    chosenPlans,
    warnings
  };
}
