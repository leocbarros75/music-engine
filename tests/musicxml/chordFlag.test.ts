import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

/**
 * `<chord/>` attaches a note to the one before it. The note that OPENS a time
 * slot has nothing to attach to, so it can never carry the tag — MusicXML has
 * no meaning for it and readers fall over.
 *
 * The engine emitted exactly that. Lifting the top line out of a piano's chord
 * stacks carries each note's `chord` flag along, and in its new monophonic part
 * the flag is a lie: a melody of four separate notes was written as a four-note
 * stack on beat one. 71 measures of the choral wind quartet looked like this.
 */

const note = (t: number, dur: number, step: string, octave: number, extra: any = {}) => ({
  id: `n${step}${octave}@${t}`, t, dur, type: 'note' as const, voice: 1, staff: 1,
  pitch: { step, octave }, ...extra,
});
const score = (events: any[]) => ({
  score_id: 's', meta: { ensemble: 'woodwind_ensemble' }, global: { divisions: 4 },
  parts: [{
    part_id: 'P_FL', name: 'Flute', instrument: 'flute', staves: 1, pitchSpace: 'sounding',
    measures: [{ number: 1, attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } }, events }],
  }],
});
const notesOf = (xml: string) =>
  (xml.split('<part id="P_FL"')[1] ?? '').split('</part>')[0].split('<note>').slice(1);

test('a melody carrying stale chord flags is written as a melody, not a stack', () => {
  // Bar 2 of the choral wind quartet: four sequential notes, three of which
  // were inner noteheads of a piano chord before the soprano was lifted out.
  const xml = exportScoreModelToMusicXML(score([
    note(0, 1, 'E', 4, { chord: true }),
    note(1, 2, 'A', 4, { chord: true }),
    note(3, 0.5, 'A', 4, { chord: true }),
    note(3.5, 0.5, 'B', 4),
  ]) as any);
  const notes = notesOf(xml);
  assert.equal(notes.length, 4, 'four notes');
  assert(!notes[0].includes('<chord/>'),
    'the first note of the measure cannot be a chord member — there is nothing before it');
  assert.equal(notes.filter((n) => n.includes('<chord/>')).length, 0,
    'none of them sound together, so none of them is a chord');
});

test('a real chord is still written as a chord', () => {
  const xml = exportScoreModelToMusicXML(score([
    note(0, 4, 'C', 4),
    note(0, 4, 'E', 4, { chord: true }),
    note(0, 4, 'G', 4, { chord: true }),
  ]) as any);
  const notes = notesOf(xml);
  assert.equal(notes.length, 3, 'three noteheads');
  assert(!notes[0].includes('<chord/>'), 'the first opens the slot');
  assert(notes[1].includes('<chord/>') && notes[2].includes('<chord/>'),
    'the other two attach to it');
});

test('the measure adds up — a melody mislabelled as a chord loses its length', () => {
  // The bug hid itself: four notes stacked on beat one total half a beat, and
  // the trailing-rest logic quietly padded the rest of the bar.
  const xml = exportScoreModelToMusicXML(score([
    note(0, 1, 'E', 4, { chord: true }),
    note(1, 2, 'A', 4, { chord: true }),
    note(3, 1, 'B', 4, { chord: true }),
  ]) as any);
  const bar = (xml.split('<part id="P_FL"')[1] ?? '').split('</part>')[0];
  const sounding = [...bar.matchAll(/<note>(?:(?!<\/note>).)*?<duration>(\d+)<\/duration>/gs)]
    .filter((m) => !m[0].includes('<chord/>'))
    .reduce((a, m) => a + Number(m[1]), 0);
  const rests = [...bar.matchAll(/<note><rest\/><duration>(\d+)<\/duration>/g)]
    .reduce((a, m) => a + Number(m[1]), 0);
  assert.equal(sounding + rests, 16, 'four quarters at four divisions each');
  assert.equal(rests, 0, 'the bar is full of notes; nothing needed padding');
});
