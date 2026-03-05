import { mapPianoToStringQuartetOpen } from "./mapToEnsemble";
import { mapPianoToBrassEnsembleOpen } from "./mapToBrassEnsemble";
import { mapPianoToWoodwindEnsembleOpen } from "./mapToWoodwindEnsemble";
import { mapPianoToJazzBandOpen } from "./mapToJazzBand";
import { mapPianoToPercussionOpen } from "./mapToPercussion";
import { mapPianoToFullOrchestraOpen } from "./mapToFullOrchestra";
export function arrangeScoreModel(score, req) {
    const ensemble = req?.target?.ensemble;
    if (ensemble === "string_quartet")
        return mapPianoToStringQuartetOpen(score);
    if (ensemble === "brass_ensemble")
        return mapPianoToBrassEnsembleOpen(score);
    if (ensemble === "woodwind_ensemble")
        return mapPianoToWoodwindEnsembleOpen(score);
    if (ensemble === "jazz_band")
        return mapPianoToJazzBandOpen(score);
    if (ensemble === "percussion")
        return mapPianoToPercussionOpen(score);
    if (ensemble === "full_orchestra") {
        return mapPianoToFullOrchestraOpen(score, req?.options);
    }
    return score;
}
//# sourceMappingURL=arrangeRouter.js.map