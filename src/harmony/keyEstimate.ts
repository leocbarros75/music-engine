// src/harmony/keyEstimate.ts
import type { KeyEstimate } from "./types";
import { tonicNameToPc, pcToName } from "./pitch";

// Small key estimator using pitch class histogram and major/minor templates.

const MAJOR_TEMPLATE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_TEMPLATE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += (a[i] ?? 0) * (b[i] ?? 0);
  return s;
}

function norm(a: number[]): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += (a[i] ?? 0) * (a[i] ?? 0);
  return Math.sqrt(s);
}

function rotate(arr: number[], shift: number): number[] {
  const out = new Array(12).fill(0);
  for (let i = 0; i < 12; i++) out[(i + shift + 12) % 12] = arr[i] ?? 0;
  return out;
}

function cosineSim(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na <= 0 || nb <= 0) return 0;
  return dot(a, b) / (na * nb);
}

export function estimateKeyFromPcHistogram(hist: number[], preferSharps = true): KeyEstimate {
  const h = (hist ?? []).slice(0, 12);
  while (h.length < 12) h.push(0);

  let best: { pc: number; mode: "major" | "minor"; sim: number } = { pc: 0, mode: "major", sim: -1 };

  for (let tonicPc = 0; tonicPc < 12; tonicPc++) {
    const maj = cosineSim(h, rotate(MAJOR_TEMPLATE, tonicPc));
    if (maj > best.sim) best = { pc: tonicPc, mode: "major", sim: maj };

    const min = cosineSim(h, rotate(MINOR_TEMPLATE, tonicPc));
    if (min > best.sim) best = { pc: tonicPc, mode: "minor", sim: min };
  }

  const confidence = Math.max(0, Math.min(1, (best.sim + 1) / 2));
  return { tonic: pcToName(best.pc, preferSharps), mode: best.mode, confidence };
}

export function keyFromMetaOrBestGuess(metaKey: any | null, hist: number[], preferSharps = true): KeyEstimate {
  if (metaKey) {
    if (typeof metaKey === "string") {
      const s = metaKey.toLowerCase();
      const tonic = metaKey.trim().split(/\s+/)[0] ?? "C";
      const mode = s.includes("minor") ? "minor" : s.includes("major") ? "major" : "unknown";
      if (mode === "major" || mode === "minor") return { tonic, mode, confidence: 0.95 };
    }

    if (typeof metaKey === "object" && typeof metaKey.tonic === "string") {
      const mode = metaKey.mode === "minor" ? "minor" : metaKey.mode === "major" ? "major" : "unknown";
      if (mode === "major" || mode === "minor") return { tonic: metaKey.tonic, mode, confidence: 0.95 };
    }
  }

  return estimateKeyFromPcHistogram(hist, preferSharps);
}

export function tonicPcFromKey(key: KeyEstimate): number {
  return tonicNameToPc(key.tonic);
}