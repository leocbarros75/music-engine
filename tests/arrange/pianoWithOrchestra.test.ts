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

// Arranging this source now runs the string DP, which costs about half a
// minute. Every test below wants the same two scores, so build each once.
const cache = new Map<string, any>();
const arrange = (ensemble: string) => {
  const hit = cache.get(ensemble);
  if (hit) return hit;
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: readFileSync(SRC, 'utf8'), settings: { ensemble } as any,
  });
  assert(r.ok, `${ensemble} failed: ${r.error}`);
  const out = parseMusicXMLToScoreModel(r.musicxml) as any;
  cache.set(ensemble, out);
  return out;
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
  //
  // Compared against a floor rather than against the transcription's own
  // figure: the two modes are no longer built the same way. This one voices its
  // strings from the chords so it does not double the pianist, and that lands
  // near but not on the transcription's value.
  assert(
    activity(withPiano, 'strings') > 0.8,
    `the cushion thinned out: strings at ${activity(withPiano, 'strings')}`
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

test('the orchestra accompanies the pianist rather than playing along', { skip: !have }, () => {
  // Built from the CHORDS, not from the piano's own notes. The first version of
  // this mode used the piano-copy core, so Violin 1 doubled the piano's top
  // line in 55% of the eighth-note ticks where both sounded. The reference
  // edition, whose stated aim is warmth "without replacing the piano melody",
  // doubles in 17%.
  const out = arrange('piano_with_orchestra');
  const piano = out.parts.find((p: any) => /piano|keyboard/i.test(String(p.name)));
  const v1 = out.parts.find((p: any) => /violin 1|violin i\b/i.test(String(p.name)));
  assert(piano && v1, 'need both the piano and Violin 1');

  const top = (part: any, bar: number, t: number, staff1Only: boolean): number | null => {
    const es = (part.measures[bar]?.events ?? [])
      .filter((e: any) => e.type === 'note' && Number(e.t) <= t + 1e-9 && Number(e.t) + Number(e.dur) > t + 1e-9)
      .filter((e: any) => !staff1Only || Number(e.staff ?? 1) === 1)
      .map((e: any) => Number(e.midi))
      .filter((m: number) => Number.isFinite(m));
    return es.length ? Math.max(...es) : null;
  };
  let sampled = 0, unison = 0;
  const bars = Math.min(piano.measures.length, v1.measures.length);
  for (let b = 0; b < bars; b++) {
    for (let t = 0; t < 4; t += 0.5) {
      const p = top(piano, b, t, true);
      const v = top(v1, b, t, false);
      if (p === null || v === null) continue;
      sampled++;
      if (p === v) unison++;
    }
  }
  assert(sampled > 100, `too few overlapping ticks to judge: ${sampled}`);
  const rate = unison / sampled;
  assert(rate < 0.25, `Violin 1 doubles the piano in ${Math.round(100 * rate)}% of ticks`);
});

test('the score is laid out the way orchestration books set it out', { skip: !have }, () => {
  // Woodwinds, brass, percussion, keyboard, strings — with the horns at the top
  // of the brass (they bridge the woodwinds and the rest of it, which is why
  // every text puts them first despite the trumpets being higher), and the
  // piano between the percussion and the strings.
  const names: string[] = arrange('piano_with_orchestra').parts.map((p: any) => String(p.name));
  const at = (re: RegExp) => names.findIndex((n) => re.test(n));

  const flute = at(/^flute/i), bassoon = at(/^bassoon/i);
  const horn1 = at(/^horn 1/i), trumpet1 = at(/^trumpet 1/i), tuba = at(/^tuba/i);
  const timpani = at(/^timpani/i), piano = at(/^piano/i), violin1 = at(/^violin 1/i);
  for (const [label, i] of [['flute', flute], ['bassoon', bassoon], ['horn 1', horn1],
    ['trumpet 1', trumpet1], ['tuba', tuba], ['timpani', timpani], ['piano', piano],
    ['violin 1', violin1]] as Array<[string, number]>) {
    assert(i >= 0, `${label} is missing from the score: ${names.join(', ')}`);
  }
  assert(flute < bassoon, 'the woodwinds are out of order');
  assert(bassoon < horn1, 'the brass should follow the woodwinds');
  assert(horn1 < trumpet1, 'horns come before trumpets in an orchestral score');
  assert(trumpet1 < tuba, 'the tuba belongs at the bottom of the brass');
  assert(tuba < timpani, 'percussion follows the brass');
  assert(timpani < piano, 'the piano sits below the percussion');
  assert(piano < violin1, 'the piano sits above the strings');
});

test('the viola plays with the rest of the cushion', () => {
  // This asserted the opposite for one commit. Matching the reference's 47 of
  // 79 bars measured well and sounded wrong, and the ear is what decides a
  // question like this one. The viola is part of the cushion here.
  const out = arrange('piano_orchestra');
  const barsPlayed = (re: RegExp): number => {
    const p = out.parts.find((x: any) => re.test(String(x.name)));
    assert(p, `no part matching ${re}`);
    return (p.measures ?? []).filter((m: any) =>
      (m.events ?? []).some((e: any) => e.type === 'note')).length;
  };
  const viola = barsPlayed(/^viola/i);
  const violin2 = barsPlayed(/^violin 2/i);
  assert(
    viola >= violin2 - 2,
    `the viola plays ${viola} bars against Violin 2's ${violin2} — it has dropped out of the cushion`
  );
});

test('no bar of the transcription is left with a thin string section', { skip: !have }, () => {
  // Making one inner voice selective must not leave a bar without harmony.
  // Only the transcription is checked: in the piano modes the orchestra enters
  // gradually on purpose and the pianist covers the opening.
  const out = arrange('piano_orchestra');
  const strings = out.parts.filter((p: any) =>
    /violin|viola|cello|double bass/i.test(String(p.name)));
  assert(strings.length >= 5, `expected the full section, found ${strings.length}`);
  const bars = Math.max(...strings.map((p: any) => (p.measures ?? []).length));
  for (let i = 0; i < bars; i++) {
    const sounding = strings.filter((p: any) =>
      (p.measures?.[i]?.events ?? []).some((e: any) => e.type === 'note')).length;
    const anyoneAtAll = out.parts.some((p: any) =>
      (p.measures?.[i]?.events ?? []).some((e: any) => e.type === 'note'));
    if (!anyoneAtAll) continue;
    assert(sounding >= 3, `bar ${i + 1} has only ${sounding} string voice(s)`);
  }
});
