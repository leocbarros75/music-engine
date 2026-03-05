// src/harmonize/satb/chordSymbol.ts

type ParsedChord = {
  rootPc: number; // 0..11
  pcs: number[]; // chord pitch classes
  name: string;
};

const PC_BY_NAME: Record<string, number> = {
  C: 0,
  "C#": 1,
  Db: 1,
  D: 2,
  "D#": 3,
  Eb: 3,
  E: 4,
  F: 5,
  "F#": 6,
  Gb: 6,
  G: 7,
  "G#": 8,
  Ab: 8,
  A: 9,
  "A#": 10,
  Bb: 10,
  B: 11
};

function clampPc(x: number): number {
  const v = x % 12;
  return v < 0 ? v + 12 : v;
}

/**
 * Supports: C, Am, Cmin, Cmaj7, C7, Cm7, Cdim, Caug, C°7, Cø7 (basic)
 * This is only for the SATB baseline.
 */
export function parseChordSymbol(symbolRaw: string): ParsedChord | null {
  const s = (symbolRaw ?? "").trim();
  if (!s) return null;

  // Root: letter + optional accidental
  const m = s.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;

  const letter = m[1]!.toUpperCase();
  const accidental = m[2] ?? "";
  const rest = (m[3] ?? "").trim();

  const rootName = `${letter}${accidental}`;
  const rootPc = PC_BY_NAME[rootName];
  if (typeof rootPc !== "number") return null;

  // Quality detection (minimal)
  const lower = rest.toLowerCase();

  const isDim = lower.includes("dim") || rest.includes("°");
  const isHalfDim = rest.includes("ø");
  const isAug = lower.includes("aug");
  const isMin = lower.startsWith("m") || lower.includes("min");
  const isMaj7 = lower.includes("maj7");
  const isMaj9 = lower.includes("maj9") || lower.includes("ma9");
  const is7 = lower === "7" || lower.endsWith("7") || lower.includes("dom7");
  const isSus2 = lower.includes("sus2");
  const isSus4 = lower.includes("sus") && !isSus2;
  const hasAdd2 = lower.includes("add2") || lower === "2" || (lower.includes(" 2") && !lower.includes("sus2"));
  const hasAdd4 = lower.includes("add4") || lower.includes("(4)");
  const hasAdd6 = lower.includes("6") && !lower.includes("16") && !lower.includes("m6");
  const hasAdd9 = lower.includes("add9") || lower.includes(" 9") || lower === "9" || isMaj9;

  // Base triad
  let third = 4;
  let fifth = 7;

  if (isMin) third = 3;
  if (isDim) {
    third = 3;
    fifth = 6;
  }
  if (isAug) {
    third = 4;
    fifth = 8;
  }

  let triad = [rootPc, clampPc(rootPc + third), clampPc(rootPc + fifth)];
  if (isSus2) triad = [rootPc, clampPc(rootPc + 2), clampPc(rootPc + fifth)];
  if (isSus4) triad = [rootPc, clampPc(rootPc + 5), clampPc(rootPc + fifth)];

  // Add 7th if requested
  const pcs = new Set<number>(triad);
  if (isMaj7 || isMaj9) pcs.add(clampPc(rootPc + 11));

  if (isHalfDim) {
    // half-diminished: dim triad + m7
    return { rootPc, pcs: [...new Set([rootPc, clampPc(rootPc + 3), clampPc(rootPc + 6), clampPc(rootPc + 10)])], name: s };
  }

  if (is7) {
    // dominant/min7 by default
    pcs.add(clampPc(rootPc + 10));
  }

  if (hasAdd2 || hasAdd9 || isMaj9) pcs.add(clampPc(rootPc + 2));
  if (hasAdd4) pcs.add(clampPc(rootPc + 5));
  if (hasAdd6) pcs.add(clampPc(rootPc + 9));

  return { rootPc, pcs: [...pcs], name: s };
}
