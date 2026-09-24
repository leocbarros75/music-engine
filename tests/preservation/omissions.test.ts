import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOmissions, omissionsSentence } from '../../src/preservation/omissions';

/**
 * A reduction leaves notes out — four players cannot sound a dense piano
 * texture at once. The fault was never the dropping, it was the silence about
 * it: the reader had to diff two scores by eye and guess whether an absence
 * was a decision or a bug.
 *
 * The reasons here are only ever inferred from evidence in the score, and
 * "unattributed" is a real answer. A plausible wrong reason is worse than no
 * reason, because it stops the reader looking.
 */

const note = (step: string, octave: number, voice = 1, chord = false) =>
  `<note>${chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch>` +
  `<duration>16</duration><voice>${voice}</voice><type>whole</type></note>`;

const piano = (bars: string[]) => `<?xml version="1.0"?><score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">${bars.map((b, i) => `<measure number="${i + 1}">${i === 0
    ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
    : ''}${b}</measure>`).join('')}</part></score-partwise>`;

const played = (parts: Array<{ id: string; name: string; bars: string[] }>) =>
  `<?xml version="1.0"?><score-partwise version="4.0"><part-list>${
    parts.map((p) => `<score-part id="${p.id}"><part-name>${p.name}</part-name></score-part>`).join('')
  }</part-list>${parts.map((p) => `<part id="${p.id}">${p.bars.map((b, i) => `<measure number="${i + 1}">${i === 0
    ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
    : ''}${b}</measure>`).join('')}</part>`).join('')}</score-partwise>`;

test('a note nothing plays is named, with where it came from', () => {
  const src = piano([note('C', 4) + note('E', 4, 1, true)]);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: [note('C', 4)] }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.sourceNotes, 2);
  assert.equal(rec.summary.omitted, 1);
  const [o] = rec.omissions;
  assert.equal(o!.measure, 1);
  assert.equal(o!.sourcePart, 'Piano');
  assert.equal(o!.midi, 64, 'the E, not the C');
});

test('a pitch already sounding elsewhere is called doubling, not loss', () => {
  // The piano plays C4 and C5; the flute takes one of them. The other is not
  // missing from the music — it is missing from the page only.
  const src = piano([note('C', 4) + note('C', 5, 1, true)]);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: [note('C', 5)] }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.omitted, 1);
  assert.equal(rec.omissions[0]!.reason, 'octave_doubling');
});

test('a line dropped throughout is reported as a line, not as loose notes', () => {
  // Voice 2 is an alternate figure the arrangement never uses. Blaming each of
  // its notes separately would bury the one fact worth knowing.
  const bars = Array.from({ length: 6 }, () => note('C', 4) + note('G', 3, 2));
  const src = piano(bars);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: bars.map(() => note('C', 4)) }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.omitted, 6);
  assert(rec.omissions.every((o) => o.reason === 'voice_omitted'),
    `reasons: ${JSON.stringify(rec.summary.byReason)}`);
  assert(rec.omissions[0]!.detail.includes('voice 2'), 'it names the voice');
});

test('an inner note of a chord says the outer parts were taken', () => {
  const src = piano([note('C', 3) + note('E', 4, 1, true) + note('G', 5, 1, true)]);
  const out = played([
    { id: 'P_FL', name: 'Flute', bars: [note('G', 5)] },
    { id: 'P_BN', name: 'Bassoon', bars: [note('C', 3)] },
  ]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.omitted, 1);
  assert.equal(rec.omissions[0]!.reason, 'interior_voice');
});

test('when the score does not say why, it says so', () => {
  // A single top note with nothing kept at that moment: no doubling, no
  // dropped line, nothing outside it. Inventing a rationale here would be
  // worse than admitting the gap.
  const src = piano([note('C', 4), note('D', 4)]);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: [note('C', 4), ''] }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.omitted, 1);
  assert.equal(rec.omissions[0]!.reason, 'unattributed');
  assert(/worth a look/.test(rec.omissions[0]!.detail));
});

test('nothing omitted says so plainly', () => {
  const src = piano([note('C', 4)]);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: [note('C', 4)] }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.omitted, 0);
  assert.match(omissionsSentence(rec), /All 1 source notes are played/);
});

test('the summary adds up to the source', () => {
  const src = piano([note('C', 3) + note('E', 4, 1, true) + note('G', 5, 1, true), note('C', 4, 2)]);
  const out = played([{ id: 'P_FL', name: 'Flute', bars: [note('G', 5), ''] }]);
  const rec = buildOmissions(src, out);
  assert.equal(rec.summary.kept + rec.summary.omitted, rec.summary.sourceNotes);
  assert.equal(rec.omissions.length, rec.summary.omitted);
  const counted = Object.values(rec.summary.byReason).reduce((a, b) => a + b, 0);
  assert.equal(counted, rec.summary.omitted, 'every omission carries exactly one reason');
});
