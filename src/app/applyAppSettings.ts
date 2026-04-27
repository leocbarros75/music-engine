import type { ScoreModel } from "../score/types";
import fs from "fs";
import path from "path";
import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { applyChoralRhythmFromMelody } from "../rhythm/applyChoralRhythmFromMelody";
import {
  applyPolyphonicBassCounterRhythm,
  applyPolyphonicTenorCounterRhythm,
  applyPolyphonicAltoCounterRhythm
} from "../rhythm/applyPolyphonicBassCounterRhythm";
import { applyRhythmToBassFinalCadence } from "../rhythm/applyRhythmToBassFinalCadence";
import { analyzeTexture } from "../texture/textureAnalyzer";
import { arrangePianoFromSatb } from "../arrange/arrangePianoFromSatb";
import { arrangeStringEnsembleFromSatb } from "../arrange/arrangeStringEnsembleFromSatb";
import { arrangeStringQuartetFromPianoInstrumentation } from "../arrange/arrangeStringQuartetFromPianoInstrumentation";
import { arrangeWoodwindQuartetFromPianoInstrumentation } from "../arrange/arrangeWoodwindQuartetFromPianoInstrumentation";
import { arrangeStringEnsemble } from "../arrange/strings/stringArranger";
import { applyStringPolyphonicRhythm } from "../arrange/strings/stringRhythm";
import { arrangeStringPolyphonic } from "../arrange/stringsPolyphony/stringsPolyphonicArranger";
import { mapPianoToWoodwindEnsembleOpen } from "../arrange/mapToWoodwindEnsemble";
import { mapPianoToBrassEnsembleOpen } from "../arrange/mapToBrassEnsemble";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

export type AppSettings = {
  title?: string;
  ensemble?: string;
  keySignature?: string;
  keyFifths?: number;
  keySignatureMode?: "original" | "manual";
  targetKey?: string;
  timeSignature?: string;
  timeSignatureMode?: "original" | "manual";
  tempo?: number;
  style?: string;
  level?: "beginner" | "intermediate" | "advanced" | "professional";
  accompanimentType?: string;
  accompaniment?: string;
  ruleStrictness?: "relaxed" | "standard" | "strict";
  textureMode?: string;
  styleProfile?: string;
  modernMode?: string;
  bassActivity?: "grounded" | "less_active" | "active" | "high_active";
  tenorActivity?: "grounded" | "less_active" | "active" | "high_active";
  altoActivity?: "grounded" | "less_active" | "active" | "high_active";
  sopranoActivity?: "grounded" | "less_active" | "active" | "high_active";
  vln1Activity?: "grounded" | "less_active" | "active" | "high_active";
  vln2Activity?: "grounded" | "less_active" | "active" | "high_active";
  vlaActivity?: "grounded" | "less_active" | "active" | "high_active";
  vcActivity?: "grounded" | "less_active" | "active" | "high_active";
  cbActivity?: "grounded" | "less_active" | "active" | "high_active";
  sopranoMelodyShare?: number;
  randomizeOffsets?: boolean;
  pianoStylePreset?: string;
  pianoStylePresetPath?: string;
  useStringEnsembleArranger?: boolean;
  instrumentation?:
    | "auto"
    | "piano_copy_to_string_quartet"
    | "satb_to_string_quartet"
    | "piano_copy_to_woodwind_quartet"
    | "satb_to_woodwind_quartet";
};

export type ApplySettingsResult = {
  scoreModel: ScoreModel;
  warnings: string[];
  detectedInputKeyFifths: number;
  appliedTransposeSemitones: number;
  styleUsed: string;
  cadenceMeasures: number[];
};

type ChordEvent = {
  measure: number;
  t: number;
  symbol: string;
};

type PitchSpelling = { step: string; alter: number };

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

function getTempoBpmFromSettings(score: ScoreModel, settings?: AppSettings): number {
  const tempo = Number(settings?.tempo ?? score.meta?.tempo_bpm);
  if (Number.isFinite(tempo) && tempo > 0) return tempo;
  return 120;
}

function isSimpleSixteenthCell(cell: number[]): boolean {
  const sixteenthCount = cell.filter((d) => Math.abs(d - 0.25) < 1e-6).length;
  if (sixteenthCount === 0) return true;
  return sixteenthCount <= 2 && cell.length <= 4;
}

function filterCellsForTempo(cells: number[][], tempoBpm: number): number[][] {
  if (!Number.isFinite(tempoBpm) || tempoBpm <= 0) return cells;
  if (tempoBpm > 132) {
    return cells.filter((cell) => cell.every((d) => d >= 0.5 - 1e-6));
  }
  return cells.filter((cell) => isSimpleSixteenthCell(cell));
}

function getKeyInfo(score: ScoreModel): { value: number; found: boolean; mode: "major" | "minor" | null } {
  const m0 = score.parts?.[0]?.measures?.[0];
  const fifths = (m0 as any)?.attributes?.key_fifths;
  const rawMode = String((m0 as any)?.attributes?.key_mode ?? "").toLowerCase();
  const mode = rawMode === "minor" || rawMode === "major" ? (rawMode as "major" | "minor") : null;
  if (typeof fifths === "number" && Number.isFinite(fifths)) return { value: fifths, found: true, mode };
  return { value: 0, found: false, mode };
}

function extractMelodyEventsForStrings(score: ScoreModel, octaveShift = 0): Record<number, NoteEvent[]> {
  const parts = score.parts ?? [];
  const melodyPart =
    parts.find((p: any) => {
      const name = String(p?.name ?? "").toLowerCase();
      return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    }) ?? parts[0];
  const out: Record<number, NoteEvent[]> = {};
  for (const m of melodyPart?.measures ?? []) {
    const mNum = Number(m?.number) || 1;
    const events: NoteEvent[] = [];
    for (const ev of m?.events ?? []) {
      if (!ev || (ev.type !== "note" && ev.type !== "rest")) continue;
      if (ev.type === "note") {
        const midi = typeof ev.midi === "number" ? ev.midi : ev.pitch ? pitchToMidi(ev.pitch) : null;
        if (midi === null) continue;
        events.push({
          id: `vln1-src-${mNum}-${ev.t}`,
          t: Number(ev.t ?? 0),
          dur: Number(ev.dur ?? 0),
          type: "note",
          pitch: midiToPitch(midi + octaveShift),
          voice: 1,
          staff: 1
        } as any);
      } else {
        events.push({
          id: `vln1-src-${mNum}-${ev.t}`,
          t: Number(ev.t ?? 0),
          dur: Number(ev.dur ?? 0),
          type: "rest",
          voice: 1,
          staff: 1,
          isRest: true
        } as any);
      }
    }
    out[mNum] = events;
  }
  return out;
}

function setKeyFifths(score: ScoreModel, fifths: number, mode?: "major" | "minor"): void {
  for (const part of score.parts ?? []) {
    const m0 = part.measures?.[0];
    if (!m0) continue;
    if (!m0.attributes) m0.attributes = {};
    (m0.attributes as any).key_fifths = fifths;
    if (mode) (m0.attributes as any).key_mode = mode;
  }
}

function parseKeySignature(input: string): { fifths: number; mode: "major" | "minor" } | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const lower = raw.toLowerCase();
  const isMinor = lower.includes("minor") || /m$/.test(lower);
  const match = lower.match(/^\s*([a-g])\s*([#b]?)/i);
  if (!match) return null;

  const step = match[1].toUpperCase();
  const acc = match[2] ?? "";
  const keyName = `${step}${acc}`;

  const MAJOR: Record<string, number> = {
    C: 0,
    G: 1,
    D: 2,
    A: 3,
    E: 4,
    B: 5,
    "F#": 6,
    "C#": 7,
    F: -1,
    Bb: -2,
    Eb: -3,
    Ab: -4,
    Db: -5,
    Gb: -6,
    Cb: -7
  };

  const MINOR: Record<string, number> = {
    A: 0,
    E: 1,
    B: 2,
    "F#": 3,
    "C#": 4,
    "G#": 5,
    "D#": 6,
    "A#": 7,
    D: -1,
    G: -2,
    C: -3,
    F: -4,
    Bb: -5,
    Eb: -6,
    Ab: -7
  };

  const map = isMinor ? MINOR : MAJOR;
  if (keyName in map) {
    return { fifths: map[keyName]!, mode: isMinor ? "minor" : "major" };
  }

  return null;
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

function attachTextureAnalysis(scoreModel: ScoreModel, warnings: string[]): void {
  try {
    const report = analyzeTexture(scoreModel);
    (scoreModel.meta as any) = { ...(scoreModel.meta ?? {}), textureAnalysis: report };
  } catch (err: any) {
    warnings.push(`[texture] Texture analysis failed: ${err?.message ?? String(err)}`);
  }
}

function computeTransposeSemitones(params: {
  detectedFifths: number;
  detectedMode: "major" | "minor";
  targetFifths: number;
  targetMode: "major" | "minor";
}): number {
  const { detectedFifths, detectedMode, targetFifths, targetMode } = params;
  const fromPc = detectedMode === "minor" ? tonicPcFromFifthsMinor(detectedFifths) : tonicPcFromFifthsMajor(detectedFifths);
  const toPc = targetMode === "minor" ? tonicPcFromFifthsMinor(targetFifths) : tonicPcFromFifthsMajor(targetFifths);
  let diff = (toPc - fromPc + 12) % 12;
  if (diff > 6) diff -= 12;
  return diff;
}

function transposeScoreModel(score: ScoreModel, semitones: number): void {
  if (!semitones) return;
  for (const part of score.parts ?? []) {
    for (const measure of part.measures ?? []) {
      for (const ev of measure.events ?? []) {
        if (ev.type !== "note" || !ev.pitch) continue;
        const midi = pitchToMidi(ev.pitch as any);
        const shifted = midi + semitones;
        (ev as any).midi = shifted;
        (ev as any).pitch = midiToPitch(shifted);
      }
    }
  }
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

function parseBassFromChordSymbol(symbolRaw: string): { pc: number; spelling: PitchSpelling } | null {
  const s = String(symbolRaw || "").trim();
  if (!s) return null;

  let main = s;
  let slashBass: string | null = null;
  if (s.includes("/")) {
    const parts = s.split("/");
    main = (parts[0] ?? "").trim();
    slashBass = (parts[1] ?? "").trim();
  }

  const rootMatch = main.match(/^([A-Ga-g][#b]?)/);
  if (!rootMatch) return null;
  const rootTok = rootMatch[1]!;
  const rootInfo = parseRootTokenWithSpelling(rootTok);
  if (!rootInfo) return null;

  const bassInfo = slashBass ? parseRootTokenWithSpelling(slashBass) : null;
  return bassInfo ?? rootInfo;
}

function pitchWithSpelling(midi: number, spelling: PitchSpelling | null | undefined) {
  const base = midiToPitch(midi);
  if (!spelling) return base;
  const basePc = ((midi % 12) + 12) % 12;
  const targetPc = (STEP_TO_PC[spelling.step] + (spelling.alter ?? 0) + 12) % 12;
  if (basePc !== targetPc) return base;
  return { step: spelling.step, alter: spelling.alter, octave: base.octave };
}

function measureBeatsFromAttributes(attrs: any | undefined): number {
  const beats = Number(attrs?.time?.beats ?? 4);
  const beatType = Number(attrs?.time?.beat_type ?? 4);
  if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) return 4;
  return beats * (4 / beatType);
}

function chooseBassMidiWithLeapLimit(
  pcTarget: number,
  prevMidi: number,
  range: { min: number; max: number },
  anchorMidi = 43,
  maxLeap = 12
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (((m % 12) + 12) % 12 === pcTarget) candidates.push(m);
  }
  if (!candidates.length) return prevMidi;

  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const anchorPenalty = Math.abs(c - anchorMidi);
    const smoothPenalty = Math.abs(c - prevMidi) * 0.35;
    const score = anchorPenalty + smoothPenalty;
    if (score < bestScore) {
      best = c;
      bestScore = score;
    }
  }

  if (Math.abs(best - prevMidi) <= maxLeap) return best;
  const alt = candidates.filter((c) => Math.abs(c - prevMidi) <= maxLeap);
  if (!alt.length) return best;

  let bestAlt = alt[0]!;
  let bestAltScore = Number.POSITIVE_INFINITY;
  for (const c of alt) {
    const anchorPenalty = Math.abs(c - anchorMidi);
    const smoothPenalty = Math.abs(c - prevMidi) * 0.35;
    const score = anchorPenalty + smoothPenalty;
    if (score < bestAltScore) {
      bestAlt = c;
      bestAltScore = score;
    }
  }
  return bestAlt;
}

function pickAlternatePc(primaryPc: number, parsed: { rootPc: number; pcs: number[] } | null): number {
  if (!parsed || !Array.isArray(parsed.pcs) || parsed.pcs.length === 0) return primaryPc;
  const rootPc = parsed.rootPc;
  if (primaryPc !== rootPc) return rootPc;
  const fifth = (rootPc + 7) % 12;
  if (parsed.pcs.includes(fifth)) return fifth;
  const thirdMaj = (rootPc + 4) % 12;
  const thirdMin = (rootPc + 3) % 12;
  if (parsed.pcs.includes(thirdMaj)) return thirdMaj;
  if (parsed.pcs.includes(thirdMin)) return thirdMin;
  const alt = parsed.pcs.find((pc) => pc !== primaryPc);
  return typeof alt === "number" ? alt : primaryPc;
}

function buildBeginnerPattern(segmentBeats: number, melodyDensity: number, polyphonic: boolean): number[] {
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const beats = Math.round(segmentBeats * 1000) / 1000;

  if (polyphonic) {
    if (beats >= 2 && Number.isInteger(beats)) {
      return Array.from({ length: beats }, () => 1);
    }
    return [beats];
  }

  if (beats >= 4) {
    if (melodyDensity >= 6) return [beats];
    return [beats / 2, beats / 2];
  }
  if (beats >= 2) {
    if (melodyDensity >= 6) return [beats];
    if (Math.abs(beats - 2) < 1e-6) return [1, 1];
    return [beats];
  }
  return [beats];
}

function buildBeginnerChordVoicing(params: {
  anchorMidi: number;
  parsed: { rootPc: number; pcs: number[] } | null;
  range: { min: number; max: number };
  maxNotes?: number;
}): number[] {
  const { anchorMidi, parsed, range } = params;
  const maxNotes = Math.max(1, params.maxNotes ?? 3);
  const anchorPc = ((anchorMidi % 12) + 12) % 12;
  const pcs = Array.isArray(parsed?.pcs) && parsed!.pcs.length ? parsed!.pcs : [anchorPc];

  const ordered = pcs
    .slice()
    .sort((a, b) => {
      const da = (a - anchorPc + 12) % 12;
      const db = (b - anchorPc + 12) % 12;
      return da - db;
    });

  const midis: number[] = [];
  for (const pc of ordered) {
    let m = anchorMidi + ((pc - anchorPc + 12) % 12);
    while (m < range.min && m + 12 <= anchorMidi + 12) m += 12;
    if (m < anchorMidi) m = anchorMidi;
    if (m > range.max || m > anchorMidi + 12) continue;
    if (!midis.includes(m)) midis.push(m);
    if (midis.length >= maxNotes) break;
  }

  if (!midis.length) return [anchorMidi];
  return midis;
}

function pickMidiForPcWithinRange(
  pc: number,
  range: { min: number; max: number },
  preferredAbove?: number
): number | null {
  const targetPc = ((pc % 12) + 12) % 12;
  if (typeof preferredAbove === "number") {
    for (let m = Math.max(range.min, preferredAbove + 1); m <= range.max; m++) {
      if (((m % 12) + 12) % 12 === targetPc) return m;
    }
  }
  for (let m = range.max; m >= range.min; m--) {
    if (((m % 12) + 12) % 12 === targetPc) return m;
  }
  return null;
}

function buildDyadVoicing(params: {
  bassMidi: number;
  parsed: { rootPc: number; pcs: number[] } | null;
  range: { min: number; max: number };
}): number[] {
  const bassPc = ((params.bassMidi % 12) + 12) % 12;
  const rootPc = params.parsed?.rootPc ?? bassPc;
  const fifthPc = (rootPc + 7) % 12;
  const preferred = bassPc === rootPc ? fifthPc : rootPc;
  let upper = pickMidiForPcWithinRange(preferred, params.range, params.bassMidi);
  if (upper === null || upper === params.bassMidi) {
    const fallbackPc = preferred === rootPc ? fifthPc : rootPc;
    upper = pickMidiForPcWithinRange(fallbackPc, params.range, params.bassMidi);
  }
  if (upper === null || upper === params.bassMidi) return [params.bassMidi];
  return [params.bassMidi, upper];
}

function normalizeChordalActivity(activity?: string): "less_active" | "active" | "high_active" {
  switch (activity) {
    case "high_active":
      return "high_active";
    case "active":
      return "active";
    case "less_active":
    case "grounded":
    default:
      return "less_active";
  }
}

const CHORDAL_RHYTHM_CELLS: number[][] = [
  [1],
  [0.5, 0.5],
  [0.25, 0.25, 0.5],
  [0.5, 0.25, 0.25],
  [0.75, 0.25]
];

function pickChordalCell(measureNumber: number, beatIndex: number, tempoBpm: number): number[] {
  const filtered = filterCellsForTempo(CHORDAL_RHYTHM_CELLS, tempoBpm);
  const pool = filtered.length ? filtered : CHORDAL_RHYTHM_CELLS;
  const group = Math.floor((measureNumber - 1) / 8);
  const seed = (group * 1315423911 + Math.round(beatIndex * 1000) * 2654435761) >>> 0;
  const idx = seed % pool.length;
  return pool[idx] ?? [1];
}

function buildChordalPattern(segmentBeats: number, measureNumber: number, startBeat: number, tempoBpm: number): number[] {
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const out: number[] = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let beatOffset = 0;
  while (remaining > 1e-6) {
    if (remaining < 1 - 1e-6) {
      out.push(remaining);
      break;
    }
    const cell = pickChordalCell(measureNumber, startBeat + beatOffset, tempoBpm);
    out.push(...cell);
    remaining -= 1;
    beatOffset += 1;
  }
  return out;
}

type ArpToken = "bass" | "root" | "third" | "fifth" | "passing";

const ARP_PATTERNS_EIGHTH: ArpToken[][] = [
  ["bass", "fifth", "root", "fifth", "third", "fifth", "root", "fifth"],
  ["bass", "fifth", "root", "third", "fifth", "root", "third", "fifth"]
];

const ARP_PATTERNS_QUARTER: ArpToken[][] = [
  ["bass", "fifth", "root", "third"],
  ["bass", "root", "third", "fifth"]
];

const WORSHIP_LH_CELLS_LESS: number[][] = [
  [4],
  [2, 2],
  [3, 1],
  [1.5, 0.5, 1, 1],
  [1, 1, 2]
];

const WORSHIP_LH_CELLS_ACTIVE: number[][] = [
  [1, 1, 1, 1],
  [1.5, 0.5, 1, 1],
  [0.5, 0.5, 1, 1, 1],
  [0.5, 0.5, 0.5, 0.5, 1, 1],
  [1, 0.75, 0.25, 0.5, 0.5, 1],
  [0.75, 0.25, 1, 0.5, 0.5, 1],
  [0.75, 0.25, 0.5, 0.5, 0.25, 0.25, 0.5, 1],
  [2, 1, 1]
];

const WORSHIP_LH_CELLS_HIGH: number[][] = [
  [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  [0.5, 0.5, 1, 1, 1],
  [0.5, 0.5, 0.5, 0.5, 1, 1],
  [0.75, 0.25, 0.5, 0.5, 0.5, 0.5, 1],
  [0.25, 0.25, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
  [1, 0.5, 0.5, 0.5, 0.5, 1],
  [1.5, 0.5, 0.5, 0.5, 1],
  [1, 1, 0.5, 0.5, 1]
];

const WORSHIP_TOKEN_SEQ_LESS: ArpToken[] = ["bass", "fifth", "root", "third"];
const WORSHIP_TOKEN_SEQ_ACTIVE: ArpToken[] = ["bass", "fifth", "third", "root", "fifth", "third", "root"];
const WORSHIP_TOKEN_SEQ_HIGH: ArpToken[] = [
  "bass",
  "fifth",
  "third",
  "root",
  "fifth",
  "third",
  "root",
  "fifth",
  "third",
  "root"
];

function pickLowestMidiForPcWithinRange(pc: number, range: { min: number; max: number }): number | null {
  const targetPc = ((pc % 12) + 12) % 12;
  for (let m = range.min; m <= range.max; m++) {
    if (((m % 12) + 12) % 12 === targetPc) return m;
  }
  return null;
}

let cachedAlbertiPattern: ArpToken[] | null = null;

function loadAlbertiPatternTokens(): ArpToken[] {
  if (cachedAlbertiPattern) return cachedAlbertiPattern;
  const fallback: ArpToken[] = ["bass", "fifth", "third", "fifth"];
  try {
    const filePath = path.join(process.cwd(), "rules", "rhythm", "rhythm_patterns.json");
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    const pattern = Array.isArray(data?.alberti?.pattern) ? data.alberti.pattern : null;
    if (!pattern || !pattern.length) {
      cachedAlbertiPattern = fallback;
      return cachedAlbertiPattern;
    }
    const mapped = pattern
      .map((token: any) => String(token || "").toLowerCase())
      .map((token) => {
        if (token === "low" || token === "bass") return "bass";
        if (token === "high") return "fifth";
        if (token === "mid") return "third";
        if (token === "root") return "root";
        if (token === "third") return "third";
        if (token === "fifth") return "fifth";
        return null;
      })
      .filter((t: ArpToken | null): t is ArpToken => t !== null);
    cachedAlbertiPattern = mapped.length ? mapped : fallback;
    return cachedAlbertiPattern;
  } catch {
    cachedAlbertiPattern = fallback;
    return cachedAlbertiPattern;
  }
}

function resolveChordToneMap(params: {
  parsed: { rootPc: number; pcs: number[] } | null;
  bassInfo: { pc: number } | null;
}): { bassPc: number; rootPc: number; thirdPc: number; fifthPc: number; pcs: number[] } {
  const rootPc = params.parsed?.rootPc ?? params.bassInfo?.pc ?? 0;
  const bassPc = params.bassInfo?.pc ?? rootPc;
  const pcs = Array.isArray(params.parsed?.pcs) && params.parsed!.pcs.length ? params.parsed!.pcs : [rootPc];
  const majThird = (rootPc + 4) % 12;
  const minThird = (rootPc + 3) % 12;
  const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : rootPc;
  const fifthPc = pcs.includes((rootPc + 7) % 12)
    ? (rootPc + 7) % 12
    : pcs.find((pc) => pc !== rootPc && pc !== thirdPc) ?? rootPc;
  return { bassPc, rootPc, thirdPc, fifthPc, pcs };
}

function scalePcsFromKey(fifths: number, mode: "major" | "minor"): number[] {
  const tonic = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
  const intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map((i) => (tonic + i) % 12);
}

function findScaleNeighborMidi(
  baseMidi: number,
  scalePcs: number[],
  dir: 1 | -1,
  min: number,
  max: number
): number | null {
  const set = new Set(scalePcs);
  for (let i = 1; i <= 12; i++) {
    const m = baseMidi + dir * i;
    if (m < min || m > max) break;
    const p = ((m % 12) + 12) % 12;
    if (set.has(p)) return m;
  }
  return null;
}

function buildArpeggioSteps(params: {
  segmentBeats: number;
  activity: "less_active" | "active" | "high_active";
  measureNumber: number;
}): Array<{ dur: number; token: ArpToken }> {
  const { segmentBeats, activity, measureNumber } = params;
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const stepDur = activity === "less_active" ? 1 : 0.5;
  const patterns = activity === "less_active" ? ARP_PATTERNS_QUARTER : ARP_PATTERNS_EIGHTH;
  const pattern = patterns[measureNumber % patterns.length] ?? patterns[0]!;

  const out: Array<{ dur: number; token: ArpToken }> = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  while (remaining > 1e-6) {
    const dur = remaining < stepDur - 1e-6 ? remaining : stepDur;
    const token = pattern[idx % pattern.length]!;
    out.push({ dur, token });
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
  }
  return out;
}

function buildWorshipArpeggioSteps(params: {
  segmentBeats: number;
  activity: "less_active" | "active" | "high_active";
  measureNumber: number;
  startBeat: number;
  level?: "beginner" | "intermediate" | "advanced" | "professional";
  tempoBpm?: number;
}): Array<{ dur: number; token: ArpToken }> {
  const { segmentBeats, activity, measureNumber, startBeat, level, tempoBpm } = params;
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  if (activity === "active" && level === "advanced") {
    const weights = [
      { value: 1, weight: 40 },
      { value: 0.5, weight: 40 },
      { value: 2, weight: 20 }
    ];
    const out: Array<{ dur: number; token: ArpToken }> = [];
    let remaining = Math.round(segmentBeats * 1000) / 1000;
    let idx = 0;
    let tokIdx = 0;
    while (remaining > 1e-6) {
      const seed = (measureNumber * 1315423911 + Math.round((startBeat + idx) * 1000) * 2654435761) >>> 0;
      let dur = pickWeighted(weights, seed);
      if (dur > remaining + 1e-6) {
        const allowed = weights
          .map((w) => w.value)
          .filter((v) => v <= remaining + 1e-6)
          .sort((a, b) => b - a);
        dur = allowed[0] ?? remaining;
      }
      const token = WORSHIP_TOKEN_SEQ_ACTIVE[tokIdx % WORSHIP_TOKEN_SEQ_ACTIVE.length] ?? "bass";
      out.push({ dur, token });
      remaining = Math.round((remaining - dur) * 1000) / 1000;
      idx += 1;
      tokIdx += 1;
    }
    return out;
  }
  const cells =
    activity === "high_active"
      ? WORSHIP_LH_CELLS_HIGH
      : activity === "active"
        ? WORSHIP_LH_CELLS_ACTIVE
        : WORSHIP_LH_CELLS_LESS;
  const tokenSeq =
    activity === "high_active"
      ? WORSHIP_TOKEN_SEQ_HIGH
      : activity === "active"
        ? WORSHIP_TOKEN_SEQ_ACTIVE
        : WORSHIP_TOKEN_SEQ_LESS;

  const tempo = Number.isFinite(tempoBpm) && Number(tempoBpm) > 0 ? Number(tempoBpm) : 120;
  const filtered = filterCellsForTempo(cells, tempo);
  const pool = filtered.length ? filtered : cells;
  const group = Math.floor((measureNumber - 1) / 8);
  const seed = (group * 1315423911 + Math.round(startBeat * 1000) * 2654435761) >>> 0;
  const cell = pool[seed % pool.length] ?? pool[0] ?? [segmentBeats];

  const out: Array<{ dur: number; token: ArpToken }> = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  let tokIdx = 0;
  while (remaining > 1e-6) {
    let dur = cell[idx % cell.length] ?? remaining;
    if (dur > remaining) dur = remaining;
    const token = tokenSeq[tokIdx % tokenSeq.length] ?? "bass";
    out.push({ dur, token });
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
    tokIdx += 1;
  }
  return out;
}

function buildAlbertiSteps(params: {
  segmentBeats: number;
  measureNumber: number;
  startBeat: number;
  activity: "less_active" | "active" | "high_active";
}): Array<{ dur: number; token: ArpToken }> {
  const { segmentBeats, measureNumber, startBeat, activity } = params;
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const pattern = loadAlbertiPatternTokens();
  const out: Array<{ dur: number; token: ArpToken }> = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  const allowEighths = activity === "less_active";
  const eighthRatio = 0.3;
  while (remaining > 1e-6) {
    if (allowEighths) {
      const beatDur = remaining >= 1 ? 1 : remaining;
      const seed = (measureNumber * 73856093) ^ (Math.round((startBeat + idx) * 1000) * 19349663);
      const roll = ((seed >>> 0) % 1000) / 1000;
      const split = beatDur >= 1 && roll < eighthRatio;
      if (split) {
        for (let k = 0; k < 2; k++) {
          let token = pattern[idx % pattern.length] ?? "bass";
          out.push({ dur: 0.5, token });
          idx += 1;
        }
        remaining = Math.round((remaining - 1) * 1000) / 1000;
        continue;
      }
      let token = pattern[idx % pattern.length] ?? "bass";
      out.push({ dur: beatDur, token });
      remaining = Math.round((remaining - beatDur) * 1000) / 1000;
      idx += 1;
      continue;
    }

    const dur = remaining < 0.5 - 1e-6 ? remaining : 0.5;
    let token = pattern[idx % pattern.length] ?? "bass";
    if ((activity === "active" || activity === "high_active") && token === "third") {
      const swap = (measureNumber * 7 + Math.round(startBeat * 2) + idx) % 4 === 0;
      if (swap) token = "passing";
    }
    out.push({ dur, token });
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
  }
  return out;
}

function buildBeginnerWorshipBassSteps(params: {
  segmentBeats: number;
  measureNumber: number;
  startBeat: number;
  activity: "less_active" | "active" | "high_active";
}): Array<{ dur: number; token: ArpToken }> {
  const { segmentBeats, measureNumber, startBeat, activity } = params;
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];

  const weights =
    activity === "high_active"
      ? [
          { value: 4, weight: 15 },
          { value: 2, weight: 20 },
          { value: 1, weight: 40 },
          { value: 0.5, weight: 25 }
        ]
      : activity === "active"
        ? [
            { value: 4, weight: 30 },
            { value: 2, weight: 25 },
            { value: 1, weight: 45 }
          ]
        : [
            { value: 4, weight: 60 },
            { value: 2, weight: 40 }
          ];

  const out: Array<{ dur: number; token: ArpToken }> = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  const pattern: ArpToken[] = ["bass", "third", "fifth", "third"];

  while (remaining > 1e-6) {
    const seed = (measureNumber * 73856093) ^ (Math.round((startBeat + idx) * 1000) * 19349663);
    let dur = pickWeighted(weights, seed);
    if (dur > remaining + 1e-6) {
      const allowed = weights
        .map((w) => w.value)
        .filter((v) => v <= remaining + 1e-6)
        .sort((a, b) => b - a);
      dur = allowed[0] ?? remaining;
    }
    const token = dur >= 2 ? "bass" : pattern[idx % pattern.length] ?? "bass";
    out.push({ dur, token });
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
  }
  return out;
}

function applyPianoPolyphonicArpeggioBass(
  scoreModel: ScoreModel,
  chords: ChordEvent[],
  warnings: string[],
  options?: {
    activity?: "grounded" | "less_active" | "active" | "high_active";
    worship?: boolean;
    level?: "beginner" | "intermediate" | "advanced" | "professional";
    tempoBpm?: number;
  }
): boolean {
  if (!Array.isArray(chords) || chords.length === 0) {
    warnings.push("[piano] Polyphonic arpeggio skipped: no chord events available.");
    return false;
  }

  const parts = scoreModel.parts ?? [];
  const melodyPart =
    parts.find((p: any) => {
      const name = String(p?.name ?? "").toLowerCase();
      return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    }) ?? parts[0];
  const bassPart =
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("bass")) ??
    (parts.length ? parts[parts.length - 1] : null);

  if (!melodyPart || !bassPart) {
    warnings.push("[piano] Polyphonic arpeggio skipped: missing melody or bass part.");
    return false;
  }

  const activity = normalizeChordalActivity(options?.activity);
  const isWorship = options?.worship === true;
  const level = (options?.level ?? "beginner") as "beginner" | "intermediate" | "advanced" | "professional";
  const isBeginner = level === "beginner";
  const range = level === "advanced" ? { min: 40, max: 52 } : { min: 40, max: 64 }; // E2..E3 or E2..E4
  const allowArp = activity !== "grounded";
  if (!allowArp) {
    warnings.push("[piano] Polyphonic arpeggio skipped: activity grounded.");
    return false;
  }
  const tempoBpm =
    typeof options?.tempoBpm === "number" && Number.isFinite(options.tempoBpm)
      ? options.tempoBpm
      : getTempoBpmFromSettings(scoreModel);

  const keyInfo = getKeyInfo(scoreModel);
  const keyMode = keyInfo.mode ?? "major";
  const scalePcs = scalePcsFromKey(keyInfo.value, keyMode);

  const measures = bassPart.measures ?? [];
  const measureNumbers = measures.map((m: any, idx: number) => Number(m?.number ?? idx + 1));
  const lastTwo = measureNumbers.slice(-2);

  const newMeasures: any[] = [];
  let prevMidi = 43;
  let lastChord: ChordEvent | null = null;

  for (let i = 0; i < measures.length; i++) {
    const bMeasure = measures[i];
    const mMeasure = melodyPart.measures?.[i];
    if (!bMeasure || !mMeasure) continue;
    const measureNumber = Number(bMeasure.number ?? mMeasure.number ?? i + 1);
    const attrs = bMeasure.attributes ?? mMeasure.attributes ?? {};
    const measureBeats = measureBeatsFromAttributes(attrs);

    const inMeasure = chords
      .filter((c) => Number(c.measure) === measureNumber)
      .map((c) => ({ ...c, t: Number(c.t) }))
      .filter((c) => Number.isFinite(c.t))
      .sort((a, b) => Number(a.t) - Number(b.t));

    const events: any[] = [];
    let chordEvents = inMeasure.slice();

    if (!chordEvents.length && lastChord) {
      chordEvents = [{ ...lastChord, t: 0 }];
    } else if (chordEvents.length && chordEvents[0]!.t > 0) {
      const base = lastChord ?? chordEvents[0]!;
      chordEvents = [{ ...base, t: 0 }, ...chordEvents];
    }

    if (!chordEvents.length) {
      events.push({ type: "rest", t: 0, dur: measureBeats });
      newMeasures.push({ number: measureNumber, attributes: attrs, events });
      continue;
    }

    if (lastTwo.includes(measureNumber)) {
      const melEvents = (mMeasure?.events ?? []).filter((e: any) => e && (e.type === "note" || e.type === "rest"));
      for (const ev of melEvents) {
        if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number") continue;
        const chord = pickChordForTime(chords, measureNumber, Number(ev.t));
        if (!chord) {
          events.push({ type: "rest", t: ev.t, dur: ev.dur });
          continue;
        }
        const bassInfo = parseBassFromChordSymbol(chord.symbol);
        if (!bassInfo) {
          events.push({ type: "rest", t: ev.t, dur: ev.dur });
          continue;
        }
        const midi = chooseBassMidiWithLeapLimit(bassInfo.pc, prevMidi, range, 43, 12);
        events.push({
          type: "note",
          t: ev.t,
          dur: ev.dur,
          midi,
          pitch: pitchWithSpelling(midi, bassInfo.spelling)
        });
        prevMidi = midi;
      }

      newMeasures.push({ number: measureNumber, attributes: attrs ? { ...attrs } : undefined, events });
      lastChord = chordEvents[chordEvents.length - 1] ?? lastChord;
      continue;
    }

    for (let ci = 0; ci < chordEvents.length; ci++) {
      const chord = chordEvents[ci]!;
      const start = Math.max(0, Number(chord.t) || 0);
      const end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1]!.t) : measureBeats;
      const segDur = Math.max(0, Math.min(end, measureBeats) - start);
      if (segDur <= 0) continue;

      const bassInfo = parseBassFromChordSymbol(chord.symbol);
      const parsed = parseChordSymbol(chord.symbol);
      const map = resolveChordToneMap({ parsed: parsed as any, bassInfo });
      const steps = isBeginner && isWorship
        ? buildBeginnerWorshipBassSteps({ segmentBeats: segDur, activity, measureNumber, startBeat: start })
        : isBeginner
          ? buildAlbertiSteps({ segmentBeats: segDur, activity, measureNumber, startBeat: start })
          : isWorship
            ? buildWorshipArpeggioSteps({ segmentBeats: segDur, activity, measureNumber, startBeat: start, level, tempoBpm })
            : buildArpeggioSteps({ segmentBeats: segDur, activity, measureNumber });
      let cursor = start;
      const bassAnchor =
        pickLowestMidiForPcWithinRange(map.bassPc, range) ??
        chooseBassMidiWithLeapLimit(map.bassPc, prevMidi, range, 43, 12);

      for (const step of steps) {
        const strongBeat = Math.abs(cursor - Math.round(cursor)) < 1e-6;
        const chordBoundary = chordEvents.some((c) => Math.abs(Number(c.t) - cursor) < 1e-6);
        const blockPassing = strongBeat || chordBoundary;
        let pc = map.rootPc;
        if (step.token === "bass") pc = map.bassPc;
        if (step.token === "third") pc = map.thirdPc;
        if (step.token === "fifth") pc = map.fifthPc;

        let midi =
          step.token === "bass"
            ? bassAnchor
            : pickMidiForPcWithinRange(pc, range, bassAnchor) ?? bassAnchor;

        if (step.token === "passing") {
          if (!blockPassing) {
            const dir: 1 | -1 = (measureNumber + Math.round(cursor * 2)) % 2 === 0 ? 1 : -1;
            const neighbor =
              findScaleNeighborMidi(prevMidi ?? bassAnchor, scalePcs, dir, range.min, range.max) ?? null;
            if (neighbor !== null) {
              midi = neighbor;
            }
          } else {
            const chordPc = map.bassPc ?? map.rootPc;
            midi = pickMidiForPcWithinRange(chordPc, range, bassAnchor) ?? bassAnchor;
          }
        }

        if (step.token === "bass" && bassInfo?.spelling) {
          events.push({
            type: "note",
            t: cursor,
            dur: step.dur,
            midi,
            pitch: pitchWithSpelling(midi, bassInfo.spelling)
          });
        } else {
          events.push({ type: "note", t: cursor, dur: step.dur, midi, pitch: midiToPitch(midi) });
        }

        prevMidi = midi;
        cursor += step.dur;
      }
    }

    newMeasures.push({ number: measureNumber, attributes: attrs ? { ...attrs } : undefined, events });
    lastChord = chordEvents[chordEvents.length - 1] ?? lastChord;
  }

  bassPart.measures = newMeasures;
  warnings.push(`[piano] Polyphonic arpeggio applied (activity=${activity}, left-hand arpeggio).`);
  return true;
}

function applyBeginnerPianoAccompaniment(
  scoreModel: ScoreModel,
  chords: ChordEvent[],
  warnings: string[],
  options?: { activity?: "grounded" | "less_active" | "active" | "high_active"; tempoBpm?: number }
): boolean {
  if (!Array.isArray(chords) || chords.length === 0) {
    warnings.push("[piano] Beginner accompaniment skipped: no chord events available.");
    return false;
  }

  const parts = scoreModel.parts ?? [];
  const melodyPart =
    parts.find((p: any) => {
      const name = String(p?.name ?? "").toLowerCase();
      return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    }) ?? parts[0];
  const bassPart =
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("bass")) ??
    (parts.length ? parts[parts.length - 1] : null);

  if (!melodyPart || !bassPart) {
    warnings.push("[piano] Beginner accompaniment skipped: missing melody or bass part.");
    return false;
  }

  const range = { min: 40, max: 64 }; // E2..E4
  let prevMidi = 43;
  let lastChord: ChordEvent | null = null;
  const activity = normalizeChordalActivity(options?.activity);
  const useRhythmCells = activity === "high_active";
  const tempoBpm =
    typeof options?.tempoBpm === "number" && Number.isFinite(options.tempoBpm)
      ? options.tempoBpm
      : getTempoBpmFromSettings(scoreModel);

  const newMeasures: any[] = [];
  for (let i = 0; i < (bassPart.measures ?? []).length; i++) {
    const bMeasure = bassPart.measures?.[i];
    const mMeasure = melodyPart.measures?.[i];
    if (!bMeasure || !mMeasure) continue;
    const measureNumber = Number(bMeasure.number ?? mMeasure.number ?? i + 1);
    const attrs = bMeasure.attributes ?? mMeasure.attributes ?? {};
    const measureBeats = measureBeatsFromAttributes(attrs);

    const melodyEvents = (mMeasure.events ?? []).filter((e: any) => e && e.type === "note");
    const melodyDensity = melodyEvents.length;

    const inMeasure = chords
      .filter((c) => Number(c.measure) === measureNumber)
      .map((c) => ({ ...c, t: Number(c.t) }))
      .filter((c) => Number.isFinite(c.t))
      .sort((a, b) => Number(a.t) - Number(b.t));

    const events: any[] = [];
    let chordEvents = inMeasure.slice();

    if (!chordEvents.length && lastChord) {
      chordEvents = [{ ...lastChord, t: 0 }];
    } else if (chordEvents.length && chordEvents[0]!.t > 0) {
      const base = lastChord ?? chordEvents[0]!;
      chordEvents = [{ ...base, t: 0 }, ...chordEvents];
    }

    if (!chordEvents.length) {
      events.push({ type: "rest", t: 0, dur: measureBeats });
      newMeasures.push({ number: measureNumber, attributes: attrs, events });
      continue;
    }

    for (let ci = 0; ci < chordEvents.length; ci++) {
      const chord = chordEvents[ci]!;
      const start = Math.max(0, Number(chord.t) || 0);
      const end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1]!.t) : measureBeats;
      const segDur = Math.max(0, Math.min(end, measureBeats) - start);
      if (segDur <= 0) continue;

      const bassInfo = parseBassFromChordSymbol(chord.symbol);
      const parsed = parseChordSymbol(chord.symbol);
      const primaryPc = bassInfo?.pc ?? parsed?.rootPc ?? 0;
      const primarySpelling = bassInfo?.spelling ?? null;

      const pattern = useRhythmCells ? buildChordalPattern(segDur, measureNumber, start, tempoBpm) : [segDur];
      let cursor = start;
      for (const dur of pattern) {
        const midi = chooseBassMidiWithLeapLimit(primaryPc, prevMidi, range, 43, 12);
        const maxNotes = activity === "less_active" ? 2 : Math.min(4, parsed?.pcs?.length ?? 3);
        const voicing =
          activity === "less_active"
            ? buildDyadVoicing({ bassMidi: midi, parsed: parsed as any, range })
            : buildBeginnerChordVoicing({
                anchorMidi: midi,
                parsed: parsed as any,
                range,
                maxNotes
              });
        const ordered = voicing.slice().sort((a, b) => a - b);
        ordered.forEach((m, idx) => {
          const pitch = idx === 0 ? pitchWithSpelling(m, primarySpelling) : midiToPitch(m);
          events.push({ type: "note", t: cursor, dur, midi: m, pitch, chord: idx > 0 });
        });
        prevMidi = midi;
        cursor += dur;
      }
    }

    newMeasures.push({
      number: measureNumber,
      attributes: attrs ? { ...attrs } : undefined,
      events
    });

    lastChord = chordEvents[chordEvents.length - 1] ?? lastChord;
  }

  bassPart.measures = newMeasures;
  warnings.push(`[piano] Chordal accompaniment applied (activity=${activity}, left-hand chords).`);
  return true;
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

function chooseBassMidi(
  pcTarget: number,
  prevMidi: number,
  range: { min: number; max: number },
  anchorMidi = 43
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (((m % 12) + 12) % 12 === pcTarget) candidates.push(m);
  }
  if (!candidates.length) return prevMidi;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
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

function enforceBassToChords(
  scoreModel: ScoreModel,
  chords: ChordEvent[],
  warnings: string[],
  options?: { useMelodyRhythm?: boolean }
): void {
  if (!Array.isArray(chords) || !chords.length) return;
  const useMelodyRhythm = options?.useMelodyRhythm !== false;

  const parts = scoreModel.parts ?? [];
  const melodyPart =
    parts.find((p: any) => {
      const name = String(p?.name ?? "").toLowerCase();
      return name.includes("soprano") || name.includes("melody") || name.includes("voice");
    }) ?? parts[0];
  const bassPart =
    parts.find((p: any) => String(p?.name ?? "").toLowerCase().includes("bass")) ??
    (parts.length ? parts[parts.length - 1] : null);

  if (!bassPart) {
    warnings.push("[chord-lock] Could not find Bass part to enforce chord roots.");
    return;
  }

  const range = { min: 40, max: 64 }; // E2..E4
  let prevMidi = 43;

  const melodyMeasures = melodyPart?.measures ?? [];
  const canUseMelody = useMelodyRhythm && melodyMeasures.length > 0;

  if (canUseMelody) {
    const newMeasures: any[] = [];
    for (let i = 0; i < melodyMeasures.length; i++) {
      const melM = melodyMeasures[i];
      const measureNumber = Number(melM?.number) || (i + 1);
      const melEvents = (melM?.events ?? []).filter((e: any) => e && (e.type === "note" || e.type === "rest"));
      const nextEvents: any[] = [];

      for (const ev of melEvents) {
        if (!ev || typeof ev.t !== "number" || typeof ev.dur !== "number") continue;
        const chord = pickChordForTime(chords, measureNumber, Number(ev.t));
        if (!chord) {
          nextEvents.push({ type: "rest", t: ev.t, dur: ev.dur });
          continue;
        }
        const bassInfo = parseBassFromChordSymbol(chord.symbol);
        if (!bassInfo) {
          nextEvents.push({ type: "rest", t: ev.t, dur: ev.dur });
          continue;
        }
        const midi = chooseBassMidi(bassInfo.pc, prevMidi, range, 43);
        nextEvents.push({
          type: "note",
          t: ev.t,
          dur: ev.dur,
          midi,
          pitch: pitchWithSpelling(midi, bassInfo.spelling)
        });
        prevMidi = midi;
      }

      const attrs = bassPart?.measures?.[i]?.attributes;
      newMeasures.push({
        number: measureNumber,
        attributes: attrs ? { ...attrs } : undefined,
        events: nextEvents
      });
    }

    bassPart.measures = newMeasures;
    return;
  }

  for (const m of bassPart.measures ?? []) {
    const measureNumber = Number(m?.number) || 0;
    const events = m?.events ?? [];
    for (const ev of events) {
      if (!ev || (ev.type !== "note" && ev.type !== "rest") || typeof ev?.t !== "number") continue;
      if (ev.type === "rest") continue;
      if (ev.lockPitch === true && (typeof ev.midi === "number" || ev.pitch)) {
        const midi = typeof ev.midi === "number" ? ev.midi : pitchToMidi(ev.pitch);
        if (typeof midi === "number" && Number.isFinite(midi)) prevMidi = midi;
        continue;
      }
      const chord = pickChordForTime(chords, measureNumber, Number(ev.t));
      if (!chord) {
        ev.type = "rest";
        delete (ev as any).midi;
        delete (ev as any).pitch;
        continue;
      }
      const bassInfo = parseBassFromChordSymbol(chord.symbol);
      if (!bassInfo) {
        ev.type = "rest";
        delete (ev as any).midi;
        delete (ev as any).pitch;
        continue;
      }
      const midi = chooseBassMidi(bassInfo.pc, prevMidi, range, 43);
      ev.type = "note";
      ev.midi = midi;
      ev.pitch = pitchWithSpelling(midi, bassInfo.spelling);
      prevMidi = midi;
    }
  }
}

function resolveRhythmStyle(styleRaw: string | undefined, warnings: string[]): string {
  const normalized = String(styleRaw || "classical").toLowerCase();
  const supported = new Set(["classical", "pop", "rock", "funk", "samba", "worship"]);
  if (!supported.has(normalized)) {
    warnings.push(`Style "${styleRaw}" not supported by rhythm stage. Defaulting to "classical".`);
    return "classical";
  }
  return normalized;
}

export function applyAppSettings(
  scoreModel: ScoreModel,
  settings: AppSettings,
  chords: ChordEvent[] = []
): ApplySettingsResult {
  const warnings: string[] = [];
  const ensemble = String(settings.ensemble ?? "").toLowerCase();
  const wantsPianoWithMelody = ensemble === "piano_with_melody";
  const wantsPiano =
    wantsPianoWithMelody || ensemble === "piano" || ensemble === "grand_piano" || ensemble === "acoustic_piano";
  const wantsStrings = ensemble === "string_ensemble" || ensemble === "strings";
  const wantsWoodwinds = ensemble === "woodwind_ensemble" || ensemble === "woodwinds";
  const wantsBrass = ensemble === "brass_ensemble" || ensemble === "brass";
  const useStringEnsembleArranger = settings.useStringEnsembleArranger !== false;
  const instrumentation = settings.instrumentation ?? "auto";
  const usePianoCopyStringQuartetInstrumentation =
    wantsStrings && (instrumentation === "piano_copy_to_string_quartet" || instrumentation === "satb_to_string_quartet");
  const usePianoCopyWoodwindQuartetInstrumentation =
    wantsWoodwinds &&
    (instrumentation === "piano_copy_to_woodwind_quartet" || instrumentation === "satb_to_woodwind_quartet");

  const detectedKey = getKeyInfo(scoreModel);
  const detectedInputKeyFifths = detectedKey.value;
  const detectedMode: "major" | "minor" = detectedKey.mode ?? "major";

  const keyMode =
    settings.keySignatureMode ??
    (settings.targetKey === "original" || settings.keySignature === "original" ? "original" : "manual");
  const targetKey = settings.targetKey ?? settings.keySignature ?? "original";

  let target = null;
  if (keyMode !== "original") {
    if (typeof settings.keyFifths === "number" && Number.isFinite(settings.keyFifths)) {
      target = { fifths: settings.keyFifths, mode: "major" as const };
    } else if (targetKey) {
      target = parseKeySignature(targetKey);
      if (!target) warnings.push(`Could not parse key signature "${targetKey}". Using detected key.`);
    }
  }

  let appliedTransposeSemitones = 0;
  if (target && keyMode !== "original") {
    appliedTransposeSemitones = computeTransposeSemitones({
      detectedFifths: detectedInputKeyFifths,
      detectedMode,
      targetFifths: target.fifths,
      targetMode: target.mode
    });
    if (appliedTransposeSemitones !== 0) {
      transposeScoreModel(scoreModel, appliedTransposeSemitones);
    }
    setKeyFifths(scoreModel, target.fifths, target.mode);
  } else if (keyMode === "original" && detectedKey.found) {
    setKeyFifths(scoreModel, detectedInputKeyFifths, detectedMode);
  }

  const styleRaw = String(settings.style ?? "").toLowerCase();
  const styleUsed = resolveRhythmStyle(settings.style, warnings);
  const accompanimentRaw = settings.accompanimentType ?? settings.accompaniment ?? "";
  const accompaniment = String(accompanimentRaw || "").toLowerCase();
  const isChordal = accompaniment === "chordal";
  const textureMode = String(settings.textureMode ?? "").toLowerCase();
  const useHomorhythmic = textureMode === "homophony_homorhythmic";
  const useMelodyAccomp = textureMode === "homophony_melody_accompaniment";
  const usePolyphonic = textureMode === "polyphony" || accompaniment === "polyphonic";
  const useHomophonic = accompaniment === "homophonic" || isChordal || useHomorhythmic;
  const wantsPianoBeginner = wantsPiano && settings.level === "beginner";
  const wantsPianoChordal = wantsPiano && isChordal;
  const chordalAllowed = wantsPianoChordal && settings.level === "beginner";
  const worshipPiano = wantsPiano && styleRaw === "worship";
  const pianoAdvanced = wantsPiano && settings.level === "advanced";
  const sopranoActivity = settings.sopranoActivity ?? "grounded";
  const sopranoMelodyShare = typeof settings.sopranoMelodyShare === "number" ? settings.sopranoMelodyShare : 30;
  const useSopranoTexture = wantsPiano && !wantsPianoWithMelody && sopranoActivity !== "grounded";
  const tempoBpm = getTempoBpmFromSettings(scoreModel, settings);
  const omitMelodyInPiano = wantsPianoWithMelody ? false : worshipPiano || useSopranoTexture;
  const pianoEnsembleTag = wantsPianoWithMelody ? "piano_with_melody" : "piano";

  if (usePianoCopyStringQuartetInstrumentation) {
    const finalScore = arrangeStringQuartetFromPianoInstrumentation(scoreModel, { warnings });
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (usePianoCopyWoodwindQuartetInstrumentation) {
    const finalScore = arrangeWoodwindQuartetFromPianoInstrumentation(scoreModel, { warnings });
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (wantsWoodwinds) {
    const finalScore = mapPianoToWoodwindEnsembleOpen(scoreModel, {
      level: settings.level,
      accompaniment,
      textureMode,
      chords,
      warnings,
      fluteActivity: settings.sopranoActivity ?? "less_active",
      oboeActivity: settings.altoActivity ?? "less_active",
      clarinetActivity: settings.tenorActivity ?? "less_active",
      bassoonActivity: settings.bassActivity ?? "less_active"
    });
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (wantsBrass) {
    const finalScore = mapPianoToBrassEnsembleOpen(scoreModel, {
      level: settings.level,
      accompaniment,
      textureMode,
      chords,
      warnings
    });
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (usePolyphonic && accompaniment !== "polyphonic") {
    warnings.push("[texture] Polyphony requested; consider setting accompaniment to polyphonic.");
  }

  if (useHomophonic && !wantsPianoBeginner && !chordalAllowed) {
    const choralResult = applyChoralRhythmFromMelody(scoreModel);
    warnings.push(...(choralResult.warnings ?? []));
    if (choralResult.applied) {
      warnings.push("[rhythm] Homophonic accompaniment: copied melody rhythm to inner voices and Bass.");
    }
    enforceBassToChords(scoreModel, chords, warnings, { useMelodyRhythm: true });
    const finalScore = wantsPiano
      ? arrangePianoFromSatb(scoreModel, {
          level: settings.level,
          warnings,
          chords,
          polyphonic: usePolyphonic,
          rhActivity: settings.altoActivity ?? settings.tenorActivity ?? settings.bassActivity ?? "less_active",
          sopranoActivity,
          sopranoMelodyShare,
          tempoBpm,
          melodyHand: "right",
          omitMelodyInPiano,
          separateMelodyPart: (worshipPiano || useSopranoTexture) && !wantsPianoWithMelody,
          worshipChordPad: wantsPianoWithMelody ? false : worshipPiano,
          pianoStylePreset: settings.pianoStylePreset,
          pianoStylePresetPath: settings.pianoStylePresetPath,
          ensembleTag: pianoEnsembleTag
        })
      : wantsStrings
        ? useStringEnsembleArranger
          ? (() => {
              const profile = usePolyphonic ? "countermelody" : "hymn_support";
              const stringResult = arrangeStringEnsemble(scoreModel, chords, { profile });
              warnings.push(...(stringResult.warnings ?? []));
              const stringScore = stringResult.scoreModel;
              if (usePolyphonic) {
                applyStringPolyphonicRhythm(stringScore, {
                  vln1Activity: settings.vln1Activity ?? "grounded",
                  vln2Activity: settings.vln2Activity ?? settings.altoActivity ?? "active",
                  vlaActivity: settings.vlaActivity ?? settings.tenorActivity ?? "active",
                  vcActivity: settings.vcActivity ?? settings.bassActivity ?? "less_active",
                  cbActivity: settings.cbActivity ?? settings.bassActivity ?? "less_active",
                  chordEvents: chords,
                  keyFifths: detectedInputKeyFifths,
                  keyMode: detectedMode,
                  syncopate: true,
                  warnings
                });
              }
              return stringScore;
            })()
          : arrangeStringEnsembleFromSatb(scoreModel, { level: settings.level, warnings })
        : scoreModel;
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (useMelodyAccomp) {
    warnings.push("[texture] Melody+accompaniment: keeping inner voices on simpler cadence rhythm.");
  }

  let cadenceMeasures: number[] = [];
  let pianoBeginnerApplied = false;
  let pianoPolyphonicApplied = false;
  if (wantsPianoChordal && !chordalAllowed) {
    warnings.push("[piano] Chordal accompaniment is beginner-only. Falling back to homophonic.");
  }

  if (chordalAllowed) {
    pianoBeginnerApplied = applyBeginnerPianoAccompaniment(scoreModel, chords, warnings, {
      activity: settings.bassActivity ?? "less_active",
      tempoBpm
    });
  }

  if (usePolyphonic) {
    if (!pianoBeginnerApplied && !wantsStrings) {
      let pianoArpApplied = false;
      if (wantsPiano) {
        pianoArpApplied = applyPianoPolyphonicArpeggioBass(scoreModel, chords, warnings, {
          activity: settings.bassActivity ?? "less_active",
          worship: worshipPiano,
          level: settings.level,
          tempoBpm
        });
      }
      if (pianoArpApplied) pianoPolyphonicApplied = true;
      if (!pianoArpApplied) {
        const bassRhythm = applyPolyphonicBassCounterRhythm(scoreModel, chords, {
          allowRests: true,
          activity: settings.bassActivity ?? "less_active",
          randomizeOffsets: settings.randomizeOffsets !== false,
          minMidiOverride: pianoAdvanced ? 40 : undefined,
          maxMidiOverride: pianoAdvanced ? 52 : undefined
        });
        warnings.push(...(bassRhythm.warnings ?? []));
      }
      const tenorActivity = settings.tenorActivity ?? settings.bassActivity ?? "less_active";
      const tenorRhythm = applyPolyphonicTenorCounterRhythm(scoreModel, chords, {
        allowRests: true,
        activity: tenorActivity,
        randomizeOffsets: settings.randomizeOffsets !== false,
        minMidiOverride: pianoAdvanced ? 52 : undefined,
        maxMidiOverride: pianoAdvanced ? 64 : undefined,
        durationWhitelist:
          wantsPiano && worshipPiano && settings.level === "advanced" && tenorActivity === "less_active" ? [1, 2] : undefined
      });
      warnings.push(...(tenorRhythm.warnings ?? []));
      const altoRhythm = applyPolyphonicAltoCounterRhythm(scoreModel, chords, {
        allowRests: true,
        activity: settings.altoActivity ?? settings.bassActivity ?? "less_active",
        randomizeOffsets: settings.randomizeOffsets !== false
      });
      warnings.push(...(altoRhythm.warnings ?? []));
    }
  } else {
    if (!pianoBeginnerApplied) {
      if (styleUsed === "funk" || styleUsed === "samba") {
        // eslint-disable-next-line no-console
        console.log("[rhythm] Bass leap policy: allow larger leaps for funk/samba.");
      } else {
        // eslint-disable-next-line no-console
        console.log(`[rhythm] Bass leap policy: keep bass grounded for style=\"${styleUsed}\".`);
      }

      const rhythmResult = applyRhythmToBassFinalCadence(scoreModel, {
        style: styleUsed as any,
        role: "bass",
        applyOnlyFinalCadence: true,
        warnOnly: true,
        level: settings.level
      });

      warnings.push(...(rhythmResult.warnings ?? []));
      cadenceMeasures = rhythmResult.appliedMeasureNumbers ?? [];
    }
  }

  const useMelodyRhythmForChordLock = useHomophonic && !pianoBeginnerApplied;
  const useMelodyRhythmForBass = useMelodyRhythmForChordLock && !(wantsPiano && usePolyphonic);
  if (!pianoBeginnerApplied && !wantsStrings) {
    enforceBassToChords(scoreModel, chords, warnings, { useMelodyRhythm: useMelodyRhythmForBass });
  }
  const finalScore = wantsPiano
    ? arrangePianoFromSatb(scoreModel, {
        level: settings.level,
        warnings,
        chords,
        polyphonic: usePolyphonic,
        rhActivity: settings.altoActivity ?? settings.tenorActivity ?? settings.bassActivity ?? "less_active",
        sopranoActivity,
        sopranoMelodyShare,
        tempoBpm,
        melodyHand: "right",
        omitMelodyInPiano,
        separateMelodyPart: (worshipPiano || useSopranoTexture) && !wantsPianoWithMelody,
        worshipChordPad: wantsPianoWithMelody ? false : worshipPiano,
        pianoStylePreset: settings.pianoStylePreset,
        pianoStylePresetPath: settings.pianoStylePresetPath,
        ensembleTag: pianoEnsembleTag
      })
    : wantsStrings
      ? useStringEnsembleArranger
        ? (() => {
            const profile = usePolyphonic ? "countermelody" : "hymn_support";
            const stringResult = usePolyphonic
              ? arrangeStringPolyphonic(scoreModel, chords, { level: settings.level })
              : arrangeStringEnsemble(scoreModel, chords, { profile });
            warnings.push(...(stringResult.warnings ?? []));
            const stringScore = stringResult.scoreModel;
            if (usePolyphonic) {
              const levelRaw = String(settings.level ?? "").toLowerCase();
              const melodyShift = levelRaw === "intermediate" || levelRaw === "advanced" ? 12 : 0;
              const melodyEvents = extractMelodyEventsForStrings(scoreModel, melodyShift);
              applyStringPolyphonicRhythm(stringScore, {
                vln1Activity: settings.vln1Activity ?? "grounded",
                vln2Activity: settings.vln2Activity ?? settings.altoActivity ?? "active",
                vlaActivity: settings.vlaActivity ?? settings.tenorActivity ?? "active",
                vcActivity: settings.vcActivity ?? settings.bassActivity ?? "less_active",
                cbActivity: settings.cbActivity ?? settings.bassActivity ?? "less_active",
                chordEvents: chords,
                keyFifths: detectedInputKeyFifths,
                keyMode: detectedMode,
                syncopate: true,
                allowNonChordTones: true,
                preserveVln1Melody: true,
                enforceChordRootBass: true,
                level: settings.level,
                warnings
              });
              const vln1Part = (stringScore.parts ?? []).find(
                (p: any) => String(p?.name ?? "").toLowerCase().includes("violin i")
              );
              if (vln1Part) {
                vln1Part.measures = vln1Part.measures.map((m: any) => ({
                  ...m,
                  events: (melodyEvents[m.number] ?? m.events ?? []).sort((a, b) => Number(a.t) - Number(b.t))
                }));
              }
            }
            return stringScore;
          })()
        : arrangeStringEnsembleFromSatb(scoreModel, { level: settings.level, warnings })
      : scoreModel;
  attachTextureAnalysis(finalScore, warnings);

  return {
    scoreModel: finalScore,
    warnings,
    detectedInputKeyFifths,
    appliedTransposeSemitones,
    styleUsed,
    cadenceMeasures
  };
}
