export type Settings = {
  title: string;
  ensemble:
    | "choral"
    | "piano"
    | "piano_with_melody"
    | "string_ensemble"
    | "woodwind_ensemble"
    | "brass_ensemble"
    | "orchestra";
  keySignature: string;
  timeSignature: string;
  tempo: number;
  style: "classical" | "worship" | "latino" | "pop" | "rock" | "funk" | "samba" | "baroque" | "romantic";
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
   */
  stringExample?: string;
  instrumentation?:
    | "auto"
    | "piano_copy_to_string_quartet"
    | "satb_to_string_quartet"
    | "piano_copy_to_woodwind_quartet"
    | "satb_to_woodwind_quartet";
  sopranoMelodyShare?: number;
  randomizeOffsets?: boolean;
  pianoStylePreset?: string;
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
    | "nocturne";
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
