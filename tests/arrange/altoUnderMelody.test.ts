import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lowestNoteMidiDuring } from '../../src/rhythm/applyPolyphonicBassCounterRhythm';

const n = (t: number, dur: number, midi: number) => ({ type: 'note', t, dur, midi });

/** Bar 7 of the reproduction: the melody falls while the alto is still holding. */
const MELODY = [n(0, 1, 62), n(1, 0.5, 62), n(1.5, 0.5, 64), n(2, 2, 61)];

test('the ceiling is the lowest the melody goes while the note sounds', () => {
  // An alto note from beat 1.5 lasting one beat overlaps the melody's D4 (64)
  // and its fall to C#4 (61). The binding value is 61, not the 64 at its onset.
  assert.equal(lowestNoteMidiDuring(MELODY, 1.5, 1), 61);
});

test('a short note only sees the melody it actually overlaps', () => {
  assert.equal(lowestNoteMidiDuring(MELODY, 1.5, 0.5), 64);
  assert.equal(lowestNoteMidiDuring(MELODY, 0, 1), 62);
});

test('a note spanning the whole bar takes the melody floor', () => {
  assert.equal(lowestNoteMidiDuring(MELODY, 0, 4), 61);
});

test('a zero-length or gap position still answers, rather than returning nothing', () => {
  assert.equal(lowestNoteMidiDuring(MELODY, 1.5, 0), 64);
  assert.equal(lowestNoteMidiDuring([], 0, 1), null);
});

test('rests and malformed events are ignored', () => {
  const events = [
    { type: 'rest', t: 0, dur: 1 },
    { type: 'note', t: 0, dur: 1 },            // no midi
    { type: 'note', t: 0, dur: Number.NaN, midi: 40 },
    n(0, 2, 70),
  ];
  assert.equal(lowestNoteMidiDuring(events, 0, 2), 70);
});

test('the alto would clear the melody by a semitone at every point of the span', () => {
  // The ceiling the caller applies is (lowest - 1); check it holds throughout.
  const t = 1.5, dur = 1;
  const ceiling = lowestNoteMidiDuring(MELODY, t, dur)! - 1;
  for (let x = t; x < t + dur; x += 0.25) {
    const sopr = MELODY.filter((e) => e.t <= x + 1e-9 && e.t + e.dur > x + 1e-9)[0]?.midi;
    assert(sopr !== undefined && ceiling < sopr, `at ${x}: ceiling ${ceiling} vs melody ${sopr}`);
  }
});
