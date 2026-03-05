import type { ScoreModel } from "../score/types";
type Issue = {
    severity: "error" | "warning";
    type: string;
    message: string;
    location?: any;
};
type RepairAction = {
    type: string;
    changed: boolean;
    note?: string;
};
/**
 * repairScoreModel(score, issues)
 * Returns:
 *  { ok: true, scoreModel: repairedScore, applied: RepairAction[] }
 */
export declare function repairScoreModel(scoreModel: ScoreModel, issues: Issue[]): {
    ok: boolean;
    scoreModel: ScoreModel;
    applied: RepairAction[];
};
export {};
//# sourceMappingURL=repairScoreModel.d.ts.map