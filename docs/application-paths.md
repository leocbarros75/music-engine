# Application paths

## Maintained entry points

- `apps/web`: browser studio. Run the backend with `npm run dev`, then `npm run web` in a second terminal. Vite forwards API calls to port 3001, including AI settings and rhythm-chart generation.
- `apps/electron`: desktop interface. `npm run app` starts it and lets it start/reuse the backend. Output files live in the repository's `tmp/` directory.
- `app`: compatibility launcher only. Its npm commands, Electron entry point and Vite config delegate to `apps/electron`. Its old renderer/preload files remain as reference; do not extend them.

## One MusicXML application boundary

Both clients send original MusicXML, settings and optional part selection to `POST /generate`. `src/app/generateArrangement.ts` validates input, normalizes settings, selects source parts without re-exporting them, and invokes the pipeline. `normalizeAppSettings.ts` owns mode inference, supported fields and defaults; clients no longer rewrite key/time modes.

`/arrange_musicxml` and the MusicXML form of `/harmonize_satb_from_chords` are aliases of that same boundary. They now share validation, selected-part behavior, error status, MusicXML, MIDI, playback and preservation reports, even when settings are omitted. Arrangement aliases also share the heavy-request rate limit.

The desktop no longer extracts chords locally or runs an exporter as a fallback. It saves the server's MusicXML and matching MIDI, rejects partial successful responses, and displays server warnings and metadata. `tmp/app_response.json` replaces three duplicate intermediate response snapshots. `apps/electron/electron/musicxmlChords.ts` remains an unused historical reference.

## Other inputs

- `/generate_from_chords` creates an input score, then uses the same application boundary.
- `/generate_from_rhythm_pdf` parses and validates a chart, then calls `arrangeRhythmChart.ts`. Its specialized orchestral writer remains intact; its output now passes through the canonical MusicXML/performance synchronization. Other chart ensembles use the application pipeline. Both return MIDI when supported, playback status, chart metadata and warnings. A generated guide melody is not described as a preserved source melody.
- OMR returns editable MusicXML for the normal generation path; it remains an optional external service.

Unpitched percussion has no shared MIDI drum mapping yet. A full rhythm-chart orchestra therefore returns an explicit unsupported playback report and no misleading MIDI. A supported pitched-only roster returns matching MIDI normally.

## Compatibility boundary and limits

The model-only/file-path form of `/harmonize_satb_from_chords` remains a low-level legacy API for existing scripts. It is not used by either maintained application and does not offer raw-source preservation guarantees. Analysis, part extraction and import endpoints remain separate operations; they are not alternate arrangers.

The existing desktop offers fewer ensemble controls than the browser. This consolidation makes shared operations consistent; it does not replace both interfaces with a single UI or add all browser features to desktop.

Run `npm run test:application` for route parity, invalid inputs, settings normalization, desktop request/response behavior, chart output parity and proxy coverage. `npm test` includes these checks. Live Electron interaction, external OMR/AI services and audible playback still require manual verification.
