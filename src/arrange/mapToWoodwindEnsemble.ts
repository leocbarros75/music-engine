// src/arrange/mapToWoodwindEnsemble.ts

import type { ScoreModel } from "../score/types";
import { InstrumentCatalog, shiftOctavesIntoRange, midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { extractOnsetChords } from "../analyze/chordExtractor";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

type ChordEvent = { measure: number; t: number; symbol: string };

export type WoodwindMapOptions = {
  level?: "beginner" | "intermediate" | "advanced" | "professional";
  accompaniment?: string;
  textureMode?: string;
  chords?: ChordEvent[];
  warnings?: string[];
  fluteActivity?: "grounded" | "less_active" | "active" | "high_active";
  oboeActivity?: "grounded" | "less_active" | "active" | "high_active";
  clarinetActivity?: "grounded" | "less_active" | "active" | "high_active";
  bassoonActivity?: "grounded" | "less_active" | "active" | "high_active";
};

function makePart(part_id: string, name: string, instrument: string, staves = 1) {
  return { part_id, name, instrument, staves, measures: [] as any[] };
}

function cloneMeasureShell(m: any) {
  return { number: m.number, attributes: { ...m.attributes }, events: [] as any[] };
}

function addNote(
  measure: any,
  t: number,
  dur: number,
  pitch: { step: string; alter?: number; octave: number },
  voice: number,
  idPrefix: string,
  seq: number
) {
  measure.events.push({
    id: `${idPrefix}_${measure.number}_${seq}`,
    t,
    dur,
    type: "note",
    pitch,
    voice,
    staff: 1
  });
}

function warn(warnings: string[] | undefined, msg: string): void {
  if (!warnings) return;
  warnings.push(msg);
}

function parsePcToken(tok: string): number | null {
  const m = String(tok ?? "").trim().match(/^([A-Ga-g])([#b]?)/);
  if (!m) return null;
  const step = m[1]!.toUpperCase();
  const acc = m[2] ?? "";
  const byStep: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const base = byStep[step];
  if (typeof base !== "number") return null;
  const alter = acc === "#" ? 1 : acc === "b" ? -1 : 0;
  return (base + alter + 12) % 12;
}

function parseBassPc(symbol: string): number | null {
  const s = String(symbol ?? "").trim();
  if (!s) return null;
  const slash = s.split("/");
  if (slash.length > 1) {
    const bass = parsePcToken(slash[1] ?? "");
    if (bass !== null) return bass;
  }
  const parsed = parseChordSymbol(s);
  if (parsed) return parsed.rootPc;
  return parsePcToken(s);
}

function measureBeats(attrs: any | undefined): number {
  const beats = Number(attrs?.time?.beats ?? 4);
  const beatType = Number(attrs?.time?.beat_type ?? attrs?.time?.beatType ?? 4);
  if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) return 4;
  return beats * (4 / beatType);
}

function uniquePcs(pcs: number[]): number[] {
  return Array.from(new Set(pcs.map((pc) => ((pc % 12) + 12) % 12)));
}

function chooseMidiForPc(
  pc: number,
  range: { min: number; max: number },
  params: { center: number; prev?: number | null; upper?: number | null; lower?: number | null }
): number | null {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    const mpc = ((m % 12) + 12) % 12;
    if (mpc !== ((pc % 12) + 12) % 12) continue;
    if (typeof params.upper === "number" && m > params.upper) continue;
    if (typeof params.lower === "number" && m < params.lower) continue;
    candidates.push(m);
  }
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const move = typeof params.prev === "number" ? Math.abs(c - params.prev) : 0;
    const center = Math.abs(c - params.center);
    const score = move * 3 + center;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}

function shiftOctavesToward(midi: number, lo: number, hi: number, center: number): number {
  let m = shiftOctavesIntoRange(midi, lo, hi);
  const candidates: number[] = [];
  for (let k = -4; k <= 4; k++) {
    const c = m + 12 * k;
    if (c >= lo && c <= hi) candidates.push(c);
  }
  if (candidates.length === 0) return m;
  let best = candidates[0]!;
  let bestDist = Math.abs(best - center);
  for (const c of candidates) {
    const d = Math.abs(c - center);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function homophonicLevel(options: WoodwindMapOptions): "beginner" | "intermediate" | "advanced" | null {
  const level = String(options.level ?? "").toLowerCase();
  const accompaniment = String(options.accompaniment ?? "").toLowerCase();
  const textureMode = String(options.textureMode ?? "").toLowerCase();
  const isHomophonic =
    accompaniment === "homophonic" ||
    accompaniment === "chordal" ||
    textureMode === "homophony_homorhythmic" ||
    textureMode === "homophony_melody_accompaniment";
  if (!isHomophonic) return null;
  if (level === "beginner") return "beginner";
  if (level === "intermediate") return "intermediate";
  if (level === "advanced") return "advanced";
  return null;
}

function polyphonicProfile(
  options: WoodwindMapOptions
):
  | "beginner_less_active"
  | "beginner_active"
  | "intermediate_less_active"
  | "intermediate_active"
  | "intermediate_high_active"
  | "advanced_less_active"
  | "advanced_active"
  | "advanced_high_active"
  | null {
  const level = String(options.level ?? "").toLowerCase();
  const accompaniment = String(options.accompaniment ?? "").toLowerCase();
  const textureMode = String(options.textureMode ?? "").toLowerCase();
  const isPolyphonic = accompaniment === "polyphonic" || textureMode === "polyphony";
  if (!isPolyphonic || (level !== "beginner" && level !== "intermediate" && level !== "advanced")) return null;

  const fluteActivity = options.fluteActivity ?? "less_active";
  const oboeActivity = options.oboeActivity ?? "less_active";
  const clarinetActivity = options.clarinetActivity ?? "less_active";
  const bassoonActivity = options.bassoonActivity ?? "less_active";

  if (
    fluteActivity === "less_active" &&
    oboeActivity === "less_active" &&
    clarinetActivity === "less_active" &&
    bassoonActivity === "less_active"
  ) {
    if (level === "advanced") return "advanced_less_active";
    return level === "intermediate" ? "intermediate_less_active" : "beginner_less_active";
  }
  if (
    fluteActivity === "high_active" ||
    oboeActivity === "high_active" ||
    clarinetActivity === "high_active" ||
    bassoonActivity === "high_active"
  ) {
    if (level === "beginner") return "beginner_active";
    if (level === "intermediate") return "intermediate_high_active";
    if (level === "advanced") return "advanced_high_active";
  }
  if (
    fluteActivity === "active" ||
    oboeActivity === "active" ||
    clarinetActivity === "active" ||
    bassoonActivity === "active"
  ) {
    if (level === "beginner") return "beginner_active";
    if (level === "intermediate") return "intermediate_active";
    if (level === "advanced") return "advanced_active";
  }
  return null;
}

function pcOfMidi(midi: number | null | undefined): number | null {
  if (typeof midi !== "number" || !Number.isFinite(midi)) return null;
  return ((midi % 12) + 12) % 12;
}

function activeMidiAt(events: Array<{ t: number; dur: number; midi: number }>, t: number): number | null {
  let active: { t: number; midi: number } | null = null;
  for (const ev of events) {
    if (ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9) {
      if (!active || ev.t > active.t) active = { t: ev.t, midi: ev.midi };
    }
  }
  return active?.midi ?? null;
}

function minMidiDuring(events: Array<{ t: number; dur: number; midi: number }>, t: number, dur: number): number | null {
  const overlapping = events
    .filter((ev) => ev.t < t + dur - 1e-9 && t < ev.t + ev.dur - 1e-9)
    .map((ev) => ev.midi);
  return overlapping.length ? Math.min(...overlapping) : null;
}

function maxMidiDuring(events: Array<{ t: number; dur: number; midi: number }>, t: number, dur: number): number | null {
  const overlapping = events
    .filter((ev) => ev.t < t + dur - 1e-9 && t < ev.t + ev.dur - 1e-9)
    .map((ev) => ev.midi);
  return overlapping.length ? Math.max(...overlapping) : null;
}

function buildQuarterHalfPattern(measureLen: number, measureNumber: number, beatUnit = 1): number[] {
  const out: number[] = [];
  let remaining = measureLen;
  const useTwo = measureNumber % 2 === 0;
  while (remaining > 0.01) {
    if (remaining >= beatUnit * 2 && useTwo) {
      out.push(beatUnit * 2);
      remaining -= beatUnit * 2;
    } else {
      out.push(Math.min(beatUnit, remaining));
      remaining -= beatUnit;
    }
  }
  return out;
}

function shouldChooseMeasure(measureNumber: number, ratio: number, salt = 0): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  let h = (measureNumber * 2654435761) ^ (salt * 1597334677);
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

function measureRatio(measureNumber: number, salt = 0): number {
  let h = (measureNumber * 2654435761) ^ (salt * 1597334677);
  h = (h >>> 0) % 1000;
  return h / 1000;
}

function patternRatio(measureNumber: number, slotIndex: number, salt = 0): number {
  let h = (measureNumber * 2654435761) ^ (slotIndex * 2246822519) ^ (salt * 1597334677);
  h = (h >>> 0) % 1000;
  return h / 1000;
}

function buildShuffledRhythmCells(measureLen: number, measureNumber: number, salt = 0): number[] {
  const cellBank: number[][] = [
    [0.5, 0.5, 1],
    [1, 0.5, 0.5],
    [1.5, 0.5],
    [0.5, 0.5, 1],
    [1, 0.5, 0.5],
    [1.5, 0.5],
    [1],
    [2]
  ];
  const out: number[] = [];
  let remaining = measureLen;
  let slotIndex = 0;

  while (remaining > 0.01) {
    const fitting = cellBank.filter((cell) => cell.reduce((sum, dur) => sum + dur, 0) <= remaining + 1e-9);
    if (!fitting.length) {
      out.push(remaining);
      break;
    }
    const pickIndex = Math.floor(patternRatio(measureNumber, slotIndex, salt) * fitting.length) % fitting.length;
    const chosen = fitting[pickIndex] ?? fitting[0]!;
    for (const dur of chosen) out.push(dur);
    remaining -= chosen.reduce((sum, dur) => sum + dur, 0);
    slotIndex += 1;
  }

  return out.filter((dur) => dur > 0.01);
}

function buildIntermediateOboeActivePattern(measureLen: number, measureNumber: number): number[] {
  const cellBank: number[][] = [
    [1, 1, 1, 1],
    [2, 2],
    [1.5, 0.5, 1, 1],
    [1, 1.5, 0.5, 1],
    [1, 1, 1.5, 0.5],
    [2, 1.5, 0.5],
    [1.5, 0.5, 2],
    [2, 1, 1],
    [1, 2, 1],
    [1, 1, 2],
    [2, 1],
    [1, 2],
    [1, 1, 1]
  ];
  const fitting = cellBank.filter((cell) => Math.abs(cell.reduce((sum, dur) => sum + dur, 0) - measureLen) < 1e-6);
  if (!fitting.length) {
    return buildQuarterHalfPattern(measureLen, measureNumber, 1);
  }
  const pickIndex = Math.floor(patternRatio(measureNumber, 0, 733) * fitting.length) % fitting.length;
  return fitting[pickIndex] ?? fitting[0]!;
}

function buildAdvancedBassoonPattern(measureLen: number, measureNumber: number): number[] {
  const cellBank: number[][] = [
    [0.5, 0.5],
    [0.5, 0.25, 0.25],
    [1.5, 0.5],
    [1]
  ];
  const out: number[] = [];
  let remaining = measureLen;
  let slotIndex = 0;

  while (remaining > 0.01) {
    const fitting = cellBank.filter((cell) => cell.reduce((sum, dur) => sum + dur, 0) <= remaining + 1e-9);
    if (!fitting.length) {
      out.push(remaining);
      break;
    }
    const pickIndex = Math.floor(patternRatio(measureNumber, slotIndex, 887) * fitting.length) % fitting.length;
    const chosen = fitting[pickIndex] ?? fitting[0]!;
    for (const dur of chosen) out.push(dur);
    remaining -= chosen.reduce((sum, dur) => sum + dur, 0);
    slotIndex += 1;
  }

  return out.filter((dur) => dur > 0.01);
}

function buildRestedEighthThreeSlots(measureLen: number): Array<{ t: number; dur: number }> {
  const slots: Array<{ t: number; dur: number }> = [];
  for (let cellStart = 0; cellStart < measureLen - 1e-6; cellStart += 2) {
    for (const offset of [0.5, 1, 1.5]) {
      const t = cellStart + offset;
      if (t >= measureLen - 1e-6) continue;
      slots.push({ t, dur: Math.min(0.5, measureLen - t) });
    }
  }
  return slots;
}

function buildAdvancedColorCellSlots(measureLen: number, measureNumber: number, salt = 0): Array<{ t: number; dur: number }> {
  const baseOrder = ["dot8_16", "e_16_16", "e_e", "q"] as const;
  const order = [...baseOrder];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(patternRatio(measureNumber, i, salt) * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }

  const slots: Array<{ t: number; dur: number }> = [];
  let cellIdx = 0;
  for (let beat = 0; beat < measureLen - 1e-6; beat += 1) {
    const cell = order[cellIdx % order.length]!;
    const cellSlots =
      cell === "dot8_16"
        ? [
            { t: beat, dur: 0.75 },
            { t: beat + 0.75, dur: 0.25 }
          ]
        : cell === "e_16_16"
          ? [
              { t: beat, dur: 0.5 },
              { t: beat + 0.5, dur: 0.25 },
              { t: beat + 0.75, dur: 0.25 }
            ]
          : cell === "e_e"
            ? [
                { t: beat, dur: 0.5 },
                { t: beat + 0.5, dur: 0.5 }
              ]
            : [{ t: beat, dur: 1 }];
    for (const slot of cellSlots) {
      if (slot.t < measureLen - 1e-6) {
        slots.push({ t: slot.t, dur: Math.min(slot.dur, measureLen - slot.t) });
      }
    }
    cellIdx += 1;
  }
  return slots;
}

function buildAdvancedHighColorCellSlots(measureLen: number, measureNumber: number, salt = 0): Array<{ t: number; dur: number }> {
  const baseOrder = ["four16", "two8", "dotq8"] as const;
  const order = [...baseOrder];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(patternRatio(measureNumber, i, salt) * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }

  const slots: Array<{ t: number; dur: number }> = [];
  let cellIdx = 0;
  for (let beat = 0; beat < measureLen - 1e-6; beat += 1) {
    const cell = order[cellIdx % order.length]!;
    const cellSlots =
      cell === "four16"
        ? [
            { t: beat, dur: 0.25 },
            { t: beat + 0.25, dur: 0.25 },
            { t: beat + 0.5, dur: 0.25 },
            { t: beat + 0.75, dur: 0.25 }
          ]
        : cell === "two8"
          ? [
              { t: beat, dur: 0.5 },
              { t: beat + 0.5, dur: 0.5 }
            ]
          : [
              { t: beat, dur: 1.5 },
              { t: beat + 1.5, dur: 0.5 }
            ];
    for (const slot of cellSlots) {
      if (slot.t < measureLen - 1e-6) {
        slots.push({ t: slot.t, dur: Math.min(slot.dur, measureLen - slot.t) });
      }
    }
    cellIdx += cell === "dotq8" ? 2 : 1;
  }
  return slots;
}

function pickChordToneSequence(chord: { pcs?: number[]; rootPc?: number }, length = 4): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const majorThird = (root + 4) % 12;
  const minorThird = (root + 3) % 12;
  let third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
  if (third === null) {
    third = pcs.find((pc) => pc !== root && pc !== fifth) ?? root;
  }
  const base = [root, fifth, third, fifth];
  const out: number[] = [];
  for (let i = 0; i < length; i++) out.push(base[i % base.length]);
  return out;
}

function pickThirdAndFifth(chord: { pcs?: number[]; rootPc?: number }): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const majorThird = (root + 4) % 12;
  const minorThird = (root + 3) % 12;
  const third = pcs.includes(majorThird) ? majorThird : pcs.includes(minorThird) ? minorThird : null;
  const out: number[] = [];
  if (third !== null) out.push(third);
  if (pcs.includes(fifth)) out.push(fifth);
  return out.length ? out : pcs.slice(0, 2);
}

function pickRootAndFifth(chord: { pcs?: number[]; rootPc?: number }): number[] {
  const pcs = chord?.pcs ?? [];
  if (!pcs.length) return [];
  const root = typeof chord.rootPc === "number" ? chord.rootPc : pcs[0]!;
  const fifth = (root + 7) % 12;
  const out = [root];
  if (pcs.includes(fifth)) out.push(fifth);
  return uniquePcs(out.length ? out : pcs.slice(0, 2));
}

function oppositeDirection(dir: "up" | "down" | "either"): "up" | "down" | "either" {
  if (dir === "up") return "down";
  if (dir === "down") return "up";
  return "either";
}

function candidateMidisForPcs(
  pcs: number[],
  minMidi: number,
  maxMidi: number,
  params: { lower?: number | null; upper?: number | null; excludeMidi?: number | null; excludePc?: number | null } = {}
): number[] {
  const out = new Set<number>();
  for (const rawPc of pcs) {
    const pc = ((rawPc % 12) + 12) % 12;
    for (let midi = minMidi; midi <= maxMidi; midi++) {
      if (((midi % 12) + 12) % 12 !== pc) continue;
      if (typeof params.lower === "number" && midi < params.lower) continue;
      if (typeof params.upper === "number" && midi > params.upper) continue;
      if (typeof params.excludeMidi === "number" && midi === params.excludeMidi) continue;
      if (typeof params.excludePc === "number" && pc === ((params.excludePc % 12) + 12) % 12) continue;
      out.add(midi);
    }
  }
  return Array.from(out).sort((a, b) => a - b);
}

function pickCandidateNear(
  prevMidi: number,
  pcs: number[],
  minMidi: number,
  maxMidi: number,
  preferDir: "up" | "down" | "either",
  params: {
    lower?: number | null;
    upper?: number | null;
    excludeMidi?: number | null;
    excludePc?: number | null;
    center?: number | null;
    avoidPc?: number[];
  } = {}
): number {
  const candidates = candidateMidisForPcs(pcs, minMidi, maxMidi, params);
  if (!candidates.length) return shiftOctavesIntoRange(prevMidi, minMidi, maxMidi);
  const center = typeof params.center === "number" ? params.center : prevMidi;
  const avoidSet = new Set((params.avoidPc ?? []).map((pc) => ((pc % 12) + 12) % 12));

  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const cand of candidates) {
    const move = Math.abs(cand - prevMidi);
    const dirPenalty =
      preferDir === "either"
        ? 0
        : preferDir === "up"
          ? cand > prevMidi
            ? 0
            : 8
          : cand < prevMidi
            ? 0
            : 8;
    const centerPenalty = Math.abs(cand - center);
    const avoidPenalty = avoidSet.has(((cand % 12) + 12) % 12) ? 15 : 0;
    const score = move * 3 + dirPenalty + centerPenalty + avoidPenalty;
    if (score < bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}

function findSourcePart(score: ScoreModel): any | null {
  const parts = score.parts ?? [];
  const pianoByInstrument = parts.find((p: any) => String(p?.instrument ?? "").toLowerCase().includes("piano"));
  if (pianoByInstrument) return pianoByInstrument;
  const pianoByStaves = parts.find((p: any) => Number(p?.staves ?? 1) >= 2);
  if (pianoByStaves) return pianoByStaves;
  return parts[0] ?? null;
}

function normalizeChords(score: ScoreModel, options: WoodwindMapOptions): ChordEvent[] {
  const fromOptions = Array.isArray(options.chords) ? options.chords : [];
  const fromMeta = Array.isArray((score as any)?.meta?.inputChords) ? ((score as any).meta.inputChords as ChordEvent[]) : [];
  const src = fromOptions.length ? fromOptions : fromMeta;
  return src
    .map((c) => ({
      measure: Number(c.measure),
      t: Number(c.t),
      symbol: String(c.symbol ?? "")
    }))
    .filter((c) => Number.isFinite(c.measure) && Number.isFinite(c.t) && c.symbol)
    .sort((a, b) => (a.measure - b.measure) || (a.t - b.t));
}

function collectRhTopNotes(m: any): Array<{ t: number; dur: number; midi: number }> {
  const notes = (m?.events ?? [])
    .filter((ev: any) => ev?.type === "note" && ev?.pitch)
    .map((ev: any) => ({ ev, midi: pitchToMidi(ev.pitch) }))
    .filter((x: any) => Number.isFinite(x.midi));
  const hasStaff = notes.some((n: any) => Number.isFinite(Number(n.ev?.staff)));
  const rh = notes.filter((n: any) => {
    if (hasStaff) return Number(n.ev?.staff ?? 1) === 1;
    return n.midi >= 60;
  });
  const src = rh.length ? rh : notes;
  const byT = new Map<number, { t: number; dur: number; midi: number }>();
  for (const n of src) {
    const t = Number(n.ev?.t ?? 0);
    const dur = Number(n.ev?.dur ?? 0);
    if (!Number.isFinite(t) || !Number.isFinite(dur) || dur <= 0) continue;
    const prev = byT.get(t);
    if (!prev || n.midi > prev.midi) {
      byT.set(t, { t, dur, midi: n.midi });
    }
  }
  return Array.from(byT.values()).sort((a, b) => a.t - b.t);
}

function collectOnsetPcs(m: any): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (const ev of m?.events ?? []) {
    if (ev?.type !== "note" || !ev?.pitch) continue;
    const t = Number(ev.t ?? 0);
    if (!Number.isFinite(t)) continue;
    const pc = ((pitchToMidi(ev.pitch) % 12) + 12) % 12;
    const list = out.get(t) ?? [];
    list.push(pc);
    out.set(t, list);
  }
  for (const [k, v] of out.entries()) out.set(k, uniquePcs(v));
  return out;
}

function mapBeginnerPolyphonicLessActive(score: ScoreModel, options: WoodwindMapOptions): ScoreModel {
  const srcPart = findSourcePart(score);
  if (!srcPart) return score;
  const level = String(options.level ?? "").toLowerCase();
  const isIntermediate = level === "intermediate";
  const isAdvanced = level === "advanced";

  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const outParts = [fl, ob, cl, bn];

  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures ?? []) {
    const shells = outParts.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;
    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = normalizeChords(score, options);
  const chordsByMeasure = new Map<number, ChordEvent[]>();
  for (const ch of chords) {
    const list = chordsByMeasure.get(ch.measure) ?? [];
    list.push(ch);
    chordsByMeasure.set(ch.measure, list);
  }
  for (const list of chordsByMeasure.values()) list.sort((a, b) => a.t - b.t);

  const rFL = isAdvanced ? { midi_low: 59, midi_high: 98 } : isIntermediate ? { midi_low: 60, midi_high: 91 } : { midi_low: 60, midi_high: 79 };
  const rOB = isAdvanced ? { midi_low: 58, midi_high: 93 } : isIntermediate ? { midi_low: 60, midi_high: 87 } : { midi_low: 62, midi_high: 87 };
  const rCL = isAdvanced ? { midi_low: 52, midi_high: 96 } : isIntermediate ? { midi_low: 52, midi_high: 91 } : { midi_low: 52, midi_high: 84 };
  const rBN = isAdvanced ? { midi_low: 35, midi_high: 76 } : isIntermediate ? { midi_low: 34, midi_high: 67 } : { midi_low: 29, midi_high: 55 };

  let seq = 0;
  let prevOb = 69;
  let prevCl = 60;
  let prevBn = 41;

  const totalMeasures = (srcPart.measures ?? []).length;
  for (let mi = 0; mi < totalMeasures; mi++) {
    const srcMeasure = srcPart.measures[mi];
    const mNum = Number(srcMeasure?.number ?? mi + 1);
    const shells = measureMap[String(mNum)];
    if (!shells) continue;

    const melody = collectRhTopNotes(srcMeasure).map((ev) => ({
      ...ev,
      midi: shiftOctavesIntoRange(ev.midi + 12, rFL.midi_low, rFL.midi_high)
    }));
    for (const ev of melody) {
      addNote(shells[0], ev.t, ev.dur, midiToPitch(ev.midi), 1, "FL", ++seq);
    }

    const chordsHere = chordsByMeasure.get(mNum) ?? [];
    // ScoreModel event timing uses beats, while the MusicXML exporter converts beats to
    // divisions later. Keep all planning in beat units here so rhythm and harmony stay aligned.
    const beatUnit = 1;
    const measureLen = measureBeats(srcMeasure?.attributes);
    const sourceNoteEvents = (srcMeasure?.events ?? [])
      .filter((ev: any) => ev?.type === "note" && ev?.pitch)
      .map((ev: any) => ({ t: Number(ev.t ?? 0), dur: Number(ev.dur ?? 0), midi: pitchToMidi(ev.pitch) }))
      .filter((ev: any) => Number.isFinite(ev.t) && Number.isFinite(ev.dur) && ev.dur > 0 && Number.isFinite(ev.midi));

    const harmonyAt = (t: number) => {
      let activeChord: ChordEvent | null = null;
      for (const ch of chordsHere) {
        if (ch.t <= t + 1e-9) activeChord = ch;
      }
      const activeSourcePcs = uniquePcs(
        sourceNoteEvents.filter((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9).map((ev) => pcOfMidi(ev.midi) ?? 0)
      );
      const sourceBassPc = (() => {
        const active = sourceNoteEvents
          .filter((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9)
          .sort((a, b) => a.midi - b.midi);
        return active.length ? pcOfMidi(active[0]!.midi) : null;
      })();
      const parsed = activeChord ? parseChordSymbol(activeChord.symbol) : null;
      const pcs = uniquePcs(parsed?.pcs?.length ? parsed.pcs : activeSourcePcs);
      const rootPc = parsed?.rootPc ?? pcs[0] ?? sourceBassPc ?? 0;
      const bassPc = activeChord ? (parseBassPc(activeChord.symbol) ?? rootPc) : sourceBassPc ?? rootPc;
      const majThird = (rootPc + 4) % 12;
      const minThird = (rootPc + 3) % 12;
      const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
      const fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;
      const chordCore = uniquePcs(
        [rootPc, thirdPc ?? undefined, fifthPc ?? undefined].filter((x): x is number => typeof x === "number")
      );
      return {
        pcs: pcs.length ? pcs : chordCore,
        rootPc,
        bassPc,
        thirdPc,
        fifthPc,
        chordCore: chordCore.length ? chordCore : pcs
      };
    };

    const melodyDirAt = (t: number): "up" | "down" | "either" => {
      const currentIdx = melody.findIndex((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9);
      if (currentIdx <= 0) return "either";
      const current = melody[currentIdx];
      const prev = melody[currentIdx - 1];
      if (!current || !prev) return "either";
      if (current.midi > prev.midi) return "up";
      if (current.midi < prev.midi) return "down";
      return "either";
    };

    const isClosingMeasure = mi >= totalMeasures - 2;
    if (isClosingMeasure && melody.length) {
      const tailBnEvents: Array<{ t: number; dur: number; midi: number }> = [];
      const tailClEvents: Array<{ t: number; dur: number; midi: number }> = [];
      const tailObEvents: Array<{ t: number; dur: number; midi: number }> = [];

      for (const slot of melody) {
        const h = harmonyAt(slot.t);
        const bnMidi = pickCandidateNear(
          prevBn,
          [h.bassPc],
          rBN.midi_low,
          rBN.midi_high,
          oppositeDirection(melodyDirAt(slot.t)),
          { center: 41 }
        );
        tailBnEvents.push({ t: slot.t, dur: slot.dur, midi: bnMidi });
        prevBn = bnMidi;

        const coveredForClarinet = new Set<number>();
        for (const pc of [pcOfMidi(slot.midi), pcOfMidi(bnMidi)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) coveredForClarinet.add(pc);
        }
        const missingForClarinet = h.chordCore.filter((pc) => !coveredForClarinet.has(pc));
        const clarinetPriority = uniquePcs([
          ...missingForClarinet,
          ...h.pcs.filter((pc) => pc !== pcOfMidi(bnMidi))
        ]);
        const clarinetLower = bnMidi + 1;
        const clarinetStrictUpper = slot.midi - 8;
        const clarinetRelaxedUpper = slot.midi - 1;
        let clarinetUpper = clarinetStrictUpper;
        let clarinetPool = candidateMidisForPcs(
          clarinetPriority.length ? clarinetPriority : h.pcs,
          rCL.midi_low,
          rCL.midi_high,
          { lower: clarinetLower, upper: clarinetUpper }
        );
        if (!clarinetPool.length) {
          clarinetUpper = clarinetRelaxedUpper;
          clarinetPool = candidateMidisForPcs(
            clarinetPriority.length ? clarinetPriority : h.pcs,
            rCL.midi_low,
            rCL.midi_high,
            { lower: clarinetLower, upper: clarinetUpper }
          );
        }
        const clMidi = clarinetPool.length
          ? pickCandidateNear(
              prevCl,
              clarinetPriority.length ? clarinetPriority : h.pcs,
              rCL.midi_low,
              rCL.midi_high,
              oppositeDirection(melodyDirAt(slot.t)),
              {
                lower: clarinetLower,
                upper: clarinetUpper,
                center: bnMidi + 4,
                avoidPc: missingForClarinet.length ? [] : [pcOfMidi(bnMidi) ?? -1]
              }
            )
          : shiftOctavesIntoRange(prevCl, rCL.midi_low, rCL.midi_high);
        tailClEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
        prevCl = clMidi;

        const coveredForOboe = new Set<number>();
        for (const pc of [pcOfMidi(slot.midi), pcOfMidi(clMidi), pcOfMidi(bnMidi)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) coveredForOboe.add(pc);
        }
        const missingForOboe = h.chordCore.filter((pc) => !coveredForOboe.has(pc));
        const oboePriority = uniquePcs([
          ...missingForOboe,
          ...h.pcs.filter((pc) => pc !== pcOfMidi(clMidi))
        ]);
        const oboeLower = clMidi + 1;
        const oboeUpper = slot.midi - 1;
        let oboePool = candidateMidisForPcs(oboePriority.length ? oboePriority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower: oboeLower,
          upper: oboeUpper
        });
        if (!oboePool.length) {
          oboePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
            lower: oboeLower,
            upper: oboeUpper
          });
        }
        const obMidi = oboePool.length
          ? pickCandidateNear(
              prevOb,
              oboePriority.length ? oboePriority : h.pcs,
              rOB.midi_low,
              rOB.midi_high,
              oppositeDirection(melodyDirAt(slot.t)),
              {
                lower: oboeLower,
                upper: oboeUpper,
                center: (slot.midi + clMidi) / 2,
                avoidPc: missingForOboe.length ? [] : [pcOfMidi(clMidi) ?? -1]
              }
            )
          : shiftOctavesIntoRange(prevOb, rOB.midi_low, rOB.midi_high);
        tailObEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
        prevOb = obMidi;
      }

      for (const ev of tailBnEvents) addNote(shells[3], ev.t, ev.dur, midiToPitch(ev.midi), 1, "BN", ++seq);
      for (const ev of tailClEvents) addNote(shells[2], ev.t, ev.dur, midiToPitch(ev.midi), 1, "CL", ++seq);
      for (const ev of tailObEvents) addNote(shells[1], ev.t, ev.dur, midiToPitch(ev.midi), 1, "OB", ++seq);
      continue;
    }

    const bnEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (isAdvanced) {
      const bassPattern = buildAdvancedBassoonPattern(measureLen, mNum);
      let bassT = 0;
      for (const rawDur of bassPattern) {
        const t = bassT;
        const dur = Math.min(rawDur, measureLen - t);
        if (dur <= 0.01) break;
        const h = harmonyAt(t);
        const preferDir = oppositeDirection(melodyDirAt(t));
        const bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, preferDir, {
          center: 45
        });
        bnEvents.push({ t, dur, midi: bnMidi });
        addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
        bassT += dur;
      }
    } else {
      let t = 0;
      for (const dur of buildQuarterHalfPattern(measureLen, mNum, beatUnit)) {
        const h = harmonyAt(t);
        const preferDir = oppositeDirection(melodyDirAt(t));
        const bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, preferDir, {
          center: 41
        });
        bnEvents.push({ t, dur, midi: bnMidi });
        addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
        t += dur;
      }
    }

    const clEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (isAdvanced) {
      for (const slot of buildRestedEighthThreeSlots(measureLen)) {
        const t = slot.t;
        const dur = slot.dur;
        const h = harmonyAt(t);
        const fluteNow = activeMidiAt(melody, t);
        const bassNow = activeMidiAt(bnEvents, t);
        const bassFloor = maxMidiDuring(bnEvents, t, dur);
        const strictUpper = typeof fluteNow === "number" ? fluteNow - 8 : undefined;
        const relaxedUpper = typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const colors = pickThirdAndFifth(h);
        const colorMissing = colors.filter((pc) => missing.includes(pc));
        const priority = uniquePcs([
          ...colorMissing,
          ...colors,
          ...(colorMissing.length ? [] : [h.rootPc]),
          ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))
        ]);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        let activeUpper = strictUpper;
        let candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
          lower,
          upper: activeUpper
        });
        if (!candidatePool.length) {
          activeUpper = relaxedUpper;
          candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
            lower,
            upper: activeUpper
          });
        }
        if (!candidatePool.length) continue;
        const clMidi = pickCandidateNear(
          prevCl,
          priority.length ? priority : h.pcs,
          rCL.midi_low,
          rCL.midi_high,
          oppositeDirection(melodyDirAt(t)),
          {
            lower,
            upper: activeUpper,
            center: typeof fluteNow === "number" && typeof bassNow === "number" ? (fluteNow + bassNow) / 2 : 62,
            avoidPc: missing.length ? [] : typeof bassNow === "number" ? [pcOfMidi(bassNow) ?? -1] : []
          }
        );
        clEvents.push({ t, dur, midi: clMidi });
        prevCl = clMidi;
      }
    } else {
      for (let i = 0; i < bnEvents.length; i++) {
      const bnEv = bnEvents[i]!;
      const nextBn = bnEvents[i + 1];
      const slots =
        Math.abs(bnEv.dur - beatUnit * 2) < 1e-6
          ? [
              { t: bnEv.t, dur: beatUnit },
              { t: bnEv.t + beatUnit, dur: beatUnit }
            ]
          : Math.abs(bnEv.dur - beatUnit) < 1e-6 && nextBn && Math.abs(nextBn.dur - beatUnit) < 1e-6
            ? [{ t: bnEv.t, dur: beatUnit * 2 }]
            : [{ t: bnEv.t, dur: bnEv.dur }];

      const prevBnMidi = i > 0 ? bnEvents[i - 1]?.midi ?? null : null;
      const bnDir =
        typeof prevBnMidi === "number"
          ? bnEv.midi > prevBnMidi
            ? "up"
            : bnEv.midi < prevBnMidi
              ? "down"
              : "either"
          : "either";
      const preferDir = oppositeDirection(bnDir);

      for (const slot of slots) {
        const h = harmonyAt(slot.t);
        const fluteNow = activeMidiAt(melody, slot.t);
        const bassNow = activeMidiAt(bnEvents, slot.t);
        const fluteCeiling = minMidiDuring(melody, slot.t, slot.dur);
        const bassFloor = maxMidiDuring(bnEvents, slot.t, slot.dur);
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const priority = uniquePcs(
          [
            ...missing,
            ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))
          ]
        );
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        const strictUpper =
          typeof fluteCeiling === "number" ? fluteCeiling - 8 : typeof fluteNow === "number" ? fluteNow - 8 : undefined;
        const relaxedUpper =
          typeof fluteCeiling === "number" ? fluteCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        let activeUpper = strictUpper;
        let candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
          lower,
          upper: activeUpper
        });
        if (!candidatePool.length) {
          activeUpper = relaxedUpper;
          candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
            lower,
            upper: activeUpper
          });
        }
        if (!candidatePool.length) continue;
        const clMidi = pickCandidateNear(prevCl, priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, preferDir, {
          lower,
          upper: activeUpper,
          center:
            typeof bassFloor === "number"
              ? bassFloor + 4
              : typeof bassNow === "number"
                ? bassNow + 4
                : 55,
          avoidPc: missing.length ? [] : typeof bassNow === "number" ? [pcOfMidi(bassNow) ?? -1] : []
        });
        clEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
        prevCl = clMidi;
      }

      if (Math.abs(bnEv.dur - beatUnit) < 1e-6 && nextBn && Math.abs(nextBn.dur - beatUnit) < 1e-6) i += 1;
      }
    }
    for (const ev of clEvents) {
      addNote(shells[2], ev.t, ev.dur, midiToPitch(ev.midi), 1, "CL", ++seq);
    }

    const obEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (isAdvanced) {
      for (const slot of buildRestedEighthThreeSlots(measureLen)) {
        const h = harmonyAt(slot.t);
        const fluteNow = activeMidiAt(melody, slot.t);
        const clarinetNow = activeMidiAt(clEvents, slot.t);
        const bassNow = activeMidiAt(bnEvents, slot.t);
        const fluteCeiling = minMidiDuring(melody, slot.t, slot.dur);
        const clarinetFloor = maxMidiDuring(clEvents, slot.t, slot.dur);
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(clarinetNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const colors = pickThirdAndFifth(h);
        const colorMissing = colors.filter((pc) => missing.includes(pc));
        const priority = colorMissing.length
          ? uniquePcs([...colorMissing, ...colors, ...h.pcs.filter((pc) => pc !== pcOfMidi(clarinetNow))])
          : uniquePcs([h.rootPc, ...colors, ...h.pcs.filter((pc) => pc !== pcOfMidi(clarinetNow))]);
        const lower =
          typeof clarinetFloor === "number"
            ? clarinetFloor + 1
            : typeof clarinetNow === "number"
              ? clarinetNow + 1
              : typeof bassNow === "number"
                ? bassNow + 1
                : undefined;
        const upper =
          typeof fluteCeiling === "number" ? fluteCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        let candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower,
          upper
        });
        if (!candidatePool.length) {
          candidatePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
            lower,
            upper
          });
        }
        if (!candidatePool.length) continue;
        const obMidi = pickCandidateNear(
          prevOb,
          priority.length ? priority : h.pcs,
          rOB.midi_low,
          rOB.midi_high,
          oppositeDirection(melodyDirAt(slot.t)),
          {
            lower,
            upper,
            center:
              typeof fluteCeiling === "number" && typeof clarinetFloor === "number"
                ? (fluteCeiling + clarinetFloor) / 2
                : typeof fluteNow === "number" && typeof clarinetNow === "number"
                  ? (fluteNow + clarinetNow) / 2
                  : typeof fluteNow === "number"
                    ? fluteNow - 5
                    : 72,
            avoidPc: missing.length ? [] : typeof clarinetNow === "number" ? [pcOfMidi(clarinetNow) ?? -1] : []
          }
        );
        obEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
        prevOb = obMidi;
      }
    } else {
      for (let beat = 0; beat < measureLen - 1e-6; beat += beatUnit) {
      const slot = { t: beat, dur: Math.min(beatUnit, measureLen - beat) };
      const h = harmonyAt(slot.t);
      const fluteNow = activeMidiAt(melody, slot.t);
      const clarinetNow = activeMidiAt(clEvents, slot.t);
      const bassNow = activeMidiAt(bnEvents, slot.t);
      const fluteCeiling = minMidiDuring(melody, slot.t, slot.dur);
      const clarinetFloor = maxMidiDuring(clEvents, slot.t, slot.dur);
      const covered = new Set<number>();
      for (const pc of [pcOfMidi(fluteNow), pcOfMidi(clarinetNow), pcOfMidi(bassNow)]) {
        if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
      }
      const missing = h.chordCore.filter((pc) => !covered.has(pc));
      const priority = uniquePcs([
        ...missing,
        ...h.pcs.filter((pc) => pc !== pcOfMidi(clarinetNow))
      ]);
      const lower =
        typeof clarinetFloor === "number"
          ? clarinetFloor + 1
          : typeof clarinetNow === "number"
            ? clarinetNow + 1
            : typeof bassNow === "number"
              ? bassNow + 1
              : undefined;
      const upper =
        typeof fluteCeiling === "number" ? fluteCeiling - 1 : typeof fluteNow === "number" ? fluteNow - 1 : undefined;
      let candidatePool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
        lower,
        upper
      });
      if (!candidatePool.length) {
        candidatePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
          lower,
          upper
        });
      }
      if (!candidatePool.length) continue;
      const obMidi = pickCandidateNear(
        prevOb,
        priority.length ? priority : h.pcs,
        rOB.midi_low,
        rOB.midi_high,
        oppositeDirection(melodyDirAt(slot.t)),
        {
          lower,
          upper,
          center:
            typeof fluteCeiling === "number" && typeof clarinetFloor === "number"
              ? (fluteCeiling + clarinetFloor) / 2
              : typeof fluteNow === "number" && typeof clarinetNow === "number"
                ? (fluteNow + clarinetNow) / 2
                : typeof fluteNow === "number"
                  ? fluteNow - 5
                  : 69,
          avoidPc: missing.length ? [] : typeof clarinetNow === "number" ? [pcOfMidi(clarinetNow) ?? -1] : []
        }
      );
      obEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
      prevOb = obMidi;
      }
    }
    for (const ev of obEvents) {
      addNote(shells[1], ev.t, ev.dur, midiToPitch(ev.midi), 1, "OB", ++seq);
    }
  }

  warn(
    options.warnings,
    isAdvanced
      ? "[woodwinds] Advanced polyphonic (40%): Flute melody, Bassoon Alberti bass, Clarinet fills 3rd/5th, Oboe fills root/5th, strict no crossing."
      : isIntermediate
      ? "[woodwinds] Intermediate polyphonic (40%): Flute melody, Bassoon quarter/half bass, Clarinet contrary to Bassoon, Oboe contrary to Flute, strict no crossing."
      : "[woodwinds] Beginner polyphonic (40%): Flute melody, Bassoon quarter/half bass, Clarinet contrary to Bassoon, Oboe contrary to Flute, strict no crossing."
  );
  if (!chords.length) {
    warn(
      options.warnings,
      isAdvanced
        ? "[woodwinds] Advanced polyphonic used source harmony fallback because no chord symbols were found."
        : isIntermediate
        ? "[woodwinds] Intermediate polyphonic used source harmony fallback because no chord symbols were found."
        : "[woodwinds] Beginner polyphonic used source harmony fallback because no chord symbols were found."
    );
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: outParts
  } as any;
}

function mapBeginnerPolyphonicActive(score: ScoreModel, options: WoodwindMapOptions): ScoreModel {
  const srcPart = findSourcePart(score);
  if (!srcPart) return score;
  const level = String(options.level ?? "").toLowerCase();
  const isIntermediate = level === "intermediate";
  const isAdvanced = level === "advanced";

  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const outParts = [fl, ob, cl, bn];

  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures ?? []) {
    const shells = outParts.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;
    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = normalizeChords(score, options);
  const chordsByMeasure = new Map<number, ChordEvent[]>();
  for (const ch of chords) {
    const list = chordsByMeasure.get(ch.measure) ?? [];
    list.push(ch);
    chordsByMeasure.set(ch.measure, list);
  }
  for (const list of chordsByMeasure.values()) list.sort((a, b) => a.t - b.t);

  const rFL = isAdvanced ? { midi_low: 59, midi_high: 98 } : isIntermediate ? { midi_low: 60, midi_high: 91 } : { midi_low: 60, midi_high: 79 };
  const rOB = isAdvanced ? { midi_low: 58, midi_high: 93 } : isIntermediate ? { midi_low: 60, midi_high: 87 } : { midi_low: 62, midi_high: 87 };
  const rCL = isAdvanced ? { midi_low: 52, midi_high: 96 } : isIntermediate ? { midi_low: 52, midi_high: 91 } : { midi_low: 52, midi_high: 84 };
  const rBN = isAdvanced ? { midi_low: 35, midi_high: 76 } : isIntermediate ? { midi_low: 34, midi_high: 67 } : { midi_low: 29, midi_high: 55 };
  const bassoonActivity = options.bassoonActivity ?? "less_active";
  const oboeActivity = options.oboeActivity ?? "less_active";
  const clarinetActivity = options.clarinetActivity ?? "less_active";
  const isIntermediateHighActive =
    isIntermediate &&
    [options.fluteActivity, bassoonActivity, oboeActivity, clarinetActivity].some((activity) => activity === "high_active");
  const isAdvancedHighActive =
    isAdvanced &&
    [options.fluteActivity, bassoonActivity, oboeActivity, clarinetActivity].some((activity) => activity === "high_active");

  let seq = 0;
  let prevOb = 69;
  let prevCl = 60;
  let prevBn = 41;
  const totalMeasures = (srcPart.measures ?? []).length;

  for (let mi = 0; mi < totalMeasures; mi++) {
    const srcMeasure = srcPart.measures[mi];
    const mNum = Number(srcMeasure?.number ?? mi + 1);
    const shells = measureMap[String(mNum)];
    if (!shells) continue;

    const melody = collectRhTopNotes(srcMeasure).map((ev) => ({
      ...ev,
      midi: shiftOctavesIntoRange(ev.midi + 12, rFL.midi_low, rFL.midi_high)
    }));
    for (const ev of melody) {
      addNote(shells[0], ev.t, ev.dur, midiToPitch(ev.midi), 1, "FL", ++seq);
    }

    const chordsHere = chordsByMeasure.get(mNum) ?? [];
    const measureLen = measureBeats(srcMeasure?.attributes);
    const sourceNoteEvents = (srcMeasure?.events ?? [])
      .filter((ev: any) => ev?.type === "note" && ev?.pitch)
      .map((ev: any) => ({ t: Number(ev.t ?? 0), dur: Number(ev.dur ?? 0), midi: pitchToMidi(ev.pitch) }))
      .filter((ev: any) => Number.isFinite(ev.t) && Number.isFinite(ev.dur) && ev.dur > 0 && Number.isFinite(ev.midi));

    const harmonyAt = (t: number) => {
      let activeChord: ChordEvent | null = null;
      for (const ch of chordsHere) {
        if (ch.t <= t + 1e-9) activeChord = ch;
      }
      const activeSourcePcs = uniquePcs(
        sourceNoteEvents.filter((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9).map((ev) => pcOfMidi(ev.midi) ?? 0)
      );
      const sourceBassPc = (() => {
        const active = sourceNoteEvents
          .filter((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9)
          .sort((a, b) => a.midi - b.midi);
        return active.length ? pcOfMidi(active[0]!.midi) : null;
      })();
      const parsed = activeChord ? parseChordSymbol(activeChord.symbol) : null;
      const pcs = uniquePcs(parsed?.pcs?.length ? parsed.pcs : activeSourcePcs);
      const rootPc = parsed?.rootPc ?? pcs[0] ?? sourceBassPc ?? 0;
      const bassPc = activeChord ? (parseBassPc(activeChord.symbol) ?? rootPc) : sourceBassPc ?? rootPc;
      const majThird = (rootPc + 4) % 12;
      const minThird = (rootPc + 3) % 12;
      const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
      const fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;
      const chordCore = uniquePcs(
        [rootPc, thirdPc ?? undefined, fifthPc ?? undefined].filter((x): x is number => typeof x === "number")
      );
      return {
        pcs: pcs.length ? pcs : chordCore,
        rootPc,
        bassPc,
        thirdPc,
        fifthPc,
        chordCore: chordCore.length ? chordCore : pcs
      };
    };

    const melodyDirAt = (t: number): "up" | "down" | "either" => {
      const currentIdx = melody.findIndex((ev) => ev.t - 1e-9 <= t && t < ev.t + ev.dur - 1e-9);
      if (currentIdx <= 0) return "either";
      const current = melody[currentIdx];
      const prev = melody[currentIdx - 1];
      if (!current || !prev) return "either";
      if (current.midi > prev.midi) return "up";
      if (current.midi < prev.midi) return "down";
      return "either";
    };

    const isClosingMeasure = mi >= totalMeasures - 2;
    if (isClosingMeasure && melody.length) {
      const tailBnEvents: Array<{ t: number; dur: number; midi: number }> = [];
      const tailClEvents: Array<{ t: number; dur: number; midi: number }> = [];
      const tailObEvents: Array<{ t: number; dur: number; midi: number }> = [];

      for (const slot of melody) {
        const h = harmonyAt(slot.t);
        const bassPriority =
          bassoonActivity === "high_active" || isAdvanced
            ? [h.bassPc]
            : [h.bassPc, ...pickRootAndFifth(h)];
        const bnMidi = pickCandidateNear(
          prevBn,
          bassPriority,
          rBN.midi_low,
          rBN.midi_high,
          oppositeDirection(melodyDirAt(slot.t)),
          { center: 41 }
        );
        tailBnEvents.push({ t: slot.t, dur: slot.dur, midi: bnMidi });
        prevBn = bnMidi;

        const coveredForClarinet = new Set<number>();
        for (const pc of [pcOfMidi(slot.midi), pcOfMidi(bnMidi)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) coveredForClarinet.add(pc);
        }
        const missingForClarinet = h.chordCore.filter((pc) => !coveredForClarinet.has(pc));
        const clarinetPriority = uniquePcs([
          ...missingForClarinet,
          ...pickThirdAndFifth(h),
          ...h.pcs.filter((pc) => pc !== pcOfMidi(bnMidi))
        ]);
        const clarinetLower = bnMidi + 1;
        const clarinetStrictUpper = slot.midi - 8;
        const clarinetRelaxedUpper = slot.midi - 1;
        let clarinetUpper = clarinetStrictUpper;
        let clarinetPool = candidateMidisForPcs(
          clarinetPriority.length ? clarinetPriority : h.pcs,
          rCL.midi_low,
          rCL.midi_high,
          { lower: clarinetLower, upper: clarinetUpper }
        );
        if (!clarinetPool.length) {
          clarinetUpper = clarinetRelaxedUpper;
          clarinetPool = candidateMidisForPcs(
            clarinetPriority.length ? clarinetPriority : h.pcs,
            rCL.midi_low,
            rCL.midi_high,
            { lower: clarinetLower, upper: clarinetUpper }
          );
        }
        const clMidi = clarinetPool.length
          ? pickCandidateNear(
              prevCl,
              clarinetPriority.length ? clarinetPriority : h.pcs,
              rCL.midi_low,
              rCL.midi_high,
              oppositeDirection(melodyDirAt(slot.t)),
              {
                lower: clarinetLower,
                upper: clarinetUpper,
                center: bnMidi + 4,
                avoidPc: missingForClarinet.length ? [] : [pcOfMidi(bnMidi) ?? -1]
              }
            )
          : shiftOctavesIntoRange(prevCl, rCL.midi_low, rCL.midi_high);
        tailClEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
        prevCl = clMidi;

        const coveredForOboe = new Set<number>();
        for (const pc of [pcOfMidi(slot.midi), pcOfMidi(clMidi), pcOfMidi(bnMidi)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) coveredForOboe.add(pc);
        }
        const missingForOboe = h.chordCore.filter((pc) => !coveredForOboe.has(pc));
        const oboePriority = uniquePcs([
          ...missingForOboe,
          ...pickThirdAndFifth(h),
          ...h.pcs.filter((pc) => pc !== pcOfMidi(clMidi))
        ]);
        const oboeLower = clMidi + 1;
        const oboeUpper = slot.midi - 1;
        let oboePool = candidateMidisForPcs(oboePriority.length ? oboePriority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower: oboeLower,
          upper: oboeUpper
        });
        if (!oboePool.length) {
          oboePool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, {
            lower: oboeLower,
            upper: oboeUpper
          });
        }
        const obMidi = oboePool.length
          ? pickCandidateNear(
              prevOb,
              oboePriority.length ? oboePriority : h.pcs,
              rOB.midi_low,
              rOB.midi_high,
              oppositeDirection(melodyDirAt(slot.t)),
              {
                lower: oboeLower,
                upper: oboeUpper,
                center: (slot.midi + clMidi) / 2,
                avoidPc: missingForOboe.length ? [] : [pcOfMidi(clMidi) ?? -1]
              }
            )
          : shiftOctavesIntoRange(prevOb, rOB.midi_low, rOB.midi_high);
        tailObEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
        prevOb = obMidi;
      }

      for (const ev of tailBnEvents) addNote(shells[3], ev.t, ev.dur, midiToPitch(ev.midi), 1, "BN", ++seq);
      for (const ev of tailClEvents) addNote(shells[2], ev.t, ev.dur, midiToPitch(ev.midi), 1, "CL", ++seq);
      for (const ev of tailObEvents) addNote(shells[1], ev.t, ev.dur, midiToPitch(ev.midi), 1, "OB", ++seq);
      continue;
    }

    const bnEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (bassoonActivity === "high_active") {
      if (isAdvanced) {
        for (let t = 0; t < measureLen - 1e-6; t += 0.5) {
          const dur = Math.min(0.5, measureLen - t);
          const h = harmonyAt(t);
          const rootAndFifth = pickRootAndFifth(h);
          const targetPc = rootAndFifth[Math.round(t / 0.5) % Math.max(1, rootAndFifth.length)] ?? h.rootPc;
          const bnMidi = pickCandidateNear(
            prevBn,
            [targetPc],
            rBN.midi_low,
            rBN.midi_high,
            oppositeDirection(melodyDirAt(t)),
            { center: 43 }
          );
          bnEvents.push({ t, dur, midi: bnMidi });
          addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
          prevBn = bnMidi;
        }
      } else {
        const bassDurations = [0.5, 1, 2];
        let bassT = 0;
        let bassSlotIndex = 0;
        while (bassT < measureLen - 1e-6) {
          const fittingDurations = bassDurations.filter((value) => value <= measureLen - bassT + 1e-9);
          const pickIndex =
            Math.floor(patternRatio(mNum, bassSlotIndex, 419) * Math.max(1, fittingDurations.length)) %
            Math.max(1, fittingDurations.length);
          const dur = fittingDurations[pickIndex] ?? fittingDurations[0] ?? (measureLen - bassT);
          const t = bassT;
          const h = harmonyAt(t);
          const bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(t)), {
            center: 41
          });
          bnEvents.push({ t, dur, midi: bnMidi });
          addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
          prevBn = bnMidi;
          bassT += dur;
          bassSlotIndex += 1;
        }
      }
    } else if (bassoonActivity === "active") {
      if (isAdvanced) {
        for (let t = 0; t < measureLen - 1e-6; t += 0.5) {
          const dur = Math.min(0.5, measureLen - t);
          const h = harmonyAt(t);
          const bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(t)), {
            center: 43
          });
          bnEvents.push({ t, dur, midi: bnMidi });
          addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
          prevBn = bnMidi;
        }
      } else {
        for (const ev of melody) {
          const h = harmonyAt(ev.t);
          const bassChoices = uniquePcs([h.bassPc, ...pickRootAndFifth(h)]);
          const bnMidi = pickCandidateNear(prevBn, bassChoices, rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(ev.t)), {
            center: 41
          });
          bnEvents.push({ t: ev.t, dur: ev.dur, midi: bnMidi });
          addNote(shells[3], ev.t, ev.dur, midiToPitch(bnMidi), 1, "BN", ++seq);
          prevBn = bnMidi;
        }
      }
    } else {
      let bassT = 0;
      for (const dur of buildQuarterHalfPattern(measureLen, mNum, 1)) {
        const h = harmonyAt(bassT);
        const bnMidi = pickCandidateNear(prevBn, [h.bassPc], rBN.midi_low, rBN.midi_high, oppositeDirection(melodyDirAt(bassT)), {
          center: 41
        });
        bnEvents.push({ t: bassT, dur, midi: bnMidi });
        addNote(shells[3], bassT, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
        bassT += dur;
      }
    }

    const obEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (oboeActivity === "high_active") {
      const oboeSlots = isAdvanced
        ? melody.map((ev) => ({ t: ev.t, dur: ev.dur }))
        : (() => {
            const obPattern = buildShuffledRhythmCells(measureLen, mNum, 211);
            const slots: Array<{ t: number; dur: number }> = [];
            let obT = 0;
            for (const rawDur of obPattern) {
              const dur = Math.min(rawDur, measureLen - obT);
              if (dur <= 0.01) break;
              slots.push({ t: obT, dur });
              obT += dur;
            }
            return slots;
          })();
      for (const slot of oboeSlots) {
        const t = slot.t;
        const dur = slot.dur;
        const h = harmonyAt(t);
        const fluteNow = activeMidiAt(melody, t);
        const bassNow = activeMidiAt(bnEvents, t);
        const bassFloor = maxMidiDuring(bnEvents, t, dur);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        const upper = typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const priority = isAdvanced
          ? missing.length
            ? uniquePcs([...missing, ...pickThirdAndFifth(h), ...h.pcs])
            : uniquePcs([h.rootPc, ...pickThirdAndFifth(h), ...h.pcs])
          : missing.length
            ? uniquePcs([
                ...(isAdvanced && typeof h.thirdPc === "number" ? [h.thirdPc] : missing),
                ...pickThirdAndFifth(h),
                ...h.pcs
              ])
            : uniquePcs([
                ...(isAdvanced && typeof h.thirdPc === "number" ? [h.thirdPc] : [h.rootPc]),
                ...pickThirdAndFifth(h),
                ...h.pcs
              ]);
        let pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower,
          upper
        });
        if (!pool.length) {
          pool = candidateMidisForPcs(uniquePcs([h.rootPc, ...h.pcs]), rOB.midi_low, rOB.midi_high, {
            lower,
            upper
          });
        }
        if (!pool.length) {
          continue;
        }
        const obMidi = pickCandidateNear(
          prevOb,
          priority.length ? priority : h.pcs,
          rOB.midi_low,
          rOB.midi_high,
          oppositeDirection(melodyDirAt(t)),
          {
            lower,
            upper,
            center: typeof fluteNow === "number" ? fluteNow - 5 : 69,
            avoidPc:
              missing.length || typeof bassNow !== "number"
                ? []
                : [pcOfMidi(bassNow) ?? -1]
          }
        );
        obEvents.push({ t, dur, midi: obMidi });
        addNote(shells[1], t, dur, midiToPitch(obMidi), 1, "OB", ++seq);
        prevOb = obMidi;
      }
    } else if (oboeActivity === "active") {
      const oboeSlots = isAdvanced
        ? melody.map((ev) => ({ t: ev.t, dur: ev.dur }))
        : isIntermediate
        ? (() => {
            const pattern = buildIntermediateOboeActivePattern(measureLen, mNum);
            const slots: Array<{ t: number; dur: number }> = [];
            let t = 0;
            for (const rawDur of pattern) {
              const dur = Math.min(rawDur, measureLen - t);
              if (dur <= 0.01) break;
              slots.push({ t, dur });
              t += dur;
            }
            return slots;
          })()
        : melody.map((ev) => ({ t: ev.t, dur: ev.dur }));
      for (const slot of oboeSlots) {
        const h = harmonyAt(slot.t);
        const fluteNow = activeMidiAt(melody, slot.t);
        const bassNow = activeMidiAt(bnEvents, slot.t);
        const bassFloor = maxMidiDuring(bnEvents, slot.t, slot.dur);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : undefined;
        const upper = typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        const colors = pickThirdAndFifth(h);
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const priority = isAdvanced
          ? typeof h.thirdPc === "number"
            ? [h.thirdPc]
            : uniquePcs([...colors, ...h.pcs])
          : uniquePcs([...missing, ...colors, ...h.pcs]);
        let pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower,
          upper
        });
        if (!pool.length) {
          pool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, { lower, upper });
        }
        if (!pool.length) continue;
        const obMidi = pickCandidateNear(
          prevOb,
          priority.length ? priority : h.pcs,
          rOB.midi_low,
          rOB.midi_high,
          oppositeDirection(melodyDirAt(slot.t)),
          {
            lower,
            upper,
            center: typeof fluteNow === "number" ? fluteNow - 5 : 69,
            avoidPc:
              missing.length ? [] : typeof bassNow === "number" ? [pcOfMidi(bassNow) ?? -1] : []
          }
        );
        obEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
        addNote(shells[1], slot.t, slot.dur, midiToPitch(obMidi), 1, "OB", ++seq);
        prevOb = obMidi;
      }
    } else {
      for (let beat = 0; beat < measureLen - 1e-6; beat += 1) {
        const slot = { t: beat, dur: Math.min(1, measureLen - beat) };
        const h = harmonyAt(slot.t);
        const fluteNow = activeMidiAt(melody, slot.t);
        const bassNow = activeMidiAt(bnEvents, slot.t);
        const bassFloor = maxMidiDuring(bnEvents, slot.t, slot.dur);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        const upper = typeof fluteNow === "number" ? fluteNow - 1 : undefined;
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const priority = uniquePcs([...missing, ...pickThirdAndFifth(h), ...h.pcs]);
        let pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rOB.midi_low, rOB.midi_high, {
          lower,
          upper
        });
        if (!pool.length) {
          pool = candidateMidisForPcs(h.pcs, rOB.midi_low, rOB.midi_high, { lower, upper });
        }
        if (!pool.length) continue;
        const obMidi = pickCandidateNear(
          prevOb,
          priority.length ? priority : h.pcs,
          rOB.midi_low,
          rOB.midi_high,
          oppositeDirection(melodyDirAt(slot.t)),
          {
            lower,
            upper,
            center: typeof fluteNow === "number" ? fluteNow - 5 : 69
          }
        );
        obEvents.push({ t: slot.t, dur: slot.dur, midi: obMidi });
        addNote(shells[1], slot.t, slot.dur, midiToPitch(obMidi), 1, "OB", ++seq);
        prevOb = obMidi;
      }
    }

    const clEvents: Array<{ t: number; dur: number; midi: number }> = [];
    if (clarinetActivity === "high_active") {
      const clarinetSlots = isAdvanced
        ? (() => {
            const slots: Array<{ t: number; dur: number }> = [];
            for (let t = 0; t < measureLen - 1e-6; t += 1) {
              slots.push({ t, dur: Math.min(1, measureLen - t) });
            }
            return slots;
          })()
        : (() => {
            const clPattern = buildShuffledRhythmCells(measureLen, mNum, 307);
            const slots: Array<{ t: number; dur: number }> = [];
            let clT = 0;
            for (const rawDur of clPattern) {
              const dur = Math.min(rawDur, measureLen - clT);
              if (dur <= 0.01) break;
              slots.push({ t: clT, dur });
              clT += dur;
            }
            return slots;
          })();
      for (const slot of clarinetSlots) {
        const t = slot.t;
        const dur = slot.dur;
        const h = harmonyAt(t);
        const seqPcs = pickChordToneSequence(h, 4);
        const idx = Math.round(t) % Math.max(1, seqPcs.length);
        const targetPc = seqPcs.length ? seqPcs[idx]! : (h.rootPc ?? 0);
        const fluteNow = activeMidiAt(melody, t);
        const bassNow = activeMidiAt(bnEvents, t);
        const oboeNow = activeMidiAt(obEvents, t);
        const bassFloor = maxMidiDuring(bnEvents, t, dur);
        const oboeCeiling = minMidiDuring(obEvents, t, dur);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        const upper =
          typeof oboeCeiling === "number"
            ? oboeCeiling - 1
            : typeof fluteNow === "number"
              ? fluteNow - 9
              : undefined;
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow), pcOfMidi(oboeNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const arpeggioPcs = pickChordToneSequence(h, 4);
        const arpeggioTargetPc =
          arpeggioPcs.length && isAdvanced
            ? arpeggioPcs[Math.floor(t) % arpeggioPcs.length]!
            : targetPc;
        const priority = missing.length
          ? uniquePcs([
              ...(isAdvanced ? pickThirdAndFifth(h).filter((pc) => missing.includes(pc)) : missing),
              arpeggioTargetPc,
              ...pickThirdAndFifth(h),
              ...h.pcs
            ])
          : uniquePcs([
              ...(isAdvanced ? [h.rootPc] : [h.rootPc]),
              arpeggioTargetPc,
              ...pickThirdAndFifth(h),
              ...h.pcs
            ]);
        let pool = candidateMidisForPcs(priority.length ? priority : [arpeggioTargetPc], rCL.midi_low, rCL.midi_high, {
          lower,
          upper
        });
        if (!pool.length) {
          pool = candidateMidisForPcs(uniquePcs([h.rootPc, ...(seqPcs.length ? seqPcs : h.pcs)]), rCL.midi_low, rCL.midi_high, {
            lower,
            upper
          });
        }
        if (!pool.length) continue;
        const clMidi = pickCandidateNear(
          prevCl,
          priority.length ? priority : [arpeggioTargetPc, ...(seqPcs.length ? seqPcs : h.pcs)],
          rCL.midi_low,
          rCL.midi_high,
          oppositeDirection(melodyDirAt(t)),
          {
            lower,
            upper,
            center:
              typeof oboeNow === "number" && typeof bassNow === "number" ? (oboeNow + bassNow) / 2 : 60,
            avoidPc:
              missing.length || typeof oboeNow !== "number"
                ? []
                : [pcOfMidi(oboeNow) ?? -1]
          }
        );
        clEvents.push({ t, dur, midi: clMidi });
        addNote(shells[2], t, dur, midiToPitch(clMidi), 1, "CL", ++seq);
        prevCl = clMidi;
      }
    } else if (clarinetActivity === "active") {
      const clarinetSlots = isAdvanced
        ? buildRestedEighthThreeSlots(measureLen)
        : (() => {
            const r = measureRatio(mNum, 611);
            const stepDur = r < 0.1 ? 0.5 : r < 0.4 ? 2 : 1;
            const slots: Array<{ t: number; dur: number }> = [];
            for (let t = 0; t < measureLen - 1e-6; t += stepDur) {
              slots.push({ t, dur: Math.min(stepDur, measureLen - t) });
            }
            return slots;
          })();
      for (const slot of clarinetSlots) {
        const t = slot.t;
        const dur = slot.dur;
        const h = harmonyAt(t);
        const fluteNow = activeMidiAt(melody, t);
        const bassNow = activeMidiAt(bnEvents, t);
        const oboeNow = activeMidiAt(obEvents, t);
        const bassFloor = maxMidiDuring(bnEvents, t, dur);
        const oboeCeiling = minMidiDuring(obEvents, t, dur);
        const covered = new Set<number>();
        for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow), pcOfMidi(oboeNow)]) {
          if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
        }
        const missing = h.chordCore.filter((pc) => !covered.has(pc));
        const colors = pickThirdAndFifth(h);
        const priority = isAdvanced
          ? (() => {
              const rootPc = h.rootPc;
              const fifthPc = typeof h.fifthPc === "number" ? h.fifthPc : null;
              const rootFifth = uniquePcs(
                [fifthPc ?? undefined, rootPc ?? undefined].filter((pc): pc is number => typeof pc === "number")
              );
              const rootFifthMissing = rootFifth.filter((pc) => missing.includes(pc));
              return rootFifthMissing.length
                ? uniquePcs([...rootFifthMissing, ...rootFifth, ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))])
                : uniquePcs([...rootFifth, ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))]);
            })()
          : uniquePcs([...missing, ...colors, ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))]);
        const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
        const upper =
          typeof oboeCeiling === "number"
            ? oboeCeiling - 1
            : typeof fluteNow === "number"
              ? fluteNow - 9
              : undefined;
        let pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
          lower,
          upper
        });
        if (!pool.length) {
          pool = candidateMidisForPcs(h.pcs, rCL.midi_low, rCL.midi_high, { lower, upper });
        }
        if (!pool.length) continue;
        const clMidi = pickCandidateNear(
          prevCl,
          priority.length ? priority : h.pcs,
          rCL.midi_low,
          rCL.midi_high,
          oppositeDirection(melodyDirAt(t)),
          {
            lower,
            upper,
            center:
              typeof oboeCeiling === "number" && typeof bassFloor === "number" ? (oboeCeiling + bassFloor) / 2 : 60
          }
        );
        clEvents.push({ t, dur, midi: clMidi });
        addNote(shells[2], t, dur, midiToPitch(clMidi), 1, "CL", ++seq);
        prevCl = clMidi;
      }
    } else {
      for (let i = 0; i < bnEvents.length; i++) {
        const bnEv = bnEvents[i]!;
        const nextBn = bnEvents[i + 1];
        const slots =
          Math.abs(bnEv.dur - 2) < 1e-6
            ? [
                { t: bnEv.t, dur: 1 },
                { t: bnEv.t + 1, dur: 1 }
              ]
            : Math.abs(bnEv.dur - 1) < 1e-6 && nextBn && Math.abs(nextBn.dur - 1) < 1e-6
              ? [{ t: bnEv.t, dur: 2 }]
              : [{ t: bnEv.t, dur: bnEv.dur }];
        const prevBnMidi = i > 0 ? bnEvents[i - 1]?.midi ?? null : null;
        const bnDir =
          typeof prevBnMidi === "number"
            ? bnEv.midi > prevBnMidi
              ? "up"
              : bnEv.midi < prevBnMidi
                ? "down"
                : "either"
            : "either";
        const preferDir = oppositeDirection(bnDir);
        for (const slot of slots) {
          const h = harmonyAt(slot.t);
          const fluteNow = activeMidiAt(melody, slot.t);
          const bassNow = activeMidiAt(bnEvents, slot.t);
          const oboeCeiling = minMidiDuring(obEvents, slot.t, slot.dur);
          const bassFloor = maxMidiDuring(bnEvents, slot.t, slot.dur);
          const covered = new Set<number>();
          for (const pc of [pcOfMidi(fluteNow), pcOfMidi(bassNow), pcOfMidi(activeMidiAt(obEvents, slot.t))]) {
            if (typeof pc === "number" && h.chordCore.includes(pc)) covered.add(pc);
          }
          const missing = h.chordCore.filter((pc) => !covered.has(pc));
          const priority = uniquePcs([...missing, ...h.pcs.filter((pc) => pc !== pcOfMidi(bassNow))]);
          const lower = typeof bassFloor === "number" ? bassFloor + 1 : typeof bassNow === "number" ? bassNow + 1 : undefined;
          const upper =
            typeof oboeCeiling === "number"
              ? oboeCeiling - 1
              : typeof fluteNow === "number"
                ? fluteNow - 8
                : undefined;
          let pool = candidateMidisForPcs(priority.length ? priority : h.pcs, rCL.midi_low, rCL.midi_high, {
            lower,
            upper
          });
          if (!pool.length) {
            pool = candidateMidisForPcs(h.pcs, rCL.midi_low, rCL.midi_high, { lower, upper });
          }
          if (!pool.length) continue;
          const clMidi = pickCandidateNear(
            prevCl,
            priority.length ? priority : h.pcs,
            rCL.midi_low,
            rCL.midi_high,
            preferDir,
            {
              lower,
              upper,
              center:
                typeof oboeCeiling === "number" && typeof bassFloor === "number" ? (oboeCeiling + bassFloor) / 2 : 60
            }
          );
          clEvents.push({ t: slot.t, dur: slot.dur, midi: clMidi });
          addNote(shells[2], slot.t, slot.dur, midiToPitch(clMidi), 1, "CL", ++seq);
          prevCl = clMidi;
        }
        if (Math.abs(bnEv.dur - 1) < 1e-6 && nextBn && Math.abs(nextBn.dur - 1) < 1e-6) i += 1;
      }
    }
  }

  warn(
    options.warnings,
    isAdvanced
      ? isAdvancedHighActive
        ? "[woodwinds] Advanced polyphonic (100%): string-inspired high activity, Bassoon roots/fifths in 8ths, Clarinet quarter-note arpeggios, Oboe melody-rhythm contrary harmonic fill."
        : "[woodwinds] Advanced polyphonic (60%): Flute melody, Bassoon 8ths on chord bass, Clarinet shuffled color cells, Oboe shuffled gap-fill cells, strict no crossing."
      : isIntermediate
      ? isIntermediateHighActive
        ? "[woodwinds] Intermediate polyphonic (100%): string-inspired high activity, independent lines, strict no crossing."
        : "[woodwinds] Intermediate polyphonic active profile: per-instrument activity respected, strict no crossing."
      : "[woodwinds] Beginner polyphonic active profile: per-instrument activity respected, strict no crossing."
  );
  if (!chords.length) {
    warn(
      options.warnings,
      isAdvanced
        ? "[woodwinds] Advanced polyphonic used source harmony fallback because no chord symbols were found."
        : isIntermediate
        ? "[woodwinds] Intermediate polyphonic used source harmony fallback because no chord symbols were found."
        : "[woodwinds] Beginner polyphonic used source harmony fallback because no chord symbols were found."
    );
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: outParts
  } as any;
}

function mapBeginnerHomophonic(score: ScoreModel, options: WoodwindMapOptions): ScoreModel {
  const srcPart = findSourcePart(score);
  if (!srcPart) return score;
  const level = String(options.level ?? "").toLowerCase();
  const isIntermediate = level === "intermediate";
  const isAdvanced = level === "advanced";
  const isUpperHomophonic = isIntermediate || isAdvanced;

  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const outParts = [fl, ob, cl, bn];

  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures ?? []) {
    const shells = outParts.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;
    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = normalizeChords(score, options);
  const chordsByMeasure = new Map<number, ChordEvent[]>();
  for (const ch of chords) {
    const list = chordsByMeasure.get(ch.measure) ?? [];
    list.push(ch);
    chordsByMeasure.set(ch.measure, list);
  }
  for (const list of chordsByMeasure.values()) {
    list.sort((a, b) => a.t - b.t);
  }

  // Homophonic ranges by level (strict no-crossing order):
  // Beginner:
  //   Flute C4-G5, Oboe D4-Eb6, Clarinet E3-C6, Bassoon F1-G3.
  // Intermediate:
  //   Flute C4-G6, Oboe C4-Eb6, Clarinet E3-G6, Bassoon Bb1-G4.
  // Advanced:
  //   Flute B3-D7, Oboe Bb3-A6, Clarinet E3-C7, Bassoon B1-E5.
  const rFL = isAdvanced
    ? { midi_low: 59, midi_high: 98, preferred_low: 67, preferred_high: 89 }
    : isIntermediate
      ? { midi_low: 60, midi_high: 91, preferred_low: 67, preferred_high: 84 }
      : { midi_low: 60, midi_high: 79, preferred_low: 67, preferred_high: 77 };
  const rOB = isAdvanced
    ? { midi_low: 58, midi_high: 93, preferred_low: 64, preferred_high: 86 }
    : isIntermediate
      ? { midi_low: 60, midi_high: 87, preferred_low: 65, preferred_high: 82 }
      : { midi_low: 62, midi_high: 87, preferred_low: 67, preferred_high: 82 };
  const rCL = isAdvanced
    ? { midi_low: 52, midi_high: 96, preferred_low: 60, preferred_high: 88 }
    : isIntermediate
      ? { midi_low: 52, midi_high: 91, preferred_low: 60, preferred_high: 84 }
      : { midi_low: 52, midi_high: 84, preferred_low: 60, preferred_high: 79 };
  const rBN = isAdvanced
    ? { midi_low: 35, midi_high: 76, preferred_low: 40, preferred_high: 60 }
    : isIntermediate
      ? { midi_low: 34, midi_high: 67, preferred_low: 38, preferred_high: 55 }
      : { midi_low: 29, midi_high: 55, preferred_low: 34, preferred_high: 50 };

  let seq = 0;
  let prevOb: number | null = null;
  let prevCl: number | null = null;
  let prevBn: number | null = null;
  let activeChord: ChordEvent | null = null;

  for (let mi = 0; mi < (srcPart.measures ?? []).length; mi++) {
    const srcMeasure = srcPart.measures[mi];
    const mNum = Number(srcMeasure?.number ?? mi + 1);
    const shells = measureMap[String(mNum)];
    if (!shells) continue;

    const melody = collectRhTopNotes(srcMeasure);
    const onsetPcs = collectOnsetPcs(srcMeasure);
    const chordsHere = chordsByMeasure.get(mNum) ?? [];
    const mBeats = measureBeats(srcMeasure?.attributes);
    const bassPlan: Array<{ t: number; dur: number; midi: number }> = [];

    if (chordsHere.length) {
      for (let ci = 0; ci < chordsHere.length; ci++) {
        const ch = chordsHere[ci]!;
        const nextT = ci + 1 < chordsHere.length ? chordsHere[ci + 1]!.t : mBeats;
        const dur = Math.max(0.25, nextT - ch.t);
        const bassPc = parseBassPc(ch.symbol);
        if (bassPc === null) continue;
        const bnMidi =
          chooseMidiForPc(bassPc, { min: rBN.midi_low, max: rBN.midi_high }, {
            center: 41,
            prev: prevBn
          }) ?? shiftOctavesToward(41, rBN.midi_low, rBN.midi_high, 41);
        bassPlan.push({ t: ch.t, dur, midi: bnMidi });
        addNote(shells[3], ch.t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
      }
    } else {
      const lh = (srcMeasure?.events ?? [])
        .filter((ev: any) => ev?.type === "note" && ev?.pitch)
        .map((ev: any) => ({ ev, midi: pitchToMidi(ev.pitch) }))
        .filter((x: any) => Number.isFinite(x.midi) && Number(x.ev?.staff ?? 2) === 2);
      const byT = new Map<number, number[]>();
      for (const n of lh) {
        const t = Number(n.ev?.t ?? 0);
        const list = byT.get(t) ?? [];
        list.push(n.midi);
        byT.set(t, list);
      }
      const times = Array.from(byT.keys()).sort((a, b) => a - b);
      for (let ti = 0; ti < times.length; ti++) {
        const t = times[ti]!;
        const nextT = ti + 1 < times.length ? times[ti + 1]! : mBeats;
        const dur = Math.max(0.25, nextT - t);
        const low = Math.min(...(byT.get(t) ?? [41]));
        const bnMidi = shiftOctavesToward(low, rBN.midi_low, rBN.midi_high, 41);
        bassPlan.push({ t, dur, midi: bnMidi });
        addNote(shells[3], t, dur, midiToPitch(bnMidi), 1, "BN", ++seq);
        prevBn = bnMidi;
      }
    }

    const bassAt = (t: number): number | null => {
      let active: { t: number; midi: number } | null = null;
      for (const b of bassPlan) {
        if (b.t - 1e-9 <= t && t < b.t + b.dur - 1e-9) {
          if (!active || b.t > active.t) active = { t: b.t, midi: b.midi };
        }
      }
      return active?.midi ?? null;
    };

    let chordIdx = 0;

    for (const mEv of melody) {
      while (chordIdx < chordsHere.length && chordsHere[chordIdx]!.t <= mEv.t + 1e-9) {
        activeChord = chordsHere[chordIdx]!;
        chordIdx += 1;
      }

      const fluteSourceMidi = isUpperHomophonic ? mEv.midi + 12 : mEv.midi;
      const flMidi = shiftOctavesIntoRange(fluteSourceMidi, rFL.midi_low, rFL.midi_high);
      addNote(shells[0], mEv.t, mEv.dur, midiToPitch(flMidi), 1, "FL", ++seq);

      const melodyPc = ((flMidi % 12) + 12) % 12;
      const parsed = activeChord ? parseChordSymbol(activeChord.symbol) : null;
      const bassPc = activeChord ? (parseBassPc(activeChord.symbol) ?? parsed?.rootPc ?? melodyPc) : melodyPc;
      const fallbackPcs = onsetPcs.get(mEv.t) ?? [melodyPc];
      const pcs = uniquePcs(parsed?.pcs?.length ? parsed.pcs : fallbackPcs);
      const rootPc = parsed?.rootPc ?? pcs[0] ?? melodyPc;
      const majThird = (rootPc + 4) % 12;
      const minThird = (rootPc + 3) % 12;
      const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : null;
      const fifthPc = pcs.includes((rootPc + 7) % 12) ? (rootPc + 7) % 12 : null;

      const preferred = uniquePcs(
        [
          thirdPc ?? undefined,
          fifthPc ?? undefined,
          rootPc,
          ...pcs.filter((pc) => pc !== melodyPc && pc !== bassPc)
        ].filter((x): x is number => typeof x === "number")
      );
      const harmonyPcs = preferred.length ? preferred : uniquePcs([rootPc, bassPc]);
      const bassMidi = bassAt(mEv.t);

      let obMidi: number | null = null;
      let clMidi: number | null = null;

      if (isUpperHomophonic) {
        const requiredPcs = uniquePcs(
          [rootPc, thirdPc ?? undefined, fifthPc ?? undefined].filter((x): x is number => typeof x === "number")
        );
        const chordCore = requiredPcs.length ? requiredPcs : harmonyPcs;

        const coveredBefore = new Set<number>();
        for (const pc of [melodyPc, bassPc]) {
          if (chordCore.includes(pc)) coveredBefore.add(pc);
        }
        const missingBefore = chordCore.filter((pc) => !coveredBefore.has(pc));
        const obPriority = uniquePcs([...missingBefore, ...harmonyPcs]);
        let obChosenPc: number | null = null;

        for (const pc of obPriority) {
          const pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
            center: Math.min(flMidi - 4, rOB.preferred_high ?? rOB.midi_high),
            prev: prevOb,
            upper: flMidi - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
          });
          if (pick !== null) {
            obMidi = pick;
            obChosenPc = pc;
            break;
          }
        }
        if (obMidi === null) {
          obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);
          obChosenPc = ((obMidi % 12) + 12) % 12;
        }

        const coveredAfterOb = new Set<number>(coveredBefore);
        if (obChosenPc !== null && chordCore.includes(obChosenPc)) coveredAfterOb.add(obChosenPc);
        const missingAfterOb = chordCore.filter((pc) => !coveredAfterOb.has(pc));
        const chordComplete = missingAfterOb.length === 0;

        const clPriority = chordComplete
          ? uniquePcs([obChosenPc ?? undefined, ...harmonyPcs].filter((x): x is number => typeof x === "number"))
          : uniquePcs([
              ...missingAfterOb,
              ...harmonyPcs.filter((pc) => pc !== obChosenPc),
              ...harmonyPcs.filter((pc) => pc === obChosenPc)
            ]);

        for (const pc of clPriority) {
          const pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
            center: Math.min((obMidi ?? flMidi) - 5, rCL.preferred_high ?? rCL.midi_high),
            prev: prevCl,
            upper: (obMidi ?? flMidi) - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
          });
          if (pick !== null) {
            clMidi = pick;
            break;
          }
        }
        if (clMidi === null) clMidi = shiftOctavesToward((obMidi ?? flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
      } else {
        for (const pc of harmonyPcs) {
          const pick = chooseMidiForPc(pc, { min: rOB.midi_low, max: rOB.midi_high }, {
            center: Math.min(flMidi - 4, rOB.preferred_high ?? rOB.midi_high),
            prev: prevOb,
            upper: flMidi - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 2 : undefined
          });
          if (pick !== null) {
            obMidi = pick;
            break;
          }
        }
        if (obMidi === null) obMidi = shiftOctavesToward(flMidi - 5, rOB.midi_low, rOB.midi_high, 74);

        for (const pc of harmonyPcs) {
          const pick = chooseMidiForPc(pc, { min: rCL.midi_low, max: rCL.midi_high }, {
            center: Math.min((obMidi ?? flMidi) - 5, rCL.preferred_high ?? rCL.midi_high),
            prev: prevCl,
            upper: (obMidi ?? flMidi) - 1,
            lower: typeof bassMidi === "number" ? bassMidi + 1 : undefined
          });
          if (pick !== null) {
            clMidi = pick;
            break;
          }
        }
        if (clMidi === null) clMidi = shiftOctavesToward((obMidi ?? flMidi) - 5, rCL.midi_low, rCL.midi_high, 69);
      }

      if (obMidi! >= flMidi) obMidi = shiftOctavesIntoRange(flMidi - 1, rOB.midi_low, rOB.midi_high);
      if (clMidi! >= obMidi!) clMidi = shiftOctavesIntoRange(obMidi! - 1, rCL.midi_low, rCL.midi_high);
      if (typeof bassMidi === "number" && clMidi! <= bassMidi) {
        const lifted = shiftOctavesIntoRange(bassMidi + 1, rCL.midi_low, rCL.midi_high);
        clMidi = lifted < obMidi! ? lifted : clMidi;
      }
      if (clMidi! >= obMidi!) {
        const raisedOb = shiftOctavesIntoRange(clMidi! + 1, rOB.midi_low, rOB.midi_high);
        if (raisedOb < flMidi) obMidi = raisedOb;
      }
      if (clMidi! >= obMidi!) clMidi = Math.max(rCL.midi_low, Math.min(rCL.midi_high, obMidi! - 1));

      addNote(shells[1], mEv.t, mEv.dur, midiToPitch(obMidi!), 1, "OB", ++seq);
      addNote(shells[2], mEv.t, mEv.dur, midiToPitch(clMidi!), 1, "CL", ++seq);
      prevOb = obMidi!;
      prevCl = clMidi!;
    }
  }

  if (!chords.length) {
    warn(
      options.warnings,
      `[woodwinds] ${isAdvanced ? "Advanced" : isIntermediate ? "Intermediate" : "Beginner"} homophonic: no chord hints found, bassoon used source bass notes.`
    );
  } else {
    warn(
      options.warnings,
      isAdvanced
        ? "[woodwinds] Advanced homophonic applied (Flute melody +8ve, strict advanced ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
        : isIntermediate
          ? "[woodwinds] Intermediate homophonic applied (Flute melody +8ve, strict intermediate ranges, no crossing, Bassoon chord bass, Oboe/Clarinet missing-tone harmony)."
          : "[woodwinds] Beginner homophonic applied (Flute original melody pitch, strict beginner ranges, no crossing, Bassoon chord bass, Oboe/Clarinet harmony)."
    );
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ...(score.meta ?? {}), ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: outParts
  } as any;
}

function mapLegacyOpen(score: ScoreModel): ScoreModel {
  const fl = makePart("FL", "Flute", "flute", 1);
  const ob = makePart("OB", "Oboe", "oboe", 1);
  const cl = makePart("CL", "Clarinet in Bb", "clarinet_bb", 1);
  const bn = makePart("BN", "Bassoon", "bassoon", 1);
  const partsOut = [fl, ob, cl, bn];

  const srcPart = score.parts[0];
  if (!srcPart) return score;
  const measureMap: Record<string, any[]> = {};
  for (const m of srcPart.measures) {
    const shells = partsOut.map(() => cloneMeasureShell(m));
    measureMap[String(m.number)] = shells;

    fl.measures.push(shells[0]);
    ob.measures.push(shells[1]);
    cl.measures.push(shells[2]);
    bn.measures.push(shells[3]);
  }

  const chords = extractOnsetChords(score);

  const rFL = InstrumentCatalog.flute;
  const rOB = InstrumentCatalog.oboe;
  const rCL = InstrumentCatalog.clarinet_bb;
  const rBN = InstrumentCatalog.bassoon;

  const CENTER_FL = 79;
  const CENTER_OB = 74;
  const CENTER_CL = 69;
  const CENTER_BN = 46;

  let seq = 0;
  for (const ch of chords) {
    const shells = measureMap[String(ch.measure)];
    if (!shells) continue;

    const notes = ch.notes.slice().sort((a, b) => a.midi - b.midi);
    if (notes.length === 0) continue;

    const t = ch.t;
    const dur = Math.max(...notes.map((n) => (n as any).dur ?? 1), 1);

    const pick = (idx: number) => notes[Math.min(Math.max(idx, 0), notes.length - 1)]!.midi;

    const low = pick(0);
    const mid1 = pick(Math.floor((notes.length - 1) * 0.33));
    const mid2 = pick(Math.floor((notes.length - 1) * 0.66));
    const high = pick(notes.length - 1);

    let mBN = low;
    let mCL = mid1;
    let mOB = mid2;
    let mFL = high;

    mBN = shiftOctavesToward(mBN, rBN.midi_low, rBN.midi_high, CENTER_BN);
    mCL = shiftOctavesToward(mCL, rCL.midi_low, rCL.midi_high, CENTER_CL);
    mOB = shiftOctavesToward(mOB, rOB.midi_low, rOB.midi_high, CENTER_OB);
    mFL = shiftOctavesToward(mFL, rFL.midi_low, rFL.midi_high, CENTER_FL);

    if (mCL < mBN) mCL = shiftOctavesToward(mCL + 12, rCL.midi_low, rCL.midi_high, CENTER_CL);
    if (mOB < mCL) mOB = shiftOctavesToward(mOB + 12, rOB.midi_low, rOB.midi_high, CENTER_OB);
    if (mFL < mOB) mFL = shiftOctavesToward(mFL + 12, rFL.midi_low, rFL.midi_high, CENTER_FL);

    addNote(shells[0], t, dur, midiToPitch(mFL), 1, "FL", ++seq);
    addNote(shells[1], t, dur, midiToPitch(mOB), 1, "OB", ++seq);
    addNote(shells[2], t, dur, midiToPitch(mCL), 1, "CL", ++seq);
    addNote(shells[3], t, dur, midiToPitch(mBN), 1, "BN", ++seq);
  }

  return {
    score_id: `ARR_${Math.random().toString(16).slice(2, 10)}`,
    meta: { ensemble: "woodwind_ensemble" },
    global: { ...score.global },
    parts: partsOut
  } as any;
}

/**
 * Woodwind ensemble mapping (concert pitch view):
 * Flute (C), Oboe (C), Clarinet in Bb (shows concert pitch), Bassoon (C)
 */
export function mapPianoToWoodwindEnsembleOpen(score: ScoreModel, options: WoodwindMapOptions = {}): ScoreModel {
  if (
    polyphonicProfile(options) === "beginner_less_active" ||
    polyphonicProfile(options) === "intermediate_less_active" ||
    polyphonicProfile(options) === "advanced_less_active"
  ) {
    return mapBeginnerPolyphonicLessActive(score, options);
  }
  if (
    polyphonicProfile(options) === "beginner_active" ||
    polyphonicProfile(options) === "intermediate_active" ||
    polyphonicProfile(options) === "intermediate_high_active" ||
    polyphonicProfile(options) === "advanced_active" ||
    polyphonicProfile(options) === "advanced_high_active"
  ) {
    return mapBeginnerPolyphonicActive(score, options);
  }
  if (homophonicLevel(options)) {
    return mapBeginnerHomophonic(score, options);
  }
  return mapLegacyOpen(score);
}
