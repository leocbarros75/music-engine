import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';
import { arrangeWorshipOrchestraFromSatb } from '../../src/arrange/orchestra/worshipOrchestraArranger';

/**
 * The SATB orchestra is built on a string-quartet core: every wind and brass
 * part reads one of its four voices. Given a source with no four voices to
 * find — a piano score, a single vocal line — the split hands the score back
 * untouched, which looks like success, and fourteen parts are then spread
 * across one line. Ten of them came out silent and nothing said why.
 *
 * It is not that the mode is broken. Given a real SATB score it fills the
 * roster. It is that the wrong source failed quietly.
 */

const staff = (id: string, pitches: Array<[string, number]>) => `
  <part id="${id}">${pitches.map((p, i) => `
    <measure number="${i + 1}">${i === 0
      ? '<attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>'
      : ''}
      <note><pitch><step>${p[0]}</step><octave>${p[1]}</octave></pitch>
        <duration>16</duration><voice>1</voice><type>whole</type></note>
    </measure>`).join('')}</part>`;

const SATB_SCORE = (() => {
  const S: Array<[string, number]> = [['C', 5], ['D', 5], ['E', 5], ['D', 5], ['C', 5], ['B', 4], ['C', 5], ['C', 5]];
  const A: Array<[string, number]> = [['E', 4], ['F', 4], ['G', 4], ['F', 4], ['E', 4], ['D', 4], ['E', 4], ['E', 4]];
  const T: Array<[string, number]> = [['G', 3], ['A', 3], ['B', 3], ['A', 3], ['G', 3], ['G', 3], ['G', 3], ['G', 3]];
  const B: Array<[string, number]> = [['C', 3], ['D', 3], ['E', 3], ['D', 3], ['C', 3], ['G', 2], ['C', 3], ['C', 3]];
  return `<?xml version="1.0"?><score-partwise version="4.0"><part-list>
    <score-part id="P1"><part-name>Soprano</part-name></score-part>
    <score-part id="P2"><part-name>Alto</part-name></score-part>
    <score-part id="P3"><part-name>Tenor</part-name></score-part>
    <score-part id="P4"><part-name>Bass</part-name></score-part>
    </part-list>${staff('P1', S)}${staff('P2', A)}${staff('P3', T)}${staff('P4', B)}</score-partwise>`;
})();

/** One part, one line — a vocal lead sheet, not a choir. */
const NOT_SATB = `<?xml version="1.0"?><score-partwise version="4.0"><part-list>
  <score-part id="P1"><part-name>Voice</part-name></score-part></part-list>
  ${staff('P1', [['C', 5], ['D', 5], ['E', 5], ['D', 5]])}</score-partwise>`;

const soundingParts = (score: any) =>
  score.parts.filter((p: any) =>
    p.measures.some((m: any) => (m.events ?? []).some((e: any) => e.type === 'note')));

test('a real SATB score fills the orchestra', () => {
  const warnings: string[] = [];
  const out: any = arrangeWorshipOrchestraFromSatb(
    parseMusicXMLToScoreModel(SATB_SCORE), { warnings }).scoreModel;
  const sounding = soundingParts(out);
  assert(out.parts.length >= 12, `expected a full roster, got ${out.parts.length}`);
  // Percussion is intensity-gated and may legitimately sit out a short piece;
  // everything else should be carrying music.
  assert(sounding.length >= out.parts.length - 2,
    `only ${sounding.length} of ${out.parts.length} parts have notes: ` +
    out.parts.filter((p: any) => !sounding.includes(p)).map((p: any) => p.part_id).join(', '));
  assert(!warnings.some((w) => /does not appear to be an SATB score/.test(w)),
    'a valid SATB score must not be accused of being something else');
});

test('the string cushion is never left silent on a valid source', () => {
  const out: any = arrangeWorshipOrchestraFromSatb(
    parseMusicXMLToScoreModel(SATB_SCORE), { warnings: [] }).scoreModel;
  for (const id of ['P_VLN1', 'P_VLN2', 'P_VLA', 'P_CELBS']) {
    const p = out.parts.find((x: any) => x.part_id === id);
    assert(p, `${id} is missing`);
    assert(p.measures.some((m: any) => (m.events ?? []).some((e: any) => e.type === 'note')),
      `${id} has no notes — the strings are the cushion, they play`);
  }
});

test('a source that is not SATB says so instead of going quiet', () => {
  const warnings: string[] = [];
  arrangeWorshipOrchestraFromSatb(parseMusicXMLToScoreModel(NOT_SATB), { warnings });
  const said = warnings.find((w) => /does not appear to be an SATB score/.test(w));
  assert(said, `no warning was raised; got: ${JSON.stringify(warnings)}`);
  assert(said.includes('Voice'), 'it names what it did find, so the user can see the mismatch');
  assert(/piano/i.test(said), 'and points at the mode that would have worked');
});
