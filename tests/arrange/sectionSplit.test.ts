import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSectionParts } from '../../src/arrange/orchestra/worshipOrchestraArranger';

/**
 * One player, one staff.
 *
 * The chart layout puts two players on a line — "Horn 1-2", "Cello-Bass" — which
 * is right for a worship chart and costs two things in an orchestral score. The
 * reader has to work out which note is theirs, and, more concretely, a shared
 * staff cannot be given written breaths: the breathing pass sees a section,
 * marks "stagger breathing", and leaves the line unbroken. Our winds and brass
 * ran 74 beats without a written break where the reference never exceeds 3.875.
 */

const note = (t: number, midi: number) => ({
  id: `n${midi}@${t}`, t, dur: 1, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 },
});
const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
const score = (parts: any[]) => ({ score_id: 's', meta: {}, global: { divisions: 4 }, parts } as any);
const midisOf = (score: any, name: string) => {
  const p = score.parts.find((x: any) => x.name === name);
  assert(p, `no part named ${name}: ${score.parts.map((x: any) => x.name).join(', ')}`);
  return p.measures.flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note').map((e: any) => e.midi));
};

test('a two-note staff becomes two players, high to the first', () => {
  const s = score([{
    part_id: 'P_HN12', name: 'Horn 1-2', instrument: 'horn_f', staves: 1,
    measures: [bar(1, [note(0, 67), note(0, 60), note(1, 65), note(1, 58)])],
  }]);
  assert.equal(splitSectionParts(s), 1);
  assert.deepEqual(midisOf(s, 'Horn 1'), [67, 65], 'Horn 1 should take the upper notes');
  assert.deepEqual(midisOf(s, 'Horn 2'), [60, 58], 'Horn 2 should take the lower notes');
  assert(!s.parts.find((p: any) => p.name === 'Horn 1-2'), 'the shared staff is still there');
});

test('where only one note is written, both players have it', () => {
  // A single note on a two-player staff is played by both, not by the first alone.
  const s = score([{
    part_id: 'P_HN12', name: 'Horn 1-2', instrument: 'horn_f', staves: 1,
    measures: [bar(1, [note(0, 64)])],
  }]);
  splitSectionParts(s);
  assert.deepEqual(midisOf(s, 'Horn 1'), [64]);
  assert.deepEqual(midisOf(s, 'Horn 2'), [64]);
});

test('a unison staff gives both players the line, each in their own register', () => {
  // Flute/Oboe carries ONE line. Both take it, but an oboe cannot live where a
  // flute can, so the copy is placed by octaves into its own range.
  const s = score([{
    part_id: 'P_LOWBR', name: 'Trombone 3/Tuba', instrument: 'tuba_c', staves: 1,
    measures: [bar(1, [note(0, 50), note(1, 48), note(2, 46), note(3, 47)])],
  }]);
  splitSectionParts(s);
  const tbn = midisOf(s, 'Trombone 3');
  const tu = midisOf(s, 'Tuba');
  assert.equal(tbn.length, 4, 'the trombone lost notes');
  assert.equal(tu.length, 4, 'the tuba lost notes');
  // Same line, so the shape must be identical whatever octave each sits in.
  const shape = (v: number[]) => v.map((m, i) => (i ? m - v[i - 1]! : 0));
  assert.deepEqual(shape(tu), shape(tbn), 'the tuba is not playing the same line');
});

test('a copied line moves by whole octaves, never note by note', () => {
  // Clamping each note on its own would drop only the high ones and tear
  // octave holes through the middle of a phrase.
  const s = score([{
    part_id: 'P_FLOB', name: 'Flute/Oboe', instrument: 'flute', staves: 1,
    measures: [bar(1, [note(0, 84), note(1, 86), note(2, 88), note(3, 89)])],
  }]);
  splitSectionParts(s);
  const fl = midisOf(s, 'Flute');
  const ob = midisOf(s, 'Oboe');
  const deltas = ob.map((m: number, i: number) => m - fl[i]!);
  assert(
    deltas.every((d: number) => d === deltas[0] && d % 12 === 0),
    `the oboe line was reshaped rather than transposed: ${deltas.join(' ')}`
  );
});

test('no orchestral staff carries a saxophone label', () => {
  // "Trumpet 2-3 (Alto Sax)" is the worship band's doubling cue. It does not
  // belong on an orchestral part, and it made the family audit read three brass
  // staves as woodwinds.
  const s = score([
    { part_id: 'P_TPT23', name: 'Trumpet 2-3', instrument: 'trumpet_bb_2', staves: 1,
      measures: [bar(1, [note(0, 72), note(0, 67)])] },
    { part_id: 'P_TBN12', name: 'Trombone 1-2', instrument: 'trombone', staves: 1,
      measures: [bar(1, [note(0, 60), note(0, 55)])] },
  ]);
  splitSectionParts(s);
  for (const p of s.parts) {
    assert(!/sax/i.test(String(p.name)), `"${p.name}" still carries a sax label`);
  }
  assert.deepEqual(
    s.parts.map((p: any) => p.name),
    ['Trumpet 2', 'Trumpet 3', 'Trombone 1', 'Trombone 2']
  );
});

test('parts that are already one player are left untouched', () => {
  const solo = { part_id: 'P_TPT1', name: 'Trumpet 1', instrument: 'trumpet_bb_1', staves: 1,
    measures: [bar(1, [note(0, 72)])] };
  const s = score([solo]);
  assert.equal(splitSectionParts(s), 0, 'nothing should have been split');
  assert.equal(s.parts.length, 1);
  assert.equal(s.parts[0], solo, 'the part object was rebuilt for no reason');
});
