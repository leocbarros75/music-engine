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
