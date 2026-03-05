// src/instruments/brassEnsemble.ts
/**
 * BRASS ENSEMBLE (default)
 * Practical, common church/community brass ensemble:
 * - 2 Trumpets
 * - 1 Horn
 * - 1 Trombone
 * - 1 Bass Trombone (or 2nd Trombone)
 * - 1 Tuba
 */
export const BRASS_ENSEMBLE_PARTS = [
    { part_id: "TPT1", name: "Trumpet 1", instrument: "trumpet", staves: 1 },
    { part_id: "TPT2", name: "Trumpet 2", instrument: "trumpet", staves: 1 },
    { part_id: "HN1", name: "Horn", instrument: "horn", staves: 1 },
    { part_id: "TBN1", name: "Trombone", instrument: "trombone", staves: 1 },
    { part_id: "BTBN", name: "Bass Trombone", instrument: "bass_trombone", staves: 1 },
    { part_id: "TUBA", name: "Tuba", instrument: "tuba", staves: 1 }
];
//# sourceMappingURL=brassEnsemble.js.map