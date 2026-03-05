// scripts/checkSatbParallels.ts
import fs from "node:fs";

type NoteEv = { type: string; t: number; midi?: number; pitch?: any };
type Measure = { number: number; events?: NoteEv[] };
type Part = { name: string; measures?: Measure[] };
type ScoreModel = { parts?: Part[] };

function pc(m: number): number {
  return ((m % 12) + 12) % 12;
}

function dir(a: number, b: number): -1 | 0 | 1 {
  if (b > a) return 1;
  if (b < a) return -1;
  return 0;
}

function isPerfect(intervalPc: number): boolean {
  return intervalPc === 0 || intervalPc === 7; // P8 or P5
}

function noteAt(measure: Measure | undefined, t: number): number | null {
  if (!measure?.events) return null;
  const e = measure.events.find((x) => x.type === "note" && Number(x.t) === t);
  return typeof e?.midi === "number" ? e.midi : null;
}

function getPart(sm: ScoreModel, name: string): Part | undefined {
  return (sm.parts ?? []).find((p) => String(p.name).toLowerCase() === name.toLowerCase());
}

function getMeasure(part: Part | undefined, num: number): Measure | undefined {
  return (part?.measures ?? []).find((m) => Number(m.number) === num);
}

function checkPair(params: {
  upperName: string;
  lowerName: string;
  upperPrev: number;
  upperNext: number;
  lowerPrev: number;
  lowerNext: number;
  label: string;
}): string[] {
  const { upperName, lowerName, upperPrev, upperNext, lowerPrev, lowerNext, label } = params;

  const prevInt = pc(upperPrev - lowerPrev);
  const nextInt = pc(upperNext - lowerNext);

  const du = dir(upperPrev, upperNext);
  const dl = dir(lowerPrev, lowerNext);

  const out: string[] = [];

  // Parallel perfect 5ths/8ves (both perfect, similar motion)
  if (isPerfect(prevInt) && isPerfect(nextInt) && du !== 0 && dl !== 0 && du === dl) {
    out.push(
      `PARALLEL ${label}: ${upperName}/${lowerName} prevInt=${prevInt} nextInt=${nextInt} ` +
        `(${upperPrev}->${upperNext}, ${lowerPrev}->${lowerNext})`
    );
  }

  // Direct (hidden) perfect 5ths/8ves: not perfect -> perfect in similar motion
  if (!isPerfect(prevInt) && isPerfect(nextInt) && du !== 0 && dl !== 0 && du === dl) {
    out.push(
      `DIRECT ${label}: ${upperName}/${lowerName} prevInt=${prevInt} nextInt=${nextInt} ` +
        `(${upperPrev}->${upperNext}, ${lowerPrev}->${lowerNext})`
    );
  }

  return out;
}

function main() {
  const inPath = process.argv[2] ?? "./tmp/satb_response.json";
  const raw = fs.readFileSync(inPath, "utf8");
  const j = JSON.parse(raw);
  const sm: ScoreModel = j.scoreModel;

  const voices = ["Soprano", "Alto", "Tenor", "Bass"] as const;
  const parts = Object.fromEntries(voices.map((v) => [v, getPart(sm, v)])) as Record<
    (typeof voices)[number],
    Part | undefined
  >;

  // Print m3 and m4 at each beat
  const targetMeasures = [3, 4];
  for (const v of voices) {
    console.log(`\n== ${v} ==`);
    for (const mn of targetMeasures) {
      const m = getMeasure(parts[v], mn);
      const notes = [0, 1, 2, 3]
        .map((t) => {
          const midi = noteAt(m, t);
          return midi === null ? null : { t, midi };
        })
        .filter(Boolean);
      console.log(`m ${mn}`, notes);
    }
  }

  // Compare m3:t=3 -> m4:t=0 (barline)
  const upperLowerPairs: Array<[string, string]> = [
    ["Soprano", "Alto"],
    ["Soprano", "Tenor"],
    ["Soprano", "Bass"],
    ["Alto", "Tenor"],
    ["Alto", "Bass"],
    ["Tenor", "Bass"]
  ];

  const m3S = getMeasure(parts.Soprano, 3);
  const m3A = getMeasure(parts.Alto, 3);
  const m3T = getMeasure(parts.Tenor, 3);
  const m3B = getMeasure(parts.Bass, 3);

  const m4S = getMeasure(parts.Soprano, 4);
  const m4A = getMeasure(parts.Alto, 4);
  const m4T = getMeasure(parts.Tenor, 4);
  const m4B = getMeasure(parts.Bass, 4);

  const m3 = { Soprano: m3S, Alto: m3A, Tenor: m3T, Bass: m3B };
  const m4 = { Soprano: m4S, Alto: m4A, Tenor: m4T, Bass: m4B };

  const prevT = 3; // last beat of m3
  const nextT = 0; // first beat of m4

  const issues: string[] = [];

  for (const [upperName, lowerName] of upperLowerPairs) {
    const upPrev = noteAt((m3 as any)[upperName], prevT);
    const loPrev = noteAt((m3 as any)[lowerName], prevT);
    const upNext = noteAt((m4 as any)[upperName], nextT);
    const loNext = noteAt((m4 as any)[lowerName], nextT);

    if (upPrev === null || loPrev === null || upNext === null || loNext === null) continue;

    issues.push(
      ...checkPair({
        upperName,
        lowerName,
        upperPrev: upPrev,
        upperNext: upNext,
        lowerPrev: loPrev,
        lowerNext: loNext,
        label: "m3:t3 -> m4:t0"
      })
    );
  }

  console.log("\n== Voice-leading checks ==");
  if (issues.length === 0) console.log("No parallel/direct perfect 5ths/8ves detected at barline m3->m4.");
  else for (const s of issues) console.log(s);
}

main();