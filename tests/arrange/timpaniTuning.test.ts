import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timpaniTuning, tuningLabel } from '../../src/arrange/orchestra/worshipOrchestraArranger';

/**
 * Two drums, tuned once.
 *
 * The part used to take whatever pitch the bar's bass landed on and shift it
 * into range. Over 79 bars in F that gave six pitches — F2, G2, A2, Bb2, C3, D3
 * — which is six drums, or a player retuning mid-performance, and the score
 * said neither. Tonic and dominant is the oldest convention the instrument has,
 * and it exists because changing a drum's pitch takes a pedal and several
 * seconds.
 */

const LO = 38, HI = 57; // D2..A3, the range the arranger writes within

test('F major gives the pair a timpanist expects', () => {
  // The Codex edition of this exact source tunes F2 and C3. Reached independently.
  const t = timpaniTuning(-1, 'major', LO, HI);
  assert.equal(t.tonic, 41, 'tonic is not F2');
  assert.equal(t.dominant, 48, 'dominant is not C3');
  assert.equal(tuningLabel(t.tonic, t.dominant), 'F2, C3');
});

test('the minor mode is read, not assumed from the signature', () => {
  // A minor and C major share a key signature. A timpanist in A minor wants
  // A and E; taking the signature at face value would hand them C and G.
  const minor = timpaniTuning(0, 'minor', LO, HI);
  const major = timpaniTuning(0, 'major', LO, HI);
  assert.equal(minor.tonicPc, 9, `A minor tonic pitch class is ${minor.tonicPc}, not A`);
  assert.equal(minor.dominantPc, 4, 'the fifth above A is E');
  assert.equal(major.tonicPc, 0, 'C major tonic should be C');
  assert.notEqual(minor.tonic, major.tonic, 'the two modes produced the same drums');
});

test('both drums always fit on the instrument', () => {
  // Eb is the case that forced the rule: Eb3 is in range but the fifth above it
  // is not, so the pair drops an octave rather than losing the dominant.
  for (let fifths = -7; fifths <= 7; fifths++) {
    for (const mode of ['major', 'minor']) {
      const t = timpaniTuning(fifths, mode, LO, HI);
      assert(t.tonic >= LO && t.tonic <= HI, `${fifths} ${mode}: tonic ${t.tonic} off the drums`);
      assert(t.dominant >= LO && t.dominant <= HI, `${fifths} ${mode}: dominant ${t.dominant} off the drums`);
      assert.equal(t.dominant - t.tonic, 7, `${fifths} ${mode}: the drums are not a fifth apart`);
      assert.equal(((t.tonic % 12) + 12) % 12, t.tonicPc, 'tonic pitch does not match its own pitch class');
      assert.equal(((t.dominant % 12) + 12) % 12, t.dominantPc, 'dominant pitch does not match its own pitch class');
    }
  }
});

test('Eb major drops the pair an octave so the fifth survives', () => {
  const t = timpaniTuning(-3, 'major', LO, HI);
  assert.equal(t.tonic, 39, 'Eb2 expected');
  assert.equal(t.dominant, 46, 'Bb2 expected');
});
