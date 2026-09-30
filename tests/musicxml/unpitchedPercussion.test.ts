import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';
import { buildPlayabilityAudit } from '../../src/preservation/playability';

/**
 * A drum is a note.
 *
 * MusicXML writes one as a <note> with <unpitched> where the pitch would be.
 * The parser had no branch for that, so it fell through to the one for a note
 * with no pitch at all and filed every drum hit as a REST: reading a score back
 * in deleted its drum part, and re-exporting it wrote silence.
 *
 * Everything built on the model inherited the hole. The playability audit
 * counted only type "note", so a full percussion part reported zero events and
 * read as an empty staff — a claim I made twice in one session, once about the
 * orchestra's percussion and once about the jazz band's drums. Both were full
 * of music: 224 hits in the one I called silent.
 */

const hit = (t: number, instrumentId: string) => ({
  id: `d${t}`, t, dur: 1, type: 'unpitched' as const, instrumentId, voice: 1, staff: 1,
});
const drumPart = {
  part_id: 'P_DR', name: 'Drums', instrument: 'drums', staves: 1,
  measures: [{
    number: 1, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } },
    events: [hit(0, 'kick'), hit(1, 'snare'), hit(2, 'kick'), hit(3, 'snare')],
  }],
};
const score = (parts: any[]) => ({
  score_id: 's', meta: { ensemble: 'jazz_band', title: 'A Song' },
  global: { divisions: 4 }, parts,
} as any);

const drumsIn = (s: any) => {
  const p = s.parts.find((x: any) => /drum/i.test(String(x.name)));
  assert(p, 'no drum part');
  return (p.measures ?? []).flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'unpitched'));
};

test('a drum hit survives being read back as a drum hit, not a rest', () => {
  const xml = exportScoreModelToMusicXML(score([drumPart]));
  assert.match(xml, /<unpitched>/, 'the drums were not written out');
  const back = parseMusicXMLToScoreModel(xml) as any;
  assert.equal(drumsIn(back).length, 4, 'the drum hits came back as something else');
  const rests = (back.parts.find((p: any) => /drum/i.test(String(p.name))).measures ?? [])
    .flatMap((m: any) => (m.events ?? []).filter((e: any) => e.type === 'rest'));
  assert.equal(rests.length, 0, 'drum hits were filed as rests');
});

test('a score read in and written out again still has its drums', () => {
  // The destructive half: every round trip used to empty the part.
  const once = exportScoreModelToMusicXML(score([drumPart]));
  const twice = exportScoreModelToMusicXML(parseMusicXMLToScoreModel(once) as any);
  const hits = (xml: string) => (xml.match(/<unpitched>/g) ?? []).length;
  assert.equal(hits(twice), hits(once), `${hits(once)} hits became ${hits(twice)}`);
});

test('the audit counts a drum part as having music in it', () => {
  const a = buildPlayabilityAudit(score([drumPart]));
  const drums = a.parts.find((p) => /drum/i.test(p.part))!;
  assert.equal(drums.events, 4, 'a part full of drums reported as empty');
  assert.equal(drums.silentBars, 0, 'the bar has drums in it');
});

test('a drum has no register to be outside of', () => {
  // Unpitched notes must not reach the range checks: there is no such thing as
  // a snare drum played too high.
  const a = buildPlayabilityAudit(score([drumPart]));
  const drums = a.parts.find((p) => /drum/i.test(p.part))!;
  assert.equal(drums.lowSoundingMidi, null);
  assert.equal(drums.highSoundingMidi, null);
  assert.equal(drums.outOfRange, 0);
  assert.equal(a.totalOutOfRange, 0);
});

test('a drummer is not asked to breathe', () => {
  const a = buildPlayabilityAudit(score([
    drumPart,
    { part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
      measures: [{ number: 1, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } },
        events: [{ id: 'n', t: 0, dur: 4, midi: 72, type: 'note', voice: 1, staff: 1,
          pitch: { step: 'C', octave: 5 } }] }] },
  ]));
  assert.notEqual(a.worst?.part, 'Drums', 'the drummer was named as short of air');
});
