# Calibrating player-level bands against published graded editions

`src/arrange/difficulty/levels.ts` decides how high a part may be written for a
player at a given level. Those numbers started as pedagogy — the registers band
method books stay inside in a first year — and were marked provisional from the
day they were written. This directory is how two of them stopped being
provisional.

## What counts as evidence

A graded edition is the **same arrangement published twice by the same house,
once as written and once simplified**. That pair is a difficulty statement: a
professional editor saying, about this exact music, what a less able player
should be asked to play. Nothing else here is.

A professional part on its own is *not* evidence of a band. It records what one
arranger chose to write, not what the instrument's players can manage, so it is
measured and recorded but never used to set a limit.

## The source

Semsen Music, *The Hymns Project, Vol. 3 (Christmas)* — strings pack, arranged
and orchestrated by Cliff Duren, 2024. Ten pieces. For each one the pack ships
`Violin 1, 2` and `Violin 1, 2 (Simplified)`: ten graded pairs, of which eight
carry music and two are marked TACET.

Viola, Cello, String Bass and the three doubling parts ship at one level only.
They are measured for the record and for cross-validation; they set nothing.

**The pack is purchased sheet music and is not in this repository.**
`measured-bands.json` — the numbers it yielded — is.

## Method

The parts are Finale engravings printed through Quartz, which writes every
glyph as its own `cm`/`Tm`/`Tj` and draws staff lines, ledger lines, stems and
barlines as explicit strokes. So a notehead's pitch is geometry, not image
recognition: its height against the five staff-line positions, plus the clef
glyph's own line and the accidentals in front of it.

This is not OMR and will not survive a scanned page. It is deliberately narrow.

- `finale_pdf.py` — PDF object layer and a content-stream interpreter
  (graphics/text state, `q`/`Q`/`cm`/`Tm`/`TJ`, path segments). Stdlib only.
- `read_part.py` — staves, clefs, key signatures, accidentals, pitches.
- `measure_bands.py` — walks a pack, transposes to sounding pitch, splits
  divisi staves into their two section lines, writes `measured-bands.json`.

```sh
python3 tools/calibration/measure_bands.py "/path/to/The-Hymns-Project-Vol3_Strings-Pack"
```

It exits non-zero if any notehead could not be placed on a staff.

## How the reader was checked

A measuring instrument gets verified before its readings are used.

1. **Against the engraved page.** Bars 13–16 of *Joy to the World!* read
   `C4 B3 C4 C4`; the rendered page shows three whole notes on the ledger line
   below the staff and one hanging beneath it.
2. **Key signatures fall out of the geometry.** Page 1 of *Joy to the World!*
   has none and the extracted notes carry no accidentals; later pages carry two
   sharps and the sharps land on F and C.
3. **Doubling parts agree.** Viola/Clarinet 3, Cello/Bassoon and String
   Bass/Bass Clarinet are the same music written for different instruments.
   All **30 pairs** return identical note counts.
4. **The transposition is coherent.** Aligned note by note, the bass clarinet
   sits a written major 9th above the string bass for 83 notes and a written
   major 2nd for 38 — an octave above the contrabass, dropping to unison where
   the register allows.
5. **Nothing is silently dropped.** All **78 parts** read with zero noteheads
   left unassigned, and the totals match the raw glyph inventory exactly.

Three defects were found and fixed this way, each of which had silently
swallowed whole systems: a greedy staff scan derailed by a multi-measure-rest
bar; an adjacency chain broken by a hairpin and a beam; and a single modal
staff spacing on a page whose last system is engraved larger.

Note 3 and 5 are the load-bearing ones. They are cheap, they are independent of
anything I believe about the music, and either would have failed loudly if the
reader were dropping or mislocating notes.

## What was measured

Sounding pitch, medians across editions.

| | editions | ceiling | floor |
|---|---:|---|---|
| Violin 1 — as published | 10 | G♯6 | A3 |
| Violin 1 — simplified | 8 | **D6** | A♯3 |
| Violin 2 — as published | 10 | A5 | A3 |
| Violin 2 — simplified | 8 | **A5** | A3 |

Three things the pair says, none of which were assumptions going in:

- **Simplifying is a ceiling operation.** The ceiling falls by a median of 6
  semitones (range 3–8). The floor does not rise — in six of eight editions it
  is identical, and where it moves it moves *down*. This is what
  `simplify.ts` already does, now with evidence rather than a judgement call.
- **It targets the top line only.** Violin 2's register is untouched: same
  median ceiling, same floor, identical range in six of eight.
- **Register is not the whole of it.** The simplified editions also carry about
  25% fewer notes (median ratio 0.75), and in two of ten the answer is TACET —
  the simplified players sit the piece out.

## What this does and does not calibrate

Calibrated from measurement: `violin_1` and `violin_2`.

Still seeded from pedagogy: every other entry in `STUDENT_BAND` — all the
winds, all the brass, the saxophones, the voices, the mallets, and the
remaining strings. **No graded pair exists for them in this pack**, and a
violin-derived offset applied to a horn would be the same invention the
measurement was meant to replace. They are marked in the table.

Known limits of what *is* calibrated:

- One publisher, one arranger, one genre, ten pieces, all Christmas hymn
  arrangements for a church string section. It is the idiom this engine
  targets, which is why it is worth having, and it is still one sample.
- Two published levels cannot calibrate four engine levels. `beginner` is
  measured and `advanced` remains the catalog's preferred range.
  `intermediate` is an interpolation between them except for the violins,
  where the interpolation gave bad answers. `violin_1` is set outright to
  **E6**, the ceiling of the two most demanding simplified parts in the pack —
  the midpoint had landed on G6, a semitone under this arranger's professional
  median, because the catalog calls B6 comfortable. `violin_2` is set to
  **C6**: the same reference would collapse it onto beginner, since the
  publisher does not simplify the second line at all, so it is anchored instead
  to where second violin parts normally stop (B5 in nine of ten editions).
  Both are Leo's calls, anchored to the editions rather than derived from them.

  On the measured editions C6 behaves exactly as the old D♯6 midpoint did —
  B5 through D♯6 all rewrite only the single E6 outlier and leave every
  simplified edition alone. The test pins that behaviour band rather than the
  value, because the editions do not support finer precision than that.
- Ceiling only. The floors are recorded but set nothing, because the editions
  show the floor is not a difficulty constraint.
