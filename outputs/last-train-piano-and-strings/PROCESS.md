# Last Train to London: piano with an added string ensemble

Composer: Jeff Lynne. Supplied piano arrangement: Zach V.

This edition preserves the supplied piano part and composes five additional
string lines. The piano remains the principal rhythmic and melodic instrument.
The ensemble is Violin I, Violin II, viola, cello and double bass. Every string
part is monophonic: one player per part is possible, and sections can play the
same lines in unison. There is no mandatory divisi or double stopping.

## 1. The musical brief

The earlier transcription redistributed piano notes among strings. This edition
has a different objective: create an ensemble around a pianist who still plays
the original arrangement. Consequently, assigning every piano note to a string
instrument would produce excessive doubling and competing attacks.

The new material supplies three things the existing piano texture can use:

1. Sustained sound underneath or around the piano's decaying attacks.
2. Short, light offbeats that reinforce the pulse without copying the bass riff.
3. Brief independent answering figures, with rests that leave the pianist space.

Professional arranging does not require every player to be busy. In this edition,
the strings deliberately rest in measures 5-6, 103, 110 and 123. The opening and
high-register episodes also use reduced forces. These absences make the fuller
arrivals perceptible.

## 2. Preserve the piano as musical data

An MXL file is a ZIP archive containing MusicXML. The `unpack()` function reads
the container's declared root file rather than assuming an internal filename.
The output retains a byte-for-byte copy of the original MXL as well as its
extracted XML.

For the combined score, `build()` deep-copies the source piano part. It does not
infer and recreate the piano's notes. Notes, rests, voices, durations, ties,
tuplets, dynamics, pedal, octave indications, staff assignments and repeats all
remain in that copied musical tree. Original page/system breaks, measure
widths and positional coordinates are removed so the added staves can be laid
out afresh. One printed tempo is normalized: the source encodes `121` and a
separate `.4` word. They become a single `121.4` marking; the source's playback
tempo of 121.4 remains unchanged. Page appearance is therefore new; musical
content is preserved.

The validation compares a canonical representation of the original and output
piano trees after the same layout and printed-tempo normalization. This is stronger
than comparing note counts: it also catches an altered pitch, missing tie or
changed direction. There are 123 measures and 1,942 pitched piano note segments.
Tied continuations are segments, not new attacks.

## 3. Read the musical timeline

The source uses 60 divisions per quarter note. In its 4/4 bars:

```python
quarter = 60
eighth = 30
bar = 240
```

MusicXML is a sequence of instructions, not a table already sorted by time.
A normal note advances a cursor. A chord member shares the preceding note's
onset. A `backup` instruction moves the cursor backward for another voice or
staff. `piano_events()` applies these rules and extracts sounding pitch, onset,
duration, staff and measure for analysis.

That extraction is used to identify the bass roots and inspect the source.
It is not used to replace the original piano XML. This distinction also protects
the unusual source tuplets: the added strings use simple rhythms, while the
piano's original tuplet durations remain untouched.

## 4. Make an explicit harmonic and formal plan

The harmony is an editorial reading of this particular piano arrangement.
It is not presented as an authoritative chord chart of the commercial recording.
The code uses the low piano attacks to identify the E, B and A roots in the
groove. These are supported with Em7, Bm7 and Am7 colors. Explicit overrides
handle the C-D lifts, D-to-Em refrain arrivals, and the coda.

Pitch-class frequency alone is insufficient. For example, a frequently repeated
D in an E-minor bass riff does not automatically make the harmony D major.
The bass position, sustained upper notes and phrase context matter. For this
reason, `harmony()` contains readable, piece-specific decisions.

In the refrain's odd-numbered bars, the D harmony occupies the first three
beats and changes to Em on beat four. The source piano changes its material
there; the string support changes with it instead of sustaining F-sharp into
the new E-minor arrival.

The coda sometimes places upper harmony over a different bass note. The bass
part follows the supplied piano's low attack, preserving the inversion or
pedal implication. In even coda bars, the cello releases after two beats so
the pianist's moving bass, including its chromatic motion, remains exposed.

| Measures | Added texture | Musical purpose |
|---|---|---|
| 1-4 | Quiet inner-string veil; delayed Violin I entries | Establish atmosphere |
| 5-8 | Piano alone, then a small viola pickup | Let the groove establish itself |
| 9-22 | Viola offbeats, inner pedal, short violin answers | Add motion with space |
| 23-24 | Broader sustained harmony | Prepare the refrain |
| 25-32 | Sustained support and a simple upper arch | Broaden the sound |
| 33-38 | Lower sustained strings and middle-register answers | Contrast with high piano writing |
| 39-64 | Returning groove, lift and stronger refrain dynamics | Develop the sectional shape |
| 65-70 | Reduced texture | Recover space |
| 71-86 | Restrained support around piano ornamentation | Keep piano foreground |
| 87-96 | Lift and full refrain | Make a stronger arrival |
| 97-110 | Echoes separated by piano breaks | Alternate ensemble and solo sound |
| 111-122 | Broad coda support, selective bass punctuation | Support the changing bass context |
| 123 | Piano tag alone | Retain the source's repeat/tag behavior |

Rehearsal letters A-S mark these editorial sections. Section names such as
"refrain" are practical rehearsal descriptions, not claims about official form.
The source repeats are copied without expansion, including the final repeated
tag. No new concert ending has been imposed.

## 5. Choose voicings by constrained search

`voice_chord()` enumerates available pitches for cello, viola, Violin II and
Violin I. It rejects voice crossing and excessively wide adjacent upper voices.
The remaining candidates receive a cost:

```python
cost = motion + 2 * leap_penalty + 14 * missing_pitch_classes + 0.25 * register_cost
```

`motion` is the sum of semitone distances from the preceding selected voicing.
`leap_penalty` grows quadratically for movements larger than a fourth-plus-a-
semitone threshold of five semitones. `missing_pitch_classes` encourages chord
coverage. `register_cost` favors the chosen central tessituras.

This is a deterministic, greedy local search: it chooses the best next voicing,
not the globally optimal path for the whole composition. It does not simulate
fingering, bow contact, string crossings, expressive balance or human taste.
Its purpose is to make a manageable initial voicing decision reproducible.

The scoring weights are editorial parameters, not musical laws. Doubling a
chord tone can be preferable to complete coverage when the piano already
supplies the missing note. An extended Gmaj9 has five pitch classes but only
four upper bowed lines, so complete coverage is not always possible or needed.

The string tessitura constraints are intentionally narrower than the instruments'
absolute professional ranges. They are selected for this accompaniment. The
new violin material therefore does not need to follow the piano to its highest
octaves.

## 6. Compose gestures from the harmonic plan

`compose()` turns a chord plan into a texture. The rhythm depends on the
section; notes are not simply copied from the piano.

For the viola's groove, the onsets are:

```python
for onset in (30, 90, 150, 210):
    add('VA', bar, onset, 30, pitch, 'offbeat pulse', 'staccato')
```

These are the "and" of beats 1, 2, 3 and 4. The rests between attacks matter:
they keep the string layer from filling all the piano's rhythmic space.

The upper lyrical arch uses a half note, a quarter-note chord-tone inflection,
and a quarter-note return. A short answer uses a quarter and two eighths in the
second half of the bar. These are newly constructed gestures shaped by the
source's harmonic rhythm. They are not quotations of a separate recorded string
part. Their middle notes are chord tones; the code does not falsely label them
as non-chord neighbor tones.

In a more elaborate revision, true non-chord neighbors could be introduced on
weak subdivisions and resolved by step, but each would need to be checked
against the actual piano melody. This edition deliberately keeps the added
pitch vocabulary restrained because the piano already contains ornamental and
chromatic activity.

Double bass supplies sparse pizzicato arrivals. It takes the pitch class of
the piano's low attack, then chooses an available octave in its accompaniment
register. It does not copy the piano's repeated bass riff.

## 7. Notate what a player needs

The bowed strings receive short slurs for connected gestures and staccato
marks for the viola offbeats. The brief slurs fit within a single bar. Long
un-slurred support notes allow players to choose practical bow distribution.
There is no blanket sequence of up/down-bow signs: the principal can set those
after hearing the balance and deciding the desired articulation.

A slur joins different notes into a connected gesture; a tie extends the same
pitch's duration. The new string writing here does not need cross-bar ties.
The original piano's ties are preserved independently. Staccato specifies the
character of the release, not a requirement to use an off-string stroke.

The double bass is marked "Pizz. throughout". Its XML pitches are written an
octave above their intended sound and use `octave-change = -1`. The W3C
MusicXML definition specifies transposition as the interval added to written
pitch to obtain sounding pitch. Playback timbre can depend on the notation
application's treatment of pizzicato text; notation and MIDI program alone
are not a guarantee of a realistic sample-library performance.

The pianist should remain clearly audible. With sections, start the string
dynamics conservatively and let the conductor adjust. With one player per
part, the same notes produce a more transparent chamber sound.

## 8. Validation and reproduction

From this folder, using Python 3 and its standard library:

```sh
python3 arrange.py
python3 -m unittest -v
```

The generator writes six MusicXML files, the arrangement event list, harmonic
plan, validation report and a MuseScore export job list. It regenerates those
files in its own folder; it does not modify the original Downloads file.

For PDF output with MuseScore 4 on macOS:

```sh
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

Run the generator first after moving the folder: it updates the absolute paths
in the job list. PDF export is a separate step. A changed MusicXML file does
not automatically update an existing PDF.

The eight tests check preserved piano content; ranges, bar duration, repeat and
export fidelity; local chord membership; intended piano-only breaks; short,
closed slurs; matching extracted parts; and bass pitch classes. Two tests
deliberately corrupt the score to ensure the validator rejects it.

These tests prove the stated structural properties. They do not prove that a
passage balances well in a room or that a player prefers its phrasing. The
edition still benefits from a read-through. In particular, local chord-tone
membership is not a comprehensive test for clashes with passing piano notes.

Useful files:

- `arrangement-events.json`: every new note, its onset, duration and role.
- `harmonic-plan.json`: every harmonic segment and selected voicing.
- `validation.json`: preservation and structural check results.
- `arrange.py`: complete, commented generator for this source.
- `test_arrangement.py`: runnable validation tests.

## 9. Learning references

The musical plan above is an editorial design for the supplied score. These
references support instrument and notation facts rather than dictating its
notes or guaranteeing a particular arrangement:

- [Philharmonia: Violin](https://philharmonia.co.uk/resources/instruments/violin/)
  demonstrates the instrument, explains the character of its registers and
  discusses how bow direction can affect articulation. Listen for how sustained
  strings contrast with a piano attack.
- [Philharmonia: Double Bass](https://philharmonia.co.uk/resources/instruments/double-bass/)
  introduces the instrument and its sounding/written octave relationship.
- [W3C MusicXML: transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)
  gives the precise encoding rule used for the bass part.

A useful practical exercise: change the viola's offbeat attacks in four bars to
half notes, regenerate the score and compare. The harmony can remain identical,
yet the perceived energy changes substantially. That is one of the central
lessons of arranging: orchestration, rhythm, register and silence shape the
result as much as the choice of chord.
