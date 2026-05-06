// src/harmonize/satb/chordSymbol.ts
// Full jazz chord parser: triads, 7ths, extensions (9/11/13), alterations (#11, b9, b5, #5),
// slash inversions, and all standard jazz symbol variants.

export type ParsedChord = {
  rootPc: number;       // 0..11 — root pitch class
  pcs: number[];        // all chord pitch classes (unordered, deduplicated)
  bassPc: number | null; // slash-chord bass note PC (null = root position)
  name: string;         // original symbol string
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

function clampPc(x: number): number {
  const v = x % 12;
  return v < 0 ? v + 12 : v;
}

function add(pcs: Set<number>, root: number, semitones: number): void {
  pcs.add(clampPc(root + semitones));
}

// Parse a note name (e.g. "Eb", "F#", "G") into a pitch class 0..11.
// Returns null if unrecognised.
function parseNoteName(s: string): number | null {
  // Handle 2-char first (C# before C, Bb before B, etc.)
  const two = s.slice(0, 2);
  if (PC_BY_NAME[two] !== undefined) return PC_BY_NAME[two]!;
  const one = s.slice(0, 1).toUpperCase();
  if (PC_BY_NAME[one] !== undefined) return PC_BY_NAME[one]!;
  return null;
}

// ─── Chord quality classifier ─────────────────────────────────────────────────
// Receives the part of the symbol AFTER the root (e.g. "maj7", "m7b5", "7#11").

type ChordQuality =
  | "major"           // C
  | "minor"           // Cm
  | "aug"             // Caug
  | "dim"             // Cdim
  | "sus2"            // Csus2
  | "sus4"            // Csus4 / Csus
  | "maj7"            // Cmaj7
  | "maj9"            // Cmaj9
  | "maj11"           // Cmaj11
  | "maj13"           // Cmaj13
  | "dom7"            // C7
  | "dom9"            // C9
  | "dom11"           // C11
  | "dom13"           // C13
  | "dom7b9"          // C7b9
  | "dom7s9"          // C7#9
  | "dom7s11"         // C7#11
  | "dom7b5"          // C7b5
  | "dom7s5"          // C7#5 / C7aug
  | "dom9s11"         // C9#11
  | "m7"              // Cm7
  | "m9"              // Cm9
  | "m11"             // Cm11
  | "m13"             // Cm13
  | "m7b5"            // Cm7b5 / Cø7
  | "dim7"            // Cdim7 / C°7
  | "m6"              // Cm6
  | "maj6"            // C6
  | "mmaj7"           // CmMaj7 (minor-major 7th)
  | "mmaj9";          // CmMaj9

function classifyQuality(rest: string): ChordQuality {
  const r = rest.trim();
  const lo = r.toLowerCase();

  // Half-diminished (m7b5): must come before generic m7 and dim checks
  if (lo.includes("m7b5") || lo.includes("m7♭5") || lo === "ø7" || lo === "ø" ||
      lo.includes("halfdim") || lo.includes("half-dim") || r.includes("Ø7")) {
    return "m7b5";
  }

  // Diminished 7th: fully diminished (dim7 / °7)
  if (lo.includes("dim7") || r.includes("°7")) return "dim7";

  // Minor-major 7th (mMaj7, mM7)
  if (lo.includes("mmaj7") || lo.includes("mma7") || lo.includes("m(maj7)") ||
      lo.includes("minmaj7") || lo.includes("m△7")) {
    return "mmaj7";
  }
  if (lo.includes("mmaj9") || lo.includes("mma9") || lo.includes("m(maj9)")) {
    return "mmaj9";
  }

  // Major extended
  if (lo.includes("maj13") || lo.includes("ma13") || lo.includes("△13")) return "maj13";
  if (lo.includes("maj11") || lo.includes("ma11") || lo.includes("△11")) return "maj11";
  if (lo.includes("maj9") || lo.includes("ma9") || lo.includes("△9")) return "maj9";
  if (lo.includes("maj7") || lo.includes("ma7") || lo.includes("△7") || lo.includes("△")) return "maj7";
  if (lo.includes("maj6")) return "maj6";  // Cmaj6 (treat as C6)

  // Augmented
  if (lo.includes("aug") || lo === "+") return "aug";

  // Sus
  if (lo.includes("sus2")) return "sus2";
  if (lo.includes("sus4") || lo === "sus") return "sus4";

  // Minor extended (must check before generic minor / dom7)
  if (lo.includes("m13") || lo.includes("min13")) return "m13";
  if (lo.includes("m11") || lo.includes("min11")) return "m11";
  if (lo.includes("m9") || lo.includes("min9")) return "m9";
  if (lo.includes("m7") || lo.includes("min7")) return "m7";
  if (lo.includes("m6") || lo.includes("min6")) return "m6";

  // Diminished triad (plain dim — comes after dim7)
  if (lo.includes("dim") || r.includes("°")) return "dim";

  // Dominant extended / altered — ordered most specific → least
  if (lo.includes("9#11") || lo.includes("9♯11")) return "dom9s11";
  if (lo.includes("7#11") || lo.includes("7♯11") || lo.includes("7(#11)") ||
      lo.includes("lyd") || lo.includes("lydian")) return "dom7s11";
  if (lo.includes("7b9") || lo.includes("7♭9")) return "dom7b9";
  if (lo.includes("7#9") || lo.includes("7♯9")) return "dom7s9";
  if (lo.includes("7b5") || lo.includes("7♭5")) return "dom7b5";
  if (lo.includes("7#5") || lo.includes("7♯5") || lo.includes("7aug")) return "dom7s5";
  if (lo === "13" || lo.includes("13")) return "dom13";
  if (lo === "11" || lo.includes("11")) return "dom11";
  if (lo === "9"  || lo.includes("9")) return "dom9";
  if (lo === "7"  || lo.endsWith("7") || lo.includes("dom7")) return "dom7";

  // Minor triad (plain m / min) — after all minor extended
  if (lo.startsWith("m") || lo.includes("min")) return "minor";

  // 6th chords
  if (lo === "6" || lo.includes("add6") || lo.includes("add 6")) return "maj6";

  // add2 / add9
  if (lo.includes("add2") || lo.includes("add9") || lo === "2" || lo === "9(no7)") return "major"; // treat as major + colour

  return "major";
}

// ─── Build pitch class set from quality ──────────────────────────────────────

function pcsForQuality(rootPc: number, quality: ChordQuality): number[] {
  const s = new Set<number>([rootPc]);

  switch (quality) {
    case "major":
      add(s, rootPc, 4); add(s, rootPc, 7);
      break;
    case "minor":
      add(s, rootPc, 3); add(s, rootPc, 7);
      break;
    case "aug":
      add(s, rootPc, 4); add(s, rootPc, 8);
      break;
    case "dim":
      add(s, rootPc, 3); add(s, rootPc, 6);
      break;
    case "sus2":
      add(s, rootPc, 2); add(s, rootPc, 7);
      break;
    case "sus4":
      add(s, rootPc, 5); add(s, rootPc, 7);
      break;

    // ── Major 7th family ──
    case "maj7":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 11);
      break;
    case "maj9":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 11); add(s, rootPc, 2);
      break;
    case "maj11":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 11); add(s, rootPc, 2); add(s, rootPc, 5);
      break;
    case "maj13":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 11); add(s, rootPc, 2); add(s, rootPc, 5); add(s, rootPc, 9);
      break;
    case "maj6":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 9);
      break;

    // ── Dominant 7th family ──
    case "dom7":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10);
      break;
    case "dom9":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2);
      break;
    case "dom11":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 5);
      break;
    case "dom13":
      // C13: C E G Bb D A (omit 11th/F as per jazz convention to avoid clash)
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 9);
      break;
    case "dom7b9":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 1); // b9 = +13 = +1
      break;
    case "dom7s9":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 3); // #9 = +15 = +3
      break;
    case "dom7s11":
      // Lydian dominant: C E G Bb D F# (9 + #11, omit natural 5th or keep)
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 6);
      break;
    case "dom9s11":
      add(s, rootPc, 4); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 6);
      break;
    case "dom7b5":
      add(s, rootPc, 4); add(s, rootPc, 6); add(s, rootPc, 10);
      break;
    case "dom7s5":
      add(s, rootPc, 4); add(s, rootPc, 8); add(s, rootPc, 10);
      break;

    // ── Minor 7th family ──
    case "m7":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 10);
      break;
    case "m9":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2);
      break;
    case "m11":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 5);
      break;
    case "m13":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 10); add(s, rootPc, 2); add(s, rootPc, 5); add(s, rootPc, 9);
      break;
    case "m6":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 9);
      break;

    // ── Half-diminished (m7b5 / ø7) ──
    case "m7b5":
      add(s, rootPc, 3); add(s, rootPc, 6); add(s, rootPc, 10);
      break;

    // ── Fully diminished 7th (dim7 / °7) ──
    // Stack minor 3rds: root + 3 + 6 + 9
    case "dim7":
      add(s, rootPc, 3); add(s, rootPc, 6); add(s, rootPc, 9);
      break;

    // ── Minor-major 7th ──
    case "mmaj7":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 11);
      break;
    case "mmaj9":
      add(s, rootPc, 3); add(s, rootPc, 7); add(s, rootPc, 11); add(s, rootPc, 2);
      break;

    default:
      // Fallback: major triad
      add(s, rootPc, 4); add(s, rootPc, 7);
  }

  return [...s];
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Parse a chord symbol string into rootPc, pcs, bassPc, and name.
 *
 * Supports:
 *   Triads:        C  Cm  Caug  Cdim  Csus2  Csus4
 *   7ths:          Cmaj7  C7  Cm7  Cm7b5  Cdim7  CmMaj7
 *   Extensions:    Cmaj9  Cmaj11  Cmaj13
 *                  C9  C11  C13  C7#11  C7b9  C7#9
 *                  Cm9  Cm11  Cm13
 *   Inversions:    C/E  Cm7/Bb  Cmaj9/G  (any slash chord)
 *   Alternates:    Cø7  C°7  CΔ7  CΔ  CΔ9
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

  // ── 3. Classify chord quality from rest
  const quality = classifyQuality(rest);

  // ── 4. Build pitch class set
  const pcs = pcsForQuality(rootPc, quality);

  // ── 5. Parse bass note (slash chord)
  let bassPc: number | null = null;
  if (bassStr) {
    const bp = parseNoteName(bassStr);
    if (typeof bp === "number") bassPc = bp;
  }

  return { rootPc, pcs, bassPc, name: s };
}

// ─── Convenience: get PCs loosely (null-safe) ────────────────────────────────

/**
 * Returns the pitch classes for a chord symbol, or null if unrecognised.
 * Always returns an array; never throws.
 */
export function chordPcsFromSymbol(symbol: string): number[] | null {
  const p = parseChordSymbol(symbol);
  return p ? p.pcs : null;
}
