import type { ScoreModel, Part, Measure, NoteEvent, Pitch } from "../score/types";
import fs from "fs";
import path from "path";
import { midiToPitch, pitchToMidi } from "../instruments/instrumentCatalog";
import { parseChordSymbol } from "../harmonize/satb/chordSymbol";

type PianoLevel = "beginner" | "intermediate" | "advanced" | "professional";

type ArrangePianoOptions = {
  level?: PianoLevel;
  warnings?: string[];
  chords?: Array<{ measure: number; t: number; symbol: string }>;
  polyphonic?: boolean;
  rhActivity?: "grounded" | "less_active" | "active" | "high_active";
  sopranoActivity?: "grounded" | "less_active" | "active" | "high_active";
  sopranoMelodyShare?: number;
  omitMelodyInPiano?: boolean;
  separateMelodyPart?: boolean;
  melodyHand?: "left" | "right";
  ensembleTag?: "piano" | "piano_with_melody";
  worshipChordPad?: boolean;
  tempoBpm?: number;
  pianoStylePreset?: string;
  pianoStylePresetPath?: string;
};

type VoiceMap = {
  voice: number;
  staff: number;
  anchor?: "soprano" | "bass";
  relation?: "below" | "above";
};

type VoiceTarget = {
  staff: number;
  voice: number;
  range: { min: number; max: number };
  label: string;
};

type PitchSpelling = { step: string; alter?: number };

type RhythmPattern = {
  grid_resolution?: string;
  pattern_array?: number[];
};

type PianoStylePreset = {
  composition_meta?: {
    title?: string;
    tempo_bpm?: number;
    time_signature?: [number, number];
    feel?: string;
    style_preset?: string;
  };
  instrument_logic?: {
    left_hand_lower?: {
      rhythm_pattern?: RhythmPattern;
    };
    right_hand_upper?: {
      rhythm_pattern?: RhythmPattern;
    };
  };
};

const STEP_TO_PC: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11
};

const REPEAT_RATIO = 0.2;

function warn(warnings: string[], msg: string): void {
  warnings.push(msg);
  // eslint-disable-next-line no-console
  console.warn(msg);
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

function parseBassTargetFromChordSymbol(symbolRaw: string): { pc: number; spelling: PitchSpelling } | null {
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

function chordQualityFlags(symbolRaw: string): { isMajor: boolean; isMinor: boolean; isDominant: boolean } {
  const s = String(symbolRaw || "").trim();
  if (!s) return { isMajor: false, isMinor: false, isDominant: false };
  const m = s.match(/^([A-Ga-g][#b]?)(.*)$/);
  if (!m) return { isMajor: false, isMinor: false, isDominant: false };
  const qual = (m[2] ?? "").trim().toLowerCase();
  const isMaj = qual.startsWith("maj") || qual.includes("maj");
  const isMin = !isMaj && (qual.startsWith("m") || qual.startsWith("min"));
  const isDim = qual.includes("dim") || qual.includes("°");
  const isAug = qual.includes("aug");
  const isDom = qual.includes("7") && !isMaj && !isMin && !isDim && !isAug;
  const isMajor = !isMin && !isDim && !isAug;
  return { isMajor, isMinor: isMin, isDominant: isDom };
}

function resolvePresetPath(presetNameOrPath: string, warnings: string[]): string | null {
  if (!presetNameOrPath) return null;
  const cwd = process.cwd();
  const candidate = path.isAbsolute(presetNameOrPath)
    ? presetNameOrPath
    : path.join(cwd, "rules", "piano", `${presetNameOrPath}.json`);
  const resolved = path.resolve(candidate);
  const root = path.resolve(cwd);
  if (!resolved.startsWith(root)) {
    warn(warnings, `[piano] Preset path "${presetNameOrPath}" is outside the repo root.`);
    return null;
  }
  if (!fs.existsSync(resolved)) {
    warn(warnings, `[piano] Preset file not found: ${resolved}`);
    return null;
  }
  return resolved;
}

// ── Built-in piano style presets ────────────────────────────────────────────
// Pattern arrays are 8-element binary arrays for 4/4 time (one element = one 8th note).
// Each 1 triggers a chord-pad hit; 0 is silence.
//
// Usage: pass pianoStylePreset: "boom_chick" (etc.) from Settings.
// When a built-in preset is active, worship-chord-pad mode is automatically
// enabled so the pattern is applied to the right-hand voicings.
//
const BUILTIN_PIANO_PRESETS: Record<string, PianoStylePreset> = {
  // ── Classical / baroque ──────────────────────────────────────────────────
  // Each beat gets a chord (quarter-note pulse)
  block_chords: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } }
    }
  },
  // ── Pop / ballad ─────────────────────────────────────────────────────────
  // Half-note chords — slow and open
  ballad: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 0, 0, 0, 0] } }
    }
  },
  // Bass on beats 1 & 3, chord stabs on beats 2 & 4 (country / pop)
  boom_chick: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [0, 0, 0, 0, 1, 0, 0, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 0, 0, 0, 0] } }
    }
  },
  // ── Worship / gospel ─────────────────────────────────────────────────────
  // Continuous 8th-note pulse — driving worship feel
  gospel_pulse: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [1, 0, 1, 0, 1, 0, 1, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } }
    }
  },
  // Syncopated gospel: anticipates beats 2 and 4
  gospel_sync: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [1, 0, 0, 1, 0, 0, 1, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } }
    }
  },
  // ── Jazz / Latin ─────────────────────────────────────────────────────────
  // Comp on the "and" of beats 2 and 4 (jazz comp feel)
  jazz_comp: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [0, 0, 0, 1, 0, 0, 0, 1] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 1, 0, 0, 0] } }
    }
  },
  // Bossa-nova: anticipates beat 3 (long, short, long feel)
  bossa_nova: {
    instrument_logic: {
      right_hand_upper: { rhythm_pattern: { pattern_array: [1, 0, 0, 1, 0, 1, 0, 0] } },
      left_hand_lower:  { rhythm_pattern: { pattern_array: [1, 0, 0, 0, 0, 0, 0, 0] } }
    }
  }
};

function loadPianoStylePreset(
  presetNameOrPath: string | undefined,
  warnings: string[]
): PianoStylePreset | null {
  if (!presetNameOrPath) return null;

  // Check built-in presets first (case-insensitive)
  const builtin = BUILTIN_PIANO_PRESETS[presetNameOrPath.toLowerCase().replace(/[-\s]/g, "_")];
  if (builtin) return builtin;

  const resolved = resolvePresetPath(presetNameOrPath, warnings);
  if (!resolved) return null;
  try {
    const raw = fs.readFileSync(resolved, "utf-8");
    const json = JSON.parse(raw);
    if (!json || typeof json !== "object") return null;
    return json as PianoStylePreset;
  } catch (err: any) {
    warn(warnings, `[piano] Failed to read preset "${presetNameOrPath}": ${String(err?.message ?? err)}`);
    return null;
  }
}

function patternOnsetsFromArray(pattern: number[], measureBeats: number): number[] {
  if (!Array.isArray(pattern) || pattern.length === 0) return [];
  if (!Number.isFinite(measureBeats) || measureBeats <= 0) return [];
  const step = measureBeats / pattern.length;
  const onsets: number[] = [];
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i]) {
      onsets.push(Math.round(i * step * 1000) / 1000);
    }
  }
  if (!onsets.length) return [];
  return Array.from(new Set(onsets)).sort((a, b) => a - b);
}

function slicePatternOnsets(onsets: number[], start: number, end: number): number[] {
  const within = onsets.filter((t) => t >= start - 1e-6 && t < end - 1e-6);
  if (!within.length) return [start];
  if (Math.abs(within[0] - start) > 1e-6) within.unshift(start);
  return within;
}

function pitchWithSpelling(midi: number, spelling: PitchSpelling | null | undefined): Pitch {
  const base = midiToPitch(midi);
  if (!spelling) return base;
  const basePc = ((midi % 12) + 12) % 12;
  const targetPc = (STEP_TO_PC[spelling.step] + (spelling.alter ?? 0) + 12) % 12;
  if (basePc !== targetPc) return base;
  return { step: spelling.step, alter: spelling.alter, octave: base.octave };
}

function pickMidiForPcNear(
  pc: number,
  nearMidi: number,
  range: { min: number; max: number }
): number | null {
  const targetPc = ((pc % 12) + 12) % 12;
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (((m % 12) + 12) % 12 === targetPc) candidates.push(m);
  }
  if (!candidates.length) return null;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const score = Math.abs(c - nearMidi);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function shouldAllowRepeat(measureNumber: number, t: number, ratio = REPEAT_RATIO, salt = 0): boolean {
  if (ratio <= 0) return false;
  if (ratio >= 1) return true;
  const tKey = Math.round(t * 1000);
  let h = (measureNumber * 2654435761) ^ (tKey * 805459861) ^ (salt * 1224736769) ^ 0x9e3779b9;
  h = (h >>> 0) % 1000;
  return h / 1000 < ratio;
}

function resolveChordsForArrange(
  chords: Array<{ measure: number; t: number; symbol: string }> | undefined,
  score: ScoreModel
): Array<{ measure: number; t: number; symbol: string }> {
  if (Array.isArray(chords) && chords.length) return chords;
  const meta = (score as any)?.meta ?? {};
  const inputChords = Array.isArray(meta?.inputChords) ? meta.inputChords : [];
  if (inputChords.length) return inputChords;
  const inferred = Array.isArray(meta?.harmonize?.chords) ? meta.harmonize.chords : [];
  return inferred;
}

function findPart(score: ScoreModel, predicate: (p: Part) => boolean): Part | null {
  for (const p of score.parts ?? []) {
    if (predicate(p)) return p;
  }
  return null;
}

function findSoprano(score: ScoreModel): Part | null {
  return (
    findPart(score, (p) => String(p.part_id).toLowerCase() === "p_s") ??
    findPart(score, (p) => String(p.name ?? "").toLowerCase().includes("soprano")) ??
    findPart(score, (p) => String(p.name ?? "").toLowerCase().includes("melody")) ??
    (score.parts?.[0] ?? null)
  );
}

function findAlto(score: ScoreModel): Part | null {
  return (
    findPart(score, (p) => String(p.part_id).toLowerCase() === "p_a") ??
    findPart(score, (p) => String(p.name ?? "").toLowerCase().includes("alto")) ??
    null
  );
}

function findTenor(score: ScoreModel): Part | null {
  return (
    findPart(score, (p) => String(p.part_id).toLowerCase() === "p_t") ??
    findPart(score, (p) => String(p.name ?? "").toLowerCase().includes("tenor")) ??
    null
  );
}

function findBass(score: ScoreModel): Part | null {
  return (
    findPart(score, (p) => String(p.part_id).toLowerCase() === "p_b") ??
    findPart(score, (p) => String(p.name ?? "").toLowerCase().includes("bass")) ??
    (score.parts?.[score.parts.length - 1] ?? null)
  );
}

function cloneMeasuresTemplate(src: Part): Measure[] {
  return (src.measures ?? []).map((m) => ({
    number: m.number,
    attributes: m.attributes ? { ...m.attributes } : undefined,
    events: []
  }));
}

function cloneMeasuresWithEvents(src: Part): Measure[] {
  return (src.measures ?? []).map((m) => ({
    number: m.number,
    attributes: m.attributes ? { ...m.attributes } : undefined,
    events: (m.events ?? []).map((e: any) => ({ ...e }))
  }));
}

function eventMidi(ev: any): number | null {
  if (typeof ev?.midi === "number" && Number.isFinite(ev.midi)) return ev.midi;
  if (ev?.pitch) {
    try {
      return pitchToMidi(ev.pitch);
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

function findNoteMidiAtOrBeforeTime(events: any[], t: number): number | null {
  let last: any | null = null;
  for (const e of events) {
    if (e?.type !== "note") continue;
    const et = Number(e.t);
    if (!Number.isFinite(et)) continue;
    if (et <= t) {
      if (!last || et > Number(last.t)) last = e;
    }
  }
  return last ? eventMidi(last) : null;
}

function setEventMidi(ev: any, midi: number): void {
  ev.midi = midi;
  ev.pitch = midiToPitch(midi);
}

function adjustMidiToRangeByOctave(midi: number, min: number, max: number): number | null {
  let m = midi;
  while (m < min) m += 12;
  while (m > max) m -= 12;
  if (m < min || m > max) return null;
  return m;
}

function clampMidiToRange(midi: number, min: number, max: number): number {
  if (midi < min) return min;
  if (midi > max) return max;
  return midi;
}

function findActiveEvent(events: any[], staff: number, voice: number, t: number): any | null {
  for (const e of events) {
    if (!e || e.type !== "note") continue;
    if (e.staff !== staff || e.voice !== voice) continue;
    const et = Number(e.t);
    const dur = Number(e.dur);
    if (!Number.isFinite(et) || !Number.isFinite(dur)) continue;
    if (et <= t && t < et + dur) return e;
  }
  return null;
}

function enforceVoiceSpacingForMeasure(
  events: any[],
  measureNumber: number,
  measureBeats: number,
  warnings: string[],
  options?: {
    tenorBassMin?: number;
    tenorRange?: { min: number; max: number };
    bassRange?: { min: number; max: number };
    altoRange?: { min: number; max: number };
    sopranoRange?: { min: number; max: number };
    allowOverlap?: boolean;
  }
): void {
  const times = new Set<number>();
  for (const e of events) {
    if (e && e.type === "note" && Number.isFinite(e.t)) {
      const start = Number(e.t);
      times.add(start);
      const dur = Number(e.dur);
      if (Number.isFinite(dur) && dur > 0) {
        const end = Math.round((start + dur) * 1000) / 1000;
        times.add(end);
      }
    }
  }
  const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
  for (let b = 0; b < beatCount; b += 1) {
    times.add(b);
  }
  const orderedTimes = Array.from(times).sort((a, b) => a - b);

  const hasVoice4 = events.some((e) => e && e.staff === 2 && e.voice === 4);
  const bassVoice = hasVoice4 ? 4 : 3;
  const tenorVoice = hasVoice4 ? 3 : null;

  const harmonyMin = Math.min(
    41,
    options?.bassRange?.min ?? 128,
    options?.tenorRange?.min ?? 128,
    options?.altoRange?.min ?? 128,
    options?.sopranoRange?.min ?? 128
  );
  const harmonyMax = Math.max(
    72,
    options?.bassRange?.max ?? 0,
    options?.tenorRange?.max ?? 0,
    options?.altoRange?.max ?? 0,
    options?.sopranoRange?.max ?? 0
  );

  const sopranoRange = options?.sopranoRange ?? { min: harmonyMin, max: harmonyMax };
  const altoRange = options?.altoRange ?? { min: harmonyMin, max: harmonyMax };
  const tenorRange = options?.tenorRange ?? { min: harmonyMin, max: harmonyMax };
  const bassRange = options?.bassRange ?? { min: harmonyMin, max: harmonyMax };

  for (const t of orderedTimes) {
    const sEv = findActiveEvent(events, 1, 1, t);
    const aEv = findActiveEvent(events, 1, 2, t);
    const tEv = tenorVoice ? findActiveEvent(events, 2, tenorVoice, t) : null;
    const bEv = findActiveEvent(events, 2, bassVoice, t);

    let sMidi = sEv ? eventMidi(sEv) : null;
    let aMidi = aEv ? eventMidi(aEv) : null;
    let tMidi = tEv ? eventMidi(tEv) : null;
    let bMidi = bEv ? eventMidi(bEv) : null;

    if (tEv && typeof tMidi === "number") {
      const { min, max } = tenorRange;
      if (tMidi < min || tMidi > max) {
        const adj = adjustMidiToRangeByOctave(tMidi, min, max);
        if (adj !== null) {
          setEventMidi(tEv, adj);
          tMidi = adj;
        } else {
          const clamped = clampMidiToRange(tMidi, min, max);
          setEventMidi(tEv, clamped);
          tMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor clamped to range.`);
        }
      }
    }

    if (bEv && typeof bMidi === "number") {
      const { min, max } = bassRange;
      if (bMidi < min || bMidi > max) {
        const adj = adjustMidiToRangeByOctave(bMidi, min, max);
        if (adj !== null) {
          setEventMidi(bEv, adj);
          bMidi = adj;
        } else {
          const clamped = clampMidiToRange(bMidi, min, max);
          setEventMidi(bEv, clamped);
          bMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Bass clamped to range.`);
        }
      }
    }

    const sLocked = sEv && ((sEv as any).__lockPitch === true || (sEv as any).__melody === true);
    if (sEv && typeof sMidi === "number" && !sLocked) {
      const { min, max } = sopranoRange;
      if (sMidi < min || sMidi > max) {
        const adj = adjustMidiToRangeByOctave(sMidi, min, max);
        if (adj !== null) {
          setEventMidi(sEv, adj);
          sMidi = adj;
        } else {
          const clamped = clampMidiToRange(sMidi, min, max);
          setEventMidi(sEv, clamped);
          sMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Soprano clamped to range.`);
        }
      }
    }

    if (aEv && typeof aMidi === "number") {
      const { min, max } = altoRange;
      if (aMidi < min || aMidi > max) {
        const adj = adjustMidiToRangeByOctave(aMidi, min, max);
        if (adj !== null) {
          setEventMidi(aEv, adj);
          aMidi = adj;
        } else {
          const clamped = clampMidiToRange(aMidi, min, max);
          setEventMidi(aEv, clamped);
          aMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Alto clamped to range.`);
        }
      }
    }

    if (options?.allowOverlap) continue;

    // Soprano/Alto: max octave (do not move locked melody)
    if (aEv && typeof aMidi === "number" && typeof sMidi === "number") {
      let minA = Math.max(sMidi - 12, altoRange.min);
      let maxA = Math.min(sMidi - 1, altoRange.max);
      if (minA <= maxA && (aMidi < minA || aMidi > maxA)) {
        const adj = adjustMidiToRangeByOctave(aMidi, minA, maxA);
        if (adj !== null) {
          setEventMidi(aEv, adj);
          aMidi = adj;
        } else {
          const clamped = clampMidiToRange(aMidi, minA, maxA);
          setEventMidi(aEv, clamped);
          aMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Alto/Soprano spacing clamped to octave.`);
        }
      }
      if (!sLocked && aMidi !== null && sMidi !== null && sMidi - aMidi > 12) {
        const minS = Math.max(aMidi + 1, sopranoRange.min);
        const maxS = Math.min(aMidi + 12, sopranoRange.max);
        if (minS <= maxS) {
          const adj = adjustMidiToRangeByOctave(sMidi, minS, maxS);
          if (adj !== null) {
            setEventMidi(sEv, adj);
            sMidi = adj;
          } else {
            const clamped = clampMidiToRange(sMidi, minS, maxS);
            setEventMidi(sEv, clamped);
            sMidi = clamped;
          }
          warn(warnings, `[piano] m${measureNumber} t=${t}: Soprano adjusted to octave with Alto.`);
        }
      }
    }

    // Alto/Tenor: max octave (allow unison between Alto and Tenor)
    if (tEv && typeof tMidi === "number" && typeof aMidi === "number") {
      let minT = Math.max(aMidi - 12, tenorRange.min);
      let maxT = Math.min(aMidi, tenorRange.max);
      if (minT <= maxT && (tMidi < minT || tMidi > maxT)) {
        const adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
        if (adj !== null) {
          setEventMidi(tEv, adj);
          tMidi = adj;
        } else {
          const clamped = clampMidiToRange(tMidi, minT, maxT);
          setEventMidi(tEv, clamped);
          tMidi = clamped;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor/Alto spacing clamped to octave.`);
        }
      }
      if (tMidi !== null && aMidi !== null && aMidi - tMidi > 12) {
        const minA = Math.max(tMidi, altoRange.min);
        const maxA = Math.min(tMidi + 12, altoRange.max);
        if (minA <= maxA) {
          const adj = adjustMidiToRangeByOctave(aMidi, minA, maxA);
          if (adj !== null) {
            setEventMidi(aEv, adj);
            aMidi = adj;
          } else {
            const clamped = clampMidiToRange(aMidi, minA, maxA);
            setEventMidi(aEv, clamped);
            aMidi = clamped;
          }
          warn(warnings, `[piano] m${measureNumber} t=${t}: Alto adjusted to octave with Tenor.`);
        }
      }
    }

    // Tenor/Bass: max octave
    if (bEv && typeof bMidi === "number" && typeof tMidi === "number") {
      const bassLocked = (bEv as any).__lockPitch === true;
      let minB = Math.max(tMidi - 12, bassRange.min);
      let maxB = Math.min(tMidi - 1, bassRange.max);
      if (minB <= maxB && (bMidi < minB || bMidi > maxB)) {
        if (!bassLocked) {
          const adj = adjustMidiToRangeByOctave(bMidi, minB, maxB);
          if (adj !== null) {
            setEventMidi(bEv, adj);
            bMidi = adj;
          } else {
            const clamped = clampMidiToRange(bMidi, minB, maxB);
            setEventMidi(bEv, clamped);
            bMidi = clamped;
            warn(warnings, `[piano] m${measureNumber} t=${t}: Bass/Tenor spacing clamped to octave.`);
          }
        } else {
          const minT = Math.max(tenorRange.min, bMidi + 1);
          const maxT = Math.min(tenorRange.max, bMidi + 12);
          if (minT <= maxT) {
            const adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
            if (adj !== null) {
              setEventMidi(tEv, adj);
              tMidi = adj;
            } else {
              const clamped = clampMidiToRange(tMidi, minT, maxT);
              setEventMidi(tEv, clamped);
              tMidi = clamped;
            }
            warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor adjusted to maintain bass interval.`);
          }
        }
      }
      if (bMidi !== null && tMidi !== null && tMidi - bMidi > 12) {
        const minT = Math.max(bMidi + 1, tenorRange.min);
        const maxT = Math.min(bMidi + 12, tenorRange.max);
        if (minT <= maxT) {
          const adj = adjustMidiToRangeByOctave(tMidi, minT, maxT);
          if (adj !== null) {
            setEventMidi(tEv, adj);
            tMidi = adj;
          } else {
            const clamped = clampMidiToRange(tMidi, minT, maxT);
            setEventMidi(tEv, clamped);
            tMidi = clamped;
          }
          warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor adjusted to octave with Bass.`);
        }
      }
    }

    const minTb = options?.tenorBassMin;
    let minInterval = typeof minTb === "number" && Number.isFinite(minTb) ? minTb : null;
    if (typeof bMidi === "number" && bMidi < 48) {
      minInterval = Math.max(minInterval ?? 0, 7);
    }
    if (
      typeof minInterval === "number" &&
      Number.isFinite(minInterval) &&
      bEv &&
      tEv &&
      typeof bMidi === "number" &&
      typeof tMidi === "number"
    ) {
      const currentInterval = tMidi - bMidi;
      if (currentInterval < minInterval) {
        const tenorMin = tenorRange.min;
        const tenorMax = tenorRange.max;
        const bassMin = bassRange.min;
        const bassMax = bassRange.max;
        const desiredTenorMin = Math.max(tenorMin, bMidi + minInterval);
        let adjustedTenor = adjustMidiToRangeByOctave(tMidi, desiredTenorMin, tenorMax);
        if (adjustedTenor !== null) {
          setEventMidi(tEv, adjustedTenor);
          tMidi = adjustedTenor;
          warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor raised to maintain bass interval.`);
        } else {
          const bassLocked = (bEv as any).__lockPitch === true;
          const desiredBassMax = Math.min(bassMax, tMidi - minInterval);
          if (!bassLocked) {
            const adjustedBass = adjustMidiToRangeByOctave(bMidi, bassMin, desiredBassMax);
            if (adjustedBass !== null) {
              setEventMidi(bEv, adjustedBass);
              bMidi = adjustedBass;
              warn(warnings, `[piano] m${measureNumber} t=${t}: Bass lowered to maintain tenor interval.`);
            } else {
              const clampedTenor = clampMidiToRange(tMidi, desiredTenorMin, tenorMax);
              const clampedBass = clampMidiToRange(bMidi, bassMin, desiredBassMax);
              setEventMidi(tEv, clampedTenor);
              setEventMidi(bEv, clampedBass);
              warn(warnings, `[piano] m${measureNumber} t=${t}: Bass/Tenor interval clamped to minimum.`);
            }
          } else {
            const clampedTenor = clampMidiToRange(tMidi, desiredTenorMin, tenorMax);
            setEventMidi(tEv, clampedTenor);
            tMidi = clampedTenor;
            warn(warnings, `[piano] m${measureNumber} t=${t}: Tenor clamped to maintain bass interval.`);
          }
        }
      }
    }
  }
}

function clampVoiceLeapsForMeasure(
  events: any[],
  staff: number,
  voice: number,
  maxLeap: number,
  measureNumber: number,
  warnings: string[]
): void {
  const seq = events
    .filter((e) => e && e.type === "note" && e.staff === staff && e.voice === voice && Number.isFinite(e.t))
    .sort((a, b) => Number(a.t) - Number(b.t));
  let prevMidi: number | null = null;
  for (const ev of seq) {
    const midi = eventMidi(ev);
    if (midi === null) continue;
    if (prevMidi === null) {
      prevMidi = midi;
      continue;
    }
    if (Math.abs(midi - prevMidi) <= maxLeap) {
      prevMidi = midi;
      continue;
    }
    const min = prevMidi - maxLeap;
    const max = prevMidi + maxLeap;
    const adj = adjustMidiToRangeByOctave(midi, min, max);
    if (adj !== null) {
      setEventMidi(ev, adj);
      prevMidi = adj;
      continue;
    }
    const clamped = clampMidiToRange(midi, min, max);
    setEventMidi(ev, clamped);
    warn(warnings, `[piano] m${measureNumber} t=${ev.t}: leap clamped for staff ${staff} voice ${voice}.`);
    prevMidi = clamped;
  }
}

function getTempoBpm(score: ScoreModel, fallback = 120): number {
  const tempo = Number(score.meta?.tempo_bpm);
  if (Number.isFinite(tempo) && tempo > 0) return tempo;
  return fallback;
}

function findActiveNotesAtTime(
  events: any[],
  staff: number,
  t: number
): Array<{ ev: any; midi: number }> {
  const out: Array<{ ev: any; midi: number }> = [];
  for (const e of events) {
    if (!e || e.type !== "note") continue;
    if (e.staff !== staff) continue;
    if ((e as any).__drop) continue;
    const et = Number(e.t);
    const dur = Number(e.dur);
    if (!Number.isFinite(et) || !Number.isFinite(dur)) continue;
    if (et <= t && t < et + dur) {
      const midi = eventMidi(e);
      if (typeof midi === "number") out.push({ ev: e, midi });
    }
  }
  return out;
}

function markEventDrop(ev: any): void {
  (ev as any).__drop = true;
}

function trimEventsToMeasure(
  events: any[],
  measureBeats: number,
  measureNumber: number,
  warnings: string[]
): void {
  if (!Number.isFinite(measureBeats) || measureBeats <= 0) return;
  let trimmed = false;
  for (const ev of events) {
    if (!ev || (ev.type !== "note" && ev.type !== "rest")) continue;
    let t = Number(ev.t);
    let dur = Number(ev.dur);
    if (!Number.isFinite(t) || !Number.isFinite(dur)) continue;
    if (t < 0) {
      t = 0;
      ev.t = 0;
      trimmed = true;
    }
    if (t >= measureBeats - 1e-6) {
      markEventDrop(ev);
      trimmed = true;
      continue;
    }
    const end = t + dur;
    if (end > measureBeats + 1e-6) {
      dur = Math.max(0, measureBeats - t);
      ev.dur = dur;
      trimmed = true;
    }
    if (dur <= 1e-6) {
      markEventDrop(ev);
      trimmed = true;
    }
  }
  if (trimmed) {
    warn(warnings, `[piano] m${measureNumber}: trimmed events to measure length.`);
  }
}

function limitHandNoteCountAtTime(
  events: any[],
  staff: number,
  t: number,
  maxNotes: number,
  measureNumber: number,
  warnings: string[]
): void {
  const active = findActiveNotesAtTime(events, staff, t);
  if (active.length <= maxNotes) return;

  const sorted = active.slice().sort((a, b) => a.midi - b.midi);
  const forceKeep = sorted.filter((a) => (a.ev as any).__forceKeep || (a.ev as any).__lockPitch);
  const keep = new Set<number>();
  for (const fk of forceKeep) {
    const idx = sorted.indexOf(fk);
    if (idx >= 0) keep.add(idx);
  }

  if (sorted.length > 0) {
    keep.add(0);
    keep.add(sorted.length - 1);
  }

  let lo = 0;
  let hi = sorted.length - 1;
  let toggle = true;
  while (keep.size < Math.min(maxNotes, sorted.length)) {
    if (toggle) {
      if (!keep.has(hi)) keep.add(hi);
      hi -= 1;
    } else {
      if (!keep.has(lo)) keep.add(lo);
      lo += 1;
    }
    toggle = !toggle;
    if (lo > hi) break;
  }

  let dropped = false;
  for (let i = 0; i < sorted.length; i++) {
    if (keep.has(i)) continue;
    markEventDrop(sorted[i]!.ev);
    dropped = true;
  }

  if (dropped) {
    warn(warnings, `[piano] m${measureNumber} t=${t}: trimmed hand to ${maxNotes} notes.`);
  }
}

function enforceHandLimitsForMeasure(params: {
  events: any[];
  measureNumber: number;
  measureBeats: number;
  warnings: string[];
  maxSpan?: number;
  maxNotes?: number;
  rhRange?: { min: number; max: number };
  lhRange?: { min: number; max: number };
  suppressSpanWarnings?: boolean;
}): void {
  const { events, measureNumber, measureBeats, warnings } = params;
  const maxSpan = params.maxSpan ?? 12; // octave
  const maxNotes = params.maxNotes ?? 4;
  const rhRange = params.rhRange ?? { min: 52, max: 88 };
  const lhRange = params.lhRange ?? { min: 36, max: 72 };
  const suppressSpanWarnings = params.suppressSpanWarnings === true;

  const times = new Set<number>();
  for (const e of events) {
    if (e && e.type === "note" && Number.isFinite(e.t)) {
      const start = Number(e.t);
      times.add(start);
      const dur = Number(e.dur);
      if (Number.isFinite(dur) && dur > 0) {
        const end = Math.round((start + dur) * 1000) / 1000;
        times.add(end);
      }
    }
  }
  const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
  for (let b = 0; b < beatCount; b += 1) {
    times.add(b);
  }
  const orderedTimes = Array.from(times).sort((a, b) => a - b);

  for (const t of orderedTimes) {
    for (const staff of [1, 2]) {
      limitHandNoteCountAtTime(events, staff, t, maxNotes, measureNumber, warnings);

      const active = findActiveNotesAtTime(events, staff, t).filter((a) => !(a.ev as any).__drop);
      if (active.length < 2) continue;
      let sorted = active.slice().sort((a, b) => a.midi - b.midi);
      const range = staff === 1 ? rhRange : lhRange;
      let span = sorted[sorted.length - 1]!.midi - sorted[0]!.midi;
      let adjusted = false;

      while (span > maxSpan) {
        let moved = false;
        if (staff === 1) {
          for (let i = 0; i < sorted.length - 1; i++) {
            const note = sorted[i]!;
            if ((note.ev as any).__forceKeep || (note.ev as any).__lockPitch) continue;
            const candidate = note.midi + 12;
            if (candidate <= range.max && candidate < sorted[sorted.length - 1]!.midi) {
              setEventMidi(note.ev, candidate);
              moved = true;
              adjusted = true;
              break;
            }
          }
        } else {
          for (let i = sorted.length - 1; i > 0; i--) {
            const note = sorted[i]!;
            if ((note.ev as any).__forceKeep || (note.ev as any).__lockPitch) continue;
            const candidate = note.midi - 12;
            if (candidate >= range.min && candidate > sorted[0]!.midi) {
              setEventMidi(note.ev, candidate);
              moved = true;
              adjusted = true;
              break;
            }
          }
        }

        if (!moved) break;
        sorted = findActiveNotesAtTime(events, staff, t).filter((a) => !(a.ev as any).__drop).sort((a, b) => a.midi - b.midi);
        if (sorted.length < 2) break;
        span = sorted[sorted.length - 1]!.midi - sorted[0]!.midi;
      }

      if (span > maxSpan) {
        limitHandNoteCountAtTime(events, staff, t, Math.max(2, maxNotes - 1), measureNumber, warnings);
      }

      if (adjusted && !suppressSpanWarnings) {
        warn(warnings, `[piano] m${measureNumber} t=${t}: hand span clamped to octave.`);
      }
    }
  }
}

function thinChordsAtMelodyOnsets(params: {
  events: any[];
  melodyEvents: any[];
  measureNumber: number;
  warnings: string[];
  staff?: number;
  maxNotes?: number;
}): void {
  const { events, melodyEvents, measureNumber, warnings } = params;
  const staff = params.staff ?? 1;
  const maxNotes = params.maxNotes ?? 2;
  const onsets = new Set<number>();
  for (const e of melodyEvents ?? []) {
    if (!e || e.type !== "note") continue;
    if (!Number.isFinite(e.t)) continue;
    onsets.add(Number(e.t));
  }
  for (const t of onsets) {
    const active = (events ?? []).filter(
      (e: any) => e?.type === "note" && e.staff === staff && Number(e.t) === t && !(e as any).__drop
    );
    if (active.length <= maxNotes) continue;
    const sorted = active
      .map((ev: any) => ({ ev, midi: eventMidi(ev) ?? 0 }))
      .sort((a, b) => a.midi - b.midi);
    const keep = new Set<number>();
    if (sorted.length > 0) {
      keep.add(0);
      keep.add(sorted.length - 1);
    }
    while (keep.size < Math.min(maxNotes, sorted.length)) {
      const idx = keep.size;
      if (!keep.has(idx)) keep.add(idx);
      else break;
    }
    let dropped = false;
    for (let i = 0; i < sorted.length; i++) {
      if (keep.has(i)) continue;
      if ((sorted[i]!.ev as any).__forceKeep) continue;
      markEventDrop(sorted[i]!.ev);
      dropped = true;
    }
    if (dropped) {
      warn(warnings, `[piano] m${measureNumber} t=${t}: thinned RH chord for vocal entry.`);
    }
  }
}

function ensureMelodyStartDoubling(params: {
  events: any[];
  melodyEvents: any[];
  measureNumber: number;
  warnings: string[];
}): void {
  const { events, melodyEvents, measureNumber, warnings } = params;
  if (measureNumber !== 1) return;
  const mel = (melodyEvents ?? []).find((e: any) => e?.type === "note" && Number(e.t) === 0);
  if (!mel) return;
  const melMidi = eventMidi(mel);
  if (melMidi === null) return;
  const existing = (events ?? []).some(
    (e: any) => e?.type === "note" && e.staff === 1 && Number(e.t) === 0 && eventMidi(e) === melMidi
  );
  if (existing) return;
  const dur = Number(mel.dur);
  if (!Number.isFinite(dur) || dur <= 0) return;
  const ev: any = {
    type: "note",
    t: 0,
    dur,
    voice: 1,
    staff: 1,
    pitch: midiToPitch(melMidi),
    id: `1-1-n-${measureNumber}-0-mel-dbl`
  };
  (ev as any).__forceKeep = true;
  events.push(ev);
  warn(warnings, `[piano] m${measureNumber} t=0: doubled vocal entry pitch.`);
}

function dropDuplicateNotesAtTime(params: { events: any[]; measureNumber: number; warnings: string[] }): void {
  const { events, measureNumber, warnings } = params;
  const seen = new Map<string, any>();
  let dropped = 0;
  const preferScore = (ev: any) => ((ev as any).__melody ? 4 : 0) + ((ev as any).__forceKeep ? 2 : 0);
  for (const ev of events ?? []) {
    if (!ev || ev.type !== "note") continue;
    const midi = eventMidi(ev);
    if (typeof midi !== "number") continue;
    const tKey = Math.round(Number(ev.t) * 1000);
    const key = `${ev.staff}:${ev.voice}:${tKey}:${midi}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, ev);
      continue;
    }
    if (preferScore(ev) > preferScore(existing)) {
      markEventDrop(existing);
      seen.set(key, ev);
      dropped += 1;
    } else {
      markEventDrop(ev);
      dropped += 1;
    }
  }
  if (dropped) {
    warn(warnings, `[piano] m${measureNumber}: dropped ${dropped} duplicate note(s) at same time.`);
  }
}

function enforceHarmonyBelowMelody(params: {
  events: any[];
  measureNumber: number;
  warnings: string[];
  rhRange?: { min: number; max: number };
}): void {
  const { events, measureNumber, warnings } = params;
  const rhRange = params.rhRange ?? { min: 52, max: 88 };
  const melodyEvents = (events ?? []).filter(
    (e: any) => e?.type === "note" && e.staff === 1 && e.voice === 1 && (e as any).__melody === true
  );
  if (!melodyEvents.length) return;

  const times = new Set<number>();
  for (const e of melodyEvents) {
    const t = Number(e.t);
    const dur = Number(e.dur);
    if (!Number.isFinite(t) || !Number.isFinite(dur)) continue;
    times.add(t);
    const end = Math.round((t + dur) * 1000) / 1000;
    times.add(end);
  }
  const orderedTimes = Array.from(times).sort((a, b) => a - b);
  let warned = false;

  for (const t of orderedTimes) {
    const mel = findActiveEvent(events, 1, 1, t);
    if (!mel) continue;
    const melMidi = eventMidi(mel);
    if (typeof melMidi !== "number") continue;

    const active = findActiveNotesAtTime(events, 1, t).filter((a) => a.ev !== mel && !(a.ev as any).__drop);
    for (const entry of active) {
      const ev = entry.ev;
      if ((ev as any).__melody) continue;
      const midi = entry.midi;
      if (midi < melMidi) continue;
      let adjusted: number | null = midi;
      while (adjusted !== null && adjusted >= melMidi) {
        const candidate = adjusted - 12;
        adjusted = candidate >= rhRange.min ? candidate : null;
      }
      if (adjusted !== null && adjusted < melMidi) {
        setEventMidi(ev, adjusted);
      } else {
        markEventDrop(ev);
        if (!warned) {
          warn(warnings, `[piano] m${measureNumber} t=${t}: dropped RH harmony above melody.`);
          warned = true;
        }
      }
    }
  }
}
function fitToWindow(midi: number, min: number, max: number): number | null {
  let m = midi;
  while (m < min) m += 12;
  while (m > max) m -= 12;
  if (m < min || m > max) return null;
  return m;
}

function mapVoiceEvents(params: {
  srcEvents: any[];
  voice: number;
  staff: number;
  anchorEvents?: any[];
  relation?: "below" | "above";
  allowedIntervalsAbove?: number[];
  measureNumber: number;
  warnings: string[];
  markMelody?: boolean;
}): NoteEvent[] {
  const { srcEvents, voice, staff, anchorEvents, relation, allowedIntervalsAbove, measureNumber, warnings, markMelody } = params;
  const out: NoteEvent[] = [];
  const sorted = (srcEvents ?? []).filter(isNoteOrRest).slice().sort((a, b) => Number(a.t) - Number(b.t));
  let warned = false;

  for (const ev of sorted) {
    const t = Number(ev.t);
    const dur = Number(ev.dur);
    if (ev.type === "rest") {
      out.push({ type: "rest", t, dur, voice, staff, isRest: true, id: `${voice}-${staff}-r-${t}` } as any);
      continue;
    }

    const midi = eventMidi(ev);
    if (midi === null) continue;

    let useMidi = midi;
    if (relation && anchorEvents?.length) {
      const anchor = findNoteMidiAtTime(anchorEvents, t);
      if (typeof anchor === "number") {
        if (relation === "below") {
          const min = anchor - 12;
          const max = anchor - 1;
          if (min <= max) {
            const fit = fitToWindow(midi, min, max);
            if (fit === null) {
              const clamped = clampMidiToRange(midi, min, max);
              useMidi = clamped;
              if (!warned) {
                warn(warnings, `[piano] m${measureNumber} t=${t}: RH inner voice clamped into octave window.`);
                warned = true;
              }
            } else {
              useMidi = fit;
            }
          }
        } else if (relation === "above") {
          const min = anchor + 1;
          const max = anchor + 12;
          if (min <= max) {
            let fit: number | null = null;
            if (Array.isArray(allowedIntervalsAbove) && allowedIntervalsAbove.length) {
              const candidates = allowedIntervalsAbove
                .map((intv) => anchor + intv)
                .filter((cand) => cand >= min && cand <= max);
              if (candidates.length) {
                let best = candidates[0]!;
                let bestDist = Math.abs(best - midi);
                for (let i = 1; i < candidates.length; i++) {
                  const cand = candidates[i]!;
                  const dist = Math.abs(cand - midi);
                  if (dist < bestDist) {
                    best = cand;
                    bestDist = dist;
                  }
                }
                fit = best;
              }
            } else {
              fit = fitToWindow(midi, min, max);
            }
            if (fit === null) {
              const clamped = clampMidiToRange(midi, min, max);
              useMidi = clamped;
              if (!warned) {
                warn(warnings, `[piano] m${measureNumber} t=${t}: LH inner voice clamped into octave window.`);
                warned = true;
              }
            } else {
              useMidi = fit;
            }
          }
        }
      }
    }

    out.push({
      type: "note",
      t,
      dur,
      voice,
      staff,
      pitch: midiToPitch(useMidi),
      id: `${voice}-${staff}-n-${t}`,
      chord: (ev as any).chord === true,
      isRest: false
    } as any);
    if (markMelody) {
      (out[out.length - 1] as any).__melody = true;
      (out[out.length - 1] as any).__lockPitch = true;
    }
  }

  return out;
}

type ChordEvent = { measure: number; t: number; symbol: string };
type ArpToken = "root" | "third" | "fifth" | "passing";
type AltoRole = "chord" | "passing" | "neighbor" | "appoggiatura" | "skip" | "leap" | "anticipation" | "syncopation";
type ActivityLevel = "less_active" | "active" | "high_active";
type SopranoMode = "melody" | "harmony" | "counter";
type CounterRole =
  | "chord"
  | "passing"
  | "neighbor"
  | "appoggiatura"
  | "skip"
  | "leap"
  | "chromatic"
  | "suspension"
  | "anticipation"
  | "syncopation";

function measureBeatsFromAttributes(attrs: any | undefined): number {
  const beats = Number(attrs?.time?.beats ?? 4);
  const beatType = Number(attrs?.time?.beat_type ?? 4);
  if (!Number.isFinite(beats) || beats <= 0 || !Number.isFinite(beatType) || beatType <= 0) return 4;
  return beats * (4 / beatType);
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

function isChordBoundary(chords: ChordEvent[], measureNumber: number, t: number): boolean {
  for (const c of chords) {
    if (Number(c.measure) !== Number(measureNumber)) continue;
    if (near(Number(c.t), t)) return true;
  }
  return false;
}

function resolveChordToneMap(parsed: { rootPc: number; pcs: number[] } | null): { rootPc: number; thirdPc: number; fifthPc: number } {
  const rootPc = parsed?.rootPc ?? 0;
  const pcs = Array.isArray(parsed?.pcs) && parsed!.pcs.length ? parsed!.pcs : [rootPc];
  const majThird = (rootPc + 4) % 12;
  const minThird = (rootPc + 3) % 12;
  const thirdPc = pcs.includes(majThird) ? majThird : pcs.includes(minThird) ? minThird : rootPc;
  const fifthPc = pcs.includes((rootPc + 7) % 12)
    ? (rootPc + 7) % 12
    : pcs.find((pc) => pc !== rootPc && pc !== thirdPc) ?? rootPc;
  return { rootPc, thirdPc, fifthPc };
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

function scalePcsFromKey(fifths: number, mode: "major" | "minor"): number[] {
  const tonic = mode === "minor" ? tonicPcFromFifthsMinor(fifths) : tonicPcFromFifthsMajor(fifths);
  const intervals = mode === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  return intervals.map((i) => (tonic + i) % 12);
}

function pickMidiForPcBelow(pc: number, min: number, max: number): number | null {
  const targetPc = ((pc % 12) + 12) % 12;
  for (let m = max; m >= min; m--) {
    if (((m % 12) + 12) % 12 === targetPc) return m;
  }
  return null;
}

function pickMidiForPcAtOrAbove(pc: number, min: number, max: number): number | null {
  const targetPc = ((pc % 12) + 12) % 12;
  for (let m = min; m <= max; m++) {
    if (((m % 12) + 12) % 12 === targetPc) return m;
  }
  return null;
}

function chooseChordToneNearestFromPcs(
  chordPcs: number[],
  prevMidi: number,
  range: { min: number; max: number },
  excludeMidis: number[] = []
): number {
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    if (!chordPcs.includes(((m % 12) + 12) % 12)) continue;
    if (excludeMidis.includes(m)) continue;
    candidates.push(m);
  }
  if (!candidates.length) return prevMidi;
  let best = candidates[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const score = Math.abs(c - prevMidi);
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
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
  for (let m = range.min; m <= range.max; m++) {
    if (!chordPcs.includes(((m % 12) + 12) % 12)) continue;
    const dist = Math.abs(m - prevMidi);
    if (dist < minInterval || dist > maxInterval) continue;
    if (dist < bestScore) {
      bestScore = dist;
      best = m;
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

function findScaleNeighborMidi(
  baseMidi: number,
  scalePcs: number[],
  dir: 1 | -1,
  min: number,
  max: number
): number | null {
  const targetSet = new Set(scalePcs);
  for (let i = 1; i <= 12; i++) {
    const m = baseMidi + dir * i;
    if (m < min || m > max) break;
    const pc = ((m % 12) + 12) % 12;
    if (targetSet.has(pc)) return m;
  }
  return null;
}

function findNoteEventAtExactTime(events: any[], t: number): any | null {
  const target = Number(t);
  return (
    events.find(
      (e: any) => e?.type === "note" && Number.isFinite(e.t) && Math.abs(Number(e.t) - target) < 1e-6
    ) ?? null
  );
}

function isRepeatedQuarterAtTime(events: any[], t: number): boolean {
  const ev1 = findNoteEventAtExactTime(events, t);
  if (!ev1) return false;
  const d1 = Number(ev1.dur);
  if (!Number.isFinite(d1) || Math.abs(d1 - 1) > 1e-6) return false;
  const ev2 = findNoteEventAtExactTime(events, t + 1);
  if (!ev2) return false;
  const d2 = Number(ev2.dur);
  if (!Number.isFinite(d2) || Math.abs(d2 - 1) > 1e-6) return false;
  const m1 = eventMidi(ev1);
  const m2 = eventMidi(ev2);
  if (m1 === null || m2 === null) return false;
  return m1 === m2;
}

function findChromaticNeighborMidi(baseMidi: number, dir: 1 | -1, min: number, max: number): number | null {
  const m = baseMidi + dir;
  if (m < min || m > max) return null;
  return m;
}

function pickPassingMidi(params: {
  baseMidi: number;
  scalePcs: number[];
  dir: 1 | -1;
  min: number;
  max: number;
  allowChromatic: boolean;
  preferChromatic: boolean;
}): number | null {
  const { baseMidi, scalePcs, dir, min, max, allowChromatic, preferChromatic } = params;
  if (allowChromatic && preferChromatic) {
    const chrom = findChromaticNeighborMidi(baseMidi, dir, min, max);
    if (chrom !== null) return chrom;
  }
  const diatonic = findScaleNeighborMidi(baseMidi, scalePcs, dir, min, max);
  if (diatonic !== null) return diatonic;
  if (allowChromatic) return findChromaticNeighborMidi(baseMidi, dir, min, max);
  return null;
}

function buildRhFillSteps(segmentBeats: number, activity: "less_active" | "active" | "high_active"): Array<{ dur: number; token: ArpToken }> {
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const stepDur = activity === "less_active" ? 1 : 0.5;
  const pattern: ArpToken[] =
    activity === "less_active"
      ? ["root", "third", "fifth", "root"]
      : activity === "high_active"
        ? ["root", "passing", "third", "passing", "fifth", "passing", "root", "passing"]
        : ["root", "fifth", "third", "fifth", "root", "third", "fifth", "root"];
  const out: Array<{ dur: number; token: ArpToken }> = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  while (remaining > 1e-6) {
    const dur = remaining < stepDur - 1e-6 ? remaining : stepDur;
    out.push({ dur, token: pattern[idx % pattern.length]! });
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
  }
  return out;
}

function buildActiveDurations(segmentBeats: number, activity: ActivityLevel, seedBase: number): number[] {
  if (!Number.isFinite(segmentBeats) || segmentBeats <= 0) return [];
  const weights =
    activity === "active"
      ? [
          { value: 0.5, weight: 25 },
          { value: 1, weight: 45 },
          { value: 2, weight: 20 },
          { value: 4, weight: 10 }
        ]
      : activity === "high_active"
        ? [
            { value: 0.5, weight: 50 },
            { value: 1, weight: 35 },
            { value: 2, weight: 12 },
            { value: 4, weight: 3 }
          ]
        : [
            { value: 1, weight: 55 },
            { value: 2, weight: 30 },
            { value: 4, weight: 15 }
          ];
  const durations: number[] = [];
  let remaining = Math.round(segmentBeats * 1000) / 1000;
  let idx = 0;
  while (remaining > 1e-6) {
    const seed = seedBase + idx * 101;
    let dur = pickWeighted(weights, seed);
    if (dur > remaining + 1e-6) {
      const allowed = weights
        .map((w) => w.value)
        .filter((v) => v <= remaining + 1e-6)
        .sort((a, b) => b - a);
      dur = allowed[0] ?? remaining;
    }
    durations.push(dur);
    remaining = Math.round((remaining - dur) * 1000) / 1000;
    idx += 1;
  }
  return durations;
}

function pickTopMode(
  measureNumber: number,
  t: number,
  activity: ActivityLevel,
  melodyShare: number
): SopranoMode {
  const share = Math.max(0, Math.min(100, Number.isFinite(melodyShare) ? melodyShare : 30));
  const base =
    activity === "high_active"
      ? { harmony: 35, counter: 35 }
      : activity === "less_active"
        ? { harmony: 55, counter: 15 }
        : { harmony: 45, counter: 25 };
  const remaining = Math.max(0, 100 - share);
  const baseSum = base.harmony + base.counter || 1;
  const harmonyWeight = (remaining * base.harmony) / baseSum;
  const counterWeight = remaining - harmonyWeight;
  const weights: Array<{ value: SopranoMode; weight: number }> = [
    { value: "melody", weight: share },
    { value: "harmony", weight: harmonyWeight },
    { value: "counter", weight: counterWeight }
  ];
  const seed = (measureNumber * 73856093) ^ (Math.round(t * 1000) * 19349663);
  return pickWeighted(weights, seed);
}

function pickCounterRole(measureNumber: number, t: number, activity: ActivityLevel): CounterRole {
  const weights: Array<{ value: CounterRole; weight: number }> = [
    { value: "passing", weight: 35 },
    { value: "neighbor", weight: 25 },
    { value: "skip", weight: 10 },
    { value: "leap", weight: 10 },
    { value: "chord", weight: 20 }
  ];
  const seed = (measureNumber * 83492791) ^ (Math.round(t * 1000) * 29791);
  return pickWeighted(weights, seed);
}

function enforceChordPriorityForMeasure(params: {
  events: any[];
  chords: ChordEvent[];
  measureNumber: number;
  measureBeats: number;
  warnings: string[];
  allowWorshipClusters?: boolean;
  strictAllTimes?: boolean;
}): void {
  const { events, chords, measureNumber, measureBeats, warnings, allowWorshipClusters } = params;
  const strictAllTimes = params.strictAllTimes === true;
  if (!Array.isArray(chords) || !chords.length) return;

  const times = new Set<number>();
  for (const e of events) {
    if (e && e.type === "note" && Number.isFinite(e.t)) {
      times.add(Number(e.t));
    }
  }
  const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
  for (let b = 0; b < beatCount; b += 1) times.add(b);
  for (const c of chords) {
    if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t)) {
      times.add(Number(c.t));
    }
  }
  const orderedTimes = Array.from(times).sort((a, b) => a - b);

  for (const t of orderedTimes) {
    if (!strictAllTimes && !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t)) continue;
    const chord = pickChordForTime(chords, measureNumber, t);
    const parsed = chord ? parseChordSymbol(chord.symbol) : null;
    const baseChordPcs = parsed?.pcs ?? [];
    if (!baseChordPcs.length) continue;
    let rhChordPcs = baseChordPcs.slice();
    if (allowWorshipClusters && parsed && chord) {
      const quality = chordQualityFlags(chord.symbol);
      const rootPc = parsed.rootPc;
      const majThirdPc = (rootPc + 4) % 12;
      const minThirdPc = (rootPc + 3) % 12;
      const sus4Pc = (rootPc + 5) % 12;
      if (quality.isDominant) {
        rhChordPcs = rhChordPcs.filter((pc) => pc !== majThirdPc && pc !== minThirdPc);
        rhChordPcs.push(sus4Pc);
      } else if (quality.isMajor) {
        rhChordPcs.push((rootPc + 2) % 12);
      }
      rhChordPcs = Array.from(new Set(rhChordPcs));
    }

    const active = findActiveNotesAtTime(events, 1, t)
      .concat(findActiveNotesAtTime(events, 2, t))
      .map((entry) => entry.ev);

    for (const ev of active) {
      if (!ev || ev.type !== "note") continue;
      if ((ev as any).__melody) continue;
      const midi = eventMidi(ev);
      if (typeof midi !== "number") continue;
      const staff = Number(ev.staff) === 2 ? 2 : 1;
      const pc = ((midi % 12) + 12) % 12;
      const allowedPcs = staff === 1 && allowWorshipClusters ? rhChordPcs : baseChordPcs;
      if (allowedPcs.includes(pc)) continue;
      const range = staff === 1 ? { min: 52, max: 88 } : { min: 41, max: 72 };
      const adjusted = chooseChordToneNearestFromPcs(allowedPcs, midi, range, []);
      if (adjusted !== midi) {
        setEventMidi(ev, adjusted);
        warn(warnings, `[piano] m${measureNumber} t=${t}: adjusted note to chord tone on strong beat.`);
      }
    }
  }
}

function ensureChordVoicesAtBeats(params: {
  events: any[];
  chords: ChordEvent[];
  measureNumber: number;
  measureBeats: number;
  warnings: string[];
  voices: VoiceTarget[];
  allowWorshipClusters?: boolean;
}): void {
  const { events, chords, measureNumber, measureBeats, warnings, voices, allowWorshipClusters } = params;
  if (!Array.isArray(chords) || !chords.length) return;
  if (!Array.isArray(voices) || !voices.length) return;

  const melodyLocked = new Set<string>();
  for (const ev of events) {
    if (ev?.type !== "note") continue;
    if ((ev as any).__melody) {
      melodyLocked.add(`${ev.staff}:${ev.voice}`);
    }
  }

  const times = new Set<number>();
  const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
  for (let b = 0; b < beatCount; b += 1) times.add(b);
  for (const c of chords) {
    if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t)) times.add(Number(c.t));
  }
  const orderedTimes = Array.from(times).sort((a, b) => a - b);

  for (let i = 0; i < orderedTimes.length; i++) {
    const t = orderedTimes[i]!;
    const nextTime = orderedTimes[i + 1] ?? measureBeats;
    const chord = pickChordForTime(chords, measureNumber, t);
    const parsed = chord ? parseChordSymbol(chord.symbol) : null;
    const baseChordPcs = parsed?.pcs ?? [];
    if (!baseChordPcs.length) continue;
    let chordPcs = baseChordPcs.slice();
    if (allowWorshipClusters && parsed && chord) {
      const quality = chordQualityFlags(chord.symbol);
      const rootPc = parsed.rootPc;
      const majThirdPc = (rootPc + 4) % 12;
      const minThirdPc = (rootPc + 3) % 12;
      const sus4Pc = (rootPc + 5) % 12;
      if (quality.isDominant) {
        chordPcs = chordPcs.filter((pc) => pc !== majThirdPc && pc !== minThirdPc);
        chordPcs.push(sus4Pc);
      } else if (quality.isMajor) {
        chordPcs.push((rootPc + 2) % 12);
      }
      chordPcs = Array.from(new Set(chordPcs));
    }

    const dur = Math.max(0.25, Math.min(measureBeats - t, nextTime - t));

    for (const voice of voices) {
      const key = `${voice.staff}:${voice.voice}`;
      const active = findActiveEvent(events, voice.staff, voice.voice, t);
      if (active && ((active as any).__melody || (active as any).__forceKeep)) continue;
      if (active) {
        const midi = eventMidi(active);
        if (typeof midi === "number") {
          const pc = ((midi % 12) + 12) % 12;
          if (!chordPcs.includes(pc)) {
            const adjusted = chooseChordToneNearestFromPcs(chordPcs, midi, voice.range, []);
            if (adjusted !== midi) {
              setEventMidi(active, adjusted);
              warn(warnings, `[piano] m${measureNumber} t=${t}: adjusted ${voice.label} to chord tone.`);
            }
          }
        }
        continue;
      }
      if (melodyLocked.has(key)) continue;

      const prevMidi = findNoteMidiAtOrBeforeTime(events.filter((e) => e?.staff === voice.staff && e?.voice === voice.voice), t);
      const seedMidi = typeof prevMidi === "number" ? prevMidi : Math.round((voice.range.min + voice.range.max) / 2);
      const midi = chooseChordToneNearestFromPcs(chordPcs, seedMidi, voice.range, []);
      const ev: any = {
        type: "note",
        t,
        dur,
        voice: voice.voice,
        staff: voice.staff,
        pitch: midiToPitch(midi),
        id: `${voice.staff}-${voice.voice}-n-${measureNumber}-${t}-forced`
      };
      ev.midi = midi;
      ev.__forceKeep = true;
      events.push(ev);
    }
  }
}

function enforceBassToChordAtTimes(params: {
  events: any[];
  chords: ChordEvent[];
  measureNumber: number;
  measureBeats: number;
  warnings: string[];
  range: { min: number; max: number };
  maxLeap?: number;
  extraTimes?: number[];
}): void {
  const { events, chords, measureNumber, measureBeats, warnings, range, maxLeap, extraTimes } = params;
  if (!Array.isArray(chords) || !chords.length) return;

  const times = new Set<number>();
  const beatCount = Math.max(0, Math.floor(Number.isFinite(measureBeats) ? measureBeats : 0));
  for (let b = 0; b < beatCount; b += 1) times.add(b);
  for (const c of chords) {
    if (Number(c.measure) === Number(measureNumber) && Number.isFinite(c.t)) {
      times.add(Number(c.t));
    }
  }
  if (Array.isArray(extraTimes)) {
    for (const t of extraTimes) {
      if (Number.isFinite(t)) times.add(Number(t));
    }
  }

  const orderedTimes = Array.from(times).sort((a, b) => a - b);
  for (const t of orderedTimes) {
    const chord = pickChordForTime(chords, measureNumber, t);
    if (!chord) continue;
    const parsed = parseChordSymbol(chord.symbol);
    const bassTarget = parseBassTargetFromChordSymbol(chord.symbol);
    const targetPc = bassTarget?.pc ?? parsed?.rootPc;
    if (typeof targetPc !== "number") continue;
    const hasSlashBass = bassTarget?.pc !== undefined && bassTarget?.pc !== null;
    const thirdPcs =
      parsed && typeof parsed.rootPc === "number"
        ? [((parsed.rootPc + 3) % 12 + 12) % 12, ((parsed.rootPc + 4) % 12 + 12) % 12]
        : [];
    const fifthPc = parsed && typeof parsed.rootPc === "number" ? ((parsed.rootPc + 7) % 12 + 12) % 12 : null;

    const active = findActiveNotesAtTime(events, 2, t).filter((a) => !(a.ev as any).__drop);
    if (!active.length) {
      const staff2Notes = (events ?? []).filter(
        (e: any) => e?.type === "note" && Number(e?.staff) === 2 && !(e as any).__drop
      );
      const voice = staff2Notes.some((e: any) => Number(e.voice) === 4) ? 4 : 3;
      const nextTimes = staff2Notes
        .map((e: any) => Number(e?.t))
        .filter((et: number) => Number.isFinite(et) && et > t);
      const nextTime = nextTimes.length ? Math.min(...nextTimes) : measureBeats;
      const rawDur = Number.isFinite(nextTime) ? Math.max(0, nextTime - t) : 0;
      const dur = Math.max(0.25, Math.min(measureBeats - t, rawDur || (measureBeats - t)));
      const target = pickMidiForPcNear(targetPc, range.min, range);
      if (target === null) continue;
      const ev: any = {
        type: "note",
        t,
        dur,
        voice,
        staff: 2,
        pitch: pitchWithSpelling(target, bassTarget?.spelling),
        id: `2-${voice}-n-${measureNumber}-${t}-forced`
      };
      ev.midi = target;
      ev.__lockPitch = true;
      events.push(ev);
      continue;
    }
    active.sort((a, b) => a.midi - b.midi);
    const bass = active[0]!;
    const currentMidi = bass.midi;
    const currentPc = ((currentMidi % 12) + 12) % 12;
    if (!hasSlashBass && currentMidi < 48 && thirdPcs.includes(currentPc)) {
      const rootPc = parsed?.rootPc ?? targetPc;
      const rootMidi = pickMidiForPcNear(rootPc, currentMidi, range);
      const fifthMidi = fifthPc !== null ? pickMidiForPcNear(fifthPc, currentMidi, range) : null;
      let preferred = rootMidi;
      if (rootMidi !== null && fifthMidi !== null) {
        preferred = Math.abs(fifthMidi - currentMidi) < Math.abs(rootMidi - currentMidi) ? fifthMidi : rootMidi;
      } else if (rootMidi === null && fifthMidi !== null) {
        preferred = fifthMidi;
      }
      if (preferred !== null) {
        bass.ev.midi = preferred;
        bass.ev.pitch = pitchWithSpelling(preferred, bassTarget?.spelling);
      }
    }
    const target = pickMidiForPcNear(targetPc, currentMidi, range);
    if (target === null) continue;
    let adjusted = target;
    if (typeof maxLeap === "number" && Number.isFinite(maxLeap) && Math.abs(adjusted - currentMidi) > maxLeap) {
      const clamped = adjustMidiToRangeByOctave(adjusted, currentMidi - maxLeap, currentMidi + maxLeap);
      if (clamped !== null) adjusted = clamped;
    }
    bass.ev.midi = adjusted;
    bass.ev.pitch = pitchWithSpelling(adjusted, bassTarget?.spelling);
    (bass.ev as any).__lockPitch = true;
    if (((adjusted % 12) + 12) % 12 !== targetPc) {
      warn(warnings, `[piano] m${measureNumber} t=${t}: bass adjusted to chord tone.`);
    }
  }
}

function fitMidiToRangeByOctave(midi: number, min: number, max: number): number | null {
  let m = midi;
  while (m < min) m += 12;
  while (m > max) m -= 12;
  if (m < min || m > max) return null;
  return m;
}

function clampTopLeap(params: {
  midi: number;
  prevMidi: number;
  chordPcs: number[];
  range: { min: number; max: number };
  maxLeap?: number;
}): number {
  const { midi, prevMidi, chordPcs, range } = params;
  const maxLeap = params.maxLeap ?? 7; // perfect 5th
  if (Math.abs(midi - prevMidi) <= maxLeap) return midi;
  const pcs = chordPcs.length ? chordPcs : [((midi % 12) + 12) % 12];
  const candidates: number[] = [];
  for (let m = range.min; m <= range.max; m++) {
    const pc = ((m % 12) + 12) % 12;
    if (!pcs.includes(pc)) continue;
    if (Math.abs(m - prevMidi) <= maxLeap) candidates.push(m);
  }
  if (candidates.length) {
    candidates.sort((a, b) => Math.abs(a - prevMidi) - Math.abs(b - prevMidi));
    return candidates[0]!;
  }
  return prevMidi;
}

function chooseTopChordTone(params: {
  chordPcs: number[];
  prevMidi: number;
  range: { min: number; max: number };
  bottomMidi: number | null;
}): number {
  const { chordPcs, prevMidi, range, bottomMidi } = params;
  if (!chordPcs.length) return prevMidi;
  const min = typeof bottomMidi === "number" ? Math.max(range.min, bottomMidi + 1) : range.min;
  const max = typeof bottomMidi === "number" ? Math.min(range.max, bottomMidi + 12) : range.max;
  const localRange = min <= max ? { min, max } : range;
  return chooseChordToneNearestFromPcs(chordPcs, prevMidi, localRange, typeof bottomMidi === "number" ? [bottomMidi] : []);
}

function buildRhTopVoiceEvents(params: {
  chords: ChordEvent[];
  measureNumber: number;
  measureBeats: number;
  melodyEvents: any[];
  bottomEvents: NoteEvent[];
  activity: ActivityLevel;
  scalePcs: number[];
  melodyShare: number;
  range?: { min: number; max: number };
  allowOverlap?: boolean;
}): NoteEvent[] {
  const { chords, measureNumber, measureBeats, melodyEvents, bottomEvents, activity, scalePcs, melodyShare } = params;
  const range = params.range ?? { min: 60, max: 88 }; // C4..E6
  const allowOverlap = params.allowOverlap === true;
  const evs: NoteEvent[] = [];
  let prevMidi: number | null = null;

  let chordEvents = chords
    .filter((c) => Number(c.measure) === Number(measureNumber))
    .map((c) => ({ ...c, t: Number(c.t) }))
    .filter((c) => Number.isFinite(c.t))
    .sort((a, b) => Number(a.t) - Number(b.t));

  if (!chordEvents.length) {
    chordEvents = [{ measure: measureNumber, t: 0, symbol: "C" }];
  } else if (chordEvents[0]!.t > 0) {
    chordEvents = [{ ...chordEvents[0]!, t: 0 }, ...chordEvents];
  }

  for (let ci = 0; ci < chordEvents.length; ci++) {
    const chord = chordEvents[ci]!;
    const start = Math.max(0, Number(chord.t) || 0);
    const end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1]!.t) : measureBeats;
    const segDur = Math.max(0, Math.min(end, measureBeats) - start);
    if (segDur <= 0) continue;

    const parsed = parseChordSymbol(chord.symbol);
    const chordPcs = parsed?.pcs ?? [];
    const group = Math.floor((measureNumber - 1) / 8);
    const seedBase = group * 10000 + Math.round(start * 1000);
    const durations = (activity as string) === "grounded" ? [segDur] : buildActiveDurations(segDur, activity, seedBase);
    let cursor = start;

    for (let iEv = 0; iEv < durations.length; iEv++) {
      const dur = durations[iEv]!;
      const t = cursor;
      if (t + dur > measureBeats + 1e-6) break;

      let bottomMidi = findNoteMidiAtTime(bottomEvents, t);
      if (bottomMidi === null) {
        bottomMidi = findNoteMidiAtOrBeforeTime(bottomEvents, t);
      }
      const melodyMidi = findNoteMidiAtTime(melodyEvents, t);
      const mode = pickTopMode(measureNumber, t, activity, melodyShare);
      let midi: number | null = null;
      const allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);

      if (mode === "melody" && typeof melodyMidi === "number") {
        midi = melodyMidi;
      }

      if (midi === null) {
        if (mode === "harmony" || mode === "melody") {
          const base = prevMidi ?? (typeof melodyMidi === "number" ? melodyMidi : range.min);
          midi = chooseTopChordTone({
            chordPcs,
            prevMidi: base,
            range,
            bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
          });
        } else {
          const role = pickCounterRole(measureNumber, t, activity);
          const base = prevMidi ?? (typeof melodyMidi === "number" ? melodyMidi : range.min);
          if (role === "suspension" && prevMidi !== null) {
            midi = prevMidi;
          } else if (role === "anticipation") {
            const nextChord = pickChordForTime(
              chords,
              t + dur < measureBeats ? measureNumber : measureNumber + 1,
              t + dur < measureBeats ? t + dur : 0
            );
            const nextParsed = nextChord ? parseChordSymbol(nextChord.symbol) : null;
            const nextPcs = nextParsed?.pcs ?? chordPcs;
            midi = chooseTopChordTone({
              chordPcs: nextPcs,
              prevMidi: base,
              range,
              bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
            });
          } else if (role === "syncopation") {
            midi = prevMidi ?? base;
          } else if (role === "chromatic" && allowChromatic) {
            const dir: 1 | -1 = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
            midi = chooseNeighborMidi(base, scalePcs, range, dir);
          } else if (role === "passing" || role === "neighbor" || role === "appoggiatura") {
            const dir: 1 | -1 = (measureNumber + Math.round(t * 2) + (role === "neighbor" ? 1 : 0)) % 2 === 0 ? 1 : -1;
            midi = chooseNeighborMidi(base, scalePcs, range, dir);
          } else if (role === "skip") {
            const fallback = chooseTopChordTone({
              chordPcs,
              prevMidi: base,
              range,
              bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
            });
            midi = chooseChordToneByInterval(chordPcs, base, range, 3, 5, fallback);
          } else if (role === "leap") {
            const fallback = chooseTopChordTone({
              chordPcs,
              prevMidi: base,
              range,
              bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
            });
            midi = chooseChordToneByInterval(chordPcs, base, range, 6, 9, fallback);
          } else {
            midi = chooseTopChordTone({
              chordPcs,
              prevMidi: base,
              range,
              bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
            });
          }
        }
      }

      if (midi === null) {
        cursor = Math.round((cursor + dur) * 1000) / 1000;
        continue;
      }

      if (mode !== "melody") {
        const bottom = typeof bottomMidi === "number" ? bottomMidi : null;
        if (bottom !== null) {
          const adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, bottom + 1), Math.min(range.max, bottom + 12));
          if (adjusted !== null) midi = adjusted;
        } else {
          const adjusted = fitMidiToRangeByOctave(midi, range.min, range.max);
          if (adjusted !== null) midi = adjusted;
        }
      }

      if ((isStrongBeat(t) || isChordBoundary(chords, measureNumber, t)) && chordPcs.length && !chordPcs.includes(((midi % 12) + 12) % 12)) {
        const base = prevMidi ?? midi;
        midi = chooseTopChordTone({
          chordPcs,
          prevMidi: base,
          range,
          bottomMidi: typeof bottomMidi === "number" ? bottomMidi : null
        });
      }

      if (prevMidi !== null && midi === prevMidi && !shouldAllowRepeat(measureNumber, t, REPEAT_RATIO, 17)) {
        if (!isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t)) {
          const dir: 1 | -1 = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
          const neighbor = chooseNeighborMidi(prevMidi, scalePcs, range, dir);
          if (neighbor !== prevMidi) midi = neighbor;
        }
        if (midi === prevMidi && chordPcs.length) {
          const alt = chooseChordToneNearestFromPcs(chordPcs, prevMidi, range, [prevMidi]);
          if (alt !== prevMidi) midi = alt;
        }
      }

      if (!allowOverlap && typeof bottomMidi === "number") {
        const minAbove = bottomMidi + 1;
        if (midi <= bottomMidi) {
          let adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, minAbove), range.max);
          if (adjusted === null || adjusted <= bottomMidi) {
            const localRange = { min: Math.max(range.min, minAbove), max: range.max };
            const base = Math.max(prevMidi ?? midi, localRange.min);
            adjusted = chordPcs.length
              ? chooseChordToneNearestFromPcs(chordPcs, base, localRange, [])
              : Math.min(localRange.max, Math.max(localRange.min, base));
          }
          midi = adjusted;
        }
      }
      if (allowOverlap && typeof bottomMidi === "number") {
        const minAbove = bottomMidi;
        const maxAbove = bottomMidi + 12;
        const adjusted = fitMidiToRangeByOctave(midi, Math.max(range.min, minAbove), Math.min(range.max, maxAbove));
        if (adjusted !== null) midi = adjusted;
      }

      if (prevMidi !== null) {
        midi = clampTopLeap({
          midi,
          prevMidi,
          chordPcs,
          range,
          maxLeap: 9
        });
      }

      evs.push({
        type: "note",
        t,
        dur,
        voice: 1,
        staff: 1,
        pitch: midiToPitch(midi),
        chord: false,
        id: `1-1-n-${measureNumber}-${t}`
      } as any);
      if (mode === "melody" && typeof melodyMidi === "number") {
        (evs[evs.length - 1] as any).__melody = true;
      }
      prevMidi = midi;
      cursor = Math.round((cursor + dur) * 1000) / 1000;
    }
  }

  return evs;
}

function buildRhFillEvents(params: {
  chords: ChordEvent[];
  lastChord: ChordEvent | null;
  measureNumber: number;
  measureBeats: number;
  melodyEvents: any[];
  activity: "less_active" | "active" | "high_active";
  scalePcs: number[];
}): { events: NoteEvent[]; lastChord: ChordEvent | null } {
  const { chords, measureNumber, measureBeats, melodyEvents, activity, scalePcs } = params;
  const range = { min: 55, max: 84 }; // G3..C6
  const evs: NoteEvent[] = [];
  let lastChord = params.lastChord;

  let chordEvents = chords
    .filter((c) => Number(c.measure) === Number(measureNumber))
    .map((c) => ({ ...c, t: Number(c.t) }))
    .filter((c) => Number.isFinite(c.t))
    .sort((a, b) => Number(a.t) - Number(b.t));

  if (!chordEvents.length && lastChord) {
    chordEvents = [{ ...lastChord, t: 0 }];
  } else if (chordEvents.length && chordEvents[0]!.t > 0) {
    const base = lastChord ?? chordEvents[0]!;
    chordEvents = [{ ...base, t: 0 }, ...chordEvents];
  }

  if (!chordEvents.length) return { events: evs, lastChord };

  for (let ci = 0; ci < chordEvents.length; ci++) {
    const chord = chordEvents[ci]!;
    const start = Math.max(0, Number(chord.t) || 0);
    const end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1]!.t) : measureBeats;
    const segDur = Math.max(0, Math.min(end, measureBeats) - start);
    if (segDur <= 0) continue;

    const parsed = parseChordSymbol(chord.symbol);
    const map = resolveChordToneMap(parsed as any);
    const steps = buildRhFillSteps(segDur, activity);
    let cursor = start;
    let lastToneMidi: number | null = null;

    for (const step of steps) {
      const melMidi = findNoteMidiAtTime(melodyEvents, cursor);
      const maxMidi = typeof melMidi === "number" ? Math.min(range.max, melMidi - 1) : range.max;
      if (maxMidi < range.min) {
        cursor += step.dur;
        continue;
      }
      let midi: number | null = null;
      if (step.token === "passing" && activity === "high_active") {
        const base = lastToneMidi ?? pickMidiForPcBelow(map.rootPc, range.min, maxMidi);
        if (typeof base === "number") {
          const dir: 1 | -1 = (measureNumber + Math.round(cursor * 2)) % 2 === 0 ? 1 : -1;
          midi = pickPassingMidi({
            baseMidi: base,
            scalePcs,
            dir,
            min: range.min,
            max: maxMidi,
            allowChromatic: !isStrongBeat(cursor) && !isChordBoundary(chords, measureNumber, cursor),
            preferChromatic: !isStrongBeat(cursor) && !isChordBoundary(chords, measureNumber, cursor)
          });
        }
      }
      if (midi === null) {
        const pc =
          step.token === "third" ? map.thirdPc : step.token === "fifth" ? map.fifthPc : map.rootPc;
        midi = pickMidiForPcBelow(pc, range.min, maxMidi);
      }
      if (midi === null) {
        cursor += step.dur;
        continue;
      }
      evs.push({
        type: "note",
        t: cursor,
        dur: step.dur,
        voice: 5,
        staff: 1,
        pitch: midiToPitch(midi),
        id: `1-5-n-${measureNumber}-${cursor}`
      } as any);
      lastToneMidi = midi;
      cursor += step.dur;
    }
  }

  lastChord = chordEvents[chordEvents.length - 1] ?? lastChord;
  return { events: evs, lastChord };
}

function buildRhChordPadEvents(params: {
  chords: ChordEvent[];
  lastChord: ChordEvent | null;
  measureNumber: number;
  measureBeats: number;
  level: PianoLevel;
  rhActivity?: ArrangePianoOptions["rhActivity"];
  scalePcs: number[];
  range?: { min: number; max: number };
  bottomRangeMin?: number;
  pulseOnsets?: number[];
}): { events: NoteEvent[]; lastChord: ChordEvent | null } {
  const { chords, measureNumber, measureBeats, level, rhActivity, scalePcs } = params;
  const range = params.range ?? { min: 60, max: 84 }; // C4..C6
  const pulseOnsets = Array.isArray(params.pulseOnsets) ? params.pulseOnsets : null;
  const bottomRangeMin = params.bottomRangeMin ?? 55; // G3
  const evs: NoteEvent[] = [];
  let lastChord = params.lastChord;
  const activity = (rhActivity ?? "less_active") as ActivityLevel;
  const activeBottom = activity === "active" || activity === "high_active";
  let prevBottomMidi: number | null = null;

  const pickBottomRole = (t: number): AltoRole => {
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
  };

  let chordEvents = chords
    .filter((c) => Number(c.measure) === Number(measureNumber))
    .map((c) => ({ ...c, t: Number(c.t) }))
    .filter((c) => Number.isFinite(c.t))
    .sort((a, b) => Number(a.t) - Number(b.t));

  if (!chordEvents.length && lastChord) {
    chordEvents = [{ ...lastChord, t: 0 }];
  } else if (chordEvents.length && chordEvents[0]!.t > 0) {
    const base = lastChord ?? chordEvents[0]!;
    chordEvents = [{ ...base, t: 0 }, ...chordEvents];
  }

  if (!chordEvents.length) return { events: evs, lastChord };

  for (let ci = 0; ci < chordEvents.length; ci++) {
    const chord = chordEvents[ci]!;
    const start = Math.max(0, Number(chord.t) || 0);
    const end = ci + 1 < chordEvents.length ? Number(chordEvents[ci + 1]!.t) : measureBeats;
    const segDur = Math.max(0, Math.min(end, measureBeats) - start);
    if (segDur <= 0) continue;

    const parsed = parseChordSymbol(chord.symbol);
    if (!parsed) continue;
    const rootPc = parsed.rootPc;
    const chordPcs = new Set(parsed.pcs ?? []);
    const quality = chordQualityFlags(chord.symbol);
    const rhChordPcs = new Set(chordPcs);
    const majThirdPc = (rootPc + 4) % 12;
    const minThirdPc = (rootPc + 3) % 12;
    const sus4Pc = (rootPc + 5) % 12;
    if (quality.isDominant) {
      rhChordPcs.delete(majThirdPc);
      rhChordPcs.delete(minThirdPc);
      rhChordPcs.add(sus4Pc);
    } else if (quality.isMajor) {
      rhChordPcs.add((rootPc + 2) % 12);
    }
    const chordMap = resolveChordToneMap(parsed as any);

    const worshipPatterns: Record<PianoLevel, number[][]> = {
      beginner: [
        [0, 7],
        [0, 5],
        [0, 4],
        [0, 3],
        [0, 12],
        [0, 7, 12]
      ],
      intermediate: [
        [0, 2, 7],
        [0, 5, 9],
        [0, 7, 12],
        [0, 4, 7],
        [0, 3, 7],
        [0, 5, 7],
        [0, 3, 8],
        [0, 4, 9]
      ],
      advanced: [
        [0, 2, 7],
        [0, 5, 9],
        [0, 7, 12],
        [0, 2, 4, 7],
        [0, 3, 7, 10],
        [0, 4, 7, 10],
        [0, 4, 7, 11],
        [0, 3, 7],
        [0, 4, 7]
      ],
      professional: [
        [0, 2, 7],
        [0, 5, 9],
        [0, 7, 12],
        [0, 2, 4, 7],
        [0, 3, 7, 10],
        [0, 4, 7, 10],
        [0, 4, 7, 11],
        [0, 2, 4, 7, 10],
        [0, 2, 4, 7, 11]
      ]
    };

    const patterns = worshipPatterns[level] ?? worshipPatterns.intermediate;
    const hasPc = (interval: number) => {
      const pc = ((rootPc + interval) % 12 + 12) % 12;
      if (interval % 12 === 0) return true;
      return rhChordPcs.has(pc);
    };

    const filtered = patterns.filter((pat) => pat.every((iv) => hasPc(iv)));
    const group = Math.floor((measureNumber - 1) / 8);
    const chosen = filtered.length
      ? filtered[(group + Math.round(start * 2)) % filtered.length]!
      : patterns.find((pat) => pat.every((iv) => hasPc(iv % 12))) ?? [0, 7];

    const baseRoot =
      pickMidiForPcBelow(rootPc, 60, 72) ??
      pickMidiForPcBelow(rootPc, range.min, range.max);
    if (baseRoot === null) continue;

    const tones: number[] = [];
    let cursorMidi = baseRoot;
    for (const iv of chosen) {
      const pc = ((rootPc + iv) % 12 + 12) % 12;
      const next = pickMidiForPcAtOrAbove(pc, cursorMidi, range.max);
      if (next === null) {
        tones.length = 0;
        break;
      }
      tones.push(next);
      cursorMidi = next + 1;
    }

    if (!tones.length) continue;
    const span = Math.max(...tones) - Math.min(...tones);
    const maxSpan = 12;
    if (span > maxSpan) {
      tones.length = 0;
    }

    if (!tones.length) continue;

    const bottomMidi = tones[0]!;
    let upperTones = tones.slice(1);
    const maxUpper = activeBottom ? 3 : 4;
    if (upperTones.length > maxUpper) {
      upperTones = upperTones.slice(upperTones.length - maxUpper);
    }
    const topMidi = upperTones.length ? Math.max(...upperTones) : bottomMidi;
    let bottomForVoice2 = bottomMidi;
    if (!upperTones.length) {
      const maxBelow = Math.min(range.max, bottomMidi - 1);
      const worshipThirdPc = quality.isDominant ? sus4Pc : chordMap.thirdPc;
      const candidates = [worshipThirdPc, chordMap.fifthPc, chordMap.rootPc];
      for (const pc of candidates) {
        const cand = pickMidiForPcBelow(pc, range.min, maxBelow);
        if (cand !== null && cand !== bottomMidi) {
          bottomForVoice2 = cand;
          break;
        }
      }
    }

    const pulseTimes = pulseOnsets ? slicePatternOnsets(pulseOnsets, start, end) : [start];
    for (let pi = 0; pi < pulseTimes.length; pi++) {
      const tPulse = pulseTimes[pi]!;
      const nextPulse = pi + 1 < pulseTimes.length ? pulseTimes[pi + 1]! : end;
      const durPulse = Math.max(0, Math.min(end, nextPulse) - tPulse);
      if (durPulse <= 0) continue;
      if (upperTones.length) {
        for (let ui = 0; ui < upperTones.length; ui++) {
          const midi = upperTones[ui]!;
          evs.push({
            type: "note",
            t: tPulse,
            dur: durPulse,
            voice: 1,
            staff: 1,
            pitch: midiToPitch(midi),
            chord: ui > 0,
            id: `1-1-n-${measureNumber}-${tPulse}-${ui}`
          } as any);
        }
      } else {
        evs.push({
          type: "note",
          t: tPulse,
          dur: durPulse,
          voice: 1,
          staff: 1,
          pitch: midiToPitch(bottomMidi),
          chord: false,
          id: `1-1-n-${measureNumber}-${tPulse}-0`
        } as any);
      }
    }

    const canAddBottomVoice = upperTones.length > 0 || bottomForVoice2 !== bottomMidi;
    if (canAddBottomVoice && activeBottom) {
      const seedBase = group * 10000 + Math.round(start * 1000);
      const durations = buildActiveDurations(segDur, activity, seedBase);
      const maxMidi = Math.min(range.max, topMidi - 1);
      let minMidi = Math.max(bottomRangeMin, topMidi - 12);
      if (maxMidi < minMidi) {
        minMidi = topMidi - 12;
      }
      const localRange = { min: minMidi, max: Math.max(minMidi, maxMidi) };
      if (prevBottomMidi === null) prevBottomMidi = bottomForVoice2;
      let cursor = start;
      for (let iEv = 0; iEv < durations.length; iEv++) {
        const dur = durations[iEv]!;
        const t = cursor;
        if (t + dur > measureBeats + 1e-6) break;
        const role = pickBottomRole(t);
        const chordPcsArr = Array.from(rhChordPcs);
        const exclude = upperTones.slice();
        let midi = prevBottomMidi ?? bottomForVoice2;

        if (role === "passing") {
          const dir: 1 | -1 = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
          const allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);
          midi =
            pickPassingMidi({
              baseMidi: midi,
              scalePcs,
              dir,
              min: localRange.min,
              max: localRange.max,
              allowChromatic,
              preferChromatic: allowChromatic && activity === "high_active"
            }) ?? chooseNeighborMidi(midi, scalePcs, localRange, dir);
        } else if (role === "neighbor" || role === "appoggiatura") {
          const dir: 1 | -1 = (measureNumber + Math.round(t * 2) + 1) % 2 === 0 ? 1 : -1;
          const allowChromatic = !isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t);
          midi =
            pickPassingMidi({
              baseMidi: midi,
              scalePcs,
              dir,
              min: localRange.min,
              max: localRange.max,
              allowChromatic,
              preferChromatic: allowChromatic && activity === "high_active"
            }) ?? chooseNeighborMidi(midi, scalePcs, localRange, dir);
        } else if (role === "skip") {
          midi = chooseChordToneByInterval(chordPcsArr, midi, localRange, 3, 5, midi);
        } else if (role === "leap") {
          midi = chooseChordToneByInterval(chordPcsArr, midi, localRange, 7, 9, midi);
        } else if (role === "anticipation") {
          const nextChord = pickChordForTime(
            chords,
            t + dur < measureBeats ? measureNumber : measureNumber + 1,
            t + dur < measureBeats ? t + dur : 0
          );
          const nextParsed = nextChord ? parseChordSymbol(nextChord.symbol) : null;
          const nextPcs = nextParsed?.pcs ?? chordPcsArr;
          midi = chooseChordToneNearestFromPcs(nextPcs, midi, localRange, exclude);
        } else if (role === "syncopation") {
          if (!isStrongBeat(t)) {
            midi = prevBottomMidi ?? midi;
          }
        } else {
          midi = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, exclude);
        }

        if (prevBottomMidi !== null && midi === prevBottomMidi && !shouldAllowRepeat(measureNumber, t, REPEAT_RATIO, 23)) {
          if (!isStrongBeat(t) && !isChordBoundary(chords, measureNumber, t)) {
            const dir: 1 | -1 = (measureNumber + Math.round(t * 2)) % 2 === 0 ? 1 : -1;
            const neighbor = chooseNeighborMidi(midi, scalePcs, localRange, dir);
            if (neighbor !== midi) midi = neighbor;
          }
          if (midi === prevBottomMidi && chordPcsArr.length) {
            const alt = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, [midi, ...exclude]);
            if (alt !== midi) midi = alt;
          }
        }

        if (exclude.includes(midi)) {
          midi = chooseChordToneNearestFromPcs(chordPcsArr, midi, localRange, exclude);
        }

        evs.push({
          type: "note",
          t,
          dur,
          voice: 2,
          staff: 1,
          pitch: midiToPitch(midi),
          chord: false,
          id: `1-2-n-${measureNumber}-${t}`
        } as any);
        prevBottomMidi = midi;
        cursor = Math.round((cursor + dur) * 1000) / 1000;
      }
    } else if (canAddBottomVoice) {
      let bottom = bottomForVoice2;
      const maxMidi = Math.min(range.max, topMidi - 1);
      let minMidi = Math.max(bottomRangeMin, topMidi - 12);
      if (maxMidi < minMidi) {
        minMidi = topMidi - 12;
      }
      if (bottom > maxMidi) bottom = maxMidi;
      if (bottom < minMidi) bottom = minMidi;
      evs.push({
        type: "note",
        t: start,
        dur: segDur,
        voice: 2,
        staff: 1,
        pitch: midiToPitch(bottom),
        chord: false,
        id: `1-2-n-${measureNumber}-${start}-0`
      } as any);
    }
  }

  lastChord = chordEvents[chordEvents.length - 1] ?? lastChord;
  return { events: evs, lastChord };
}

export function arrangePianoFromSatb(score: ScoreModel, options?: ArrangePianoOptions): ScoreModel {
  const warnings = options?.warnings ?? [];
  const level = (options?.level ?? "beginner") as PianoLevel;
  const polyphonic = options?.polyphonic === true;
  const chordsForArrange = resolveChordsForArrange(options?.chords, score);
  const rhActivity = (options?.rhActivity ?? "less_active") as "grounded" | "less_active" | "active" | "high_active";
  const sopranoActivity = (options?.sopranoActivity ?? "grounded") as
    | "grounded"
    | "less_active"
    | "active"
    | "high_active";
  const wantsPianoWithMelody = options?.ensembleTag === "piano_with_melody";
  const melodyHand = options?.melodyHand === "left" ? "left" : "right";
  const melodyOnLeft = melodyHand === "left";
  const sopranoMelodyShare =
    typeof options?.sopranoMelodyShare === "number" && Number.isFinite(options.sopranoMelodyShare)
      ? Math.max(0, Math.min(100, options.sopranoMelodyShare))
      : 30;
  const useSopranoTexture = !wantsPianoWithMelody && !melodyOnLeft && sopranoActivity !== "grounded";
  const omitMelodyInPiano = options?.omitMelodyInPiano === true || melodyOnLeft;
  const separateMelodyPart = options?.separateMelodyPart === true;
  const worshipChordPad = options?.worshipChordPad === true;
  const worshipMode = worshipChordPad === true;
  const tempoBpm =
    typeof options?.tempoBpm === "number" && Number.isFinite(options.tempoBpm)
      ? options.tempoBpm
      : getTempoBpm(score);
  const maxLeap = 9;
  const pianoAdvanced = level === "advanced";
  const preset = loadPianoStylePreset(
    options?.pianoStylePresetPath ?? options?.pianoStylePreset,
    warnings
  );
  const lhPatternArray = preset?.instrument_logic?.left_hand_lower?.rhythm_pattern?.pattern_array;
  const rhPatternArray = preset?.instrument_logic?.right_hand_upper?.rhythm_pattern?.pattern_array;
  const worshipRanges = {
    bass: { min: 36, max: 52 }, // C2..E3
    tenor: { min: 53, max: 64 }, // F3..E4
    alto: { min: 55, max: 72 }, // G3..C5
    soprano: { min: 60, max: 84 } // C4..C6
  };
  const tenorRange = worshipMode ? worshipRanges.tenor : pianoAdvanced ? { min: 52, max: 64 } : null; // E3..E4
  const bassRange = worshipMode ? worshipRanges.bass : pianoAdvanced ? { min: 40, max: 52 } : null; // E2..E3
  const tenorIntervalsAbove = pianoAdvanced ? [5, 6, 7, 8, 9, 10, 11, 12] : [7, 8, 9, 10, 11, 12];
  const spacingOptions = worshipMode
    ? {
        tenorRange: tenorRange ?? undefined,
        bassRange: bassRange ?? undefined,
        altoRange: worshipRanges.alto,
        sopranoRange: worshipRanges.soprano,
        allowOverlap: false
      }
    : pianoAdvanced
      ? {
          tenorBassMin: 5,
          tenorRange: tenorRange ?? undefined,
          bassRange: bassRange ?? undefined
        }
      : undefined;
  const lhRange = worshipMode ? { min: 24, max: 64 } : pianoAdvanced ? { min: 40, max: 64 } : { min: 41, max: 72 };
  const bassChordRange = worshipMode ? { min: 24, max: 52 } : pianoAdvanced ? { min: 40, max: 52 } : { min: 41, max: 72 };
  const worshipRhRange = worshipMode ? { min: worshipRanges.alto.min, max: worshipRanges.soprano.max } : undefined;
  const worshipTopRange = worshipMode ? worshipRanges.soprano : undefined;
  const voiceSopranoRange = worshipMode ? worshipRanges.soprano : { min: 52, max: 88 };
  const voiceAltoRange = worshipMode ? worshipRanges.alto : { min: 52, max: 84 };
  const voiceTenorRange = worshipMode ? worshipRanges.tenor : tenorRange ?? { min: 48, max: 64 };

  const includeA = level === "intermediate" || level === "advanced";
  const includeT = level === "advanced";

  if (level === "professional") {
    warn(warnings, "[piano] Professional level not defined yet; using 2-voice texture (melody + bass).");
  }

  const soprano = findSoprano(score);
  const alto = includeA ? findAlto(score) : null;
  const tenor = includeT ? findTenor(score) : null;
  const bass = findBass(score);

  if (!soprano || !bass) {
    warn(warnings, "[piano] Missing Soprano or Bass part; returning original score.");
    return score;
  }

  const measures = cloneMeasuresTemplate(soprano);
  const pianoPart: Part = {
    part_id: "P_PNO",
    name: "Piano",
    instrument: "piano",
    staves: 2,
    measures
  };

  let lastChord: ChordEvent | null = null;
  const firstMeasure = measures[0];
  const keyFifths = Number(firstMeasure?.attributes?.key_fifths ?? 0);
  const keyModeRaw = String(firstMeasure?.attributes?.key_mode ?? "major").toLowerCase();
  const keyMode: "major" | "minor" = keyModeRaw === "minor" ? "minor" : "major";
  const scalePcs = scalePcsFromKey(keyFifths, keyMode);
  for (let i = 0; i < measures.length; i++) {
    const mNum = Number(measures[i]?.number ?? i + 1);
    const sM = soprano.measures?.[i];
    const aM = alto?.measures?.[i];
    const tM = tenor?.measures?.[i];
    const bM = bass?.measures?.[i];

    const sEvents = sM?.events ?? [];
    const aEvents = aM?.events ?? [];
    const tEvents = tM?.events ?? [];
    const bEvents = bM?.events ?? [];

    const evs: NoteEvent[] = [];
    const measureBeats = measureBeatsFromAttributes(measures[i]?.attributes);
    const rhPulseOnsets = rhPatternArray ? patternOnsetsFromArray(rhPatternArray, measureBeats) : undefined;
    const lhPatternOnsets = lhPatternArray ? patternOnsetsFromArray(lhPatternArray, measureBeats) : undefined;
    let rhBottomEvents: NoteEvent[] = [];
    const rhAltoVoice = melodyOnLeft ? 1 : 2;
    const rhTenorVoice = melodyOnLeft ? 2 : 3;

    // RH chord pad for worship accompaniment
    if (worshipChordPad && chordsForArrange.length) {
      const pad = buildRhChordPadEvents({
        chords: chordsForArrange,
        lastChord,
        measureNumber: mNum,
        measureBeats,
        level,
        rhActivity,
        scalePcs,
        range: worshipRhRange,
        bottomRangeMin: worshipMode ? worshipRanges.alto.min : undefined,
        pulseOnsets: rhPulseOnsets
      });
      lastChord = pad.lastChord;
      if (useSopranoTexture) {
        rhBottomEvents = pad.events.filter((e: any) => e?.staff === 1 && e?.voice === 2);
        evs.push(...rhBottomEvents);
      } else {
        evs.push(...pad.events);
      }
    } else if (includeA && aEvents.length) {
      // RH inner voice (alto)
      rhBottomEvents = mapVoiceEvents({
        srcEvents: aEvents,
        voice: rhAltoVoice,
        staff: 1,
        anchorEvents: melodyOnLeft ? undefined : sEvents,
        relation: worshipMode || melodyOnLeft ? undefined : "below",
        measureNumber: mNum,
        warnings
      });
      evs.push(...rhBottomEvents);
    }

    let rhTenorEvents: NoteEvent[] = [];
    if (melodyOnLeft && !worshipChordPad && includeT && tEvents.length) {
      rhTenorEvents = mapVoiceEvents({
        srcEvents: tEvents,
        voice: rhTenorVoice,
        staff: 1,
        anchorEvents: rhBottomEvents,
        relation: rhBottomEvents.length ? "below" : undefined,
        measureNumber: mNum,
        warnings
      });
      evs.push(...rhTenorEvents);
    }

    // RH top voice
    if (useSopranoTexture) {
      const topEvents = buildRhTopVoiceEvents({
        chords: chordsForArrange,
        measureNumber: mNum,
        measureBeats,
        melodyEvents: sEvents,
        bottomEvents: rhBottomEvents,
        activity: (sopranoActivity as string) === "grounded" ? "less_active" : (sopranoActivity as ActivityLevel),
        scalePcs,
        melodyShare: sopranoMelodyShare,
        range: worshipTopRange,
        allowOverlap: worshipMode
      });
      evs.push(...topEvents);
    } else if (!omitMelodyInPiano) {
      // RH: melody (unless omitted for worship-style piano accompaniment)
      evs.push(
        ...mapVoiceEvents({
          srcEvents: sEvents,
          voice: 1,
          staff: 1,
          measureNumber: mNum,
          warnings,
          markMelody: true
        })
      );
    }

    if (polyphonic && chordsForArrange.length && rhActivity !== "grounded") {
      // RH arpeggio fill disabled; polyphonic arpeggios are handled in LH only.
      lastChord = pickChordForTime(chordsForArrange, mNum, 0) ?? lastChord;
    }

    if (melodyOnLeft) {
      evs.push(
        ...mapVoiceEvents({
          srcEvents: sEvents,
          voice: 3,
          staff: 2,
          measureNumber: mNum,
          warnings,
          markMelody: true
        })
      );
    }

    // LH inner voice (tenor)
    if (!melodyOnLeft && includeT && tEvents.length) {
      evs.push(
        ...mapVoiceEvents({
          srcEvents: tEvents,
          voice: 3,
          staff: 2,
          anchorEvents: bEvents,
          relation: worshipMode ? undefined : "above",
          allowedIntervalsAbove: worshipMode ? undefined : tenorIntervalsAbove,
          measureNumber: mNum,
          warnings
        })
      );
    }

    // LH bass
    const bassVoice = melodyOnLeft ? 4 : includeT ? 4 : 3;
    evs.push(
      ...mapVoiceEvents({
        srcEvents: bEvents,
        voice: bassVoice,
        staff: 2,
        measureNumber: mNum,
        warnings
      })
    );

    if (!melodyOnLeft && (omitMelodyInPiano || separateMelodyPart)) {
      ensureMelodyStartDoubling({ events: evs, melodyEvents: sEvents, measureNumber: mNum, warnings });
    }

    const sorted = evs.sort((a, b) => Number(a.t) - Number(b.t) || Number(a.voice) - Number(b.voice));
    trimEventsToMeasure(sorted, measureBeats, mNum, warnings);
    dropDuplicateNotesAtTime({ events: sorted, measureNumber: mNum, warnings });
    if (!melodyOnLeft && !omitMelodyInPiano) {
      enforceHarmonyBelowMelody({
        events: sorted,
        measureNumber: mNum,
        warnings,
        rhRange: { min: 52, max: 88 }
      });
    }

    if (!melodyOnLeft) {
      thinChordsAtMelodyOnsets({
        events: sorted,
        melodyEvents: sEvents,
        measureNumber: mNum,
        warnings,
        staff: 1,
        maxNotes: 2
      });
    }

    const beatVoices: VoiceTarget[] = [];
    if (melodyOnLeft) {
      if (includeA) beatVoices.push({ staff: 1, voice: 1, range: voiceAltoRange, label: "alto" });
      if (includeT) beatVoices.push({ staff: 1, voice: 2, range: voiceTenorRange, label: "tenor" });
    } else {
      beatVoices.push({ staff: 1, voice: 1, range: voiceSopranoRange, label: "soprano" });
      if (includeA) beatVoices.push({ staff: 1, voice: 2, range: voiceAltoRange, label: "alto" });
      if (includeT) beatVoices.push({ staff: 2, voice: 3, range: voiceTenorRange, label: "tenor" });
    }
    ensureChordVoicesAtBeats({
      events: sorted,
      chords: chordsForArrange,
      measureNumber: mNum,
      measureBeats,
      warnings,
      voices: beatVoices,
      allowWorshipClusters: worshipMode
    });
    sorted.sort((a, b) => Number(a.t) - Number(b.t) || Number(a.voice) - Number(b.voice));

    if (melodyOnLeft) {
      if (includeA) clampVoiceLeapsForMeasure(sorted, 1, 1, maxLeap, mNum, warnings);
      if (includeT) clampVoiceLeapsForMeasure(sorted, 1, 2, maxLeap, mNum, warnings);
      clampVoiceLeapsForMeasure(sorted, 1, 5, maxLeap, mNum, warnings);
      clampVoiceLeapsForMeasure(sorted, 2, 4, maxLeap, mNum, warnings);
    } else {
      clampVoiceLeapsForMeasure(sorted, 1, 1, maxLeap, mNum, warnings);
      clampVoiceLeapsForMeasure(sorted, 1, 2, maxLeap, mNum, warnings);
      clampVoiceLeapsForMeasure(sorted, 1, 5, maxLeap, mNum, warnings);
      if (includeT) clampVoiceLeapsForMeasure(sorted, 2, 3, maxLeap, mNum, warnings);
      const bassVoice = includeT ? 4 : 3;
      clampVoiceLeapsForMeasure(sorted, 2, bassVoice, maxLeap, mNum, warnings);
      enforceVoiceSpacingForMeasure(sorted, mNum, measureBeats, warnings, spacingOptions);
    }
    enforceHandLimitsForMeasure({
      events: sorted,
      measureNumber: mNum,
      measureBeats,
      warnings,
      maxSpan: 12,
      maxNotes: 4,
      rhRange: { min: 52, max: 88 },
      lhRange,
      suppressSpanWarnings: worshipMode
    });
    enforceChordPriorityForMeasure({
      events: sorted,
      chords: chordsForArrange,
      measureNumber: mNum,
      measureBeats,
      warnings,
      allowWorshipClusters: worshipMode,
      strictAllTimes: worshipMode
    });
    enforceBassToChordAtTimes({
      events: sorted,
      chords: chordsForArrange,
      measureNumber: mNum,
      measureBeats,
      warnings,
      range: bassChordRange,
      maxLeap,
      extraTimes: lhPatternOnsets
    });
    enforceHandLimitsForMeasure({
      events: sorted,
      measureNumber: mNum,
      measureBeats,
      warnings,
      maxSpan: 12,
      maxNotes: 4,
      rhRange: { min: 52, max: 88 },
      lhRange,
      suppressSpanWarnings: worshipMode
    });
    if (!melodyOnLeft) {
      enforceVoiceSpacingForMeasure(sorted, mNum, measureBeats, warnings, spacingOptions);
    }
    enforceChordPriorityForMeasure({
      events: sorted,
      chords: chordsForArrange,
      measureNumber: mNum,
      measureBeats,
      warnings,
      allowWorshipClusters: worshipMode,
      strictAllTimes: worshipMode
    });
    measures[i]!.events = sorted.filter((e: any) => !(e as any).__drop);
  }

  let melodyPart: Part | null = null;
  if (separateMelodyPart) {
    melodyPart = {
      part_id: "P_MEL",
      name: "Melody",
      instrument: "voice",
      staves: 1,
      measures: cloneMeasuresWithEvents(soprano)
    };
  }

  return {
    ...score,
    parts: melodyPart ? [melodyPart, pianoPart] : [pianoPart],
    meta: {
      ...score.meta,
      ensemble: options?.ensembleTag ?? (melodyOnLeft ? "piano_with_melody" : "piano")
    }
  };
}
