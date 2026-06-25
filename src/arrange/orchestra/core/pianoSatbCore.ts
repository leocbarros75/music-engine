import type { ScoreModel } from "../../../score/types";
import {
  getInstrumentSpec,
  midiToPitch,
  pitchToMidi
} from "../../../instruments/instrumentCatalog";

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

// ── SA/TB Choral format detection ────────────────────────────────────────────
// Handles scores where SA voices share one treble staff and TB voices share
// one bass staff, with top/bottom notes at each onset representing each voice.
type SaTbParts = { sa: PartLike; tb: PartLike };

function findSaTbParts(score: ScoreModel): SaTbParts | null {
  const parts = (score.parts ?? []) as PartLike[];
  if (parts.length < 2) return null;

  // 1. Explicit name detection — common SA/TB naming conventions
  const matchesAny = (p: any, keywords: string[]) =>
    keywords.some(k => String(p?.name ?? "").toLowerCase().includes(k));

  const saByName = parts.find(p =>
    matchesAny(p, ["sa", "s/a", "sop/alt", "soprano/alto", "treble", "women", "upper"])
  ) ?? null;
  const tbByName = parts.find(p =>
    matchesAny(p, ["tb", "t/b", "ten/bas", "tenor/bass", "men", "lower"]) &&
    p !== saByName
  ) ?? null;
  if (saByName && tbByName) return { sa: saByName, tb: tbByName };

  // 2. Fallback: exactly 2 non-piano parts where at least one has chord notes
  //    (≥2 notes at the same onset — typical SA/TB piano-reduction format)
  if (parts.length === 2) {
    const hasChordNotes = (p: PartLike) =>
      (p?.measures ?? []).some((m: any) => {
        const notes = (m?.events ?? []).filter((e: any) => e?.type === "note");
        const onsets = new Map<string, number>();
        for (const n of notes) {
          const k = onsetKey(Number(n?.t));
          onsets.set(k, (onsets.get(k) ?? 0) + 1);
        }
        return [...onsets.values()].some(v => v >= 2);
      });
    if (hasChordNotes(parts[0]) || hasChordNotes(parts[1])) {
      return { sa: parts[0], tb: parts[1] };
    }
  }

  return null;
}

/**
 * Copy one SA or TB choral part into two string parts (straight pitch-split).
 * At each onset:
 *   - 1 note  : both top and bottom parts receive it (unison)
 *   - 2 notes : top → topPart; bottom → bottomPart
 *   - 3+ notes: top → topPart; bottom + inner notes (as chord additions) → bottomPart
 * No transposition or range clamping — "copy as-is" per user requirement.
 */
function splitChoralPartToStringPair(
  srcMeasures: MeasureLike[],
  topPart: PartLike,
  bottomPart: PartLike
): void {
  for (let mi = 0; mi < srcMeasures.length; mi++) {
    const srcMeasure = srcMeasures[mi] ?? {};
    const srcEvents = (srcMeasure.events ?? []).filter((e: any) => e?.type === "note");
    const topM = topPart.measures[mi];
    const botM = bottomPart.measures[mi];
    if (!topM || !botM) continue;

    // Group by onset
    const byOnset = new Map<string, EventLike[]>();
    for (const ev of srcEvents) {
      const t = Number(ev?.t);
      if (!Number.isFinite(t)) continue;
      const key = onsetKey(t);
      const bucket = byOnset.get(key) ?? [];
      bucket.push(ev);
      byOnset.set(key, bucket);
    }

    // Process onsets in time order
    const sortedOnsets = [...byOnset.entries()].sort(
      (a, b) => parseFloat(a[0]) - parseFloat(b[0])
    );

    for (const [, events] of sortedOnsets) {
      // Sort notes high→low by MIDI pitch
      const sorted = events
        .map(ev => ({ ev, midi: eventMidi(ev) }))
        .filter((x): x is { ev: EventLike; midi: number } => x.midi !== null)
        .sort((a, b) => b.midi - a.midi);

      if (sorted.length === 0) continue;

      const topNote = sorted[0]!;
      const botNote = sorted[sorted.length - 1]!;

      // Top note → top part (straight copy, voice 1, staff 1)
      const topEv = { ...clone(topNote.ev), voice: 1, staff: 1 };
      topM.events.push(topEv);

      if (sorted.length === 1) {
        // Single note: both parts play it
        botM.events.push({ ...clone(topNote.ev), voice: 1, staff: 1 });
      } else {
        // Bottom note → bottom part
        const botEv = { ...clone(botNote.ev), voice: 1, staff: 1 };
        botM.events.push(botEv);

        // Any inner notes → chord additions on bottom part
        for (let i = sorted.length - 2; i >= 1; i--) {
          const innerEv = { ...clone(sorted[i]!.ev), voice: 1, staff: 1, chord: true };
          botM.events.push(innerEv);
        }
      }
    }
  }
}

/** Build a new empty part whose measure structure (number, attributes) mirrors src. */
function makePartFromSource(
  partId: string,
  name: string,
  instrument: string,
  srcMeasures: MeasureLike[]
): PartLike {
  return {
    part_id: partId,
    name,
    instrument,
    staves: 1,
    measures: srcMeasures.map((m, i) => ({
      number: Number(m?.number ?? i + 1),
      ...(m?.attributes ? { attributes: clone(m.attributes) } : {}),
      events: [] as EventLike[]
    }))
  };
}

/** Arrange SA/TB choral score → string quartet: SA top→V1, SA bottom→V2, TB top→VA, TB bottom→VC. */
function arrangeSaTbChoralToStringQuartet(
  score: ScoreModel,
  choralParts: SaTbParts,
  options: ArrangeOptions
): ScoreModel {
  const { sa, tb } = choralParts;
  const saMeasures = (sa?.measures ?? []) as MeasureLike[];
  const tbMeasures = (tb?.measures ?? []) as MeasureLike[];

  const violin1 = makePartFromSource("P_V1", "Violin I",  "violin_1", saMeasures);
  const violin2 = makePartFromSource("P_V2", "Violin II", "violin_2", saMeasures);
  const viola   = makePartFromSource("P_VA", "Viola",     "viola",    tbMeasures);
  const cello   = makePartFromSource("P_VC", "Cello",     "cello",    tbMeasures);

  splitChoralPartToStringPair(saMeasures, violin1, violin2);
  splitChoralPartToStringPair(tbMeasures, viola,   cello);

  warn(
    options.warnings,
    "[strings] SA/TB choral copy applied: SA high→Violin I, SA low→Violin II, TB high→Viola, TB low→Cello."
  );

  return {
    ...(score as any),
    meta: { ...(score as any).meta, ensemble: "satb_string_quartet" },
    parts: [violin1, violin2, viola, cello],
  } as ScoreModel;
}

/**
 * Dedicated SATB → String Quartet copy.
 * Handles three input formats automatically:
 *   1. SA/TB choral (2 parts with chord notes): SA top→V1, SA bottom→V2, TB top→VA, TB bottom→VC
 *   2. Four separate parts (Soprano/Alto/Tenor/Bass): direct clone S→V1, A→V2, T→VA, B→VC
 * Straight copy — no transposition, no arrangement.
 * Exported for the "satb_string_quartet" ensemble.
 */
export function arrangeSatbToStringQuartetDirect(
  score: any,
  options: ArrangeOptions = {}
): any {
  // Priority 1: SA/TB choral format (2 parts with top/bottom voices as chord notes)
  const saTb = findSaTbParts(score as ScoreModel);
  if (saTb) return arrangeSaTbChoralToStringQuartet(score as ScoreModel, saTb, options);

  // Priority 2: four separate SATB parts
  const satb = findSatbParts(score as ScoreModel);
  if (satb) return arrangeSatbToStringQuartet(score as ScoreModel, satb, options);

  warn(options.warnings, "[strings] SATB → String Quartet: no SATB or SA/TB parts found; returning original score.");
  return score;
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

// ── Chord inference & harmonic fill helpers ───────────────────────────────────

/** Triad / seventh-chord templates: intervals (semitones) above the root. */
const CHORD_SHAPES = [
  { pcs: [0, 4, 7]  },   // major triad
  { pcs: [0, 3, 7]  },   // minor triad
  { pcs: [0, 4, 7, 10] }, // dominant 7th
  { pcs: [0, 4, 7, 11] }, // major 7th
  { pcs: [0, 3, 7, 10] }, // minor 7th
  { pcs: [0, 3, 6]  },   // diminished triad
  { pcs: [0, 3, 6, 9]  }, // diminished 7th
  { pcs: [0, 4, 8]  },   // augmented
  { pcs: [0, 5, 7]  },   // sus4
  { pcs: [0, 2, 7]  },   // sus2
];

type ChordCandidate = { rootPc: number; pcs: number[] };

/**
 * Infer the best-matching triad/7th chord from a set of MIDI pitches.
 * Returns `null` when fewer than 2 distinct pitch-classes are given.
 * Scoring: +10 per present PC that belongs to the chord, −5 per present PC
 * that does NOT belong, −0.5 per chord tone (prefers triads over 7ths).
 */
function inferChordFromNotes(midis: number[]): ChordCandidate | null {
  if (midis.length < 2) return null;
  const presentPcs = new Set(midis.map(m => ((m % 12) + 12) % 12));
  if (presentPcs.size < 2) return null;

  let bestScore = -Infinity;
  let best: ChordCandidate | null = null;

  for (let root = 0; root < 12; root++) {
    for (const shape of CHORD_SHAPES) {
      const chordPcs = shape.pcs.map(i => (root + i) % 12);
      const hits      = chordPcs.filter(pc => presentPcs.has(pc)).length;
      const misses    = [...presentPcs].filter(pc => !chordPcs.includes(pc)).length;
      const score     = hits * 10 - misses * 5 - shape.pcs.length * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = { rootPc: root, pcs: chordPcs };
      }
    }
  }
  return best;
}

/**
 * Given a set of already-present pitch-classes and an inferred chord, find
 * the MIDI of the most important *missing* chord tone in [rangeMin, rangeMax].
 *
 * Priority order: 3rd (defines major/minor quality) → 5th → root → 7th.
 * Returns `null` when all chord tones are present or none fit in range.
 */
function findMissingChordTone(
  presentPcs: Set<number>,
  chord: ChordCandidate,
  rangeMin: number,
  rangeMax: number
): number | null {
  const missing = chord.pcs.filter(pc => !presentPcs.has(pc));
  if (missing.length === 0) return null;

  // Index priority: 3rd(1) → 5th(2) → root(0) → 7th(3)
  const priority = [1, 2, 0, 3];
  let targetPc: number | null = null;
  for (const idx of priority) {
    const pc = chord.pcs[idx];
    if (pc !== undefined && missing.includes(pc)) { targetPc = pc; break; }
  }
  if (targetPc === null) targetPc = missing[0]!;

  // Place targetPc in range
  let midi = 12 + targetPc;
  while (midi < rangeMin) midi += 12;
  while (midi > rangeMax) midi -= 12;
  return (midi >= rangeMin && midi <= rangeMax) ? midi : null;
}

/**
 * Expand a single fill pitch into a sequence of notes that mirrors the
 * rhythmic pulse of a "donor" voice already placed in the measure.
 *
 * Algorithm:
 *   1. Collect the unique onset times (quantised to 1/64 beat) of donor note
 *      events that fall within [fillOnset, fillOnset + fillDur).
 *   2. Ensure the fill-onset itself appears as the first entry.
 *   3. Produce one sub-note per unique onset; each sub-note lasts until the
 *      next onset (or the end of the fill window).
 *   4. If 0 or 1 donor subdivisions exist, return a single note — no change
 *      to the current behaviour for already-simple textures.
 *
 * This gives fill voices the same rhythmic energy as their companion without
 * duplicating pitches — Violin II follows Violin I's rhythm, Viola follows
 * the most-active companion (Violin I if busier than Cello, else Cello).
 */
function buildRhythmInheritedFill(
  fillMidi: number,
  donorEvents: EventLike[],
  fillOnset: number,
  fillDur: number,
  instrumentId: string
): Array<{ t: number; dur: number; midi: number; pitch: any }> {
  const eps  = 1e-6;
  const end  = fillOnset + fillDur;
  const clamped = clampMidiToAbsoluteRange(fillMidi, instrumentId);
  const pitch   = midiToPitch(clamped);

  // Unique donor onset times within the fill window
  const rawTimes = donorEvents
    .filter(ev => ev.type === "note" && !(ev as any).isRest)
    .map(ev => Number(ev.t))
    .filter(t => t >= fillOnset - eps && t < end - eps);
  const grid = 64; // 1/64 beat quantisation
  const uniqueTimes = [
    ...new Set(rawTimes.map(t => Math.round(t * grid) / grid))
  ].sort((a, b) => a - b);

  // Always include fill onset as the first attack
  if (uniqueTimes.length === 0 || uniqueTimes[0]! > fillOnset + eps) {
    uniqueTimes.unshift(Math.round(fillOnset * grid) / grid);
  }

  if (uniqueTimes.length <= 1) {
    // No useful subdivision — single note
    return [{ t: fillOnset, dur: fillDur, midi: clamped, pitch }];
  }

  return uniqueTimes.map((t, i) => {
    const nextT = i + 1 < uniqueTimes.length ? uniqueTimes[i + 1]! : end;
    const dur   = Math.max(nextT - t, eps * 10);
    return { t, dur, midi: clamped, pitch };
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

    // ── Two-phase routing ─────────────────────────────────────────────────────
    //
    // Phase 1 — map explicit piano notes:
    //   V1  ← top  RH note at every onset
    //   V2  ← bottom RH note when 2+ notes; inner notes as chord additions
    //   VC  ← bottom LH note at every onset
    //   VA  ← 2nd LH note when 2+ notes; extra LH notes as chord additions
    //   Single-note onsets queue a "fill request" instead of pushing immediately.
    //
    // Phase 2 — chord-aware fills with rhythm inheritance:
    //   Collect all placed MIDIs across V1/V2/VC at each fill onset.
    //   Infer the implied chord; find the most important MISSING chord tone
    //   (3rd → 5th → root priority) in the target voice's comfortable range.
    //   Subdivide the fill into sub-notes that mirror the companion voice's
    //   rhythmic pulse (V1 donors V2 fills; V1-or-VC donors VA fills).
    //   Falls back to the old diatonic-3rd heuristic when chord inference fails.

    // Tracking maps for cross-voice chord inference (Phase 2)
    type PlacedInfo = { midi: number; t: number; dur: number };
    const v1AtOnset = new Map<string, PlacedInfo>();
    const v2AtOnset = new Map<string, { midi: number }>();
    const vcAtOnset = new Map<string, PlacedInfo>();

    // Fill queues
    type FillReq = { t: number; dur: number; anchorMidi: number };
    const v2Fills = new Map<string, FillReq>(); // onset-key → V1 anchor info
    const vaFills = new Map<string, FillReq>(); // onset-key → VC anchor info

    // ── Phase 1: map explicit notes ──────────────────────────────────────────

    // RH → V1 (always) + V2 (when 2+ notes; else queue fill)
    for (const key of Array.from(rhByOnset.keys()).sort()) {
      const selected = selectNotesForOnset(rhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const top    = selected[selected.length - 1]!;
      const bottom = selected[0]!;

      pushMappedNote(v1m, top, "violin_1", "v1", ++seq);
      v1AtOnset.set(key, {
        midi: clampMidiToAbsoluteRange(top.midi, "violin_1"),
        t:   Number(top.ev?.t   ?? 0),
        dur: Number(top.ev?.dur ?? 1),
      });

      if (selected.length >= 3) {
        pushMappedNote(v2m, bottom, "violin_2", "v2-lo", ++seq);
        v2AtOnset.set(key, { midi: clampMidiToAbsoluteRange(bottom.midi, "violin_2") });
        for (let i = 1; i <= selected.length - 2; i++) {
          pushMappedNote(v2m, selected[i]!, "violin_2", "v2-inner", ++seq, { chord: true });
        }
      } else if (selected.length === 2) {
        pushMappedNote(v2m, bottom, "violin_2", "v2", ++seq);
        v2AtOnset.set(key, { midi: clampMidiToAbsoluteRange(bottom.midi, "violin_2") });
      } else {
        // Single RH note → queue chord-aware V2 fill
        v2Fills.set(key, {
          t:           Number(top.ev?.t   ?? 0),
          dur:         Number(top.ev?.dur ?? 1),
          anchorMidi:  clampMidiToAbsoluteRange(top.midi, "violin_1"),
        });
      }
    }

    // LH → VC (always) + VA (when 2+ notes; else queue fill)
    for (const key of Array.from(lhByOnset.keys()).sort()) {
      const selected = selectNotesForOnset(lhByOnset.get(key) ?? []);
      if (!selected.length) continue;
      const bottom = selected[0]!;

      pushMappedNote(vcm, bottom, "cello", "vc", ++seq);
      vcAtOnset.set(key, {
        midi: clampMidiToAbsoluteRange(bottom.midi, "cello"),
        t:   Number(bottom.ev?.t   ?? 0),
        dur: Number(bottom.ev?.dur ?? 1),
      });

      if (selected.length >= 2) {
        pushMappedNote(vam, selected[1]!, "viola", "va", ++seq);
        for (let i = 2; i < selected.length; i++) {
          pushMappedNote(vam, selected[i]!, "viola", "va-extra", ++seq, { chord: true });
        }
      } else {
        // Single LH note → queue chord-aware VA fill
        vaFills.set(key, {
          t:           Number(bottom.ev?.t   ?? 0),
          dur:         Number(bottom.ev?.dur ?? 1),
          anchorMidi:  clampMidiToAbsoluteRange(bottom.midi, "cello"),
        });
      }
    }

    // ── Phase 2: chord-aware fills with rhythm inheritance ───────────────────

    // Comfortable ranges for fill voices
    const V2_MIN = 55, V2_MAX = 84; // G3–C6  (Violin II)
    const VA_MIN = 48, VA_MAX = 81; // C3–A5  (Viola)

    // V2 fills — Violin II inherits rhythm from Violin I
    for (const [key, { t: fillT, dur: fillDur, anchorMidi: v1Midi }] of v2Fills) {
      const allMidis: number[] = [v1Midi];
      const vcInfo = vcAtOnset.get(key);
      if (vcInfo) allMidis.push(vcInfo.midi);

      const presentPcs = new Set(allMidis.map(m => ((m % 12) + 12) % 12));
      const chord      = allMidis.length >= 2 ? inferChordFromNotes(allMidis) : null;

      let fillMidi: number;
      if (chord) {
        fillMidi = findMissingChordTone(presentPcs, chord, V2_MIN, V2_MAX)
          ?? diatonicStepsBelow(v1Midi, 2, currentKeyFifths);
      } else {
        fillMidi = diatonicStepsBelow(v1Midi, 2, currentKeyFifths);
      }

      if (fillMidi === v1Midi) continue; // avoid unison with V1

      // Rhythm donor: V1 events within the fill window
      const donorV1 = v1m.events.filter(ev =>
        ev.type === "note" && !(ev as any).isRest &&
        Number(ev.t) >= fillT - 1e-6 && Number(ev.t) < fillT + fillDur - 1e-6
      );
      const subNotes = buildRhythmInheritedFill(fillMidi, donorV1, fillT, fillDur, "violin_2");
      for (let sni = 0; sni < subNotes.length; sni++) {
        const n = subNotes[sni]!;
        v2m.events.push({
          id: `v2-fill-${mi}-${key}-${sni}`,
          t: n.t, dur: n.dur, type: "note", pitch: n.pitch, voice: 1, staff: 1,
        });
        seq++;
      }
    }

    // VA fills — Viola inherits rhythm from whichever companion is busier
    for (const [key, { t: fillT, dur: fillDur, anchorMidi: vcMidi }] of vaFills) {
      const allMidis: number[] = [vcMidi];
      const v1Info = v1AtOnset.get(key);
      if (v1Info) allMidis.push(v1Info.midi);
      const v2Info = v2AtOnset.get(key);
      if (v2Info) allMidis.push(v2Info.midi);
      // Also grab any V2 fills placed in Phase 2 at this onset
      for (const ev of v2m.events) {
        if (ev.type === "note" && !(ev as any).isRest && Math.abs(Number(ev.t) - fillT) < 1e-6) {
          const m = eventMidi(ev);
          if (typeof m === "number") allMidis.push(m);
        }
      }

      const presentPcs = new Set(allMidis.map(m => ((m % 12) + 12) % 12));
      const chord      = allMidis.length >= 2 ? inferChordFromNotes(allMidis) : null;

      let fillMidi: number;
      if (chord) {
        const chordFill = findMissingChordTone(presentPcs, chord, VA_MIN, VA_MAX);
        if (chordFill !== null) {
          fillMidi = chordFill;
        } else {
          fillMidi = diatonicStepsAbove(vcMidi, 2, currentKeyFifths);
          while (fillMidi < VA_MIN) fillMidi += 12;
          while (fillMidi > VA_MAX) fillMidi -= 12;
        }
      } else {
        fillMidi = diatonicStepsAbove(vcMidi, 2, currentKeyFifths);
        while (fillMidi < VA_MIN) fillMidi += 12;
        while (fillMidi > VA_MAX) fillMidi -= 12;
      }

      if (fillMidi === vcMidi) continue; // avoid unison with VC

      // Rhythm donor: the Viola is an inner-harmony voice that moves with the
      // BASS/harmonic rhythm (Cello), not the busy melodic figuration of Violin I.
      // Inheriting the Cello keeps the viola calm and idiomatic (matches how real
      // quartet arrangements voice the inner part). Fall back to V1 only if the
      // cello is silent in this window.
      const inWindow = (evs: EventLike[]) =>
        evs.filter(ev =>
          ev.type === "note" && !(ev as any).isRest &&
          Number(ev.t) >= fillT - 1e-6 && Number(ev.t) < fillT + fillDur - 1e-6
        );
      const donorVC = inWindow(vcm.events);
      const donorV1 = inWindow(v1m.events);
      const donorEvents = donorVC.length ? donorVC : donorV1;

      const subNotes = buildRhythmInheritedFill(fillMidi, donorEvents, fillT, fillDur, "viola");
      for (let sni = 0; sni < subNotes.length; sni++) {
        const n = subNotes[sni]!;
        vam.events.push({
          id: `va-fill-${mi}-${key}-${sni}`,
          t: n.t, dur: n.dur, type: "note", pitch: n.pitch, voice: 1, staff: 1,
        });
        seq++;
      }
    }

    v1m.events.sort(measureEventSort);
    v2m.events.sort(measureEventSort);
    vam.events.sort(measureEventSort);
    vcm.events.sort(measureEventSort);
  }

  warn(
    warnings,
    "[strings] Instrumentation copy applied: V1=top-RH, V2=bottom-RH(+chord-fill), VA=upper-LH(+chord-fill), VC=bottom-LH. " +
    "Fill voices use chord inference (missing 3rd/5th priority) + rhythm inheritance from companion voice."
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
