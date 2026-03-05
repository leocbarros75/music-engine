// src/harmonize/satb/harmonizeSatbFromChords.ts
import type { ScoreModel } from "../../score/types";
import { midiToPitch } from "../../instruments/instrumentCatalog";
import { inferChordsFromMelody } from "./inferChordsFromMelody";
import { repairVoicingForBeat } from "./repairVoicing";
import {
  orderingOk,
  repairVoicingForCrossingAndOverlap,
  resolvePolyphonicProfile,
  scorePolyphonicVoicing
} from "../../voiceleading/polyphonicRules";
import type { PolyphonicChordContext, PolyphonicProfile, VoiceRanges, VoiceState } from "../../voiceleading/types";

type ChordEvent = {
  measure: number;
  t: number;
  symbol: string; // e.g. "C", "F", "G7", "Am", "Dm7", "C/E"
};

type HarmonizeOptions = {
  keepMelodyInSoprano?: boolean;
  forceRootInBass?: boolean; // default true
  tenorRangeOverride?: Range;
  tenorMinOverride?: number;
  accompanimentType?: string;
  styleProfile?: string;
  modernMode?: string;
};

type VoiceName = "Soprano" | "Alto" | "Tenor" | "Bass";

type Range = { min: number; max: number };

// Sounding ranges (MIDI)
const RANGES: Record<VoiceName, Range> = {
  Soprano: { min: 60, max: 81 }, // C4..A5
  Alto: { min: 55, max: 74 }, // G3..D5
  Tenor: { min: 48, max: 69 }, // C3..A4 (dynamic max applied by soprano range)
  Bass: { min: 40, max: 64 } // E2..E4
};

function pc(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function clampInt(x: number, lo: number, hi: number): number {
  if (x < lo) return lo;
  if (x > hi) return hi;
  return x;
}

function motionDir(prev: number, next: number): -1 | 0 | 1 {
  if (next > prev) return 1;
  if (next < prev) return -1;
  return 0;
}

const LEAP_COMPENSATE_SEMITONES = new Set([5, 7, 8, 9]); // P4, P5, m6, M6

function shouldCompensateLeap(prev: number, next: number): boolean {
  return LEAP_COMPENSATE_SEMITONES.has(Math.abs(next - prev));
}

function isPerfectConsonance(intervalPc: number): boolean {
  // P8 (0), P5 (7).
  return intervalPc === 0 || intervalPc === 7;
}

function isParallelPerfect(params: {
  prevUpper: number;
  prevLower: number;
  nextUpper: number;
  nextLower: number;
}): boolean {
  const { prevUpper, prevLower, nextUpper, nextLower } = params;

  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);

  if (!isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;

  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);

  if (du === 0 || dl === 0) return false;
  if (du !== dl) return false;

  return true;
}

function isDirectPerfect(params: {
  prevUpper: number;
  prevLower: number;
  nextUpper: number;
  nextLower: number;
}): boolean {
  const { prevUpper, prevLower, nextUpper, nextLower } = params;

  const prevInt = pc(prevUpper - prevLower);
  const nextInt = pc(nextUpper - nextLower);

  if (isPerfectConsonance(prevInt)) return false;
  if (!isPerfectConsonance(nextInt)) return false;

  const du = motionDir(prevUpper, nextUpper);
  const dl = motionDir(prevLower, nextLower);

  if (du === 0 || dl === 0) return false;
  if (du !== dl) return false;

  return true;
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
  const k = String(fifths);
  return map[k] ?? 9;
}

function scalePcsFromKey(fifths: number, mode: "major" | "minor"): number[] {
  const tonicPc = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
  const intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map((i) => (tonicPc + i) % 12);
}

function findContraryStepMidi(
  prev: number,
  curr: number,
  scalePcs: number[],
  range: Range
): number | null {
  const dir = motionDir(prev, curr);
  if (dir === 0) return null;
  const stepDir = dir === 1 ? -1 : 1;
  for (let delta = 1; delta <= 2; delta++) {
    const cand = curr + stepDir * delta;
    if (cand < range.min || cand > range.max) continue;
    if (scalePcs.includes(pc(cand))) return cand;
  }
  return null;
}

function getKeyFifths(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = m0?.attributes?.key_fifths;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return fifths;
  return 0;
}

function getKeyMode(score: ScoreModel): "major" | "minor" {
  const m0 = score.parts?.[0]?.measures?.[0];
  const raw = String(m0?.attributes?.key_mode ?? "").toLowerCase();
  if (raw === "minor") return "minor";
  return "major";
}

type ParsedChord = {
  rootPc: number;
  pcs: number[];
  bassPcPref: number | null;
  rootSpelling: PitchSpelling | null;
  bassSpelling: PitchSpelling | null;
  hasSeventh: boolean;
  seventhPc: number | null;
};

type PitchSpelling = { step: string; alter: number };

function parseRootTokenWithSpelling(tok: string): { pc: number; spelling: PitchSpelling } | null {
  const m = tok.match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const base = STEP_TO_PC[step];
  if (typeof base !== "number") return null;
  const alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  const pcVal = (base + alter + 12) % 12;
  return { pc: pcVal, spelling: { step, alter } };
}

function chordPcsFromSymbol(symbol: string): ParsedChord | null {
  const s = symbol.trim();

  // Slash bass: "C/E"
  let main = s;
  let slashBass: string | null = null;
  if (s.includes("/")) {
    const parts = s.split("/");
    main = (parts[0] ?? "").trim();
    slashBass = (parts[1] ?? "").trim();
  }

  const m = main.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!m) return null;

  const rootTok = m[1]!;
  const qualTok = (m[2] ?? "").trim().toLowerCase();

  const rootInfo = parseRootTokenWithSpelling(rootTok);
  if (!rootInfo) return null;
  const rootPc = rootInfo.pc;
  const rootSpelling = rootInfo.spelling;

  const isMinorTriad =
    qualTok === "m" ||
    qualTok === "min" ||
    qualTok.startsWith("m7") ||
    qualTok.startsWith("min7");

  const isMaj7 = qualTok === "maj7" || qualTok === "ma7";
  const isMin7 = qualTok === "m7" || qualTok === "min7";
  const isDom7 = qualTok === "7" || (qualTok.endsWith("7") && !isMaj7 && !isMin7);

  const third = isMinorTriad ? 3 : 4;
  const fifth = 7;

  const pcs: number[] = [rootPc, (rootPc + third) % 12, (rootPc + fifth) % 12];

  let hasSeventh = false;
  let seventhPc: number | null = null;

  if (isMaj7) {
    hasSeventh = true;
    seventhPc = (rootPc + 11) % 12;
    pcs.push(seventhPc);
  } else if (isDom7 || isMin7) {
    hasSeventh = true;
    seventhPc = (rootPc + 10) % 12;
    pcs.push(seventhPc);
  }

  const bassInfo = slashBass ? parseRootTokenWithSpelling(slashBass) : null;
  const bassPcPref = bassInfo ? bassInfo.pc : null;
  const bassSpelling = bassInfo ? bassInfo.spelling : null;

  return {
    rootPc,
    pcs: Array.from(new Set(pcs)),
    bassPcPref,
    rootSpelling,
    bassSpelling,
    hasSeventh,
    seventhPc
  };
}

function midiCandidatesForPcInRange(pitchClass: number, range: Range): number[] {
  const out: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (pc(m) === pitchClass) out.push(m);
  }
  return out;
}

function bestByPenalty(cands: number[], penalty: (m: number) => number): number | null {
  if (!cands.length) return null;
  let best = cands[0]!;
  let bestP = penalty(best);
  for (let i = 1; i < cands.length; i++) {
    const m = cands[i]!;
    const p = penalty(m);
    if (p < bestP) {
      bestP = p;
      best = m;
    }
  }
  return best;
}

function rankVoiceCandidates(params: {
  chordPcs: number[];
  targetMidi: number;
  range: Range;
  belowMidi?: number;
  aboveMidi?: number;
  preferPc?: number | null;
  restrictToPreferPc?: boolean;
  avoidPcs?: number[];
  extraPenalty?: (candidateMidi: number) => number;
}): Array<{ midi: number; score: number }> {
  const {
    chordPcs,
    targetMidi,
    range,
    belowMidi,
    aboveMidi,
    preferPc,
    restrictToPreferPc,
    avoidPcs,
    extraPenalty
  } = params;

  let pcs = chordPcs.slice();
  if (preferPc !== null && preferPc !== undefined) {
    if (restrictToPreferPc) {
      pcs = [preferPc];
    } else {
      pcs = [preferPc, ...pcs.filter((x) => x !== preferPc)];
    }
  }

  const avoidSet = new Set<number>(avoidPcs ?? []);
  const allCands: number[] = [];
  for (const p of pcs) {
    if (avoidSet.has(p)) continue;
    allCands.push(...midiCandidatesForPcInRange(p, range));
  }

  const filtered = allCands.filter((m) => {
    if (belowMidi !== undefined && m >= belowMidi) return false;
    if (aboveMidi !== undefined && m <= aboveMidi) return false;
    return true;
  });

  if (!filtered.length) return [];

  const mid = (range.min + range.max) / 2;
  const scored = filtered.map((m) => {
    const dist = Math.abs(m - targetMidi);
    const center = Math.abs(m - mid) * 0.15;
    const prefer = preferPc !== null && preferPc !== undefined && pc(m) === preferPc ? -1.2 : 0;
    const extra = extraPenalty ? extraPenalty(m) : 0;
    return { midi: m, score: dist + center + prefer + extra };
  });

  scored.sort((a, b) => a.score - b.score);
  return scored;
}

function chooseVoiceNote(params: {
  voice: VoiceName;
  chordPcs: number[];
  targetMidi: number;
  range: Range;
  belowMidi?: number;
  aboveMidi?: number;
  preferPc?: number | null;
  restrictToPreferPc?: boolean;
  avoidPcs?: number[];
  extraPenalty?: (candidateMidi: number) => number;
}): number | null {
  const {
    chordPcs,
    targetMidi,
    range,
    belowMidi,
    aboveMidi,
    preferPc,
    restrictToPreferPc,
    avoidPcs,
    extraPenalty
  } = params;

  let pcs = chordPcs.slice();
  if (preferPc !== null && preferPc !== undefined) {
    if (restrictToPreferPc) {
      pcs = [preferPc];
    } else {
      pcs = [preferPc, ...pcs.filter((x) => x !== preferPc)];
    }
  }

  const avoidSet = new Set<number>(avoidPcs ?? []);

  const allCands: number[] = [];
  for (const p of pcs) {
    if (avoidSet.has(p)) continue;
    allCands.push(...midiCandidatesForPcInRange(p, range));
  }

  const filtered = allCands.filter((m) => {
    if (belowMidi !== undefined && m >= belowMidi) return false;
    if (aboveMidi !== undefined && m <= aboveMidi) return false;
    return true;
  });

  if (!filtered.length) return null;

  const mid = (range.min + range.max) / 2;
  return bestByPenalty(filtered, (m) => {
    const dist = Math.abs(m - targetMidi);
    const center = Math.abs(m - mid) * 0.15;
    const prefer = preferPc !== null && preferPc !== undefined && pc(m) === preferPc ? -1.2 : 0;
    const extra = extraPenalty ? extraPenalty(m) : 0;
    return dist + center + prefer + extra;
  });
}

function getScoreBeatsPerMeasure(score: ScoreModel): number {
  const m0 = score.parts?.[0]?.measures?.[0];
  const beats = m0?.attributes?.time?.beats;
  if (typeof beats === "number" && beats > 0) return beats;
  return 4;
}

function getSopranoMidiRange(score: ScoreModel, soprPart: any): { min: number; max: number } {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const m of soprPart?.measures ?? []) {
    for (const ev of m?.events ?? []) {
      if (ev?.type !== "note") continue;
      const midi = typeof ev.midi === "number" ? ev.midi : null;
      if (midi === null) continue;
      if (midi < min) min = midi;
      if (midi > max) max = midi;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: 60, max: 81 };
  }
  return { min, max };
}

function tenorRangeForSoprano(sopranoRange: { min: number; max: number }): Range {
  // If soprano is high (B4..G5), keep tenor top lower (E4).
  if (sopranoRange.max >= 71) {
    return { min: RANGES.Tenor.min, max: 64 }; // E4
  }
  // If soprano is low (C4..A4), keep tenor top at A3.
  if (sopranoRange.max <= 69) {
    return { min: RANGES.Tenor.min, max: 57 }; // A3
  }
  return { ...RANGES.Tenor };
}

function buildChordMap(chords: ChordEvent[]): Map<string, ChordEvent> {
  const map = new Map<string, ChordEvent>();
  for (const c of chords) map.set(`${c.measure}:${c.t}`, c);
  return map;
}

function getSopranoSource(score: ScoreModel): { partIndex: number; part: any } | null {
  const parts = score.parts ?? [];
  if (!parts.length) return null;
  for (let i = 0; i < parts.length; i++) {
    const name = String(parts[i]?.name ?? "").toLowerCase();
    if (name.includes("soprano") || name.includes("melody") || name.includes("voice")) {
      return { partIndex: i, part: parts[i] };
    }
  }
  let bestIndex = -1;
  let bestAvg = -Infinity;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const midis: number[] = [];
    for (const m of part?.measures ?? []) {
      for (const e of m?.events ?? []) {
        if (!e || e.type !== "note") continue;
        const midi = eventMidi(e);
        if (typeof midi === "number") midis.push(midi);
      }
    }
    if (!midis.length) continue;
    const avg = midis.reduce((a, b) => a + b, 0) / midis.length;
    if (avg > bestAvg) {
      bestAvg = avg;
      bestIndex = i;
    }
  }
  if (bestIndex >= 0) return { partIndex: bestIndex, part: parts[bestIndex] };
  return parts[0] ? { partIndex: 0, part: parts[0] } : null;
}

function makeEmptyPart(part_id: string, name: string, measuresTemplate: any[]): any {
  return {
    part_id,
    name,
    measures: measuresTemplate.map((m) => ({
      number: m.number,
      attributes: m.attributes ? { ...m.attributes } : undefined,
      events: []
    }))
  };
}

function ensureMeasureAttributesOnlyOnFirst(part: any): void {
  const ms = part.measures ?? [];
  for (let i = 0; i < ms.length; i++) {
    if (i === 0) continue;
    if (ms[i]?.attributes) delete ms[i].attributes;
  }
}

function addNoteEvent(measure: any, t: number, dur: number, midi: number, pitchOverride?: PitchSpelling | null): void {
  const base = pitchWithSpelling(midi, pitchOverride);
  measure.events.push({
    type: "note",
    t,
    dur,
    pitch: base,
    midi
  });
}

function pitchWithSpelling(midi: number, spelling: PitchSpelling | null | undefined) {
  const base = midiToPitch(midi);
  if (!spelling) return base;
  const basePc = pc(midi);
  const targetPc = (STEP_TO_PC[spelling.step] + (spelling.alter ?? 0) + 12) % 12;
  if (basePc !== targetPc) return base;
  return { step: spelling.step, alter: spelling.alter, octave: base.octave };
}

function pcFromSpelling(spelling: PitchSpelling): number {
  return (STEP_TO_PC[spelling.step] + (spelling.alter ?? 0) + 12) % 12;
}

function addRestEvent(measure: any, t: number, dur: number): void {
  measure.events.push({
    type: "rest",
    t,
    dur
  });
}

type PendingResolution = {
  voice: "Alto" | "Tenor";
  toPc: number;
  atMeasure: number;
  atT: number;
};

type PendingLeap = {
  voice: VoiceName;
  targetMidi: number;
  atMeasure: number;
  atT: number;
};

function pickChordForBeat(chordMap: Map<string, ChordEvent>, measureNumber: number, t: number): ChordEvent | null {
  // Prefer exact match at this beat, else fall back to beat 0 for the measure.
  return chordMap.get(`${measureNumber}:${t}`) ?? chordMap.get(`${measureNumber}:0`) ?? null;
}

function nextBeatPosition(params: {
  measureNumber: number;
  t: number;
  lastBeat: number;
  nextMeasureNumber: number;
  lastMeasureNumber: number;
}): { measure: number; t: number } | null {
  const { measureNumber, t, lastBeat, nextMeasureNumber, lastMeasureNumber } = params;
  if (t < lastBeat) return { measure: measureNumber, t: t + 1 };
  if (measureNumber < lastMeasureNumber) return { measure: nextMeasureNumber, t: 0 };
  return null;
}

function consumePendingLeap(
  pending: PendingLeap[],
  voice: VoiceName,
  measureNumber: number,
  t: number
): number | null {
  const idx = pending.findIndex((p) => p.voice === voice && p.atMeasure === measureNumber && p.atT === t);
  if (idx < 0) return null;
  const item = pending[idx];
  pending.splice(idx, 1);
  return item?.targetMidi ?? null;
}

function scheduleLeapCompensation(params: {
  pending: PendingLeap[];
  voice: VoiceName;
  prevMidi: number | null;
  currMidi: number | null;
  scalePcs: number[];
  range: Range;
  nextPos: { measure: number; t: number } | null;
  measureNumber: number;
  t: number;
  warnings: string[];
}): void {
  const { pending, voice, prevMidi, currMidi, scalePcs, range, nextPos, measureNumber, t, warnings } = params;
  if (!nextPos) return;
  if (prevMidi === null || currMidi === null) return;
  if (!shouldCompensateLeap(prevMidi, currMidi)) return;

  const target = findContraryStepMidi(prevMidi, currMidi, scalePcs, range);
  if (target === null) {
    warnings.push(
      `[leap] WARN m${measureNumber} t${t}: ${voice} leap ${prevMidi}->${currMidi} could not find diatonic contrary step within range.`
    );
    return;
  }

  pending.push({ voice, targetMidi: target, atMeasure: nextPos.measure, atT: nextPos.t });
}

function applyPendingLeapTarget(params: {
  voice: VoiceName;
  targetMidi: number | null;
  soprMidi: number;
  altoMidi: number;
  tenorMidi: number;
  bassMidi: number;
  warnings: string[];
  measureNumber: number;
  t: number;
}): { soprMidi: number; altoMidi: number; tenorMidi: number; bassMidi: number } {
  const { voice, targetMidi, soprMidi, altoMidi, tenorMidi, bassMidi, warnings, measureNumber, t } = params;
  if (targetMidi === null) return { soprMidi, altoMidi, tenorMidi, bassMidi };

  const state = { S: soprMidi, A: altoMidi, T: tenorMidi, B: bassMidi };
  if (voice === "Soprano") state.S = targetMidi;
  if (voice === "Alto") state.A = targetMidi;
  if (voice === "Tenor") state.T = targetMidi;
  if (voice === "Bass") state.B = targetMidi;

  if (!orderingOk(state, true)) {
    warnings.push(
      `[leap] WARN m${measureNumber} t${t}: ${voice} contrary step ${targetMidi} rejected due to ordering.`
    );
    return { soprMidi, altoMidi, tenorMidi, bassMidi };
  }

  return { soprMidi: state.S, altoMidi: state.A, tenorMidi: state.T, bassMidi: state.B };
}

function collectChordMidis(pcs: number[], range: Range): number[] {
  const out: number[] = [];
  for (const p of pcs) {
    out.push(...midiCandidatesForPcInRange(p, range));
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

const TENOR_BASS_ALLOWED_INTERVALS = [7, 8, 9, 10, 11, 12];
const ALTO_TENOR_ALLOWED_INTERVALS = [0, 1, 2, 3, 4, 5];

function intervalPenalty(interval: number, allowed: number[], weight: number): number {
  if (interval < 0) return weight * 2;
  if (allowed.includes(interval)) return 0;
  let minDiff = Number.POSITIVE_INFINITY;
  for (const a of allowed) {
    const diff = Math.abs(interval - a);
    if (diff < minDiff) minDiff = diff;
  }
  if (!Number.isFinite(minDiff)) return weight;
  return weight * (1 + minDiff * 0.6);
}

function refineInnerVoices(params: {
  chordPcs: number[];
  soprMidi: number;
  bassMidi: number;
  tenorTarget: number;
  altoTarget: number;
  tenorRange: Range;
  altoRange: Range;
  allowUnisonD4: boolean;
}): { tenor: number; alto: number } | null {
  const {
    chordPcs,
    soprMidi,
    bassMidi,
    tenorTarget,
    altoTarget,
    tenorRange,
    altoRange,
    allowUnisonD4
  } = params;

  const tenorCands = collectChordMidis(chordPcs, tenorRange);
  const altoCands = collectChordMidis(chordPcs, altoRange);
  if (!tenorCands.length || !altoCands.length) return null;

  const soprPc = pc(soprMidi);
  const bassPc = pc(bassMidi);

  let best: { tenor: number; alto: number; score: number } | null = null;
  for (const t of tenorCands) {
    for (const a of altoCands) {
      if (a >= soprMidi) continue;
      let score = 0;
      score += Math.abs(t - tenorTarget) * 0.6;
      score += Math.abs(a - altoTarget) * 0.6;
      if (pc(t) === soprPc) score += 5;
      if (pc(a) === soprPc) score += 5;
      if (pc(t) === bassPc) score += 3;
      if (pc(a) === bassPc) score += 3;

      const tb = t - bassMidi;
      const at = a - t;
      if (tb > 0) score += intervalPenalty(tb, TENOR_BASS_ALLOWED_INTERVALS, 4);
      if (at >= 0) score += intervalPenalty(at, ALTO_TENOR_ALLOWED_INTERVALS, 3.5);

      if (t >= a) {
        if (allowUnisonD4 && t === a && t === 62) {
          score += 0.5;
        } else {
          score += 4;
        }
      }

      if (pc(t) === pc(a) && !(allowUnisonD4 && t === a && t === 62)) {
        score += 4;
      }

      if (!best || score < best.score) best = { tenor: t, alto: a, score };
    }
  }

  if (!best) return null;
  return { tenor: best.tenor, alto: best.alto };
}

function buildCandidateMap(
  ranked: Array<{ midi: number; score: number }>,
  limit: number
): { list: number[]; scoreByMidi: Map<number, number> } {
  const trimmed = ranked.slice(0, limit);
  const list = trimmed.map((c) => c.midi);
  const scoreByMidi = new Map<number, number>();
  for (const c of trimmed) scoreByMidi.set(c.midi, c.score);
  return { list, scoreByMidi };
}

function selectPolyphonicVoicing(params: {
  chordPcs: number[];
  chordRootPc: number;
  chordSeventhPc: number | null;
  soprMidi: number;
  bassPcPref: number | null;
  lockBassToPref: boolean;
  ranges: VoiceRanges;
  targets: { bassTarget: number; tenorTarget: number; altoTarget: number };
  prev: VoiceState | null;
  profile: PolyphonicProfile;
  keyPc: number | null;
  keyMode: "major" | "minor";
  prevChordCtx: PolyphonicChordContext | null;
  allowUnisonD4: boolean;
  measureNumber: number;
  t: number;
}): { bassMidi: number; tenorMidi: number; altoMidi: number; warnings: string[] } {
  const {
    chordPcs,
    chordRootPc,
    chordSeventhPc,
    soprMidi,
    bassPcPref,
    lockBassToPref,
    ranges,
    targets,
    prev,
    profile,
    keyPc,
    keyMode,
    prevChordCtx,
    allowUnisonD4,
    measureNumber,
    t
  } = params;

  const warnings: string[] = [];

  const bassRanked = rankVoiceCandidates({
    chordPcs,
    targetMidi: targets.bassTarget,
    range: ranges.B,
    preferPc: bassPcPref,
    restrictToPreferPc: lockBassToPref
  });

  const tenorRanked = rankVoiceCandidates({
    chordPcs,
    targetMidi: targets.tenorTarget,
    range: ranges.T
  });

  const altoRanked = rankVoiceCandidates({
    chordPcs,
    targetMidi: targets.altoTarget,
    range: ranges.A,
    belowMidi: soprMidi
  });

  const N = 6;
  const bassMap = buildCandidateMap(bassRanked, N);
  const tenorMap = buildCandidateMap(tenorRanked, N);
  const altoMap = buildCandidateMap(altoRanked, N);

  let bassList = bassMap.list;
  let tenorList = tenorMap.list;
  let altoList = altoMap.list;

  if (!bassList.length) {
    if (lockBassToPref && bassPcPref !== null) {
      bassList = midiCandidatesForPcInRange(bassPcPref, ranges.B);
      if (!bassList.length) {
        bassList = collectChordMidis(chordPcs, ranges.B);
        warnings.push(
          `[poly] WARN m${measureNumber} t=${t}: slash bass out of range, relaxed to chord tones.`
        );
      }
    } else {
      bassList = collectChordMidis(chordPcs, ranges.B);
    }
  }
  if (!tenorList.length) tenorList = collectChordMidis(chordPcs, ranges.T);
  if (!altoList.length) altoList = collectChordMidis(chordPcs, ranges.A);

  const chordCtx: PolyphonicChordContext = {
    pcs: chordPcs,
    rootPc: chordRootPc,
    seventhPc: chordSeventhPc
  };

  let best: { bass: number; tenor: number; alto: number; score: number } | null = null;
  for (const b of bassList) {
    for (const tMidi of tenorList) {
      for (const a of altoList) {
        if (a >= soprMidi) continue;
        const candidate: VoiceState = { S: soprMidi, A: a, T: tMidi, B: b };
        if (!orderingOk(candidate, allowUnisonD4)) continue;

        const scoreResult = scorePolyphonicVoicing({
          prev,
          next: candidate,
          ranges,
          profile,
          keyPc,
          keyMode,
          chord: chordCtx,
          prevChord: prevChordCtx
        });

        const baseScore =
          (bassMap.scoreByMidi.get(b) ?? 0) +
          (tenorMap.scoreByMidi.get(tMidi) ?? 0) +
          (altoMap.scoreByMidi.get(a) ?? 0);

        const total = scoreResult.score + baseScore;
        if (!best || total < best.score) best = { bass: b, tenor: tMidi, alto: a, score: total };
      }
    }
  }

  if (best) {
    const candidate: VoiceState = { S: soprMidi, A: best.alto, T: best.tenor, B: best.bass };
    const spacingViolation = candidate.S - candidate.A > 12 || candidate.A - candidate.T > 12;
    const overlapViolation =
      prev &&
      (candidate.A > prev.S ||
        candidate.S < prev.A ||
        candidate.T > prev.A ||
        candidate.A < prev.T ||
        candidate.B > prev.T ||
        candidate.T < prev.B);

    if (spacingViolation || overlapViolation) {
      const repaired = repairVoicingForCrossingAndOverlap({
        prev,
        proposed: candidate,
        chordPcs,
        ranges,
        profile,
        keyPc,
        keyMode,
        chord: chordCtx,
        prevChord: prevChordCtx,
        allowUnisonD4,
        bassPreferPc: bassPcPref,
        lockBassToPrefer: lockBassToPref
      });
      warnings.push(...repaired.warnings.map((w) => `[poly] WARN m${measureNumber} t${t}: ${w.replace(/^\[poly\]\s*WARN\s*/i, "")}`));
      return {
        bassMidi: repaired.state.B,
        tenorMidi: repaired.state.T,
        altoMidi: repaired.state.A,
        warnings
      };
    }

    return { bassMidi: best.bass, tenorMidi: best.tenor, altoMidi: best.alto, warnings };
  }

  const proposed: VoiceState = {
    S: soprMidi,
    A: altoList[0] ?? clampInt(soprMidi - 5, ranges.A.min, ranges.A.max),
    T: tenorList[0] ?? clampInt(soprMidi - 12, ranges.T.min, ranges.T.max),
    B: bassList[0] ?? clampInt(soprMidi - 24, ranges.B.min, ranges.B.max)
  };

  const repaired = repairVoicingForCrossingAndOverlap({
    prev,
    proposed,
    chordPcs,
    ranges,
    profile,
    keyPc,
    keyMode,
    chord: chordCtx,
    prevChord: prevChordCtx,
    allowUnisonD4,
    bassPreferPc: bassPcPref,
    lockBassToPrefer: lockBassToPref
  });

  warnings.push(...repaired.warnings.map((w) => `[poly] WARN m${measureNumber} t${t}: ${w.replace(/^\[poly\]\s*WARN\s*/i, "")}`));

  return {
    bassMidi: repaired.state.B,
    tenorMidi: repaired.state.T,
    altoMidi: repaired.state.A,
    warnings
  };
}

export function harmonizeSatbFromChords(
  inScore: ScoreModel,
  chords: ChordEvent[],
  optionsIn?: HarmonizeOptions
): ScoreModel {
  const options: HarmonizeOptions = optionsIn ?? {};
  const keepMelody = options.keepMelodyInSoprano !== false;
  const forceRootInBass = options.forceRootInBass !== false;
  const accompanimentType = String(options.accompanimentType ?? (options as any).accompaniment ?? "").toLowerCase();
  const usePolyphonic = accompanimentType === "polyphonic";
  const polyProfile = resolvePolyphonicProfile(options.styleProfile, options.modernMode);

  const beatsPerMeasure = getScoreBeatsPerMeasure(inScore);
  const lastBeat = Math.max(0, beatsPerMeasure - 1);

  const soprSrc = getSopranoSource(inScore);
  if (!soprSrc) {
    return {
      ...(inScore as any),
      meta: { ...(inScore as any).meta, ensemble: "satb" } as any,
      parts: []
    } as any;
  }

  const soprPart = soprSrc.part;
  const soprRange = getSopranoMidiRange(inScore, soprPart);
  const tenorRange = options.tenorRangeOverride ?? tenorRangeForSoprano(soprRange);
  if (typeof options.tenorMinOverride === "number" && Number.isFinite(options.tenorMinOverride)) {
    tenorRange.min = Math.max(tenorRange.min, Math.round(options.tenorMinOverride));
    if (tenorRange.min > tenorRange.max) tenorRange.min = tenorRange.max;
  }
  const measuresTemplate = (soprPart.measures ?? []).map((m: any) => ({
    number: m.number,
    attributes: m.attributes ? { ...m.attributes } : undefined
  }));
  const polyRanges: VoiceRanges = {
    S: { min: soprRange.min, max: soprRange.max },
    A: RANGES.Alto,
    T: tenorRange,
    B: RANGES.Bass
  };

  const lastMeasureNumber = Number(measuresTemplate[measuresTemplate.length - 1]?.number ?? measuresTemplate.length);

  const outS = makeEmptyPart("P_S", "Soprano", measuresTemplate);
  const outA = makeEmptyPart("P_A", "Alto", measuresTemplate);
  const outT = makeEmptyPart("P_T", "Tenor", measuresTemplate);
  const outB = makeEmptyPart("P_B", "Bass", measuresTemplate);

  const inputChordCount = (chords ?? []).length;
  const usedInference = inputChordCount === 0;

  // If chords are empty, infer them from melody.
  const safeChords = inputChordCount ? (chords ?? []) : inferChordsFromMelody(inScore);
  const chordMap = buildChordMap(safeChords);

  // For final-cadence Bass enforcement: determine tonic PC (major, key_fifths)
  const keyFifths = getKeyFifths(inScore);
  const keyMode = getKeyMode(inScore);
  const tonicPc = keyMode === "minor" ? tonicPcFromFifthsMinor(keyFifths) : tonicPcFromFifthsMajor(keyFifths);
  const scalePcs = scalePcsFromKey(keyFifths, keyMode);

  if (keepMelody) {
    for (let mi = 0; mi < measuresTemplate.length; mi++) {
      const srcM = soprPart.measures?.[mi];
      const dstM = outS.measures?.[mi];
      if (!dstM) continue;

      const srcEvents = (srcM?.events ?? []).filter((e: any) => e?.type === "note" || e?.type === "rest");
      for (const e of srcEvents) dstM.events.push({ ...e });
    }
  }

  let prevS: number | null = null;
  let prevA: number | null = null;
  let prevT: number | null = null;
  let prevB: number | null = null;
  let prevChordCtx: PolyphonicChordContext | null = null;
  const repairWarnings: string[] = [];

  let pending: PendingResolution | null = null;
  const pendingLeaps: PendingLeap[] = [];

  for (let mi = 0; mi < measuresTemplate.length; mi++) {
    const measureNumber = Number(measuresTemplate[mi]?.number ?? mi + 1);

    const mS = outS.measures?.[mi];
    const mA = outA.measures?.[mi];
    const mT = outT.measures?.[mi];
    const mB = outB.measures?.[mi];
    if (!mS || !mA || !mT || !mB) continue;

    const nextMeasureNumber = Number(measuresTemplate[mi + 1]?.number ?? (measureNumber + 1));

    for (let t = 0; t < beatsPerMeasure; t++) {
      const chordEv = pickChordForBeat(chordMap, measureNumber, t);
      const parsed = chordEv ? chordPcsFromSymbol(chordEv.symbol) : null;

      const nextChordEv = chordMap.get(`${nextMeasureNumber}:0`);
      const parsedNext = nextChordEv ? chordPcsFromSymbol(nextChordEv.symbol) : null;

      if (!parsed) {
        addRestEvent(mA, t, 1);
        addRestEvent(mT, t, 1);
        addRestEvent(mB, t, 1);
        continue;
      }

      const chordPcs = parsed.pcs;
      const rootPc = parsed.rootPc;

      const isFinalMeasure = measureNumber === lastMeasureNumber;
      const isFinalTonicI = isFinalMeasure && pc(rootPc) === pc(tonicPc);

      const hasSlashBass = parsed.bassPcPref !== null;
      // Prefer bass from slash if given; else (by default) prefer root
      let bassPcPref =
        parsed.bassPcPref !== null ? parsed.bassPcPref : forceRootInBass ? rootPc : null;

      // Hard rule: on the final I (cadence resolution), force Bass to root at t=0
      // unless a slash bass is explicitly provided.
      if (isFinalTonicI && t === 0 && !hasSlashBass) {
        bassPcPref = rootPc;
      }
      const lockBassToPref = hasSlashBass || forceRootInBass;
      let bassPitchSpelling = lockBassToPref ? parsed.bassSpelling ?? parsed.rootSpelling : null;

      let soprMidi: number | null = null;
      const sEv = (mS.events ?? []).find((e: any) => e?.type === "note" && Number(e.t) === t);
      if (sEv?.midi !== undefined) soprMidi = Number(sEv.midi);

      if (soprMidi === null) {
        addRestEvent(mA, t, 1);
        addRestEvent(mT, t, 1);
        addRestEvent(mB, t, 1);
        continue;
      }

      let bassMidi: number | null = null;
      let tenorMidi: number | null = null;
      let altoMidi: number | null = null;

      if (usePolyphonic) {
        const bassTarget = prevB ?? 48;
        const tenorTarget = prevT ?? clampInt(bassTarget + 12, tenorRange.min, tenorRange.max);
        const altoTarget = prevA ?? clampInt(soprMidi - 5, RANGES.Alto.min, RANGES.Alto.max);

        const polyResult = selectPolyphonicVoicing({
          chordPcs,
          chordRootPc: rootPc,
          chordSeventhPc: parsed.seventhPc ?? null,
          soprMidi,
          bassPcPref,
          lockBassToPref,
          ranges: polyRanges,
          targets: { bassTarget, tenorTarget, altoTarget },
          prev: prevS !== null && prevA !== null && prevT !== null && prevB !== null ? { S: prevS, A: prevA, T: prevT, B: prevB } : null,
          profile: polyProfile,
          keyPc: tonicPc,
          keyMode,
          prevChordCtx,
          allowUnisonD4: true,
          measureNumber,
          t
        });

        bassMidi = polyResult.bassMidi;
        tenorMidi = polyResult.tenorMidi;
        altoMidi = polyResult.altoMidi;
        if (polyResult.warnings.length) {
          for (const w of polyResult.warnings) {
            // eslint-disable-next-line no-console
            console.warn(w);
            repairWarnings.push(w);
          }
        }
      } else {
        const forceTenorPc =
          pending && pending.voice === "Tenor" && pending.atMeasure === measureNumber && pending.atT === t
            ? pending.toPc
            : null;

        const forceAltoPc =
          pending && pending.voice === "Alto" && pending.atMeasure === measureNumber && pending.atT === t
            ? pending.toPc
            : null;

        if (pending && pending.atMeasure === measureNumber && pending.atT === t) {
          pending = null;
        }

        const bassTarget = prevB ?? 48;

        const bassExtraPenalty = (candB: number): number => {
          let pen = 0;

          // Avoid parallels/direct perfects with Soprano
          if (prevS !== null && prevB !== null) {
            const pPenalty = isParallelPerfect({
              prevUpper: prevS,
              prevLower: prevB,
              nextUpper: soprMidi!,
              nextLower: candB
            })
              ? 50
              : 0;

            const dPenalty = isDirectPerfect({
              prevUpper: prevS,
              prevLower: prevB,
              nextUpper: soprMidi!,
              nextLower: candB
            })
              ? 20
              : 0;

            pen += pPenalty + dPenalty;
          }

          // Hard cadence rule: final I at t=0 must be Bass root
          if (isFinalTonicI && t === 0) {
            if (pc(candB) !== pc(rootPc)) pen += 10_000;
          }

          return pen;
        };

        bassMidi =
          chooseVoiceNote({
            voice: "Bass",
            chordPcs,
            targetMidi: bassTarget,
            range: RANGES.Bass,
            belowMidi: soprMidi,
            preferPc: bassPcPref,
            restrictToPreferPc: lockBassToPref,
            extraPenalty: bassExtraPenalty
          }) ??
          (hasSlashBass
            ? null
            : chooseVoiceNote({
                voice: "Bass",
                chordPcs,
                targetMidi: bassTarget,
                range: RANGES.Bass,
                preferPc: bassPcPref,
                restrictToPreferPc: false,
                extraPenalty: bassExtraPenalty
              }));
        if (bassMidi === null && hasSlashBass) {
          const relaxed = chooseVoiceNote({
            voice: "Bass",
            chordPcs,
            targetMidi: bassTarget,
            range: RANGES.Bass,
            preferPc: bassPcPref,
            restrictToPreferPc: false,
            extraPenalty: bassExtraPenalty
          });
          if (relaxed !== null) {
            bassMidi = relaxed;
            bassPitchSpelling = null;
            // eslint-disable-next-line no-console
            console.warn(
              `[warn] [chord] Slash bass "${chordEv?.symbol ?? ""}" out of range at m${measureNumber} t=${t}; relaxed to chord tone.`
            );
          }
        }

        const chordHas7 = parsed.hasSeventh && parsed.seventhPc !== null;
        const seventhPc = parsed.seventhPc;

        const soprIs7 = chordHas7 && seventhPc !== null ? pc(soprMidi) === seventhPc : false;

        const resolutionPc = chordHas7 && seventhPc !== null ? (seventhPc + 11) % 12 : null;

        const canForceResolution =
          chordHas7 &&
          seventhPc !== null &&
          resolutionPc !== null &&
          parsedNext &&
          parsedNext.pcs.includes(resolutionPc);

        const shouldPlace7Now = chordHas7 && seventhPc !== null && t === lastBeat;
        const avoid7Early = chordHas7 && seventhPc !== null && t !== lastBeat ? [seventhPc] : [];

        const tenorTarget = prevT ?? clampInt((bassMidi ?? bassTarget) + 12, RANGES.Tenor.min, RANGES.Tenor.max);

        const tenorPreferPc =
          forceTenorPc !== null ? forceTenorPc : shouldPlace7Now && !soprIs7 ? seventhPc : null;

        const tenorAvoid: number[] = [];
        tenorAvoid.push(...avoid7Early);

        const tenorExtraPenalty = (candT: number): number => {
          let pen = 0;

          if (bassMidi !== null && prevT !== null && prevB !== null) {
            if (
              isParallelPerfect({
                prevUpper: prevT,
                prevLower: prevB,
                nextUpper: candT,
                nextLower: bassMidi
              })
            )
              pen += 40;
            if (
              isDirectPerfect({
                prevUpper: prevT,
                prevLower: prevB,
                nextUpper: candT,
                nextLower: bassMidi
              })
            )
              pen += 15;
          }

          if (prevT !== null && prevS !== null) {
            if (
              isParallelPerfect({
                prevUpper: prevS,
                prevLower: prevT,
                nextUpper: soprMidi!,
                nextLower: candT
              })
            )
              pen += 40;
            if (
              isDirectPerfect({
                prevUpper: prevS,
                prevLower: prevT,
                nextUpper: soprMidi!,
                nextLower: candT
              })
            )
              pen += 15;
          }

          return pen;
        };

        tenorMidi =
          chooseVoiceNote({
            voice: "Tenor",
            chordPcs,
            targetMidi: tenorTarget,
            range: tenorRange,
            aboveMidi: bassMidi ?? bassTarget,
            preferPc: tenorPreferPc,
            avoidPcs: tenorAvoid,
            extraPenalty: tenorExtraPenalty
          }) ??
          chooseVoiceNote({
            voice: "Tenor",
            chordPcs,
            targetMidi: tenorTarget,
            range: tenorRange,
            aboveMidi: bassMidi ?? bassTarget,
            avoidPcs: tenorAvoid,
            extraPenalty: tenorExtraPenalty
          });

        const altoTarget = prevA ?? clampInt(soprMidi - 5, RANGES.Alto.min, RANGES.Alto.max);
        const altoCeil = soprMidi - 1;

        const tenorTook7 =
          chordHas7 && seventhPc !== null && tenorMidi !== null ? pc(tenorMidi) === seventhPc : false;

        const altoPreferPc =
          forceAltoPc !== null ? forceAltoPc : shouldPlace7Now && !soprIs7 && !tenorTook7 ? seventhPc : null;

        const altoAvoid: number[] = [];
        altoAvoid.push(...avoid7Early);
        if (chordHas7 && seventhPc !== null && tenorTook7) altoAvoid.push(seventhPc);

        const altoExtraPenalty = (candA: number): number => {
          let pen = 0;

          if (tenorMidi !== null && prevA !== null && prevT !== null) {
            if (
              isParallelPerfect({
                prevUpper: prevA,
                prevLower: prevT,
                nextUpper: candA,
                nextLower: tenorMidi
              })
            )
              pen += 35;
            if (
              isDirectPerfect({
                prevUpper: prevA,
                prevLower: prevT,
                nextUpper: candA,
                nextLower: tenorMidi
              })
            )
              pen += 12;
          }

          if (bassMidi !== null && prevA !== null && prevB !== null) {
            if (
              isParallelPerfect({
                prevUpper: prevA,
                prevLower: prevB,
                nextUpper: candA,
                nextLower: bassMidi
              })
            )
              pen += 35;
            if (
              isDirectPerfect({
                prevUpper: prevA,
                prevLower: prevB,
                nextUpper: candA,
                nextLower: bassMidi
              })
            )
              pen += 12;
          }

          if (prevA !== null && prevS !== null) {
            if (
              isParallelPerfect({
                prevUpper: prevS,
                prevLower: prevA,
                nextUpper: soprMidi!,
                nextLower: candA
              })
            )
              pen += 35;
            if (
              isDirectPerfect({
                prevUpper: prevS,
                prevLower: prevA,
                nextUpper: soprMidi!,
                nextLower: candA
              })
            )
              pen += 12;
          }

          return pen;
        };

        altoMidi =
          chooseVoiceNote({
            voice: "Alto",
            chordPcs,
            targetMidi: altoTarget,
            range: RANGES.Alto,
            belowMidi: altoCeil,
            preferPc: altoPreferPc,
            avoidPcs: altoAvoid,
            extraPenalty: altoExtraPenalty
          }) ?? null;

        if (altoMidi === null) {
          const tenorBelow = soprMidi - 4;
          const tenorLowerTarget = clampInt((tenorMidi ?? tenorTarget) - 7, RANGES.Tenor.min, RANGES.Tenor.max);

          const altTenor =
            chooseVoiceNote({
              voice: "Tenor",
              chordPcs,
              targetMidi: tenorLowerTarget,
              range: tenorRange,
              aboveMidi: bassMidi ?? bassTarget,
              belowMidi: tenorBelow,
              preferPc: tenorPreferPc,
              avoidPcs: tenorAvoid,
              extraPenalty: tenorExtraPenalty
            }) ??
            chooseVoiceNote({
              voice: "Tenor",
              chordPcs,
              targetMidi: tenorLowerTarget,
              range: tenorRange,
              aboveMidi: bassMidi ?? bassTarget,
              belowMidi: tenorBelow,
              avoidPcs: tenorAvoid,
              extraPenalty: tenorExtraPenalty
            });

          if (altTenor !== null) {
            tenorMidi = altTenor;

            altoMidi =
              chooseVoiceNote({
                voice: "Alto",
                chordPcs,
                targetMidi: altoTarget,
                range: RANGES.Alto,
                belowMidi: altoCeil,
                preferPc: altoPreferPc,
                avoidPcs: altoAvoid,
                extraPenalty: altoExtraPenalty
              }) ?? null;
          }
        }

        if (altoMidi !== null && soprMidi - altoMidi > 12) {
          const forcedTarget = soprMidi - 7;
          const alt2 =
            chooseVoiceNote({
              voice: "Alto",
              chordPcs,
              targetMidi: forcedTarget,
              range: RANGES.Alto,
              belowMidi: altoCeil,
              preferPc: altoPreferPc,
              avoidPcs: altoAvoid,
              extraPenalty: altoExtraPenalty
            }) ?? null;
          if (alt2 !== null) altoMidi = alt2;
        }

        if (altoMidi === null) {
          const tenorCandidates = rankVoiceCandidates({
            chordPcs,
            targetMidi: tenorTarget,
            range: tenorRange,
            aboveMidi: bassMidi ?? bassTarget,
            preferPc: tenorPreferPc,
            avoidPcs: tenorAvoid,
            extraPenalty: tenorExtraPenalty
          });

          let bestPair: { tenor: number; alto: number; score: number } | null = null;

          for (const cand of tenorCandidates.slice(0, 24)) {
            const candTenor = cand.midi;
            const candAlto =
              chooseVoiceNote({
                voice: "Alto",
                chordPcs,
                targetMidi: altoTarget,
                range: RANGES.Alto,
                belowMidi: altoCeil,
                preferPc: altoPreferPc,
                avoidPcs: altoAvoid,
                extraPenalty: altoExtraPenalty
              }) ?? null;

            if (candAlto === null) continue;
            const spacingPenalty = candAlto - candTenor > 12 ? 3 : 0;
            const pairScore = cand.score + spacingPenalty;
            if (!bestPair || pairScore < bestPair.score) {
              bestPair = { tenor: candTenor, alto: candAlto, score: pairScore };
            }
          }

          if (bestPair) {
            tenorMidi = bestPair.tenor;
            altoMidi = bestPair.alto;
          }
        }

        if (tenorMidi === null) {
          const tenorFallbackTarget = clampInt((bassMidi ?? bassTarget) + 7, RANGES.Tenor.min, RANGES.Tenor.max);
          tenorMidi =
            chooseVoiceNote({
              voice: "Tenor",
              chordPcs,
              targetMidi: tenorFallbackTarget,
              range: tenorRange,
              aboveMidi: bassMidi ?? bassTarget,
              avoidPcs: tenorAvoid,
              extraPenalty: tenorExtraPenalty
            }) ?? null;
        }

        if (altoMidi === null) {
          const altoFallbackTarget = clampInt(soprMidi - 4, RANGES.Alto.min, RANGES.Alto.max);
          altoMidi =
            chooseVoiceNote({
              voice: "Alto",
              chordPcs,
              targetMidi: altoFallbackTarget,
              range: RANGES.Alto,
              belowMidi: soprMidi,
              avoidPcs: altoAvoid,
              extraPenalty: altoExtraPenalty
            }) ?? null;
        }

        if (bassMidi === null || tenorMidi === null || altoMidi === null) {
          const repaired = repairVoicingForBeat({
            chordPcs,
            parsedChord: parsed,
            soprMidi,
            prev: { prevA, prevT, prevB, prevS },
            ranges: { Bass: RANGES.Bass, Tenor: tenorRange, Alto: RANGES.Alto },
            options: { forceRootInBass, allowOctaveShift: true, allowTenorAltoUnisonD4: true },
            targets: { bassTarget, tenorTarget, altoTarget },
            context: { measure: measureNumber, t }
          });

          if (repaired) {
            bassMidi = repaired.bassMidi;
            tenorMidi = repaired.tenorMidi;
            altoMidi = repaired.altoMidi;
            bassPitchSpelling = repaired.bassSpelling ?? bassPitchSpelling;
            if (bassPitchSpelling && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
              bassPitchSpelling = null;
            }
            if (repaired.warnings.length) {
              for (const w of repaired.warnings) {
                // eslint-disable-next-line no-console
                console.warn(w);
                repairWarnings.push(w);
              }
            }
          }
        }

        if (tenorMidi === null) {
          tenorMidi =
            chooseVoiceNote({
              voice: "Tenor",
              chordPcs,
              targetMidi: tenorTarget,
              range: tenorRange
            }) ?? tenorTarget;
        }
        if (altoMidi === null) {
          altoMidi =
            chooseVoiceNote({
              voice: "Alto",
              chordPcs,
              targetMidi: altoTarget,
              range: RANGES.Alto
            }) ?? altoTarget;
        }
        if (bassMidi === null) {
          bassMidi =
            chooseVoiceNote({
              voice: "Bass",
              chordPcs,
              targetMidi: bassTarget,
              range: RANGES.Bass
            }) ?? bassTarget;
          if (bassPitchSpelling && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
            bassPitchSpelling = null;
          }
        }

        if (tenorMidi !== null && altoMidi !== null && bassMidi !== null) {
          const refined = refineInnerVoices({
            chordPcs,
            soprMidi,
            bassMidi,
            tenorTarget,
            altoTarget,
            tenorRange,
            altoRange: RANGES.Alto,
            allowUnisonD4: true
          });
          if (refined) {
            tenorMidi = refined.tenor;
            altoMidi = refined.alto;
          }
        }

        if (shouldPlace7Now && canForceResolution && resolutionPc !== null) {
          const tenorHas7Now = tenorMidi !== null && seventhPc !== null ? pc(tenorMidi) === seventhPc : false;
          const altoHas7Now = altoMidi !== null && seventhPc !== null ? pc(altoMidi) === seventhPc : false;

          if (tenorHas7Now) {
            pending = { voice: "Tenor", toPc: resolutionPc, atMeasure: nextMeasureNumber, atT: 0 };
          } else if (altoHas7Now) {
            pending = { voice: "Alto", toPc: resolutionPc, atMeasure: nextMeasureNumber, atT: 0 };
          }
        }
      }

      if (bassPitchSpelling && bassMidi !== null && pcFromSpelling(bassPitchSpelling) !== pc(bassMidi)) {
        bassPitchSpelling = null;
      }

      if (soprMidi !== null && altoMidi !== null && tenorMidi !== null && bassMidi !== null) {
        const leapTargetB = consumePendingLeap(pendingLeaps, "Bass", measureNumber, t);
        const leapTargetT = consumePendingLeap(pendingLeaps, "Tenor", measureNumber, t);
        const leapTargetA = consumePendingLeap(pendingLeaps, "Alto", measureNumber, t);
        const leapTargetS = keepMelody ? null : consumePendingLeap(pendingLeaps, "Soprano", measureNumber, t);

        let curS = soprMidi;
        let curA = altoMidi;
        let curT = tenorMidi;
        let curB = bassMidi;

        ({ soprMidi: curS, altoMidi: curA, tenorMidi: curT, bassMidi: curB } = applyPendingLeapTarget({
          voice: "Bass",
          targetMidi: leapTargetB,
          soprMidi: curS,
          altoMidi: curA,
          tenorMidi: curT,
          bassMidi: curB,
          warnings: repairWarnings,
          measureNumber,
          t
        }));

        ({ soprMidi: curS, altoMidi: curA, tenorMidi: curT, bassMidi: curB } = applyPendingLeapTarget({
          voice: "Tenor",
          targetMidi: leapTargetT,
          soprMidi: curS,
          altoMidi: curA,
          tenorMidi: curT,
          bassMidi: curB,
          warnings: repairWarnings,
          measureNumber,
          t
        }));

        ({ soprMidi: curS, altoMidi: curA, tenorMidi: curT, bassMidi: curB } = applyPendingLeapTarget({
          voice: "Alto",
          targetMidi: leapTargetA,
          soprMidi: curS,
          altoMidi: curA,
          tenorMidi: curT,
          bassMidi: curB,
          warnings: repairWarnings,
          measureNumber,
          t
        }));

        if (!keepMelody) {
          ({ soprMidi: curS, altoMidi: curA, tenorMidi: curT, bassMidi: curB } = applyPendingLeapTarget({
            voice: "Soprano",
            targetMidi: leapTargetS,
            soprMidi: curS,
            altoMidi: curA,
            tenorMidi: curT,
            bassMidi: curB,
            warnings: repairWarnings,
            measureNumber,
            t
          }));
        }

        soprMidi = curS;
        altoMidi = curA;
        tenorMidi = curT;
        bassMidi = curB;
      }

      const nextPos = nextBeatPosition({
        measureNumber,
        t,
        lastBeat,
        nextMeasureNumber,
        lastMeasureNumber
      });

      scheduleLeapCompensation({
        pending: pendingLeaps,
        voice: "Bass",
        prevMidi: prevB,
        currMidi: bassMidi,
        scalePcs,
        range: RANGES.Bass,
        nextPos,
        measureNumber,
        t,
        warnings: repairWarnings
      });

      scheduleLeapCompensation({
        pending: pendingLeaps,
        voice: "Tenor",
        prevMidi: prevT,
        currMidi: tenorMidi,
        scalePcs,
        range: tenorRange,
        nextPos,
        measureNumber,
        t,
        warnings: repairWarnings
      });

      scheduleLeapCompensation({
        pending: pendingLeaps,
        voice: "Alto",
        prevMidi: prevA,
        currMidi: altoMidi,
        scalePcs,
        range: RANGES.Alto,
        nextPos,
        measureNumber,
        t,
        warnings: repairWarnings
      });

      if (!keepMelody) {
        scheduleLeapCompensation({
          pending: pendingLeaps,
          voice: "Soprano",
          prevMidi: prevS,
          currMidi: soprMidi,
          scalePcs,
          range: soprRange,
          nextPos,
          measureNumber,
          t,
          warnings: repairWarnings
        });
      }

      addNoteEvent(mT, t, 1, tenorMidi);

      addNoteEvent(mA, t, 1, altoMidi);

      addNoteEvent(mB, t, 1, bassMidi, bassPitchSpelling);

      prevS = soprMidi;
      prevA = altoMidi ?? prevA;
      prevT = tenorMidi ?? prevT;
      prevB = bassMidi;
      prevChordCtx = { pcs: chordPcs, rootPc, seventhPc: parsed.seventhPc ?? null };
    }
  }

  ensureMeasureAttributesOnlyOnFirst(outS);
  ensureMeasureAttributesOnlyOnFirst(outA);
  ensureMeasureAttributesOnlyOnFirst(outT);
  ensureMeasureAttributesOnlyOnFirst(outB);

  const chordEventSample = safeChords.slice(0, 32).map((c) => ({
    measure: Number((c as any).measure),
    t: Number((c as any).t),
    symbol: String((c as any).symbol)
  }));
  const chordEvents = safeChords.map((c) => ({
    measure: Number((c as any).measure),
    t: Number((c as any).t),
    symbol: String((c as any).symbol)
  }));

  const out: ScoreModel = {
    ...(inScore as any),
    meta: {
      ...((inScore as any).meta ?? {}),
      ensemble: "satb",
      harmonize: {
        mode: "satb_from_chords_or_melody",
        version: "0.7.3",
        note:
          "If chords are empty, infer diatonic triads on strong beats from melody using key signature; final cadence enforces Bass root on final I at t=0.",
        chords: chordEvents,
        debug: {
          usedInference,
          beatsPerMeasure,
          chordEventCount: safeChords.length,
          chordEventSample,
          repairWarnings: repairWarnings.length ? repairWarnings : undefined,
          accompanimentType: accompanimentType || undefined,
          polyphonicProfile: usePolyphonic
            ? { profile: polyProfile.name, modernMode: polyProfile.modernMode ?? undefined }
            : undefined
        }
      }
    },
    parts: [outS, outA, outT, outB]
  };

  return out;
}
