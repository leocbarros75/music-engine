// src/arrange/reinstrument.ts
//
// Part re-instrumentation: hand an existing part to a different instrument while
// keeping the music SOUNDING the same. E.g. "let the Alto Sax play the Horn
// part", or "let the Clarinet play the Viola part".
//
// How it works:
//   1. Recover the source part's CONCERT (sounding) pitch. The model stores
//      written pitch; for a transposing source the parser captured <transpose>
//      so sounding = written + chromatic + 12*octaveChange. Concert sources have
//      no transpose (sounding = stored).
//   2. Octave-fit each sounding note into the TARGET instrument's playable range
//      — only notes that fall outside the range jump by an octave; everything in
//      range keeps its exact sounding pitch.
//   3. Store the fitted CONCERT pitch and set the part's instrument to the target.
//      The MusicXML exporter then writes the target's transposition automatically
//      (e.g. Alto Sax notation reads a M6 higher than it sounds).
//
// This is a REPLACE operation: the chosen part becomes the new instrument; the
// score keeps the same number of parts. Multiple parts can be remapped at once.

import type { ScoreModel } from "../score/types";
import { midiToPitch, pitchToMidi, getInstrumentSpec } from "../instruments/instrumentCatalog";

type PartLike = any;
type EventLike = any;

/** One row of the remap table: source part → target instrument. */
export type ReinstrumentMapping = {
  /** Matches a part by part_id (exact) or by name (case-insensitive, trimmed). */
  part: string;
  /** Target instrument id (e.g. "alto_sax_eb", "clarinet_bb"). */
  to: string;
};

/** Instruments offered as re-instrumentation targets, grouped for the UI. */
export const REINSTRUMENT_TARGETS: Array<{ group: string; items: Array<{ id: string; label: string }> }> = [
  { group: "Strings", items: [
    { id: "violin_1", label: "Violin" },
    { id: "viola", label: "Viola" },
    { id: "cello", label: "Cello" },
    { id: "double_bass", label: "Double Bass" },
  ] },
  { group: "Woodwinds", items: [
    { id: "flute", label: "Flute" },
    { id: "oboe", label: "Oboe" },
    { id: "clarinet_bb", label: "Clarinet (Bb)" },
    { id: "bassoon", label: "Bassoon" },
  ] },
  { group: "Saxophones", items: [
    { id: "soprano_sax_bb", label: "Soprano Sax (Bb)" },
    { id: "alto_sax_eb", label: "Alto Sax (Eb)" },
    { id: "tenor_sax_bb", label: "Tenor Sax (Bb)" },
    { id: "baritone_sax_eb", label: "Baritone Sax (Eb)" },
  ] },
  { group: "Brass", items: [
    { id: "trumpet_bb_1", label: "Trumpet (Bb)" },
    { id: "horn_f", label: "Horn (F)" },
    { id: "trombone", label: "Trombone" },
    { id: "tuba_c", label: "Tuba" },
  ] },
];

const TARGET_LABEL: Record<string, string> = Object.fromEntries(
  REINSTRUMENT_TARGETS.flatMap((g) => g.items.map((i) => [i.id, i.label]))
);

function eventMidi(ev: EventLike): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) { try { return pitchToMidi(ev.pitch); } catch { return null; } }
  return null;
}

/** written + offset = sounding. */
function writtenToSoundingSemis(t: { chromatic: number; octaveChange?: number } | null | undefined): number {
  if (!t) return 0;
  return Number(t.chromatic ?? 0) + 12 * Number(t.octaveChange ?? 0);
}

/**
 * Octave-fit a sounding pitch into [lo, hi]. Notes already in range are kept
 * exactly; out-of-range notes jump by whole octaves toward the nearest edge,
 * preserving pitch class. If the instrument's range is narrower than the note
 * can reach (rare), it clamps to the nearest limit.
 */
function octaveFit(midi: number, lo: number, hi: number): number {
  let m = midi;
  while (m < lo) m += 12;
  while (m > hi) m -= 12;
  if (m < lo) m = lo;     // range narrower than an octave around the note
  if (m > hi) m = hi;
  return m;
}

function matchMapping(part: PartLike, mappings: ReinstrumentMapping[]): ReinstrumentMapping | null {
  const pid = String(part?.part_id ?? "");
  const pname = String(part?.name ?? "").trim().toLowerCase();
  // Prefer an exact part_id match, then a name match.
  return (
    mappings.find((m) => String(m.part) === pid) ??
    mappings.find((m) => String(m.part).trim().toLowerCase() === pname) ??
    null
  );
}

/**
 * Apply a remap table to a score, replacing each mapped part's instrument.
 * Returns a new score; unmapped parts pass through untouched.
 */
export function applyReinstrumentation(
  score: ScoreModel,
  mappings: ReinstrumentMapping[],
  warnings: string[] = []
): ScoreModel {
  if (!Array.isArray(mappings) || mappings.length === 0) return score;

  const parts = (score as any).parts ?? [];
  const newParts = parts.map((part: PartLike) => {
    const mapping = matchMapping(part, mappings);
    if (!mapping) return part;

    const spec = getInstrumentSpec(mapping.to);
    if (!spec) {
      warnings.push(`[reinstrument] Unknown target instrument "${mapping.to}" — "${part?.name ?? part?.part_id}" left unchanged.`);
      return part;
    }

    const lo = Number((spec as any).midi_low);
    const hi = Number((spec as any).midi_high);
    const sourceOffset = writtenToSoundingSemis(part?.transpose);
    let shiftedCount = 0;

    const measures = (part.measures ?? []).map((m: any) => {
      const events = (m.events ?? []).map((ev: any) => {
        if (ev?.type !== "note" || !ev.pitch) return ev;
        const written = eventMidi(ev);
        if (written === null) return ev;
        const sounding = written + sourceOffset;       // recover concert pitch
        const fitted = (Number.isFinite(lo) && Number.isFinite(hi)) ? octaveFit(sounding, lo, hi) : sounding;
        if (fitted !== sounding) shiftedCount++;
        return { ...ev, midi: fitted, pitch: midiToPitch(fitted) };
      });
      return { ...m, events };
    });

    const label = TARGET_LABEL[mapping.to] ?? spec.name ?? mapping.to;
    if (shiftedCount) {
      warnings.push(`[reinstrument] "${part?.name ?? part?.part_id}" → ${label}: ${shiftedCount} note(s) octave-shifted to fit the range.`);
    } else {
      warnings.push(`[reinstrument] "${part?.name ?? part?.part_id}" → ${label}: sounding pitch preserved exactly.`);
    }

    // The part now holds CONCERT pitch; drop the source transpose so the exporter
    // applies only the TARGET instrument's written transposition.
    const { transpose: _drop, ...rest } = part;
    return { ...rest, name: label, instrument: mapping.to, measures };
  });

  return { ...(score as any), parts: newParts } as ScoreModel;
}
