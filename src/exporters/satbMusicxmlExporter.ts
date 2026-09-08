// Compatibility entry point: SATB and instrumental scores use the same notation exporter.
import { exportScoreModelToMusicXML } from './musicxmlExporter';
import type { ScoreModel } from '../score/types';
export function exportSatbScoreModelToMusicXML(score: ScoreModel): string {
  return exportScoreModelToMusicXML(score);
}
