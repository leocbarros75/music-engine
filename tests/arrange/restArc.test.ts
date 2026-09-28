import assert from 'node:assert/strict';
import { test } from 'node:test';
import { restThinBars, TRANSCRIPTION_REST_LEVELS } from '../../src/arrange/strings/restArc';

/**
 * Who sits out, and where.
 *
 * The string transcription had all five parts playing all 62 bars. The source
 * gives nothing to inherit — that piano never stops in either hand — so the
 * decision rests on how thick the writing is, bar by bar.
 *
 * The figures come from the Codex piano-and-strings edition of the same song,
 * but only the ones that survive the change of role: the first violin rests 15
 * bars there and must rest none here, because there it accompanies a piano and
 * here it IS the tune. Numbers have been moved between arrangements of this song
 * twice before and did not survive the move either time, so what these tests
 * really pin is the part that is easy to get wrong: the melody keeps playing,
 * and the piece does not end by subtraction.
 */

const note = (t: number, midi: number) => ({
  id: `n${midi}@${t}`, t, dur: 1, midi, type: 'note' as const,
  voice: 1, staff: 1, pitch: { step: 'C', octave: 4 },
});

/** A source bar holding `count` notes — only the count matters to the curve. */
const sourceBar = (number: number, count: number) => ({
  number,
  attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } },
  events: Array.from({ length: count }, (_, i) => note(i * 0.25, 60 + i)),
});

/** Counts chosen so the curve is exact: p90 is 10, so 2 -> 0.20 and 1 -> 0.10. */
const SOURCE = { part_id: 'P0', name: 'Soprano', measures: [10, 10, 10, 2, 1, 10, 10].map((c, i) => sourceBar(i + 1, c)) };

const outPart = (name: string, bars = 7) => ({
  part_id: `P_${name}`, name, instrument: 'strings', staves: 1,
  measures: Array.from({ length: bars }, (_, i) => ({
    number: i + 1,
    attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } },
    events: [note(0, 60)],
  })),
});

const sounds = (part: any, bar: number) =>
  (part.measures[bar - 1].events ?? []).some((e: any) => e.type === 'note');

test('Violin I plays through the thinnest bar in the piece', () => {
  // The whole point. Bar 5 is the thinnest bar there is; the tune is still there.
  const v1 = outPart('Violin I');
  const rested = restThinBars([v1], SOURCE);
  assert.equal(rested.size, 0, 'Violin I was given rests');
  assert(sounds(v1, 5), 'the melody dropped out of the thinnest bar');
  for (let b = 1; b <= 7; b++) assert(sounds(v1, b), `Violin I is silent in bar ${b}`);
});

test('the bass sits out a thin bar and plays a full one', () => {
  const cb = outPart('Double Bass');
  restThinBars([cb], SOURCE);
  assert(!sounds(cb, 4), 'the bass played through a thin bar');
  assert(!sounds(cb, 5), 'the bass played through the thinnest bar');
  assert(sounds(cb, 1), 'the bass sat out a full bar');
  assert(sounds(cb, 3), 'the bass sat out a full bar');
});

test('the inner voices are more reserved about resting than the bass', () => {
  // Bar 4 (0.20) is thin enough for the bass but not for the second violin:
  // strings thin from the bottom up, and a cushion that leaves stops cushioning.
  const v2 = outPart('Violin II');
  const cb = outPart('Double Bass');
  restThinBars([v2, cb], SOURCE);
  assert(sounds(v2, 4), 'the second violin rested a bar only the bass should');
  assert(!sounds(cb, 4), 'the bass should have rested there');
  assert(!sounds(v2, 5), 'the second violin played the thinnest bar');
});

test('the piece does not end by subtraction', () => {
  // A thin FINAL bar is left alone: a closing chord wants its bass, and an
  // arrangement that thins out at the end sounds stopped rather than finished.
  const source = { part_id: 'P0', name: 'Soprano', measures: [10, 10, 1].map((c, i) => sourceBar(i + 1, c)) };
  const cb = outPart('Double Bass', 3);
  restThinBars([cb], source);
  assert(sounds(cb, 3), 'the bass was cut from the final bar');
});

test('a tie into a silenced bar is released, not left hanging', () => {
  const cb = outPart('Double Bass');
  (cb.measures[2].events[0] as any).tieStart = true; // bar 3 ties into bar 4
  restThinBars([cb], SOURCE);
  assert(!sounds(cb, 4), 'bar 4 should be silent');
  assert(
    !(cb.measures[2].events[0] as any).tieStart,
    'bar 3 still ties into a bar that no longer sounds'
  );
});

test('every voice that can rest has a level, and the melody has none', () => {
  const keys = Object.keys(TRANSCRIPTION_REST_LEVELS).sort();
  assert.deepEqual(keys, ['cb', 'vc', 'vla', 'vln2'],
    'Violin I must not be given a resting level');
  // Strings thin from the bottom up: each lower voice rests at least as readily.
  const { vln2, vla, vc, cb } = TRANSCRIPTION_REST_LEVELS;
  assert(vln2 <= vla && vla <= vc && vc <= cb,
    `levels are not ordered bottom-up: ${vln2} ${vla} ${vc} ${cb}`);
});
