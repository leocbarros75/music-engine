import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeWoodwindQuartetFromPianoInstrumentation } from '../../src/arrange/arrangeWoodwindQuartetFromPianoInstrumentation';

/** A two-staff piano part; `rh`/`lh` are [onset, duration, midi] triples. */
const piano = (bars: Array<{ rh: Array<[number, number, number]>; lh: Array<[number, number, number]> }>) => ({
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 2,
    measures: bars.map((bar, i) => ({
      number: i + 1,
      ...(i === 0 ? { attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 } } : {}),
      events: [
        ...bar.rh.map(([t, dur, midi], j) => ({ id: `r${i}-${j}`, t, dur, midi, type: 'note', pitch: midiToPitch(midi), voice: 1, staff: 1 })),
        ...bar.lh.map(([t, dur, midi], j) => ({ id: `l${i}-${j}`, t, dur, midi, type: 'note', pitch: midiToPitch(midi), voice: 2, staff: 2 })),
      ],
    })),
  }],
  meta: {},
} as any);

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function midiToPitch(m: number) {
  const n = NAMES[((m % 12) + 12) % 12]!;
  return { step: n[0]!, ...(n.length > 1 ? { alter: n[1] === '#' ? 1 : -1 } : {}), octave: Math.floor(m / 12) - 1 };
}

const partOf = (score: any, id: string) => score.parts.find((p: any) => p.part_id === id);
const notesIn = (score: any, id: string, bar: number) =>
  (partOf(score, id).measures[bar].events ?? [])
    .filter((e: any) => e.type === 'note')
    .sort((a: any, b: any) => a.t - b.t);

/** Bar 112 of the reference: a held chord with sixteenths running over it. */
const PEDAL_AND_FIGURE = piano([{
  rh: [
    [0, 4, 76], [0, 4, 71], [0, 4, 67], [0, 4, 64],
    ...([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3, 3.25, 3.5, 3.75]
      .map((t, i) => [t, 0.25, i % 2 ? 74 : 76] as [number, number, number])),
  ],
  lh: [[0, 4, 40]],
}]);

test('a held tone is released where the next attack falls, not dropped', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(PEDAL_AND_FIGURE, {});
  const fl = notesIn(out, 'P_FL', 0);
  assert.equal(fl.length, 15, 'the pedal plus all fourteen sixteenths reach the flute');
  assert.equal(Number(fl[0].t), 0);
  assert.equal(Number(fl[0].dur), 0.5, 'the four-beat pedal is clipped at the first sixteenth');
});

test('no wind is ever asked to play two notes at once', () => {
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(PEDAL_AND_FIGURE, {});
  for (const id of ['P_FL', 'P_OB', 'P_CL', 'P_BN']) {
    for (let bar = 0; bar < partOf(out, id).measures.length; bar++) {
      const ns = notesIn(out, id, bar);
      for (let i = 1; i < ns.length; i++) {
        assert(
          Number(ns[i - 1].t) + Number(ns[i - 1].dur) <= Number(ns[i].t) + 1e-9,
          `${id} bar ${bar + 1}: a note at ${ns[i - 1].t} overruns the attack at ${ns[i].t}`
        );
      }
    }
  }
});

test('a triplet keeps its own onsets rather than the 1/64 grid', () => {
  // 2/3 of a beat is not on a 1/64 grid; rounding the onset to that grid moves
  // the note, and a moved note is one the source no longer has.
  const third = 2 / 3;
  const src = piano([{
    rh: [0, 1, 2, 3, 4, 5].map((i) => [i * third, third, 72 + i] as [number, number, number]),
    lh: [[0, 4, 40]],
  }]);
  const fl = notesIn(arrangeWoodwindQuartetFromPianoInstrumentation(src, {}), 'P_FL', 0);
  assert.equal(fl.length, 6);
  for (let i = 0; i < 6; i++)
    assert(Math.abs(Number(fl[i].t) - i * third) < 1e-9, `onset ${i} moved to ${fl[i].t}`);
});

test('a plain chord sequence is untouched — clipping only fires on an overlap', () => {
  const src = piano([{
    rh: [[0, 2, 72], [0, 2, 76], [0, 2, 79], [2, 2, 74], [2, 2, 77], [2, 2, 81]],
    lh: [[0, 2, 48], [2, 2, 50]],
  }]);
  const out = arrangeWoodwindQuartetFromPianoInstrumentation(src, {});
  for (const id of ['P_FL', 'P_OB', 'P_CL', 'P_BN']) {
    const ns = notesIn(out, id, 0);
    assert.equal(ns.length, 2, `${id} plays both chords`);
    assert(ns.every((n: any) => Number(n.dur) === 2), `${id} keeps its full half-bar values`);
  }
});
