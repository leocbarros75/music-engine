import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPlayabilityAudit, playabilitySentence } from '../../src/preservation/playability';

/**
 * The arranger's report on its own work, in the terms a player would use.
 *
 * The engine produced parts that ran 248 beats without a rest or a breath mark
 * and said nothing about it. Every number needed to catch that was computed
 * along the way and discarded.
 */

const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 }, ...extra,
});
const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
const score = (parts: any[]) => ({
  score_id: 's', meta: { ensemble: 'test' }, global: { divisions: 4 }, parts,
} as any);
/** n bars of one unbroken whole note — what the engine used to produce. */
const held = (name: string, instrument: string, bars: number, midi = 72) => ({
  part_id: `P_${name}`, name, instrument, staves: 1,
  measures: Array.from({ length: bars }, (_, i) => bar(i + 1, [note(0, 4, midi)])),
});

test('a part that never stops is reported as never stopping', () => {
  // The regression that matters. An earlier version dropped the FINAL run to
  // ignore the closing fermata — and a part that never breaks has exactly one
  // run, so the worst case in the engine's history came back as 0.00 beats.
  const a = buildPlayabilityAudit(score([held('Flute', 'flute', 20)]));
  assert.equal(a.parts[0]!.maxContinuousBeatsExceptFinal, 80,
    'twenty bars of unbroken sound is eighty beats, not zero');
});

test('the closing chord is not counted against the players', () => {
  // Four bars of sound, a rest, then a held close. The close is a cutoff the
  // players agree between them; counting it would flag every piece ever.
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: [
      ...Array.from({ length: 4 }, (_, i) => bar(i + 1, [note(0, 4, 72)])),
      bar(5, []),
      bar(6, [note(0, 4, 72)]),
    ],
  };
  const a = buildPlayabilityAudit(score([p]));
  assert.equal(a.parts[0]!.maxContinuousBeatsExceptFinal, 16, 'the four bars, not the close');
});

test('a breath mark ends the stretch — the player takes the time', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: [
      bar(1, [note(0, 4, 72)]),
      bar(2, [note(0, 4, 72, { articulations: ['breath-mark'] })]),
      bar(3, [note(0, 4, 72)]),
      bar(4, [note(0, 4, 72)]),
    ],
  };
  const a = buildPlayabilityAudit(score([p]));
  assert.equal(a.parts[0]!.maxContinuousBeatsExceptFinal, 8, 'the comma broke it at bar 2');
  assert.equal(a.parts[0]!.breathMarks, 1);
});

test('a pianist is not short of air', () => {
  // A keyboard sustains under the pedal. A long unbroken piano line is not a
  // finding, and must never be named the worst part in the score.
  const a = buildPlayabilityAudit(score([
    held('Piano', 'piano', 30, 60),
    held('Oboe', 'oboe', 4, 72),
  ]));
  assert.equal(a.worst!.part, 'Oboe', `worst was ${a.worst!.part}`);
  const piano = a.parts.find((p) => p.part === 'Piano')!;
  assert.equal(piano.maxContinuousBeatsExceptFinal, 120, 'still reported honestly in its own row');
});

test('a note the instrument cannot play is a fault, not a choice', () => {
  // A flute cannot sound two octaves below its bottom note.
  const a = buildPlayabilityAudit(score([{
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: [bar(1, [note(0, 2, 30), note(2, 2, 74)])],
  }]));
  assert.equal(a.totalOutOfRange, 1);
  assert.equal(a.parts[0]!.outOfRange, 1);
  assert.match(playabilitySentence(a), /outside the instrument/);
});

test('range and event counts describe what is actually there', () => {
  const a = buildPlayabilityAudit(score([{
    part_id: 'P_TP', name: 'Trumpet 1', instrument: 'trumpet_bb_1', staves: 1,
    measures: [bar(1, [note(0, 1, 60), note(1, 1, 72), note(2, 2, 67)]), bar(2, [])],
  }]));
  const p = a.parts[0]!;
  assert.equal(p.events, 3);
  assert.equal(p.lowSoundingMidi, 60);
  assert.equal(p.highSoundingMidi, 72);
  assert.equal(p.silentBars, 1);
  assert.equal(p.totalBars, 2);
});

test('a clean score says so plainly', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: [bar(1, [note(0, 2, 72)]), bar(2, [note(0, 2, 72)]), bar(3, [note(0, 2, 72)])],
  };
  const a = buildPlayabilityAudit(score([p]));
  assert.equal(a.totalOutOfRange, 0);
  assert.match(playabilitySentence(a, 71), /longest stretch without air/);
});
