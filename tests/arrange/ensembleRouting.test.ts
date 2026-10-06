import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { pipelineMusicxmlToArrangedMusicxml } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';

/**
 * Asking for one thing and getting another, quietly.
 *
 * "jazz_band" produced a four-part chorale. So did "percussion". So did a name
 * typed at random — all three byte-identical to "choral", with no warning.
 *
 * Both had a working arranger the whole time. mapToJazzBand.ts and
 * mapToPercussion.ts are reached through arrangeRouter.ts, which nothing
 * imports any more: the router went dead when the worship orchestra replaced
 * mapPianoToFullOrchestraOpen, and these went with it. Nobody noticed because
 * the fallback said nothing.
 *
 * So there are two things to keep: the arrangers stay reachable, and an
 * ensemble nobody recognises says so rather than answering a different question.
 */

const SRC = 'outputs/living-hope-piano-and-strings/original-piano.musicxml';
const have = existsSync(SRC);

const run = (ensemble: string) => {
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: readFileSync(SRC, 'utf8'), settings: { ensemble } as any,
  });
  assert(r.ok, `${ensemble} failed: ${r.error}`);
  return { score: parseMusicXMLToScoreModel(r.musicxml) as any, warnings: (r.warnings ?? []) as string[] };
};
const names = (score: any) => score.parts.map((p: any) => String(p.name));
const sounds = (score: any) => score.parts.filter((p: any) =>
  (p.measures ?? []).some((m: any) => (m.events ?? []).some((e: any) =>
    e.type === 'note' || e.type === 'unpitched'))).length;

test('a jazz band is a jazz band, not four voices', { skip: !have }, () => {
  const { score } = run('jazz_band');
  const n = names(score).join(' ').toLowerCase();
  assert(!/soprano|alto,|tenor,|^bass$/.test(names(score).join(',').toLowerCase()) || /sax|trumpet|drum/.test(n),
    `got a chorale: ${names(score).join(', ')}`);
  for (const want of ['sax', 'trumpet', 'trombone', 'bass', 'drum']) {
    assert(n.includes(want), `no ${want} in the band: ${names(score).join(', ')}`);
  }
  assert(sounds(score) >= 5, `only ${sounds(score)} parts actually play`);
});

test('percussion is percussion', { skip: !have }, () => {
  const { score } = run('percussion');
  const n = names(score).join(' ').toLowerCase();
  assert(/percussion|timpani|drum/.test(n), `got: ${names(score).join(', ')}`);
  assert(sounds(score) >= 1, 'nothing plays');
});

test('the two of them are not just the chorale wearing a different name', { skip: !have }, () => {
  // The bug in one line: these were byte-identical to "choral".
  const choral = names(run('choral').score).join(',');
  assert.notEqual(names(run('jazz_band').score).join(','), choral);
  assert.notEqual(names(run('percussion').score).join(','), choral);
});

test('an ensemble nobody recognises says so', { skip: !have }, () => {
  const { warnings, score } = run('not_a_real_ensemble');
  const said = warnings.find((w) => /^\[ensemble\]/.test(w));
  assert(said, `no warning; got: ${warnings.join(' | ')}`);
  assert(said.includes('not_a_real_ensemble'), 'the warning does not name what was asked for');
  assert(/soprano, alto, tenor, bass/i.test(said), 'it does not say what it did instead');
  assert(/jazz_band/.test(said), 'it does not list what could have been asked for');
  // It still produces something playable rather than failing outright.
  assert(sounds(score) >= 1, 'the fallback produced nothing at all');
});

test('a real ensemble is not accused of being unknown', { skip: !have }, () => {
  for (const ensemble of ['choral', 'jazz_band', 'percussion', 'string_ensemble']) {
    const { warnings } = run(ensemble);
    assert(
      !warnings.some((w) => /^\[ensemble\] .* is not an ensemble/.test(w)),
      `${ensemble} was called unknown`
    );
  }
});

test('the horns in the jazz band are given somewhere to breathe', { skip: !have }, () => {
  // All four ran 299 beats — the whole piece — with not one mark in the score.
  // The route simply never called the breathing pass, which the drums had been
  // hiding: with percussion uncounted the audit reported this part of the band
  // as empty rather than as breathless.
  // Counting MARKS was the original assertion, and the band growing to
  // seventeen showed it to be the wrong measure. The derived brass punctuates:
  // Trumpet 2 is silent in 117 of 124 bars and never plays two bars in a row,
  // so it has nothing but air — and it carries no mark, which the mark count
  // read as breathlessness. The fault this test exists for was a 299-BEAT RUN,
  // so that is what it now measures, with the mark still required of the parts
  // that actually carry the chart.
  const { score } = run('jazz_band');
  const winds = score.parts.filter((p: any) => /sax|trumpet|trombone/i.test(String(p.name)));
  assert(winds.length >= 3, `expected a horn section, found ${winds.length}`);

  const BREATHLESS = 8;   // two bars of 4/4 without stopping is already too long
  for (const p of winds) {
    const bars = (p.measures ?? []).length;
    let run = 0, longest = 0, played = 0, marks = 0;
    (p.measures ?? []).forEach((m: any, bi: number) => {
      const es = (m.events ?? [])
        .filter((e: any) => e?.type === 'note' && !e.grace)
        .sort((a: any, b: any) => Number(a.t) - Number(b.t));
      for (const e of es) {
        if (Array.isArray(e.articulations) && e.articulations.includes('breath-mark')) marks++;
      }
      const beats = Number(m?.attributes?.time?.beats ?? 4);
      if (!es.length) { longest = Math.max(longest, run); run = 0; return; }
      played++;
      let cursor = bi * beats;
      for (const e of es) {
        const t = bi * beats + Number(e.t);
        if (t > cursor + 1e-6) { longest = Math.max(longest, run); run = 0; }
        run += Number(e.dur ?? 0);
        cursor = Math.max(cursor, t + Number(e.dur ?? 0));
      }
      if (cursor < (bi + 1) * beats - 1e-6) { longest = Math.max(longest, run); run = 0; }
    });
    longest = Math.max(longest, run);

    assert(
      longest <= BREATHLESS,
      `${p.name} plays ${longest} beats without stopping`
    );
    // A part that holds the line for most of the piece must be given its mark;
    // one that punctuates is resting almost throughout and needs none.
    if (played > bars * 0.5) {
      assert(marks > 0, `${p.name} carries the chart and has nowhere to breathe`);
    }
  }
});
