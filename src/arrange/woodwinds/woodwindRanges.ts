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
// Flute:        C4–D7   pref D4–C6    (lower octave is the warm register)
// Oboe:         Bb3–A6  pref C4–F5    (sweet spot; extreme upper avoided)
// Clarinet Bb:  D3–Bb6  pref E3–G5    (concert sounding; whole step below written)
// Horn in F:    B1–F5   pref G2–C5    (concert sounding; P5 below written)
// Bassoon:      Bb1–E5  pref C2–Eb4   (practical limit)
export const WOODWIND_RANGES: Record<WoodwindVoiceId, WoodwindRange> = {
  fl: { absMin: 60, absMax: 98, prefMin: 62, prefMax: 84 }, // C4..D7   pref D4..C6
  ob: { absMin: 58, absMax: 93, prefMin: 60, prefMax: 77 }, // Bb3..A6  pref C4..F5
  cl: { absMin: 50, absMax: 90, prefMin: 52, prefMax: 79 }, // D3..Bb6  pref E3..G5 (concert)
  hn: { absMin: 35, absMax: 77, prefMin: 43, prefMax: 72 }, // B1..F5   pref G2..C5 (concert)
  bn: { absMin: 34, absMax: 74, prefMin: 36, prefMax: 63 }, // Bb1..D5  pref C2..Eb4
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
