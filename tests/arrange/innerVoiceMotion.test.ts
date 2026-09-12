import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCandidatesForSlice } from '../../src/arrange/strings/candidates';
import { evaluateTransition, PROFILE_WEIGHTS } from '../../src/arrange/strings/constraints';
import type { Slice, Voicing } from '../../src/arrange/strings/types';

const D_MAJOR_PCS = [2, 6, 9]; // D F# A

const build = (prev: number | null, on: boolean, symbol = 'D') =>
  buildCandidatesForSlice({
    slice: { measure: 1, t: 1, dur: 1, melodyMidi: 81, chordSymbol: symbol } as Slice,
    prevVoicing: prev === null ? null : ({ vln1: 81, vln2: prev, vla: prev, vc: 50, cb: 38 } as Voicing),
    keyFifths: 2, keyMode: 'major', profileId: 'melody_harmony',
    keepInnerVoicesBelowMelody: true, innerVoiceMotion: on,
  });

const isChordTone = (m: number) => D_MAJOR_PCS.includes(((m % 12) + 12) % 12);

test('a step is offered when the chord has none within reach', () => {
  // From A4 under D major the chord's own tones are a third away or more.
  const on = build(69, true);
  for (const voice of ['vln2', 'vla'] as const) {
    const steps = on[voice].filter((m) => Math.abs(m - 69) >= 1 && Math.abs(m - 69) <= 2);
    assert(steps.length > 0, `${voice} still has nowhere to step: ${on[voice].join(' ')}`);
    assert(steps.every((m) => !isChordTone(m)), 'the offered step should be the scale tone');
  }
});

test('nothing extra is offered when a chord tone is already a step away', () => {
  // From G4, the chord's own F#4 is a semitone below — no help needed.
  const on = build(67, true);
  const off = build(67, false);
  assert.deepEqual(on.vln2, off.vln2);
  assert.deepEqual(on.vla, off.vla);
});

test('off by default, so brass and woodwinds reading this DP are untouched', () => {
  assert.deepEqual(build(69, false), buildCandidatesForSlice({
    slice: { measure: 1, t: 1, dur: 1, melodyMidi: 81, chordSymbol: 'D' } as Slice,
    prevVoicing: { vln1: 81, vln2: 69, vla: 69, vc: 50, cb: 38 } as Voicing,
    keyFifths: 2, keyMode: 'major', profileId: 'melody_harmony',
    keepInnerVoicesBelowMelody: true,
  }));
});

test('only the inner voices get the extra step', () => {
  const on = build(69, true);
  const off = build(69, false);
  assert.deepEqual(on.vc, off.vc);
  assert.deepEqual(on.cb, off.cb);
  assert.deepEqual(on.vln1, off.vln1);
});

// ── what the off-chord tone costs ───────────────────────────────────────────
const cost = (prevMidi: number, nextMidi: number, opts: {
  strongBeat?: boolean; prevChordPcs?: number[];
}) => {
  // Viola parked on a chord tone so only Violin II's penalties are measured.
  const v = (m: number): Voicing => ({ vln1: 81, vln2: m, vla: 62, vc: 50, cb: 38 });
  const score = evaluateTransition(v(prevMidi), v(nextMidi), {
    profile: PROFILE_WEIGHTS.melody_harmony,
    pendingRecovery: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
    chordPcs: D_MAJOR_PCS,
    strongBeat: opts.strongBeat === true,
    prevChordPcs: opts.prevChordPcs,
  });
  return Object.fromEntries(
    score.penalties.filter((p) => p.id.includes('chord_tone')).map((p) => [p.id, p.cost])
  );
};

test('a passing tone on a weak beat is cheap; on a strong beat it is not', () => {
  const weak = cost(69, 67, { strongBeat: false })['non_chord_tone'];  // A4 -> G4, stepwise
  const strong = cost(69, 67, { strongBeat: true })['non_chord_tone'];
  assert(weak !== undefined && strong !== undefined);
  assert(weak < strong, `weak ${weak} should cost less than strong ${strong}`);
  // Cheap enough that the step reward still makes the move worth taking.
  assert(weak < PROFILE_WEIGHTS.melody_harmony.stepPreference);
});

test('an off-chord tone reached by leap costs full price', () => {
  const leapt = cost(62, 67, { strongBeat: false })['non_chord_tone']; // D4 -> G4, a fourth
  const stepped = cost(69, 67, { strongBeat: false })['non_chord_tone'];
  assert(leapt > stepped, `leapt-to ${leapt} should cost more than stepped-in ${stepped}`);
});

test('an off-chord tone must resolve — chains and leaps away are charged', () => {
  // G4 was off-chord under D; staying off-chord on E4 chains two together.
  const chained = cost(67, 64, { prevChordPcs: D_MAJOR_PCS })['unresolved_non_chord_tone'];
  assert(chained !== undefined && chained > 0, 'a chained off-chord tone should be charged');
  // Leaving G4 by a leap, even onto a chord tone, does not resolve it.
  const leftByLeap = cost(67, 74, { prevChordPcs: D_MAJOR_PCS })['unresolved_non_chord_tone'];
  assert(leftByLeap !== undefined && leftByLeap > 0, 'leaving by leap should be charged');
  // Resolving by step onto a chord tone is free.
  assert.equal(cost(67, 69, { prevChordPcs: D_MAJOR_PCS })['unresolved_non_chord_tone'], undefined);
});

test('nothing is charged when the caller did not opt in', () => {
  const v = (m: number): Voicing => ({ vln1: 81, vln2: m, vla: 62, vc: 50, cb: 38 });
  const score = evaluateTransition(v(69), v(67), {
    profile: PROFILE_WEIGHTS.melody_harmony,
    pendingRecovery: { vln1: null, vln2: null, vla: null, vc: null, cb: null },
  });
  assert.equal(score.penalties.filter((p) => p.id.includes('chord_tone')).length, 0);
});
