import type { ScoreModel } from "../score/types";
type Issue = {
    severity: "error" | "warning";
    type: string;
    message: string;
    location?: any;
};
export declare function repairScoreModel(scoreModel: ScoreModel, issues: Issue[]): {
    scoreModel: ScoreModel;
    applied: {
        type: string;
        changed: boolean;
        note?: string;
    }[];
};
export {};
//# sourceMappingURL=repairEngine.d.ts.map