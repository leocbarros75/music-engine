# Washed — Jazz Band

2026-10-06 · Standalone instrumental arrangement · Jazz-funk / gospel · Straight eighths · Quarter = 139 · Concert B major

Start with `washed-jazz-band.pdf` for the conductor, or open `washed-jazz-band.musicxml` in Dorico, MuseScore, or another MusicXML application to edit. The full score has transposed staves and **concert chord symbols** above Alto 1. Separate player parts have their own written-pitch chord symbols.

## Score and parts

| File stem | Instrument | PDF pages | Written key |
|---|---|---:|---|
| washed-jazz-band | Full score; 17 parts / 18 staves | 31 | Mixed transposed staves |
| washed-AS1 | Alto Saxophone 1 in E-flat | 4 | A-flat |
| washed-AS2 | Alto Saxophone 2 in E-flat | 4 | A-flat |
| washed-TS1 | Tenor Saxophone 1 in B-flat | 4 | D-flat |
| washed-TS2 | Tenor Saxophone 2 in B-flat | 4 | D-flat |
| washed-BS | Baritone Saxophone in E-flat | 4 | A-flat |
| washed-TP1 | Trumpet 1 in B-flat | 4 | D-flat |
| washed-TP2 | Trumpet 2 in B-flat | 4 | D-flat |
| washed-TP3 | Trumpet 3 in B-flat | 4 | D-flat |
| washed-TP4 | Trumpet 4 in B-flat | 4 | D-flat |
| washed-TB1 | Trombone 1 | 4 | B |
| washed-TB2 | Trombone 2 | 4 | B |
| washed-TB3 | Trombone 3 | 4 | B |
| washed-BT | Bass Trombone | 4 | B |
| washed-PI | Piano, grand staff | 8 | B |
| washed-GT | Rhythm Guitar | 4 | B; octave notation |
| washed-BA | Acoustic Bass | 4 | B; octave notation |
| washed-DR | Drum Set | 4 | Unpitched |

Every listed stem has both `.pdf` and `.musicxml` files. Print the full score at A3 portrait and the parts at A4 portrait, preferably at actual size. The engraving uses approximately 5 mm staves in the conductor score and 7 mm in parts. Review page turns before performance, especially the eight-page piano part.

## Musical treatment

The saxophones carry the main harmonic texture. Alto 1, Tenor 1, Trombone 1, and Trumpet 1 rotate through foreground features. Brass responses emphasize selected arrivals. Piano and guitar share syncopated comping; bass alternates two-feel and walking motion with audited chromatic approaches; drums supply a straight-eighth backbeat and brief fills.

The source is a five-page **rhythm chart containing partial melody and instrumental cues**. This arrangement preserves its 123 numbered bars, pickup, repeats, endings, and printed harmony from bar 9 onward. The 46 opening melody segments remain exact in Alto 1. Opening N.C. harmony is editorial, as requested for the Auto arrangements. Later lines include octave-adjusted source cues, newly composed continuations, motif returns, and breathing changes; they are identified in the audit data.

This task begins from the rhythm chart, so the piano is newly arranged here. It is not a piano-plus-band edition with an unchanged original piano part. No complete vocal melody is claimed where the rhythm chart does not supply one.

## Learning and rehearsal material

- `PROCESS.md`: comprehensive musical/technical explanation, actual code examples, and primary references.
- `PLAYER-REVIEW.md`: rehearsal sequence, instrument-specific questions, and a structured player-feedback table.
- `REGISTERS.md`: actual sounding/written ranges, activity, and continuous wind-phrase lengths.
- `arrange.py`: complete piece-specific arrangement and export generator.
- `notation.py`: shared note-value, XML, pitch, and beaming helpers.
- `test_arrangement.py`: 32 structural and musical tests, including deliberately corrupted cases.
- `test-results.txt`: successful current test run.
- `arrangement-events.json`: note events with roles, source identifiers, and editorial provenance.
- `harmony-plan.json`: source chord spans, added colors, and selected voicings.
- `source-audit.json`, `validation.json`, `pdf-validation.json`: source facts and distinct validation stages.
- `engrave-jobs.json`: MuseScore PDF export jobs; regenerate after moving the folder.
- `manifest.json`, `verify_package.py`: file hashes and package integrity check.
- `source-rhythm.pdf`, `source-rhythm.musicxml`: unchanged reference copies.

## Verification and reproduction

The 32 tests pass. All 18 arrangement PDFs were rendered; their 103 pages were visually inspected. Score and part pitch/timing/tie content is compared after reopening the MusicXML, including the performed repeat route. Title, instrument identity, and paper size were checked in the final PDFs.

Audio and live-player review are not completed. Notation correctness and visual review do not certify balance, groove, fingering, breath comfort, or performance readiness. Use the player-review sheet to refine the edition with your musicians.

Python 3 and its standard library are enough to run the musical generator and tests:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

`arrange.py` rewrites derived XML/JSON in its own folder and retains the source copies. PDF export requires MuseScore 4; the process guide gives the command. The generator contains Washed-specific phrase assignments and form, so changing only the source file is not sufficient to arrange another song.

To check the delivered file hashes before editing:

```sh
python3 verify_package.py
```

The manifest describes the delivered edition. Intentional edits or regeneration can change hashes; retain your changes and regenerate a new manifest if distributing a revised edition.

The source composers, rights notice, and original arrangement/orchestration credits remain in MusicXML. A malformed placeholder lyricist field was omitted from derived identification. Codex assisted the editorial arrangement and Python authoring; no external music-generation service supplied these notes. Original source copies remain byte-for-byte unchanged.
