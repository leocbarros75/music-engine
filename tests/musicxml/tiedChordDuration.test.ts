import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';

const DIV = 4;

const note = (t: number, dur: number, step: string, octave: number, chord = false, extra = {}) => ({
  id: `${step}${octave}@${t}`, t, dur, type: 'note' as const,
  pitch: { step, octave }, voice: 1, staff: 1, ...(chord ? { chord: true } : {}), ...extra,
});

const score = (events: any[]) => ({
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 1,
    measures: [{
      number: 1,
      attributes: { divisions: DIV, key_fifths: 0, time: { beats: 4, beat_type: 4 } },
      events,
    }],
  }],
  meta: {},
}) as any;

/** Every <note> in document order: [hasChord, duration, tieStart, tieStop]. */
function notesOf(xml: string) {
  const bar = xml.slice(xml.indexOf('<measure number="1"'), xml.indexOf('</measure>'));
  return [...bar.matchAll(/<note>(.*?)<\/note>/gs)].map((m) => {
    const s = m[1]!;
    return {
      chord: s.includes('<chord/>'),
      rest: s.includes('<rest/>'),
      step: s.match(/<step>(\w)<\/step>/)?.[1] ?? null,
      dur: Number(s.match(/<duration>(\d+)<\/duration>/)?.[1]),
      tieStart: s.includes('tie type="start"'),
      tieStop: s.includes('tie type="stop"'),
    };
  });
}

test('a chord too long for one note value is tied, not truncated', () => {
  // 3.5 beats: dotted half (12) tied to an eighth (2). It used to snap to 12
  // and drop the eighth, shifting everything after it in the voice.
  const xml = exportScoreModelToMusicXML(score([
    note(0, 3.5, 'D', 3), note(0, 3.5, 'A', 3, true),
    note(3.5, 0.5, 'B', 3),
  ]));
  const ns = notesOf(xml).filter((n) => !n.rest);
  assert.deepEqual(ns.map((n) => n.dur), [12, 12, 2, 2, 2]);
  assert.deepEqual(ns.map((n) => n.chord), [false, true, false, true, false]);
  assert.deepEqual(ns.slice(0, 4).map((n) => n.tieStart), [true, true, false, false]);
  assert.deepEqual(ns.slice(0, 4).map((n) => n.tieStop), [false, false, true, true]);
});

test('each tied piece is a complete stack, in document order', () => {
  // <chord/> attaches a note to the one before it, so the pieces must not
  // interleave: stack, then stack — never note-a-piece-1, note-a-piece-2, ...
  const xml = exportScoreModelToMusicXML(score([
    note(0, 1.25, 'C', 4), note(0, 1.25, 'E', 4, true), note(0, 1.25, 'G', 4, true),
  ]));
  const ns = notesOf(xml).filter((n) => !n.rest);
  assert.deepEqual(ns.map((n) => `${n.step}${n.chord ? '+' : ''}`),
    ['C', 'E+', 'G+', 'C', 'E+', 'G+']);
  assert.deepEqual(ns.map((n) => n.dur), [4, 4, 4, 1, 1, 1]);
});

test('the bar still adds up, and the time is in the chord rather than a trailing rest', () => {
  const xml = exportScoreModelToMusicXML(score([
    note(0, 1.25, 'C', 4), note(0, 1.25, 'E', 4, true),
    note(1.25, 1.25, 'D', 4),
    note(2.5, 1.5, 'E', 4),
  ]));
  const filled = notesOf(xml).filter((n) => !n.chord).reduce((s, n) => s + n.dur, 0);
  assert.equal(filled, 4 * DIV);
  assert.equal(notesOf(xml).some((n) => n.rest), false, 'no rest should be needed');
});

test('a chord that already fits one note value is written exactly as before', () => {
  const xml = exportScoreModelToMusicXML(score([
    note(0, 2, 'C', 4), note(0, 2, 'E', 4, true), note(0, 2, 'G', 4, true),
    note(2, 2, 'D', 4),
  ]));
  const ns = notesOf(xml).filter((n) => !n.rest);
  assert.deepEqual(ns.map((n) => n.dur), [8, 8, 8, 8]);
  assert.equal(ns.some((n) => n.tieStart || n.tieStop), false, 'no ties for a plain chord');
});

test("a chord whose members disagree on length is not given one", () => {
  // MusicXML gives a chord a single duration. Rather than pick one for the
  // player, such a group falls through to the pre-existing path.
  const xml = exportScoreModelToMusicXML(score([
    note(0, 2, 'C', 4), note(0, 1, 'E', 4, true),
    note(2, 2, 'D', 4),
  ]));
  assert.doesNotThrow(() => parseMusicXMLToScoreModel(xml));
});

test('an existing tie on the chord survives on the outer edges', () => {
  const xml = exportScoreModelToMusicXML(score([
    note(0, 3.5, 'D', 3, false, { tieStart: true }),
    note(0, 3.5, 'A', 3, true, { tieStart: true }),
    note(3.5, 0.5, 'B', 3),
  ]));
  const ns = notesOf(xml).filter((n) => !n.rest);
  // first piece opens no tie-stop; last piece keeps the event's own tie-start
  assert.equal(ns[0]!.tieStop, false);
  assert.equal(ns[2]!.tieStart, true, 'the final piece carries the original tie');
});

test('the result round-trips: the chord reads back at its full length', () => {
  const xml = exportScoreModelToMusicXML(score([
    note(0, 3.5, 'D', 3), note(0, 3.5, 'A', 3, true),
    note(3.5, 0.5, 'B', 3),
  ]));
  const back: any = parseMusicXMLToScoreModel(xml);
  const evs = back.parts[0].measures[0].events.filter((e: any) => e.type === 'note' && !e.chord);
  const filled = evs.reduce((s: number, e: any) => s + Number(e.dur), 0);
  assert.equal(filled, 4);
});
