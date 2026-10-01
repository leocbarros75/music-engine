import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { markPizzicato } from '../../src/arrange/strings/pizzicato';
import { restThinBars, isChart } from '../../src/arrange/strings/restArc';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';

const PIANO_SRC = 'outputs/living-hope-piano-and-strings/original-piano.musicxml';
const CHART_SRC = 'outputs/washed-string-auto/source-rhythm.musicxml';
const haveSources = existsSync(PIANO_SRC) && existsSync(CHART_SRC);

/**
 * Plucking, and what a chart does not tell you.
 *
 * The engine never wrote "Pizz." or "Arco" at all. The reference edition of a
 * rhythm chart marks each seven times, and more than a third of its events are
 * plucked — a cello reading an unmarked part uses the bow, which is a different
 * sound from the one the writing is reaching for.
 *
 * And a chart is not a score. A rhythm slash is a pitched note wearing a slash
 * notehead: it says "play the chord, this rhythm" and nothing about how thick
 * the music is. Counting notes per bar on one measures NOTATION, so the rest
 * arc thinned the section on exactly the bars it should have been driving —
 * forty bars of it, where the reference rests its inner voices for one bar in
 * a hundred and twenty-four.
 */

const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
const note = (t: number, dur: number, extra: any = {}) => ({
  id: `n${t}`, t, dur, midi: 48, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 3 }, ...extra,
});
/** `shape` per bar: 'short' is a plucked pulse, 'long' a sustained bow. */
const part = (name: string, shape: Array<'short' | 'long'>) => ({
  part_id: `P_${name}`, name, instrument: name.toLowerCase(), staves: 1,
  measures: shape.map((s, i) => bar(i + 1, s === 'short'
    ? [note(0, 0.5), note(1, 0.5), note(2, 0.5), note(3, 0.5)]
    : [note(0, 4)])),
});
const wordsOf = (p: any) => p.measures.flatMap((m: any) =>
  (m.performance?.words ?? []).map((w: any) => String(w.text)));

test('the lower strings are told when they are plucking', () => {
  const vc = part('Cello', [...Array(8).fill('short'), ...Array(8).fill('long')] as any);
  const plans = markPizzicato([vc]);
  assert.equal(plans.length, 1, 'the cello was not marked');
  assert.deepEqual(wordsOf(vc), ['Pizz.', 'Arco'], `got ${wordsOf(vc).join(', ')}`);
});

test('a direction lands on its own part and no other', () => {
  // The parts are built by shallow-copying measures, so the measure objects are
  // distinct while sharing ONE performance object between them. Pushing into it
  // put "Pizz." over the violins: all five parts came back carrying the cello's
  // marks, five words each, including the three that never pluck.
  const shape = [...Array(8).fill('short'), ...Array(8).fill('long')] as any;
  const vc = part('Cello', shape);
  const v1 = part('Violin I', shape);
  const shared = { words: [] as any[] };
  (vc.measures[0] as any).performance = shared;   // the sharing, exactly
  (v1.measures[0] as any).performance = shared;

  markPizzicato([vc, v1]);
  assert.deepEqual(wordsOf(v1), [], `the violin was given ${wordsOf(v1).join(', ')}`);
  assert(wordsOf(vc).includes('Pizz.'), 'the cello lost its own mark');
});

test('a violin is not asked to pluck', () => {
  const v1 = part('Violin I', Array(16).fill('short') as any);
  assert.deepEqual(markPizzicato([v1]), [], 'a violin was marked');
});

test('the bow is the default, so Arco alone is not written', () => {
  // A part that only ever sustains needs no instruction at all.
  const vc = part('Cello', Array(16).fill('long') as any);
  assert.deepEqual(markPizzicato([vc]), [], 'a sustaining part was told to use the bow');
  assert.deepEqual(wordsOf(vc), []);
});

test('a brief change of texture does not flip the instruction', () => {
  // Two bars of short notes inside a sustained passage is not worth putting the
  // instrument down for. A player reading Pizz./Arco three bars running stops.
  const vc = part('Cello', [
    ...Array(6).fill('long'), 'short', 'short', ...Array(8).fill('long'),
  ] as any);
  assert.deepEqual(markPizzicato([vc]), [], `got ${wordsOf(vc).join(', ')}`);
});

test('a chart is not thinned, because its slashes are not thin writing', () => {
  const slashBar = (n: number) => bar(n, [
    note(0, 1, { notehead: 'slash' }), note(1, 1, { notehead: 'slash' }),
    note(2, 1, { notehead: 'slash' }), note(3, 1, { notehead: 'slash' }),
  ]);
  const dense = (n: number) => bar(n, Array.from({ length: 16 }, (_, i) => note(i * 0.25, 0.25)));

  // Alternating. On note count alone the slash bars look a quarter as thick,
  // which is what rested the rhythm section on the bars carrying the groove.
  const chart = {
    part_id: 'P0', name: 'Rhythm',
    measures: Array.from({ length: 16 }, (_, i) => (i % 2 ? slashBar(i + 1) : dense(i + 1))),
  };
  const cb = part('Double Bass', Array(16).fill('long') as any);
  assert.equal(restThinBars([cb], chart).size, 0, 'the chart was thinned');

  // The same shape WITHOUT slash noteheads is a score, and is still thinned.
  const score = {
    part_id: 'P0', name: 'Piano',
    measures: Array.from({ length: 16 }, (_, i) => (i % 2
      ? bar(i + 1, [note(0, 1), note(1, 1), note(2, 1), note(3, 1)])
      : dense(i + 1))),
  };
  const cb2 = part('Double Bass', Array(16).fill('long') as any);
  assert(restThinBars([cb2], score).size > 0, 'a real score stopped being thinned');
});

/**
 * And only where there is evidence for it.
 *
 * Asked of every source, the rule above marked a BAROQUE arrangement as
 * plucked: its cello is 89% quarter notes and its bass 93%, which is a walking
 * continuo line, and a continuo line is played with the bow. The evidence for
 * plucking is one pop rhythm chart. That is as far as the rule goes, and the
 * gate is the same chart test the rest arc uses.
 *
 * Checked on the real sources rather than through the pipeline: arranging them
 * takes about a minute each, and what needs proving is the DECISION, not that
 * the arranger runs.
 */
test('a real chart is recognised and a real score is not', { skip: !haveSources }, () => {
  const first = (file: string) => (parseMusicXMLToScoreModel(readFileSync(file, 'utf8')) as any).parts[0];
  assert.equal(isChart(first(CHART_SRC)), true, 'the rhythm chart was not recognised');
  assert.equal(isChart(first(PIANO_SRC)), false, 'a piano score was taken for a chart');
});
