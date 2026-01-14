// src/harmony/key/keyFromSignature.ts

type Mode = "major" | "minor";

export type KeySigResult = {
  tonic: string;
  mode: Mode;
  confidence: number;
  source: "key_signature";
};

type ScoreModelLike = {
  parts?: Array<{
    measures?: Array<{
      attributes?: {
        key?: { fifths?: number; mode?: string };
      };
    }>;
  }>;
};

function normalizeMode(x: unknown): Mode | null {
  if (typeof x !== "string") return null;
  const m = x.trim().toLowerCase();
  if (m === "major") return "major";
  if (m === "minor") return "minor";
  // MusicXML sometimes uses "minor" only, but just in case:
  if (m === "ionian") return "major";
  if (m === "aeolian") return "minor";
  return null;
}

// Circle-of-fifths mapping for major keys by fifths count.
// fifths: -7..+7
const FIFTHS_TO_MAJOR_TONIC: Record<number, string> = {
  "-7": "Cb",
  "-6": "Gb",
  "-5": "Db",
  "-4": "Ab",
  "-3": "Eb",
  "-2": "Bb",
  "-1": "F",
  "0": "C",
  "1": "G",
  "2": "D",
  "3": "A",
  "4": "E",
  "5": "B",
  "6": "F#",
  "7": "C#"
};

// Natural relative minor of each major tonic (same key signature).
const MAJOR_TO_RELATIVE_MINOR: Record<string, string> = {
  Cb: "Ab",
  Gb: "Eb",
  Db: "Bb",
  Ab: "F",
  Eb: "C",
  Bb: "G",
  F: "D",
  C: "A",
  G: "E",
  D: "B",
  A: "F#",
  E: "C#",
  B: "G#",
  "F#": "D#",
  "C#": "A#"
};

export function keyFromScoreSignature(scoreModel: unknown): KeySigResult | null {
  const sm = scoreModel as ScoreModelLike;

  const parts = sm.parts ?? [];
  for (const part of parts) {
    const measures = part.measures ?? [];
    for (const m of measures) {
      const key = m.attributes?.key;
      if (!key) continue;

      const fifths = typeof key.fifths === "number" ? key.fifths : null;
      if (fifths === null) continue;

      const mode = normalizeMode(key.mode) ?? "major";

      const majorTonic = FIFTHS_TO_MAJOR_TONIC[fifths];
      if (!majorTonic) continue;

      const tonic = mode === "major" ? majorTonic : (MAJOR_TO_RELATIVE_MINOR[majorTonic] ?? majorTonic);

      return {
        tonic,
        mode,
        confidence: 0.99,
        source: "key_signature"
      };
    }
  }

  return null;
}