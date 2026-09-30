import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyBreathing, breathBars, longestRunBeats, longestBreathlessBeats,
         isSectionPart, markStaggeredBreathing } from '../../src/arrange/breathing';
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

test('where a part has no other air: a rest AND a comma', () => {
  // A transcription's only breath is the one we give it. The reference edition
  // writes both at alternating bar ends — the note gives up its tail and the
  // comma says what the gap is for.
  const p = held('P_FL', 'Flute', 4);
  const plan = applyBreathing([p] as any);
  assert(plan.releases > 0, 'the tail is given up');
  const shortened = p.measures.filter((m: any) => m.events[0].dur < 4);
  assert.equal(shortened[0].events[0].dur, 3.5, 'an eighth, not more');
  assert(shortened.every((m: any) => (m.events[0].articulations ?? []).includes('breath-mark')),
    'and every released note carries the comma — the rest alone does not say why it is there');
});

test('where the writing already breathes: a comma alone, no duration touched', () => {
  // The complementary parts rest by the arc and release before each next
  // attack. Clipping their note-ends as well is what read as staccato, which
  // is a dot's instruction and not a comma's.
  for (const dur of [4, 2, 1]) {
    const p = {
      part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
      measures: Array.from({ length: 6 }, (_, i) =>
        bar(i + 1, Array.from({ length: 4 / dur }, (_, j) => note(j * dur, dur, 72)))),
    };
    const before = JSON.stringify(p.measures.map((m: any) => m.events.map((e: any) => e.dur)));
    const plan = applyBreathing([p] as any, { writeRests: false });
    assert.equal(plan.releases, 0, `dur=${dur}: a note was shortened`);
    assert(plan.marks > 0, `dur=${dur}: no breath was asked for at all`);
    assert.equal(JSON.stringify(p.measures.map((m: any) => m.events.map((e: any) => e.dur))), before,
      `dur=${dur}: durations changed`);
  }
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

test('an eighth gives up half of itself rather than leave no rest at all', () => {
  // The reference is explicit: "if it is already short, half its duration is
  // released instead", and some of its rests are sixteenths. Refusing to halve
  // an eighth left sixteen-bar stretches with no rest anywhere, because in a
  // busy passage every barline lands on one.
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, Array.from({ length: 8 }, (_, j) => note(j * 0.5, 0.5, 72)))),
  };
  applyBreathing([p] as any);
  const halved = p.measures.flatMap((m: any) => m.events).filter((e: any) => e.dur === 0.25);
  assert(halved.length > 0, 'the eighth at the barline was halved');
  assert(halved.every((e: any) => (e.articulations ?? []).includes('breath-mark')),
    'and still says why the gap is there');
});

test('a sixteenth is left whole — there is nothing left to give', () => {
  const p = {
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1,
    measures: Array.from({ length: 4 }, (_, i) =>
      bar(i + 1, Array.from({ length: 16 }, (_, j) => note(j * 0.25, 0.25, 72)))),
  };
  const plan = applyBreathing([p] as any);
  assert.equal(plan.releases, 0, 'nothing was short enough to halve');
  assert(plan.marks > 0, 'so it asked for the breath instead');
  assert(p.measures.flatMap((m: any) => m.events).every((e: any) => e.dur === 0.25),
    'no note lost any of its value');
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

// ── Sections ────────────────────────────────────────────────────────────────

test('two players on one staff are a section; one player is not', () => {
  const named = (name: string) => ({ part_id: 'X', name, instrument: name, measures: [] } as any);
  for (const n of ['Horn 1-2', 'Horn 3-4', 'Trumpet 1-2', 'Trumpet 2-3 (Alto Sax)',
                   'Trombone 3/Tuba', 'Flute/Oboe', 'Horn a 2']) {
    assert(isSectionPart(named(n)), `"${n}" shares a staff`);
  }
  for (const n of ['Flute', 'Oboe', 'Clarinet in Bb', 'Bassoon', 'Trumpet 1', 'Tuba']) {
    assert(!isSectionPart(named(n)), `"${n}" is one player`);
  }
});

test('a section is told to stagger, and its music is left alone', () => {
  const p = held('P_HN', 'Horn 1-2', 24);
  const before = p.measures.map((m: any) => m.events[0].dur);
  const marked = markStaggeredBreathing([p] as any);
  assert.equal(marked, 1);
  assert.deepEqual(p.measures.map((m: any) => m.events[0].dur), before,
    'not a single note was shortened — the players cover for each other');
  assert.equal((p.measures[0] as any).performance.words[0].text, 'stagger breathing');
});

test('asking twice does not print it twice', () => {
  const p = held('P_HN', 'Horn 1-2', 8);
  markStaggeredBreathing([p] as any);
  assert.equal(markStaggeredBreathing([p] as any), 0, 'already marked');
  assert.equal((p.measures[0] as any).performance.words.length, 1);
});

test('the direction reaches the MusicXML over that part, and no other', () => {
  const part = (id: string, name: string) => ({
    part_id: id, name, instrument: name, staves: 1, pitchSpace: 'sounding',
    measures: [bar(1, [{ ...note(0, 4, 72), pitch: { step: 'C', octave: 5 } }])],
  });
  const score: any = {
    score_id: 's', meta: { ensemble: 'symphonic_orchestra' }, global: { divisions: 4 },
    parts: [part('P_HN', 'Horn 1-2'), part('P_FL', 'Flute')],
  };
  markStaggeredBreathing([score.parts[0]]);
  const xml = exportScoreModelToMusicXML(score);
  assert(xml.includes('<words>stagger breathing</words>'), 'the direction is written');
  const horn = xml.split('<part id="P_HN"')[1]!.split('</part>')[0];
  const flute = xml.split('<part id="P_FL"')[1]!.split('</part>')[0];
  assert(horn.includes('stagger breathing'), 'over the horns');
  assert(!flute.includes('stagger breathing'),
    'and NOT over the flute, who has written rests instead');
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

test('a stretch with nowhere legal to breathe does not abandon the rest of the part', () => {
  // The repair loop used to stop at the first stretch it could not fix, so one
  // tied passage left every later stretch unrepaired. Tightening the orchestra's
  // limit from eight beats to four made it visible rather than causing it: the
  // bassoon and first horn came out at 15.75 beats where four had been asked
  // for, WORSE than under the wider limit, which had simply not asked as often.
  //
  // Two false starts are baked into this fixture. The stretches must be
  // SEPARATED by a rest, or they merge into one span, the repair finds a legal
  // barline inside it and the failure path is never reached. And the assertion
  // has to be about the resulting SPANS, not about whether breath marks appear:
  // the planned pass puts marks in those bars on its own, so counting them
  // passes against the bug.
  const bar = (number: number, events: any[]) => ({
    number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
  });
  const whole = (id: string, extra: any = {}) => ({
    id, t: 0, dur: 4, midi: 72, type: 'note' as const, voice: 1, staff: 1,
    pitch: { step: 'C', octave: 5 }, ...extra,
  });
  const silent = (id: string) => ({
    id, t: 0, dur: 4, type: 'rest' as const, isRest: true, voice: 1, staff: 1,
  });

  const part: any = {
    part_id: 'P_BSN', name: 'Bassoon', instrument: 'bassoon', staves: 1,
    measures: [
      // Bars 1-3: tied across every barline. Twelve beats, nowhere legal.
      bar(1, [whole('a', { tieStart: true })]),
      bar(2, [whole('b', { tieStart: true, tieStop: true })]),
      bar(3, [whole('c', { tieStop: true })]),
      bar(4, [silent('r')]),          // the gap that makes them two stretches
      // Bars 5-9: ordinary whole notes, every barline legal.
      bar(5, [whole('d')]), bar(6, [whole('e')]), bar(7, [whole('f')]),
      bar(8, [whole('g')]), bar(9, [whole('h')]),
    ],
  };

  applyBreathing([part], { maxBreathlessBeats: 4 });

  // What a player is actually asked to hold in the LATER stretch, bars 5-9.
  let longest = 0;
  let run = 0;
  for (let i = 4; i < part.measures.length; i++) {
    const notes = (part.measures[i].events ?? []).filter((e: any) => e.type === 'note');
    if (!notes.length) { run = 0; continue; }
    run += notes.reduce((n: number, e: any) => n + Number(e.dur), 0);
    longest = Math.max(longest, run);
    const breathes = notes.some((e: any) =>
      Array.isArray(e.articulations) && e.articulations.includes('breath-mark'));
    if (breathes) run = 0;
  }
  assert(longest <= 4 + 1e-9,
    `the stretch after the tied one still runs ${longest} beats — repair stopped at the tied passage`);

  const breathsIn = (i: number) =>
    (part.measures[i].events ?? []).filter((e: any) =>
      Array.isArray(e.articulations) && e.articulations.includes('breath-mark')).length;
  assert.equal(breathsIn(0) + breathsIn(1), 0, 'a tie was broken to force a breath');
});
