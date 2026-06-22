// src/arrange/brass/arrangeSatbToBrassQuartet.ts
//
// Choral-brass: direct transcription of a SATB score to brass quartet.
//
//   Soprano → Trumpet 1
//   Alto    → Trumpet 2
//   Tenor   → Trombone
//   Bass    → Tuba
//
// All pitches are stored CONCERT (sounding); the MusicXML exporter writes the
// written-pitch transposition for Bb trumpet (+2). Notes are shifted by octave
// when outside an instrument's sounding range.
//
// SATB is only four voices, so Choral-brass is always a QUARTET (no Horn) —
// matching the woodwind Choral path (Fl/Ob/Cl/Bn).
//
// Input formats supported (same as the woodwind choral path):
//   1. Four separate SATB parts (names contain soprano/alto/tenor/bass)
//   2. SA/TB choral format on two grand-staff parts
//   3. SATB on a single grand staff with chord stacks (piano-choral layout)
//   4. Any score with exactly 4 parts — treated as S/A/T/B in top-down order

import type { ScoreModel } from "../../score/types";
import { midiToPitch, pitchToMidi } from "../../instruments/instrumentCatalog";
import { BRASS_RANGES, BRASS_PART_META, type BrassVoiceId } from "./brassRanges";

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

// ── Range clamping — octave shift into a brass voice's ABSOLUTE sounding range ──
function clampByOctave(midi: number, bvId: BrassVoiceId): number {
  const r = BRASS_RANGES[bvId];
  let m = midi;
  while (m < r.absMin) m += 12;
  while (m > r.absMax) m -= 12;
  if (m < r.absMin) m = r.absMin;
  if (m > r.absMax) m = r.absMax;
  return m;
}

function clampPartToRange(part: PartLike, bvId: BrassVoiceId): void {
  for (const m of part.measures ?? []) {
    for (const ev of m.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = eventMidi(ev);
      if (midi === null) continue;
      const clamped = clampByOctave(midi, bvId);
      if (clamped !== midi) {
        ev.midi  = clamped;
        ev.pitch = midiToPitch(clamped);
      }
    }
  }
}

// ── SATB part-finders (identical strategy to the woodwind choral path) ──────

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

  if (parts.length === 4) {
    return { soprano: parts[0], alto: parts[1], tenor: parts[2], bass: parts[3] };
  }
  return null;
}

type SaTbParts = { sa: PartLike; tb: PartLike };

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

function splitGrandStaffSatb(pianoLikePart: PartLike): SatbParts {
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

    const assignTopBottom = (byT: Map<number, EventLike[]>, topPart: PartLike, bottomPart: PartLike) => {
      for (const [, group] of byT) {
        const sorted = group
          .map(ev => ({ ev, midi: eventMidi(ev) }))
          .filter(x => x.midi !== null)
          .sort((a, b) => (a.midi! - b.midi!));
        if (!sorted.length) continue;
        topPart.measures[mi]?.events.push(clone(sorted[sorted.length - 1]!.ev));
        bottomPart.measures[mi]?.events.push(clone(sorted[0]!.ev));
      }
    };

    assignTopBottom(trebleByT, sop, alt);
    assignTopBottom(bassByT,   ten, bas);

    for (const part of [sop, alt, ten, bas]) {
      part.measures[mi]?.events.sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
    }
  }
  return { soprano: sop, alto: alt, tenor: ten, bass: bas };
}

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
    if (!topM.events.length && !botM.events.length) continue;
    if (!topM.events.length) topM.events.push(...botM.events.map(clone));
    if (!botM.events.length) botM.events.push(...topM.events.map(clone));
    top.measures.push(topM);
    bot.measures.push(botM);
  }
  return { top, bottom: bot };
}

function makeBrassPart(src: PartLike, bvId: BrassVoiceId): PartLike {
  const meta = BRASS_PART_META[bvId];
  const p = clone(src);
  p.part_id    = meta.part_id;
  p.name       = meta.name;
  p.instrument = meta.instrument;
  p.staves     = 1;
  return p;
}

export type SatbToBrassOptions = { warnings?: string[] };

/**
 * Transcribe a SATB choral score to brass quartet.
 * Soprano → Trumpet 1, Alto → Trumpet 2, Tenor → Trombone, Bass → Tuba.
 * Notes outside each instrument's sounding range are shifted by octave.
 */
export function arrangeSatbToBrassQuartetDirect(
  score: ScoreModel,
  options: SatbToBrassOptions = {}
): ScoreModel {
  const { warnings } = options;

  let satb: SatbParts | null = findSatbParts(score);

  if (!satb) {
    const saTb = findSaTbParts(score);
    if (saTb) {
      const { top: s, bottom: a } = splitTwoPart(saTb.sa);
      const { top: t, bottom: b } = splitTwoPart(saTb.tb);
      satb = { soprano: s, alto: a, tenor: t, bass: b };
    }
  }

  if (!satb) {
    const grandPart = (score.parts ?? []).find((p: any) =>
      Number(p?.staves ?? 1) >= 2 ||
      (p.measures ?? []).some((m: any) => (m.events ?? []).some((ev: any) => Number(ev?.staff) === 2))
    );
    if (grandPart) satb = splitGrandStaffSatb(grandPart);
  }

  if (!satb) {
    warn(warnings, "[brass] Choral-brass: no SATB parts found; returning original score.");
    return score;
  }

  const trumpet1 = makeBrassPart(satb.soprano, "tpt1");
  const trumpet2 = makeBrassPart(satb.alto,    "tpt2");
  const trombone = makeBrassPart(satb.tenor,   "tbn");
  const tuba     = makeBrassPart(satb.bass,    "tuba");

  clampPartToRange(trumpet1, "tpt1");
  clampPartToRange(trumpet2, "tpt2");
  clampPartToRange(trombone, "tbn");
  clampPartToRange(tuba,     "tuba");

  warn(warnings, "[brass] Choral-brass: Soprano→Trumpet 1, Alto→Trumpet 2, Tenor→Trombone, Bass→Tuba.");

  return {
    ...(score as any),
    meta:  { ...(score as any).meta, ensemble: "brass_ensemble" },
    parts: [trumpet1, trumpet2, trombone, tuba],
  } as ScoreModel;
}
