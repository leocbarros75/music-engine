/**
 * Quick local test of piano_with_strings pipeline
 * Usage: npx tsx _test_pw_strings.ts "/path/to/piano.musicxml"
 */
import * as fs from "fs";
import * as path from "path";
import { pipelineMusicxmlToArrangedMusicxml } from "./src/pipeline/pipelineMusicxmlToArrangedMusicxml";

const srcFile = process.argv[2] ?? "/Users/leobarros/Downloads/shout (5).musicxml";
const musicxml = fs.readFileSync(srcFile, "utf-8");

try {
  const result = pipelineMusicxmlToArrangedMusicxml({
    musicxml,
    settings: {
      ensemble: "piano_with_strings",
      instrumentation: "piano_with_strings",
      textureMode: "homophony_melody_accompaniment",
      level: "intermediate",
    } as any,
  });

  if (!result.ok) {
    console.error("PIPELINE ERROR:", (result as any).error);
    console.error("Warnings:", result.warnings);
    process.exit(1);
  }

  console.log("✓ OK");
  console.log("Parts:", result.meta?.parts?.map((p) => p.name));
  console.log("Warnings:", result.warnings?.slice(0, 15));

  const outFile = path.join(path.dirname(srcFile), path.basename(srcFile, ".musicxml") + "_pw_strings.musicxml");
  fs.writeFileSync(outFile, result.musicxml);
  console.log("Written:", outFile);
} catch (err: any) {
  console.error("EXCEPTION:", err?.message ?? String(err));
  console.error(err?.stack);
  process.exit(1);
}
