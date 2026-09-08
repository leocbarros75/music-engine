import type { MeasurePerformance } from "./performance";
import type { PitchSpace, Transposition } from "./standard";

export type Pitch = { step: string; alter?: number; octave: number };

export type NoteEvent =
  | {
      id: string;
      t: number; // measure-relative onset in quarter-note beats (quarter = 1)
      dur: number; // duration in quarter-note beats; never MusicXML divisions
      type: "note";
      pitch: Pitch;
      /** Grace notes retain onset but consume no metrical time. */
      grace?: boolean;
      tieStart?: boolean;
      tieStop?: boolean;
      articulations?: string[];
      voice: number;
      staff: number;
      isRest?: false;
      midi?: number;   // cached MIDI value (optional, computed on demand)
      [key: string]: unknown; // allow extended properties (lockPitch, role, etc.)
    }
  | {
      id: string;
      t: number;
      dur: number;
      type: "rest";
      voice: number;
      staff: number;
      isRest: true;
      midi?: number;
      [key: string]: unknown;
    };

export type Measure = {
  performance?: MeasurePerformance;
  number: number;
  /** Explicit length for pickups/irregular bars; otherwise inherited meter. */
  durationBeats?: number;
  implicit?: boolean;
  attributes?: {
    /** Serialization resolution only; event times are always quarter-note beats. */
    divisions?: number;
    source_divisions?: number;
    key_fifths?: number;
    key_mode?: string;
    time?: { beats: number; beat_type: number };
  };
  events: NoteEvent[];
};

export type Part = {
  part_id: string;
  name: string;
  instrument: string;
  staves?: number;
  /** Imported parts: written. Generated parts: sounding. MIDI cache uses this same space. */
  pitchSpace?: PitchSpace;
  /**
   * Transposing-instrument written→sounding offset, captured from the source
   * MusicXML <transpose>. For pitchSpace=written this records how
   * to recover concert pitch (sounding = written + chromatic + 12*octaveChange).
   * Once pitchSpace=sounding, retained transpose is provenance and is not reapplied.
   */
  transpose?: Transposition;
  measures: Measure[];
};

export type ScoreModel = {
  /** Version 1: quarter-note beats, measure-relative onsets, explicit pitch space. */
  standardVersion?: 1;
  score_id: string;
  meta: {
    title?: string;
    composer?: string;
    ensemble: string;
    key?: string;
    time_signature?: string;
    tempo_bpm?: number;
    /** Source harmony symbols; written input is converted at the pipeline boundary. */
    inputChords?: Array<{ measure: number; t: number; symbol: string }>;
  };
  global: {
    /** MusicXML serialization resolution, never a multiplier on stored event time. */
    divisions: number;
  };
  parts: Part[];
};
