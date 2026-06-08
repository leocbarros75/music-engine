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
 * Piano → Woodwind quartet — FAITHFUL COPY (voices rest where the piano rests).
 *
 *   Flute    ← RH top note          Oboe    ← RH 2nd-from-top (when present)
 *   Clarinet ← LH top note          Bassoon ← LH bottom note
 *
 * A voice with no source note at an onset simply RESTS (no per-beat chord
 * completion). Each note is octave-placed into its instrument's sweet-spot
 * register and voices are kept ordered top-to-bottom (no crossings).
 *
 * Sustained-gap fill: only when a voice would be SILENT for a whole measure (a
 * long gap) does it receive a single sustained chord tone drawn from the other
 * voices' harmony — so a voice is never absent for long stretches, without
 * cluttering the faithful per-beat copy.
 */
export function arrangeWoodwindQuartetFromPianoInstrumentation(
  score: ScoreModel,
  options: ArrangeOptions = {}
): ScoreModel {
  const warnings = options.warnings;
  const pianoPart = findPianoPart(score);
  if (!pianoPart) {
    // No piano staff → defer to the SATB→quartet path (choral sources)
    const stringScore = arrangeStringQuartetFromPianoInstrumentation(score, { warnings });
    const sp: PartLike[] = Array.isArray((stringScore as any)?.parts) ? (stringScore as any).parts : [];
    if (!sp.length) { warn(warnings, "[woodwinds] copy: no piano/SATB parts; returning original."); return score; }
    const remapped = WW_FROM_STRING.map((map, idx) => {
      const src = sp.find((p) => String(p.part_id) === map.stringId) ?? sp[idx];
      if (!src) return null;
      const measures = (src.measures ?? []).map((m: any) => ({ ...m, events: (m.events ?? []).map((ev: any) => {
        if (ev?.type !== "note" || !ev.pitch) return ev;
        const mm = eventMidi(ev); if (typeof mm !== "number") return ev;
        const placed = clampToWoodwindSweetSpot(mm, map.wvId);
        return placed === mm ? ev : { ...ev, midi: placed, pitch: midiToPitch(placed) };
      }) }));
      return { ...src, part_id: map.partId, name: map.name, instrument: map.instrument, staves: 1, measures };
    }).filter((p): p is PartLike => !!p);
    enforceWoodwindVoiceOrder(remapped);
    return { ...(score as any), meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" }, parts: remapped } as ScoreModel;
  }

  const sourceMeasures: MeasureLike[] = Array.isArray(pianoPart?.measures) ? pianoPart.measures : [];
  const flute    = makePart("P_FL", "Flute",          "flute",       sourceMeasures);
  const oboe     = makePart("P_OB", "Oboe",           "oboe",        sourceMeasures);
  const clarinet = makePart("P_CL", "Clarinet in Bb", "clarinet_bb", sourceMeasures);
  const bassoon  = makePart("P_BN", "Bassoon",        "bassoon",     sourceMeasures);

  // Voice → (instrument id, woodwind range id, target part)
  const voiceDefs = [
    { part: flute,    instr: "flute",       wvId: "fl" as WoodwindVoiceId },
    { part: oboe,     instr: "oboe",        wvId: "ob" as WoodwindVoiceId },
    { part: clarinet, instr: "clarinet_bb", wvId: "cl" as WoodwindVoiceId },
    { part: bassoon,  instr: "bassoon",     wvId: "bn" as WoodwindVoiceId },
  ];

  let seq = 0;
  for (let mi = 0; mi < sourceMeasures.length; mi++) {
    const srcMeasure = sourceMeasures[mi] ?? {};
    const noteEvents = (Array.isArray(srcMeasure?.events) ? srcMeasure.events : [])
      .filter((ev: any) => ev?.type === "note").sort(measureEventSort);

    const rhByOnset = new Map<string, EventLike[]>();
    const lhByOnset = new Map<string, EventLike[]>();
    for (const ev of noteEvents) {
      const t = Number(ev?.t); if (!Number.isFinite(t)) continue;
      const map = resolveStaff(ev) === 2 ? lhByOnset : rhByOnset;
      const k = onsetKey(t); const b = map.get(k) ?? []; b.push(ev); map.set(k, b);
    }

    // ── RH chord → Flute (top) / Oboe (mid) / Clarinet (bottom) ────────────
    // The right-hand chord is spread across the three upper winds, all playing
    // on every RH onset (when fewer than 3 RH notes, the nearest note is reused
    // so each upper voice still sounds). Flute lifts to its bright register;
    // Oboe/Clarinet are octave-placed into their sweet spots.
    for (const k of Array.from(rhByOnset.keys()).sort()) {
      const onset = Number(k);
      const sel = selectNotesForOnset(rhByOnset.get(k) ?? []); // ascending by midi
      if (!sel.length) continue;
      const n = sel.length;
      const topEv = sel[n - 1]!;                 // highest → Flute
      const midEv = n >= 2 ? sel[n - 2]! : sel[n - 1]!; // 2nd  → Oboe
      const botEv = n >= 3 ? sel[n - 3]! : (n >= 2 ? sel[n - 2]! : sel[n - 1]!); // 3rd → Clarinet
      pushMappedNote(flute.measures[mi],    { ev: topEv.ev, midi: clampToWoodwindSweetSpot(topEv.midi, "fl") }, "flute",       "fl", ++seq, { t: onset });
      pushMappedNote(oboe.measures[mi],     { ev: midEv.ev, midi: clampToWoodwindSweetSpot(midEv.midi, "ob") }, "oboe",        "ob", ++seq, { t: onset });
      pushMappedNote(clarinet.measures[mi], { ev: botEv.ev, midi: clampToWoodwindSweetSpot(botEv.midi, "cl") }, "clarinet_bb", "cl", ++seq, { t: onset });
    }

    // ── LH bass → Bassoon ──────────────────────────────────────────────────
    for (const k of Array.from(lhByOnset.keys()).sort()) {
      const onset = Number(k);
      const sel = selectNotesForOnset(lhByOnset.get(k) ?? []);
      if (!sel.length) continue;
      const bottom = sel[0]!;
      pushMappedNote(bassoon.measures[mi], { ev: bottom.ev, midi: clampToWoodwindSweetSpot(bottom.midi, "bn") }, "bassoon", "bn", ++seq, { t: onset });
    }

    for (const d of voiceDefs) (d.part.measures[mi].events as any[]).sort(measureEventSort);
  }

  const woodwindParts = voiceDefs.map((d) => d.part);

  // Keep voices ordered top-to-bottom (no crossings) at shared onsets.
  enforceWoodwindVoiceOrder(woodwindParts);

  // ── Sustained-gap fill ───────────────────────────────────────────────────
  // Only a voice that is SILENT for an entire measure (long gap) receives a
  // single sustained chord tone, drawn from the harmony of the other voices.
  fillSustainedGaps(woodwindParts, sourceMeasures);

  warn(warnings, "[woodwinds] Faithful copy: RH→Flute/Oboe, LH→Clarinet/Bassoon; voices rest where the piano rests; long gaps get a sustained chord tone.");

  return {
    ...(score as any),
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    parts: woodwindParts,
  } as ScoreModel;
}

/**
 * For each voice, any measure where it has NO notes (and the ensemble does have
 * harmony) gets a single sustained chord tone in the voice's sweet-spot. Keeps
 * a voice from disappearing for long stretches without cluttering faithful rests.
 */
function fillSustainedGaps(parts: PartLike[], sourceMeasures: MeasureLike[]): void {
  const wvIds: WoodwindVoiceId[] = ["fl", "ob", "cl", "bn"];
  const measureCount = Math.max(...parts.map((p) => (p.measures ?? []).length), 0);
  let beats = 4, beatType = 4;
  for (let mi = 0; mi < measureCount; mi++) {
    const attrs = (sourceMeasures[mi] as any)?.attributes;
    if (Number.isFinite(attrs?.time?.beats)) beats = Number(attrs.time.beats);
    if (Number.isFinite(attrs?.time?.beat_type)) beatType = Number(attrs.time.beat_type);
    const measureLen = beats * (4 / beatType);

    // Harmony pitch-classes sounding in this measure (from all voices)
    const pcs = new Set<number>();
    for (const p of parts) {
      for (const ev of (p.measures?.[mi]?.events ?? [])) {
        if (ev?.type === "note" && ev.pitch) {
          const m = eventMidi(ev); if (typeof m === "number") pcs.add(((m % 12) + 12) % 12);
        }
      }
    }
    if (!pcs.size) continue; // whole ensemble tacet → leave it silent

    for (let vi = 0; vi < parts.length; vi++) {
      const meas = parts[vi]?.measures?.[mi];
      if (!meas) continue;
      const hasNote = (meas.events ?? []).some((e: any) => e?.type === "note" && e.pitch);
      if (hasNote) continue; // voice already plays this measure — leave faithful
      // Pick the chord pc nearest this voice's preferred centre
      const r = WOODWIND_RANGES[wvIds[vi]!];
      const centre = (r.prefMin + r.prefMax) / 2;
      let bestMidi: number | null = null, bestDist = Infinity;
      for (const pc of pcs) {
        let m = pc; while (m < r.absMin) m += 12; while (m > r.absMax) m -= 12;
        for (const cand of [m, m + 12, m - 12]) {
          if (cand < r.absMin || cand > r.absMax) continue;
          const d = Math.abs(cand - centre);
          if (d < bestDist) { bestDist = d; bestMidi = cand; }
        }
      }
      if (bestMidi === null) continue;
      meas.events = [{
        id: `${wvIds[vi]}-gap-${mi}`, t: 0, dur: measureLen,
        type: "note", pitch: midiToPitch(bestMidi), voice: 1, staff: 1,
      }];
    }
  }
}
