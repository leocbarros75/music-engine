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

function detectSecondaryDominant(chordRootPc: number, key: KeyEstimate): { roman: string; secondaryOf: string } | null {
  const tonicPc = tonicNameToPc(key.tonic);
  const scale = key.mode === "minor" ? MINOR_HARMONIC_DEGREE_PCS : MAJOR_DEGREE_PCS;

  for (let i = 0; i < 7; i++) {
    const targetDeg = i + 1;
    if (targetDeg === 1) continue;

    const targetPc = mod12(tonicPc + scale[i]);
    const vOfTarget = mod12(targetPc + 7);

    if (vOfTarget === mod12(chordRootPc)) {
      const targetRoman =
        targetDeg === 2 ? "ii" :
        targetDeg === 3 ? "iii" :
        targetDeg === 4 ? "IV" :
        targetDeg === 5 ? "V" :
        targetDeg === 6 ? "vi" :
        "vii°";
      return { roman: `V/${targetRoman}`, secondaryOf: targetRoman };
    }
  }
  return null;
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

  // 7th chord figures
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
    // If left already has a figure, do not double-append
    if (/\d$/.test(left)) return roman;
    return `${left}${figure}${right}`;
  }

  // If roman already ends with digits, do not double-append
  if (/\d$/.test(roman)) return roman;
  return `${roman}${figure}`;
}

function isMajorTriadQuality(q: string): boolean {
  return q === "maj";
}

export function analyzeRomanNumeral(chord: ChordInfo, key: KeyEstimate, notes: string[]): RomanAnalysis {
  if (!chord || chord.rootPc === null) {
    return { roman: "N.C.", degree: null, functionTag: "other", notes };
  }

  const deg = degreeFromPcInKey(chord.rootPc, key);
  const functionTag = functionTagFromDegree(deg);

  // 0) Borrowed bVII in major (mixture), example: C major -> Bb major = bVII
  // This fixes cases where chordDetect names it "A#" and degreeFromPcInKey returns null.
  if (key?.mode === "major" && deg === null && isMajorTriadQuality(chord.quality)) {
    const tonicPc = tonicPcFromKey(key);
    const bVIIpc = mod12(tonicPc - 2);

    if (mod12(chord.rootPc) === bVIIpc) {
      const fig = inversionFigure(chord);
      let roman = "bVII";
      if (fig === "6" || fig === "64") roman = applyInversionToRoman(roman, fig);

      return {
        roman,
        degree: 7,
        functionTag: "predominant",
        notes
      };
    }
  }

  // 1) Secondary dominants: only for dominant-7 quality
  if (chord.quality === "dom7") {
    const sec = detectSecondaryDominant(chord.rootPc, key);
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

  // 2) Diatonic roman + inversion figure (this fixes V65 etc)
  let roman = deg ? romanFromDegree(deg, chord.quality) : chord.name;

  // If it is a 7th chord, romanFromDegree already includes "7" (V7).
  // For inversions we want V65, V43, V42 (replace the 7 figure).
  const fig = inversionFigure(chord);
  const is7 = isSeventhChordQuality(chord.quality);

  if (is7) {
    if (fig === "65" || fig === "43" || fig === "42") {
      roman = roman.replace(/7$/, ""); // remove trailing 7 before adding inversion
      roman = applyInversionToRoman(roman, fig);
    } else {
      // root position remains V7
      // keep roman as-is
    }
  } else {
    // Triads: add 6 / 64 when applicable
    if (fig === "6" || fig === "64") roman = applyInversionToRoman(roman, fig);
  }

  return { roman, degree: deg, functionTag, notes };
}

export function chordNotesToNames(pcs: number[], preferSharps = true): string[] {
  return (pcs ?? []).map((pc) => pcToName(pc, preferSharps));
}