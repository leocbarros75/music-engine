import type { ScoreModel } from "../score/types";

export type DensityReport = {
  measures: number;
  parts: number;
  totalNotes: number;
  avgNotesPerMeasure: number;
  densityScore: number;
  densityLevel: "sparse" | "medium" | "dense";
  perMeasure: number[];
};

export function computeDensity(score: ScoreModel): DensityReport {
  const parts = score.parts ?? [];
  const measures = parts[0]?.measures?.length ?? 0;
  const perMeasure = new Array(Math.max(0, measures)).fill(0);

  let totalNotes = 0;
  let shortNotes = 0;

  for (const part of parts) {
    const ms = part.measures ?? [];
    for (let mi = 0; mi < ms.length; mi++) {
      const m = ms[mi];
      const events = Array.isArray(m?.events) ? m.events : [];
      for (const ev of events) {
        if (ev?.type !== "note") continue;
        totalNotes += 1;
        perMeasure[mi] = (perMeasure[mi] ?? 0) + 1;
        const dur = Number((ev as any)?.dur);
        if (Number.isFinite(dur) && dur > 0 && dur < 1) shortNotes += 1;
      }
    }
  }

  const avgNotesPerMeasure = measures > 0 ? totalNotes / measures : totalNotes;
  const rhythmicComplexity = totalNotes > 0 ? shortNotes / totalNotes : 0;
  const densityScore = avgNotesPerMeasure + rhythmicComplexity * 2 + Math.max(0, parts.length - 1) * 0.5;

  let densityLevel: DensityReport["densityLevel"] = "medium";
  if (densityScore < 4) densityLevel = "sparse";
  else if (densityScore >= 8) densityLevel = "dense";

  return {
    measures,
    parts: parts.length,
    totalNotes,
    avgNotesPerMeasure,
    densityScore: Number(densityScore.toFixed(2)),
    densityLevel,
    perMeasure
  };
}

