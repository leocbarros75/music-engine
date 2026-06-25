import type { Slice, VoiceId, Voicing } from "./types";
import { STRING_RANGES } from "./ranges";
import { parseChordSymbol } from "../../../harmonize/satb/chordSymbol";

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function clampPc(pc: number): number {
  const v = pc % 12;
  return v < 0 ? v + 12 : v;
}

function parseChordPcs(symbol?: string | null): { pcs: number[]; bassPc: number | null; rootPc: number | null } {
  if (!symbol) return { pcs: [], bassPc: null, rootPc: null };
  const raw = String(symbol);
  const parts = raw.split("/");
  const base = parts[0] ?? raw;
  const parsed = parseChordSymbol(base);
  const pcs = parsed?.pcs ?? [];
  const rootPc = typeof parsed?.rootPc === "number" ? parsed.rootPc : null;
  let bassPc: number | null = null;
  if (parts.length > 1) {
    const bass = parseChordSymbol(parts[1]);
    bassPc = bass?.rootPc ?? null;
  }
  return { pcs, bassPc, rootPc };
}

function scalePcsFromKey(fifths: number, mode: "major" | "minor"): number[] {
  const major = [0, 2, 4, 5, 7, 9, 11];
  const minor = [0, 2, 3, 5, 7, 8, 10];
  const root = clampPc(0 + fifths * 7);
  const base = mode === "minor" ? minor : major;
  return base.map((pc) => clampPc(root + pc));
}

function inferChordPcs(melodyPc: number, scalePcs: number[]): number[] {
  const triads = [
    [0, 2, 4], // I
    [3, 5, 0], // IV
    [4, 6, 1], // V
    [5, 0, 2], // vi
    [1, 3, 5] // ii
  ];
  const scaleIdx = scalePcs.indexOf(melodyPc);
  if (scaleIdx < 0) return scalePcs;
  for (const triad of triads) {
    const pcs = triad.map((i) => scalePcs[i % 7]);
    if (pcs.includes(melodyPc)) return pcs;
  }
  return scalePcs;
}

function pickCandidatesForVoice(pcs: number[], range: { absMin: number; absMax: number }, prev: number | null): number[] {
  if (!pcs.length) return [];
  const target = typeof prev === "number" ? prev : Math.round((range.absMin + range.absMax) / 2);
  const candidates: number[] = [];
  for (const pc of pcs) {
    for (let oct = -2; oct <= 2; oct++) {
      const midi = clampPc(pc) + (Math.floor(target / 12) + oct) * 12;
      if (midi >= range.absMin && midi <= range.absMax) candidates.push(midi);
    }
  }
  const unique = Array.from(new Set(candidates));
  unique.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return unique.slice(0, 4);
}

export function buildCandidatesForSlice(params: {
  slice: Slice;
  prevVoicing: Voicing | null;
  keyFifths: number;
  keyMode: "major" | "minor";
  profileId?: string;
}): Record<VoiceId, number[]> {
  const { slice, prevVoicing, keyFifths, keyMode, profileId } = params;
  const { pcs, bassPc, rootPc } = parseChordPcs(slice.chordSymbol);
  const scale = scalePcsFromKey(keyFifths, keyMode);
  const melodyPc = typeof slice.melodyMidi === "number" ? slice.melodyMidi % 12 : null;
  const chordPcs = pcs.length ? pcs : melodyPc !== null ? inferChordPcs(melodyPc, scale) : scale;

  // ── Profile-specific melody assignment ───────────────────────────────────
  // cello_melody: Vc carries the foreground melody; Vln I plays harmony.
  const isCelloMelody = profileId === "cello_melody";

  const out: Record<VoiceId, number[]> = {
    vln1: [],
    vln2: [],
    vla: [],
    vc: [],
    cb: []
  };

  if (typeof slice.melodyMidi === "number" && !isCelloMelody) {
    // Standard: Vln I locked to melody (one octave up when range permits)
    const vln1Range = STRING_RANGES.vln1;
    const shifted = slice.melodyMidi + 12;
    out.vln1 = [shifted >= vln1Range.absMin && shifted <= vln1Range.absMax ? shifted : slice.melodyMidi];
  }

  if (typeof slice.melodyMidi === "number" && isCelloMelody) {
    // cello_melody: Vc locked to melody, clamped into Vc range by octave
    const vcRange = STRING_RANGES.vc;
    let midi = slice.melodyMidi;
    while (midi > vcRange.absMax) midi -= 12;
    while (midi < vcRange.absMin) midi += 12;
    // Keep in preferred range if possible
    const inPref = midi >= vcRange.prefMin && midi <= vcRange.prefMax;
    const shiftedDown = midi - 12;
    if (!inPref && shiftedDown >= vcRange.absMin && shiftedDown >= vcRange.prefMin) midi = shiftedDown;
    out.vc = [midi];
  }

  for (const voice of VOICES) {
    // Skip already-locked voices
    if (voice === "vln1" && out.vln1.length) continue;
    if (voice === "vc" && out.vc.length) continue;

    const range = STRING_RANGES[voice];
    const prev = prevVoicing ? prevVoicing[voice] : null;
    const pcsForVoice =
      voice === "cb"
        ? bassPc !== null
          ? [bassPc]
          : rootPc !== null
            ? [rootPc]
            : chordPcs
        : chordPcs;
    out[voice] = pickCandidatesForVoice(pcsForVoice, range, prev);
    if (!out[voice].length) {
      out[voice] = pickCandidatesForVoice(chordPcs, range, prev);
    }
  }

  return out;
}

export function buildVoicingStates(candidateMap: Record<VoiceId, number[]>): Voicing[] {
  const v1 = candidateMap.vln1.length ? candidateMap.vln1 : [null];
  const v2 = candidateMap.vln2.length ? candidateMap.vln2 : [null];
  const va = candidateMap.vla.length ? candidateMap.vla : [null];
  const vc = candidateMap.vc.length ? candidateMap.vc : [null];
  const cb = candidateMap.cb.length ? candidateMap.cb : [null];

  const out: Voicing[] = [];
  for (const a of v1) {
    for (const b of v2) {
      for (const c of va) {
        for (const d of vc) {
          for (const e of cb) {
            out.push({ vln1: a, vln2: b, vla: c, vc: d, cb: e });
          }
        }
      }
    }
  }
  return out;
}
