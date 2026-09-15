import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateRhPattern } from '../../src/arrange/pianoAccompPatterns';

const run = (chords: Array<{ measure: number; t: number; symbol: string }>, rhPattern: any = 'sustained') =>
  generateRhPattern({ chords, measureNumber: 1, measureBeats: 4, rhPattern, warnings: [] });

/** Distinct onsets — a chord's three notes share one. */
const attacks = (events: any[]) => new Set(events.map((e) => Number(e.t))).size;
const spans = (events: any[]) => {
  const byT = new Map<number, number>();
  for (const e of events) byT.set(Number(e.t), Number(e.dur));
  return [...byT.entries()].sort((a, b) => a[0] - b[0]);
};

test('one harmony in the bar is one held chord', () => {
  const ev = run([{ measure: 1, t: 0, symbol: 'C' }]);
  assert.equal(attacks(ev), 1);
  assert.deepEqual(spans(ev), [[0, 4]]);
  assert.equal(ev.length, 3, 'a triad, struck once');
});

test('two harmonies are two held chords, each lasting its own span', () => {
  const ev = run([{ measure: 1, t: 0, symbol: 'C' }, { measure: 1, t: 2, symbol: 'G' }]);
  assert.equal(attacks(ev), 2);
  assert.deepEqual(spans(ev), [[0, 2], [2, 2]]);
});

test('an uneven harmonic rhythm keeps its own proportions', () => {
  const ev = run([{ measure: 1, t: 0, symbol: 'C' }, { measure: 1, t: 3, symbol: 'G' }]);
  assert.deepEqual(spans(ev), [[0, 3], [3, 1]]);
});

test('a bar whose harmony starts late is left to the caller, as for every pattern', () => {
  // generateRhPattern returns nothing when no chord is active at beat 0 — a
  // shared guard, not specific to this pattern. The bar is filled downstream
  // rather than guessed at here.
  assert.deepEqual(run([{ measure: 1, t: 2, symbol: 'G' }]), []);
});

test('it fills the bar exactly, however the harmony is divided', () => {
  for (const cs of [
    [{ measure: 1, t: 0, symbol: 'C' }],
    [{ measure: 1, t: 0, symbol: 'C' }, { measure: 1, t: 2, symbol: 'G' }],
    [{ measure: 1, t: 0, symbol: 'C' }, { measure: 1, t: 1, symbol: 'F' }, { measure: 1, t: 2.5, symbol: 'G' }],
    [{ measure: 1, t: 0, symbol: 'Am' }, { measure: 1, t: 1.5, symbol: 'F' }],
  ]) {
    const total = spans(run(cs)).reduce((s, [, d]) => s + d, 0);
    assert.equal(total, 4, `${cs.length} chord(s) should still fill four beats`);
  }
});

test('it holds where block_beats re-strikes — that is the whole difference', () => {
  const chords = [{ measure: 1, t: 0, symbol: 'C' }];
  const held = run(chords, 'sustained');
  const struck = run(chords, 'block_beats');
  assert.equal(attacks(held), 1);
  assert.equal(attacks(struck), 4);
  // Same harmony, same total time; only the number of attacks differs.
  assert.equal(spans(held).reduce((s, [, d]) => s + d, 0), 4);
  assert.equal(spans(struck).reduce((s, [, d]) => s + d, 0), 4);
});

test('a bar with no chord data produces nothing rather than guessing', () => {
  assert.deepEqual(run([]), []);
});
