import type { ScoreModel } from "../score/types";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";

type PartLike = any;
type MeasureLike = any;
type EventLike = any;

type ArrangeOptions = {
  warnings?: string[];
};

function warn(warnings: string[] | undefined, msg: string): void {
  if (!warnings) return;
  warnings.push(msg);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function eventMidi(ev: EventLike): number | null {
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

function resolveStaff(ev: EventLike): 1 | 2 {
  const staff = Number(ev?.staff);
  if (staff === 2) return 2;
  if (staff === 1) return 1;
  const midi = eventMidi(ev);
  if (typeof midi === "number" && midi < 60) return 2;
  return 1;
}

function measureEventSort(a: EventLike, b: EventLike): number {
  const dt = Number(a?.t ?? 0) - Number(b?.t ?? 0);
  if (Math.abs(dt) > 1e-9) return dt;
  const da = Number(a?.dur ?? 0);
  const db = Number(b?.dur ?? 0);
  if (Math.abs(da - db) > 1e-9) return db - da;
  return 0;
}

function quantizeOnset(t: number): number {
  const grid = 64;
  return Math.round(t * grid) / grid;
}

function onsetKey(t: number): string {
  return quantizeOnset(t).toFixed(6);
}

function clampMidiToAbsoluteRange(midi: number, instrumentId: string): number {
  const spec = getInstrumentSpec(instrumentId);
  if (!spec) return midi;
  const lo = Number((spec as any).midi_low);
  const hi = Number((spec as any).midi_high);
  if (Number.isFinite(lo) && Number.isFinite(hi) && midi >= lo && midi <= hi) {
    return midi;
  }
  let m = midi;
  while (Number.isFinite(lo) && m < lo) m += 12;
  while (Number.isFinite(hi) && m > hi) m -= 12;
  if (Number.isFinite(lo) && m < lo) m = lo;
  if (Number.isFinite(hi) && m > hi) m = hi;
  return m;
}

function findPianoPart(score: ScoreModel): PartLike | null {
  const parts = score.parts ?? [];
  const byInstrument = parts.find((p: any) => String(p?.instrument ?? "").toLowerCase().includes("piano"));
  if (byInstrument) return byInstrument;
  const byName = parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("piano"));
  if (byName) return byName;
  const byStaves = parts.find((p: any) => Number(p?.staves ?? 1) >= 2);
  if (byStaves) return byStaves;
  return null;
}

function makePart(partId: string, name: string, instrument: string, measures: MeasureLike[]): PartLike {
  const clonedMeasures = measures.map((m, i) => ({
    number: Number(m?.number ?? i + 1),
    ...(i === 0 && m?.attributes ? { attributes: clone(m.attributes) } : {}),
    events: []
  }));
  return {
    part_id: partId,
    name,
    instrument,
    staves: 1,
    measures: clonedMeasures
  };
}

function pushMappedNote(
  targetMeasure: MeasureLike,
  source: { ev: EventLike; midi: number },
  instrumentId: string,
  idPrefix: string,
  seq: number,
  options?: { t?: number; dur?: number }
): void {
  const t = Number.isFinite(options?.t as number) ? Number(options?.t) : Number(source.ev?.t);
  const dur = Number.isFinite(options?.dur as number) ? Number(options?.dur) : Number(source.ev?.dur);
  if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) return;
  const clampedMidi = clampMidiToAbsoluteRange(source.midi, instrumentId);
  const tieStart = source.ev?.tieStart === true;
  const tieStop = source.ev?.tieStop === true;
  targetMeasure.events.push({
    id: `${idPrefix}-${targetMeasure.number}-${seq}`,
    t,
    dur,
    type: "note",
    pitch: midiToPitch(clampedMidi),
    voice: 1,
    staff: 1,
    ...(tieStart ? { tieStart: true } : {}),
    ...(tieStop ? { tieStop: true } : {})
  });
}

function selectNotesForOnset(events: EventLike[]): Array<{ ev: EventLike; midi: number }> {
  return events
    .map((ev) => {
      const midi = eventMidi(ev);
      if (typeof midi !== "number") return null;
      return { ev, midi };
    })
    .filter((x): x is { ev: EventLike; midi: number } => !!x)
    .sort((a, b) => {
      if (a.midi !== b.midi) return a.midi - b.midi;
      const ad = Number(a.ev?.dur ?? 0);
      const bd = Number(b.ev?.dur ?? 0);
      return ad - bd;
    });
}

export function arrangeWoodwindQuartetFromPianoInstrumentation(
  score: ScoreModel,
  options: ArrangeOptions = {}
): ScoreModel {
  const warnings = options.warnings;
  const pianoPart = findPianoPart(score);
  if (!pianoPart) {
    warn(warnings, "[woodwinds] Instrumentation copy: piano part not found; returning original score.");
    return score;
  }

  const sourceMeasures = Array.isArray(pianoPart?.measures) ? pianoPart.measures : [];
  const flute = makePart("P_FL", "Flute", "flute", sourceMeasures);
  const oboe = makePart("P_OB", "Oboe", "oboe", sourceMeasures);
  const clarinet = makePart("P_CL", "Clarinet in Bb", "clarinet_bb", sourceMeasures);
  const bassoon = makePart("P_BN", "Bassoon", "bassoon", sourceMeasures);

  let seq = 0;
  for (let mi = 0; mi < sourceMeasures.length; mi++) {
    const srcMeasure = sourceMeasures[mi] ?? {};
    const srcEvents = Array.isArray(srcMeasure?.events) ? srcMeasure.events : [];
    const noteEvents = srcEvents.filter((ev: any) => ev?.type === "note").sort(measureEventSort);

    const rhByOnset = new Map<string, EventLike[]>();
    const lhByOnset = new Map<string, EventLike[]>();
    for (const ev of noteEvents) {
      const t = Number(ev?.t);
      if (!Number.isFinite(t)) continue;
      const key = onsetKey(t);
      const staff = resolveStaff(ev);
      const map = staff === 2 ? lhByOnset : rhByOnset;
      const bucket = map.get(key) ?? [];
      bucket.push(ev);
      map.set(key, bucket);
    }

    const flMeasure = flute.measures[mi];
    const obMeasure = oboe.measures[mi];
    const clMeasure = clarinet.measures[mi];
    const bnMeasure = bassoon.measures[mi];
    const clarinetFallbackByOnset = new Map<string, { ev: EventLike; midi: number }>();

    for (const key of Array.from(rhByOnset.keys()).sort()) {
      const onset = Number(key);
      const selected = selectNotesForOnset(rhByOnset.get(key) ?? []);
      if (!selected.length) continue;

      const top = selected[selected.length - 1]!;
      const second = selected.length > 1 ? selected[selected.length - 2]! : null;
      const bottom = selected[0]!;

      pushMappedNote(flMeasure, top, "flute", "fl", ++seq, { t: onset });
      if (second) {
        pushMappedNote(obMeasure, second, "oboe", "ob", ++seq, { t: onset });
      } else {
        pushMappedNote(obMeasure, top, "oboe", "ob-unison", ++seq, { t: onset });
      }

      if (selected.length >= 3) {
        clarinetFallbackByOnset.set(key, bottom);
      }
    }

    for (const key of Array.from(lhByOnset.keys()).sort()) {
      const onset = Number(key);
      const selected = selectNotesForOnset(lhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const bottom = selected[0]!;
      const top = selected[selected.length - 1]!;

      pushMappedNote(bnMeasure, bottom, "bassoon", "bn", ++seq, { t: onset });
      if (selected.length >= 2) {
        pushMappedNote(clMeasure, top, "clarinet_bb", "cl", ++seq, { t: onset });
      } else {
        const fallback = clarinetFallbackByOnset.get(key);
        if (fallback) {
          pushMappedNote(clMeasure, fallback, "clarinet_bb", "cl-rh-fallback", ++seq, { t: onset });
        }
      }
    }

    for (const [key, clarinetSource] of clarinetFallbackByOnset) {
      if (lhByOnset.has(key)) continue;
      pushMappedNote(clMeasure, clarinetSource, "clarinet_bb", "cl-rh-only", ++seq, { t: Number(key) });
    }

    flMeasure.events.sort(measureEventSort);
    obMeasure.events.sort(measureEventSort);
    clMeasure.events.sort(measureEventSort);
    bnMeasure.events.sort(measureEventSort);
  }

  warn(
    warnings,
    "[woodwinds] Instrumentation copy applied: RH top->Flute, RH inner->Oboe, LH top->Clarinet, LH bottom->Bassoon."
  );

  return {
    ...(score as any),
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    parts: [flute, oboe, clarinet, bassoon]
  } as ScoreModel;
}
