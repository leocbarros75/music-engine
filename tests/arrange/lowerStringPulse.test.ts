import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pulseLowerStrings } from '../../src/arrange/strings/pulse';

/**
 * The chart's own rhythm, in the lower strings.
 *
 * On a rhythm chart our cello and bass sustained — half their notes a beat or
 * longer, sixty-one whole notes in the cello. The reference edition writes its
 * cello 92% quarter-or-shorter and its bass 97%, and the shape never varies:
 * every attack is an EIGHTH, and the rhythm is in the spacing. Its bass is
 * quarters apart in forty bars and a two-feel in twenty-five.
 *
 * The rhythm is read off the chart rather than invented. A slash bar says "play
 * the chord, THIS rhythm", and the feel carries forward into the bars that
 * notate melody instead — that is what a chart means, and stopping at the slash
 * bars left the bass pulsing for 33 bars and sustaining through the rest.
 */

const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
const note = (t: number, dur: number, midi = 40, extra: any = {}) => ({
  id: `n${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'E', octave: 2 }, ...extra,
});
const slash = (t: number, dur = 1) => note(t, dur, 60, { notehead: 'slash' });

/** A source bar whose slashes ask for attacks at `onsets`. */
const chartBar = (n: number, onsets: number[]) => bar(n, onsets.map((t) => slash(t)));
/** A source bar of notated melody — no slashes. */
const melodyBar = (n: number) => bar(n, [note(0, 1, 72), note(1, 1, 74), note(2, 2, 76)]);

const held = (name: string, bars: number) => ({
  part_id: `P_${name}`, name, instrument: name.toLowerCase(), staves: 1,
  measures: Array.from({ length: bars }, (_, i) => bar(i + 1, [note(0, 4)])),
});
const notesOf = (p: any, barIndex: number) =>
  (p.measures[barIndex].events ?? []).filter((e: any) => e.type === 'note');

test('a slash bar gives the bass the chart\'s attacks, short', () => {
  const cb = held('Double Bass', 1);
  const source = { measures: [chartBar(1, [0, 1, 2, 3])] };
  const plans = pulseLowerStrings([cb], source);
  assert.equal(plans.length, 1);
  const out = notesOf(cb, 0);
  assert.deepEqual(out.map((e: any) => e.t), [0, 1, 2, 3]);
  for (const e of out) assert.equal(e.dur, 0.5, `attack at ${e.t} is ${e.dur} long`);
});

test('the pitch is the one the voicing already chose', () => {
  // This decides length and placement. It does not pick notes.
  const cb = held('Cello', 1);
  (cb.measures[0].events[0] as any).midi = 45;
  pulseLowerStrings([cb], { measures: [chartBar(1, [0, 2])] });
  for (const e of notesOf(cb, 0)) assert.equal(e.midi, 45, 'the pulse changed the harmony');
});

test('the feel carries into the bars that notate melody', () => {
  // A band reads a slash bar and keeps that feel until told otherwise.
  const cb = held('Double Bass', 3);
  const source = { measures: [chartBar(1, [0, 2]), melodyBar(2), melodyBar(3)] };
  pulseLowerStrings([cb], source);
  for (const b of [0, 1, 2]) {
    assert.deepEqual(notesOf(cb, b).map((e: any) => e.t), [0, 2],
      `bar ${b + 1} did not keep the feel`);
  }
});

test('nothing happens before the chart has said anything', () => {
  const cb = held('Double Bass', 2);
  pulseLowerStrings([cb], { measures: [melodyBar(1), melodyBar(2)] });
  assert.deepEqual(notesOf(cb, 0).map((e: any) => e.dur), [4], 'a feel was invented');
});

test('attacks closer than an eighth do not overlap each other', () => {
  // Some slash rhythms are closer than an eighth apart, and a fixed length
  // wrote notes over each other inside one part — a line one player bows.
  const cb = held('Cello', 1);
  pulseLowerStrings([cb], { measures: [chartBar(1, [0, 0.25, 1, 3.75])] });
  const out = notesOf(cb, 0).sort((a: any, b: any) => a.t - b.t);
  for (let i = 1; i < out.length; i++) {
    assert(out[i].t >= out[i - 1].t + out[i - 1].dur - 1e-9,
      `${out[i - 1].t}+${out[i - 1].dur} runs into ${out[i].t}`);
  }
  const last = out[out.length - 1];
  assert(last.t + last.dur <= 4 + 1e-9, 'the last attack runs past the barline');
});

test('the violins are left alone', () => {
  const v1 = held('Violin I', 2);
  assert.deepEqual(pulseLowerStrings([v1], { measures: [chartBar(1, [0, 1, 2, 3]), melodyBar(2)] }), []);
  assert.deepEqual(notesOf(v1, 0).map((e: any) => e.dur), [4], 'a violin was given the pulse');
});

test('a bar the part is resting in stays resting', () => {
  const cb = held('Double Bass', 2);
  cb.measures[1].events = [];
  pulseLowerStrings([cb], { measures: [chartBar(1, [0, 2]), chartBar(2, [0, 2])] });
  assert.equal(notesOf(cb, 1).length, 0, 'the pulse filled a bar the part was sitting out');
});
