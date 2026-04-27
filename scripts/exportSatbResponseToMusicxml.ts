// scripts/exportSatbResponseToMusicxml.ts
import fs from "node:fs";
import path from "node:path";
import { exportSatbScoreModelToMusicXML } from "../src/exporters/satbMusicxmlExporter";
import { exportScoreModelToMusicXML } from "../src/exporters/musicxmlExporter";

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

function main(): void {
  const inPath = process.argv[2];
  const outPath = process.argv[3];

  if (!inPath || !outPath) {
    die("Usage: npx tsx scripts/exportSatbResponseToMusicxml.ts <satb_response.json> <out.musicxml>");
  }

  const raw = fs.readFileSync(inPath, "utf8");
  const json = JSON.parse(raw);

  const scoreModel = json?.scoreModel;
  if (!scoreModel) die("Input JSON missing scoreModel.");

  const ensemble = String(scoreModel?.meta?.ensemble ?? "").toLowerCase();
  const hasPianoPart = Array.isArray(scoreModel?.parts)
    ? scoreModel.parts.some((p: any) => String(p?.instrument ?? "").toLowerCase().includes("piano"))
    : false;
  const hasGrandStaff = Array.isArray(scoreModel?.parts)
    ? scoreModel.parts.some((p: any) => Number(p?.staves ?? 1) === 2)
    : false;
  const hasWoodwindPart = Array.isArray(scoreModel?.parts)
    ? scoreModel.parts.some((p: any) => {
        const s = `${String(p?.instrument ?? "")} ${String(p?.name ?? "")}`.toLowerCase();
        return (
          s.includes("flute") ||
          s.includes("oboe") ||
          s.includes("clarinet") ||
          s.includes("bassoon") ||
          s.includes("woodwind")
        );
      })
    : false;
  const hasBrassPart = Array.isArray(scoreModel?.parts)
    ? scoreModel.parts.some((p: any) => {
        const s = `${String(p?.instrument ?? "")} ${String(p?.name ?? "")}`.toLowerCase();
        return (
          s.includes("trumpet") ||
          s.includes("horn") ||
          s.includes("trombone") ||
          s.includes("tuba") ||
          s.includes("brass")
        );
      })
    : false;
  const useGeneralExporter =
    ensemble === "piano" ||
    ensemble === "piano_with_melody" ||
    ensemble === "woodwind_ensemble" ||
    ensemble === "woodwinds" ||
    ensemble === "brass_ensemble" ||
    ensemble === "brass" ||
    hasPianoPart ||
    hasGrandStaff ||
    hasWoodwindPart ||
    hasBrassPart;

  const xml = useGeneralExporter
    ? exportScoreModelToMusicXML(scoreModel)
    : exportSatbScoreModelToMusicXML(scoreModel);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, xml, "utf8");

  // eslint-disable-next-line no-console
  console.log(`Wrote MusicXML: ${path.resolve(outPath)}`);
}

main();
