// src/arrange/types.ts
export type ParticipationTargets = {
  strings?: number;
  woodwinds?: number;
  brass?: number;
  percussion?: number;
};

export type FullOrchestraProfile = "classical";

export type FullOrchestraOptions = {
  profile?: FullOrchestraProfile;

  // legacy name kept for compatibility
  phraseLen?: 1 | 2 | 4 | 8;

  // preferred name used by ArrangeRequest options
  blockMeasures?: 1 | 2 | 4 | 8;

  targets?: ParticipationTargets;

  // Range enforcement
  // - "preferred": keep notes within preferred range when possible
  // - "absolute": clamp only to absolute range
  // - "both": try preferred first, then absolute
  rangeMode?: "preferred" | "absolute" | "both";
};