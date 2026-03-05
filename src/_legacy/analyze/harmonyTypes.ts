import type { Pitch } from "../../instruments/instrumentCatalog";

export type HarmonyMode = "major" | "minor" | "unknown";

export type KeySignature = {
  fifths: number; // -7..+7 (MusicXML <fifths>)
  mode: HarmonyMode;
};

export type ChordQuality =
  | "maj"
  | "min"
  | "dim"
  | "aug"
  | "7" // dominant 7
  | "maj7"
  | "min7"
  | "hdim7"
  | "dim7";

export type HarmonyChord = {
  t: number; // onset within measure (in divisions)
  pitches?: Pitch[]; // optional, if we ever want note-level output
  pcs?: number[]; // 0..11, concert pitch pitch classes
  rootPc?: number; // 0..11
  quality?: ChordQuality;
  inversion?: 0 | 1 | 2 | 3;
  symbol?: string; // e.g. C, Cm, C7, C°7
  confidence?: number; // 0..1
};

export type HarmonyMeasure = {
  measureNumber: number;
  key?: KeySignature; // from measure attributes if present
  chords: HarmonyChord[]; // sorted by t
};

export type HarmonyAnalysis = {
  version: "harmony_v1";
  concertPitch: true;
  per: "measure";
  measures: HarmonyMeasure[];
};