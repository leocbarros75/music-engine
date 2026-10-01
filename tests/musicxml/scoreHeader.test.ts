import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

/**
 * What a reader sees before a note of it.
 *
 * The first page came out blank with "full_orchestra" printed on it. Three
 * things were wrong at once. The title was the name of the ensemble, because
 * the parser read the source's title into meta.title and the exporter never
 * looked at it. There were no credits, so nothing engraved. And there were no
 * <defaults>, so a reader used its own — A4 at full staff size — and a twenty
 * stave system did not fit, which is what pushed the music to page two and left
 * page one empty.
 *
 * The copyright notice matters most of the three. These sources are published
 * worship charts whose notice names the publishers, the licence and the terms
 * of duplication, and it was being dropped on the way through.
 */

const note = (t: number, midi: number) => ({
  id: `n${t}`, t, dur: 1, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 },
});
const part = (part_id: string, name: string) => ({
  part_id, name, instrument: 'violin_1', staves: 1,
  measures: [{
    number: 1, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 }, key_fifths: 0 },
    events: [note(0, 60)],
  }],
});
const score = (meta: any, partCount = 1) => ({
  score_id: 's',
  meta: { ensemble: 'full_orchestra', ...meta },
  global: { divisions: 4 },
  parts: Array.from({ length: partCount }, (_, i) => part(`P${i}`, `Violin ${i + 1}`)),
} as any);

test("the score carries the song's title, not the name of the ensemble", () => {
  const xml = exportScoreModelToMusicXML(score({ title: 'The Everlasting Love Of God' }));
  assert.match(xml, /<work-title>The Everlasting Love Of God<\/work-title>/);
  assert.doesNotMatch(xml, /<work-title>full_orchestra<\/work-title>/);
});

test('with no title of its own it still says something', () => {
  const xml = exportScoreModelToMusicXML(score({}));
  assert.match(xml, /<work-title>[^<]+<\/work-title>/, 'the title must not be empty');
});

test('the composer and the copyright notice survive the journey', () => {
  const rights = '2020 Getty Music | All rights reserved. Used by permission | CCLI #PENDING';
  const xml = exportScoreModelToMusicXML(score({
    title: 'A Song', composer: 'Matt Boswell, Matt Papa', arranger: 'Jeff Moore', rights,
  }));
  assert.match(xml, /<creator type="composer">Matt Boswell, Matt Papa<\/creator>/);
  assert.match(xml, /<creator type="arranger">Jeff Moore<\/creator>/);
  assert.match(xml, /<rights>2020 Getty Music/, 'the copyright notice was dropped');
});

test('the title and composer are engraved, not just recorded', () => {
  // <work-title> alone prints nothing in most readers; credits are the ink.
  const xml = exportScoreModelToMusicXML(score({ title: 'A Song', composer: 'Someone' }));
  assert.match(xml, /<credit-type>title<\/credit-type>/);
  assert.match(xml, /<credit-type>composer<\/credit-type>/);
});

test('nothing is printed into the composer\'s corner beside it', () => {
  // A subtitle was tried twice and the reader dropped it onto the composer's
  // own row both times, printing one string across the other.
  const xml = exportScoreModelToMusicXML(score({
    title: 'A Song', composer: 'Someone', arranger: 'Someone Else',
  }));
  assert.doesNotMatch(xml, /<credit-type>subtitle<\/credit-type>/);
  assert.doesNotMatch(xml, /<credit-type>arranger<\/credit-type>/);
  // It is still recorded as metadata, just not as ink.
  assert.match(xml, /<creator type="arranger">Someone Else<\/creator>/);
});

test('a big score declares a page big enough to hold it', () => {
  const many = exportScoreModelToMusicXML(score({ title: 'A Song' }, 20));
  assert.match(many, /<scaling><millimeters>5\.5<\/millimeters>/,
    'twenty staves need a smaller staff to fit a system');
  assert.match(many, /<page-height>\d+<\/page-height>/);
  assert.match(many, /<page-width>\d+<\/page-width>/);
});

test('a small score is not shrunk for no reason', () => {
  const few = exportScoreModelToMusicXML(score({ title: 'A Song' }, 2));
  assert.match(few, /<scaling><millimeters>7<\/millimeters>/,
    'a two-stave score should keep a readable staff size');
});

test('the same score exports the same bytes, today and tomorrow', () => {
  // The header once carried the day it was written. That made the output a
  // function of the clock rather than of the input: every exported score
  // changed at midnight, and the isolation sweep that guards every change here
  // reported 288 of 300 combinations as different when nothing had been
  // touched. A score that cannot be reproduced byte for byte cannot be
  // verified.
  const s = score({ title: 'A Song', composer: 'Someone', rights: 'All rights reserved' });
  const once = exportScoreModelToMusicXML(s);
  const twice = exportScoreModelToMusicXML(s);
  assert.equal(once, twice, 'two exports of one score differ');
  assert.doesNotMatch(once, /<encoding-date>/, 'the export is dated, so it changes by the day');
  // Provenance is still there, just not the clock.
  assert.match(once, /<software>music-engine<\/software>/);
});
