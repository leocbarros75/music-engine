import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readableTempo } from '../../src/score/performance';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

test('a reciprocal artefact reads as the whole number the writer meant', () => {
  // MIDI stores microseconds per quarter, so every tempo arrives as 60e6/us.
  for (const us of [895522, 500000, 454545, 1000000]) {
    const raw = 60000000 / us;
    const shown = readableTempo(raw);
    assert.equal(shown, Math.round(raw), `${us}µs gave ${shown}`);
    assert.equal(Number.isInteger(shown), true);
  }
  assert.equal(readableTempo(60000000 / 895522), 67);
});

test('a deliberate decimal survives', () => {
  assert.equal(readableTempo(132.5), 132.5);
  assert.equal(readableTempo(60000000 / 452830), 132.5);
  assert.equal(readableTempo(63.4), 63.4);
});

test('nonsense falls back rather than reaching the page', () => {
  assert.equal(readableTempo(Number.NaN), 120);
  assert.equal(readableTempo(Number.POSITIVE_INFINITY), 120);
});

test('the printed mark and the playback tempo agree', () => {
  const score: any = {
    parts: [{
      part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 1,
      measures: [{
        number: 1,
        attributes: { divisions: 4, key_fifths: 0, time: { beats: 4, beat_type: 4 } },
        performance: { tempos: [{ t: 0, bpm: 60000000 / 895522 }] },
        events: [{ id: 'n1', t: 0, dur: 4, type: 'note', pitch: { step: 'C', octave: 4 }, voice: 1, staff: 1 }],
      }],
    }],
    meta: {},
  };
  const xml = exportScoreModelToMusicXML(score);
  assert.match(xml, /<per-minute>67<\/per-minute>/);
  assert.match(xml, /<sound tempo="67"/);
  assert.doesNotMatch(xml, /67\.0000/);
});
