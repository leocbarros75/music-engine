import { useEffect } from "react";
import type { Settings } from "../types";

const ENSEMBLE_OPTIONS: Array<{ label: string; value: Settings["ensemble"] }> = [
  { label: "choral (SATB)", value: "choral" },
  { label: "piano", value: "piano" },
  { label: "piano with melody (RH)", value: "piano_with_melody" },
  { label: "string ensemble", value: "string_ensemble" },
  { label: "woodwind ensemble", value: "woodwind_ensemble" },
  { label: "brass ensemble", value: "brass_ensemble" },
  { label: "orchestra", value: "orchestra" }
];

const STYLE_OPTIONS: Settings["style"][] = ["classical", "worship", "latino", "pop", "rock", "funk", "samba"];
const LEVEL_OPTIONS: Settings["level"][] = ["beginner", "intermediate", "advanced", "professional"];
const ACCOMP_OPTIONS: Settings["accompaniment"][] = [
  "homophonic",
  "chordal",
  "polyphonic",
  "alberti_bass",
  "heterophonic"
];
const ACCOMP_HELP: Record<Settings["accompaniment"], string> = {
  homophonic: "Vertical texture: voices move together (shared rhythm).",
  chordal: "Block chord texture (piano-focused).",
  polyphonic: "Horizontal texture: independent melodic contours with shared harmony.",
  alberti_bass: "Patterned bass accompaniment (future refinement).",
  heterophonic: "Melody variants layered (future refinement)."
};
const TEXTURE_OPTIONS: Array<{ label: string; value: Settings["textureMode"]; help: string }> = [
  { label: "Homophony (homorhythmic)", value: "homophony_homorhythmic", help: "All voices share the same rhythm." },
  {
    label: "Homophony (melody + accompaniment)",
    value: "homophony_melody_accompaniment",
    help: "Melody leads; accompaniment supports."
  },
  { label: "Polyphony (counterpoint)", value: "polyphony", help: "Independent lines with shared harmony." },
  { label: "Heterophony", value: "heterophony", help: "Variations of the same melody." },
  { label: "Biphony (drone)", value: "biphony", help: "Melody plus sustained pitch." },
  { label: "Monophony", value: "monophony", help: "Single melodic line." }
];
const POLYPHONIC_PROFILES: Array<{ label: string; value: NonNullable<Settings["styleProfile"]>; help: string }> = [
  { label: "Baroque", value: "baroque", help: "Strict counterpoint and spacing." },
  { label: "Classical", value: "classical", help: "Balanced voice-leading rules." },
  { label: "Romantic", value: "romantic", help: "More flexible spacing and motion." },
  { label: "Modern", value: "modern", help: "Adaptive rules (tonal/modal/atonal)." }
];
const MODERN_MODES: Array<{ label: string; value: NonNullable<Settings["modernMode"]>; help: string }> = [
  { label: "Modern tonal", value: "modernTonal", help: "Extended harmony, tonal anchors." },
  { label: "Modal", value: "modal", help: "Controlled parallels allowed." },
  { label: "Atonal", value: "atonal", help: "No tonal resolution rules." }
];
const BASS_ACTIVITY_OPTIONS: Array<{ label: string; value: NonNullable<Settings["bassActivity"]>; help: string }> = [
  { label: "Less active (40%)", value: "less_active", help: "Occasional motion, mostly stable tones." },
  { label: "Active (60%)", value: "active", help: "More 8th-note motion, passing/neighbor tones." },
  { label: "High active (100%)", value: "high_active", help: "Continuous motion where possible." }
];
const INSTRUMENTATION_OPTIONS: Array<{ label: string; value: NonNullable<Settings["instrumentation"]>; help: string }> = [
  { label: "Auto arranger", value: "auto", help: "Use the current string arranging engine." },
  {
    label: "Piano -> String Quartet (Copy)",
    value: "piano_copy_to_string_quartet",
    help: "Copy piano voices directly: RH top->Violin I, RH inner->Violin II, LH top->Viola, LH bottom->Cello."
  },
  {
    label: "SATB -> String Quartet (Legacy)",
    value: "satb_to_string_quartet",
    help: "Legacy alias of the copy instrumentation mode."
  }
];
const STRICTNESS_OPTIONS: Array<{ label: string; value: Settings["ruleStrictness"]; help: string }> = [
  { label: "Relaxed", value: "relaxed", help: "Warnings only, fewer errors." },
  { label: "Standard", value: "standard", help: "Balanced warnings for most cases." },
  { label: "Strict", value: "strict", help: "Escalate core rules to errors." }
];
const STRICTNESS_BY_LEVEL: Record<Settings["level"], Settings["ruleStrictness"]> = {
  beginner: "strict",
  intermediate: "standard",
  advanced: "standard",
  professional: "relaxed"
};

const KEY_OPTIONS_MAJOR = [
  { label: "C major", value: "C major" },
  { label: "G major", value: "G major" },
  { label: "D major", value: "D major" },
  { label: "A major", value: "A major" },
  { label: "E major", value: "E major" },
  { label: "B major", value: "B major" },
  { label: "F# major", value: "F# major" },
  { label: "C# major", value: "C# major" },
  { label: "F major", value: "F major" },
  { label: "Bb major", value: "Bb major" },
  { label: "Eb major", value: "Eb major" },
  { label: "Ab major", value: "Ab major" },
  { label: "Db major", value: "Db major" },
  { label: "Gb major", value: "Gb major" },
  { label: "Cb major", value: "Cb major" }
];

const KEY_OPTIONS_MINOR = [
  { label: "A minor", value: "A minor" },
  { label: "E minor", value: "E minor" },
  { label: "B minor", value: "B minor" },
  { label: "F# minor", value: "F# minor" },
  { label: "C# minor", value: "C# minor" },
  { label: "G# minor", value: "G# minor" },
  { label: "D# minor", value: "D# minor" },
  { label: "A# minor", value: "A# minor" },
  { label: "D minor", value: "D minor" },
  { label: "G minor", value: "G minor" },
  { label: "C minor", value: "C minor" },
  { label: "F minor", value: "F minor" },
  { label: "Bb minor", value: "Bb minor" },
  { label: "Eb minor", value: "Eb minor" },
  { label: "Ab minor", value: "Ab minor" }
];
const TIME_OPTIONS = [
  { label: "Original (from file)", value: "original" },
  { label: "2/4", value: "2/4" },
  { label: "3/4", value: "3/4" },
  { label: "4/4", value: "4/4" },
  { label: "6/8", value: "6/8" },
  { label: "9/8", value: "9/8" },
  { label: "12/8", value: "12/8" }
];

type Props = {
  settings: Settings;
  onChange: (next: Settings) => void;
};

function titleize(input: string) {
  return input.replace(/_/g, " ");
}

export default function SettingsForm({ settings, onChange }: Props) {
  function update<K extends keyof Settings>(key: K, value: Settings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function updateEnsemble(nextEnsemble: Settings["ensemble"]) {
    const next = { ...settings, ensemble: nextEnsemble };
    if (nextEnsemble !== "piano" && nextEnsemble !== "piano_with_melody" && next.accompaniment === "chordal") {
      next.accompaniment = "homophonic";
    }
    onChange(next);
  }

  function updateLevel(nextLevel: Settings["level"]) {
    const nextStrictness = STRICTNESS_BY_LEVEL[nextLevel] ?? "standard";
    const next = { ...settings, level: nextLevel, ruleStrictness: nextStrictness };
    if (nextLevel !== "beginner" && next.accompaniment === "chordal") {
      next.accompaniment = "homophonic";
    }
    onChange(next);
  }

  const keyPreview =
    settings.keySignature === "original"
      ? "Original (from file)"
      : settings.keySignature
        ? settings.keySignature
        : "None";

  const textureHelp =
    TEXTURE_OPTIONS.find((opt) => opt.value === settings.textureMode)?.help ?? "Choose a texture target.";

  const profileHelp =
    POLYPHONIC_PROFILES.find((opt) => opt.value === settings.styleProfile)?.help ?? "Choose a profile.";

  const modernHelp =
    MODERN_MODES.find((opt) => opt.value === settings.modernMode)?.help ?? "Choose a modern mode.";
  const accompanimentHelp = ACCOMP_HELP[settings.accompaniment] ?? "Select an accompaniment texture.";
  const bassActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.bassActivity)?.help ?? "Choose activity level.";
  const tenorActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.tenorActivity)?.help ?? "Choose activity level.";
  const altoActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.altoActivity)?.help ?? "Choose activity level.";
  const sopranoActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.sopranoActivity)?.help ?? "Choose activity level.";
  const vln1ActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vln1Activity)?.help ?? "Choose activity level.";
  const vln2ActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vln2Activity)?.help ?? "Choose activity level.";
  const vlaActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vlaActivity)?.help ?? "Choose activity level.";
  const vcActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.vcActivity)?.help ?? "Choose activity level.";
  const cbActivityHelp =
    BASS_ACTIVITY_OPTIONS.find((opt) => opt.value === settings.cbActivity)?.help ?? "Choose activity level.";
  const instrumentationHelp =
    INSTRUMENTATION_OPTIONS.find((opt) => opt.value === settings.instrumentation)?.help ??
    "Choose instrumentation mapping.";
  const sopranoMelodyShare = Math.max(0, Math.min(100, settings.sopranoMelodyShare ?? 30));
  const offsetsHelp =
    settings.randomizeOffsets === false
      ? "Offsets disabled: rhythms align to downbeats."
      : "Offsets enabled: subtle syncopation and staggered entries.";
  const isPiano = settings.ensemble === "piano" || settings.ensemble === "piano_with_melody";
  const isStrings = settings.ensemble === "string_ensemble";
  const isWoodwinds = settings.ensemble === "woodwind_ensemble";
  const showPolyphonicControls = settings.accompaniment === "polyphonic" || settings.textureMode === "polyphony";
  const showChordalActivity = settings.accompaniment === "chordal" && isPiano && settings.level === "beginner";
  const showPianoSopranoActivity = isPiano;
  const showStringPolyphonic = isStrings && showPolyphonicControls;
  const showWoodwindPolyphonic = isWoodwinds && showPolyphonicControls;
  const showGenericPolyphonicVoices = showPolyphonicControls && !showStringPolyphonic && !showWoodwindPolyphonic;
  const accompanimentOptions = isPiano
    ? ACCOMP_OPTIONS
    : ACCOMP_OPTIONS.filter((opt) => opt !== "chordal");

  useEffect(() => {
    if (settings.ensemble !== "piano" && settings.ensemble !== "piano_with_melody" && settings.accompaniment === "chordal") {
      onChange({ ...settings, accompaniment: "homophonic" });
    }
  }, [settings, onChange]);

  useEffect(() => {
    if (settings.level !== "beginner" && settings.accompaniment === "chordal") {
      onChange({ ...settings, accompaniment: "homophonic" });
    }
  }, [settings, onChange]);

  return (
    <div className="settings-form">
      <div className="field">
        <label>Title</label>
        <input
          value={settings.title}
          onChange={(e) => update("title", e.target.value)}
          placeholder="Song title"
        />
      </div>

      <div className="field">
        <label>Ensemble</label>
        <select value={settings.ensemble} onChange={(e) => updateEnsemble(e.target.value as Settings["ensemble"])}>
          {ENSEMBLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {settings.ensemble !== "choral" &&
          settings.ensemble !== "piano" &&
          settings.ensemble !== "piano_with_melody" &&
          settings.ensemble !== "string_ensemble" &&
          settings.ensemble !== "woodwind_ensemble" && <div className="pill warn">Coming soon (SATB + piano + strings + woodwinds supported)</div>}
      </div>

      {settings.ensemble === "string_ensemble" && (
        <div className="field">
          <label>Instrumentation</label>
          <select
            value={settings.instrumentation ?? "auto"}
            onChange={(e) => update("instrumentation", e.target.value as Settings["instrumentation"])}
          >
            {INSTRUMENTATION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            <span className="slider-help">{instrumentationHelp}</span>
          </div>
        </div>
      )}

      <div className="field">
        <label>Key Signature</label>
        <select value={settings.keySignature} onChange={(e) => update("keySignature", e.target.value)}>
          <option value="original">Original (from file)</option>
          <optgroup label="Major">
            {KEY_OPTIONS_MAJOR.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Minor">
            {KEY_OPTIONS_MINOR.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </optgroup>
        </select>
        <div className="key-preview">
          Selected: <span className="key-badge">{keyPreview}</span>
        </div>
      </div>

      <div className="field">
        <label>Time Signature</label>
        <select
          value={settings.timeSignature}
          onChange={(e) => update("timeSignature", e.target.value)}
        >
          {TIME_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Tempo (BPM)</label>
        <input
          type="number"
          min={30}
          max={240}
          value={settings.tempo}
          onChange={(e) => update("tempo", Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>Style</label>
        <select value={settings.style} onChange={(e) => update("style", e.target.value as Settings["style"])}>
          {STYLE_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {titleize(opt)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Level</label>
        <select value={settings.level} onChange={(e) => updateLevel(e.target.value as Settings["level"])}>
          {LEVEL_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {titleize(opt)}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label>Accompaniment Type</label>
        <select
          value={settings.accompaniment}
          onChange={(e) => update("accompaniment", e.target.value as Settings["accompaniment"])}
        >
          {accompanimentOptions.map((opt) => (
            <option key={opt} value={opt}>
              {titleize(opt)}
            </option>
          ))}
        </select>
        <div className="key-preview">
          Selected: <span className="key-badge">{titleize(settings.accompaniment)}</span>
          <span className="slider-help">{accompanimentHelp}</span>
        </div>
        {!isPiano && <div className="pill warn">Chordal accompaniment is available for piano only.</div>}
        {isPiano && settings.accompaniment === "chordal" && settings.level !== "beginner" && (
          <div className="pill warn">Chordal accompaniment is beginner-only and will fall back to homophonic.</div>
        )}
      </div>

      <div className="field">
        <label>Texture Mode</label>
        <select
          value={settings.textureMode}
          onChange={(e) => update("textureMode", e.target.value as Settings["textureMode"])}
        >
          {TEXTURE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <div className="key-preview">
          Selected: <span className="key-badge">{titleize(settings.textureMode)}</span>
          <span className="slider-help">{textureHelp}</span>
        </div>
      </div>

      {showPolyphonicControls && (
        <div className="field">
          <label>Polyphonic Profile</label>
          <select
            value={settings.styleProfile ?? "classical"}
            onChange={(e) => update("styleProfile", e.target.value as Settings["styleProfile"])}
          >
            {POLYPHONIC_PROFILES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected: <span className="key-badge">{titleize(settings.styleProfile ?? "classical")}</span>
            <span className="slider-help">{profileHelp}</span>
          </div>
        </div>
      )}

      {showPolyphonicControls && settings.styleProfile === "modern" && (
        <div className="field">
          <label>Modern Mode</label>
          <select
            value={settings.modernMode ?? "modernTonal"}
            onChange={(e) => update("modernMode", e.target.value as Settings["modernMode"])}
          >
            {MODERN_MODES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected: <span className="key-badge">{titleize(settings.modernMode ?? "modernTonal")}</span>
            <span className="slider-help">{modernHelp}</span>
          </div>
        </div>
      )}

      {((showPolyphonicControls && !showWoodwindPolyphonic) || showChordalActivity) && (
        <div className="field">
          <label>{showChordalActivity && !showPolyphonicControls ? "Chordal Activity (Left Hand)" : "Polyphonic Activity (Bass)"}</label>
          <select
            value={settings.bassActivity ?? "grounded"}
            onChange={(e) => update("bassActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected: <span className="key-badge">{titleize(settings.bassActivity ?? "grounded")}</span>
            <span className="slider-help">{bassActivityHelp}</span>
          </div>
        </div>
      )}

      {showGenericPolyphonicVoices && (
        <div className="field">
          <label>Polyphonic Activity (Tenor)</label>
          <select
            value={settings.tenorActivity ?? settings.bassActivity ?? "less_active"}
            onChange={(e) => update("tenorActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">
              {titleize(settings.tenorActivity ?? settings.bassActivity ?? "less_active")}
            </span>
            <span className="slider-help">{tenorActivityHelp}</span>
          </div>
        </div>
      )}

      {showGenericPolyphonicVoices && (
        <div className="field">
          <label>Polyphonic Activity (Alto)</label>
          <select
            value={settings.altoActivity ?? settings.bassActivity ?? "less_active"}
            onChange={(e) => update("altoActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">
              {titleize(settings.altoActivity ?? settings.bassActivity ?? "less_active")}
            </span>
            <span className="slider-help">{altoActivityHelp}</span>
          </div>
        </div>
      )}

      {showWoodwindPolyphonic && (
        <div className="field">
          <label>Woodwind Polyphonic Activity (Bassoon)</label>
          <select
            value={settings.bassActivity ?? "less_active"}
            onChange={(e) => update("bassActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected: <span className="key-badge">{titleize(settings.bassActivity ?? "less_active")}</span>
            <span className="slider-help">{bassActivityHelp}</span>
          </div>
        </div>
      )}

      {showWoodwindPolyphonic && (
        <div className="field">
          <label>Woodwind Polyphonic Activity (Clarinet)</label>
          <select
            value={settings.tenorActivity ?? settings.bassActivity ?? "less_active"}
            onChange={(e) => update("tenorActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">
              {titleize(settings.tenorActivity ?? settings.bassActivity ?? "less_active")}
            </span>
            <span className="slider-help">{tenorActivityHelp}</span>
          </div>
        </div>
      )}

      {showWoodwindPolyphonic && (
        <div className="field">
          <label>Woodwind Polyphonic Activity (Oboe)</label>
          <select
            value={settings.altoActivity ?? settings.bassActivity ?? "less_active"}
            onChange={(e) => update("altoActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">
              {titleize(settings.altoActivity ?? settings.bassActivity ?? "less_active")}
            </span>
            <span className="slider-help">{altoActivityHelp}</span>
          </div>
        </div>
      )}

      {showWoodwindPolyphonic && (
        <div className="field">
          <label>Woodwind Polyphonic Activity (Flute)</label>
          <select
            value={settings.sopranoActivity ?? "less_active"}
            onChange={(e) => update("sopranoActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">{titleize(settings.sopranoActivity ?? "less_active")}</span>
            <span className="slider-help">{sopranoActivityHelp}</span>
          </div>
        </div>
      )}

      {showPianoSopranoActivity && (
        <div className="field">
          <label>Soprano Activity (RH Top)</label>
          <select
            value={settings.sopranoActivity ?? "less_active"}
            onChange={(e) => update("sopranoActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="key-preview">
            Selected:{" "}
            <span className="key-badge">{titleize(settings.sopranoActivity ?? "less_active")}</span>
            <span className="slider-help">{sopranoActivityHelp}</span>
          </div>
        </div>
      )}

      {showStringPolyphonic && (
        <div className="field">
          <label>String Polyphonic Activity (Violin I)</label>
          <select
            value={settings.vln1Activity ?? "grounded"}
            onChange={(e) => update("vln1Activity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="slider-meta">
            Selected: <span className="key-badge">{titleize(settings.vln1Activity ?? "grounded")}</span>
            <span className="slider-help">{vln1ActivityHelp}</span>
          </div>
        </div>
      )}

      {showStringPolyphonic && (
        <div className="field">
          <label>String Polyphonic Activity (Violin II)</label>
          <select
            value={settings.vln2Activity ?? "less_active"}
            onChange={(e) => update("vln2Activity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="slider-meta">
            Selected: <span className="key-badge">{titleize(settings.vln2Activity ?? "less_active")}</span>
            <span className="slider-help">{vln2ActivityHelp}</span>
          </div>
        </div>
      )}

      {showStringPolyphonic && (
        <div className="field">
          <label>String Polyphonic Activity (Viola)</label>
          <select
            value={settings.vlaActivity ?? "less_active"}
            onChange={(e) => update("vlaActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="slider-meta">
            Selected: <span className="key-badge">{titleize(settings.vlaActivity ?? "less_active")}</span>
            <span className="slider-help">{vlaActivityHelp}</span>
          </div>
        </div>
      )}

      {showStringPolyphonic && (
        <div className="field">
          <label>String Polyphonic Activity (Cello)</label>
          <select
            value={settings.vcActivity ?? "less_active"}
            onChange={(e) => update("vcActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="slider-meta">
            Selected: <span className="key-badge">{titleize(settings.vcActivity ?? "less_active")}</span>
            <span className="slider-help">{vcActivityHelp}</span>
          </div>
        </div>
      )}

      {showStringPolyphonic && (
        <div className="field">
          <label>String Polyphonic Activity (Double Bass)</label>
          <select
            value={settings.cbActivity ?? "less_active"}
            onChange={(e) => update("cbActivity", e.target.value as Settings["bassActivity"])}
          >
            {BASS_ACTIVITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <div className="slider-meta">
            Selected: <span className="key-badge">{titleize(settings.cbActivity ?? "less_active")}</span>
            <span className="slider-help">{cbActivityHelp}</span>
          </div>
        </div>
      )}

      {showPianoSopranoActivity && (
        <div className="field">
          <label>Soprano Melody Share (RH Top)</label>
          <input
            className="range-input"
            type="range"
            min={0}
            max={100}
            step={5}
            value={sopranoMelodyShare}
            onChange={(e) => update("sopranoMelodyShare", Number(e.target.value))}
          />
          <div className="slider-labels">
            <span className={sopranoMelodyShare <= 10 ? "active" : ""}>0%</span>
            <span className={sopranoMelodyShare >= 30 && sopranoMelodyShare <= 40 ? "active" : ""}>30%</span>
            <span className={sopranoMelodyShare >= 60 && sopranoMelodyShare <= 70 ? "active" : ""}>60%</span>
            <span className={sopranoMelodyShare >= 90 ? "active" : ""}>100%</span>
          </div>
          <div className="key-preview">
            Selected: <span className="key-badge">{sopranoMelodyShare}%</span>
            <span className="slider-help">Share of original melody used in RH top voice.</span>
          </div>
        </div>
      )}

      {showPolyphonicControls && (
        <div className="field">
          <label>Randomize Activity Offsets</label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={settings.randomizeOffsets !== false}
              onChange={(e) => update("randomizeOffsets", e.target.checked)}
            />
            <span>{settings.randomizeOffsets === false ? "Off" : "On"}</span>
          </label>
          <div className="key-preview">
            <span className="slider-help">{offsetsHelp}</span>
          </div>
        </div>
      )}

      <div className="field">
        <label>Rule Strictness</label>
        <input
          className="range-input"
          type="range"
          min={0}
          max={STRICTNESS_OPTIONS.length - 1}
          step={1}
          value={Math.max(0, STRICTNESS_OPTIONS.findIndex((opt) => opt.value === settings.ruleStrictness))}
          onChange={(e) => {
            const idx = Number(e.target.value);
            const next = STRICTNESS_OPTIONS[idx] ?? STRICTNESS_OPTIONS[1]!;
            update("ruleStrictness", next.value);
          }}
        />
        <div className="slider-labels">
          {STRICTNESS_OPTIONS.map((opt) => (
            <span key={opt.value} className={opt.value === settings.ruleStrictness ? "active" : ""}>
              {opt.label}
            </span>
          ))}
        </div>
        <div className="key-preview">
          Selected:{" "}
          <span className="key-badge">
            {STRICTNESS_OPTIONS.find((opt) => opt.value === settings.ruleStrictness)?.label ?? "Standard"}
          </span>
          <span className="slider-help">
            {STRICTNESS_OPTIONS.find((opt) => opt.value === settings.ruleStrictness)?.help ?? ""}
          </span>
        </div>
      </div>
    </div>
  );
}
