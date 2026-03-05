import type { Settings } from "../types";

type Props = {
  settings: Settings;
  prompt: string;
  onApply: (value: string) => void;
};

function titleize(input: string) {
  return input.replace(/_/g, " ");
}

function buildSuggestedPrompt(settings: Settings, prompt: string) {
  const title = settings.title || "Untitled";
  const ensemble = titleize(settings.ensemble);
  const key = settings.keySignature === "original" ? "original key" : settings.keySignature || "C";
  const time = settings.timeSignature === "original" ? "original time" : settings.timeSignature || "4/4";
  const tempo = settings.tempo || 120;
  const style = settings.style;
  const level = settings.level;
  const accompaniment = titleize(settings.accompaniment);
  const texture = titleize(settings.textureMode);
  const polyProfile = settings.accompaniment === "polyphonic" ? titleize(settings.styleProfile ?? "classical") : "";
  const modernMode =
    settings.accompaniment === "polyphonic" && settings.styleProfile === "modern"
      ? titleize(settings.modernMode ?? "modernTonal")
      : "";
  const bassActivity =
    settings.accompaniment === "polyphonic" || settings.textureMode === "polyphony"
      ? titleize(settings.bassActivity ?? "grounded")
      : "";
  const tenorActivity =
    settings.accompaniment === "polyphonic" || settings.textureMode === "polyphony"
      ? titleize(settings.tenorActivity ?? settings.bassActivity ?? "grounded")
      : "";
  const altoActivity =
    settings.accompaniment === "polyphonic" || settings.textureMode === "polyphony"
      ? titleize(settings.altoActivity ?? settings.bassActivity ?? "grounded")
      : "";
  const pianoEnsemble = settings.ensemble === "piano" || settings.ensemble === "piano_with_melody";
  const sopranoActivity = pianoEnsemble ? titleize(settings.sopranoActivity ?? settings.bassActivity ?? "grounded") : "";
  const sopranoShare = pianoEnsemble ? settings.sopranoMelodyShare ?? 30 : null;

  const profileText = polyProfile ? ` Polyphonic profile ${polyProfile}${modernMode ? ` (${modernMode})` : ""}.` : "";
  const activityText =
    bassActivity || tenorActivity || altoActivity || sopranoActivity
      ? ` Polyphonic activity Bass ${bassActivity || "Less active"}, Tenor ${tenorActivity || "Less active"}, Alto ${
          altoActivity || "Less active"
        }, Soprano ${sopranoActivity || "Less active"}. Melody share ${sopranoShare ?? 30}%. Offsets ${
          settings.randomizeOffsets === false ? "off" : "on"
        }.`
      : "";
  const base = `Arrange "${title}" for ${ensemble}. Key ${key}, ${time}, ${tempo} BPM. Style ${style}, level ${level}, accompaniment ${accompaniment}, texture ${texture}.${profileText}${activityText}`;
  if (prompt.trim()) {
    return `${base} Additional intent: ${prompt.trim()}`;
  }
  return base;
}

export default function PromptAssistant({ settings, prompt, onApply }: Props) {
  const suggestion = buildSuggestedPrompt(settings, prompt);

  return (
    <div className="prompt-assistant">
      <div className="prompt-header">
        <div>
          <h3>Prompt Assistant</h3>
          <p>Suggested prompt from your settings.</p>
        </div>
        <button className="ghost" onClick={() => onApply(suggestion)}>
          Use Suggested
        </button>
      </div>
      <div className="prompt-suggestion">{suggestion}</div>
    </div>
  );
}
