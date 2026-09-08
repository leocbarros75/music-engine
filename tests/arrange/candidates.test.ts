import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCandidateMap as strings } from '../../src/arrange/stringsPolyphony/pathfinding';
import { buildCandidateMap as woodwinds } from '../../src/arrange/woodwinds/polyphony/pathfinding';
import { buildCandidateMap as brass } from '../../src/arrange/brass/polyphony/pathfinding';
import { buildCandidateMap as orchestra } from '../../src/arrange/orchestra/polyphony/pathfinding';
import { loadCounterpointRules } from '../../src/arrange/stringsPolyphony/counterpointScoring';
import { STRING_RANGES } from '../../src/arrange/stringsPolyphony/ranges';

const params = () => ({
  slice: { index: 0, measure: 1, t: 0, dur: 1, melodyMidi: 67, chordSymbol: 'C', isStrongBeat: true },
  prevVoicing: { vln1: null, vln2: null, vla: null, vc: 48, cb: 36 },
  keyFifths: 0, keyMode: 'major' as 'major' | 'minor', motif: null, motifEntries: [],
  rules: loadCounterpointRules(),
  rhythmState: { totalAttacks: 5, perVoice: { vln1: 0, vln2: 0, vla: 0, vc: 1, cb: 4 } }
});
for (const [name, build] of Object.entries({ strings, woodwinds, brass, orchestra })) {
  test(`${name}: first slice with no previous voicing does not crash`, () => {
    const out = build({ ...params(), prevVoicing: null });
    assert.deepEqual(out.vln1, [67]);
    assert(out.cb.length > 0);
  });
  test(`${name}: anchored bass offers singing cello pitches and keeps stepwise choices`, () => {
    const out = build(params());
    assert(out.vc.includes(48));
    assert(out.vc.some(n => n >= 60 && n <= 72));
    assert(out.vc.every(n => [0, 4, 7].includes(n % 12)));
    assert.equal(new Set(out.vc).size, out.vc.length);
  });
  test(`${name}: wrong bass pitch or insufficient anchoring does not unlock cello register`, () => {
    const p = params(); p.prevVoicing.cb = 38;
    assert(build(p).vc.every(n => n < 60));
    p.prevVoicing.cb = 36; p.rhythmState.totalAttacks = 10;
    assert(build(p).vc.every(n => n < 60));
  });
  test(`${name}: singing register never exceeds supplied instrument range`, () => {
    const ranges = { ...STRING_RANGES, vc: { absMin: 36, absMax: 55, prefMin: 40, prefMax: 52 } };
    const out = build({ ...params(), ranges });
    assert(out.vc.length > 0);
    assert(out.vc.every(n => n >= 36 && n <= 55));
  });
  test(`${name}: agile weak beats permit bass rests while strong beats retain root`, () => {
    const p = params(); p.rhythmState.perVoice.vc = 3; p.slice.isStrongBeat = false;
    assert.deepEqual(build(p).cb, []);
    p.slice.isStrongBeat = true;
    const bass = build(p).cb;
    assert(bass.length > 0 && bass.every(n => n % 12 === 0));
  });
  test(`${name}: slash chord anchors bass on the specified inversion`, () => {
    const p = params(); p.slice.chordSymbol = 'C/E';
    const bass = build(p).cb;
    assert(bass.length > 0 && bass.every(n => n % 12 === 4));
  });
  test(`${name}: A minor without chords uses the zero-sharp natural minor scale`, () => {
    const p = params(); p.keyMode = 'minor'; p.slice.chordSymbol = null;
    const out = build(p);
    for (const voice of ['vln2', 'vla', 'vc', 'cb'] as const) {
      assert(out[voice].length > 0);
      assert(out[voice].every(n => [0, 2, 4, 5, 7, 9, 11].includes(n % 12)));
    }
  });
  test(`${name}: motif insertion respects custom ranges`, () => {
    const out = build({ ...params(),
      ranges: { ...STRING_RANGES, vln2: { absMin: 72, absMax: 79, prefMin: 72, prefMax: 79 } },
      motif: { intervals: [0], durations: [1], startSlice: 0, length: 1, baseMidi: 48 },
      motifEntries: [{ voice: 'vln2', startSlice: 0, transpose: 0 }]
    });
    assert(out.vln2.length > 0);
    assert(out.vln2.every(n => n >= 72 && n <= 79));
  });
}
