// tests/harmony/runMusicXMLExportTest.ts
import process from "node:process";

import type { ScoreModel } from "../../src/score/types";
import { exportScoreModelToMusicXML } from "../../src/exporters/musicxmlExporter";

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) die(`ASSERTION FAILED: ${msg}`);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = 0;
  while (true) {
    const next = haystack.indexOf(needle, idx);
    if (next === -1) return count;
    count++;
    idx = next + needle.length;
  }
}

function buildTinyScoreModel(): ScoreModel {
  const score: ScoreModel = {
    score_id: "TEST_EXPORT_001",
    meta: {
      ensemble: "unit_test_ensemble",
      harmony: {
        cadences: [
          { atMeasure: 1, type: "authentic_perfect", evidence: { prevRoman: "V7", lastRoman: "I" } }
        ]
      }
    },
    global: { divisions: 480 },
    parts: [
      {
        part_id: "P1",
        name: "Piano",
        instrument: "piano",
        staves: 2,
        measures: [
          {
            number: 1,
            attributes: {
              divisions: 480,
              key_fifths: 0,
              time: { beats: 4, beat_type: 4 }
            },
            events: [
              {
                id: "N1",
                t: 0,
                dur: 480,
                type: "note",
                pitch: { step: "C", octave: 4 },
                voice: 1,
                staff: 1
              },
              {
                id: "R1",
                t: 480,
                dur: 480,
                type: "rest",
                voice: 1,
                staff: 1
              }
            ]
          }
        ]
      }
    ]
  } as any;

  return score;
}

const scoreModel = buildTinyScoreModel();
const xml = exportScoreModelToMusicXML(scoreModel);

assert(typeof xml === "string" && xml.length > 0, "Exporter must return a non-empty string.");

assert(xml.includes("<score-partwise"), "XML must contain <score-partwise.");
assert(xml.includes("<part-list>"), "XML must contain <part-list>.");
assert(xml.includes('<score-part id="P1">'), "XML must contain score-part for P1.");
assert(xml.includes('<part id="P1">'), "XML must contain <part id=\"P1\"> section.");
assert(xml.includes('<measure number="1">'), "XML must contain measure 1.");

assert(xml.includes("<note>"), "XML must contain at least one <note> element.");
assert(xml.includes("<rest/>"), "XML must contain at least one <rest/> element.");
assert(xml.includes("<pitch>"), "XML must contain <pitch> for pitched notes.");

const noteCount = countOccurrences(xml, "<note>");
assert(noteCount >= 2, "Expected at least 2 <note> elements (one pitched note, one rest).");

// Quick staff sanity (grand staff)
assert(xml.includes("<staves>2</staves>"), "Piano should export as grand staff with <staves>2</staves>.");
assert(xml.includes('<clef number="1"><sign>G</sign><line>2</line></clef>'), "Piano staff 1 clef should be G.");
assert(xml.includes('<clef number="2"><sign>F</sign><line>4</line></clef>'), "Piano staff 2 clef should be F.");

// Cadence text direction
assert(xml.includes("<direction"), "XML must include <direction> when cadence annotations exist.");
assert(xml.includes("PAC"), "Cadence label should include PAC for authentic_perfect.");
assert(xml.includes("V7→I"), "Cadence evidence should be present when provided.");

// Final barline
assert(
  xml.includes('<barline location="right"><bar-style>light-heavy</bar-style></barline>'),
  "Final barline should be light-heavy on the last measure."
);

// eslint-disable-next-line no-console
console.log("OK: MusicXML exporter sanity test passed.");