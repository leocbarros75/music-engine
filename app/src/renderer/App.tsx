import { useEffect, useMemo, useState } from "react";

const PDF_IMPORT_ENABLED = import.meta.env.VITE_PDF_IMPORT === "true";

const ENSEMBLE_OPTIONS = ["choral", "piano", "string_ensemble", "brass_ensemble", "orchestra"] as const;
const STYLE_OPTIONS = ["classical", "worship", "latino", "pop", "rock", "funk", "samba"] as const;
const LEVEL_OPTIONS = ["beginner", "intermediate", "advanced", "professional"] as const;
const ACCOMP_OPTIONS = ["choral", "homophonic", "polyphonic", "alberti_bass", "heterophonic"] as const;

const KEY_OPTIONS = ["C", "G", "D", "A", "E", "B", "F#", "F", "Bb", "Eb", "Ab", "Db", "Gb"];
const TIME_OPTIONS = ["2/4", "3/4", "4/4", "6/8", "9/8", "12/8"];

function titleize(input: string) {
  return input.replace(/_/g, " ");
}

function buildSuggestedPrompt(form: any) {
  const title = form.title || "Untitled";
  const ensemble = titleize(form.ensemble || "choral");
  const key = form.keySignature || "C";
  const time = form.timeSignature || "4/4";
  const tempo = form.tempo || 120;
  const style = form.style || "classical";
  const level = form.level || "intermediate";
  const accompaniment = titleize(form.accompaniment || "homophonic");

  return `Arrange \"${title}\" for ${ensemble}. Key ${key}, ${time}, ${tempo} BPM. Style ${style}, level ${level}, accompaniment ${accompaniment}.`;
}

function formatPreview(text: string, maxLines = 20) {
  const lines = text.split(/\r?\n/).slice(0, maxLines);
  return lines.join("\n");
}

export default function App() {
  const [form, setForm] = useState({
    title: "",
    ensemble: "choral",
    keySignature: "C",
    timeSignature: "4/4",
    tempo: 120,
    style: "classical",
    level: "intermediate",
    accompaniment: "homophonic"
  });

  const [inputType, setInputType] = useState<"musicxml" | "pdf">("musicxml");
  const [musicXmlText, setMusicXmlText] = useState("");
  const [musicXmlName, setMusicXmlName] = useState("");
  const [pdfPath, setPdfPath] = useState("");
  const [prompt, setPrompt] = useState("");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [outputCopyPath, setOutputCopyPath] = useState("");

  const suggestedPrompt = useMemo(() => buildSuggestedPrompt(form), [form]);

  const hasInput = inputType === "musicxml" ? !!musicXmlText : !!pdfPath;

  useEffect(() => {
    let unsubscribe: (() => void) | null = null;
    window.musicEngine
      .getLogs()
      .then((entries) => setLogs(entries))
      .catch(() => null);
    unsubscribe = window.musicEngine.onLog((entry) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        return next.slice(-500);
      });
    });
    return () => unsubscribe?.();
  }, []);

  function updateForm(field: string, value: string | number) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function pushLocalLog(level: string, message: string) {
    const formatted = message.startsWith("[") ? message : `[${level}] ${message}`;
    const entry = { level, message: formatted, ts: new Date().toISOString() };
    setLogs((prev) => [...prev, entry].slice(-500));
  }

  async function onMusicXmlFile(file: File | null) {
    if (!file) return;
    const text = await file.text();
    setInputType("musicxml");
    setMusicXmlText(text);
    setMusicXmlName(file.name);
    setPdfPath("");
    pushLocalLog("info", `Loaded MusicXML: ${file.name}`);
  }

  async function onPdfFile(file: File | null) {
    if (!file) return;
    const path = (file as any).path as string | undefined;
    if (!path) {
      pushLocalLog("warn", "PDF import requires file system access (Electron). Unable to read file path.");
      return;
    }
    setInputType("pdf");
    setPdfPath(path);
    setMusicXmlText("");
    setMusicXmlName(file.name);
    pushLocalLog("info", `Loaded PDF: ${file.name}`);
  }

  function buildPayload(savePath?: string | null): PipelinePayload {
    return {
      inputType,
      musicxmlText: inputType === "musicxml" ? musicXmlText : undefined,
      pdfPath: inputType === "pdf" ? pdfPath : undefined,
      prompt,
      settings: form,
      savePath
    };
  }

  async function runAnalyze() {
    if (!hasInput) {
      pushLocalLog("warn", "Please upload a MusicXML (or PDF if enabled) before running.");
      return;
    }
    setBusy(true);
    try {
      await window.musicEngine.analyze(buildPayload());
      pushLocalLog("info", "Analyze / Prepare complete.");
    } catch (err: any) {
      pushLocalLog("warn", err?.message || "Analyze failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runGenerate() {
    if (!hasInput) {
      pushLocalLog("warn", "Please upload a MusicXML (or PDF if enabled) before running.");
      return;
    }
    setBusy(true);
    try {
      await window.musicEngine.generate(buildPayload());
      pushLocalLog("info", "Generate Arrangement complete.");
    } catch (err: any) {
      pushLocalLog("warn", err?.message || "Generate failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runExport() {
    if (!hasInput) {
      pushLocalLog("warn", "Please upload a MusicXML (or PDF if enabled) before running.");
      return;
    }
    setBusy(true);
    try {
      const savePath = await window.musicEngine.chooseExportPath();
      const res = await window.musicEngine.exportMusicXml(buildPayload(savePath));
      setOutputPath(res.outputXmlPath);
      setOutputCopyPath(res.copyPath || "");
      pushLocalLog("info", "Export complete.");
    } catch (err: any) {
      pushLocalLog("warn", err?.message || "Export failed.");
    } finally {
      setBusy(false);
    }
  }

  const previewText = inputType === "musicxml" && musicXmlText ? formatPreview(musicXmlText) : "";

  return (
    <div className="app">
      <section className="panel panel-left">
        <div className="panel-header">
          <h1>Music Engine Studio</h1>
          <p>Desktop arranger powered by your local music-engine backend.</p>
        </div>

        <div className="field">
          <label>Title</label>
          <input
            value={form.title}
            onChange={(e) => updateForm("title", e.target.value)}
            placeholder="Song title"
          />
        </div>

        <div className="field">
          <label>Ensemble</label>
          <select value={form.ensemble} onChange={(e) => updateForm("ensemble", e.target.value)}>
            {ENSEMBLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {titleize(opt)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Key Signature</label>
          <input
            list="keys"
            value={form.keySignature}
            onChange={(e) => updateForm("keySignature", e.target.value)}
            placeholder="C"
          />
          <datalist id="keys">
            {KEY_OPTIONS.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label>Time Signature</label>
          <input
            list="times"
            value={form.timeSignature}
            onChange={(e) => updateForm("timeSignature", e.target.value)}
            placeholder="4/4"
          />
          <datalist id="times">
            {TIME_OPTIONS.map((opt) => (
              <option key={opt} value={opt} />
            ))}
          </datalist>
        </div>

        <div className="field">
          <label>Tempo (BPM)</label>
          <input
            type="number"
            min={40}
            max={220}
            value={form.tempo}
            onChange={(e) => updateForm("tempo", Number(e.target.value))}
          />
        </div>

        <div className="field">
          <label>Style</label>
          <select value={form.style} onChange={(e) => updateForm("style", e.target.value)}>
            {STYLE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {titleize(opt)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Level</label>
          <select value={form.level} onChange={(e) => updateForm("level", e.target.value)}>
            {LEVEL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {titleize(opt)}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Accompaniment</label>
          <select value={form.accompaniment} onChange={(e) => updateForm("accompaniment", e.target.value)}>
            {ACCOMP_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {titleize(opt)}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel panel-center">
        <div className="section">
          <h2>Input</h2>
          <div className="upload">
            <label className="upload-label">
              <span>MusicXML upload</span>
              <input
                type="file"
                accept=".musicxml,.xml"
                onChange={(e) => onMusicXmlFile(e.target.files?.[0] || null)}
              />
            </label>
            {PDF_IMPORT_ENABLED && (
              <label className="upload-label">
                <span>PDF import (experimental)</span>
                <input type="file" accept=".pdf" onChange={(e) => onPdfFile(e.target.files?.[0] || null)} />
                <small>PDF import is experimental.</small>
              </label>
            )}
          </div>
          <div className="meta-line">
            <strong>Loaded:</strong> {musicXmlName || "(none)"}
          </div>
        </div>

        <div className="section">
          <h2>Prompt</h2>
          <textarea
            placeholder="Describe your musical intent..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="prompt-helper">
            <div className="prompt-header">
              <span>Suggested prompt</span>
              <button className="ghost" onClick={() => setPrompt(suggestedPrompt)}>
                Use Suggested
              </button>
            </div>
            <div className="prompt-suggested">{suggestedPrompt}</div>
          </div>
        </div>

        <div className="section">
          <h2>Preview</h2>
          {inputType === "musicxml" ? (
            <pre className="preview">{previewText || "(upload a MusicXML to preview)"}</pre>
          ) : (
            <div className="preview">PDF selected: {pdfPath || "(none)"}</div>
          )}
        </div>
      </section>

      <section className="panel panel-right">
        <div className="section">
          <h2>Pipeline</h2>
          <div className="button-row">
            <button disabled={busy || !hasInput} onClick={runAnalyze}>
              Analyze / Prepare
            </button>
            <button className="primary" disabled={busy || !hasInput} onClick={runGenerate}>
              Generate Arrangement
            </button>
            <button disabled={busy || !hasInput} onClick={runExport}>
              Export MusicXML
            </button>
          </div>
          <div className="button-row">
            <button disabled={!outputPath} onClick={() => window.musicEngine.openOutputFile(outputCopyPath || outputPath)}>
              Open Output File
            </button>
            <button
              disabled={!outputPath}
              onClick={() => window.musicEngine.openOutputFolder(outputCopyPath || outputPath)}
            >
              Open Output Folder
            </button>
          </div>
          <div className="output-path">
            <strong>Output:</strong> {outputCopyPath || outputPath || "(not exported yet)"}
          </div>
        </div>

        <div className="section logs">
          <h2>Logs</h2>
          <div className="log-list">
            {logs.length === 0 ? (
              <div className="log-empty">No logs yet.</div>
            ) : (
              logs.map((entry, idx) => (
                <div key={`${entry.ts}-${idx}`} className="log-entry">
                  <span className="log-time">{entry.ts.split("T")[1]?.split(".")[0]}</span>
                  <span className="log-message">{entry.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
