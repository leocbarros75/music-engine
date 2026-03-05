// src/harmony/roman.ts
import type { KeyEstimate, RomanAnalysis, ChordInfo } from "./types";
import { tonicNameToPc, pcToName } from "./pitch";
import { tonicPcFromKey } from "./keyEstimate";

const MAJOR_DEGREE_PCS = [0, 2, 4, 5, 7, 9, 11];
const MINOR_HARMONIC_DEGREE_PCS = [0, 2, 3, 5, 7, 8, 11];

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function degreeFromPcInKey(pc: number, key: KeyEstimate): number | null {
  const tonicPc = tonicPcFromKey(key);
  const rel = mod12(pc - tonicPc);

  const scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;
  const idx = scale.indexOf(rel);
  if (idx < 0) return null;
  return idx + 1;
}

function romanBaseFromDegree(deg: number): string {
  return (
    deg === 1 ? "I" :
    deg === 2 ? "II" :
    deg === 3 ? "III" :
    deg === 4 ? "IV" :
    deg === 5 ? "V" :
    deg === 6 ? "VI" :
    deg === 7 ? "VII" : "I"
  );
}

function romanFromDegree(deg: number, quality: string): string {
  const base = romanBaseFromDegree(deg);

  if (quality === "min") return base.toLowerCase();
  if (quality === "dim") return base.toLowerCase() + "°";
  if (quality === "hdim7") return base.toLowerCase() + "ø7";
  if (quality === "dim7") return base.toLowerCase() + "°7";

  if (quality === "dom7") return base + "7";
  if (quality === "min7") return base.toLowerCase() + "7";
  if (quality === "maj7") return base + "maj7";

  return base;
}

function functionTagFromDegree(deg: number | null): RomanAnalysis["functionTag"] {
  if (deg === 1 || deg === 3 || deg === 6) return "tonic";
  if (deg === 2 || deg === 4) return "predominant";
  if (deg === 5 || deg === 7) return "dominant";
  return "other";
}

function isSeventhChordQuality(q: string): boolean {
  return q === "dom7" || q === "maj7" || q === "min7" || q === "hdim7" || q === "dim7";
}

function inversionFigure(chord: ChordInfo): string {
  const root = chord.rootPc;
  const bass = chord.bassPc;

  if (root === null) return "";
  if (bass === null) return "";

  const pcs = chord.pcs ?? [];
  const r = mod12(root);

  const third =
    pcs.includes(mod12(r + 4)) ? mod12(r + 4) :
    pcs.includes(mod12(r + 3)) ? mod12(r + 3) :
    null;

  const fifth =
    pcs.includes(mod12(r + 7)) ? mod12(r + 7) :
    pcs.includes(mod12(r + 6)) ? mod12(r + 6) :
    pcs.includes(mod12(r + 8)) ? mod12(r + 8) :
    null;

  const seventh =
    pcs.includes(mod12(r + 10)) ? mod12(r + 10) :
    pcs.includes(mod12(r + 11)) ? mod12(r + 11) :
    pcs.includes(mod12(r + 9)) ? mod12(r + 9) :
    null;

  const is7 = isSeventhChordQuality(chord.quality);

  if (!is7) {
    if (bass === r) return "";
    if (third !== null && bass === third) return "6";
    if (fifth !== null && bass === fifth) return "64";
    return "";
  }

  if (bass === r) return "7";
  if (third !== null && bass === third) return "65";
  if (fifth !== null && bass === fifth) return "43";
  if (seventh !== null && bass === seventh) return "42";
  return "7";
}

function applyInversionToRoman(roman: string, figure: string): string {
  if (!figure) return roman;

  const slash = roman.indexOf("/");
  if (slash >= 0) {
    const left = roman.slice(0, slash);
    const right = roman.slice(slash);
    if (/\d$/.test(left)) return roman;
    return `${left}${figure}${right}`;
  }

  if (/\d$/.test(roman)) return roman;
  return `${roman}${figure}`;
}

function borrowedMixtureRomanIfAny(
  chord: ChordInfo,
  key: KeyEstimate
): { roman: string; degree: number; functionTag: RomanAnalysis["functionTag"] } | null {
  const mode = String(key?.mode ?? "").toLowerCase();
  if (mode !== "major") return null;

  const root = chord?.rootPc;
  if (typeof root !== "number") return null;

  const tonicPc = tonicNameToPc(key.tonic);
  const rel = mod12(root - tonicPc);

  const q = String(chord?.quality ?? "").toLowerCase();

  // Common borrowed chords in major:
  if (q === "maj" && rel === 3) return { roman: "bIII", degree: 3, functionTag: "tonic" };
  if (q === "maj" && rel === 8) return { roman: "bVI", degree: 6, functionTag: "predominant" };
  if (q === "maj" && rel === 10) return { roman: "bVII", degree: 7, functionTag: "predominant" };

  return null;
}

function targetRomanFromDegree(targetDeg: number): string {
  return (
    targetDeg === 2 ? "ii" :
    targetDeg === 3 ? "iii" :
    targetDeg === 4 ? "IV" :
    targetDeg === 5 ? "V" :
    targetDeg === 6 ? "vi" :
    "vii°"
  );
}

function diatonicPcSetForKey(key: KeyEstimate): Set<number> {
  const tonicPc = tonicNameToPc(key.tonic);
  const scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;
  const s = new Set<number>();
  for (const rel of scale) s.add(mod12(tonicPc + rel));
  return s;
}

function chordHasChromaticTone(chord: ChordInfo, key: KeyEstimate): boolean {
  const pcs = Array.isArray(chord?.pcs) ? chord.pcs : [];
  const diatonic = diatonicPcSetForKey(key);
  for (const pc of pcs) {
    const p = mod12(pc);
    if (!diatonic.has(p)) return true;
  }
  return false;
}

/**
 * Secondary function detection (Phase 4.3, conservative)
 *
 * Detect:
 * - V/target as dom7 always (strong evidence)
 * - V/target as MAJOR TRIAD only when the chord contains chromatic tones outside the key scale
 * - vii°/target as dim / ø7 / °7 (these are typically chromatic anyway)
 *
 * Returns the roman string and "secondaryOf" = the target roman (expected resolution).
 */
function detectSecondaryFunction(
  chord: ChordInfo,
  key: KeyEstimate
): { roman: string; secondaryOf: string } | null {
  const rootPc = chord?.rootPc;
  if (typeof rootPc !== "number") return null;

  const q = String(chord?.quality ?? "").toLowerCase();

  const tonicPc = tonicNameToPc(key.tonic);
  const scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;

  const hasChromatic = chordHasChromaticTone(chord, key);

  for (let i = 0; i < 7; i++) {
    const targetDeg = i + 1;
    if (targetDeg === 1) continue;

    const targetPc = mod12(tonicPc + scale[i]);
    const vOfTarget = mod12(targetPc + 7);
    const ltOfTarget = mod12(targetPc - 1);

    const targetRoman = targetRomanFromDegree(targetDeg);

    // V/target as dom7 (allow even if chord tones happen to be diatonic)
    if (q === "dom7" && mod12(rootPc) === vOfTarget) {
      return { roman: `V/${targetRoman}`, secondaryOf: targetRoman };
    }

    // V/target as major triad ONLY with chromatic evidence
    if (q === "maj" && hasChromatic && mod12(rootPc) === vOfTarget) {
      return { roman: `V/${targetRoman}`, secondaryOf: targetRoman };
    }

    // vii°/target as dim / ø7 / °7
    if ((q === "dim" || q === "hdim7" || q === "dim7") && mod12(rootPc) === ltOfTarget) {
      const base =
        q === "hdim7" ? "viiø7" :
        q === "dim7" ? "vii°7" :
        "vii°";
      return { roman: `${base}/${targetRoman}`, secondaryOf: targetRoman };
    }
  }

  return null;
}

export function analyzeRomanNumeral(chord: ChordInfo, key: KeyEstimate, notes: string[]): RomanAnalysis {
  if (!chord || chord.rootPc === null) {
    return { roman: "N.C.", degree: null, functionTag: "other", notes };
  }

  const deg = degreeFromPcInKey(chord.rootPc, key);
  const functionTag = functionTagFromDegree(deg);

  // 1) Secondary function chords (Phase 4.3, conservative)
  {
    const sec = detectSecondaryFunction(chord, key);
    if (sec) {
      const fig = inversionFigure(chord);
      const roman = applyInversionToRoman(sec.roman, fig);
      return {
        roman,
        degree: deg,
        functionTag: "dominant",
        secondaryOf: sec.secondaryOf,
        notes
      };
    }
  }

  // 2) Borrowed mixture in major when degree is non-diatonic (deg=null)
  if (deg === null) {
    const mix = borrowedMixtureRomanIfAny(chord, key);
    if (mix) {
      const fig = inversionFigure(chord);
      const roman = applyInversionToRoman(mix.roman, fig);
      return { roman, degree: mix.degree, functionTag: mix.functionTag, notes };
    }
  }

  // 3) Diatonic roman + inversion figure, else chord name
  let roman = deg ? romanFromDegree(deg, chord.quality) : chord.name;

  const fig = inversionFigure(chord);
  const is7 = isSeventhChordQuality(chord.quality);

  if (is7) {
    if (fig === "65" || fig === "43" || fig === "42") {
      roman = roman.replace(/7$/, "");
      roman = applyInversionToRoman(roman, fig);
    }
  } else {
    if (fig === "6" || fig === "64") roman = applyInversionToRoman(roman, fig);
  }

  return { roman, degree: deg, functionTag, notes };
}

export function chordNotesToNames(pcs: number[], preferSharps = true): string[] {
  return (pcs ?? []).map((pc) => pcToName(pc, preferSharps));
}