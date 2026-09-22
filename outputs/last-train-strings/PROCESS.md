# Last Train to London: a faithful piano-to-strings transcription

## What you receive

A full score for five string sections, five separate section parts, editable
MusicXML, the Python generator, tests, and a note-by-note source map. Composer:
Jeff Lynne. The supplied piano score credits its arrangement to Zach V.; that
credit is retained in the printed transcription.

This is a string-orchestra edition, not a five-player quintet. At the densest
moments the writing requires two Violin I lines, two Violin II lines, four viola
lines, three cello lines and one bass line. A minimum allocation for the written
divisi is therefore 2/2/4/3/1 players; larger balanced sections are possible.
Multiple notes are divided between players, not prescribed as double stops.
Section principals still need to distribute the divisi lines among desks.

The transcription contains 123 notated measures. All 1,942 pitched source note
segments have a primary destination. None is omitted. There are 63 octave-adjusted
primary segments and 274 separately labelled added double-bass segments. The
source is in a one-sharp key signature, with tempo 121.4 quarter notes/minute.
Repeated sections remain as repeats, not expanded duplicate measures.

## 1. What fidelity means in this project

The invariant is the combination of source identity, onset, duration, pitch class
and tie status. Instrument, octave and extra bass doubling are editable orchestral
parameters. Fidelity here does not mean identical piano timbre, pedal resonance,
or precisely the same balance between notes. Those properties cannot be preserved
by changing instruments alone.

A 'note segment' means one pitched MusicXML note element. A note tied across four
bars contributes four segments but one attack. The 1,942 figure is therefore not
an attack count. The audit separates this distinction rather than inflating a
claim about newly played notes.

All changes are inspectable in note-map.csv and note-map.json. A typical entry has:

```
source_id, bar, onset_beats, duration_beats,
source_staff, source_voice, source_midi,
destination, sounding_midi, octave_shift,
added_doubling, tie_chain
```

A zero octave_shift means the primary note retains its exact sounding pitch.
An added_doubling row is supplemental, never a replacement for a missing source
note. The source input and its hash are included for reproducibility.

## 2. Unpack compressed MusicXML, then reconstruct its timeline

An .mxl file is a ZIP container. META-INF/container.xml identifies the root score.
This file contains score.xml. Read that XML; do not treat the compressed archive
as plain text. The package includes an extracted source.musicxml for easy reruns.

The source uses 60 divisions per quarter note. Ordinary durations are:

| Value | Integer duration |
|---|---:|
| Sixteenth | 15 |
| Eighth | 30 |
| Quarter | 60 |
| Dotted quarter | 90 |
| Whole | 240 |
| Quarter-note triplet | 40 |

The read_source() function tracks the cursor, backup and forward elements. A note
with <chord/> uses the preceding non-chord note's onset and does not advance the
cursor. Staff and voice identifiers remain attached to every source event.

This matters in measure 4: one RH voice sustains the opening chord while another
plays triplets. Looking only at document order would incorrectly play those
layers one after another instead of simultaneously.

Integer timing also protects the unusual source tuplets. In measures 74 and 76,
quintuplet notes are encoded as five eighth notes in the time of seven eighth
notes: 30 * 7/5 = 42 divisions each. They remain exactly 42 divisions. This edition
does not silently quantize or 'correct' that unusual source rhythm.

## 3. Identify musical roles, not merely piano hands

A left-hand staff does not always contain bass. In measures 33-38 and related
returns, the piano's LH moves into treble register. Those notes function as inner
or accompanying lines and are assigned to upper strings rather than automatically
to the double bass.

The principal editorial rules are:

- Highest note of a RH onset group: Violin I.
- Next note: Violin II.
- Remaining RH chord tones: Viola, divided when needed.
- Low LH line: Cello.
- Higher LH chord members or treble-register LH material: Viola or Violin II.
- Selected low-source attacks: additional Double Bass support.

These are inspectable heuristics for this piano score, not a claim that 'highest
note always equals the true melody' in all music. A sustained voice and a new
foreground figure can coexist in the same section, so the section divides.
A different artistic balance could promote selected figures to another section.

## 4. Bind ties before choosing instruments

Chord rank can change while one pitch continues. A source D may be the top note
of one chord but an inner note of the next. If we allocate each chord independently,
that sustained D could jump from one instrument to another halfway through its
tie. The generator avoids that by first building a tie-chain identity.

Tie validation requires the same source staff/voice/pitch and exact temporal
continuity. Once the first segment is assigned, the entire chain inherits its
instrument and octave shift. This is a hard constraint, not a low-priority cost.

```
if note.tie_chain in previous_decisions:
    destination, octave_shift = previous_decisions[note.tie_chain]
else:
    destination, octave_shift = choose_role_and_register(note)
```

This edition preserves musical sustains. It does not require a string player to
perform every long tie in one physical bow. Discreet bow changes are explicitly
permitted. Bow distribution and coordinated attacks remain player decisions.

## 5. Keep the riff instead of replacing it with generic accompaniment

The recurring low piano figure is a defining feature of this arrangement. The
cello keeps its notes, rests and syncopated attacks, including the faster sixteenth
figures. The bass adds selected reinforcing attacks; it does not replace that
figure with invented root notes or a new walking line.

The bass-selection policy is explicit: choose the lowest member of a source LH
group, with pitch no higher than G3, beginning on a quarter-note boundary and
lasting at least an eighth. If that attack starts a tie chain, copy the entire
chain. The new bass part therefore derives from source material and contains
intentional rests between its selected attacks.

Where feasible, the bass doubling sounds one octave below that source note. If
that would fall below the standard low E, it uses the source octave instead. This
edition requires no low-C extension. Its actual bass range is E1-G2 sounding.
The cello's actual range is C2-G3, with below-C2 source material raised an octave.

## 6. Register changes and what they cost

Professional string ranges are not one universal hard ceiling. Here, the code
uses explicit editorial boundaries to avoid very high or physically unavailable
notes. Actual sounding ranges in the result are:

| Section | Range |
|---|---|
| Violin I | G3-G6 |
| Violin II | G3-B5 |
| Viola | C3-G5 |
| Cello | C2-G3 |
| Double Bass | E1-G2 |

The most conspicuous planned change lowers RH material in measures 73-76 by one
octave. Some other isolated register changes keep notes within the selected
instrument ranges. All are logged; no source pitch class changes.

An octave change is not perceptually neutral: brightness, projection, spacing and
voice prominence change. Thus exact interval spacing is retained where possible,
but pitch-class preservation is the invariant when a register adjustment is
necessary. Listen to these passages with the piano source when reviewing the
edition. A range check is not a full fingering or bowing feasibility proof.

Instrument references: [Philharmonia instrument resources](https://philharmonia.co.uk/resources/instruments/)
and [Double Bass](https://philharmonia.co.uk/resources/instruments/double-bass/).
The resources explain the instruments; the numerical working limits above are
explicit choices for this edition, not limits quoted from those pages.

## 7. Divisi preserves harmony without demanding impossible chords

A piano can strike more pitches at once than five monophonic players can sustain.
The choice is to omit/revoice material, require double stops, or divide sections.
For this source-preserving edition, I chose divisi.

In dense passages, several source layers may reach the viola simultaneously. They
are printed as chord stacks and, when rhythms differ, separate notated voices.
They are not four-note chords for one violist. The guide and opening part marking
state the maximum division explicitly. A small quintet edition would require a
separate reduction with a documented omission and redistribution policy.

Unlike the previous piano accompaniment example, this generator does not use a
minimum-motion chord optimizer. It retains existing source pitches and rhythmic
layers, then assigns them by role with tie continuity. Calling that a global
voice-leading optimization would misdescribe the implementation.

## 8. Convert notation semantics correctly

Piano pedal marks and octave-line graphics are removed. Written note durations
are retained; pedal resonance is not converted into invented extra note lengths.
The source's encoded pitch already includes the sounding octave associated with
its octave-line notation. Reapplying that octave shift would transpose twice.

Double bass is the opposite issue: its part is newly notated one octave above
its sound. The exported pitch is therefore raised by 12 semitones and MusicXML
contains octave-change -1. The validator converts back to sounding pitch before
checking fidelity.

[MusicXML transpose](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/)
defines transposition as what must be added to written pitch to get sounding
pitch. This distinction is essential for comparing orchestral scores in code.

Articulations and tuplet boundaries that the source stores only on the bottom
note of a piano chord are propagated to separated section members. Each pitch
retains its own ties. Dynamics and hairpins are transferred; their final orchestral
balance still needs musical review. The directions 'arco' and light detached
cello playing are editorial, not recovered from the piano performance.

No blanket slurs or automatic up/down-bow pattern have been added. Sustained
phrases may use unobtrusive changes; rapid figures may use short strokes.
[Philharmonia's violin resource](https://philharmonia.co.uk/resources/instruments/violin/)
is useful for understanding direction and articulation. Rehearsal determines the
best bow lengths, attack character and desk coordination at the source tempo.

## 9. Export five parts and the full score

Each section gets its own MusicXML part, instrument sound, clef and MIDI program.
Simultaneous source notes assigned to one section become divisi chord members;
independent source streams remain separate rhythmic voices. Gaps receive rests.
Full-measure silence is encoded as a measure rest. Secondary voice rests can be
hidden to avoid unnecessary engraving clutter.

Tuplet durations are retained, not rounded. Repeat barlines are copied into every
part. The score and individual parts are exported independently and reopened for
verification. The editable files can be imported into MuseScore or Dorico.

## 10. What is tested

Eight tests verify:

1. Every pitched source segment has exactly one primary destination.
2. Exported onsets, durations, sounding pitches and tie statuses match the mapping.
3. Tie chains keep one section and octave shift.
4. Sounding pitches fit the chosen ranges, including bass transposition.
5. The measure-4 triplets retain their exact integer timing.
6. Added bass events can be traced to original source events.
7. No piano pedals or source octave-line graphics survive in the string output.
8. A deliberately corrupted duration is rejected.

The PDFs were rendered and inspected for layout. These checks do not establish a
performer-approved balance, optimal bowing, or optimal page turns. No audio
realization was assessed. The source-to-destination map enables a player to review
specific musical changes instead of accepting an unexplained 'AI arrangement'.

## 11. Reproduce and experiment

From this folder, with Python 3 installed:

```
python3 transcribe.py
python3 -m unittest -v
```

The generator needs only Python's standard library and source.musicxml. It writes
six MusicXML files, note-map.json, note-map.csv and validation.json. It does not
regenerate PDF automatically. Import the updated MusicXML into your notation
program and export again. engrave-jobs.json illustrates the MuseScore batch
export format, but its absolute paths must be updated if you move the folder.

This generator is audited for this file's 4/4 meter and 60 divisions. It does not
pretend to support every possible MusicXML score. Generalizing means adding
meter/division handling, more robust role analysis, and policy choices for divisi,
register, instrument availability and source errors.

Useful experiments:

- Disable added bass doublings and compare how the groove's weight changes.
- Compare the register of measures 73-76 with the piano source.
- Reassign a treble-LH phrase to a different section and retain the tie-chain test.
- Design a quintet reduction that explicitly ranks which duplicate notes may be
  omitted. Keep that as a separate edition with its own audit.

The references above are public explanations of the notation and instruments.
They are not assertions about specific training-data origins. The direct source
of the music is your supplied piano score; the arrangement rules and code are
fully exposed here.
