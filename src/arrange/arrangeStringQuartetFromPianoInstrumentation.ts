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

// ── Diatonic harmony helpers ──────────────────────────────────────────────────
// Build the set of 7 diatonic pitch classes for a given key signature (fifths).
function getDiatonicPCs(fifths: number): number[] {
  // Sharps/flats added in order (sharps: F C G D A E B; flats: Bb Eb Ab Db Gb Cb Fb)
  const sharpsOrder = [6, 1, 8, 3, 10, 5, 0];
  const flatsOrder  = [10, 3, 8, 1, 6, 11, 4];
  const pcs = new Set<number>([0, 2, 4, 5, 7, 9, 11]); // C major
  const f = Math.max(-7, Math.min(7, Math.round(fifths)));
  if (f > 0) {
    for (let i = 0; i < f; i++) {
      pcs.delete((sharpsOrder[i]! - 1 + 12) % 12); // remove natural
      pcs.add(sharpsOrder[i]!);                      // add sharp
    }
  } else if (f < 0) {
    for (let i = 0; i < -f; i++) {
      pcs.delete((flatsOrder[i]! + 1) % 12);         // remove natural
      pcs.add(flatsOrder[i]!);                        // add flat
    }
  }
  return [...pcs].sort((a, b) => a - b);
}

// Return the MIDI of the note N diatonic steps BELOW `midi` in the given key.
function diatonicStepsBelow(midi: number, steps: number, fifths: number): number {
  const pcs = getDiatonicPCs(fifths);
  let pc = ((midi % 12) + 12) % 12;
  let idx = pcs.indexOf(pc);
  if (idx < 0) {
    // Non-diatonic: snap down to nearest scale tone
    let best = pcs[0]!, bestDist = 13;
    for (const spc of pcs) {
      const d = ((pc - spc) % 12 + 12) % 12; // distance going down
      if (d > 0 && d < bestDist) { bestDist = d; best = spc; }
    }
    midi = midi - bestDist;
    pc = best;
    idx = pcs.indexOf(pc);
  }
  const newIdx = ((idx - steps) % 7 + 7) % 7;
  const newPc = pcs[newIdx]!;
  const baseOctave = Math.floor(midi / 12) * 12;
  let result = baseOctave + newPc;
  if (result >= midi) result -= 12;
  return result;
}

// Return the MIDI of the note N diatonic steps ABOVE `midi` in the given key.
function diatonicStepsAbove(midi: number, steps: number, fifths: number): number {
  const pcs = getDiatonicPCs(fifths);
  let pc = ((midi % 12) + 12) % 12;
  let idx = pcs.indexOf(pc);
  if (idx < 0) {
    // Non-diatonic: snap up to nearest scale tone
    let best = pcs[0]!, bestDist = 13;
    for (const spc of pcs) {
      const d = ((spc - pc) % 12 + 12) % 12; // distance going up
      if (d > 0 && d < bestDist) { bestDist = d; best = spc; }
    }
    midi = midi + bestDist;
    pc = best;
    idx = pcs.indexOf(pc);
  }
  const newIdx = (idx + steps) % 7;
  const newPc = pcs[newIdx]!;
  const baseOctave = Math.floor(midi / 12) * 12;
  let result = baseOctave + newPc;
  if (result <= midi) result += 12;
  return result;
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

function partHasStaff2Notes(part: PartLike): boolean {
  // Check whether any note event in this part is on staff 2 — this identifies
  // a grand-staff piano part even when the part name is not "Piano".
  for (const measure of (part?.measures ?? []) as MeasureLike[]) {
    for (const ev of (measure?.events ?? []) as EventLike[]) {
      if (ev?.type === "note" && Number(ev?.staff) === 2) return true;
    }
  }
  return false;
}

/** Exported so pipeline/applyAppSettings can auto-detect piano input for "auto" routing. */
export function scoreHasPianoPart(score: any): boolean {
  return findPianoPart(score as ScoreModel) !== null;
}

/**
 * Dedicated SATB → String Quartet copy.
 * Maps S→Violin I, A→Violin II, T→Viola, B→Cello.
 * Clamps notes to each instrument's absolute range.
 * Exported for the "satb_string_quartet" ensemble.
 */
export function arrangeSatbToStringQuartetDirect(
  score: any,
  options: ArrangeOptions = {}
): any {
  const satb = findSatbParts(score as ScoreModel);
  if (!satb) {
    warn(options.warnings, "[strings] SATB → String Quartet: no SATB parts found; returning original score.");
    return score;
  }
  return arrangeSatbToStringQuartet(score as ScoreModel, satb, options);
}

function findPianoPart(score: ScoreModel): PartLike | null {
  const parts = score.parts ?? [];

  // 1. Explicit instrument field (set by some parsers)
  const byInstrument = parts.find((p: any) =>
    String(p?.instrument ?? "").toLowerCase().includes("piano") ||
    String(p?.instrument ?? "").toLowerCase().includes("keyboard") ||
    String(p?.instrument ?? "").toLowerCase().includes("keys")
  );
  if (byInstrument) return byInstrument;

  // 2. Part name contains a keyboard keyword
  const pianoKeywords = ["piano", "pno", "keyboard", "keys", "accomp", "organ", "harpsichord"];
  const byName = parts.find((p: any) => {
    const n = String(p?.name ?? "").toLowerCase();
    return pianoKeywords.some((k) => n.includes(k));
  });
  if (byName) return byName;

  // 3. staves field set to 2 (some parsers write this from <staves> XML element)
  const byStaves = parts.find((p: any) => Number(p?.staves ?? 1) >= 2);
  if (byStaves) return byStaves;

  // 4. Inspect actual note events — find the part that has staff=2 notes
  //    (grand-staff part where LH notes carry staff="2")
  const byStaff2 = parts.find((p: any) => partHasStaff2Notes(p));
  if (byStaff2) return byStaff2;

  return null;
}

type SatbParts = { soprano: PartLike; alto: PartLike; tenor: PartLike; bass: PartLike };

function findSatbParts(score: ScoreModel): SatbParts | null {
  const parts = score.parts ?? [];
  const find = (...keywords: string[]) =>
    parts.find((p: any) => {
      const n = String(p?.name ?? "").toLowerCase();
      return keywords.some((k) => n.includes(k));
    }) ?? null;
  const soprano = find("soprano", "sop");
  const alto    = find("alto", "alt");
  const tenor   = find("tenor", "ten");
  const bass    = find("bass", "bas");
  if (soprano && alto && tenor && bass) return { soprano, alto, tenor, bass };
  // Fallback: if exactly 4 parts, treat them as S/A/T/B in order
  if (parts.length === 4) {
    return { soprano: parts[0], alto: parts[1], tenor: parts[2], bass: parts[3] };
  }
  return null;
}

function clonePartAs(source: PartLike, partId: string, name: string, instrument: string): PartLike {
  const cloned = clone(source);
  cloned.part_id  = partId;
  cloned.name     = name;
  cloned.instrument = instrument;
  cloned.staves   = 1;
  return cloned;
}

function arrangeSatbToStringQuartet(
  score: ScoreModel,
  satb: SatbParts,
  options: ArrangeOptions
): ScoreModel {
  const violin1 = clonePartAs(satb.soprano, "P_V1", "Violin I",  "violin_1");
  const violin2 = clonePartAs(satb.alto,    "P_V2", "Violin II", "violin_2");
  const viola   = clonePartAs(satb.tenor,   "P_VA", "Viola",     "viola");
  const cello   = clonePartAs(satb.bass,    "P_VC", "Cello",     "cello");

  // Clamp any notes that fall outside each instrument's absolute range
  for (const [part, instrId] of [
    [violin1, "violin_1"],
    [violin2, "violin_2"],
    [viola,   "viola"],
    [cello,   "cello"],
  ] as const) {
    for (const measure of (part.measures ?? []) as MeasureLike[]) {
      for (const ev of (measure.events ?? []) as EventLike[]) {
        if (ev?.type !== "note") continue;
        const midi = eventMidi(ev);
        if (typeof midi !== "number") continue;
        const clamped = clampMidiToAbsoluteRange(midi, instrId);
        if (clamped !== midi) {
          ev.midi  = clamped;
          ev.pitch = midiToPitch(clamped);
        }
      }
    }
  }

  warn(
    options.warnings,
    "[strings] SATB instrumentation copy applied: Soprano→Violin I, Alto→Violin II, Tenor→Viola, Bass→Cello."
  );

  return {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "string_ensemble" },
    parts: [violin1, violin2, viola, cello],
  } as ScoreModel;
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
    const satb = findSatbParts(score);
    if (satb) return arrangeSatbToStringQuartet(score, satb, options);
    warn(warnings, "[strings] Instrumentation copy: no piano or SATB parts found; returning original score.");
    return score;
  }

  const sourceMeasures = Array.isArray(pianoPart?.measures) ? pianoPart.measures : [];
  const violin1 = makePart("P_V1", "Violin I", "violin_1", sourceMeasures);
  const violin2 = makePart("P_V2", "Violin II", "violin_2", sourceMeasures);
  const viola = makePart("P_VA", "Viola", "viola", sourceMeasures);
  const cello = makePart("P_VC", "Cello", "cello", sourceMeasures);

  // Track running key signature (updated when a measure has new attributes)
  let currentKeyFifths = 0;
  const firstAttrs = sourceMeasures.find((m: any) => m?.attributes?.key_fifths !== undefined);
  if (firstAttrs) currentKeyFifths = Number(firstAttrs.attributes.key_fifths) || 0;

  let seq = 0;
  for (let mi = 0; mi < sourceMeasures.length; mi++) {
    const srcMeasure = sourceMeasures[mi] ?? {};

    // Update key signature if this measure has new attributes
    if (Number.isFinite(srcMeasure?.attributes?.key_fifths)) {
      currentKeyFifths = Number(srcMeasure.attributes.key_fifths);
    }

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

    // ── Unified routing rules ────────────────────────────────────────────────
    //
    // RH (per onset, sorted low→high):
    //   1 note  : V1 = that note; V2 = engine-fill (diatonic 3rd below V1)
    //   2 notes : V1 = top;        V2 = bottom
    //   3 notes : V1 = top;        V2 = bottom + middle as chord addition
    //   4+ notes: V1 = top;        V2 = bottom + ALL inner notes as chord additions
    //             (extra inner notes beyond the 1st are added to V2 so no piano
    //              note is dropped when the chord is larger than 4 voices)
    //
    // LH (per onset, sorted low→high):
    //   1 note  : VC = that note;  VA = engine-fill (diatonic 3rd above VC)
    //   2 notes : VC = bottom;     VA = 2nd from bottom
    //   3+ notes: VC = bottom;     VA = 2nd from bottom + ALL remaining notes
    //             as chord additions (so a full LH chord is preserved in VA)

    // RH → V1 + V2
    for (const key of Array.from(rhByOnset.keys()).sort()) {
      const selected = selectNotesForOnset(rhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const top    = selected[selected.length - 1]!;
      const bottom = selected[0]!;

      // V1 = top note (always)
      pushMappedNote(v1m, top, "violin_1", "v1", ++seq);

      if (selected.length >= 3) {
        // V2 = bottom note as primary; all inner notes (between bottom and top) as chord additions
        pushMappedNote(v2m, bottom, "violin_2", "v2-lo", ++seq);
        for (let i = 1; i <= selected.length - 2; i++) {
          pushMappedNote(v2m, selected[i]!, "violin_2", "v2-inner", ++seq, { chord: true });
        }
      } else if (selected.length === 2) {
        // V2 = bottom note
        pushMappedNote(v2m, bottom, "violin_2", "v2", ++seq);
      } else {
        // Single RH note: V2 = engine-fill, diatonic 3rd below V1
        const fillMidi = diatonicStepsBelow(top.midi, 2, currentKeyFifths);
        if (fillMidi !== top.midi) {
          pushMappedNote(v2m, { ev: top.ev, midi: fillMidi }, "violin_2", "v2-fill", ++seq);
        }
      }
    }

    // LH → VC + VA
    for (const key of Array.from(lhByOnset.keys()).sort()) {
      const selected = selectNotesForOnset(lhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const bottom = selected[0]!;

      // VC = bottom note (always)
      pushMappedNote(vcm, bottom, "cello", "vc", ++seq);

      if (selected.length >= 2) {
        // VA = 2nd note from bottom as primary; any additional LH notes as chord additions
        pushMappedNote(vam, selected[1]!, "viola", "va", ++seq);
        for (let i = 2; i < selected.length; i++) {
          pushMappedNote(vam, selected[i]!, "viola", "va-extra", ++seq, { chord: true });
        }
      } else {
        // Single LH note: VA = engine-fill, diatonic 3rd above VC clamped to viola range
        let fillMidi = diatonicStepsAbove(bottom.midi, 2, currentKeyFifths);
        // Keep fill within comfortable viola range (G3=55 … C6=84)
        while (fillMidi < 55) fillMidi += 12;
        while (fillMidi > 84) fillMidi -= 12;
        if (fillMidi !== bottom.midi) {
          pushMappedNote(vam, { ev: bottom.ev, midi: fillMidi }, "viola", "va-fill", ++seq);
        }
      }
    }

    v1m.events.sort(measureEventSort);
    v2m.events.sort(measureEventSort);
    vam.events.sort(measureEventSort);
    vcm.events.sort(measureEventSort);
  }

  warn(
    warnings,
    "[strings] Instrumentation copy applied: V1=top-RH, V2=bottom-RH(+fill), VA=upper-LH(+fill), VC=bottom-LH."
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
