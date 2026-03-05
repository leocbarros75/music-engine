import type { ScoreModel } from "../score/types";
type Issue = {
    severity: "error" | "warning";
    type: string;
    message: string;
    location?: {
        part_id?: string;
        measure?: number;
        t?: number;
        event_id?: string;
        top_event_id?: string;
        bot_event_id?: string;
        staff?: number;
        voice?: number;
    };
};
export declare function validateScoreModelPiano(score: ScoreModel): {
    ok: boolean;
    issues: Issue[];
};
export {};
//# sourceMappingURL=scoreModelValidator.d.ts.map