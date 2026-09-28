import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeStringEnsemble } from '../../src/arrange/strings/stringArranger';
import { STRING_RANGES } from '../../src/arrange/strings/ranges';
import { pitchToMidi } from '../../src/instruments/instrumentCatalog';

/**
 * Which note is the tune?
 *
 * A keyboard source is ONE part carrying two staves. Its events arrive sorted
 * by time alone, and the arranger took the first one still sounding at each
 * slice — so whenever a left-hand note was held under the right hand, Violin I
 * was handed the bass. Violin I is locked to that pitch, so the section then
 * voiced the chord correctly ABOVE what it had been told was the melody, and
 * the DP's crossing penalty, which had been working the whole time, had
 * nothing it could do. It read as a voice-crossing defect in the search.
 */

const note = (t: number, dur: number, midi: number, staff: number) => ({
  id: `n${midi}@${t}s${staff}`, t, dur, midi, type: 'note' as const,
  voice: staff, staff,
});

/**
 * A right hand moving above a left hand that holds through the bar — the shape
 * every piano source has, and the one that produced the fault.
 */
const pianoScore = (rh: number[], lhMidi: number) => ({
  score_id: 's', meta: {}, global: { divisions: 4 },
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 2,
    measures: [{
      number: 1,
      attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 },
      // The held left hand is listed FIRST, exactly as a parsed piano part has it.
      events: [note(0, 4, lhMidi, 2), ...rh.map((m, i) => note(i, 1, m, 1))],
    }],
  }],
} as any);

const chords = [{ measure: 1, t: 0, symbol: 'C' }];

/** Output events carry a spelled pitch, not the cached midi the input uses. */
const soundingMidi = (e: any): number | null => {
  if (typeof e?.midi === 'number' && Number.isFinite(e.midi)) return e.midi;
  try { return e?.pitch ? pitchToMidi(e.pitch) : null; } catch { return null; }
};

const vln1Of = (score: any): number[] => {
  const part = score.parts.find((p: any) => String(p.name) === 'Violin I');
  assert(part, 'no Violin I part');
  const out = part.measures.flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note').map(soundingMidi)
  ).filter((m: number | null): m is number => m !== null);
  assert(out.length, 'Violin I has no sounding notes');
  return out;
};

test('the melody is the top line, not whichever note is listed first', () => {
  // The left hand at C2 is held under a right hand up at C5. Violin I must be
  // the right hand, note for note — asserting merely that it avoids the bass
  // note is not enough, because an out-of-range candidate gets replaced
  // downstream and the wrong melody still passes.
  const rh = [72, 74, 76, 77];
  const v1 = vln1Of(arrangeStringEnsemble(pianoScore(rh, 36), chords, {
    profile: 'melody_harmony',
  }).scoreModel);
  assert.deepEqual(v1, rh, `Violin I is not the right hand: ${v1.join(' ')}`);
});

test('the upper staff wins even when the lower staff is higher at that instant', () => {
  // A left-hand note ABOVE the right hand's current note. Picking the highest
  // sounding pitch alone would take it; the tune is still the upper staff.
  const rh = [60, 62, 64, 65];
  const v1 = vln1Of(arrangeStringEnsemble(pianoScore(rh, 67), chords, {
    profile: 'melody_harmony',
  }).scoreModel);
  assert.deepEqual(v1, rh, `Violin I did not follow the upper staff: ${v1.join(' ')}`);
});

test('a low melody is lifted into the register a first violin plays in', () => {
  // The same tune, once refused and once allowed. Only whole octaves, so the
  // line must keep its exact shape.
  const rh = [55, 57, 59, 60];
  const off = vln1Of(arrangeStringEnsemble(pianoScore(rh, 36), chords, {
    profile: 'melody_harmony',
  }).scoreModel);
  const on = vln1Of(arrangeStringEnsemble(pianoScore(rh, 36), chords, {
    profile: 'melody_harmony', liftMelodyIntoRegister: true,
  }).scoreModel);

  assert(off.length === on.length, 'the lift changed how many notes there are');
  assert(
    Math.min(...off) < STRING_RANGES.vln1.prefMin,
    'fixture no longer starts below the violin floor',
  );
  assert(
    Math.min(...on) >= STRING_RANGES.vln1.prefMin,
    `still below the violin's floor: ${on.join(' ')}`
  );
  // Whole octaves only: every note moved by the same multiple of twelve.
  const deltas = on.map((m, i) => m - off[i]!);
  assert(
    deltas.every((d) => d === deltas[0] && d % 12 === 0),
    `the tune was reshaped, not transposed: ${deltas.join(' ')}`
  );
});

test('a melody already in register is left where it is', () => {
  const rh = [72, 74, 76, 77];
  const off = vln1Of(arrangeStringEnsemble(pianoScore(rh, 36), chords, {
    profile: 'melody_harmony',
  }).scoreModel);
  const on = vln1Of(arrangeStringEnsemble(pianoScore(rh, 36), chords, {
    profile: 'melody_harmony', liftMelodyIntoRegister: true,
  }).scoreModel);
  assert.deepEqual(on, off, 'a comfortable melody was moved anyway');
});
