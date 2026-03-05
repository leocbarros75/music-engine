# music-engine Repo Skill

## Repo root
- `~/Desktop/music-engine`

## Core entrypoints
- HTTP server: `src/server.ts`
- Health: `GET http://localhost:3001/health`
- Harmonize SATB from chords (or infer when chords empty): `POST http://localhost:3001/harmonize_satb_from_chords`

## Key conventions
- Use `attributes.key_fifths` (NOT `attributes.key.fifths`)
- Rhythm units are quarter-beat units (t and dur measured in beats)

## Safe editing workflow
When you change any file:
1) Back up the file:
   - `cp path/to/file path/to/file.bak.before_<short_reason>`
2) Open in TextEdit:
   - `open -a TextEdit path/to/file`
3) Run typecheck:
   - `npx tsc -p tsconfig.json --noEmit`
4) Run the relevant script:
   - Example: `./scripts/runSatbTest_rhythm_noChords.zsh funk`

## Do / Don’t summary
Do:
- Add new modules under `src/` with tight scope.
- Warn and continue on non-fatal issues (unknown style, unsupported meter for now).
- Preserve `meta.harmonize.debug` because downstream scripts read it.

Don’t:
- Break server routes without updating scripts/tests.
- Assume missing MusicXML attributes exist.
- Crash on rule violations: log warnings and proceed.
