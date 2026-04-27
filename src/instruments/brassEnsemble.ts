// src/instruments/brassEnsemble.ts

export type EnsemblePartDef = {
  part_id: string;
  name: string;
  instrument: string;
  staves: number;
};

/**
 * BRASS ENSEMBLE (default)
 * Practical 5-part brass ensemble:
 * - 2 Trumpets
 * - 1 Trombone
 * - 1 Bass Trombone
 * - 1 Tuba
 */
export const BRASS_ENSEMBLE_PARTS: EnsemblePartDef[] = [
  { part_id: "TPT1", name: "Trumpet 1", instrument: "trumpet_bb_1", staves: 1 },
  { part_id: "TPT2", name: "Trumpet 2", instrument: "trumpet_bb_2", staves: 1 },
  { part_id: "TBN1", name: "Trombone", instrument: "trombone", staves: 1 },
  { part_id: "BTBN", name: "Bass Trombone", instrument: "bass_trombone", staves: 1 },
  { part_id: "TUBA", name: "Tuba", instrument: "tuba_c", staves: 1 }
];
