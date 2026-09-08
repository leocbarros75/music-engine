import { normalizeAppSettings } from './normalizeAppSettings';
import { validateMusicXml } from './validateMusicXml';
import { selectSourceParts } from '../preservation/sourcePreservation';
import { pipelineMusicxmlToArrangedMusicxml, type PipelineResult, type PipelineError } from '../pipeline/pipelineMusicxmlToArrangedMusicxml';

/** Application boundary shared by desktop, web and MusicXML compatibility routes. */
export function generateArrangement(body: Record<string, unknown>): PipelineResult | PipelineError {
  try {
    if (typeof body.musicxml !== 'string' || !body.musicxml) {
      return { ok: false, error: "Provide 'musicxml' as a string in the request body.", warnings: [] };
    }
    const validation = validateMusicXml(body.musicxml);
    if (!validation.ok) return { ok: false, error: (validation as { error: string }).error, warnings: [] };
    const settings = normalizeAppSettings(body.settings);
    const partIds = Array.isArray(body.partIds) ? body.partIds.map(String) : [];
    const musicxml = selectSourceParts(body.musicxml, partIds, settings.preserveSource !== false);
    return pipelineMusicxmlToArrangedMusicxml({
      musicxml, settings, phrasePlan: body.phrasePlan,
      chords: Array.isArray(body.chords) ? body.chords : undefined,
      options: body.options && typeof body.options === 'object' && !Array.isArray(body.options)
        ? body.options as Record<string, unknown> : {}
    });
  } catch (error) {
    return { ok: false, error: (error as Error).message, warnings: [] };
  }
}
