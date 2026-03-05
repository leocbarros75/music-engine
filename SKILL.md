# Music Engine Repo Skill Guide

## What this repo is
music-engine is a Node + TypeScript engine that:
1) parses MusicXML into an internal ScoreModel
2) harmonizes melody into SATB (or other ensembles later)
3) applies rhythm stages (cadence-first, style-driven)
4) exports ScoreModel back to MusicXML

## Run the server
From repo root:

- Start server:
  - `cd ~/Desktop/music-engine`
  - `npx tsx src/server.ts`

- Health check:
  - `curl -sS http://localhost:3001/health`

If you see EADDRINUSE, something is already listening on 3001:
- `lsof -nP -iTCP:3001 -sTCP:LISTEN`

## Run the Electron app
From repo root:

- Install Electron app deps:
  - `cd ~/Desktop/music-engine/apps/electron`
  - `npm install`

- Run Electron + Vite dev:
  - `npm run dev`

- Build:
  - `npm run build`

Optional (repo root shortcut):
- `npm run app`

## Important paths
- HTTP server: `src/server.ts`
- MusicXML parser: `src/parsers/musicxmlParser.ts`
- SATB harmonizer: `src/harmonize/satb/harmonizeSatbFromChords.ts`
- Chord inference: `src/harmonize/satb/inferChordsFromMelody.ts`
- Rhythm modules: `src/rhythm/*`
- Exporters: `src/exporters/*`
- App settings pipeline: `src/app/applyAppSettings.ts`
- Test scripts: `scripts/*`
- Test MusicXML: `tests/musicxml/*`
- Electron main: `apps/electron/electron/main.ts`
- Electron preload: `apps/electron/electron/preload.ts`
- Renderer UI: `apps/electron/renderer/src/App.tsx`

## Pipeline overview
MusicXML -> ScoreModel -> Harmonize -> Apply settings (rhythm + key) -> Export MusicXML

## Melody preservation guarantee
- Melody is detected from the uploaded file (prefers part name containing "melody" or "soprano", else first part).
- When `keepMelodyInSoprano` is true, the melody events are copied exactly into the Soprano part (same t, dur, pitch, midi).
- Rhythm styling only applies to non-melody parts (currently Bass only).

Key files:
- Melody detection + copy: `src/harmonize/satb/harmonizeSatbFromChords.ts`
- Melody source selection for chord inference: `src/harmonize/satb/inferChordsFromMelody.ts`
- Parser (namespace-safe, key/time/divisions): `src/parsers/musicxmlParser.ts`

Recommended debug meta location:
- `scoreModel.meta.harmonize.debug`
- `scoreModel.meta.rhythm.debug`
- `scoreModel.meta.app` (settings, warnings, transpose info)

## Key signature rules
- ScoreModel uses `attributes.key_fifths` on measure 1 attributes
- Export must write `<key><fifths>N</fifths></key>` based on that
- If user changes key, transpose pitches and update `key_fifths`

## Rhythm rules (current direction)
- Units are in beats, quarter = 1 beat in 4/4
- For MusicXML export, use `divisions=4` so durations are stable:
  - dur=1 => duration=4 quarter
  - dur=2 => duration=8 half
  - dur=4 => duration=16 whole

## Debugging checklist when output looks wrong
1) Check exported MusicXML:
   - `<divisions>` value
   - `<key><fifths>`
   - measure duration totals

2) Check server response:
   - `scoreModel.meta.*` debug objects
   - `scoreModel.meta.app.warnings` and `styleUsed`
   - part names and event counts per measure

3) Check cadence logs:
   - `[cadence]` messages
   - chord symbols used for final cadence

## Scripts you will use often
- Harmonize SATB no chords:
  - `./scripts/runSatbTest_noChords.zsh`

- Harmonize + rhythm:
  - `./scripts/runSatbTest_rhythm_noChords.zsh`
