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
    }
  | {
      id: string;
      t: number;
      dur: number;
      type: "rest";
      voice: number;
      staff: number;
      isRest: true;
    };

export type Measure = {
  number: number;
  attributes?: {
    divisions?: number;
    key_fifths?: number;
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