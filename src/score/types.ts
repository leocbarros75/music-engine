export type Pitch = { step: string; alter?: number; octave: number };

export type NoteEvent =
  | {
      id: string;
      t: number; // onset in divisions
      dur: number; // duration in divisions
      type: "note";
      pitch: Pitch;
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
  number: number;
  attributes?: {
    divisions?: number;
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
  measures: Measure[];
};

export type ScoreModel = {
  score_id: string;
  meta: {
    title?: string;
    composer?: string;
    ensemble: string;
    key?: string;
    time_signature?: string;
    tempo_bpm?: number;
  };
  global: {
    divisions: number;
  };
  parts: Part[];
};
