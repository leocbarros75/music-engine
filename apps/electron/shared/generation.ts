import type { Settings } from './ipcTypes';

export function generationRequest(musicxml: string, settings: Settings) {
  return { musicxml, settings, options: { keepMelodyInSoprano: true } };
}

/** Reject outdated/partial responses instead of silently exporting a different score. */
export function requireGeneratedMusicxml(result: any): asserts result is { ok: true; musicxml: string; [key: string]: any } {
  if (result?.ok !== true || typeof result.musicxml !== 'string' || !result.musicxml) {
    throw new Error('The server returned no MusicXML. Update/restart the backend and try again.');
  }
}
