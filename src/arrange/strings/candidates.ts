import type { Slice, VoiceId, Voicing } from "./types";
import { STRING_RANGES } from "./ranges";
import { parseChordSymbol } from "../../harmonize/satb/chordSymbol";

const VOICES: VoiceId[] = ["vln1", "vln2", "vla", "vc", "cb"];

/**
 * How far above Violin II's preferred floor the melody must sit before the
 * inner voices are held underneath it. An octave: less than that and there is
 * no room to hold them there without compressing the ensemble downward.
 */
export const MELODY_HEADROOM = 12;

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

function pickCandidatesForVoice(
  pcs: number[],
  range: { absMin: number; absMax: number },
  prev: number | null,
  /**
   * Highest pitch this voice may take at this slice — the melody, when Violin I
   * is locked to it. Crossing above the melody is only a soft DP penalty, and a
   * melody sitting low in the violin's range loses to the pull of each voice's
   * own preferred register on nearly every slice: Violin II came out above the
   * tune at 62 of 64 sampled points. A ceiling cannot be outvoted.
   *
   * Advisory, not absolute. If nothing the chord offers fits underneath, the
   * voice keeps its full choice — a forced crossing beats an empty candidate
   * list or a pitch outside the harmony.
   */
  ceiling: number | null = null
): number[] {
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
  const under = ceiling === null ? unique : unique.filter((m) => m <= ceiling);
  const pool = under.length ? under : unique;
  pool.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
  return pool.slice(0, 4);
}

export function buildCandidatesForSlice(params: {
  slice: Slice;
  prevVoicing: Voicing | null;
  keyFifths: number;
  keyMode: "major" | "minor";
  profileId?: string;
  /** See StringArrangerOptions.keepInnerVoicesBelowMelody. Off unless asked. */
  keepInnerVoicesBelowMelody?: boolean;
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
    // Keep the source register. Octave changes are explicit pipeline settings.
    const vln1Range = STRING_RANGES.vln1;
    const shifted = slice.melodyMidi;
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
    // Keep Violin II and Viola under the tune — but only where they fit.
    //
    // Crossing is just a soft DP penalty, and a melody low in the violin's range
    // loses to each voice's pull toward its own register: Violin II came out
    // above the melody at 62 of 64 sampled points. A candidate ceiling settles
    // it outright.
    //
    // It is conditional because forcing four voices under a low melody does not
    // make room that is not there, it compresses the whole ensemble. Applied
    // unconditionally to a melody at C#4–A4, crossings went to zero and the
    // double bass paid for it: a clean D2 G2 A2 line became D2 G1 A1 … D3 D3,
    // under the preferred floor the Forsyth note in ranges.ts argues for, with
    // a 17-semitone leap. So the ceiling waits until the melody sits at least
    // an octave above Violin II's preferred floor; below that the register
    // itself is the problem, and arrangeStringEnsemble says so in a warning
    // rather than quietly writing a cramped score.
    const melodyTop =
      params.keepInnerVoicesBelowMelody && out.vln1.length ? (out.vln1[0] as number) : null;
    const roomBelow =
      melodyTop !== null && melodyTop - STRING_RANGES.vln2.prefMin >= MELODY_HEADROOM;
    const ceiling = roomBelow && (voice === "vln2" || voice === "vla") ? melodyTop : null;
    out[voice] = pickCandidatesForVoice(pcsForVoice, range, prev, ceiling);
    if (!out[voice].length) {
      out[voice] = pickCandidatesForVoice(chordPcs, range, prev, ceiling);
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
