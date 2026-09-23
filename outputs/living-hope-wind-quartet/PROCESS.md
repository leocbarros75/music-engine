# Living Hope: piano-to-wind-quartet transcription

Music by Brian Johnson and Phil Wickham. Piano source arranged by Dan Galbraith,
PraiseCharts #71163, CCLI #7106807. Original source and rights metadata retained.

## What this edition does

This is a self-contained quartet for flute, oboe, B-flat clarinet and bassoon.
There is no piano part in the quartet. It follows the supplied piano score's
62 notated measures in E-flat major, 4/4, quarter note = 71, including repeats
and first/second endings.

The source is a piano accompaniment, without a separate vocal melody staff.
Consequently the flute carries the piano's upper line, not an independently
reconstructed version of the sung melody. This distinction matters: chordal
accompaniment can repeat a top pitch while the singer would move elsewhere.

The quartet is a reduction. Four wind players cannot reproduce every note of
a dense piano texture at once. The transcription represents 870 of the source's
1,005 pitched note segments; 135 are unselected. Of those, 100 belong to the
alternate left-hand voice 4, and 35 are octave doublings or unselected interior
material. A segment is a MusicXML note element, including tied continuations,
not necessarily a new attack. These counts do not imply identical durations:
48 selected releases have been shortened by an eighth note for breathing.

Every retained event is traceable in `note-map.json`. Every unselected source
segment is listed in `omissions.json`. No new pitch class is invented. There
are 863 wind events before notation splits some durations into tied values;
502 events use an octave different from their source pitch.

## 1. Assign musical responsibilities

| Instrument | Main responsibility | Register decision |
|---|---|---|
| Flute | Highest active right-hand piano note | One octave above the source line |
| Oboe | Next distinct inner right-hand pitch class | Choose a suitable octave and favor continuity |
| B-flat clarinet | Next remaining inner right-hand pitch class | Keep below oboe where selected; use a suitable sounding octave |
| Bassoon | Lowest note of the principal left-hand voice 3 | Raise notes below its low B-flat by octaves |

This policy preserves the piano's recognizable upper contour and bass movement
while removing redundant octave thickness. The oboe and clarinet rest when a
passage has no separate inner tone available. The code does not fill those gaps
with newly harmonized material.

Actual sounding ranges in this edition:

- Flute: G4-E-flat6.
- Oboe: E-flat4-A-flat5.
- Clarinet: B-flat3-E-flat5, written C4-F5.
- Bassoon: B-flat1-A-flat3.

The flute's high register is an intentional color choice, especially in the
later chorus. It needs balance with the middle voices; playing every high note
at maximum strength would defeat that balance. Range compliance alone does not
guarantee ideal blend or effortless phrasing.

The principal left-hand voice is distinct from the optional voice-4 figures.
The piano source's instructions to play alternate figures on later passes are
not reproduced as bassoon instructions, because those alternate notes are not
included in this edition. The main voice's later rhythmic changes are retained.

## 2. Recover the source timeline

The source has eight MusicXML divisions per quarter note:

```python
sixteenth = 2
eighth = 4
quarter = 8
bar = 32
```

`read_source()` follows the MusicXML cursor. A normal note advances time; a
chord member shares its preceding note's onset; a `backup` returns the cursor
for another voice. This avoids the common mistake of reading a two-staff piano
score as one long sequential melody.

Each source note receives an ID, staff, voice, onset, duration, MIDI pitch and
tie-chain identity. A tie continuation reuses the chain of the note it extends.
Repeated notes without a tie retain different identities even when their
pitches are identical. This prevents separate piano attacks from being silently
converted into one sustained wind note.

## 3. Reduce active notes at change-points

The algorithm builds a sorted list of all starts and ends within a measure.
Between consecutive change-points, it asks which source notes are active:

```python
active = [n for n in notes if n.onset <= time < n.onset + n.duration]
```

The highest active right-hand pitch determines the flute line. The next
different right-hand pitch classes supply the inner voices. This is an upper
envelope of the actual piano texture; it also handles overlapping right-hand
voices in measures 20-21.

Adjacent time cells are merged only if the same source tie chain and output
pitch remain selected. This removes artificial fragments caused by another
staff's rhythm while preserving genuine repeated attacks.

This is a transparent editorial selection rule, not an assertion that the
highest note always represents a singer's melody. For this brief it provides
a faithful transcription of the available piano upper line. To produce a
quartet led by the sung melody, a vocal melody source would be needed.

## 4. Register and voice leading

The flute's octave displacement is consistent throughout, preserving contour.
The inner winds use the original pitch classes but choose octaves near their
preceding selected pitches, within the edition's limits. The selected octave
is locked to the source tie chain so a continued note cannot jump an octave
halfway through its tie.

The bassoon retains the principal bass pitch class. Notes below B-flat1 are
raised by octaves; for example, a piano E-flat1 becomes bassoon E-flat2. This
necessarily changes some bass intervals and removes some octave contrasts.
Those changes are recorded rather than described as a literal note-for-note
copy. Some source bass leaps remain: professionals should shape them with a
light attack rather than turning every arrival into an accent.

## 5. B-flat clarinet notation

The working data uses sounding pitches. Only the exported clarinet notation is
written a major second higher:

```python
written_midi = sounding_midi + 2
```

Thus a concert E-flat is written F. E-flat major becomes written F major.
The MusicXML part specifies `diatonic = -1` and `chromatic = -2`, meaning that
the written pitch sounds a major second lower. The full score is a transposed
score: the clarinet line uses the same written notation as its separate part.

The code also advances the note letter diatonically and then calculates the
needed accidental. This preserves meaningful spelling rather than blindly
mapping every MIDI number to a preferred sharp or flat.

The validator decodes the output back to sounding pitches before comparing it
with the transcription data. Comparing written clarinet pitches directly to
concert-pitch data would falsely report every clarinet note as an error.

## 6. Breathing is an editorial change

Piano notation can sustain sound while wind players must breathe. This edition
staggered releases so that the whole quartet does not routinely stop together.
Flute has candidate breaths every two bars; inner winds and bassoon use offset
four-bar patterns. The candidates are subject to musical constraints:

1. The event must finish at the barline.
2. It must not continue into a tied event.
3. A sufficiently long note can release an eighth note early, with an explicit
   rest filling the bar.
4. If the final event is too short, retain the attack and add a breath comma
   instead of deleting the note.

There are 63 breath marks, including 48 explicit eighth-rest releases. At
quarter note = 71, an eighth note lasts approximately 0.42 seconds. Breath
commas without a written rest ask the player to borrow a small amount of time
from the preceding value while maintaining the ensemble pulse.

This is a starting breath plan, not a physiological guarantee. Air use varies
with instrument, dynamic, register and performer. Players may move breaths;
the important rehearsal goal is to preserve the phrase and avoid simultaneous
gaps. Repeated notes also offer small articulation separations.

No early release is inserted into the final fermata. The four players should
agree on its length and cutoff, taking enough air before the final arrival.

## 7. Ties, slurs and articulation

Source ties are preserved when the same selected source chain continues
contiguously at the same output pitch. A duration that must be split for clear
notation is joined with internal ties as well.

Short slurs are added to contiguous eighth/sixteenth figures within one beat,
where their intervals are moderate. These slurs do not cross a breath or absorb
a tied continuation. They indicate a connected wind articulation, rather than
the string bow allocation discussed in earlier projects.

Most quarter-note chordal motion remains gently articulated under the opening
`dolce, cantabile` instruction. The bassoon receives a light-support instruction
so the piano's rhythmic weight does not become a series of heavy wind accents.

The source's dynamics, hairpins and tempo transfer to the quartet. Piano pedal,
vocal lyric-entry snippets and directions for omitted alternate figures do not.
Rehearsal labels are supplied consistently in the full score and separate parts.

The source's composite `mp - mf` is exported as one italic text marking, avoiding
three overlapping dynamic objects. Faster notes are explicitly beamed by beat
to make the bassoon's dotted and subdivided rhythms readable.

## 8. Reproduce and inspect

The generator uses only Python 3's standard library. In this folder:

```sh
python3 transcribe.py
python3 -m unittest -v
```

It writes the full score and four parts as MusicXML, plus mapping, omission,
validation and engraving-job JSON files. It does not modify the original file
on the external drive. The included `original-piano.musicxml` is unchanged.

PDF generation is separate. With MuseScore 4 on macOS:

```sh
"/Applications/MuseScore 4.app/Contents/MacOS/mscore" -j engrave-jobs.json
```

Run the generator after moving the folder to refresh the absolute file paths
in the job list. A MusicXML edit does not automatically update an existing PDF.

Nine tests check source-to-output mapping, source-duration coverage, flute
upper-line fidelity, clarinet key/transposition, breath shortening, tie and slur
integrity, individual-part agreement, ranges, repeats and endings. Deliberately
corrupted pitch and duration examples verify that validation can fail.

These checks establish structural properties. They do not substitute for
listening, a live read-through or player feedback. The edition has not been
approved by professional wind players, and no audio-based balance assessment
is claimed.

## 9. Learning references

The source notes and rhythms come from the supplied piano file. The following
orchestra resources offer player demonstrations and instrument context:

- [Philharmonia: Flute](https://philharmonia.co.uk/resources/instruments/flute/)
- [Philharmonia: Oboe](https://philharmonia.co.uk/resources/instruments/oboe/)
- [Philharmonia: Clarinet](https://philharmonia.co.uk/resources/instruments/clarinet/)
- [Philharmonia: Bassoon](https://philharmonia.co.uk/resources/instruments/bassoon/)
- [W3C: MusicXML transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)

The sources explain instrument characteristics and the notation standard; the
selection, octave and breathing policies above are editorial decisions for
this transcription.

A useful exercise is to inspect measure 24 in the source and quartet. Identify
the piano's top B-flat, its inner A-flat/E-flat material, and its low bass.
Then examine the clarinet's written notes alongside their sounding pitches.
This separates three operations that are often confused: selecting a voice,
placing it in an octave, and transposing its notation for the instrument.
