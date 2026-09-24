/**
 * Does every note the source played reach the page?
 *
 * The transcription ensembles — piano_string_quartet, satb_brass_quartet,
 * reinstrument and their siblings — re-instrument an existing score rather than
 * arranging from chord symbols. For those the contract is note-level: the music
 * moves to different instruments, but nothing is supposed to disappear.
 *
 * Nothing measured that. Transcribing a 123-bar piano score to a string quartet
 * dropped 115 of its 1,942 note segments, and the output looked entirely
 * plausible: every bar full, every part in range, nothing to notice. The losses
 * were short off-beat right-hand figuration — the detail that makes a piano part
 * sound like one — and they went silently.
 *
 * This counts them. It is deliberately a measurement and not a guarantee: it
 * reports what arrived, and the caller decides whether that is acceptable.
 *
 * Octave displacement is reported separately rather than counted as a loss. A
 * transcription legitimately moves a line an octave to fit an instrument's
 * range; a note that vanishes is a different thing from a note that moved.
 *
 * Matching is on pitch CLASS at a moment, not exact pitch, and that detail
 * matters. Matching exact pitch first looks stricter and is simply wrong when a
 * whole texture drops an octave: a reference transcription moved G5 and G4 down
 * together, and exact-first matching paired the source's G4 with the output G4
 * that was really the G5's destination, then reported the G5 as lost. Pitch
 * class with multiplicity has no such collision — two Gs in, two Gs out.
 */

import { DOMParser } from "@xmldom/xmldom";

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * The ensembles that re-instrument an existing score, and so owe it every note.
 * The rest arrange from harmony: a complementary string cushion is not supposed
 * to carry the piano's every note, and auditing it against that would report a
 * fault where there is none.
 */
export const TRANSCRIPTION_ENSEMBLES = new Set([
  "reinstrument",
  "piano_string_quartet", "satb_string_quartet",
  "piano_woodwind_quartet", "satb_woodwind_quartet",
  "piano_brass_quartet", "satb_brass_quartet",
]);

export type ConservationReport = {
  /** Pitched note elements in the source. A note tied across bars counts once per bar. */
  sourceSegments: number;
  /**
   * Source segments present in the output at the same bar and beat, in some
   * octave. This is the transcription invariant: the music moves instruments,
   * and octave is an orchestral parameter, but nothing should disappear.
   */
  preserved: number;
  /** Of those, how many kept the source's exact sounding pitch. */
  sameOctave: number;
  /** Segments with no destination at all. */
  lost: number;
  /** A few lost notes, to make a number diagnosable. */
  examples: Array<{ measure: number; beat: number; midi: number; durationBeats: number }>;
};

export type Note = {
  measure: number;
  onset: number;
  midi: number;
  dur: number;
  /** The part this note is written in — its MusicXML id, and its printed name. */
  partId: string;
  partName: string;
  /** Which staff of a grand-staff part, when the source says. */
  staff: number | null;
  /** The written voice, when the source says. A dropped voice is the single
   *  commonest reason a note does not reach the arrangement, and without this
   *  an omissions record can only say "some inner note". */
  voice: number | null;
};

/** Printed part names, keyed by the id the <part> elements use. */
function partNames(doc: any): Map<string, string> {
  const names = new Map<string, string>();
  for (const sp of el(doc.documentElement, "score-part")) {
    const id = sp.getAttribute("id");
    if (id) names.set(id, (text(sp, "part-name") ?? id).trim());
  }
  return names;
}

const el = (n: any, tag: string): any[] =>
  Array.from(n.getElementsByTagName(tag) ?? []);
const text = (n: any, tag: string): string | null =>
  el(n, tag)[0]?.textContent ?? null;

/** Sounding MIDI of a <note>, or null for rests, grace notes and unpitched. */
function soundingMidi(note: any, chromatic: number, octaveChange: number): number | null {
  if (el(note, "rest").length || el(note, "grace").length) return null;
  const pitch = el(note, "pitch")[0];
  if (!pitch) return null;
  const step = text(pitch, "step");
  if (!step || !(step in STEP)) return null;
  const alter = Number(text(pitch, "alter") ?? 0) || 0;
  const octave = Number(text(pitch, "octave") ?? 4);
  // A <transpose> describes written-to-sounding, so applying it gives concert pitch.
  return (octave + 1) * 12 + STEP[step]! + alter + chromatic + octaveChange * 12;
}

/**
 * Every pitched note in a score, at concert pitch, with its bar and beat.
 *
 * Walks <backup> and <forward> rather than assuming document order is
 * chronological — a MusicXML part writes one voice, rewinds, then writes the
 * next, and treating that as a straight line puts every later voice at the
 * wrong beat.
 */
export function collectNotes(xml: string): Note[] {
  const doc = new DOMParser({ onError: () => {} } as any).parseFromString(xml, "application/xml");
  const out: Note[] = [];
  const names = partNames(doc);
  for (const part of el(doc.documentElement, "part")) {
    const partId = part.getAttribute("id") ?? "";
    const partName = names.get(partId) ?? partId;
    const transpose = el(part, "transpose")[0];
    const chromatic = transpose ? Number(text(transpose, "chromatic") ?? 0) || 0 : 0;
    const octaveChange = transpose ? Number(text(transpose, "octave-change") ?? 0) || 0 : 0;
    let divisions = 1;
    for (const measure of el(part, "measure")) {
      const d = text(measure, "divisions");
      if (d) divisions = Number(d) || divisions;
      const number = Number(measure.getAttribute("number")) || 0;
      let cursor = 0;
      let previousOnset = 0;
      for (const node of Array.from(measure.childNodes ?? []) as any[]) {
        if (node.nodeType !== 1) continue;
        const name = node.localName ?? node.nodeName;
        if (name === "backup") { cursor -= Number(text(node, "duration") ?? 0) / divisions; continue; }
        if (name === "forward") { cursor += Number(text(node, "duration") ?? 0) / divisions; continue; }
        if (name !== "note") continue;
        const dur = Number(text(node, "duration") ?? 0) / divisions;
        const isChordMember = el(node, "chord").length > 0;
        const onset = isChordMember ? previousOnset : cursor;
        const midi = soundingMidi(node, chromatic, octaveChange);
        const staffText = text(node, "staff");
        const staff = staffText === null ? null : Number(staffText) || null;
        const voiceText = text(node, "voice");
        const voice = voiceText === null ? null : Number(voiceText) || null;
        if (midi !== null) out.push({ measure: number, onset, midi, dur, partId, partName, staff, voice });
        if (!isChordMember) { previousOnset = cursor; cursor += dur; }
      }
    }
  }
  return out;
}

/** Bar + beat + pitch class. The beat is rounded so triplets compare cleanly. */
const key = (n: { measure: number; onset: number; midi: number }) =>
  `${n.measure}|${Math.round(n.onset * 1000)}|${((n.midi % 12) + 12) % 12}`;

/**
 * Pair each source note with the output note that plays it, in two passes.
 *
 * Notes that kept their exact sounding pitch are claimed FIRST, across the
 * whole score; only what remains is paired by pitch class. The order matters
 * whenever a moment holds several notes of one pitch class in different
 * octaves, which a piano chord does constantly: bar 25 of the reference sounds
 * D2, D4 and D6 over a quartet playing D6 and D2, and a single greedy pass in
 * source order lets the D4 help itself to the D6.
 *
 * Returns, for each source note by index, its destination or undefined. How
 * MANY notes find a destination does not depend on the passes — each bucket is
 * drained either way — but WHICH note goes where does, and so does the count
 * of notes that kept their own octave.
 *
 * One function, so the conservation figures and the note map can never
 * disagree about the same score.
 */
export function pairSourceToOutput(
  source: Note[],
  output: Note[]
): Array<Note | undefined> {
  const buckets = new Map<string, Note[]>();
  for (const n of output) {
    const k = key(n);
    const list = buckets.get(k);
    if (list) list.push(n);
    else buckets.set(k, [n]);
  }

  const taken: Array<Note | undefined> = new Array(source.length);
  source.forEach((n, i) => {
    const bucket = buckets.get(key(n));
    if (!bucket?.length) return;
    const exact = bucket.findIndex((c) => c.midi === n.midi);
    if (exact >= 0) taken[i] = bucket.splice(exact, 1)[0];
  });
  source.forEach((n, i) => {
    if (taken[i]) return;
    const bucket = buckets.get(key(n));
    if (bucket?.length) taken[i] = bucket.shift();
  });
  return taken;
}

export function auditNoteConservation(sourceXml: string, outputXml: string): ConservationReport {
  const source = collectNotes(sourceXml);
  const taken = pairSourceToOutput(source, collectNotes(outputXml));

  let preserved = 0;
  let sameOctave = 0;
  const examples: ConservationReport["examples"] = [];

  source.forEach((n, i) => {
    const dest = taken[i];
    if (dest) {
      preserved++;
      // Counted separately: a note can be present at the right moment while
      // the transcription has moved its octave to fit an instrument.
      if (dest.midi === n.midi) sameOctave++;
    } else if (examples.length < 8) {
      examples.push({ measure: n.measure, beat: n.onset, midi: n.midi, durationBeats: n.dur });
    }
  });

  return {
    sourceSegments: source.length,
    preserved,
    sameOctave,
    lost: source.length - preserved,
    examples,
  };
}
