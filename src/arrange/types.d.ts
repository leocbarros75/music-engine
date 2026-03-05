export type ParticipationTargets = {
    strings?: number;
    woodwinds?: number;
    brass?: number;
    percussion?: number;
};
export type FullOrchestraProfile = "classical";
export type FullOrchestraOptions = {
    profile?: FullOrchestraProfile;
    phraseLen?: 1 | 2 | 4 | 8;
    blockMeasures?: 1 | 2 | 4 | 8;
    targets?: ParticipationTargets;
    rangeMode?: "preferred" | "absolute" | "both";
};
//# sourceMappingURL=types.d.ts.map