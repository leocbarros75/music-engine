// src/arrange/brass/brassRanges.ts
//
// Brass quintet ranges, characteristics and DP voice mapping — calibrated from
// three real scores: Sousa "The Crusader March" (concert band), Strauss
// "Also Sprach Zarathustra", and Tchaikovsky "1812 Overture".
//
// Standard brass quintet: Trumpet 1, Trumpet 2, Horn in F, Trombone, Tuba.
// All MIDI values are CONCERT (sounding) pitch — the MusicXML exporter applies
// written-pitch transposition (Trumpet/Bb +2, Horn in F +7; Trombone/Tuba read
// in concert bass clef).
//
// Calibration (concert, p10–p90 working ranges across the 3 orchestral/band
// sources + 3 real brass QUINTETS — Godfather, Chattanooga, St. Louis Blues):
//   Trumpet 1 63–77, Trumpet 2 60–74, Horn 56–69, Trombone 51–63, Tuba 31–45
//   (quintet, chamber). Orchestral/band confirm the same with wider extremes.
//   Motion: chamber quintet voices are balanced & moderately stepwise (43–49%);
//   march trumpets stepwise (65–79%); fanfares leap-heavy (74–87%) — derive
//   from the melody/harmony. The pref ranges below bracket all sources.

export type BrassVoiceId = "tpt1" | "tpt2" | "hn" | "tbn" | "tuba";

export type BrassRange = { absMin: number; absMax: number; prefMin: number; prefMax: number };

// pref = reliable/characteristic register; abs = full practical range (concert).
export const BRASS_RANGES: Record<BrassVoiceId, BrassRange> = {
  tpt1: { absMin: 52, absMax: 86, prefMin: 57, prefMax: 82 }, // E3..D6  pref A3..Bb5
  tpt2: { absMin: 52, absMax: 84, prefMin: 55, prefMax: 79 }, // E3..C6  pref G3..G5
  hn:   { absMin: 35, absMax: 77, prefMin: 48, prefMax: 72 }, // B1..F5  pref C3..C5
  tbn:  { absMin: 40, absMax: 72, prefMin: 43, prefMax: 67 }, // E2..C5  pref G2..G4
  tuba: { absMin: 26, absMax: 58, prefMin: 31, prefMax: 53 }, // D1..Bb3 pref G1..F3
};

export type BrassCharacter = {
  agility: number;           // 0–1 technical agility for fast passagework
  defaultActivity: "grounded" | "less_active" | "active" | "high_active";
  role: string;
  sweetSpot: string;
};

export const BRASS_CHARACTER: Record<BrassVoiceId, BrassCharacter> = {
  tpt1: { agility: 0.9,  defaultActivity: "active",      role: "lead melody / fanfare",        sweetSpot: "G4–G5" },
  tpt2: { agility: 0.9,  defaultActivity: "active",      role: "2nd melody / harmony",          sweetSpot: "E4–E5" },
  hn:   { agility: 0.55, defaultActivity: "less_active", role: "noble inner voice / harmony",   sweetSpot: "C3–G4" },
  tbn:  { agility: 0.5,  defaultActivity: "less_active", role: "tenor-bass harmony (slide)",    sweetSpot: "G2–Bb3" },
  tuba: { agility: 0.45, defaultActivity: "grounded",    role: "bass foundation",               sweetSpot: "G1–D3" },
};

// Brass voice → string-DP slot (the brass arranger reuses the string/woodwind DP).
export const BRASS_TO_STRING_VOICE: Record<BrassVoiceId, "vln1" | "vln2" | "vla" | "vc" | "cb"> = {
  tpt1: "vln1",
  tpt2: "vln2",
  hn:   "vla",
  tbn:  "vc",
  tuba: "cb",
};

export const BRASS_PART_META: Record<BrassVoiceId, { part_id: string; name: string; instrument: string }> = {
  tpt1: { part_id: "P_TP1", name: "Trumpet 1",   instrument: "trumpet_bb_1" },
  tpt2: { part_id: "P_TP2", name: "Trumpet 2",   instrument: "trumpet_bb_2" },
  hn:   { part_id: "P_HN",  name: "Horn in F",   instrument: "horn_f"       },
  tbn:  { part_id: "P_TBN", name: "Trombone",    instrument: "trombone"     },
  tuba: { part_id: "P_TUBA",name: "Tuba",        instrument: "tuba_c"       },
};

/** Brass quartet (Tpt1/Tpt2/Trombone/Tuba — no horn) and quintet (with horn). */
export const BRASS_QUARTET_VOICES: BrassVoiceId[] = ["tpt1", "tpt2", "tbn", "tuba"];
export const BRASS_QUINTET_VOICES: BrassVoiceId[] = ["tpt1", "tpt2", "hn", "tbn", "tuba"];
