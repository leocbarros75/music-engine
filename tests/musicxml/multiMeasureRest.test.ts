import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

const attrs = (beats = 4) => ({
  divisions: 4, key_fifths: 0, key_mode: 'major',
  time: { beats, beat_type: 4 },
});

const silent = (number: number, extra: Record<string, unknown> = {}) => ({
  number, attributes: attrs(), events: [], ...extra,
});
const playing = (number: number) => ({
  number, attributes: attrs(),
  events: [{ id: `n${number}`, t: 0, dur: 4, type: 'note', pitch: { step: 'A', octave: 3 }, voice: 1, staff: 1 }],
});

const part = (measures: any[], name = 'Timpani') => ({
  part_id: 'P_TIMP', name, instrument: 'timpani', staves: 1, measures,
});

const runsIn = (xml: string) =>
  [...xml.matchAll(/<multiple-rest>(\d+)<\/multiple-rest>/g)].map((m) => Number(m[1]));

const exportOne = (measures: any[]) =>
  exportScoreModelToMusicXML({ parts: [part(measures)], meta: {} } as any);

test('a run of silent bars collapses into one multi-measure rest', () => {
  const xml = exportOne([silent(1), silent(2), silent(3), silent(4), playing(5)]);
  assert.deepEqual(runsIn(xml), [4]);
});

test('every bar still exists in the file, each a full bar of rest', () => {
  const xml = exportOne([silent(1), silent(2), silent(3), playing(4)]);
  const bars = [...xml.matchAll(/<measure number="(\d+)"/g)].map((m) => m[1]);
  assert.deepEqual(bars, ['1', '2', '3', '4']);
  // 3 rests of 16 divisions + the played note
  assert.equal([...xml.matchAll(/<rest\/><duration>16<\/duration>/g)].length, 3);
});

test('a single silent bar stays an ordinary bar of rest', () => {
  assert.deepEqual(runsIn(exportOne([playing(1), silent(2), playing(3)])), []);
});

test('a part that plays throughout gets none', () => {
  assert.deepEqual(runsIn(exportOne([playing(1), playing(2), playing(3)])), []);
});

test('a full score never collapses a staff — the systems must stay aligned', () => {
  const score: any = {
    parts: [
      part([silent(1), silent(2), silent(3), playing(4)], 'Timpani'),
      { part_id: 'P_V1', name: 'Violin I', instrument: 'violin_1', staves: 1,
        measures: [playing(1), playing(2), playing(3), playing(4)] },
    ],
    meta: {},
  };
  assert.deepEqual(runsIn(exportScoreModelToMusicXML(score)), []);
});

test('a run breaks at a meter change', () => {
  const xml = exportOne([
    silent(1), silent(2),
    { number: 3, attributes: attrs(3), events: [] },
    { number: 4, attributes: attrs(3), events: [] },
    playing(5),
  ]);
  assert.deepEqual(runsIn(xml), [2, 2]);
});

test('a run breaks where the player needs to see the bar go by', () => {
  // A tempo mark mid-rest has to be read, so the bars around it stay separate.
  const xml = exportOne([
    silent(1), silent(2),
    silent(3, { performance: { tempos: [{ t: 0, bpm: 96 }] } }),
    silent(4), silent(5), playing(6),
  ]);
  assert.deepEqual(runsIn(xml), [2, 2]);
});

test('the multiple-rest sits inside attributes, where MusicXML puts it', () => {
  const xml = exportOne([silent(1), silent(2), playing(3)]);
  assert.match(xml, /<attributes>[^]*?<measure-style><multiple-rest>2<\/multiple-rest><\/measure-style><\/attributes>/);
});
