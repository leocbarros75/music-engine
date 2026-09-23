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

test('a breath bar is never shared by more than two of the lower parts', () => {
  // The four-bar cycle has two offsets, so in a quartet one pair doubles up.
  // Three at once would leave the texture on the top line alone.
  for (const count of [4, 5]) {
    const seen = new Map<number, number>();
    for (let i = 1; i < count; i++) {
      for (const b of breathBars(i, count, 48)) seen.set(b, (seen.get(b) ?? 0) + 1);
    }
    const worst = Math.max(...seen.values());
    assert(worst <= 2, `${worst} lower parts share a bar in a ${count}-part ensemble`);
  }
});

test('the pair that doubles up is the outer one, not two neighbours', () => {
  // Oboe (1) and bassoon (3) are the furthest apart of the lower three, so
  // what keeps sounding is a top and a middle.
  const share = (a: number, b: number) =>
    [...breathBars(a, 4, 48)].some((x) => breathBars(b, 4, 48).has(x));
  assert(share(1, 3), 'oboe and bassoon share');
  assert(!share(1, 2), 'oboe and clarinet do not');
  assert(!share(2, 3), 'clarinet and bassoon do not');
});

test('the lower parts get air roughly twice as often as a six-bar cycle gave', () => {
  const gaps = [...breathBars(1, 4, 48)].slice(1).map((b, i) => b - [...breathBars(1, 4, 48)][i]);
  assert(gaps.every((g) => g === 4), `candidate gaps: ${JSON.stringify(gaps)}`);
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
  assert(plan.longestBreathlessBeats <= 16,
    `still ${plan.longestBreathlessBeats} beats without air`);
});

test('where the planned bars are unusable, it asks again rather than giving up', () => {
  // The cycle offers this part bars 1, 5, 9… and every one of them is tied
  // onward. A purely positional plan leaves the player with nothing; the
  // choral bassoon ran 32 beats that way.
  const p = held('P_BN', 'Bassoon', 24);
  p.measures.forEach((m: any, i: number) => {
    if ((i + 1) % 4 === 1) (m.events[0] as any).tieStart = true;
  });
  const plan = applyBreathing([p] as any);
  assert(plan.longestBreathlessBeats <= 16,
    `${plan.longestBreathlessBeats} beats without air despite usable bars nearby`);
  // and it still refused to break any of the ties it was told not to touch
  p.measures.forEach((m: any, i: number) => {
    if ((i + 1) % 4 === 1) assert.equal(m.events[0].dur, 4, `bar ${i + 1} tie was broken`);
  });
});

test('a part with nowhere legal to breathe is left alone, not forced', () => {
  // Every bar ties onward: there is no lawful breath anywhere, and inventing
  // one would mean breaking a tie the arranger meant.
  const p = held('P_BN', 'Bassoon', 12);
  for (const m of p.measures) (m.events[0] as any).tieStart = true;
  const plan = applyBreathing([p] as any);
  assert.equal(plan.releases, 0);
  assert.equal(plan.marks, 0);
  assert(p.measures.every((m: any) => m.events[0].dur === 4), 'nothing touched');
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
