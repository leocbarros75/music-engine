// src/arrange/woodwinds/woodwindRanges.ts
//
// Sounding (concert) pitch ranges for woodwind quartet.
// All MIDI values are concert pitch — the MusicXML exporter handles
// transposition for Bb clarinet (+2 semitones written vs sounding).
//
// Sources: Adler "Study of Orchestration" 3rd ed., Reed & Leach "Scoring for Percussion"
// and practical orchestration references (Gardner Read "Thesaurus of Orchestral Devices").

export type WoodwindVoiceId = "fl" | "ob" | "cl" | "bn";

export type WoodwindRange = {
  absMin: number;  // hard floor — never generate notes below this
  absMax: number;  // hard ceiling
  prefMin: number; // soft preferred floor (DP tessitura penalty below this)
  prefMax: number; // soft preferred ceiling
};

// Ranges represent sounding (concert) pitches.
// Flute:        C4–D7   pref D4–C6    (lower octave is the warm "chalumeau-like" register)
// Oboe:         Bb3–A6  pref C4–F5    (sweet spot C4–F5; extreme upper avoided)
// Clarinet Bb:  D3–Bb6  pref E3–G5    (concert sounding; Bb is a whole step lower than written)
// Bassoon:      Bb1–E5  pref C2–Eb4   (practical limit; extreme high only for soloists)
export const WOODWIND_RANGES: Record<WoodwindVoiceId, WoodwindRange> = {
  fl: { absMin: 60, absMax: 98, prefMin: 62, prefMax: 84 }, // C4..D7  pref D4..C6
  ob: { absMin: 58, absMax: 93, prefMin: 60, prefMax: 77 }, // Bb3..A6 pref C4..F5
  cl: { absMin: 50, absMax: 90, prefMin: 52, prefMax: 79 }, // D3..Bb6 pref E3..G5 (concert)
  bn: { absMin: 34, absMax: 74, prefMin: 36, prefMax: 63 }, // Bb1..D5 pref C2..Eb4
};

// Maps the four woodwind voices onto string DP voice IDs.
// The DP generates voicings labelled vln1/vln2/vla/vc/cb; we reuse those labels
// internally and rename to woodwind parts after the DP finishes.
//
// Bassoon maps to "cb" (not "vc") so buildCandidatesForSlice enforces the
// chord-root / bass-note preference for the lowest voice — the same logic that
// keeps the Double Bass grounded in the bass register.
export const WOODWIND_TO_STRING_VOICE: Record<WoodwindVoiceId, "vln1" | "vln2" | "vla" | "vc" | "cb"> = {
  fl: "vln1",
  ob: "vln2",
  cl: "vla",
  bn: "cb",   // ← root/bass preference; keeps bassoon in its characteristic register
};

// Woodwind part metadata for the score model
export const WOODWIND_PART_META: Record<
  WoodwindVoiceId,
  { part_id: string; name: string; instrument: string }
> = {
  fl: { part_id: "P_FL", name: "Flute",          instrument: "flute"        },
  ob: { part_id: "P_OB", name: "Oboe",           instrument: "oboe"         },
  cl: { part_id: "P_CL", name: "Clarinet in Bb", instrument: "clarinet_bb"  },
  bn: { part_id: "P_BN", name: "Bassoon",        instrument: "bassoon"      },
};
