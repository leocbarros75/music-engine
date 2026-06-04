// src/arrange/woodwinds/woodwindRanges.ts
//
// Sounding (concert) pitch ranges for woodwind quartet.
// All MIDI values are concert pitch — the MusicXML exporter handles
// transposition for Bb clarinet (+2 semitones written vs sounding).
//
// Sources: Adler "Study of Orchestration" 3rd ed., Reed & Leach "Scoring for Percussion"
// and practical orchestration references (Gardner Read "Thesaurus of Orchestral Devices").

/** Quartet: Fl / Ob / Cl Bb / Bn.  Quintet adds Horn in F between Cl and Bn. */
export type WoodwindVoiceId = "fl" | "ob" | "cl" | "hn" | "bn";

export type WoodwindRange = {
  absMin: number;  // hard floor — never generate notes below this
  absMax: number;  // hard ceiling
  prefMin: number; // soft preferred floor (DP tessitura penalty below this)
  prefMax: number; // soft preferred ceiling
};

// Ranges represent sounding (concert) pitches.
// Preferred (pref) ranges = each instrument's reliable, best-sounding register
// per Adler/Forsyth/Rimsky-Korsakov. The DP applies a tessitura penalty outside
// pref, steering melodic content into the sweet spot while still allowing the
// full absolute range for color.
//
// Flute:       C4–D7   pref G4–E6   (low C4–F#4 weak/breathy → penalised; strong from G4 up)
// Oboe:        Bb3–A6  pref D4–E5   (plaintive singing register; extreme high pinched)
// Clarinet Bb: D3–Bb6  pref D3–C6   (versatile: chalumeau + clarion both excellent)
// Horn in F:   B1–F5   pref C3–C5   (noble middle register; low B1–B2 risky, high tiring)
// Bassoon:     Bb1–E5  pref C2–C4   (foundation + warm tenor singing register)
// pref ranges validated against THREE real scores — Elgar clarinet quartet,
// string-quartet-arr.-for-wind-quintet, and Tchaikovsky 1812 Overture (422 mm).
// p10–p90 working ranges (union across all three):
//   Flute 65–89  Oboe 61–81  Clarinet 58–79  Bassoon 36–62
export const WOODWIND_RANGES: Record<WoodwindVoiceId, WoodwindRange> = {
  fl: { absMin: 60, absMax: 98, prefMin: 65, prefMax: 88 }, // C4..D7   pref F4..E6  (3-source p10=65 p90=89)
  ob: { absMin: 58, absMax: 93, prefMin: 61, prefMax: 79 }, // Bb3..A6  pref Db4..G5 (3-source p10=61 p90=81)
  cl: { absMin: 50, absMax: 90, prefMin: 55, prefMax: 79 }, // D3..Bb6  pref G3..G5  (3-source p10=58 p90=79)
  hn: { absMin: 35, absMax: 77, prefMin: 48, prefMax: 72 }, // B1..F5   pref C3..C5  (noble middle register, Adler)
  bn: { absMin: 34, absMax: 74, prefMin: 36, prefMax: 62 }, // Bb1..D5  pref C2..D4  (3-source p10=36 p90=62)
};

// ── Per-instrument playing characteristics (from the orchestration texts) ────
// Used to assign idiomatic roles & default activity in the auto arranger.
export type WoodwindCharacter = {
  /** 0–1 technical agility for fast passagework (Flute/Clarinet highest, Horn lowest). */
  agility: number;
  /** Default melodic activity level matching the instrument's idiom. */
  defaultActivity: "grounded" | "less_active" | "active" | "high_active";
  /** One-line idiomatic role. */
  role: string;
  /** Sweet-spot register description (concert pitch). */
  sweetSpot: string;
};

// Agility calibrated against real woodwind ensemble scores, where EVERY voice
// (including bassoon) plays 85–97% notes shorter than a quarter. The flute,
// oboe, clarinet and bassoon are all highly active in real writing; only the
// Horn is idiomatically a sustained pad. So only the Horn is rhythmically
// thinned — the others follow the source rhythm fully.
//   Real motion data: bassoon leaps 38–65% (foundation), upper voices step more.
export const WOODWIND_CHARACTER: Record<WoodwindVoiceId, WoodwindCharacter> = {
  fl: { agility: 1.0,  defaultActivity: "active",      role: "agile melody / brilliant passagework",   sweetSpot: "D5–A6" },
  ob: { agility: 0.85, defaultActivity: "active",      role: "lyrical melody / active inner voice",     sweetSpot: "Eb4–D5" },
  cl: { agility: 0.95, defaultActivity: "active",      role: "flexible — agile lines or warm color",    sweetSpot: "B4–C6 clarion / D3–F4 chalumeau" },
  hn: { agility: 0.30, defaultActivity: "grounded",    role: "sustained harmony pad / noble tune",      sweetSpot: "C3–G4" },
  bn: { agility: 0.85, defaultActivity: "active",      role: "active foundation / staccato / tenor",    sweetSpot: "G2–C4" },
};

// Maps woodwind voices onto string DP voice IDs (used by buildCandidatesForSlice).
// Bassoon maps to "cb" for chord-root / bass-note preference.
// Horn maps to "vc" — inner voice between clarinet and bassoon.
export const WOODWIND_TO_STRING_VOICE: Record<WoodwindVoiceId, "vln1" | "vln2" | "vla" | "vc" | "cb"> = {
  fl: "vln1",
  ob: "vln2",
  cl: "vla",
  hn: "vc",   // inner lower-middle voice
  bn: "cb",   // root/bass preference
};

// Woodwind part metadata for the score model
export const WOODWIND_PART_META: Record<
  WoodwindVoiceId,
  { part_id: string; name: string; instrument: string }
> = {
  fl: { part_id: "P_FL", name: "Flute",          instrument: "flute"        },
  ob: { part_id: "P_OB", name: "Oboe",           instrument: "oboe"         },
  cl: { part_id: "P_CL", name: "Clarinet in Bb", instrument: "clarinet_bb"  },
  hn: { part_id: "P_HN", name: "Horn in F",      instrument: "horn_f"       },
  bn: { part_id: "P_BN", name: "Bassoon",        instrument: "bassoon"      },
};

/** Ordered voice list for quartet (no horn). */
export const QUARTET_VOICES:  WoodwindVoiceId[] = ["fl", "ob", "cl", "bn"];
/** Ordered voice list for quintet (with horn). */
export const QUINTET_VOICES: WoodwindVoiceId[] = ["fl", "ob", "cl", "hn", "bn"];
