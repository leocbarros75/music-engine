# Washed — Brass Auto

An eight-part brass arrangement from the same rhythm-chart source used for String Auto and Wind Auto. The ensemble develops the source melody, chords, riffs, and form; there is no retained piano staff.

## Start here

- `washed-brass-auto.pdf`: 16-page full score, **A3 portrait**.
- `washed-brass-auto.musicxml`: editable full score.
- Eight `washed-*.pdf` parts: four pages each, **A4 portrait**.
- Matching MusicXML files: separately editable parts.
- `PROCESS.md`: musical decisions, code walkthrough, examples, references, and verification limits.
- `PLAYER-REVIEW.md`: practical first-reading feedback sheet.
- `arrange.py`, `notation.py`, `test_arrangement.py`: complete, executable Python source.
- JSON files: source audit, concert-pitch events, harmony/voicing plan, and validation reports.
- `source-rhythm.pdf` and `source-rhythm.musicxml`: unchanged source copies.

| Part file | Instrument | Notation |
|---|---|---|
| washed-T1 | Trumpet 1 in B-flat | Treble; written a major second above sounding |
| washed-T2 | Trumpet 2 in B-flat | Treble; written a major second above sounding |
| washed-H1 | Horn 1 in F | Treble; written a perfect fifth above sounding |
| washed-H2 | Horn 2 in F | Treble; written a perfect fifth above sounding |
| washed-TB1 | Tenor Trombone 1 | Bass clef; concert pitch |
| washed-TB2 | Tenor Trombone 2 | Bass clef; concert pitch |
| washed-BT | Bass Trombone | Bass clef; concert pitch |
| washed-TU | Tuba | Bass clef; concert pitch, no octave transposition |

The full score uses **transposed instrumental staves with concert-pitch chord symbols** above Trumpet 1. In individual trumpet/horn parts, chord symbols are transposed to agree with their written notes. This convention is identified in the score subtitle.

## What is preserved and what is new

The source is a Dorico rhythm chart containing a partial melody and pitched instrumental cues, not a complete vocal lead sheet. Its pickup, 123 numbered measures, printed chord symbols from measure 9 onward, repeats, endings, and opening melody are preserved. The opening N.C. passage receives editorial harmony. New instrumental continuations and returns of source material fill passages originally represented by rhythm slashes. The result should not be treated as a reconstruction of an unprovided complete vocal melody.

B major; 4/4; quarter note = 139, even eighths. This edition retains the source's energetic character. No audio-generation service was used: the included Python generator writes the notated arrangement from explicit musical rules and this edition's phrase plan.

## Reproduce and inspect

Work inside this extracted folder:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

Python uses only its standard library. Running the generator rewrites the MusicXML and musical JSON reports; it **does not update the PDFs**. Import the new MusicXML into MuseScore, Dorico, Finale, or another compatible notation application and export the score and parts. MuseScore's batch job list is supplied as `engrave-jobs.json`; regenerate it after moving the folder because its paths are absolute.

The delivered edition passed 21 structural and mutation tests. All 48 output PDF pages were rendered and visually reviewed. These checks establish the documented notation and source-preservation properties; acoustic balance, intonation, slide/valve choices, and endurance still require a player reading. No audio review or live rehearsal was performed.

Original composer and rights credits remain in the score. The package's source copies are unchanged; the brass arrangement is identified as editorial. The manifest records file sizes and SHA-256 hashes for delivery verification.
