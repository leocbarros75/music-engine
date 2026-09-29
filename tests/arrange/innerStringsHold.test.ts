import assert from 'node:assert/strict';
import { test } from 'node:test';
import { holdInnerStrings } from '../../src/arrange/orchestra/worshipOrchestraArranger';

/**
 * Three sections were playing one rhythm.
 *
 * The orchestra's string core copies the piano's notes straight into four
 * parts, so every time the pianist re-strikes a chord all four sections re-bow
 * it. Violin 2, Viola and Violin 1 came out with exactly 563 events each and
 * byte-identical onset rhythms, the inner voices re-striking the same pitch on
 * 58-74% of their notes with not one tie in the score.
 *
 * Violin 1 is deliberately exempt: it carries the tune, and a tune that repeats
 * a pitch means it.
 */

const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 }, ...extra,
});
const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
/** Four quarter-notes on one pitch: a section re-bowing a held chord. */
const restruck = (part_id: string, name: string, midi = 60) => ({
  part_id, name, instrument: 'violin_2', staves: 1,
  measures: [bar(1, [note(0, 1, midi), note(1, 1, midi), note(2, 1, midi), note(3, 1, midi)])],
});
const score = (parts: any[]) => ({ score_id: 's', meta: {}, global: { divisions: 4 }, parts } as any);

const notesOf = (p: any) =>
  p.measures.flatMap((m: any) => (m.events ?? []).filter((e: any) => e.type === 'note'));

test('an inner voice holds the note instead of re-bowing it', () => {
  const p = restruck('P_VLN2', 'Violin 2');
  const merged = holdInnerStrings(score([p]));
  const out = notesOf(p);
  assert.equal(merged, 3, 'three re-articulations should have been absorbed');
  assert.equal(out.length, 1, `four attacks became ${out.length}`);
  assert.equal(out[0].dur, 4, 'the held note does not fill the bar');
});

test('the melody keeps every attack it was written with', () => {
  // Violin 1 is not in the set. A repeated melody note is the tune's rhythm.
  const p = restruck('P_VLN1', 'Violin 1');
  const merged = holdInnerStrings(score([p]));
  assert.equal(merged, 0, 'Violin 1 was merged');
  assert.equal(notesOf(p).length, 4, 'the melody lost attacks');
});

test('no music is lost — the sound lasts exactly as long', () => {
  const p = restruck('P_VLA', 'Viola');
  const before = notesOf(p).reduce((s: number, e: any) => s + Number(e.dur), 0);
  holdInnerStrings(score([p]));
  const after = notesOf(p).reduce((s: number, e: any) => s + Number(e.dur), 0);
  assert.equal(after, before, 'holding changed how long the part sounds');
});

test('a change of pitch still gets its own bow', () => {
  const p = {
    part_id: 'P_VLN2', name: 'Violin 2', instrument: 'violin_2', staves: 1,
    measures: [bar(1, [note(0, 1, 60), note(1, 1, 60), note(2, 1, 64), note(3, 1, 64)])],
  };
  holdInnerStrings(score([p]));
  const out = notesOf(p);
  assert.equal(out.length, 2, `expected two held notes, got ${out.length}`);
  assert.equal(out[0].midi, 60);
  assert.equal(out[1].midi, 64);
});

test('notes are never joined across a barline', () => {
  // Merging across the bar would rewrite the measure grouping.
  const p = {
    part_id: 'P_VLA', name: 'Viola', instrument: 'viola', staves: 1,
    measures: [bar(1, [note(0, 4, 60)]), bar(2, [note(0, 4, 60)])],
  };
  holdInnerStrings(score([p]));
  assert.equal(notesOf(p).length, 2, 'the barline was crossed');
});

test('a gap between two attacks is not closed up', () => {
  const p = {
    part_id: 'P_VLN2', name: 'Violin 2', instrument: 'violin_2', staves: 1,
    measures: [bar(1, [note(0, 1, 60), note(2, 1, 60)])], // a beat of silence between
  };
  holdInnerStrings(score([p]));
  const out = notesOf(p);
  assert.equal(out.length, 2, 'two separated attacks were merged through the rest');
});

test('a held note too long for one value is tied, not re-struck', () => {
  // Seven quarter-beats has no single note value, so it is written as tied
  // pieces — the bow is not retaken.
  const p = {
    part_id: 'P_VLA', name: 'Viola', instrument: 'viola', staves: 1,
    measures: [{
      number: 1, attributes: { divisions: 4, time: { beats: 7, beat_type: 4 } },
      events: Array.from({ length: 7 }, (_, i) => note(i, 1, 60)),
    }],
  };
  holdInnerStrings(score([p]));
  const out = notesOf(p);
  assert(out.length > 1, 'expected the seven beats to be split into tied pieces');
  assert(out[0].tieStart === true, 'the first piece does not start a tie');
  assert(out[out.length - 1].tieStop === true, 'the last piece does not end a tie');
  assert.equal(out.reduce((s: number, e: any) => s + Number(e.dur), 0), 7, 'the tied pieces do not add up');
});
