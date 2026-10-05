# Washed - Professional Orchestra

A standalone orchestral arrangement of the same source used for the String Auto, Wind Auto, and Brass Auto editions. This edition adds more independent lines, changing foreground instruments, broken-chord figures, resolved ornaments, and contrasting sectional textures for professional musicians.

## Deliverables

- `washed-orchestra-professional.pdf`: full score, 31 pages, **A3 portrait**; print at actual size.
- `washed-orchestra-professional.musicxml`: editable full score.
- Nineteen `washed-*.pdf` instrumental parts: four pages each, **A4 portrait**.
- Matching individual MusicXML parts.
- `PROCESS.md`: comprehensive musical and technical explanation, examples, and references.
- `PLAYER-REVIEW.md`: conductor's first-reading priorities and player feedback sheet.
- `arrange.py`, `notation.py`, `test_arrangement.py`: complete executable Python source, including 32 tests.
- JSON files: concert-pitch events, harmony/voicing plan, source audit, participation/breathing checks, and PDF review.
- Unchanged copies of the original rhythm PDF and matching Dorico MusicXML.
- `delivery-manifest.json`: file sizes and SHA-256 hashes.

## Instrumentation and part filenames

| Family | Instrument | File stem |
|---|---|---|
| Woodwinds | Flutes 1 and 2 | washed-FL1, washed-FL2 |
| | Oboe | washed-OB |
| | Clarinet in B-flat | washed-CL |
| | Bassoon | washed-BN |
| Brass | Horns 1 and 2 in F | washed-H1, washed-H2 |
| | Trumpets 1 and 2 in B-flat | washed-T1, washed-T2 |
| | Tenor Trombones 1 and 3 | washed-TB1, washed-TB3 |
| | Bass Trombone | washed-BT |
| | Tuba | washed-TU |
| Percussion | Timpani, two drums tuned F-sharp 2 and B 2 | washed-TI |
| Strings | Violins 1 and 2 | washed-V1, washed-V2 |
| | Viola | washed-VA |
| | Cello | washed-VC |
| | Double Bass | washed-CB |

Trombone numbering follows your earlier orchestra list. The score has 19 instrumental/section staves; it does not specify string section headcount. No piano staff is included.

Concert B major, 4/4, quarter note = 139, even eighths. The full score uses **transposed instrumental notation with concert chord symbols** above Flute 1. Individual clarinet/trumpet/horn parts transpose chord symbols to match written notes. B-flat instruments read C-sharp major; horns read F-sharp major. Double bass is written an octave above sounding, while tuba uses concert bass clef.

## Source and editorial scope

The source is a rhythm chart containing a partial melody and instrumental cues, not a complete vocal lead sheet. The original pickup, opening melody, 123 numbered measures, later printed harmony, repeats, and endings are preserved. The N.C. opening receives editorial harmony; slash-only passages receive new instrumental continuations. Later source cues may move by octave, and wind/brass phrase endings include documented breathing adaptations. Later returns of the opening theme are editorial.

Strings have the most nominal sounding activity, followed by woodwinds, brass, and timpani. This is a measurable design choice, not an acoustic balance guarantee. The edition passed 32 structural/corruption tests. All 107 output PDF pages were rendered and visually reviewed. Audio review and a live player reading have not been performed; the included review sheet identifies the next musical checks.

## Reproduce

Inside this extracted folder:

```sh
python3 arrange.py
python3 -m unittest -v test_arrangement.py
```

The generator uses Python's standard library and rewrites MusicXML and musical JSON reports. PDFs require a fresh export from a notation application. `engrave-jobs.json` contains MuseScore batch paths; rerun the generator after moving the package to update those absolute paths.

This is piece-specific educational code. It is not a universal arranger into which any score can be substituted without changing the form, source selection, and musical plan. Original composer and rights credits are retained; the added orchestral arrangement is identified as editorial.
