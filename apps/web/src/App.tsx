import { useRef, useState } from "react";
import SettingsForm from "./components/SettingsForm";
import PromptAssistant from "./components/PromptAssistant";
import ScoreViewer from "./components/ScoreViewer";
import AudioPlayer from "./components/AudioPlayer";
import PartsSelector from "./components/PartsSelector";
import LandingPage from "./components/LandingPage";
import { downloadMidi } from "./utils/midiExporter";
import type { JobResult, Settings } from "./types";

const DEFAULT_SETTINGS: Settings = {
  title: "",
  ensemble: "choral",
  keySignature: "original",
  timeSignature: "original",
  tempo: 120,
  style: "classical",
  level: "intermediate",
  accompaniment: "homophonic",
  ruleStrictness: "standard",
  textureMode: "homophony_homorhythmic",
  styleProfile: "classical",
  modernMode: "modernTonal",
  bassActivity: "less_active",
  tenorActivity: "less_active",
  altoActivity: "less_active",
  sopranoActivity: "less_active",
  vln1Activity: "grounded",
  vln2Activity: "less_active",
  vlaActivity: "less_active",
  vcActivity: "less_active",
  cbActivity: "less_active",
  instrumentation: "auto",
  sopranoMelodyShare: 30,
  randomizeOffsets: true,
};

function downloadXml(xml: string, filename: string) {
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Quick client-side MusicXML sanity check before uploading */
function validateXmlClient(text: string): string | null {
  if (!text.trimStart().startsWith("<?xml") && !text.trimStart().startsWith("<score")) {
    return "This doesn't look like an XML file. Please upload a .musicxml or .xml file.";
  }
  if (!/<score-partwise|<score-timewise/i.test(text)) {
    return "File is not a valid MusicXML document. Make sure you exported it as MusicXML from your notation software.";
  }
  return null;
}

export default function App() {
  const [view, setView] = useState<"landing" | "studio">("landing");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState("");
  const [inputMode, setInputMode] = useState<"file" | "chords">("file");
  const [chordText, setChordText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [musicxmlInput, setMusicxmlInput] = useState<string | null>(null);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [outputMusicxml, setOutputMusicxml] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const ensembleReady =
    settings.ensemble === "choral" ||
    settings.ensemble === "piano" ||
    settings.ensemble === "piano_with_melody" ||
    settings.ensemble === "string_ensemble" ||
    settings.ensemble === "woodwind_ensemble" ||
    settings.ensemble === "brass_ensemble" ||
    settings.ensemble === "orchestra";

  const canRunFile   = !!musicxmlInput && ensembleReady && !isRunning && !isExtracting;
  const canRunChords = !!chordText.trim() && ensembleReady && !isRunning;
  const canRun = inputMode === "file" ? canRunFile : canRunChords;

  // ── File selection ────────────────────────────────────────────────────────
  async function loadExample(exampleId: string) {
    if (!exampleId) return;
    try {
      const res = await fetch(`/examples/${exampleId}.musicxml`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const err = validateXmlClient(text);
      if (err) { setWarnings([err]); return; }
      setFileName(`${exampleId}.musicxml`);
      setMusicxmlInput(text);
      setOutputMusicxml(null);
      setJobResult(null);
      setWarnings([]);
      setSelectedPartIds([]);
    } catch (e: any) {
      setWarnings([`Could not load example: ${e?.message ?? String(e)}`]);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result;
      if (typeof text !== "string") return;
      const err = validateXmlClient(text);
      if (err) {
        setWarnings([err]);
        setMusicxmlInput(null);
        setFileName(null);
        return;
      }
      setFileName(file.name);
      setMusicxmlInput(text);
      setOutputMusicxml(null);
      setJobResult(null);
      setWarnings([]);
      setSelectedPartIds([]);
    };
    reader.readAsText(file);
    // Reset the input so the same file can be re-selected if needed
    e.target.value = "";
  }

  // ── Auto-fill title from uploaded file ───────────────────────────────────
  function handleTitleDetected(title: string) {
    // Only auto-fill if the user hasn't typed a title yet
    setSettings((prev) => prev.title ? prev : { ...prev, title });
  }

  // ── Switch input mode ─────────────────────────────────────────────────────
  function switchMode(mode: "file" | "chords") {
    setInputMode(mode);
    setWarnings([]);
    setOutputMusicxml(null);
    setJobResult(null);
  }

  // ── Extract parts (no arrangement) ───────────────────────────────────────
  async function extractParts(ids: string[]) {
    if (!musicxmlInput || !ids.length) return;
    setIsExtracting(true);
    setWarnings([]);
    try {
      const res = await fetch("/extract_part", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ musicxml: musicxmlInput, partIds: ids }),
      });
      const json = await res.json();
      if (!json.ok) { setWarnings([json.error ?? "Extraction failed."]); return; }
      const partNames = (json.extractedParts ?? []).map((p: any) => p.name || p.id).join("_");
      downloadXml(json.musicxml, `${partNames || "extracted"}.musicxml`);
    } catch (err: any) {
      setWarnings([err?.message ?? "Network error"]);
    } finally {
      setIsExtracting(false);
    }
  }

  // ── Parse PDF chord sheet ─────────────────────────────────────────────────
  async function handlePdfChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setWarnings(["Please select a PDF file."]);
      return;
    }

    setIsParsing(true);
    setWarnings([]);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

      const res = await fetch("/parse_pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdfBase64: base64 }),
      });
      const json = await res.json();

      if (!json.ok) {
        setWarnings([json.error ?? "Could not extract chords from PDF."]);
        return;
      }

      setChordText(json.chords);
      // Auto-fill title from PDF filename
      if (!settings.title) {
        const name = file.name.replace(/\.pdf$/i, "").replace(/[-_]/g, " ");
        setSettings(prev => prev.title ? prev : { ...prev, title: name });
      }
    } catch (err: any) {
      setWarnings([err?.message ?? "Network error"]);
    } finally {
      setIsParsing(false);
    }
  }

  // ── Generate from MusicXML file ───────────────────────────────────────────
  async function runPipeline() {
    if (!musicxmlInput || !ensembleReady) return;
    setIsRunning(true);
    setWarnings([]);
    setJobResult(null);
    setOutputMusicxml(null);

    try {
      const keySignatureMode = settings.keySignature === "original" ? "original" : "manual";
      const timeSignatureMode = settings.timeSignature === "original" ? "original" : "manual";

      const res = await fetch("/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          musicxml: musicxmlInput,
          partIds: selectedPartIds,
          settings: { ...settings, keySignatureMode, timeSignatureMode },
          options: { keepMelodyInSoprano: true },
        }),
      });

      const json: JobResult = await res.json();
      setJobResult(json);
      if (!json.ok) { setWarnings([json.error ?? "Unknown error"]); return; }
      if (json.warnings?.length) setWarnings(json.warnings);
      if (json.musicxml) setOutputMusicxml(json.musicxml);
    } catch (err: any) {
      setWarnings([err?.message ?? "Network error"]);
    } finally {
      setIsRunning(false);
    }
  }

  // ── Generate from chord progression ──────────────────────────────────────
  async function runFromChords() {
    if (!chordText.trim() || !ensembleReady) return;
    setIsRunning(true);
    setWarnings([]);
    setJobResult(null);
    setOutputMusicxml(null);

    try {
      const keySignatureMode = settings.keySignature === "original" ? "original" : "manual";
      const timeSignatureMode = settings.timeSignature === "original" ? "original" : "manual";

      const res = await fetch("/generate_from_chords", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chords: chordText,
          settings: { ...settings, keySignatureMode, timeSignatureMode },
          options: { keepMelodyInSoprano: true },
        }),
      });

      const json: JobResult = await res.json();
      setJobResult(json);
      if (!json.ok) { setWarnings([json.error ?? "Unknown error"]); return; }
      if (json.warnings?.length) setWarnings(json.warnings);
      if (json.musicxml) setOutputMusicxml(json.musicxml);
    } catch (err: any) {
      setWarnings([err?.message ?? "Network error"]);
    } finally {
      setIsRunning(false);
    }
  }

  // ── Landing page ─────────────────────────────────────────────────────────
  if (view === "landing") {
    return <LandingPage onEnterStudio={() => setView("studio")} />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Music Engine Studio</h1>
          <p>AI-powered arrangement — SATB, piano, strings, woodwinds, brass, orchestra.</p>
        </div>
        <button className="ghost" onClick={() => setView("landing")} style={{ fontSize: "12px" }}>
          ← Home
        </button>
      </header>

      <div className="app-body">
        <aside className="sidebar">
          <section className="panel">
            <h2>Settings</h2>
            <SettingsForm settings={settings} onChange={setSettings} />
          </section>
        </aside>

        <main className="main-content">
          {/* ── Input mode toggle + file / chord input ────────────── */}
          <section className="panel upload-panel">
            <h2>Input</h2>

            {/* Mode toggle */}
            <div className="input-mode-toggle">
              <button
                className={inputMode === "file" ? "mode-btn active" : "mode-btn"}
                onClick={() => switchMode("file")}
              >
                📄 MusicXML file
              </button>
              <button
                className={inputMode === "chords" ? "mode-btn active" : "mode-btn"}
                onClick={() => switchMode("chords")}
              >
                🎵 Chord symbols
              </button>
            </div>

            {/* File input */}
            {inputMode === "file" && (
              <div className="upload-card">
                <p>Upload a <code>.musicxml</code> or <code>.xml</code> file exported from MuseScore, Finale, or Sibelius.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".musicxml,.xml"
                  style={{ display: "none" }}
                  onChange={handleFileChange}
                />
                <button className="primary" onClick={() => fileInputRef.current?.click()}>
                  Select MusicXML
                </button>
                {/* Load built-in example — shown when a string example is selected */}
                {settings.ensemble === "string_ensemble" && settings.stringExample && (
                  <button
                    className="secondary"
                    style={{ marginLeft: "0.5rem" }}
                    onClick={() => loadExample(settings.stringExample!)}
                  >
                    Load Example
                  </button>
                )}
                {fileName && (
                  <div className="file-meta">
                    <span className="label">Selected:</span> {fileName}
                  </div>
                )}

                {/* Part selector */}
                <PartsSelector
                  musicxml={musicxmlInput}
                  selectedIds={selectedPartIds}
                  onChange={setSelectedPartIds}
                  onExtract={extractParts}
                  onTitleDetected={handleTitleDetected}
                />
              </div>
            )}

            {/* Chord input */}
            {inputMode === "chords" && (
              <div className="chord-input-card">
                <p>
                  Enter chords separated by spaces. Use <code>|</code> for bar lines.
                  <br />
                  <span className="chord-example">e.g. <code>Dm7 G7 Cmaj7 | Em7b5 A7b9 Dm7 | Cmaj9</code></span>
                </p>

                {/* PDF import */}
                <div className="pdf-import-row">
                  <input
                    ref={pdfInputRef}
                    type="file"
                    accept=".pdf"
                    style={{ display: "none" }}
                    onChange={handlePdfChange}
                  />
                  <button
                    className="ghost"
                    onClick={() => pdfInputRef.current?.click()}
                    disabled={isParsing}
                    title="Import chords from a PDF chord chart"
                  >
                    {isParsing ? "Reading PDF…" : "📄 Import from PDF"}
                  </button>
                  <span className="muted" style={{ fontSize: "11px" }}>
                    Accepts text-based chord charts (Real Book, lead sheets, etc.)
                  </span>
                </div>

                <textarea
                  className="chord-textarea"
                  placeholder={"Dm7 G7 Cmaj7 | Em7b5 A7b9 Dm7 | Cmaj9"}
                  value={chordText}
                  onChange={(e) => setChordText(e.target.value)}
                  rows={4}
                />
                <div className="chord-hint">
                  <strong>Triads:</strong> C · Cm · Cdim · Caug · Csus2 · Csus4
                  &nbsp;·&nbsp; <strong>7ths:</strong> Cmaj7 · C7 · Cm7 · Cm7b5 · Cdim7 · C7sus4
                  &nbsp;·&nbsp; <strong>Extensions:</strong> Cmaj9 · C9 · C11 · C13 · C7#11 · C7b9 · Cm9 · Cm11
                  &nbsp;·&nbsp; <strong>Slash:</strong> G/B · Cm7/Eb
                </div>
              </div>
            )}

            {/* Prompt */}
            <div className="prompt-block">
              <h3>Prompt <span className="muted" style={{ fontWeight: 400, fontSize: "11px" }}>(optional)</span></h3>
              <textarea
                placeholder="Describe intent, voicing, or texture..."
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
              />
            </div>
            {inputMode === "file" && (
              <PromptAssistant settings={settings} prompt={prompt} onApply={setPrompt} />
            )}
          </section>

          {/* ── Generate action ───────────────────────────────────── */}
          <section className="panel action-panel">
            <div className="action-row">
              <button
                className="primary large"
                disabled={!canRun}
                onClick={inputMode === "file" ? runPipeline : runFromChords}
              >
                {isRunning ? "Generating…" : "Generate Arrangement"}
              </button>
              {isExtracting && <span className="muted">Extracting parts…</span>}
            </div>

            {warnings.length > 0 && (
              <div className="warnings-list">
                {warnings.map((w, i) => <div key={i} className="warning-item">{w}</div>)}
              </div>
            )}

            {jobResult?.ok && jobResult.meta && (
              <div className="result-summary">
                {jobResult.meta.title && (
                  <div className="result-row"><span className="label">Title</span><span>{jobResult.meta.title}</span></div>
                )}
                <div className="result-row"><span className="label">Ensemble</span>    <span>{jobResult.meta.ensemble}</span></div>
                <div className="result-row"><span className="label">Style used</span>  <span>{jobResult.meta.styleUsed ?? "—"}</span></div>
                <div className="result-row"><span className="label">Chord source</span><span>{jobResult.meta.chordSource}</span></div>
                <div className="result-row"><span className="label">Chords</span>      <span>{jobResult.meta.chordEventCount}</span></div>
                {jobResult.meta.cadenceMeasures.length > 0 && (
                  <div className="result-row">
                    <span className="label">Cadence measures</span>
                    <span>{jobResult.meta.cadenceMeasures.join(", ")}</span>
                  </div>
                )}
                {/* Orchestra / multi-part: show instrument list */}
                {jobResult.meta.parts && jobResult.meta.parts.length > 4 && (
                  <div className="result-parts">
                    <span className="result-parts-label">Parts ({jobResult.meta.parts.length})</span>
                    <div className="result-parts-list">
                      {jobResult.meta.parts.map((p, i) => (
                        <span key={i} className="result-part-chip">{p.name || p.instrument}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="result-actions">
                  <button
                    onClick={() => downloadXml(outputMusicxml!, `${settings.title || jobResult.meta?.title || "arrangement"}.musicxml`)}
                    disabled={!outputMusicxml}
                  >
                    ↓ MusicXML
                  </button>
                  <button
                    onClick={() => downloadMidi(
                      jobResult?.scoreModel,
                      settings.title || jobResult.meta?.title || "arrangement",
                    )}
                    disabled={!jobResult?.scoreModel}
                    style={{ marginLeft: "8px" }}
                  >
                    ↓ MIDI
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* ── Score preview + audio ─────────────────────────────── */}
          {outputMusicxml && (
            <section className="panel score-panel">
              <div className="score-panel-header">
                <h2>Score Preview</h2>
                <AudioPlayer scoreModel={(jobResult?.scoreModel as any) ?? null} />
              </div>
              <ScoreViewer musicxml={outputMusicxml} />
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
