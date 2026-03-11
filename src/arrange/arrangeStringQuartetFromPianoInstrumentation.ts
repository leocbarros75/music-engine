import type { ScoreModel } from "../score/types";
import {
  getInstrumentSpec,
  midiToPitch,
  pitchToMidi
} from "../instruments/instrumentCatalog";

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
  // Group near-simultaneous notes into one onset while preserving 16th-note events.
  const grid = 64; // 1/64 beat
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
  options?: { t?: number; dur?: number; chord?: boolean }
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
    ...(tieStop ? { tieStop: true } : {}),
    ...(options?.chord === true ? { chord: true } : {})
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

export function arrangeStringQuartetFromPianoInstrumentation(
  score: ScoreModel,
  options: ArrangeOptions = {}
): ScoreModel {
  const warnings = options.warnings;
  const pianoPart = findPianoPart(score);
  if (!pianoPart) {
    warn(warnings, "[strings] Instrumentation copy: piano part not found; returning original score.");
    return score;
  }

  const sourceMeasures = Array.isArray(pianoPart?.measures) ? pianoPart.measures : [];
  const violin1 = makePart("P_V1", "Violin I", "violin_1", sourceMeasures);
  const violin2 = makePart("P_V2", "Violin II", "violin_2", sourceMeasures);
  const viola = makePart("P_VA", "Viola", "viola", sourceMeasures);
  const cello = makePart("P_VC", "Cello", "cello", sourceMeasures);

  let seq = 0;
  for (let mi = 0; mi < sourceMeasures.length; mi++) {
    const srcMeasure = sourceMeasures[mi] ?? {};
    const srcEvents = Array.isArray(srcMeasure?.events) ? srcMeasure.events : [];
    const noteEvents = srcEvents
      .filter((ev: any) => ev?.type === "note")
      .sort(measureEventSort);

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

    const v1m = violin1.measures[mi];
    const v2m = violin2.measures[mi];
    const vam = viola.measures[mi];
    const vcm = cello.measures[mi];
    const violaOverrideByOnset = new Map<string, { ev: EventLike; midi: number }>();

    // RH mapping:
    // - top RH note -> Violin I
    // - inner RH note (highest note below top) -> Violin II
    // - RH unison/single-note case: Violin II may double Violin I
    // - fallback: if RH has 3 notes and LH is absent at this onset,
    //   Viola takes the bottom RH note.
    // - if RH has 3 notes and LH top doubles LH bass, Viola takes bottom RH note.
    // - if RH has 3 notes and LH top is different from LH bass, Violin II plays divisi
    //   (inner RH + bottom RH).
    for (const key of Array.from(rhByOnset.keys()).sort()) {
      const onset = Number(key);
      const selected = selectNotesForOnset(rhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const lhSelectedAtOnset = selectNotesForOnset(lhByOnset.get(key) ?? []);
      const hasLhOnset = lhSelectedAtOnset.length > 0;
      const top = selected[selected.length - 1]!;
      const bottom = selected[0]!;
      pushMappedNote(v1m, top, "violin_1", "v1", ++seq, { t: onset });
      if (selected.length === 1) {
        // RH unison/melody-only onset: allow Violin II to double Violin I.
        pushMappedNote(v2m, top, "violin_2", "v2-unison", ++seq, { t: onset });
      }
      if (selected.length > 1 && selected.length !== 4) {
        const inner = selected[selected.length - 2]!;
        pushMappedNote(v2m, inner, "violin_2", "v2", ++seq, { t: onset });
      }

      if (selected.length !== 3 && !hasLhOnset) {
        // Requested instrumentation rule:
        // when RH is not a triad and LH has no onset note, Viola takes RH bottom note
        // even if Violin II is already on the same pitch.
        violaOverrideByOnset.set(key, bottom);
      }

      if (selected.length === 3) {
        const lhSelected = lhSelectedAtOnset;
        const hasLhTopVoice = lhSelected.length >= 2;

        if (!hasLhTopVoice) {
          // Strict rule: with RH triad and no LH top voice, Viola takes bottom RH note.
          violaOverrideByOnset.set(key, bottom);
        } else {
          // Violin II divisi: add bottom RH note alongside the inner RH note.
          const inner = selected[selected.length - 2]!;
          if (bottom.midi !== inner.midi) {
            const innerDur = Number(inner.ev?.dur);
            pushMappedNote(v2m, bottom, "violin_2", "v2-divisi", ++seq, {
              t: onset,
              ...(Number.isFinite(innerDur) && innerDur > 0 ? { dur: innerDur } : {}),
              chord: true
            });
          }
        }
      }

      if (selected.length === 4) {
        // Violin II takes both middle RH notes (divisi).
        const middleHighSrc = selected[selected.length - 2]!;
        const middleLowSrc = selected[selected.length - 3]!;
        const highDur = Number(middleHighSrc.ev?.dur);
        const lowDur = Number(middleLowSrc.ev?.dur);
        const sharedDur =
          Number.isFinite(highDur) && highDur > 0 && Number.isFinite(lowDur) && lowDur > 0
            ? Math.min(highDur, lowDur)
            : undefined;
        pushMappedNote(v2m, { ev: middleHighSrc.ev, midi: middleHighSrc.midi }, "violin_2", "v2-mid-high", ++seq, {
          t: onset,
          ...(typeof sharedDur === "number" ? { dur: sharedDur } : {})
        });
        if (middleLowSrc.midi !== middleHighSrc.midi) {
          pushMappedNote(v2m, { ev: middleLowSrc.ev, midi: middleLowSrc.midi }, "violin_2", "v2-mid-low", ++seq, {
            t: onset,
            ...(typeof sharedDur === "number" ? { dur: sharedDur } : {}),
            chord: true
          });
        }

        // Viola takes RH bottom only when LH top is missing OR LH top doubles LH bass.
        const lhSelected = lhSelectedAtOnset;
        const hasLhTopVoice = lhSelected.length >= 2;
        const lhBottom = lhSelected.length > 0 ? lhSelected[0]! : null;
        const lhTop = hasLhTopVoice ? lhSelected[lhSelected.length - 1]! : null;
        const lhTopDoublesBass =
          !!lhBottom && !!lhTop && ((lhTop.midi % 12 + 12) % 12) === ((lhBottom.midi % 12 + 12) % 12);
        if (!hasLhTopVoice || lhTopDoublesBass) {
          violaOverrideByOnset.set(key, bottom);
        }
      }
    }

    // LH mapping:
    // - top LH note -> Viola
    // - bottom LH note -> Cello
    for (const key of Array.from(lhByOnset.keys()).sort()) {
      const selected = selectNotesForOnset(lhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const bottom = selected[0]!;
      const top = selected[selected.length - 1]!;
      const violaOverride = violaOverrideByOnset.get(key);
      if (violaOverride) {
        pushMappedNote(vam, violaOverride, "viola", "va-rh-override", ++seq);
      } else {
        pushMappedNote(vam, top, "viola", "va", ++seq);
      }
      pushMappedNote(vcm, bottom, "cello", "vc", ++seq);
    }

    // Apply Viola overrides for RH onsets where LH is missing.
    for (const [key, violaSource] of violaOverrideByOnset) {
      if (lhByOnset.has(key)) continue;
      pushMappedNote(vam, violaSource, "viola", "va-rh-fallback", ++seq);
    }

    v1m.events.sort(measureEventSort);
    v2m.events.sort(measureEventSort);
    vam.events.sort(measureEventSort);
    vcm.events.sort(measureEventSort);
  }

  warn(
    warnings,
    "[strings] Instrumentation copy applied: RH top->Violin I, RH inner->Violin II, LH top->Viola, LH bottom->Cello."
  );

  return {
    ...(score as any),
    meta: {
      ...(score as any).meta,
      ensemble: "string_ensemble"
    },
    parts: [violin1, violin2, viola, cello]
  } as ScoreModel;
}
