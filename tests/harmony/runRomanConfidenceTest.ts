// tests/harmony/runRomanConfidenceTest.ts
import process from "node:process";

import type { ScoreModel } from "../../src/score/types";
import { analyzeHarmony } from "../../src/harmony/analyzeHarmony";

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function assert(cond: unknown, msg: string): void {
  if (!cond) die(`ASSERTION FAILED: ${msg}`);
}

function buildAmbiguousScore(): ScoreModel {
  const score: ScoreModel = {
    score_id: "TEST_ROMAN_CONF_001",
    meta: { ensemble: "unit_test_ensemble" },
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
              // Ambiguous cluster: C4 + C#4 on beat 1
              { id: "N1", t: 0, dur: 480, type: "note", pitch: { step: "C", octave: 4 }, voice: 1, staff: 1 },
              { id: "N2", t: 0, dur: 480, type: "note", pitch: { step: "C", alter: 1, octave: 4 }, voice: 1, staff: 1 }
            ]
          }
        ]
      }
    ]
  } as any;

  return score;
}

const scoreModel = buildAmbiguousScore();

const out = analyzeHarmony({
  scoreModel,
  options: {
    granularity: "beat",
    ignorePercussion: true,
    romanMinConfidence: 0.95,
    suppressLowConfidenceRoman: true
  }
} as any) as any;

assert(out && typeof out === "object", "Output must be an object.");
assert(out.ok === true, "Output ok must be true.");

const beats = out.beats ?? [];
assert(Array.isArray(beats) && beats.length > 0, "Expected beats array.");
const b1 = beats.find((b: any) => b.measureNumber === 1 && b.beatNumber === 1);
assert(!!b1, "Expected beat 1 record for measure 1.");
assert(String(b1?.roman?.roman ?? "") === "N.C.", "Expected roman to be suppressed to N.C. at m1 b1.");

const warnings = out.warnings ?? [];
assert(Array.isArray(warnings), "Expected warnings array.");
assert(
  warnings.some((w: any) => w.type === "low_confidence_roman_suppressed" && w.atMeasure === 1 && w.atBeat === 1),
  "Expected low_confidence_roman_suppressed warning at m1 b1."
);

// eslint-disable-next-line no-console
console.log("OK: Roman confidence suppression test passed.");
