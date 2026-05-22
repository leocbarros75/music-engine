/**
 * choralStyleProfiles.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 1 reference library: the 5 audible dimensions that make each choral
 * style period and composer immediately recognisable.
 *
 * FIVE DIMENSIONS
 * ───────────────
 * 1. Voice-leading strictness  → penalty weights (wired to polyphonicRules.ts)
 * 2. Bass character            → pattern + activity + stepwise rate
 * 3. Inner voice behaviour     → independence, activity, rest density
 * 4. Harmonic language         → rhythm, chromatic density, chord colour
 * 5. Phrase / cadence shape    → cadence period, cadence type preferences
 *
 * USAGE
 * ─────
 * applyAppSettings calls resolveChoralProfile(style, composer?) to get the
 * correct bassActivity / tenorActivity / altoActivity / styleProfile defaults
 * that are then passed to the harmonizer.  The user's explicit settings always
 * override any profile default.
 */

// ── Type definitions ──────────────────────────────────────────────────────────

export type ChoralBassPattern =
  | "walking_eighth"   // Bach basso continuo — constant 8th-note bass motion
  | "walking_quarter"  // Handel / Brahms / Schubert — quarter-note bass lines
  | "alberti"          // Classical accompaniment (root–5th–3rd–5th)
  | "root_quarter"     // Root on every beat — standard hymn bass
  | "root_half"        // Root on half-note — slow hymn / worship ballad
  | "gospel_quarter";  // Off-beat emphasis, fills between root notes (Mark Hayes)

export type ActivityLevel = "grounded" | "less_active" | "active" | "high_active";

export type ChoralStylePeriod = "baroque" | "classical" | "romantic" | "modern" | "worship";

export type ChoralComposerProfile = {
  /** Human-readable name */
  composer: string;
  /** Broad period this composer belongs to */
  period: ChoralStylePeriod;

  // ── Dimension 1: Voice-leading strictness ──────────────────────────────────
  /** Maps to polyphonicRules.ts profile name */
  styleProfile: "baroque" | "classical" | "romantic" | "modern";
  /** 0 = homophonic block chords; 1 = fully independent contrapuntal voices */
  voiceIndependence: number;

  // ── Dimension 2: Bass character ────────────────────────────────────────────
  bassPattern: ChoralBassPattern;
  /** 0–1: fraction of bass note-to-note moves that are stepwise (≤ 2 semitones) */
  bassStepwiseRate: number;
  bassActivity: ActivityLevel;

  // ── Dimension 3: Inner voice behaviour ────────────────────────────────────
  tenorActivity: ActivityLevel;
  altoActivity: ActivityLevel;
  /** 0–1: fraction of beats where an inner voice begins with a rest */
  restDensity: number;

  // ── Dimension 4: Harmonic language ────────────────────────────────────────
  /** Average number of beats per chord change (higher = slower harmonic rhythm) */
  harmonicRhythm: number;
  /** 0–1: density of chromatic passing / neighbour tones */
  chromaticDensity: number;
  /** Dominant rhythmic subdivision */
  rhythmUnit: "sixteenth" | "eighth" | "quarter" | "dotted" | "mixed";
  /** 0–1: fraction of notes placed on off-beats */
  syncopationWeight: number;

  // ── Dimension 5: Phrase / cadence shape ────────────────────────────────────
  /** Average number of measures between cadences */
  cadencePeriod: number;
  /** True if deceptive/plagal cadences are preferred over perfect authentic */
  preferDeceptiveCadence: boolean;

  // ── Special stylistic features ─────────────────────────────────────────────
  /** Suspension chains (7–6, 4–3, 9–8) — quintessential Bach chorale device */
  useSuspensions?: boolean;
  /** Motivic sequence repetition (Vivaldi, Dvořák) */
  useSequences?: boolean;
  /** Hemiola cross-rhythm — 3-beat groupings in duple meter (Brahms) */
  useCrossRhythm?: boolean;
  /** Gospel syncopation + off-beat bass fills (Mark Hayes, Camp Kirkland) */
  useGospelSyncopation?: boolean;
  /** Added-9th / sus4 chord colour (contemporary worship, John Rutter) */
  useAddedNinth?: boolean;
  /** Climactic register expansion on final phrase (worship, Romantic) */
  useClimaticBuild?: boolean;
};

export type ChoralPeriodDefaults = {
  period: ChoralStylePeriod;
  styleProfile: "baroque" | "classical" | "romantic" | "modern";
  bassActivity: ActivityLevel;
  tenorActivity: ActivityLevel;
  altoActivity: ActivityLevel;
  voiceIndependence: number;
  harmonicRhythm: number;
  chromaticDensity: number;
  cadencePeriod: number;
};

// ── Period-level defaults ─────────────────────────────────────────────────────
// These are applied when the user selects a style but has not chosen a
// specific sub-composer.  Composer profiles override these.

export const CHORAL_PERIOD_DEFAULTS: Record<ChoralStylePeriod, ChoralPeriodDefaults> = {

  baroque: {
    period: "baroque",
    styleProfile: "baroque",
    // Walking bass is the signature of baroque choral writing
    bassActivity: "high_active",
    // Alto and Tenor move independently — counterpoint is the texture
    tenorActivity: "active",
    altoActivity: "active",
    voiceIndependence: 0.75,
    // Baroque moves chords every 1–2 beats (fast harmonic rhythm)
    harmonicRhythm: 1.5,
    // ~15% chromatic passing tones (F#, Eb etc. as colour)
    chromaticDensity: 0.15,
    // Cadences every ~4 bars on average
    cadencePeriod: 4,
  },

  classical: {
    period: "classical",
    styleProfile: "classical",
    // Active bass but quarter-note motion, not walking eighths
    bassActivity: "active",
    // Inner voices are harmonic support, not fully independent
    tenorActivity: "less_active",
    altoActivity: "less_active",
    voiceIndependence: 0.25,
    // Classical moves chords every 2–4 beats (moderate harmonic rhythm)
    harmonicRhythm: 2.5,
    // Very little chromaticism — diatonic clarity is the goal
    chromaticDensity: 0.05,
    // Regular 4–8 bar phrase structure
    cadencePeriod: 6,
  },

  romantic: {
    period: "romantic",
    styleProfile: "romantic",
    // Rich walking bass with chromatic passing tones
    bassActivity: "active",
    // Inner voices have more colour and independence than classical
    tenorActivity: "active",
    altoActivity: "active",
    voiceIndependence: 0.45,
    // Romantic can move quickly (chromaticism) or slowly (expressive)
    harmonicRhythm: 2.0,
    // ~25% chromatic events — secondary dominants, diminished 7ths, Aug 6ths
    chromaticDensity: 0.25,
    // Phrase extensions via deceptive cadences — longer average
    cadencePeriod: 6,
  },

  modern: {
    period: "modern",
    styleProfile: "modern",
    bassActivity: "less_active",
    tenorActivity: "less_active",
    altoActivity: "less_active",
    voiceIndependence: 0.35,
    harmonicRhythm: 3.0,
    chromaticDensity: 0.30,
    cadencePeriod: 8,
  },

  worship: {
    period: "worship",
    // Worship uses classical voice-leading rules (clean, accessible)
    styleProfile: "classical",
    // Root bass on downbeats — harmonic clarity above all
    bassActivity: "less_active",
    // Supportive inner voices — no independent counterpoint
    tenorActivity: "less_active",
    altoActivity: "less_active",
    voiceIndependence: 0.15,
    // Slow harmonic rhythm — hymns change chord every 2–4 beats
    harmonicRhythm: 3.0,
    // Minimal chromaticism — occasional secondary dominant for colour
    chromaticDensity: 0.08,
    // Strong cadences every 4 bars — predictable phrase structure
    cadencePeriod: 4,
  },
};

// ── Composer sub-profiles ─────────────────────────────────────────────────────
// Each entry refines the period defaults for a specific composer's voice.
// Source: analysis of actual SATB scores (note proportions, spacing, rhythm).

export const CHORAL_COMPOSER_PROFILES: Record<string, ChoralComposerProfile> = {

  // ════════════════════════════════════════════════════════════════════════════
  // BAROQUE
  // ════════════════════════════════════════════════════════════════════════════

  bach: {
    composer: "J.S. Bach",
    period: "baroque",
    styleProfile: "baroque",
    // Source: BWV 227, 578, 848 analysis
    // Bass: 95% 8th-note motion, walking stepwise continuo
    bassPattern: "walking_eighth",
    bassStepwiseRate: 0.70,
    bassActivity: "high_active",
    // Alto and Tenor have fully independent melodic lines
    voiceIndependence: 0.90,
    tenorActivity: "active",
    altoActivity: "active",
    restDensity: 0.02,       // nearly continuous motion, very few rests
    // Fast harmonic rhythm — often one chord per beat
    harmonicRhythm: 1.0,
    // Rich chromatic passing tones: F# in G minor, Eb in C major, etc.
    chromaticDensity: 0.18,
    rhythmUnit: "eighth",
    syncopationWeight: 0.08,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useSuspensions: true,    // 7–6, 4–3, 9–8 suspension chains — hallmark texture
    useSequences: true,      // descending-5th sequences in inner voices
  },

  handel: {
    composer: "G.F. Handel",
    period: "baroque",
    styleProfile: "baroque",
    // Handel mixes polyphony with homophonic grandeur (Messiah style)
    bassPattern: "walking_quarter",
    bassStepwiseRate: 0.55,
    bassActivity: "active",
    voiceIndependence: 0.55,
    tenorActivity: "active",
    altoActivity: "less_active", // alto often doubles soprano at the 3rd
    restDensity: 0.10,
    harmonicRhythm: 2.0,
    chromaticDensity: 0.10,
    rhythmUnit: "quarter",
    syncopationWeight: 0.08,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useSuspensions: true,
  },

  vivaldi: {
    composer: "A. Vivaldi",
    period: "baroque",
    styleProfile: "baroque",
    // Vivaldi: ostinato bass + running melodic sequences, less counterpoint
    bassPattern: "walking_eighth",
    bassStepwiseRate: 0.45,
    bassActivity: "high_active",
    voiceIndependence: 0.40,
    tenorActivity: "less_active",
    altoActivity: "less_active",
    restDensity: 0.12,
    harmonicRhythm: 1.0,     // very fast harmonic rhythm, one chord per beat
    chromaticDensity: 0.08,
    rhythmUnit: "sixteenth",
    syncopationWeight: 0.05,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useSequences: true,      // sequence + repetition is the Vivaldi engine
  },

  // ════════════════════════════════════════════════════════════════════════════
  // CLASSICAL
  // ════════════════════════════════════════════════════════════════════════════

  mozart: {
    composer: "W.A. Mozart",
    period: "classical",
    styleProfile: "classical",
    // Mozart SATB: melody leads, inner voices fill harmony cleanly
    bassPattern: "root_quarter",
    bassStepwiseRate: 0.50,
    bassActivity: "active",
    voiceIndependence: 0.20,
    tenorActivity: "less_active",
    altoActivity: "less_active",
    restDensity: 0.08,
    harmonicRhythm: 2.0,
    chromaticDensity: 0.05,
    rhythmUnit: "eighth",
    syncopationWeight: 0.05,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
  },

  haydn: {
    composer: "F.J. Haydn",
    period: "classical",
    styleProfile: "classical",
    // Haydn: surprise rests, wit, arpeggiated inner voices
    bassPattern: "alberti",
    bassStepwiseRate: 0.48,
    bassActivity: "active",
    voiceIndependence: 0.45,
    tenorActivity: "active",      // more independent than Mozart
    altoActivity: "less_active",
    restDensity: 0.28,            // trademark surprise rests in inner voices
    harmonicRhythm: 2.5,
    chromaticDensity: 0.08,
    rhythmUnit: "mixed",
    syncopationWeight: 0.18,
    cadencePeriod: 5,
    preferDeceptiveCadence: true, // Haydn loves the deceptive cadence
  },

  beethoven_early: {
    composer: "L. van Beethoven (early)",
    period: "classical",
    styleProfile: "classical",
    // Beethoven: dramatic sforzando, syncopated bass, strategic silences
    bassPattern: "walking_quarter",
    bassStepwiseRate: 0.52,
    bassActivity: "active",
    voiceIndependence: 0.65,
    tenorActivity: "active",
    altoActivity: "active",
    restDensity: 0.22,
    harmonicRhythm: 2.0,
    chromaticDensity: 0.12,
    rhythmUnit: "mixed",
    syncopationWeight: 0.40,
    cadencePeriod: 5,
    preferDeceptiveCadence: true,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // ROMANTIC
  // ════════════════════════════════════════════════════════════════════════════

  brahms: {
    composer: "J. Brahms",
    period: "romantic",
    styleProfile: "romantic",
    // Brahms: dense chromatic counterpoint, hemiola, walking bass
    bassPattern: "walking_quarter",
    bassStepwiseRate: 0.60,
    bassActivity: "active",
    voiceIndependence: 0.75,
    tenorActivity: "active",
    altoActivity: "active",
    restDensity: 0.18,
    harmonicRhythm: 1.5,         // frequent harmonic changes with chromaticism
    chromaticDensity: 0.30,      // rich chromatic inner-voice motion
    rhythmUnit: "mixed",
    syncopationWeight: 0.35,
    cadencePeriod: 6,
    preferDeceptiveCadence: true,
    useCrossRhythm: true,        // hemiola (3-against-2)
    useSuspensions: true,
  },

  dvorak: {
    composer: "A. Dvořák",
    period: "romantic",
    styleProfile: "romantic",
    // Dvořák: folk-inflected sequences, arpeggiated warmth, pentatonic moments
    bassPattern: "walking_quarter",
    bassStepwiseRate: 0.55,
    bassActivity: "active",
    voiceIndependence: 0.40,
    tenorActivity: "active",
    altoActivity: "less_active",
    restDensity: 0.15,
    harmonicRhythm: 2.0,
    chromaticDensity: 0.18,
    rhythmUnit: "eighth",
    syncopationWeight: 0.20,
    cadencePeriod: 5,
    preferDeceptiveCadence: true,
    useSequences: true,          // Slavic melodic sequences
    useClimaticBuild: true,
  },

  schubert: {
    composer: "F. Schubert",
    period: "romantic",
    styleProfile: "romantic",
    // Schubert: singing inner lines, dotted rhythms, major–minor key shifts
    bassPattern: "walking_quarter",
    bassStepwiseRate: 0.58,
    bassActivity: "active",
    voiceIndependence: 0.35,
    tenorActivity: "active",
    altoActivity: "active",
    restDensity: 0.12,
    harmonicRhythm: 2.0,
    chromaticDensity: 0.22,      // chromaticism for expressive key shifts
    rhythmUnit: "dotted",        // characteristic dotted rhythm (Ständchen style)
    syncopationWeight: 0.12,
    cadencePeriod: 5,
    preferDeceptiveCadence: true,
    useClimaticBuild: true,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // MODERN
  // ════════════════════════════════════════════════════════════════════════════

  rutter: {
    composer: "J. Rutter",
    period: "modern",
    styleProfile: "modern",
    // Rutter: lyrical, gentle, tonal but with contemporary colour
    bassPattern: "root_quarter",
    bassStepwiseRate: 0.50,
    bassActivity: "less_active",
    voiceIndependence: 0.30,
    tenorActivity: "less_active",
    altoActivity: "less_active",
    restDensity: 0.12,
    harmonicRhythm: 2.5,
    chromaticDensity: 0.15,
    rhythmUnit: "mixed",
    syncopationWeight: 0.10,
    cadencePeriod: 6,
    preferDeceptiveCadence: false,
    useAddedNinth: true,         // gentle added-9th colour
    useClimaticBuild: true,
  },

  part: {
    composer: "A. Pärt",
    period: "modern",
    styleProfile: "modern",
    // Pärt tintinnabuli: sparse, modal, static harmony, stepwise voice motion
    bassPattern: "root_half",
    bassStepwiseRate: 0.75,
    bassActivity: "grounded",
    voiceIndependence: 0.25,
    tenorActivity: "grounded",
    altoActivity: "grounded",
    restDensity: 0.30,
    harmonicRhythm: 4.0,         // very slow harmonic rhythm
    chromaticDensity: 0.03,      // nearly no chromaticism
    rhythmUnit: "quarter",
    syncopationWeight: 0.02,
    cadencePeriod: 8,
    preferDeceptiveCadence: false,
  },

  // ════════════════════════════════════════════════════════════════════════════
  // WORSHIP
  // ════════════════════════════════════════════════════════════════════════════

  mark_hayes: {
    composer: "Mark Hayes",
    period: "worship",
    styleProfile: "classical",  // classical voice-leading rules — accessible
    // Gospel-influenced rhythm, off-beat bass fills between root notes
    bassPattern: "gospel_quarter",
    bassStepwiseRate: 0.45,
    bassActivity: "active",      // more active than typical hymn bass
    voiceIndependence: 0.25,
    tenorActivity: "active",     // tenor has rhythmic fills and passing tones
    altoActivity: "less_active",
    restDensity: 0.15,
    harmonicRhythm: 2.5,
    chromaticDensity: 0.15,      // added 9ths, sus4, secondary dominants
    rhythmUnit: "mixed",
    syncopationWeight: 0.35,     // gospel syncopation is the signature
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useGospelSyncopation: true,
    useAddedNinth: true,         // added-9th and sus4 chords throughout
    useClimaticBuild: true,      // climactic register expansion on final phrase
  },

  camp_kirkland: {
    composer: "Camp Kirkland",
    period: "worship",
    styleProfile: "classical",
    // Contemporary worship — simpler than Mark Hayes but warm and accessible
    bassPattern: "root_quarter",
    bassStepwiseRate: 0.40,
    bassActivity: "less_active",
    voiceIndependence: 0.20,
    tenorActivity: "less_active",
    altoActivity: "less_active",
    restDensity: 0.10,
    harmonicRhythm: 3.0,
    chromaticDensity: 0.10,
    rhythmUnit: "quarter",
    syncopationWeight: 0.20,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useAddedNinth: true,
    useClimaticBuild: true,
  },

  joseph_martin: {
    composer: "Joseph Martin",
    period: "worship",
    styleProfile: "classical",
    // Traditional hymn structure with sophisticated internal voice motion
    bassPattern: "root_quarter",
    bassStepwiseRate: 0.50,
    bassActivity: "less_active",
    voiceIndependence: 0.30,
    tenorActivity: "less_active",
    altoActivity: "less_active",
    restDensity: 0.08,
    harmonicRhythm: 2.5,
    chromaticDensity: 0.12,
    rhythmUnit: "mixed",
    syncopationWeight: 0.15,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
    useSuspensions: true,
    useClimaticBuild: true,
  },

  hymn_traditional: {
    composer: "Traditional Hymn",
    period: "worship",
    styleProfile: "classical",
    // Classic SATB hymn: block chords, root bass, simple harmony (Wesley, Watts)
    bassPattern: "root_half",
    bassStepwiseRate: 0.40,
    bassActivity: "grounded",
    voiceIndependence: 0.10,
    tenorActivity: "grounded",
    altoActivity: "grounded",
    restDensity: 0.03,
    harmonicRhythm: 4.0,         // one chord per half-note / one per bar
    chromaticDensity: 0.04,
    rhythmUnit: "quarter",
    syncopationWeight: 0.02,
    cadencePeriod: 4,
    preferDeceptiveCadence: false,
  },
};

// ── Period → composer list ────────────────────────────────────────────────────

export const COMPOSERS_BY_PERIOD: Record<ChoralStylePeriod, string[]> = {
  baroque:   ["bach", "handel", "vivaldi"],
  classical: ["mozart", "haydn", "beethoven_early"],
  romantic:  ["brahms", "dvorak", "schubert"],
  modern:    ["rutter", "part"],
  worship:   ["mark_hayes", "camp_kirkland", "joseph_martin", "hymn_traditional"],
};

// ── Engine parameter resolution ───────────────────────────────────────────────

/**
 * Returns the engine-ready settings for a given style + optional composer.
 * Used by applyAppSettings to auto-configure bassActivity, tenorActivity,
 * altoActivity, styleProfile, and voiceIndependence when choralMode = "style".
 *
 * The user's explicit settings override any value returned here.
 */
export function resolveChoralProfile(
  style?: string | null,
  composer?: string | null
): {
  styleProfile: "baroque" | "classical" | "romantic" | "modern";
  bassActivity: ActivityLevel;
  tenorActivity: ActivityLevel;
  altoActivity: ActivityLevel;
  voiceIndependence: number;
  harmonicRhythm: number;
  chromaticDensity: number;
  cadencePeriod: number;
  features: {
    useSuspensions: boolean;
    useSequences: boolean;
    useCrossRhythm: boolean;
    useGospelSyncopation: boolean;
    useAddedNinth: boolean;
    useClimaticBuild: boolean;
  };
} {
  // 1. Try composer profile
  const composerKey = String(composer ?? "").toLowerCase().replace(/\s+/g, "_");
  const cp = CHORAL_COMPOSER_PROFILES[composerKey] ?? null;
  if (cp) {
    return {
      styleProfile: cp.styleProfile,
      bassActivity: cp.bassActivity,
      tenorActivity: cp.tenorActivity,
      altoActivity: cp.altoActivity,
      voiceIndependence: cp.voiceIndependence,
      harmonicRhythm: cp.harmonicRhythm,
      chromaticDensity: cp.chromaticDensity,
      cadencePeriod: cp.cadencePeriod,
      features: {
        useSuspensions:       cp.useSuspensions       ?? false,
        useSequences:         cp.useSequences         ?? false,
        useCrossRhythm:       cp.useCrossRhythm       ?? false,
        useGospelSyncopation: cp.useGospelSyncopation ?? false,
        useAddedNinth:        cp.useAddedNinth        ?? false,
        useClimaticBuild:     cp.useClimaticBuild     ?? false,
      },
    };
  }

  // 2. Fall back to period defaults
  const periodKey = String(style ?? "classical").toLowerCase() as ChoralStylePeriod;
  const pd = CHORAL_PERIOD_DEFAULTS[periodKey] ?? CHORAL_PERIOD_DEFAULTS.classical;
  return {
    styleProfile: pd.styleProfile,
    bassActivity: pd.bassActivity,
    tenorActivity: pd.tenorActivity,
    altoActivity: pd.altoActivity,
    voiceIndependence: pd.voiceIndependence,
    harmonicRhythm: pd.harmonicRhythm,
    chromaticDensity: pd.chromaticDensity,
    cadencePeriod: pd.cadencePeriod,
    features: {
      useSuspensions: false,
      useSequences: false,
      useCrossRhythm: false,
      useGospelSyncopation: false,
      useAddedNinth: false,
      useClimaticBuild: false,
    },
  };
}
