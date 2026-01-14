// src/harmony/borrowed.ts

type KeyLike = {
  tonic: string; // e.g. "C"
  mode: "major" | "minor";
  confidence?: number;
};

type BorrowedHint = {
  measureNumber: number;
  beatNumber?: number;
  chordName: string;
  chordQuality: string;
  rootPc: number | null;
  suggestedRoman: string;
  reason: string;
};

function pcName(pc: number): string {
  const names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  return names[((pc % 12) + 12) % 12] ?? "C";
}

// Map tonic name -> pitch class
function tonicToPc(tonic: string): number | null {
  const t = (tonic ?? "").trim().toUpperCase();
  const map: Record<string, number> = {
    C: 0,
    "C#": 1,
    DB: 1,
    D: 2,
    "D#": 3,
    EB: 3,
    E: 4,
    F: 5,
    "F#": 6,
    GB: 6,
    G: 7,
    "G#": 8,
    AB: 8,
    A: 9,
    "A#": 10,
    BB: 10,
    B: 11
  };
  return map[t] ?? null;
}

function relPc(rootPc: number, tonicPc: number): number {
  return ((rootPc - tonicPc) % 12 + 12) % 12;
}

/**
 * Very conservative mixture hints.
 * We do NOT change your roman output here.
 * We only add "borrowedHints" as an optional annotation for debugging and later upgrades.
 */
export function borrowedChordHint(params: {
  key: KeyLike;
  chord: any; // detectChordFromPcs output
  measureNumber: number;
  beatNumber?: number;
}): BorrowedHint | null {
  const { key, chord, measureNumber, beatNumber } = params;

  const tonicPc = tonicToPc(key?.tonic);
  if (tonicPc === null) return null;

  const rootPc: number | null = typeof chord?.rootPc === "number" ? chord.rootPc : null;
  const quality = String(chord?.quality ?? "unknown");
  const chordName = String(chord?.name ?? (rootPc === null ? "?" : pcName(rootPc)));

  if (rootPc === null) return null;

  const r = relPc(rootPc, tonicPc);

  // Key = MAJOR. Common borrowed chords: iv, bVI, bVII, bII (Neapolitan-ish)
  if (key.mode === "major") {
    // iv: root = 5 (F in C), quality minor
    if (r === 5 && quality === "min") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "iv",
        reason: "Minor subdominant (iv) borrowed from parallel minor."
      };
    }

    // bVI: root = 8 (Ab in C), quality major
    if (r === 8 && quality === "maj") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "bVI",
        reason: "Flat VI (bVI) borrowed from parallel minor."
      };
    }

    // bVII: root = 10 (Bb in C), quality major (or dom7 sometimes)
    if (r === 10 && (quality === "maj" || quality === "dom7")) {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "bVII",
        reason: "Flat VII (bVII) borrowed from mixolydian / parallel minor usage."
      };
    }

    // bII: root = 1 (Db in C), usually major
    if (r === 1 && quality === "maj") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "bII",
        reason: "Neapolitan-like color (bII major) in a major key."
      };
    }

    return null;
  }

  // Key = MINOR. Common borrowed chords: IV, bII, VI (major), etc.
  if (key.mode === "minor") {
    // IV in minor: root = 5 (D in A minor? careful: A minor tonicPc=9, r=5 => D)
    // In A minor, IV is D major (quality maj)
    if (r === 5 && quality === "maj") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "IV",
        reason: "Major IV in minor (often melodic/harmonic minor mixture)."
      };
    }

    // bII in minor (Neapolitan): r = 1, usually maj
    if (r === 1 && quality === "maj") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "bII",
        reason: "Neapolitan (bII major) in minor."
      };
    }

    // VI major in minor: r = 8, quality maj (F in A minor)
    if (r === 8 && quality === "maj") {
      return {
        measureNumber,
        beatNumber,
        chordName,
        chordQuality: quality,
        rootPc,
        suggestedRoman: "VI",
        reason: "Major VI is common diatonic in natural minor."
      };
    }

    return null;
  }

  return null;
}