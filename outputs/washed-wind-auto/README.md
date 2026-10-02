# Washed - Wind Auto

Codex-assisted instrumental arrangement for Flute, Oboe, B-flat Clarinet, and Bassoon. B concert major, 4/4, quarter=139, pickup plus 123 numbered measures. Repeats and alternate endings retained.

Flute preserves the opening melody; its N.C. opening receives the same labeled editorial harmony as String Auto. The source is a partial-melody rhythm chart, so later slash-only passages use new instrumental continuations and theme returns. This edition shares melodies among the upper winds and regenerates the accompaniment with written breathing rests.

## Delivery

- `washed-wind-auto.pdf` / `.musicxml`: full transposed score; clarinet uses written pitch, and chord symbols above Flute are concert pitch.
- `washed-FL`, `washed-OB`, `washed-CL`, `washed-BS`: four individual parts, each PDF and editable MusicXML. Clarinet notes and chord symbols are transposed to written C# major.
- `PROCESS.md`: comprehensive musical and code walkthrough, source distinctions, bar examples, transposition, breathing, references, and reproduction instructions.
- `PLAYER-REVIEW.md`: first-reading feedback sheet.
- `arrange.py`, `notation.py`, `test_arrangement.py`: complete generation code and eighteen tests.
- `arrangement-events.json`, `harmony-plan.json`, `source-audit.json`: inspectable musical events, chord plan, register ranges, and provenance.
- `validation.json`, `test-results.txt`, `pdf-validation.json`: checks and reports.
- `source-rhythm.pdf`, `source-rhythm.musicxml`: unchanged supplied source and matching adjacent export.
- `engrave-jobs.json`: MuseScore PDF jobs, with paths regenerated for the folder where the script is run.

## Regenerate

From this folder: `python3 arrange.py`, then `python3 -m unittest test_arrangement.py`. Python standard library is sufficient. Open MusicXML in Dorico or MuseScore to edit or export; running Python alone does not update the PDFs.

All eighteen tests pass; PDFs have been visually inspected. The repeat-aware breath audit is a heuristic, including nominal timing only. No audio audition or live-player rehearsal was completed. Use the review sheet for breathing comfort, articulation, balance, and page-turn decisions.
