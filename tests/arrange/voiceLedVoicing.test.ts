import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createVoiceLedState, voiceLedChordVoices } from '../../src/arrange/pianoWithMelody/voiceLedVoicing';

// The left hand's window in the accompaniment patterns: C2–A3.
const LO = 36;
const HI = 57;

/** The D-major progression from the lead sheet that exposed both defects. */
const PROGRESSION = ['D', 'G', 'A', 'D', 'D', 'A7', 'D', 'D', 'G', 'A', 'F#m', 'Em', 'G', 'G', 'A7'];

function runLh(symbols: string[]) {
  const state = createVoiceLedState('lh');
  return symbols.map(s => voiceLedChordVoices(s, LO, HI, state));
}

test('lh: every voicing has three distinct pitches', () => {
  // buildWalkingBass walks bass→mid→high, so a collapsed voicing makes the bass
  // play the same note three times in a row instead of root–3rd–5th.
  for (const [i, v] of runLh(PROGRESSION).entries()) {
    assert(v, `${PROGRESSION[i]} produced no voicing`);
    assert.equal(
      new Set([v.bass, v.mid, v.high]).size, 3,
      `${PROGRESSION[i]} collapsed to ${JSON.stringify(v)}`
    );
  }
});

test('lh: the bass does not ratchet up the window over a progression', () => {
  const voicings = runLh(PROGRESSION);
  const first = voicings[0]!.bass;
  for (const [i, v] of voicings.entries()) {
    assert(
      v!.bass <= first + 12,
      `${PROGRESSION[i]} bass drifted to ${v!.bass}, over an octave above the opening ${first}`
    );
  }
});

test('lh: the bass is always the chord root, or the named bass of a slash chord', () => {
  const state = createVoiceLedState('lh');
  const cases: Array<[string, number]> = [['D', 2], ['G/B', 11], ['A7', 9], ['C/D', 2]];
  for (const [symbol, pc] of cases) {
    const v = voiceLedChordVoices(symbol, LO, HI, state);
    assert(v, `${symbol} produced no voicing`);
    assert.equal(v.bass % 12, pc, `${symbol} bass was ${v.bass}`);
  }
});

test('rh: common tones are held rather than rebuilt in root position', () => {
  // D -> G shares a D. The root-position voicer moved all three voices a 4th.
  const state = createVoiceLedState('rh');
  const d = voiceLedChordVoices('D', 60, 72, state)!;
  const g = voiceLedChordVoices('G', 60, 72, state)!;
  assert(
    [g.bass, g.mid, g.high].includes(d.bass),
    `D ${JSON.stringify(d)} -> G ${JSON.stringify(g)} held no common tone`
  );
});

test('repeating a symbol returns the identical voicing', () => {
  const state = createVoiceLedState('lh');
  const a = voiceLedChordVoices('D', LO, HI, state);
  const b = voiceLedChordVoices('D', LO, HI, state);
  assert.deepEqual(a, b);
});
