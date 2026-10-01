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

/**
 * Who can be short of air.
 *
 * This was a list of things that do NOT breathe — piano, harp, timpani — and
 * anything unlisted was assumed to. So it named a bassist as short of air after
 * 299 beats, and named violinists before that. A string section changes bow; it
 * does not breathe, which the reference edition says in as many words about its
 * own 291-beat cello line.
 *
 * The hard case is that "Bass" is a singer in one score and a bass player in
 * another, with the same part name AND the same instrument: choral emits
 * Bass[Bass] and the jazz band emits Bass[Bass]. Nothing on the part separates
 * them, so the company it keeps has to.
 */

const voice = (name: string, bars = 10) => ({
  part_id: `P_${name}`, name, instrument: name, staves: 1,
  measures: Array.from({ length: bars }, (_, i) => bar(i + 1, [note(0, 4, 60)])),
});

test('a bassist is not short of air, and a bass singer is', () => {
  // Same part name, same instrument, opposite answers.
  const band = buildPlayabilityAudit(score([
    { part_id: 'P_AS', name: 'Alto Sax', instrument: 'Alto Sax', staves: 1,
      measures: [bar(1, [note(0, 1, 72)])] },
    { part_id: 'P_TS', name: 'Tenor Sax', instrument: 'Tenor Sax', staves: 1,
      measures: [bar(1, [note(0, 1, 67)])] },
    voice('Bass', 10),
  ]));
  assert.notEqual(band.worst?.part, 'Bass',
    'the bass player was named short of air — two saxophones are not a choir');

  const choir = buildPlayabilityAudit(score([
    voice('Soprano'), voice('Alto'), voice('Tenor'), voice('Bass'),
  ]));
  assert(choir.worst, 'nobody in a choir was judged to breathe');
  assert(/soprano|alto|tenor|bass/i.test(choir.worst!.part), `got ${choir.worst!.part}`);
});

test('a string section changes bow rather than breathing', () => {
  const a = buildPlayabilityAudit(score([
    held('Violin I', 'violin_1', 30, 72),
    held('Cello', 'cello', 30, 48),
    held('Double Bass', 'double_bass', 30, 36),
  ]));
  assert.equal(a.worst, null, `a string player was named short of air: ${a.worst?.part}`);
  // Still reported honestly in their own rows.
  assert.equal(a.parts[0]!.maxContinuousBeatsExceptFinal, 120);
});

test('the wind in a mixed score is the one that gets named', () => {
  const a = buildPlayabilityAudit(score([
    held('Violin I', 'violin_1', 40, 72),   // longer, but bows
    held('Horn 2', 'horn_f', 6, 60),        // shorter, but breathes
  ]));
  assert.equal(a.worst!.part, 'Horn 2', `got ${a.worst!.part}`);
});
