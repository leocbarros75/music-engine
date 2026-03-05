// src/rhythm/applyPolyphonicBassCounterRhythm.ts
import type { ScoreModel } from "../score/types";
import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";
import type { RhythmApplyResult } from "./rhythmTypes";

type ApplyOptions = {
  allowRests?: boolean;
  activity?: "grounded" | "less_active" | "active" | "high_active";
  randomizeOffsets?: boolean;
  minMidiOverride?: number;
  maxMidiOverride?: number;
  durationWhitelist?: number[];
};

type ChordEvent = { measure: number; t: number; symbol: string };

type Pitch = { step: string; alter?: number; octave: number };

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
}

function getMelodyPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  const preferred =
    parts.find((p: any) => {
      const name = String(p?.name ?? "").toLowerCase();
      return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    }) ?? parts[0];
  return preferred ?? null;
}

function getBassPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("bass")) return p;
  }
  return parts.length ? parts[parts.length - 1] : null;
}

function getTenorPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("tenor")) return p;
  }
  return parts.length ? parts[1] : null;
}

function getAltoPart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  for (const p of parts) {
    const n = String(p?.name ?? "").toLowerCase();
    if (n.includes("alto")) return p;
  }
  return parts.length ? parts[2] : null;
}

function isNoteOrRest(e: any): boolean {
  return e && (e.type === "note" || e.type === "rest") && typeof e.t === "number" && typeof e.dur === "number";
}

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

function isStrongBeat(t: number): boolean {
  return near(t, Math.round(t));
}

function isChordBoundary(chords: ChordEvent[], measureNumber: number, t: number): boolean {
  for (const c of chords) {
    if (Number(c.measure) !== Number(measureNumber)) continue;
    if (near(Number(c.t), t)) return true;
  }
  return false;
}

function shouldForceChordTone(chords: ChordEvent[], measureNumber: number, t: number): boolean {
  if (isChordBoundary(chords, measureNumber, t)) return true;
  if (isStrongBeat(t)) return true;
  return false;
}

function ensureChordBoundaryEvents(
  events: any[],
  chords: ChordEvent[],
  measureNumber: number,
  beatsPerMeasure: number
): any[] {
  const times = Array.from(
    new Set(
      chords
        .filter((c) => Number(c.measure) === Number(measureNumber))
        .map((c) => Number(c.t))
        .filter((t) => Number.isFinite(t) && t >= 0 && t < beatsPerMeasure)
    )
  ).sort((a, b) => a - b);
  if (!times.length) return events.slice();

  const out = events.slice().sort((a, b) => Number(a.t) - Number(b.t));
  for (const t of times) {
    if (out.some((ev) => isNoteOrRest(ev) && near(Number(ev.t), t))) continue;
    const idx = out.findIndex((ev) => {
      if (!isNoteOrRest(ev)) return false;
      const start = Number(ev.t);
      const end = start + Number(ev.dur);
      return start < t && t < end - 1e-6;
    });
    if (idx < 0) continue;
    const ev = out[idx];
    const start = Number(ev.t);
    const end = start + Number(ev.dur);
    const beforeDur = t - start;
    const afterDur = end - t;
    if (beforeDur <= 1e-6 || afterDur <= 1e-6) continue;
    const before = { ...ev, dur: beforeDur };
    const after = { ...ev, t, dur: afterDur };
    out.splice(idx, 1, before, after);
  }
  return out;
}

function shouldUseSixteenth(measureNumber: number, t: number, ratio = 0.15, salt = 0): boolean {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 73856093) ^ (tKey * 19349663) ^ (salt * 83492791) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

function activityRatio(level?: ApplyOptions["activity"]): number {
  switch (level) {
    case "high_active":
      return 1;
    case "active":
      return 0.55;
    case "less_active":
      return 0.3;
    case "grounded":
    default:
      return 0;
  }
}

function shouldUseActive(measureNumber: number, t: number, ratio: number): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ 0x27d4eb2f;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

type RhythmStep = { dur: number; role: "chord" | "passing" };

const SIXTEENTH_PATTERNS: RhythmStep[][] = [
  [
    { dur: 0.25, role: "chord" },
    { dur: 0.25, role: "passing" },
    { dur: 0.5, role: "chord" }
  ],
  [
    { dur: 0.5, role: "chord" },
    { dur: 0.25, role: "passing" },
    { dur: 0.25, role: "chord" }
  ],
  [
    { dur: 0.25, role: "chord" },
    { dur: 0.5, role: "passing" },
    { dur: 0.25, role: "chord" }
  ],
  [
    { dur: 0.75, role: "chord" },
    { dur: 0.25, role: "passing" }
  ]
];

function pickSixteenthPattern(measureNumber: number, t: number, salt = 0): RhythmStep[] {
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 1274126177) ^ (tKey * 1103515245) ^ (salt * 1540483477) ^ 0x85ebca6b;
  h = Math.abs(h >>> 0);
  const idx = h % SIXTEENTH_PATTERNS.length;
  return SIXTEENTH_PATTERNS[idx] ?? SIXTEENTH_PATTERNS[0]!;
}

function pushPattern(out: any[], t: number, pattern: RhythmStep[], dir: 1 | -1): void {
  let cursor = t;
  for (const step of pattern) {
    const ev: any = { type: "note", t: cursor, dur: step.dur, role: step.role };
    if (step.role === "passing") ev.dir = dir;
    out.push(ev);
    cursor += step.dur;
  }
}

function voiceSalt(tag?: string): number {
  if (!tag) return 0;
  let h = 0;
  for (let i = 0; i < tag.length; i++) {
    h = (h * 31 + tag.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function shouldUseActiveWithSalt(measureNumber: number, t: number, ratio: number, salt: number): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x27d4eb2f;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

const REPEAT_RATIO = 0.2;

function shouldAllowRepeatWithSalt(measureNumber: number, t: number, ratio: number, salt: number): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

type AltoRole = "chord" | "passing" | "neighbor" | "appoggiatura" | "skip" | "leap" | "anticipation" | "syncopation";

function pickAltoActiveRole(measureNumber: number, t: number, chords: ChordEvent[]): AltoRole {
  if (isStrongBeat(t) || isChordBoundary(chords, measureNumber, t)) return "chord";
  const weights: Array<{ value: AltoRole; weight: number }> = [
    { value: "passing", weight: 35 },
    { value: "neighbor", weight: 25 },
    { value: "skip", weight: 10 },
    { value: "leap", weight: 10 },
    { value: "chord", weight: 20 }
  ];
  const seed = (measureNumber * 1299709) ^ (Math.round(t * 1000) * 1511);
  return pickWeighted(weights, seed);
}

function activitySixteenthRatio(level?: ApplyOptions["activity"]): number {
  switch (level) {
    case "high_active":
      return 0.35;
    case "active":
      return 0.12;
    case "less_active":
      return 0.04;
    default:
      return 0;
  }
}

function buildActiveWeightedBaseEvents(params: {
  measureNumber: number;
  beatsPerMeasure: number;
  chords: ChordEvent[];
  allowRests: boolean;
  randomizeOffsets?: boolean;
  voiceTag?: string;
  durationWhitelist?: number[];
}): any[] {
  const { measureNumber, beatsPerMeasure, chords, allowRests, randomizeOffsets, voiceTag, durationWhitelist } = params;
  const out: any[] = [];
  const inMeasure = chords.filter((c) => Number(c.measure) === Number(measureNumber));
  const changePoints = Array.from(
    new Set([0, ...inMeasure.map((c) => Number(c.t)).filter((t) => t >= 0 && t < beatsPerMeasure), beatsPerMeasure])
  ).sort((a, b) => a - b);

  const baseWeights: Array<{ value: number; weight: number }> =
    voiceTag === "tenor"
      ? [
          { value: 1, weight: 4 }, // quarter (40%)
          { value: 2, weight: 3 }, // half (30%)
          { value: 0.5, weight: 2 }, // eighth (20%)
          { value: 1.5, weight: 1 } // dotted-quarter
        ]
      : [
          { value: 0.5, weight: 25 },
          { value: 1, weight: 45 },
          { value: 2, weight: 20 },
          { value: 4, weight: 10 }
        ];
  const weights =
    Array.isArray(durationWhitelist) && durationWhitelist.length
      ? baseWeights.filter((w) => durationWhitelist.includes(w.value))
      : baseWeights;

  for (let idx = 0; idx < changePoints.length - 1; idx++) {
    let cursor = changePoints[idx]!;
    const end = changePoints[idx + 1]!;
    const offsetChance = 0.05;
    const offsetDur = end - cursor >= 0.5 ? 0.5 : 0;
    if (allowRests && randomizeOffsets !== false && offsetDur > 0) {
      const seed = (measureNumber * 7919) ^ (Math.round(cursor * 1000) * 197);
      const roll = ((seed >>> 0) % 1000) / 1000;
      if (roll < offsetChance) {
        out.push({ type: "rest", t: cursor, dur: offsetDur });
        cursor += offsetDur;
      }
    }
    while (cursor < end - 1e-6) {
      const remaining = end - cursor;
      const choices = weights.filter((c) => c.value <= remaining + 1e-6);
      if (!choices.length) {
        out.push({ type: "note", t: cursor, dur: remaining });
        break;
      }
      const seed = (measureNumber * 991) ^ (Math.round(cursor * 1000) * 313);
      const dur = pickWeighted(choices, seed);
      const restRoll = allowRests ? ((seed >>> 0) % 1000) / 1000 : 1;
      const restChance = 0.03;
      const type = allowRests && restRoll < restChance ? "rest" : "note";
      out.push({ type, t: cursor, dur });
      cursor += dur;
    }
  }

  return out;
}

function pickWeighted<T>(choices: Array<{ value: T; weight: number }>, seed: number): T {
  const total = choices.reduce((sum, c) => sum + c.weight, 0);
  if (total <= 0) return choices[0]!.value;
  const r = (seed % 1000) / 1000;
  let acc = 0;
  for (const c of choices) {
    acc += c.weight / total;
    if (r <= acc) return c.value;
  }
  return choices[choices.length - 1]!.value;
}

function buildIndependentBaseEvents(params: {
  measureNumber: number;
  beatsPerMeasure: number;
  chords: ChordEvent[];
  activity: ApplyOptions["activity"];
  allowRests: boolean;
  randomizeOffsets?: boolean;
  voiceTag?: string;
  durationWhitelist?: number[];
}): any[] {
  const { measureNumber, beatsPerMeasure, chords, activity, allowRests, randomizeOffsets, voiceTag, durationWhitelist } =
    params;
  const out: any[] = [];
  const salt = voiceSalt(voiceTag);
  const inMeasure = chords.filter((c) => Number(c.measure) === Number(measureNumber));
  const changePoints = Array.from(
    new Set([0, ...inMeasure.map((c) => Number(c.t)).filter((t) => t >= 0 && t < beatsPerMeasure), beatsPerMeasure])
  ).sort((a, b) => a - b);

  const activityLevel = activity ?? "less_active";
  const durationChoices = (remaining: number, t: number) => {
    const base =
      voiceTag === "tenor"
        ? activityLevel === "high_active"
          ? [
              { value: 1, weight: 3 }, // quarter (30%)
              { value: 0.5, weight: 5 }, // eighth (50%)
              { value: 2, weight: 1 }, // other (half)
              { value: 0.25, weight: 1 } // other (sixteenth)
            ]
          : activityLevel === "active"
            ? [
                { value: 1, weight: 4 }, // quarter (40%)
                { value: 2, weight: 3 }, // half (30%)
                { value: 0.5, weight: 2 }, // eighth (20%)
                { value: 1.5, weight: 1 } // dotted-quarter (10%)
              ]
            : [
                { value: 2, weight: 6 }, // half
                { value: 1, weight: 4 } // quarter
              ]
        : activityLevel === "high_active"
          ? [
              { value: 0.5, weight: 5 },
              { value: 0.25, weight: 4 },
              { value: 1, weight: 2 },
              { value: 2, weight: 1 }
            ]
          : activityLevel === "active"
            ? [
                { value: 1, weight: 4 },
                { value: 0.5, weight: 3 },
                { value: 2, weight: 1 }
              ]
            : [
                { value: 2, weight: 5 },
                { value: 1, weight: 3 },
                { value: 0.5, weight: 1 }
              ];
    const filtered = base.filter((c) => c.value <= remaining + 1e-6);
    if (Array.isArray(durationWhitelist) && durationWhitelist.length) {
      const limited = filtered.filter((c) => durationWhitelist.includes(c.value));
      return limited.length ? limited : filtered;
    }
    return filtered;
  };

  for (let idx = 0; idx < changePoints.length - 1; idx++) {
    let cursor = changePoints[idx]!;
    const end = changePoints[idx + 1]!;
    const offsetChance =
      activityLevel === "high_active" ? 0.35 : activityLevel === "active" ? 0.2 : activityLevel === "less_active" ? 0.1 : 0;
    const offsetDur =
      activityLevel === "high_active" && end - cursor >= 0.25
        ? 0.25
        : end - cursor >= 0.5
          ? 0.5
          : 0;
    if (allowRests && randomizeOffsets !== false && offsetDur > 0) {
      const seed = (measureNumber * 7919) ^ (Math.round(cursor * 1000) * 197) ^ (salt * 509);
      const roll = ((seed >>> 0) % 1000) / 1000;
      if (roll < offsetChance) {
        out.push({ type: "rest", t: cursor, dur: offsetDur });
        cursor += offsetDur;
      }
    }
    while (cursor < end - 1e-6) {
      const remaining = end - cursor;
      const choices = durationChoices(remaining, cursor);
      if (!choices.length) break;
      const seed = (measureNumber * 991) ^ (Math.round(cursor * 1000) * 313) ^ (salt * 271);
      const dur = pickWeighted(choices, seed);
      const restRoll = allowRests ? ((seed >>> 0) % 1000) / 1000 : 1;
      const restChance = activityLevel === "high_active" ? 0.08 : activityLevel === "active" ? 0.05 : 0.03;
      const type = allowRests && restRoll < restChance ? "rest" : "note";
      out.push({ type, t: cursor, dur });
      cursor += dur;
    }
  }

  return out;
}

function passingDirFromRoots(rootNow: number | null, rootNext: number | null, measureNumber: number, t: number): 1 | -1 {
  if (rootNow !== null && rootNext !== null && rootNow !== rootNext) {
    const diff = (rootNext - rootNow + 12) % 12;
    return diff <= 6 ? 1 : -1;
  }
  const key = measureNumber + Math.round(t * 2);
  return key % 2 === 0 ? 1 : -1;
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

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = (m0 as any)?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

function getKeyMode(score: ScoreModel): "major" | "minor" {
  const m0 = score.parts?.[0]?.measures?.[0];
  const raw = String((m0 as any)?.attributes?.key_mode ?? "").toLowerCase();
  return raw === "minor" ? "minor" : "major";
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
  return map[String(fifths)] ?? 0;
}

function tonicPcFromFifthsMinor(fifths: number): number {
  const map: Record<number, number> = {
    "-7": 8,
    "-6": 3,
    "-5": 10,
    "-4": 5,
    "-3": 0,
    "-2": 7,
    "-1": 2,
    "0": 9,
    "1": 4,
    "2": 11,
    "3": 6,
    "4": 1,
    "5": 8,
    "6": 3,
    "7": 10
  };
  return map[String(fifths)] ?? 9;
}

function scalePcsForKey(tonicPc: number, mode: "major" | "minor"): number[] {
  const steps = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return steps.map((s) => (tonicPc + s) % 12);
}

function parseRootPc(symbolRaw: string): number | null {
  const s = String(symbolRaw ?? "").trim();
  if (!s) return null;
  const main = s.split("/")[0] ?? s;
  const m = main.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return null;
  if (acc === "#") return (base + 1) % 12;
  if (acc === "b") return (base + 11) % 12;
  return base;
}

function parseBassPc(symbolRaw: string): number | null {
  const s = String(symbolRaw ?? "").trim();
  if (!s) return null;
  if (!s.includes("/")) return parseRootPc(s);
  const slash = s.split("/")[1] ?? "";
  const m = slash.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return parseRootPc(s);
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return parseRootPc(s);
  if (acc === "#") return (base + 1) % 12;
  if (acc === "b") return (base + 11) % 12;
  return base;
}

function pickChordForTime(chords: ChordEvent[], measure: number, t: number): ChordEvent | null {
  const inMeasure = chords.filter((c) => Number(c.measure) === Number(measure));
  if (!inMeasure.length) return null;
  const sorted = inMeasure.slice().sort((a, b) => Number(a.t) - Number(b.t));
  let best: ChordEvent | null = null;
  for (const c of sorted) {
    if (Number(c.t) <= t + 1e-6) best = c;
    else break;
  }
  return best ?? sorted[0] ?? null;
}

function chordFunction(rootPc: number, tonicPc: number): "I" | "IV" | "V" | null {
  if (rootPc === tonicPc) return "I";
  if (rootPc === (tonicPc + 5) % 12) return "IV";
  if (rootPc === (tonicPc + 7) % 12) return "V";
  return null;
}

function chooseBassMidi(
  pcTarget: number,
  prevMidi: number,
  range: { min: number; max: number },
  anchorMidi = 43,
  options?: { maxLeap?: number; warnings?: string[]; context?: string }
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (((m % 12) + 12) % 12 === pcTarget) candidates.push(m);
  }
  if (!candidates.length) return prevMidi;
  const maxLeap = options?.maxLeap;
  const leapCandidates =
    typeof maxLeap === "number" && Number.isFinite(maxLeap)
      ? candidates.filter((c) => Math.abs(c - prevMidi) <= maxLeap)
      : candidates;
  if (!leapCandidates.length && options?.warnings && options?.context) {
    warn(options.warnings, options.context);
  }
  const pool = leapCandidates.length ? leapCandidates : candidates;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of pool) {
    const anchorPenalty = Math.abs(c - anchorMidi);
    const smoothPenalty = Math.abs(c - prevMidi) * 0.35;
    const score = anchorPenalty + smoothPenalty;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function chooseChordToneInDirection(
  chordPcs: number[],
  prevMidi: number,
  range: { min: number; max: number },
  dir: 1 | -1,
  options?: { maxLeap?: number; warnings?: string[]; context?: string }
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (chordPcs.includes(((m % 12) + 12) % 12)) candidates.push(m);
  }
  if (!candidates.length) return prevMidi;
  const maxLeap = options?.maxLeap;
  const leapCandidates =
    typeof maxLeap === "number" && Number.isFinite(maxLeap)
      ? candidates.filter((c) => Math.abs(c - prevMidi) <= maxLeap)
      : candidates;
  if (!leapCandidates.length && options?.warnings && options?.context) {
    warn(options.warnings, options.context);
  }
  const pool = leapCandidates.length ? leapCandidates : candidates;
  const sorted = pool.sort((a, b) => a - b);
  if (dir > 0) {
    const up = sorted.find((m) => m > prevMidi);
    return up ?? sorted[0]!;
  }
  const down = [...sorted].reverse().find((m) => m < prevMidi);
  return down ?? sorted[sorted.length - 1]!;
}

function chooseChordToneNearest(
  chordPcs: number[],
  prevMidi: number,
  range: { min: number; max: number },
  anchorMidi: number,
  options?: { maxLeap?: number; warnings?: string[]; context?: string; avoidRepeat?: boolean }
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (chordPcs.includes(((m % 12) + 12) % 12)) candidates.push(m);
  }
  if (!candidates.length) return prevMidi;
  const maxLeap = options?.maxLeap;
  const leapCandidates =
    typeof maxLeap === "number" && Number.isFinite(maxLeap)
      ? candidates.filter((c) => Math.abs(c - prevMidi) <= maxLeap)
      : candidates;
  if (!leapCandidates.length && options?.warnings && options?.context) {
    warn(options.warnings, options.context);
  }
  const pool = leapCandidates.length ? leapCandidates : candidates;

  let best = pool[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of pool) {
    const dist = Math.abs(c - prevMidi) * 0.8;
    const anchor = Math.abs(c - anchorMidi) * 0.2;
    const score = dist + anchor;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (options?.avoidRepeat && best === prevMidi) {
    let nextBest = best;
    let nextScore = Number.POSITIVE_INFINITY;
    for (const c of pool) {
      if (c === prevMidi) continue;
      const dist = Math.abs(c - prevMidi) * 0.8;
      const anchor = Math.abs(c - anchorMidi) * 0.2;
      const score = dist + anchor;
      if (score < nextScore) {
        nextScore = score;
        nextBest = c;
      }
    }
    if (nextBest !== best) return nextBest;
  }

  return best;
}

function chooseChordToneByInterval(
  chordPcs: number[],
  prevMidi: number,
  range: { min: number; max: number },
  minInterval: number,
  maxInterval: number,
  fallback: number
): number {
  let best: number | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let midi = range.min; midi <= range.max; midi++) {
    if (!chordPcs.includes(((midi % 12) + 12) % 12)) continue;
    const dist = Math.abs(midi - prevMidi);
    if (dist < minInterval || dist > maxInterval) continue;
    if (dist < bestScore) {
      bestScore = dist;
      best = midi;
    }
  }
  return best ?? fallback;
}

function chooseNeighborMidi(
  prevMidi: number,
  scalePcs: number[],
  range: { min: number; max: number },
  dir: 1 | -1
): number {
  let candidate = prevMidi + dir;
  while (candidate >= range.min && candidate <= range.max) {
    if (scalePcs.includes(((candidate % 12) + 12) % 12)) return candidate;
    candidate += dir;
  }
  return prevMidi;
}

function choosePassingMidi(
  prevMidi: number,
  scalePcs: number[],
  range: { min: number; max: number },
  dir: 1 | -1
): number {
  const steps = [1, 2];
  for (const step of steps) {
    const cand = prevMidi + dir * step;
    if (cand < range.min || cand > range.max) continue;
    if (scalePcs.includes(((cand % 12) + 12) % 12)) return cand;
  }
  const fallback = prevMidi - dir;
  if (fallback >= range.min && fallback <= range.max && scalePcs.includes(((fallback % 12) + 12) % 12)) {
    return fallback;
  }
  return prevMidi;
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try {
      return pitchToMidi(ev.pitch as Pitch);
    } catch {
      return null;
    }
  }
  return null;
}

function findNoteMidiAtTime(events: any[], t: number): number | null {
  let active: any | null = null;
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e.t);
    const ed = Number(e.dur);
    if (!Number.isFinite(et) || !Number.isFinite(ed)) continue;
    if (et <= t && t < et + ed) {
      active = e;
      break;
    }
  }
  if (!active) {
    active = events.find((e: any) => e?.type === "note" && Number(e.t) === t) ?? null;
  }
  return active ? eventMidi(active) : null;
}

function buildCounterRhythmEvents(params: {
  melodyEvents: any[];
  followStrict: boolean;
  allowRests: boolean;
  measureNumber: number;
  chords: ChordEvent[];
  beatsPerMeasure: number;
  tonicPc: number;
  activity: ApplyOptions["activity"];
  independent?: boolean;
  randomizeOffsets?: boolean;
  voiceTag?: string;
  durationWhitelist?: number[];
}): any[] {
  const {
    melodyEvents,
    followStrict,
    allowRests,
    measureNumber,
    chords,
    beatsPerMeasure,
    tonicPc,
    activity,
    independent,
    randomizeOffsets,
    voiceTag,
    durationWhitelist
  } = params;
  const out: any[] = [];
  const forceDurationWhitelist = Array.isArray(durationWhitelist) && durationWhitelist.length > 0;
  const wantsWeightedActiveDurations =
    (voiceTag === "alto" || voiceTag === "tenor") && activity === "active" && independent && !followStrict;
  const wantsRoleWeighting = activity === "active" && independent && !followStrict;
  const base = followStrict && !forceDurationWhitelist
    ? melodyEvents.slice().sort((a, b) => Number(a.t) - Number(b.t))
    : wantsWeightedActiveDurations
      ? buildActiveWeightedBaseEvents({
          measureNumber,
          beatsPerMeasure,
          chords,
          allowRests,
          randomizeOffsets,
          voiceTag,
          durationWhitelist
        })
      : independent
        ? buildIndependentBaseEvents({
            measureNumber,
            beatsPerMeasure,
            chords,
            activity: activity ?? "less_active",
            allowRests,
            randomizeOffsets,
            voiceTag,
            durationWhitelist
          })
        : melodyEvents.slice().sort((a, b) => Number(a.t) - Number(b.t));
  const evs =
    followStrict && !forceDurationWhitelist || !independent
      ? base
      : ensureChordBoundaryEvents(base, chords, measureNumber, beatsPerMeasure);
  const activityLevel = activityRatio(activity);
  const salt = voiceSalt(voiceTag);
  const sixteenthRatio = activitySixteenthRatio(activity);

  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (!isNoteOrRest(ev)) continue;

    const t = Number(ev.t);
    const dur = Number(ev.dur);
    const next = evs[i + 1];
    const useActive = shouldUseActiveWithSalt(measureNumber, t, activityLevel, salt);

    if (ev.type === "rest" && allowRests) {
      out.push({ type: "rest", t, dur });
      continue;
    }

    if (wantsRoleWeighting) {
      out.push({ type: "note", t, dur, role: pickAltoActiveRole(measureNumber, t, chords) });
      continue;
    }

    if (followStrict) {
      out.push({ type: "note", t, dur, role: "chord" });
      continue;
    }

    const chordNow = pickChordForTime(chords, measureNumber, t);
    const chordNext = pickChordForTime(
      chords,
      t + dur < beatsPerMeasure ? measureNumber : measureNumber + 1,
      t + dur < beatsPerMeasure ? t + dur : 0
    );
    const rootNow = chordNow ? parseRootPc(chordNow.symbol) : null;
    const rootNext = chordNext ? parseRootPc(chordNext.symbol) : null;
    const fnNow = rootNow !== null ? chordFunction(rootNow, tonicPc) : null;
    const fnNext = rootNext !== null ? chordFunction(rootNext, tonicPc) : null;

    if (useActive && near(dur, 1) && fnNow === "IV" && fnNext === "I") {
      out.push({ type: "note", t, dur: 0.5, role: "arpUp", step: 0 });
      out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "arpUp", step: 1 });
      continue;
    }

    if (useActive && near(dur, 1) && fnNow === "V" && fnNext === "I") {
      out.push({ type: "note", t, dur: 0.5, role: "arpDown", step: 0 });
      out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "arpDown", step: 1 });
      continue;
    }

    if (near(dur, 2)) {
      const dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
      out.push({ type: "note", t, dur: 1, role: "chord" });
      if (useActive) {
        out.push({ type: "note", t: t + 1, dur: 0.5, role: "chord" });
        out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "passing", dir });
      } else {
        out.push({ type: "note", t: t + 1, dur: 1, role: "chord" });
      }
      continue;
    }

    if (
      useActive &&
      near(dur, 1.5) &&
      next &&
      isNoteOrRest(next) &&
      near(Number(next.dur), 0.5) &&
      near(Number(next.t), t + 1.5)
    ) {
      const dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
      out.push({ type: "note", t, dur: 0.5, role: "chord" });
      out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir });
      out.push({ type: "note", t: t + 1.0, dur: 0.5, role: "chord" });
      out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "chord" });
      i += 1;
      continue;
    }

    if (useActive && near(dur, 1.5)) {
      const dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
      out.push({ type: "note", t, dur: 0.5, role: "chord" });
      out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir });
      out.push({ type: "note", t: t + 1.0, dur: 0.5, role: "chord" });
      continue;
    }

    if (
      near(dur, 1) &&
      next &&
      isNoteOrRest(next) &&
      next.type === "note" &&
      near(Number(next.dur), 1) &&
      near(Number(next.t), t + 1)
    ) {
      const midiNow = eventMidi(ev);
      const midiNext = eventMidi(next);
      if (useActive && midiNow !== null && midiNext !== null && midiNow === midiNext) {
        const dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
        const allow16th = shouldUseSixteenth(measureNumber, t + 1, sixteenthRatio, salt);
        out.push({ type: "note", t, dur: 0.5, role: "chord" });
        out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir });
        if (allow16th) {
          const pattern = pickSixteenthPattern(measureNumber, t + 1, salt);
          pushPattern(out, t + 1, pattern, dir);
        } else {
          out.push({ type: "note", t: t + 1, dur: 0.5, role: "chord" });
          out.push({ type: "note", t: t + 1.5, dur: 0.5, role: "passing", dir });
        }
        i += 1;
        continue;
      }
      out.push({ type: "note", t, dur: 2, role: "chord" });
      i += 1;
      continue;
    }

    if (useActive && near(dur, 1)) {
      const dir = passingDirFromRoots(rootNow, rootNext, measureNumber, t);
      const allow16th = shouldUseSixteenth(measureNumber, t, sixteenthRatio, salt);
      if (allow16th) {
        const pattern = pickSixteenthPattern(measureNumber, t, salt);
        pushPattern(out, t, pattern, dir);
      } else {
        out.push({ type: "note", t, dur: 0.5, role: "chord" });
        out.push({ type: "note", t: t + 0.5, dur: 0.5, role: "passing", dir });
      }
      continue;
    }

    out.push({ type: "note", t, dur, role: "chord" });
  }

  return out;
}

export function applyPolyphonicBassCounterRhythm(
  score: ScoreModel,
  chords: ChordEvent[],
  options?: ApplyOptions
): RhythmApplyResult {
  const warnings: string[] = [];
  const bass = getBassPart(score);
  const melody = getMelodyPart(score);
  const chordEvents =
    Array.isArray(chords) && chords.length
      ? chords
      : Array.isArray((score as any)?.meta?.harmonize?.chords)
        ? ((score as any).meta.harmonize.chords as ChordEvent[])
        : [];

  if (!bass || !melody) {
    warn(warnings, "[rhythm] Missing Bass or Melody part for polyphonic bass counter-rhythm.");
    return {
      applied: false,
      reason: "missing parts",
      style: "classical",
      detectedCadencePairs: [],
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const bassMeasures = Array.isArray(bass.measures) ? bass.measures : [];
  const melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
  const total = Math.min(bassMeasures.length, melMeasures.length);
  const applied: number[] = [];
  const range = { min: 40, max: 64 };
  if (typeof options?.minMidiOverride === "number" && Number.isFinite(options.minMidiOverride)) {
    range.min = Math.max(range.min, Math.round(options.minMidiOverride));
  }
  if (typeof options?.maxMidiOverride === "number" && Number.isFinite(options.maxMidiOverride)) {
    range.max = Math.min(range.max, Math.round(options.maxMidiOverride));
  }
  if (range.min > range.max) range.min = range.max;
  const maxLeap = 12;
  let prevMidi = 43;
  const keyMode = getKeyMode(score);
  const tonicPc =
    keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
  const scalePcs = scalePcsForKey(tonicPc, keyMode);
  const beatsPerMeasure = score.parts?.[0]?.measures?.[0]?.attributes?.time?.beats ?? 4;

  for (let i = 0; i < total; i++) {
    const b = bassMeasures[i];
    const m = melMeasures[i];
    if (!b || !m) continue;

    const mNum = Number(b?.number) || i + 1;
    const followStrict = i < 2 || i >= total - 2;
    const melEvents = Array.isArray(m?.events) ? m.events.filter(isNoteOrRest) : [];
    const other = Array.isArray(b?.events) ? b.events.filter((e: any) => !isNoteOrRest(e)) : [];

    const counter = buildCounterRhythmEvents({
      melodyEvents: melEvents,
      followStrict,
      allowRests: options?.allowRests === true,
      measureNumber: mNum,
      chords: chordEvents,
      beatsPerMeasure,
      tonicPc,
      activity: options?.activity ?? "less_active",
      independent: true,
      randomizeOffsets: options?.randomizeOffsets,
      voiceTag: "bass"
    });

    if (!counter.length) {
      warn(warnings, `[rhythm] m${mNum}: no counter-rhythm events created for bass.`);
      continue;
    }

    const enriched = counter.map((ev) => {
      if (ev.type === "rest") return ev;
      const forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
      const allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("bass"));
      const role =
        forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
          ? "chord"
          : ev.role;
      const chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
      const parsed = chord ? parseChordSymbol(chord.symbol.split("/")[0] ?? chord.symbol) : null;
      const bassPc = chord ? parseBassPc(chord.symbol) : null;
      const chordPcs = parsed?.pcs ?? (bassPc !== null ? [bassPc] : []);
      const rootPc = parsed?.rootPc ?? bassPc ?? null;

      if (!chord || rootPc === null) {
        return { ...ev, type: "note", midi: prevMidi, pitch: midiToPitch(prevMidi), lockPitch: true };
      }

      const finalize = (midi: number) => {
        let nextMidi = midi;
        if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
          const alt = chooseChordToneNearest(chordPcs, prevMidi, range, 43, {
            maxLeap,
            avoidRepeat: true,
            warnings,
            context: `[rhythm] m${mNum} t=${ev.t}: repeat avoided; using alternate chord tone.`
          });
          if (typeof alt === "number") nextMidi = alt;
        }
        prevMidi = nextMidi;
        return { ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi), lockPitch: true };
      };

      if (role === "arpUp" || role === "arpDown") {
        if (ev.step === 0) {
          const basePc = bassPc ?? rootPc;
          const midi = chooseBassMidi(basePc, prevMidi, range, 43, {
            maxLeap,
            warnings,
            context: `[rhythm] m${mNum} t=${ev.t}: bass leap exceeded ${maxLeap} semitones; using closest chord tone.`
          });
          return finalize(midi);
        }
        const dir: 1 | -1 = role === "arpUp" ? 1 : -1;
        const midi = chooseChordToneInDirection(chordPcs, prevMidi, range, dir, {
          maxLeap,
          warnings,
          context: `[rhythm] m${mNum} t=${ev.t}: bass leap exceeded ${maxLeap} semitones; using closest chord tone.`
        });
        return finalize(midi);
      }

      if (role === "passing") {
        const dir: 1 | -1 = ev.dir === -1 ? -1 : 1;
        const midi = choosePassingMidi(prevMidi, scalePcs, range, dir);
        return finalize(midi);
      }
      if (role === "neighbor" || role === "appoggiatura") {
        const dir: 1 | -1 = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
        const midi = chooseNeighborMidi(prevMidi, scalePcs, range, dir);
        return finalize(midi);
      }
      if (role === "skip") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, range, 3, 5, prevMidi);
        return finalize(midi);
      }
      if (role === "leap") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, range, 7, 9, prevMidi);
        return finalize(midi);
      }

      const basePc = bassPc ?? rootPc;
      const midi = chooseBassMidi(basePc, prevMidi, range, 43, {
        maxLeap,
        warnings,
        context: `[rhythm] m${mNum} t=${ev.t}: bass leap exceeded ${maxLeap} semitones; using closest chord tone.`
      });
      return finalize(midi);
    });

    b.events = [...other, ...enriched].sort((a: any, bEv: any) => Number(a.t ?? 0) - Number(bEv.t ?? 0));
    applied.push(mNum);
  }

  if (applied.length) {
    warn(
      warnings,
      `[rhythm] Polyphonic bass counter-rhythm applied to ${applied.length} measure(s). First and last two measures follow melody rhythm.`
    );
  }

  return {
    applied: applied.length > 0,
    reason: applied.length ? "applied" : "no measures",
    style: "classical",
    detectedCadencePairs: [],
    appliedCadencePair: null,
    appliedMeasureNumbers: applied,
    chosenPlans: {},
    warnings
  };
}

export function applyPolyphonicTenorCounterRhythm(
  score: ScoreModel,
  chords: ChordEvent[],
  options?: ApplyOptions
): RhythmApplyResult {
  const warnings: string[] = [];
  const tenor = getTenorPart(score);
  const melody = getMelodyPart(score);
  const chordEvents =
    Array.isArray(chords) && chords.length
      ? chords
      : Array.isArray((score as any)?.meta?.harmonize?.chords)
        ? ((score as any).meta.harmonize.chords as ChordEvent[])
        : [];

  if (!tenor || !melody) {
    warn(warnings, "[rhythm] Missing Tenor or Melody part for polyphonic tenor counter-rhythm.");
    return {
      applied: false,
      reason: "missing parts",
      style: "classical",
      detectedCadencePairs: [],
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const tenorMeasures = Array.isArray(tenor.measures) ? tenor.measures : [];
  const melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
  const total = Math.min(tenorMeasures.length, melMeasures.length);
  const applied: number[] = [];
  const defaultRange = { min: 48, max: 69 };
  const anchorMidi = 57;
  const maxLeap = 12;
  let prevMidi = anchorMidi;
  const keyMode = getKeyMode(score);
  const tonicPc =
    keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
  const scalePcs = scalePcsForKey(tonicPc, keyMode);
  const beatsPerMeasure = score.parts?.[0]?.measures?.[0]?.attributes?.time?.beats ?? 4;

  let minSeen = Number.POSITIVE_INFINITY;
  let maxSeen = Number.NEGATIVE_INFINITY;
  for (const m of tenorMeasures) {
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note" || typeof ev?.midi !== "number") continue;
      minSeen = Math.min(minSeen, ev.midi);
      maxSeen = Math.max(maxSeen, ev.midi);
    }
  }
  const range = {
    min: Number.isFinite(minSeen) ? Math.max(defaultRange.min, minSeen - 2) : defaultRange.min,
    max: Number.isFinite(maxSeen) ? Math.min(defaultRange.max, maxSeen + 2) : defaultRange.max
  };
  if (typeof options?.minMidiOverride === "number" && Number.isFinite(options.minMidiOverride)) {
    range.min = Math.max(range.min, Math.round(options.minMidiOverride));
  }
  if (typeof options?.maxMidiOverride === "number" && Number.isFinite(options.maxMidiOverride)) {
    range.max = Math.min(range.max, Math.round(options.maxMidiOverride));
  }
  if (range.min > range.max) range.min = range.max;

  for (let i = 0; i < total; i++) {
    const tPart = tenorMeasures[i];
    const m = melMeasures[i];
    if (!tPart || !m) continue;

    const mNum = Number(tPart?.number) || i + 1;
    const followStrict = i < 2 || i >= total - 2;
    const melEvents = Array.isArray(m?.events) ? m.events.filter(isNoteOrRest) : [];
    const other = Array.isArray(tPart?.events) ? tPart.events.filter((e: any) => !isNoteOrRest(e)) : [];

    const counter = buildCounterRhythmEvents({
      melodyEvents: melEvents,
      followStrict,
      allowRests: options?.allowRests === true,
      measureNumber: mNum,
      chords: chordEvents,
      beatsPerMeasure,
      tonicPc,
      activity: options?.activity ?? "less_active",
      independent: true,
      randomizeOffsets: options?.randomizeOffsets,
      voiceTag: "tenor",
      durationWhitelist: options?.durationWhitelist
    });

    if (!counter.length) {
      warn(warnings, `[rhythm] m${mNum}: no counter-rhythm events created for tenor.`);
      continue;
    }

    const enriched = counter.map((ev) => {
      if (ev.type === "rest") return ev;
      const forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
      const allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("tenor"));
      const role =
        forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
          ? "chord"
          : ev.role;
      const chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
      const parsed = chord ? parseChordSymbol(chord.symbol.split("/")[0] ?? chord.symbol) : null;
      const chordPcs = parsed?.pcs ?? [];
      if (!chord || !chordPcs.length) {
        return { ...ev, type: "note", midi: prevMidi, pitch: midiToPitch(prevMidi), lockPitch: true };
      }

      const dir = passingDirFromRoots(parseRootPc(chord.symbol), parseRootPc(chord.symbol), mNum, Number(ev.t));

      const finalize = (midi: number) => {
        let nextMidi = midi;
        if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
          const alt = chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
            maxLeap,
            warnings,
            context: `[rhythm] m${mNum} t=${ev.t}: tenor repeat avoided; using alternate chord tone.`,
            avoidRepeat: true
          });
          if (typeof alt === "number") nextMidi = alt;
        }
        prevMidi = nextMidi;
        return { ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi), lockPitch: true };
      };

      if (role === "arpUp" || role === "arpDown") {
        const stepDir: 1 | -1 = role === "arpUp" ? 1 : -1;
        const midi =
          ev.step === 0
            ? chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
                maxLeap,
                warnings,
                context: `[rhythm] m${mNum} t=${ev.t}: tenor leap exceeded ${maxLeap} semitones; using closest chord tone.`,
                avoidRepeat: !allowRepeat
              })
            : chooseChordToneInDirection(chordPcs, prevMidi, range, stepDir, {
                maxLeap,
                warnings,
                context: `[rhythm] m${mNum} t=${ev.t}: tenor leap exceeded ${maxLeap} semitones; using closest chord tone.`
              });
        return finalize(midi);
      }

      if (role === "passing") {
        const passDir: 1 | -1 = ev.dir === -1 ? -1 : 1;
        const midi = choosePassingMidi(prevMidi, scalePcs, range, passDir);
        return finalize(midi);
      }
      if (role === "neighbor" || role === "appoggiatura") {
        const dir: 1 | -1 = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
        const midi = chooseNeighborMidi(prevMidi, scalePcs, range, dir);
        return finalize(midi);
      }
      if (role === "skip") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, range, 3, 5, prevMidi);
        return finalize(midi);
      }
      if (role === "leap") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, range, 7, 9, prevMidi);
        return finalize(midi);
      }

      const midi = chooseChordToneNearest(chordPcs, prevMidi, range, anchorMidi, {
        maxLeap,
        warnings,
        context: `[rhythm] m${mNum} t=${ev.t}: tenor leap exceeded ${maxLeap} semitones; using closest chord tone.`,
        avoidRepeat: !allowRepeat
      });
      return finalize(midi);
    });

    tPart.events = [...other, ...enriched].sort((a: any, bEv: any) => Number(a.t ?? 0) - Number(bEv.t ?? 0));
    applied.push(mNum);
  }

  if (applied.length) {
    warn(
      warnings,
      `[rhythm] Polyphonic tenor counter-rhythm applied to ${applied.length} measure(s). First and last two measures follow melody rhythm.`
    );
  }

  return {
    applied: applied.length > 0,
    reason: applied.length ? "applied" : "no measures",
    style: "classical",
    detectedCadencePairs: [],
    appliedCadencePair: null,
    appliedMeasureNumbers: applied,
    chosenPlans: {},
    warnings
  };
}

export function applyPolyphonicAltoCounterRhythm(
  score: ScoreModel,
  chords: ChordEvent[],
  options?: ApplyOptions
): RhythmApplyResult {
  const warnings: string[] = [];
  const alto = getAltoPart(score);
  const melody = getMelodyPart(score);
  const chordEvents =
    Array.isArray(chords) && chords.length
      ? chords
      : Array.isArray((score as any)?.meta?.harmonize?.chords)
        ? ((score as any).meta.harmonize.chords as ChordEvent[])
        : [];

  if (!alto || !melody) {
    warn(warnings, "[rhythm] Missing Alto or Melody part for polyphonic alto counter-rhythm.");
    return {
      applied: false,
      reason: "missing parts",
      style: "classical",
      detectedCadencePairs: [],
      appliedCadencePair: null,
      appliedMeasureNumbers: [],
      chosenPlans: {},
      warnings
    };
  }

  const altoMeasures = Array.isArray(alto.measures) ? alto.measures : [];
  const melMeasures = Array.isArray(melody.measures) ? melody.measures : [];
  const total = Math.min(altoMeasures.length, melMeasures.length);
  const applied: number[] = [];
  const defaultRange = { min: 55, max: 74 };
  const anchorMidi = 62;
  const maxLeap = 12;
  let prevMidi = anchorMidi;
  const keyMode = getKeyMode(score);
  const tonicPc =
    keyMode === "minor" ? tonicPcFromFifthsMinor(getKeyFifths(score)) : tonicPcFromFifthsMajor(getKeyFifths(score));
  const scalePcs = scalePcsForKey(tonicPc, keyMode);
  const beatsPerMeasure = score.parts?.[0]?.measures?.[0]?.attributes?.time?.beats ?? 4;

  let minSeen = Number.POSITIVE_INFINITY;
  let maxSeen = Number.NEGATIVE_INFINITY;
  for (const m of altoMeasures) {
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note" || typeof ev?.midi !== "number") continue;
      minSeen = Math.min(minSeen, ev.midi);
      maxSeen = Math.max(maxSeen, ev.midi);
    }
  }
  const baseRange = {
    min: Number.isFinite(minSeen) ? Math.max(defaultRange.min, minSeen - 2) : defaultRange.min,
    max: Number.isFinite(maxSeen) ? Math.min(defaultRange.max, maxSeen + 2) : defaultRange.max
  };

  for (let i = 0; i < total; i++) {
    const aPart = altoMeasures[i];
    const m = melMeasures[i];
    if (!aPart || !m) continue;

    const mNum = Number(aPart?.number) || i + 1;
    const followStrict = i < 2 || i >= total - 2;
    const melEvents = Array.isArray(m?.events) ? m.events.filter(isNoteOrRest) : [];
    const other = Array.isArray(aPart?.events) ? aPart.events.filter((e: any) => !isNoteOrRest(e)) : [];

    const counter = buildCounterRhythmEvents({
      melodyEvents: melEvents,
      followStrict,
      allowRests: options?.allowRests === true,
      measureNumber: mNum,
      chords: chordEvents,
      beatsPerMeasure,
      tonicPc,
      activity: options?.activity ?? "less_active",
      independent: true,
      randomizeOffsets: options?.randomizeOffsets,
      voiceTag: "alto"
    });

    if (!counter.length) {
      warn(warnings, `[rhythm] m${mNum}: no counter-rhythm events created for alto.`);
      continue;
    }

    const enriched = counter.map((ev) => {
      if (ev.type === "rest") return ev;
      const forceChord = shouldForceChordTone(chordEvents, mNum, Number(ev.t));
      const allowRepeat = shouldAllowRepeatWithSalt(mNum, Number(ev.t), REPEAT_RATIO, voiceSalt("alto"));
      const role =
        forceChord && (ev.role === "passing" || ev.role === "neighbor" || ev.role === "appoggiatura")
          ? "chord"
          : ev.role;
      const chord = pickChordForTime(chordEvents, mNum, Number(ev.t));
      const parsed = chord ? parseChordSymbol(chord.symbol.split("/")[0] ?? chord.symbol) : null;
      const chordPcs = parsed?.pcs ?? [];
      if (!chord || !chordPcs.length) {
        return { ...ev, type: "note", midi: prevMidi, pitch: midiToPitch(prevMidi), lockPitch: true };
      }

      const soprMidi = findNoteMidiAtTime(melEvents, Number(ev.t));
      const localRange = {
        min: baseRange.min,
        max: soprMidi !== null ? Math.min(baseRange.max, soprMidi - 1) : baseRange.max
      };
      if (localRange.max < localRange.min) {
        localRange.max = localRange.min;
      }

      const finalize = (midi: number) => {
        let nextMidi = midi;
        if (!allowRepeat && nextMidi === prevMidi && !forceChord) {
          const alt = chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
            maxLeap,
            warnings,
            context: `[rhythm] m${mNum} t=${ev.t}: alto repeat avoided; using alternate chord tone.`,
            avoidRepeat: true
          });
          if (typeof alt === "number") nextMidi = alt;
        }
        prevMidi = nextMidi;
        return { ...ev, midi: nextMidi, pitch: midiToPitch(nextMidi), lockPitch: true };
      };

      if (role === "arpUp" || role === "arpDown") {
        const stepDir: 1 | -1 = role === "arpUp" ? 1 : -1;
        const midi =
          ev.step === 0
            ? chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
                maxLeap,
                warnings,
                context: `[rhythm] m${mNum} t=${ev.t}: alto leap exceeded ${maxLeap} semitones; using closest chord tone.`,
                avoidRepeat: !allowRepeat
              })
            : chooseChordToneInDirection(chordPcs, prevMidi, localRange, stepDir, {
                maxLeap,
                warnings,
                context: `[rhythm] m${mNum} t=${ev.t}: alto leap exceeded ${maxLeap} semitones; using closest chord tone.`
              });
        return finalize(midi);
      }

      if (role === "passing") {
        const passDir: 1 | -1 = ev.dir === -1 ? -1 : 1;
        const midi = choosePassingMidi(prevMidi, scalePcs, localRange, passDir);
        return finalize(midi);
      }

      if (role === "neighbor" || role === "appoggiatura") {
        const dir: 1 | -1 = (mNum + Math.round(Number(ev.t) * 2)) % 2 === 0 ? 1 : -1;
        const midi = chooseNeighborMidi(prevMidi, scalePcs, localRange, dir);
        return finalize(midi);
      }

      if (role === "skip") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, localRange, 3, 5, prevMidi);
        return finalize(midi);
      }

      if (role === "leap") {
        const midi = chooseChordToneByInterval(chordPcs, prevMidi, localRange, 7, 9, prevMidi);
        return finalize(midi);
      }

      if (role === "anticipation") {
        const nextChord = pickChordForTime(
          chordEvents,
          Number(ev.t) + Number(ev.dur) < beatsPerMeasure ? mNum : mNum + 1,
          Number(ev.t) + Number(ev.dur) < beatsPerMeasure ? Number(ev.t) + Number(ev.dur) : 0
        );
        const nextParsed = nextChord ? parseChordSymbol(nextChord.symbol.split("/")[0] ?? nextChord.symbol) : null;
        const nextPcs = nextParsed?.pcs ?? chordPcs;
        const midi = chooseChordToneNearest(nextPcs, prevMidi, localRange, anchorMidi, {
          maxLeap,
          warnings,
          context: `[rhythm] m${mNum} t=${ev.t}: alto leap exceeded ${maxLeap} semitones; using closest chord tone.`,
          avoidRepeat: !allowRepeat
        });
        return finalize(midi);
      }

      if (role === "syncopation") {
        const offbeat = !isStrongBeat(Number(ev.t));
        const prevPc = ((prevMidi % 12) + 12) % 12;
        if (offbeat && chordPcs.includes(prevPc)) {
          return { ...ev, midi: prevMidi, pitch: midiToPitch(prevMidi), lockPitch: true };
        }
      }

      const midi = chooseChordToneNearest(chordPcs, prevMidi, localRange, anchorMidi, {
        maxLeap,
        warnings,
        context: `[rhythm] m${mNum} t=${ev.t}: alto leap exceeded ${maxLeap} semitones; using closest chord tone.`,
        avoidRepeat: !allowRepeat
      });
      return finalize(midi);
    });

    aPart.events = [...other, ...enriched].sort((a: any, bEv: any) => Number(a.t ?? 0) - Number(bEv.t ?? 0));
    applied.push(mNum);
  }

  if (applied.length) {
    warn(
      warnings,
      `[rhythm] Polyphonic alto counter-rhythm applied to ${applied.length} measure(s). First and last two measures follow melody rhythm.`
    );
  }

  return {
    applied: applied.length > 0,
    reason: applied.length ? "applied" : "no measures",
    style: "classical",
    detectedCadencePairs: [],
    appliedCadencePair: null,
    appliedMeasureNumbers: applied,
    chosenPlans: {},
    warnings
  };
}
