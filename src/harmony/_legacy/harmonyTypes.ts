// src/harmony/harmonyTypes.ts

export type RomanNumeral =
  | "I" | "ii" | "iii" | "IV" | "V" | "vi" | "vii°"
  | "i" | "ii°" | "III" | "iv" | "v" | "VI" | "VII";

export type CadenceType =
  | "PAC"
  | "IAC"
  | "HC"
  | "PC"
  | "DC"
  | "NONE";

export type HarmonicMeasure = {
  measure: number;
  roman: RomanNumeral;
};

export type HarmonicPhraseAnalysis = {
  key: string;
  mode: "major" | "minor";
  measures: HarmonicMeasure[];
  cadence: CadenceType;
};