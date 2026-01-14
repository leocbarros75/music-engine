// src/harmony/cadence.ts
import type { CadenceDetection, MeasureHarmony, CadenceType } from "./types";

function up(s: string): string {
  return String(s ?? "").toUpperCase().trim();
}

function isVishRoman(roman: string): boolean {
  const r = up(roman);
  // Includes V, V7, V/V, etc, and vii° as dominant-function
  return r.startsWith("V") || r.includes("V/") || r.startsWith("VII");
}

function isIshRoman(roman: string): boolean {
  const r = String(roman ?? "").trim();
  return r === "I" || r === "i";
}

function isIVishRoman(roman: string): boolean {
  const r = String(roman ?? "").trim();
  return r === "IV" || r === "iv";
}

function isVIishRoman(roman: string): boolean {
  const r = String(roman ?? "").trim();
  return r === "VI" || r === "vi";
}

function looksLikeV7(prev: MeasureHarmony): boolean {
  const prevRoman = up(prev?.roman?.roman ?? "");
  const q = prev?.chord?.quality ?? "unknown";

  // Strong signal: detected dominant seventh quality
  if (q === "dom7") return true;

  // Backup: roman text contains 7 on a V
  if (prevRoman.startsWith("V") && prevRoman.includes("7")) return true;

  return false;
}

export function detectCadences(measures: MeasureHarmony[]): CadenceDetection[] {
  const out: CadenceDetection[] = [];

  for (let i = 1; i < measures.length; i++) {
    const prev = measures[i - 1];
    const last = measures[i];

    const prevR = prev?.roman?.roman ?? "N.C.";
    const lastR = last?.roman?.roman ?? "N.C.";

    let type: CadenceType = "none";
    let conf = 0;

    // Authentic cadence: V(7) -> I
    if (isVishRoman(prevR) && isIshRoman(lastR)) {
      // If we can tell it's V7, treat as "perfect" with higher confidence.
      if (looksLikeV7(prev)) {
        type = "authentic_perfect";
        conf = 0.9;
      } else {
        type = "authentic_imperfect";
        conf = 0.75;
      }
    }
    // Deceptive: V -> vi
    else if (isVishRoman(prevR) && isVIishRoman(lastR)) {
      type = "deceptive";
      conf = looksLikeV7(prev) ? 0.75 : 0.65;
    }
    // Half cadence: ends on V-ish
    else if (!isVishRoman(prevR) && isVishRoman(lastR)) {
      type = "half";
      conf = 0.6;
    }
    // Plagal: IV -> I
    else if (isIVishRoman(prevR) && isIshRoman(lastR)) {
      type = "plagal";
      conf = 0.6;
    }

    if (type !== "none") {
      out.push({
        atMeasure: last.measureNumber,
        type,
        confidence: conf,
        evidence: { prevRoman: prevR, lastRoman: lastR }
      });
    }
  }

  return out;
}