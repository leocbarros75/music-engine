// src/arrange/arrangeStringEnsembleFromSatb.ts
import type { ScoreModel } from "../score/types";
import { getInstrumentSpec, clampMidiToInstrumentRange, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";

type StringLevel = "beginner" | "intermediate" | "advanced" | "professional";

export type ArrangeStringEnsembleOptions = {
  level?: StringLevel;
  warnings?: string[];
};

type Part = any;

function warn(warnings: string[] | undefined, msg: string): void {
  if (!warnings) return;
  warnings.push(msg);
}

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x));
}

function isNoteOrRest(ev: any): boolean {
  return ev && (ev.type === "note" || ev.type === "rest");
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

function findPartByName(score: ScoreModel, name: string, fallbackIndex: number): Part | null {
  const parts = (score as any)?.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes(name)) return p;
  }
  return parts[fallbackIndex] ?? null;
}

function ensureMeasureAttributesOnlyOnFirst(part: any): void {
  const ms = part?.measures ?? [];
  for (let i = 0; i < ms.length; i++) {
    if (i === 0) continue;
    if (ms[i]?.attributes) delete ms[i].attributes;
  }
}

function mapPartFromSource(
  src: Part,
  instrumentId: string,
  partId: string,
  partName: string,
  octaveShift: number
): Part {
  const spec = getInstrumentSpec(instrumentId);
  const measures = (src?.measures ?? []).map((m: any) => {
    const events = (m?.events ?? []).map((ev: any) => {
      if (!isNoteOrRest(ev)) return clone(ev);
      if (ev.type === "rest") return clone(ev);
      const midi = eventMidi(ev);
      if (midi === null || !spec) return clone(ev);
      const shifted = midi + octaveShift * 12;
      const clamped = clampMidiToInstrumentRange(shifted, spec);
      return {
        ...clone(ev),
        midi: clamped,
        pitch: midiToPitch(clamped)
      };
    });
    return { ...clone(m), events };
  });

  const part = {
    part_id: partId,
    name: partName,
    instrument: instrumentId,
    staves: 1,
    measures
  };
  ensureMeasureAttributesOnlyOnFirst(part);
  return part;
}

export function arrangeStringEnsembleFromSatb(
  score: ScoreModel,
  options: ArrangeStringEnsembleOptions = {}
): ScoreModel {
  const warnings = options.warnings ?? [];
  const soprano = findPartByName(score, "soprano", 0);
  const alto = findPartByName(score, "alto", 1);
  const tenor = findPartByName(score, "tenor", 2);
  const bass = findPartByName(score, "bass", 3);

  if (!soprano || !bass) {
    warn(warnings, "[strings] Missing Soprano or Bass part; returning original score.");
    return score;
  }

  const violin1 = mapPartFromSource(soprano, "violin_1", "P_V1", "Violin I", 0);
  const violin2 = mapPartFromSource(alto ?? soprano, "violin_2", "P_V2", "Violin II", 0);
  const viola = mapPartFromSource(tenor ?? alto ?? soprano, "viola", "P_VA", "Viola", 0);
  const cello = mapPartFromSource(bass, "cello", "P_VC", "Cello", 0);
  const doubleBass = mapPartFromSource(bass, "double_bass", "P_DB", "Double Bass", -1);

  const parts = [violin1, violin2, viola, cello, doubleBass];

  return {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "string_ensemble" },
    parts
  } as ScoreModel;
}
