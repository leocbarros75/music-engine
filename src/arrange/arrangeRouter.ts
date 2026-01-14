// src/arrange/arrangeRouter.ts
import type { ScoreModel } from "../score/types";
import { mapPianoToStringQuartetOpen } from "./mapToEnsemble";
import { mapPianoToBrassEnsembleOpen } from "./mapToBrassEnsemble";
import { mapPianoToWoodwindEnsembleOpen } from "./mapToWoodwindEnsemble";
import { mapPianoToJazzBandOpen } from "./mapToJazzBand";
import { mapPianoToPercussionOpen } from "./mapToPercussion";
import { mapPianoToFullOrchestraOpen } from "./mapToFullOrchestra";
import type { FullOrchestraOptions } from "./types";

export type ArrangeIntent = "instrumentation_only" | "new_arrangement";

export type ArrangeEnsemble =
  | "string_quartet"
  | "brass_ensemble"
  | "woodwind_ensemble"
  | "jazz_band"
  | "percussion"
  | "full_orchestra";

export type ArrangeRequest = {
  intent: ArrangeIntent;
  target: {
    ensemble: ArrangeEnsemble;
    spacing?: "open_classical" | "compact";
  };
  options?: FullOrchestraOptions;
};

export function arrangeScoreModel(score: ScoreModel, req: ArrangeRequest): ScoreModel {
  const ensemble = req?.target?.ensemble;

  if (ensemble === "string_quartet") return mapPianoToStringQuartetOpen(score);
  if (ensemble === "brass_ensemble") return mapPianoToBrassEnsembleOpen(score);
  if (ensemble === "woodwind_ensemble") return mapPianoToWoodwindEnsembleOpen(score);
  if (ensemble === "jazz_band") return mapPianoToJazzBandOpen(score);
  if (ensemble === "percussion") return mapPianoToPercussionOpen(score);

  if (ensemble === "full_orchestra") {
    return mapPianoToFullOrchestraOpen(score, req?.options);
  }

  return score;
}