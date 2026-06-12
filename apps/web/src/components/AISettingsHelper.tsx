/**
 * AISettingsHelper.tsx
 *
 * Lets the user describe what they want in plain language — "Make it sound
 * like Bach", "Romantic piano waltz, slow and melancholic" — and translates
 * that into concrete engine settings via the /parse_prompt endpoint.
 *
 * Props:
 *   settings        — current Settings object (sent as context to the AI)
 *   onSettingsChange — called with the partial settings diff to apply
 */

import { useState } from "react";
import type { Settings } from "../types";

type ParseResult = {
  settings: Record<string, string | number | boolean>;
  explanation: string;
  suggestions?: string[];
};

type Props = {
  settings: Settings;
  onSettingsChange: (updates: Partial<Settings>) => void;
};

/** Build a compact plain-text summary of current settings for context */
function buildSettingsSummary(s: Settings): string {
  const parts: string[] = [
    `ensemble: ${s.ensemble}`,
    `style: ${s.style}`,
    `level: ${s.level}`,
    `tempo: ${s.tempo} BPM`,
    `accompaniment: ${s.accompaniment}`,
    `textureMode: ${s.textureMode}`,
  ];
  if (s.styleProfile) parts.push(`styleProfile: ${s.styleProfile}`);
  if (s.lhPattern && s.lhPattern !== "auto") parts.push(`lhPattern: ${s.lhPattern}`);
  if (s.rhPattern) parts.push(`rhPattern: ${s.rhPattern}`);
  return parts.join(", ");
}

/** Human-readable label for a settings key */
function labelFor(key: string): string {
  const MAP: Record<string, string> = {
    ensemble: "Ensemble",
    style: "Style",
    level: "Level",
    tempo: "Tempo (BPM)",
    accompaniment: "Accompaniment",
    textureMode: "Texture mode",
    styleProfile: "Style profile",
    ruleStrictness: "Rule strictness",
    lhPattern: "LH pattern",
    rhPattern: "RH pattern",
    bassRhythm: "Bass note value",
    bassFinalNote: "Bass final note",
    timeSignature: "Time signature",
    sopranoActivity: "Soprano activity",
    altoActivity: "Alto activity",
    tenorActivity: "Tenor activity",
    bassActivity: "Bass activity",
    vln1Activity: "Violin I activity",
    vln2Activity: "Violin II activity",
    vlaActivity: "Viola activity",
    vcActivity: "Cello activity",
  };
  return MAP[key] ?? key.replace(/([A-Z])/g, " $1").toLowerCase();
}

export default function AISettingsHelper({ settings, onSettingsChange }: Props) {
  const [input, setInput]     = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult]   = useState<ParseResult | null>(null);
  const [error, setError]     = useState<string | null>(null);

  async function askAI() {
    const trimmed = input.trim();
    if (!trimmed) return;
    setIsLoading(true);
    setResult(null);
    setError(null);

    try {
      const res = await fetch("/parse_prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: trimmed,
          currentSettingsSummary: buildSettingsSummary(settings),
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error ?? "AI could not process your request.");
        return;
      }
      setResult({
        settings:    json.settings    ?? {},
        explanation: json.explanation ?? "Settings updated.",
        suggestions: Array.isArray(json.suggestions) ? json.suggestions : undefined,
      });
    } catch (err: any) {
      setError(err?.message ?? "Network error — could not reach server.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Shift+Enter = newline; plain Enter = submit
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askAI();
    }
  }

  function applySettings() {
    if (!result) return;
    onSettingsChange(result.settings as Partial<Settings>);
    setResult(null);
    setInput("");
  }

  function dismiss() {
    setResult(null);
    setError(null);
  }

  const hasChanges = result && Object.keys(result.settings).length > 0;

  return (
    <div className="ai-helper">
      <div className="ai-helper-header">
        <div>
          <h3>AI Settings Helper</h3>
          <p>Describe the sound you want — AI translates it into engine settings.</p>
        </div>
      </div>

      <div className="ai-helper-input-row">
        <textarea
          className="ai-helper-textarea"
          placeholder={`"Make it sound like Bach"\n"Romantic piano waltz, Chopin feel"\n"Pop ballad, slow, like Elton John"`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          disabled={isLoading}
        />
        <button
          className="primary ai-helper-ask-btn"
          onClick={askAI}
          disabled={!input.trim() || isLoading}
        >
          {isLoading ? "Asking…" : "Ask AI"}
        </button>
      </div>

      {error && (
        <div className="ai-helper-error">
          {error}
          <button className="ghost ai-helper-dismiss" onClick={dismiss}>✕</button>
        </div>
      )}

      {result && (
        <div className="ai-helper-result">
          {/* Explanation */}
          <div className="ai-helper-explanation">{result.explanation}</div>

          {/* Settings preview */}
          {hasChanges && (
            <div className="ai-helper-settings-preview">
              <div className="ai-helper-preview-label">Settings to apply:</div>
              <ul className="ai-helper-settings-list">
                {Object.entries(result.settings).map(([key, val]) => (
                  <li key={key}>
                    <span className="ai-helper-key">{labelFor(key)}</span>
                    <span className="ai-helper-arrow">→</span>
                    <span className="ai-helper-val">{String(val)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggestions */}
          {result.suggestions && result.suggestions.length > 0 && (
            <div className="ai-helper-suggestions">
              <div className="ai-helper-preview-label">Suggestions:</div>
              <ul>
                {result.suggestions.map((s, i) => (
                  <li key={i} className="ai-helper-suggestion-item">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Actions */}
          <div className="ai-helper-actions">
            {hasChanges && (
              <button className="primary" onClick={applySettings}>
                Apply Settings
              </button>
            )}
            <button className="ghost" onClick={dismiss}>
              {hasChanges ? "Cancel" : "Dismiss"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
