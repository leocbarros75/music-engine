/**
 * _diag_string_quartet.ts
 * Local diagnostic: run the piano→string-quartet arranger on a source file
 * and print a per-measure note breakdown for each part.
 * Also writes an output MusicXML file you can open in notation software.
 *
 * Usage:
 *   npx tsx _diag_string_quartet.ts "/path/to/source.musicxml"
 *
 * Output file: same directory as source, named <original>_quartet.musicxml
 */
import * as fs from "fs";
import * as path from "path";
import { parseMusicXMLToScoreModel } from "./src/parsers/musicxmlParser";
import { arrangeStringQuartetFromPianoInstrumentation } from "./src/arrange/arrangeStringQuartetFromPianoInstrumentation";
import { exportScoreModelToMusicXML } from "./src/exporters/musicxmlExporter";
import type { Pitch } from "./src/instruments/instrumentCatalog";

function pitchStr(p: unknown): string {
  if (!p || typeof p !== "object") return String(p ?? "?");
  const pitch = p as Pitch;
  const alter = pitch.alter === 1 ? "#" : pitch.alter === -1 ? "b" : "";
  return `${pitch.step}${alter}${pitch.octave}`;
}

const srcFile = process.argv[2];
if (!srcFile) {
  console.error("Usage: npx tsx _diag_string_quartet.ts <source.musicxml>");
  process.exit(1);
}

const srcPath = path.resolve(srcFile);
const xml = fs.readFileSync(srcPath, "utf-8");
const score = parseMusicXMLToScoreModel(xml) as any;

// ── Source analysis ───────────────────────────────────────────────────────────
console.log("\n=== SOURCE SCORE ===");
console.log(`Parts: ${score.parts?.length ?? 0}`);
for (const p of score.parts ?? []) {
  let staff1Notes = 0, staff2Notes = 0;
  const onsetMap = new Map<string, number>();
  const rhVoices = new Set<number>();
  for (const m of p.measures ?? []) {
    for (const ev of m.events ?? []) {
      if (ev.type !== "note") continue;
      const staff = Number(ev.staff);
      if (staff === 2) staff2Notes++;
      else { staff1Notes++; rhVoices.add(Number(ev.voice ?? 1)); }
      const key = Number(ev.t).toFixed(3) + "_s" + (staff === 2 ? "2" : "1");
      onsetMap.set(key, (onsetMap.get(key) ?? 0) + 1);
    }
  }
  const chordOnsets = [...onsetMap.values()].filter(c => c >= 2).length;
  console.log(`  "${p.name}" (${p.instrument ?? p.part_id ?? "?"})`);
  console.log(`    Staff-1 notes: ${staff1Notes}, Staff-2 notes: ${staff2Notes}`);
  console.log(`    RH voices: [${[...rhVoices].sort().join(", ")}]  → isPolyphonic: ${rhVoices.size > 1}`);
  console.log(`    Onsets with 2+ simultaneous notes: ${chordOnsets}`);
}

// ── Per-measure RH/LH for first 5 measures ────────────────────────────────────
const piano = score.parts?.[0];
if (piano) {
  console.log("\n=== RH/LH per measure (first 5 measures) ===");
  for (const m of (piano.measures ?? []).slice(0, 5)) {
    const rh: string[] = [], lh: string[] = [];
    for (const ev of m.events ?? []) {
      if (ev.type !== "note") continue;
      const staff = Number(ev.staff) === 2 ? 2 : 1;
      const label = `t=${Number(ev.t).toFixed(2)} ${pitchStr(ev.pitch)} v${ev.voice ?? 1}`;
      if (staff === 1) rh.push(label); else lh.push(label);
    }
    console.log(`  M${m.number}:`);
    if (rh.length) console.log(`    RH: ${rh.join(" | ")}`);
    if (lh.length) console.log(`    LH: ${lh.join(" | ")}`);
  }
}

// ── Run the arranger ──────────────────────────────────────────────────────────
const warnings: string[] = [];
const result = arrangeStringQuartetFromPianoInstrumentation(score, { warnings }) as any;

console.log("\n=== ARRANGER OUTPUT ===");
if (warnings.length) console.log("Warnings:", warnings);

for (const p of result.parts ?? []) {
  let total = 0, measuresWithNotes = 0;
  const pitchSamples: string[] = [];
  for (const m of p.measures ?? []) {
    const notes = (m.events ?? []).filter((e: any) => e.type === "note");
    if (notes.length > 0) {
      measuresWithNotes++;
      total += notes.length;
      if (pitchSamples.length < 10) {
        for (const ev of notes) {
          if (pitchSamples.length < 10) pitchSamples.push(pitchStr(ev.pitch));
        }
      }
    }
  }
  const totalMeasures = p.measures?.length ?? 0;
  const icon = total > 0 ? "✓" : "✗ EMPTY";
  console.log(`  ${icon} ${p.name} (${p.instrument}): ${total} notes in ${measuresWithNotes}/${totalMeasures} measures`);
  if (pitchSamples.length) console.log(`    Pitches: ${pitchSamples.join(", ")}`);
}

// ── Per-measure note counts ───────────────────────────────────────────────────
console.log("\n=== Per-measure note counts (V1 / V2 / VA / VC) ===");
const [v1p, v2p, vap, vcp] = result.parts ?? [];
const maxM = Math.max(
  v1p?.measures?.length ?? 0, v2p?.measures?.length ?? 0,
  vap?.measures?.length ?? 0, vcp?.measures?.length ?? 0
);
for (let i = 0; i < maxM; i++) {
  const cnt = (part: any) => (part?.measures?.[i]?.events ?? []).filter((e: any) => e.type === "note").length;
  const v1n = cnt(v1p), v2n = cnt(v2p), van = cnt(vap), vcn = cnt(vcp);
  const flag = (v2n === 0 || van === 0) ? " ← V2/VA gap" : "";
  console.log(`  M${i + 1}: V1=${v1n}  V2=${v2n}  VA=${van}  VC=${vcn}${flag}`);
}

// ── Export MusicXML ───────────────────────────────────────────────────────────
try {
  const outputXml = exportScoreModelToMusicXML(result);
  const base = path.basename(srcPath, path.extname(srcPath));
  const outPath = path.join(path.dirname(srcPath), `${base}_quartet.musicxml`);
  fs.writeFileSync(outPath, outputXml, "utf-8");
  console.log(`\n✓ MusicXML written to: ${outPath}`);
} catch (e: any) {
  console.error("\n✗ MusicXML export failed:", e?.message ?? e);
}
