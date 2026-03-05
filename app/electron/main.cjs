const { app, BrowserWindow, ipcMain, dialog, shell } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const APP_TMP_DIR = path.join(REPO_ROOT, "tmp");
const BACKEND_URL = "http://localhost:3001";

let mainWindow = null;
let backendProcess = null;
let backendSpawnedByUs = false;
let backendStarting = false;
let currentRun = null;

const logBuffer = [];
const LOG_LIMIT = 500;

function pushLog(level, message) {
  const entry = {
    level,
    message,
    ts: new Date().toISOString()
  };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_LIMIT) logBuffer.shift();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log", entry);
  }
}

function formatLine(level, message) {
  const text = String(message ?? "").trim();
  if (!text) return "";
  if (text.startsWith("[")) return text;
  return `[${level}] ${text}`;
}

function log(level, message) {
  const line = formatLine(level, message);
  if (!line) return;
  pushLog(level, line);
}

function ensureTmpDir() {
  fs.mkdirSync(APP_TMP_DIR, { recursive: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 800) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function checkHealth() {
  try {
    const res = await fetchWithTimeout(`${BACKEND_URL}/health`, { method: "GET" }, 800);
    if (!res.ok) return false;
    const json = await res.json();
    return json && json.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth({ retries = 20, delayMs = 350 } = {}) {
  for (let i = 0; i < retries; i++) {
    if (await checkHealth()) return true;
    await sleep(delayMs);
  }
  return false;
}

function pipeChildOutput(child, fallbackLevel) {
  const handle = (chunk, level) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const msg = trimmed.startsWith("[") ? trimmed : formatLine(level || fallbackLevel, trimmed);
      pushLog(level || fallbackLevel, msg);
    }
  };

  if (child.stdout) child.stdout.on("data", (d) => handle(d, fallbackLevel || "info"));
  if (child.stderr) child.stderr.on("data", (d) => handle(d, "warn"));
}

async function ensureBackendRunning() {
  if (await checkHealth()) {
    log("backend", "Backend already running on http://localhost:3001.");
    return true;
  }

  if (backendStarting) {
    const ok = await waitForHealth();
    if (!ok) log("warn", "Backend still not responding after startup attempt.");
    return ok;
  }

  backendStarting = true;
  log("backend", "Backend not detected. Starting music-engine server...");

  backendProcess = spawn("npx", ["tsx", "src/server.ts"], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: "3001" }
  });
  backendSpawnedByUs = true;

  pipeChildOutput(backendProcess, "backend");

  backendProcess.on("exit", (code) => {
    if (code && code !== 0) {
      log("warn", `Backend process exited with code ${code}.`);
    }
  });

  const ok = await waitForHealth();
  if (!ok) {
    log("warn", "Backend did not become healthy. If port 3001 is in use, reusing existing service.");
  } else {
    log("backend", "Backend is healthy.");
  }

  backendStarting = false;
  return ok;
}

function sanitizeFileToken(input) {
  return String(input || "untitled")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function newRunId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

async function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd || REPO_ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(opts.env || {}) }
    });

    pipeChildOutput(child, opts.logLevel || "script");

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve({ code: 0 });
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function harmonizeFromMusicXml(xmlText, meta) {
  await ensureBackendRunning();
  log("cadence", "Calling /harmonize_satb_from_chords (chords: []).");

  const res = await fetch(`${BACKEND_URL}/harmonize_satb_from_chords`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      musicxml: xmlText,
      chords: [],
      options: { keepMelodyInSoprano: true }
    })
  });

  const json = await res.json();
  if (!res.ok || !json || json.ok === false) {
    const msg = json?.error ? String(json.error) : `HTTP ${res.status}`;
    throw new Error(`Harmonize failed: ${msg}`);
  }

  if (json && json.scoreModel && meta) {
    const score = json.scoreModel;
    score.meta = {
      ...(score.meta || {}),
      title: meta.title || score.meta?.title || "",
      composer: meta.composer || score.meta?.composer || "",
      ensemble: meta.ensemble || score.meta?.ensemble || "",
      intent: meta.intent || score.meta?.intent || ""
    };
  }

  return json;
}

function resolveStyle(styleRaw) {
  const style = String(styleRaw || "classical").toLowerCase();
  const supported = new Set(["classical", "pop", "rock", "funk", "samba"]);
  if (!supported.has(style)) {
    log("warn", `Style "${style}" not supported by rhythm stage. Defaulting to "classical".`);
    return "classical";
  }
  return style;
}

async function applyRhythm(inPath, outPath, style) {
  const resolved = resolveStyle(style);
  if (resolved === "funk" || resolved === "samba") {
    log("rhythm", "Bass leap policy: allow larger leaps for funk/samba.");
  } else {
    log("rhythm", `Bass leap policy: keep bass grounded for style="${resolved}".`);
  }

  await runCommand("npx", [
    "tsx",
    "scripts/applyRhythmToSatbResponse.ts",
    inPath,
    outPath,
    resolved
  ]);

  return resolved;
}

async function exportMusicXml(inPath, outPath) {
  await runCommand("npx", ["tsx", "scripts/exportSatbResponseToMusicxml.ts", inPath, outPath]);
}

function isPdfEnabled() {
  return (
    String(process.env.PDF_IMPORT || "").toLowerCase() === "true" ||
    String(process.env.PDF_IMPORT || "") === "1" ||
    String(process.env.VITE_PDF_IMPORT || "").toLowerCase() === "true"
  );
}

function findAudiverisBinary() {
  if (process.env.AUDIVERIS_BIN) return process.env.AUDIVERIS_BIN;
  const res = spawnSync("which", ["audiveris"], { encoding: "utf8" });
  const pathOut = String(res.stdout || "").trim();
  return pathOut || null;
}

async function convertPdfToMusicXml(pdfPath, runId) {
  if (!isPdfEnabled()) {
    throw new Error("PDF import is disabled. Set VITE_PDF_IMPORT=true to enable.");
  }

  const audiveris = findAudiverisBinary();
  if (!audiveris) {
    log("warn", "Audiveris not found. Install it and ensure the 'audiveris' command is available in PATH.");
    log("warn", "See: https://audiveris.github.io/audiveris/ for installation instructions.");
    throw new Error("Audiveris not available.");
  }

  const outDir = path.join(APP_TMP_DIR, `audiveris_${runId}`);
  fs.mkdirSync(outDir, { recursive: true });

  log("info", `PDF import (experimental): running Audiveris on ${pdfPath}`);

  await runCommand(audiveris, ["-export", "-output", outDir, pdfPath], {
    cwd: REPO_ROOT,
    logLevel: "pdf"
  });

  const files = fs.readdirSync(outDir).filter((f) => f.endsWith(".musicxml") || f.endsWith(".xml"));
  if (!files.length) {
    throw new Error("Audiveris did not produce a MusicXML file.");
  }

  const xmlPath = path.join(outDir, files[0]);
  log("pdf", `Audiveris output: ${xmlPath}`);
  return fs.readFileSync(xmlPath, "utf8");
}

async function resolveInputXml(payload, runId) {
  if (payload.inputType === "pdf") {
    return await convertPdfToMusicXml(payload.pdfPath, runId);
  }

  if (!payload.musicxmlText) {
    throw new Error("No MusicXML content provided.");
  }
  return payload.musicxmlText;
}

function getMetaFromPayload(payload) {
  const settings = payload.settings || {};
  const intentBits = [];
  if (payload.prompt) intentBits.push(String(payload.prompt));
  const intent = intentBits.join(" ").trim();
  return {
    title: settings.title || "",
    ensemble: settings.ensemble || "",
    composer: settings.composer || "",
    intent
  };
}

async function analyzePipeline(payload) {
  ensureTmpDir();
  const runId = newRunId();
  const titleSlug = sanitizeFileToken(payload?.settings?.title || "output");
  const satbJsonPath = path.join(APP_TMP_DIR, `satb_${titleSlug || "run"}_${runId}.json`);

  const xml = await resolveInputXml(payload, runId);
  const meta = getMetaFromPayload(payload);
  const response = await harmonizeFromMusicXml(xml, meta);

  fs.writeFileSync(satbJsonPath, JSON.stringify(response, null, 2), "utf8");
  log("info", `SATB response saved: ${satbJsonPath}`);

  currentRun = {
    runId,
    satbJsonPath,
    rhythmJsonPath: null,
    outputXmlPath: null,
    settings: payload.settings || {},
    lastStyle: payload.settings?.style || "classical"
  };

  return { runId, satbJsonPath };
}

async function generatePipeline(payload) {
  const base = currentRun ? { ...currentRun } : null;
  if (!base || !base.satbJsonPath || !fs.existsSync(base.satbJsonPath)) {
    await analyzePipeline(payload);
  }

  const style = payload.settings?.style || currentRun?.lastStyle || "classical";
  const runId = currentRun.runId;
  const titleSlug = sanitizeFileToken(payload?.settings?.title || "output");
  const rhythmJsonPath = path.join(APP_TMP_DIR, `satb_${titleSlug || "run"}_${runId}_rhythm.json`);

  await applyRhythm(currentRun.satbJsonPath, rhythmJsonPath, style);

  currentRun.rhythmJsonPath = rhythmJsonPath;
  currentRun.lastStyle = style;
  log("info", `Rhythm-applied SATB saved: ${rhythmJsonPath}`);

  return { runId, rhythmJsonPath };
}

async function exportPipeline(payload) {
  if (!currentRun || !currentRun.satbJsonPath) {
    await analyzePipeline(payload);
  }
  if (!currentRun.rhythmJsonPath) {
    await generatePipeline(payload);
  }

  const runId = currentRun.runId;
  const titleSlug = sanitizeFileToken(payload?.settings?.title || "output");
  const outputXmlPath = path.join(APP_TMP_DIR, `satb_${titleSlug || "run"}_${runId}.musicxml`);
  const inputForExport = currentRun.rhythmJsonPath || currentRun.satbJsonPath;

  await exportMusicXml(inputForExport, outputXmlPath);
  currentRun.outputXmlPath = outputXmlPath;

  let copyPath = null;
  if (payload.savePath) {
    fs.copyFileSync(outputXmlPath, payload.savePath);
    copyPath = payload.savePath;
    log("info", `Export copied to: ${copyPath}`);
  }

  log("info", `Exported MusicXML: ${outputXmlPath}`);

  return { runId, outputXmlPath, copyPath };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    const indexPath = path.join(__dirname, "..", "dist", "renderer", "index.html");
    mainWindow.loadFile(indexPath);
  }
}

app.whenReady().then(async () => {
  ensureTmpDir();
  createWindow();
  await ensureBackendRunning();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  if (backendSpawnedByUs && backendProcess && !backendProcess.killed) {
    backendProcess.kill("SIGTERM");
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("log:get", async () => logBuffer);
ipcMain.handle("pipeline:analyze", async (_evt, payload) => analyzePipeline(payload));
ipcMain.handle("pipeline:generate", async (_evt, payload) => generatePipeline(payload));
ipcMain.handle("pipeline:export", async (_evt, payload) => exportPipeline(payload));

ipcMain.handle("dialog:saveMusicXml", async () => {
  const result = await dialog.showSaveDialog({
    title: "Export MusicXML",
    defaultPath: path.join(APP_TMP_DIR, "output.musicxml"),
    filters: [{ name: "MusicXML", extensions: ["musicxml", "xml"] }]
  });
  if (result.canceled) return null;
  return result.filePath || null;
});

ipcMain.handle("shell:openFolder", async (_evt, folderPath) => {
  if (!folderPath) return;
  await shell.openPath(folderPath);
});

ipcMain.handle("shell:openFile", async (_evt, filePath) => {
  if (!filePath) return;
  await shell.openPath(filePath);
});
