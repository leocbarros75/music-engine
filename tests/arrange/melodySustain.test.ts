import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeStringEnsemble } from '../../src/arrange/strings/stringArranger';
import { pitchToMidi } from '../../src/instruments/instrumentCatalog';

/**
 * One note, or two?
 *
 * Violin I is built one event per slice, and slices are cut at every chord
 * change and every onset anywhere in the source part. A melody note held
 * through a chord change therefore came out as two notes at the same pitch,
 * re-struck — 255 of Violin I's 354 notes on the reference piano source
 * repeated the pitch before them, with no tie anywhere.
 *
 * The obvious fix — merging any two adjacent notes of equal pitch, the way the
 * accompanying voices do — is wrong for a melody. This tune genuinely repeats
 * notes 132 times; a worship song declaims syllables on a repeated pitch, and
 * flattening those would rewrite the melody.
 *
 * So the test of correctness is not "fewer notes". It is that a note the
 * SLICER cut is rejoined, and a note the COMPOSER repeated is left alone.
 */

const note = (t: number, dur: number, midi: number, staff: number) => ({
  id: `n${midi}@${t}s${staff}`, t, dur, midi, type: 'note' as const,
  voice: staff, staff,
});

const pianoScore = (rh: Array<[number, number, number]>) => ({
  score_id: 's', meta: {}, global: { divisions: 4 },
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 2,
    measures: [{
      number: 1,
      attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 },
      events: [note(0, 4, 48, 2), ...rh.map(([t, dur, midi]) => note(t, dur, midi, 1))],
    }],
  }],
} as any);

const soundingMidi = (e: any): number | null => {
  if (typeof e?.midi === 'number' && Number.isFinite(e.midi)) return e.midi;
  try { return e?.pitch ? pitchToMidi(e.pitch) : null; } catch { return null; }
};

const vln1Events = (score: any): any[] => {
  const part = score.parts.find((p: any) => String(p.name) === 'Violin I');
  assert(part, 'no Violin I part');
  return part.measures.flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note')
  );
};

const run = (rh: Array<[number, number, number]>, chords: any[]) =>
  vln1Events(arrangeStringEnsemble(pianoScore(rh), chords, {
    profile: 'melody_harmony', sustainAccompaniment: true,
  }).scoreModel);

test('a held note cut by a chord change is rejoined', () => {
  // ONE whole note in the source. The chord moves under it at beat 2, which
  // cuts the slice grid in half and used to produce two struck notes.
  const ev = run([[0, 4, 72]], [
    { measure: 1, t: 0, symbol: 'C' },
    { measure: 1, t: 2, symbol: 'F' },
  ]);
  const pitches = ev.map(soundingMidi);
  assert(pitches.every((p) => p === 72), `Violin I is not the melody: ${pitches.join(' ')}`);
  const total = ev.reduce((s, e) => s + Number(e.dur), 0);
  assert.equal(total, 4, 'the note lost or gained time');
  if (ev.length > 1) {
    // Split only for notation: it must be tied, never re-struck.
    assert(ev[0].tieStart === true, `two notes and no tie: ${ev.length} pieces`);
  }
  assert(ev.length <= 2, `a single held note became ${ev.length} attacks`);
});

test('a note the composer repeated is left alone', () => {
  // TWO half notes at the same pitch, one chord. Nothing may merge these:
  // they are the tune's own rhythm.
  const ev = run([[0, 2, 72], [2, 2, 72]], [{ measure: 1, t: 0, symbol: 'C' }]);
  assert.equal(ev.length, 2, `a genuine repeated note was flattened into ${ev.length}`);
  assert(!ev[0].tieStart, 'a repeated note was tied into one sound');
  assert.deepEqual(ev.map(soundingMidi), [72, 72]);
});

test('a repeated note still stands apart when a chord change falls between', () => {
  // The hard case: two real notes AND a slice boundary at the same instant.
  // Merging by pitch and contiguity alone would join them.
  const ev = run([[0, 2, 72], [2, 2, 72]], [
    { measure: 1, t: 0, symbol: 'C' },
    { measure: 1, t: 2, symbol: 'F' },
  ]);
  assert.equal(ev.length, 2, `two struck notes became ${ev.length}`);
  assert(!ev[0].tieStart, 'the second attack was tied away');
});

test('the melody still moves note to note', () => {
  const ev = run([[0, 1, 72], [1, 1, 74], [2, 1, 76], [3, 1, 77]], [
    { measure: 1, t: 0, symbol: 'C' },
  ]);
  assert.deepEqual(ev.map(soundingMidi), [72, 74, 76, 77]);
});
