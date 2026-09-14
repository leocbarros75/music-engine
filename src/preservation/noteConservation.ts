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

type Note = { measure: number; onset: number; midi: number; dur: number };

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
  for (const part of el(doc.documentElement, "part")) {
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
        if (midi !== null) out.push({ measure: number, onset, midi, dur });
        if (!isChordMember) { previousOnset = cursor; cursor += dur; }
      }
    }
  }
  return out;
}

/** Bar + beat + pitch class. The beat is rounded so triplets compare cleanly. */
const key = (n: { measure: number; onset: number; midi: number }) =>
  `${n.measure}|${Math.round(n.onset * 1000)}|${((n.midi % 12) + 12) % 12}`;

/** Bar + beat + exact sounding pitch, for the stricter same-octave figure. */
const exactKey = (n: { measure: number; onset: number; midi: number }) =>
  `${n.measure}|${Math.round(n.onset * 1000)}|${n.midi}`;

export function auditNoteConservation(sourceXml: string, outputXml: string): ConservationReport {
  const source = collectNotes(sourceXml);
  const output = collectNotes(outputXml);

  const counted = (xs: Note[], f: (n: Note) => string) => {
    const m = new Map<string, number>();
    for (const n of xs) m.set(f(n), (m.get(f(n)) ?? 0) + 1);
    return m;
  };
  const byClass = counted(output, key);
  const byPitch = counted(output, exactKey);

  const take = (m: Map<string, number>, k: string): boolean => {
    const have = m.get(k) ?? 0;
    if (have <= 0) return false;
    m.set(k, have - 1);
    return true;
  };

  let preserved = 0;
  let sameOctave = 0;
  const examples: ConservationReport["examples"] = [];

  for (const n of source) {
    if (take(byClass, key(n))) {
      preserved++;
      // Counted independently: a note can be present at the right moment while
      // the transcription has moved its octave to fit an instrument.
      if (take(byPitch, exactKey(n))) sameOctave++;
    } else if (examples.length < 8) {
      examples.push({ measure: n.measure, beat: n.onset, midi: n.midi, durationBeats: n.dur });
    }
  }

  return {
    sourceSegments: source.length,
    preserved,
    sameOctave,
    lost: source.length - preserved,
    examples,
  };
}
