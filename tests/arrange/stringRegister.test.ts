import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCandidatesForSlice, MELODY_HEADROOM } from '../../src/arrange/strings/candidates';
import { STRING_RANGES } from '../../src/arrange/strings/ranges';
import type { Slice } from '../../src/arrange/strings/types';

const slice = (melodyMidi: number): Slice => ({
  measure: 1, t: 0, dur: 1, melodyMidi, chordSymbol: 'D',
} as Slice);

const build = (melodyMidi: number, on: boolean) =>
  buildCandidatesForSlice({
    slice: slice(melodyMidi), prevVoicing: null, keyFifths: 2, keyMode: 'major',
    profileId: 'melody_harmony', keepInnerVoicesBelowMelody: on,
  });

/** A melody comfortably clear of Violin II's floor: the ceiling should apply. */
const HIGH = STRING_RANGES.vln2.prefMin + MELODY_HEADROOM + 6;
/** A melody too low to fit the inner voices underneath. */
const LOW = STRING_RANGES.vln2.prefMin + 4;

test('with room below, Violin II and Viola stay under the melody', () => {
  const out = build(HIGH, true);
  for (const voice of ['vln2', 'vla'] as const) {
    assert(out[voice].length, `${voice} lost every candidate`);
    assert(
      out[voice].every((m) => m <= HIGH),
      `${voice} offers pitches above the melody: ${out[voice].join(' ')}`
    );
  }
});

test('cello and bass are never ceilinged — capping them moved the bass off its floor', () => {
  const on = build(HIGH, true);
  const off = build(HIGH, false);
  assert.deepEqual(on.vc, off.vc);
  assert.deepEqual(on.cb, off.cb);
});

test('a melody with no room underneath leaves the candidates alone', () => {
  // Forcing four voices under a low melody compresses the ensemble rather than
  // making room; arrangeStringEnsemble warns about the register instead.
  assert.deepEqual(build(LOW, true), build(LOW, false));
});

test('off by default, so brass and woodwinds reading this DP are untouched', () => {
  assert.deepEqual(
    build(HIGH, false),
    buildCandidatesForSlice({
      slice: slice(HIGH), prevVoicing: null, keyFifths: 2, keyMode: 'major',
      profileId: 'melody_harmony',
    })
  );
});

test('the ceiling never empties a voice, even with the melody at its floor', () => {
  const floor = STRING_RANGES.vln2.absMin;
  const out = build(floor, true);
  for (const voice of ['vln1', 'vln2', 'vla', 'vc', 'cb'] as const) {
    assert(out[voice].length > 0, `${voice} has no candidates`);
  }
});
