# Electron App Repo Skill (music-engine)

## Goal
Build an Electron desktop app that uses the existing music-engine Node/TS server + scripts to:
- import a real MusicXML file
- capture user settings (title, ensemble, key, meter, tempo, style, level, texture)
- run harmonize -> rhythm -> export pipeline
- output MusicXML and open it
- show logs and warnings
- warn and continue for non-fatal issues

## Repo paths (source of truth)
- Repo root: `~/Desktop/music-engine`
- Server entry: `src/server.ts`
- Health: `GET http://localhost:3001/health`
- Harmonize: `POST http://localhost:3001/harmonize_satb_from_chords`
- Rhythm script: `scripts/applyRhythmToSatbResponse.ts`
- Export script: `scripts/exportSatbResponseToMusicxml.ts`
- Example runner: `scripts/runSatbTest_rhythm_noChords.zsh`

## Non-negotiables
- Do not move engine code out of `src/`.
- Do not break existing server routes.
- Put new app code under `apps/electron/`.
- Warnings: print and continue (do not crash the app).
- If style is unknown: warn and default to `classical`.
- Keep rhythm units in quarter-beat units.

## App architecture (recommended)
Electron + Vite + React (renderer) with a Node-controlled main process.
- `apps/electron/`
  - `package.json`
  - `electron/`
    - `main.ts` (Electron main process; spawns/uses server; runs scripts)
    - `preload.ts` (secure IPC)
  - `renderer/`
    - `index.html`
    - `src/` (React UI)
  - `shared/` (types)

## Security
- `contextIsolation: true`
- `nodeIntegration: false`
- Use IPC via preload only; do not expose arbitrary filesystem access.
Expose minimal API on `window.api`:
- `selectMusicXmlFile(): Promise<{path:string, name:string}>`
- `runGenerateJob(settings): Promise<{ok:boolean, outputMusicXmlPath?:string, warnings:string[]}>`
- `openFile(path:string): Promise<void>`
- `onLog(cb): unsubscribe`

## Server management
Electron must NOT fail if a server is already running.

On app start:
1) Try `GET http://localhost:3001/health`
2) If ok: reuse it
3) Else spawn:
   - `npx tsx src/server.ts`
   - `cwd` must be repo root
4) Stream stdout/stderr to the UI log panel
5) Retry health until available (finite retries)

If port 3001 is taken by a different process:
- warn user
- for now: spawn with `PORT=3002` and use that base URL

## UI: required fields
- Title (string)
- Ensemble (enum): choral(SATB) | piano | string ensemble | brass ensemble | orchestra
- Key signature (string/enum; informational for now unless engine consumes)
- Time signature (string, ex: 4/4, 3/4, 2/4)
- Tempo BPM (number)
- Style (enum): classical | worship | latino | pop | rock | funk | samba
- Level (enum): beginner | intermediate | advanced | professional
- Texture/accompaniment type (enum): choral | homophonic | polyphonic | alberti bass | heterophonic
- File upload: MusicXML `.musicxml` or `.xml` (MXL later)

Also include:
- “Prompt helper” text area (user writes a prompt)
- “AI prompt assistant” panel that suggests a final prompt (MVP can be rules-based; later plug into model)

## Generation pipeline (MVP)
Write artifacts under `~/Desktop/music-engine/tmp/`:
- `tmp/app_request.json`
- `tmp/app_satb_response.json`
- `tmp/app_satb_response_rhythm.json`
- `tmp/app_out.musicxml`

Steps:
1) Read MusicXML file to string.
2) POST to `/harmonize_satb_from_chords`:
   - `musicxml: <string>`
   - `chords: []` (let engine infer)
   - `options: { keepMelodyInSoprano: true }`
3) Save response JSON to `tmp/app_satb_response.json`.
4) Apply rhythm (final cadence only):
   - run `npx tsx scripts/applyRhythmToSatbResponse.ts tmp/app_satb_response.json tmp/app_satb_response_rhythm.json <style>`
   - unknown style => warn + default to `classical`
5) Export MusicXML:
   - run `npx tsx scripts/exportSatbResponseToMusicxml.ts tmp/app_satb_response_rhythm.json tmp/app_out.musicxml`
6) Open output:
   - use Electron shell open (preferred), or `open tmp/app_out.musicxml` on macOS.

Notes:
- Only SATB is implemented right now; other ensembles must show “coming soon” and not pretend.
- “Bass more grounded unless funk/samba” applies in rhythm selection logic (already in scripts).

## Logging requirements
- Show engine logs in UI panel with:
  - timestamp
  - level (info/warn/error)
  - message
- Preserve existing log tags like:
  - `[rhythm] ...`
  - `[cadence] ...`
  - `[warn] ...`

## Dev commands (must work)
From repo root:
- `cd apps/electron`
- `npm install`
- `npm run dev`
- `npm run build`

## Editing rules for Codex
When Codex edits files:
- provide full file contents (line 1 to end)
- provide exact terminal commands to create/open/run files
- avoid pasting shell comments as terminal commands unless inside a file
