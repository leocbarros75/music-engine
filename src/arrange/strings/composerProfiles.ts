/**
 * Composer-level style profiles for string ensemble arrangement.
 *
 * Each profile encodes 5 audible parameters that distinguish composers within
 * the same period style (e.g. Mozart vs Beethoven both within "classical"):
 *
 *   syncopationWeight  — how strongly off-beat accents are used
 *   bassPattern        — the characteristic cello/bass texture
 *   voiceIndependence  — 0 = homophonic (Mozart), 1 = fully contrapuntal (Bach)
 *   restDensity        — how often inner voices rest (Haydn = surprise rests)
 *   rhythmUnit         — dominant subdivision ("eighth" = steady 8ths, "mixed" = varied)
 */

export type BassPatternType =
  | "alberti"          // root-5th-3rd-5th in 8ths (Mozart)
  | "walking_eighth"   // step-wise 8th notes (Bach basso continuo)
  | "walking_quarter"  // step-wise quarters (Brahms / Romantic)
  | "ostinato"         // repeated-root quarter / half (Vivaldi continuo)
  | "syncopated"       // off-beat bass with dramatic rests (Beethoven)
  | "arpeggiated";     // chord tones in sequence (Haydn / Schubert)

export type ComposerProfile = {
  /** Display name */
  composer: string;
  /** The broad period this profile belongs to */
  period: "baroque" | "classical" | "romantic" | "modern";
  /** 0–1: fraction of notes placed on off-beats */
  syncopationWeight: number;
  /** Characteristic bass/cello texture */
  bassPattern: BassPatternType;
  /** 0 = homophonic melody+accompaniment, 1 = equal contrapuntal voices */
  voiceIndependence: number;
  /** 0–1: fraction of inner-voice beats that begin with a rest */
  restDensity: number;
  /** Dominant rhythmic subdivision */
  rhythmUnit: "sixteenth" | "eighth" | "quarter" | "dotted" | "mixed";
  /** Vivaldi-style repeated rhythmic sequences over descending/ascending steps */
  useSequences?: boolean;
  /** Brahms-style 3-beat groupings in duple meter (hemiolia) */
  useCrossRhythm?: boolean;
};

// ── Hand-crafted composer presets ─────────────────────────────────────────────

export const COMPOSER_PROFILES: Record<string, ComposerProfile> = {

  // ── Baroque ─────────────────────────────────────────────────────────────────

  bach: {
    composer: "Bach",
    period: "baroque",
    // Stats from bach_chamber_bwv.musicxml:
    // Upper voices: 47-52% 16ths → fast contrapuntal lines
    // Gamba bass:   95% 8ths    → walking continuo bass confirmed
    // Rest density: 0.01-0.03   → nearly continuous motion
    syncopationWeight: 0.08,
    bassPattern: "walking_eighth",
    voiceIndependence: 0.85,
    restDensity: 0.02,
    rhythmUnit: "sixteenth",
  },

  vivaldi: {
    composer: "Vivaldi",
    period: "baroque",
    // Stats from vivaldi_concerto.musicxml (first 100 measures):
    // Upper strings: 35-54% 16ths/32nds → fast running sequences
    // Cello offbeat: 0.29 → mostly on-beat (ostinato style confirmed)
    // Viola/Cello rest density: 0.10-0.14
    // Voice independence: upper strings move together; bass separate → 0.40
    syncopationWeight: 0.05,
    bassPattern: "ostinato",
    voiceIndependence: 0.40,
    restDensity: 0.10,
    rhythmUnit: "sixteenth",
    useSequences: true,
  },

  handel: {
    composer: "Handel",
    period: "baroque",
    syncopationWeight: 0.08,
    bassPattern: "walking_quarter",
    voiceIndependence: 0.55,
    restDensity: 0.10,
    rhythmUnit: "eighth",
  },

  // ── Classical ────────────────────────────────────────────────────────────────

  haydn: {
    composer: "Haydn",
    period: "classical",
    syncopationWeight: 0.18,
    bassPattern: "arpeggiated",
    voiceIndependence: 0.45,
    restDensity: 0.28, // surprise rests
    rhythmUnit: "mixed",
  },

  mozart: {
    composer: "Mozart",
    period: "classical",
    syncopationWeight: 0.05,
    bassPattern: "alberti",
    voiceIndependence: 0.20,
    restDensity: 0.08,
    rhythmUnit: "eighth",
  },

  beethoven: {
    composer: "Beethoven",
    period: "classical",
    syncopationWeight: 0.40,
    bassPattern: "syncopated",
    voiceIndependence: 0.70,
    restDensity: 0.25,
    rhythmUnit: "mixed",
  },

  // ── Romantic ─────────────────────────────────────────────────────────────────

  schubert: {
    composer: "Schubert",
    period: "romantic",
    syncopationWeight: 0.10,
    bassPattern: "walking_quarter",
    voiceIndependence: 0.30,
    restDensity: 0.12,
    rhythmUnit: "dotted",
  },

  brahms: {
    composer: "Brahms",
    period: "romantic",
    syncopationWeight: 0.35,
    bassPattern: "walking_quarter",
    voiceIndependence: 0.75,
    restDensity: 0.20,
    rhythmUnit: "mixed",
    useCrossRhythm: true,
  },

  dvorak: {
    composer: "Dvořák",
    period: "romantic",
    syncopationWeight: 0.20,
    bassPattern: "arpeggiated",
    voiceIndependence: 0.40,
    restDensity: 0.15,
    rhythmUnit: "eighth",
    useSequences: true,
  },
};

// ── Example file → composer mapping ───────────────────────────────────────────
// Maps the stringExample setting value to a composer key in COMPOSER_PROFILES.

export const EXAMPLE_TO_COMPOSER: Record<string, string> = {
  // Beethoven
  beethoven_op18_no1:          "beethoven",
  // Mozart
  mozart_k387_mvt1:            "mozart",
  mozart_k421_mvt1:            "mozart",
  mozart_k421:                 "mozart",
  mozart_k545_arr_mvt1:        "mozart",
  mozart_k465_mvt1:            "mozart",
  // Haydn
  haydn_op76_no3_mvt2:         "haydn",
  haydn_op64_no3_mvt1:         "haydn",
  haydn_op64_no5_mvt1:         "haydn",
  haydn_lark:                  "haydn",
  // Dvořák
  dvorak_op51:                 "dvorak",
  dvorak_op96_american:        "dvorak",
  // Brahms
  brahms_op51_no1:             "brahms",
  // Bach (user-provided files — calibrated from real rhythm analysis)
  bach_chamber_bwv:            "bach",
  bach_violin_concerto_bwv1041: "bach",
  // Vivaldi (user-provided file — calibrated from real rhythm analysis)
  vivaldi_concerto:            "vivaldi",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getComposerProfile(composerKey: string): ComposerProfile | null {
  return COMPOSER_PROFILES[composerKey.toLowerCase()] ?? null;
}

export function getComposerFromExample(exampleId: string): string | null {
  return EXAMPLE_TO_COMPOSER[exampleId] ?? null;
}

/** All composer keys that belong to a given period, in display order. */
export function composersForPeriod(period: string): string[] {
  return Object.entries(COMPOSER_PROFILES)
    .filter(([, p]) => p.period === period)
    .map(([key]) => key);
}
