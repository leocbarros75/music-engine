# Living Hope: piano with a complementary string ensemble

Music by Brian Johnson and Phil Wickham. Original piano arrangement by
Dan Galbraith. The supplied source identifies PraiseCharts #71163 and
CCLI #7106807. Original attribution and rights metadata are retained.

## The result

The original two-staff piano music is retained, with five newly arranged lines:
Violin I, Violin II, viola, cello and double bass. One musician can play each
string part; sections can also play these lines in unison. No divisi or multiple
stops are required. The file contains no independent vocal staff, so none has
been invented. Its existing vocal-entry text cues remain in the piano part.

The score has 62 notated measures in E-flat major, 4/4, quarter note = 71.
Repeats and first/second endings are retained rather than expanded into a
linear performance. The 1,005 original pitched piano note segments remain;
606 new string notes form the accompaniment. The word "segments" includes tied
continuations, so it is not a count of separate piano attacks.

## 1. Begin with the musical role

The pianist already supplies the recognizable material. The added strings
therefore provide continuity, color and a sectional rise in intensity. They
do not need to reproduce every piano attack. This arrangement uses a sustained
ballad texture, unlike the more rhythmic string accompaniment made for Last
Train to London.

The initial bar belongs to piano alone. Inner strings enter quietly, and
Violin I enters later. During the first verse, the highest string line appears
only at selected phrase endings. The chorus opens into fuller harmony. The
later verse retreats, introduces quiet repeated viola quarters, and then
builds toward the final chorus. All players share the final fermata.

| Bars | String treatment | Reason |
|---|---|---|
| 1-4 | Piano alone, then inner strings and a delayed upper entry | Establish the piano sound before adding weight |
| 5-12 | Viola support, delayed second violin, sparse cello, occasional first violin | Leave room for the verse |
| 13-23 | Four bowed lines, selected bass entries and short answers | Gradually strengthen the phrase |
| 24-34 | Full ensemble, sustained harmony and brief upper inflections | Give the chorus breadth |
| 35-42 | Reduced first violin and bass; quiet viola quarter-note motion | Create contrast and forward motion |
| 43-48 | Fuller strings and bass | Build toward the next chorus |
| 49-56 | Full ensemble with stronger dynamics | Support the main arrival |
| 57-61 | Broad closing refrain at a slightly reduced dynamic | Shape the release |
| 62 | E-flat-major sonority with fermatas | Coordinate the final cutoff |

These are arranging decisions for this supplied score. They are not a claim
to reproduce the commercial recording's orchestration.

## 2. Protect the source before composing

`original-piano.musicxml` is a byte-for-byte copy of the user's file. Its SHA-256
hash is recorded in `validation.json`.

The combined score copies the original piano part's XML tree. It does not
reconstruct that part from inferred notes. This preserves voices, cue notes,
ties, chord symbols, expressions, pedal markings, repeats, alternate endings
and the original final fermatas.

Only engraving metadata is normalized: old page breaks, measure widths,
coordinates and font-family overrides are removed. An embedded title block
in measure 2 is relocated to the new score's title/credits area. The original
piano's music and performance directions remain. Its full rights notice is
kept in score metadata and the unchanged source file, with a visible source
credit in the PDF.

`validate()` compares canonical XML trees after applying the same normalization
to the original and output piano. This catches changes beyond the notes, such
as a missing tie or altered repeat. A deliberate pitch corruption is included
in the tests to show that the preservation check actually rejects a change.

## 3. Read time and harmony from MusicXML

This source uses eight divisions per quarter note:

```python
eighth = 4
quarter = 8
half = 16
bar = 32
```

A normal note advances the timeline cursor. A chord member starts with the
preceding note. A `backup` moves the cursor backward so another voice or staff
can be encoded. A harmony element applies at the current cursor position,
plus its explicit offset when one exists.

The source contains actual chord symbols. Using them avoids guessing all the
harmony from note-frequency statistics. `parse_chord()` reads the root, chord
kind, added degrees and bass note. `read_source()` gives each harmony an exact
start and duration. In measure 48 no new chord symbol appears; E-flat harmony
is carried forward from measure 47.

Two important distinctions in this source:

- **A-flat add2 contains A-flat, B-flat, C and E-flat.** The added second does
  not remove the third. Parsing only the displayed "2" could incorrectly turn
  it into a suspended chord.
- **B-flat sus4 contains B-flat, E-flat and F.** Adding D would change its
  suspended character. The added strings therefore use the suspension's
  actual pitch collection until the harmony changes.

These distinctions have dedicated tests. So do slash chords: E-flat/B-flat,
C minor/E-flat, B-flat/D, A-flat add2/C and E-flat/G retain their bass identity.
For example, at beat three of measure 30 the double bass uses B-flat under
E-flat harmony. Replacing it with an E-flat root would change the inversion.

## 4. Choose a connected voicing

`voicing()` enumerates candidate pitches for cello, viola, second violin and
first violin within deliberately moderate registers. It rejects crossed
voices and upper adjacent spacings greater than an octave. The remaining
voicings receive a numerical cost:

```python
cost = motion + 2 * large_leap_penalty + 12 * missing_chord_tones + 0.2 * register_cost
```

`motion` sums semitone distances from the previously selected voicing.
`large_leap_penalty` rises quadratically for movements beyond five semitones.
`missing_chord_tones` encourages coverage. `register_cost` keeps the ensemble
near selected comfortable centers.

This is local exhaustive search, not global optimization of the whole score.
The selected voicing also acts as a template when some players rest. The
algorithm does not pretend to simulate a player's fingers or bow. Its value
is that the constraints and preferences are explicit and reproducible.

The double bass is handled separately: its pitch class comes from the chord's
specified bass, with an available octave chosen within a standard accompaniment
register. It is written an octave above its sounding pitch with a MusicXML
transpose declaration. The minimum allowed sounding note is E1; no extension
below a standard four-string instrument is required.

## 5. Turn harmony into an arrangement

The chord template supplies possible pitches; the section plan controls who
plays, when they enter and how long they sustain.

At this tempo, a half note lasts approximately 1.69 seconds. Most full-bar
support is written as two half notes, giving natural bow-renewal points rather
than requiring every player to sustain a long chain in one bow. Players should
make these changes discreetly. The repeated half notes are not ties: a gentle
renewal is permitted.

Selected first-violin answers occupy the last two beats of a phrase:

```python
# p: selected chord tone; q: a nearby different chord tone
gesture = [(0, 8, p), (8, 4, q), (12, 4, p)]
```

Those numbers mean a quarter note followed by two eighth notes. A short slur
connects the gesture. Its middle note is a chord-tone inflection, not necessarily
a non-chord neighbor. The code does not label it as a true neighbor tone when
it does not meet that definition.

For measures 35-42, the viola uses gentle repeated quarters. The first violin
and bass are reduced, so adding rhythmic motion does not simply make every
instrument busier. The printed instruction asks the ensemble to grow on the
second pass; the notes and source repeat structure stay the same.

Each generated note has a `role` in `arrangement-events.json`. This makes it
possible to inspect the intended function of a note, not just its MIDI number.
The harmonic plan records each chord, its pitch collection, bass, time span
and selected four-part voicing.

## 6. Bowing and rehearsal

All five string parts are arco. Upper answers use short slurs; sustained lines
leave bow renewal to the player. Tenuto marks in the later viola verse mean
warm, connected weight rather than hard accents. No automatic up/down-bow
pattern is imposed on every note.

At rehearsal, first check whether the piano remains clear. Then check the
entrances at measures 5, 24, 35 and 49, and coordinate the final fermata and
cutoff. With sections, principals can set uniform bow directions after hearing
the room and choosing the degree of articulation. With single players, allow
the accompaniment to retain a chamber-music transparency.

The final whole notes with fermatas require a shared release; players may
renew the bow as necessary. A fermata does not imply that one bow must last
for an arbitrarily long conductor-held duration.

## 7. Reproduce or modify the arrangement

Use Python 3; the generator needs only the standard library:

```sh
python3 arrange.py
python3 -m unittest -v
```

The generator writes six editable MusicXML scores, the note list, harmonic
plan, validation report and PDF-export job list into its own folder. It does
not edit the source on the external drive.

To export PDFs using MuseScore 4 on macOS:

```sh
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

Run `arrange.py` first if you move the folder: this refreshes the absolute paths
in `engrave-jobs.json`. Editing MusicXML does not automatically update the PDFs.

The nine tests cover source preservation, written-to-sounding bass pitches,
bar durations, ranges, slur closure, chord membership, repeats and endings,
individual-part agreement, the suspended/add2 distinctions, carried harmony,
and the final fermata. Two tests deliberately corrupt the score and require
validation to fail.

The tests establish structural consistency. They do not establish the best
possible balance, phrasing or interaction with every piano passing note. The
PDFs also need visual review, and the arrangement still benefits from a live
read-through. No live performance or audio-based balance assessment is claimed.

## 8. References and useful exercises

The supplied piano score is the musical source for this arrangement. These
public references support the instrument and encoding facts:

- [Philharmonia: Violin](https://philharmonia.co.uk/resources/instruments/violin/)
  introduces register, sustain and bowing. Listen for how bow speed and attack
  change the impression of an otherwise identical written note.
- [Philharmonia: Double Bass](https://philharmonia.co.uk/resources/instruments/double-bass/)
  introduces the instrument and its octave-transposing notation.
- [W3C: MusicXML transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)
  specifies the written-to-sounding pitch relationship used in the export.

Try changing only the viola rhythm in four bars: two half notes versus four
quarters. Keep the pitches and dynamics identical. Then compare the result.
This isolates the effect of articulation density from reharmonization.

A second exercise is to remove the first violin from the first chorus and
reserve it for the final chorus. The harmony remains largely supplied by the
piano, but the formal arrival changes. Restraint is an arranging parameter
that code can represent just as explicitly as adding more notes.
