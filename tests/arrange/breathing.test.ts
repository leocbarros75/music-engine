import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBreathing, breathBars, longestRunBeats, longestBreathlessBeats } from '../../src/arrange/breathing';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

const note = (t: number, dur: number, midi: number, extra: any = {}) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 }, ...extra,
});
const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
/** `n` bars of one unbroken whole note each — the shape the engine produced. */
const held = (id: string, name: string, bars: number) => ({
  part_id: id, name, instrument: name, staves: 1,
  measures: Array.from({ length: bars }, (_, i) => bar(i + 1, [note(0, 4, 72)])),
});
const marksIn = (p: any) => p.measures.flatMap((m: any) =>
  (m.events ?? []).filter((e: any) => (e.articulations ?? []).includes('breath-mark')));

// ── The rules ───────────────────────────────────────────────────────────────

test('a long note at the barline gives up its tail, leaving a gap to breathe in', () => {
  const p = held('P_FL', 'Flute', 4);
  const plan = applyBreathing([p] as any);
  assert(plan.releases > 0, 'something was released');
  const shortened = p.measures.filter((m: any) => m.events[0].dur < 4);
  assert(shortened.length > 0, 'at least one bar ends early');
  assert.equal(shortened[0].events[0].dur, 3.5, 'an eighth, not more');
});

test('never out of a tie — the note is still sounding into the next bar', () => {
  const p = held('P_FL', 'Flute', 6);
  for (const m of p.measures) (m.events[0] as any).tieStart = true;
  applyBreathing([p] as any);
  assert(p.measures.every((m: any) => m.events[0].dur === 4), 'nothing touched');
  assert.equal(marksIn(p).length, 0, 'and no mark either');
});

test('never out of the final bar — the players agree a cutoff there', () => {
  const p = held('P_FL', 'Flute', 4);
  applyBreathing([p] as any);
  const last = p.measures[p.measures.length - 1];
  assert.equal(last.events[0].dur, 4, 'the closing bar keeps its full value');
  assert.equal((last.events[0] as any).articulations ?? undefined, undefined, 'and takes no mark');
});

test('a note too short to shorten keeps its value and takes a breath mark', () => {
  // Eighths throughout: half of an eighth is a sixteenth, which is no breath.
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, Array.from({ length: 8 }, (_, j) => note(j * 0.5, 0.5, 72)))),
  };
  const plan = applyBreathing([p] as any);
  assert.equal(plan.releases, 0, 'nothing was long enough to shorten');
  assert(plan.marks > 0, 'so it asked for a breath instead');
  const marked = marksIn(p);
  assert(marked.every((e: any) => e.dur === 0.5), 'no note lost any of its value');
});

test('a quarter becomes an eighth plus an eighth rest — never more than half', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, [0, 1, 2, 3].map((t) => note(t, 1, 72)))),
  };
  applyBreathing([p] as any);
  const shortened = p.measures.flatMap((m: any) => m.events).filter((e: any) => e.dur < 1);
  assert(shortened.length > 0, 'the bar-ending quarter released');
  assert(shortened.every((e: any) => e.dur === 0.5), 'down to an eighth, not below');
});

test('a bar that already ends in air is left alone', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) => bar(i + 1, [note(0, 2, 72)])),
  };
  const plan = applyBreathing([p] as any);
  assert.equal(plan.releases, 0);
  assert.equal(plan.marks, 0);
});

test('a chord at the barline moves as one — a breath is not a way to split it', () => {
  const p = {
    part_id: 'P_FL', name: 'Horn', instrument: 'horn', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, [note(0, 4, 60), note(0, 4, 64, { chord: true })])),
  };
  applyBreathing([p] as any);
  for (const m of p.measures) {
    assert.equal(m.events[0].dur, m.events[1].dur, 'both notes of the chord end together');
  }
});

// ── Staggering ──────────────────────────────────────────────────────────────

test('the lower parts of a quartet never come up for air in the same bar', () => {
  const seen = new Map<number, number>();
  for (let i = 1; i < 4; i++) {
    for (const b of breathBars(i, 4, 48)) seen.set(b, (seen.get(b) ?? 0) + 1);
  }
  const shared = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(shared, [], `bars shared by two lower parts: ${JSON.stringify(shared)}`);
});

test('the top line, most exposed, gets an opportunity every other bar', () => {
  assert.deepEqual([...breathBars(0, 4, 8)], [2, 4, 6, 8]);
});

test('a whole quartet is never silent at once', () => {
  const parts = ['Flute', 'Oboe', 'Clarinet', 'Bassoon'].map((n, i) => held(`P${i}`, n, 40));
  applyBreathing(parts as any);
  for (let barIdx = 0; barIdx < 40; barIdx++) {
    const resting = parts.filter((p) => (p.measures[barIdx].events[0] as any).dur < 4).length;
    assert(resting < parts.length, `every player breathes at once in bar ${barIdx + 1}`);
  }
});

// ── Measuring ───────────────────────────────────────────────────────────────

test('a breath mark breaks the line for the player, not for the notation', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: [bar(1, [note(0, 4, 72, { articulations: ['breath-mark'] })]), bar(2, [note(0, 4, 72)])],
  };
  assert.equal(longestRunBeats(p as any), 8, 'the notation shows eight unbroken beats');
  assert.equal(longestBreathlessBeats(p as any), 4, 'but the player takes air after four');
});

test('the engine used to write a part nobody could play, and no longer does', () => {
  // 62 bars of unbroken tone is what the engine produced before breathing:
  // at 71 to the quarter that is three and a half minutes without air.
  const parts = ['Flute', 'Oboe', 'Clarinet', 'Bassoon'].map((n, i) => held(`P${i}`, n, 62));
  assert.equal(longestBreathlessBeats(parts[0] as any), 248, 'the part as it was');
  const plan = applyBreathing(parts as any);
  assert(plan.longestBreathlessBeats <= 24,
    `still ${plan.longestBreathlessBeats} beats without air`);
});

// ── Serialization ───────────────────────────────────────────────────────────

test('a breath mark reaches the MusicXML as <breath-mark/>, where a player sees it', () => {
  const score: any = {
    score_id: 's', meta: { ensemble: 'woodwind_ensemble' }, global: { divisions: 4 },
    parts: [{
      part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1, pitchSpace: 'sounding',
      measures: [
        bar(1, [{ ...note(0, 4, 72), pitch: { step: 'C', octave: 5 } }]),
        bar(2, [{ ...note(0, 4, 72), pitch: { step: 'C', octave: 5 }, articulations: ['breath-mark'] }]),
      ],
    }],
  };
  const xml = exportScoreModelToMusicXML(score);
  assert(xml.includes('<breath-mark'), 'the mark is written');
  assert(/<articulations>\s*<breath-mark\s*\/>\s*<\/articulations>/.test(xml),
    'inside <articulations>, where MusicXML puts it');
});
