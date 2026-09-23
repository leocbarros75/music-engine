import type { ScoreModel } from "../score/types";
import { getInstrumentSpec, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { arrangeStringQuartetFromPianoInstrumentation } from "./arrangeStringQuartetFromPianoInstrumentation";
import { WOODWIND_RANGES, type WoodwindVoiceId } from "./woodwinds/woodwindRanges";
import { resolveTies } from "./tieResolution";
import { collapseToSinglePlayer } from "./divisi";

/**
 * Place a pitch in a woodwind's sweet-spot register by octave. Keeps the pitch
 * class exactly (harmony preserved); only shifts octaves so each instrument
 * sounds in its idiomatic register — lifting a low piano melody into the flute's
 * bright octave, and keeping voices ordered top-to-bottom (Fl>Ob>Cl>Bn).
 */
function clampToWoodwindSweetSpot(
  midi: number,
  wvId: WoodwindVoiceId,
  options?: { keepOctave?: boolean }
): number {
  const r = WOODWIND_RANGES[wvId];
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  // Some material belongs where it was written even though the sweet spot
  // would pull it elsewhere. Range is still enforced above; only the
  // preference is waived.
  if (options?.keepOctave) return m;
  const mid = (r.prefMin + r.prefMax) / 2;
  // Up is not the same as down. A note under the preferred floor is weak or
  // unspeakable there — the flute's bottom fourth is breathy, and lifting it
  // is a real improvement — so that branch is unconditional.
  if (m < r.prefMin) { const up = m + 12; if (up <= r.absMax && Math.abs(up - mid) <= Math.abs(m - mid)) m = up; }
  // Downward, the preferred ceiling is a p90 of real writing, not a limit: a
  // tenth of the notes in the scores it was measured from already sit above
  // it. Dropping a line a whole octave to save a semitone or two of that is
  // not a register choice, it is losing the top of the phrase — and it
  // inverts the texture, putting a right-hand melody under the left hand and
  // dragging the lower voices down after it through the de-crossing pass.
  // Bar 33 of the reference did exactly that: a melody on F#6, two semitones
  // over the flute's ceiling, came out an octave down at F#5.
  if (m > r.prefMax && m - r.prefMax > FOLD_SLACK_SEMITONES) {
    const dn = m - 12;
    if (dn >= r.absMin && Math.abs(dn - mid) <= Math.abs(m - mid)) m = dn;
  }
  return m;
}

/**
 * How far above its preferred ceiling a note may sit before it is worth moving
 * an octave: a major third. Measured against the p10-p90 working ranges taken
 * from three real wind scores, this is the value at which the oboe's own p90
 * comes back to 79 against a target of 81, with no other voice moving away
 * from its target.
 */
const FOLD_SLACK_SEMITONES = 4;

/**
 * Does this left-hand group actually contain bass?
 *
 * A left-hand staff is not a bass clef by another name. Where the piano's left
 * hand climbs into treble register it is playing an inner or accompanying
 * line, and the passage has no bass at all — bars 33-38 of the reference, and
 * the same material returning at 65-70, 97-102 and 104-109, put the whole left
 * hand at B3 and above.
 *
 * Treating it as bass anyway is what the sweet-spot fold did: 124 onsets
 * across 24 bars were pulled down a full octave, so an inner figure on B3 and
 * D4 came out of the bassoon as B2. That is not a register choice, it is a
 * different musical function.
 *
 * The bassoon can play those notes where they stand — the reference's
 * treble-hand material spans B3 to C5, inside the instrument's range and in
 * the tenor register it sings in. So nothing moves to another instrument and
 * nothing is dropped; the fold simply does not apply when there is no bass to
 * put in the bass register.
 */
const TREBLE_HAND_FLOOR = 60; // C4

function handHasNoBass(midis: number[]): boolean {
  return midis.length > 0 && midis.every((m) => m >= TREBLE_HAND_FLOOR);
}

type PartLike = any;
type MeasureLike = any;
type EventLike = any;

type ArrangeOptions = {
  warnings?: string[];
  /**
   * Bassoon entry rule (Piano→Wind copy). The bassoon (heaviest voice) rests
   * during the intro and enters when the texture builds:
   *   - number (1-based measure): bassoon rests before this measure (manual).
   *   - "auto" (default): rest the leading run of thin/quiet measures, then enter.
   *   - "always": bassoon plays the bass from the start (no intro rest).
   */
  bassoonEntry?: number | "auto" | "always";
};

/**
 * Decide which measures the bassoon should be tacet (intro rest).
 * Manual: explicit entry measure. Auto: the LEADING run of measures whose note
 * density is below 70% of the piece median (a thin intro), capped so we never
 * silence more than the first third of the piece.
 */
function computeBassoonTacet(
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

  // Auto: density per measure
  const dens = sourceMeasures.map((m: any) =>
    (m?.events ?? []).filter((e: any) => e?.type === "note" && !e.isRest).length
  );
  const sorted = [...dens].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  if (median <= 0) return tacet;
  const threshold = median * 0.7;
  const cap = Math.floor(n / 3); // never mute more than the first third
  for (let mi = 0; mi < n; mi++) {
    if (dens[mi]! < threshold && mi < cap) tacet.add(mi);
    else break; // only the LEADING run
  }
  return tacet;
}

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

const KEYBOARD_WORDS = ["piano", "pno", "keyboard", "keys", "accomp", "organ", "harpsichord"];

/** A grand staff gives itself away: its left hand writes staff 2. */
function partHasStaff2Notes(p: any): boolean {
  for (const m of p?.measures ?? []) {
    for (const ev of m?.events ?? []) {
      if (Number(ev?.staff) === 2) return true;
    }
  }
  return false;
}

/**
 * Find the piano in a score that may not say where it is.
 *
 * The last two tests are what make this work on real files. A score exported
 * without a <part-name> — which is common — has its name and instrument
 * defaulted to the part id, so every keyword test misses, and this arranger
 * fell through to the choral path without saying so. The string quartet has
 * had these two steps all along; winds never got them.
 */
function findPianoPart(score: ScoreModel): PartLike | null {
  const parts = score.parts ?? [];
  const named = (p: any, field: string) => {
    const s = String(p?.[field] ?? "").toLowerCase();
    return KEYBOARD_WORDS.some((k) => s.includes(k));
  };
  const byInstrument = parts.find((p: any) => named(p, "instrument"));
  if (byInstrument) return byInstrument;
  const byName = parts.find((p: any) => named(p, "name"));
  if (byName) return byName;
  const byStaves = parts.find((p: any) => Number(p?.staves ?? 1) >= 2);
  if (byStaves) return byStaves;
  const byStaff2 = parts.find((p: any) => partHasStaff2Notes(p));
  if (byStaff2) return byStaff2;
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
  options?: { t?: number; dur?: number; articulations?: string[] }
): void {
  const t = Number.isFinite(options?.t as number) ? Number(options?.t) : Number(source.ev?.t);
  const dur = Number.isFinite(options?.dur as number) ? Number(options?.dur) : Number(source.ev?.dur);
  if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) return;
  const clampedMidi = clampMidiToAbsoluteRange(source.midi, instrumentId);
  const tieStart = source.ev?.tieStart === true;
  const tieStop = source.ev?.tieStop === true;
  const articulations = options?.articulations?.length
    ? options.articulations
    : (Array.isArray(source.ev?.articulations) ? source.ev.articulations : undefined);
  targetMeasure.events.push({
    id: `${idPrefix}-${targetMeasure.number}-${seq}`,
    t,
    dur,
    type: "note",
    pitch: midiToPitch(clampedMidi),
    voice: 1,
    staff: 1,
    ...(articulations?.length ? { articulations: [...articulations] } : {}),
    ...(tieStart ? { tieStart: true } : {}),
    ...(tieStop ? { tieStop: true } : {})
  });
}

/**
 * The articulations of a chord, gathered from all of its notes.
 *
 * A piano engraver marks a chord once — the staccato dot or the accent goes on
 * one notehead of the stack, usually the bottom, and means the whole chord.
 * Splitting that chord across four instruments hands the mark to whichever
 * player happens to get that note and leaves the others playing the same attack
 * unmarked. Taking the union of the stack and giving it to every member is what
 * the piano notation already meant.
 */
function chordArticulations(events: EventLike[]): string[] {
  const marks = new Set<string>();
  for (const ev of events) {
    if (!Array.isArray(ev?.articulations)) continue;
    for (const a of ev.articulations) if (typeof a === "string") marks.add(a);
  }
  return [...marks];
}

/**
 * Clip each note in a voice where the next one begins.
 *
 * A wind plays one note at a time, and this path hands each of them a line
 * drawn from a keyboard texture that does not respect that. Bar 112 of the
 * reference gives the flute a four-beat pedal C AND the fourteen sixteenths
 * that decorate it, in one voice. MusicXML cannot write two notes at once on a
 * single staff line, so the exporter keeps the pedal and the whole figure
 * vanishes — silently, and with the bar still looking full.
 *
 * Clipping is the right resolution rather than dropping either: a player
 * covering both a held tone and a figure releases the held tone to speak the
 * figure, which is what this writes. Onsets and pitches are untouched; only a
 * note that was overrunning the next gets shortened.
 */
function clipOverlaps(events: EventLike[]): void {
  const notes = events
    .filter((e: any) => e?.type === "note" && Number.isFinite(Number(e?.t)))
    .sort((a: any, b: any) => Number(a.t) - Number(b.t));
  for (let i = 0; i < notes.length; i++) {
    const cur: any = notes[i];
    let next = i + 1;
    // Chord members share an onset; the clip is against the next onset, not a
    // sibling that starts at the same moment.
    while (next < notes.length && Math.abs(Number(notes[next]!.t) - Number(cur.t)) < 1e-9) next++;
    if (next >= notes.length) continue;
    const room = Number(notes[next]!.t) - Number(cur.t);
    if (Number(cur.dur) > room + 1e-9) cur.dur = room;
  }
}

/**
 * The right hand's third-from-top note at an onset — the clarinet's fallback
 * when the left hand has no tenor line to give it. Falls back in turn to the
 * second and then the only note, so the voice is never left silent under a
 * hand that is still sounding.
 */
function rhInnerAt(
  rhByOnset: Map<string, EventLike[]>,
  key: string
): { ev: EventLike; midi: number } | null {
  const sel = selectNotesForOnset(rhByOnset.get(key) ?? []);
  const n = sel.length;
  if (!n) return null;
  return sel[Math.max(0, n - 3)]!;
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
 * Two hands, two winds each. The clarinet had drifted onto the right hand as a
 * third copy of that chord, which left the bassoon alone underneath and threw
 * away every left-hand note but the lowest — 215 of this reference's 376 lost
 * notes came from that one cap. Where the left hand plays a single note there
 * is no tenor line to take, and doubling the bassoon in octaves is not
 * four-part writing either, so the clarinet returns to the right hand's third
 * note for those onsets.
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
    // The string arranger writes for SECTIONS — chord stacks, and divided
    // voices where a line and the figure over it coexist. One flute is not a
    // section. Reduce each part to the single line its player can hold.
    // The bassoon holds the bottom of its stack; the upper winds hold the top.
    const shed = collapseToSinglePlayer(remapped, (_p, i) =>
      WW_FROM_STRING[i]?.wvId === "bn" ? "bottom" : "top");
    if (shed) {
      warn(warnings, `[woodwinds] ${shed} divisi note${shed === 1 ? "" : "s"} dropped: the string arrangement divides its sections, and one wind player cannot.`);
    }
    enforceWoodwindVoiceOrder(remapped);
    const untiedChoral = resolveTies(remapped, pitchToMidi);
    if (untiedChoral) {
      warn(warnings, `[woodwinds] ${untiedChoral} tie${untiedChoral === 1 ? "" : "s"} left dangling by that reduction and became re-attacks.`);
    }
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

    // ── RH chord → Flute (top) / Oboe (2nd) ───────────────────────────────
    // Both upper winds play on every RH onset; where the hand has one note it
    // is reused so neither voice drops out. Flute lifts to its bright
    // register, Oboe is octave-placed into its sweet spot.
    //
    // The note is written at its own onset, not at the 1/64 key it was grouped
    // under: rounding a triplet's 2/3 of a beat onto that grid moves it, and a
    // moved note is a note the source no longer has.
    for (const k of Array.from(rhByOnset.keys()).sort()) {
      const sel = selectNotesForOnset(rhByOnset.get(k) ?? []); // ascending by midi
      if (!sel.length) continue;
      const n = sel.length;
      const onset = Number(sel[n - 1]!.ev?.t);
      const topEv = sel[n - 1]!;                        // highest → Flute
      const midEv = n >= 2 ? sel[n - 2]! : sel[n - 1]!; // 2nd     → Oboe
      const marks = chordArticulations(sel.map((s) => s.ev));
      pushMappedNote(flute.measures[mi], { ev: topEv.ev, midi: clampToWoodwindSweetSpot(topEv.midi, "fl") }, "flute", "fl", ++seq, { t: onset, articulations: marks });
      pushMappedNote(oboe.measures[mi],  { ev: midEv.ev, midi: clampToWoodwindSweetSpot(midEv.midi, "ob") }, "oboe",  "ob", ++seq, { t: onset, articulations: marks });
    }

    // ── LH → Clarinet (top) / Bassoon (bottom) ────────────────────────────
    // The clarinet takes the left hand's upper note — the keyboard's tenor
    // line, and the clarinet's own chalumeau register — rather than a third
    // copy of the right-hand chord. Three winds crowded onto one hand left the
    // bassoon alone under them and threw away every left-hand note but the
    // lowest; this reads as four parts instead.
    //
    // Where the left hand plays a single note the clarinet has no tenor to
    // take, and doubling the bassoon in octaves for whole stretches is not
    // four-part writing either. It goes back to the right hand's third note
    // there, which is what it had before.
    for (const k of Array.from(lhByOnset.keys()).sort()) {
      const sel = selectNotesForOnset(lhByOnset.get(k) ?? []);
      if (!sel.length) continue;
      const bottom = sel[0]!;
      const lhMarks = chordArticulations(sel.map((s) => s.ev));
      // A left hand up in treble register is an inner line, not a bass line.
      const noBass = handHasNoBass(sel.map((s) => s.midi));
      pushMappedNote(bassoon.measures[mi], { ev: bottom.ev, midi: clampToWoodwindSweetSpot(bottom.midi, "bn", { keepOctave: noBass }) }, "bassoon", "bn", ++seq, { t: Number(bottom.ev?.t), articulations: lhMarks });
      const tenor = sel.length >= 2 ? sel[sel.length - 1]! : rhInnerAt(rhByOnset, k);
      if (tenor) {
        const marks = sel.length >= 2 ? lhMarks : chordArticulations(rhByOnset.get(k) ?? []);
        pushMappedNote(clarinet.measures[mi], { ev: tenor.ev, midi: clampToWoodwindSweetSpot(tenor.midi, "cl", { keepOctave: noBass }) }, "clarinet_bb", "cl", ++seq, { t: Number(tenor.ev?.t), articulations: marks });
      }
    }

    // A right-hand onset the left hand does not share still needs the clarinet,
    // or it falls silent under the figuration the other two winds are playing.
    for (const k of Array.from(rhByOnset.keys()).sort()) {
      if (lhByOnset.has(k)) continue;
      const inner = rhInnerAt(rhByOnset, k);
      if (!inner) continue;
      pushMappedNote(clarinet.measures[mi], { ev: inner.ev, midi: clampToWoodwindSweetSpot(inner.midi, "cl") }, "clarinet_bb", "cl", ++seq,
        { t: Number(inner.ev?.t), articulations: chordArticulations(rhByOnset.get(k) ?? []) });
    }

    // One wind, one note at a time: release a held tone where the next attack
    // falls, rather than letting the export choose between them.
    for (const d of voiceDefs) clipOverlaps(d.part.measures[mi].events as any[]);

    for (const d of voiceDefs) (d.part.measures[mi].events as any[]).sort(measureEventSort);
  }

  const woodwindParts = voiceDefs.map((d) => d.part);

  // ── Bassoon entry rule: rest the intro, enter when the texture builds ────
  const bassoonTacet = computeBassoonTacet(sourceMeasures, options.bassoonEntry ?? "auto");
  if (bassoonTacet.size) {
    for (const mi of bassoonTacet) {
      const bm = bassoon.measures[mi];
      if (bm) bm.events = [];
    }
    const entryNum = Math.max(...Array.from(bassoonTacet)) + 2; // 1-based measure of entry
    warn(warnings, `[woodwinds] Bassoon tacet for the intro; enters at measure ${entryNum}.`);
  }

  // Keep voices ordered top-to-bottom (no crossings) at shared onsets.
  enforceWoodwindVoiceOrder(woodwindParts);

  // ── Sustained-gap fill ───────────────────────────────────────────────────
  // Only a voice that is SILENT for an entire measure (long gap) receives a
  // single sustained chord tone, drawn from the harmony of the other voices.
  // The bassoon's intentional intro-rest measures are skipped (kept tacet).
  fillSustainedGaps(woodwindParts, sourceMeasures, { bassoonTacet });

  // Last, so it judges what actually reached the page: the de-crossing pass
  // above moves octaves, and a tie between two different pitches is no more a
  // tie than one whose continuation was never written.
  const untied = resolveTies(woodwindParts, pitchToMidi);
  if (untied) {
    warn(warnings, untied === 1
      ? "[woodwinds] 1 tie could not follow its pitch into a single instrument and became a re-attack."
      : `[woodwinds] ${untied} ties could not follow their pitch into a single instrument and became re-attacks.`);
  }

  warn(warnings, "[woodwinds] Faithful copy: RH chord→Flute/Oboe, LH→Clarinet (tenor)/Bassoon (bass); voices rest where the piano rests.");

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
function fillSustainedGaps(
  parts: PartLike[],
  sourceMeasures: MeasureLike[],
  opts?: { bassoonTacet?: Set<number> }
): void {
  const wvIds: WoodwindVoiceId[] = ["fl", "ob", "cl", "bn"];
  const bassoonTacet = opts?.bassoonTacet ?? new Set<number>();
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
      // Bassoon (last voice) keeps its intentional intro-rest measures silent.
      if (wvIds[vi] === "bn" && bassoonTacet.has(mi)) continue;
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
