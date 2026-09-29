import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { buildFamilyBalance, classifyFamily, familyBalanceSentence } from '../../src/preservation/familyBalance';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';

/**
 * How much each family actually plays.
 *
 * Share of note count could not see the fault it existed to catch: strings,
 * winds and brass came out 49/32/18 against a target of 48/36/16 while nobody
 * ever rested, because everyone over-played in proportion. The measure that
 * moves is the average, per part, of how much of the piece that part sounds.
 */

const note = (t: number, dur: number, midi = 60) => ({
  id: `n${midi}@${t}`, t, dur, midi, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step: 'C', octave: 4 },
});
const bar = (number: number, events: any[]) => ({
  number, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events,
});
/** `fill` quarter-beats of sound in every one of `bars` four-beat bars. */
const part = (name: string, bars: number, fill: number) => ({
  part_id: `P_${name}`, name, instrument: name.toLowerCase(), staves: 1,
  measures: Array.from({ length: bars }, (_, i) => bar(i + 1, fill > 0 ? [note(0, fill)] : [])),
});
const score = (parts: any[]) => ({ score_id: 's', meta: {}, global: { divisions: 4 }, parts } as any);

test('a bassoon is a woodwind and a bass trombone is brass', () => {
  // Both contain "bass". The classifier in applyParticipation.ts tests that
  // substring first and calls a bassoon a string.
  assert.equal(classifyFamily('Bassoon'), 'woodwinds');
  assert.equal(classifyFamily('contrabassoon'), 'woodwinds');
  assert.equal(classifyFamily('Bass Trombone'), 'brass');
  assert.equal(classifyFamily('Double Bass'), 'strings');
  assert.equal(classifyFamily('Contrabass'), 'strings');
});

test('a brass part keeps its family when a sax player doubles it', () => {
  // Our orchestral staves carry the worship band's doubling in their names.
  // Testing for "sax" first files three brass staves under woodwinds.
  assert.equal(classifyFamily('Trumpet 2-3 (Alto Sax)'), 'brass');
  assert.equal(classifyFamily('Trombone 1-2 (Tenor Sax)'), 'brass');
  assert.equal(classifyFamily('Trombone 3/Tuba (Bari Sax)'), 'brass');
  assert.equal(classifyFamily('Alto Saxophone'), 'woodwinds');
});

test('the double reed called a horn is not brass', () => {
  assert.equal(classifyFamily('English Horn'), 'woodwinds');
  assert.equal(classifyFamily('Cor Anglais'), 'woodwinds');
  assert.equal(classifyFamily('Horn 1-2'), 'brass');
});

test('activity is the share of the piece a part sounds', () => {
  // Two bars of four beats: eight beats total. A part sounding two beats per
  // bar sounds four of the eight.
  const b = buildFamilyBalance(score([part('Violin', 2, 2)]));
  assert.equal(b.totalBeats, 8);
  const st = b.families.find((f) => f.family === 'strings')!;
  assert.equal(st.soundingBeats, 4);
  assert(Math.abs(st.averageActivity - 0.5) < 1e-9, `activity ${st.averageActivity}`);
});

test('a staff carrying two lines cannot sound for longer than the piece', () => {
  // The giveaway that sent me here: a family reported 110% activity, which is
  // impossible. Summing overlapping notes does that; a union does not.
  const twoLines = {
    part_id: 'P_CB', name: 'Cello-Bass', instrument: 'cello', staves: 1,
    measures: [bar(1, [note(0, 4, 48), note(0, 4, 36)]), bar(2, [note(0, 4, 48), note(0, 4, 36)])],
  };
  const b = buildFamilyBalance(score([twoLines]));
  const st = b.families.find((f) => f.family === 'strings')!;
  assert.equal(st.soundingBeats, 8, 'the union of two identical spans is one span');
  assert.equal(st.overlapBeats, 8, 'the second line is reported as overlap');
  assert(st.averageActivity <= 1 + 1e-9, `activity ${st.averageActivity} exceeds the piece`);
});

test('an inverted hierarchy is reported, not averaged away', () => {
  const b = buildFamilyBalance(score([
    part('Violin', 4, 4),    // strings, always sounding
    part('Flute', 4, 1),     // woodwinds, a quarter of the time
    part('Trumpet', 4, 3),   // brass, three quarters — out of order
  ]));
  assert.equal(b.hierarchyHolds, false);
  assert.match(b.violations.join(' '), /brass .* not below woodwinds/);
  assert.match(String(familyBalanceSentence(b)), /out of order/);
});

test('the right order passes', () => {
  const b = buildFamilyBalance(score([
    part('Violin', 4, 4), part('Flute', 4, 2), part('Trumpet', 4, 1),
  ]));
  assert.equal(b.hierarchyHolds, true);
  assert.deepEqual(b.violations, []);
  assert.doesNotMatch(String(familyBalanceSentence(b)), /out of order/);
});

test('it reproduces the reference edition\'s own published figures', () => {
  // The strongest check available: an outside edition states its measurements
  // in prose, and this audit must arrive at the same numbers from its score.
  const f = 'outputs/everlasting-love-piano-orchestra/everlasting-love-piano-orchestra.musicxml';
  if (!existsSync(f)) return; // reference not present in this checkout
  const b = buildFamilyBalance(parseMusicXMLToScoreModel(readFileSync(f, 'utf8')) as any);
  const pct = (name: string) =>
    Math.round(100 * 100 * (b.families.find((x) => x.family === name)?.averageActivity ?? 0)) / 100;
  assert.equal(b.totalBeats, 299, 'the edition states 299 quarter-note beats');
  assert.equal(pct('strings'), 89.97);
  assert.equal(pct('woodwinds'), 10.17);
  assert.equal(pct('brass'), 1.34);
  assert.equal(b.hierarchyHolds, true);
});
