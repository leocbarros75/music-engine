import assert from 'node:assert/strict';
import { test } from 'node:test';
import { auditNoteConservation, collectNotes, TRANSCRIPTION_ENSEMBLES } from '../../src/preservation/noteConservation';

type N = { step: string; octave: number; alter?: number; chord?: boolean };

const note = (n: N, dur = 4) =>
  `<note>${n.chord ? '<chord/>' : ''}<pitch><step>${n.step}</step>` +
  (n.alter ? `<alter>${n.alter}</alter>` : '') +
  `<octave>${n.octave}</octave></pitch><duration>${dur}</duration><type>quarter</type></note>`;

const score = (parts: Array<{ id: string; transpose?: string; bars: string[] }>) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list>` +
  parts.map((p) => `<score-part id="${p.id}"><part-name>${p.id}</part-name></score-part>`).join('') +
  `</part-list>` +
  parts.map((p) => `<part id="${p.id}">` + p.bars.map((b, i) =>
    `<measure number="${i + 1}"><attributes><divisions>4</divisions>` +
    `<time><beats>4</beats><beat-type>4</beat-type></time>${p.transpose ?? ''}</attributes>${b}</measure>`
  ).join('') + `</part>`).join('') +
  `</score-partwise>`;

const oneBar = (...ns: N[]) => score([{ id: 'P1', bars: [ns.map((n) => note(n)).join('')] }]);

test('an unchanged score conserves everything', () => {
  const xml = oneBar({ step: 'C', octave: 4 }, { step: 'E', octave: 4, chord: true });
  const r = auditNoteConservation(xml, xml);
  assert.equal(r.sourceSegments, 2);
  assert.equal(r.preserved, 2);
  assert.equal(r.sameOctave, 2);
  assert.equal(r.lost, 0);
});

test('a dropped note is counted and located', () => {
  const src = oneBar({ step: 'C', octave: 4 }, { step: 'E', octave: 4, chord: true });
  const out = oneBar({ step: 'C', octave: 4 });
  const r = auditNoteConservation(src, out);
  assert.equal(r.lost, 1);
  assert.equal(r.examples.length, 1);
  assert.equal(r.examples[0]!.measure, 1);
  assert.equal(r.examples[0]!.midi, 64); // the E that vanished
});

test('an octave move is preserved, and reported as an octave move', () => {
  const src = oneBar({ step: 'C', octave: 5 });
  const out = oneBar({ step: 'C', octave: 4 });
  const r = auditNoteConservation(src, out);
  assert.equal(r.preserved, 1, 'the note is still there, an octave down');
  assert.equal(r.sameOctave, 0, 'but not at its original pitch');
  assert.equal(r.lost, 0);
});

test('a whole texture dropping an octave loses nothing', () => {
  // The case that broke an earlier version: matching exact pitch first paired
  // the source G4 with the output G4 that was really the G5's destination, then
  // called the G5 lost. Two Gs in, two Gs out.
  const src = oneBar({ step: 'G', octave: 4 }, { step: 'G', octave: 5, chord: true });
  const out = oneBar({ step: 'G', octave: 3 }, { step: 'G', octave: 4, chord: true });
  const r = auditNoteConservation(src, out);
  assert.equal(r.preserved, 2, `expected both Gs, got ${r.preserved} (lost ${r.lost})`);
  assert.equal(r.lost, 0);
});

test('a transposing instrument is compared at sounding pitch', () => {
  // Written D4 on a B flat clarinet sounds C4.
  const src = oneBar({ step: 'C', octave: 4 });
  const out = score([{
    id: 'P1',
    transpose: '<transpose><diatonic>-1</diatonic><chromatic>-2</chromatic></transpose>',
    bars: [note({ step: 'D', octave: 4 })],
  }]);
  const r = auditNoteConservation(src, out);
  assert.equal(r.preserved, 1, 'written D4 sounding C4 should match the source C4');
  assert.equal(r.lost, 0);
});

test('a double bass sounds an octave below its written pitch', () => {
  const src = oneBar({ step: 'E', octave: 2 });
  const out = score([{
    id: 'P1',
    transpose: '<transpose><diatonic>0</diatonic><chromatic>0</chromatic><octave-change>-1</octave-change></transpose>',
    bars: [note({ step: 'E', octave: 3 })],
  }]);
  assert.equal(auditNoteConservation(src, out).lost, 0);
});

test('backup is followed, so a second voice is not placed at the wrong beat', () => {
  const bar =
    note({ step: 'C', octave: 4 }) + note({ step: 'D', octave: 4 }) +
    `<backup><duration>8</duration></backup>` +
    note({ step: 'G', octave: 3 }) + note({ step: 'A', octave: 3 });
  const notes = collectNotes(score([{ id: 'P1', bars: [bar] }]));
  assert.deepEqual(notes.map((n) => [n.onset, n.midi]), [[0, 60], [1, 62], [0, 55], [1, 57]]);
});

test('rests and grace notes are not counted as source material', () => {
  // The rest still advances the beat, so both sides carry it and the C lands
  // on beat 1 in each — the point under test is the COUNT, not the placement.
  const rest = `<note><rest/><duration>4</duration></note>`;
  const grace = `<note><grace/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>`;
  const src = score([{ id: 'P1', bars: [rest + grace + note({ step: 'C', octave: 4 })] }]);
  const out = score([{ id: 'P1', bars: [rest + note({ step: 'C', octave: 4 })] }]);
  const r = auditNoteConservation(src, out);
  assert.equal(r.sourceSegments, 1, 'the rest and the grace note are not source material');
  assert.equal(r.lost, 0);
});

test('only the re-instrumenting ensembles are audited', () => {
  for (const ens of ['piano_string_quartet', 'satb_brass_quartet', 'reinstrument'])
    assert(TRANSCRIPTION_ENSEMBLES.has(ens), `${ens} should be audited`);
  // These arrange from harmony; conservation is not their contract.
  for (const ens of ['string_ensemble', 'piano_with_strings', 'orchestra', 'choral'])
    assert(!TRANSCRIPTION_ENSEMBLES.has(ens), `${ens} should not be audited`);
});
