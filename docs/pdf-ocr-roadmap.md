# PDF → MusicXML OCR Roadmap (Audiveris First)

## Goals
- Provide a reliable PDF to MusicXML conversion path for the Electron app.
- Keep the pipeline local-first, deterministic, and debuggable.
- Surface warnings and let users correct results without blocking the app.

## Phase 0: UI Scaffold (Already in App)
- Upload button labeled “PDF import (experimental)”.
- Feature flag gate to avoid accidental execution.
- Clear copy about Audiveris dependency.

## Phase 1: Local Audiveris Integration
- Detect Audiveris install path or prompt user to select the binary.
- Run `audiveris -batch -export -output <out_dir> <pdf_path>`.
- Capture stdout/stderr and stream logs to the app.
- Fail gracefully with actionable install instructions if Audiveris is missing.

## Phase 2: Post-Processing MusicXML
- Normalize divisions and time signatures into engine-friendly units.
- Fix key signature parsing and propagate `attributes.key_fifths`.
- Remove redundant part meta created by OMR if it conflicts with engine expectations.
- Validate measure durations against time signature and emit warnings.

## Phase 3: Melody Detection + Chord Extraction
- Prefer part names containing “Melody” or “Soprano”.
- Fall back to top staff / highest average pitch.
- Extract `<harmony>` elements if present and translate to chord symbols.
- If no chords present, keep inference path.

## Phase 4: Quality Assurance Checks
- Preflight: count measures, verify time and key signatures exist.
- Postflight: confirm melody preservation against extracted melody.
- Chord check: verify bass aligns to chord root or slash bass at chord events.
- Emit a compact diagnostics report for the Debug panel.

## Phase 5: User Fixups
- Allow manual chord edits per measure.
- Allow reassigning melody source part.
- Allow manual key override before running the harmonizer.

## Phase 6: Automated Regression Suite
- Add a small fixture set of PDFs with expected MusicXML counts.
- Include baseline diffs of detected melody note counts and key signatures.
- Gate the OCR pipeline behind an integration test runner.

## Operational Notes
- Keep Audiveris optional and do not bundle it initially.
- Store intermediate outputs in `tmp/ocr/` for reproducibility.
- Provide a “Open OCR Folder” button in the app for debugging.
