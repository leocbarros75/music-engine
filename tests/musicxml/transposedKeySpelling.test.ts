import assert from 'node:assert/strict';
import { test } from 'node:test';
import { transposeKeyFifths, exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

/** How far each instrument's written key sits above concert, in semitones. */
const UP_A_TONE = 2;   // B flat clarinet, trumpet
const UP_A_SIXTH = 9;  // E flat alto sax
const UP_A_FIFTH = 7;  // F horn

test('a six-and-six tie follows the concert key rather than the loop order', () => {
  // Concert E major (4 sharps) + a tone = F sharp major, not G flat.
  assert.equal(transposeKeyFifths(4, UP_A_TONE), 6);
  // Concert A major (3 sharps) + a sixth = F sharp major, for the alto sax.
  assert.equal(transposeKeyFifths(3, UP_A_SIXTH), 6);
  // Concert B major (5 sharps) + a fifth = F sharp major, for the horn.
  assert.equal(transposeKeyFifths(5, UP_A_FIFTH), 6);
});

test('a flat concert key ties toward flats', () => {
  // D flat major (5 flats) up a fourth is G flat, not F sharp.
  assert.equal(transposeKeyFifths(-5, 5), -6);
});

test('fewest accidentals still decides when there is no tie', () => {
  // Concert B major + a tone is D flat (5 flats), not C sharp (7 sharps) —
  // which is what a clarinettist expects to read.
  assert.equal(transposeKeyFifths(5, UP_A_TONE), -5);
  // Concert E major + a sixth is D flat for the alto sax, for the same reason.
  assert.equal(transposeKeyFifths(4, UP_A_SIXTH), -5);
});

test('ordinary keys are unchanged', () => {
  assert.equal(transposeKeyFifths(0, UP_A_TONE), 2);   // C  -> D
  assert.equal(transposeKeyFifths(-2, UP_A_TONE), 0);  // Bb -> C
  assert.equal(transposeKeyFifths(3, UP_A_TONE), 5);   // A  -> B
  assert.equal(transposeKeyFifths(-5, UP_A_TONE), -3); // Db -> Eb
  assert.equal(transposeKeyFifths(4, UP_A_FIFTH), 5);  // E  -> B  (horn)
});

test('the written key never exceeds seven accidentals', () => {
  for (let concert = -7; concert <= 7; concert++) {
    for (const shift of [UP_A_TONE, UP_A_SIXTH, UP_A_FIFTH, 3, 5, 10]) {
      const f = transposeKeyFifths(concert, shift);
      assert(f >= -7 && f <= 7, `concert ${concert} + ${shift} gave ${f}`);
    }
  }
});

test('the clarinet part reads F sharp major end to end', () => {
  const model: any = {
    parts: [{
      part_id: 'P_CL', name: 'Clarinet', instrument: 'clarinet_bb', staves: 1,
      measures: [{
        number: 1,
        attributes: { divisions: 4, key_fifths: 4, key_mode: 'major', time: { beats: 4, beat_type: 4 } },
        events: [{ id: 'n', t: 0, dur: 4, type: 'note', pitch: { step: 'E', octave: 4 }, voice: 1, staff: 1 }],
      }],
    }],
    meta: {},
  };
  const xml = exportScoreModelToMusicXML(model);
  assert.match(xml, /<fifths>6<\/fifths>/);
  assert.doesNotMatch(xml, /<fifths>-6<\/fifths>/);
});

// ── Respellings that cross the octave boundary ──────────────────────────────
// Octave numbers change at C, so C flat belongs to the octave above the B it
// replaces and B sharp to the octave below its C. Keeping the octave made each
// of those the wrong pitch by a full octave.

const STEP: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function writtenPitch(keyFifths: number, step: string, octave: number) {
  const model: any = {
    parts: [{
      part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 1,
      measures: [{
        number: 1,
        attributes: { divisions: 4, key_fifths: keyFifths, key_mode: 'major', time: { beats: 4, beat_type: 4 } },
        events: [{ id: 'n', t: 0, dur: 4, type: 'note', pitch: { step, alter: 0, octave }, voice: 1, staff: 1 }],
      }],
    }],
    meta: {},
  };
  const xml = exportScoreModelToMusicXML(model);
  const st = xml.match(/<step>(\w)<\/step>/)![1]!;
  const al = Number(xml.match(/<alter>(-?\d+)<\/alter>/)?.[1] ?? 0);
  const oc = Number(xml.match(/<octave>(\d)<\/octave>/)![1]);
  return { name: `${st}${al > 0 ? '#' : al < 0 ? 'b' : ''}${oc}`, midi: (oc + 1) * 12 + STEP[st]! + al };
}

test('B respelt as C flat goes up an octave, not across one', () => {
  for (const key of [-6, -7]) {
    const w = writtenPitch(key, 'B', 4);
    assert.equal(w.midi, 71, `key ${key} wrote ${w.name}`);
    assert.equal(w.name, 'Cb5');
  }
});

test('C respelt as B sharp goes down an octave', () => {
  const w = writtenPitch(7, 'C', 4);
  assert.equal(w.midi, 60, `wrote ${w.name}`);
  assert.equal(w.name, 'B#3');
});

test('respellings inside an octave keep it', () => {
  const w = writtenPitch(-7, 'E', 4);
  assert.equal(w.midi, 64);
  assert.equal(w.name, 'Fb4');
});

test('no respelling ever changes the pitch, in any key', () => {
  for (let key = -7; key <= 7; key++) {
    for (const step of Object.keys(STEP)) {
      for (const octave of [3, 4, 5]) {
        const want = (octave + 1) * 12 + STEP[step]!;
        const got = writtenPitch(key, step, octave);
        assert.equal(got.midi, want, `key ${key}: ${step}${octave} became ${got.name}`);
      }
    }
  }
});
