import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeBrassQuintetFromPianoInstrumentation } from '../../src/arrange/arrangeBrassQuintetFromPianoInstrumentation';
import { pitchToMidi } from '../../src/instruments/instrumentCatalog';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const midiToPitch = (m: number) => {
  const n = NAMES[((m % 12) + 12) % 12]!;
  return { step: n[0]!, ...(n.length > 1 ? { alter: n[1] === '#' ? 1 : -1 } : {}), octave: Math.floor(m / 12) - 1 };
};
const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, pitch: midiToPitch(midi), ...extra,
});

const piano = (bars: Array<{ rh: any[]; lh: any[] }>) => ({
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 2,
    measures: bars.map((bar, i) => ({
      number: i + 1,
      ...(i === 0 ? { attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 } } : {}),
      events: [
        ...bar.rh.map((e) => ({ ...e, staff: 1, voice: 1 })),
        ...bar.lh.map((e) => ({ ...e, staff: 2, voice: 2 })),
      ],
    })),
  }],
  meta: {},
} as any);

const notesIn = (score: any, id: string, bar = 0) =>
  (score.parts.find((p: any) => p.part_id === id)?.measures[bar]?.events ?? [])
    .filter((e: any) => e.type === 'note')
    .sort((a: any, b: any) => a.t - b.t);
const midisIn = (score: any, id: string, bar = 0) => notesIn(score, id, bar).map((e: any) => pitchToMidi(e.pitch));

test('a triplet keeps its own onsets rather than the 1/64 grid', () => {
  const third = 2 / 3;
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([{
    rh: [0, 1, 2, 3, 4, 5].map((i) => note(i * third, third, 72 + i)),
    lh: [note(0, 4, 40)],
  }]), {});
  const tp1 = notesIn(out, 'P_TP1');
  assert.equal(tp1.length, 6);
  for (let i = 0; i < 6; i++)
    assert(Math.abs(Number(tp1[i].t) - i * third) < 1e-9, `onset ${i} moved to ${tp1[i].t}`);
});

test('no brass voice is asked to play two notes at once', () => {
  // A held chord with a figure running over it: MusicXML can write only one of
  // them on a staff line, so the figure used to vanish.
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([{
    rh: [note(0, 4, 76), note(0, 4, 71), note(0, 4, 67),
      ...[0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((t) => note(t, 0.5, 74))],
    lh: [note(0, 4, 40)],
  }]), {});
  for (const id of ['P_TP1', 'P_TP2', 'P_HN', 'P_TBN', 'P_TUBA']) {
    const ns = notesIn(out, id);
    for (let i = 1; i < ns.length; i++)
      assert(Number(ns[i - 1].t) + Number(ns[i - 1].dur) <= Number(ns[i].t) + 1e-9,
        `${id}: a note at ${ns[i - 1].t} overruns the attack at ${ns[i].t}`);
  }
});

test('an accent on one notehead reaches every voice taking that chord', () => {
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([{
    rh: [note(0, 4, 72, { articulations: ['accent'] }), note(0, 4, 76), note(0, 4, 79)],
    lh: [note(0, 4, 40)],
  }]), {});
  for (const id of ['P_TP1', 'P_TP2', 'P_HN']) {
    const marks = notesIn(out, id)[0]?.articulations ?? [];
    assert.deepEqual(marks, ['accent'], `${id} should carry the chord's accent`);
  }
});

test('a tie whose continuation never arrives is not written', () => {
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([
    { rh: [note(0, 4, 72, { tieStart: true })], lh: [note(0, 4, 40)] },
    { rh: [note(0, 4, 67)], lh: [note(0, 4, 40)] },
  ]), {});
  const first = notesIn(out, 'P_TP1', 0)[0];
  assert.equal(first.tieStart, undefined, 'no tie into empty air');
});

test('a left hand that does contain bass is still placed as bass', () => {
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([{
    rh: [note(0, 4, 72), note(0, 4, 76)],
    lh: [note(0, 4, 40), note(0, 4, 55)],
  }]), {});
  assert.deepEqual(midisIn(out, 'P_TUBA'), [40], 'a real bass note is left alone');
});

test('every voice stays inside its own range', () => {
  const RANGES: Record<string, [number, number]> = {
    P_TP1: [52, 86], P_TP2: [52, 84], P_HN: [35, 77], P_TBN: [40, 72], P_TUBA: [26, 58],
  };
  const out = arrangeBrassQuintetFromPianoInstrumentation(piano([{
    rh: [note(0, 4, 96), note(0, 4, 91), note(0, 4, 88)],
    lh: [note(0, 4, 71), note(0, 4, 74)],
  }]), {});
  for (const [id, [lo, hi]] of Object.entries(RANGES))
    for (const m of midisIn(out, id))
      assert(m >= lo && m <= hi, `${id} played ${m}, outside ${lo}-${hi}`);
});
