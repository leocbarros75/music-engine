# Washed - String Auto

A Codex-assisted instrumental arrangement for Violin 1, Violin 2, Viola, Cello and Double Bass, using the supplied rhythm chart. B major; 4/4; quarter=139; pickup plus 123 numbered measures. Original repeats and alternate endings are retained.

The N.C. opening receives a new labeled harmonization. Violin 1 preserves the written opening melody. The source is a partial-melody rhythm chart: later slash-only passages receive new instrumental lines and editorial returns of the opening theme. This is not a reconstruction of the complete vocal part.

## Files

- `washed-string-auto.pdf` / `.musicxml`: full score.
- `washed-V1`, `washed-V2`, `washed-VA`, `washed-VC`, `washed-CB`: five parts, each PDF and editable MusicXML.
- `PROCESS.md`: musical decisions, concrete bar examples, code architecture, reproduction instructions, references, and limits.
- `PLAYER-REVIEW.md`: first-reading feedback sheet.
- `arrange.py`, `notation.py`, `test_arrangement.py`: generation, notation helpers, and fourteen tests.
- `arrangement-events.json`, `harmony-plan.json`, `source-audit.json`: inspectable musical data and provenance.
- `validation.json`, `pdf-validation.json`: structural and PDF reports.
- `source-rhythm.pdf`, `source-rhythm.musicxml`: unchanged copies of the source and matching adjacent notation export.
- `engrave-jobs.json`: local MuseScore export jobs; regenerated paths follow the extracted package directory.

## Regenerate

From this package folder, run `python3 arrange.py` and `python3 -m unittest test_arrangement.py`. No third-party Python packages are required for generation. Open the MusicXML in a notation application to edit or export PDFs. PDFs must be exported again after any musical change; running Python alone does not update them.

Structural tests pass. PDF pages were visually checked. No audio audition or live-player rehearsal was completed; bowing suggestions and ensemble balance remain subject to musician review.
