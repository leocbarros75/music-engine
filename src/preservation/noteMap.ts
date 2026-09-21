/**
 * Where did every note go?
 *
 * The conservation audit answers "how many arrived" — a number, and a number
 * is not reviewable. A player looking at a transcription wants to ask a
 * different question about a specific bar: this note, the one that sounds
 * wrong to me, where did it come from and what was done to it? Without an
 * answer the only options are to trust the arrangement or to re-derive it by
 * hand, and neither is a review.
 *
 * So this pairs each source note with its destination: which instrument took
 * it, at what octave, or that nothing did.
 *
 * WHAT THIS IS NOT. The destination is DERIVED, not recorded. Our arrangers
 * emit fresh events with no back-reference to the note they came from, so the
 * pairing is made afterwards, by matching bar, beat and pitch class. A note
 * that kept its own pitch is matched to itself and that is certain. What is
 * not certain is the rest: where a moment holds several notes of one pitch
 * class and none of them kept its octave, which source note went to which
 * instrument is a guess among them. The SET of destinations at that moment is
 * right either way, and so is every count; only the line drawn between two
 * same-class notes may be wrong.
 *
 * It also cannot tell a supplementary doubling from a primary destination —
 * both look like a note arriving. Recording provenance in the arrangers would
 * settle both, and is the honest next step if this is ever used for anything
 * beyond review by eye.
 *
 * Octave is reported as a shift, not a verdict. A transcription moves a line
 * an octave to fit an instrument, and that is an orchestral decision; the
 * invariant is that the pitch class survives.
 */

import { createHash } from "node:crypto";
import { collectNotes, pairSourceToOutput } from "./noteConservation";

export type NoteMapRow = {
  /** Source position: the bar and beat the note is played on. */
  measure: number;
  beat: number;
  durationBeats: number;
  /** Where it came from. */
  sourcePart: string;
  sourceStaff: number | null;
  sourceMidi: number;
  /** Where it went — null when nothing in the arrangement plays it. */
  destination: string | null;
  destinationPart: string | null;
  soundingMidi: number | null;
  /** Octaves moved. 0 means the note kept its exact sounding pitch. */
  octaveShift: number | null;
};

export type NoteMap = {
  rows: NoteMapRow[];
  summary: {
    sourceSegments: number;
    preserved: number;
    sameOctave: number;
    lost: number;
    /** Destinations by instrument, so a thin or absent part is visible at a glance. */
    byDestination: Record<string, number>;
    /** sha256 of the source, so a map can be tied back to the file it describes. */
    sourceSha256: string;
  };
};

/**
 * Pair every source note with the output note that plays it.
 *
 * In two passes, and the order is the whole point. Notes that kept their exact
 * sounding pitch are claimed FIRST, across the whole score; only then is what
 * remains paired by pitch class.
 *
 * Taking them in one greedy pass gets this wrong whenever a moment holds
 * several notes of one pitch class in different octaves, which a piano chord
 * does constantly. Bar 25 of the reference sounds D2, D4 and D6 together over
 * a quartet playing D6 and D2: walking the source in order, D4 finds no D4,
 * helps itself to the D6 — and then the real D6 is reported as having gone to
 * the bassoon four octaves down, while D2 is reported lost. Every one of those
 * three claims is false. A map that misdirects the reader is worse than no
 * map, because it is the thing they were going to trust instead of re-deriving
 * the arrangement by hand.
 */
export function buildNoteMap(sourceXml: string, outputXml: string): NoteMap {
  const source = collectNotes(sourceXml);
  const taken = pairSourceToOutput(source, collectNotes(outputXml));

  const rows: NoteMapRow[] = [];
  const byDestination: Record<string, number> = {};
  let preserved = 0;
  let sameOctave = 0;

  source.forEach((n, i) => {
    const dest = taken[i];
    if (dest) {
      preserved++;
      if (dest.midi === n.midi) sameOctave++;
      byDestination[dest.partName] = (byDestination[dest.partName] ?? 0) + 1;
    }
    rows.push({
      measure: n.measure,
      beat: n.onset,
      durationBeats: n.dur,
      sourcePart: n.partName,
      sourceStaff: n.staff,
      sourceMidi: n.midi,
      destination: dest ? dest.partId : null,
      destinationPart: dest ? dest.partName : null,
      soundingMidi: dest ? dest.midi : null,
      octaveShift: dest ? Math.round((dest.midi - n.midi) / 12) : null,
    });
  });

  return {
    rows,
    summary: {
      sourceSegments: source.length,
      preserved,
      sameOctave,
      lost: source.length - preserved,
      byDestination,
      sourceSha256: createHash("sha256").update(sourceXml).digest("hex"),
    },
  };
}

const CSV_COLUMNS: Array<keyof NoteMapRow> = [
  "measure", "beat", "durationBeats",
  "sourcePart", "sourceStaff", "sourceMidi",
  "destination", "destinationPart", "soundingMidi", "octaveShift",
];

/** A quoted field, so an instrument name containing a comma cannot split a row. */
function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

/** The map as CSV — one row per source note, openable in any spreadsheet. */
export function noteMapToCsv(map: NoteMap): string {
  const lines = [CSV_COLUMNS.join(",")];
  for (const row of map.rows) lines.push(CSV_COLUMNS.map((c) => csvCell(row[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Just the notes nothing plays — the shortest useful view when reviewing. */
export function lostRows(map: NoteMap): NoteMapRow[] {
  return map.rows.filter((r) => r.destination === null);
}
