import fs from "node:fs";
import assert from "node:assert/strict";
import { buildNoteTimeline } from "../../src/score/standard";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseMusicXMLToScoreModel } from "../../src/parsers/musicxmlParser";
import { harmonizeSatbFromChords } from "../../src/harmonize/satb/harmonizeSatbFromChords";
import { checkChoralRules } from "../../src/rules/choral/checkChoralRules";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturePath = path.join(__dirname, "test_4bar_melody_c_major.xml");

if (!fs.existsSync(fixturePath)) {
  throw new Error(`Fixture not found: ${fixturePath}`);
}

const xml = fs.readFileSync(fixturePath, "utf8");
const score: any = parseMusicXMLToScoreModel(xml);

const outScore: any = harmonizeSatbFromChords(score, [], { keepMelodyInSoprano: true });
const result = checkChoralRules(outScore, []);

if (result.rulesVersion !== "choral-v1") {
  throw new Error(`Unexpected rules version: ${result.rulesVersion}`);
}

console.log(
  `Choral rules check completed. violations=${result.violations.length} warnings=${result.warnings.length}`
);

assert.equal(outScore.parts.length, 4, "SATB must contain four voices");
const soprano = outScore.parts.find((p: any) => p.part_id === "P_S");
assert(soprano, "SATB must contain the soprano melody");
const notes = (s: any) => buildNoteTimeline(s).map(n => [n.midi, n.startBeat, n.durationBeats]);
assert.deepEqual(notes({ ...outScore, parts: [soprano] }), notes(score), "Soprano must retain source melody and timing");
assert(Array.isArray(result.violations) && Array.isArray(result.warnings));
for (const violation of result.violations) {
  assert(violation.ruleId && violation.message, "Violations must identify and explain the rule");
  assert(["warn", "error"].includes(violation.severity));
}
