import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeSatbToWoodwindQuartetDirect } from '../../src/arrange/woodwinds/arrangeSatbToWoodwindQuartet';
import { arrangeSatbToBrassQuartetDirect } from '../../src/arrange/brass/arrangeSatbToBrassQuartet';
import { exportScoreModelToMusicXML } from '../../src/exporters/musicxmlExporter';

/**
 * Lifting a voice out of a piano grand staff into an instrument's own part
 * carries metadata that was true in the stack and is false in the line.
 *
 *   `chord` — "attaches to the note before it" — printed a melody as one
 *             unplayable stack on beat one, in 71 measures.
 *   `staff` — "I live on the lower staff" — a clarinet has only one staff, so
 *             the exporter writes staff 1 while the event still claims 2, and
 *             everything matched back by position is dropped: 13 breath marks
 *             went that way, from the two lower parts of each quartet.
 *
 * Both fail silently. The arrangement sounds correct and the score is wrong.
 */

const note = (t: number, dur: number, step: string, octave: number, staff: number, voice: number, chord = false) => ({
  id: `${step}${octave}@${t}s${staff}`, t, dur, type: 'note' as const,
  pitch: { step, octave }, voice, staff, ...(chord ? { chord: true } : {}),
});

/**
 * A piano-choral grand staff: soprano over alto on the treble, tenor over bass
 * on the bass staff, engraved as chord stacks the way publishers actually set
 * it — lowest notehead first, the ones above it flagged as chord members.
 */
function grandStaffSource() {
  const bar = (number: number) => ({
    number,
    attributes: { divisions: 4, time: { beats: 4, beat_type: 4 } },
    events: [0, 1, 2, 3].flatMap((t) => [
      note(t, 1, 'C', 4, 1, 1),               // alto  (lower of the treble stack)
      note(t, 1, 'G', 4, 1, 1, true),         // soprano, stacked above it
      note(t, 1, 'C', 3, 2, 3),               // bass   (lower of the bass stack)
      note(t, 1, 'E', 3, 2, 3, true),         // tenor, stacked above it
    ]),
  });
  return {
    score_id: 's', meta: { ensemble: 'satb_woodwind_quartet' }, global: { divisions: 4 },
    parts: [{
      part_id: 'P_PNO', name: 'Piano', instrument: 'piano', staves: 2, pitchSpace: 'sounding',
      measures: Array.from({ length: 8 }, (_, i) => bar(i + 1)),
    }],
  };
}

const arrangements = [
  { name: 'woodwind', run: () => arrangeSatbToWoodwindQuartetDirect(grandStaffSource() as any, { warnings: [] }) },
  { name: 'brass',    run: () => arrangeSatbToBrassQuartetDirect(grandStaffSource() as any, { warnings: [] }) },
];

for (const { name, run } of arrangements) {
  test(`${name}: a part with one staff has no note claiming another`, () => {
    const score: any = run();
    assert(score.parts.length >= 4, 'the quartet was built');
    for (const p of score.parts) {
      const declared = Number(p.staves ?? 1);
      for (const m of p.measures) for (const e of m.events ?? []) {
        const s = Number(e.staff ?? 1);
        assert(s >= 1 && s <= declared,
          `${p.name} declares ${declared} staff/staves but has a note on staff ${s}`);
      }
    }
  });

  test(`${name}: no note opening a time slot claims to be a chord member`, () => {
    const score: any = run();
    for (const p of score.parts) {
      for (const m of p.measures) {
        const slots = new Map<string, any[]>();
        for (const e of m.events ?? []) {
          if (e.type !== 'note') continue;
          const k = `${e.voice ?? 1}|${e.t}`;
          slots.set(k, [...(slots.get(k) ?? []), e]);
        }
        for (const [k, g] of slots) {
          assert(g[0].chord !== true,
            `${p.name} bar ${m.number}: the first note of slot ${k} claims to be a chord member`);
        }
      }
    }
  });

  test(`${name}: an articulation on a lower part survives the export`, () => {
    // The staff mismatch dropped these silently, and only on the two lower
    // parts — which is what made it look like a breathing bug.
    const score: any = run();
    let marked = 0;
    for (const p of score.parts) {
      const ev = p.measures[2]?.events?.[0];
      if (!ev) continue;
      ev.articulations = ['accent'];
      marked++;
    }
    assert(marked >= 4, 'every part got one');
    const xml = exportScoreModelToMusicXML(score);
    assert.equal((xml.match(/<accent\s*\/>/g) ?? []).length, marked,
      'every accent reached the MusicXML');
  });
}
