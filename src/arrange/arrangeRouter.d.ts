import type { ScoreModel } from "../score/types";
import type { FullOrchestraOptions } from "./types";
export type ArrangeIntent = "instrumentation_only" | "new_arrangement";
export type ArrangeEnsemble = "string_quartet" | "brass_ensemble" | "woodwind_ensemble" | "jazz_band" | "percussion" | "full_orchestra";
export type ArrangeRequest = {
    intent: ArrangeIntent;
    target: {
        ensemble: ArrangeEnsemble;
        spacing?: "open_classical" | "compact";
    };
    options?: FullOrchestraOptions;
};
export declare function arrangeScoreModel(score: ScoreModel, req: ArrangeRequest): ScoreModel;
//# sourceMappingURL=arrangeRouter.d.ts.map