// src/rhythm/applySimpleMeterRhythmToAtb.ts
import type { ScoreModel } from "../score/types";

type RhythmSlot = { t: number; dur: number };

type RhythmPlan = {
  beatsPerMeasure: number;
  slots: RhythmSlot[];
  label: string;
};

export type RhythmApplyResult = {
  applied: boolean;
  reason: string;
  plansUsed: Record<string, RhythmPlan>; // by measure number
  warnings: string[];
};

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function getBeatsPerMeasure(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const beats = m0?.attributes?.time?.beats;
  if (typeof beats === "number" && beats > 0) return beats;
  return 4;
}

function getPartByName(score: ScoreModel, needle: string): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes(needle)) return p;
  }
  return null;
}

function getAtbParts(score: ScoreModel): any[] {
  const a = getPartByName(score, "alto");
  const t = getPartByName(score, "tenor");
  const b = getPartByName(score, "bass");
  return [a, t, b].filter(Boolean);
}

function getMeasureNumber(m: any, fallback: number): number {
  const n = Number(m?.number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // warnings only
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function sopranoDurAt(measureS: any, t: number): number | null {
  const events = Array.isArray(measureS?.events) ? measureS.events : [];
  const nr = events.filter((e: any) => isNoteOrRest(e)).sort((a: any, b: any) => Number(a.t) - Number(b.t));
  const hit = nr.find((e: any) => Number(e.t) === t);
  if (!hit) return null;
  const d = Number(hit.dur);
  return Number.isFinite(d) && d > 0 ? d : null;
}

function choosePlan3of4(params: { measureS: any | null; measureNumber: number; warnings: string[] }): RhythmPlan {
  const { measureS, measureNumber, warnings } = params;

  const p3: RhythmPlan = { beatsPerMeasure: 3, slots: [{ t: 0, dur: 3 }], label: "3/4:3" };
  const p21: RhythmPlan = {
    beatsPerMeasure: 3,
    slots: [
      { t: 0, dur: 2 },
      { t: 2, dur: 1 }
    ],
    label: "3/4:2+1"
  };
  const p12: RhythmPlan = {
    beatsPerMeasure: 3,
    slots: [
      { t: 0, dur: 1 },
      { t: 1, dur: 2 }
    ],
    label: "3/4:1+2"
  };

  if (!measureS) {
    warn(warnings, `[rhythm] m${measureNumber}: no soprano measure found for 3/4 selection, defaulting to 2+1`);
    return p21;
  }

  const d0 = sopranoDurAt(measureS, 0);
  const d1 = sopranoDurAt(measureS, 1);
  const d2 = sopranoDurAt(measureS, 2);

  // Strong match: pick the closest plan to soprano anchors
  if (d0 !== null && d0 >= 3) return p3;
  if (d0 !== null && d2 !== null && d0 >= 2 && d2 >= 1) return p21;
  if (d0 !== null && d1 !== null && d0 >= 1 && d1 >= 2) return p12;

  // Soft heuristic: look for presence of events at t=1 or t=2
  const events = Array.isArray(measureS?.events) ? measureS.events : [];
  const nr = events.filter((e: any) => isNoteOrRest(e));
  const hasT1 = nr.some((e: any) => Number(e.t) === 1);
  const hasT2 = nr.some((e: any) => Number(e.t) === 2);

  if (hasT2 && !hasT1) {
    warn(warnings, `[rhythm] m${measureNumber}: 3/4 unclear; choosing 2+1 (soprano activity at t=2)`);
    return p21;
  }
  if (hasT1 && !hasT2) {
    warn(warnings, `[rhythm] m${measureNumber}: 3/4 unclear; choosing 1+2 (soprano activity at t=1)`);
    return p12;
  }

  warn(warnings, `[rhythm] m${measureNumber}: 3/4 unclear; choosing 3 (dotted-half) as default`);
  return p3;
}

function choosePlanForMeter(params: {
  beatsPerMeasure: number;
  measureS: any | null;
  measureNumber: number;
  warnings: string[];
}): RhythmPlan {
  const { beatsPerMeasure, measureS, measureNumber, warnings } = params;

  if (beatsPerMeasure === 4) {
    return {
      beatsPerMeasure,
      slots: [
        { t: 0, dur: 2 },
        { t: 2, dur: 2 }
      ],
      label: "4/4:2+2"
    };
  }

  if (beatsPerMeasure === 2) {
    return { beatsPerMeasure, slots: [{ t: 0, dur: 2 }], label: "2/4:2" };
  }

  if (beatsPerMeasure === 3) {
    return choosePlan3of4({ measureS, measureNumber, warnings });
  }

  warn(warnings, `[rhythm] Unsupported meter: beatsPerMeasure=${beatsPerMeasure}. No rhythm changes applied.`);
  return { beatsPerMeasure, slots: [], label: "unsupported" };
}

function compressMeasureToPlan(measure: any, plan: RhythmPlan, warnings: string[], measureNumber: number): void {
  if (!plan.slots.length) return;

  const events = Array.isArray(measure?.events) ? measure.events : [];
  if (!events.length) return;

  const other = events.filter((e: any) => !isNoteOrRest(e));
  const nr = events.filter((e: any) => isNoteOrRest(e));

  const byT = new Map<number, any>();
  for (const e of nr) {
    const t = Number(e.t);
    if (!Number.isFinite(t)) continue;
    // keep first event per t
    if (!byT.has(t)) byT.set(t, { ...e });
  }

  const outNR: any[] = [];
  for (const slot of plan.slots) {
    const src = byT.get(slot.t);
    if (!src) {
      warn(warnings, `[rhythm] m${measureNumber}: missing ATB anchor at t=${slot.t}; leaving empty`);
      continue;
    }
    outNR.push({ ...src, t: slot.t, dur: slot.dur });
  }

  measure.events = [...other, ...outNR].sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
}

export function applySimpleMeterRhythmToAtb(score: ScoreModel): RhythmApplyResult {
  const warnings: string[] = [];
  const beatsPerMeasure = getBeatsPerMeasure(score);

  const sopr = getPartByName(score, "soprano") ?? score.parts?.[0] ?? null;
  const atb = getAtbParts(score);

  if (!sopr) {
    warn(warnings, "[rhythm] No soprano part found. No rhythm changes applied.");
    return { applied: false, reason: "no soprano", plansUsed: {}, warnings };
  }

  if (atb.length !== 3) {
    warn(warnings, "[rhythm] Expected Alto/Tenor/Bass parts. No rhythm changes applied.");
    return { applied: false, reason: "missing ATB parts", plansUsed: {}, warnings };
  }

  const soprMeasures = sopr.measures ?? [];
  const measureCount = atb[0]?.measures?.length ?? 0;

  if (!measureCount) {
    warn(warnings, "[rhythm] ATB has no measures. No rhythm changes applied.");
    return { applied: false, reason: "no measures", plansUsed: {}, warnings };
  }

  const plansUsed: Record<string, RhythmPlan> = {};

  for (let i = 0; i < measureCount; i++) {
    const mAny = atb[0]?.measures?.[i];
    const mNum = getMeasureNumber(mAny, i + 1);
    const measureS = soprMeasures[i] ?? null;

    const plan = choosePlanForMeter({ beatsPerMeasure, measureS, measureNumber: mNum, warnings });
    plansUsed[String(mNum)] = plan;

    for (const p of atb) {
      const m = p?.measures?.[i];
      if (!m) continue;
      compressMeasureToPlan(m, plan, warnings, mNum);
    }
  }

  warn(warnings, `[rhythm] Applied ATB rhythm. meter beatsPerMeasure=${beatsPerMeasure}.`);

  return { applied: true, reason: "applied meter rhythm to ATB", plansUsed, warnings };
}