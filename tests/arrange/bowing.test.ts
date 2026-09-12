import assert from 'node:assert/strict';
import { test } from 'node:test';
import { markBowDirections, startsWithPickup } from '../../src/arrange/strings/bowing';
import type { Part } from '../../src/score/types';

const note = (t: number, dur: number, octave = 4) => ({
  id: `n${t}`, t, dur, type: 'note' as const,
  pitch: { step: 'A', octave }, voice: 1, staff: 1,
});
const rest = (t: number, dur: number) => ({
  id: `r${t}`, t, dur, type: 'rest' as const, voice: 1, staff: 1, isRest: true as const,
});

const part = (measures: any[]): Part => ({
  part_id: 'P_V1', name: 'Violin I', instrument: 'violin_1', staves: 1, measures,
} as unknown as Part);

const marksOf = (p: Part) =>
  (p.measures ?? []).flatMap((m: any) =>
    (m.events ?? [])
      .filter((e: any) => e.technical?.length)
      .map((e: any) => `m${m.number}:t${e.t}:${e.technical.join(',')}`)
  );

test('the first note of the part takes a down-bow', () => {
  const p = part([{ number: 1, events: [note(0, 1), note(1, 1), note(2, 2)] }]);
  assert.equal(markBowDirections(p), 1);
  assert.deepEqual(marksOf(p), ['m1:t0:down-bow']);
});

test('nothing is marked note by note', () => {
  // Four bars of quarters: one mark, not sixteen. A run of alternating symbols
  // says nothing about how much bow each stroke uses.
  const bars = [1, 2, 3, 4].map((n) => ({
    number: n, events: [note(0, 1), note(1, 1), note(2, 1), note(3, 1)],
  }));
  const p = part(bars);
  assert.equal(markBowDirections(p), 1);
});

test('a rest of a beat or more is a retake', () => {
  const p = part([
    { number: 1, events: [note(0, 2), rest(2, 1), note(3, 1)] },
    { number: 2, events: [note(0, 4)] },
  ]);
  assert.deepEqual(marksOf(p), []);
  markBowDirections(p);
  assert.deepEqual(marksOf(p), ['m1:t0:down-bow', 'm1:t3:down-bow']);
});

test('a short rest is a comma, not a retake', () => {
  const p = part([{ number: 1, events: [note(0, 1.5), rest(1.5, 0.5), note(2, 2)] }]);
  markBowDirections(p);
  assert.deepEqual(marksOf(p), ['m1:t0:down-bow']);
});

test('a rest carrying across a bar line still counts as one break', () => {
  const p = part([
    { number: 1, events: [note(0, 3), rest(3, 1)] },
    { number: 2, events: [rest(0, 1), note(1, 3)] },
  ]);
  markBowDirections(p);
  assert.deepEqual(marksOf(p), ['m1:t0:down-bow', 'm2:t1:down-bow']);
});

test('a pickup goes up, so the downbeat lands down', () => {
  const p = part([
    { number: 1, events: [note(0, 1)] },
    { number: 2, events: [note(0, 4)] },
  ]);
  markBowDirections(p, { pickup: true });
  assert.deepEqual(marksOf(p), ['m1:t0:up-bow']);
});

test('marking twice does not double up', () => {
  const p = part([{ number: 1, events: [note(0, 4)] }]);
  markBowDirections(p);
  markBowDirections(p);
  assert.deepEqual(marksOf(p), ['m1:t0:down-bow']);
});

test('an incomplete first bar is recognised as a pickup', () => {
  const full = part([{
    number: 1,
    attributes: { time: { beats: 4, beat_type: 4 } },
    events: [note(0, 4)],
  }]);
  const short = part([{
    number: 1,
    attributes: { time: { beats: 4, beat_type: 4 } },
    events: [note(0, 1)],
  }]);
  assert.equal(startsWithPickup(full), false);
  assert.equal(startsWithPickup(short), true);
});
