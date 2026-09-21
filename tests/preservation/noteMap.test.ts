import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNoteMap, noteMapToCsv, lostRows } from '../../src/preservation/noteMap';
import { auditNoteConservation } from '../../src/preservation/noteConservation';

/** A score whose parts each play one chord in bar 1. `[step, octave]` pairs. */
const score = (parts: Array<{ id: string; name: string; notes: Array<[string, number]> }>) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list>` +
  parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`).join('') +
  `</part-list>` +
  parts.map((p) => `<part id="${p.id}"><measure number="1">` +
    `<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
    p.notes.map(([step, octave], i) =>
      `<note>${i > 0 ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
      `<duration>4</duration><type>whole</type></note>`).join('') +
    `</measure></part>`).join('') +
  `</score-partwise>`;

const PIANO = (notes: Array<[string, number]>) => score([{ id: 'P1', name: 'Piano', notes }]);

test('every source note gets a row, whether or not it arrived', () => {
  const src = PIANO([['C', 4], ['E', 4], ['G', 4]]);
  const out = score([{ id: 'P_FL', name: 'Flute', notes: [['G', 4]] }]);
  const map = buildNoteMap(src, out);
  assert.equal(map.rows.length, 3, 'three source notes, three rows');
  assert.equal(map.summary.lost, 2);
  assert.deepEqual(map.rows.map((r) => r.sourceMidi), [60, 64, 67]);
});

test('a row names the instrument that took the note', () => {
  const src = PIANO([['C', 4], ['G', 4]]);
  const out = score([
    { id: 'P_FL', name: 'Flute', notes: [['G', 4]] },
    { id: 'P_BN', name: 'Bassoon', notes: [['C', 4]] },
  ]);
  const map = buildNoteMap(src, out);
  const byMidi = new Map(map.rows.map((r) => [r.sourceMidi, r]));
  assert.equal(byMidi.get(60)!.destinationPart, 'Bassoon');
  assert.equal(byMidi.get(60)!.destination, 'P_BN');
  assert.equal(byMidi.get(67)!.destinationPart, 'Flute');
});

test('a note that did not move reports a zero shift, not a missing one', () => {
  const map = buildNoteMap(PIANO([['C', 4]]), score([{ id: 'P_FL', name: 'Flute', notes: [['C', 4]] }]));
  assert.equal(map.rows[0]!.octaveShift, 0);
  assert.equal(map.rows[0]!.soundingMidi, 60);
});

test('a moved note reports how far, in octaves and in pitch', () => {
  const map = buildNoteMap(PIANO([['C', 6]]), score([{ id: 'P_BN', name: 'Bassoon', notes: [['C', 3]] }]));
  assert.equal(map.rows[0]!.octaveShift, -3);
  assert.equal(map.rows[0]!.sourceMidi, 84);
  assert.equal(map.rows[0]!.soundingMidi, 48);
});

test('a lost note has no destination rather than a wrong one', () => {
  const map = buildNoteMap(PIANO([['C', 4], ['A', 4]]), score([{ id: 'P_FL', name: 'Flute', notes: [['C', 4]] }]));
  const lost = lostRows(map);
  assert.equal(lost.length, 1);
  assert.equal(lost[0]!.sourceMidi, 69);
  assert.equal(lost[0]!.destination, null);
  assert.equal(lost[0]!.soundingMidi, null);
  assert.equal(lost[0]!.octaveShift, null);
});

test('a note that kept its octave is not robbed by one that did not', () => {
  // The bug this exists to prevent. Three Ds sound together — D2, D4, D6 —
  // over a quartet playing D6 and D2. Walking the source in order, D4 finds no
  // D4 and helps itself to the D6; the real D6 is then reported four octaves
  // down in the bassoon and the D2 is reported lost. All three claims false.
  const src = PIANO([['D', 2], ['D', 4], ['D', 6]]);          // 38, 62, 86
  const out = score([
    { id: 'P_FL', name: 'Flute', notes: [['D', 6]] },          // 86
    { id: 'P_BN', name: 'Bassoon', notes: [['D', 2]] },        // 38
  ]);
  const map = buildNoteMap(src, out);
  const byMidi = new Map(map.rows.map((r) => [r.sourceMidi, r]));
  assert.equal(byMidi.get(86)!.destinationPart, 'Flute', 'D6 belongs to the flute playing D6');
  assert.equal(byMidi.get(86)!.octaveShift, 0);
  assert.equal(byMidi.get(38)!.destinationPart, 'Bassoon', 'D2 belongs to the bassoon playing D2');
  assert.equal(byMidi.get(38)!.octaveShift, 0);
  assert.equal(byMidi.get(62)!.destination, null, 'the D4 is the one with nowhere to go');
});

test('the map and the conservation audit never disagree about a score', () => {
  const cases: Array<[string, string]> = [
    [PIANO([['C', 4], ['E', 4], ['G', 4]]), score([{ id: 'A', name: 'A', notes: [['G', 4]] }])],
    [PIANO([['D', 2], ['D', 4], ['D', 6]]), score([{ id: 'A', name: 'A', notes: [['D', 6]] }, { id: 'B', name: 'B', notes: [['D', 2]] }])],
    [PIANO([['C', 4], ['C', 5]]), score([{ id: 'A', name: 'A', notes: [['C', 4], ['C', 4]] }])],
    [PIANO([['C', 4]]), PIANO([['C', 4]])],
  ];
  for (const [src, out] of cases) {
    const audit = auditNoteConservation(src, out);
    const map = buildNoteMap(src, out);
    assert.deepEqual(
      [map.summary.sourceSegments, map.summary.preserved, map.summary.sameOctave, map.summary.lost],
      [audit.sourceSegments, audit.preserved, audit.sameOctave, audit.lost],
      'one pairing, one answer'
    );
  }
});

test('the summary counts destinations by instrument', () => {
  const src = PIANO([['C', 4], ['E', 4], ['G', 4]]);
  const out = score([
    { id: 'P_FL', name: 'Flute', notes: [['G', 4]] },
    { id: 'P_OB', name: 'Oboe', notes: [['E', 4], ['C', 4]] },
  ]);
  assert.deepEqual(buildNoteMap(src, out).summary.byDestination, { Flute: 1, Oboe: 2 });
});

test('the summary carries the hash of the source it describes', () => {
  const a = buildNoteMap(PIANO([['C', 4]]), PIANO([['C', 4]]));
  const b = buildNoteMap(PIANO([['D', 4]]), PIANO([['D', 4]]));
  assert.match(a.summary.sourceSha256, /^[0-9a-f]{64}$/);
  assert.notEqual(a.summary.sourceSha256, b.summary.sourceSha256);
});

test('the CSV has a header and one line per source note', () => {
  const src = PIANO([['C', 4], ['E', 4]]);
  const out = score([{ id: 'P_FL', name: 'Flute', notes: [['C', 4]] }]);
  const lines = noteMapToCsv(buildNoteMap(src, out)).trimEnd().split('\n');
  assert.equal(lines.length, 3, 'header plus two notes');
  assert.match(lines[0]!, /^measure,beat,durationBeats,/);
  assert.equal(lines[1]!.split(',')[0], '1');
});

test('an instrument name containing a comma cannot split a row', () => {
  const src = PIANO([['C', 4]]);
  const out = score([{ id: 'P_X', name: 'Clarinet, Bass', notes: [['C', 4]] }]);
  const lines = noteMapToCsv(buildNoteMap(src, out)).trimEnd().split('\n');
  assert.match(lines[1]!, /"Clarinet, Bass"/);
  assert.equal(lines.length, 2);
});
