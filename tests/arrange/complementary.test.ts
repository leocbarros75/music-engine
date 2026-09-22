import assert from 'node:assert/strict';
import { test } from 'node:test';
import { withPianoPart, densityCurve, planArc, applyArc } from '../../src/arrange/complementary';

const note = (t: number, midi: number) => ({
  id: `n${midi}@${t}`, t, dur: 1, midi, type: 'note' as const,
  pitch: { step: 'C', octave: 4 }, voice: 1, staff: 1,
});
/** A measure holding `n` notes — density is a count, the pitches do not matter. */
const bar = (number: number, n: number) => ({
  number, events: Array.from({ length: n }, (_, i) => note(i, 60 + i)),
});
const part = (id: string, bars: any[]) => ({ part_id: id, name: id, measures: bars });

// ── The piano stays in the score ────────────────────────────────────────────

test('the piano is added to the parts it accompanies', () => {
  const strings = [part('P_V1', []), part('P_VC', [])];
  const piano = part('P_PNO', []);
  const out = withPianoPart(strings, piano);
  assert.equal(out.length, 3);
  assert.equal(out[out.length - 1], piano, 'at the foot of the score, under the players added to it');
});

test('a missing piano leaves the parts alone rather than adding a hole', () => {
  const strings = [part('P_V1', [])];
  assert.deepEqual(withPianoPart(strings, null), strings);
});

test('a piano already present is not duplicated', () => {
  const piano = part('P_PNO', []);
  const parts = [part('P_V1', []), piano];
  assert.equal(withPianoPart(parts, piano).length, 2);
  assert.equal(withPianoPart(parts, { part_id: 'P_PNO', measures: [] }).length, 2, 'matched by id too');
});

// ── Reading where the music opens up ────────────────────────────────────────

test('density is measured against the piece, not an absolute', () => {
  // Same shape, different absolute sizes: a quiet piece is not permanently
  // "thin" just because nobody ever plays twelve notes at once.
  const small = densityCurve([bar(1, 1), bar(2, 2), bar(3, 4)]);
  const large = densityCurve([bar(1, 5), bar(2, 10), bar(3, 20)]);
  assert.deepEqual(small.map((x) => Math.round(x * 100)), large.map((x) => Math.round(x * 100)));
});

test('an empty score produces a flat curve rather than a division by zero', () => {
  assert.deepEqual(densityCurve([bar(1, 0), bar(2, 0)]), [0, 0]);
});

// ── The arc ─────────────────────────────────────────────────────────────────

const voices = ['V1', 'V2', 'VA', 'VC'];
/** A piece that starts thin and opens out, which is what a verse into a chorus does. */
const opening = [
  ...Array.from({ length: 4 }, (_, i) => bar(i + 1, 2)),
  ...Array.from({ length: 8 }, (_, i) => bar(i + 5, 12)),
];

test('the piano has the opening to itself', () => {
  const arc = planArc(opening, { voicesTopDown: voices, openBars: 1 });
  assert.equal(arc[0]!.playing.size, 0, 'nobody joins in bar 1');
});

test('the ensemble arrives rather than switching on', () => {
  const arc = planArc(opening, { voicesTopDown: voices, openBars: 1 });
  const entry = (v: string) => arc.findIndex((a) => a.playing.has(v)) + 1;
  assert(entry('V2') < entry('V1'), 'an inner voice is in before the top one');
  assert(entry('VA') < entry('V1'), 'so is the other inner voice');
  assert(entry('V1') > 1, 'the top voice waits');
});

test('thin writing keeps the inner voices and rests the outer ones', () => {
  // The inner voices sustain harmony; the top competes with the melody and the
  // bottom adds weight the passage has not asked for.
  const arc = planArc(opening, { voicesTopDown: voices, openBars: 1 });
  const thin = arc[3]!;   // bar 4, still 2 notes per bar
  assert(!thin.playing.has('V1'), 'the top voice sits out thin writing');
  assert(!thin.playing.has('VC'), 'so does the bottom');
});

test('everyone plays where the music opens up', () => {
  const arc = planArc(opening, { voicesTopDown: voices, openBars: 1 });
  const full = arc[arc.length - 1]!;
  for (const v of voices) assert(full.playing.has(v), `${v} should be in at full density`);
});

test('a part does not flicker in and out for a single bar', () => {
  // One bar of sound between two of rest reads as a mistake, not as phrasing.
  const jagged = [bar(1, 12), bar(2, 1), bar(3, 12), bar(4, 1), bar(5, 12), bar(6, 12), bar(7, 12), bar(8, 12)];
  const arc = planArc(jagged, { voicesTopDown: voices, openBars: 0 });
  for (const v of voices)
    for (let i = 1; i < arc.length - 1; i++) {
      const alone = arc[i]!.playing.has(v) && !arc[i - 1]!.playing.has(v) && !arc[i + 1]!.playing.has(v);
      const gap = !arc[i]!.playing.has(v) && arc[i - 1]!.playing.has(v) && arc[i + 1]!.playing.has(v);
      assert(!alone, `${v} plays a single isolated bar at ${i + 1}`);
      assert(!gap, `${v} rests a single isolated bar at ${i + 1}`);
    }
});

// ── Applying it ─────────────────────────────────────────────────────────────

test('a bar the arc rests is emptied, and one it keeps is untouched', () => {
  const p = part('V1', [bar(1, 3), bar(2, 3)]);
  const arc = [
    { playing: new Set<string>(), intensity: 0 },
    { playing: new Set(['V1']), intensity: 1 },
  ];
  const rested = applyArc([p], arc);
  assert.equal(p.measures[0]!.events.length, 0, 'rested');
  assert.equal(p.measures[1]!.events.length, 3, 'kept');
  assert.equal(rested.get('V1'), 1, 'and it is reported');
});

test('an already-empty bar is not counted as newly rested', () => {
  const p = part('V1', [bar(1, 0)]);
  const rested = applyArc([p], [{ playing: new Set<string>(), intensity: 0 }]);
  assert.equal(rested.get('V1'), 0, 'nothing was taken away');
});

test('a part the arc says nothing about keeps all its notes', () => {
  const p = part('V1', [bar(1, 3), bar(2, 3)]);
  applyArc([p], []);
  assert.equal(p.measures[0]!.events.length, 3);
  assert.equal(p.measures[1]!.events.length, 3);
});

// ── Holding a note rather than re-striking it ───────────────────────────────

import { sustainForBowing, bowLengthBeats, quarterBpmOf } from '../../src/arrange/complementary';

test('a bow length follows the tempo, not a constant', () => {
  // The same couple of seconds is a different note value at each speed.
  assert.equal(bowLengthBeats(71), 2, 'a half note at 71 runs about 1.7 seconds');
  assert.equal(bowLengthBeats(120), 3, 'faster, and a dotted half fills the same bow');
  assert.equal(bowLengthBeats(60), 1.5, 'slower, and a dotted quarter already does');
  assert.equal(bowLengthBeats(0), 2, 'a nonsense tempo falls back to a sane default, not to nothing');
});

test('the tempo is read from the score when it says', () => {
  assert.equal(quarterBpmOf([{ number: 1, performance: { tempos: [{ t: 0, bpm: 71 }] }, events: [] }]), 71);
  assert.equal(quarterBpmOf([{ number: 1, events: [] }]), null, 'and is not invented when it does not');
});

const at = (t: number, dur: number, midi: number) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const,
  pitch: { step: 'C', octave: 4 }, voice: 1, staff: 1,
});
const onePart = (events: any[]) => [{ part_id: 'V1', name: 'V1', measures: [{ number: 1, events }] }];
const durs = (p: any[]) => p[0].measures[0].events.map((e: any) => `${e.t}+${e.dur}`);

test('a note struck four times becomes two bow lengths', () => {
  const p = onePart([at(0, 1, 60), at(1, 1, 60), at(2, 1, 60), at(3, 1, 60)]);
  const removed = sustainForBowing(p, 2);
  assert.deepEqual(durs(p), ['0+2', '2+2']);
  assert.equal(removed, 2, 'four attacks became two');
});

test('the last piece takes the remainder, so the span still ends where it did', () => {
  const p = onePart([at(0, 1, 60), at(1, 1, 60), at(2, 1, 60)]);
  sustainForBowing(p, 2);
  assert.deepEqual(durs(p), ['0+2', '2+1'], 'three beats, not four');
});

test('a part that is actually moving keeps every note', () => {
  // Only REPEATED pitches are held. Melody is not thinned.
  const p = onePart([at(0, 1, 60), at(1, 1, 62), at(2, 1, 64), at(3, 1, 65)]);
  assert.equal(sustainForBowing(p, 2), 0);
  assert.deepEqual(durs(p), ['0+1', '1+1', '2+1', '3+1']);
});

test('a gap breaks the hold — a rest is not something to play through', () => {
  const p = onePart([at(0, 1, 60), at(2, 1, 60)]);
  assert.equal(sustainForBowing(p, 2), 0, 'not contiguous, so not one note');
  assert.deepEqual(durs(p), ['0+1', '2+1']);
});

test('two pitches sounding together are held independently', () => {
  // A divisi stack is several streams that happen to share onsets.
  const p = onePart([at(0, 1, 60), at(0, 1, 67), at(1, 1, 60), at(1, 1, 67)]);
  sustainForBowing(p, 2);
  const events = p[0].measures[0].events;
  assert.equal(events.length, 2, 'one held note per pitch');
  assert.deepEqual(events.map((e: any) => e.midi).sort(), [60, 67]);
  assert(events.every((e: any) => e.dur === 2));
});

test('a held note is written as separate strokes, never as a tie', () => {
  // A renewed bow is the point. A tie would ask one player to hold the phrase
  // in a single stroke.
  const p = onePart([at(0, 1, 60), at(1, 1, 60), at(2, 1, 60), at(3, 1, 60)]);
  sustainForBowing(p, 2);
  for (const e of p[0].measures[0].events) {
    assert(!e.tieStart, 'no tie out');
    assert(!e.tieStop, 'no tie in');
  }
});

test('a single note is left exactly as it was', () => {
  const p = onePart([at(0, 4, 60)]);
  assert.equal(sustainForBowing(p, 2), 0);
  assert.deepEqual(durs(p), ['0+4']);
});

// ── A short answer at the end of a phrase ───────────────────────────────────

import { addAnsweringGestures } from '../../src/arrange/complementary';

const held = (t: number, dur: number, midi: number) => ({
  id: `h${midi}@${t}`, t, dur, midi, type: 'note' as const,
  pitch: { step: 'E', octave: 5 }, voice: 1, staff: 1,
});
const mkPart = (id: string, bars: any[][]) =>
  ({ part_id: id, name: id, measures: bars.map((events, i) => ({ number: i + 1, events })) });
const fullArc = (n: number, intensity = 1) =>
  Array.from({ length: n }, () => ({ playing: new Set(['V1', 'V2']), intensity }));
/** A top voice holding two half notes per bar, over an inner voice. */
const sustaining = (bars: number) => [
  mkPart('V1', Array.from({ length: bars }, () => [held(0, 2, 76), held(2, 2, 76)])),
  mkPart('V2', Array.from({ length: bars }, () => [held(0, 4, 72)])),
];
const barOf = (p: any, i: number) =>
  p.measures[i].events.slice().sort((a: any, b: any) => a.t - b.t).map((e: any) => `${e.t}+${e.dur}:${e.midi}`);

test('the answer is a quarter and two quavers over the last two beats', () => {
  const parts = sustaining(1);
  assert.equal(addAnsweringGestures(parts, fullArc(1)), 3);
  assert.deepEqual(barOf(parts[0], 0), ['0+2:76', '2+1:76', '3+0.5:72', '3.5+0.5:76']);
});

test('it steps away and comes back', () => {
  const parts = sustaining(1);
  addAnsweringGestures(parts, fullArc(1));
  const tail = parts[0].measures[0].events.filter((e: any) => e.t >= 2);
  assert.equal(tail[0].midi, 76, 'starts on the note it was holding');
  assert.notEqual(tail[1].midi, 76, 'leans away');
  assert.equal(tail[2].midi, 76, 'and returns');
});

test('one slur covers the whole gesture', () => {
  const parts = sustaining(1);
  addAnsweringGestures(parts, fullArc(1));
  const tail = parts[0].measures[0].events.filter((e: any) => e.t >= 2);
  assert.equal(tail[0].slurStart, true);
  assert.equal(tail[2].slurStop, true);
  assert(!tail[1].slurStart && !tail[1].slurStop, 'the middle note is inside it');
});

test('the step-away note gets a spelling of its own', () => {
  // Reusing the held note's pitch would print the wrong notehead at the right
  // sounding pitch.
  const parts = sustaining(1);
  addAnsweringGestures(parts, fullArc(1));
  const away = parts[0].measures[0].events.find((e: any) => e.midi !== 76);
  assert(away.pitch && away.pitch.step, 'has a pitch');
  assert.notDeepEqual(away.pitch, { step: 'E', octave: 5 }, 'and not the held note\'s');
});

test('it answers every other opportunity, not every bar', () => {
  // Answering constantly is another accompaniment competing with the melody.
  const parts = sustaining(4);
  addAnsweringGestures(parts, fullArc(4));
  const answered = [0, 1, 2, 3].filter((i) => parts[0].measures[i].events.length > 2);
  assert.deepEqual(answered, [0, 2]);
});

test('thin writing gets no answer at all', () => {
  const parts = sustaining(2);
  assert.equal(addAnsweringGestures(parts, fullArc(2, 0.2)), 0, 'the music has not opened up');
  assert.deepEqual(barOf(parts[0], 0), ['0+2:76', '2+2:76']);
});

test('a bar the top voice is resting gets no answer', () => {
  const parts = sustaining(1);
  const arc = [{ playing: new Set(['V2']), intensity: 1 }];
  assert.equal(addAnsweringGestures(parts, arc as any), 0);
});

test('a part already moving in the tail is left to say its own thing', () => {
  const parts = [
    mkPart('V1', [[held(0, 2, 76), held(2, 1, 76), held(3, 1, 74)]]),
    mkPart('V2', [[held(0, 4, 72)]]),
  ];
  assert.equal(addAnsweringGestures(parts, fullArc(1)), 0);
});

test('the step-away pitch comes from what the ensemble is sounding', () => {
  // Not from a chord symbol: drawn from the other parts, it cannot disagree
  // with the harmony as actually voiced.
  const parts = [
    mkPart('V1', [[held(0, 2, 76), held(2, 2, 76)]]),
    mkPart('V2', [[held(0, 4, 77)]]),      // F5 — a semitone above
  ];
  addAnsweringGestures(parts, fullArc(1));
  const away = parts[0].measures[0].events.find((e: any) => e.midi !== 76);
  assert.equal(away.midi % 12, 77 % 12, 'it leans to the pitch class the ensemble has');
});

test('no harmony under it means no invented neighbour', () => {
  const parts = [mkPart('V1', [[held(0, 2, 76), held(2, 2, 76)]])];
  const arc = [{ playing: new Set(['V1']), intensity: 1 }];
  assert.equal(addAnsweringGestures(parts, arc as any), 0);
});

test('the bar still adds up after the answer', () => {
  const parts = sustaining(1);
  addAnsweringGestures(parts, fullArc(1));
  const total = parts[0].measures[0].events.reduce((s: number, e: any) => s + Number(e.dur), 0);
  assert.equal(total, 4);
});

test('a note carrying only its spelling is still read as a pitch', () => {
  // `midi` is a cache the model fills in later. Reading it alone treats every
  // note as unpitched, which silently disabled this pass entirely: eleven
  // eligible phrase tails, every one rejected for having no pitch.
  const noMidi = (t: number, dur: number, step: string, octave: number) => ({
    id: `x${step}${octave}@${t}`, t, dur, type: 'note' as const,
    pitch: { step, octave }, voice: 1, staff: 1,
  });
  const parts = [
    { part_id: 'V1', name: 'V1', measures: [{ number: 1, events: [noMidi(0, 2, 'E', 5), noMidi(2, 2, 'E', 5)] }] },
    { part_id: 'V2', name: 'V2', measures: [{ number: 1, events: [noMidi(0, 4, 'C', 5)] }] },
  ];
  const arc = [{ playing: new Set(['V1', 'V2']), intensity: 1 }];
  assert.equal(addAnsweringGestures(parts, arc as any), 3, 'the gesture is written');
});

test('sustain also reads a spelling-only note', () => {
  const noMidi = (t: number, dur: number) => ({
    id: `y@${t}`, t, dur, type: 'note' as const, pitch: { step: 'C', octave: 4 }, voice: 1, staff: 1,
  });
  const p = [{ part_id: 'V1', name: 'V1', measures: [{ number: 1, events: [noMidi(0, 1), noMidi(1, 1), noMidi(2, 1), noMidi(3, 1)] }] }];
  assert.equal(sustainForBowing(p, 2), 2, 'four repeats of one pitch become two');
});
