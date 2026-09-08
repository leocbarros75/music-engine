import type { ScoreModel } from "../score/types";
import { toSoundingScore } from "../score/pitch";

/** Explicit pitch-space conversion; instrument names alone never imply stored pitch. */
export function scoreModelToConcertPitch(score: ScoreModel): ScoreModel {
  const out = toSoundingScore(score);
  return { ...out, meta: { ...out.meta, view: "concert_pitch" } } as ScoreModel;
}
