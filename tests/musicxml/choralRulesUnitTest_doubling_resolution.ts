import { midiToPitch } from "../../src/instruments/instrumentCatalog";
import { checkChoralRules } from "../../src/rules/choral/checkChoralRules";

type NoteEvent = { type: "note"; t: number; dur: number; midi: number; pitch: any };

function note(t: number, midi: number, dur = 1): NoteEvent {
  return { type: "note", t, dur, midi, pitch: midiToPitch(midi) };
}

function makePart(part_id: string, name: string, events: NoteEvent[]) {
  return {
    part_id,
    name,
    measures: [
      {
        number: 1,
        attributes: { key_fifths: 0, key_mode: "major" },
        events
      }
    ]
  };
}

function makeScore(parts: any[]) {
  return {
    score_id: "unit-test",
    meta: { ensemble: "satb" },
    global: { divisions: 4 },
    parts
  };
}

const scoreDoubling = makeScore([
  makePart("P_S", "Soprano", [note(0, 72)]),
  makePart("P_A", "Alto", [note(0, 64)]),
  makePart("P_T", "Tenor", [note(0, 52)]),
  makePart("P_B", "Bass", [note(0, 48)])
]);

const doublingResult = checkChoralRules(
  scoreDoubling,
  [{ measure: 1, t: 0, symbol: "C" }],
  { strictness: "standard" }
);

if (!doublingResult.violations.some((v) => v.ruleId === "doubling.third.root_position")) {
  throw new Error("Expected doubling.third.root_position violation, but none was found.");
}

const strictDoubling = checkChoralRules(
  scoreDoubling,
  [{ measure: 1, t: 0, symbol: "C" }],
  { strictness: "strict" }
);

const strictViolation = strictDoubling.violations.find((v) => v.ruleId === "doubling.third.root_position");
if (!strictViolation || strictViolation.severity !== "error") {
  throw new Error("Expected doubling.third.root_position to be severity=error under strict mode.");
}

const scoreResolution = makeScore([
  makePart("P_S", "Soprano", [note(0, 71), note(1, 71)]),
  makePart("P_A", "Alto", [note(0, 65), note(1, 67)]),
  makePart("P_T", "Tenor", [note(0, 62), note(1, 62)]),
  makePart("P_B", "Bass", [note(0, 55), note(1, 55)])
]);

const resolutionResult = checkChoralRules(
  scoreResolution,
  [{ measure: 1, t: 0, symbol: "G7" }],
  { strictness: "standard" }
);

if (!resolutionResult.violations.some((v) => v.ruleId === "resolution.seventh")) {
  throw new Error("Expected resolution.seventh violation, but none was found.");
}

const scoreLeadingTone = makeScore([
  makePart("P_S", "Soprano", [note(0, 71), note(1, 69)]),
  makePart("P_A", "Alto", [note(0, 64, 2)]),
  makePart("P_T", "Tenor", [note(0, 55, 2)]),
  makePart("P_B", "Bass", [note(0, 48, 2)])
]);

const leadingToneResult = checkChoralRules(scoreLeadingTone, [], { strictness: "standard" });
if (!leadingToneResult.violations.some((v) => v.ruleId === "resolution.leading_tone")) {
  throw new Error("Expected resolution.leading_tone violation, but none was found.");
}

const scoreParallel = makeScore([
  makePart("P_S", "Soprano", [note(0, 60), note(1, 62)]),
  makePart("P_A", "Alto", [note(0, 53), note(1, 55)]),
  makePart("P_T", "Tenor", [note(0, 48, 2)]),
  makePart("P_B", "Bass", [note(0, 36, 2)])
]);

const parallelResult = checkChoralRules(scoreParallel, [], { strictness: "standard" });
if (!parallelResult.violations.some((v) => v.ruleId === "parallel.perfect")) {
  throw new Error("Expected parallel.perfect violation, but none was found.");
}

console.log("Choral rules unit tests passed (doubling + resolution).");
