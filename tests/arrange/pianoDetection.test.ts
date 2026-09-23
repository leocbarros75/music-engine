import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMusicXMLToScoreModel } from '../../src/parsers/musicxmlParser';
import { arrangeBrassQuintetFromPianoInstrumentation } from '../../src/arrange/arrangeBrassQuintetFromPianoInstrumentation';
import { arrangeWoodwindQuartetFromPianoInstrumentation } from '../../src/arrange/arrangeWoodwindQuartetFromPianoInstrumentation';

/**
 * Finding the piano in a score that does not say where it is.
 *
 * A piano-to-brass arrangement of a score whose piano could not be found came
 * back as the piano, unchanged — no error, no warning, just the input again.
 * The real file that exposed it failed three separate ways at once: it is
 * named "Pno. RH", which fails a `"piano"` substring test; it declares
 * <staves>2</staves>, which the parser never read; and its left hand writes
 * staff 2, which brass and winds never looked at. The string quartet had
 * always looked, which is why only these two were broken.
 */

/** A grand staff with no <part-name> at all — commoner than it sounds. */
const GRAND_STAFF_NO_NAME = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"/></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>4</divisions>
        <key><fifths>0</fifths></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <staves>2</staves>
        <clef number="1"><sign>G</sign><line>2</line></clef>
        <clef number="2"><sign>F</sign><line>4</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>C</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>16</duration><voice>1</voice><type>whole</type><staff>1</staff></note>
      <backup><duration>16</duration></backup>
      <note><pitch><step>G</step><octave>2</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type><staff>2</staff></note>
    </measure>
  </part>
</score-partwise>`;

test('the parser records how many staves a part is written on', () => {
  const score: any = parseMusicXMLToScoreModel(GRAND_STAFF_NO_NAME);
  assert.equal(score.parts.length, 1);
  assert.equal(Number(score.parts[0].staves), 2,
    'a grand staff says <staves>2</staves> and the field exists to hold it');
});

test('a single-staff part does not claim two', () => {
  const single = GRAND_STAFF_NO_NAME
    .replace('<staves>2</staves>', '')
    .replace(/<staff>2<\/staff>/g, '<staff>1</staff>');
  const score: any = parseMusicXMLToScoreModel(single);
  assert(!(Number(score.parts[0].staves) > 1), 'nothing invented where the score said nothing');
});

/**
 * A transcription copies; it does not compose. The fixture contains only C and
 * G, so any other pitch class in the output means the arranger never found the
 * piano and fell through to a path that harmonises — which is what the wind
 * quartet did, silently, inventing A, E and F. Names alone cannot catch that:
 * the fallback produces parts called Flute and Oboe either way.
 */
function assertTranscribed(out: any, label: string): void {
  const strayed: string[] = [];
  for (const p of out.parts ?? []) {
    for (const m of p.measures ?? []) {
      for (const e of m.events ?? []) {
        if (e?.type !== "note" || !e.pitch) continue;
        if (e.pitch.step !== "C" && e.pitch.step !== "G") {
          strayed.push(`${p.name}:${e.pitch.step}${e.pitch.octave}`);
        }
      }
    }
  }
  assert.deepEqual(strayed, [],
    `${label} invented pitches the source never had — it harmonised instead of transcribing`);
}

const arrangers = [
  { name: 'brass',    run: (s: any) => arrangeBrassQuintetFromPianoInstrumentation(s, { warnings: [] }),
    expect: /trumpet|horn|trombone|tuba/i },
  { name: 'woodwind', run: (s: any) => arrangeWoodwindQuartetFromPianoInstrumentation(s, { warnings: [] }),
    expect: /flute|oboe|clarinet|bassoon/i },
];

for (const { name, run, expect } of arrangers) {
  test(`${name}: an unnamed grand staff is still recognised as the piano`, () => {
    const score: any = parseMusicXMLToScoreModel(GRAND_STAFF_NO_NAME);
    const out: any = run(score);
    const names = out.parts.map((p: any) => p.name).join(", ");
    assert(out.parts.some((p: any) => expect.test(p.name)),
      `expected ${name} parts, got the score back as: ${names}`);
    assertTranscribed(out, name);
  });

  test(`${name}: an abbreviated name like "Pno. RH" is recognised`, () => {
    const score: any = parseMusicXMLToScoreModel(
      GRAND_STAFF_NO_NAME.replace('<score-part id="P1"/>',
        '<score-part id="P1"><part-name>Pno. RH</part-name></score-part>'));
    const out: any = run(score);
    assert(out.parts.some((p: any) => expect.test(p.name)),
      `"Pno. RH" was not recognised: got ${out.parts.map((p: any) => p.name).join(", ")}`);
    assertTranscribed(out, name);
  });

}

test('brass: a part that is genuinely not a piano is not treated as one', () => {
  // Only checked on brass. When no piano is found the brass arranger hands the
  // score back untouched, so "not found" is visible in the output; the wind
  // arranger falls through to its choral path and produces wind parts either
  // way, which makes the same assertion meaningless there.
  const score: any = parseMusicXMLToScoreModel(
    GRAND_STAFF_NO_NAME
      .replace('<staves>2</staves>', '')
      .replace(/<staff>2<\/staff>/g, '<staff>1</staff>')
      .replace('<score-part id="P1"/>',
        '<score-part id="P1"><part-name>Violin</part-name></score-part>'));
  const out: any = arrangeBrassQuintetFromPianoInstrumentation(score, { warnings: [] }) as any;
  assert(!out.parts.some((p: any) => /trumpet|horn|trombone|tuba/i.test(p.name)),
    `a single-staff Violin part was mistaken for a piano: ${out.parts.map((p: any) => p.name).join(", ")}`);
});
