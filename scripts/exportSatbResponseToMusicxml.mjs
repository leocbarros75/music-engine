// scripts/exportSatbResponseToMusicxml.mjs
import fs from "node:fs";
import path from "node:path";

// Change these if you want different names
const INPUT_JSON = process.argv[2] ?? "./tmp/satb_response.json";
const OUTPUT_MUSICXML = process.argv[3] ?? "./tmp/satb_out.musicxml";

// IMPORTANT:
// Adjust this import + function name to match your exporter.
// I’m making a best guess here based on your project naming.
import { scoreModelToMusicXML } from "../dist/exporters/musicxmlExporter.js";

function isObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

const raw = fs.readFileSync(INPUT_JSON, "utf8");
const parsed = JSON.parse(raw);

if (!isObject(parsed) || parsed.ok !== true || !isObject(parsed.scoreModel)) {
  console.error("Input JSON does not look like { ok:true, scoreModel:{...} }");
  process.exit(1);
}

const scoreModel = parsed.scoreModel;

const musicxml = scoreModelToMusicXML(scoreModel);
fs.mkdirSync(path.dirname(OUTPUT_MUSICXML), { recursive: true });
fs.writeFileSync(OUTPUT_MUSICXML, musicxml, "utf8");

console.log(`Wrote MusicXML to: ${OUTPUT_MUSICXML}`);