export type Settings = {
  title: string;
  ensemble:
    | "choral"
    | "piano"
    | "piano_with_melody"
    | "string_ensemble"
    | "piano_string_quartet"
    | "satb_string_quartet"
    | "piano_with_strings"
    | "woodwind_ensemble"
    | "piano_woodwind_quartet"
    | "satb_woodwind_quartet"
    | "piano_with_woodwinds"
    | "brass_ensemble"
    | "piano_brass_quartet"
    | "satb_brass_quartet"
    | "piano_with_brass"
    | "reinstrument"
    | "orchestra"
    | "piano_orchestra"
    | "satb_orchestra";
  /** Re-instrumentation remap table: reassign parts to new instruments (sounding preserved). */
  reinstrument?: Array<{ part: string; to: string }>;
  /** Worship-orchestra intensity: "build" (light intro → climaxes) or "tutti" (full throughout). */
  orchestraIntensity?: "build" | "tutti";
  /** Worship-orchestra texture (auto): melody+harmony, chorale block, or contrapuntal. */
  orchestraTexture?: "melody_harmony" | "chorale" | "contrapuntal";
  keySignature: string;
  timeSignature: string;
  tempo: number;
  style: "baroque" | "classical" | "romantic" | "modern" | "worship" | "latino" | "pop" | "rock" | "funk" | "samba";
  level: "beginner" | "intermediate" | "advanced" | "professional";
  accompaniment: "homophonic" | "chordal" | "polyphonic" | "alberti_bass" | "heterophonic";
  ruleStrictness: "relaxed" | "standard" | "strict";
  textureMode:
    | "homophony_homorhythmic"
    | "homophony_melody_accompaniment"
    | "polyphony"
    | "heterophony"
    | "biphony"
    | "monophony";
  styleProfile?: "baroque" | "classical" | "romantic" | "modern";
  modernMode?: "modernTonal" | "modal" | "atonal";
  bassActivity?: "grounded" | "less_active" | "active" | "high_active";
  tenorActivity?: "grounded" | "less_active" | "active" | "high_active";
  altoActivity?: "grounded" | "less_active" | "active" | "high_active";
  sopranoActivity?: "grounded" | "less_active" | "active" | "high_active";
  vln1Activity?: "grounded" | "less_active" | "active" | "high_active";
  vln2Activity?: "grounded" | "less_active" | "active" | "high_active";
  vlaActivity?: "grounded" | "less_active" | "active" | "high_active";
  vcActivity?: "grounded" | "less_active" | "active" | "high_active";
  cbActivity?: "grounded" | "less_active" | "active" | "high_active";
  /**
   * Adler-based string texture mode.
   * Only active when ensemble = "string_ensemble" and instrumentation = "auto".
   */
  stringTexture?: "melody_harmony" | "melody_pizzicato" | "cello_melody" | "homophonic_block" | "counterpoint";
  /**
   * Reference example piece loaded into the string ensemble engine.
   * Automatically maps to a composer profile (see composerProfiles.ts).
   */
  stringExample?: string;
  /**
   * Explicit composer override (e.g. "mozart", "beethoven", "brahms").
   * When set, overrides the composer inferred from stringExample.
   * "auto" or undefined = derive from example.
   */
  stringComposer?: string;
  instrumentation?:
    | "auto"
    | "piano_copy_to_string_quartet"
    | "satb_to_string_quartet"
    | "piano_copy_to_woodwind_quartet"
    | "satb_to_woodwind_quartet";
  sopranoMelodyShare?: number;
  randomizeOffsets?: boolean;
  pianoStylePreset?: string;
  /** Woodwind quintet (adds Horn in F as a 5th voice) when true. */
  woodwindQuintet?: boolean;
  /** Brass ensemble auto settings. */
  brassTexture?: "melody_harmony" | "chamber" | "chorale" | "fanfare" | "contrapuntal";
  brassExample?: string;
  brassQuintet?: boolean;  // default true (Tpt1/Tpt2/Horn/Trombone/Tuba); false = quartet (no Horn)
  /**
   * Piano→Wind copy: measure (1-based) where the Bassoon enters (rests before).
   * 0 = always play; undefined = auto-detect the thin intro.
   */
  bassoonEntryMeasure?: number;
  /** Woodwind ensemble auto settings — parity with the string ensemble. */
  woodwindTexture?: "melody_harmony" | "chorale" | "contrapuntal" | "chamber";
  woodwindExample?: string;
  woodwindComposer?: string;
  fluteActivity?:    "grounded" | "less_active" | "active" | "high_active";
  oboeActivity?:     "grounded" | "less_active" | "active" | "high_active";
  clarinetActivity?: "grounded" | "less_active" | "active" | "high_active";
  hornActivity?:     "grounded" | "less_active" | "active" | "high_active";
  bassoonActivity?:  "grounded" | "less_active" | "active" | "high_active";
  /**
   * When true, the engine auto-generates chord harmony from the melody using
   * Krumhansl-Schmuckler key detection + scale-degree harmonization.
   * No chord events need to be supplied by the user.
   */
  melodyOnly?: boolean;
  /**
   * Top-level accompaniment mode for the choral (SATB) ensemble.
   * Drives which sub-panel is shown and which engine settings are applied.
   *   "homophonic"  → block chords, all voices homorhythmic
   *   "polyphonic"  → four-voice counterpoint, no explicit style picker
   *   "style"       → style-driven harmonisation; reveals the style sub-dropdown
   */
  choralMode?: "homophonic" | "polyphonic" | "style";

  /**
   * Explicit LH accompaniment pattern override for piano accompaniment mode.
   * When set, bypasses the auto-selection based on style + time signature.
   * "auto" means let the engine decide.
   */
  lhPattern?:
    | "auto"
    | "alberti"
    | "block_beats"
    | "boom_chick"
    | "broken_ascending"
    | "waltz_bass"
    | "serenade_strum"
    | "root_chord_stabs"
    | "interval_oscillation"
    | "jazz_shell"
    | "octave_bass"
    | "nocturne"
    | "pop_arpeggio"
    | "walking_bass"
    | "pedal_bass"
    | "spec_bass";
  /** spec_bass: note value of the instruction-driven bass line. */
  bassRhythm?: "whole" | "half" | "quarter";
  /** spec_bass: "follow_melody" ends the bass together with the melody's last note. */
  bassFinalNote?: "follow_melody" | "default";
  /**
   * Explicit RH pattern for piano accompaniment mode.
   * "block_beats"        — full block chord every beat
   * "melody_inner_voice" — chiming inner voice (worship/polyphonic feel)
   * "melody_fill_eighths"— ascending broken-chord 8th fills (lyrical)
   * "syncopated"         — offbeat chord hits on the 'and' of each beat
   * "arpeggio"           — ascending 16th-note arpeggios per beat
   * "melody_only"        — melody in piano RH, no chord accompaniment
   */
  rhPattern?:
    | "block_beats"
    | "melody_inner_voice"
    | "melody_fill_eighths"
    | "syncopated"
    | "arpeggio"
    | "melody_only"
    | "dotted_ballad";
};

export type JobResult = {
  ok: boolean;
  musicxml?: string;
  scoreModel?: unknown;
  warnings?: string[];
  error?: string;
  meta?: {
    ensemble: string;
    styleUsed?: string;
    chordSource: string;
    cadenceMeasures: number[];
    chordEventCount: number;
    parts?: Array<{ name: string; instrument: string }>;
    title?: string;
  };
};
