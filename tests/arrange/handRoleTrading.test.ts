import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangePianoFromSatb } from '../../src/arrange/arrangePianoFromSatb';

const BEATS = 4;

/** A melody bar with `n` evenly spaced attacks. */
const bar = (number: number, n: number) => ({
  number,
  attributes: { divisions: 4, key_fifths: 0, key_mode: 'major', time: { beats: BEATS, beat_type: 4 } },
  events: Array.from({ length: n }, (_, i) => ({
    id: `m${number}-${i}`, t: (i * BEATS) / n, dur: BEATS / n,
    type: 'note' as const, pitch: { step: 'G', octave: 4 }, voice: 1, staff: 1,
  })),
});

/**
 * Bar 1 moving (12 attacks), bar 2 held (1 attack), on one unchanging chord.
 * Bar 3 exists only so the two bars under test are not the last measure, which
 * carries its own cadence handling.
 */
const score = () => ({
  parts: [{ part_id: 'P_MEL', name: 'Melody', instrument: 'voice', staves: 1,
    measures: [bar(1, 12), bar(2, 1), bar(3, 4)] }],
  meta: {},
}) as any;

const CHORDS = [
  { measure: 1, t: 0, symbol: 'C' },
  { measure: 2, t: 0, symbol: 'C' },
  { measure: 3, t: 0, symbol: 'C' },
];

function attacks(result: any) {
  const piano = (result.parts ?? []).find((p: any) => p.name === 'Piano');
  assert(piano, 'no piano part');
  // Count ATTACKS, not noteheads: a chord's members share one onset, and the
  // ScoreModel leaves them unflagged (the exporter infers chords from shared t).
  const onsets = (events: any[], staff: number) =>
    new Set(events.filter((e: any) => e.type === 'note' && Number(e.staff) === staff)
      .map((e: any) => Math.round(Number(e.t) * 1000))).size;
  return (piano.measures ?? []).map((m: any) => ({
    rh: onsets(m.events ?? [], 1),
    lh: onsets(m.events ?? [], 2),
  }));
}

const run = (handRoleTrading: boolean) =>
  attacks(arrangePianoFromSatb(score(), {
    chords: CHORDS, lhPattern: 'pop_arpeggio', rhPattern: 'melody_inner_voice',
    ensembleTag: 'piano_with_melody', handRoleTrading,
  } as any));

test('while the voice moves, the left hand carries and the right hand sustains', () => {
  const [moving] = run(true);
  assert(moving!.lh > moving!.rh,
    `bar 1: left ${moving!.lh} should carry more than right ${moving!.rh}`);
});

test('while the voice holds, the right hand answers and the left steps back', () => {
  const [, held] = run(true);
  assert(held!.rh > held!.lh,
    `bar 2: right ${held!.rh} should answer over left ${held!.lh}`);
});

test('the hands swap roles between the two bars rather than moving together', () => {
  const [moving, held] = run(true);
  // Anti-phase: whichever hand leads in one bar yields in the other.
  assert(moving!.lh > moving!.rh && held!.lh < held!.rh,
    `expected a swap, got bar1 ${moving!.rh}/${moving!.lh} bar2 ${held!.rh}/${held!.lh}`);
});

test('trading evens out the bar-to-bar swing', () => {
  const on = run(true).slice(0, 2).map((a) => a.rh + a.lh);
  const off = run(false).slice(0, 2).map((a) => a.rh + a.lh);
  const swing = (xs: number[]) => Math.max(...xs) - Math.min(...xs);
  assert(swing(on) < swing(off),
    `trading swing ${swing(on)} should be under the untraded ${swing(off)}`);
});

test('off by default, so the other piano ensembles are untouched', () => {
  assert.deepEqual(
    attacks(arrangePianoFromSatb(score(), {
      chords: CHORDS, lhPattern: 'pop_arpeggio', rhPattern: 'melody_inner_voice',
      ensembleTag: 'piano_with_melody',
    } as any)),
    run(false)
  );
});

test('an explicitly chosen pattern is still honoured verbatim', () => {
  // forcePattern means the player picked the texture; trading must not override it.
  const forced = attacks(arrangePianoFromSatb(score(), {
    chords: CHORDS, lhPattern: 'pop_arpeggio', rhPattern: 'melody_inner_voice',
    ensembleTag: 'piano_with_melody', handRoleTrading: true, forcePattern: true,
  } as any));
  const [moving, held] = forced;
  assert.equal(moving!.lh, held!.lh, 'a forced left-hand pattern should not vary by bar');
});
