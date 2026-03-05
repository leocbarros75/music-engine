// scripts/checkChordal7thResolution.ts
// Usage: npx tsx scripts/checkChordal7thResolution.ts ./tmp/satb_response.json

import fs from "fs";

type NoteEv = { type: "note"; t: number; midi: number };
type Measure = { number: number; events: any[] };
type Part = { name: string; measures: Measure[] };
type ScoreModel = { parts: Part[] };

function pc(m: number): number {
  const x = ((m % 12) + 12) % 12;
  return x;
}

function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Missing input json path.");
    process.exit(2);
  }

  const j = JSON.parse(fs.readFileSync(path, "utf8"));
  const sm: ScoreModel | undefined = j?.scoreModel;
  if (!sm?.parts?.length) {
    console.error("No scoreModel.parts found.");
    process.exit(2);
  }

  // Hard-coded for your current test cadence:
  // m3 is G7 in C -> chordal 7th is F, should resolve to E at m4:t0.
  const seventhPc = 5;     // F
  const resolutionPc = 4;  // E
  const fromMeasure = 3;
  const toMeasure = 4;
  const toT = 0;

  const findings: any[] = [];

  for (const p of sm.parts) {
    const m3 = p.measures.find((m) => m.number === fromMeasure);
    const m4 = p.measures.find((m) => m.number === toMeasure);

    const m3Notes = (m3?.events ?? []).filter((e: any) => e?.type === "note") as NoteEv[];
    const has7 = m3Notes.find((n) => pc(n.midi) === seventhPc);

    if (!has7) continue;

    const m4Notes = (m4?.events ?? []).filter((e: any) => e?.type === "note") as NoteEv[];
    const next = m4Notes.find((n) => Number(n.t) === toT);

    findings.push({
      voice: p.name,
      m3: { t: has7.t, midi: has7.midi, pc: pc(has7.midi) },
      m4_t0: next ? { t: next.t, midi: next.midi, pc: pc(next.midi) } : null
    });
  }

  console.log("Chordal 7th findings:", JSON.stringify(findings, null, 2));

  // Validate: any voice that has the 7th must resolve to E at m4:t0.
  const bad = findings.filter((f) => f.m4_t0?.pc !== resolutionPc);

  if (bad.length) {
    console.error("FAIL: 7th did not resolve to E at m4:t0 in:", bad.map((b) => b.voice).join(", "));
    process.exit(1);
  }

  console.log("PASS: all chordal 7ths resolved to E at m4:t0.");
}

main();