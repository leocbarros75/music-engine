import * as fs from "fs";
import { pipelineMusicxmlToArrangedMusicxml } from "./src/pipeline/pipelineMusicxmlToArrangedMusicxml";

const musicxml = fs.readFileSync("/Users/leobarros/Downloads/shout (5).musicxml", "utf-8");

const result = pipelineMusicxmlToArrangedMusicxml({
  musicxml,
  settings: {
    ensemble: "piano_with_strings",
    instrumentation: "piano_with_strings",
    textureMode: "homophony_melody_accompaniment",
    level: "intermediate",
  } as any,
}) as any;

if (!result.ok) {
  console.error("PIPELINE ERROR:", result.error);
  console.error("Warnings:", result.warnings);
} else {
  console.log("OK");
  console.log("Parts:", result.meta?.parts?.map((p: any) => p.name));
  console.log("Warnings:", result.warnings?.slice(0, 10));
  fs.writeFileSync("/tmp/test_output.musicxml", result.musicxml);
  console.log("Output written to /tmp/test_output.musicxml");
}
