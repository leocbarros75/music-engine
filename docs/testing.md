# Testing the engine

After `npm ci`, run `npm test` from the project folder. This runs all 31 offline test jobs: score timing, source preservation, request handlers, shared MusicXML/MIDI/playback, string arrangements, candidate generation for four ensemble engines, chord extraction, choral rules, harmony analysis in both modes, and the test runner itself. No API key, running server, network connection, or personal Downloads file is required after dependencies are installed.

The runner uses the installed `tsx` loader and the current Node executable. Each job has its own process, a two-minute timeout, and failure output. It continues after a failed job and exits unsuccessfully if any job fails. Both beat and measure harmony modes assert expected Roman numerals, keys and cadences. All eight harmony fixtures are enumerated from `tests/harmony/expectations.ts`.

Focused commands:

- `npm run test:phrases` — inspected phrase context, strict proposals, provider mocks, source preservation and export parity.

- `npm run test:application` — route parity, desktop requests, chart output contracts and proxy coverage.

- `npm run test:harmony` — both modes, Roman confidence and exporter checks.
- `npm run test:harmony:beat` / `npm run test:harmony:measure` — one mode.
- `npm run test:arrange` — existing string fixtures and 32 candidate regressions across strings, woodwinds, brass and orchestra.
- `npm run test:musicxml` — included hymn and choral-rule checks.
- `npm run test:score`, `npm run test:preservation`, `npm run test:performance` — earlier foundation suites.

Add new suites to `tests/run-tests.mjs` and keep them deterministic. New harmony fixtures need explicit expectations. A good regression test should fail when the corresponding behavior is broken; include valid cases that must not be flagged, as well as invalid cases that must be caught. Do not replace a failing musical expectation with whatever the engine currently outputs.

`tests/harmony/runHarmonyTest.mjs` (and its old compatibility path `tests/runHarmonyTest.mjs`) is a separate, optional live-server smoke check. It requires an XML path and an already running server. It rejects HTTP failures, invalid JSON, engine failures and missing analysis records, but does not replace the offline musical assertions. `debugBeatUnits.ts` remains a diagnostic script, not a test suite. Additional unregistered XML files are exploratory fixtures, not claimed test coverage.

GitHub Actions is configured to run the full suite and all three builds on Node 22/Linux. This workflow still needs its first run after the changes are pushed. Local verification for this update used Node 25.2.1 on macOS. These tests do not verify audible sample quality, browser/device audio behavior or engraving appearance; those still require listening and visual review.
