import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractChordEventsFromMusicXml } from '../../src/extract/chordEventsFromMusicXml';
import { parseChordSymbol } from '../../src/harmonize/satb/chordSymbol';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const spell = (sym: string) => {
  const p: any = parseChordSymbol(sym);
  return p ? p.pcs.map((x: number) => NAMES[x]) : null;
};

/** One bar carrying a single <harmony>, written the way a real chart encodes it. */
const harmony = (inner: string) => `<?xml version="1.0"?><score-partwise version="4.0">
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1"><measure number="1">
<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
${inner}
<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>
</measure></part></score-partwise>`;

const symbolsOf = (xml: string) =>
  (extractChordEventsFromMusicXml(xml) as any).chords.map((c: any) => c.symbol);

// ── The extractor has to carry what <kind> cannot say ───────────────────────

test('an added degree survives extraction', () => {
  // MusicXML says an Ab add2 twice: kind "major", plus a degree of value 2,
  // type add. Reading only the kind loses the tone the chord is named for.
  const xml = harmony(`<harmony><root><root-step>A</root-step><root-alter>-1</root-alter></root>
    <kind text="2">major</kind>
    <degree><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>
    </harmony>`);
  assert.deepEqual(symbolsOf(xml), ['Abadd2']);
});

test('a plain triad is still a plain triad', () => {
  const xml = harmony(`<harmony><root><root-step>A</root-step><root-alter>-1</root-alter></root>
    <kind>major</kind></harmony>`);
  assert.deepEqual(symbolsOf(xml), ['Ab']);
});

test('an added degree and a slash bass both survive together', () => {
  const xml = harmony(`<harmony><root><root-step>A</root-step><root-alter>-1</root-alter></root>
    <kind text="2">major</kind>
    <degree><degree-value>2</degree-value><degree-alter>0</degree-alter><degree-type>add</degree-type></degree>
    <bass><bass-step>C</bass-step></bass></harmony>`);
  assert.deepEqual(symbolsOf(xml), ['Abadd2/C']);
});

test('only ADDED degrees are read; subtract and alter are left alone', () => {
  // Those change the chord in ways a suffix cannot carry. Half-describing them
  // would be worse than leaving the existing behaviour in place.
  for (const type of ['subtract', 'alter']) {
    const xml = harmony(`<harmony><root><root-step>C</root-step></root><kind>major</kind>
      <degree><degree-value>5</degree-value><degree-alter>0</degree-alter><degree-type>${type}</degree-type></degree>
      </harmony>`);
    assert.deepEqual(symbolsOf(xml), ['C'], `${type} should not become a suffix`);
  }
});

test('a raised or lowered addition is spelled, not silently flattened', () => {
  const xml = harmony(`<harmony><root><root-step>C</root-step></root><kind>major</kind>
    <degree><degree-value>11</degree-value><degree-alter>1</degree-alter><degree-type>add</degree-type></degree>
    </harmony>`);
  assert.deepEqual(symbolsOf(xml), ['Cadd#11'], 'the sharp belongs in the name');
});

// ── The parser has to know that a 2nd and a 9th are one pitch class ─────────

test('add2 gives the same chord as add9', () => {
  assert.deepEqual(spell('Cadd2'), spell('Cadd9'));
  assert.deepEqual(spell('Cadd2'), ['C', 'E', 'G', 'D']);
});

test('the added second is actually there', () => {
  // The bug: Abadd2 came out as a bare Ab triad, losing the Bb. Living Hope
  // is built on this chord — twelve of its hundred symbols.
  assert.deepEqual(spell('Abadd2'), ['Ab', 'C', 'Eb', 'Bb']);
});

test('an added second does not displace the third, as a suspension would', () => {
  const add2 = spell('Abadd2')!;
  assert(add2.includes('C'), 'the major third stays');
  assert(add2.includes('Bb'), 'and the second joins it');
  assert.deepEqual(spell('Bbsus4'), ['Bb', 'Eb', 'F'], 'a suspension really does replace the third');
});

test('the minor form keeps its minor third', () => {
  assert.deepEqual(spell('Cmadd2'), ['C', 'Eb', 'G', 'D']);
  assert.deepEqual(spell('Cmadd2'), spell('Cmadd9'));
});

test('a slash bass survives the added tone', () => {
  const p: any = parseChordSymbol('Abadd2/C');
  assert.equal(NAMES[p.bassPc], 'C');
  assert.deepEqual(p.pcs.map((x: number) => NAMES[x]), ['Ab', 'C', 'Eb', 'Bb']);
});

test('parenthesised and spaced spellings read the same', () => {
  for (const sym of ['Cadd2', 'C(add2)', 'Cadd 2'])
    assert.deepEqual(spell(sym), ['C', 'E', 'G', 'D'], sym);
});
