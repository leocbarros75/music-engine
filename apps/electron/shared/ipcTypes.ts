export type EnsembleOption =
  | "choral"
  | "piano"
  | "piano_with_melody"
  | "string_ensemble"
  | "brass_ensemble"
  | "orchestra";
export type StyleOption = "classical" | "worship" | "latino" | "pop" | "rock" | "funk" | "samba";
export type LevelOption = "beginner" | "intermediate" | "advanced" | "professional";
export type AccompanimentOption = "homophonic" | "chordal" | "polyphonic" | "alberti_bass" | "heterophonic";
export type RuleStrictness = "relaxed" | "standard" | "strict";
export type TextureMode =
  | "homophony_homorhythmic"
  | "homophony_melody_accompaniment"
  | "polyphony"
  | "heterophony"
  | "biphony"
  | "monophony";
export type PolyphonicProfile = "baroque" | "classical" | "romantic" | "modern";
export type ModernMode = "modernTonal" | "modal" | "atonal";
export type BassActivity = "grounded" | "less_active" | "active" | "high_active";

export type Settings = {
  title: string;
  ensemble: EnsembleOption;
  keySignature: string;
  timeSignature: string;
  tempo: number;
  style: StyleOption;
  level: LevelOption;
  accompaniment: AccompanimentOption;
  ruleStrictness: RuleStrictness;
  textureMode: TextureMode;
  styleProfile?: PolyphonicProfile;
  modernMode?: ModernMode;
  bassActivity?: BassActivity;
  tenorActivity?: BassActivity;
  altoActivity?: BassActivity;
  sopranoActivity?: BassActivity;
  vln1Activity?: BassActivity;
  vln2Activity?: BassActivity;
  vlaActivity?: BassActivity;
  vcActivity?: BassActivity;
  cbActivity?: BassActivity;
  sopranoMelodyShare?: number;
  randomizeOffsets?: boolean;
  keySignatureMode?: "original" | "manual";
  targetKey?: string;
  timeSignatureMode?: "original" | "manual";
  useStringEnsembleArranger?: boolean;
};

export type MusicXmlFile = {
  path: string;
  name: string;
};

export type DebugChordEvent = {
  measure: number;
  t: number;
  symbol: string;
};

export type ChordMismatch = {
  measure: number;
  chord: string;
  chordPcs: number[];
  outputPcs: number[];
};

export type RuleViolation = {
  ruleId: string;
  severity: "warn" | "error";
  message: string;
  measure?: number;
  t?: number;
  voices?: string[];
};

export type JobDebug = {
  melodyPartName?: string;
  melodyPartId?: string;
  melodyVoice?: number | null;
  melodyNoteCount?: number | null;
  detectedInputKeyMode?: string | null;
  chordEventCount?: number;
  chordEventSample?: DebugChordEvent[];
  chordWarnings?: string[];
  chordCheck?: {
    measuresChecked: number;
    mismatches: ChordMismatch[];
  };
  ruleViolations?: RuleViolation[];
  ruleWarnings?: string[];
  rulesVersion?: string;
  textureAnalysis?: {
    type: string;
    density?: {
      densityLevel?: string;
      densityScore?: number;
      totalNotes?: number;
      avgNotesPerMeasure?: number;
    };
    motionSummary?: {
      parallel?: number;
      similar?: number;
      contrary?: number;
      oblique?: number;
      parallelPerfect?: number;
    } | null;
    spacingQuality?: string;
  } | null;
  rhythmDensity?: {
    voices: Record<
      string,
      {
        avgNotesPerMeasure: number;
        totalNotes: number;
        measures: Array<{ measure: number; notes: number }>;
      }
    >;
  };
};

export type JobRequest = {
  settings: Settings;
  filePath: string;
  prompt: string;
};

export type JobResult = {
  ok: boolean;
  outputPath?: string;
  serverBaseUrl?: string;
  styleUsed?: string;
  accompanimentUsed?: string;
  chordSource?: string;
  debug?: JobDebug;
  cadenceMeasures?: number[];
  warnings: string[];
  error?: string;
};

export type LogLevel = "info" | "warn" | "error";

export type LogEntry = {
  ts: string;
  level: LogLevel;
  message: string;
};
