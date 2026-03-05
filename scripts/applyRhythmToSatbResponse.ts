// scripts/applyRhythmToSatbResponse.ts
import fs from "node:fs";
import { applyRhythmToBassFinalCadence } from "../src/rhythm/applyRhythmToBassFinalCadence";
import type { RhythmApplyOptions } from "../src/rhythm/rhythmTypes";

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(msg);
  process.exit(1);
}

const inPath = process.argv[2] ?? "./tmp/satb_response.json";
const outPath = process.argv[3] ?? "./tmp/satb_response_rhythm.json";
const styleRaw = process.argv[4] ?? "classical";
const levelRaw = process.argv[5] ?? undefined;

function resolveStyle(input: string): string {
  const normalized = String(input || "classical").toLowerCase();
  const supported = new Set(["classical", "pop", "rock", "funk", "samba"]);
  if (!supported.has(normalized)) {
    // eslint-disable-next-line no-console
    console.warn(`[warn] Style "${input}" not supported by rhythm stage. Defaulting to "classical".`);
    return "classical";
  }
  return normalized;
}

const style = resolveStyle(styleRaw) as any;

if (!fs.existsSync(inPath)) die(`Missing input: ${inPath}`);

const raw = fs.readFileSync(inPath, "utf8");
const j = JSON.parse(raw);

if (!j || typeof j !== "object" || !j.scoreModel) die("Input JSON must contain { scoreModel }.");

const options: RhythmApplyOptions = {
  style,
  role: "bass",
  applyOnlyFinalCadence: true,
  warnOnly: true,
  level: levelRaw as any
};

const scoreModel = j.scoreModel;
const result = applyRhythmToBassFinalCadence(scoreModel, options);

const out = {
  ...j,
  scoreModel: scoreModel,
  meta: {
    ...(j.meta ?? {}),
    rhythm: {
      ...(j.meta?.rhythm ?? {}),
      applied: result.applied,
      style: result.style,
      appliedCadencePair: result.appliedCadencePair,
      appliedMeasureNumbers: result.appliedMeasureNumbers,
      chosenPlans: result.chosenPlans
    }
  }
};

fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf8");

// eslint-disable-next-line no-console
console.log(`[rhythm] wrote: ${outPath}`);
// eslint-disable-next-line no-console
console.log(
  `[rhythm] applied=${result.applied} style=${result.style} measures=${result.appliedMeasureNumbers.join(",") || "(none)"}`
);
