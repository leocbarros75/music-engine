import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

const score = (events: any[], divisions = 4) => ({
  parts: [{
    part_id: 'P1', name: 'Piano', instrument: 'piano', staves: 1,
    measures: [{
      number: 1,
      attributes: { divisions, key_fifths: 0, time: { beats: 4, beat_type: 4 } },
      events,
    }],
  }],
  meta: {},
}) as any;

const note = (t: number, dur: number, step: string, octave: number) => ({
  id: `${step}${octave}@${t}`, t, dur, type: 'note' as const,
  pitch: { step, octave }, voice: 1, staff: 1,
});

const divisionsOf = (xml: string) => Number(xml.match(/<divisions>(\d+)<\/divisions>/)?.[1]);
const notesOf = (xml: string) =>
  [...xml.matchAll(/<note>(.*?)<\/note>/gs)].map((m) => m[1]!).filter((s) => !s.includes('<rest/>'));
const tupletsOf = (xml: string) =>
  [...xml.matchAll(/<actual-notes>(\d+)<\/actual-notes><normal-notes>(\d+)<\/normal-notes>/g)]
    .map((m) => `${m[1]}:${m[2]}`);

/** Three in the time of two — 2/3 of a beat, which no plain value can spell. */
const TRIPLET_BAR = [0, 1, 2, 3, 4, 5].map((i) => note((i * 2) / 3, 2 / 3, 'C', 4 + (i % 2)));

test('a triplet survives export at all', () => {
  const xml = exportScoreModelToMusicXML(score(TRIPLET_BAR));
  assert.equal(notesOf(xml).length, 6, 'all six notes reach the page');
  for (const n of notesOf(xml))
    assert.match(n, /<type>/, 'a note with no <type> becomes a ghost rest on import');
});

test('it is written as what it is: three quarters in the time of two', () => {
  const xml = exportScoreModelToMusicXML(score(TRIPLET_BAR));
  assert.deepEqual(tupletsOf(xml), Array(6).fill('3:2'));
  for (const n of notesOf(xml)) assert.match(n, /<type>quarter<\/type>/);
});

test('the divisions rises only as far as the rhythm needs', () => {
  // Four divisions of a quarter cannot express a third of one. Twelve can, and
  // there is no reason to go past it.
  assert.equal(divisionsOf(exportScoreModelToMusicXML(score(TRIPLET_BAR))), 12);
});

test('a duple bar keeps the divisions it declared', () => {
  const duple = [note(0, 1, 'C', 4), note(1, 0.5, 'D', 4), note(1.5, 0.5, 'E', 4), note(2, 2, 'F', 4)];
  assert.equal(divisionsOf(exportScoreModelToMusicXML(score(duple))), 4);
  assert.deepEqual(tupletsOf(exportScoreModelToMusicXML(score(duple))), []);
});

test('a power-of-two divisions can never produce a tuplet', () => {
  // The guarantee that every existing ensemble's output is unchanged: at 4, 8
  // or 16 divisions every writable note value is a power of two, so no group
  // of three or five can be built from one. Durations that do not fit are tied
  // together out of ordinary values, exactly as before.
  for (const divisions of [4, 8, 16]) {
    for (const dur of [3.5, 1.25, 2.5, 0.75, 1.75, 3.75]) {
      const xml = exportScoreModelToMusicXML(score([note(0, dur, 'C', 4)], divisions));
      assert.equal(divisionsOf(xml), divisions, `divisions ${divisions} moved for dur ${dur}`);
      assert.deepEqual(tupletsOf(xml), [], `dur ${dur} invented a tuplet at ${divisions} divisions`);
    }
  }
});

test('an irregular group is spelled by its own arithmetic, not a guessed ratio', () => {
  // Five in the time of seven eighths — 0.7 of a beat each. The reference score
  // declares exactly this; a hardcoded table of the usual tuplets would have
  // mangled it the way the old code mangled every triplet.
  const five = [0, 1, 2, 3, 4].map((i) => note(0.5 + i * 0.7, 0.7, 'C', 4));
  const xml = exportScoreModelToMusicXML(score([note(0, 0.5, 'G', 4), ...five]));
  assert.deepEqual(tupletsOf(xml), Array(5).fill('5:7'));
  for (const n of notesOf(xml).slice(1)) assert.match(n, /<type>eighth<\/type>/);
});

const rest = (t: number, dur: number) => ({ id: `r@${t}`, t, dur, type: 'rest' as const, voice: 1, staff: 1 });

test('a score carrying debris no notation can spell keeps the divisions it had', () => {
  // An arranger working on an irregular grid leaves slivers — a twentieth of a
  // beat. No divisions writes one of those, and a finer divisions that makes
  // it exactly representable but unwritable is worse than a coarse one that
  // rounds it: the rounding at least printed. So the score stays where it was.
  const withDebris = [note(0, 3.25, 'C', 4), rest(3.25, 0.05), note(3.3, 2 / 3, 'D', 4)];
  assert.equal(divisionsOf(exportScoreModelToMusicXML(score(withDebris))), 4);
});

test('a gap between notes counts as much as a note', () => {
  // The gap has to be written as a rest, so it constrains the divisions the
  // same way a duration does. Judging only the notes let a bar of perfectly
  // representable notes export at a divisions whose leftover gap had no
  // spelling, and it printed as a rest with no <type> — a ghost rest.
  const gapped = [note(0, 0.25, 'C', 4), note(0.3, 2 / 3, 'D', 4)];
  assert.equal(divisionsOf(exportScoreModelToMusicXML(score(gapped))), 4);
});

test('every rest that is written has a note value', () => {
  for (const events of [
    [note(0, 3.25, 'C', 4), rest(3.25, 0.05), note(3.3, 2 / 3, 'D', 4)],
    [note(0, 0.25, 'C', 4), note(0.3, 2 / 3, 'D', 4)],
    [note(0, 0.5, 'C', 4), note(2, 0.5, 'D', 4)],
    TRIPLET_BAR,
  ]) {
    const xml = exportScoreModelToMusicXML(score(events));
    const all = [...xml.matchAll(/<note>(.*?)<\/note>/gs)].map((m) => m[1]!);
    for (const n of all)
      assert.match(n, /<type>/, `a type-less ${n.includes('<rest/>') ? 'rest' : 'note'} becomes a ghost rest`);
  }
});

test('the bar still adds up', () => {
  for (const events of [TRIPLET_BAR, [note(0, 0.5, 'G', 4), ...[0, 1, 2, 3, 4].map((i) => note(0.5 + i * 0.7, 0.7, 'C', 4))]]) {
    const xml = exportScoreModelToMusicXML(score(events));
    const div = divisionsOf(xml);
    const total = [...xml.matchAll(/<duration>(\d+)<\/duration>/g)].reduce((s, m) => s + Number(m[1]), 0);
    assert.equal(total, 4 * div, 'the measure is exactly four beats of written time');
  }
});
