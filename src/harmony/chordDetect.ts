// src/harmony/chordDetect.ts
import type { ChordInfo, ChordQuality } from "./types";
import { pcToName } from "./pitch";

function uniqSorted(a: number[]): number[] {
  const s = new Set<number>();
  for (const x of a) s.add(((x % 12) + 12) % 12);
  return Array.from(s).sort((x, y) => x - y);
}

function hasPc(pcs: number[], pc: number): boolean {
  const t = ((pc % 12) + 12) % 12;
  return pcs.includes(t);
}

function qualityForTriad(pcs: number[], root: number): ChordQuality {
  const r = ((root % 12) + 12) % 12;
  const m3 = (r + 3) % 12;
  const M3 = (r + 4) % 12;
  const p5 = (r + 7) % 12;
  const d5 = (r + 6) % 12;
  const a5 = (r + 8) % 12;

  const hasM3 = hasPc(pcs, M3);
  const hasm3 = hasPc(pcs, m3);

  if (hasM3 && hasPc(pcs, p5)) return "maj";
  if (hasm3 && hasPc(pcs, p5)) return "min";
  if (hasm3 && hasPc(pcs, d5)) return "dim";
  if (hasM3 && hasPc(pcs, a5)) return "aug";

  if (hasPc(pcs, (r + 2) % 12) && hasPc(pcs, p5)) return "sus2";
  if (hasPc(pcs, (r + 5) % 12) && hasPc(pcs, p5)) return "sus4";

  return "unknown";
}

function qualityForSeventh(pcs: number[], root: number, triadQ: ChordQuality): ChordQuality {
  const r = ((root % 12) + 12) % 12;
  const m7 = (r + 10) % 12;
  const M7 = (r + 11) % 12;
  const d7 = (r + 9) % 12;

  const hasm7 = hasPc(pcs, m7);
  const hasM7 = hasPc(pcs, M7);
  const hasd7 = hasPc(pcs, d7);

  // Dominant seventh: major triad + m7
  if (triadQ === "maj" && hasm7) return "dom7";

  if (triadQ === "maj" && hasM7) return "maj7";
  if (triadQ === "min" && hasm7) return "min7";
  if (triadQ === "dim" && hasm7) return "hdim7";
  if (triadQ === "dim" && hasd7) return "dim7";

  return triadQ;
}

function suffixForQuality(q: ChordQuality): string {
  return q === "maj"
    ? ""
    : q === "min"
    ? "m"
    : q === "dim"
    ? "dim"
    : q === "aug"
    ? "aug"
    : q === "dom7"
    ? "7"
    : q === "maj7"
    ? "maj7"
    : q === "min7"
    ? "m7"
    : q === "hdim7"
    ? "ø7"
    : q === "dim7"
    ? "dim7"
    : q === "sus2"
    ? "sus2"
    : q === "sus4"
    ? "sus4"
    : "";
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Normalize the detector score to 0..1.
 *
 * Score is intentionally heuristic, but roughly:
 * - triad recognized: +3
 * - root present: +2
 * - seventh recognized: +1
 * - bass==root boost: +0.35
 * - smaller set bonus: up to +0.5 (pcs length 1..6)
 *
 * So typical "strong" chord snapshots land around 5..6+.
 */
function scoreToConfidence(score: number): number {
  const MAX = 6.85;
  return clamp01(score / MAX);
}

// IMPORTANT: bassPc is optional, but when present it helps resolve ambiguities,
// especially for fully diminished seventh chords (symmetrical).
export function detectChordFromPcs(
  pcsIn: number[],
  preferSharps = true,
  bassPc?: number | null
): ChordInfo {
  const pcs = uniqSorted(pcsIn);
  const bpc = bassPc === null || bassPc === undefined ? null : (((bassPc % 12) + 12) % 12);

  if (pcs.length === 0) {
    return {
      pcs,
      rootPc: null,
      bassPc: bpc,
      quality: "unknown",
      name: "N.C.",
      score: 0,
      confidence: 0
    };
  }

  // Try each pc as potential root, score by how many chord tones it explains.
  let best: { root: number; score: number; quality: ChordQuality } | null = null;

  for (const r of pcs) {
    const triadQ = qualityForTriad(pcs, r);
    let score = 0;

    // Reward matching third/fifth patterns
    if (triadQ !== "unknown") score += 3;

    // Reward root presence
    if (hasPc(pcs, r)) score += 2;

    // Reward seventh recognition
    const sevQ = qualityForSeventh(pcs, r, triadQ);
    if (sevQ !== triadQ) score += 1;

    // Prefer bass as root a little (helps inversion-driven snapshots)
    if (bpc !== null && r === bpc) score += 0.35;

    // Small reward for smaller sets (clean chord)
    score += Math.max(0, 6 - pcs.length) * 0.1;

    const qFinal = qualityForSeventh(pcs, r, triadQ);

    if (!best || score > best.score) best = { root: r, score, quality: qFinal };
  }

  let rootPc = best?.root ?? pcs[0];
  let quality = best?.quality ?? "unknown";

  // Special case: fully diminished 7th chords are symmetrical and root is ambiguous.
  // If we know the bass, we treat the bass as the functional root for analysis tests.
  if (quality === "dim7" && bpc !== null && hasPc(pcs, bpc)) {
    rootPc = bpc;
  }

  const rootName = pcToName(rootPc, preferSharps);
  const suffix = suffixForQuality(quality);

  const score = typeof best?.score === "number" ? best.score : 0;
  const confidence = scoreToConfidence(score);

  return {
    pcs,
    rootPc,
    bassPc: bpc,
    quality,
    name: `${rootName}${suffix}`,
    score,
    confidence
  };
}