import { useEffect, useMemo, useState } from "react";
import SettingsForm from "./components/SettingsForm";
import LogsPanel from "./components/LogsPanel";
import PromptAssistant from "./components/PromptAssistant";
import DebugPanel from "./components/DebugPanel";
import ViolationsPanel from "./components/ViolationsPanel";
import type { JobResult, LogEntry, MusicXmlFile, Settings } from "./types";

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
  textureMode: "homophony_melody_accompaniment",
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
  randomizeOffsets: true
};

export default function App() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<MusicXmlFile | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [serverReady, setServerReady] = useState(false);
  const [jobResult, setJobResult] = useState<JobResult | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const ensembleReady =
    settings.ensemble === "choral" ||
    settings.ensemble === "piano" ||
    settings.ensemble === "piano_with_melody" ||
    settings.ensemble === "string_ensemble" ||
    settings.ensemble === "woodwind_ensemble" ||
    settings.ensemble === "brass_ensemble";
  const canRun = !!file && ensembleReady && serverReady && !isRunning;

  function addWarning(value: string) {
    if (!value) return;
    setWarnings((prev) => (prev.includes(value) ? prev : [...prev, value]));
  }

  function resetWarnings() {
    setWarnings([]);
  }

  useEffect(() => {
    window.api
      .getServerStatus()
      .then((status) => {
        if (status.ready) {
          setServerReady(true);
        }
      })
      .catch(() => null);

    const unsubscribe = window.api.onLog((entry) => {
      setLogs((prev) => [...prev, entry].slice(-400));
      if (entry.level === "warn") {
        addWarning(entry.message);
      }
      if (entry.message.includes("[server] ready")) {
        setServerReady(true);
      }
    });
    const unsubscribeReady = window.api.onServerReady((baseUrl) => {
      if (baseUrl) {
        setServerReady(true);
      }
    });

    return () => {
      unsubscribe();
      unsubscribeReady();
    };
  }, []);

  const jobSummary = useMemo(() => {
    const keyLabel = settings.keySignature === "original" ? "Original (from file)" : settings.keySignature;
    const timeLabel = settings.timeSignature === "original" ? "Original (from file)" : settings.timeSignature;
    return {
      title: settings.title || "Untitled",
      ensemble: settings.ensemble,
      keySignature: keyLabel,
      timeSignature: timeLabel,
      tempo: settings.tempo,
      style: settings.style,
      level: settings.level,
      accompaniment: settings.accompaniment,
      textureMode: settings.textureMode,
      styleProfile: settings.styleProfile,
      modernMode: settings.modernMode,
      bassActivity: settings.bassActivity,
      tenorActivity: settings.tenorActivity,
      altoActivity: settings.altoActivity,
      sopranoActivity: settings.sopranoActivity,
      vln1Activity: settings.vln1Activity,
      vln2Activity: settings.vln2Activity,
      vlaActivity: settings.vlaActivity,
      vcActivity: settings.vcActivity,
      cbActivity: settings.cbActivity,
      instrumentation: settings.instrumentation,
      sopranoMelodyShare: settings.sopranoMelodyShare,
      randomizeOffsets: settings.randomizeOffsets,
      ruleStrictness: settings.ruleStrictness,
      file: file?.name || "(no file selected)",
      prompt: prompt || "(no prompt)"
    };
  }, [settings, file, prompt]);
  const showPolyphonicSummary = jobSummary.textureMode === "polyphony" || jobSummary.accompaniment === "polyphonic";
  const showChordalSummary = jobSummary.accompaniment === "chordal";
  const showWoodwindPolyphonicSummary = showPolyphonicSummary && settings.ensemble === "woodwind_ensemble";

  async function pickFile() {
    const selection = await window.api.selectMusicXmlFile();
    if (!selection) return;
    setFile(selection);
  }

  async function runPipeline() {
    if (!file) {
      addWarning("Select a MusicXML file before running the pipeline.");
      return;
    }
    if (!ensembleReady) {
      addWarning("Supported ensembles: choral (SATB), piano, strings, and woodwinds.");
      return;
    }

    resetWarnings();
    setIsRunning(true);
    setJobResult(null);

    try {
      const result = await window.api.runGenerateJob({
        settings,
        filePath: file.path,
        prompt
      });

      setJobResult(result);

      if (result.serverBaseUrl) {
        setServerReady(true);
      }

      (result.warnings || []).forEach((warning) => addWarning(warning));

      if (!result.ok && result.error) {
        addWarning(result.error);
      }
    } catch (err: any) {
      addWarning(err?.message || "Pipeline failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div>
          <h1>Music Engine Studio</h1>
          <p>Desktop arranger powered by your local music-engine server.</p>
        </div>
        <div className={`server-pill ${serverReady ? "ready" : "pending"}`}>
          {serverReady ? "Server ready" : "Server starting..."}
        </div>
      </header>

      <div className="app-grid">
        <section className="panel settings">
          <h2>Settings</h2>
          <SettingsForm settings={settings} onChange={setSettings} />
        </section>

        <section className="panel input">
          <h2>Input</h2>
          <div className="upload-card">
            <div>
              <h3>MusicXML File</h3>
              <p>Upload a .musicxml or .xml file to run the pipeline.</p>
            </div>
            <button className="primary" onClick={pickFile}>
              Select MusicXML
            </button>
            <div className="file-meta">
              <span className="label">Selected:</span>
              <span>{file?.name || "None"}</span>
            </div>
            {file && <div className="file-path">{file.path}</div>}
          </div>

          <div className="upload-card">
            <div>
              <h3>PDF Import (Experimental)</h3>
              <p>PDF import is experimental. Install Audiveris to enable conversion.</p>
            </div>
            <button disabled>Import PDF (coming soon)</button>
            <div className="pill warn">Experimental</div>
          </div>

          <div className="prompt-block">
            <h3>Prompt</h3>
            <textarea
              placeholder="Describe intent, voicing, or texture..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>

          <PromptAssistant settings={settings} prompt={prompt} onApply={setPrompt} />
        </section>

        <section className="panel output">
          <h2>Job Summary</h2>
          <div className="summary-grid">
            <div>
              <div className="summary-label">Title</div>
              <div>{jobSummary.title}</div>
            </div>
            <div>
              <div className="summary-label">Ensemble</div>
              <div>{jobSummary.ensemble}</div>
            </div>
            <div>
              <div className="summary-label">Key / Meter</div>
              <div>
                {jobSummary.keySignature} · {jobSummary.timeSignature}
              </div>
            </div>
            <div>
              <div className="summary-label">Tempo</div>
              <div>{jobSummary.tempo} BPM</div>
            </div>
            <div>
              <div className="summary-label">Style</div>
              <div>{jobSummary.style}</div>
            </div>
            <div>
              <div className="summary-label">Level</div>
              <div>{jobSummary.level}</div>
            </div>
            <div>
              <div className="summary-label">Accompaniment</div>
              <div>{jobSummary.accompaniment}</div>
            </div>
            <div>
              <div className="summary-label">Texture</div>
              <div>{jobSummary.textureMode}</div>
            </div>
            <div>
              <div className="summary-label">Polyphonic Profile</div>
              <div>{jobSummary.styleProfile || "(default)"}</div>
            </div>
            {jobSummary.styleProfile === "modern" && (
              <div>
                <div className="summary-label">Modern Mode</div>
                <div>{jobSummary.modernMode || "modernTonal"}</div>
              </div>
            )}
            {showWoodwindPolyphonicSummary && (
              <div>
                <div className="summary-label">Woodwind Polyphonic Activity</div>
                <div>
                  Bassoon: {jobSummary.bassActivity || "less_active"} · Clarinet:{" "}
                  {jobSummary.tenorActivity || jobSummary.bassActivity || "less_active"} · Oboe:{" "}
                  {jobSummary.altoActivity || jobSummary.bassActivity || "less_active"} · Flute:{" "}
                  {jobSummary.sopranoActivity || jobSummary.bassActivity || "less_active"} · Offsets:{" "}
                  {jobSummary.randomizeOffsets === false ? "Off" : "On"}
                </div>
              </div>
            )}
            {showPolyphonicSummary && !showWoodwindPolyphonicSummary && (
              <div>
                <div className="summary-label">Polyphonic Activity</div>
                <div>
                  Bass: {jobSummary.bassActivity || "less_active"} · Tenor:{" "}
                  {jobSummary.tenorActivity || jobSummary.bassActivity || "less_active"} · Alto:{" "}
                  {jobSummary.altoActivity || jobSummary.bassActivity || "less_active"} · Soprano:{" "}
                  {jobSummary.sopranoActivity || jobSummary.bassActivity || "less_active"} · Offsets:{" "}
                  {jobSummary.randomizeOffsets === false ? "Off" : "On"} · Melody share:{" "}
                  {jobSummary.sopranoMelodyShare ?? 30}%
                </div>
              </div>
            )}
            {(settings.ensemble === "piano" || settings.ensemble === "piano_with_melody") && !showPolyphonicSummary && (
              <div>
                <div className="summary-label">Soprano Melody Share</div>
                <div>{jobSummary.sopranoMelodyShare ?? 30}%</div>
              </div>
            )}
            {showChordalSummary && !showPolyphonicSummary && (
              <div>
                <div className="summary-label">Chordal Activity</div>
                <div>Left hand: {jobSummary.bassActivity || "less_active"}</div>
              </div>
            )}
            <div>
              <div className="summary-label">Rule Strictness</div>
              <div>{jobSummary.ruleStrictness}</div>
            </div>
            <div>
              <div className="summary-label">File</div>
              <div>{jobSummary.file}</div>
            </div>
          </div>

          <div className="action-row">
            <button className="primary" disabled={!canRun} onClick={runPipeline}>
              {isRunning ? "Running..." : "Generate Arrangement"}
            </button>
            {!serverReady && <div className="muted">Waiting for server...</div>}
            {!ensembleReady && <div className="muted">Supported ensembles: SATB, piano, strings, and woodwinds.</div>}
          </div>

          <div className="result-card">
            <h3>Job Result</h3>
            {jobResult ? (
              <div className="result-grid">
                <div>
                  <div className="summary-label">Output</div>
                  <div className="path">{jobResult.outputPath || "(none)"}</div>
                </div>
                <div>
                  <div className="summary-label">Server</div>
                  <div>{jobResult.serverBaseUrl || "(unknown)"}</div>
                </div>
                <div>
                  <div className="summary-label">Style Used</div>
                  <div>{jobResult.styleUsed || "(unknown)"}</div>
                </div>
                <div>
                  <div className="summary-label">Accompaniment Used</div>
                  <div>{jobResult.accompanimentUsed || jobSummary.accompaniment || "(unknown)"}</div>
                </div>
                <div>
                  <div className="summary-label">Chord Source</div>
                  <div>{jobResult.chordSource || "(unknown)"}</div>
                </div>
                <div>
                  <div className="summary-label">Cadence Measures</div>
                  <div>{jobResult.cadenceMeasures?.length ? jobResult.cadenceMeasures.join(", ") : "(none)"}</div>
                </div>
                <div>
                  <div className="summary-label">Warnings</div>
                  <div>{jobResult.warnings?.length ? jobResult.warnings.length : 0}</div>
                </div>
                <div className="result-actions">
                  <button
                    disabled={!jobResult.outputPath}
                    onClick={() => jobResult.outputPath && window.api.openFile(jobResult.outputPath)}
                  >
                    Open Output
                  </button>
                </div>
              </div>
            ) : (
              <div className="muted">No run yet.</div>
            )}
          </div>

          <DebugPanel debug={jobResult?.debug} />
        </section>

        <section className="panel logs">
          <LogsPanel logs={logs} warnings={warnings} />
        </section>

        <section className="panel violations">
          <h2>Rule Violations</h2>
          <ViolationsPanel debug={jobResult?.debug} />
        </section>
      </div>
    </div>
  );
}
