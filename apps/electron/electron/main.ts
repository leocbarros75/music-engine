import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { JobRequest, JobResult, LogEntry, LogLevel, MusicXmlFile } from "../shared/ipcTypes";
import { extractChordEventsFromMusicXml } from "./musicxmlChords";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const APP_ROOT = path.resolve(__dirname, "..", "..");
const RENDERER_DIST = path.join(APP_ROOT, "dist", "renderer");
const TMP_DIR = path.join(REPO_ROOT, "tmp");

const REQUEST_PATH = path.join(TMP_DIR, "app_request.json");
const SATB_PATH = path.join(TMP_DIR, "app_satb_response.json");
const RHYTHM_PATH = path.join(TMP_DIR, "app_satb_response_rhythm.json");
const PIANO_PATH = path.join(TMP_DIR, "app_piano_response.json");
const OUT_PATH = path.join(TMP_DIR, "app_out.musicxml");

type SpawnedProcess = ChildProcessByStdio<null, Readable, Readable>;

let mainWindow: BrowserWindow | null = null;
let serverProcess: SpawnedProcess | null = null;
let serverBaseUrl = "http://localhost:3001";
let serverReady = false;
let canStreamLogs = false;
const pendingLogs: LogEntry[] = [];
let warnedAboutTsx = false;

function emitLog(entry: LogEntry) {
  if (!canStreamLogs || !mainWindow) {
    pendingLogs.push(entry);
    return;
  }
  mainWindow.webContents.send("log:entry", entry);
}

function log(level: LogLevel, message: string) {
  const entry: LogEntry = {
    ts: new Date().toISOString(),
    level,
    message
  };

  if (level === "warn") {
    console.warn(message);
  } else if (level === "error") {
    console.error(message);
  } else {
    console.log(message);
  }

  emitLog(entry);
}

function emitServerReady() {
  serverReady = true;
  if (mainWindow) {
    mainWindow.webContents.send("server:ready", { baseUrl: serverBaseUrl });
  }
}

function flushLogs() {
  if (!mainWindow) return;
  pendingLogs.forEach((entry) => mainWindow?.webContents.send("log:entry", entry));
  pendingLogs.length = 0;
}

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
}

function resolveTsxCommand() {
  const localTsx = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  if (fs.existsSync(localTsx)) {
    return { cmd: localTsx, argsPrefix: [] as string[] };
  }
  if (!warnedAboutTsx) {
    warnedAboutTsx = true;
    log(
      "warn",
      "[warn] Local tsx binary not found. Run `npm install` at repo root or ensure tsx is available in PATH."
    );
  }
  return { cmd: "npx", argsPrefix: ["tsx"] as string[] };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 1200) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

async function checkHealth(baseUrl: string) {
  try {
    const res = await fetchWithTimeout(`${baseUrl}/health`, { method: "GET" }, 1000);
    if (!res.ok) return false;
    const json = await res.json();
    return json?.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth(baseUrl: string, attempts = 18, delayMs = 350) {
  for (let i = 0; i < attempts; i += 1) {
    if (await checkHealth(baseUrl)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function streamChild(child: SpawnedProcess, label: string) {
  const handle = (chunk: Buffer, level: LogLevel) => {
    const text = chunk.toString();
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const message = trimmed.startsWith("[") ? trimmed : `[${label}] ${trimmed}`;
      log(level, message);
    }
  };

  child.stdout.on("data", (data) => handle(data, "info"));
  child.stderr.on("data", (data) => handle(data, "warn"));
}

function spawnServer(port: number) {
  log("info", `[server] spawning music-engine on port ${port}...`);

  const { cmd, argsPrefix } = resolveTsxCommand();
  const child = spawn(cmd, [...argsPrefix, "src/server.ts"], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  }) as SpawnedProcess;

  serverProcess = child;
  streamChild(child, "server");

  child.on("exit", (code) => {
    if (code && code !== 0) {
      log("warn", `[server] process exited with code ${code}.`);
    }
  });
}

async function ensureServer(): Promise<string> {
  if (await checkHealth("http://localhost:3001")) {
    serverBaseUrl = "http://localhost:3001";
    log("info", `[server] ready: ${serverBaseUrl} (reused existing).`);
    emitServerReady();
    return serverBaseUrl;
  }

  spawnServer(3001);
  const ok3001 = await waitForHealth("http://localhost:3001");
  if (ok3001) {
    serverBaseUrl = "http://localhost:3001";
    log("info", `[server] ready: ${serverBaseUrl}.`);
    emitServerReady();
    return serverBaseUrl;
  }

  log(
    "warn",
    "[server] Port 3001 appears occupied or unhealthy. Falling back to PORT=3002 for a local server instance."
  );

  spawnServer(3002);
  const ok3002 = await waitForHealth("http://localhost:3002");
  if (!ok3002) {
    throw new Error("Server failed to start on port 3001 and 3002.");
  }

  serverBaseUrl = "http://localhost:3002";
  log("info", `[server] ready: ${serverBaseUrl}.`);
  emitServerReady();
  return serverBaseUrl;
}

async function selectMusicXmlFile(): Promise<MusicXmlFile | null> {
  const result = await dialog.showOpenDialog({
    title: "Select MusicXML",
    properties: ["openFile"],
    filters: [{ name: "MusicXML", extensions: ["musicxml", "xml"] }]
  });

  if (result.canceled || result.filePaths.length === 0) return null;

  const filePath = result.filePaths[0];
  return {
    path: filePath,
    name: path.basename(filePath)
  };
}

function resolveRhythmStyle(style: string, warnings: string[]) {
  const normalized = style.toLowerCase();
  const supported = new Set(["classical", "pop", "rock", "funk", "samba"]);
  if (!supported.has(normalized)) {
    const warning = `Style "${style}" not supported by rhythm stage. Defaulting to "classical".`;
    warnings.push(warning);
    log("warn", `[warn] ${warning}`);
    return "classical";
  }
  return normalized;
}
async function runCommand(cmd: string, args: string[], label: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"]
    }) as SpawnedProcess;

    streamChild(child, label);

    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} failed with code ${code}`));
    });
  });
}

async function runGenerateJob(payload: JobRequest): Promise<JobResult> {
  const warnings: string[] = [];

  try {
    if (
      payload.settings.ensemble !== "choral" &&
      payload.settings.ensemble !== "piano" &&
      payload.settings.ensemble !== "piano_with_melody" &&
      payload.settings.ensemble !== "string_ensemble" &&
      payload.settings.ensemble !== "woodwind_ensemble" &&
      payload.settings.ensemble !== "brass_ensemble"
    ) {
      const warning = "Selected ensemble is not supported yet. SATB, piano, strings, woodwinds, and brass only for MVP.";
      warnings.push(warning);
      log("warn", `[warn] ${warning}`);
      return { ok: false, warnings, error: warning };
    }

    if (!fs.existsSync(payload.filePath)) {
      const error = "Selected MusicXML file could not be found.";
      warnings.push(error);
      log("error", `[error] ${error}`);
      return { ok: false, warnings, error };
    }

    ensureTmpDir();

    const baseUrl = await ensureServer();

    const keySignatureMode = payload.settings.keySignature === "original" ? "original" : "manual";
    const targetKey = keySignatureMode === "original" ? "original" : payload.settings.keySignature;
    const timeSignatureMode = payload.settings.timeSignature === "original" ? "original" : "manual";

    const settingsForServer = {
      ...payload.settings,
      keySignatureMode,
      targetKey,
      timeSignatureMode
    };

    const requestPayload = {
      settings: settingsForServer,
      prompt: payload.prompt,
      filePath: payload.filePath,
      serverBaseUrl: baseUrl,
      timestamp: new Date().toISOString()
    };

    fs.writeFileSync(REQUEST_PATH, JSON.stringify(requestPayload, null, 2));

    const musicxml = fs.readFileSync(payload.filePath, "utf8");
    const chordParse = extractChordEventsFromMusicXml(musicxml);
    const extractedChords = chordParse.chords ?? [];
    if (Array.isArray(chordParse.warnings) && chordParse.warnings.length) {
      for (const warnMsg of chordParse.warnings) {
        const msg = String(warnMsg);
        if (!msg) continue;
        warnings.push(msg);
        log("warn", `[warn] ${msg}`);
      }
    }

    log("info", `[job] POST /harmonize_satb_from_chords (chords: ${extractedChords.length}).`);

    const response = await fetch(`${baseUrl}/harmonize_satb_from_chords`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        musicxml,
        chords: extractedChords,
        options: { keepMelodyInSoprano: true },
        settings: settingsForServer
      })
    });

    const json = await response.json();

    if (!response.ok || json?.ok === false) {
      const error = json?.error || `Harmonize failed with status ${response.status}`;
      log("error", `[error] ${error}`);
      return { ok: false, warnings, error };
    }

    fs.writeFileSync(SATB_PATH, JSON.stringify(json, null, 2));
    log("info", `[job] wrote ${SATB_PATH}`);

    fs.writeFileSync(RHYTHM_PATH, JSON.stringify(json, null, 2));
    log("info", `[job] wrote ${RHYTHM_PATH}`);

    const responseEnsemble = String(json?.scoreModel?.meta?.ensemble ?? "");
    if (
      payload.settings.ensemble === "piano" ||
      payload.settings.ensemble === "piano_with_melody" ||
      responseEnsemble.toLowerCase() === "piano" ||
      responseEnsemble.toLowerCase() === "piano_with_melody"
    ) {
      fs.writeFileSync(PIANO_PATH, JSON.stringify(json, null, 2));
      log("info", `[job] wrote ${PIANO_PATH}`);
    }

    const { cmd, argsPrefix } = resolveTsxCommand();
    await runCommand(
      cmd,
      [...argsPrefix, "scripts/exportSatbResponseToMusicxml.ts", RHYTHM_PATH, OUT_PATH],
      "export"
    );

    const metaApp = json?.scoreModel?.meta?.app ?? {};
    const styleUsed = typeof metaApp.styleUsed === "string" ? metaApp.styleUsed : payload.settings.style;
    const chordSource = typeof metaApp.chordSource === "string" ? metaApp.chordSource : undefined;
    const debug = metaApp?.debug ?? undefined;
    if (debug && (metaApp as any).detectedInputKeyMode) {
      (debug as any).detectedInputKeyMode = (metaApp as any).detectedInputKeyMode;
    }

    if (Array.isArray(metaApp.warnings)) {
      for (const warnMsg of metaApp.warnings) {
        const msg = String(warnMsg);
        if (!msg) continue;
        warnings.push(msg);
        log("warn", `[warn] ${msg}`);
      }
    }

    let cadenceMeasures: number[] = [];
    try {
      const applied = metaApp.cadenceMeasures;
      if (Array.isArray(applied)) {
        cadenceMeasures = applied.map((value: any) => Number(value)).filter((value: number) => Number.isFinite(value));
      }
    } catch {
      warnings.push("Could not parse cadence measures from rhythm output.");
    }

    await shell.openPath(OUT_PATH);

    return {
      ok: true,
      outputPath: OUT_PATH,
      serverBaseUrl: baseUrl,
      styleUsed,
      accompanimentUsed: payload.settings.accompaniment,
      chordSource,
      debug,
      cadenceMeasures,
      warnings
    };
  } catch (err: any) {
    const message = err?.message || "Pipeline failed.";
    warnings.push(message);
    log("error", `[error] ${message}`);
    return { ok: false, warnings, error: message };
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  mainWindow.webContents.on("did-finish-load", () => {
    canStreamLogs = true;
    flushLogs();
  });
}

app.whenReady().then(async () => {
  ensureTmpDir();
  createWindow();
  try {
    await ensureServer();
  } catch (err: any) {
    log("warn", `[warn] ${err?.message || "Server failed to start."}`);
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("dialog:openMusicXml", () => selectMusicXmlFile());
ipcMain.handle("job:run", (_event, payload: JobRequest) => runGenerateJob(payload));
ipcMain.handle("shell:openFile", (_event, filePath: string) => shell.openPath(filePath));
ipcMain.handle("server:getStatus", () => ({ ready: serverReady, baseUrl: serverBaseUrl }));
