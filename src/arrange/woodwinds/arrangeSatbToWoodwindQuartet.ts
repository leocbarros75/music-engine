// src/arrange/woodwinds/arrangeSatbToWoodwindQuartet.ts
//
// Choral-wind: direct transcription of a SATB score to woodwind quartet.
//
//   Soprano → Flute
//   Alto    → Oboe
//   Tenor   → Clarinet in Bb  (stored as concert/sounding pitch)
//   Bass    → Bassoon
//
// Notes are shifted by octave when outside an instrument's sounding range.
// The general MusicXML exporter handles written-pitch transposition for Bb
// clarinet (+2 semitones) automatically via getTransposeForInstrument.
//
// Input formats supported:
//   1. Four separate SATB parts (names contain soprano/alto/tenor/bass)
//   2. SA/TB choral format on two grand-staff parts (treble voice 1/2 = S/A,
//      bass voice 1/2 = T/B)
//   3. SATB on a single grand staff with 4 voices (piano-choral layout)
//   4. Any score with exactly 4 parts — treated as S/A/T/B in top-down order

import type { ScoreModel } from "../../score/types";
import { midiToPitch, pitchToMidi, getInstrumentSpec } from "../../instruments/instrumentCatalog";

type PartLike  = any;
type EventLike = any;

function warn(warnings: string[] | undefined, msg: string): void {
  warnings?.push(msg);
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function eventMidi(ev: EventLike): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) { try { return pitchToMidi(ev.pitch); } catch { return null; } }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Range clamping — octave shift into instrument's absolute sounding range
// ─────────────────────────────────────────────────────────────────────────────

function clampByOctave(midi: number, instrId: string): number {
  const spec = getInstrumentSpec(instrId);
  if (!spec) return midi;
  const lo = Number((spec as any).midi_low);
  const hi = Number((spec as any).midi_high);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return midi;
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  if (m < lo) m = lo;
  if (m > hi) m = hi;
  return m;
}

function clampPartToRange(part: PartLike, instrId: string): void {
  for (const m of part.measures ?? []) {
    for (const ev of m.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = eventMidi(ev);
      if (midi === null) continue;
      const clamped = clampByOctave(midi, instrId);
      if (clamped !== midi) {
        ev.midi  = clamped;
        ev.pitch = midiToPitch(clamped);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SATB part-finders
// ─────────────────────────────────────────────────────────────────────────────

type SatbParts = { soprano: PartLike; alto: PartLike; tenor: PartLike; bass: PartLike };

function findSatbParts(score: ScoreModel): SatbParts | null {
  const parts = score.parts ?? [];
  const find = (...kws: string[]) =>
    parts.find((p: any) => kws.some(k => String(p?.name ?? "").toLowerCase().includes(k))) ?? null;

  const soprano = find("soprano", "sop", "s ");
  const alto    = find("alto", "alt", "a ");
  const tenor   = find("tenor", "ten", "t ");
  const bass    = find("bass", "bas", "b ");

  if (soprano && alto && tenor && bass) return { soprano, alto, tenor, bass };

  // Fallback: exactly 4 parts → treat as SATB top-down
  if (parts.length === 4) {
    return { soprano: parts[0], alto: parts[1], tenor: parts[2], bass: parts[3] };
  }
  return null;
}

type SaTbParts = { sa: PartLike; tb: PartLike };  // 2-part choral format

function findSaTbParts(score: ScoreModel): SaTbParts | null {
  const parts = score.parts ?? [];
  if (parts.length !== 2) return null;
  const names = parts.map((p: any) => String(p?.name ?? "").toLowerCase());
  const hasSA = names.some(n => n.includes("soprano") || n.includes("treble") || n.includes("sa"));
  const hasTB = names.some(n => n.includes("tenor") || n.includes("bass") || n.includes("tb"));
  if (hasSA && hasTB) {
    const sa = parts.find((p: any) => {
      const n = String(p?.name ?? "").toLowerCase();
      return n.includes("soprano") || n.includes("treble") || n.includes("sa");
    })!;
    const tb = parts.find((p: any) => p !== sa)!;
    return { sa, tb };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Grand-staff single-part SATB (piano-choral layout, 4 voices)
// ─────────────────────────────────────────────────────────────────────────────

function splitGrandStaffSatb(pianoLikePart: PartLike): SatbParts {
  // Grand-staff SATB is usually engraved as CHORD STACKS, not 4 separate voices:
  //   Treble staff = a chord {Soprano(top), Alto(bottom)} at each onset
  //   Bass   staff = a chord {Tenor(top),  Bass(bottom)}  at each onset
  // (Some publishers add occasional divisi via extra voices — those notes are
  //  merged into the same staff's onset group before splitting by pitch.)
  //
  // So we group every note by (staff, onset-time), then assign:
  //   treble onset → highest pitch = Soprano, lowest = Alto
  //   bass   onset → highest pitch = Tenor,   lowest = Bass
  const makeSplitPart = (id: string) => ({
    part_id: id, name: id, instrument: id, staves: 1,
    measures: (pianoLikePart.measures ?? []).map((m: any) => ({
      number: m.number,
      attributes: m.attributes ? clone(m.attributes) : undefined,
      events: [] as any[],
    })),
  });

  const sop = makeSplitPart("split_s");
  const alt = makeSplitPart("split_a");
  const ten = makeSplitPart("split_t");
  const bas = makeSplitPart("split_b");

  for (let mi = 0; mi < (pianoLikePart.measures ?? []).length; mi++) {
    const m = pianoLikePart.measures[mi];

    // Group notes by staff and onset time
    const trebleByT = new Map<number, EventLike[]>();
    const bassByT   = new Map<number, EventLike[]>();
    for (const ev of (m?.events ?? [])) {
      if (ev.type !== "note") continue;
      const staff = Number(ev.staff ?? 1);
      const t = Math.round(Number(ev.t ?? 0) * 1000) / 1000;
      const map = staff === 2 ? bassByT : trebleByT;
      const bucket = map.get(t) ?? [];
      bucket.push(ev);
      map.set(t, bucket);
    }

    const assignTopBottom = (
      byT: Map<number, EventLike[]>,
      topPart: PartLike,
      bottomPart: PartLike
    ) => {
      for (const [, group] of byT) {
        const sorted = group
          .map(ev => ({ ev, midi: eventMidi(ev) }))
          .filter(x => x.midi !== null)
          .sort((a, b) => (a.midi! - b.midi!));
        if (!sorted.length) continue;
        const top = sorted[sorted.length - 1]!.ev;
        const bottom = sorted[0]!.ev;
        topPart.measures[mi]?.events.push(clone(top));
        // When only one note sounds, both voices double it
        bottomPart.measures[mi]?.events.push(clone(bottom));
      }
    };

    assignTopBottom(trebleByT, sop, alt);
    assignTopBottom(bassByT,   ten, bas);

    // Keep events time-ordered
    for (const part of [sop, alt, ten, bas]) {
      part.measures[mi]?.events.sort(
        (a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0)
      );
    }
  }
  return { soprano: sop, alto: alt, tenor: ten, bass: bas };
}

// ─────────────────────────────────────────────────────────────────────────────
// SA/TB two-part split: voice 1 → top, voice 2 → bottom
// ─────────────────────────────────────────────────────────────────────────────

function splitTwoPart(part: PartLike): { top: PartLike; bottom: PartLike } {
  const top = { ...clone(part), measures: [] as any[] };
  const bot = { ...clone(part), measures: [] as any[] };
  for (const m of part.measures ?? []) {
    const topM = { number: m.number, attributes: m.attributes ? clone(m.attributes) : undefined, events: [] as any[] };
    const botM = { number: m.number, attributes: m.attributes ? clone(m.attributes) : undefined, events: [] as any[] };
    for (const ev of (m.events ?? [])) {
      if (ev.type !== "note") continue;
      const v = Number(ev.voice ?? 1);
      if (v <= 1) topM.events.push(clone(ev));
      else        botM.events.push(clone(ev));
    }
    // If only one voice present, copy to both
    if (!topM.events.length && !botM.events.length) continue;
    if (!topM.events.length) topM.events.push(...botM.events.map(clone));
    if (!botM.events.length) botM.events.push(...topM.events.map(clone));
    top.measures.push(topM);
    bot.measures.push(botM);
  }
  return { top, bottom: bot };
}

// ─────────────────────────────────────────────────────────────────────────────
// Finalise: clone a source part and rename it as a woodwind instrument
// ─────────────────────────────────────────────────────────────────────────────

function makeWoodwindPart(
  src: PartLike,
  partId: string,
  name: string,
  instrument: string
): PartLike {
  const p = clone(src);
  p.part_id    = partId;
  p.name       = name;
  p.instrument = instrument;
  p.staves     = 1;
  return p;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────

export type SatbToWoodwindOptions = { warnings?: string[] };

/**
 * Transcribe a SATB choral score to woodwind quartet.
 * Soprano → Flute, Alto → Oboe, Tenor → Clarinet in Bb, Bass → Bassoon.
 * Notes outside each instrument's sounding range are shifted by octave.
 */
export function arrangeSatbToWoodwindQuartetDirect(
  score: ScoreModel,
  options: SatbToWoodwindOptions = {}
): ScoreModel {
  const { warnings } = options;

  // ── Detect input format and extract SATB parts ───────────────────────────

  let satb: SatbParts | null = null;

  // Priority 1: four separate named SATB parts or 4-part score
  satb = findSatbParts(score);

  // Priority 2: SA/TB two-part choral format
  if (!satb) {
    const saTb = findSaTbParts(score);
    if (saTb) {
      const { top: s, bottom: a } = splitTwoPart(saTb.sa);
      const { top: t, bottom: b } = splitTwoPart(saTb.tb);
      satb = { soprano: s, alto: a, tenor: t, bass: b };
    }
  }

  // Priority 3: single grand-staff part (piano-choral layout)
  if (!satb) {
    const grandPart = (score.parts ?? []).find((p: any) =>
      Number(p?.staves ?? 1) >= 2 ||
      (p.measures ?? []).some((m: any) =>
        (m.events ?? []).some((ev: any) => Number(ev?.staff) === 2)
      )
    );
    if (grandPart) satb = splitGrandStaffSatb(grandPart);
  }

  if (!satb) {
    warn(warnings, "[woodwinds] Choral-wind: no SATB parts found; returning original score.");
    return score;
  }

  // ── Build woodwind parts ─────────────────────────────────────────────────

  const flute    = makeWoodwindPart(satb.soprano, "P_FL", "Flute",          "flute");
  const oboe     = makeWoodwindPart(satb.alto,    "P_OB", "Oboe",           "oboe");
  const clarinet = makeWoodwindPart(satb.tenor,   "P_CL", "Clarinet in Bb", "clarinet_bb");
  const bassoon  = makeWoodwindPart(satb.bass,    "P_BN", "Bassoon",        "bassoon");

  // ── Clamp notes to each instrument's sounding range ─────────────────────
  clampPartToRange(flute,    "flute");
  clampPartToRange(oboe,     "oboe");
  clampPartToRange(clarinet, "clarinet_bb");
  clampPartToRange(bassoon,  "bassoon");

  warn(
    warnings,
    "[woodwinds] Choral-wind: Soprano→Flute, Alto→Oboe, Tenor→Clarinet, Bass→Bassoon."
  );

  return {
    ...(score as any),
    meta:  { ...(score as any).meta, ensemble: "woodwind_ensemble" },
    parts: [flute, oboe, clarinet, bassoon],
  } as ScoreModel;
}
