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
//
// These are EDITORIAL ranges and must narrow the instrument catalog, never
// widen it: the catalog says what the instrument can play, this table says how
// much of that we choose to write. Where an arranger clamps against both — the
// piano-copy paths do — a table that claims more than the catalog allows is
// simply a lie about what the code does, and it hides real bugs. The
// trombone's ceiling used to read C5 while the catalog capped it at Bb4, so a
// rule written against C5 could never fire and looked correct for it.
// `brassRanges.test.ts` now fails if any of these steps outside the catalog.
export const BRASS_RANGES: Record<BrassVoiceId, BrassRange> = {
  tpt1: { absMin: 52, absMax: 86, prefMin: 57, prefMax: 82 }, // E3..D6  pref A3..Bb5
  tpt2: { absMin: 52, absMax: 84, prefMin: 55, prefMax: 79 }, // E3..C6  pref G3..G5
  hn:   { absMin: 35, absMax: 77, prefMin: 48, prefMax: 72 }, // B1..F5  pref C3..C5
  tbn:  { absMin: 40, absMax: 70, prefMin: 43, prefMax: 67 }, // E2..Bb4 pref G2..G4
  tuba: { absMin: 26, absMax: 58, prefMin: 31, prefMax: 53 }, // D1..Bb3 pref G1..F3
};


/**
 * Where each voice actually lives, as MIDI — the documented sweet spot in a
 * form the code can use.
 *
 * `BRASS_CHARACTER.sweetSpot` has always carried this ("G4–G5" for the first
 * trumpet) and nothing has ever read it: placement used prefMin/prefMax, which
 * run far wider and far lower. A first trumpet whose preferred range starts at
 * A3 will happily sit there if the voicing it inherits is low, and ours did —
 * 58 to 70 against 74 to 79 in a hand-written edition of the same song. In
 * range, and nowhere near the register the instrument is for.
 */
/*
 * Two of these came from the textbook and did not survive measurement.
 *
 * They were read off BRASS_CHARACTER.sweetSpot — the register each instrument
 * is documented to live in. Against the hand-written brass edition of this song
 * (`outputs/washed-brass-auto/`), whose actual SOUNDING registers are
 * Trumpet 1 66-76, Trumpet 2 54-76, Horn 1 54-71, Horn 2 54-64,
 * Trombone 1 42-66, Trombone 2 47-54, Bass Trombone 42-47 and Tuba 30-40:
 *
 *   The horn was six semitones too low. "C3-G4" is the noble middle register in
 *   the abstract, but a horn carrying lines in a section sits higher, and ours
 *   got pulled down an octave once the placement rule stopped being vetoed by
 *   stray notes — 35-64 sounding against that edition's 54-71.
 *
 *   The tuba was ten too high at the top. "G1-D3" let its median settle at 44
 *   against the edition's 35: D3 is a tuba note but not where a bass line
 *   lives, and the error propagated, since the derived bass trombone keeps its
 *   clearance above the tuba and so had nowhere to sit.
 *
 * The trumpets and the trombone already agreed with the measurement and are
 * untouched.
 */
export const BRASS_SWEET_SPOT: Record<BrassVoiceId, { lo: number; hi: number }> = {
  tpt1: { lo: 67, hi: 79 },  // G4–G5
  tpt2: { lo: 64, hi: 76 },  // E4–E5
  hn:   { lo: 54, hi: 71 },  // F#3–B4 — measured, not C3–G4
  tbn:  { lo: 43, hi: 58 },  // G2–Bb3
  tuba: { lo: 30, hi: 42 },  // F#1–F#2 — a bass line, not up to D3
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
