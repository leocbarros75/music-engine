// tests/harmony/runMusicXMLExportTest.ts
import process from "node:process";
import { parseMusicXMLToScoreModel } from "../../src/parsers/musicxmlParser";
import { buildNoteTimeline } from "../../src/score/standard";

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
                dur: 1,
                type: "note",
                pitch: { step: "C", octave: 4 },
                voice: 1,
                staff: 1
              },
              {
                id: "R1",
                t: 1,
                dur: 1,
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
// A <backup> must rewind by exactly what the previous voice wrote, or the next
// voice starts before the bar line. A chord whose duration is not a standard note
// value is printed snapped DOWN — 3.75 beats prints as a dotted half — so a voice
// containing one does not fill the bar, and rewinding by the bar's nominal length
// overshoots. This was 36 bars of a real transcription.
{
  const score: any = {
    meta: { ensemble: "piano" },
    parts: [{
      part_id: "P_PNO", name: "Piano", instrument: "piano", staves: 2, pitchSpace: "sounding",
      measures: [{
        number: 1,
        attributes: { divisions: 4, key_fifths: 0, key_mode: "major", time: { beats: 4, beat_type: 4 } },
        events: [
          // a three-note chord lasting 3.75 beats — not a standard note value
          { id: "a", type: "note", t: 0, dur: 3.75, midi: 62, pitch: { step: "D", octave: 4 }, voice: 1, staff: 1 },
          { id: "b", type: "note", t: 0, dur: 3.75, midi: 66, pitch: { step: "F", alter: 1, octave: 4 }, voice: 1, staff: 1 },
          { id: "c", type: "note", t: 0, dur: 3.75, midi: 69, pitch: { step: "A", octave: 4 }, voice: 1, staff: 1 },
          { id: "d", type: "note", t: 0, dur: 4, midi: 50, pitch: { step: "D", octave: 3 }, voice: 5, staff: 2 }
        ]
      }]
    }]
  };
  const xml = exportScoreModelToMusicXML(score);
  const body = /<measure number="1">([\s\S]*?)<\/measure>/.exec(xml)?.[1] ?? "";
  const segments = body.split(/<backup>\s*<duration>(\d+)<\/duration>\s*<\/backup>/);
  let checked = 0;
  for (let i = 0; i + 1 < segments.length; i += 2) {
    let written = 0;
    for (const n of segments[i]!.matchAll(/<note>([\s\S]*?)<\/note>/g)) {
      if (/<chord\s*\/?>/.test(n[1]!)) continue;
      written += Number(/<duration>(\d+)<\/duration>/.exec(n[1]!)?.[1] ?? 0);
    }
    const backup = Number(segments[i + 1]);
    if (written !== backup)
      throw new Error(`backup rewinds ${backup} but the voice wrote ${written}: the next voice would start ${backup - written} divisions early`);
    checked++;
  }
  if (!checked) throw new Error("expected at least one backup to check");
  // And a left-hand voice's rest belongs on its own staff, not hardcoded to staff 1.
  const lh = /<backup>[\s\S]*$/.exec(body)?.[0] ?? "";
  if (/<rest\s*\/?>[\s\S]*?<staff>1<\/staff>/.test(lh))
    throw new Error("a left-hand rest was written on staff 1");
  console.log("OK: backups rewind by what each voice actually wrote.");
}

console.log("OK: MusicXML exporter sanity test passed.");
const timeline = buildNoteTimeline(parseMusicXMLToScoreModel(xml));
assert(timeline.length === 1, "Exactly one sounding note should survive export.");
assert(timeline[0].midi === 60 && timeline[0].startBeat === 0 && timeline[0].durationBeats === 1,
  "Exported C4 must start at beat zero and last one quarter beat regardless of divisions.");
