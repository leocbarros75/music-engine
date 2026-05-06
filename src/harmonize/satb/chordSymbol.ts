// src/harmonize/satb/chordSymbol.ts
// Full jazz chord parser: triads, 7ths, extensions (9/11/13), alterations (#11, b9, b5, #5),
// slash inversions, and all standard jazz symbol variants.
//
// ParsedChord fields:
//   pcs        — ALL chord pitch classes (for matching / inference)
//   voicingPcs — reduced set for SATB/piano voicing: omits perfect 5th on 11th+13th chords
//   colorPcs   — extension / alteration tones above the 7th (b9, 9, #9, 11, #11, b13, 13)
//   bassPc     — slash-chord bass PC; null = root position

export type ParsedChord = {
  rootPc: number;        // 0..11 — root pitch class
  pcs: number[];         // all chord pitch classes (unordered, deduplicated)
  voicingPcs: number[];  // pcs with expendable 5th omitted on 11th / 13th chords
  colorPcs: number[];    // extension / alteration tones (for voice-leading priority)
  bassPc: number | null; // slash-chord bass note PC (null = root position)
  name: string;          // original symbol string
};

// ─── Pitch-class lookup ───────────────────────────────────────────────────────

export const PC_BY_NAME: Record<string, number> = {
  C: 0,
  "C#": 1, Db: 1,
  D: 2,
  "D#": 3, Eb: 3,
  E: 4,
  F: 5,
  "F#": 6, Gb: 6,
  G: 7,
  "G#": 8, Ab: 8,
  A: 9,
  "A#": 10, Bb: 10,
  B: 11,
};

export function clampPc(x: number): number {
  const v = x % 12;
  return v < 0 ? v + 12 : v;
}

function add(pcs: Set<number>, root: number, semitones: number): void {
  pcs.add(clampPc(root + semitones));
}

// Parse a note name (e.g. "Eb", "F#", "G") into a pitch class 0..11.
function parseNoteName(s: string): number | null {
  const two = s.slice(0, 2);
  if (PC_BY_NAME[two] !== undefined) return PC_BY_NAME[two]!;
  const one = s.slice(0, 1).toUpperCase();
  if (PC_BY_NAME[one] !== undefined) return PC_BY_NAME[one]!;
  return null;
}

// ─── Chord quality classifier ─────────────────────────────────────────────────
// Receives the part of the symbol AFTER the root (e.g. "maj7", "m7b5", "7#11").

type ChordQuality =
  | "major"       // C
  | "minor"       // Cm
  | "aug"         // Caug / C+
  | "dim"         // Cdim / C°
  | "sus2"        // Csus2
  | "sus4"        // Csus4 / Csus
  | "dom7sus4"    // C7sus4 — R,4,5,b7 (no 3rd)
  | "dom9sus4"    // C9sus4 — R,4,5,b7,9 (no 3rd)
  | "maj6"        // C6     — R,3,5,6
  | "m6"          // Cm6    — R,b3,5,6
  | "add9"        // Cadd9  — R,3,5,9 (no 7th)
  | "madd9"       // Cmadd9 — R,b3,5,9 (no 7th)
  | "maj7"        // Cmaj7
  | "maj9"        // Cmaj9
  | "maj11"       // Cmaj11
  | "maj13"       // Cmaj13
  | "dom7"        // C7
  | "dom9"        // C9
  | "dom11"       // C11
  | "dom13"       // C13
  | "dom7b9"      // C7b9 / C7(b9)
  | "dom7s9"      // C7#9 / C7(#9)
  | "dom7s11"     // C7#11 / Lydian dominant
  | "dom7b5"      // C7b5
  | "dom7s5"      // C7#5 / Caug7
  | "dom9s11"     // C9#11
  | "dom13s11"    // C13#11
  | "m7"          // Cm7
  | "m9"          // Cm9
  | "m11"         // Cm11
  | "m13"         // Cm13
  | "m7b5"        // Cm7b5 / Cø7 (half-diminished)
  | "dim7"        // Cdim7 / C°7 (fully diminished)
  | "mmaj7"       // CmMaj7 (minor-major 7th)
  | "mmaj9";      // CmMaj9

export function classifyQuality(rest: string): ChordQuality {
  const r = rest.trim();
  const lo = r.toLowerCase();

  // ── Half-diminished (must come before generic m7 / dim checks) ──
  if (
    lo.includes("m7b5") || lo.includes("m7♭5") || lo === "ø7" || lo === "ø" ||
    lo.includes("halfdim") || lo.includes("half-dim") || r === "Ø7"
  ) return "m7b5";

  // ── Diminished 7th (full) ──
  if (lo.includes("dim7") || r.includes("°7")) return "dim7";

  // ── Minor-major 7th ──
  if (
    lo.includes("mmaj7") || lo.includes("mma7") || lo.includes("m(maj7)") ||
    lo.includes("minmaj7") || lo.includes("m△7")
  ) return "mmaj7";
  if (lo.includes("mmaj9") || lo.includes("mma9") || lo.includes("m(maj9)")) return "mmaj9";

  // ── Augmented 7th (BEFORE plain aug check) ──
  if (lo.includes("aug7") || lo === "+7") return "dom7s5";

  // ── Augmented triad ──
  if (lo.includes("aug") || lo === "+") return "aug";

  // ── Sus + 7th (before plain sus) ──
  if (lo.includes("9sus4") || lo.includes("sus4 9") || lo.includes("sus 9")) return "dom9sus4";
  if (lo.includes("7sus4") || lo.includes("7sus")) return "dom7sus4";

  // ── Sus triads ──
  if (lo.includes("sus2")) return "sus2";
  if (lo.includes("sus4") || lo === "sus") return "sus4";

  // ── add9 / madd9 (before 9 / m9 catches) ──
  if (lo.includes("madd9") || lo.includes("m add9") || lo.includes("m(add9)")) return "madd9";
  if (lo.includes("add9") || lo.includes("add 9") || lo.includes("(add9)")) return "add9";

  // ── Major extended ──
  if (lo.includes("maj13") || lo.includes("ma13") || lo.includes("△13")) return "maj13";
  if (lo.includes("maj11") || lo.includes("ma11") || lo.includes("△11")) return "maj11";
  if (lo.includes("maj9") || lo.includes("ma9") || lo.includes("△9")) return "maj9";
  if (
    lo.includes("maj7") || lo.includes("ma7") ||
    lo.includes("△7") || lo === "△" || lo === "Δ" || lo === "^7" || lo === "△"
  ) return "maj7";

  // ── 6th chords (before m, to catch "m6") ──
  if (lo.includes("m6") || lo.includes("min6")) return "m6";
  if (lo === "6" || lo.includes("maj6") || lo.includes("add6")) return "maj6";

  // ── Minor extended (most specific first; before generic minor / dom7) ──
  if (lo.includes("m13") || lo.includes("min13")) return "m13";
  if (lo.includes("m11") || lo.includes("min11")) return "m11";
  if (lo.includes("m9") || lo.includes("min9")) return "m9";
  if (lo.includes("m7") || lo.includes("min7")) return "m7";

  // ── Diminished triad (after dim7) ──
  if (lo.includes("dim") || r.includes("°")) return "dim";

  // ── Dominant extended / altered — most specific first ──
  if (lo.includes("13#11") || lo.includes("13♯11")) return "dom13s11";
  if (lo.includes("9#11") || lo.includes("9♯11")) return "dom9s11";
  if (lo.includes("7#11") || lo.includes("7♯11") || lo.includes("7(#11)") ||
      lo.includes("lyd") || lo.includes("lydian")) return "dom7s11";
  if (lo.includes("7b9") || lo.includes("7♭9") || lo.includes("7(b9)")) return "dom7b9";
  if (lo.includes("7#9") || lo.includes("7♯9") || lo.includes("7(#9)")) return "dom7s9";
  if (lo.includes("7b5") || lo.includes("7♭5")) return "dom7b5";
  if (lo.includes("7#5") || lo.includes("7♯5")) return "dom7s5";
  if (lo === "13" || (lo.includes("13") && !lo.startsWith("m"))) return "dom13";
  if (lo === "11" || (lo.includes("11") && !lo.startsWith("m"))) return "dom11";
  if (lo === "9"  || (lo.includes("9")  && !lo.startsWith("m"))) return "dom9";
  if (lo === "7"  || lo === "dom7") return "dom7";
  // Catch-all for trailing "7" (e.g. something like "dom7" already handled above)
  if (lo.endsWith("7") && !lo.startsWith("m") && !lo.includes("maj")) return "dom7";

  // ── Minor triad (plain m / min; after all minor extended forms) ──
  if (lo.startsWith("m") || lo.includes("min")) return "minor";

  return "major";
}

// ─── Build pitch class sets from quality ──────────────────────────────────────

type ChordPcSets = {
  pcs: Set<number>;
  colorPcs: number[];      // extensions / alterations beyond the 7th
  omitFifth: boolean;      // true → voicingPcs should drop the perfect 5th
};

function buildSets(rootPc: number, quality: ChordQuality): ChordPcSets {
  const s = new Set<number>([rootPc]);
  const color: number[] = [];
  let omitFifth = false;

  const r = rootPc;

  switch (quality) {
    // ── Triads ──
    case "major":
      add(s, r, 4); add(s, r, 7); break;
    case "minor":
      add(s, r, 3); add(s, r, 7); break;
    case "aug":
      add(s, r, 4); add(s, r, 8); break;
    case "dim":
      add(s, r, 3); add(s, r, 6); break;
    case "sus2":
      add(s, r, 2); add(s, r, 7); break;
    case "sus4":
      add(s, r, 5); add(s, r, 7); break;

    // ── Dominant 7 sus ──
    case "dom7sus4":
      // R, 4, 5, b7  — NO 3rd
      add(s, r, 5); add(s, r, 7); add(s, r, 10); break;
    case "dom9sus4":
      add(s, r, 5); add(s, r, 7); add(s, r, 10);
      add(s, r, 2); color.push(clampPc(r + 2)); break;

    // ── 6th chords ──
    case "maj6":
      add(s, r, 4); add(s, r, 7); add(s, r, 9); break;
    case "m6":
      add(s, r, 3); add(s, r, 7); add(s, r, 9); break;

    // ── add9 ──
    case "add9":
      add(s, r, 4); add(s, r, 7); add(s, r, 2);
      color.push(clampPc(r + 2)); break;
    case "madd9":
      add(s, r, 3); add(s, r, 7); add(s, r, 2);
      color.push(clampPc(r + 2)); break;

    // ── Major 7th family ──
    case "maj7":
      add(s, r, 4); add(s, r, 7); add(s, r, 11); break;
    case "maj9":
      add(s, r, 4); add(s, r, 7); add(s, r, 11); add(s, r, 2);
      color.push(clampPc(r + 2)); break;
    case "maj11":
      add(s, r, 4); add(s, r, 7); add(s, r, 11); add(s, r, 2); add(s, r, 5);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 5));
      omitFifth = true; break;
    case "maj13":
      add(s, r, 4); add(s, r, 7); add(s, r, 11); add(s, r, 2); add(s, r, 5); add(s, r, 9);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 9));
      omitFifth = true; break;

    // ── Dominant 7th family ──
    case "dom7":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); break;
    case "dom9":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2);
      color.push(clampPc(r + 2)); break;
    case "dom11":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 5);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 5));
      omitFifth = true; break;
    case "dom13":
      // Omit 11th (F in C13) to avoid clash — keep 13th (A in C13)
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 9);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 9));
      omitFifth = true; break;
    case "dom7b9":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 1);
      color.push(clampPc(r + 1)); break;  // b9 is the color tone
    case "dom7s9":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 3);
      color.push(clampPc(r + 3)); break;  // #9 is the color tone
    case "dom7s11":
      // Lydian dominant: R, 3, 5, b7, 9, #11
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 6);
      color.push(clampPc(r + 6)); break;  // #11 is the primary color
    case "dom9s11":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 6);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 6)); break;
    case "dom13s11":
      add(s, r, 4); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 6); add(s, r, 9);
      color.push(clampPc(r + 6)); color.push(clampPc(r + 9));
      omitFifth = true; break;
    case "dom7b5":
      add(s, r, 4); add(s, r, 6); add(s, r, 10);
      color.push(clampPc(r + 6)); break;
    case "dom7s5":
      // Augmented dominant (C aug7 / C7#5): R, 3, #5, b7
      add(s, r, 4); add(s, r, 8); add(s, r, 10);
      color.push(clampPc(r + 8)); break;

    // ── Minor 7th family ──
    case "m7":
      add(s, r, 3); add(s, r, 7); add(s, r, 10); break;
    case "m9":
      add(s, r, 3); add(s, r, 7); add(s, r, 10); add(s, r, 2);
      color.push(clampPc(r + 2)); break;
    case "m11":
      // Cm11: R, b3, 5, b7, 9, 11 — 5th is expendable
      add(s, r, 3); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 5);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 5));
      omitFifth = true; break;
    case "m13":
      add(s, r, 3); add(s, r, 7); add(s, r, 10); add(s, r, 2); add(s, r, 5); add(s, r, 9);
      color.push(clampPc(r + 2)); color.push(clampPc(r + 9));
      omitFifth = true; break;

    // ── Half-diminished / m7b5 ──
    case "m7b5":
      // R, b3, b5, b7 — the flat 5th IS the color; don't omit it
      add(s, r, 3); add(s, r, 6); add(s, r, 10);
      color.push(clampPc(r + 6)); break;

    // ── Fully diminished ──
    case "dim7":
      add(s, r, 3); add(s, r, 6); add(s, r, 9); break;

    // ── Minor-major ──
    case "mmaj7":
      add(s, r, 3); add(s, r, 7); add(s, r, 11); break;
    case "mmaj9":
      add(s, r, 3); add(s, r, 7); add(s, r, 11); add(s, r, 2);
      color.push(clampPc(r + 2)); break;

    default:
      add(s, r, 4); add(s, r, 7); break; // major fallback
  }

  return { pcs: s, colorPcs: color, omitFifth };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse a chord symbol string into rootPc, pcs, voicingPcs, colorPcs, bassPc, and name.
 *
 * voicingPcs omits the perfect 5th for 11th/13th chords (the note is expendable there).
 * colorPcs lists alteration/extension tones that should be prioritized in voicing.
 * bassPc is the slash-chord bass note PC, or null for root position.
 */
export function parseChordSymbol(symbolRaw: string): ParsedChord | null {
  const s = (symbolRaw ?? "").trim();
  if (!s) return null;

  // ── 1. Split slash chord: "Cm7/Eb" → main="Cm7", bassStr="Eb"
  let mainStr = s;
  let bassStr: string | null = null;
  const slashIdx = s.indexOf("/");
  if (slashIdx > 0) {
    mainStr = s.slice(0, slashIdx).trim();
    bassStr = s.slice(slashIdx + 1).trim();
  }

  // ── 2. Parse root from mainStr
  const m = mainStr.match(/^([A-Ga-g])([#b]?)(.*)$/);
  if (!m) return null;

  const letter   = m[1]!.toUpperCase();
  const accident = m[2] ?? "";
  const rest     = (m[3] ?? "").trim();

  const rootName = `${letter}${accident}`;
  const rootPc = PC_BY_NAME[rootName];
  if (typeof rootPc !== "number") return null;

  // ── 3. Classify chord quality and build pitch class sets ──
  const quality  = classifyQuality(rest);
  const { pcs: pcsSet, colorPcs, omitFifth } = buildSets(rootPc, quality);

  const allPcs = [...pcsSet];
  const perfectFifthPc = clampPc(rootPc + 7);
  const voicingPcs = omitFifth
    ? allPcs.filter((p) => p !== perfectFifthPc)
    : allPcs;

  // ── 4. Parse bass note (slash chord) ──
  let bassPc: number | null = null;
  if (bassStr) {
    const bp = parseNoteName(bassStr);
    if (typeof bp === "number") bassPc = bp;
  }

  return { rootPc, pcs: allPcs, voicingPcs, colorPcs, bassPc, name: s };
}

// ─── Convenience wrappers ─────────────────────────────────────────────────────

/** Returns all pitch classes for a chord symbol, or null if unrecognised. */
export function chordPcsFromSymbol(symbol: string): number[] | null {
  return parseChordSymbol(symbol)?.pcs ?? null;
}

/** Returns the voicing pitch classes (5th omitted for extended chords). */
export function voicingPcsFromSymbol(symbol: string): number[] | null {
  return parseChordSymbol(symbol)?.voicingPcs ?? null;
}
