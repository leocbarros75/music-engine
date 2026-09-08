import { exportMidi } from "../../../../src/score/midi";
export { exportMidi };

/** Encode and immediately trigger a browser download. */
export function downloadMidi(scoreModel: any, filename: string, bpm?: number): void {
  const data = exportMidi(scoreModel, bpm);
  const blob = new Blob([data.buffer as ArrayBuffer], { type: "audio/midi" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename.endsWith(".mid") ? filename : `${filename}.mid`;
  a.click();
  URL.revokeObjectURL(url);
}
