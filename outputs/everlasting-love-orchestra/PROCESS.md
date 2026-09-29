# The Everlasting Love of God: orchestral transcription

## The edition

This is a piano-to-orchestra transcription for the exact nineteen parts requested: Flute 1, Flute 2, Oboe, B-flat Clarinet, Bassoon, Horns 1 and 2 in F, B-flat Trumpets 1 and 2, Trombone 1, Trombone 3, Bass Trombone, Tuba, Timpani, Violin 1, Violin 2, Viola, Cello and Double Bass. The label Trombone 3 is intentional. There is no piano in the performing score; the orchestra carries the piano material.

The source credits Matt Boswell, Matt Papa and Matt Redman as composers, Jeff Moore as arranger, and Daniel Galbraith for orchestration. Those supplied credits and rights metadata remain in the output. This new edition is an editorial transcription of the supplied piano file; it does not purport to reproduce the publisher's orchestration.

The source has 79 notated measures in F major, with quarter note = 72 and changes among 4/4, 2/4 and 3/4. It contains one piano part on two staves and no separate vocal line. “Melody” below therefore means the piano's highest sounding right-hand line. That is a useful structural proxy, not a claim that every piano fill is a sung melody.

## Source preservation and deliberate adaptation

The source file is copied unchanged as `original-piano.musicxml`. The orchestral edition preserves measure order, time signatures, repeat barlines, segno/coda symbols, source tempo/dynamic shapes and final ritardando. Keyboard-specific directions, such as the synth cue, are not transferred. Printed navigation symbols are copied without inventing additional D.S. or jump instructions absent from the supplied file.

Every retained orchestral pitch comes from a piano note sounding at that point. Octave displacement, selective omission, doubling, and shortening for breaths are permitted. No new pitch classes or reharmonization are introduced. The output contains 3,384 instrumental events before notation splits, drawing on 1,168 of the 1,345 pitched source segments. The 177 unselected source segments are recorded in `omissions.json`. A segment may be a tied continuation rather than a fresh attack.

These counts do not measure artistic quality: one piano note may feed several instruments. Conversely, a redundant octave or alternate left-hand voice may contribute nothing. The package makes those choices inspectable.

## 1. Parse time rather than reading notes as a flat list

MusicXML represents simultaneous voices with a cursor. A normal note advances it; a chord member shares the previous onset. A backup rewinds it and a forward moves it ahead. The parser also reads direction offsets and tracks active time signatures.

This source uses eight divisions per quarter note. A 4/4 measure spans 32 units, 3/4 spans 24, and 2/4 spans 16. The `BARS` table records each measure's length and cumulative start. This prevents the common error of treating every bar as four beats.

```python
length = beats * 32 // beat_type
absolute_start = BARS[bar - 1]['start'] + onset
```

The parser records pitch, onset, duration, staff, voice and a unique source ID. Tied continuations share a chain ID. Repeated attacks on the same pitch have separate chains. That distinction prevents repeated piano notes from becoming accidental sustained orchestral ties.

## 2. Construct the active texture

For each measure, all note onsets and endings become boundaries. Between adjacent boundaries, the active set of source notes is constant. The algorithm sorts right-hand notes by pitch, selects the highest as the principal line, and extracts distinct lower pitch classes for interior voices.

The principal bass is the lowest active note in left-hand voice 2. The source's additional left-hand voice 3 is omitted rather than indiscriminately combined with the principal line. This is an editorial choice to review against the source if a particular alternate figure is important to you.

```python
active = [n for n in notes if n['on'] <= start < n['on'] + n['dur']]
upper = sorted((n for n in active if n['staff'] == 1),
               key=lambda n: -n['midi'])
```

This method catches offbeat changes and short piano figures. It does not infer chords from a downbeat snapshot.

## 3. Give each section a clear job

| Section | Treatment |
|---|---|
| Violin 1 | Continuous upper piano line, octave-adjusted only when outside its working range |
| Violin 2 | First distinct interior right-hand tone |
| Viola | Deeper interior tone; selected octave support in larger sections |
| Cello | Principal piano bass adapted to cello range |
| Double bass | Lower-register reinforcement of that bass |
| Flute 1 / Oboe | Selected melodic color over the string foundation |
| Flute 2 / Clarinet | Selected interior harmony, with flute in the higher octave |
| Bassoon | Alternating or fuller-section bass reinforcement |
| Horns | Middle-register harmony, entering more fully as the texture grows |
| Trumpets | Melody and upper interior reinforcement in larger sections |
| Tenor trombones | Lower harmonic voices in larger sections |
| Bass trombone | Structural bass punctuation, rather than continuous doubling |
| Tuba | Low bass reinforcement in larger sections |
| Timpani | Twelve selected F2/C3 punctuation notes |

The fuller sections are measures 22-30, 40-45 and 57 onward. Earlier verses rely primarily on strings, with selected woodwind entries. Oboe colors verse passages in measures 4-13 and 46-56; Flute 1 takes the other selected melodic passages. The entries are deliberate, piece-specific scheduling rules, not an automatic discovery of ideal orchestration.

An important limitation is that the top piano line sometimes consists of accompaniment figuration. The continuous Violin 1 line preserves that motion. A later free arrangement could simplify it or redistribute it more radically, but that would be a different task from this transcription.

## 4. Adapt register and voice leading

For a given source pitch class, the code enumerates octave equivalents inside an instrument's working range. It chooses the candidate closest to the target register. Principal lines target the original pitch or a deliberate octave displacement; other parts use a previous-pitch preference where no explicit target is supplied.

```python
candidates = [p for p in range(low, high + 1) if p % 12 == pitch_class]
chosen = min(candidates, key=lambda p: (abs(p - target), p))
```

This is a local register-selection rule. It does not optimize the entire phrase, prohibit every crossing, or solve all fingering and bowing questions. The actual extrema appear in `playability-audit.json`; they are measured results, not textbook maximum ranges.

For example, a right-hand F3 is below the violin's G3 lower bound. The violin therefore receives F4. The melody test explicitly allows this octave adaptation while requiring the selected source pitch class and timing to match. Low-bass notes similarly move to a playable octave where necessary.

Every part is monophonic. There are no generated string double stops or divisi requirements. The conductor may assign any suitable number of players to each string part.

## 5. Transpose notation after musical allocation

All calculations use concert pitch. Written transposition is applied only during export:

| Part | Written relative to sounding | Written key |
|---|---|---|
| Clarinet and trumpets in B-flat | Major second higher | G major |
| Horns in F | Perfect fifth higher | C major |
| Double bass | Octave higher | F major |
| Other instruments | Concert pitch | F major |

Viola uses alto clef. Bassoon, trombones, tuba, timpani, cello and double bass use bass clef. The full score is transposed, matching the player parts.

The source spelling is retained diatonically when transposed: letter-name movement and semitone movement are computed together. The double-bass MusicXML uses `octave-change = -1` so playback is an octave below the notation. General MIDI instruments are assigned across two ports to avoid conflicting program assignments when nineteen parts exceed the available non-percussion channels on one port. Importers vary in their playback routing; no audio preview is certified here.

## 6. Breaths and string articulation

A wind or brass note reaching a measure end is shortened by up to an eighth note, where its duration permits, except in the final measure. This provides 298 written breathing releases. The longest measured uninterrupted wind/brass passage in the notated sequence is 3.875 quarter-note beats, excluding the final bar. At quarter = 72, that is about 3.23 seconds.

Some rests are brief. This bound is an audit of continuity, not a guarantee that a particular player can breathe comfortably at every marked release. Breath timing, instrument resistance, register and dynamics still require rehearsal. Strings continue through these releases so the musical line is not dependent on every wind sustaining to the barline.

Ties are reconstructed only when the source chain, pitch and temporal adjacency agree after editing. Short, contiguous figures within a beat receive selective slurs when the interval and articulation conditions allow. For strings these propose short bow groups. Up-bow and down-bow markings are not imposed globally: concertmaster and section leaders should determine them after considering tempo, string crossings, contact point and phrase emphasis. Unslurred notes use separate bows unless the players agree otherwise.

The continuous violin and bass writing is intentional source preservation. Bow distribution, stamina and page turns need practical review; use facing pages or a tablet where a continuous line prevents a convenient turn.

## 7. Timpani as a harmonic instrument

The timpani part is pitched, tuned to F2 and C3, with soft mallets and damping at rests. A note is selected only at a larger-section measure opening whose active principal piano bass has pitch class F or C. Other harmonies receive a rest. This avoids both invented drum pitches and mandatory retuning during the passage.

The part contains twelve attacks, no rolls and no pedal-tuning changes. Their durations reflect the retained source interval; the player should coordinate damping and resonance in rehearsal. The intention is structural emphasis, not a continuous percussion groove.

## 8. Engraving and verification

The conductor score uses a large page format with one nineteen-staff system per page, normally four measures per system. The parts are separately engraved, with section labels and changing meters. The source's coordinates and font choices are normalized, while its musical dynamic instructions remain. Composite dynamic ranges are rendered as one text instruction to avoid collisions.

Thirteen tests cover sounding-pitch reconstruction, duration completeness, ranges, monophony, meter changes, navigation symbols, transpositions, part-to-score identity, source activity for every retained time unit, the upper piano line with octave adaptation, ties, fixed timpani tuning and the wind breathing bound. Deliberate pitch and duration corruption must fail validation.

Generated MusicXML is parsed back and compared with the event data. PDF pages are rendered and visually checked separately. None of these checks establishes that the orchestra has played the score. Listening review, balance, bowing, breathing and page-turn planning remain distinct tasks. In particular, the source dynamics transferred to many simultaneous instruments may need adjustment for the size of your string section and room.

## Reproduce and study the code

The generator uses Python 3's standard library. Keep it beside the original source copy:

```sh
cd /path/to/everlasting-love-orchestra
python3 transcribe.py
python3 -m unittest discover -s . -p 'test_*.py' -v
mscore -j engrave-jobs.json
```

Run the generator after moving the folder so the batch export paths are refreshed. MuseScore can alternatively open each MusicXML directly. Preserve manual notation edits in separately named files, because running the generator overwrites its outputs.

`note-map.json` lists every event's source IDs, musical role, octave placement, breath trim, ties and slurs. `omissions.json` identifies unselected source notes. `validation.json` records structural results and the original source hash. `playability-audit.json` records per-part event counts, ranges and continuity. For strings, long continuity values mean uninterrupted notes, not a single bow.

Suggested study: compare measures 4-7 with 22-25, tracing the same source roles into different instrument combinations. Then mute brass conceptually and identify which strings still maintain melody, harmony and bass. Finally, inspect a 2/4-to-4/4 transition and follow the cumulative time calculation in `BARS`. This connects orchestration decisions with the data model that makes them auditable.

## References

- [Philharmonia instrument demonstrations](https://philharmonia.co.uk/resources/instruments/): player-led introductions to orchestral instruments.
- [Philharmonia timpani](https://philharmonia.co.uk/resources/instruments/timpani/): study the instrument and its player perspective.
- [Philharmonia double bass](https://philharmonia.co.uk/resources/instruments/double-bass/): listen to the bass's orchestral role and sound.
- [W3C MusicXML transpose reference](https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/transpose/): written-to-sounding encoding.

These resources support instrument and notation study. The exact allocation schedule, octave choices and breath rules in this edition are editorial decisions implemented in the supplied code, not universal rules attributed to those sources.
