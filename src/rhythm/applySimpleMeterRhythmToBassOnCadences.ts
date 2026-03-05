// src/rhythm/applySimpleMeterRhythmToBassOnCadences.ts
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
  cadenceMeasureNumbers: number[];
  cadencePairs: Array<{ fromMeasure: number; toMeasure: number }>;
  plansUsed: Record<string, RhythmPlan>;
  warnings: string[];
};

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
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

function getBassPart(score: ScoreModel): any | null {
  return getPartByName(score, "bass");
}

function getMeasureNumber(m: any, fallback: number): number {
  const n = Number(m?.number);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function pc(x: number): number {
  return ((x % 12) + 12) % 12;
}

const STEP_TO_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

function parseRootToken(tok: string): number | null {
  const m = tok.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return null;
  if (acc === "#") return (base + 1) % 12;
  if (acc === "b") return (base + 11) % 12;
  return base;
}

function tonicPcFromFifthsMajor(fifths: number): number {
  const map: Record<number, number> = {
    "-7": 11,
    "-6": 6,
    "-5": 1,
    "-4": 8,
    "-3": 3,
    "-2": 10,
    "-1": 5,
    "0": 0,
    "1": 7,
    "2": 2,
    "3": 9,
    "4": 4,
    "5": 11,
    "6": 6,
    "7": 1
  };
  const k = String(fifths);
  return map[k] ?? 0;
}

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = m0?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

type ChordEvent = { measure: number; t: number; symbol: string };

function getChordEventsFromMeta(score: ScoreModel): ChordEvent[] {
  const meta: any = (score as any)?.meta;
  const sample = meta?.harmonize?.debug?.chordEventSample;
  if (Array.isArray(sample) && sample.length) {
    return sample
      .map((c: any) => ({
        measure: Number(c?.measure),
        t: Number(c?.t ?? 0),
        symbol: String(c?.symbol ?? "")
      }))
      .filter((c: any) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol);
  }

  const full = meta?.harmonize?.chords;
  if (Array.isArray(full) && full.length) {
    return full
      .map((c: any) => ({
        measure: Number(c?.measure),
        t: Number(c?.t ?? 0),
        symbol: String(c?.symbol ?? "")
      }))
      .filter((c: any) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol);
  }

  return [];
}

function chordMainAndSlash(symbol: string): { main: string; slashBass: string | null } {
  const s = String(symbol ?? "").trim();
  if (!s) return { main: "", slashBass: null };
  if (!s.includes("/")) return { main: s, slashBass: null };

  const parts = s.split("/");
  const main = (parts[0] ?? "").trim();
  const slashBass = (parts[1] ?? "").trim();
  return { main, slashBass: slashBass || null };
}

function chordRootPc(symbol: string): number | null {
  const { main } = chordMainAndSlash(symbol);
  const m = main.match(/^([A-Ga-g][#b]?)/);
  if (!m) return null;
  return parseRootToken(m[1]!);
}

function chordSlashBassPc(symbol: string): number | null {
  const { slashBass } = chordMainAndSlash(symbol);
  if (!slashBass) return null;
  return parseRootToken(slashBass);
}

function chordMapByMeasureT0(chords: ChordEvent[]): Map<number, ChordEvent> {
  const map = new Map<number, ChordEvent>();
  for (const c of chords) {
    if (!Number.isFinite(c.measure)) continue;
    if (!Number.isFinite(c.t)) continue;
    if (c.t !== 0) continue; // per your rule: t=0 only
    if (!c.symbol) continue;
    map.set(c.measure, c);
  }
  return map;
}

function isDominantFunction(params: { chordSymbol: string; tonicPc: number }): boolean {
  const { chordSymbol, tonicPc } = params;

  const dominant = pc(tonicPc + 7);
  const leadingTone = pc(tonicPc + 11);

  const root = chordRootPc(chordSymbol);
  const slashBass = chordSlashBassPc(chordSymbol);

  // V (root = dominant) OR V6-ish (bass = leadingTone) counts
  if (root !== null && pc(root) === dominant) return true;
  if (slashBass !== null && pc(slashBass) === leadingTone) return true;

  return false;
}

function detectCadencePairsVI(score: ScoreModel, warnings: string[]): Array<{ fromMeasure: number; toMeasure: number }> {
  const chords = getChordEventsFromMeta(score);
  if (!chords.length) {
    warn(warnings, "[rhythm] No chord events found in meta.harmonize.debug. Cadence detection skipped.");
    return [];
  }

  const fifths = getKeyFifths(score);
  const tonic = tonicPcFromFifthsMajor(fifths);

  const m0 = chordMapByMeasureT0(chords);

  const p0 = score.parts?.[0];
  const measures = p0?.measures ?? [];
  if (!Array.isArray(measures) || measures.length < 2) return [];

  const nums = measures.map((m: any, idx: number) => getMeasureNumber(m, idx + 1));
  const pairs: Array<{ fromMeasure: number; toMeasure: number }> = [];

  for (let i = 0; i < nums.length - 1; i++) {
    const a = nums[i]!;
    const b = nums[i + 1]!;

    const ca = m0.get(a);
    const cb = m0.get(b);
    if (!ca || !cb) continue;

    const rb = chordRootPc(cb.symbol);
    if (rb === null) continue;

    const isV = isDominantFunction({ chordSymbol: ca.symbol, tonicPc: tonic });
    const isI = pc(rb) === pc(tonic);

    if (isV && isI) {
      pairs.push({ fromMeasure: a, toMeasure: b });
    }
  }

  return pairs;
}

function choosePlan3of4(params: { measureNumber: number; warnings: string[] }): RhythmPlan {
  const { measureNumber, warnings } = params;
  warn(warnings, `[rhythm] m${measureNumber}: 3/4 cadence rhythm uses dotted-half (3).`);
  return { beatsPerMeasure: 3, slots: [{ t: 0, dur: 3 }], label: "3/4:3" };
}

function choosePlanForMeter(params: { beatsPerMeasure: number; measureNumber: number; warnings: string[] }): RhythmPlan {
  const { beatsPerMeasure, measureNumber, warnings } = params;

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
    return choosePlan3of4({ measureNumber, warnings });
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
    if (!byT.has(t)) byT.set(t, { ...e });
  }

  const outNR: any[] = [];
  for (const slot of plan.slots) {
    const src = byT.get(slot.t);
    if (!src) {
      warn(warnings, `[rhythm] m${measureNumber}: missing Bass anchor at t=${slot.t}; leaving empty`);
      continue;
    }
    outNR.push({ ...src, t: slot.t, dur: slot.dur });
  }

  measure.events = [...other, ...outNR].sort((a: any, b: any) => Number(a.t ?? 0) - Number(b.t ?? 0));
}

function pickFinalCadencePair(
  cadencePairs: Array<{ fromMeasure: number; toMeasure: number }>
): { fromMeasure: number; toMeasure: number } | null {
  if (!cadencePairs.length) return null;

  // Final cadence = greatest toMeasure, tie-break by greatest fromMeasure
  const sorted = cadencePairs
    .slice()
    .sort((a, b) => (a.toMeasure !== b.toMeasure ? a.toMeasure - b.toMeasure : a.fromMeasure - b.fromMeasure));

  return sorted[sorted.length - 1] ?? null;
}

export function applySimpleMeterRhythmToBassOnCadences(score: ScoreModel): RhythmApplyResult {
  const warnings: string[] = [];
  const beatsPerMeasure = getBeatsPerMeasure(score);

  const bass = getBassPart(score);
  if (!bass) {
    warn(warnings, "[rhythm] No Bass part found. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no bass",
      cadenceMeasureNumbers: [],
      cadencePairs: [],
      plansUsed: {},
      warnings
    };
  }

  const cadencePairs = detectCadencePairsVI(score, warnings);
  if (!cadencePairs.length) {
    warn(warnings, "[rhythm] No V->I cadences detected. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no cadences",
      cadenceMeasureNumbers: [],
      cadencePairs,
      plansUsed: {},
      warnings
    };
  }

  const finalPair = pickFinalCadencePair(cadencePairs);
  if (!finalPair) {
    warn(warnings, "[rhythm] Cadences were detected but final cadence selection failed. No rhythm changes applied.");
    return {
      applied: false,
      reason: "final cadence selection failed",
      cadenceMeasureNumbers: [],
      cadencePairs,
      plansUsed: {},
      warnings
    };
  }

  const cadenceMeasureSet = new Set<number>([finalPair.fromMeasure, finalPair.toMeasure]);
  const cadenceMeasureNumbers = Array.from(cadenceMeasureSet).sort((a, b) => a - b);

  warn(
    warnings,
    `[rhythm] Detected ${cadencePairs.length} V->I cadence(s). Applying rhythm only to final cadence: ${finalPair.fromMeasure}->${finalPair.toMeasure}.`
  );

  const bassMeasures = bass.measures ?? [];
  if (!Array.isArray(bassMeasures) || !bassMeasures.length) {
    warn(warnings, "[rhythm] Bass has no measures. No rhythm changes applied.");
    return {
      applied: false,
      reason: "no measures",
      cadenceMeasureNumbers,
      cadencePairs,
      plansUsed: {},
      warnings
    };
  }

  const plansUsed: Record<string, RhythmPlan> = {};
  let didAny = false;

  for (let i = 0; i < bassMeasures.length; i++) {
    const m = bassMeasures[i];
    const mNum = getMeasureNumber(m, i + 1);

    if (!cadenceMeasureSet.has(mNum)) continue;

    const plan = choosePlanForMeter({ beatsPerMeasure, measureNumber: mNum, warnings });
    plansUsed[String(mNum)] = plan;

    compressMeasureToPlan(m, plan, warnings, mNum);
    didAny = true;
  }

  if (!didAny) {
    warn(warnings, `[rhythm] Final cadence measures found (${cadenceMeasureNumbers.join(", ")}), but nothing was changed.`);
    return {
      applied: false,
      reason: "no changes applied",
      cadenceMeasureNumbers,
      cadencePairs,
      plansUsed,
      warnings
    };
  }

  warn(
    warnings,
    `[rhythm] Applied Bass-only rhythm compression on final cadence measures: ${cadenceMeasureNumbers.join(
      ", "
    )}. beatsPerMeasure=${beatsPerMeasure}.`
  );

  return {
    applied: true,
    reason: "applied final-cadence-only simple-meter rhythm to Bass",
    cadenceMeasureNumbers,
    cadencePairs,
    plansUsed,
    warnings
  };
}