# Living Hope: original piano with a complementary wind quartet

Music by Brian Johnson and Phil Wickham. Original piano arrangement by
Dan Galbraith; source identifies PraiseCharts #71163 and CCLI #7106807.

## The musical result

This edition is for piano, flute, oboe, B-flat clarinet and bassoon. The piano's
music remains intact; the four winds add newly composed accompaniment. It is
not the earlier wind transcription with piano added back underneath it.

The source contains 62 notated measures in E-flat major, 4/4, quarter note = 71.
Its repeats, alternate endings, chord symbols, pedal, piano voices, cue figures
and final fermatas remain. There is no independent vocal staff in the supplied
file, and none has been reconstructed.

The wind layer has 384 notes: flute 90, oboe 110, clarinet 99 and bassoon 85.
All four parts are monophonic, for one player each. The piano supplies the main
musical continuity. Wind rests are therefore a useful arranging resource rather
than something that must be filled.

## 1. Preserve the piano before writing around it

`original-piano.musicxml` is an unchanged copy of the supplied source. The
generator deep-copies its piano part into the combined score, retaining all
1,005 pitched piano note segments. A segment includes a tied continuation and
should not be confused with an independent attack.

For the new engraving, old page breaks, measure widths, coordinates and
font-family overrides are removed. The title block embedded in source measure
2 is relocated to the score header. A source dynamic range encoded as separate
`mp`, `-`, and `mf` objects is displayed as one italic `mp - mf` instruction so
the marks do not overlap. In measure 35 that range and the simultaneous
`2x - more motion` text share one instruction, retaining both messages without
colliding. These are layout/display normalizations; notes,
rhythms and musical instructions remain.

The preservation test compares canonical XML trees after applying those same
documented normalizations to the original and copied piano. Separate tests
deliberately alter a piano pitch and the tempo and require validation to fail.
The source hash is recorded in `validation.json`.

## 2. Read the supplied harmony accurately

The source already contains chord symbols, so the harmonic plan reads their
structured MusicXML rather than guessing chords from the most frequent notes.
The parser handles roots, chord kinds, added degrees and slash basses.

Two examples matter particularly here:

- A-flat add2 includes A-flat, B-flat, C and E-flat. The second is added while
  the third remains present.
- B-flat sus4 uses B-flat, E-flat and F. It is not automatically changed to
  B-flat major by introducing D.

Inversions such as E-flat/B-flat, B-flat/D, A-flat add2/C and E-flat/G remain
in the harmonic plan. Bassoon accompaniment follows the indicated bass pitch
class. The pianist retains the original bass material underneath it.

MusicXML uses eight divisions per quarter in this file. A bar therefore has
32 divisions. `read_source()` follows normal notes, chord members, `backup`
and `forward` instructions to locate each harmony accurately. When a measure
contains no new symbol, the previous harmony continues; measure 48 is one such
case.

## 3. Plan the wind texture by section

| Measures | Added wind treatment | Purpose |
|---|---|---|
| 1-4 | Piano first; quiet clarinet color, a little bassoon, then oboe | Introduce the ensemble gradually |
| 5-12 | Piano starts the verse alone; sparse middle-register support | Preserve the verse's intimacy |
| 13-23 | More oboe/clarinet support and selected short answers | Strengthen the continuation |
| 24-34 | Four-part support with offset entrances and releases | Broaden the chorus without constant doubling |
| 35-42 | Flute mostly rests; reduce the wind texture | Make the later verse feel different |
| 43-48 | Fuller support and alternating upper answers | Build toward the next chorus |
| 49-56 | Full but restrained wind harmony | Support the final chorus while piano remains prominent |
| 57-61 | Short answering gestures and spacious support | Shape the closing refrain |
| 62 | Four sustained wind notes and a shared fermata | Coordinate the final release with piano |

The wind dynamics generally stay in a supportive range. The final chorus is
marked mezzo-forte in the winds while the original piano's dynamics remain.
The intended balance must still be adjusted in rehearsal for the actual room
and players.

## 4. Choose connected voicings

The `voicing()` function enumerates suitable pitches for bassoon, clarinet,
oboe and flute. Candidate voicings must remain ordered and keep adjacent upper
voices within an octave. A cost favors small movement, chord-tone coverage and
moderate registers:

```python
cost = motion + 2 * leap_penalty + 12 * missing_chord_tones + 0.2 * register_cost
```

This is a local search, choosing the next voicing from the previous one. It is
not a simulation of human fingering and is not a globally optimized composition.
The bassoon's actual sounding note is then set from the source's specified
bass/inversion. The other selected pitches form a harmonic template; the
section plan decides which instruments actually play it.

The accompaniment's actual registers are deliberately moderate: flute D5-G5,
oboe D4-B-flat4, clarinet sounding G3-C4, and bassoon G2-E-flat3. The clarinet's
lower color helps separate it from the flute and oboe. Those register choices
are editorial decisions for this accompaniment, not limits of the instruments.

## 5. Compose answers instead of duplicating the piano

Selected flute and oboe answers use a quarter note and two eighths over the
last two beats of a sufficiently long harmonic segment:

```python
gesture = [(0, 8, p), (8, 4, q), (12, 4, p)]
```

Here `p` is a selected chord tone and `q` is a nearby different chord tone.
The figure receives a short slur, with the two eighths beamed together.
It is a newly constructed harmonic answer, not a copied piano phrase or a
claim to reproduce a commercial recording's wind orchestration.

For example, measures 26 and 28 alternate flute and oboe answers. Other
instruments support the harmony with rests between entries. The answers use
chord tones; their middle notes are not mislabeled as non-chord neighbor tones.

Elsewhere, the accompaniment delays an oboe entrance by a quarter note while
flute and clarinet enter earlier. Bassoon usually gives a short harmonic
punctuation rather than duplicating the pianist's entire bass pattern.

## 6. Build breathing space into the rhythm

Strings can renew the bow while sustaining a texture. Wind players need air,
and each instrument has different demands. Here breathing is handled primarily
through written rests instead of long sustained phrases interrupted by commas.

Before the final fermata, the longest continuous passages in the notated
sequence are 3.5 beats for flute, oboe and clarinet, and 3 beats for bassoon.
At quarter note = 71, 3.5 beats is about 2.96 seconds. The rests keep the added
texture light and give frequent breathing opportunities. This duration check
does not guarantee every player's comfort at every dynamic; it establishes a
clear structural allowance for breathing.

The final fermata is an intentional exception. Players should prepare enough
air for the agreed hold, and the ensemble should coordinate its release with
the pianist. A breath comma is not needed after every short phrase when a rest
already makes the opportunity explicit.

Slurs join only the short answering figures. They indicate connected wind
articulation. They are not ties: the figures change pitch, while ties would
extend a repeated pitch without rearticulation.

## 7. Transpose the clarinet correctly

The internal event list stores sounding MIDI pitches. The B-flat clarinet's
exported notes are written two semitones higher, in F major:

```python
written_pitch = sounding_pitch + 2
```

The MusicXML part declares `diatonic = -1` and `chromatic = -2`, describing
the interval from written pitch to sounding pitch. Both the combined score
and separate clarinet part use transposed notation. The piano, flute, oboe
and bassoon remain in concert E-flat major.

Validation reads clarinet notes back into sounding pitch before comparing
them with the event list. This catches pitch errors without mistaking the
instrument's expected transposition for an error.

## 8. Files, reproduction and checks

Use Python 3; no external Python packages are needed for the generator:

```sh
python3 arrange.py
python3 -m unittest -v
```

This regenerates five MusicXML files, the event list, harmonic plan, validation
report and MuseScore export job list in the same folder. The original external
drive file is never edited.

For PDFs with MuseScore 4 on macOS:

```sh
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

After moving the folder, run the generator first to refresh the job list's
absolute paths. PDF export is separate from MusicXML generation.

The nine tests check piano preservation, rejected pitch/tempo corruption,
clarinet notation, breathing opportunities, chord types and inversions,
matching extracted parts, piano-only openings, the final release, and rejected
wind-duration corruption. The core validator also checks all measure lengths,
instrument ranges, slur closure, chord membership and repeated-section endings.

The PDFs were visually reviewed. No live read-through or audio-based balance
assessment is claimed. Chord membership is useful but does not by itself prove
the best interaction with every piano passing note. The player read-through
is where balance, phrasing and any intrusive answer should be refined.

## Learning references

The supplied piano score is the musical source. Instrument demonstrations and
notation references for further study include:

- [Philharmonia: Flute](https://philharmonia.co.uk/resources/instruments/flute/)
- [Philharmonia: Oboe](https://philharmonia.co.uk/resources/instruments/oboe/)
- [Philharmonia: Clarinet](https://philharmonia.co.uk/resources/instruments/clarinet/)
- [Philharmonia: Bassoon](https://philharmonia.co.uk/resources/instruments/bassoon/)
- [W3C: MusicXML transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)

These sources support instrument and encoding knowledge. The section plan,
voicing weights, entrances and answering figures are editorial choices for
this score.

A useful exercise is to mute the wind parts, then add clarinet, bassoon, oboe
and flute one at a time. Notice what each adds and where the original piano
already supplies enough information. Then remove one wind entrance without
changing any pitches. The difference demonstrates why register, timing and
silence are central to complementary arranging.
