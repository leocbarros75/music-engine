import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { pipelineMusicxmlToArrangedMusicxml } from '../../src/pipeline/pipelineMusicxmlToArrangedMusicxml';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';
import { buildPlayabilityAudit } from '../../src/preservation/playability';

/**
 * The soprano was the piano.
 *
 * The harmonizer is handed "the melody". With a preservation lock that is the
 * one protected part, which is monophonic by definition. WITHOUT one it was
 * handed the whole score — and a piano source never has a lock, because a lock
 * needs a single unambiguous monophonic part and a two-stave piano is not one.
 *
 * So it sang the piano. Soprano came out with all 1005 of its notes, spanning
 * D1 to D#5, with four sounding at once on 110 onsets, five on 57 and six on
 * two. The audit called it fine, because a voice had no entry in the instrument
 * catalogue and the range check was skipped entirely.
 *
 * The same mistake the string DP made, where taking the first sounding note
 * handed Violin I the left hand.
 */

const SRC = 'outputs/living-hope-piano-and-strings/original-piano.musicxml';
const have = existsSync(SRC);
const choral = () => {
  const r: any = pipelineMusicxmlToArrangedMusicxml({
    musicxml: readFileSync(SRC, 'utf8'), settings: { ensemble: 'choral' } as any,
  });
  assert(r.ok, `choral failed: ${r.error}`);
  return { score: parseMusicXMLToScoreModel(r.musicxml) as any, warnings: (r.warnings ?? []) as string[] };
};
const partNamed = (score: any, re: RegExp) => {
  const p = score.parts.find((x: any) => re.test(String(x.name)));
  assert(p, `no part matching ${re}`);
  return p;
};

test('a singer is given one note at a time', { skip: !have }, () => {
  const sop = partNamed(choral().score, /^soprano/i);
  for (const m of sop.measures ?? []) {
    const byOnset = new Map<number, number>();
    for (const e of m.events ?? []) {
      if (e.type !== 'note') continue;
      byOnset.set(Number(e.t), (byOnset.get(Number(e.t)) ?? 0) + 1);
    }
    for (const [t, n] of byOnset) {
      assert.equal(n, 1, `bar ${m.number} beat ${t}: the soprano is given ${n} notes at once`);
    }
  }
});

test('the melody is the right hand, not whatever is lowest', { skip: !have }, () => {
  // A third of this source's onsets have nothing attacking in the upper staff —
  // the right hand holds while the left moves. Taking the left hand there is
  // what put a D1 in a soprano part.
  const sop = partNamed(choral().score, /^soprano/i);
  const midis = (sop.measures ?? []).flatMap((m: any) =>
    (m.events ?? []).filter((e: any) => e.type === 'note').map((e: any) => Number(e.midi)))
    .filter((n: number) => Number.isFinite(n));
  assert(midis.length > 0, 'the soprano has no notes');
  assert(Math.min(...midis) >= 48, `the soprano is given ${Math.min(...midis)} — that is the left hand`);
});

test('a voice is judged against a voice range', { skip: !have }, () => {
  // getInstrumentSpec("Soprano") found nothing, so the range check was skipped
  // and a part containing D1 reported outOfRange 0.
  const { score } = choral();
  const audit = buildPlayabilityAudit(score);
  const sop = audit.parts.find((p) => /^soprano/i.test(p.part))!;
  assert(sop.lowSoundingMidi !== null, 'the soprano has no measured range');
  // This source's tune dips below C4, which is a real finding and should be
  // reported rather than silently passed.
  assert(sop.outOfRange > 0,
    'a soprano line reaching below C4 was reported as entirely in range');
});

test('the singers are given somewhere to breathe', { skip: !have }, () => {
  // Every voice ran 188 to 248 beats without air, in music whose whole point is
  // that people sing it.
  const { score, warnings } = choral();
  const audit = buildPlayabilityAudit(score);
  for (const name of [/^soprano/i, /^alto/i, /^tenor/i, /^bass/i]) {
    const p = audit.parts.find((x) => name.test(x.part))!;
    assert(p.breathMarks > 0, `${p.part} has nowhere to breathe in the whole piece`);
    assert(p.maxContinuousBeatsExceptFinal <= 8 + 1e-9,
      `${p.part} holds ${p.maxContinuousBeatsExceptFinal} beats`);
  }
  assert(warnings.some((w) => /^\[choral\] Staggered breathing/.test(w)),
    'the score does not say what it did');
});
