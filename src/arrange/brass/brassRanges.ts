// src/arrange/brass/brassRanges.ts
//
// Brass ensemble ranges & playing characteristics, CALIBRATED from three real
// scores: Sousa "The Crusader March" (concert band), Strauss "Also Sprach
// Zarathustra", and Tchaikovsky "1812 Overture".
//
// All MIDI values are CONCERT (sounding) pitch. The MusicXML exporter applies
// written-pitch transposition: Trumpet/Bb +2, Horn in F +7, Euphonium/Trombone/
// Tuba are read in concert (bass clef).
//
// Calibration data (concert, p10–p90 working ranges across the 3 sources):
//   Trumpet (Bb): Sousa Ab3–Gb5 (61–73 lead), 1812 G3–Bb5, Zara C4–C6
//   Horn (F):     Sousa G3–Bb4 (56–66),        1812 Eb2–Db5, Zara G3–C5
//   Trombone:     Sousa Ab2–F4 (49–61),        1812 G2–A4
//   Euphonium:    Sousa Ab2–F4 (49–59) — lyrical tenor brass (73% stepwise)
//   Tuba:         Sousa Ab1–Eb3 (36–46),       1812/Zara C2–C3
//
// Motion is CONTEXT-DEPENDENT (same as woodwinds): trumpets/horns are stepwise
// when carrying a march tune (65–79% steps) but leap heavily in fanfares
// (1812/Zarathustra: 74–87% leaps). The arranger should derive this from the
// melody/harmony, not fix it per instrument.

export type BrassVoiceId = "tpt" | "hn" | "tbn" | "euph" | "tuba";

export type BrassRange = {
  absMin: number;
  absMax: number;
  prefMin: number;
  prefMax: number;
};

// pref = reliable, characteristic register; abs = full practical range.
export const BRASS_RANGES: Record<BrassVoiceId, BrassRange> = {
  tpt:  { absMin: 52, absMax: 86, prefMin: 55, prefMax: 82 }, // E3..D6   pref G3..Bb5 (Bb trumpet, concert)
  hn:   { absMin: 35, absMax: 77, prefMin: 48, prefMax: 72 }, // B1..F5   pref C3..C5  (Horn in F, concert)
  tbn:  { absMin: 40, absMax: 72, prefMin: 43, prefMax: 67 }, // E2..C5   pref G2..G4  (tenor trombone)
  euph: { absMin: 40, absMax: 70, prefMin: 45, prefMax: 65 }, // E2..Bb4  pref A2..F4  (euphonium — lyrical tenor)
  tuba: { absMin: 24, absMax: 55, prefMin: 28, prefMax: 53 }, // C1..G3   pref E1..F3  (bass foundation)
};

export type BrassCharacter = {
  /** 0–1 technical agility for fast passagework. */
  agility: number;
  role: string;
  sweetSpot: string;
};

// Calibrated/Adler-informed. Trumpet & Euphonium most agile; Horn lyrical but
// less nimble; Trombone moderate (slide); Tuba foundational.
export const BRASS_CHARACTER: Record<BrassVoiceId, BrassCharacter> = {
  tpt:  { agility: 0.9,  role: "lead melody / fanfare",            sweetSpot: "G4–G5" },
  hn:   { agility: 0.55, role: "noble melody / harmonic fill",     sweetSpot: "C3–G4" },
  tbn:  { agility: 0.5,  role: "harmony / tenor-bass (slide)",     sweetSpot: "G2–Bb3" },
  euph: { agility: 0.8,  role: "lyrical tenor melody",             sweetSpot: "A2–F4" },
  tuba: { agility: 0.45, role: "bass foundation",                  sweetSpot: "E1–D3" },
};

// Brass quintet voice order (top→bottom) and the string-DP slot each maps to
// (for when the brass arranger reuses the string/woodwind DP machinery).
//   Trumpet1 → vln1, Trumpet2/Horn → vln2/vla, Trombone → vc, Tuba → cb
export const BRASS_QUINTET_VOICES: BrassVoiceId[] = ["tpt", "hn", "tbn", "euph", "tuba"];
