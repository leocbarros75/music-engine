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
  instrumentation?:
    | "auto"
    | "piano_copy_to_string_quartet"
    | "satb_to_string_quartet"
    | "piano_copy_to_woodwind_quartet"
    | "satb_to_woodwind_quartet";
  sopranoMelodyShare?: number;
  randomizeOffsets?: boolean;
  pianoStylePreset?: string;
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
