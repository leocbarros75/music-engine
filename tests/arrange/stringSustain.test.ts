import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeStringEnsemble } from '../../src/arrange/strings/stringArranger';
import type { ScoreModel } from '../../src/score/types';

/**
 * A melody of five onsets per bar over one unchanging chord. Every accompanying
 * voice used to get five notes a bar on the same pitch, because buildSlices cuts
 * the bar at each melody onset and the harmony never moved.
 */
function leadSheet(): ScoreModel {
  const bar = (n: number, pitches: Array<[string, number, number]>) => ({
    number: n,
    attributes: n === 1
      ? { divisions: 4, key: { fifths: 2 }, time: { beats: 4, beat_type: 4 } }
      : undefined,
    events: pitches.map(([step, octave, t], i) => ({
      id: `mel-${n}-${i}`, t, dur: i === 0 ? 1 : 0.5,
      type: 'note' as const, pitch: { step, octave }, voice: 1, staff: 1,
    })),
  });
  return {
    parts: [{
      part_id: 'P_MEL', name: 'Melody', instrument: 'voice', staves: 1,
      measures: [
        bar(1, [['F', 4, 0], ['F', 4, 1], ['G', 4, 1.5], ['A', 4, 2], ['B', 4, 2.5]]),
        bar(2, [['A', 4, 0], ['G', 4, 1], ['F', 4, 1.5], ['E', 4, 2], ['D', 4, 2.5]]),
      ],
    }],
    meta: {},
  } as unknown as ScoreModel;
}

const CHORDS = [{ measure: 1, t: 0, symbol: 'D' }, { measure: 2, t: 0, symbol: 'G' }];

function notesOf(result: ReturnType<typeof arrangeStringEnsemble>, name: string) {
  const part = (result.scoreModel.parts ?? []).find((p: any) => p.name === name) as any;
  assert(part, `no part named ${name}`);
  return (part.measures ?? []).map((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note')
  );
}

test('sustained voices hold a pitch instead of re-striking it each melody onset', () => {
  const on = arrangeStringEnsemble(leadSheet(), CHORDS, {
    profile: 'melody_harmony', sustainAccompaniment: true,
  });
  for (const name of ['Violin II', 'Viola', 'Cello', 'Double Bass']) {
    for (const [i, bar] of notesOf(on, name).entries()) {
      const pitches = bar.map((e: any) => `${e.pitch.step}${e.pitch.alter ?? ''}${e.pitch.octave}`);
      assert.equal(
        new Set(pitches).size, pitches.length,
        `${name} bar ${i + 1} still re-strikes: ${pitches.join(' ')}`
      );
    }
  }
});

test('the melody voice keeps its own rhythm', () => {
  const on = arrangeStringEnsemble(leadSheet(), CHORDS, {
    profile: 'melody_harmony', sustainAccompaniment: true,
  });
  const off = arrangeStringEnsemble(leadSheet(), CHORDS, { profile: 'melody_harmony' });
  assert.deepEqual(
    notesOf(on, 'Violin I').map((b: any[]) => b.length),
    notesOf(off, 'Violin I').map((b: any[]) => b.length)
  );
});

test('sustaining is off by default, so brass and woodwinds are untouched', () => {
  const off = arrangeStringEnsemble(leadSheet(), CHORDS, { profile: 'melody_harmony' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(off.scoreModel)),
    JSON.parse(JSON.stringify(
      arrangeStringEnsemble(leadSheet(), CHORDS, {
        profile: 'melody_harmony', sustainAccompaniment: false,
      }).scoreModel
    ))
  );
});

test('re-articulating textures do not sustain even when asked', () => {
  // Pizzicato chord hits and chorale writing re-strike on purpose.
  for (const profile of ['melody_pizzicato', 'bach_chorale', 'homophonic_block'] as const) {
    const on = arrangeStringEnsemble(leadSheet(), CHORDS, { profile, sustainAccompaniment: true });
    const off = arrangeStringEnsemble(leadSheet(), CHORDS, { profile });
    assert.deepEqual(
      JSON.parse(JSON.stringify(on.scoreModel)),
      JSON.parse(JSON.stringify(off.scoreModel)),
      `${profile} should be unaffected by sustainAccompaniment`
    );
  }
});

test('merged notes still fill the bar exactly', () => {
  const on = arrangeStringEnsemble(leadSheet(), CHORDS, {
    profile: 'melody_harmony', sustainAccompaniment: true,
  });
  for (const name of ['Violin I', 'Violin II', 'Viola', 'Cello', 'Double Bass']) {
    const part = (on.scoreModel.parts ?? []).find((p: any) => p.name === name) as any;
    for (const m of part.measures ?? []) {
      const total = (m.events ?? []).reduce((s: number, e: any) => s + Number(e.dur), 0);
      assert.equal(total, 4, `${name} bar ${m.number} totals ${total}, not 4`);
    }
  }
});
