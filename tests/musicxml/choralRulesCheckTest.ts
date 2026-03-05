import fs from "node:fs";
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
