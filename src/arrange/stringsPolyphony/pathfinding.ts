import type { CounterpointRules, Motif, MotifEntry, RhythmState, Slice, VoiceId, Voicing } from "./types";
import { STRING_RANGES, type Range } from "./ranges";
import { motifMidiAtSlice } from "./motifs";
import { parseChordSymbol } from "../../harmonize/satb/chordSymbol";

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

function clampPc(pc: number): number {
  const v = pc % 12;
  return v < 0 ? v + 12 : v;
}

function scalePcs(fifths: number, mode: "major" | "minor"): number[] {
  const major = [0, 2, 4, 5, 7, 9, 11];
  const minor = [0, 2, 3, 5, 7, 8, 10];
  const root = clampPc(fifths * 7);
  const base = mode === "minor" ? minor : major;
  return base.map((pc) => clampPc(root + pc));
}

function pickCandidates(pcs: number[], range: { absMin: number; absMax: number }, prev: number | null): number[] {
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
  return unique.slice(0, 6);
}

function chordPcs(symbol: string | null): number[] {
  if (!symbol) return [];
  const parsed = parseChordSymbol(symbol);
  return parsed?.pcs ?? [];
}

function bassPc(symbol: string | null): number | null {
  if (!symbol) return null;
  const parts = symbol.split("/");
  if (parts.length > 1) {
    const bass = parseChordSymbol(parts[1]);
    if (bass?.rootPc !== undefined) return bass.rootPc;
  }
  const parsed = parseChordSymbol(parts[0]);
  return parsed?.rootPc ?? null;
}

export function buildCandidateMap(params: {
  slice: Slice;
  prevVoicing: Voicing | null;
  keyFifths: number;
  keyMode: "major" | "minor";
  motif: Motif | null;
  motifEntries: MotifEntry[];
  rules: CounterpointRules;
  rhythmState: RhythmState;
  ranges?: Record<VoiceId, Range>;
}): Record<VoiceId, number[]> {
  const { slice, prevVoicing, keyFifths, keyMode, motif, motifEntries, rules, rhythmState } = params;
  const rangeMap = params.ranges ?? STRING_RANGES;
  const scale = scalePcs(keyFifths, keyMode);
  const chord = chordPcs(slice.chordSymbol);
  const chordBass = bassPc(slice.chordSymbol);
  const useChord = chord.length ? chord : scale;
  const isStrongBeat = slice.isStrongBeat;
  const allowedPcs = new Set(isStrongBeat ? useChord : [...useChord, ...scale]);

  const out: Record<VoiceId, number[]> = {
    vln1: [],
    vln2: [],
    vla: [],
    vc: [],
    cb: []
  };

  const bassRatio =
    rhythmState.totalAttacks > 0 ? (rhythmState.perVoice.cb ?? 0) / rhythmState.totalAttacks : 1;
  const bassAnchored =
    chordBass !== null &&
    prevVoicing?.cb !== null &&
    ((prevVoicing.cb % 12) + 12) % 12 === chordBass &&
    bassRatio >= (rules.polyphony.celloSinger?.bassAnchoringThreshold ?? 0);
  const celloAgile = (rhythmState.perVoice.vc ?? 0) >= (rules.polyphony.celloSinger?.agilityNoteDensity ?? 3);

  // Violin I melody anchor.
  if (typeof slice.melodyMidi === "number") {
    out.vln1 = [slice.melodyMidi];
  }

  for (const voice of VOICES) {
    if (voice === "vln1" && out.vln1.length) continue;
    const prev = prevVoicing ? prevVoicing[voice] : null;
    let range = rangeMap[voice];
    if (voice === "vc" && rules.polyphony.celloSinger?.celloFreeRange && bassAnchored) {
      const [low, high] = rules.polyphony.celloSinger.celloFreeRange;
      range = { ...range, prefMin: low, prefMax: high };
    }

    const pcs = isStrongBeat ? useChord : [...new Set([...useChord, ...scale])];
    if (voice === "cb") {
      const cbChordPcs = chord.length ? chord : useChord;
      if (chordBass !== null) {
        if (celloAgile && !isStrongBeat) {
          out[voice] = [];
        } else {
          out[voice] = pickCandidates([chordBass], range, prev);
        }
      } else {
        // No slash bass, but still keep CB on chord tones only.
        out[voice] = pickCandidates(cbChordPcs, range, prev);
      }
    } else {
      out[voice] = pickCandidates(pcs, range, prev);
    }
    if (!out[voice].length && voice !== "vln1") {
      out[voice] = pickCandidates(scale, range, prev);
    }
  }

  // Motif insertion.
  if (motif) {
    for (const entry of motifEntries) {
      if (!entry.voice) continue;
      const target = motifMidiAtSlice(motif, entry, slice.index);
      if (target === null) continue;
      const range = STRING_RANGES[entry.voice];
      const candidates = [target, target + 12, target - 12].filter((m) => {
        if (m < range.absMin || m > range.absMax) return false;
        const pc = ((m % 12) + 12) % 12;
        return allowedPcs.has(pc);
      });
      if (candidates.length) {
        const current = out[entry.voice] ?? [];
        const merged = [...new Set([...candidates, ...current])];
        out[entry.voice] = merged;
      }
    }
  }

  return out;
}
