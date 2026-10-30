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
 * The register a less able player should be asked to play, in concert pitch.
 *
 * Two entries are MEASURED and the rest are SEEDED, and the difference matters
 * enough to mark on every line.
 *
 * Measured means: a publisher issued the same arrangement twice, once as
 * written and once simplified, and the simplified edition's ceiling was read
 * off the engraving. That is a professional editor stating, about real music,
 * what a weaker player should be handed. See `tools/calibration/README.md` for
 * the source, the method and how the reader was checked; the measurements
 * themselves are in `tools/calibration/measured-bands.json`.
 *
 * Seeded means: the register a method book stays inside in a first year. It is
 * a guess, it has never been checked against a graded edition, and the one
 * place a guess could finally be checked it was wrong by ten semitones. Treat
 * the rest of this table with that in mind.
 *
 * It lives here rather than in `InstrumentCatalog` on purpose: the catalog
 * answers what an instrument can physically play, which is a fact about the
 * instrument. This answers what a particular player should be asked to play,
 * which is a different question about the same instrument.
 */
const STUDENT_BAND: Record<string, { lo: number; hi: number }> = {
  // ── Woodwinds. SEEDED — no graded edition available.
  flute:           { lo: 60, hi: 79 }, // C4-G5
  oboe:            { lo: 62, hi: 77 }, // D4-F5
  clarinet_bb:     { lo: 50, hi: 70 }, // D3-Bb4 concert — stays under the break
  bassoon:         { lo: 41, hi: 60 }, // F2-C4
  soprano_sax_bb:  { lo: 58, hi: 77 },
  alto_sax_eb:     { lo: 51, hi: 72 },
  tenor_sax_bb:    { lo: 46, hi: 67 },
  baritone_sax_eb: { lo: 39, hi: 60 },

  // ── Brass. SEEDED. Nothing above the staff, which is where endurance goes
  // first.
  trumpet_bb_1:    { lo: 53, hi: 70 }, // F3-Bb4
  trumpet_bb_2:    { lo: 53, hi: 70 },
  horn_f:          { lo: 53, hi: 65 }, // F3-F4 — the narrowest band here, and
                                       // deliberately so: the horn is the
                                       // hardest of these to pitch accurately.
  trombone:        { lo: 41, hi: 58 }, // F2-Bb3
  bass_trombone:   { lo: 36, hi: 55 },
  tuba_c:          { lo: 34, hi: 53 }, // Bb1-F3

  // ── Violins. MEASURED, from 8 published simplified editions (Semsen, The
  // Hymns Project Vol. 3, arr. Duren). The ceiling is the median of what those
  // editions actually use; the floor is the open G string, because across all
  // eight the floor does not rise when the music is simplified — in six it is
  // identical and where it moves it moves down.
  //
  // The seeded guess here was G3-E5, a strict first-position reading. A real
  // simplified edition goes to D6, ten semitones higher, so the engine had
  // been dropping violin parts roughly an octave further than any publisher
  // does. Violin 2 is lower not because the player is weaker but because the
  // editions leave the second line alone: its register is already reachable,
  // and simplification is spent on the top line.
  violin_1:        { lo: 55, hi: 86 }, // G3-D6
  violin_2:        { lo: 55, hi: 81 }, // G3-A5

  // ── Remaining strings. SEEDED, first position, no shifting.
  viola:           { lo: 48, hi: 69 }, // C3-A4
  cello:           { lo: 36, hi: 62 }, // C2-D4
  double_bass:     { lo: 28, hi: 47 }, // E1-B2

  // ── Voices. SEEDED. An amateur choir, not a trained one.
  soprano:         { lo: 60, hi: 76 },
  alto:            { lo: 55, hi: 70 },
  tenor:           { lo: 48, hi: 64 },
  bass_voice:      { lo: 41, hi: 57 },

  // ── Pitched percussion. SEEDED. Narrowed mostly so a part does not run off
  // the ends of the instrument in front of a student.
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
 * An intermediate ceiling set outright, where splitting the difference does not
 * give a sensible answer.
 *
 * The midpoint rule works when both ends mean something. For the violin the top
 * end does not: the catalog calls B6 comfortable, which is higher than anything
 * in ten published professional parts (max A6, median G#6), so halving the gap
 * to the student band landed intermediate on G6 — a semitone under what this
 * publisher asks of a professional. An "intermediate" player was being handed a
 * professional's register.
 *
 * E6 is Leo's call, and the editions back it: it is the ceiling of the two most
 * demanding simplified parts in the pack (What Child Is This, O Holy Night).
 * So intermediate now means "the hardest simplified part a publisher actually
 * wrote", which is a real place to stand rather than an arithmetic midpoint.
 *
 * Violin 2 cannot use that same reference. The publisher does not simplify the
 * second line at all — its published and simplified ceilings are the same note,
 * A5 — so "the hardest simplified edition" would collapse intermediate onto
 * beginner and start rewriting ordinary second violin parts. The question for a
 * second violin is not how high the player can reach but how high the LINE
 * normally goes, because that is what decides when a part is unusual enough to
 * be worth pulling down. Nine of the ten published second violin parts stop at
 * B5 or below; the tenth climbs to E6.
 *
 * C6 sits a semitone above that, below violin 1's E6 so the two lines keep the
 * distinction the editions draw sharply, and it leaves all eight published
 * simplified editions untouched. Be straight about what it buys: on the
 * measured editions C6 behaves exactly as the midpoint D#6 did — both rewrite
 * only the one E6 outlier. What changes is that the number now says something
 * ("a second violin stays under a first") instead of falling out of arithmetic,
 * and it will act on a line between C6 and D#6 that this engine can write even
 * though this publisher never did.
 */
const INTERMEDIATE_HI: Record<string, number> = {
  violin_1: 88, // E6
  violin_2: 84, // C6
};

/**
 * The register a part may use at a given level.
 *
 * `professional` returns null, meaning no constraint at all — and that is what
 * makes the whole pass provably inert by default, which the sweep checks.
 *
 * `advanced` is the catalog's own preferred band. `intermediate` sits halfway
 * between that and the student band rather than having a third table of
 * invented numbers.
 *
 * Only `beginner` is measured, and only for the violins. A publisher issues an
 * arrangement at two levels, as written and simplified, so two levels are all
 * a graded edition can speak to; the engine has four. `advanced` stays the
 * catalog's preferred band on purpose — a published professional part records
 * what one arranger chose to write, not what a good player can manage, so
 * using it as a ceiling would cap advanced players at that arranger's taste.
 * `intermediate` is the midpoint except where `INTERMEDIATE_HI` overrides it.
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
    hi: INTERMEDIATE_HI[spec.id] ?? INTERMEDIATE_HI[id] ?? Math.round((student.hi + prefHi) / 2),
  };
}

/** The hard wall: what the instrument can physically play. Never crossed. */
export function playableRange(instrument: string | undefined): Band | null {
  const spec = getInstrumentSpec(String(instrument ?? "").toLowerCase());
  return spec ? { lo: spec.midi_low, hi: spec.midi_high } : null;
}

/**
 * Ensembles whose idiom IS the eighth note.
 *
 * In swing the eighth is not an ornament on the beat, it is the pulse — the
 * horns, the ride cymbal and the comping all live on it. Putting a big band on
 * a one-beat grid cut 901 notes to 416 and moved every onset onto the beat:
 * a textbook beginner part, and no longer jazz. What makes a big-band chart
 * hard for a student is its density, its register and its endurance, none of
 * which is the eighth note.
 */
const SWUNG = /jazz|swing|big.?band/i;

/** The finest grid an idiom will tolerate before it stops being that idiom. */
const SWUNG_FLOOR = 0.5;

/**
 * The rhythmic grid a player at this level is asked to read, in quarter-beats.
 *
 * STILL PROVISIONAL — unlike the violin bands beside it, which are now
 * measured. It comes from the same place the bands started: what method books
 * put in front of a player in their first years. A beginner counts beats, so
 * the grid is the beat itself; an intermediate reads eighths; an advanced
 * player reads sixteenths, which on our output is close to no constraint at
 * all — 1% of notes are shorter than that — and that is the intent.
 * `professional` returns null, which is what keeps the whole pass inert by
 * default.
 *
 * The graded editions do say something here, but not enough to set a grid from.
 * A published simplified part carries about 25% fewer notes than the edition it
 * stands beside (median ratio 0.75 over eight pairs), so thinning is real and
 * roughly a quarter of the material. That is a measure of DENSITY, not of note
 * value: reading it as a grid would be inventing a number and calling it
 * evidence. Calibrating this properly needs the note values off those
 * engravings, which means reading beams and flags, which the reader in
 * `tools/calibration/` deliberately does not do.
 *
 * The ensemble decides how coarse the grid may get. It is the ENSEMBLE rather
 * than the instrument family that matters here, because the question is one of
 * idiom, not of technique: the same trumpeter reads a concert band part and a
 * big band part differently.
 */
export function gridFor(level: PlayerLevel, ensemble?: string): number | null {
  const base =
    level === "beginner" ? 1 :
    level === "intermediate" ? 0.5 :
    level === "advanced" ? 0.25 :
    null;
  if (base === null) return null;
  // Never coarser than the idiom's own floor. A swung chart keeps its eighths
  // at every level; it is simplified by register, density and air instead.
  return SWUNG.test(String(ensemble ?? "")) ? Math.min(base, SWUNG_FLOOR) : base;
}

/**
 * How long this player may be asked to play without air, in quarter-beats.
 *
 * `applyBreathing` already enforces a cap and already takes one — its default
 * is 8 beats where rests are written. Breath is where a student fails first and
 * where the professional part is least forgiving, so the cap tightens as the
 * level drops rather than a second mechanism being invented for it.
 *
 * Null for a professional: the default stands and nothing is re-breathed.
 */
export function breathCapFor(level: PlayerLevel): number | null {
  if (level === "beginner") return 4;
  if (level === "intermediate") return 6;
  if (level === "advanced") return 8;
  return null;
}

/** Players who run out of air. A string part tires, but it does not breathe. */
export const WIND_OR_BRASS =
  /flute|piccolo|oboe|clarinet|bassoon|sax|horn|trumpet|cornet|trombone|tuba|euphonium|recorder/i;
