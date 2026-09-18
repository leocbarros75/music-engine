import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeWoodwindQuartetFromPianoInstrumentation } from '../../src/arrange/arrangeWoodwindQuartetFromPianoInstrumentation';
import { resolveTiesWithinPart } from '../../src/arrange/tieResolution';
import { pitchToMidi } from '../../src/instruments/instrumentCatalog';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiToPitch = (m: number) => {
  const n = NAMES[((m % 12) + 12) % 12]!;
  return { step: n[0]!, ...(n.length > 1 ? { alter: n[1] === '#' ? 1 : -1 } : {}), octave: Math.floor(m / 12) - 1 };
};

const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const,
  pitch: midiToPitch(midi), voice: 1, staff: 1, ...extra,
});

/** A one-part score whose measures hold the given events. */
const part = (bars: any[][]) => ({
  part_id: 'P1', name: 'Flute', instrument: 'flute', staves: 1,
  measures: bars.map((events, i) => ({
    number: i + 1,
    ...(i === 0 ? { attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 } } : {}),
    events,
  })),
});

const tiesOf = (p: any) =>
  p.measures.flatMap((m: any) => (m.events ?? []).map((e: any) =>
    `${e.tieStop ? '<' : ''}${e.midi}${e.tieStart ? '>' : ''}`));

// ── Ties that no longer bind anything ───────────────────────────────────────

test('a tie whose continuation is the same pitch is left alone', () => {
  const p = part([[note(0, 4, 72, { tieStart: true })], [note(0, 4, 72, { tieStop: true })]]);
  assert.equal(resolveTiesWithinPart(p, pitchToMidi), 0);
  assert.deepEqual(tiesOf(p), ['72>', '<72']);
});

test('a tie whose continuation never arrives is dropped', () => {
  // The second segment went to another instrument, or a cap dropped it. The
  // note stays; the bind that describes nothing does not.
  const p = part([[note(0, 4, 72, { tieStart: true })], [note(0, 4, 67)]]);
  assert.equal(resolveTiesWithinPart(p, pitchToMidi), 1);
  assert.deepEqual(tiesOf(p), ['72', '67']);
});

test('a tie stop with nothing before it is dropped', () => {
  const p = part([[note(0, 4, 67)], [note(0, 4, 72, { tieStop: true })]]);
  assert.equal(resolveTiesWithinPart(p, pitchToMidi), 1);
  assert.deepEqual(tiesOf(p), ['67', '72']);
});

test('a tie between two different octaves is not a tie', () => {
  // The de-crossing pass moves octaves after assignment, so a chain can end up
  // binding two pitches that are no longer the same note.
  const p = part([[note(0, 4, 72, { tieStart: true })], [note(0, 4, 60, { tieStop: true })]]);
  assert.equal(resolveTiesWithinPart(p, pitchToMidi), 2);
  assert.deepEqual(tiesOf(p), ['72', '60']);
});

test('a chain of three survives intact, and loses only the broken link', () => {
  const whole = part([
    [note(0, 4, 72, { tieStart: true })],
    [note(0, 4, 72, { tieStart: true, tieStop: true })],
    [note(0, 4, 72, { tieStop: true })],
  ]);
  assert.equal(resolveTiesWithinPart(whole, pitchToMidi), 0);

  const broken = part([
    [note(0, 4, 72, { tieStart: true })],
    [note(0, 4, 65)],
    [note(0, 4, 72, { tieStop: true })],
  ]);
  assert.equal(resolveTiesWithinPart(broken, pitchToMidi), 2, 'the orphaned start and stop both go');
  assert.deepEqual(tiesOf(broken), ['72', '65', '72']);
});

test('ties within one bar are judged the same way', () => {
  const p = part([[note(0, 2, 72, { tieStart: true }), note(2, 2, 72, { tieStop: true })]]);
  assert.equal(resolveTiesWithinPart(p, pitchToMidi), 0);
});

// ── A chord is marked once and means the whole chord ────────────────────────

const piano = (rh: any[], lh: any[]) => ({
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 2,
    measures: [{
      number: 1,
      attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 },
      events: [...rh.map((e) => ({ ...e, staff: 1, voice: 1 })), ...lh.map((e) => ({ ...e, staff: 2, voice: 2 }))],
    }],
  }],
  meta: {},
} as any);

const marksIn = (score: any, id: string) =>
  (score.parts.find((p: any) => p.part_id === id)?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note')
    .map((e: any) => (e.articulations ?? []).join(','));

test('an accent written on one notehead reaches every instrument taking that chord', () => {
  // A piano engraver marks the stack once. Split across four players, only the
  // one who got that note used to see it.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano(
      [note(0, 4, 72, { articulations: ['accent'] }), note(0, 4, 76), note(0, 4, 79)],
      [note(0, 4, 48), note(0, 4, 55)]
    ), {});
  assert.deepEqual(marksIn(out, 'P_FL'), ['accent'], 'flute has the top note, which was unmarked');
  assert.deepEqual(marksIn(out, 'P_OB'), ['accent']);
});

test('marks on different noteheads are combined, not chosen between', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano(
      [note(0, 4, 72, { articulations: ['staccato'] }), note(0, 4, 76, { articulations: ['accent'] })],
      [note(0, 4, 48)]
    ), {});
  for (const id of ['P_FL', 'P_OB']) {
    const got = marksIn(out, id)[0]!.split(',').sort();
    assert.deepEqual(got, ['accent', 'staccato'], `${id} should carry both`);
  }
});

test('an unmarked chord stays unmarked', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 72), note(0, 4, 76)], [note(0, 4, 48)]), {});
  for (const id of ['P_FL', 'P_OB', 'P_CL', 'P_BN'])
    assert.deepEqual(marksIn(out, id), [''], `${id} should have no articulations`);
});

test('the left hand is marked from its own chord, not the right hand\'s', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano(
      [note(0, 4, 72, { articulations: ['accent'] }), note(0, 4, 76)],
      [note(0, 4, 48, { articulations: ['staccato'] }), note(0, 4, 55)]
    ), {});
  assert.deepEqual(marksIn(out, 'P_BN'), ['staccato']);
  assert.deepEqual(marksIn(out, 'P_CL'), ['staccato'], 'clarinet is on the left hand here');
  assert.deepEqual(marksIn(out, 'P_FL'), ['accent']);
});

// ── A left hand is not a bass clef by another name ──────────────────────────

test('a left hand up in treble register is not folded into bass register', () => {
  // Bars 33-38 of the reference put the whole left hand at B3 and above: an
  // inner figure, not a bass line. Folding it to the bassoon's preferred
  // register turned B3 into B2 — a different musical function, not a register
  // choice. The bassoon can play it where it stands.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 78), note(0, 4, 81)], [note(0, 4, 71), note(0, 4, 74)]), {});
  const bn = (out.parts.find((p: any) => p.part_id === 'P_BN')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(bn, [71], 'the bassoon keeps B3 rather than dropping to B2');
});

test('a left hand that does contain bass is still placed as bass', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 72), note(0, 4, 76)], [note(0, 4, 40), note(0, 4, 55)]), {});
  const bn = (out.parts.find((p: any) => p.part_id === 'P_BN')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(bn, [40], 'a real bass note is left alone');
});

test('one treble note above a low one is still a bass group', () => {
  // The rule asks whether the hand has ANY bass, not whether some note is high.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 72)], [note(0, 4, 43), note(0, 4, 64)]), {});
  const bn = (out.parts.find((p: any) => p.part_id === 'P_BN')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(bn, [43]);
});

test('the bassoon stays inside its range even when the octave is kept', () => {
  // Keeping the written octave waives the PREFERENCE, never the instrument.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 96)], [note(0, 4, 88), note(0, 4, 91)]), {});
  const bn = (out.parts.find((p: any) => p.part_id === 'P_BN')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert(bn.every((m: number) => m >= 34 && m <= 74), `out of range: ${bn.join(',')}`);
});

// ── A preferred ceiling is a p90, not a limit ───────────────────────────────

test('a note just over the preferred ceiling keeps its octave', () => {
  // The flute's preferred ceiling is 88, taken as the p90 of three real wind
  // scores — a tenth of the notes in them are already above it. Dropping a
  // melody an octave to save two semitones of that loses the top of the phrase.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 90), note(0, 4, 81)], [note(0, 4, 71), note(0, 4, 74)]), {});
  const fl = (out.parts.find((p: any) => p.part_id === 'P_FL')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(fl, [90], 'F#6 stays where it was written');
});

test('a note far above the ceiling is still brought down', () => {
  // Beyond a major third the fold is doing real work, not losing a phrase.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 96), note(0, 4, 81)], [note(0, 4, 48)]), {});
  const fl = (out.parts.find((p: any) => p.part_id === 'P_FL')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(fl, [84], 'an octave down, comfortably inside the preferred band');
});

test('a note under the preferred floor is still lifted', () => {
  // The slack is one-directional. A note below the floor is weak or
  // unspeakable there, so moving it up remains a real improvement.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 62), note(0, 4, 64)], [note(0, 4, 48)]), {});
  const fl = (out.parts.find((p: any) => p.part_id === 'P_FL')?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch));
  assert.deepEqual(fl, [76], 'lifted out of the breathy bottom octave');
});

test('the right hand is not pushed below the left', () => {
  // The failure this fixes: folding the melody down inverted the texture, and
  // the de-crossing pass then dragged the inner voices down after it.
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(
    piano([note(0, 4, 78), note(0, 4, 81), note(0, 4, 90)], [note(0, 4, 71), note(0, 4, 74)]), {});
  const at = (id: string) => (out.parts.find((p: any) => p.part_id === id)?.measures[0]?.events ?? [])
    .filter((e: any) => e.type === 'note').map((e: any) => pitchToMidi(e.pitch))[0];
  assert.deepEqual([at('P_FL'), at('P_OB'), at('P_CL'), at('P_BN')], [90, 81, 74, 71],
    'the quartet reproduces the piano, top to bottom, with no folding at all');
});
