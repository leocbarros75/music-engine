import type { ScoreModel } from "../score/types";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { BRASS_RANGES, BRASS_PART_META, type BrassVoiceId } from "./brass/brassRanges";

/**
 * Piano → Brass quintet/quartet — FAITHFUL COPY (voices rest where the piano rests).
 *
 * Quintet (default):
 *   Trumpet 1 ← RH top note      Trumpet 2 ← RH 2nd-from-top      Horn ← RH 3rd
 *   Trombone  ← LH top note      Tuba      ← LH bottom note
 * Quartet (no horn):
 *   Trumpet 1 ← RH top           Trumpet 2 ← RH 2nd
 *   Trombone  ← LH top           Tuba      ← LH bottom
 *
 * A voice with no source note at an onset RESTS (no per-beat chord completion).
 * Each note is octave-placed into its instrument's sweet-spot register and the
 * upper voices are kept ordered top-to-bottom (no crossings). Pitch class is
 * preserved throughout, so harmony is unchanged.
 *
 * Tuba entry rule: the foundation voice may rest during a thin intro and enter
 * when the texture builds (mirrors the woodwind bassoon-entry rule).
 *
 * Concert pitch throughout; the MusicXML exporter writes the transposition
 * (Trumpet/Bb +2, Horn in F +7; Trombone/Tuba in concert bass clef).
 */

type PartLike = any;
type MeasureLike = any;
type EventLike = any;

type ArrangeOptions = {
  warnings?: string[];
  /** false = quartet (no Horn). Default true (quintet with Horn). */
  quintet?: boolean;
  /**
   * Tuba entry rule (the heaviest voice rests during the intro and enters when
   * the texture builds):
   *   - number (1-based measure): tuba rests before this measure (manual).
   *   - "auto" (default): rest the leading run of thin/quiet measures, then enter.
   *   - "always": tuba plays the bass from the start (no intro rest).
   */
  tubaEntry?: number | "auto" | "always";
};

/** Octave-place a pitch into a brass voice's sweet-spot register (pitch class kept). */
function clampToBrassSweetSpot(midi: number, bvId: BrassVoiceId): number {
  const r = BRASS_RANGES[bvId];
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  const mid = (r.prefMin + r.prefMax) / 2;
  if (m < r.prefMin) { const up = m + 12; if (up <= r.absMax && Math.abs(up - mid) <= Math.abs(m - mid)) m = up; }
  if (m > r.prefMax) { const dn = m - 12; if (dn >= r.absMin && Math.abs(dn - mid) <= Math.abs(m - mid)) m = dn; }
  return m;
}

/**
 * Decide which measures the tuba should be tacet (intro rest).
 * Manual: explicit entry measure. Auto: the LEADING run of measures whose note
 * density is below 70% of the piece median (a thin intro), capped at the first
 * third of the piece.
 */
function computeTubaTacet(
  sourceMeasures: MeasureLike[],
  rule: number | "auto" | "always" | undefined
): Set<number> {
  const tacet = new Set<number>();
  const n = sourceMeasures.length;
  if (n === 0 || rule === "always") return tacet;

  if (typeof rule === "number" && rule >= 1) {
    for (let mi = 0; mi < Math.min(rule - 1, n); mi++) tacet.add(mi);
    return tacet;
  }

  const dens = sourceMeasures.map((m: any) =>
    (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.isRest).length
  );
  const sorted = [...dens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return tacet;
  const threshold = median * 0.7;
  const cap = Math.floor(n / 3);
  for (let mi = 0; mi < n; mi++) {
    if (dens[mi]! < threshold && mi < cap) tacet.add(mi);
    else break;
  }
  return tacet;
}

function warn(warnings: string[] | undefined, msg: string): void {
  if (warnings) warnings.push(msg);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function eventMidi(ev: EventLike): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try { return pitchToMidi(ev.pitch); } catch { return null; }
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
  if (Number.isFinite(lo) && Number.isFinite(hi) && midi >= lo && midi <= hi) return midi;
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

function makePart(bvId: BrassVoiceId, measures: MeasureLike[]): PartLike {
  const meta = BRASS_PART_META[bvId];
  const clonedMeasures = measures.map((m, i) => ({
    number: Number(m?.number ?? i + 1),
    ...(i === 0 && m?.attributes ? { attributes: clone(m.attributes) } : {}),
    events: []
  }));
  return { part_id: meta.part_id, name: meta.name, instrument: meta.instrument, staves: 1, measures: clonedMeasures };
}

function pushMappedNote(
  targetMeasure: MeasureLike,
  ev: EventLike,
  midi: number,
  instrumentId: string,
  idPrefix: string,
  seq: number,
  onset: number
): void {
  const t = Number.isFinite(onset) ? onset : Number(ev?.t);
  const dur = Number(ev?.dur);
  if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) return;
  const clampedMidi = clampMidiToAbsoluteRange(midi, instrumentId);
  const tieStart = ev?.tieStart === true;
  const tieStop = ev?.tieStop === true;
  targetMeasure.events.push({
    id: `${idPrefix}-${targetMeasure.number}-${seq}`,
    t, dur, type: "note",
    pitch: midiToPitch(clampedMidi),
    voice: 1, staff: 1,
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
    .sort((a, b) => (a.midi !== b.midi ? a.midi - b.midi : Number(a.ev?.dur ?? 0) - Number(b.ev?.dur ?? 0)));
}

/**
 * Resolve crossings so the upper voices read top-to-bottom (Tpt1 ≥ Tpt2 ≥ Horn).
 * If a lower-ordered voice sounds ABOVE the one above it, drop it by an octave
 * while it stays in range. Pitch class preserved → harmony unchanged.
 */
function enforceBrassVoiceOrder(parts: PartLike[], bvIds: BrassVoiceId[]): void {
  if (parts.length < 2) return;
  const measureCount = Math.max(...parts.map((p) => (p.measures ?? []).length));
  for (let mi = 0; mi < measureCount; mi++) {
    const perPart = parts.map((p) => {
      const m = p.measures?.[mi];
      const map = new Map<string, any>();
      for (const ev of (m?.events ?? [])) {
        if (ev?.type === "note" && ev.pitch) map.set(onsetKey(Number(ev.t)), ev);
      }
      return map;
    });
    const onsets = new Set<string>();
    perPart.forEach((mp) => mp.forEach((_v, k) => onsets.add(k)));
    for (const k of onsets) {
      for (let vi = 1; vi < parts.length; vi++) {
        const above = perPart[vi - 1]?.get(k);
        const cur = perPart[vi]?.get(k);
        if (!above || !cur) continue;
        const aMidi = eventMidi(above);
        let cMidi = eventMidi(cur);
        if (typeof aMidi !== "number" || typeof cMidi !== "number") continue;
        const range = BRASS_RANGES[bvIds[vi]!];
        let guard = 0;
        while (cMidi > aMidi && cMidi - 12 >= range.absMin && guard++ < 4) cMidi -= 12;
        if (cMidi !== eventMidi(cur)) {
          cur.midi = cMidi;
          cur.pitch = midiToPitch(cMidi);
        }
      }
    }
  }
}

export function arrangeBrassQuintetFromPianoInstrumentation(
  score: ScoreModel,
  options: ArrangeOptions = {}
): ScoreModel {
  const warnings = options.warnings;
  const quintet = options.quintet ?? true;
  const pianoPart = findPianoPart(score);
  if (!pianoPart) {
    warn(warnings, "[brass] copy: no piano part found; returning original score.");
    return score;
  }

  const sourceMeasures: MeasureLike[] = Array.isArray(pianoPart?.measures) ? pianoPart.measures : [];

  // Upper voices (from RH chord, top→bottom) and lower voices (from LH, top→bottom).
  const upperIds: BrassVoiceId[] = quintet ? ["tpt1", "tpt2", "hn"] : ["tpt1", "tpt2"];
  const lowerIds: BrassVoiceId[] = ["tbn", "tuba"];
  const allIds: BrassVoiceId[] = [...upperIds, ...lowerIds];
  const partByVoice = new Map<BrassVoiceId, PartLike>();
  for (const bvId of allIds) partByVoice.set(bvId, makePart(bvId, sourceMeasures));

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

    // ── RH chord → upper brass (Tpt1 top, Tpt2 mid, Horn bottom) ─────────────
    // Spread the right-hand chord across the upper voices. With fewer RH notes
    // than upper voices, the nearest note is reused so each voice still sounds.
    for (const k of Array.from(rhByOnset.keys()).sort()) {
      const onset = Number(k);
      const sel = selectNotesForOnset(rhByOnset.get(k) ?? []); // ascending by midi
      if (!sel.length) continue;
      const n = sel.length;
      upperIds.forEach((bvId, idx) => {
        // idx 0 = highest. Walk down from the top of the chord.
        const pick = sel[Math.max(0, n - 1 - idx)]!;
        const part = partByVoice.get(bvId)!;
        pushMappedNote(part.measures[mi], pick.ev, clampToBrassSweetSpot(pick.midi, bvId), bvId, bvId, ++seq, onset);
      });
    }

    // ── LH → Trombone (top) / Tuba (bottom) ──────────────────────────────────
    for (const k of Array.from(lhByOnset.keys()).sort()) {
      const onset = Number(k);
      const sel = selectNotesForOnset(lhByOnset.get(k) ?? []); // ascending by midi
      if (!sel.length) continue;
      const n = sel.length;
      const topEv = sel[n - 1]!;   // highest LH note → Trombone
      const botEv = sel[0]!;       // lowest LH note  → Tuba
      pushMappedNote(partByVoice.get("tbn")!.measures[mi],  topEv.ev, clampToBrassSweetSpot(topEv.midi, "tbn"),  "tbn",  "tbn",  ++seq, onset);
      pushMappedNote(partByVoice.get("tuba")!.measures[mi], botEv.ev, clampToBrassSweetSpot(botEv.midi, "tuba"), "tuba_c", "tuba", ++seq, onset);
    }

    for (const bvId of allIds) (partByVoice.get(bvId)!.measures[mi].events as any[]).sort(measureEventSort);
  }

  const brassParts = allIds.map((bvId) => partByVoice.get(bvId)!);

  // ── Tuba entry rule: rest the thin intro, enter when the texture builds ────
  const tubaTacet = computeTubaTacet(sourceMeasures, options.tubaEntry ?? "auto");
  if (tubaTacet.size) {
    const tubaPart = partByVoice.get("tuba")!;
    for (const mi of tubaTacet) {
      const tm = tubaPart.measures[mi];
      if (tm) tm.events = [];
    }
    const entryNum = Math.max(...Array.from(tubaTacet)) + 2;
    warn(warnings, `[brass] Tuba tacet for the intro; enters at measure ${entryNum}.`);
  }

  // Keep the upper voices ordered top-to-bottom (no crossings) at shared onsets.
  enforceBrassVoiceOrder(upperIds.map((bvId) => partByVoice.get(bvId)!), upperIds);

  warn(warnings, `[brass] Faithful copy: RH chord→${upperIds.map((b) => BRASS_PART_META[b].name).join("/")}, LH→Trombone/Tuba; voices rest where the piano rests.`);

  return {
    ...(score as any),
    meta: { ...(score.meta ?? {}), ensemble: "brass_ensemble" },
    parts: brassParts,
  } as ScoreModel;
}
