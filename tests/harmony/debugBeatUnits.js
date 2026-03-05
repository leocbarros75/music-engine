import fs from "node:fs";
import { parseMusicXMLToScoreModel } from "../../src/parsers/musicxmlParser";
const filePath = process.argv[2];
if (!filePath) {
    console.error("Usage: npx tsx tests/harmony/debugBeatUnits.ts <path-to-xml>");
    process.exit(1);
}
if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
}
const xml = fs.readFileSync(filePath, "utf8");
const score = parseMusicXMLToScoreModel(xml);
const p0 = score?.parts?.[0];
const m0 = p0?.measures?.[0];
console.log("parts:", score?.parts?.length ?? 0);
console.log("measure[1] attributes:", JSON.stringify(m0?.attributes ?? {}, null, 2));
const evs = m0?.events ?? [];
const notes = evs.filter((e) => e?.type === "note");
console.log("measure[1] events:", evs.length);
console.log("measure[1] note events:", notes.length);
console.log("first 20 note events (t/dur/midi/pitch):");
for (const n of notes.slice(0, 20)) {
    console.log(JSON.stringify({
        t: n?.t,
        dur: n?.dur,
        midi: n?.midi,
        pitch: n?.pitch,
        tie: n?.tie,
        isRest: n?.isRest
    }, null, 0));
}
