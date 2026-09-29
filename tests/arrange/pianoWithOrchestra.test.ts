import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { pipelineMusicxmlToArrangedMusicxml } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';
import { buildFamilyBalance } from '../../src/preservation/familyBalance';

/**
 * An orchestra written around a pianist who is still playing.
 *
 * "piano_orchestra" reads like this mode and is not: its own docstring calls it
 * a transcription — piano in, orchestra out, no piano in the score. So there
 * was no piano-with-orchestra mode at all, while piano_with_strings,
 * piano_with_woodwinds and piano_with_brass all existed.
 *
 * The difference that matters is not the extra staff. It is that the orchestra
 * has to get out of the way. Our worship orchestra is written to a chart
 * balance in which brass leads, which is right when the orchestra IS the
 * arrangement and wrong the moment a pianist is playing the piece underneath.
 * The Codex editions of one song, one transcription and one with the piano
 * kept, put a number on how much gets out of the way: brass falls from 25.16%
 * of the piece to 1.34%, winds from 35.89% to 10.17%, while the strings hold.
 */

const SRC = 'outputs/everlasting-love-piano-orchestra/original-piano.musicxml';
const have = existsSync(SRC);

const arrange = (ensemble: string) => {
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: readFileSync(SRC, 'utf8'), settings: { ensemble } as any,
  });
  assert(r.ok, `${ensemble} failed: ${r.error}`);
  return parseMusicXMLToScoreModel(r.musicxml) as any;
};
const activity = (score: any, family: string) =>
  buildFamilyBalance(score).families.find((f: any) => f.family === family)?.averageActivity ?? 0;

test('the pianist is still in the score', { skip: !have }, () => {
  const out = arrange('piano_with_orchestra');
  const piano = out.parts.find((p: any) => /piano|keyboard/i.test(String(p.name)));
  assert(piano, `no piano part: ${out.parts.map((p: any) => p.name).join(', ')}`);
  const notes = (piano.measures ?? []).flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note'));
  assert(notes.length > 500, `the piano part is nearly empty: ${notes.length} notes`);
});

test('the orchestra gets out of the way', { skip: !have }, () => {
  // Same source, same orchestra, the only difference being that someone is
  // playing the piano. Strings hold; winds and brass recede.
  const withPiano = arrange('piano_with_orchestra');
  const transcription = arrange('piano_orchestra');

  assert(
    activity(withPiano, 'brass') < activity(transcription, 'brass') / 2,
    `brass barely moved: ${activity(withPiano, 'brass')} vs ${activity(transcription, 'brass')}`
  );
  assert(
    activity(withPiano, 'woodwinds') < activity(transcription, 'woodwinds'),
    'the winds did not recede'
  );
  // The strings are the cushion under the piano and must NOT thin out with the
  // rest — that was the mistake made once already, applying wind thresholds to
  // a string section until the cushion stopped cushioning.
  assert(
    Math.abs(activity(withPiano, 'strings') - activity(transcription, 'strings')) < 0.05,
    `the strings moved: ${activity(withPiano, 'strings')} vs ${activity(transcription, 'strings')}`
  );
});

test('strings, then winds, then brass', { skip: !have }, () => {
  // The order both reference editions hold to, and the one our transcription
  // route breaks. Under a soloist it is not optional.
  const b = buildFamilyBalance(arrange('piano_with_orchestra'));
  assert.equal(b.hierarchyHolds, true, `out of order: ${b.violations.join('; ')}`);
});

test('the transcription route keeps the order too, and keeps no piano', { skip: !have }, () => {
  // This asserted the opposite until Leo decided it: the orchestra was written
  // to a chart balance in which brass leads, and its hierarchy was inverted by
  // design. Both Codex editions of this song put brass under the winds, and
  // that is now the order here as well — so the transcription route passes the
  // same check the piano mode does. What still separates them is how far the
  // winds and brass hold back, not whether the order is right.
  const b = buildFamilyBalance(arrange('piano_orchestra'));
  assert.equal(b.hierarchyHolds, true, `out of order: ${b.violations.join('; ')}`);
  const piano = arrange('piano_orchestra').parts.find((p: any) => /piano|keyboard/i.test(String(p.name)));
  assert(!piano, 'piano_orchestra is a transcription and must not emit a piano part');
});

test('the piano mode still holds back further than the transcription', { skip: !have }, () => {
  // Both orders are right now, so this is what keeps the two modes distinct.
  const withPiano = buildFamilyBalance(arrange('piano_with_orchestra'));
  const transcription = buildFamilyBalance(arrange('piano_orchestra'));
  const brass = (b: any) => b.families.find((f: any) => f.family === 'brass')?.averageActivity ?? 0;
  assert(
    brass(withPiano) < brass(transcription) / 2,
    `brass ${brass(withPiano)} vs ${brass(transcription)} — the piano mode is not holding back`
  );
});
