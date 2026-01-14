import type { ScoreModel } from "../score/types";
import { pitchToMidi } from "../instruments/instrumentCatalog";
import type {
  HarmonyAnalysis,
  HarmonyChord,
  HarmonyMeasure,
  HarmonyMode,
  KeySignature,
  ChordQuality
} from "./harmonyTypes";

// Pitch class helpers
function pc(midi: number): number {
  const x = ((midi % 12) + 12) % 12;
  return x;
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

const PC_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function chordSymbol(rootPc: number, q: ChordQuality): string {
  const r = PC_NAMES[rootPc] ?? "C";
  switch (q) {
    case "maj":
      return r;
    case "min":
      return `${r}m`;
    case "dim":
      return `${r}dim`;
    case "aug":
      return `${r}aug`;
    case "7":
      return `${r}7`;
    case "maj7":
      return `${r}maj7`;
    case "min7":
      return `${r}m7`;
    case "hdim7":
      return `${r}ø7`;
    case "dim7":
      return `${r}°7`;
    default:
      return r;
  }
}

type Match = {
  rootPc: number;
  quality: ChordQuality;
  inversion: 0 | 1 | 2 | 3;
  symbol: string;
  score: number; // 0..1
};

type Pattern = {
  quality: ChordQuality;
  intervals: number[]; // pitch-class intervals from root
};

// Common-practice core set (Phase 1)
const PATTERNS: Pattern[] = [
  { quality: "maj", intervals: [0, 4, 7] },
  { quality: "min", intervals: [0, 3, 7] },
  { quality: "dim", intervals: [0, 3, 6] },
  { quality: "aug", intervals: [0, 4, 8] },

  { quality: "7", intervals: [0, 4, 7, 10] },
  { quality: "maj7", intervals: [0, 4, 7, 11] },
  { quality: "min7", intervals: [0, 3, 7, 10] },
  { quality: "hdim7", intervals: [0, 3, 6, 10] },
  { quality: "dim7", intervals: [0, 3, 6, 9] }
];

function bestChordMatch(pcs: number[], bassPc: number | null): Match | null {
  if (pcs.length < 2) return null;

  const set = new Set(pcs);
  let best: Match | null = null;

  for (let root = 0; root < 12; root++) {
    for (const pat of PATTERNS) {
      const expected = pat.intervals.map((i) => (root + i) % 12);
      const expectedSet = new Set(expected);

      // Coverage score: how much of the chord is present
      let present = 0;
      for (const e of expectedSet) if (set.has(e)) present++;

      const coverage = present / expectedSet.size;

      // Penalty for extra tones (helps avoid labeling clusters as a triad)
      const extras = pcs.filter((x) => !expectedSet.has(x)).length;
      const extraPenalty = extras > 0 ? Math.min(0.35, extras * 0.12) : 0;

      // Bass agreement helps inversions/root detection
      let bassBoost = 0;
      if (bassPc !== null && expectedSet.has(bassPc)) bassBoost = 0.08;

      const score = clamp01(coverage - extraPenalty + bassBoost);

      if (!best || score > best.score) {
        const inv = computeInversion(root, pat.quality, bassPc, expected);
        best = {
          rootPc: root,
          quality: pat.quality,
          inversion: inv,
          symbol: chordSymbol(root, pat.quality),
          score
        };
      }
    }
  }

  // Reject very weak fits
  if (best && best.score < 0.45) return null;
  return best;
}

function computeInversion(
  rootPc: number,
  quality: ChordQuality,
  bassPc:: number | null,
  chordPcs: number[]
): 0 | 1 | 2 | 3 {
  if (bassPc === null) return 0;

  // chordPcs is already normalized (root + pattern)
  const uniq = Array.from(new Set(chordPcs));
  // For triads: 0=root,1=3rd,2=5th. For 7ths: 3=7th.
  const idx = uniq.findIndex((x) => x === bassPc);
  if (idx < 0) return 0;
  if (quality === "maj" || quality === "min" || quality === "dim" || quality === "aug") {
    if (idx === 0) return 0;
    if (idx === 1) return 1;
    return 2;
  }
  // 7th-chords
  if (idx === 0) return 0;
  if (idx === 1) return 1;
  if (idx === 2) return 2;
  return 3;
}

function getMeasureKeySignature(m: any): KeySignature | undefined {
  const fifths = m?.attributes?.key_fifths;
  if (typeof fifths !== "number") return undefined;

  // Phase 1: mode is unknown; we can add heuristic later.
  const mode: HarmonyMode = "unknown";
  return { fifths, mode };
}

function collectOnsetNotesInMeasure(score: ScoreModel, measureIndex: number): Map<number, number[]> {
  // Map onset t -> MIDI notes (concert pitch)
  const map = new Map<number, number[]>();

  for (const part of score.parts ?? []) {
    const measure = (part.measures ?? [])[measureIndex];
    if (!measure) continue;

    for (const ev of measure.events ?? []) {
      if (ev?.type !== "note" || !ev?.pitch?.step) continue;
      const t = typeof ev.t === "number" ? ev.t : 0;

      const midi = pitchToMidi(ev.pitch);
      const arr = map.get(t) ?? [];
      arr.push(midi);
      map.set(t, arr);
    }
  }

  return map;
}

function pickBassPc(midiNotes: number[]): number | null {
  if (!midiNotes.length) return null;
  let min = midiNotes[0]!;
  for (const m of midiNotes) if (m < min) min = m;
  return pc(min);
}

/**
 * Phase 1 harmony analyzer:
 * - per measure
 * - on each onset time inside the measure, compute a chord label from pitch classes
 * - concert pitch only
 */
export function analyzeHarmonyPerMeasure(score: ScoreModel): HarmonyAnalysis {
  const measureCount = Math.max(
    0,
    ...(score.parts ?? []).map((p) => (p.measures ?? []).length)
  );

  const measures: HarmonyMeasure[] = [];

  for (let mi = 0; mi < measureCount; mi++) {
    // Use first part’s measure attributes as the key-signature source
    const firstMeasure = (score.parts?.[0]?.measures ?? [])[mi];
    const key = getMeasureKeySignature(firstMeasure);

    const onsetMap = collectOnsetNotesInMeasure(score, mi);
    const times = Array.from(onsetMap.keys()).sort((a, b) => a - b);

    const chords: HarmonyChord[] = [];

    for (const t of times) {
      const midiNotes = onsetMap.get(t) ?? [];
      const pcs = Array.from(new Set(midiNotes.map(pc))).sort((a, b) => a - b);

      if (pcs.length === 0) continue;

      const bass = pickBassPc(midiNotes);
      const match = bestChordMatch(pcs, bass);

      if (!match) {
        chords.push({ t, pcs, confidence: pcs.length ? 0.25 : 0 });
        continue;
      }

      chords.push({
        t,
        pcs,
        rootPc: match.rootPc,
        quality: match.quality,
        inversion: match.inversion,
        symbol: match.symbol,
        confidence: match.score
      });
    }

    measures.push({
      measureNumber: (firstMeasure?.number ?? mi + 1) as number,
      key,
      chords
    });
  }

  return {
    version: "harmony_v1",
    concertPitch: true,
    per: "measure",
    measures
  };
}

/**
 * Helper to attach analysis into score.meta.harmony (internal only).
 */
export function attachHarmonyToScore(score: ScoreModel): ScoreModel {
  const harmony = analyzeHarmonyPerMeasure(score);

  const meta = {
    ...(score.meta ?? {}),
    harmony
  };

  return { ...score, meta };
}