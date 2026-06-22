import type { ScoreModel, NoteEvent } from "../score/types";
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
import type { LhPatternId } from "../arrange/pianoAccompPatterns";
import { arrangeStringEnsembleFromSatb } from "../arrange/arrangeStringEnsembleFromSatb";
import { arrangeStringQuartetFromPianoInstrumentation, arrangeSatbToStringQuartetDirect, scoreHasPianoPart } from "../arrange/arrangeStringQuartetFromPianoInstrumentation";
import { arrangeWoodwindQuartetFromPianoInstrumentation } from "../arrange/arrangeWoodwindQuartetFromPianoInstrumentation";
import { arrangePianoWithStrings } from "../arrange/arrangePianoWithStrings";
import { arrangeStringEnsemble, applyPianoBassRhythm, applyPianoMelodyRhythm } from "../arrange/strings/stringArranger";
import type { ProfileId } from "../arrange/strings/types";
import { arrangeWoodwindEnsemble, type WoodwindActivity } from "../arrange/woodwinds/woodwindArranger";
import { arrangeSatbToWoodwindQuartetDirect } from "../arrange/woodwinds/arrangeSatbToWoodwindQuartet";
import { woodwindTextureToProfile, woodwindTextureToActivity, woodwindExampleToTexture, type WoodwindTexture } from "../arrange/woodwinds/woodwindStyle";
import { arrangeBrassEnsemble, type BrassActivity } from "../arrange/brass/brassArranger";
import { brassTextureToProfile, brassTextureToActivity, brassExampleToTexture, type BrassTexture } from "../arrange/brass/brassStyle";
import { arrangeBrassQuintetFromPianoInstrumentation } from "../arrange/arrangeBrassQuintetFromPianoInstrumentation";
import { arrangeSatbToBrassQuartetDirect } from "../arrange/brass/arrangeSatbToBrassQuartet";
import { applyStringPolyphonicRhythm } from "../arrange/strings/stringRhythm";
import { getComposerFromExample } from "../arrange/strings/composerProfiles";
import { arrangeStringPolyphonic } from "../arrange/stringsPolyphony/stringsPolyphonicArranger";
import { mapPianoToWoodwindEnsembleOpen } from "../arrange/mapToWoodwindEnsemble";
import { mapPianoToBrassEnsembleOpen } from "../arrange/mapToBrassEnsemble";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";
import { resolveChoralProfile } from "../harmonize/satb/choralStyleProfiles";
import { inferChordsFromAllVoices } from "../harmonize/satb/inferChordsFromMelody";
import { preserveFinalMeasuresRhythm } from "../rhythm/preserveFinalMeasuresRhythm";

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
  /**
   * Suzuki method volume number (1–8+).
   * When provided, overrides `level` for string-ensemble outputs and maps to
   * per-instrument range constraints, activity levels, and approach-note density
   * following the Suzuki repertoire progression:
   *   Vol 1   → Beginner    (1st position, whole/half/quarter only, no approach notes)
   *   Vol 2–3 → Intermediate (8th notes, limited range, light approach notes)
   *   Vol 4–5 → Advanced    (16th notes, moderate shifting, approach notes on)
   *   Vol 6+  → Professional (full range and technique)
   */
  suzukiVolume?: number;
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
  /**
   * Explicit LH pattern override for piano accompaniment mode.
   * "auto" or undefined = auto-select based on style + time signature.
   */
  lhPattern?: string;
  /**
   * Explicit RH pattern for piano accompaniment mode.
   * When set, overrides auto-selection.
   */
  rhPattern?: string;
  /** spec_bass: note value of the instruction-driven bass line ("whole"|"half"|"quarter"). */
  bassRhythm?: "whole" | "half" | "quarter";
  /** spec_bass: "follow_melody" re-aligns the final bass note to the melody's last note. */
  bassFinalNote?: "follow_melody" | "default";
  /**
   * Adler-based string texture mode (only applies when ensemble = "string_ensemble"
   * and instrumentation = "auto").
   *   "melody_harmony"   — Vln I foreground melody; Vln II + Vla inner harmony; Vc bass; Cb -8va (default)
   *   "melody_pizzicato" — Vln I arco melody; Vln II + Vla + Vc + Cb pizzicato
   *   "cello_melody"     — Cello foreground melody; violins soft background
   *   "homophonic_block" — All 5 voices block chords, Adler overtone spacing
   */
  stringTexture?: string;
  /** Example file ID (e.g. "beethoven_op18_no1"). Maps to a composer profile. */
  stringExample?: string;
  /**
   * Explicit composer override (e.g. "mozart", "beethoven", "brahms").
   * When set, overrides the composer inferred from stringExample.
   * When "auto" or undefined, the composer is derived from stringExample.
   */
  stringComposer?: string;
  useStringEnsembleArranger?: boolean;
  instrumentation?:
    | "auto"
    | "piano_copy_to_string_quartet"
    | "satb_to_string_quartet"
    | "piano_copy_to_woodwind_quartet"
    | "satb_to_woodwind_quartet";
  /** Woodwind quintet (adds Horn in F as 5th voice) when true or woodwindSize="quintet". */
  woodwindQuintet?: boolean;
  woodwindSize?: "quartet" | "quintet";
  /**
   * Piano→Wind copy: bassoon entry. Measure number (1-based) where the bassoon
   * enters (it rests before). 0 = always play. Undefined = auto-detect the
   * thin intro and rest the bassoon there.
   */
  bassoonEntryMeasure?: number;
  /** Woodwind ensemble auto settings — parity with the string ensemble. */
  woodwindTexture?: "melody_harmony" | "chorale" | "contrapuntal" | "chamber";
  woodwindExample?: string;
  woodwindComposer?: string;
  /** Brass ensemble auto settings — parity with the woodwind ensemble. */
  brassTexture?: "melody_harmony" | "chamber" | "chorale" | "fanfare" | "contrapuntal";
  brassExample?: string;
  brassQuintet?: boolean;  // default true (with Horn); false = quartet
  /** Per-instrument activity (overrides idiomatic agility defaults). */
  fluteActivity?:    "grounded" | "less_active" | "active" | "high_active";
  oboeActivity?:     "grounded" | "less_active" | "active" | "high_active";
  clarinetActivity?: "grounded" | "less_active" | "active" | "high_active";
  hornActivity?:     "grounded" | "less_active" | "active" | "high_active";
  bassoonActivity?:  "grounded" | "less_active" | "active" | "high_active";
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

type Activity = "grounded" | "less_active" | "active" | "high_active";

/**
 * For polyphonic string arrangements, inner voices (Vln II, Viola) need at
 * least "active" activity to produce independent contrapuntal lines.  "Grounded"
 * or "less_active" defaults produce block-chord (choral) texture instead.
 * This helper raises the activity to `minLevel` without lowering it if the
 * user has already chosen something higher.
 */
const ACTIVITY_ORDER: Activity[] = ["grounded", "less_active", "active", "high_active"];
function promoteActivityForPolyphony(act: Activity, minLevel: Activity = "active"): Activity {
  return ACTIVITY_ORDER.indexOf(act) < ACTIVITY_ORDER.indexOf(minLevel) ? minLevel : act;
}

/**
 * Schoenberg accompaniment density scaling (Fundamentals Ch. IX).
 *
 * "When the melody is ornate, the accompaniment should be neutral."
 *
 * Measures average melodic density of a part (note onsets / beats per measure)
 * and, if the melody is busy (≥ 1.5 onsets/beat — mostly eighth notes or
 * denser), steps the inner-voice *activity* down by one level so the
 * accompaniment does not crowd the melodic line.
 *
 * Only applies to inner voices (Vln II, Vla, etc.), never to the melody voice
 * itself (Vln I).  The user's explicit activity setting acts as a ceiling —
 * we never raise activity, only lower it.
 *
 * @param part       - The melody (foreground) part whose density we measure
 * @param activity   - The requested inner-voice activity level
 * @returns The adapted activity level (may be one step lower if melody is ornate)
 */
function schoenbergScaleActivity(part: any, activity: Activity): Activity {
  if (!part || !Array.isArray(part.measures)) return activity;

  let totalOnsets = 0;
  let totalBeats  = 0;
  for (const m of part.measures) {
    const beats = (() => {
      const b = Number(m?.attributes?.time?.beats ?? 4);
      const bt = Number(m?.attributes?.time?.beat_type ?? 4);
      return b * (4 / bt);
    })();
    const onsets = new Set<number>();
    for (const ev of m?.events ?? []) {
      if (ev && ev.type === "note" && !(ev as any).isRest && typeof ev.t === "number") {
        onsets.add(Math.round(Number(ev.t) * 1000));
      }
    }
    totalOnsets += onsets.size;
    totalBeats  += beats;
  }

  if (totalBeats <= 0) return activity;
  const density = totalOnsets / totalBeats;

  // Only scale down if the melody is ornate (avg ≥ 1.5 onsets/beat)
  if (density < 1.5) return activity;

  const ORDER: Activity[] = ["grounded", "less_active", "active", "high_active"];
  const idx = ORDER.indexOf(activity);
  if (idx <= 0) return activity; // already grounded — nothing to step down
  return ORDER[idx - 1]!;
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

/**
 * Builds a rest-only "Soprano" template score from the piano structure.
 *
 * Passing this to arrangeStringEnsemble ensures that slice.melodyMidi is null
 * for every time slot, so the DP is free to choose any chord tone for Violin I
 * rather than locking it to the piano's top note.  The result is a genuine
 * complementary string arrangement instead of a melodic copy of the piano.
 *
 * pianoChords (from inferChordsFromAllVoices) continues to supply the chord
 * progression for all four string voices — only the melody constraint changes.
 */
function buildPianoTemplateScore(pianoScore: ScoreModel): ScoreModel {
  const parts = (pianoScore as any).parts ?? [];
  const pianoPart = parts[0];
  if (!pianoPart) return pianoScore;

  const measures = (pianoPart.measures ?? []).map((m: any) => {
    const attrs = m.attributes ?? {};
    const beats    = Number(attrs?.time?.beats    ?? 4);
    const beatType = Number(attrs?.time?.beat_type ?? 4);
    const measureLen = beats * (4 / beatType);
    // Single whole-measure rest — no melody notes, so melodyMidi stays null.
    return {
      ...m,
      events: [
        {
          id:     `tmpl-rest-${m.number}`,
          t:      0,
          dur:    measureLen,
          type:   "rest",
          voice:  1,
          staff:  1,
          isRest: true,
        },
      ],
    };
  });

  return {
    ...pianoScore,
    parts: [
      {
        ...pianoPart,
        part_id:    "P_S",
        name:       "Soprano",
        instrument: "soprano",
        staves:     1,
        measures,
      },
    ],
  } as any;
}

/**
 * Build a template score from the piano source that seeds the string arranger's
 * time grid with the piano's RIGHT-HAND rhythm (unique note-onset times per
 * measure, deduplicated across stacked chord tones).
 *
 * Unlike buildPianoTemplateScore (which produces a single whole-measure rest),
 * this gives the DP many more time-points to work with → Violin I (and all
 * other voices) play a denser, more active arrangement that tracks the
 * rhythmic character of the piano's melody/chords.
 *
 * All events are RESTS, so melodyMidi stays null and every voice picks chord
 * tones freely — the piano melody is never literally copied.
 */
function buildPianoRhythmTemplateScore(pianoScore: ScoreModel): ScoreModel {
  const allParts = (pianoScore as any).parts ?? [];
  const isPianoPart = (p: any): boolean => {
    const n    = String(p?.name       ?? "").toLowerCase();
    const inst = String(p?.instrument ?? "").toLowerCase();
    return n.includes("piano") || inst.includes("piano") || inst === "grand_piano";
  };
  const pianoPart = allParts.find(isPianoPart) ?? allParts[0];
  if (!pianoPart) return pianoScore;

  const measures = (pianoPart.measures ?? []).map((m: any) => {
    const attrs    = m.attributes ?? {};
    const beats    = Number(attrs?.time?.beats    ?? 4);
    const beatType = Number(attrs?.time?.beat_type ?? 4);
    const measureLen = beats * (4 / beatType);

    // Collect unique onset times from the right hand (staff=1 or voice<=2).
    const rhOnsets = new Set<number>();
    for (const ev of (m.events ?? [])) {
      if (ev.type !== "note") continue;
      const staff = Number(ev.staff ?? 1);
      const voice = Number(ev.voice ?? 1);
      if (staff === 1 || voice <= 2) {
        const t = Number(ev.t ?? 0);
        if (t >= 0 && t < measureLen) rhOnsets.add(t);
      }
    }

    // Fall back to a quarter-note grid for moderate activity when the source
    // part has no explicit right-hand note data.
    if (!rhOnsets.size) {
      for (let t = 0; t < measureLen; t += 1.0) rhOnsets.add(t);
    }

    // Emit rest events at each onset — dur=0.25 minimum (actual slice dur is
    // computed from the spacing between consecutive time-points in buildSlices).
    const events = Array.from(rhOnsets)
      .sort((a, b) => a - b)
      .map((t) => ({
        id:     `tmpl-rh-${m.number}-${t}`,
        t,
        dur:    0.25,
        type:   "rest" as const,
        voice:  1,
        staff:  1,
        isRest: true,
      }));

    return { ...m, events };
  });

  return {
    ...pianoScore,
    parts: [{
      ...pianoPart,
      part_id:    "P_S",
      name:       "Soprano",
      instrument: "soprano",
      staves:     1,
      measures,
    }],
  } as any;
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
  const allowArp = (activity as string) !== "grounded";
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
        (ev as any).type = "rest";
        delete (ev as any).midi;
        delete (ev as any).pitch;
        continue;
      }
      const bassInfo = parseBassFromChordSymbol(chord.symbol);
      if (!bassInfo) {
        (ev as any).type = "rest";
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
  const supported = new Set([
    "classical", "baroque", "romantic", "modern",
    "pop", "rock", "funk", "samba", "worship"
  ]);
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
  // Dedicated copy ensembles — each has exactly one code path, no routing switches:
  //   "piano_string_quartet"  → piano LH/RH → V1/V2/VA/VC (skip harmonizer)
  //   "satb_string_quartet"   → SATB S/A/T/B → V1/V2/VA/VC (skip harmonizer)
  //   "string_ensemble"       → auto arranger: lead sheet + style → stylistic strings
  const wantsPianoStringQuartet = ensemble === "piano_string_quartet";
  const wantsSatbStringQuartet  = ensemble === "satb_string_quartet";
  const wantsPianoWithStrings   = ensemble === "piano_with_strings";
  const wantsStrings = ensemble === "string_ensemble" || ensemble === "strings";
  const wantsBrass = ensemble === "brass_ensemble" || ensemble === "brass";
  // ── Brass family — mirrors the woodwind family ────────────────────────────
  //   brass_ensemble       → auto arranger (lead sheet + style → DP brass)
  //   piano_brass_quartet  → direct piano copy → brass (RH→Tpt1/2/Hn, LH→Tbn/Tuba)
  //   satb_brass_quartet   → Choral-brass (S→Tpt1, A→Tpt2, T→Tbn, B→Tuba)
  //   piano_with_brass     → piano as harmony source → brass arrangement (complement)
  const wantsPianoBrassCopy   = ensemble === "piano_brass_quartet";
  const wantsChoralBrass      = ensemble === "satb_brass_quartet";
  const wantsPianoWithBrass   = ensemble === "piano_with_brass";
  const useStringEnsembleArranger = settings.useStringEnsembleArranger !== false;
  const instrumentation = settings.instrumentation ?? "auto";
  const usePianoCopyStringQuartetInstrumentation =
    wantsPianoStringQuartet ||
    (wantsStrings && (instrumentation === "piano_copy_to_string_quartet" || instrumentation === "satb_to_string_quartet"));

  // ── Woodwind family — mirrors the string family ───────────────────────────
  //   woodwind_ensemble        → auto arranger (lead sheet + style → DP winds)
  //   piano_woodwind_quartet   → direct piano copy → winds (RH→Fl/Ob, LH→Cl/Bn)
  //   satb_woodwind_quartet    → Choral-wind (S→Fl, A→Ob, T→Cl, B→Bn)
  //   piano_with_woodwinds     → piano as harmony source → wind arrangement (complement)
  const wantsWoodwinds        = ensemble === "woodwind_ensemble" || ensemble === "woodwinds";
  const wantsPianoWoodwindCopy = ensemble === "piano_woodwind_quartet";
  const wantsChoralWind       = ensemble === "satb_woodwind_quartet";
  const wantsPianoWithWoodwinds = ensemble === "piano_with_woodwinds";
  const usePianoCopyWoodwindQuartetInstrumentation =
    wantsPianoWoodwindCopy ||
    (wantsWoodwinds && instrumentation === "piano_copy_to_woodwind_quartet");
  const useSatbToWoodwindInstrumentation =
    wantsChoralWind ||
    (wantsWoodwinds && instrumentation === "satb_to_woodwind_quartet");
  // Optional 5th voice (Horn in F → woodwind quintet)
  const wantsWoodwindQuintet =
    settings.woodwindQuintet === true || String(settings.woodwindSize ?? "").toLowerCase() === "quintet";

  // ── Piano+strings: capture the piano part RIGHT NOW, before anything touches scoreModel ──
  // Key transposition, rhythm engines, etc. all modify scoreModel in-place below.
  // This deep-clone is the only way to guarantee the output piano is a faithful
  // copy of exactly what the user uploaded.
  //
  // IMPORTANT: search for the piano part by name/instrument, not by position.
  // Sources like "shout.musicxml" have parts ordered [Violin I, Violin II, ..., Piano],
  // so blindly taking parts[0] would capture the Violin I melody instead of the full
  // piano grand staff (1679 notes, 147 backups). We find the Piano part explicitly,
  // and only fall back to parts[0] if no piano-named/instrumented part exists.
  const frozenPianoPart: any | null = (wantsPianoWithStrings || wantsPianoWithWoodwinds || wantsPianoWithBrass)
    ? (() => {
        const allParts: any[] = (scoreModel as any).parts ?? [];
        const isPianoPart = (p: any): boolean => {
          const n = String(p?.name ?? "").toLowerCase();
          const inst = String(p?.instrument ?? "").toLowerCase();
          return (
            n.includes("piano") || n.includes("keyboard") ||
            inst.includes("piano") || inst === "grand_piano" ||
            inst === "acoustic_piano" || inst === "keyboard"
          );
        };
        const raw = allParts.find(isPianoPart) ?? allParts[0] ?? null;
        if (!raw) return null;
        return {
          ...JSON.parse(JSON.stringify(raw)),
          part_id: "P_PNO",
          name: "Piano",
          instrument: "piano",
          staves: 2
        };
      })()
    : null;

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

  // Resolve composer profile key: explicit override > inferred from example > none
  const composerKeyRaw = String(settings.stringComposer ?? "").toLowerCase();
  const composerKeyFromExample = settings.stringExample
    ? (getComposerFromExample(settings.stringExample) ?? "")
    : "";
  const composerKey = composerKeyRaw && composerKeyRaw !== "auto"
    ? composerKeyRaw
    : composerKeyFromExample;

  const accompanimentRaw = settings.accompanimentType ?? settings.accompaniment ?? "";
  const accompaniment = String(accompanimentRaw || "").toLowerCase();
  const isChordal = accompaniment === "chordal";
  const textureMode = String(settings.textureMode ?? "").toLowerCase();
  const useHomorhythmic = textureMode === "homophony_homorhythmic";
  const useMelodyAccomp = textureMode === "homophony_melody_accompaniment";
  const usePolyphonic = textureMode === "polyphony" || accompaniment === "polyphonic";
  // Polyphonic mode takes precedence: when usePolyphonic is true, the homophonic
  // early-return block must not fire (it would use arrangeStringEnsemble block-chord
  // DP instead of arrangeStringPolyphonic, producing identical choral texture).
  const useHomophonic = (accompaniment === "homophonic" || isChordal || useHomorhythmic) && !usePolyphonic;
  const wantsPianoBeginner = wantsPiano && settings.level === "beginner";
  const wantsPianoChordal = wantsPiano && isChordal;
  const chordalAllowed = wantsPianoChordal && settings.level === "beginner";
  const worshipPiano = wantsPiano && styleRaw === "worship";
  const pianoAdvanced = wantsPiano && settings.level === "advanced";
  const sopranoActivity = settings.sopranoActivity ?? "grounded";
  const sopranoMelodyShare = typeof settings.sopranoMelodyShare === "number" ? settings.sopranoMelodyShare : 30;
  const useSopranoTexture = wantsPiano && !wantsPianoWithMelody && sopranoActivity !== "grounded";
  const tempoBpm = getTempoBpmFromSettings(scoreModel, settings);

  // ── Choral style profile resolution ────────────────────────────────────────
  // When ensemble=choral + a period style is selected, resolve the 5-dimension
  // profile and use it as the default for activity levels the user hasn't set.
  // (The user's explicit bassActivity / tenorActivity / altoActivity always win.)
  const isChoralEnsemble = ensemble === "choral" || ensemble === "satb";
  const choralProfile = (isChoralEnsemble && styleRaw && styleRaw !== "")
    ? resolveChoralProfile(styleRaw, undefined)
    : null;
  // Effective activity: user override → choral profile default → hardcoded fallback
  const effectiveBassActivity   = settings.bassActivity   ?? choralProfile?.bassActivity   ?? "less_active";
  const effectiveTenorActivity  = settings.tenorActivity  ?? choralProfile?.tenorActivity  ?? "less_active";
  const effectiveAltoActivity   = settings.altoActivity   ?? choralProfile?.altoActivity   ?? "less_active";
  if (choralProfile) {
    warnings.push(
      `[choral] Style profile "${styleRaw}": bass=${effectiveBassActivity}, tenor=${effectiveTenorActivity}, alto=${effectiveAltoActivity}, voiceIndependence=${choralProfile.voiceIndependence.toFixed(2)}`
    );
  }
  const omitMelodyInPiano = wantsPianoWithMelody ? false : worshipPiano || useSopranoTexture;
  const pianoEnsembleTag = wantsPianoWithMelody ? "piano_with_melody" : "piano";

  if (usePianoCopyStringQuartetInstrumentation) {
    // Guard: warn clearly if the input is not a piano score
    if (wantsPianoStringQuartet && !scoreHasPianoPart(scoreModel)) {
      const partNames = (scoreModel as any)?.parts?.map((p: any) => p?.name ?? "?").join(", ") ?? "none";
      warnings.push(
        `[piano→strings] Your uploaded file does not appear to be a piano score. ` +
        `Found parts: ${partNames}. ` +
        `The "piano → string quartet" mode expects a piano score with treble+bass staves. ` +
        `Please upload the original piano file.`
      );
    }
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

  if (wantsSatbStringQuartet) {
    const finalScore = arrangeSatbToStringQuartetDirect(scoreModel, { warnings });
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
    // Piano-wind (copy): RH chord→Flute/Oboe/Clarinet, LH bass→Bassoon.
    // Bassoon entry rule: manual measure if set, else auto-detect the thin intro.
    const bassoonEntry: number | "auto" | "always" =
      typeof settings.bassoonEntryMeasure === "number" && settings.bassoonEntryMeasure >= 1
        ? settings.bassoonEntryMeasure
        : (settings.bassoonEntryMeasure as any) === 0
          ? "always"
          : "auto";
    const finalScore = arrangeWoodwindQuartetFromPianoInstrumentation(scoreModel, { warnings, bassoonEntry });
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

  if (useSatbToWoodwindInstrumentation) {
    // Choral-wind: SATB transcription → Soprano→Flute, Alto→Oboe, Tenor→Clarinet, Bass→Bassoon
    const finalScore = arrangeSatbToWoodwindQuartetDirect(scoreModel, { warnings });
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

  if (wantsPianoWithWoodwinds) {
    // Piano-wind (complement): piano as harmony source → DP wind arrangement.
    // Mirrors piano_with_strings — the piano is NOT in the output.
    const pianoChords = chords.length ? chords : inferChordsFromAllVoices(scoreModel);
    if (!pianoChords.length) {
      warnings.push("[piano+winds] Could not infer chords from piano score — wind parts may be sparse.");
    }
    const wwTexture: WoodwindTexture | undefined =
      (settings.woodwindTexture as WoodwindTexture | undefined) ??
      (settings.woodwindExample ? (woodwindExampleToTexture(settings.woodwindExample) ?? undefined) : undefined);
    const wwProfile = woodwindTextureToProfile(wwTexture, styleRaw, usePolyphonic);
    const wwActivity = woodwindTextureToActivity(wwTexture) as Partial<Record<"fl" | "ob" | "cl" | "hn" | "bn", WoodwindActivity>>;

    const wwResult = arrangeWoodwindEnsemble(scoreModel, pianoChords as any, {
      profile:          wwProfile,
      chords:           pianoChords as any,
      key:              { fifths: detectedInputKeyFifths, mode: detectedMode },
      quintet:          wantsWoodwindQuintet,
      activity:         wwActivity,
      polyphonic:       usePolyphonic || wwTexture === "contrapuntal",
      level:            settings.level,
      rhythmSourcePart: frozenPianoPart,   // use piano RH onsets as rhythm grid
      warnings,
    });
    attachTextureAnalysis(wwResult.scoreModel, warnings);
    return {
      scoreModel: wwResult.scoreModel as ScoreModel,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (wantsPianoWithStrings) {
    // ── Infer chords from all piano voices if none were supplied ─────────
    const pianoChords = chords.length
      ? chords
      : inferChordsFromAllVoices(scoreModel);

    if (!pianoChords.length) {
      warnings.push("[piano+strings] Could not infer chords from piano score — string parts may be sparse.");
    }

    // ── Use the frozen piano part captured before any processing ────────
    // frozenPianoPart is a deep-clone taken at the very start of applyAppSettings,
    // before key transposition, rhythm engines, or any other mutation.
    const pianoPart = frozenPianoPart;

    // ── Generate string arrangement — same engine as string_ensemble ─────
    const profile = (usePolyphonic
      ? "countermelody"
      : (settings.stringTexture ?? "melody_harmony")) as ProfileId;

    // NOTE: arrangeStringPolyphonic expects SATB parts (soprano/alto/tenor/bass)
    // and will hang indefinitely on a piano score. Always use arrangeStringEnsemble
    // here; polyphonic/Bach texture is achieved via the "countermelody" profile
    // which is already set in `profile` when usePolyphonic is true.
    //
    // IMPORTANT: Use the SIMPLE one-event-per-measure template (not the dense
    // piano-RH-onset template) for the DP.  The DP stores all layers for
    // backtracking: O(slices × states²) memory.  With 16th-note piano parts
    // (~16 slices/measure × 88 measures × 7776 voicing states × 300 B/node)
    // the dense template causes an OOM crash on Render's 512 MB free tier.
    // Violin I activity is instead applied as a cheap O(measures × onsets)
    // post-processor below (applyPianoMelodyRhythm), exactly as done for
    // Cello/Bass (applyPianoBassRhythm).
    const templateScore = buildPianoTemplateScore(scoreModel);
    const stringResult = arrangeStringEnsemble(templateScore, pianoChords, { profile });

    warnings.push(...(stringResult.warnings ?? []));
    const stringScore = stringResult.scoreModel;

    // ── Apply polyphonic rhythm + Schoenberg density scaling if requested
    if (usePolyphonic) {
      // For Schoenberg density scaling, use the template score's "Soprano" part
      // (a rest-only part — density will be considered zero → no scaling applied).
      // This is intentional: for piano+strings, the piano carries the melodic
      // complexity; the strings should remain at the requested activity level.
      const vln1SrcPart = (templateScore.parts ?? []).find((p: any) => {
        const n = String(p?.name ?? "").toLowerCase();
        return n.includes("soprano") || n.includes("violin i") || n.includes("melody");
      });
      const rawVln2Act = promoteActivityForPolyphony(
        (settings.vln2Activity ?? settings.altoActivity ?? "active") as Activity
      );
      const rawVlaAct = promoteActivityForPolyphony(
        (settings.vlaActivity ?? settings.tenorActivity ?? "active") as Activity
      );
      const adaptedVln2Act = schoenbergScaleActivity(vln1SrcPart, rawVln2Act);
      const adaptedVlaAct  = schoenbergScaleActivity(vln1SrcPart, rawVlaAct);
      if (adaptedVln2Act !== rawVln2Act || adaptedVlaAct !== rawVlaAct) {
        warnings.push(
          `[strings] Schoenberg density scaling: ornate melody → ` +
          `vln2 ${rawVln2Act}→${adaptedVln2Act}, vla ${rawVlaAct}→${adaptedVlaAct}.`
        );
      }
      applyStringPolyphonicRhythm(stringScore, {
        vln1Activity:          settings.vln1Activity ?? "grounded",
        vln2Activity:          adaptedVln2Act,
        vlaActivity:           adaptedVlaAct,
        vcActivity:            settings.vcActivity ?? settings.bassActivity ?? "less_active",
        cbActivity:            settings.cbActivity ?? settings.bassActivity ?? "less_active",
        chordEvents:           pianoChords,
        keyFifths:             detectedInputKeyFifths,
        keyMode:               detectedMode,
        syncopate:             true,
        allowNonChordTones:    true,
        preserveVln1Melody:    true,
        enforceChordRootBass:  true,
        level:                 settings.level,
        warnings,
        tempoBpm,
        style:                 styleUsed,
        composerKey:           composerKey || undefined
      });
      // Violin I is NOT overridden with the piano melody — the DP-generated
      // chord-tone line is kept as the complementary string arrangement.
    }

    // ── Overlay piano RH rhythm on Violin I (post-DP, memory-safe) ──────────
    // applyPianoMelodyRhythm is O(measures × onsets) — it never runs a DP so
    // it has no quadratic memory cost.  Skip when usePolyphonic is active
    // because applyStringPolyphonicRhythm has already set Violin I's rhythm.
    if (pianoPart && !usePolyphonic) {
      applyPianoMelodyRhythm(
        stringScore,
        pianoPart,
        pianoChords,
        { fifths: detectedInputKeyFifths, mode: detectedMode }
      );
    }

    // ── Overlay piano bass rhythm on Cello + Double Bass ─────────────────
    // Replace the DP-generated cello/bass events with events timed to the
    // piano source's left-hand (staff=2 / voice>=3) note onsets.  Pitches
    // are re-selected from chord tones via the same candidate machinery, so
    // harmony is always respected.  If the piano has no left-hand data for a
    // measure, a quarter-note grid is used as a fallback.
    if (pianoPart) {
      applyPianoBassRhythm(
        stringScore,
        pianoPart,
        pianoChords,
        { fifths: detectedInputKeyFifths, mode: detectedMode }
      );
    }

    // ── Output: strings only (piano used as harmony source, not in output) ──
    const stringParts: any[] = (stringScore as any).parts ?? [];
    const finalScore: any = {
      ...(JSON.parse(JSON.stringify(stringScore)) as any),
      meta: { ...(stringScore as any).meta, ensemble: "string_ensemble" },
      parts: stringParts
    };

    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore as ScoreModel,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (wantsWoodwinds) {
    // ── Woodwind ensemble (auto) — full parity with string ensemble auto ────
    //   1. Runs the string DP → proper 4/5-voice chord-tone separation
    //   2. Remaps Vln I/II/Vla/Vc(/Cb) → Flute/Oboe/Clarinet/(Horn)/Bassoon
    //   3. Clamps notes to each instrument's sounding range (sweet-spot aware)
    //   4. Applies source rhythm with per-instrument agility/activity
    //
    // Clarinet in Bb / Horn in F: pitches stored as concert/sounding; the
    // exporter adds the written transposition (+2 clarinet, +7 horn).
    //
    // Texture (woodwindTexture) and example/composer mirror the string settings.
    // An example may set the default texture if the user hasn't chosen one.
    const wwTexture: WoodwindTexture | undefined =
      (settings.woodwindTexture as WoodwindTexture | undefined) ??
      (settings.woodwindExample ? (woodwindExampleToTexture(settings.woodwindExample) ?? undefined) : undefined);
    const wwProfile = woodwindTextureToProfile(wwTexture, styleRaw, usePolyphonic);

    // Activity is driven by the chosen texture so each texture sounds distinct
    // (block chorale vs melody+accompaniment vs chamber dialogue).
    const wwActivity = woodwindTextureToActivity(wwTexture) as Partial<Record<"fl" | "ob" | "cl" | "hn" | "bn", WoodwindActivity>>;

    const wwIsContrapuntal = usePolyphonic || wwTexture === "contrapuntal";
    const wwResult = arrangeWoodwindEnsemble(scoreModel, chords as any, {
      profile:    wwProfile,
      chords:     chords as any,
      key:        { fifths: detectedInputKeyFifths, mode: detectedMode },
      quintet:    wantsWoodwindQuintet,
      activity:   wwActivity,
      polyphonic: wwIsContrapuntal,
      level:      settings.level,
      warnings,
    });

    attachTextureAnalysis(wwResult.scoreModel, warnings);
    return {
      scoreModel: wwResult.scoreModel as ScoreModel,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: [],
    };
  }

  if (wantsPianoBrassCopy) {
    // Piano→brass (copy): RH chord→Trumpet 1/2/Horn, LH→Trombone/Tuba.
    // Tuba entry rule: manual measure if set, else auto-detect the thin intro.
    const tubaEntry: number | "auto" | "always" =
      typeof settings.bassoonEntryMeasure === "number" && settings.bassoonEntryMeasure >= 1
        ? settings.bassoonEntryMeasure
        : (settings.bassoonEntryMeasure as any) === 0
          ? "always"
          : "auto";
    const brQuintet = settings.brassQuintet !== false; // default quintet (with Horn)
    const finalScore = arrangeBrassQuintetFromPianoInstrumentation(scoreModel, {
      warnings,
      quintet: brQuintet,
      tubaEntry,
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

  if (wantsChoralBrass) {
    // Choral-brass: SATB → Soprano→Trumpet 1, Alto→Trumpet 2, Tenor→Trombone, Bass→Tuba.
    const finalScore = arrangeSatbToBrassQuartetDirect(scoreModel, { warnings });
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

  if (wantsPianoWithBrass) {
    // Piano+brass (complement): piano as harmony source → DP brass arrangement.
    // Mirrors piano_with_woodwinds — the piano is NOT in the output.
    const brChords = chords.length ? chords : inferChordsFromAllVoices(scoreModel);
    if (!brChords.length) {
      warnings.push("[piano+brass] Could not infer chords from piano score — brass parts may be sparse.");
    }
    const brTexture: BrassTexture | undefined =
      (settings.brassTexture as BrassTexture | undefined) ??
      (settings.brassExample ? (brassExampleToTexture(settings.brassExample) ?? undefined) : undefined);
    const brProfile = brassTextureToProfile(brTexture, styleRaw, usePolyphonic);
    const brActivity = brassTextureToActivity(brTexture) as Partial<Record<"tpt1"|"tpt2"|"hn"|"tbn"|"tuba", BrassActivity>>;
    const brQuintet = settings.brassQuintet !== false;

    const brResult = arrangeBrassEnsemble(scoreModel, brChords as any, {
      profile:          brProfile,
      chords:           brChords as any,
      key:              { fifths: detectedInputKeyFifths, mode: detectedMode },
      quintet:          brQuintet,
      activity:         brActivity,
      polyphonic:       usePolyphonic || brTexture === "contrapuntal",
      level:            settings.level,
      rhythmSourcePart: frozenPianoPart,   // use piano RH onsets as rhythm grid
      warnings,
    });
    attachTextureAnalysis(brResult.scoreModel, warnings);
    return {
      scoreModel: brResult.scoreModel as ScoreModel,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  if (wantsBrass) {
    // ── Brass ensemble (auto) — DP-based, mirrors the woodwind/string engine ──
    //   Trumpet 1/2 ← top voices, Horn ← inner, Trombone ← tenor, Tuba ← bass.
    //   Concert pitch; exporter writes transposition (Trumpet +2, Horn +7).
    // Without chords the rhythm/texture stage cannot run (applyBrassRhythm
    // requires a harmonic grid), so a chordless source — e.g. a piano score —
    // would collapse every texture to the same DP block output.
    const brChords = chords.length ? chords : inferChordsFromAllVoices(scoreModel);
    if (!brChords.length) {
      warnings.push("[brass] Could not infer chords from the source — textures may sound identical.");
    }
    const brTexture: BrassTexture | undefined =
      (settings.brassTexture as BrassTexture | undefined) ??
      (settings.brassExample ? (brassExampleToTexture(settings.brassExample) ?? undefined) : undefined);
    const brProfile = brassTextureToProfile(brTexture, styleRaw, usePolyphonic);
    const brActivity = brassTextureToActivity(brTexture) as Partial<Record<"tpt1"|"tpt2"|"hn"|"tbn"|"tuba", BrassActivity>>;
    const brQuintet = settings.brassQuintet !== false; // default quintet (with Horn)

    const brResult = arrangeBrassEnsemble(scoreModel, brChords as any, {
      profile:    brProfile,
      chords:     brChords as any,
      key:        { fifths: detectedInputKeyFifths, mode: detectedMode },
      quintet:    brQuintet,
      activity:   brActivity,
      polyphonic: usePolyphonic || brTexture === "contrapuntal",
      level:      settings.level,
      warnings,
    });
    attachTextureAnalysis(brResult.scoreModel, warnings);
    return {
      scoreModel: brResult.scoreModel as ScoreModel,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: []
    };
  }

  // ── Piano Choral Hymn shortcut ────────────────────────────────────────────
  // When the piano "Choral" style is selected (textureMode = homorhythmic),
  // bypass all rhythm pre-processing and pattern logic.  Hand the 4 SATB
  // parts directly to buildChoralHymnGrandStaff which maps them onto a
  // grand staff: soprano+alto on treble, tenor+bass on bass.
  const wantsPianoChoral = wantsPiano && useHomorhythmic;
  if (wantsPianoChoral) {
    // Lock last 2 measures of A/T/B to the soprano rhythm before stacking onto grand staff
    preserveFinalMeasuresRhythm(scoreModel, 2, warnings);
    const finalScore = arrangePianoFromSatb(scoreModel, {
      warnings,
      choralHymn: true
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
  // ─────────────────────────────────────────────────────────────────────────

  // ── Piano Melody + Accompaniment shortcut ─────────────────────────────────
  // When the piano "Accompaniment" style is selected (textureMode = melody_accompaniment),
  // bypass all SATB voice logic. Put melody on Staff 1 and generate a left-hand
  // pattern on Staff 2 using the chord symbols from the harmonization.
  //
  // LH pattern selection:
  //   jazz                     → jazz_shell            (root+10th half dyad + sparse quarters — Autumn Leaves)
  //   polyphonic               → broken_ascending      (arpeggiated 16ths per beat — Stevens #11-12)
  //   6/8 / 9/8 / 12/8        → nocturne              (compound rolling arpeggio — Chopin Op.9 No.2, Mendelssohn Op.19 No.3)
  //   ballad                   → interval_oscillation  (tremolo mid/high 8ths — Erlkönig/Sonata18)
  //   3/4 + worship            → octave_bass           (root octave pair every beat — LOBE DEN HERREN)
  //   3/4 + romantic           → serenade_strum        (guitar-strum bass+mid/high 8ths — Ständchen)
  //   3/4 other                → waltz_bass            (root on 1, chord on 2+3)
  //   baroque / romantic 4/4   → root_chord_stabs      (root beat-1, chord blocks — Erlkönig)
  //   worship / contemporary   → boom_chick            (root on 1+3, chord stab on 2+4 — Stevens #6-8)
  //   classical (default)      → alberti               (K.545 style root-5th-3rd-5th)
  const wantsPianoAccomp = wantsPiano && useMelodyAccomp;
  if (wantsPianoAccomp) {
    // Detect time signature for waltz / serenade routing
    const firstAttrs = (scoreModel.parts?.[0]?.measures?.[0] as any)?.attributes;
    const timeSigBeats     = Number(firstAttrs?.time?.beats ?? 4);
    const timeSigBeatType  = Number(firstAttrs?.time?.beat_type ?? 4);
    const isWaltz    = timeSigBeats === 3 && timeSigBeatType === 4;
    const isCompound = timeSigBeatType === 8 && timeSigBeats % 3 === 0; // 6/8, 9/8, 12/8

    // ── Explicit pattern override ─────────────────────────────────────────
    // When the user has chosen a specific pattern in the UI, use it directly.
    const VALID_LH_PATTERNS = new Set<LhPatternId>([
      "alberti", "block_beats", "boom_chick", "broken_ascending", "waltz_bass",
      "serenade_strum", "root_chord_stabs", "interval_oscillation",
      "jazz_shell", "octave_bass", "nocturne",
      "pop_arpeggio", "walking_bass", "pedal_bass", "spec_bass",
    ]);
    const explicitPattern = settings.lhPattern && settings.lhPattern !== "auto"
      ? (VALID_LH_PATTERNS.has(settings.lhPattern as LhPatternId) ? settings.lhPattern as LhPatternId : null)
      : null;

    let lhPattern: LhPatternId;
    if (explicitPattern) {
      lhPattern = explicitPattern;              // user-selected pattern
    } else if (styleRaw === "jazz") {
      lhPattern = "jazz_shell";                 // wide root+10th dyad + sparse quarters
    } else if (usePolyphonic || accompaniment === "polyphonic") {
      lhPattern = "broken_ascending";           // ascending arpeggio 16ths
    } else if (isCompound) {
      lhPattern = "nocturne";                   // compound-meter rolling arpeggio (Chopin, Mendelssohn)
    } else if (styleRaw === "ballad") {
      lhPattern = "interval_oscillation";       // tremolo inner-voice texture
    } else if (isWaltz && (styleRaw === "worship" || styleRaw === "hymn")) {
      lhPattern = "octave_bass";                // pipe-organ octave pairs (LOBE DEN HERREN)
    } else if (isWaltz && styleRaw === "romantic") {
      lhPattern = "serenade_strum";             // Schubert guitar strum
    } else if (isWaltz) {
      lhPattern = "waltz_bass";                 // classic root-1 / chord-2+3
    } else if (styleRaw === "baroque" || styleRaw === "romantic") {
      lhPattern = "root_chord_stabs";           // dramatic root + chord blocks
    } else if (styleRaw === "pop") {
      lhPattern = "walking_bass";               // pop ballad walking bass (Drotos Lessons 12, 14)
    } else if (styleRaw === "worship" || styleRaw === "contemporary") {
      lhPattern = "boom_chick";                 // boom-chick pattern
    } else {
      lhPattern = "alberti";                    // classical default (K.545 style)
    }

    // ── Schoenberg tempo gate (Fundamentals Ch. IX) ───────────────────────────
    // "The accompaniment figure must be compatible with the character and tempo
    //  of the piece." — Schoenberg
    //
    // Alberti and broken-ascending patterns rely on subdividing each beat into
    // four 16th or 8th notes.  At very fast tempos (Allegro vivace, Presto ≥ 144)
    // those subdivisions become physically impractical for pianists and aurally
    // indistinct — they blur into a wash rather than articulating the harmony.
    // Block-chord or boom-chick patterns remain legible at any speed.
    //
    // Threshold calibrated from standard repertoire:
    //   • K.545 Allegro ≈ 126 bpm → Alberti works perfectly
    //   • Beethoven Op.13 Allegro di molto ≈ 168 bpm → block chords in LH
    //   • Chopin Etude Op.10 No.1 ≈ 176 bpm → arpeggios are deliberate virtuosity
    //     (not our case here — we auto-select for general use, not etude writing)
    // At ≥ 144 bpm we downgrade to block_beats unless the pattern is already
    // a long-note family (boom_chick, block_beats, jazz_shell, octave_bass).
    const FAST_TEMPO_THRESHOLD = 144;
    const FIGURATION_PATTERNS = new Set<LhPatternId>([
      "alberti", "broken_ascending", "interval_oscillation", "nocturne", "pop_arpeggio",
    ]);
    if (
      !explicitPattern &&
      tempoBpm >= FAST_TEMPO_THRESHOLD &&
      FIGURATION_PATTERNS.has(lhPattern)
    ) {
      lhPattern = isWaltz ? "waltz_bass" : "block_beats";
      warnings.push(
        `[piano:accomp] Tempo ${tempoBpm} bpm ≥ ${FAST_TEMPO_THRESHOLD} — ` +
        `switched to ${lhPattern} (Schoenberg: figuration patterns impractical at fast tempos).`
      );
    }

    // RH pattern: user-selected takes priority; fall back to auto-selection.
    // Auto-select RH pattern to match the LH/texture choice:
    //   polyphonic mode  → melody_inner_voice  (2-voice chiming, Worship Example 1 + Example 3)
    //   lyrical/3/4 mode → melody_fill_eighths (ascending broken-chord fill, Example 3/4)
    //   homophonic       → melody_inner_voice  (default — polyphonic feel for accompaniment)
    const VALID_RH_PATTERNS = new Set([
      "block_beats", "melody_inner_voice", "melody_fill_eighths",
      "syncopated", "arpeggio", "melody_only", "dotted_ballad",
    ]);
    const userRhPattern = settings.rhPattern && VALID_RH_PATTERNS.has(settings.rhPattern)
      ? settings.rhPattern as import("../arrange/pianoAccompPatterns").RhPatternId
      : null;
    const rhPatternAuto =
      userRhPattern ?? (
        styleRaw === "pop"
          ? "dotted_ballad" as const               // Elton John / pop ballad 3+1 feel
          : (isWaltz || lhPattern === "serenade_strum" || lhPattern === "nocturne")
            ? "melody_fill_eighths" as const
            : "melody_inner_voice" as const
      );

    const finalScore = arrangePianoFromSatb(scoreModel, {
      warnings,
      chords,
      lhPattern,
      rhPattern: rhPatternAuto,
      polyphonic: usePolyphonic || accompaniment === "polyphonic",
      // forcePattern: when the user explicitly chose an LH or RH pattern, skip
      // the Schoenberg density-simplification override so their choice is honoured.
      forcePattern: !!(explicitPattern || userRhPattern),
      bassRhythm: settings.bassRhythm,
      bassFinalNote: settings.bassFinalNote,
    });
    attachTextureAnalysis(finalScore, warnings);
    return {
      scoreModel: finalScore,
      warnings,
      detectedInputKeyFifths,
      appliedTransposeSemitones,
      styleUsed,
      cadenceMeasures: [],
    };
  }
  // ─────────────────────────────────────────────────────────────────────────

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
    // Ensure last 2 measures are strictly homorhythmic even if chord-lock shifted any notes
    preserveFinalMeasuresRhythm(scoreModel, 2, warnings);
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
          worshipChordPad: wantsPianoWithMelody ? false : (worshipPiano || !!settings.pianoStylePreset),
          pianoStylePreset: settings.pianoStylePreset,
          pianoStylePresetPath: settings.pianoStylePresetPath,
          ensembleTag: pianoEnsembleTag
        })
      : wantsStrings
        ? useStringEnsembleArranger
          ? (() => {
              // Bach chorales → use the chorale-calibrated profile automatically.
              const profile = (usePolyphonic
                ? "countermelody"
                : styleRaw === "baroque"
                  ? "bach_chorale"
                  : (settings.stringTexture ?? "melody_harmony")) as ProfileId;
              const stringResult = arrangeStringEnsemble(scoreModel, chords, { profile });
              warnings.push(...(stringResult.warnings ?? []));
              const stringScore = stringResult.scoreModel;
              if (usePolyphonic) {
                // ── Schoenberg density scaling for string inner voices ──────────
                // Measure Vln I melodic density and step down Vln II / Vla activity
                // if the melody is ornate, so inner voices don't crowd the foreground.
                const vln1Part = (stringScore.parts ?? []).find(
                  (p: any) => String(p?.name ?? "").toLowerCase().includes("violin i")
                );
                // Promote inner voices to at least "active" for real counterpoint.
                // Users can raise above "active" via the UI; we only floor, never lower.
                const rawVln2Act = promoteActivityForPolyphony(
                  (settings.vln2Activity ?? settings.altoActivity ?? "active") as Activity
                );
                const rawVlaAct = promoteActivityForPolyphony(
                  (settings.vlaActivity ?? settings.tenorActivity ?? "active") as Activity
                );
                const adaptedVln2Act = schoenbergScaleActivity(vln1Part, rawVln2Act);
                const adaptedVlaAct  = schoenbergScaleActivity(vln1Part, rawVlaAct);
                if (adaptedVln2Act !== rawVln2Act || adaptedVlaAct !== rawVlaAct) {
                  warnings.push(
                    `[strings] Schoenberg density scaling: ornate Vln I melody → ` +
                    `vln2 ${rawVln2Act}→${adaptedVln2Act}, vla ${rawVlaAct}→${adaptedVlaAct}.`
                  );
                }
                applyStringPolyphonicRhythm(stringScore, {
                  vln1Activity: settings.vln1Activity ?? "grounded",
                  vln2Activity: adaptedVln2Act,
                  vlaActivity:  adaptedVlaAct,
                  vcActivity: settings.vcActivity ?? settings.bassActivity ?? "less_active",
                  cbActivity: settings.cbActivity ?? settings.bassActivity ?? "less_active",
                  chordEvents: chords,
                  keyFifths: detectedInputKeyFifths,
                  keyMode: detectedMode,
                  syncopate: true,
                  warnings,
                  tempoBpm,
                  style: styleUsed,
                  composerKey: composerKey || undefined,
                  suzukiVolume: typeof settings.suzukiVolume === "number" ? settings.suzukiVolume : undefined,
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
          activity: effectiveBassActivity,
          randomizeOffsets: settings.randomizeOffsets !== false,
          minMidiOverride: pianoAdvanced ? 40 : undefined,
          maxMidiOverride: pianoAdvanced ? 52 : undefined
        });
        warnings.push(...(bassRhythm.warnings ?? []));
      }
      const tenorRhythm = applyPolyphonicTenorCounterRhythm(scoreModel, chords, {
        allowRests: true,
        activity: effectiveTenorActivity,
        randomizeOffsets: settings.randomizeOffsets !== false,
        minMidiOverride: pianoAdvanced ? 52 : undefined,
        maxMidiOverride: pianoAdvanced ? 64 : undefined,
        durationWhitelist:
          wantsPiano && worshipPiano && settings.level === "advanced" && effectiveTenorActivity === "less_active" ? [1, 2] : undefined
      });
      warnings.push(...(tenorRhythm.warnings ?? []));
      const altoRhythm = applyPolyphonicAltoCounterRhythm(scoreModel, chords, {
        allowRests: true,
        activity: effectiveAltoActivity,
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

  // ── Homorhythmic cadence: lock last 2 measures to soprano rhythm ───────────
  // Regardless of what rhythm the counter-point functions applied to A/T/B,
  // the final 2 measures must match the original melody — standard SATB rule.
  preserveFinalMeasuresRhythm(scoreModel, 2, warnings);
  // ─────────────────────────────────────────────────────────────────────────

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
            const profile = (usePolyphonic
              ? "countermelody"
              : styleRaw === "baroque"
                ? "bach_chorale"
                : (settings.stringTexture ?? "melody_harmony")) as ProfileId;
            const stringResult = usePolyphonic
              ? arrangeStringPolyphonic(scoreModel, chords, { level: settings.level })
              : arrangeStringEnsemble(scoreModel, chords, { profile });
            warnings.push(...(stringResult.warnings ?? []));
            const stringScore = stringResult.scoreModel;
            if (usePolyphonic) {
              const levelRaw = String(settings.level ?? "").toLowerCase();
              const melodyShift = levelRaw === "intermediate" || levelRaw === "advanced" ? 12 : 0;
              const melodyEvents = extractMelodyEventsForStrings(scoreModel, melodyShift);
              // ── Schoenberg density scaling for string inner voices ──────────
              // Measure Vln I melodic density from the ORIGINAL score (before
              // arrangeStringPolyphonic rewrites it) and step down Vln II / Vla
              // activity when the melody is ornate (Schoenberg Ch. IX).
              const vln1SrcPart = (scoreModel.parts ?? []).find(
                (p: any) => {
                  const n = String(p?.name ?? "").toLowerCase();
                  return n.includes("soprano") || n.includes("violin i") || n.includes("melody");
                }
              );
              // Promote inner voices to at least "active" for real counterpoint.
              // Users can raise above "active" via the UI; we only floor, never lower.
              const rawVln2Act2 = promoteActivityForPolyphony(
                (settings.vln2Activity ?? settings.altoActivity ?? "active") as Activity
              );
              const rawVlaAct2 = promoteActivityForPolyphony(
                (settings.vlaActivity ?? settings.tenorActivity ?? "active") as Activity
              );
              const adaptedVln2Act2 = schoenbergScaleActivity(vln1SrcPart, rawVln2Act2);
              const adaptedVlaAct2  = schoenbergScaleActivity(vln1SrcPart, rawVlaAct2);
              if (adaptedVln2Act2 !== rawVln2Act2 || adaptedVlaAct2 !== rawVlaAct2) {
                warnings.push(
                  `[strings] Schoenberg density scaling: ornate melody → ` +
                  `vln2 ${rawVln2Act2}→${adaptedVln2Act2}, vla ${rawVlaAct2}→${adaptedVlaAct2}.`
                );
              }
              applyStringPolyphonicRhythm(stringScore, {
                vln1Activity: settings.vln1Activity ?? "grounded",
                vln2Activity: adaptedVln2Act2,
                vlaActivity:  adaptedVlaAct2,
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
                warnings,
                tempoBpm,
                style: styleUsed,
                composerKey: composerKey || undefined
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
