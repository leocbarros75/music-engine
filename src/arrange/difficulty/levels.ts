import { getInstrumentSpec } from "../../instruments/instrumentCatalog";

/**
 * How hard a part is allowed to be, per player.
 *
 * The setting already existed — it is in the web UI, survives
 * `normalizeAppSettings`, and is handed to about a dozen arrangers — but
 * measured across four levels it changed nothing for seven of eight ensembles.
 * This module is the first thing that gives it a meaning.
 *
 * Phase 1 answers one question only: WHERE ON THE INSTRUMENT may this player be
 * asked to play. Rhythm, endurance, leaps and key are later phases and are
 * deliberately absent — a part moved into a comfortable register is still a
 * hard part if it is syncopated, and this file must not pretend otherwise.
 */
export type PlayerLevel = "beginner" | "intermediate" | "advanced" | "professional";

export const PLAYER_LEVELS: PlayerLevel[] = ["beginner", "intermediate", "advanced", "professional"];

export function isPlayerLevel(x: unknown): x is PlayerLevel {
  return typeof x === "string" && (PLAYER_LEVELS as string[]).includes(x);
}

/**
 * The register a FIRST- OR SECOND-YEAR player is at home in, in concert pitch.
 *
 * PROVISIONAL. These are seeded from the ranges standard band and orchestra
 * method books stay inside during a first year — first position and no shifting
 * for the strings, no crossing the break for the clarinet, nothing above the
 * staff for the brass. They are NOT measured against graded editions, which is
 * the only thing that would make them calibrated, and they should not be
 * described as if they were.
 *
 * They live here rather than in `InstrumentCatalog` on purpose: the catalog
 * answers what an instrument can physically play, which is a fact about the
 * instrument. This answers what a particular player should be asked to play,
 * which is a different question about the same instrument — and it is the one
 * number in this feature most likely to be re-pointed, so it is kept in one
 * table that can be replaced wholesale.
 */
const STUDENT_BAND: Record<string, { lo: number; hi: number }> = {
  // ── Woodwinds
  flute:           { lo: 60, hi: 79 }, // C4-G5
  oboe:            { lo: 62, hi: 77 }, // D4-F5
  clarinet_bb:     { lo: 50, hi: 70 }, // D3-Bb4 concert — stays under the break
  bassoon:         { lo: 41, hi: 60 }, // F2-C4
  soprano_sax_bb:  { lo: 58, hi: 77 },
  alto_sax_eb:     { lo: 51, hi: 72 },
  tenor_sax_bb:    { lo: 46, hi: 67 },
  baritone_sax_eb: { lo: 39, hi: 60 },

  // ── Brass. Nothing above the staff, which is where endurance goes first.
  trumpet_bb_1:    { lo: 53, hi: 70 }, // F3-Bb4
  trumpet_bb_2:    { lo: 53, hi: 70 },
  horn_f:          { lo: 53, hi: 65 }, // F3-F4 — the narrowest band here, and
                                       // deliberately so: the horn is the
                                       // hardest of these to pitch accurately.
  trombone:        { lo: 41, hi: 58 }, // F2-Bb3
  bass_trombone:   { lo: 36, hi: 55 },
  tuba_c:          { lo: 34, hi: 53 }, // Bb1-F3

  // ── Strings, first position, no shifting.
  violin_1:        { lo: 55, hi: 76 }, // G3-E5
  violin_2:        { lo: 55, hi: 76 },
  viola:           { lo: 48, hi: 69 }, // C3-A4
  cello:           { lo: 36, hi: 62 }, // C2-D4
  double_bass:     { lo: 28, hi: 47 }, // E1-B2

  // ── Voices. An amateur choir, not a trained one.
  soprano:         { lo: 60, hi: 76 },
  alto:            { lo: 55, hi: 70 },
  tenor:           { lo: 48, hi: 64 },
  bass_voice:      { lo: 41, hi: 57 },

  // ── Pitched percussion. Narrowed mostly so a part does not run off the ends
  // of the instrument in front of a student.
  glockenspiel:    { lo: 96, hi: 115 },
  tubular_bells:   { lo: 62, hi: 81 },
  vibraphone:      { lo: 57, hi: 81 },
  marimba:         { lo: 48, hi: 84 },
  xylophone:       { lo: 79, hi: 100 },
  timpani:         { lo: 46, hi: 50 },
};

/**
 * Instruments this pass leaves alone.
 *
 * The piano routes already branch on `level` inside `applyAppSettings`, so a
 * piano part would be simplified twice and in two different senses. Unpitched
 * percussion has no register to move.
 */
const EXCLUDED = new Set(["piano", "drums"]);

export type Band = { lo: number; hi: number };

/**
 * The register a part may use at a given level.
 *
 * `professional` returns null, meaning no constraint at all — and that is what
 * makes the whole pass provably inert by default, which the sweep checks.
 *
 * `advanced` is the catalog's own preferred band. `intermediate` sits halfway
 * between that and the student band rather than having a third table of
 * invented numbers: one set of provisional figures is enough.
 */
export function bandFor(instrument: string | undefined, level: PlayerLevel): Band | null {
  if (level === "professional") return null;
  const id = String(instrument ?? "").toLowerCase();
  if (!id || EXCLUDED.has(id)) return null;

  const spec = getInstrumentSpec(id);
  if (!spec) return null;

  const prefLo = typeof spec.preferred_low === "number" ? spec.preferred_low : spec.midi_low;
  const prefHi = typeof spec.preferred_high === "number" ? spec.preferred_high : spec.midi_high;
  if (level === "advanced") return { lo: prefLo, hi: prefHi };

  const student = STUDENT_BAND[spec.id] ?? STUDENT_BAND[id];
  // No student band for this instrument: fall back to the preferred one rather
  // than inventing a narrowing. Silently guessing is worse than not helping.
  if (!student) return { lo: prefLo, hi: prefHi };

  if (level === "beginner") return { lo: student.lo, hi: student.hi };

  return {
    lo: Math.round((student.lo + prefLo) / 2),
    hi: Math.round((student.hi + prefHi) / 2),
  };
}

/** The hard wall: what the instrument can physically play. Never crossed. */
export function playableRange(instrument: string | undefined): Band | null {
  const spec = getInstrumentSpec(String(instrument ?? "").toLowerCase());
  return spec ? { lo: spec.midi_low, hi: spec.midi_high } : null;
}
