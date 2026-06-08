import type { ScoreModel } from "../score/types";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { arrangeStringQuartetFromPianoInstrumentation } from "./arrangeStringQuartetFromPianoInstrumentation";
import { WOODWIND_RANGES, type WoodwindVoiceId } from "./woodwinds/woodwindRanges";

/**
 * Place a pitch in a woodwind's sweet-spot register by octave. Keeps the pitch
 * class exactly (harmony preserved); only shifts octaves so each instrument
 * sounds in its idiomatic register — lifting a low piano melody into the flute's
 * bright octave, and keeping voices ordered top-to-bottom (Fl>Ob>Cl>Bn).
 */
function clampToWoodwindSweetSpot(midi: number, wvId: WoodwindVoiceId): number {
  const r = WOODWIND_RANGES[wvId];
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  const mid = (r.prefMin + r.prefMax) / 2;
  if (m < r.prefMin) { const up = m + 12; if (up <= r.absMax && Math.abs(up - mid) <= Math.abs(m - mid)) m = up; }
  if (m > r.prefMax) { const dn = m - 12; if (dn >= r.absMin && Math.abs(dn - mid) <= Math.abs(m - mid)) m = dn; }
  return m;
}

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

// Map each woodwind voice to the string-quartet part it is derived from, plus
// its woodwind instrument id/name and part id. Register order top→bottom is
// identical (V1>V2>VA>VC ≡ Flute>Oboe>Clarinet>Bassoon).
const WW_FROM_STRING: Array<{ stringId: string; partId: string; name: string; instrument: string; wvId: WoodwindVoiceId }> = [
  { stringId: "P_V1", partId: "P_FL", name: "Flute",          instrument: "flute",       wvId: "fl" },
  { stringId: "P_V2", partId: "P_OB", name: "Oboe",           instrument: "oboe",        wvId: "ob" },
  { stringId: "P_VA", partId: "P_CL", name: "Clarinet in Bb", instrument: "clarinet_bb", wvId: "cl" },
  { stringId: "P_VC", partId: "P_BN", name: "Bassoon",        instrument: "bassoon",     wvId: "bn" },
];

/**
 * Resolve voice crossings so the quartet reads top-to-bottom Fl ≥ Ob ≥ Cl ≥ Bn.
 * At each shared onset, if a lower-ordered instrument sounds ABOVE the one above
 * it, drop the lower instrument by an octave (while it stays in range). Pitch
 * class is preserved, so harmony is unchanged.
 */
function enforceWoodwindVoiceOrder(parts: PartLike[]): void {
  if (parts.length < 2) return;
  const wvIds: WoodwindVoiceId[] = ["fl", "ob", "cl", "bn"];
  // Build onset → midi maps per part for quick lookup
  const measureCount = Math.max(...parts.map((p) => (p.measures ?? []).length));
  for (let mi = 0; mi < measureCount; mi++) {
    // Collect each part's events at this measure keyed by onset
    const perPart = parts.map((p) => {
      const m = p.measures?.[mi];
      const map = new Map<string, any>();
      for (const ev of (m?.events ?? [])) {
        if (ev?.type === "note" && ev.pitch) map.set(onsetKey(Number(ev.t)), ev);
      }
      return map;
    });
    // Union of all onsets in this measure
    const onsets = new Set<string>();
    perPart.forEach((mp) => mp.forEach((_v, k) => onsets.add(k)));
    for (const k of onsets) {
      // From top voice down, ensure each voice ≤ the voice above it
      for (let vi = 1; vi < parts.length; vi++) {
        const above = perPart[vi - 1]?.get(k);
        const cur = perPart[vi]?.get(k);
        if (!above || !cur) continue;
        const aMidi = eventMidi(above);
        let cMidi = eventMidi(cur);
        if (typeof aMidi !== "number" || typeof cMidi !== "number") continue;
        const range = WOODWIND_RANGES[wvIds[vi]!];
        let guard = 0;
        while (cMidi > aMidi && cMidi - 12 >= range.absMin && guard++ < 4) {
          cMidi -= 12;
        }
        if (cMidi !== eventMidi(cur)) {
          cur.midi = cMidi;
          cur.pitch = midiToPitch(cMidi);
        }
      }
    }
  }
}

/**
 * Piano → Woodwind quartet (faithful copy WITH chord completion).
 *
 * Delegates to arrangeStringQuartetFromPianoInstrumentation — which already
 * does the proven two-phase routing: explicit piano notes are mapped by
 * register, and any voice missing a note at an onset is COMPLETED with the
 * most important missing chord tone (3rd→5th→root), inheriting the companion
 * voice's rhythm. We then remap the four string parts onto the woodwinds:
 *   Violin I  → Flute      Violin II → Oboe
 *   Viola     → Clarinet   Cello     → Bassoon
 * clamping every note into the woodwind instrument's sounding range.
 *
 * Result: all four winds always have notes (no empty Clarinet), the harmony is
 * completed when the piano is sparse, and the piano's actual pitches are kept
 * where present.
 */
export function arrangeWoodwindQuartetFromPianoInstrumentation(
  score: ScoreModel,
  options: ArrangeOptions = {}
): ScoreModel {
  const warnings = options.warnings;

  // Run the string-quartet copy (handles piano AND SATB sources + chord completion)
  const stringScore = arrangeStringQuartetFromPianoInstrumentation(score, { warnings });
  const stringParts: PartLike[] = Array.isArray((stringScore as any)?.parts) ? (stringScore as any).parts : [];

  if (!stringParts.length) {
    warn(warnings, "[woodwinds] Instrumentation copy: no parts produced; returning original score.");
    return score;
  }

  const byId = new Map<string, PartLike>();
  for (const p of stringParts) byId.set(String(p?.part_id ?? ""), p);

  const woodwindParts: PartLike[] = WW_FROM_STRING.map((map, idx) => {
    // Prefer matching by string part id; fall back to positional order.
    const src = byId.get(map.stringId) ?? stringParts[idx];
    if (!src) return null;
    const measures = (src.measures ?? []).map((m: any) => ({
      ...m,
      events: (m.events ?? []).map((ev: any) => {
        if (ev?.type !== "note" || !ev.pitch) return ev;
        const midi = eventMidi(ev);
        if (typeof midi !== "number") return ev;
        // Place into the instrument's sweet-spot register (lifts low piano
        // melody to the flute's bright octave; keeps voices in their bands).
        const placed = clampToWoodwindSweetSpot(midi, map.wvId);
        if (placed === midi) return ev;
        return { ...ev, midi: placed, pitch: midiToPitch(placed) };
      }),
    }));
    return { ...src, part_id: map.partId, name: map.name, instrument: map.instrument, staves: 1, measures };
  }).filter((p): p is PartLike => !!p);

  // ── Enforce top-to-bottom voice order (Fl ≥ Ob ≥ Cl ≥ Bn) ────────────────
  // After octave placement a lower instrument can still sit above a higher one
  // at a given onset. Drop the offending voice by an octave (within its range)
  // so the chord reads cleanly with no crossings.
  enforceWoodwindVoiceOrder(woodwindParts);

  warn(
    warnings,
    "[woodwinds] Instrumentation copy applied (chord-completed): RH→Flute/Oboe, LH→Clarinet/Bassoon; missing voices filled with chord tones."
  );

  return {
    ...(score as any),
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    parts: woodwindParts,
  } as ScoreModel;
}
